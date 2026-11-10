/**
 * EdgeOne 开放 API 业务层
 *
 * 直接复用现有 services/tencentEdgeOne、edgeOneDnspod、edgeOneSync、edgeOneCertificates，
 * 不修改页面路由；只补充「API 语义」：精确寻址、查重、force 删除、结果回显。
 */

import {
  createAccelerationDomain,
  createDnsRecord,
  createNsZone,
  deleteAccelerationDomains,
  deleteDnsRecords,
  deleteZone,
  describeAccelerationDomains,
  describeDnsRecords,
  describeZones,
  getDnsRecord,
  modifyAccelerationDomain,
  modifyAccelerationDomainStatuses,
  modifyDnsRecords,
  normalizeDnsName,
  TeoAccelerationDomain,
  TeoDnsRecord,
  TeoZone,
  toRelativeRecordName,
  toTeoRecordFqdn,
  verifyOwnership,
} from '../../services/tencentEdgeOne';
import {
  resolveDnspodLink,
  syncCnameToDnspod,
  removeCnameFromDnspod,
  withDnspodLinks,
  CnameSyncResult,
  DnspodLink,
} from '../../services/edgeOneDnspod';
import {
  syncEdgeOneRecordDeleteToDnspod,
  syncEdgeOneRecordToDnspod,
  SyncTargetInput,
} from '../../services/edgeOneSync';
import {
  decorateCertificateStatuses,
  enableFreeCertificate,
  getCertificateState,
} from '../../services/edgeOneCertificates';
import { LoggerService } from '../../services/logger';
import { Tc3Credentials } from '../../providers/dnspod/auth';
import { ApiError } from '../errors';
import { ApiActor } from '../dns/service';
import { resolveEdgeOneCredential, resolveSite } from './credential';

const RECORD_TYPES = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'CAA', 'SRV']);
const AREAS = new Set(['mainland', 'overseas', 'global']);
const ORIGIN_PROTOCOLS = new Set(['FOLLOW', 'HTTP', 'HTTPS']);
const HOST_HEADER_MODES = new Set(['default', 'request', 'origin', 'custom']);

function asString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function isAllowed(actor: ApiActor, domain: string): boolean {
  const allowed = actor.allowedDomains || [];
  if (allowed.length === 0) return true;
  const target = String(domain).toLowerCase().replace(/\.$/, '');
  return allowed.some((rule) => {
    const pattern = String(rule).toLowerCase().replace(/\.$/, '');
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return target.endsWith(suffix) && target.length > suffix.length;
    }
    return target === pattern;
  });
}

function assertAllowed(actor: ApiActor, domain: string) {
  if (!isAllowed(actor, domain)) {
    throw new ApiError('DOMAIN_NOT_ALLOWED', `域名 ${domain} 不在此 Key 的白名单内`, 403, {
      allowedDomains: actor.allowedDomains,
    });
  }
}

async function logEdgeOne(
  actor: ApiActor,
  action: 'CREATE' | 'UPDATE' | 'DELETE',
  data: { domain?: string; recordName?: string; recordType?: string; oldValue?: unknown; newValue?: unknown; error?: string }
) {
  await LoggerService.createLog({
    userId: actor.userId,
    action,
    resourceType: 'CERTIFICATE_DEPLOY',
    domain: data.domain,
    recordName: data.recordName,
    recordType: data.recordType,
    oldValue: data.oldValue === undefined ? undefined : JSON.stringify(data.oldValue),
    newValue:
      data.newValue === undefined
        ? undefined
        : JSON.stringify({
            source: 'api',
            apiKeyId: actor.apiKeyId,
            apiKeyName: actor.apiKeyName,
            requestId: actor.requestId,
            ...(typeof data.newValue === 'object' && data.newValue !== null ? data.newValue : { value: data.newValue }),
          }),
    status: data.error ? 'FAILED' : 'SUCCESS',
    errorMessage: data.error,
    ipAddress: actor.ip,
  });
}

