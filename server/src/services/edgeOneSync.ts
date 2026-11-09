/**
 * EdgeOne 站点 → 腾讯云 DNSPod 自动同步（无状态）
 *
 * 同步目标由调用方（路由）从请求参数传入，不落库、不新增表。
 * 通过现有 DnsService 门面写入 DNSPod：同名同类型优先更新，值相同跳过，删除只删值匹配的记录。
 *
 * 注意：NS 接入后真正生效的是 EdgeOne 的权威 DNS；写入 DNSPod 用于保持旧解析商记录一致
 * （迁移期兜底 / 回退），不会影响 EdgeOne 侧记录。
 */

import { PrismaClient } from '@prisma/client';
import { decrypt } from '../utils/encryption';
import { ProviderType } from '../providers/base/types';
import { dnsService, type DnsServiceContext } from './dns/DnsService';
import type { TeoDnsRecord } from './tencentEdgeOne';

const prisma = new PrismaClient();

export interface SyncTargetInput {
  dnspodCredentialId: number;
  dnspodDomain: string;
}

export interface EdgeOneSyncResult {
  attempted: boolean;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
  target?: { credentialId: number; domain: string };
}

const EMPTY_RESULT: EdgeOneSyncResult = {
  attempted: false,
  created: 0,
  updated: 0,
  deleted: 0,
  skipped: 0,
  errors: [],
};

interface SyncParams {
  userId: number;
  siteDomain: string;
  target: SyncTargetInput | null;
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().replace(/\.+$/, '').toLowerCase();
}

function normalizeValue(value: unknown): string {
  return String(value ?? '').trim();
}

/** EdgeOne 的 FQDN 记录名 → DNSPod 相对主机记录 */
export function toDnspodSubDomain(fqdn: string, zoneName: string): string {
  const host = normalizeName(fqdn);
  const zone = normalizeName(zoneName);
  if (!host || host === '@' || host === zone) return '@';
  if (host.endsWith(`.${zone}`)) return host.slice(0, -(zone.length + 1)) || '@';
  return host;
}

/**
 * 把 EdgeOne 站点下的记录名映射到 DNSPod 目标域名下。
 * 例如站点 example.com 的 www.example.com → DNSPod example.net 的 www.example.net。
 */
function remapRecordName(fqdn: string, siteDomain: string, targetDomain: string): string {
  const host = normalizeName(fqdn);
  const site = normalizeName(siteDomain);
  if (!host || !site || site === normalizeName(targetDomain)) return host;
  if (host === site) return normalizeName(targetDomain);
  if (host.endsWith(`.${site}`)) {
    const prefix = host.slice(0, -(site.length + 1));
    return prefix ? `${prefix}.${normalizeName(targetDomain)}` : normalizeName(targetDomain);
  }
  return host;
}

/** DNSPod 返回的记录名可能是 FQDN 或相对名，统一成 FQDN 便于比较 */
function toFqdn(name: string, zoneName: string): string {
  const host = normalizeName(name);
  const zone = normalizeName(zoneName);
  if (!host || host === '@' || host === zone) return zone;
  if (host.endsWith(`.${zone}`)) return host;
  return `${host}.${zone}`;
}

function ttlOr600(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 1 ? n : 600;
}

/** 从 EdgeOne 记录生成 DNSPod 的写入参数 */
function buildRecordParams(record: TeoDnsRecord, siteDomain: string, targetDomain: string) {
  return {
    name: toDnspodSubDomain(remapRecordName(record.name, siteDomain, targetDomain), targetDomain),
    type: record.type.toUpperCase(),
    value: record.content,
    ttl: ttlOr600(record.ttl),
    ...(record.type.toUpperCase() === 'MX' && typeof record.priority === 'number'
      ? { priority: record.priority }
      : {}),
  };
}

