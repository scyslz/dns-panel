/**
 * API Key 域名白名单候选
 *
 * 汇总该用户所有 DNS 凭证托管的域名 + EdgeOne 站点，供设置页多选，
 * 避免手动逐个输入。结果缓存 5 分钟（?refresh=1 可强制刷新）。
 */

import { PrismaClient } from '@prisma/client';
import { decrypt } from '../../utils/encryption';
import { dnsService } from '../../services/dns/DnsService';
import { describeZones } from '../../services/tencentEdgeOne';
import { isRecordCapable } from '../dns/context';
import { resolveEdgeOneCredential } from '../edgeone/credential';

const prisma = new PrismaClient();

export interface DomainOption {
  domain: string;
  provider: string;
  credentialId: number;
  credentialName: string;
}

interface CacheEntry {
  expiresAt: number;
  domains: DomainOption[];
  errors: Array<{ credentialId: number; credentialName: string; message: string }>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, CacheEntry>();

async function collect(userId: number): Promise<CacheEntry> {
  const credentials = await prisma.dnsCredential.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });

  const domains: DomainOption[] = [];
  const errors: CacheEntry['errors'] = [];

  for (const credential of credentials) {
    const provider = String(credential.provider);
    try {
      if (provider === 'edgeone') {
        const resolved = await resolveEdgeOneCredential(userId, credential.id);
        const { zones } = await describeZones(resolved.creds);
        for (const zone of zones) {
          // EdgeOne 的 pages 站点不是真实域名，不进入白名单候选
          if (zone.type === 'pages' || !String(zone.zoneName).includes('.')) continue;
          domains.push({
            domain: zone.zoneName,
            provider: 'edgeone',
            credentialId: credential.id,
            credentialName: credential.name,
          });
        }
        continue;
      }

      if (!isRecordCapable(provider)) continue;

      let secrets: Record<string, string>;
      try {
        secrets = JSON.parse(decrypt(credential.secrets));
      } catch {
        errors.push({ credentialId: credential.id, credentialName: credential.name, message: '凭证解密失败' });
        continue;
      }

      const ctx = {
        provider: provider as any,
        secrets,
        accountId: credential.accountId || undefined,
        credentialKey: `domain-options-${credential.id}`,
        encrypted: false,
      };

      for (let page = 1; page <= 5; page += 1) {
        const result = await dnsService.getZones(ctx, page, 100);
        for (const zone of result.zones) {
          domains.push({
            domain: zone.name,
            provider,
            credentialId: credential.id,
            credentialName: credential.name,
          });
        }
        if (result.zones.length < 100 || page * 100 >= result.total) break;
      }
    } catch (error: any) {
      errors.push({
        credentialId: credential.id,
        credentialName: credential.name,
        message: error?.message || '获取域名失败',
      });
    }
  }

  // 去重：同一域名以第一个（默认凭证优先）为准
  const seen = new Set<string>();
  const unique = domains
    .filter((item) => {
      const key = item.domain.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    expiresAt: Date.now() + CACHE_TTL_MS,
    domains: unique,
    errors,
  };
}

export async function listDomainOptions(userId: number, refresh = false) {
  const cached = cache.get(userId);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return { domains: cached.domains, errors: cached.errors, cached: true };
  }

  const entry = await collect(userId);
  cache.set(userId, entry);
  return { domains: entry.domains, errors: entry.errors, cached: false };
}

export function clearDomainOptionsCache(userId: number) {
  cache.delete(userId);
}
