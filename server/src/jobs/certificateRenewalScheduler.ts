import { config } from '../config';
import { CertificateRenewService } from '../services/cert/CertificateRenewService';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce() {
  if (running) return;
  running = true;
  try {
    await CertificateRenewService.processDueOrders();
    await CertificateRenewService.processManualRenewExpiryReminders();
  } catch (error: any) {
    console.error('[certificate-renewal-scheduler]', error?.message || error);
  } finally {
    running = false;
  }
}

export function startCertificateRenewalScheduler() {
  if (timer) return;
  timer = setInterval(runOnce, config.acme.renewalSchedulerIntervalMs);
  runOnce().catch((error) => console.error('[certificate-renewal-scheduler:init]', error));
}