/** 构造 DnsService 上下文（与 routes/dnsRecords.ts 保持一致） */
async function buildDnsContext(userId: number, credentialId: number): Promise<DnsServiceContext> {
  const credential = await prisma.dnsCredential.findFirst({ where: { id: credentialId, userId } });
  if (!credential) throw new Error('同步目标 DNSPod 凭证不存在或无权访问');

  const provider = String(credential.provider) as ProviderType;
  if (provider !== ProviderType.DNSPOD && provider !== ProviderType.DNSPOD_TOKEN) {
    throw new Error('同步目标凭证不是腾讯云 DNSPod 账户');
  }

  let secrets: Record<string, string>;
  try {
    secrets = JSON.parse(decrypt(credential.secrets));
  } catch {
    throw new Error('同步目标 DNSPod 凭证密钥解析失败');
  }

  return {
    provider,
    secrets,
    accountId: credential.accountId || undefined,
    credentialKey: `cred-${credential.id}`,
    encrypted: false,
  };
}

async function resolveTarget(userId: number, target: SyncTargetInput, siteDomain: string) {
  const ctx = await buildDnsContext(userId, target.dnspodCredentialId);
  const zoneName = normalizeName(target.dnspodDomain || siteDomain);
  if (!zoneName) throw new Error('同步目标域名为空');
  return { ctx, zoneName, credentialId: target.dnspodCredentialId };
}

async function listAllDnspodRecords(ctx: DnsServiceContext, zoneName: string) {
  const pageSize = 500;
  const all: any[] = [];
  for (let page = 1; page <= 200; page += 1) {
    const result = await dnsService.getRecords(ctx, zoneName, { page, pageSize });
    all.push(...(Array.isArray(result.records) ? result.records : []));
    if (!result.total || all.length >= result.total || (result.records?.length || 0) < pageSize) break;
  }
  return all;
}

/**
 * 解析同步目标。未配置目标时返回 null（调用方视为「未启用同步」，不是错误）。
 * 目标配置本身有误时会抛错，由调用方决定是否影响主流程。
 */
async function prepare(params: SyncParams): Promise<{
  ctx: DnsServiceContext;
  zoneName: string;
  credentialId: number;
  siteDomain: string;
} | null> {
  if (!params.target) return null;
  const resolved = await resolveTarget(params.userId, params.target, params.siteDomain);
  return { ...resolved, siteDomain: normalizeName(params.siteDomain) };
}

function withAttempt(result: EdgeOneSyncResult, credentialId: number, zoneName: string) {
  result.attempted = true;
  result.target = { credentialId, domain: zoneName };
}

/**
 * 把一条 EdgeOne 记录 upsert 到 DNSPod（用于记录创建 / 修改之后的即时同步）。
 */
export async function syncEdgeOneRecordToDnspod(params: SyncParams & { record: TeoDnsRecord }): Promise<EdgeOneSyncResult> {
  const result: EdgeOneSyncResult = { ...EMPTY_RESULT, errors: [] };
  let target: Awaited<ReturnType<typeof prepare>>;
  try {
    target = await prepare(params);
  } catch (error: any) {
    result.attempted = true;
    result.errors.push(error?.message || '解析同步目标失败');
    return result;
  }
  if (!target) return result;
  withAttempt(result, target.credentialId, target.zoneName);

  try {
    const existing = await listAllDnspodRecords(target.ctx, target.zoneName);
    const expectedFqdn = toFqdn(remapRecordName(params.record.name, target.siteDomain, target.zoneName), target.zoneName);
    const expectedType = params.record.type.toUpperCase();
    const expectedValue = normalizeValue(params.record.content);

    const sameNameType = existing.filter((item) =>
      toFqdn(item.name, target.zoneName) === expectedFqdn
      && String(item.type || '').toUpperCase() === expectedType,
    );
    const exact = sameNameType.find((item) => normalizeValue(item.value) === expectedValue);

    if (exact) {
      result.skipped += 1;
    } else {
      const payload = buildRecordParams(params.record, target.siteDomain, target.zoneName);
      if (sameNameType.length > 0) {
        await dnsService.updateRecord(target.ctx, target.zoneName, String(sameNameType[0].id), payload);
        result.updated += 1;
      } else {
        await dnsService.createRecord(target.ctx, target.zoneName, payload);
        result.created += 1;
      }
    }
  } catch (error: any) {
    result.errors.push(error?.message || '写入 DNSPod 失败');
  }
  return result;
}

/**
 * 删除 EdgeOne 记录时，同步删除 DNSPod 上同名同类型且值相同的记录。
 * 找不到匹配则跳过，不误删其他记录。
 */
