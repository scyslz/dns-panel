/**
 * 腾讯云 EdgeOne 站点接入路由（无状态，复用现有 /api/dns-credentials 凭证）
 *
 * - 凭证：复用 dns_credentials 表中 provider='edgeone' 的记录
 * - EdgeOne 页只管 EdgeOne 的「加速域名」；真实 DNS 记录在 DNSPod
 * - DNSPod 不要求用户指定：自动用同一把 SecretId/SecretKey 找到对应 DNSPod 凭证
 * - 新增 / 删除加速域名时自动把 CNAME 写入 / 移除 DNSPod，并给列表打「已关联」标
 * - 可选申请 EdgeOne 免费证书（dns_challenge 时验证 TXT 也自动写 DNSPod）
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { decrypt } from '../utils/encryption';
import { successResponse, errorResponse } from '../utils/response';
import { authenticateToken } from '../middleware/auth';
import { createLog } from '../services/logger';
import type { AuthRequest } from '../types';
import type { Tc3Credentials } from '../providers/dnspod/auth';
import {
  TeoError,
  callTeo,
  createAccelerationDomain,
  createDnsRecord,
  createNsZone,
  deleteAccelerationDomains,
  deleteDnsRecords,
  deleteZone,
  describeAccelerationDomains,
  describeDnsRecords,
  describePlans,
  describeZones,
  getDnsRecord,
  modifyAccelerationDomain,
  modifyAccelerationDomainStatuses,
  modifyDnsRecords,
  modifyHostsCertificate,
  normalizeDnsName,
  toTeoRecordFqdn,
  verifyOwnership,
  type TeoDnsRecord,
} from '../services/tencentEdgeOne';
import {
  syncAllEdgeOneRecordsToDnspod,
  syncEdgeOneRecordDeleteToDnspod,
  syncEdgeOneRecordToDnspod,
  type SyncTargetInput,
} from '../services/edgeOneSync';
import {
  removeCnameFromDnspod,
  resolveDnspodLink,
  syncCnameToDnspod,
  withDnspodLinks,
  type DnspodLink,
} from '../services/edgeOneDnspod';
import {
  decorateCertificateStatuses,
  enableFreeCertificate,
  getCertificateState,
} from '../services/edgeOneCertificates';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticateToken);

const EDGEONE_AREA = new Set(['mainland', 'overseas', 'global']);
const RECORD_TYPES = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'CAA', 'SRV']);
const ORIGIN_PROTOCOLS = new Set(['FOLLOW', 'HTTP', 'HTTPS']);
const HOST_HEADER_MODES = new Set(['default', 'request', 'origin', 'custom']);

function parseId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}
function bodyOrQuery(req: any, key: string): unknown { return req.body?.[key] ?? req.query?.[key]; }
function asString(value: unknown): string { return value === undefined || value === null ? '' : String(value).trim(); }
function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function asBool(value: unknown): boolean { return value === true || value === 'true' || value === 1 || value === '1'; }

function fail(res: any, error: any, fallback: string) {
  const status = error instanceof TeoError ? error.httpStatus : (typeof error?.httpStatus === 'number' ? error.httpStatus : 400);
  return errorResponse(res, error?.message || fallback, status, error);
}

async function logAction(params: {
  userId: number; action: 'CREATE' | 'UPDATE' | 'DELETE'; domain?: string; recordName?: string; recordType?: string;
  status: 'SUCCESS' | 'FAILED'; ipAddress?: string; newValue?: string; oldValue?: string; errorMessage?: string;
}) {
  await createLog({ ...params, resourceType: 'CERTIFICATE_DEPLOY' as any, errorMessage: params.errorMessage });
}

/** 从现有 dns_credentials 表解析 EdgeOne 凭证 */
async function resolveEdgeOneCredential(userId: number, credentialId?: number): Promise<{
  id: number; name: string; creds: Tc3Credentials;
}> {
  const credential = credentialId
    ? await prisma.dnsCredential.findFirst({ where: { id: credentialId, userId } })
    : await prisma.dnsCredential.findFirst({ where: { userId, provider: 'edgeone', isDefault: true }, orderBy: { createdAt: 'asc' } })
      ?? await prisma.dnsCredential.findFirst({ where: { userId, provider: 'edgeone' }, orderBy: { createdAt: 'asc' } });

  if (!credential) throw Object.assign(new Error('未找到 EdgeOne 凭证，请先在「设置 → DNS 账户管理」添加 EdgeOne 凭证'), { httpStatus: 404 });
  if (String(credential.provider) !== 'edgeone') throw Object.assign(new Error('该凭证不是 EdgeOne 凭证'), { httpStatus: 400 });

  let secrets: any;
  try { secrets = JSON.parse(decrypt(credential.secrets)); }
  catch { throw Object.assign(new Error('EdgeOne 凭证密钥解析失败'), { httpStatus: 500 }); }

  const secretId = asString(secrets?.secretId);
  const secretKey = asString(secrets?.secretKey);
  const token = asString(secrets?.token || secrets?.sessionToken);
  if (!secretId || !secretKey) throw Object.assign(new Error('缺少腾讯云 SecretId / SecretKey'), { httpStatus: 400 });
  return { id: credential.id, name: credential.name, creds: { secretId, secretKey, ...(token ? { token } : {}) } };
}

