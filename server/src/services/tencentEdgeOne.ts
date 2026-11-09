/**
 * 腾讯云 EdgeOne (teo) API 客户端
 *
 * - 使用腾讯云 API 3.0 TC3-HMAC-SHA256 签名（复用 DNSPod 的签名实现）
 * - 接口版本 2022-09-01，域名 teo.tencentcloudapi.com
 * - 仅使用 NS 接入站点相关接口：站点、DNS 记录、套餐、归属权校验
 *
 * 参考文档：
 * https://cloud.tencent.com/document/product/1552/80719 (CreateZone)
 * https://cloud.tencent.com/document/product/1552/80713 (DescribeZones)
 */

import { buildTc3Headers, type Tc3Credentials } from '../providers/dnspod/auth';
import { requestJson } from './cert/httpClient';

// 允许通过环境变量覆盖接口域名（用于本地联调 / 国际站），默认中国站
const TEO_HOST = String(process.env.TEO_API_HOST || 'teo.tencentcloudapi.com').trim();
const TEO_PROTOCOL = String(process.env.TEO_API_PROTOCOL || 'https').trim() === 'http' ? 'http' : 'https';
const TEO_SERVICE = 'teo';
const TEO_VERSION = '2022-09-01';

export interface TeoOwnershipVerification {
  dnsVerification?: { subdomain?: string; recordType?: string; recordValue?: string } | null;
  nsVerification?: { nameServers?: string[] } | null;
}

export interface TeoZone {
  zoneId: string;
  zoneName: string;
  aliasZoneName?: string;
  type: string;
  area?: string;
  status?: string;
  activeStatus?: string;
  cnameStatus?: string;
  paused?: boolean;
  planType?: string;
  createdOn?: string;
  modifiedOn?: string;
  nameServers: string[];
  originalNameServers: string[];
  ownershipVerification?: TeoOwnershipVerification | null;
}

export interface TeoDnsRecord {
  recordId: string;
  name: string;         // FQDN，例如 www.example.com / example.com
  type: string;
  content: string;
  ttl?: number;
  location?: string;
  weight?: number;
  priority?: number;
  status?: string;      // enable / disable
  createdOn?: string;
  modifiedOn?: string;
}

export interface TeoPlan {
  planId: string;
  planType?: string;
  area?: string;
  status?: string;
}

/** EdgeOne 加速域名（站点下真正由 EdgeOne 管理的「域名」） */
export interface TeoAccelerationDomain {
  domainName: string;
  domainStatus?: string;     // online / process / offline / init
  cname?: string;            // 需要在 DNS 侧配置的 CNAME 目标
  identificationStatus?: string;
  originType?: string;
  origin?: string;
  originProtocol?: string;
  httpOriginPort?: number;
  httpsOriginPort?: number;
  hostHeader?: string;       // 回源 HOST 头：$host / 回源域名 / 自定义
  certificateMode?: string;  // disable / eofreecert / eofreecert_manual / sslcert
  certificateCount?: number;
  createdOn?: string;
  modifiedOn?: string;
}

export interface TeoCreateZoneResult {
  zoneId: string;
  nameServers: string[];
  ownershipVerification?: TeoOwnershipVerification | null;
}

export interface TeoVerifyOwnershipResult {
  status?: string;
  result?: string;
}

export class TeoError extends Error {
  code: string;
  requestId?: string;
  httpStatus: number;

  constructor(message: string, code = 'UnknownError', requestId?: string, httpStatus = 400) {
    super(message);
    this.name = 'TeoError';
    this.code = code;
    this.requestId = requestId;
    this.httpStatus = httpStatus;
  }
}

function asString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => asString(item)).filter(Boolean) : [];
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** 规范化域名：去空白、去尾部点、小写、去掉协议与路径 */
export function normalizeDnsName(value: unknown): string {
  let name = asString(value).toLowerCase();
  name = name.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\.+$/, '');
  return name;
}

/** 把用户输入的主机记录（www / @ / FQDN）规范成 EdgeOne 需要的 FQDN
 *  通配符记录保持为 *.example.com，允许与 DNSPod 的 "*" 主机记录一一对应。
 */
