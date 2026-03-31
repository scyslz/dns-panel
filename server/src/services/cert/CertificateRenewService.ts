import { PrismaClient } from '@prisma/client';
import { config } from '../../config';
import { encrypt, decrypt } from '../../utils/encryption';
import { createLog } from '../logger';
import { AcmeProviderType } from '../../types';
import { AcmeService, CertificateChallengeState, CertificateOrderState } from './AcmeService';
import { CertificateDnsService } from './CertificateDnsService';
import { CertificateCnameAliasService } from './CertificateCnameAliasService';
import { CertificateDeployService } from './CertificateDeployService';
import { CertificateSettingsService } from './CertificateSettingsService';
import { CertificateNotificationService } from './CertificateNotificationService';

const prisma = new PrismaClient();
const DAY_MS = 86_400_000;
const FALLBACK_RENEW_WINDOW_MS = 30 * DAY_MS;
const RENEW_RETRY_BACKOFF_MS = [300000, 900000, 1800000, 3600000, 21600000, 86400000];

function parseJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function serializeOrderState(orderState: CertificateOrderState | null): string | null {
  return orderState ? JSON.stringify(orderState) : null;
}

function nextRetryDate(retryCount: number): Date {
  const ms = RENEW_RETRY_BACKOFF_MS[Math.min(retryCount, RENEW_RETRY_BACKOFF_MS.length - 1)] || RENEW_RETRY_BACKOFF_MS[RENEW_RETRY_BACKOFF_MS.length - 1];
  return new Date(Date.now() + ms);
}

function withRenewState(orderState: CertificateOrderState, patch: Partial<CertificateOrderState>): CertificateOrderState {
  return {
    ...orderState,
    workflow: 'renew',
    ...patch,
  };
}

function isRenewState(orderState: CertificateOrderState | null): orderState is CertificateOrderState {
  return !!orderState && orderState.workflow === 'renew' && !!orderState.phase;
}

async function getCredentialSecrets(credentialId: number, userId: number) {
  const credential = await prisma.certificateCredential.findFirst({ where: { id: credentialId, userId } });
  if (!credential) throw new Error('证书账户不存在');
  return {
    id: credential.id,
    provider: credential.provider as AcmeProviderType,
    email: credential.email,
    directoryUrl: credential.directoryUrl,
    eabKid: credential.eabKid,
    eabHmacKey: credential.eabHmacKey ? decrypt(credential.eabHmacKey) : null,
    accountKeyPem: decrypt(credential.accountKeyPem),
    accountUrl: credential.accountUrl,
  };
}