async function resolveSite(zoneId: string, creds: Tc3Credentials) {
  const { zones } = await describeZones(creds, { zoneId, maxPages: 5 });
  const zone = zones.find((item) => item.zoneId === zoneId);
  if (!zone) throw Object.assign(new Error('站点不存在或不属于该 EdgeOne 凭证'), { httpStatus: 404 });
  return { zone, domain: normalizeDnsName(zone.zoneName) };
}

async function resolveSyncTarget(userId: number, req: any, siteDomain: string): Promise<SyncTargetInput | null> {
  const credentialId = parseId(bodyOrQuery(req, 'dnspodCredentialId'));
  if (!credentialId) return null;
  const credential = await prisma.dnsCredential.findFirst({ where: { id: credentialId, userId } });
  if (!credential || !['dnspod', 'dnspod_token'].includes(String(credential.provider))) {
    throw Object.assign(new Error('同步目标凭证不存在或不是腾讯云 DNSPod 账户'), { httpStatus: 400 });
  }
  return { dnspodCredentialId: credentialId, dnspodDomain: normalizeDnsName(bodyOrQuery(req, 'dnspodDomain') || siteDomain) || siteDomain };
}

function linkSummary(link: DnspodLink) {
  return { available: link.available, credentialId: link.credentialId, credentialName: link.credentialName, domain: link.domain, reason: link.reason };
}

// ============ 凭证（复用 /api/dns-credentials） ============
router.post('/credentials/:id/verify', async (req: AuthRequest, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return errorResponse(res, '无效的凭证 ID', 400);
    const { creds } = await resolveEdgeOneCredential(req.user!.id, id);
    await callTeo(creds, 'DescribeZones', { Offset: 0, Limit: 1 });
    return successResponse(res, { valid: true }, 'EdgeOne 凭证验证成功');
  } catch (error: any) {
    return successResponse(res, { valid: false, error: error?.message || '凭证验证失败' }, 'EdgeOne 凭证验证失败');
  }
});

// ============ 套餐 / 站点 ============
router.get('/plans', async (req: AuthRequest, res) => {
  try {
    const { creds } = await resolveEdgeOneCredential(req.user!.id, parseId(req.query.credentialId));
    return successResponse(res, { plans: await describePlans(creds) }, '获取 EdgeOne 套餐成功');
  } catch (error: any) { return fail(res, error, '获取 EdgeOne 套餐失败'); }
});

/** 站点列表：附带 DNSPod 自动发现结果（只打标，不要求用户指定） */
router.get('/sites', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { id: credentialId, creds } = await resolveEdgeOneCredential(userId, parseId(req.query.credentialId));
    const { zones, total } = await describeZones(creds, { keyword: asString(req.query.keyword) || undefined });

    const sites = [];
    for (const zone of zones) {
      let link: DnspodLink = { available: false, credentialId: null, credentialName: null, domain: null, reason: '暂未检测' };
      if (zone.type === 'dnsPodAccess' || zone.type === 'full') {
        try { link = await resolveDnspodLink(userId, creds, zone.zoneName); }
        catch (e: any) { link.reason = e?.message || '检测失败'; }
      }
      sites.push({ ...zone, credentialId, dnspodLink: linkSummary(link) });
    }
    return successResponse(res, { sites, total, credentialId }, '获取 EdgeOne 站点列表成功');
  } catch (error: any) { return fail(res, error, '获取 EdgeOne 站点列表失败'); }
});