export function toTeoRecordFqdn(name: string, zoneName: string): string {
  const zone = normalizeDnsName(zoneName);
  const raw = normalizeDnsName(name);
  if (!raw || raw === '@' || raw === zone) return zone;
  if (raw.endsWith(`.${zone}`)) return raw;
  return `${raw}.${zone}`;
}

/** FQDN 转换为 DNSPod 使用的相对主机记录（@ 表示根域名） */
export function toRelativeRecordName(fqdn: string, zoneName: string): string {
  const host = normalizeDnsName(fqdn);
  const zone = normalizeDnsName(zoneName);
  if (!host || host === zone) return '@';
  if (host.endsWith(`.${zone}`)) {
    return host.slice(0, -(zone.length + 1)) || '@';
  }
  return host;
}

/**
 * 调用腾讯云 EdgeOne API
 */
export async function callTeo<T = any>(creds: Tc3Credentials, action: string, payload: Record<string, any> = {}): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload && Object.keys(payload).length ? payload : {});
  const headers = buildTc3Headers(creds, {
    host: TEO_HOST,
    service: TEO_SERVICE,
    action,
    version: TEO_VERSION,
    timestamp,
    payload: body,
  });

  let response: { status: number; data: any; raw: string };
  try {
    response = await requestJson<{ Response?: T & { Error?: { Code?: string; Message?: string }; RequestId?: string } }>({
      url: `${TEO_PROTOCOL}://${TEO_HOST}/`,
      method: 'POST',
      headers,
      body,
      timeoutMs: 20000,
    });
  } catch (error: any) {
    throw new TeoError(error?.message || `腾讯云 EdgeOne 接口请求失败：${action}`, 'NetworkError', undefined, 502);
  }

  const envelope = response.data?.Response;
  if (envelope?.Error) {
    const code = asString(envelope.Error.Code) || 'UnknownError';
    const message = asString(envelope.Error.Message) || `腾讯云 EdgeOne 接口调用失败：${action}`;
    const status = /Unauthorized|AuthFailure|NoPermission|CamUnauthorized/i.test(code) ? 401 : 400;
    throw new TeoError(`${code}: ${message}`, code, asString(envelope.RequestId) || undefined, status);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new TeoError(`腾讯云 EdgeOne 接口调用失败：${action}（HTTP ${response.status}）`, 'HttpError', undefined, 502);
  }

  return (envelope || {}) as T;
}

function mapOwnershipVerification(raw: any): TeoOwnershipVerification | null {
  if (!raw || typeof raw !== 'object') return null;
  const dns = raw.DnsVerification;
  const ns = raw.NsVerification;
  return {
    dnsVerification: dns && typeof dns === 'object'
      ? {
          subdomain: asString(dns.Subdomain) || undefined,
          recordType: asString(dns.RecordType) || undefined,
          recordValue: asString(dns.RecordValue) || undefined,
        }
      : null,
    nsVerification: ns && typeof ns === 'object'
      ? { nameServers: asArray(ns.NameServers) }
      : null,
  };
}

function mapZone(raw: any): TeoZone {
  const nsDetail = raw?.NSDetail && typeof raw.NSDetail === 'object' ? raw.NSDetail : {};
  return {
    zoneId: asString(raw?.ZoneId),
    zoneName: normalizeDnsName(raw?.ZoneName),
    aliasZoneName: asString(raw?.AliasZoneName) || undefined,
    type: asString(raw?.Type) || 'full',
    area: asString(raw?.Area) || undefined,
    status: asString(raw?.Status) || undefined,
    activeStatus: asString(raw?.ActiveStatus) || undefined,
    cnameStatus: asString(raw?.CnameStatus) || undefined,
    paused: typeof raw?.Paused === 'boolean' ? raw.Paused : undefined,
    planType: asString(raw?.PlanType) || undefined,
    createdOn: asString(raw?.CreatedOn) || undefined,
    modifiedOn: asString(raw?.ModifiedOn) || undefined,
    nameServers: asArray(nsDetail?.NameServers),
    originalNameServers: asArray(nsDetail?.OriginalNameServers),
    ownershipVerification: mapOwnershipVerification(nsDetail?.OwnershipVerification),
  };
}

