/**
 * 开放 API 认证 / 授权中间件
 */

import { NextFunction, Request, Response } from 'express';
import net from 'net';
import { getClientIp } from '../../middleware/logger';
import { ApiError } from '../errors';
import { extractApiKey } from '../keys/crypto';
import { ApiKeyContext, authenticateApiKey, touchApiKey } from '../keys/service';

export interface ApiRequest extends Request {
  apiKey?: ApiKeyContext;
  requestId?: string;
  user?: { id: number; username: string; email: string };
}

export async function authenticateApiKeyMiddleware(req: ApiRequest, res: Response, next: NextFunction) {
  try {
    const raw = extractApiKey(req.headers as any);
    if (!raw) throw new ApiError('MISSING_API_KEY', '缺少 API Key，请使用 Authorization: Bearer <key>', 401);

    const { key, user } = await authenticateApiKey(raw);

    if (key.allowedIps.length > 0) {
      const ip = getClientIp(req as any);
      if (!ipAllowed(ip, key.allowedIps)) {
        throw new ApiError('IP_NOT_ALLOWED', `来源 IP ${ip} 不在白名单`, 403);
      }
    }

    req.apiKey = key;
    req.user = user;
    touchApiKey(key.id, getClientIp(req as any));
    next();
  } catch (error) {
    next(error);
  }
}

/** 域名白名单：精确匹配，或以 *. 开头的后缀匹配（不匹配裸域名） */
export function domainAllowed(domain: string, allowed: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  const target = String(domain || '').toLowerCase().replace(/\.$/, '');
  return allowed.some((rule) => {
    const pattern = String(rule || '').toLowerCase().replace(/\.$/, '');
    if (!pattern) return false;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".example.com"
      return target.endsWith(suffix) && target.length > suffix.length;
    }
    return target === pattern;
  });
}

export function assertDomainAllowed(req: ApiRequest, domain: string) {
  const allowed = req.apiKey?.allowedDomains || [];
  if (!domainAllowed(domain, allowed)) {
    throw new ApiError('DOMAIN_NOT_ALLOWED', `域名 ${domain} 不在此 Key 的白名单内`, 403, { allowedDomains: allowed });
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function ipAllowed(ip: string, rules: string[]): boolean {
  const target = String(ip || '').replace(/^::ffff:/, '');
  return rules.some((ruleRaw) => {
    const rule = String(ruleRaw || '').trim();
    if (!rule) return false;
    if (rule.includes('/') && net.isIPv4(rule.split('/')[0])) {
      const [base, bitsRaw] = rule.split('/');
      const bits = Number(bitsRaw);
      const baseInt = ipv4ToInt(base);
      const targetInt = ipv4ToInt(target);
      if (baseInt === null || targetInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
      if (bits === 0) return true;
      const mask = (0xffffffff << (32 - bits)) >>> 0;
      return (baseInt & mask) === (targetInt & mask);
    }
    return target === rule.replace(/^::ffff:/, '');
  });
}