router.get('/dnspod-targets', async (req: AuthRequest, res) => {
  try {
    const credentials = await prisma.dnsCredential.findMany({
      where: { userId: req.user!.id, provider: { in: ['dnspod', 'dnspod_token'] } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, provider: true, isDefault: true },
    });
    return successResponse(res, { credentials }, '获取 DNSPod 凭证成功');
  } catch (error: any) { return fail(res, error, '获取 DNSPod 凭证失败'); }
});

/** 创建 NS 接入站点 */
router.post('/sites', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const body = req.body || {};
  try {
    const domain = normalizeDnsName(body.domain || body.zoneName);
    const area = asString(body.area) || 'overseas';
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) return errorResponse(res, '请输入正确的域名（如 example.com）', 400);
    if (!EDGEONE_AREA.has(area)) return errorResponse(res, '加速区域只能是 mainland / overseas / global', 400);

    const { id: credentialId, creds } = await resolveEdgeOneCredential(userId, parseId(body.credentialId));
    const existed = await describeZones(creds, { keyword: domain });
    const duplicate = existed.zones.find((zone) => zone.zoneName === domain && zone.type === 'full');
    if (duplicate) return errorResponse(res, `该 EdgeOne 凭证下已存在站点 ${domain}（${duplicate.zoneId}）`, 409);

    const created = await createNsZone(creds, {
      domain, area, planId: asString(body.planId) || undefined, aliasZoneName: asString(body.aliasZoneName) || undefined,
    });
    await logAction({ userId, action: 'CREATE', domain, status: 'SUCCESS', ipAddress: req.ip, newValue: JSON.stringify({ zoneId: created.zoneId, area }) });
    return successResponse(res, { zoneId: created.zoneId, domain, nameServers: created.nameServers, ownershipVerification: created.ownershipVerification }, 'EdgeOne 站点创建成功', 201);
  } catch (error: any) {
    await logAction({ userId, action: 'CREATE', domain: asString(body.domain), status: 'FAILED', ipAddress: req.ip, errorMessage: error?.message });
    return fail(res, error, 'EdgeOne 站点创建失败');
  }
});

router.post('/sites/:zoneId/verify', async (req: AuthRequest, res) => {
  try {
    const { creds } = await resolveEdgeOneCredential(req.user!.id, parseId(bodyOrQuery(req, 'credentialId')));
    const site = await resolveSite(asString(req.params.zoneId), creds);
    return successResponse(res, { ...await verifyOwnership(creds, site.domain), domain: site.domain }, '站点归属权查询成功');
  } catch (error: any) { return fail(res, error, '站点归属权查询失败'); }
});

router.delete('/sites/:zoneId', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const zoneId = asString(req.params.zoneId);
  try {
    const { creds } = await resolveEdgeOneCredential(userId, parseId(req.query.credentialId));
    const site = await resolveSite(zoneId, creds);
    await deleteZone(creds, zoneId);
    await logAction({ userId, action: 'DELETE', domain: site.domain, status: 'SUCCESS', ipAddress: req.ip, oldValue: JSON.stringify({ zoneId }) });
    return successResponse(res, { deleted: true }, 'EdgeOne 站点删除成功');
  } catch (error: any) { return fail(res, error, 'EdgeOne 站点删除失败'); }
});

// ============ 加速域名（EdgeOne 真正管理的「域名」） ============

/** GET /sites/:zoneId/domains —— 列加速域名 + DNSPod 关联标记 */
router.get('/sites/:zoneId/domains', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const zoneId = asString(req.params.zoneId);
    const { creds } = await resolveEdgeOneCredential(userId, parseId(req.query.credentialId));
    const site = await resolveSite(zoneId, creds);
    const { domains, total } = await describeAccelerationDomains(creds, zoneId, { keyword: asString(req.query.keyword) || undefined });
    const linked = await withDnspodLinks(userId, creds, site.domain, domains);
    const certStatuses = decorateCertificateStatuses(linked.domains, userId, zoneId);
    const resultDomains = linked.domains.map((d) => ({ ...d, certificateStatus: certStatuses[d.domainName] || 'disabled' }));
    return successResponse(res, { domains: resultDomains, total, domain: site.domain, dnspodLink: linkSummary(linked.link) }, '获取 EdgeOne 加速域名成功');
  } catch (error: any) { return fail(res, error, '获取 EdgeOne 加速域名失败'); }
});

