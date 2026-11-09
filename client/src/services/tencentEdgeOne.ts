import api from './api';
import type { ApiResponse } from '@/types';

/** DNSPod 自动发现结果（同一把密钥，不需要用户指定凭证） */
export interface DnspodLinkInfo {
  available: boolean;
  credentialId: number | null;
  credentialName: string | null;
  domain: string | null;
  reason?: string;
}

export interface EdgeOneSite {
  zoneId: string;
  zoneName: string;
  aliasZoneName?: string;
  type: string;                // full / dnsPodAccess / pages / partial ...
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
  credentialId: number;
  dnspodLink: DnspodLinkInfo;
}

/** EdgeOne 加速域名（页面真正管理的「域名」） */
export interface EdgeOneDomain {
  domainName: string;          // DNS 值（加速域名）
  domainStatus?: string;       // online / process / offline / init
  cname?: string;              // EdgeOne 分配的 CNAME
  identificationStatus?: string;
  originType?: string;
  origin?: string;             // 回源 IP / 域名
  originProtocol?: string;     // FOLLOW / HTTP / HTTPS
  httpOriginPort?: number;
  httpsOriginPort?: number;
  hostHeader?: string;
  certificateMode?: string;    // disable / eofreecert / sslcert ...
  certificateCount?: number;
  certificateStatus: 'applying' | 'enabled' | 'disabled' | 'unknown';
  createdOn?: string;
  modifiedOn?: string;
  dnspod: {
    linked: boolean;
    status: 'matched' | 'different' | 'missing' | 'unknown';
    recordId?: string;
    currentValue?: string;
  };
}

export interface EdgeOnePlan {
  planId: string;
  planType?: string;
  area?: string;
  status?: string;
}

export interface DnspodSyncResult {
  attempted: boolean;
  action: 'create' | 'update' | 'skip' | 'delete' | 'none';
  recordId?: string;
  error?: string;
  link: DnspodLinkInfo;
}

export interface CreateDomainResult {
  domainName: string;
  cname?: string;
  dnspodSync: DnspodSyncResult;
  certificate?: CertificateState | null;
}

export interface CertificateState {
  status: 'applying' | 'enabled' | 'disabled' | 'unknown';
  mode?: string;
  certificateCount?: number;
  issued?: boolean;
  expireTime?: string;
  reason?: string;
}

export interface CreateSiteResult {
  zoneId: string;
  domain: string;
  nameServers: string[];
  ownershipVerification?: { nsVerification?: { nameServers?: string[] } | null } | null;
}

export const EDGEONE_AREA_OPTIONS = [
  { value: 'mainland', label: '中国大陆', help: '需 ICP 备案' },
  { value: 'overseas', label: '全球（不含中国大陆）', help: '默认' },
  { value: 'global', label: '全球（含中国大陆）', help: '需 ICP 备案' },
] as const;

export const ORIGIN_PROTOCOL_OPTIONS = [
  { value: 'FOLLOW', label: '协议跟随' },
  { value: 'HTTP', label: 'HTTP' },
  { value: 'HTTPS', label: 'HTTPS' },
] as const;

/** 回源 Host 选项：短文案，无字母编号、无括号 */
export const HOST_HEADER_MODE_OPTIONS = [
  { value: 'default', label: '加速域名' },
  { value: 'request', label: '请求 Host' },
  { value: 'origin', label: '回源地址' },
  { value: 'custom', label: '自定义' },
] as const;

export type HostHeaderMode = typeof HOST_HEADER_MODE_OPTIONS[number]['value'];

// ---------- 凭证（复用 /api/dns-credentials，仅连通性校验） ----------
export async function verifyEdgeOneCredential(id: number): Promise<ApiResponse<{ valid: boolean; error?: string }>> {
  return await api.post(`/tencent-edgeone/credentials/${id}/verify`) as unknown as ApiResponse<{ valid: boolean; error?: string }>;
}

// ---------- 套餐 / 站点 ----------
export async function listEdgeOnePlans(credentialId: number): Promise<ApiResponse<{ plans: EdgeOnePlan[] }>> {
  return await api.get('/tencent-edgeone/plans', { params: { credentialId } }) as unknown as ApiResponse<{ plans: EdgeOnePlan[] }>;
}

export async function listEdgeOneSites(params: { credentialId: number; keyword?: string })
  : Promise<ApiResponse<{ sites: EdgeOneSite[]; total: number; credentialId: number }>> {
  return await api.get('/tencent-edgeone/sites', { params }) as unknown as ApiResponse<{ sites: EdgeOneSite[]; total: number; credentialId: number }>;
}

export async function createEdgeOneSite(data: {
  credentialId: number; domain: string; area: string; planId?: string;
}): Promise<ApiResponse<CreateSiteResult>> {
  return await api.post('/tencent-edgeone/sites', data) as unknown as ApiResponse<CreateSiteResult>;
}

export async function verifyEdgeOneSite(zoneId: string, credentialId: number)
  : Promise<ApiResponse<{ status?: string; result?: string; domain: string }>> {
  return await api.post(`/tencent-edgeone/sites/${encodeURIComponent(zoneId)}/verify`, { credentialId }) as unknown as ApiResponse<{ status?: string; result?: string; domain: string }>;
}