function mapDnsRecord(raw: any): TeoDnsRecord {
  return {
    recordId: asString(raw?.RecordId),
    name: normalizeDnsName(raw?.Name),
    type: asString(raw?.Type).toUpperCase(),
    content: asString(raw?.Content),
    ttl: asNumber(raw?.TTL),
    location: asString(raw?.Location) || undefined,
    weight: asNumber(raw?.Weight),
    priority: asNumber(raw?.Priority),
    status: asString(raw?.Status) || undefined,
    createdOn: asString(raw?.CreatedOn) || undefined,
    modifiedOn: asString(raw?.ModifiedOn) || undefined,
  };
}

/** 查询站点列表（自动分页） */
export async function describeZones(creds: Tc3Credentials, options: { keyword?: string; zoneId?: string; maxPages?: number } = {}): Promise<{ zones: TeoZone[]; total: number }> {
  const limit = 100;
  const maxPages = Math.max(1, Math.min(options.maxPages || 50, 200));
  const zones: TeoZone[] = [];
  let total = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const payload: Record<string, any> = { Offset: page * limit, Limit: limit };
    const filters: Array<{ Name: string; Values: string[]; Fuzzy?: boolean }> = [];
    if (options.keyword) filters.push({ Name: 'zone-name', Values: [options.keyword], Fuzzy: true });
    if (options.zoneId) filters.push({ Name: 'zone-id', Values: [options.zoneId], Fuzzy: false });
    if (filters.length) payload.Filters = filters;
    const response = await callTeo<any>(creds, 'DescribeZones', payload);
    const batch: any[] = Array.isArray(response?.Zones) ? response.Zones : [];
    total = asNumber(response?.TotalCount) ?? total;
    zones.push(...batch.map(mapZone).filter((zone) => zone.zoneId && zone.zoneName));
    if (batch.length < limit) break;
    if (total > 0 && zones.length >= total) break;
  }

  return { zones, total: total || zones.length };
}

/** 创建 NS 接入站点；一个站点对应一个域名 */
export async function createNsZone(creds: Tc3Credentials, options: {
  domain: string;
  area: string;
  planId?: string;
  aliasZoneName?: string;
}): Promise<TeoCreateZoneResult> {
  const payload: Record<string, any> = {
    Type: 'full', // NS 接入
    ZoneName: normalizeDnsName(options.domain),
    Area: options.area,
  };
  if (options.planId) payload.PlanId = options.planId;
  if (options.aliasZoneName) payload.AliasZoneName = options.aliasZoneName;

  const response = await callTeo<any>(creds, 'CreateZone', payload);
  const zoneId = asString(response?.ZoneId);
  if (!zoneId) throw new TeoError('创建站点失败：EdgeOne 未返回 ZoneId', 'CreateZoneFailed');

  const verification = mapOwnershipVerification(response?.OwnershipVerification);
  return {
    zoneId,
    nameServers: verification?.nsVerification?.nameServers || [],
    ownershipVerification: verification,
  };
}

/** 删除站点 */
export async function deleteZone(creds: Tc3Credentials, zoneId: string): Promise<void> {
  await callTeo(creds, 'DeleteZone', { ZoneId: zoneId });
}

/** 查询 NS 是否已切换（站点归属权校验） */
export async function verifyOwnership(creds: Tc3Credentials, domain: string): Promise<TeoVerifyOwnershipResult> {
  const response = await callTeo<any>(creds, 'VerifyOwnership', { Domain: normalizeDnsName(domain) });
  return {
    status: asString(response?.Status) || undefined,
    result: asString(response?.Result) || undefined,
  };
}