/** POST /sites/:zoneId/domains —— 新增加速域名，自动写 CNAME 到 DNSPod，可选申请免费证书 */
router.post('/sites/:zoneId/domains', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const zoneId = asString(req.params.zoneId);
  const body = req.body || {};
  try {
    const { creds } = await resolveEdgeOneCredential(userId, parseId(body.credentialId));
    const site = await resolveSite(zoneId, creds);

    // dns 值：加速域名（可填 @ / www / FQDN）
    const domainName = toTeoRecordFqdn(asString(body.name || body.domainName || body.dnsValue), site.domain);
    const origin = asString(body.origin);                                  // 回源 IP / 域名
    const originProtocol = (asString(body.originProtocol).toUpperCase() || 'FOLLOW');
    const httpOriginPort = asNumber(body.httpOriginPort);
    const httpsOriginPort = asNumber(body.httpsOriginPort);
    const hostHeaderMode = asString(body.hostHeaderMode) || 'default';     // 默认 / 跟随请求 / 回源地址 / 自定义
    const hostHeader = asString(body.hostHeader);                            // c 模式自定义值
    const applyFreeCert = asBool(body.applyFreeCert);

    if (!origin) return errorResponse(res, '回源 IP / 域名不能为空', 400);
    if (!ORIGIN_PROTOCOLS.has(originProtocol)) return errorResponse(res, '回源协议只能是 FOLLOW / HTTP / HTTPS', 400);
    if (!HOST_HEADER_MODES.has(hostHeaderMode)) return errorResponse(res, '回源 Host 模式只能是 default / request / origin / custom', 400);
    if (hostHeaderMode === 'custom' && !hostHeader) return errorResponse(res, '自定义回源 Host 不能为空', 400);
    for (const [label, port] of [['HTTP 回源端口', httpOriginPort], ['HTTPS 回源端口', httpsOriginPort]] as const) {
      if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        return errorResponse(res, `${label} 取值范围为 1 ~ 65535`, 400);
      }
    }

    const created = await createAccelerationDomain(creds, zoneId, {
      domainName, origin, originProtocol, httpOriginPort, httpsOriginPort,
      hostHeaderMode: hostHeaderMode as 'default' | 'request' | 'origin' | 'custom', hostHeader,
    });

    // 用同一把密钥自动写入 DNSPod（无需指定凭证）
    const cnameSync = await syncCnameToDnspod({
      userId, edgeOneCreds: creds, siteDomain: site.domain,
      domain: { domainName, cname: created.cname, domainStatus: 'process' },
    });

    // 可选：免费证书。状态以 EdgeOne 的 Certificate.Mode 为准，带内存锁防止重复提交
    let certificate: any = null;
    if (applyFreeCert) {
      certificate = await enableFreeCertificate({
        userId, creds, zoneId, zoneType: site.zone.type, domainName,
      });
    }

    await logAction({
      userId, action: 'CREATE', domain: site.domain, recordName: domainName, recordType: 'CNAME',
      status: 'SUCCESS', ipAddress: req.ip,
      newValue: JSON.stringify({ origin, originProtocol, httpOriginPort, httpsOriginPort, hostHeader, cname: created.cname, cnameSync, certificate }),
    });

    return successResponse(res, {
      domainName, cname: created.cname, dnspodSync: cnameSync, certificate,
    }, '加速域名创建成功', 201);
  } catch (error: any) { return fail(res, error, '加速域名创建失败'); }
});

/** POST /sites/:zoneId/domains/:domainName/certificate —— 开启免费证书（带并发锁，支持失败重试） */
router.post('/sites/:zoneId/domains/:domainName/certificate', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const zoneId = asString(req.params.zoneId);
  const domainName = normalizeDnsName(req.params.domainName);
  try {
    const { creds } = await resolveEdgeOneCredential(userId, parseId(bodyOrQuery(req, 'credentialId')));
    const site = await resolveSite(zoneId, creds);
    const result = await enableFreeCertificate({ userId, creds, zoneId, zoneType: site.zone.type, domainName });
    await logAction({
      userId, action: 'UPDATE', domain: site.domain, recordName: domainName,
      status: result.status === 'disabled' ? 'FAILED' : 'SUCCESS', ipAddress: req.ip,
      newValue: JSON.stringify(result), errorMessage: result.status === 'disabled' ? result.reason : undefined,
    });
    if (result.status === 'disabled') {
      return errorResponse(res, result.reason || '免费证书申请失败，可重试', 400, result);
    }
    return successResponse(res, result, result.status === 'applying' ? '免费证书申请已提交' : '免费证书已开启');
  } catch (error: any) { return fail(res, error, '免费证书配置失败'); }
});

