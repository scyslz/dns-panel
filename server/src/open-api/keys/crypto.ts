/**
 * API Key 的生成 / 解析 / 哈希
 *
 * 格式：dns_<env>_<keyId>_<secret>
 *  - env: live | test（仅展示用，不影响校验）
 *  - keyId: 8 位十六进制，明文入库并建唯一索引，用于 O(1) 查找
 *  - secret: 32 位 base64url，只返回一次，库中仅存哈希
 */

import crypto from 'crypto';
import { config } from '../../config';

const KEY_PATTERN = /^dns_(live|test)_([a-f0-9]{8})_([A-Za-z0-9_-]{20,64})$/;

export interface GeneratedApiKey {
  plain: string;
  keyId: string;
  secret: string;
  keySuffix: string;
  keyHash: string;
  env: 'live' | 'test';
}

export function pepper(): string {
  return process.env.API_KEY_PEPPER || config.jwt.secret;
}

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(`${secret}${pepper()}`).digest('hex');
}

export function generateApiKey(env: 'live' | 'test' = 'live'): GeneratedApiKey {
  const keyId = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(24).toString('base64url');
  return {
    plain: `dns_${env}_${keyId}_${secret}`,
    keyId,
    secret,
    keySuffix: secret.slice(-4),
    keyHash: hashSecret(secret),
    env,
  };
}

export function parseApiKey(raw: string): { keyId: string; secret: string; env: string } | null {
  const match = KEY_PATTERN.exec(String(raw || '').trim());
  if (!match) return null;
  return { env: match[1], keyId: match[2], secret: match[3] };
}

export function verifySecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  if (actual.length !== expected.length || actual.length === 0) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** 用于日志/展示的脱敏 */
export function maskApiKey(value: string): string {
  return String(value || '').replace(/dns_(live|test)_[A-Za-z0-9_-]+/g, 'dns_$1_***');
}

export function extractApiKey(headers: Record<string, any>): string | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  const headerKey = headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
  return null;
}
