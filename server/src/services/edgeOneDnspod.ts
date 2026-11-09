/**
 * EdgeOne 加速域名 ↔ 腾讯云 DNSPod 关联检查与 CNAME 同步
 *
 * 设计：EdgeOne 凭证和 DNSPod 通常是同一把腾讯云 SecretId/SecretKey。
 * 因此不需要用户「指定 DNSPod 凭证」：直接用 EdgeOne 这把密钥，
 * 在当前用户的 dns_credentials 里找到 secretId 相同的 DNSPod 凭证即可操作。
 *
 * EdgeOne 页只展示 EdgeOne 自己管理的「加速域名」；真实 DNS 记录在 DNSPod，
 * 这里只给每个加速域名打一个「DNSPod 已关联」标记（对应 CNAME 是否存在/匹配），
 * 并在新增/删除加速域名时自动把 CNAME 写入/移除 DNSPod。
 */

import { PrismaClient } from '@prisma/client';
import { decrypt } from '../utils/encryption';
import { ProviderType } from '../providers/base/types';
import { dnsService, type DnsServiceContext } from './dns/DnsService';
import type { Tc3Credentials } from '../providers/dnspod/auth';
import type { TeoAccelerationDomain } from './tencentEdgeOne';

const prisma = new PrismaClient();

export interface DnspodLink {
  available: boolean;                 // 是否找到可用的 DNSPod 凭证（同一把密钥）
  credentialId: number | null;
  credentialName: string | null;
  domain: string | null;              // 命中的 DNSPod 域名
  reason?: string;                    // 不可用时的说明
}

export interface DomainLinkStatus {
  linked: boolean;                    // DNSPod 里是否已存在指向该 CNAME 的记录
  recordId?: string;
  currentValue?: string;
  status: 'matched' | 'different' | 'missing' | 'unknown';
}

export interface DomainWithLink extends TeoAccelerationDomain {
  dnspod: DomainLinkStatus;
}

export interface CnameSyncResult {
  attempted: boolean;
  action: 'create' | 'update' | 'skip' | 'delete' | 'none';
  recordId?: string;
  error?: string;
  link: DnspodLink;
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().replace(/\.+$/, '').toLowerCase();
}

function normalizeValue(value: unknown): string {
  return String(value ?? '').trim().replace(/\.+$/, '').toLowerCase();
}

function toFqdn(name: string, zone: string): string {
  const host = normalizeName(name);
  const z = normalizeName(zone);
  if (!host || host === '@' || host === z) return z;
  if (host.endsWith(`.${z}`)) return host;
  return `${host}.${z}`;
}

/** EdgeOne FQDN → DNSPod 相对主机记录（通配符保持 `*.xxx` 形式） */
function toSubDomain(fqdn: string, zone: string): string {
  const host = normalizeName(fqdn);
  const z = normalizeName(zone);
  if (!host || host === '@' || host === z) return '@';
  if (host.endsWith(`.${z}`)) return host.slice(0, -(z.length + 1)) || '@';
  return host;
}

/**
 * 自动发现可用的 DNSPod 凭证：与 EdgeOne 凭证 secretId 相同、且托管了该域名的那条。
 * 找不到时返回 available=false，但不报错（页面只打标，不影响 EdgeOne 功能）。
 */
