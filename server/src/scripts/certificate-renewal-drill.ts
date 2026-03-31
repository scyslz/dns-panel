import { PrismaClient } from '@prisma/client';
import { CertificateRenewService } from '../services/cert/CertificateRenewService';

const prisma = new PrismaClient();

function readArg(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

async function loadSnapshot(orderId: number) {
  const order = await prisma.certificateOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      primaryDomain: true,
      status: true,
      autoRenew: true,
      issuedAt: true,
      expiresAt: true,
      updatedAt: true,
      retryCount: true,
      nextRetryAt: true,
      lastError: true,
      challengeRecordsJson: true,
      certificatePem: true,
    },
  });
  if (!order) throw new Error('证书订单不存在');
  const state = parseJson<any>(order.challengeRecordsJson, null);
  return {
    ...order,
    renewWorkflow: state?.workflow || null,
    renewPhase: state?.phase || null,
    hasCertificatePem: !!order.certificatePem,
  };
}

async function main() {
  const orderId = parseInt(readArg('--order', '') || '', 10);
  const intervalMs = Math.max(3000, parseInt(readArg('--interval-ms', '10000') || '10000', 10) || 10000);
  const timeoutMs = Math.max(intervalMs, parseInt(readArg('--timeout-ms', '900000') || '900000', 10) || 900000);
  const continueOnManual = hasFlag('--continue-on-manual');

  if (!Number.isFinite(orderId)) {
    console.error('用法: npx tsx src/scripts/certificate-renewal-drill.ts --order <id> [--interval-ms 10000] [--timeout-ms 900000] [--continue-on-manual]');
    process.exit(1);
  }

  const startedAt = Date.now();
  const before = await loadSnapshot(orderId);
  console.log(JSON.stringify({ stage: 'before', snapshot: before }, null, 2));

  const startResult = await CertificateRenewService.forceStartRenewal(orderId);
  console.log(JSON.stringify({ stage: 'force-start', result: startResult }, null, 2));

  let lastMarker = '';
  while (Date.now() - startedAt <= timeoutMs) {
    await CertificateRenewService.processOrder(orderId);
    const snapshot = await loadSnapshot(orderId);
    const marker = [
      snapshot.status,
      snapshot.renewWorkflow,
      snapshot.renewPhase,
      snapshot.retryCount,
      snapshot.nextRetryAt ? new Date(snapshot.nextRetryAt).toISOString() : 'null',
      snapshot.lastError || '',
      snapshot.expiresAt ? new Date(snapshot.expiresAt).toISOString() : 'null',
    ].join('|');

    if (marker !== lastMarker) {
      lastMarker = marker;
      console.log(JSON.stringify({ stage: 'tick', snapshot }, null, 2));
    }

    if (snapshot.status !== 'issued') {
      throw new Error(`续期 drill 过程中订单状态异常: ${snapshot.status}`);
    }

    if (!snapshot.renewWorkflow && !snapshot.renewPhase && snapshot.hasCertificatePem) {
      const issuedAtChanged = String(snapshot.issuedAt || '') !== String(before.issuedAt || '');
      const expiresAtChanged = String(snapshot.expiresAt || '') !== String(before.expiresAt || '');
      if (issuedAtChanged || expiresAtChanged) {
        console.log(JSON.stringify({ stage: 'success', snapshot }, null, 2));
        return;
      }
    }

    if (snapshot.renewPhase === 'manual_dns_required' && !continueOnManual) {
      console.log(JSON.stringify({ stage: 'manual_dns_required', snapshot }, null, 2));
      return;
    }

    const waitUntil = snapshot.nextRetryAt ? new Date(snapshot.nextRetryAt).getTime() : 0;
    const waitMs = waitUntil > Date.now() ? Math.max(1000, Math.min(intervalMs, waitUntil - Date.now())) : intervalMs;
    await sleep(waitMs);
  }

  throw new Error(`续期 drill 超时，超过 ${timeoutMs}ms`);
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