function mapAccelerationDomain(raw: any): TeoAccelerationDomain {
  const origin = raw?.OriginDetail && typeof raw.OriginDetail === 'object' ? raw.OriginDetail : {};
  const cert = raw?.Certificate && typeof raw.Certificate === 'object' ? raw.Certificate : {};
  return {
    domainName: normalizeDnsName(raw?.DomainName),
    domainStatus: asString(raw?.DomainStatus) || undefined,
    cname: normalizeDnsName(raw?.Cname) || undefined,
    identificationStatus: asString(raw?.IdentificationStatus) || undefined,
    originType: asString(origin?.OriginType) || undefined,
    origin: asString(origin?.Origin) || undefined,
    originProtocol: asString(raw?.OriginProtocol) || undefined,
    httpOriginPort: asNumber(raw?.HttpOriginPort),
    httpsOriginPort: asNumber(raw?.HttpsOriginPort),
    hostHeader: asString(origin?.HostHeader) || undefined,
    certificateMode: asString(cert?.Mode) || 'disable',
    certificateCount: Array.isArray(cert?.List) ? cert.List.length : 0,
    createdOn: asString(raw?.CreatedOn) || undefined,
    modifiedOn: asString(raw?.ModifiedOn) || undefined,
  };
}

/** 查询站点下的加速域名（自动分页） */
export async function describeAccelerationDomains(creds: Tc3Credentials, zoneId: string, options: {
  keyword?: string;
  maxPages?: number;
} = {}): Promise<{ domains: TeoAccelerationDomain[]; total: number }> {
  const limit = 200;
  const maxPages = Math.max(1, Math.min(options.maxPages || 50, 200));
  const domains: TeoAccelerationDomain[] = [];
  let total = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const payload: Record<string, any> = { ZoneId: zoneId, Offset: page * limit, Limit: limit };
    if (options.keyword) {
      payload.Filters = [{ Name: 'domain-name', Values: [options.keyword], Fuzzy: true }];
    }
    const response = await callTeo<any>(creds, 'DescribeAccelerationDomains', payload);
    const batch: any[] = Array.isArray(response?.AccelerationDomains) ? response.AccelerationDomains : [];
    total = asNumber(response?.TotalCount) ?? total;
    domains.push(...batch.map(mapAccelerationDomain).filter((item) => item.domainName));
    if (batch.length < limit) break;
    if (total > 0 && domains.length >= total) break;
  }

  return { domains, total: total || domains.length };
}

/** 创建加速域名，返回分配给该域名的 CNAME */
export async function createAccelerationDomain(creds: Tc3Credentials, zoneId: string, params: {
  domainName: string;
  origin: string;                 // 回源 IP / 域名
  originProtocol?: string;        // FOLLOW / HTTP / HTTPS
  httpOriginPort?: number;
  httpsOriginPort?: number;
  hostHeaderMode?: 'default' | 'request' | 'origin' | 'custom';  // 回源 HOST 头模式
  hostHeader?: string;            // 仅 custom 模式：自定义回源 HOST 头
}): Promise<{ domainName: string; cname?: string }> {
  const protocol = String(params.originProtocol || 'FOLLOW').toUpperCase();
  const originInfo: Record<string, any> = {
    OriginType: 'IP_DOMAIN',
    Origin: asString(params.origin),
  };
  // 默认不传 HostHeader；跟随请求 → $host；使用回源地址 → 源站地址；自定义 → 用户填的值
  if (params.hostHeaderMode === 'request') {
    originInfo.HostHeader = '$host';
  } else if (params.hostHeaderMode === 'origin') {
    originInfo.HostHeader = asString(params.origin);
  } else if (params.hostHeaderMode === 'custom' && asString(params.hostHeader)) {
    originInfo.HostHeader = asString(params.hostHeader);
  }

  const payload: Record<string, any> = {
    ZoneId: zoneId,
    DomainName: normalizeDnsName(params.domainName),
    OriginInfo: originInfo,
    OriginProtocol: protocol,
  };
  // 端口默认值：HTTP 80 / HTTPS 443；FOLLOW 时两者都带
  if (protocol === 'HTTP' || protocol === 'FOLLOW') {
    payload.HttpOriginPort = typeof params.httpOriginPort === 'number' ? params.httpOriginPort : 80;
  }
  if (protocol === 'HTTPS' || protocol === 'FOLLOW') {
    payload.HttpsOriginPort = typeof params.httpsOriginPort === 'number' ? params.httpsOriginPort : 443;
  }

  await callTeo(creds, 'CreateAccelerationDomain', payload);

  // CreateAccelerationDomain 不返回 CNAME，查一次列表拿到 EdgeOne 分配的地址
  const { domains } = await describeAccelerationDomains(creds, zoneId, { keyword: normalizeDnsName(params.domainName) });
  const created = domains.find((item) => item.domainName === normalizeDnsName(params.domainName));
  return { domainName: normalizeDnsName(params.domainName), cname: created?.cname };
}

