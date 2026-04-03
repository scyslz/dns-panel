import { resolveTxt } from 'node:dns/promises';
import { PrismaClient } from '@prisma/client';
import { decrypt } from '../../utils/encryption';
import { dnsService, DnsServiceContext } from '../dns/DnsService';
import { ProviderType, Zone } from '../../providers/base/types';
import { CertificateChallengeState, AcmeService } from './AcmeService';
import { CertificateCnameAliasService } from './CertificateCnameAliasService';

const prisma = new PrismaClient();

function normalizeDomain(domain: string): string {
  return String(domain || '').trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
}

function normalizeTxt(value: string): string {
  return String(value || '').trim().replace(/^"|"$/g, '');
}


function buildRelativeRecordHost(fqdn: string, zoneName: string): string {
  const normalizedFqdn = String(fqdn || '').trim().toLowerCase().replace(/\.$/, '');
  const normalizedZone = String(zoneName || '').trim().toLowerCase().replace(/\.$/, '');
  if (!normalizedFqdn || !normalizedZone) return normalizedFqdn;
  if (normalizedFqdn === normalizedZone) return '@';
  if (normalizedFqdn.endsWith(`.${normalizedZone}`)) {
    return normalizedFqdn.slice(0, -(normalizedZone.length + 1)) || '@';
  }
  return normalizedFqdn;
}

function isSameRecordName(name: string, host: string, fqdn: string, zoneName: string): boolean {
  const normalized = String(name || '').trim().toLowerCase().replace(/\.$/, '');
  const normalizedHost = String(host || '').trim().toLowerCase();
  const normalizedFqdn = String(fqdn || '').trim().toLowerCase().replace(/\.$/, '');
  const normalizedZone = String(zoneName || '').trim().toLowerCase().replace(/\.$/, '');
  return normalized === normalizedHost
    || normalized === normalizedFqdn
    || normalized === `${normalizedHost}.${normalizedZone}`
    || (normalizedHost === '@' && normalized === normalizedZone);
}

export class CertificateDnsService {
  static async getDnsContext(userId: number, dnsCredentialId: number): Promise<DnsServiceContext> {
    const credential = await prisma.dnsCredential.findFirst({
      where: { id: dnsCredentialId, userId },
    });
    if (!credential) throw new Error('DNS 凭证不存在或无权访问');

    return {
      provider: credential.provider as ProviderType,
      secrets: JSON.parse(decrypt(credential.secrets)),
      accountId: credential.accountId || undefined,
      credentialKey: `cred-${credential.id}`,
      encrypted: false,
    };
  }

  static async listZones(ctx: DnsServiceContext): Promise<Zone[]> {
    const zones: Zone[] = [];
    for (let page = 1; page <= 100; page++) {
      const result = await dnsService.getZones(ctx, page, 100);
      zones.push(...(result.zones || []));
      if (!result.zones?.length) break;
      if (typeof result.total === 'number' && zones.length >= result.total) break;
    }
    return zones;
  }

  static async findBestZone(ctx: DnsServiceContext, domain: string): Promise<Zone | null> {
    const normalized = normalizeDomain(domain);
    const zones = await this.listZones(ctx);
    let matched: Zone | null = null;

    for (const zone of zones) {
      const zoneName = normalizeDomain(zone.name);
      if (!zoneName) continue;
      if (normalized !== zoneName && !normalized.endsWith(`.${zoneName}`)) continue;
      if (zone.authorityStatus === 'non_authoritative') continue;
      if (!matched || zoneName.length > normalizeDomain(matched.name).length) {
        matched = zone;
      }
    }

    return matched;
  }

  static async ensureChallengeRecords(userId: number, dnsCredentialId: number, challenges: CertificateChallengeState[]): Promise<CertificateChallengeState[]> {
    const primaryCtx = await this.getDnsContext(userId, dnsCredentialId);
    const next = challenges.map((item) => ({ ...item }));

    for (const item of next) {
      let effectiveCtx = primaryCtx;
      let effectiveDnsCredentialId = dnsCredentialId;
      let zone = await this.findBestZone(primaryCtx, item.identifier);
      let recordHost = '';
      let recordName = '';
      let zoneName = '';

      if (!zone) {
        const alias = await CertificateCnameAliasService.findAliasForDomain(userId, item.identifier);
        if (!alias) {
          throw new Error(`未找到域名 ${item.identifier} 的可写权威 DNS 区域`);
        }
        if (alias.status !== 'ready') {
          throw new Error(`域名 ${item.identifier} 已配置 CNAME Alias，但当前未就绪，请先完成 Alias 校验`);
        }

        effectiveCtx = await this.getDnsContext(userId, alias.dnsCredentialId);
        effectiveDnsCredentialId = alias.dnsCredentialId;
        zoneName = alias.zoneName;
        zone = await this.findBestZone(effectiveCtx, alias.targetFqdn);
        if (!zone) {
          throw new Error(`Alias 目标 ${alias.targetFqdn} 所在 DNS 区域不可写`);
        }
        recordHost = buildRelativeRecordHost(alias.targetFqdn, zone.name);
        recordName = alias.targetFqdn;
        item.aliasDomain = alias.domain;
        item.aliasStatus = alias.status;
        item.aliasTargetFqdn = alias.targetFqdn;
        item.aliasDnsCredentialId = alias.dnsCredentialId;
      } else {
        zoneName = zone.name;
        recordHost = AcmeService.getChallengeRecordHost(item.identifier, zone.name);
        recordName = `${recordHost}.${zone.name}`;
      }

      const existing = await dnsService.getRecords(effectiveCtx, zone.id, { page: 1, pageSize: 200, keyword: recordHost });
      const matched = (existing.records || []).find((record) =>
        record.type === 'TXT'
        && normalizeTxt(record.value) === normalizeTxt(item.recordValue)
        && isSameRecordName(record.name, recordHost, recordName, zone.name)
      );

      item.zoneId = zone.id;
      item.zoneName = zoneName;
      item.recordHost = recordHost;
      item.recordName = recordName;
      item.mode = 'auto';
      item.effectiveDnsCredentialId = effectiveDnsCredentialId;

      if (matched) {
        item.recordId = matched.id;
        continue;
      }

      const created = await dnsService.createRecord(effectiveCtx, zone.id, {
        name: recordHost,
        type: 'TXT',
        value: item.recordValue,
      });
      item.recordId = created.id;
    }

    return next;
  }

  static async cleanupChallengeRecords(userId: number, dnsCredentialId: number, challenges: CertificateChallengeState[]): Promise<void> {
    const autoChallenges = challenges.filter((item) => item.mode === 'auto' && item.zoneId && item.recordId);
    if (autoChallenges.length === 0) return;
    const ctxCache = new Map<number, DnsServiceContext>();

    for (const item of autoChallenges) {
      const effectiveId = Number(item.effectiveDnsCredentialId || dnsCredentialId);
      try {
        if (!ctxCache.has(effectiveId)) {
          ctxCache.set(effectiveId, await this.getDnsContext(userId, effectiveId));
        }
        await dnsService.deleteRecord(ctxCache.get(effectiveId)!, item.zoneId!, item.recordId!);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  static async areChallengesPropagated(challenges: CertificateChallengeState[]): Promise<boolean> {
    for (const item of challenges) {
      const answers = await resolveTxt(item.recordName);
      const flattened = answers.map((parts) => normalizeTxt(parts.join('')));
      if (!flattened.includes(normalizeTxt(item.recordValue))) {
        return false;
      }
    }
    return true;
  }
}
