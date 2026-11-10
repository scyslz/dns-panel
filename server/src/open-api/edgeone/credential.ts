/**
 * EdgeOne 凭证 / 站点解析（开放 API 专用）
 *
 * 与页面路由保持一致的表结构（dns_credentials, provider='edgeone'），
 * 但独立实现，避免改动 routes/tencentEdgeOne.ts。
 */

import { PrismaClient } from '@prisma/client';
import { decrypt } from '../../utils/encryption';
import type { Tc3Credentials } from '../../providers/dnspod/auth';
import { ApiError } from '../errors';
import { describeZones, normalizeDnsName, TeoZone } from '../../services/tencentEdgeOne';

const prisma = new PrismaClient();

export interface EdgeOneCredential {
  id: number;
  name: string;
  creds: Tc3Credentials;
}

function asString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

export async function resolveEdgeOneCredential(
  userId: number,
  credentialId?: number | string | null
): Promise<EdgeOneCredential> {
  const id = credentialId === undefined || credentialId === null || credentialId === ''
    ? null
    : Number(credentialId);
  if (id !== null && !Number.isInteger(id)) {
    throw new ApiError('INVALID_ARGUMENT', 'credentialId 必须是整数', 400);
  }

  const credential = id !== null
    ? await prisma.dnsCredential.findFirst({ where: { id, userId } })
    : await prisma.dnsCredential.findFirst({ where: { userId, provider: 'edgeone', isDefault: true }, orderBy: { createdAt: 'asc' } })
      ?? await prisma.dnsCredential.findFirst({ where: { userId, provider: 'edgeone' }, orderBy: { createdAt: 'asc' } });

  if (!credential) {
    throw new ApiError('INVALID_ARGUMENT', '未找到 EdgeOne 凭证，请先在「设置 → DNS 账户管理」添加', 404);
  }
  if (String(credential.provider) !== 'edgeone') {
    throw new ApiError('INVALID_ARGUMENT', '该凭证不是 EdgeOne 凭证', 400, { provider: credential.provider });
  }

  let secrets: any;
  try {
    secrets = JSON.parse(decrypt(credential.secrets));
  } catch {
    throw new ApiError('INTERNAL_ERROR', 'EdgeOne 凭证密钥解析失败', 500);
  }

  const secretId = asString(secrets?.secretId);
  const secretKey = asString(secrets?.secretKey);
  const token = asString(secrets?.token || secrets?.sessionToken);
  if (!secretId || !secretKey) {
    throw new ApiError('INVALID_ARGUMENT', 'EdgeOne 凭证缺少 SecretId / SecretKey', 400);
  }

  return {
    id: credential.id,
    name: credential.name,
    creds: { secretId, secretKey, ...(token ? { token } : {}) } as Tc3Credentials,
  };
}

export interface ResolvedSite {
  zone: TeoZone;
  domain: string;
}

/** 站点可用域名或 zoneId 指定；只能精确命中，绝不等于子域名 */
export async function resolveSite(creds: Tc3Credentials, ref: string): Promise<ResolvedSite> {
  const raw = asString(ref);
  if (!raw) throw new ApiError('INVALID_ARGUMENT', '缺少站点标识（域名或 zoneId）', 400);

  const normalized = normalizeDnsName(raw);

  // 域名形状 → 关键词查询；否则先按 zoneId 精确查
  if (!normalized.includes('.')) {
    const byId = await describeZones(creds, { zoneId: raw });
    const hitById = byId.zones.find((zone) => zone.zoneId === raw);
    if (hitById) return { zone: hitById, domain: hitById.zoneName };
  }

  const { zones } = await describeZones(creds, { keyword: normalized });
  const hit = zones.find((zone) => normalizeDnsName(zone.zoneName) === normalized || zone.zoneId === raw);
  if (!hit) {
    throw new ApiError('SITE_NOT_FOUND', `EdgeOne 站点不存在: ${raw}`, 404, {
      hint: '站点只能按完整域名精确匹配，不接受子域名或模糊搜索',
    });
  }

  return { zone: hit, domain: hit.zoneName };
}