/**
 * 配置域名服务端证书。
 * 在 NS / DNSPod 托管接入模式下，免费证书只能通过 Mode='eofreecert' 由 EdgeOne 自动验证并部署
 * （直接调 ApplyFreeCertificate 会报 OperationDenied.CurrentZoneOnlySupportAutoVerification）。
 */
export async function modifyHostsCertificate(creds: Tc3Credentials, params: {
  zoneId: string;
  hosts: string[];
  mode: 'eofreecert' | 'disable' | 'sslcert' | 'eofreecert_manual';
  certId?: string;
}): Promise<void> {
  const payload: Record<string, any> = {
    ZoneId: params.zoneId,
    Hosts: params.hosts,
    Mode: params.mode,
  };
  if (params.mode === 'sslcert' && params.certId) {
    payload.ServerCertInfo = [{ CertId: params.certId }];
  }
  await callTeo(creds, 'ModifyHostsCertificate', payload);
}

/** 查询域名免费证书申请/签发结果；未申请或失败时腾讯云会返回错误 */
export async function checkFreeCertificateVerification(creds: Tc3Credentials, params: {
  zoneId: string;
  domainName: string;
}): Promise<{ issued: boolean; commonName?: string; expireTime?: string; signatureAlgorithm?: string; error?: string }> {
  try {
    const r = await callTeo<any>(creds, 'CheckFreeCertificateVerification', {
      ZoneId: params.zoneId,
      Domain: normalizeDnsName(params.domainName),
    });
    return {
      issued: true,
      commonName: asString(r?.CommonName) || undefined,
      expireTime: asString(r?.ExpireTime) || undefined,
      signatureAlgorithm: asString(r?.SignatureAlgorithm) || undefined,
    };
  } catch (error: any) {
    return { issued: false, error: error?.message || '暂无免费证书' };
  }
}

/** 申请 EdgeOne 免费证书（手动 DNS 验证方式，仅非 NS / 非托管接入站点可用） */
export async function applyFreeCertificate(creds: Tc3Credentials, params: {
  zoneId: string;
  domainName: string;
  method?: 'dns_challenge' | 'http_challenge';
}): Promise<{
  method: string;
  dnsVerification?: { subdomain?: string; recordType?: string; recordValue?: string };
  fileVerification?: { path?: string; content?: string };
}> {
  const method = params.method || 'dns_challenge';
  const response = await callTeo<any>(creds, 'ApplyFreeCertificate', {
    ZoneId: params.zoneId,
    Domain: normalizeDnsName(params.domainName),
    VerificationMethod: method,
  });
  const dns = response?.DnsVerification;
  const file = response?.FileVerification;
  return {
    method,
    ...(dns && typeof dns === 'object' ? {
      dnsVerification: {
        subdomain: asString(dns.Subdomain) || undefined,
        recordType: asString(dns.RecordType) || undefined,
        recordValue: asString(dns.RecordValue) || undefined,
      },
    } : {}),
    ...(file && typeof file === 'object' ? {
      fileVerification: {
        path: asString(file.Path) || undefined,
        content: asString(file.Content) || undefined,
      },
    } : {}),
  };
}

/**
 * 为加速域名开启免费证书（自动适配站点接入模式）：
 * 1. 先查 CheckFreeCertificateVerification，已签发则直接复用；
 * 2. NS / DNSPod 托管接入 → ModifyHostsCertificate(Mode='eofreecert') 触发自动验证申请；
 * 3. 其他接入模式 → ApplyFreeCertificate(dns_challenge)，返回验证信息交给调用方写 DNS。
 */