async function openEdgeOne(
  actor: ApiActor,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const hasExplicit = credentialId !== undefined && credentialId !== null && credentialId !== '';
  if (boundCredentialId && hasExplicit && Number(credentialId) !== boundCredentialId) {
    throw new ApiError('SCOPE_DENIED', '该 API Key 仅允许访问绑定的凭证', 403, { boundCredentialId });
  }
  const effective = hasExplicit ? credentialId : boundCredentialId;
  const credential = await resolveEdgeOneCredential(actor.userId, effective);
  return credential;
}

function linkSummary(link: DnspodLink) {
  return {
    available: link.available,
    credentialId: link.credentialId,
    credentialName: link.credentialName,
    domain: link.domain,
    reason: link.reason,
  };
}

function mapSync(result: CnameSyncResult) {
  return {
    attempted: result.attempted,
    action: result.action,
    recordId: result.recordId,
    error: result.error || null,
    link: linkSummary(result.link),
  };
}

function mapSyncSummary(result: any) {
  if (!result?.attempted) return { attempted: false, error: (result?.errors || [])[0] || null };
  return {
    attempted: true,
    created: result.created,
    updated: result.updated,
    deleted: result.deleted,
    skipped: result.skipped,
    errors: result.errors || [],
    ok: (result.errors || []).length === 0,
  };
}

function mapSite(zone: TeoZone, link?: DnspodLink) {
  return {
    id: zone.zoneId,
    domain: zone.zoneName,
    type: zone.type,
    area: zone.area,
    status: zone.status,
    activeStatus: zone.activeStatus,
    cnameStatus: zone.cnameStatus,
    paused: zone.paused,
    planType: zone.planType,
    nameServers: zone.nameServers,
    originalNameServers: zone.originalNameServers,
    createdAt: zone.createdOn,
    ...(link ? { dnspodLink: linkSummary(link) } : {}),
  };
}

function mapDomain(domain: TeoAccelerationDomain, siteDomain: string, link?: any, certificateStatus?: string) {
  return {
    domain: domain.domainName,
    name: toRelativeRecordName(domain.domainName, siteDomain) || '@',
    status: domain.domainStatus,
    cname: domain.cname,
    origin: domain.origin,
    originType: domain.originType,
    originProtocol: domain.originProtocol,
    httpOriginPort: domain.httpOriginPort,
    httpsOriginPort: domain.httpsOriginPort,
    hostHeader: domain.hostHeader,
    certificateMode: domain.certificateMode,
    certificateStatus,
    dnspod: link,
    createdAt: domain.createdOn,
    updatedAt: domain.modifiedOn,
  };
}

/** 按加速域名精确查一条；EdgeOne 的 keyword 是模糊匹配，必须二次过滤 */
async function findDomain(
  creds: Tc3Credentials,
  zoneId: string,
  domainName: string
): Promise<TeoAccelerationDomain | null> {
  const target = normalizeDnsName(domainName);
  const { domains } = await describeAccelerationDomains(creds, zoneId, { keyword: target });
  return domains.find((item) => normalizeDnsName(item.domainName) === target) || null;
}

async function resolveSyncTarget(
  userId: number,
  creds: Tc3Credentials,
  siteDomain: string
): Promise<{ target: SyncTargetInput | null; link: DnspodLink }> {
  const link = await resolveDnspodLink(userId, creds, siteDomain);
  if (!link.available || !link.credentialId || !link.domain) return { target: null, link };
  return { target: { dnspodCredentialId: link.credentialId, dnspodDomain: link.domain }, link };
}

// ============ 站点 ============

export async function listSites(
  actor: ApiActor,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  keyword?: string
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const { zones, total } = await describeZones(credential.creds, { keyword: keyword || undefined });

  const sites = [];
  for (const zone of zones) {
    if (!isAllowed(actor, zone.zoneName)) continue;
    let link: DnspodLink | undefined;
    try {
      link = await resolveDnspodLink(actor.userId, credential.creds, zone.zoneName);
    } catch {
      link = undefined;
    }
    sites.push(mapSite(zone, link));
  }

  return {
    credential: { id: credential.id, name: credential.name },
    sites,
    total,
  };
}

