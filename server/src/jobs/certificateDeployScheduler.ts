import { config } from '../config';
import { CertificateDeployService } from '../services/cert/CertificateDeployService';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce() {
  if (running) return;
  running = true;
  try {
    await CertificateDeployService.processPendingRuns();
  } catch (error: any) {
    console.error('[certificate-deploy-scheduler]', error?.message || error);
  } finally {
    running = false;
  }
}

export function startCertificateDeployScheduler() {
  if (timer) return;
  timer = setInterval(runOnce, config.certificates.deploySchedulerIntervalMs);
  runOnce().catch((error) => console.error('[certificate-deploy-scheduler:init]', error));
}