export async function ensureFreeCertificate(creds: Tc3Credentials, params: {
  zoneId: string;
  zoneType: string;
  domainName: string;
}): Promise<{
  mode: 'already_issued' | 'auto_verification' | 'manual_verification';
  issued?: { commonName?: string; expireTime?: string };
  dnsVerification?: { subdomain?: string; recordType?: string; recordValue?: string };
}> {
  const domainName = normalizeDnsName(params.domainName);
  const existing = await checkFreeCertificateVerification(creds, { zoneId: params.zoneId, domainName });
  if (existing.issued) {
    return { mode: 'already_issued', issued: { commonName: existing.commonName, expireTime: existing.expireTime } };
  }

  const type = String(params.zoneType || '').toLowerCase();
  if (type === 'full' || type === 'dnspodaccess') {
    await modifyHostsCertificate(creds, { zoneId: params.zoneId, hosts: [domainName], mode: 'eofreecert' });
    return { mode: 'auto_verification' };
  }

  const applied = await applyFreeCertificate(creds, { zoneId: params.zoneId, domainName, method: 'dns_challenge' });
  return { mode: 'manual_verification', dnsVerification: applied.dnsVerification };
}

/** 停用 / 启用加速域名（online / offline） */
export async function modifyAccelerationDomainStatuses(creds: Tc3Credentials, params: {
  zoneId: string;
  domainNames: string[];
  status: 'online' | 'offline';
  force?: boolean;
}): Promise<void> {
  const names = params.domainNames.map((name) => normalizeDnsName(name)).filter(Boolean);
  if (names.length === 0) return;
  await callTeo(creds, 'ModifyAccelerationDomainStatuses', {
    ZoneId: params.zoneId,
    DomainNames: names,
    Status: params.status,
    ...(params.force ? { Force: true } : {}),
  });
}

/** 编辑加速域名（回源地址 / 协议 / 端口 / 回源 Host） */
export async function modifyAccelerationDomain(creds: Tc3Credentials, zoneId: string, params: {
  domainName: string;
  origin?: string;
  originProtocol?: string;
  httpOriginPort?: number;
  httpsOriginPort?: number;
  hostHeader?: string;
}): Promise<void> {
  const payload: Record<string, any> = {
    ZoneId: zoneId,
    DomainName: normalizeDnsName(params.domainName),
  };
  if (params.origin !== undefined || params.hostHeader !== undefined) {
    const originInfo: Record<string, any> = { OriginType: 'IP_DOMAIN' };
    if (params.origin !== undefined) originInfo.Origin = asString(params.origin);
    if (params.hostHeader !== undefined) {
      // HostHeader 传空字符串表示恢复默认
      originInfo.HostHeader = asString(params.hostHeader);
    }
    payload.OriginInfo = originInfo;
  }
  if (params.originProtocol !== undefined) payload.OriginProtocol = params.originProtocol;
  if (typeof params.httpOriginPort === 'number') payload.HttpOriginPort = params.httpOriginPort;
  if (typeof params.httpsOriginPort === 'number') payload.HttpsOriginPort = params.httpsOriginPort;
  await callTeo(creds, 'ModifyAccelerationDomain', payload);
}

/** 删除加速域名 */
export async function deleteAccelerationDomains(creds: Tc3Credentials, zoneId: string, domainNames: string[]): Promise<void> {
  const names = domainNames.map((name) => normalizeDnsName(name)).filter(Boolean);
  if (names.length === 0) return;
  await callTeo(creds, 'DeleteAccelerationDomains', { ZoneId: zoneId, DomainNames: names, Force: false });
}

/** 查询可用套餐 */
export async function describePlans(creds: Tc3Credentials): Promise<TeoPlan[]> {
  const response = await callTeo<any>(creds, 'DescribePlans', { Offset: 0, Limit: 200 });
  const plans: any[] = Array.isArray(response?.Plans) ? response.Plans : [];
  return plans
    .map((plan) => ({
      planId: asString(plan?.PlanId),
      planType: asString(plan?.PlanType) || undefined,
      area: asString(plan?.Area) || undefined,
      status: asString(plan?.Status) || undefined,
    }))
    .filter((plan) => plan.planId);
}