export async function getSite(
  actor: ApiActor,
  siteRef: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const link = await resolveDnspodLink(actor.userId, credential.creds, site.domain).catch(() => undefined);
  return { site: mapSite(site.zone, link) };
}

export async function createSite(
  actor: ApiActor,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  body: { domain?: string; area?: string; planId?: string; aliasZoneName?: string }
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const domain = normalizeDnsName(body.domain);
  const area = asString(body.area) || 'overseas';

  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
    throw new ApiError('INVALID_ARGUMENT', '请输入正确的域名（如 example.com）', 400);
  }
  if (!AREAS.has(area)) {
    throw new ApiError('INVALID_ARGUMENT', 'area 只能是 mainland / overseas / global', 400);
  }
  assertAllowed(actor, domain);

  const existed = await describeZones(credential.creds, { keyword: domain });
  const duplicate = existed.zones.find((zone) => zone.zoneName === domain && zone.type === 'full');
  if (duplicate) {
    throw new ApiError('DOMAIN_ALREADY_EXISTS', `该凭证下已存在站点 ${domain}`, 409, { zoneId: duplicate.zoneId });
  }

  try {
    const created = await createNsZone(credential.creds, {
      domain,
      area,
      planId: asString(body.planId) || undefined,
      aliasZoneName: asString(body.aliasZoneName) || undefined,
    });
    await logEdgeOne(actor, 'CREATE', {
      domain,
      newValue: { zoneId: created.zoneId, area, nameServers: created.nameServers },
    });
    return {
      site: {
        id: created.zoneId,
        domain,
        area,
        nameServers: created.nameServers,
        ownershipVerification: created.ownershipVerification,
      },
    };
  } catch (error: any) {
    await logEdgeOne(actor, 'CREATE', { domain, error: error?.message });
    throw error;
  }
}

export async function deleteSite(
  actor: ApiActor,
  siteRef: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  await deleteZone(credential.creds, site.zone.zoneId);
  await logEdgeOne(actor, 'DELETE', { domain: site.domain, oldValue: { zoneId: site.zone.zoneId } });
  return { deleted: true, site: { id: site.zone.zoneId, domain: site.domain } };
}

export async function verifySite(
  actor: ApiActor,
  siteRef: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const result = await verifyOwnership(credential.creds, site.domain);
  return { site: site.domain, ...result };
}

// ============ 加速域名 ============

export async function listDomains(
  actor: ApiActor,
  siteRef: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  keyword?: string
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const { domains, total } = await describeAccelerationDomains(credential.creds, site.zone.zoneId, {
    keyword: keyword || undefined,
  });
  const linked = await withDnspodLinks(actor.userId, credential.creds, site.domain, domains);
  const certStatuses = decorateCertificateStatuses(linked.domains, actor.userId, site.zone.zoneId);

  return {
    site: site.domain,
    domains: linked.domains.map((domain) =>
      mapDomain(domain, site.domain, domain.dnspod, certStatuses[domain.domainName] || 'unknown')
    ),
    total,
    dnspodLink: linkSummary(linked.link),
  };
}

export async function getDomain(
  actor: ApiActor,
  siteRef: string,
  name: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const domainName = toTeoRecordFqdn(name, site.domain);
  const domain = await findDomain(credential.creds, site.zone.zoneId, domainName);
  if (!domain) throw new ApiError('DOMAIN_NOT_FOUND', `加速域名不存在: ${domainName}`, 404);

  const linked = await withDnspodLinks(actor.userId, credential.creds, site.domain, [domain]);
  const certStatuses = decorateCertificateStatuses(linked.domains, actor.userId, site.zone.zoneId);
  return {
    site: site.domain,
    domain: mapDomain(linked.domains[0], site.domain, linked.domains[0].dnspod, certStatuses[domainName] || 'unknown'),
  };
}

