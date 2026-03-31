import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type TimelineTone = 'default' | 'info' | 'success' | 'warning' | 'error';
type TimelineCategory = 'status' | 'challenge' | 'log' | 'deployment';

interface TimelineEntry {
  id: string;
  category: TimelineCategory;
  tone: TimelineTone;
  title: string;
  description: string | null;
  timestamp: string | null;
  meta?: Record<string, any> | null;
}

function parseJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function toIso(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function compareTimelineDesc(a: TimelineEntry, b: TimelineEntry) {
  const at = a.timestamp ? new Date(a.timestamp).getTime() : 0;
  const bt = b.timestamp ? new Date(b.timestamp).getTime() : 0;
  return bt - at;
}

function normalizeVendorProvider(value: any) {
  const provider = String(value || '').trim().toLowerCase();
  return provider === 'aliyun_esa_free' ? 'aliyun_ssl' : provider;
}

function prettifyStatus(status?: string | null) {
  switch (String(status || '').trim().toLowerCase()) {
    case 'draft':
      return '草稿';
    case 'queued':
      return '排队中';
    case 'pending_dns':
      return '准备写入 DNS';
    case 'manual_dns_required':
      return '需手动 DNS';
    case 'waiting_dns_propagation':
      return '等待 DNS 生效';
    case 'validating':
      return '验证中';
    case 'issued':
      return '已签发';
    case 'failed':
      return '失败';
    case 'pending_validation':
      return '等待校验';
    case 'issuing':
      return '签发中';
    case 'running':
      return '执行中';
    case 'pending':
      return '待执行';
    case 'success':
      return '成功';
    case 'skipped':
      return '已跳过';
    default:
      return status || '-';
  }
}

function mapOrderStatusSummary(record: any): TimelineEntry {
  const status = String(record.status || '');
  const challengeState = parseJson<any>(record.challengeRecordsJson, null);
  const challengeCount = Array.isArray(challengeState?.challenges) ? challengeState.challenges.length : 0;
  const tone: TimelineTone =
    status === 'issued' ? 'success' :
    status === 'failed' ? 'error' :
    status === 'manual_dns_required' ? 'warning' :
    ['pending_dns', 'waiting_dns_propagation', 'validating', 'queued'].includes(status) ? 'info' :
    'default';

  const title =
    status === 'draft' ? '当前状态：草稿' :
    status === 'queued' ? '当前状态：等待签发队列' :
    status === 'pending_dns' ? '当前状态：准备写入 DNS 验证' :
    status === 'manual_dns_required' ? '当前状态：等待手动 DNS 验证' :
    status === 'waiting_dns_propagation' ? '当前状态：等待 DNS 生效' :
    status === 'validating' ? '当前状态：ACME 验证中' :
    status === 'issued' ? '当前状态：证书已签发' :
    '当前状态：签发失败';

  const description =
    status === 'issued'
      ? (record.expiresAt ? `证书有效期至 ${new Date(record.expiresAt).toLocaleString('zh-CN', { hour12: false })}` : '证书已签发')
      : record.lastError || (challengeCount ? `当前保留 ${challengeCount} 条 challenge 记录` : null);

  return {
    id: `certificate-summary-${record.id}-${status}-${toIso(status === 'issued' ? record.issuedAt || record.updatedAt : record.updatedAt) || 'none'}`,
    category: 'status',
    tone,
    title,
    description,
    timestamp: toIso(status === 'issued' ? record.issuedAt || record.updatedAt : record.updatedAt),
  };
}

function mapVendorStatusSummary(record: any): TimelineEntry {
  const provider = normalizeVendorProvider(record.provider);
  const tone: TimelineTone =
    record.status === 'issued' ? 'success' :
    record.status === 'failed' ? 'error' :
    record.status === 'pending_validation' ? 'info' :
    record.status === 'issuing' ? 'warning' :
    'default';

  const title =
    record.status === 'issued' ? '当前状态：厂商证书已签发' :
    record.status === 'pending_validation' ? '当前状态：等待厂商校验' :
    record.status === 'issuing' ? '当前状态：厂商签发中' :
    record.status === 'failed' ? '当前状态：厂商签发失败' :
    '当前状态：等待厂商处理';

  const payload = parseJson<any>(record.validationPayloadJson, null);
  const dnsRecords = Array.isArray(payload?.dnsRecords) ? payload.dnsRecords.length : 0;
  const providerLabel =
    provider === 'tencent_ssl' ? '腾讯云 SSL' :
    provider === 'aliyun_ssl' ? '阿里云 SSL' :
    provider === 'ucloud_ssl' ? 'UCloud SSL' :
    provider;

  return {
    id: `vendor-summary-${record.id}-${record.status}-${toIso(record.updatedAt) || 'none'}`,
    category: 'status',
    tone,
    title,
    description:
      record.status === 'issued'
        ? (record.expiresAt ? `${providerLabel} 证书有效期至 ${new Date(record.expiresAt).toLocaleString('zh-CN', { hour12: false })}` : `${providerLabel} 证书已签发`)
        : record.lastError || (dnsRecords ? `当前保留 ${dnsRecords} 条 DNS 校验记录` : `${providerLabel} 正在处理订单`),
    timestamp: toIso(record.status === 'issued' ? record.issuedAt || record.updatedAt : record.updatedAt),
  };
}

function mapChallengeSnapshot(record: any): TimelineEntry | null {
  const state = parseJson<any>(record.challengeRecordsJson, null);
  const challenges = Array.isArray(state?.challenges) ? state.challenges : [];
  if (!challenges.length) return null;

  const entries = Array.from(new Set(challenges.map((item: any) => item?.recordName || item?.recordHost || item?.identifier).filter(Boolean)));
  return {
    id: `challenge-${record.id}-${record.updatedAt?.toISOString?.() || toIso(record.updatedAt) || 'none'}`,
    category: 'challenge',
    tone: record.status === 'manual_dns_required' ? 'warning' : 'info',
    title: `DNS Challenge · ${challenges.length} 条`,
    description: entries.slice(0, 4).join(' · ') || null,
    timestamp: toIso(record.updatedAt),
    meta: {
      phase: state?.phase || null,
      workflow: state?.workflow || null,
      challenges,
    },
  };
}

function mapVendorValidationSnapshot(record: any): TimelineEntry | null {
  const payload = parseJson<any>(record.validationPayloadJson, null);
  const dnsRecords = Array.isArray(payload?.dnsRecords) ? payload.dnsRecords : [];
  if (!dnsRecords.length) return null;
  return {
    id: `vendor-validation-${record.id}-${toIso(record.lastSyncAt || record.updatedAt) || 'none'}`,
    category: 'challenge',
    tone: record.status === 'failed' ? 'error' : 'info',
    title: `DNS 校验记录 · ${dnsRecords.length} 条`,
    description: dnsRecords.slice(0, 3).map((item: any) => item?.fqdn || item?.host || item?.value).filter(Boolean).join(' · ') || null,
    timestamp: toIso(record.lastSyncAt || record.updatedAt),
    meta: { dnsRecords },
  };
}

function buildCertificateLogPresentation(recordName: string, status: string, errorMessage?: string | null) {
  if (recordName === 'draft' || recordName === 'queued') {
    return {
      title: '订单已创建',
      description: recordName === 'draft' ? '已保存为草稿' : '已进入签发队列',
    };
  }

  if (recordName === 'autoRenew:on' || recordName === 'autoRenew:off') {
    return {
      title: recordName === 'autoRenew:on' ? '已开启自动续期' : '已关闭自动续期',
      description: null,
    };
  }

  if (recordName.startsWith('issue:retry:')) {
    return {
      title: '已重新提交签发',
      description: `恢复到 ${prettifyStatus(recordName.split(':').pop() || '')} 状态`,
    };
  }

  if (recordName === 'issue:challenge-created') return { title: '已生成 ACME Challenge', description: null };
  if (recordName === 'issue:dns-written') return { title: '已写入 DNS 验证记录', description: null };
  if (recordName === 'issue:dns-ready') return { title: 'DNS 记录已生效，开始验证', description: null };
  if (recordName === 'issue:manual-dns') return { title: '需手动写入 DNS 验证', description: errorMessage || null };
  if (recordName === 'issue:success') return { title: '证书签发成功', description: null };
  if (recordName.startsWith('issue:failed:')) return { title: '证书签发失败', description: errorMessage || recordName };

  if (recordName.startsWith('renew:start:')) {
    const reason = recordName.split(':').pop();
    return {
      title: '自动续期已开始',
      description: reason === 'ari' ? '按 ARI 窗口触发' : '按到期时间窗口触发',
    };
  }

  if (recordName === 'renew:manual-dns') return { title: '自动续期需手动 DNS', description: errorMessage || null };
  if (recordName === 'renew:success') return { title: '自动续期成功', description: null };
  if (recordName.startsWith('renew:failed:')) return { title: '自动续期失败', description: errorMessage || recordName };
  if (recordName.startsWith('manual-renew-expiry:')) return { title: '已发送手动续期到期提醒', description: null };

  return {
    title: status === 'FAILED' ? '证书事件失败' : '证书事件更新',
    description: errorMessage || recordName || null,
  };
}

function buildVendorLogPresentation(recordName: string, status: string, errorMessage?: string | null) {
  if (recordName.startsWith('vendor:retry:')) {
    return { title: '已重新提交厂商证书订单', description: null };
  }

  if (recordName === 'vendor:tencent:apply' || recordName === 'vendor:aliyun:apply' || recordName === 'vendor:ucloud:apply') {
    return {
      title: status === 'FAILED' ? '厂商证书申请失败' : '厂商证书申请已提交',
      description: errorMessage || null,
    };
  }

  if (recordName === 'vendor:tencent:issued' || recordName === 'vendor:aliyun:issued' || recordName === 'vendor:ucloud:issued') {
    return { title: '厂商证书签发成功', description: null };
  }

  if (recordName.endsWith(':failed') || recordName.endsWith(':sync')) {
    return {
      title: status === 'FAILED' ? '厂商证书同步失败' : '厂商证书状态已同步',
      description: errorMessage || null,
    };
  }

  if (recordName.startsWith('vendor:')) {
    return {
      title: '厂商证书订单已创建',
      description: recordName.split(':').slice(1).join(' / ') || null,
    };
  }

  return {
    title: status === 'FAILED' ? '厂商证书事件失败' : '厂商证书事件更新',
    description: errorMessage || recordName || null,
  };
}

function buildDeployLogPresentation(recordName: string, status: string, errorMessage?: string | null) {
  if (recordName.startsWith('job:create:')) {
    return { title: '部署任务已创建', description: recordName.slice('job:create:'.length) || null };
  }
  if (recordName.startsWith('job:update:')) {
    return { title: '部署任务已更新', description: recordName.slice('job:update:'.length) || null };
  }
  if (recordName.startsWith('job:delete:')) {
    return { title: '部署任务已删除', description: recordName.slice('job:delete:'.length) || null };
  }

  const issuedIndex = recordName.lastIndexOf(':certificate.issued');
  if (issuedIndex > 0) {
    return {
      title: status === 'FAILED' ? '首签自动部署失败' : '首签自动部署成功',
      description: errorMessage || recordName.slice(0, issuedIndex) || null,
    };
  }

  const renewIndex = recordName.lastIndexOf(':certificate.renewed');
  if (renewIndex > 0) {
    return {
      title: status === 'FAILED' ? '续签自动部署失败' : '续签自动部署成功',
      description: errorMessage || recordName.slice(0, renewIndex) || null,
    };
  }

  return {
    title: status === 'FAILED' ? '部署事件失败' : '部署事件更新',
    description: errorMessage || recordName || null,
  };
}

function mapCertificateLog(log: any): TimelineEntry {
  const presentation = buildCertificateLogPresentation(String(log.recordName || ''), String(log.status || ''), log.errorMessage || null);
  return {
    id: `log-${log.id}`,
    category: 'log',
    tone: log.status === 'FAILED' ? 'error' : 'success',
    title: presentation.title,
    description: presentation.description,
    timestamp: toIso(log.timestamp),
  };
}

function mapVendorLog(log: any): TimelineEntry {
  const presentation = buildVendorLogPresentation(String(log.recordName || ''), String(log.status || ''), log.errorMessage || null);
  return {
    id: `log-${log.id}`,
    category: 'log',
    tone: log.status === 'FAILED' ? 'error' : 'success',
    title: presentation.title,
    description: presentation.description,
    timestamp: toIso(log.timestamp),
  };
}

function mapDeployLog(log: any): TimelineEntry {
  const presentation = buildDeployLogPresentation(String(log.recordName || ''), String(log.status || ''), log.errorMessage || null);
  return {
    id: `deploy-log-${log.id}`,
    category: 'deployment',
    tone: log.status === 'FAILED' ? 'error' : 'success',
    title: presentation.title,
    description: presentation.description,
    timestamp: toIso(log.timestamp),
  };
}

function mapDeployRun(run: any) {
  return {
    id: run.id,
    event: run.event,
    triggerMode: run.triggerMode,
    status: run.status,
    scheduledAt: toIso(run.scheduledAt),
    startedAt: toIso(run.startedAt),
    finishedAt: toIso(run.finishedAt),
    lastError: run.lastError || null,
    createdAt: toIso(run.createdAt),
    updatedAt: toIso(run.updatedAt),
  };
}

function isRelevantAcmeLog(log: any) {
  const recordName = String(log.recordName || '');
  return !recordName.startsWith('vendor:');
}

function isRelevantVendorLog(log: any) {
  return String(log.recordName || '').startsWith('vendor:');
}

export class CertificateActivityService {
  static async getCertificateTimeline(userId: number, orderId: number) {
    const record = await prisma.certificateOrder.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        status: true,
        primaryDomain: true,
        challengeRecordsJson: true,
        lastError: true,
        issuedAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    });
    if (!record) throw new Error('证书订单不存在');

    const [logs, deployLogs] = await Promise.all([
      prisma.log.findMany({
        where: {
          userId,
          resourceType: 'CERTIFICATE',
          domain: record.primaryDomain,
        },
        orderBy: [{ timestamp: 'desc' }],
        take: 60,
      }),
      prisma.log.findMany({
        where: {
          userId,
          resourceType: 'CERTIFICATE_DEPLOY',
          domain: record.primaryDomain,
        },
        orderBy: [{ timestamp: 'desc' }],
        take: 30,
      }),
    ]);

    const timeline = [
      mapOrderStatusSummary(record),
      mapChallengeSnapshot(record),
      ...logs.filter(isRelevantAcmeLog).map(mapCertificateLog),
      ...deployLogs.map(mapDeployLog),
    ].filter(Boolean as any).sort(compareTimelineDesc);

    return { timeline };
  }

  static async getVendorTimeline(userId: number, orderId: number) {
    const record = await prisma.vendorCertificateOrder.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        provider: true,
        status: true,
        primaryDomain: true,
        validationPayloadJson: true,
        lastSyncAt: true,
        lastError: true,
        issuedAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    });
    if (!record) throw new Error('厂商证书订单不存在');

    const [logs, deployLogs] = await Promise.all([
      prisma.log.findMany({
        where: {
          userId,
          resourceType: 'CERTIFICATE',
          domain: record.primaryDomain,
        },
        orderBy: [{ timestamp: 'desc' }],
        take: 60,
      }),
      prisma.log.findMany({
        where: {
          userId,
          resourceType: 'CERTIFICATE_DEPLOY',
          domain: record.primaryDomain,
        },
        orderBy: [{ timestamp: 'desc' }],
        take: 30,
      }),
    ]);

    const timeline = [
      mapVendorStatusSummary(record),
      mapVendorValidationSnapshot(record),
      ...logs.filter(isRelevantVendorLog).map(mapVendorLog),
      ...deployLogs.map(mapDeployLog),
    ].filter(Boolean as any).sort(compareTimelineDesc);

    return { timeline };
  }

  static async getDeployJobRuns(userId: number, jobId: number) {
    const job = await prisma.certificateDeployJob.findFirst({
      where: {
        id: jobId,
        certificateDeployTarget: { userId },
        OR: [
          { certificateOrder: { userId } },
          { vendorCertificateOrder: { userId } },
        ],
      },
      include: {
        certificateOrder: {
          select: { id: true, primaryDomain: true, status: true, expiresAt: true, autoRenew: true },
        },
        vendorCertificateOrder: {
          select: { id: true, primaryDomain: true, provider: true, status: true, expiresAt: true },
        },
        certificateDeployTarget: {
          select: { id: true, name: true, type: true, enabled: true },
        },
      },
    });
    if (!job) throw new Error('部署任务不存在');

    const primaryDomain = job.certificateOrder?.primaryDomain || job.vendorCertificateOrder?.primaryDomain || '';
    const [runs, rawLogs] = await Promise.all([
      prisma.certificateDeployRun.findMany({
        where: { jobId: job.id },
        orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      primaryDomain
        ? prisma.log.findMany({
            where: {
              userId,
              resourceType: 'CERTIFICATE_DEPLOY',
              domain: primaryDomain,
            },
            orderBy: [{ timestamp: 'desc' }],
            take: 60,
          })
        : Promise.resolve([] as any[]),
    ]);

    const targetName = String(job.certificateDeployTarget.name || '').trim();
    const logs = rawLogs
      .filter((log) => {
        const recordName = String(log.recordName || '');
        return recordName.startsWith('job:') || (!!targetName && recordName.startsWith(`${targetName}:`));
      })
      .map(mapDeployLog);

    return {
      job: {
        id: job.id,
        sourceType: job.certificateOrderId ? 'acme' : 'vendor',
        primaryDomain,
        targetName: job.certificateDeployTarget.name,
        targetType: job.certificateDeployTarget.type,
        lastStatus: job.lastStatus || null,
        lastError: job.lastError || null,
        lastTriggeredAt: toIso(job.lastTriggeredAt),
        lastSucceededAt: toIso(job.lastSucceededAt),
      },
      runs: runs.map(mapDeployRun),
      logs,
    };
  }
}
