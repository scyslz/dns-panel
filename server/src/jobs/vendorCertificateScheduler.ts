import { config } from '../config';
import { VendorCertificateService } from '../services/cert/VendorCertificateService';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce() {
  if (running) return;
  running = true;
  try {
    await VendorCertificateService.processDueOrders();
  } catch (error: any) {
    console.error('[vendor-certificate-scheduler]', error?.message || error);
  } finally {
    running = false;
  }
}

export function startVendorCertificateScheduler() {
  if (timer) return;
  timer = setInterval(runOnce, config.certificates.vendorSchedulerIntervalMs);
  runOnce().catch((error) => console.error('[vendor-certificate-scheduler:init]', error));
}