/** GET /sites/:zoneId/domains/:domainName/certificate —— 查询证书状态（Mode + 内存锁 + 签发结果） */
router.get('/sites/:zoneId/domains/:domainName/certificate', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const zoneId = asString(req.params.zoneId);
    const { creds } = await resolveEdgeOneCredential(userId, parseId(req.query.credentialId));
    const result = await getCertificateState({
      userId, creds, zoneId, domainName: normalizeDnsName(req.params.domainName), withVerification: true,
    });
    return successResponse(res, result, '免费证书状态查询成功');
  } catch (error: any) { return fail(res, error, '免费证书状态查询失败'); }
});

/** PUT /sites/:zoneId/domains/:domainName/status —— 停用 / 启用加速域名 */
router.put('/sites/:zoneId/domains/:domainName/status', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const zoneId = asString(req.params.zoneId);
  const domainName = normalizeDnsName(req.params.domainName);
  const body = req.body || {};
  try {
    const status = asString(body.status).toLowerCase();
    if (status !== 'online' && status !== 'offline') {
      return errorResponse(res, '状态只能是 online（启用）或 offline（停用）', 400);
    }
    const { creds } = await resolveEdgeOneCredential(userId, parseId(body.credentialId));
    const site = await resolveSite(zoneId, creds);
    const { domains } = await describeAccelerationDomains(creds, zoneId, { keyword: domainName });
    if (!domains.some((d) => d.domainName === domainName)) return errorResponse(res, '加速域名不存在', 404);

    await modifyAccelerationDomainStatuses(creds, {
      zoneId, domainNames: [domainName], status, force: asBool(body.force),
    });
    await logAction({
      userId, action: 'UPDATE', domain: site.domain, recordName: domainName,
      status: 'SUCCESS', ipAddress: req.ip, newValue: JSON.stringify({ status }),
    });
    return successResponse(res, { domainName, status }, status === 'online' ? '加速域名已启用' : '加速域名已停用');
  } catch (error: any) { return fail(res, error, '状态变更失败'); }
});

/** PUT /sites/:zoneId/domains/:domainName —— 编辑加速域名回源配置 */
router.put('/sites/:zoneId/domains/:domainName', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const zoneId = asString(req.params.zoneId);
  const domainName = normalizeDnsName(req.params.domainName);
  const body = req.body || {};
  try {
    const { creds } = await resolveEdgeOneCredential(userId, parseId(body.credentialId));
    const site = await resolveSite(zoneId, creds);
    const { domains } = await describeAccelerationDomains(creds, zoneId, { keyword: domainName });
    if (!domains.some((d) => d.domainName === domainName)) return errorResponse(res, '加速域名不存在', 404);

    const origin = body.origin !== undefined ? asString(body.origin) : undefined;
    if (origin !== undefined && !origin) return errorResponse(res, '回源 IP / 域名不能为空', 400);
    const originProtocol = body.originProtocol !== undefined ? asString(body.originProtocol).toUpperCase() : undefined;
    if (originProtocol !== undefined && !ORIGIN_PROTOCOLS.has(originProtocol)) {
      return errorResponse(res, '回源协议只能是 FOLLOW / HTTP / HTTPS', 400);
    }
    const httpOriginPort = asNumber(body.httpOriginPort);
    const httpsOriginPort = asNumber(body.httpsOriginPort);
    for (const [label, port] of [['HTTP 回源端口', httpOriginPort], ['HTTPS 回源端口', httpsOriginPort]] as const) {
      if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        return errorResponse(res, `${label} 取值范围为 1 ~ 65535`, 400);
      }
    }

    await modifyAccelerationDomain(creds, zoneId, {
      domainName, origin, originProtocol, httpOriginPort, httpsOriginPort,
      hostHeader: body.hostHeader !== undefined ? asString(body.hostHeader) : undefined,
    });
    await logAction({
      userId, action: 'UPDATE', domain: site.domain, recordName: domainName,
      status: 'SUCCESS', ipAddress: req.ip,
      newValue: JSON.stringify({ origin, originProtocol, httpOriginPort, httpsOriginPort, hostHeader: body.hostHeader }),
    });
    return successResponse(res, { domainName }, '加速域名已更新');
  } catch (error: any) { return fail(res, error, '加速域名更新失败'); }
});