export async function createDomain(
  actor: ApiActor,
  siteRef: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  body: {
    name?: string;
    origin?: string;
    originProtocol?: string;
    httpOriginPort?: number;
    httpsOriginPort?: number;
    hostHeaderMode?: string;
    hostHeader?: string;
    applyFreeCert?: boolean;
  }
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const domainName = toTeoRecordFqdn(asString(body.name), site.domain);
  if (domainName === site.domain && !body.name) {
    throw new ApiError('INVALID_ARGUMENT', '缺少参数: name', 400);
  }

  const existed = await findDomain(credential.creds, site.zone.zoneId, domainName);
  if (existed) {
    throw new ApiError('DOMAIN_ALREADY_EXISTS', `加速域名已存在: ${domainName}`, 409, {
      existing: mapDomain(existed, site.domain),
      hint: '如需更新回源配置，请使用 PATCH 或 :upsert',
    });
  }

  const origin = asString(body.origin);
  const originProtocol = (asString(body.originProtocol).toUpperCase() || 'FOLLOW');
  const hostHeaderMode = asString(body.hostHeaderMode) || 'default';
  const hostHeader = asString(body.hostHeader);
  const httpOriginPort = asNumber(body.httpOriginPort);
  const httpsOriginPort = asNumber(body.httpsOriginPort);

  if (!origin) throw new ApiError('INVALID_ARGUMENT', '缺少参数: origin（回源 IP / 域名）', 400);
  if (!ORIGIN_PROTOCOLS.has(originProtocol)) {
    throw new ApiError('INVALID_ARGUMENT', 'originProtocol 只能是 FOLLOW / HTTP / HTTPS', 400);
  }
  if (!HOST_HEADER_MODES.has(hostHeaderMode)) {
    throw new ApiError('INVALID_ARGUMENT', 'hostHeaderMode 只能是 default / request / origin / custom', 400);
  }
  if (hostHeaderMode === 'custom' && !hostHeader) {
    throw new ApiError('INVALID_ARGUMENT', 'hostHeaderMode=custom 时必须提供 hostHeader', 400);
  }
  for (const [label, port] of [['httpOriginPort', httpOriginPort], ['httpsOriginPort', httpsOriginPort]] as const) {
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new ApiError('INVALID_ARGUMENT', `${label} 取值范围为 1 ~ 65535`, 400);
    }
  }

  try {
    const created = await createAccelerationDomain(credential.creds, site.zone.zoneId, {
      domainName,
      origin,
      originProtocol,
      httpOriginPort,
      httpsOriginPort,
      hostHeaderMode: hostHeaderMode as any,
      hostHeader,
    });

    const sync = await syncCnameToDnspod({
      userId: actor.userId,
      edgeOneCreds: credential.creds,
      siteDomain: site.domain,
      domain: { domainName, cname: created.cname, domainStatus: 'process' },
    });

    let certificate: any = null;
    if (asBool(body.applyFreeCert)) {
      certificate = await enableFreeCertificate({
        userId: actor.userId,
        creds: credential.creds,
        zoneId: site.zone.zoneId,
        zoneType: site.zone.type,
        domainName,
      });
    }

    await logEdgeOne(actor, 'CREATE', {
      domain: site.domain,
      recordName: domainName,
      recordType: 'CNAME',
      newValue: { origin, originProtocol, cname: created.cname, dnspodSync: mapSync(sync), certificate },
    });

    return {
      domain: domainName,
      cname: created.cname,
      dnspodSync: mapSync(sync),
      certificate,
    };
  } catch (error: any) {
    await logEdgeOne(actor, 'CREATE', { domain: site.domain, recordName: domainName, error: error?.message });
    throw error;
  }
}

