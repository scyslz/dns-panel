/**
 * EdgeOne 免费证书申请状态与并发控制
 *
 * 状态源完全以 EdgeOne 的 `DescribeAccelerationDomains[].Certificate.Mode` 为准：
 *   disable → 可申请；eofreecert / sslcert / eofreecert_manual → 已开启（UI 置灰）
 * 因此不需要落库、不需要队列、跨设备一致。
 *
 * 只在内存中按 `userId:zoneId:domain` 加一把短锁，防止用户/前端在申请往返期间重复提交。
 * 进程重启后锁自然消失，但此时 EdgeOne 侧 Mode 要么已变更、要么仍是 disable，重复点击是安全的
 * （ModifyHostsCertificate(eofreecert) 本身幂等）。
 */

import type { Tc3Credentials } from '../providers/dnspod/auth';
import {
  checkFreeCertificateVerification,
  describeAccelerationDomains,
  modifyHostsCertificate,
} from './tencentEdgeOne';

const APPLY_LOCK_TTL_MS = 60_000;
const applyingLocks = new Map<string, { startedAt: number }>();

export type CertificateStatus = 'applying' | 'enabled' | 'disabled' | 'unknown';

export interface CertificateState {
  status: CertificateStatus;
  mode?: string;                 // EdgeOne 原始 Certificate.Mode
  certificateCount?: number;
  issued?: boolean;              // CheckFreeCertificateVerification 是否已签发
  expireTime?: string;
  reason?: string;               // 失败/进行中说明
}

function lockKey(userId: number, zoneId: string, domainName: string) {
  return `${userId}:${zoneId}:${domainName.toLowerCase()}`;
}

function hasActiveLock(key: string): boolean {
  const item = applyingLocks.get(key);
  if (!item) return false;
  if (Date.now() - item.startedAt > APPLY_LOCK_TTL_MS) {
    applyingLocks.delete(key);
    return false;
  }
  return true;
}

/** 查询单个加速域名的证书状态（合并 EdgeOne Mode + 内存锁 + 签发结果） */
export async function getCertificateState(params: {
  userId: number;
  creds: Tc3Credentials;
  zoneId: string;
  domainName: string;
  withVerification?: boolean;
}): Promise<CertificateState> {
  const key = lockKey(params.userId, params.zoneId, params.domainName);
  const { domains } = await describeAccelerationDomains(params.creds, params.zoneId, {
    keyword: params.domainName,
  });
  const domain = domains.find((d) => d.domainName === params.domainName.toLowerCase());
  if (!domain) return { status: 'unknown', reason: '加速域名不存在' };

  const mode = String(domain.certificateMode || 'disable').toLowerCase();
  if (hasActiveLock(key)) {
    return { status: 'applying', mode, certificateCount: domain.certificateCount, reason: '正在申请免费证书，请稍候' };
  }
  if (mode !== 'disable') {
    const state: CertificateState = { status: 'enabled', mode, certificateCount: domain.certificateCount };
    if (params.withVerification) {
      const check = await checkFreeCertificateVerification(params.creds, {
        zoneId: params.zoneId, domainName: params.domainName,
      });
      state.issued = check.issued;
      state.expireTime = check.expireTime;
      if (!check.issued) state.reason = check.error || '证书尚未签发完成';
    }
    return state;
  }
  return { status: 'disabled', mode, certificateCount: domain.certificateCount };
}

/**
 * 开启免费证书（自动验证模式）。同一域名在申请往返期间重复调用会直接返回 applying，不重复调腾讯云。
 * 调用方负责在创建加速域名/CNAME 同步之后再调用。
 */
export async function enableFreeCertificate(params: {
  userId: number;
  creds: Tc3Credentials;
  zoneId: string;
  zoneType: string;
  domainName: string;
}): Promise<CertificateState> {
  const key = lockKey(params.userId, params.zoneId, params.domainName);
  if (hasActiveLock(key)) {
    return { status: 'applying', reason: '正在申请免费证书，请勿重复提交' };
  }

  const current = await getCertificateState({
    userId: params.userId, creds: params.creds, zoneId: params.zoneId, domainName: params.domainName,
  });
  if (current.status === 'enabled') return current;
  if (current.status === 'applying') return current;

  const type = String(params.zoneType || '').toLowerCase();
  // NS / DNSPod 托管接入只支持自动验证模式；其他模式沿用手动申请（由路由层决定是否用）
  if (type !== 'full' && type !== 'dnspodaccess' && type !== 'partial') {
    return { status: 'unknown', reason: `接入类型 ${params.zoneType} 不支持自动验证申请免费证书` };
  }

  applyingLocks.set(key, { startedAt: Date.now() });
  try {
    await modifyHostsCertificate(params.creds, {
      zoneId: params.zoneId,
      hosts: [params.domainName.toLowerCase()],
      mode: 'eofreecert',
    });
  } catch (error: any) {
    applyingLocks.delete(key);
    return {
      status: 'disabled',
      mode: 'disable',
      reason: error?.message || '免费证书申请失败，可重试',
    };
  }

  // 立即回读一次：Mode 变成 eofreecert 说明 EdgeOne 已受理（异步签发）
  const after = await getCertificateState({
    userId: params.userId, creds: params.creds, zoneId: params.zoneId, domainName: params.domainName,
    withVerification: true,
  });
  // 回读时忽略本次自己的锁，直接以 EdgeOne 的 Mode 为准
  if (after.status === 'enabled' || after.status === 'applying') {
    applyingLocks.delete(key);
    if (after.mode && after.mode !== 'disable') {
      return { ...after, status: 'enabled', reason: after.issued ? undefined : (after.reason || '免费证书已开启，EdgeOne 正在签发') };
    }
  }
  return { status: 'applying', mode: 'eofreecert', reason: '申请已提交，EdgeOne 正在自动验证与部署' };
}

/** 供列表批量查询：一次拉全部域名，避免 N+1 次 DescribeAccelerationDomains */
export function decorateCertificateStatuses(
  domains: Array<{ domainName: string; certificateMode?: string; certificateCount?: number }>,
  userId: number,
  zoneId: string,
  locks: Set<string> = applyingLocksSet(),
): Record<string, CertificateStatus> {
  const out: Record<string, CertificateStatus> = {};
  for (const d of domains) {
    const mode = String(d.certificateMode || 'disable').toLowerCase();
    const key = lockKey(userId, zoneId, d.domainName);
    out[d.domainName] = mode !== 'disable' ? 'enabled' : (locks.has(key) ? 'applying' : 'disabled');
  }
  return out;
}

function applyingLocksSet(): Set<string> {
  for (const [key, item] of applyingLocks) {
    if (Date.now() - item.startedAt > APPLY_LOCK_TTL_MS) applyingLocks.delete(key);
  }
  return new Set(applyingLocks.keys());
}
