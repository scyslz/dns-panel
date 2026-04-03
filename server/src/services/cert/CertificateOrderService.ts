import { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';
import { encrypt, decrypt } from '../../utils/encryption';
import { createLog } from '../logger';
import { AcmeProviderType, CertificateStatus } from '../../types';
import { AcmeService, CertificateChallengeState, CertificateCredentialSecretsInput, CertificateOrderState } from './AcmeService';
import { CertificateDnsService } from './CertificateDnsService';
import { CertificateCnameAliasService } from './CertificateCnameAliasService';
import { config } from '../../config';
import { CertificateDeployService } from './CertificateDeployService';
import { CertificateNotificationService } from './CertificateNotificationService';

const prisma = new PrismaClient();
const WAIT_BACKOFF_MS = [30000, 60000, 120000, 300000, 600000];
const MAX_WAIT_RETRIES = 10;

interface CertificateOrderPayload {
  mode: 'draft' | 'apply';
  certificateCredentialId: number;
  dnsCredentialId: number;
  domains: string[];
  autoRenew?: boolean;
}

function normalizeDomains(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of Array.isArray(input) ? input : []) {
    let domain = String(item || '').trim().toLowerCase();
    if (!domain) continue;
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    const wildcard = domain.startsWith('*.') ? '*.' : '';
    const body = wildcard ? domain.slice(2) : domain;
    const normalized = `${wildcard}${body}`;
    if (!body || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function serializeChallenges(orderState: CertificateOrderState | null): string | null {
  return orderState ? JSON.stringify(orderState) : null;
}

function nextRetryDate(retryCount: number): Date {
  const ms = WAIT_BACKOFF_MS[Math.min(retryCount, WAIT_BACKOFF_MS.length - 1)] || WAIT_BACKOFF_MS[WAIT_BACKOFF_MS.length - 1];
  return new Date(Date.now() + ms);
}

function isInvalidAcmeAccountUrlError(message: string): boolean {
  const msg = String(message || '').toLowerCase();
  return msg.includes('invalid account url');
}

function mapOrderRecord(record: any) {
  const domains = parseJson<string[]>(record.domainsJson, []);
  const challengeState = parseJson<CertificateOrderState | null>(record.challengeRecordsJson, null);
  return {
    id: record.id,
    primaryDomain: record.primaryDomain,
    domains,
    status: record.status,
    challengeRecords: challengeState?.challenges || [],
    autoRenew: record.autoRenew,
    retryCount: record.retryCount,
    nextRetryAt: record.nextRetryAt,
    lastError: record.lastError,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deployJobsCount: Number(record?._count?.deployJobs || 0),
    certificateCredential: record.certificateCredential ? {
      id: record.certificateCredential.id,
      name: record.certificateCredential.name,
      provider: record.certificateCredential.provider,
      email: record.certificateCredential.email,
      isDefault: record.certificateCredential.isDefault,
    } : undefined,
    dnsCredential: record.dnsCredential ? {
      id: record.dnsCredential.id,
      name: record.dnsCredential.name,
      provider: record.dnsCredential.provider,
      isDefault: record.dnsCredential.isDefault,
    } : undefined,
    canRetry: record.status !== 'issued',
    canDownload: record.status === 'issued',
  };
}

async function getOrderForUser(userId: number, orderId: number) {
  const record = await prisma.certificateOrder.findFirst({
    where: { id: orderId, userId },
    include: {
      certificateCredential: true,
      dnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
      _count: { select: { deployJobs: true } },
    },
  });
  if (!record) throw new Error('证书订单不存在');
  return record;
}

async function getCredentialSecrets(credentialId: number, userId: number) {
  const credential = await prisma.certificateCredential.findFirst({ where: { id: credentialId, userId } });
  if (!credential) throw new Error('证书账户不存在');
  return {
    id: credential.id,
    name: credential.name,
    provider: credential.provider as AcmeProviderType,
    email: credential.email,
    directoryUrl: credential.directoryUrl,
    eabKid: credential.eabKid,
    eabHmacKey: credential.eabHmacKey ? decrypt(credential.eabHmacKey) : null,
    accountKeyPem: decrypt(credential.accountKeyPem),
    accountUrl: credential.accountUrl,
  };
}

async function notifyIssueFailure(userId: number, primaryDomain: string, domains: string[], provider: string, error: string) {
  await CertificateNotificationService.notifyCertificateFailed(userId, {
    primaryDomain,
    domains,
    provider,
    error,
  }).catch(() => undefined);
}

async function notifyIssueSuccess(userId: number, primaryDomain: string, domains: string[], provider: string, issuedAt?: Date | string | null, expiresAt?: Date | string | null) {
  await CertificateNotificationService.notifyCertificateIssued(userId, {
    primaryDomain,
    domains,
    provider,
    issuedAt,
    expiresAt,
  }).catch(() => undefined);
}

async function createOrderLog(userId: number, domain: string, recordName: string, status: 'SUCCESS' | 'FAILED', errorMessage?: string) {
  await createLog({
    userId,
    action: 'UPDATE',
    resourceType: 'CERTIFICATE',
    domain,
    recordName,
    status,
    errorMessage,
  });
}

export class CertificateOrderService {
  static async createOrder(userId: number, payload: CertificateOrderPayload) {
    const mode = payload.mode === 'draft' ? 'draft' : 'apply';
    const domains = normalizeDomains(payload.domains);
    if (domains.length === 0) throw new Error('至少填写一个域名');

    const [certificateCredential, dnsCredential] = await Promise.all([
      prisma.certificateCredential.findFirst({ where: { id: payload.certificateCredentialId, userId } }),
      prisma.dnsCredential.findFirst({ where: { id: payload.dnsCredentialId, userId } }),
    ]);
    if (!certificateCredential) throw new Error('证书账户不存在');
    if (!dnsCredential) throw new Error('DNS 凭证不存在');

    const created = await prisma.certificateOrder.create({
      data: {
        userId,
        certificateCredentialId: certificateCredential.id,
        dnsCredentialId: dnsCredential.id,
        primaryDomain: domains[0],
        domainsJson: JSON.stringify(domains),
        status: mode === 'draft' ? 'draft' : 'queued',
        autoRenew: payload.autoRenew !== false,
        nextRetryAt: mode === 'draft' ? null : new Date(),
      },
      include: {
        certificateCredential: true,
        dnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
        _count: { select: { deployJobs: true } },
      },
    });

    await createLog({
      userId,
      action: 'CREATE',
      resourceType: 'CERTIFICATE',
      domain: created.primaryDomain,
      recordName: created.status,
      status: 'SUCCESS',
    });

    return mapOrderRecord(created);
  }

  static async listOrders(userId: number) {
    const orders = await prisma.certificateOrder.findMany({
      where: { userId },
      include: {
        certificateCredential: true,
        dnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
        _count: { select: { deployJobs: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return orders.map(mapOrderRecord);
  }

  static async getOrder(userId: number, orderId: number) {
    const record = await getOrderForUser(userId, orderId);
    return mapOrderRecord(record);
  }

  static async retryOrder(userId: number, orderId: number) {
    const record = await prisma.certificateOrder.findFirst({ where: { id: orderId, userId } });
    if (!record) throw new Error('证书订单不存在');
    if (record.status === 'issued') throw new Error('已签发证书不可重试');

    let nextStatus: CertificateStatus = 'queued';
    let challengeRecordsJson = record.challengeRecordsJson;
    if (record.status === 'manual_dns_required') {
      nextStatus = 'waiting_dns_propagation';
    } else if (record.status === 'draft') {
      nextStatus = 'queued';
    } else if (record.status === 'waiting_dns_propagation' || record.status === 'validating' || record.status === 'pending_dns' || record.status === 'queued') {
      nextStatus = record.status as CertificateStatus;
    } else {
      challengeRecordsJson = null;
    }

    const updated = await prisma.certificateOrder.update({
      where: { id: record.id },
      data: {
        status: nextStatus,
        nextRetryAt: new Date(),
        lastError: null,
        retryCount: 0,
        challengeRecordsJson,
      },
      include: {
        certificateCredential: true,
        dnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
        _count: { select: { deployJobs: true } },
      },
    });

    await createOrderLog(userId, updated.primaryDomain, `issue:retry:${nextStatus}`, 'SUCCESS');
    return mapOrderRecord(updated);
  }

  static async deleteOrder(userId: number, orderId: number) {
    const record = await prisma.certificateOrder.findFirst({
      where: { id: orderId, userId },
      include: {
        _count: { select: { deployJobs: true } },
      },
    });
    if (!record) throw new Error('证书订单不存在');

    const deployJobsCount = Number(record?._count?.deployJobs || 0);
    if (deployJobsCount > 0) {
      throw new Error('该订单已绑定部署任务，无法删除，请先删除/解绑部署任务');
    }

    const orderState = parseJson<CertificateOrderState | null>(record.challengeRecordsJson, null);
    if (orderState?.challenges?.length) {
      await CertificateDnsService.cleanupChallengeRecords(record.userId, record.dnsCredentialId, orderState.challenges).catch(() => undefined);
    }

    await prisma.certificateOrder.delete({ where: { id: record.id } });

    await createLog({
      userId,
      action: 'DELETE',
      resourceType: 'CERTIFICATE',
      domain: record.primaryDomain,
      recordName: 'order:delete',
      status: 'SUCCESS',
    });

    return { deleted: true };
  }

  static async setAutoRenew(userId: number, orderId: number, enabled: boolean) {
    const record = await getOrderForUser(userId, orderId);
    const orderState = parseJson<CertificateOrderState | null>(record.challengeRecordsJson, null);
    if (!enabled && orderState?.workflow === 'renew' && orderState.challenges?.length) {
      await CertificateDnsService.cleanupChallengeRecords(record.userId, record.dnsCredentialId, orderState.challenges).catch(() => undefined);
    }
    const updated = await prisma.certificateOrder.update({
      where: { id: record.id },
      data: {
        autoRenew: !!enabled,
        retryCount: enabled ? record.retryCount : 0,
        nextRetryAt: enabled ? record.nextRetryAt : null,
        lastError: enabled ? record.lastError : null,
        challengeRecordsJson: !enabled && orderState?.workflow === 'renew' ? null : record.challengeRecordsJson,
      },
      include: {
        certificateCredential: true,
        dnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
        _count: { select: { deployJobs: true } },
      },
    });

    await createLog({
      userId,
      action: 'UPDATE',
      resourceType: 'CERTIFICATE',
      domain: updated.primaryDomain,
      recordName: enabled ? 'autoRenew:on' : 'autoRenew:off',
      status: 'SUCCESS',
    });

    return mapOrderRecord(updated);
  }

  static async buildDownloadZip(userId: number, orderId: number): Promise<Buffer> {
    const record = await prisma.certificateOrder.findFirst({ where: { id: orderId, userId } });
    if (!record) throw new Error('证书订单不存在');
    if (record.status !== 'issued') throw new Error('当前订单尚未签发完成');
    if (!record.certificatePem || !record.fullchainPem || !record.privateKeyPem) throw new Error('证书文件不完整');

    const zip = new JSZip();
    zip.file('cert.pem', decrypt(record.certificatePem));
    zip.file('fullchain.pem', decrypt(record.fullchainPem));
    zip.file('private.key', decrypt(record.privateKeyPem));
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  static async processDueOrders(limit = 3) {
    const now = new Date();
    const records = await prisma.certificateOrder.findMany({
      where: {
        status: { in: ['queued', 'pending_dns', 'waiting_dns_propagation', 'validating'] },
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: now } },
        ],
      },
      orderBy: [{ nextRetryAt: 'asc' }, { updatedAt: 'asc' }],
      take: limit,
    });

    for (const record of records) {
      try {
        await this.processOrder(record.id);
      } catch (error: any) {
        console.error(`[certificate-order:${record.id}]`, error?.message || error);
      }
    }
  }

  static async processOrder(orderId: number) {
    const record = await prisma.certificateOrder.findUnique({ where: { id: orderId } });
    if (!record) return;

    const domains = parseJson<string[]>(record.domainsJson, []);
    const orderState = parseJson<CertificateOrderState | null>(record.challengeRecordsJson, null);
    const credential = await getCredentialSecrets(record.certificateCredentialId, record.userId);

    if (record.status === 'queued') {
      const existingPrivateKeyPem = record.privateKeyPem ? decrypt(record.privateKeyPem) : null;

      try {
        const created = await AcmeService.createOrderState({
          ...credential,
          domains,
          existingPrivateKeyPem,
        });

        await prisma.certificateOrder.update({
          where: { id: record.id },
          data: {
            status: 'pending_dns',
            challengeRecordsJson: serializeChallenges({ ...created.orderState, workflow: 'issue', phase: 'pending_dns' }),
            privateKeyPem: encrypt(created.privateKeyPem),
            nextRetryAt: new Date(),
            lastError: null,
          },
        });

        await prisma.certificateCredential.update({
          where: { id: record.certificateCredentialId },
          data: { accountUrl: created.accountUrl, directoryUrl: created.directoryUrl },
        });
        await createOrderLog(record.userId, record.primaryDomain, 'issue:challenge-created', 'SUCCESS');
        return this.processOrder(record.id);
      } catch (error: any) {
        const message = error?.message || 'ACME 订单创建失败';

        // 兼容：环境从 staging 切换到 production 后，旧的 accountUrl 会导致 JWS KeyID 校验失败
        if (credential.accountUrl && isInvalidAcmeAccountUrlError(message)) {
          try {
            const provisioned = await AcmeService.validateAndProvisionCredential({
              ...credential,
              accountUrl: null,
            });

            await prisma.certificateCredential.update({
              where: { id: record.certificateCredentialId },
              data: {
                accountKeyPem: encrypt(provisioned.accountKeyPem),
                accountUrl: provisioned.accountUrl,
                directoryUrl: provisioned.directoryUrl,
              },
            });

            const recreated = await AcmeService.createOrderState({
              ...credential,
              accountKeyPem: provisioned.accountKeyPem,
              accountUrl: provisioned.accountUrl,
              directoryUrl: provisioned.directoryUrl,
              domains,
              existingPrivateKeyPem,
            });

            await prisma.certificateOrder.update({
              where: { id: record.id },
              data: {
                status: 'pending_dns',
                challengeRecordsJson: serializeChallenges({ ...recreated.orderState, workflow: 'issue', phase: 'pending_dns' }),
                privateKeyPem: encrypt(recreated.privateKeyPem),
                nextRetryAt: new Date(),
                lastError: null,
              },
            });

            await prisma.certificateCredential.update({
              where: { id: record.certificateCredentialId },
              data: { accountUrl: recreated.accountUrl, directoryUrl: recreated.directoryUrl },
            });
            await createOrderLog(record.userId, record.primaryDomain, 'issue:challenge-created', 'SUCCESS');
            return this.processOrder(record.id);
          } catch (repairError: any) {
            const repairMessage = repairError?.message ? `ACME 账户重建失败: ${repairError.message}` : message;
            await prisma.certificateOrder.update({
              where: { id: record.id },
              data: {
                status: 'failed',
                nextRetryAt: null,
                lastError: repairMessage,
              },
            });
            await createOrderLog(record.userId, record.primaryDomain, 'issue:failed:create-order', 'FAILED', repairMessage);
            await notifyIssueFailure(record.userId, record.primaryDomain, domains, credential.provider, repairMessage);
            return;
          }
        }

        await prisma.certificateOrder.update({
          where: { id: record.id },
          data: {
            status: 'failed',
            nextRetryAt: null,
            lastError: message,
          },
        });
        await createOrderLog(record.userId, record.primaryDomain, 'issue:failed:create-order', 'FAILED', message);
        await notifyIssueFailure(record.userId, record.primaryDomain, domains, credential.provider, message);
        return;
      }
    }

    if (record.status === 'pending_dns') {
      if (!orderState || !orderState.challenges.length) {
        await prisma.certificateOrder.update({
          where: { id: record.id },
          data: { status: 'failed', nextRetryAt: null, lastError: '缺少 ACME challenge 数据' },
        });
        await notifyIssueFailure(record.userId, record.primaryDomain, domains, credential.provider, '缺少 ACME challenge 数据');
        return;
      }

      try {
        const challenges = await CertificateDnsService.ensureChallengeRecords(record.userId, record.dnsCredentialId, orderState.challenges);
        await prisma.certificateOrder.update({
          where: { id: record.id },
          data: {
            status: 'waiting_dns_propagation',
            challengeRecordsJson: serializeChallenges({ ...orderState, workflow: 'issue', phase: 'waiting_dns_propagation', challenges }),
            nextRetryAt: new Date(Date.now() + config.acme.propagationDelayMs),
            lastError: null,
          },
        });
        await createOrderLog(record.userId, record.primaryDomain, 'issue:dns-written', 'SUCCESS');
      } catch (error: any) {
        await CertificateDnsService.cleanupChallengeRecords(record.userId, record.dnsCredentialId, orderState.challenges).catch(() => undefined);
        const manualChallenges = await CertificateCnameAliasService.attachAliasGuidance(record.userId, orderState.challenges.map((item) => ({
          ...item,
          mode: 'manual',
          recordId: null,
        })));
        await prisma.certificateOrder.update({
          where: { id: record.id },
          data: {
            status: 'manual_dns_required',
            challengeRecordsJson: serializeChallenges({ ...orderState, workflow: 'issue', phase: 'manual_dns_required', challenges: manualChallenges }),
            nextRetryAt: null,
            lastError: error?.message || '自动写入 TXT 失败，请手动添加验证记录',
          },
        });
        await createOrderLog(record.userId, record.primaryDomain, 'issue:manual-dns', 'FAILED', error?.message || '自动写入 TXT 失败，请手动添加验证记录');
      }
      return;
    }

    if (record.status === 'waiting_dns_propagation') {
      if (!orderState || !orderState.challenges.length) {
        await prisma.certificateOrder.update({
          where: { id: record.id },
          data: { status: 'failed', nextRetryAt: null, lastError: '缺少 challenge 数据' },
        });
        await notifyIssueFailure(record.userId, record.primaryDomain, domains, credential.provider, '缺少 challenge 数据');
        return;
      }

      const propagated = await CertificateDnsService.areChallengesPropagated(orderState.challenges).catch(() => false);
      if (!propagated) {
        const nextCount = record.retryCount + 1;
        const failed = nextCount >= MAX_WAIT_RETRIES;
        await prisma.certificateOrder.update({
          where: { id: record.id },
          data: {
            status: failed ? 'failed' : 'waiting_dns_propagation',
            retryCount: nextCount,
            nextRetryAt: failed ? null : nextRetryDate(record.retryCount),
            lastError: failed ? 'DNS 验证记录长时间未生效' : '等待 DNS 生效中',
          },
        });
        if (failed) {
          await createOrderLog(record.userId, record.primaryDomain, 'issue:failed:dns-propagation', 'FAILED', 'DNS 验证记录长时间未生效');
          await notifyIssueFailure(record.userId, record.primaryDomain, domains, credential.provider, 'DNS 验证记录长时间未生效');
        }
        return;
      }

      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          status: 'validating',
          challengeRecordsJson: serializeChallenges({ ...orderState, workflow: 'issue', phase: 'validating' }),
          nextRetryAt: new Date(),
          lastError: null,
        },
      });
      await createOrderLog(record.userId, record.primaryDomain, 'issue:dns-ready', 'SUCCESS');
      return this.processOrder(record.id);
    }

    if (record.status === 'validating') {
      if (!orderState || !orderState.challenges.length || !record.privateKeyPem) {
        await prisma.certificateOrder.update({
          where: { id: record.id },
          data: { status: 'failed', nextRetryAt: null, lastError: '缺少签发所需数据' },
        });
        await notifyIssueFailure(record.userId, record.primaryDomain, domains, credential.provider, '缺少签发所需数据');
        return;
      }

      try {
        const finalized = await AcmeService.finalizeOrder({
          ...credential,
          domains,
          privateKeyPem: decrypt(record.privateKeyPem),
          orderState,
        });

        await prisma.certificateOrder.update({
          where: { id: record.id },
          data: {
            status: 'issued',
            certificatePem: encrypt(finalized.certificatePem),
            fullchainPem: encrypt(finalized.fullchainPem),
            challengeRecordsJson: null,
            issuedAt: finalized.issuedAt || new Date(),
            expiresAt: finalized.expiresAt || null,
            nextRetryAt: null,
            lastError: null,
            retryCount: 0,
          },
        });

        await prisma.certificateCredential.update({
          where: { id: record.certificateCredentialId },
          data: { accountUrl: finalized.accountUrl },
        });

        await CertificateDnsService.cleanupChallengeRecords(record.userId, record.dnsCredentialId, orderState.challenges).catch(() => undefined);
        await createOrderLog(record.userId, record.primaryDomain, 'issue:success', 'SUCCESS');
        await notifyIssueSuccess(record.userId, record.primaryDomain, domains, credential.provider, finalized.issuedAt || new Date(), finalized.expiresAt || null);
        await CertificateDeployService.triggerJobsForOrder(record.id, 'certificate.issued').catch((error: any) => {
          console.error(`[certificate-deploy:${record.id}:issued]`, error?.message || error);
        });
      } catch (error: any) {
        await CertificateDnsService.cleanupChallengeRecords(record.userId, record.dnsCredentialId, orderState.challenges).catch(() => undefined);
        const message = error?.message || '证书签发失败';
        await prisma.certificateOrder.update({
          where: { id: record.id },
          data: {
            status: 'failed',
            nextRetryAt: null,
            lastError: message,
          },
        });
        await createOrderLog(record.userId, record.primaryDomain, 'issue:failed:finalize', 'FAILED', message);
        await notifyIssueFailure(record.userId, record.primaryDomain, domains, credential.provider, message);
      }
    }
  }
}