export async function updateDomain(
  actor: ApiActor,
  siteRef: string,
  name: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  body: {
    origin?: string;
    originProtocol?: string;
    httpOriginPort?: number;
    httpsOriginPort?: number;
    hostHeader?: string;
  }
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const domainName = toTeoRecordFqdn(name, site.domain);
  const existing = await findDomain(credential.creds, site.zone.zoneId, domainName);
  if (!existing) throw new ApiError('DOMAIN_NOT_FOUND', `加速域名不存在: ${domainName}`, 404);

  const origin = body.origin !== undefined ? asString(body.origin) : undefined;
  if (origin !== undefined && !origin) throw new ApiError('INVALID_ARGUMENT', 'origin 不能为空', 400);

  const originProtocol = body.originProtocol !== undefined ? asString(body.originProtocol).toUpperCase() : undefined;
  if (originProtocol !== undefined && !ORIGIN_PROTOCOLS.has(originProtocol)) {
    throw new ApiError('INVALID_ARGUMENT', 'originProtocol 只能是 FOLLOW / HTTP / HTTPS', 400);
  }

  const httpOriginPort = asNumber(body.httpOriginPort);
  const httpsOriginPort = asNumber(body.httpsOriginPort);
  for (const [label, port] of [['httpOriginPort', httpOriginPort], ['httpsOriginPort', httpsOriginPort]] as const) {
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new ApiError('INVALID_ARGUMENT', `${label} 取值范围为 1 ~ 65535`, 400);
    }
  }

  const next = {
    origin: origin !== undefined ? origin : existing.origin,
    originProtocol: originProtocol !== undefined ? originProtocol : existing.originProtocol,
    httpOriginPort: httpOriginPort !== undefined ? httpOriginPort : existing.httpOriginPort,
    httpsOriginPort: httpsOriginPort !== undefined ? httpsOriginPort : existing.httpsOriginPort,
    hostHeader: body.hostHeader !== undefined ? asString(body.hostHeader) : existing.hostHeader,
  };

  const unchanged =
    next.origin === existing.origin &&
    next.originProtocol === existing.originProtocol &&
    next.httpOriginPort === existing.httpOriginPort &&
    next.httpsOriginPort === existing.httpsOriginPort &&
    next.hostHeader === existing.hostHeader;

  if (!unchanged) {
    try {
      await modifyAccelerationDomain(credential.creds, site.zone.zoneId, {
        domainName,
        origin: next.origin,
        originProtocol: next.originProtocol,
        httpOriginPort: next.httpOriginPort,
        httpsOriginPort: next.httpsOriginPort,
        hostHeader: next.hostHeader,
      });
      await logEdgeOne(actor, 'UPDATE', {
        domain: site.domain,
        recordName: domainName,
        oldValue: mapDomain(existing, site.domain),
        newValue: next,
      });
    } catch (error: any) {
      await logEdgeOne(actor, 'UPDATE', { domain: site.domain, recordName: domainName, error: error?.message });
      throw error;
    }
  }

  return {
    action: unchanged ? 'unchanged' : 'updated',
    domain: domainName,
    config: next,
  };
}

export async function setDomainStatus(
  actor: ApiActor,
  siteRef: string,
  name: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  status: string
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const target = asString(status).toLowerCase();
  if (target !== 'online' && target !== 'offline') {
    throw new ApiError('INVALID_ARGUMENT', 'status 只能是 online 或 offline', 400);
  }

  const domainName = toTeoRecordFqdn(name, site.domain);
  const existing = await findDomain(credential.creds, site.zone.zoneId, domainName);
  if (!existing) throw new ApiError('DOMAIN_NOT_FOUND', `加速域名不存在: ${domainName}`, 404);

  await modifyAccelerationDomainStatuses(credential.creds, {
    zoneId: site.zone.zoneId,
    domainNames: [domainName],
    status: target,
  });

  await logEdgeOne(actor, 'UPDATE', {
    domain: site.domain,
    recordName: domainName,
    newValue: { status: target },
  });

  return { domain: domainName, status: target };
}

async function waitUntilOffline(creds: Tc3Credentials, zoneId: string, domainName: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await findDomain(creds, zoneId, domainName);
    const status = String(current?.domainStatus || '').toLowerCase();
    if (!current || status === 'offline' || status === 'init') return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new ApiError('OFFLINE_TIMEOUT', `等待 ${domainName} 停用超时（60 秒），请稍后重试删除`, 409);
}

