/**
 * 幂等执行（Idempotency-Key）
 *
 * 复用现有 Cache 表（key 唯一），不新增表。
 *
 * 锁与结果缓存是两件事：
 *  - 锁：请求进入时占位，业务处理完成（成功或失败）立即释放；只有进程崩溃时
 *        才靠 LOCK_LEASE_MS 兜底自动接管，不会把 24h/5min 当成锁。
 *  - 结果：成功后保留一段时间用于回放，时长可配置；设为 0 表示处理完立即删除，
 *        此时只防并发重复，不做事后回放。
 *
 * 两种模式：
 *  - 显式：请求头 Idempotency-Key
 *  - 自动：POST 未带请求头时，用 method + path(含 query) + body 的 SHA-256 生成，
 *          只对 POST 生效（PATCH/DELETE 本身幂等，自动缓存会掩盖真实状态）。
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ApiError } from '../errors';

const prisma = new PrismaClient();

function envSeconds(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** 进程崩溃后的锁租约，不是业务处理时长 */
const LOCK_LEASE_MS = Math.max(10, envSeconds('IDEMPOTENCY_LOCK_SECONDS', 120)) * 1000;
/** 显式 Key 的结果回放时长；0 = 处理完即删除 */
const EXPLICIT_RETENTION_MS = envSeconds('IDEMPOTENCY_RESULT_TTL_SECONDS', 24 * 60 * 60) * 1000;
/** 自动 Key 的结果回放时长 */
const AUTO_RETENTION_MS = envSeconds('IDEMPOTENCY_AUTO_RESULT_TTL_SECONDS', 5 * 60) * 1000;

export interface IdempotentResult<T = any> {
  status: number;
  body: T;
  replay: boolean;
  auto: boolean;
}

function requestHash(method: string, path: string, body: unknown): string {
  return crypto
    .createHash('sha256')
    .update(`${method}\n${path}\n${JSON.stringify(body ?? null)}`)
    .digest('hex');
}

function isUniqueViolation(error: any): boolean {
  return error?.code === 'P2002';
}

export async function withIdempotency<T = any>(
  params: {
    userId: number;
    apiKeyId: number;
    header: string | undefined;
    method: string;
    path: string;
    body: unknown;
    /** 未传 Idempotency-Key 时是否自动生成（调用方只对 POST 开启） */
    auto?: boolean;
  },
  handler: () => Promise<{ status: number; body: T }>
): Promise<IdempotentResult<T>> {
  const header = String(params.header || '').trim();
  const useAuto = !header && params.auto === true;

  if (!header && !useAuto) {
    const result = await handler();
    return { ...result, replay: false, auto: false };
  }
  if (header.length > 200) {
    throw new ApiError('INVALID_ARGUMENT', 'Idempotency-Key 过长（上限 200 字符）', 400);
  }

  const hash = requestHash(params.method, params.path, params.body);
  const key = useAuto
    ? `idem:auto:${params.userId}:${params.apiKeyId}:${hash}`
    : `idem:${params.userId}:${params.apiKeyId}:${header}`;

  const reserved = await reserve(key, hash);
  if (reserved.kind === 'replay') {
    return { status: reserved.status, body: reserved.body, replay: true, auto: useAuto };
  }
  if (reserved.kind === 'conflict') {
    throw new ApiError('IDEMPOTENCY_CONFLICT', '相同 Idempotency-Key 的请求体不一致', 409, { key: header });
  }
  if (reserved.kind === 'in_progress') {
    throw new ApiError('IDEMPOTENCY_IN_PROGRESS', '相同 Idempotency-Key 的请求正在处理中，请稍后重试', 409, {
      retryable: true,
    });
  }

  try {
    const result = await handler();

    // 业务处理完成：锁立即释放
    const retention = useAuto ? AUTO_RETENTION_MS : EXPLICIT_RETENTION_MS;
    if (retention > 0) {
      await prisma.cache
        .updateMany({
          where: { key, expiresAt: reserved.lockUntil },
          data: {
            value: JSON.stringify({ state: 'done', hash, status: result.status, body: result.body }),
            expiresAt: new Date(Date.now() + retention),
          },
        })
        .catch(() => undefined);
    } else {
      await prisma.cache
        .deleteMany({ where: { key, expiresAt: reserved.lockUntil } })
        .catch(() => undefined);
    }

    return { ...result, replay: false, auto: useAuto };
  } catch (error) {
    // 失败立即释放锁，允许客户端用同一个 Key 重试
    await prisma.cache
      .deleteMany({ where: { key, expiresAt: reserved.lockUntil } })
      .catch(() => undefined);
    throw error;
  }
}

type ReserveResult =
  | { kind: 'reserved'; lockUntil: Date }
  | { kind: 'replay'; status: number; body: any }
  | { kind: 'conflict' }
  | { kind: 'in_progress' };

async function reserve(key: string, hash: string): Promise<ReserveResult> {
  const now = Date.now();
  const lockUntil = new Date(now + LOCK_LEASE_MS);
  const value = JSON.stringify({ state: 'in_progress', hash, lockedAt: now });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.cache.create({ data: { key, value, expiresAt: lockUntil } });
      return { kind: 'reserved', lockUntil };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const existing = await prisma.cache.findUnique({ where: { key } });
    if (!existing) continue;

    const isExpired = existing.expiresAt.getTime() <= Date.now();
    if (isExpired) {
      // 原子接管过期锁：只有第一个更新成功的请求拿到锁
      const taken = await prisma.cache.updateMany({
        where: { key, expiresAt: { lte: new Date() } },
        data: { value, expiresAt: lockUntil },
      });
      if (taken.count === 1) return { kind: 'reserved', lockUntil };
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(existing.value);
    } catch {
      parsed = null;
    }

    if (!parsed) return { kind: 'in_progress' };
    if (parsed.hash !== hash) return { kind: 'conflict' };
    if (parsed.state === 'done') {
      return { kind: 'replay', status: Number(parsed.status) || 200, body: parsed.body };
    }
    return { kind: 'in_progress' };
  }

  return { kind: 'in_progress' };
}
