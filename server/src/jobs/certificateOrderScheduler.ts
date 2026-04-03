import { config } from '../config';
import { CertificateOrderService } from '../services/cert/CertificateOrderService';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce() {
  if (running) return;
  running = true;
  try {
    await CertificateOrderService.processDueOrders();
  } catch (error: any) {
    console.error('[certificate-order-scheduler]', error?.message || error);
  } finally {
    running = false;
  }
}

export function startCertificateOrderScheduler() {
  if (timer) return;
  timer = setInterval(runOnce, config.acme.schedulerIntervalMs);
  runOnce().catch((error) => console.error('[certificate-order-scheduler:init]', error));
}
