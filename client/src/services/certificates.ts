import api from './api';
import { ApiResponse } from '@/types';
import {
  AcmeProviderOption,
  CertificateAlias,
  CertificateCredential,
  CertificateOrder,
  CertificateSettingsData,
  CreateCertificateOrderInput,
  CreateVendorCertificateOrderInput,
  DeployJob,
  DeployJobRun,
  DeployJobRunSummary,
  DeployTarget,
  DeployTargetResourcesResponse,
  CertificateTimelineEntry,
  TestCertificateNotificationResult,
  DeployTargetTypeDefinition,
  UpsertCertificateCredentialInput,
  UpsertCertificateAliasInput,
  UpsertDeployJobInput,
  UpsertDeployTargetInput,
  VendorCertificate,
  VendorCertificateProviderDefinition,
} from '@/types/cert';

export async function getCertificateCredentialProviders(): Promise<ApiResponse<{ providers: AcmeProviderOption[] }>> {
  const response = await api.get('/certificate-credentials/providers');
  return response as unknown as ApiResponse<{ providers: AcmeProviderOption[] }>;
}

export async function getCertificateCredentials(): Promise<ApiResponse<{ credentials: CertificateCredential[] }>> {
  const response = await api.get('/certificate-credentials');
  return response as unknown as ApiResponse<{ credentials: CertificateCredential[] }>;
}

export async function createCertificateCredential(data: UpsertCertificateCredentialInput): Promise<ApiResponse<{ credential: CertificateCredential }>> {
  const response = await api.post('/certificate-credentials', data);
  return response as unknown as ApiResponse<{ credential: CertificateCredential }>;
}

export async function updateCertificateCredential(id: number, data: UpsertCertificateCredentialInput): Promise<ApiResponse<{ credential: CertificateCredential }>> {
  const response = await api.put(`/certificate-credentials/${id}`, data);
  return response as unknown as ApiResponse<{ credential: CertificateCredential }>;
}

export async function deleteCertificateCredential(id: number): Promise<ApiResponse> {
  const response = await api.delete(`/certificate-credentials/${id}`);
  return response as unknown as ApiResponse;
}

export async function setDefaultCertificateCredential(id: number): Promise<ApiResponse> {
  const response = await api.post(`/certificate-credentials/${id}/default`);
  return response as unknown as ApiResponse;
}

export async function getCertificateOrders(): Promise<ApiResponse<{ orders: CertificateOrder[] }>> {
  const response = await api.get('/certificates');
  return response as unknown as ApiResponse<{ orders: CertificateOrder[] }>;
}

export async function createCertificateOrder(data: CreateCertificateOrderInput): Promise<ApiResponse<{ order: CertificateOrder }>> {
  const response = await api.post('/certificates', data);
  return response as unknown as ApiResponse<{ order: CertificateOrder }>;
}

export async function getCertificateOrder(id: number): Promise<ApiResponse<{ order: CertificateOrder }>> {
  const response = await api.get(`/certificates/${id}`);
  return response as unknown as ApiResponse<{ order: CertificateOrder }>;
}

export async function getCertificateOrderTimeline(id: number): Promise<ApiResponse<{ timeline: CertificateTimelineEntry[] }>> {
  const response = await api.get(`/certificates/${id}/timeline`);
  return response as unknown as ApiResponse<{ timeline: CertificateTimelineEntry[] }>;
}

export async function retryCertificateOrder(id: number): Promise<ApiResponse<{ order: CertificateOrder }>> {
  const response = await api.post(`/certificates/${id}/retry`);
  return response as unknown as ApiResponse<{ order: CertificateOrder }>;
}

export async function deleteCertificateOrder(id: number): Promise<ApiResponse> {
  const response = await api.delete(`/certificates/${id}`);
  return response as unknown as ApiResponse;
}

export async function downloadCertificateOrder(id: number): Promise<Blob> {
  const response = await api.get(`/certificates/${id}/download`, { responseType: 'blob' });
  return response as unknown as Blob;
}