/** DELETE /sites/:zoneId/domains/:domainName —— 必须先停用才能删除 */
router.delete('/sites/:zoneId/domains/:domainName', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const zoneId = asString(req.params.zoneId);
  const domainName = normalizeDnsName(req.params.domainName);
  try {
    const { creds } = await resolveEdgeOneCredential(userId, parseId(req.query.credentialId));
    const site = await resolveSite(zoneId, creds);
    const { domains } = await describeAccelerationDomains(creds, zoneId, { keyword: domainName });
    const target = domains.find((d) => d.domainName === domainName);
    if (!target) return errorResponse(res, '加速域名不存在', 404);

    // EdgeOne 不允许直接删除正在使用的域名：必须先停用（offline）
    const status = String(target.domainStatus || '').toLowerCase();
    if (status !== 'offline' && status !== 'init') {
      return errorResponse(res, `该加速域名当前为「${target.domainStatus || '未知'}」，请先点击「停用」后再删除`, 409);
    }

    await deleteAccelerationDomains(creds, zoneId, [domainName]);
    const dnspodSync = await removeCnameFromDnspod({ userId, edgeOneCreds: creds, siteDomain: site.domain, domain: target });
    await logAction({
      userId, action: 'DELETE', domain: site.domain, recordName: domainName, recordType: 'CNAME',
      status: 'SUCCESS', ipAddress: req.ip, oldValue: JSON.stringify({ cname: target.cname }),
      newValue: JSON.stringify({ dnspodSync }),
    });
    return successResponse(res, { deleted: true, dnspodSync }, '加速域名删除成功');
  } catch (error: any) { return fail(res, error, '加速域名删除失败'); }
});

/** POST /sites/:zoneId/sync —— 全量对齐所有加速域名的 CNAME 到 DNSPod */
router.post('/sites/:zoneId/sync', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const zoneId = asString(req.params.zoneId);
  try {
    const { creds } = await resolveEdgeOneCredential(userId, parseId(bodyOrQuery(req, 'credentialId')));
    const site = await resolveSite(zoneId, creds);
    const link = await resolveDnspodLink(userId, creds, site.domain);
    if (!link.available) return errorResponse(res, `未找到可用的 DNSPod 关联：${link.reason || ''}`, 400);

    const { domains } = await describeAccelerationDomains(creds, zoneId);
    const results: any[] = [];
    for (const d of domains) {
      const r = await syncCnameToDnspod({ userId, edgeOneCreds: creds, siteDomain: site.domain, domain: d });
      results.push({ domainName: d.domainName, action: r.action, error: r.error });
    }
    const errors = results.filter((r) => r.error);
    await logAction({
      userId, action: 'UPDATE', domain: site.domain, status: errors.length ? 'FAILED' : 'SUCCESS', ipAddress: req.ip,
      newValue: JSON.stringify({ total: results.length, results }),
      errorMessage: errors.length ? errors.map((e) => `${e.domainName}: ${e.error}`).join('; ') : undefined,
    });
    return successResponse(res, { total: results.length, results, dnspodLink: linkSummary(link) }, '全量同步完成');
  } catch (error: any) { return fail(res, error, '全量同步失败'); }
});

// ============ 兼容：NS 站点的 EdgeOne DNS 记录（dnsPodAccess 站点不适用，前端不再调用） ============
router.get('/sites/:zoneId/records', async (req: AuthRequest, res) => {
  try {
    const { creds } = await resolveEdgeOneCredential(req.user!.id, parseId(req.query.credentialId));
    const site = await resolveSite(asString(req.params.zoneId), creds);
    const { records, total } = await describeDnsRecords(creds, site.zone.zoneId, {
      name: asString(req.query.name) || undefined, type: asString(req.query.type).toUpperCase() || undefined,
    });
    return successResponse(res, { records, total, domain: site.domain }, '获取 EdgeOne 解析记录成功');
  } catch (error: any) { return fail(res, error, '获取 EdgeOne 解析记录失败'); }
});