export async function deleteDomain(
  actor: ApiActor,
  siteRef: string,
  name: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  force: boolean
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const domainName = toTeoRecordFqdn(name, site.domain);
  const target = await findDomain(credential.creds, site.zone.zoneId, domainName);
  if (!target) throw new ApiError('DOMAIN_NOT_FOUND', `加速域名不存在: ${domainName}`, 404);

  const status = String(target.domainStatus || '').toLowerCase();
  let stopped = false;
  if (status !== 'offline' && status !== 'init') {
    if (!force) {
      throw new ApiError(
        'DOMAIN_IN_USE',
        `加速域名当前为「${target.domainStatus || '未知'}」，需先停用；可传 force=true 自动停用后删除`,
        409,
        { status: target.domainStatus }
      );
    }
    await modifyAccelerationDomainStatuses(credential.creds, {
      zoneId: site.zone.zoneId,
      domainNames: [domainName],
      status: 'offline',
    });
    await waitUntilOffline(credential.creds, site.zone.zoneId, domainName);
    stopped = true;
  }

  try {
    await deleteAccelerationDomains(credential.creds, site.zone.zoneId, [domainName]);
    const sync = await removeCnameFromDnspod({
      userId: actor.userId,
      edgeOneCreds: credential.creds,
      siteDomain: site.domain,
      domain: target,
    });

    await logEdgeOne(actor, 'DELETE', {
      domain: site.domain,
      recordName: domainName,
      recordType: 'CNAME',
      oldValue: { cname: target.cname, status: target.domainStatus },
      newValue: { stopped, dnspodSync: mapSync(sync) },
    });

    return { deleted: true, stopped, dnspodSync: mapSync(sync) };
  } catch (error: any) {
    await logEdgeOne(actor, 'DELETE', { domain: site.domain, recordName: domainName, error: error?.message });
    throw error;
  }
}

export async function getDomainCertificate(
  actor: ApiActor,
  siteRef: string,
  name: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const domainName = toTeoRecordFqdn(name, site.domain);
  return {
    domain: domainName,
    certificate: await getCertificateState({
      userId: actor.userId,
      creds: credential.creds,
      zoneId: site.zone.zoneId,
      domainName,
      withVerification: true,
    }),
  };
}

export async function applyDomainCertificate(
  actor: ApiActor,
  siteRef: string,
  name: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const domainName = toTeoRecordFqdn(name, site.domain);
  const existing = await findDomain(credential.creds, site.zone.zoneId, domainName);
  if (!existing) throw new ApiError('DOMAIN_NOT_FOUND', `加速域名不存在: ${domainName}`, 404);

  const result = await enableFreeCertificate({
    userId: actor.userId,
    creds: credential.creds,
    zoneId: site.zone.zoneId,
    zoneType: site.zone.type,
    domainName,
  });

  await logEdgeOne(actor, 'UPDATE', {
    domain: site.domain,
    recordName: domainName,
    newValue: { certificate: result },
    error: result.status === 'disabled' ? result.reason : undefined,
  });

  return { domain: domainName, certificate: result };
}

export async function syncSiteDomains(
  actor: ApiActor,
  siteRef: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await resolveSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const link = await resolveDnspodLink(actor.userId, credential.creds, site.domain);
  if (!link.available) {
    throw new ApiError('INVALID_ARGUMENT', `未找到可用的 DNSPod 关联：${link.reason || '未知原因'}`, 400, {
      dnspodLink: linkSummary(link),
    });
  }

  const { domains } = await describeAccelerationDomains(credential.creds, site.zone.zoneId);
  const results: any[] = [];
  for (const domain of domains) {
    const result = await syncCnameToDnspod({
      userId: actor.userId,
      edgeOneCreds: credential.creds,
      siteDomain: site.domain,
      domain,
    });
    results.push({ domain: domain.domainName, action: result.action, error: result.error || null });
  }

  const errors = results.filter((item) => item.error);
  await logEdgeOne(actor, 'UPDATE', {
    domain: site.domain,
    newValue: { total: results.length, results },
    error: errors.length ? errors.map((item) => `${item.domain}: ${item.error}`).join('; ') : undefined,
  });

  return {
    total: results.length,
    succeeded: results.length - errors.length,
    failed: errors.length,
    results,
    dnspodLink: linkSummary(link),
  };
}