export async function toggleCertificateAutoRenew(id: number, enabled: boolean): Promise<ApiResponse<{ order: CertificateOrder }>> {
  const response = await api.post(`/certificates/${id}/auto-renew`, { enabled });
  return response as unknown as ApiResponse<{ order: CertificateOrder }>;
}

export async function getDeployTargets(): Promise<ApiResponse<{ targets: DeployTarget[] }>> {
  const response = await api.get('/certificate-deploy/targets');
  return response as unknown as ApiResponse<{ targets: DeployTarget[] }>;
}

export async function getDeployTargetTypes(): Promise<ApiResponse<{ types: DeployTargetTypeDefinition[] }>> {
  const response = await api.get('/certificate-deploy/types');
  return response as unknown as ApiResponse<{ types: DeployTargetTypeDefinition[] }>;
}

export async function getDeployTargetResources(
  id: number,
  params?: Record<string, any>
): Promise<ApiResponse<DeployTargetResourcesResponse>> {
  const response = await api.get(`/certificate-deploy/targets/${id}/resources`, { params });
  return response as unknown as ApiResponse<DeployTargetResourcesResponse>;
}

export async function createDeployTarget(data: UpsertDeployTargetInput): Promise<ApiResponse<{ target: DeployTarget }>> {
  const response = await api.post('/certificate-deploy/targets', data);
  return response as unknown as ApiResponse<{ target: DeployTarget }>;
}

export async function updateDeployTarget(id: number, data: UpsertDeployTargetInput): Promise<ApiResponse<{ target: DeployTarget }>> {
  const response = await api.put(`/certificate-deploy/targets/${id}`, data);
  return response as unknown as ApiResponse<{ target: DeployTarget }>;
}

export async function deleteDeployTarget(id: number): Promise<ApiResponse> {
  const response = await api.delete(`/certificate-deploy/targets/${id}`);
  return response as unknown as ApiResponse;
}

export async function testDeployTarget(id: number): Promise<ApiResponse<{ result: { status: number; body: string } }>> {
  const response = await api.post(`/certificate-deploy/targets/${id}/test`);
  return response as unknown as ApiResponse<{ result: { status: number; body: string } }>;
}

export async function getDeployJobs(): Promise<ApiResponse<{ jobs: DeployJob[] }>> {
  const response = await api.get('/certificate-deploy/jobs');
  return response as unknown as ApiResponse<{ jobs: DeployJob[] }>;
}

export async function createDeployJob(data: UpsertDeployJobInput): Promise<ApiResponse<{ job: DeployJob }>> {
  const response = await api.post('/certificate-deploy/jobs', data);
  return response as unknown as ApiResponse<{ job: DeployJob }>;
}

export async function updateDeployJob(id: number, data: Partial<UpsertDeployJobInput>): Promise<ApiResponse<{ job: DeployJob }>> {
  const response = await api.put(`/certificate-deploy/jobs/${id}`, data);
  return response as unknown as ApiResponse<{ job: DeployJob }>;
}

export async function deleteDeployJob(id: number): Promise<ApiResponse> {
  const response = await api.delete(`/certificate-deploy/jobs/${id}`);
  return response as unknown as ApiResponse;
}

export async function runDeployJob(id: number, event: 'certificate.issued' | 'certificate.renewed' = 'certificate.issued'): Promise<ApiResponse<{ job: DeployJob }>> {
  const response = await api.post(`/certificate-deploy/jobs/${id}/run`, { event });
  return response as unknown as ApiResponse<{ job: DeployJob }>;
}

export async function getDeployJobRuns(
  id: number,
): Promise<ApiResponse<{ job: DeployJobRunSummary; runs: DeployJobRun[]; logs: CertificateTimelineEntry[] }>> {
  const response = await api.get(`/certificate-deploy/jobs/${id}/runs`);
  return response as unknown as ApiResponse<{ job: DeployJobRunSummary; runs: DeployJobRun[]; logs: CertificateTimelineEntry[] }>;
}

export async function getVendorCertificateProviders(): Promise<ApiResponse<{ providers: VendorCertificateProviderDefinition[] }>> {
  const response = await api.get('/vendor-certificates/providers');
  return response as unknown as ApiResponse<{ providers: VendorCertificateProviderDefinition[] }>;
}