export async function resolveDnspodLink(userId: number, edgeOneCreds: Tc3Credentials, domain: string): Promise<DnspodLink> {
  const candidates = await prisma.dnsCredential.findMany({
    where: { userId, provider: { in: ['dnspod', 'dnspod_token'] } },
    select: { id: true, name: true, provider: true, secrets: true, accountId: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });

  const matched: Array<{ id: number; name: string; provider: string; secrets: any; accountId: string | null }> = [];
  for (const c of candidates) {
    try {
      const s = JSON.parse(decrypt(c.secrets));
      // 同一把腾讯云密钥：SecretId 相同即可操作 DNSPod；token 凭证沿用自身 token
      if (String(s?.secretId || '').trim() === edgeOneCreds.secretId) {
        matched.push({ ...c, secrets: s });
      }
    } catch {
      // 忽略解析失败的凭证
    }
  }

  if (matched.length === 0) {
    return {
      available: false, credentialId: null, credentialName: null, domain: null,
      reason: '未找到与 EdgeOne 使用相同 SecretId 的 DNSPod 凭证',
    };
  }

  const target = normalizeName(domain);
  for (const c of matched) {
    const ctx: DnsServiceContext = {
      provider: c.provider as ProviderType,
      secrets: c.secrets,
      accountId: c.accountId || undefined,
      credentialKey: `cred-${c.id}`,
      encrypted: false,
    };
    try {
      const zones = await dnsService.getZones(ctx, 1, 100);
      const zone = zones.zones.find((z) => normalizeName(z.name) === target)
        || zones.zones.find((z) => target.endsWith(`.${normalizeName(z.name)}`));
      if (zone) {
        return { available: true, credentialId: c.id, credentialName: c.name, domain: normalizeName(zone.name) };
      }
    } catch {
      // 换下一个候选凭证
    }
  }

  return {
    available: false, credentialId: matched[0].id, credentialName: matched[0].name, domain: null,
    reason: `同一把密钥下未找到域名 ${target} 的托管记录`,
  };
}

async function buildContext(userId: number, link: DnspodLink): Promise<DnsServiceContext | null> {
  if (!link.available || !link.credentialId) return null;
  const c = await prisma.dnsCredential.findFirst({ where: { id: link.credentialId, userId } });
  if (!c) return null;
  try {
    return {
      provider: c.provider as ProviderType,
      secrets: JSON.parse(decrypt(c.secrets)),
      accountId: c.accountId || undefined,
      credentialKey: `cred-${c.id}`,
      encrypted: false,
    };
  } catch {
    return null;
  }
}

/**
 * 记录名归一化比较：兼容 DNSPod 历史错误写法 `*npm.example.com`（缺 `.`）。
 * 统一成 `*.npm.example.com` 形式。
 */
function canonicalRecordFqdn(name: string, zone: string): string {
  const fqdn = toFqdn(name, zone);
  return fqdn.replace(/^\*([^.])/, '*.$1');
}

function sameRecordName(name: string, expectedFqdn: string, zone: string): boolean {
  return canonicalRecordFqdn(name, zone) === canonicalRecordFqdn(expectedFqdn, zone);
}

async function listRecords(ctx: DnsServiceContext, zone: string) {
  const pageSize = 500;
  const all: any[] = [];
  for (let page = 1; page <= 200; page += 1) {
    const r = await dnsService.getRecords(ctx, zone, { page, pageSize });
    all.push(...(Array.isArray(r.records) ? r.records : []));
    if (!r.total || all.length >= r.total || (r.records?.length || 0) < pageSize) break;
  }
  return all;
}

/** 检查某个加速域名在 DNSPod 里的 CNAME 关联状态 */
export async function checkDomainLink(userId: number, link: DnspodLink, domain: TeoAccelerationDomain): Promise<DomainLinkStatus> {
  if (!link.available || !link.domain || !domain.cname) {
    return { linked: false, status: 'unknown' };
  }
  try {
    const ctx = await buildContext(userId, link);
    if (!ctx) return { linked: false, status: 'unknown' };
    const records = await listRecords(ctx, link.domain);
    const expectedFqdn = toFqdn(domain.domainName, link.domain);
    const sameName = records.filter((r) =>
      sameRecordName(r.name, expectedFqdn, link.domain)
      && String(r.type || '').toUpperCase() === 'CNAME',
    );
    if (sameName.length === 0) return { linked: false, status: 'missing' };
    const matched = sameName.find((r) => normalizeValue(r.value) === normalizeValue(domain.cname));
    if (matched) {
      return { linked: true, recordId: String(matched.id), currentValue: String(matched.value), status: 'matched' };
    }
    return { linked: false, recordId: String(sameName[0].id), currentValue: String(sameName[0].value), status: 'different' };
  } catch {
    return { linked: false, status: 'unknown' };
  }
}

/** 给一批加速域名打上 DNSPod 关联标记 */
export async function withDnspodLinks(
  userId: number,
  edgeOneCreds: Tc3Credentials,
  siteDomain: string,
  domains: TeoAccelerationDomain[],
): Promise<{ link: DnspodLink; domains: DomainWithLink[] }> {
  const link = await resolveDnspodLink(userId, edgeOneCreds, siteDomain);
  if (!link.available || !link.domain) {
    return { link, domains: domains.map((d) => ({ ...d, dnspod: { linked: false, status: 'unknown' as const } })) };
  }
  const ctx = await buildContext(userId, link);
  if (!ctx) {
    return { link, domains: domains.map((d) => ({ ...d, dnspod: { linked: false, status: 'unknown' as const } })) };
  }

  let records: any[] = [];
  try {
    records = await listRecords(ctx, link.domain);
  } catch {
    return { link, domains: domains.map((d) => ({ ...d, dnspod: { linked: false, status: 'unknown' as const } })) };
  }

  const withLinks = domains.map((d): DomainWithLink => {
    if (!d.cname) return { ...d, dnspod: { linked: false, status: 'unknown' } };
    const expectedFqdn = toFqdn(d.domainName, link.domain!);
    const sameName = records.filter((r) =>
      sameRecordName(r.name, expectedFqdn, link.domain!)
      && String(r.type || '').toUpperCase() === 'CNAME',
    );
    if (sameName.length === 0) return { ...d, dnspod: { linked: false, status: 'missing' } };
    const matched = sameName.find((r) => normalizeValue(r.value) === normalizeValue(d.cname));
    if (matched) {
      return { ...d, dnspod: { linked: true, recordId: String(matched.id), currentValue: String(matched.value), status: 'matched' } };
    }
    return { ...d, dnspod: { linked: false, recordId: String(sameName[0].id), currentValue: String(sameName[0].value), status: 'different' } };
  });

  return { link, domains: withLinks };
}

/** 把加速域名的 CNAME 写入 DNSPod（自动 upsert，同名同类型优先更新） */
export async function syncCnameToDnspod(params: {
  userId: number;
  edgeOneCreds: Tc3Credentials;
  siteDomain: string;
  domain: TeoAccelerationDomain;
}): Promise<CnameSyncResult> {
  return await upsertDnspodRecord({
    userId: params.userId,
    edgeOneCreds: params.edgeOneCreds,
    siteDomain: params.siteDomain,
    name: params.domain.domainName,
    type: 'CNAME',
    value: params.domain.cname || '',
  });
}

/**
 * 通用 upsert：把一条 DNS 记录写入自动发现的 DNSPod 域名。
 * 供加速域名 CNAME 与免费证书 dns_challenge 的验证 TXT 复用。
 */
export async function upsertDnspodRecord(params: {
  userId: number;
  edgeOneCreds: Tc3Credentials;
  siteDomain: string;
  name: string;      // FQDN 或相对主机记录
  type: string;
  value: string;
  ttl?: number;
}): Promise<CnameSyncResult> {
  const link = await resolveDnspodLink(params.userId, params.edgeOneCreds, params.siteDomain);
  const result: CnameSyncResult = { attempted: false, action: 'none', link };
  if (!link.available || !link.domain || !params.value) {
    result.error = link.reason || '记录值为空';
    return result;
  }
  const ctx = await buildContext(params.userId, link);
  if (!ctx) {
    result.error = '无法构建 DNSPod 上下文';
    return result;
  }

  result.attempted = true;
  try {
    const records = await listRecords(ctx, link.domain);
    const expectedFqdn = toFqdn(params.name, link.domain);
    const expectedType = params.type.toUpperCase();
    const sameName = records.filter((r) =>
      sameRecordName(r.name, expectedFqdn, link.domain!)
      && String(r.type || '').toUpperCase() === expectedType,
    );
    const payload = {
      name: toSubDomain(params.name, link.domain),
      type: expectedType,
      value: params.value,
      ttl: params.ttl || 600,
    };
    if (sameName.some((r) => normalizeValue(r.value) === normalizeValue(params.value))) {
      const matched = sameName.find((r) => normalizeValue(r.value) === normalizeValue(params.value))!;
      // 历史错误写法（如 `*npm.example.com`）在值已正确时也要把记录名纠正为 `*.npm.example.com`
      const rawName = normalizeName(matched.name);
      const expectedRaw = normalizeName(params.name);
      if (rawName !== expectedRaw && rawName !== toSubDomain(expectedRaw, link.domain!)) {
        await dnsService.updateRecord(ctx, link.domain, String(matched.id), payload);
        result.action = 'update';
      } else {
        result.action = 'skip';
      }
      result.recordId = String(matched.id);
    } else if (sameName.length > 0) {
      await dnsService.updateRecord(ctx, link.domain, String(sameName[0].id), payload);
      result.action = 'update';
      result.recordId = String(sameName[0].id);
    } else {
      const created = await dnsService.createRecord(ctx, link.domain, payload);
      result.action = 'create';
      result.recordId = String(created.id);
    }
  } catch (error: any) {
    result.error = error?.message || '写入 DNSPod 失败';
  }
  return result;
}

/** 删除加速域名时，移除 DNSPod 里指向该 CNAME 的记录 */
export async function removeCnameFromDnspod(params: {
  userId: number;
  edgeOneCreds: Tc3Credentials;
  siteDomain: string;
  domain: TeoAccelerationDomain;
}): Promise<CnameSyncResult> {
  const link = await resolveDnspodLink(params.userId, params.edgeOneCreds, params.siteDomain);
  const result: CnameSyncResult = { attempted: false, action: 'none', link };
  if (!link.available || !link.domain || !params.domain.cname) {
    result.error = link.reason || 'EdgeOne 未返回 CNAME';
    return result;
  }
  const ctx = await buildContext(params.userId, link);
  if (!ctx) {
    result.error = '无法构建 DNSPod 上下文';
    return result;
  }

  result.attempted = true;
  try {
    const records = await listRecords(ctx, link.domain);
    const expectedFqdn = toFqdn(params.domain.domainName, link.domain);
    const matches = records.filter((r) =>
      sameRecordName(r.name, expectedFqdn, link.domain!)
      && String(r.type || '').toUpperCase() === 'CNAME'
      && normalizeValue(r.value) === normalizeValue(params.domain.cname),
    );
    for (const r of matches) {
      await dnsService.deleteRecord(ctx, link.domain, String(r.id));
      result.action = 'delete';
      result.recordId = String(r.id);
    }
  } catch (error: any) {
    result.error = error?.message || '删除 DNSPod 记录失败';
  }
  return result;
}