export async function syncEdgeOneRecordDeleteToDnspod(params: SyncParams & { record: TeoDnsRecord }): Promise<EdgeOneSyncResult> {
  const result: EdgeOneSyncResult = { ...EMPTY_RESULT, errors: [] };
  let target: Awaited<ReturnType<typeof prepare>>;
  try {
    target = await prepare(params);
  } catch (error: any) {
    result.attempted = true;
    result.errors.push(error?.message || '解析同步目标失败');
    return result;
  }
  if (!target) return result;
  withAttempt(result, target.credentialId, target.zoneName);

  try {
    const existing = await listAllDnspodRecords(target.ctx, target.zoneName);
    const expectedFqdn = toFqdn(remapRecordName(params.record.name, target.siteDomain, target.zoneName), target.zoneName);
    const expectedType = params.record.type.toUpperCase();
    const expectedValue = normalizeValue(params.record.content);
    const matches = existing.filter((item) =>
      toFqdn(item.name, target.zoneName) === expectedFqdn
      && String(item.type || '').toUpperCase() === expectedType
      && normalizeValue(item.value) === expectedValue,
    );

    for (const item of matches) {
      await dnsService.deleteRecord(target.ctx, target.zoneName, String(item.id));
      result.deleted += 1;
    }
    if (matches.length === 0) result.skipped += 1;
  } catch (error: any) {
    result.errors.push(error?.message || '删除 DNSPod 记录失败');
  }
  return result;
}

/**
 * 全量同步：把 EdgeOne 站点的所有 DNS 记录对齐到 DNSPod。
 * 只补齐 / 更新 EdgeOne 侧存在的记录，不删除 DNSPod 上的多余记录（避免误删）。
 */
export async function syncAllEdgeOneRecordsToDnspod(params: SyncParams & { records: TeoDnsRecord[] }): Promise<EdgeOneSyncResult> {
  const result: EdgeOneSyncResult = { ...EMPTY_RESULT, errors: [] };
  if (!params.target) {
    result.errors.push('站点未启用 DNSPod 自动同步');
    return result;
  }

  let target: Awaited<ReturnType<typeof prepare>>;
  try {
    target = await prepare(params);
  } catch (error: any) {
    result.attempted = true;
    result.errors.push(error?.message || '解析同步目标失败');
    return result;
  }
  if (!target) {
    result.errors.push('站点未绑定同步目标 DNSPod 域名');
    return result;
  }
  withAttempt(result, target.credentialId, target.zoneName);

  let existing: any[] = [];
  try {
    existing = await listAllDnspodRecords(target.ctx, target.zoneName);
  } catch (error: any) {
    result.errors.push(error?.message || '读取 DNSPod 记录失败');
    return result;
  }

  for (const record of params.records) {
    try {
      const expectedFqdn = toFqdn(remapRecordName(record.name, target.siteDomain, target.zoneName), target.zoneName);
      const expectedType = record.type.toUpperCase();
      const expectedValue = normalizeValue(record.content);
      const sameNameType = existing.filter((item) =>
        toFqdn(item.name, target.zoneName) === expectedFqdn
        && String(item.type || '').toUpperCase() === expectedType,
      );
      const exact = sameNameType.find((item) => normalizeValue(item.value) === expectedValue);

      if (exact) {
        result.skipped += 1;
        continue;
      }

      const payload = buildRecordParams(record, target.siteDomain, target.zoneName);
      if (sameNameType.length > 0) {
        await dnsService.updateRecord(target.ctx, target.zoneName, String(sameNameType[0].id), payload);
        result.updated += 1;
        const idx = existing.findIndex((item) => String(item.id) === String(sameNameType[0].id));
        if (idx >= 0) existing[idx] = { ...existing[idx], value: expectedValue };
      } else {
        await dnsService.createRecord(target.ctx, target.zoneName, payload);
        result.created += 1;
        existing.push({ id: `new-${result.created}`, name: expectedFqdn, type: expectedType, value: expectedValue });
      }
    } catch (error: any) {
      result.errors.push(`${record.name || '(空)'} ${record.type}: ${error?.message || '同步失败'}`);
    }
  }
  return result;
}