// ============ EdgeOne DNS 记录（仅 full / NS 站点） ============

async function requireFullSite(creds: Tc3Credentials, siteRef: string) {
  const site = await resolveSite(creds, siteRef);
  const type = String(site.zone.type || '').toLowerCase();
  if (type !== 'full') {
    throw new ApiError(
      'ZONE_NOT_RECORD_CAPABLE',
      `站点 ${site.domain} 的接入方式为 ${site.zone.type}，解析记录不在 EdgeOne（请在 DNSPod 上操作）`,
      400,
      { site: site.domain, type: site.zone.type, hint: '使用 /api/open/domains/<域名>/records 操作 DNSPod' }
    );
  }
  return site;
}

export async function listEdgeOneRecords(
  actor: ApiActor,
  siteRef: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  params: { name?: string; type?: string }
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await requireFullSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const { records, total } = await describeDnsRecords(credential.creds, site.zone.zoneId, {
    name: params.name ? toTeoRecordFqdn(params.name, site.domain) : undefined,
    type: params.type ? params.type.toUpperCase() : undefined,
  });

  return {
    site: site.domain,
    records: records.map((record) => ({
      id: record.recordId,
      domain: site.domain,
      name: toRelativeRecordName(record.name, site.domain),
      fqdn: record.name,
      type: record.type,
      value: record.content,
      ttl: record.ttl,
      priority: record.priority,
      status: record.status,
    })),
    total,
  };
}

export async function createEdgeOneRecord(
  actor: ApiActor,
  siteRef: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  body: { name?: string; type?: string; value?: string; content?: string; ttl?: number; priority?: number }
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await requireFullSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const type = asString(body.type).toUpperCase();
  if (!RECORD_TYPES.has(type)) {
    throw new ApiError('UNSUPPORTED_RECORD_TYPE', `EdgeOne 不支持记录类型 ${type || '(空)'}`, 400, {
      supported: Array.from(RECORD_TYPES),
    });
  }

  const content = asString(body.content ?? body.value);
  if (!content) throw new ApiError('INVALID_ARGUMENT', '缺少参数: value', 400);
  if (!body.name) throw new ApiError('INVALID_ARGUMENT', '缺少参数: name', 400);

  const name = toTeoRecordFqdn(asString(body.name), site.domain);
  const ttl = asNumber(body.ttl);
  const priority = asNumber(body.priority);
  if (type === 'MX' && priority === undefined) {
    throw new ApiError('INVALID_ARGUMENT', 'MX 记录必须提供 priority', 400);
  }

  try {
    const recordId = await createDnsRecord(credential.creds, site.zone.zoneId, {
      name,
      type,
      content,
      ttl,
      priority,
    });
    const record = (await getDnsRecord(credential.creds, site.zone.zoneId, recordId)) || {
      recordId,
      name,
      type,
      content,
      ttl,
      priority,
    };

    const { target } = await resolveSyncTarget(actor.userId, credential.creds, site.domain);
    const sync = await syncEdgeOneRecordToDnspod({
      userId: actor.userId,
      siteDomain: site.domain,
      target,
      record,
    });

    await logEdgeOne(actor, 'CREATE', {
      domain: site.domain,
      recordName: toRelativeRecordName(name, site.domain),
      recordType: type,
      newValue: { record, sync: mapSyncSummary(sync) },
    });

    return {
      record: {
        id: recordId,
        domain: site.domain,
        name: toRelativeRecordName(name, site.domain),
        fqdn: name,
        type,
        value: content,
        ttl: record.ttl,
        priority: record.priority,
      },
      dnspodSync: mapSyncSummary(sync),
    };
  } catch (error: any) {
    await logEdgeOne(actor, 'CREATE', { domain: site.domain, recordName: name, recordType: type, error: error?.message });
    throw error;
  }
}