export async function deleteEdgeOneSite(zoneId: string, credentialId: number): Promise<ApiResponse<{ deleted: boolean }>> {
  return await api.delete(`/tencent-edgeone/sites/${encodeURIComponent(zoneId)}`, { params: { credentialId } }) as unknown as ApiResponse<{ deleted: boolean }>;
}

// ---------- 加速域名（增删改自动同步 DNSPod） ----------
export async function listEdgeOneDomains(params: { credentialId: number; zoneId: string }): Promise<ApiResponse<{
  domains: EdgeOneDomain[]; total: number; domain: string; dnspodLink: DnspodLinkInfo;
}>> {
  return await api.get(`/tencent-edgeone/sites/${encodeURIComponent(params.zoneId)}/domains`, {
    params: { credentialId: params.credentialId },
  }) as unknown as ApiResponse<{ domains: EdgeOneDomain[]; total: number; domain: string; dnspodLink: DnspodLinkInfo }>;
}

export async function createEdgeOneDomain(data: {
  credentialId: number;
  zoneId: string;
  name: string;                 // DNS 值（@ / www / FQDN）
  origin: string;               // 回源 IP / 域名
  originProtocol: string;       // 回源协议
  httpOriginPort?: number;      // HTTP 回源端口
  httpsOriginPort?: number;     // HTTPS 回源端口
  hostHeaderMode: HostHeaderMode;                 // 回源 Host 模式
  hostHeader?: string;          // custom 模式自定义值
  applyFreeCert: boolean;       // 是否申请免费 SSL 证书
}): Promise<ApiResponse<CreateDomainResult>> {
  const { zoneId, ...body } = data;
  return await api.post(`/tencent-edgeone/sites/${encodeURIComponent(zoneId)}/domains`, body) as unknown as ApiResponse<CreateDomainResult>;
}

export async function deleteEdgeOneDomain(params: {
  credentialId: number; zoneId: string; domainName: string;
}): Promise<ApiResponse<{ deleted: boolean; dnspodSync: DnspodSyncResult }>> {
  return await api.delete(`/tencent-edgeone/sites/${encodeURIComponent(params.zoneId)}/domains/${encodeURIComponent(params.domainName)}`, {
    params: { credentialId: params.credentialId },
  }) as unknown as ApiResponse<{ deleted: boolean; dnspodSync: DnspodSyncResult }>;
}

/** 停用 / 启用加速域名（删除前必须先停用） */
export async function setEdgeOneDomainStatus(params: {
  credentialId: number; zoneId: string; domainName: string; status: 'online' | 'offline'; force?: boolean;
}): Promise<ApiResponse<{ domainName: string; status: string }>> {
  return await api.put(`/tencent-edgeone/sites/${encodeURIComponent(params.zoneId)}/domains/${encodeURIComponent(params.domainName)}/status`, {
    credentialId: params.credentialId, status: params.status, force: params.force,
  }) as unknown as ApiResponse<{ domainName: string; status: string }>;
}

/** 编辑加速域名回源配置 */
export async function updateEdgeOneDomain(data: {
  credentialId: number; zoneId: string; domainName: string;
  origin?: string; originProtocol?: string;
  httpOriginPort?: number; httpsOriginPort?: number; hostHeader?: string;
}): Promise<ApiResponse<{ domainName: string }>> {
  const { zoneId, domainName, ...body } = data;
  return await api.put(`/tencent-edgeone/sites/${encodeURIComponent(zoneId)}/domains/${encodeURIComponent(domainName)}`, body) as unknown as ApiResponse<{ domainName: string }>;
}

/** 为已有加速域名开启/查询免费证书（自动适配站点接入模式） */
export async function enableEdgeOneFreeCertificate(params: {
  credentialId: number; zoneId: string; domainName: string;
}): Promise<ApiResponse<CertificateState>> {
  return await api.post(`/tencent-edgeone/sites/${encodeURIComponent(params.zoneId)}/domains/${encodeURIComponent(params.domainName)}/certificate`, {
    credentialId: params.credentialId,
  }) as unknown as ApiResponse<CertificateState>;
}

/** 全量对齐所有加速域名的 CNAME 到 DNSPod */
export async function getEdgeOneCertificateState(params: {
  credentialId: number; zoneId: string; domainName: string;
}): Promise<ApiResponse<CertificateState>> {
  return await api.get(`/tencent-edgeone/sites/${encodeURIComponent(params.zoneId)}/domains/${encodeURIComponent(params.domainName)}/certificate`, {
    params: { credentialId: params.credentialId },
  }) as unknown as ApiResponse<CertificateState>;
}

export async function syncEdgeOneSite(zoneId: string, credentialId: number): Promise<ApiResponse<{
  total: number; results: Array<{ domainName: string; action: string; error?: string }>; dnspodLink: DnspodLinkInfo;
}>> {
  return await api.post(`/tencent-edgeone/sites/${encodeURIComponent(zoneId)}/sync`, { credentialId }) as unknown as ApiResponse<{
    total: number; results: Array<{ domainName: string; action: string; error?: string }>; dnspodLink: DnspodLinkInfo;
  }>;
}
