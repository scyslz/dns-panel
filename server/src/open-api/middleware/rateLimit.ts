/**
 * 按 API Key 的滑动窗口限流（进程内）
 *
 * 不引入新依赖，也不使用全局限流：每个 Key 独立配额，避免一个 Key 打满影响其他 Key 或页面用户。
 * 多实例部署时每个实例独立计数（如需全局配额，后续可换成 Redis/DB）。
 */

import { NextFunction, Response } from 'express';
import { ApiError } from '../errors';
import { ApiRequest } from './auth';

const WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, timestamps] of buckets) {
    const alive = timestamps.filter((ts) => now - ts < WINDOW_MS);
    if (alive.length === 0) buckets.delete(key);
    else buckets.set(key, alive);
  }
}

export function perKeyRateLimit(req: ApiRequest, res: Response, next: NextFunction) {
  const key = req.apiKey;
  if (!key) return next(new ApiError('INVALID_API_KEY', '未认证', 401));

  const now = Date.now();
  sweep(now);
  const bucketKey = `key:${key.id}`;
  const timestamps = (buckets.get(bucketKey) || []).filter((ts) => now - ts < WINDOW_MS);
  const limit = Math.max(1, key.rateLimitPerMin);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0];
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', '0');
    return next(
      new ApiError('RATE_LIMITED', `请求过于频繁，请 ${retryAfter} 秒后重试`, 429, {
        limit,
        windowSeconds: WINDOW_MS / 1000,
        retryAfter,
      })
    );
  }

  timestamps.push(now);
  buckets.set(bucketKey, timestamps);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - timestamps.length)));
  next();
}