/** 查询站点 DNS 记录（自动分页） */
export async function describeDnsRecords(creds: Tc3Credentials, zoneId: string, options: {
  name?: string;
  type?: string;
  maxPages?: number;
} = {}): Promise<{ records: TeoDnsRecord[]; total: number }> {
  const limit = 1000;
  const maxPages = Math.max(1, Math.min(options.maxPages || 50, 200));
  const records: TeoDnsRecord[] = [];
  let total = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const payload: Record<string, any> = { ZoneId: zoneId, Offset: page * limit, Limit: limit };
    const filters: Array<{ Name: string; Values: string[]; Fuzzy?: boolean }> = [];
    if (options.name) filters.push({ Name: 'name', Values: [options.name], Fuzzy: false });
    if (options.type) filters.push({ Name: 'type', Values: [options.type], Fuzzy: false });
    if (filters.length) payload.Filters = filters;

    const response = await callTeo<any>(creds, 'DescribeDnsRecords', payload);
    const batch: any[] = Array.isArray(response?.DnsRecords) ? response.DnsRecords : [];
    total = asNumber(response?.TotalCount) ?? total;
    records.push(...batch.map(mapDnsRecord).filter((record) => record.recordId));
    if (batch.length < limit) break;
    if (total > 0 && records.length >= total) break;
  }

  return { records, total: total || records.length };
}

/** 创建 EdgeOne DNS 记录，返回记录 ID */
export async function createDnsRecord(creds: Tc3Credentials, zoneId: string, params: {
  name: string;       // FQDN
  type: string;
  content: string;
  ttl?: number;
  priority?: number;
}): Promise<string> {
  const payload: Record<string, any> = {
    ZoneId: zoneId,
    Name: normalizeDnsName(params.name),
    Type: params.type.toUpperCase(),
    Content: params.content,
  };
  if (params.ttl !== undefined) payload.TTL = params.ttl;
  if (params.type.toUpperCase() === 'MX' && params.priority !== undefined) payload.Priority = params.priority;

  const response = await callTeo<any>(creds, 'CreateDnsRecord', payload);
  const recordId = asString(response?.RecordId);
  if (!recordId) throw new TeoError('创建解析记录失败：EdgeOne 未返回 RecordId', 'CreateDnsRecordFailed');
  return recordId;
}

/** 批量修改 EdgeOne DNS 记录（ModifyDnsRecords 只接受 RecordId + 需要变更的字段） */
export async function modifyDnsRecords(creds: Tc3Credentials, zoneId: string, records: Array<{
  recordId: string;
  name?: string;
  type?: string;
  content?: string;
  ttl?: number;
  priority?: number;
}>): Promise<void> {
  const payloadRecords = records.map((record) => {
    const item: Record<string, any> = { RecordId: record.recordId };
    if (record.name !== undefined) item.Name = normalizeDnsName(record.name);
    if (record.type !== undefined) item.Type = record.type.toUpperCase();
    if (record.content !== undefined) item.Content = record.content;
    if (record.ttl !== undefined) item.TTL = record.ttl;
    if (record.type?.toUpperCase() === 'MX' && record.priority !== undefined) item.Priority = record.priority;
    return item;
  });
  await callTeo(creds, 'ModifyDnsRecords', { ZoneId: zoneId, DnsRecords: payloadRecords });
}

/** 批量删除 EdgeOne DNS 记录 */
export async function deleteDnsRecords(creds: Tc3Credentials, zoneId: string, recordIds: string[]): Promise<void> {
  const ids = recordIds.map((id) => asString(id)).filter(Boolean);
  if (ids.length === 0) return;
  await callTeo(creds, 'DeleteDnsRecords', { ZoneId: zoneId, RecordIds: ids });
}

/** 查询单条 EdgeOne DNS 记录 */
export async function getDnsRecord(creds: Tc3Credentials, zoneId: string, recordId: string): Promise<TeoDnsRecord | null> {
  const { records } = await describeDnsRecords(creds, zoneId);
  return records.find((record) => record.recordId === recordId) || null;
}
