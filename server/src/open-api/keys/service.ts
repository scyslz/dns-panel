/**
 * API Key 业务逻辑
 *
 * 设计约定：
 *  - API Key 与单个 User 完全绑定，拥有该 User 的全部权限，不再区分 scope
 *  - 明文只返回一次，库中只存哈希
 */

import { PrismaClient } from '@prisma/client';
import { ApiError } from '../errors';
import { generateApiKey, parseApiKey, verifySecret } from './crypto';

const prisma = new PrismaClient();

export interface ApiKeyContext {
  id: number;
  userId: number;
  name: string;
  credentialId: number | null;
  allowedDomains: string[];
  allowedIps: string[];
  rateLimitPerMin: number;
}

export interface CreateApiKeyInput {
  userId: number;
  name: string;
  credentialId?: number | null;
  allowedDomains?: string[];
  allowedIps?: string[];
  rateLimitPerMin?: number;
  expiresAt?: string | Date | null;
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeDomains(input: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (input || [])
        .map((item) => String(item).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, ''))
        .filter(Boolean)
    )
  );
}

function normalizeIps(input: string[] | undefined): string[] {
  return Array.from(new Set((input || []).map((item) => String(item).trim()).filter(Boolean)));
}

export async function createApiKey(input: CreateApiKeyInput) {
  const name = String(input.name || '').trim();
  if (!name) throw new ApiError('INVALID_ARGUMENT', '缺少参数: name', 400);

  const rateLimitPerMin = Number.isFinite(Number(input.rateLimitPerMin))
    ? Math.max(1, Math.min(10000, Number(input.rateLimitPerMin)))
    : 60;

  let credentialId: number | null = null;
  if (input.credentialId !== undefined && input.credentialId !== null) {
    const credential = await prisma.dnsCredential.findFirst({
      where: { id: Number(input.credentialId), userId: input.userId },
      select: { id: true },
    });
    if (!credential) throw new ApiError('INVALID_ARGUMENT', '凭证不存在或无权访问', 400);
    credentialId = credential.id;
  }

  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    throw new ApiError('INVALID_ARGUMENT', 'expiresAt 不是合法时间', 400);
  }

  const generated = generateApiKey('live');

  const record = await prisma.apiKey.create({
    data: {
      userId: input.userId,
      name,
      keyId: generated.keyId,
      keyHash: generated.keyHash,
      keySuffix: generated.keySuffix,
      credentialId,
      allowedDomains: JSON.stringify(normalizeDomains(input.allowedDomains)),
      allowedIps: JSON.stringify(normalizeIps(input.allowedIps)),
      rateLimitPerMin,
      expiresAt,
    },
  });

  return {
    id: record.id,
    name: record.name,
    keyId: record.keyId,
    // 明文只在这里出现一次
    key: generated.plain,
    credentialId: record.credentialId,
    allowedDomains: parseJsonArray(record.allowedDomains),
    allowedIps: parseJsonArray(record.allowedIps),
    rateLimitPerMin: record.rateLimitPerMin,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

export async function listApiKeys(userId: number) {
  const rows = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    keyId: row.keyId,
    keyPreview: `dns_live_${row.keyId}_***${row.keySuffix || ''}`,
    keySuffix: row.keySuffix,
    credentialId: row.credentialId,
    allowedDomains: parseJsonArray(row.allowedDomains),
    allowedIps: parseJsonArray(row.allowedIps),
    rateLimitPerMin: row.rateLimitPerMin,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    lastUsedIp: row.lastUsedIp,
    createdAt: row.createdAt,
    active: !row.revokedAt && (!row.expiresAt || row.expiresAt.getTime() > Date.now()),
  }));
}

export async function revokeApiKey(userId: number, id: number) {
  const row = await prisma.apiKey.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError('INVALID_ARGUMENT', 'API Key 不存在', 404);
  if (row.revokedAt) return { id: row.id, revokedAt: row.revokedAt };
  const updated = await prisma.apiKey.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });
  return { id: updated.id, revokedAt: updated.revokedAt };
}

/**
 * 校验明文 Key，返回请求上下文。
 * 每次请求都查库：保证吊销立即生效。
 */
export async function authenticateApiKey(raw: string): Promise<{
  key: ApiKeyContext;
  user: { id: number; username: string; email: string };
}> {
  const parsed = parseApiKey(raw);
  if (!parsed) throw new ApiError('INVALID_API_KEY', 'API Key 格式不正确', 401);

  const record = await prisma.apiKey.findUnique({ where: { keyId: parsed.keyId } });
  if (!record) throw new ApiError('INVALID_API_KEY', 'API Key 无效', 401);
  if (record.revokedAt) throw new ApiError('INVALID_API_KEY', 'API Key 已吊销', 401);
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    throw new ApiError('KEY_EXPIRED', 'API Key 已过期', 401);
  }
  if (!verifySecret(parsed.secret, record.keyHash)) {
    throw new ApiError('INVALID_API_KEY', 'API Key 无效', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, username: true, email: true, isActive: true, role: true },
  });
  if (!user || !user.isActive) throw new ApiError('INVALID_API_KEY', 'API Key 所属用户已禁用', 401);

  return {
    key: {
      id: record.id,
      userId: record.userId,
      name: record.name,
      credentialId: record.credentialId ?? null,
      allowedDomains: parseJsonArray(record.allowedDomains),
      allowedIps: parseJsonArray(record.allowedIps),
      rateLimitPerMin: record.rateLimitPerMin,
    },
    user: { id: user.id, username: user.username, email: user.email || '' },
  };
}

/** 异步更新 lastUsedAt，60 秒节流，不阻塞请求 */
export function touchApiKey(id: number, ip: string) {
  const sixtySecondsAgo = new Date(Date.now() - 60_000);
  prisma.apiKey
    .updateMany({
      where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: sixtySecondsAgo } }] },
      data: { lastUsedAt: new Date(), lastUsedIp: ip },
    })
    .catch(() => {
      /* 统计用途，失败不影响请求 */
    });
}