function syncSummary(result: any) { return !result?.attempted ? null : { ...result, ok: !result.errors?.length }; }

router.post('/sites/:zoneId/records', async (req: AuthRequest, res) => {
  const userId = req.user!.id; const zoneId = asString(req.params.zoneId); const body = req.body || {};
  try {
    const { creds } = await resolveEdgeOneCredential(userId, parseId(body.credentialId));
    const site = await resolveSite(zoneId, creds);
    const target = await resolveSyncTarget(userId, req, site.domain);
    const type = asString(body.type).toUpperCase();
    if (!RECORD_TYPES.has(type)) return errorResponse(res, `不支持的记录类型：${type}`, 400);
    const content = asString(body.content ?? body.value);
    if (!content) return errorResponse(res, '记录值不能为空', 400);
    const name = toTeoRecordFqdn(asString(body.name), site.domain);
    const ttl = asNumber(body.ttl);
    const priority = asNumber(body.priority);
    const recordId = await createDnsRecord(creds, zoneId, { name, type, content, ttl, priority });
    const record: TeoDnsRecord = await getDnsRecord(creds, zoneId, recordId) || { recordId, name, type, content, ttl, priority } as TeoDnsRecord;
    const sync = await syncEdgeOneRecordToDnspod({ userId, siteDomain: site.domain, record, target });
    return successResponse(res, { recordId, record, sync: syncSummary(sync) }, '解析记录创建成功', 201);
  } catch (error: any) { return fail(res, error, '解析记录创建失败'); }
});

router.put('/sites/:zoneId/records/:recordId', async (req: AuthRequest, res) => {
  const userId = req.user!.id; const zoneId = asString(req.params.zoneId); const recordId = asString(req.params.recordId); const body = req.body || {};
  try {
    const { creds } = await resolveEdgeOneCredential(userId, parseId(body.credentialId));
    const site = await resolveSite(zoneId, creds);
    const target = await resolveSyncTarget(userId, req, site.domain);
    const before = await getDnsRecord(creds, zoneId, recordId);
    if (!before) return errorResponse(res, '解析记录不存在', 404);
    const type = asString(body.type).toUpperCase() || before.type.toUpperCase();
    const content = body.content !== undefined ? asString(body.content ?? body.value) : before.content;
    const name = body.name !== undefined ? toTeoRecordFqdn(asString(body.name), site.domain) : before.name;
    const ttl = body.ttl !== undefined ? asNumber(body.ttl) : before.ttl;
    const priority = body.priority !== undefined ? asNumber(body.priority) : (type === 'MX' ? before.priority : undefined);
    await modifyDnsRecords(creds, zoneId, [{ recordId, name, type, content, ttl, priority }]);
    const after: TeoDnsRecord = await getDnsRecord(creds, zoneId, recordId) || { ...before, name, type, content, ttl, priority } as TeoDnsRecord;
    const sync = await syncEdgeOneRecordToDnspod({ userId, siteDomain: site.domain, record: after, target });
    return successResponse(res, { record: after, sync: syncSummary(sync) }, '解析记录更新成功');
  } catch (error: any) { return fail(res, error, '解析记录更新失败'); }
});

router.delete('/sites/:zoneId/records/:recordId', async (req: AuthRequest, res) => {
  const userId = req.user!.id; const zoneId = asString(req.params.zoneId); const recordId = asString(req.params.recordId);
  try {
    const { creds } = await resolveEdgeOneCredential(userId, parseId(req.query.credentialId));
    const site = await resolveSite(zoneId, creds);
    const target = await resolveSyncTarget(userId, req, site.domain);
    const before = await getDnsRecord(creds, zoneId, recordId);
    if (!before) return errorResponse(res, '解析记录不存在', 404);
    await deleteDnsRecords(creds, zoneId, [recordId]);
    const sync = await syncEdgeOneRecordDeleteToDnspod({ userId, siteDomain: site.domain, record: before, target });
    return successResponse(res, { deleted: true, sync: syncSummary(sync) }, '解析记录删除成功');
  } catch (error: any) { return fail(res, error, '解析记录删除失败'); }
});

export default router;