async function createRenewLog(userId: number, domain: string, recordName: string, status: 'SUCCESS' | 'FAILED', errorMessage?: string) {
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

async function notifyRenewFailure(userId: number, primaryDomain: string, domains: string[], provider: string, error: string) {
  await CertificateNotificationService.notifyRenewFailed(userId, {
    primaryDomain,
    domains,
    provider,
    error,
  }).catch(() => undefined);
}

async function notifyRenewSuccess(userId: number, primaryDomain: string, domains: string[], provider: string, issuedAt?: Date | string | null, expiresAt?: Date | string | null) {
  await CertificateNotificationService.notifyRenewSucceeded(userId, {
    primaryDomain,
    domains,
    provider,
    issuedAt,
    expiresAt,
  }).catch(() => undefined);
}

export class CertificateRenewService {
  static async processManualRenewExpiryReminders(limit = 20) {
    const now = Date.now();
    const settingsCache = new Map<number, number>();
    const candidates = await prisma.certificateOrder.findMany({
      where: {
        status: 'issued',
        autoRenew: false,
        expiresAt: { not: null },
      },
      orderBy: [{ expiresAt: 'asc' }, { updatedAt: 'asc' }],
      take: Math.max(limit * 5, limit),
    });

    let processed = 0;
    for (const record of candidates) {
      if (!record.expiresAt) continue;
      let renewDays = settingsCache.get(record.userId);
      if (renewDays == null) {
        const settings = await CertificateSettingsService.getSettingsWithSecrets(record.userId).catch(() => null);
        renewDays = settings?.automation?.renewDays ?? 30;
        settingsCache.set(record.userId, renewDays);
      }

      const daysLeft = Math.floor((record.expiresAt.getTime() - now) / DAY_MS);
      if (daysLeft < 0 || daysLeft > renewDays) continue;

      const recent = await prisma.log.findFirst({
        where: {
          userId: record.userId,
          resourceType: 'CERTIFICATE',
          domain: record.primaryDomain,
          recordName: `manual-renew-expiry:${record.id}`,
          status: 'SUCCESS',
          timestamp: { gte: new Date(now - DAY_MS) },
        },
        select: { id: true },
      });
      if (recent) continue;

      const domains = parseJson<string[]>(record.domainsJson, []);
      const results = await CertificateNotificationService.notifyManualRenewExpiry(record.userId, {
        primaryDomain: record.primaryDomain,
        domains,
        expiresAt: record.expiresAt,
        daysLeft,
      }).catch((error: any) => [{ channel: 'email', success: false, error: error?.message || '提醒发送失败' }]);

      if (!results.length) continue;

      const successCount = results.filter((item: any) => item?.success).length;
      const failureMessage = results.filter((item: any) => !item?.success).map((item: any) => item?.error).filter(Boolean).join('; ');
      await createRenewLog(
        record.userId,
        record.primaryDomain,
        `manual-renew-expiry:${record.id}`,
        successCount > 0 ? 'SUCCESS' : 'FAILED',
        successCount > 0 ? undefined : (failureMessage || '手动续期到期提醒发送失败')
      );

      processed += 1;
      if (processed >= limit) break;
    }
  }

  static async processDueOrders(limit = 10) {
    const now = new Date();
    const records = await prisma.certificateOrder.findMany({
      where: {
        status: 'issued',
        autoRenew: true,
        expiresAt: { not: null },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      orderBy: [{ nextRetryAt: 'asc' }, { expiresAt: 'asc' }, { updatedAt: 'asc' }],
      take: limit,
    });

    for (const record of records) {
      try {
        await this.processOrder(record.id);
      } catch (error: any) {
        console.error(`[certificate-renew:${record.id}]`, error?.message || error);
      }
    }
  }

  static async processOrder(orderId: number) {
    const record = await prisma.certificateOrder.findUnique({ where: { id: orderId } });
    if (!record || record.status !== 'issued' || !record.expiresAt) return;

    const domains = parseJson<string[]>(record.domainsJson, []);
    if (!domains.length) return;

    const orderState = parseJson<CertificateOrderState | null>(record.challengeRecordsJson, null);
    if (!record.autoRenew && !isRenewState(orderState)) return;

    const credential = await getCredentialSecrets(record.certificateCredentialId, record.userId);

    if (!isRenewState(orderState)) {
      const due = await this.isDueForRenewal(credential.provider, credential.directoryUrl, record.certificatePem, record.expiresAt);
      if (!due.due) return;
      await this.beginRenewal(record, domains, credential, due.replaces || null, due.reason);
      return;
    }

    if (orderState.phase === 'pending_dns') {
      await this.processPendingDns(record, orderState, domains, credential);
      return;
    }

    if (orderState.phase === 'manual_dns_required' || orderState.phase === 'waiting_dns_propagation') {
      await this.processWaitingDns(record, orderState, domains, credential);
      return;
    }

    if (orderState.phase === 'validating') {
      await this.processValidating(record, orderState, domains, credential);
    }
  }

  static async isDueForRenewal(
    provider: AcmeProviderType,
    directoryUrl: string | null | undefined,
    certificatePemEncrypted: string | null,
    expiresAt: Date
  ): Promise<{ due: boolean; reason: 'ari' | 'fallback'; replaces?: string | null }> {
    const now = Date.now();

    if (certificatePemEncrypted) {
      try {
        const renewalInfo = await AcmeService.getRenewalInfo({
          provider,
          directoryUrl,
          email: 'renewal-check@local',
          certificatePem: decrypt(certificatePemEncrypted),
        });

        if (renewalInfo.supported && (renewalInfo.suggestedWindowStart || renewalInfo.suggestedWindowEnd)) {
          const windowStart = renewalInfo.suggestedWindowStart?.getTime() ?? renewalInfo.suggestedWindowEnd?.getTime() ?? Number.MAX_SAFE_INTEGER;
          if (now >= windowStart) {
            return { due: true, reason: 'ari', replaces: renewalInfo.certId };
          }
          return { due: false, reason: 'ari', replaces: renewalInfo.certId };
        }
      } catch {
        // fallback to fixed window
      }
    }

    return {
      due: expiresAt.getTime() - now <= FALLBACK_RENEW_WINDOW_MS,
      reason: 'fallback',
    };
  }

  static async forceStartRenewal(orderId: number) {
    const record = await prisma.certificateOrder.findUnique({ where: { id: orderId } });
    if (!record) throw new Error('证书订单不存在');
    if (record.status !== 'issued') throw new Error('仅已签发证书可执行续期 drill');
    if (!record.expiresAt) throw new Error('当前证书缺少 expiresAt，无法执行续期 drill');

    const domains = parseJson<string[]>(record.domainsJson, []);
    if (!domains.length) throw new Error('当前证书缺少域名信息');

    const orderState = parseJson<CertificateOrderState | null>(record.challengeRecordsJson, null);
    if (isRenewState(orderState)) {
      return {
        orderId: record.id,
        primaryDomain: record.primaryDomain,
        phase: orderState.phase,
        replaces: orderState.replaces || null,
        message: '续期 drill 已在进行中',
      };
    }

    const credential = await getCredentialSecrets(record.certificateCredentialId, record.userId);
    let replaces: string | null = null;
    if (record.certificatePem) {
      try {
        const renewalInfo = await AcmeService.getRenewalInfo({
          provider: credential.provider,
          directoryUrl: credential.directoryUrl,
          email: credential.email,
          certificatePem: decrypt(record.certificatePem),
        });
        replaces = renewalInfo.certId || null;
      } catch {
        replaces = null;
      }
    }

    await this.beginRenewal(record, domains, credential, replaces, 'force');
    return {
      orderId: record.id,
      primaryDomain: record.primaryDomain,
      phase: 'pending_dns',
      replaces,
      message: '续期 drill 已启动',
    };
  }

  private static async beginRenewal(record: any, domains: string[], credential: any, replaces: string | null, reason: 'ari' | 'fallback' | 'force') {
    await createRenewLog(record.userId, record.primaryDomain, `renew:start:${reason}`, 'SUCCESS');

    try {
      const created = await AcmeService.createOrderState({
        ...credential,
        domains,
        replaces,
      });

      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          challengeRecordsJson: serializeOrderState({
            ...created.orderState,
            workflow: 'renew',
            phase: 'pending_dns',
            replaces,
            renewalPrivateKeyPem: encrypt(created.privateKeyPem),
          }),
          nextRetryAt: new Date(),
          retryCount: 0,
          lastError: null,
        },
      });

      await prisma.certificateCredential.update({
        where: { id: record.certificateCredentialId },
        data: {
          accountUrl: created.accountUrl,
          directoryUrl: created.directoryUrl,
        },
      });
    } catch (error: any) {
      const message = error?.message || '自动续期创建 ACME 订单失败';
      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          nextRetryAt: nextRetryDate(record.retryCount),
          retryCount: record.retryCount + 1,
          lastError: message,
        },
      });
      await createRenewLog(record.userId, record.primaryDomain, 'renew:failed:create-order', 'FAILED', message);
      await notifyRenewFailure(record.userId, record.primaryDomain, domains, credential.provider, message);
      throw error;
    }
  }

  static async processPendingDns(record: any, orderState: CertificateOrderState, domains: string[], credential: any) {
    if (!orderState.challenges.length) {
      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          challengeRecordsJson: null,
          nextRetryAt: nextRetryDate(record.retryCount),
          retryCount: record.retryCount + 1,
          lastError: '续期缺少 ACME challenge 数据',
        },
      });
      await createRenewLog(record.userId, record.primaryDomain, 'renew:failed:missing-challenge', 'FAILED', '续期缺少 ACME challenge 数据');
      await notifyRenewFailure(record.userId, record.primaryDomain, domains, credential.provider, '续期缺少 ACME challenge 数据');
      return;
    }

    try {
      const challenges = await CertificateDnsService.ensureChallengeRecords(record.userId, record.dnsCredentialId, orderState.challenges);
      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          challengeRecordsJson: serializeOrderState(withRenewState(orderState, {
            phase: 'waiting_dns_propagation',
            challenges,
          })),
          nextRetryAt: new Date(Date.now() + config.acme.propagationDelayMs),
          lastError: null,
        },
      });
    } catch (error: any) {
      await CertificateDnsService.cleanupChallengeRecords(record.userId, record.dnsCredentialId, orderState.challenges).catch(() => undefined);
      const manualChallenges = await CertificateCnameAliasService.attachAliasGuidance(record.userId, orderState.challenges.map((item) => ({
        ...item,
        mode: 'manual',
        recordId: null,
      })));
      const message = error?.message || '自动续期写入 TXT 失败，请手动添加验证记录';
      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          challengeRecordsJson: serializeOrderState(withRenewState(orderState, {
            phase: 'manual_dns_required',
            challenges: manualChallenges,
          })),
          nextRetryAt: nextRetryDate(0),
          lastError: message,
          retryCount: 0,
        },
      });
      await createRenewLog(record.userId, record.primaryDomain, 'renew:manual-dns', 'FAILED', message);
    }
  }

  static async processWaitingDns(record: any, orderState: CertificateOrderState, domains: string[], credential: any) {
    if (!orderState.challenges.length) {
      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          challengeRecordsJson: null,
          nextRetryAt: nextRetryDate(record.retryCount),
          retryCount: record.retryCount + 1,
          lastError: '续期缺少 DNS challenge 数据',
        },
      });
      await createRenewLog(record.userId, record.primaryDomain, 'renew:failed:missing-dns', 'FAILED', '续期缺少 DNS challenge 数据');
      await notifyRenewFailure(record.userId, record.primaryDomain, domains, credential.provider, '续期缺少 DNS challenge 数据');
      return;
    }

    const propagated = await CertificateDnsService.areChallengesPropagated(orderState.challenges).catch(() => false);
    if (!propagated) {
      const nextCount = record.retryCount + 1;
      const waitingMessage = orderState.phase === 'manual_dns_required' ? '等待手动 DNS 记录生效中' : '等待 DNS 生效中';
      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          challengeRecordsJson: serializeOrderState(orderState),
          retryCount: nextCount,
          nextRetryAt: nextRetryDate(record.retryCount),
          lastError: waitingMessage,
        },
      });
      return;
    }

    await prisma.certificateOrder.update({
      where: { id: record.id },
      data: {
        challengeRecordsJson: serializeOrderState(withRenewState(orderState, { phase: 'validating' })),
        nextRetryAt: new Date(),
        lastError: null,
      },
    });
  }

  static async processValidating(record: any, orderState: CertificateOrderState, domains: string[], credential: any) {
    if (!orderState.challenges.length || !orderState.renewalPrivateKeyPem) {
      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          challengeRecordsJson: null,
          nextRetryAt: nextRetryDate(record.retryCount),
          retryCount: record.retryCount + 1,
          lastError: '续期缺少签发所需数据',
        },
      });
      await createRenewLog(record.userId, record.primaryDomain, 'renew:failed:missing-finalize-data', 'FAILED', '续期缺少签发所需数据');
      await notifyRenewFailure(record.userId, record.primaryDomain, domains, credential.provider, '续期缺少签发所需数据');
      return;
    }

    try {
      const finalized = await AcmeService.finalizeOrder({
        ...credential,
        domains,
        privateKeyPem: decrypt(orderState.renewalPrivateKeyPem),
        orderState,
      });

      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          privateKeyPem: orderState.renewalPrivateKeyPem,
          certificatePem: encrypt(finalized.certificatePem),
          fullchainPem: encrypt(finalized.fullchainPem),
          issuedAt: finalized.issuedAt || new Date(),
          expiresAt: finalized.expiresAt || null,
          challengeRecordsJson: null,
          nextRetryAt: null,
          retryCount: 0,
          lastError: null,
        },
      });

      await prisma.certificateCredential.update({
        where: { id: record.certificateCredentialId },
        data: { accountUrl: finalized.accountUrl },
      });

      await CertificateDnsService.cleanupChallengeRecords(record.userId, record.dnsCredentialId, orderState.challenges).catch(() => undefined);
      await createRenewLog(record.userId, record.primaryDomain, 'renew:success', 'SUCCESS');
      await notifyRenewSuccess(record.userId, record.primaryDomain, domains, credential.provider, finalized.issuedAt || new Date(), finalized.expiresAt || null);
      await CertificateDeployService.triggerJobsForOrder(record.id, 'certificate.renewed').catch((error: any) => {
        console.error(`[certificate-deploy:${record.id}:renewed]`, error?.message || error);
      });
    } catch (error: any) {
      await CertificateDnsService.cleanupChallengeRecords(record.userId, record.dnsCredentialId, orderState.challenges).catch(() => undefined);
      const message = error?.message || '证书续期失败';
      await prisma.certificateOrder.update({
        where: { id: record.id },
        data: {
          challengeRecordsJson: null,
          nextRetryAt: nextRetryDate(record.retryCount),
          retryCount: record.retryCount + 1,
          lastError: message,
        },
      });
      await createRenewLog(record.userId, record.primaryDomain, 'renew:failed:finalize', 'FAILED', message);
      await notifyRenewFailure(record.userId, record.primaryDomain, domains, credential.provider, message);
    }
  }
}