export async function updateEdgeOneRecord(
  actor: ApiActor,
  siteRef: string,
  recordId: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  body: { name?: string; type?: string; value?: string; content?: string; ttl?: number; priority?: number }
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await requireFullSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const before = await getDnsRecord(credential.creds, site.zone.zoneId, recordId);
  if (!before) throw new ApiError('RECORD_NOT_FOUND', `记录不存在: ${recordId}`, 404);

  const type = body.type ? asString(body.type).toUpperCase() : before.type.toUpperCase();
  if (!RECORD_TYPES.has(type)) {
    throw new ApiError('UNSUPPORTED_RECORD_TYPE', `EdgeOne 不支持记录类型 ${type}`, 400, {
      supported: Array.from(RECORD_TYPES),
    });
  }

  const content = body.content !== undefined || body.value !== undefined
    ? asString(body.content ?? body.value)
    : before.content;
  if (!content) throw new ApiError('INVALID_ARGUMENT', 'value 不能为空', 400);

  const name = body.name !== undefined ? toTeoRecordFqdn(body.name, site.domain) : before.name;
  const ttl = body.ttl !== undefined ? asNumber(body.ttl) : before.ttl;
  const priority = body.priority !== undefined
    ? asNumber(body.priority)
    : type === 'MX'
      ? before.priority
      : undefined;

  try {
    await modifyDnsRecords(credential.creds, site.zone.zoneId, [
      { recordId, name, type, content, ttl, priority },
    ]);
    const after = (await getDnsRecord(credential.creds, site.zone.zoneId, recordId)) || {
      ...before,
      name,
      type,
      content,
      ttl,
      priority,
    };

    const { target } = await resolveSyncTarget(actor.userId, credential.creds, site.domain);
    const sync = await syncEdgeOneRecordToDnspod({
      userId: actor.userId,
      siteDomain: site.domain,
      target,
      record: after,
    });

    await logEdgeOne(actor, 'UPDATE', {
      domain: site.domain,
      recordName: toRelativeRecordName(name, site.domain),
      recordType: type,
      oldValue: { record: before },
      newValue: { record: after, sync: mapSyncSummary(sync) },
    });

    return {
      record: {
        id: recordId,
        domain: site.domain,
        name: toRelativeRecordName(after.name, site.domain),
        fqdn: after.name,
        type: after.type,
        value: after.content,
        ttl: after.ttl,
        priority: after.priority,
      },
      dnspodSync: mapSyncSummary(sync),
    };
  } catch (error: any) {
    await logEdgeOne(actor, 'UPDATE', { domain: site.domain, recordName: name, recordType: type, error: error?.message });
    throw error;
  }
}

export async function deleteEdgeOneRecord(
  actor: ApiActor,
  siteRef: string,
  recordId: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openEdgeOne(actor, credentialId, boundCredentialId);
  const site = await requireFullSite(credential.creds, siteRef);
  assertAllowed(actor, site.domain);

  const before = await getDnsRecord(credential.creds, site.zone.zoneId, recordId);
  if (!before) throw new ApiError('RECORD_NOT_FOUND', `记录不存在: ${recordId}`, 404);

  await deleteDnsRecords(credential.creds, site.zone.zoneId, [recordId]);

  const { target } = await resolveSyncTarget(actor.userId, credential.creds, site.domain);
  const sync = await syncEdgeOneRecordDeleteToDnspod({
    userId: actor.userId,
    siteDomain: site.domain,
    target,
    record: before,
  });

  await logEdgeOne(actor, 'DELETE', {
    domain: site.domain,
    recordName: toRelativeRecordName(before.name, site.domain),
    recordType: before.type,
    oldValue: { record: before },
    newValue: { sync: mapSyncSummary(sync) },
  });

  return { deleted: true, dnspodSync: mapSyncSummary(sync) };
}