export async function getVendorCertificates(): Promise<ApiResponse<{ orders: VendorCertificate[] }>> {
  const response = await api.get('/vendor-certificates');
  return response as unknown as ApiResponse<{ orders: VendorCertificate[] }>;
}

export async function createVendorCertificateOrder(data: CreateVendorCertificateOrderInput): Promise<ApiResponse<{ order: VendorCertificate }>> {
  const response = await api.post('/vendor-certificates', data);
  return response as unknown as ApiResponse<{ order: VendorCertificate }>;
}

export async function getVendorCertificateOrder(id: number): Promise<ApiResponse<{ order: VendorCertificate }>> {
  const response = await api.get(`/vendor-certificates/${id}`);
  return response as unknown as ApiResponse<{ order: VendorCertificate }>;
}

export async function getVendorCertificateTimeline(id: number): Promise<ApiResponse<{ timeline: CertificateTimelineEntry[] }>> {
  const response = await api.get(`/vendor-certificates/${id}/timeline`);
  return response as unknown as ApiResponse<{ timeline: CertificateTimelineEntry[] }>;
}

export async function retryVendorCertificateOrder(id: number): Promise<ApiResponse<{ order: VendorCertificate }>> {
  const response = await api.post(`/vendor-certificates/${id}/retry`);
  return response as unknown as ApiResponse<{ order: VendorCertificate }>;
}

export async function deleteVendorCertificateOrder(id: number): Promise<ApiResponse> {
  const response = await api.delete(`/vendor-certificates/${id}`);
  return response as unknown as ApiResponse;
}

export async function downloadVendorCertificateOrder(id: number): Promise<Blob> {
  const response = await api.get(`/vendor-certificates/${id}/download`, { responseType: 'blob' });
  return response as unknown as Blob;
}

export async function getCertificateAliases(): Promise<ApiResponse<{ aliases: CertificateAlias[] }>> {
  const response = await api.get('/certificate-aliases');
  return response as unknown as ApiResponse<{ aliases: CertificateAlias[] }>;
}

export async function createCertificateAlias(data: UpsertCertificateAliasInput): Promise<ApiResponse<{ alias: CertificateAlias }>> {
  const response = await api.post('/certificate-aliases', data);
  return response as unknown as ApiResponse<{ alias: CertificateAlias }>;
}

export async function updateCertificateAlias(id: number, data: Partial<UpsertCertificateAliasInput>): Promise<ApiResponse<{ alias: CertificateAlias }>> {
  const response = await api.put(`/certificate-aliases/${id}`, data);
  return response as unknown as ApiResponse<{ alias: CertificateAlias }>;
}

export async function deleteCertificateAlias(id: number): Promise<ApiResponse> {
  const response = await api.delete(`/certificate-aliases/${id}`);
  return response as unknown as ApiResponse;
}

export async function checkCertificateAlias(id: number): Promise<ApiResponse<{ alias: CertificateAlias }>> {
  const response = await api.post(`/certificate-aliases/${id}/check`);
  return response as unknown as ApiResponse<{ alias: CertificateAlias }>;
}

export async function getCertificateSettings(): Promise<ApiResponse<{ settings: CertificateSettingsData }>> {
  const response = await api.get('/auth/certificate-settings');
  return response as unknown as ApiResponse<{ settings: CertificateSettingsData }>;
}

export async function updateCertificateSettings(data: CertificateSettingsData): Promise<ApiResponse<{ settings: CertificateSettingsData }>> {
  const response = await api.put('/auth/certificate-settings', data);
  return response as unknown as ApiResponse<{ settings: CertificateSettingsData }>;
}

export async function testCertificateSettingsChannel(
  channel?: string
): Promise<ApiResponse<{ results: TestCertificateNotificationResult[] }>> {
  const response = await api.post('/auth/certificate-settings/test', channel ? { channel } : {});
  return response as unknown as ApiResponse<{ results: TestCertificateNotificationResult[] }>;
}
