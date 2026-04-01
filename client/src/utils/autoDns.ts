import { Domain, DNSRecord } from '@/types';
import { DnsCredential } from '@/types/dns';
import { createDNSRecord, getDNSRecords, updateDNSRecord } from '@/services/dns';
import { getDomainById, getDomains } from '@/services/domains';

export const normalizeHostname = (input: unknown): string =>
  String(input ?? '').trim().replace(/\.+$/, '').toLowerCase();

export const stripWildcardPrefix = (hostname: string): string =>
  normalizeHostname(hostname).replace(/^\*\./, '');

export const findBestZone = (hostname: string, domains: Domain[]): Domain | undefined => {
  const host = stripWildcardPrefix(hostname);
  let best: Domain | undefined;

  for (const domain of domains) {
    const zone = normalizeHostname(domain?.name);
    if (!zone) continue;
    if (host === zone || host.endsWith(`.${zone}`)) {
      if (!best || zone.length > normalizeHostname(best.name).length) best = domain;
    }
  }

  return best;
};

export const listMatchingZones = (hostname: string, domains: Domain[]): Domain[] => {
  const host = stripWildcardPrefix(hostname);

  return domains
    .filter((domain) => {
      const zone = normalizeHostname(domain?.name);
      return !!zone && (host === zone || host.endsWith(`.${zone}`));
    })
    .sort((a, b) => normalizeHostname(b.name).length - normalizeHostname(a.name).length);
};

export const toRelativeRecordName = (fqdn: string, zoneName: string): string => {
  const host = String(fqdn || '').trim().replace(/\.+$/, '');
  const zone = String(zoneName || '').trim().replace(/\.+$/, '');

  if (!host || !zone) return host;
  if (normalizeHostname(host) === normalizeHostname(zone)) return '@';

  const hostParts = host.split('.');
  const zoneParts = zone.split('.');
  if (hostParts.length <= zoneParts.length) return host;

  return hostParts.slice(0, hostParts.length - zoneParts.length).join('.') || '@';
};

export type AutoDnsRecordType = 'TXT' | 'CNAME';

export const toRecordFqdn = (record: DNSRecord, fallbackZoneName?: string): string => {
  const recordName = String(record.name || '').trim().replace(/\.+$/, '');
  const zoneName = String(record.zoneName || fallbackZoneName || '').trim().replace(/\.+$/, '');

  if (!recordName) return normalizeHostname(zoneName);
  if (recordName === '@') return normalizeHostname(zoneName);

  const normalizedRecordName = normalizeHostname(recordName);
  const normalizedZoneName = normalizeHostname(zoneName);

  if (!normalizedZoneName) return normalizedRecordName;
  if (normalizedRecordName === normalizedZoneName || normalizedRecordName.endsWith(`.${normalizedZoneName}`)) {
    return normalizedRecordName;
  }

  return normalizeHostname(`${recordName}.${zoneName}`);
};

export const pickSilentAutoDnsCandidate = (hostname: string, candidates: Domain[]): Domain | null => {
  const best = findBestZone(hostname, candidates);
  if (!best) return null;

  const normalizedBestZone = normalizeHostname(best.name);
  const bestZoneTargets = candidates.filter((candidate) => normalizeHostname(candidate.name) === normalizedBestZone);
  const uniqueTargets = new Set(bestZoneTargets.map((candidate) => `${candidate.credentialId ?? 'na'}:${candidate.id}`));

  if (uniqueTargets.size > 1) return null;
  return best;
};

export async function upsertDnsRecordForZone(
  zone: Domain,
  params: { recordType: AutoDnsRecordType; fqdn: string; value: string }
): Promise<{ action: 'create' | 'update'; record: DNSRecord | null }> {
  if (typeof zone.credentialId !== 'number') {
    throw new Error('目标域名缺少账户信息');
  }

  const existingResp = await getDNSRecords(zone.id, zone.credentialId);
  const existingRecords = existingResp.data?.records || [];
  const expectedFqdn = normalizeHostname(params.fqdn);
  const expectedValue = String(params.value || '').trim();
  const existingRecord = existingRecords.find((record) => {
    const sameName = toRecordFqdn(record, zone.name) === expectedFqdn;
    const sameType = String(record.type || '').trim().toUpperCase() === params.recordType;
    if (!sameName || !sameType) return false;
    if (params.recordType !== 'TXT') return true;
    return String(record.content || '').trim() === expectedValue;
  });

  const payload = {
    type: params.recordType,
    name: toRelativeRecordName(params.fqdn, zone.name) || '@',
    content: params.value,
  };

  if (existingRecord?.id) {
    if (String(existingRecord.content || '').trim() === expectedValue) {
      return { action: 'update', record: existingRecord };
    }
    const resp = await updateDNSRecord(zone.id, existingRecord.id, payload, zone.credentialId);
    return { action: 'update', record: resp.data?.record || null };
  }

  const resp = await createDNSRecord(zone.id, payload, zone.credentialId);
  return { action: 'create', record: resp.data?.record || null };
}

export const isAuthoritativeZone = (domain: Domain | null | undefined): boolean =>
  domain?.authorityStatus === 'authoritative';

const shouldRetryWithDetail = (domain: Domain): boolean =>
  (!domain.authorityStatus || domain.authorityStatus === 'unknown') && typeof domain.credentialId === 'number';

const refreshZoneAuthority = async (domain: Domain): Promise<Domain> => {
  if (typeof domain.credentialId !== 'number') return domain;

  try {
    const resp = await getDomainById(domain.id, domain.credentialId);
    const detail = resp.data?.domain;
    if (!detail) return domain;

    return {
      ...domain,
      authorityStatus: detail.authorityStatus,
      authorityReason: detail.authorityReason,
      authorityMeta: detail.authorityMeta,
    };
  } catch {
    return domain;
  }
};

export async function loadCandidateZones(credentials: DnsCredential[]): Promise<Domain[]> {
  if (!Array.isArray(credentials) || credentials.length === 0) return [];

  const settled = await Promise.allSettled(
    credentials.map(async (credential) => {
      const resp = await getDomains(credential.id);
      const domains = resp.data?.domains || [];
      return domains.map((domain) => ({
        ...domain,
        credentialId: credential.id,
        credentialName: credential.name,
        provider: credential.provider,
      }));
    })
  );

  return settled.flatMap((item) => (item.status === 'fulfilled' ? item.value : []));
}

export async function findMatchingCandidateZones(
  credentials: DnsCredential[],
  hostname: string
): Promise<Domain[]> {
  const domains = await loadCandidateZones(credentials);
  const matches = listMatchingZones(hostname, domains);
  const authoritative = matches.filter(isAuthoritativeZone);
  if (authoritative.length > 0) return authoritative;

  const uncertain = matches.filter(shouldRetryWithDetail);
  if (uncertain.length === 0) return [];

  const settled = await Promise.allSettled(uncertain.map((domain) => refreshZoneAuthority(domain)));
  const refreshed = settled
    .map((item) => (item.status === 'fulfilled' ? item.value : null))
    .filter((item): item is Domain => !!item);

  return refreshed.filter(isAuthoritativeZone);
}
