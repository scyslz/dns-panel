import { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';
import { X509Certificate } from 'node:crypto';
import { createLog } from '../logger';
import { decrypt, encrypt } from '../../utils/encryption';
import { CertificateContactProfile, VendorCertificateProvider, VendorCertificateStatus } from '../../types';
import {
  getAliyunAuthForUser,
  getDnsCredentialForUser,
  getDnspodTc3CredentialsForUser,
  getUcloudAuthForUser,
} from './credentialHelpers';
import { TencentSslCertificateSummary, TencentSslService } from './TencentSslService';
import { AliyunCasService } from './AliyunCasService';
import { UcloudSslService } from './UcloudSslService';
import { CertificateSettingsService } from './CertificateSettingsService';
import { CertificateDeployService } from './CertificateDeployService';
import { CertificateNotificationService } from './CertificateNotificationService';
import { dnsService } from '../dns/DnsService';
import { CertificateDnsService } from './CertificateDnsService';

const prisma = new PrismaClient();
const TENCENT_ISSUED_STATUSES = new Set([1]);
const TENCENT_PENDING_VALIDATION_STATUSES = new Set([4]);
const TENCENT_ISSUING_STATUSES = new Set([0, 5, 8, 11, 13, 15]);
const TENCENT_FAILED_STATUSES = new Set([2, 6, 7, 9, 10, 12, 14]);
const ALIYUN_PRODUCT_CODE = 'digicert-free-1-free';

interface CreateVendorCertificateOrderInput {
  provider: VendorCertificateProvider;
  vendorCredentialId: number;
  validationDnsCredentialId: number;
  domains: string[];
  contactProfile?: CertificateContactProfile | null;
}

interface VendorProviderDefinition {
  provider: VendorCertificateProvider;
  label: string;
  description: string;
  vendorCredentialProvider: string;
  supportsDownload: boolean;
  supportsMultipleDomains: boolean;
  supportsWildcardDomains: boolean;
  requiresContactProfile: boolean;
}

interface VendorDnsValidationRecord {
  fqdn: string;
  type: 'TXT' | 'CNAME';
  value: string;
  zoneId?: string | null;
  zoneName?: string | null;
  host?: string | null;
  recordId?: string | null;
}

function parseJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function normalizeString(value: any): string {
  return String(value || '').trim();
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
    if (!body) continue;
    const normalized = `${wildcard}${body}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function normalizeComparableDomain(domain: string): string {
  return normalizeString(domain).toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
}

function normalizeNullableString(value: any): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function toDateOrNull(value?: string | Date | number | null): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = typeof value === 'number' ? new Date(value > 10_000_000_000 ? value : value * 1000) : (value instanceof Date ? value : new Date(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function firstCertificatePem(content: string): string {
  const match = String(content || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  return match ? match[0].trim() : '';
}

const PRIVATE_KEY_PEM_LABELS = ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY'] as const;

function escapeRegex(input: string): string {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPemBlocks(content: string, label: string): string[] {
  const escapedLabel = escapeRegex(label);
  return Array.from(String(content || '').matchAll(new RegExp(`-----BEGIN ${escapedLabel}-----[\s\S]+?-----END ${escapedLabel}-----`, 'g'))).map((item) => item[0].trim());
}

function hasPemBlock(content: string, label: string | readonly string[]): boolean {
  const labels = Array.isArray(label) ? label : [label];
  return labels.some((item) => extractPemBlocks(content, item).length > 0);
}

function parseCertificateDates(certificatePem: string, issuedAt?: string | number | Date | null, expiresAt?: string | number | Date | null) {
  const issuedDate = toDateOrNull(issuedAt);
  const expiresDate = toDateOrNull(expiresAt);
  if (issuedDate || expiresDate) {
    return { issuedAt: issuedDate, expiresAt: expiresDate };
  }

  try {
    const cert = new X509Certificate(certificatePem);
    return {
      issuedAt: toDateOrNull(cert.validFrom),
      expiresAt: toDateOrNull(cert.validTo),
    };
  } catch {
    return {
      issuedAt: null,
      expiresAt: null,
    };
  }
}

async function buildCertificateZip(certificatePem: string, fullchainPem: string, privateKeyPem: string) {
  const zip = new JSZip();
  zip.file('cert.pem', certificatePem);
  zip.file('fullchain.pem', fullchainPem);
  zip.file('private.key', privateKeyPem);
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function createVendorLog(userId: number, domain: string, recordName: string, status: 'SUCCESS' | 'FAILED', errorMessage?: string) {
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

function getProviderDefinitions(): VendorProviderDefinition[] {
  return [
    {
      provider: 'tencent_ssl',
      label: '腾讯云 SSL',
      description: '复用 dnspod 凭证申请腾讯云免费证书，可单域名下载标准 ZIP。',
      vendorCredentialProvider: 'dnspod',
      supportsDownload: true,
      supportsMultipleDomains: false,
      supportsWildcardDomains: false,
      requiresContactProfile: true,
    },
    {
      provider: 'aliyun_ssl',
      label: '阿里云免费 SSL',
      description: '复用阿里云 DNS 凭证走 CAS 免费证书申请、轮询与下载。',
      vendorCredentialProvider: 'aliyun',
      supportsDownload: true,
      supportsMultipleDomains: false,
      supportsWildcardDomains: false,
      requiresContactProfile: true,
    },
    {
      provider: 'ucloud_ssl',
      label: 'UCloud 免费 SSL',
      description: '复用 UCloud DNS 凭证申请 TrustAsia 免费证书，并支持下载。',
      vendorCredentialProvider: 'ucloud',
      supportsDownload: true,
      supportsMultipleDomains: false,
      supportsWildcardDomains: false,
      requiresContactProfile: true,
    },
  ];
}

function normalizeProvider(value: any): VendorCertificateProvider {
  const provider = String(value || '').trim().toLowerCase() as VendorCertificateProvider;
  if (provider !== 'tencent_ssl' && provider !== 'aliyun_ssl' && provider !== 'ucloud_ssl') {
    throw new Error('不支持的厂商证书渠道');
  }
  return provider;
}

function normalizeStoredProvider(value: any): VendorCertificateProvider {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'aliyun_esa_free') return 'aliyun_ssl';
  return normalizeProvider(provider);
}

function summarizeCredential(credential: any) {
  if (!credential) return undefined;
  return {
    id: credential.id,
    name: credential.name,
    provider: credential.provider,
    isDefault: !!credential.isDefault,
  };
}

function mapVendorOrderRecord(record: any) {
  const vendorCredential = record.vendorCredential || record.legacyDnsCredential || null;
  const validationDnsCredential = record.validationDnsCredential || record.legacyDnsCredential || null;
  const certificateReady = !!record.certificatePem && !!record.fullchainPem && !!record.privateKeyPem;

  return {
    id: record.id,
    provider: normalizeStoredProvider(record.provider),
    primaryDomain: record.primaryDomain,
    domains: parseJson<string[]>(record.domainsJson, []),
    status: record.status as VendorCertificateStatus,
    providerOrderId: record.providerOrderId || null,
    providerCertificateId: record.providerCertificateId || null,
    contactProfile: parseJson(record.contactProfileJson, null),
    validationPayload: parseJson(record.validationPayloadJson, null),
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    lastSyncAt: record.lastSyncAt,
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    canRetry: record.status !== 'issued',
    canDownload: record.status === 'issued' && certificateReady,
    vendorCredentialId: record.vendorCredentialId ?? record.dnsCredentialId ?? vendorCredential?.id ?? null,
    validationDnsCredentialId: record.validationDnsCredentialId ?? record.dnsCredentialId ?? validationDnsCredential?.id ?? null,
    vendorCredential: summarizeCredential(vendorCredential),
    validationDnsCredential: summarizeCredential(validationDnsCredential),
  };
}

function pickTencentStatus(summary: TencentSslCertificateSummary | null): VendorCertificateStatus {
  const status = typeof summary?.status === 'number' ? summary.status : null;
  const statusName = String(summary?.statusName || '').trim().toLowerCase();

  if (
    !!summary?.allowDownload ||
    (status !== null && TENCENT_ISSUED_STATUSES.has(status)) ||
    /certificate issued|issued|approved/.test(statusName)
  ) {
    return 'issued';
  }

  if (
    (status !== null && TENCENT_FAILED_STATUSES.has(status)) ||
    /failed|cancel|revok|refund|expired/.test(statusName)
  ) {
    return 'failed';
  }

  if (
    !!summary?.awaitingValidationMsg ||
    (status !== null && TENCENT_PENDING_VALIDATION_STATUSES.has(status)) ||
    /validation|dns/.test(statusName)
  ) {
    return 'pending_validation';
  }

  if (status !== null && TENCENT_ISSUING_STATUSES.has(status)) {
    return 'issuing';
  }

  return 'issuing';
}

function deriveTencentError(summary: TencentSslCertificateSummary | null): string | null {
  if (!summary) return null;
  const internalStatus = pickTencentStatus(summary);
  if (internalStatus === 'pending_validation') {
    return summary.awaitingValidationMsg || summary.statusName || '等待腾讯云校验证书';
  }
  if (internalStatus === 'failed') {
    return summary.awaitingValidationMsg || summary.statusName || '腾讯云证书申请失败';
  }
  return null;
}

function normalizeVendorDnsType(input: any): 'TXT' | 'CNAME' {
  const normalized = normalizeString(input).toUpperCase();
  return normalized === 'CNAME' ? 'CNAME' : 'TXT';
}

function normalizeFqdn(input: string): string {
  return normalizeString(input).toLowerCase().replace(/\.$/, '');
}

function buildRelativeRecordHost(fqdn: string, zoneName: string): string {
  const normalizedFqdn = normalizeFqdn(fqdn);
  const normalizedZone = normalizeFqdn(zoneName);
  if (!normalizedFqdn || !normalizedZone) return normalizedFqdn;
  if (normalizedFqdn === normalizedZone) return '@';
  if (normalizedFqdn.endsWith(`.${normalizedZone}`)) {
    return normalizedFqdn.slice(0, -(normalizedZone.length + 1)) || '@';
  }
  return normalizedFqdn;
}

function isSameRecordName(name: string, host: string, fqdn: string, zoneName: string): boolean {
  const normalized = normalizeFqdn(name);
  const normalizedHost = normalizeFqdn(host);
  const normalizedFqdn = normalizeFqdn(fqdn);
  const normalizedZone = normalizeFqdn(zoneName);
  return normalized === normalizedHost
    || normalized === normalizedFqdn
    || normalized === `${normalizedHost}.${normalizedZone}`
    || (normalizedHost === '@' && normalized === normalizedZone);
}

function normalizeTxtValue(value: string): string {
  return normalizeString(value).replace(/^"|"$/g, '');
}

function buildContactProfile(defaults: CertificateContactProfile, input?: CertificateContactProfile | null): CertificateContactProfile {
  const merged: CertificateContactProfile = {
    ...defaults,
    ...(input || {}),
  };

  const normalized: CertificateContactProfile = {};
  for (const [key, value] of Object.entries(merged)) {
    normalized[key as keyof CertificateContactProfile] = normalizeString(value);
  }

  normalized.companyCountry = normalized.companyCountry || 'CN';
  return normalized;
}

function assertContactProfile(provider: VendorCertificateProvider, contactProfile: CertificateContactProfile) {
  if (!normalizeString(contactProfile.email)) {
    throw new Error('联系人邮箱不能为空');
  }
  if (provider === 'aliyun_ssl' || provider === 'ucloud_ssl') {
    if (!normalizeString(contactProfile.name)) throw new Error('联系人姓名不能为空');
    if (!normalizeString(contactProfile.phone)) throw new Error('联系人手机号不能为空');
  }
}

function mapAliyunStatus(state: any): VendorCertificateStatus {
  const type = normalizeString(state?.Type).toLowerCase();
  if (type === 'certificate') return 'issued';
  if (type === 'verify_fail') return 'failed';
  if (type === 'domain_verify') return 'pending_validation';
  return 'issuing';
}

function deriveAliyunError(state: any): string | null {
  const status = mapAliyunStatus(state);
  if (status === 'failed') return normalizeString(state?.Message) || '阿里云免费证书审核失败';
  if (status === 'pending_validation') return '等待阿里云完成域名校验';
  return null;
}

function mapUcloudStatus(detail: any): VendorCertificateStatus {
  const stateCode = normalizeString(detail?.CertificateInfo?.StateCode).toUpperCase();
  if (stateCode === 'COMPLETED' || stateCode === 'RENEWED') return 'issued';
  if (stateCode === 'REJECTED' || stateCode === 'SECURITY_REVIEW_FAILED') return 'failed';
  if (/AUTH|PENDING|APPLY|REVIEW|VERIFY|ISSUING/.test(stateCode)) return 'pending_validation';
  return 'issuing';
}

function deriveUcloudError(detail: any): string | null {
  const state = mapUcloudStatus(detail);
  const stateName = normalizeString(detail?.CertificateInfo?.State || detail?.CertificateInfo?.StateCode);
  if (state === 'failed') return stateName || 'UCloud 证书申请失败';
  if (state === 'pending_validation') return stateName || '等待 UCloud 完成域名校验';
  return null;
}

async function getVendorOrderForUser(userId: number, id: number) {
  const record = await prisma.vendorCertificateOrder.findFirst({
    where: { id, userId },
    include: {
      legacyDnsCredential: {
        select: { id: true, name: true, provider: true, isDefault: true },
      },
      vendorCredential: {
        select: { id: true, name: true, provider: true, isDefault: true },
      },
      validationDnsCredential: {
        select: { id: true, name: true, provider: true, isDefault: true },
      },
    },
  });

  if (!record) throw new Error('厂商证书订单不存在');
  return record;
}

async function getMergedDefaultContact(userId: number, input?: CertificateContactProfile | null) {
  const settings = await CertificateSettingsService.getSettingsWithSecrets(userId);
  return buildContactProfile(settings.defaultContact, input);
}

async function parseZipCertificate(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const files = await Promise.all(
    Object.values(zip.files)
      .filter((file) => !file.dir)
      .map(async (file) => ({
        name: file.name.toLowerCase(),
        content: (await file.async('string')).trim(),
      }))
  );

  const privateKey = files.find((file) => hasPemBlock(file.content, PRIVATE_KEY_PEM_LABELS) || /(?:^|\/)(?:.+\.)?(key|txt)$/i.test(file.name) || file.name.includes('private'));
  const certFiles = files.filter((file) => /\.(crt|pem|cer)$/i.test(file.name) && hasPemBlock(file.content, 'CERTIFICATE'));
  const fullchain = certFiles.find((file) => /(bundle|fullchain|chain)/i.test(file.name)) || certFiles[0];
  const leaf = certFiles.find((file) => !/(bundle|fullchain|chain)/i.test(file.name)) || fullchain;

  if (!privateKey || !hasPemBlock(privateKey.content, PRIVATE_KEY_PEM_LABELS)) throw new Error('下载内容中缺少私钥文件');
  if (!fullchain || !leaf) throw new Error('下载内容中缺少证书文件');

  const certificatePem = firstCertificatePem(leaf.content) || leaf.content.trim();
  const fullchainPem = fullchain.content.trim();
  return {
    certificatePem,
    fullchainPem,
    privateKeyPem: privateKey.content.trim(),
  };
}

async function parseTencentZip(base64Content: string) {
  const buffer = Buffer.from(String(base64Content || ''), 'base64');
  if (!buffer.length) throw new Error('腾讯云未返回证书 ZIP 内容');
  return await parseZipCertificate(buffer);
}

function buildValidationRecord(input: { fqdn?: string | null; type?: string | null; value?: string | null }) {
  const fqdn = normalizeFqdn(String(input.fqdn || ''));
  const type = normalizeVendorDnsType(input.type);
  const value = type === 'TXT' ? normalizeTxtValue(String(input.value || '')) : normalizeFqdn(String(input.value || ''));
  if (!fqdn || !value) return null;
  return { fqdn, type, value } as VendorDnsValidationRecord;
}

function extractTencentValidationRecords(detail: any): VendorDnsValidationRecord[] {
  const auths = Array.isArray(detail?.DvAuthDetail?.DvAuths) ? detail.DvAuthDetail.DvAuths : [];
  const records = auths
    .map((item: any) => buildValidationRecord({
      fqdn: item?.DvAuthKey || item?.DomainValidateAuthKey,
      type: item?.DvAuthVerifyType || item?.DomainValidateAuthType || 'CNAME',
      value: item?.DvAuthValue || item?.DomainValidateAuthValue,
    }))
    .filter(Boolean) as VendorDnsValidationRecord[];
  return records;
}

function extractAliyunValidationRecords(state: any, domain: string): VendorDnsValidationRecord[] {
  if (normalizeString(state?.Type).toLowerCase() !== 'domain_verify') return [];
  const recordType = normalizeVendorDnsType(state?.RecordType || 'TXT');
  const recordDomain = normalizeString(state?.RecordDomain || '');
  const value = normalizeString(state?.RecordValue || '');
  if (!recordDomain || !value) return [];
  const fqdn = recordDomain.includes('.') ? normalizeFqdn(recordDomain) : normalizeFqdn(`${recordDomain}.${normalizeComparableDomain(domain)}`);
  return [buildValidationRecord({ fqdn, type: recordType, value })!].filter(Boolean);
}

function extractUcloudValidationRecords(authInfo: any): VendorDnsValidationRecord[] {
  const records = Array.isArray(authInfo?.auths) ? authInfo.auths : [];
  return records
    .map((item: any) => buildValidationRecord({
      fqdn: item.authKey,
      type: String(item.authType || '').toUpperCase().includes('CNAME') ? 'CNAME' : 'TXT',
      value: item.authValue,
    }))
    .filter(Boolean) as VendorDnsValidationRecord[];
}

async function ensureValidationRecords(userId: number, validationDnsCredentialId: number, records: VendorDnsValidationRecord[]) {
  const ctx = await CertificateDnsService.getDnsContext(userId, validationDnsCredentialId);
  const next = records.map((item) => ({ ...item }));

  for (const item of next) {
    const zone = await CertificateDnsService.findBestZone(ctx, item.fqdn);
    if (!zone) {
      throw new Error(`验证 DNS 凭证下未找到 ${item.fqdn} 的可写权威 DNS 区域`);
    }

    const host = buildRelativeRecordHost(item.fqdn, zone.name);
    const result = await dnsService.getRecords(ctx, zone.id, { page: 1, pageSize: 200, keyword: host });
    const exact = (result.records || []).find((record) => {
      if (record.type !== item.type) return false;
      if (!isSameRecordName(record.name, host, item.fqdn, zone.name)) return false;
      return item.type === 'TXT'
        ? normalizeTxtValue(record.value) === normalizeTxtValue(item.value)
        : normalizeFqdn(record.value) === normalizeFqdn(item.value);
    });

    const sameNameType = (result.records || []).find((record) => record.type === item.type && isSameRecordName(record.name, host, item.fqdn, zone.name));

    item.zoneId = zone.id;
    item.zoneName = zone.name;
    item.host = host;

    if (exact) {
      item.recordId = exact.id;
      continue;
    }

    if (sameNameType && item.type === 'CNAME') {
      const updated = await dnsService.updateRecord(ctx, zone.id, sameNameType.id, {
        name: host,
        type: item.type,
        value: item.value,
      });
      item.recordId = updated.id;
      continue;
    }

    const created = await dnsService.createRecord(ctx, zone.id, {
      name: host,
      type: item.type,
      value: item.value,
    });
    item.recordId = created.id;
  }

  return next;
}

async function buildUcloudCertificateBundle(auth: any, certificateId: number) {
  const downloaded = await UcloudSslService.downloadCertificate(auth, certificateId);
  const directCertificate = normalizeString(downloaded?.Certificate?.FileData || '');
  const directChain = normalizeString(downloaded?.CertCA?.FileData || '');
  const directPrivateKey = normalizeString(downloaded?.PrivateKey?.FileData || downloaded?.CertificateKey?.FileData || downloaded?.Key?.FileData || '');

  if (directCertificate && directPrivateKey) {
    return {
      certificatePem: firstCertificatePem(directCertificate) || directCertificate,
      fullchainPem: [directCertificate.trim(), directChain.trim()].filter(Boolean).join('\n'),
      privateKeyPem: directPrivateKey.trim(),
    };
  }

  const downloadUrl = normalizeString(downloaded?.CertificateUrl || '');
  if (!downloadUrl) throw new Error('UCloud 未返回可下载证书内容');
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`下载 UCloud 证书失败: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return await parseZipCertificate(buffer);
}

async function notifyVendorFailure(record: any, error: string) {
  await CertificateNotificationService.notifyVendorFailed(record.userId, {
    primaryDomain: record.primaryDomain,
    domains: parseJson<string[]>(record.domainsJson, []),
    provider: normalizeStoredProvider(record.provider),
    error,
  }).catch(() => undefined);
}

async function notifyVendorIssued(record: any, issuedAt?: Date | string | null, expiresAt?: Date | string | null) {
  await CertificateNotificationService.notifyVendorIssued(record.userId, {
    primaryDomain: record.primaryDomain,
    domains: parseJson<string[]>(record.domainsJson, []),
    provider: normalizeStoredProvider(record.provider),
    issuedAt,
    expiresAt,
  }).catch(() => undefined);
  await CertificateDeployService.triggerJobsForVendorOrder(record.id, 'certificate.issued').catch(() => undefined);
}

export class VendorCertificateService {
  static listProviders() {
    return getProviderDefinitions();
  }

  static async listOrders(userId: number) {
    const records = await prisma.vendorCertificateOrder.findMany({
      where: { userId },
      include: {
        legacyDnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
        vendorCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
        validationDnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return records.map(mapVendorOrderRecord);
  }

  static async getOrder(userId: number, id: number) {
    const record = await getVendorOrderForUser(userId, id);
    return mapVendorOrderRecord(record);
  }

  static async createOrder(userId: number, input: CreateVendorCertificateOrderInput) {
    const provider = normalizeProvider(input.provider);
    const domains = normalizeDomains(input.domains);
    if (!domains.length) throw new Error('至少填写一个域名');
    if (domains.length > 1) throw new Error('当前厂商免费 SSL 首版仅支持单域名申请');
    if (domains[0].startsWith('*.')) throw new Error('当前厂商免费 SSL 首版不支持泛域名，请改用 ACME 渠道');

    const definition = getProviderDefinitions().find((item) => item.provider === provider)!;
    const vendorCredential = await getDnsCredentialForUser(userId, Number(input.vendorCredentialId));
    if (vendorCredential.provider !== definition.vendorCredentialProvider) {
      throw new Error(`${definition.label} 仅支持 ${definition.vendorCredentialProvider} 类型凭证`);
    }

    const validationDnsCredential = await getDnsCredentialForUser(userId, Number(input.validationDnsCredentialId));
    const contactProfile = await getMergedDefaultContact(userId, input.contactProfile || null);
    assertContactProfile(provider, contactProfile);

    const created = await prisma.vendorCertificateOrder.create({
      data: {
        userId,
        provider,
        dnsCredentialId: validationDnsCredential.id,
        vendorCredentialId: vendorCredential.id,
        validationDnsCredentialId: validationDnsCredential.id,
        primaryDomain: domains[0],
        domainsJson: JSON.stringify(domains),
        contactProfileJson: JSON.stringify(contactProfile),
        status: 'queued',
      },
      include: {
        legacyDnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
        vendorCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
        validationDnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
      },
    });

    await createLog({
      userId,
      action: 'CREATE',
      resourceType: 'CERTIFICATE',
      domain: created.primaryDomain,
      recordName: `vendor:${provider}`,
      status: 'SUCCESS',
    });

    return mapVendorOrderRecord(created);
  }

  static async retryOrder(userId: number, id: number) {
    const record = await getVendorOrderForUser(userId, id);
    if (record.status === 'issued') throw new Error('已签发订单不可重试');

    const updated = await prisma.vendorCertificateOrder.update({
      where: { id: record.id },
      data: {
        status: 'queued',
        lastError: null,
        lastSyncAt: null,
      },
      include: {
        legacyDnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
        vendorCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
        validationDnsCredential: { select: { id: true, name: true, provider: true, isDefault: true } },
      },
    });

    await createVendorLog(userId, updated.primaryDomain, `vendor:retry:${updated.provider}`, 'SUCCESS');
    return mapVendorOrderRecord(updated);
  }

  static async buildDownloadZip(userId: number, id: number) {
    const record = await prisma.vendorCertificateOrder.findFirst({ where: { id, userId } });
    if (!record) throw new Error('厂商证书订单不存在');
    if (record.status !== 'issued') throw new Error('当前订单尚未签发完成');
    if (!record.certificatePem || !record.fullchainPem || !record.privateKeyPem) {
      throw new Error('证书文件不完整，暂时无法下载');
    }

    return await buildCertificateZip(
      decrypt(record.certificatePem),
      decrypt(record.fullchainPem),
      decrypt(record.privateKeyPem)
    );
  }

  static async processDueOrders(limit = 10) {
    const threshold = new Date(Date.now() - 15_000);
    const records = await prisma.vendorCertificateOrder.findMany({
      where: {
        status: { in: ['queued', 'pending_validation', 'issuing'] },
        OR: [{ lastSyncAt: null }, { lastSyncAt: { lte: threshold } }],
      },
      orderBy: [{ updatedAt: 'asc' }],
      take: limit,
    });

    for (const record of records) {
      try {
        await this.processOrder(record.id);
      } catch (error: any) {
        console.error(`[vendor-certificate:${record.id}]`, error?.message || error);
      }
    }
  }

  static async processOrder(id: number) {
    const record = await prisma.vendorCertificateOrder.findUnique({ where: { id } });
    if (!record || record.status === 'issued' || record.status === 'failed') return;

    await prisma.vendorCertificateOrder.update({
      where: { id: record.id },
      data: { lastSyncAt: new Date() },
    });

    const provider = normalizeStoredProvider(record.provider);

    if (provider === 'tencent_ssl') {
      await this.processTencentOrder(record.id);
      return;
    }

    if (provider === 'aliyun_ssl') {
      await this.processAliyunOrder(record.id);
      return;
    }

    await this.processUcloudOrder(record.id);
  }

  private static resolveCredentialIds(record: any) {
    return {
      vendorCredentialId: Number(record.vendorCredentialId || record.dnsCredentialId || 0),
      validationDnsCredentialId: Number(record.validationDnsCredentialId || record.dnsCredentialId || 0),
    };
  }

  private static async fetchTencentSummary(creds: any, certificateId: string) {
    const result = await TencentSslService.describeCertificates(creds, { certificateIds: [certificateId], limit: 1 });
    return result.certificates[0] || null;
  }

  private static async syncTencentDownload(id: number) {
    const record = await prisma.vendorCertificateOrder.findUnique({ where: { id } });
    if (!record?.providerCertificateId) return;
    const { vendorCredentialId } = this.resolveCredentialIds(record);
    const { creds } = await getDnspodTc3CredentialsForUser(record.userId, vendorCredentialId);
    const summary = await this.fetchTencentSummary(creds, record.providerCertificateId).catch(() => null);
    const download = await TencentSslService.downloadCertificate(creds, record.providerCertificateId);
    const parsed = await parseTencentZip(download.contentBase64);
    const dates = parseCertificateDates(parsed.certificatePem, summary?.certBeginTime, summary?.certEndTime);

    await prisma.vendorCertificateOrder.update({
      where: { id: record.id },
      data: {
        status: 'issued',
        validationPayloadJson: JSON.stringify({
          ...parseJson(record.validationPayloadJson, {}),
          summary,
          downloadContentType: download.contentType || null,
        }),
        certificatePem: encrypt(parsed.certificatePem),
        fullchainPem: encrypt(parsed.fullchainPem),
        privateKeyPem: encrypt(parsed.privateKeyPem),
        issuedAt: dates.issuedAt,
        expiresAt: dates.expiresAt,
        lastError: null,
        lastSyncAt: new Date(),
      },
    });

    await createVendorLog(record.userId, record.primaryDomain, 'vendor:tencent:issued', 'SUCCESS');
    await notifyVendorIssued(record, dates.issuedAt, dates.expiresAt);
  }

  private static async processTencentOrder(id: number) {
    const record = await prisma.vendorCertificateOrder.findUnique({ where: { id } });
    if (!record) return;

    const domains = parseJson<string[]>(record.domainsJson, []);
    if (!domains.length) throw new Error('订单域名为空');

    const { vendorCredentialId, validationDnsCredentialId } = this.resolveCredentialIds(record);
    const { creds } = await getDnspodTc3CredentialsForUser(record.userId, vendorCredentialId);
    const contactProfile = parseJson<CertificateContactProfile | null>(record.contactProfileJson, null) || {};
    const existingPayload = parseJson<any>(record.validationPayloadJson, {});

    if (!record.providerCertificateId) {
      try {
        const applied = await TencentSslService.applyCertificate(creds, {
          domain: domains[0],
          alias: record.primaryDomain,
          authMethod: 'DNS',
          contactEmail: normalizeString(contactProfile.email),
        });
        const detail = await TencentSslService.describeCertificate(creds, applied.certificateId);
        const dnsRecords = await ensureValidationRecords(record.userId, validationDnsCredentialId, extractTencentValidationRecords(detail));
        if ([0, 4].includes(Number(detail?.Status))) {
          await TencentSslService.completeCertificate(creds, applied.certificateId).catch(() => undefined);
        }
        const summary = await this.fetchTencentSummary(creds, applied.certificateId).catch(() => null);
        const nextStatus = Number(detail?.Status) === 1 ? 'issued' : (dnsRecords.length ? 'pending_validation' : pickTencentStatus(summary));

        await prisma.vendorCertificateOrder.update({
          where: { id: record.id },
          data: {
            status: nextStatus,
            providerOrderId: normalizeNullableString(detail?.OrderId) || applied.requestId || null,
            providerCertificateId: applied.certificateId,
            validationPayloadJson: JSON.stringify({
              ...existingPayload,
              detail,
              summary,
              dnsRecords,
            }),
            lastError: nextStatus === 'failed' ? (normalizeString(detail?.StatusMsg) || deriveTencentError(summary)) : (nextStatus === 'pending_validation' ? '等待腾讯云完成域名校验' : null),
            lastSyncAt: new Date(),
          },
        });

        await createVendorLog(record.userId, record.primaryDomain, 'vendor:tencent:apply', 'SUCCESS');
        if (nextStatus === 'issued') {
          await this.syncTencentDownload(record.id);
        }
      } catch (error: any) {
        const message = error?.message || '腾讯云证书申请失败';
        await prisma.vendorCertificateOrder.update({
          where: { id: record.id },
          data: {
            status: 'failed',
            lastError: message,
            lastSyncAt: new Date(),
          },
        });
        await createVendorLog(record.userId, record.primaryDomain, 'vendor:tencent:apply', 'FAILED', message);
        await notifyVendorFailure(record, message);
        throw error;
      }
      return;
    }

    try {
      const detail = await TencentSslService.describeCertificate(creds, record.providerCertificateId);
      const dnsRecords = extractTencentValidationRecords(detail);
      const ensuredDnsRecords = dnsRecords.length ? await ensureValidationRecords(record.userId, validationDnsCredentialId, dnsRecords) : parseJson(existingPayload?.dnsRecords ? JSON.stringify(existingPayload.dnsRecords) : null, [] as VendorDnsValidationRecord[]);
      if ([0, 4].includes(Number(detail?.Status))) {
        await TencentSslService.completeCertificate(creds, record.providerCertificateId).catch(() => undefined);
      }
      const summary = await this.fetchTencentSummary(creds, record.providerCertificateId).catch(() => null);
      const nextStatus = Number(detail?.Status) === 1 ? 'issued' : (Number(detail?.Status) === 2 ? 'failed' : (ensuredDnsRecords.length ? 'pending_validation' : pickTencentStatus(summary)));

      await prisma.vendorCertificateOrder.update({
        where: { id: record.id },
        data: {
          status: nextStatus,
          validationPayloadJson: JSON.stringify({
            ...existingPayload,
            detail,
            summary,
            dnsRecords: ensuredDnsRecords,
          }),
          lastError: nextStatus === 'failed'
            ? (normalizeString(detail?.StatusMsg) || deriveTencentError(summary) || '腾讯云证书申请失败')
            : (nextStatus === 'pending_validation' ? '等待腾讯云完成域名校验' : null),
          lastSyncAt: new Date(),
        },
      });

      if (nextStatus === 'issued') {
        await this.syncTencentDownload(record.id);
      } else if (nextStatus === 'failed') {
        const failureMessage = normalizeString(detail?.StatusMsg) || deriveTencentError(summary) || '腾讯云证书申请失败';
        await createVendorLog(record.userId, record.primaryDomain, 'vendor:tencent:failed', 'FAILED', failureMessage);
        await notifyVendorFailure(record, failureMessage);
      }
    } catch (error: any) {
      const message = error?.message || '腾讯云证书状态同步失败';
      await prisma.vendorCertificateOrder.update({
        where: { id: record.id },
        data: {
          lastError: message,
          lastSyncAt: new Date(),
        },
      });
      await createVendorLog(record.userId, record.primaryDomain, 'vendor:tencent:sync', 'FAILED', message);
      await notifyVendorFailure(record, message);
      throw error;
    }
  }

  private static async processAliyunOrder(id: number) {
    const record = await prisma.vendorCertificateOrder.findUnique({ where: { id } });
    if (!record) return;

    const domains = parseJson<string[]>(record.domainsJson, []);
    if (!domains.length) throw new Error('订单域名为空');

    const { vendorCredentialId, validationDnsCredentialId } = this.resolveCredentialIds(record);
    const { auth } = await getAliyunAuthForUser(record.userId, vendorCredentialId);
    const contactProfile = parseJson<CertificateContactProfile | null>(record.contactProfileJson, null) || {};
    const existingPayload = parseJson<any>(record.validationPayloadJson, {});

    if (!record.providerOrderId) {
      try {
        const packageState = await AliyunCasService.describePackageState(auth, ALIYUN_PRODUCT_CODE);
        if (Number(packageState?.TotalCount || 0) <= Number(packageState?.UsedCount || 0)) {
          throw new Error('阿里云免费证书额度不足');
        }

        const created = await AliyunCasService.createCertificateRequest(auth, {
          productCode: ALIYUN_PRODUCT_CODE,
          username: normalizeString(contactProfile.name),
          phone: normalizeString(contactProfile.phone),
          email: normalizeString(contactProfile.email),
          domain: domains[0],
          validateType: 'DNS',
        });
        const orderId = normalizeString(created?.OrderId);
        if (!orderId) throw new Error('阿里云未返回有效订单 ID');
        const state = await AliyunCasService.describeCertificateState(auth, orderId);
        const dnsRecords = await ensureValidationRecords(record.userId, validationDnsCredentialId, extractAliyunValidationRecords(state, domains[0]));
        const nextStatus = mapAliyunStatus(state);

        await prisma.vendorCertificateOrder.update({
          where: { id: record.id },
          data: {
            status: nextStatus,
            providerOrderId: orderId,
            providerCertificateId: normalizeNullableString(state?.CertId),
            validationPayloadJson: JSON.stringify({
              ...existingPayload,
              packageState,
              state,
              dnsRecords,
            }),
            lastError: deriveAliyunError(state),
            lastSyncAt: new Date(),
          },
        });

        await createVendorLog(record.userId, record.primaryDomain, 'vendor:aliyun:apply', 'SUCCESS');
        if (nextStatus === 'issued') {
          await this.syncAliyunIssued(record.id, state);
        }
      } catch (error: any) {
        const message = error?.message || '阿里云免费证书申请失败';
        await prisma.vendorCertificateOrder.update({
          where: { id: record.id },
          data: {
            status: 'failed',
            lastError: message,
            lastSyncAt: new Date(),
          },
        });
        await createVendorLog(record.userId, record.primaryDomain, 'vendor:aliyun:apply', 'FAILED', message);
        await notifyVendorFailure(record, message);
        throw error;
      }
      return;
    }

    try {
      const state = await AliyunCasService.describeCertificateState(auth, record.providerOrderId);
      const dnsRecords = extractAliyunValidationRecords(state, domains[0]);
      const ensuredDnsRecords = dnsRecords.length ? await ensureValidationRecords(record.userId, validationDnsCredentialId, dnsRecords) : parseJson(existingPayload?.dnsRecords ? JSON.stringify(existingPayload.dnsRecords) : null, [] as VendorDnsValidationRecord[]);
      const nextStatus = mapAliyunStatus(state);

      await prisma.vendorCertificateOrder.update({
        where: { id: record.id },
        data: {
          status: nextStatus,
          providerCertificateId: normalizeNullableString(state?.CertId) || record.providerCertificateId,
          validationPayloadJson: JSON.stringify({
            ...existingPayload,
            state,
            dnsRecords: ensuredDnsRecords,
          }),
          lastError: deriveAliyunError(state),
          lastSyncAt: new Date(),
        },
      });

      if (nextStatus === 'issued') {
        await this.syncAliyunIssued(record.id, state);
      } else if (nextStatus === 'failed') {
        const failureMessage = deriveAliyunError(state) || '阿里云免费证书申请失败';
        await createVendorLog(record.userId, record.primaryDomain, 'vendor:aliyun:failed', 'FAILED', failureMessage);
        await notifyVendorFailure(record, failureMessage);
      }
    } catch (error: any) {
      const message = error?.message || '阿里云免费证书状态同步失败';
      await prisma.vendorCertificateOrder.update({
        where: { id: record.id },
        data: {
          lastError: message,
          lastSyncAt: new Date(),
        },
      });
      await createVendorLog(record.userId, record.primaryDomain, 'vendor:aliyun:sync', 'FAILED', message);
      await notifyVendorFailure(record, message);
      throw error;
    }
  }

  private static async syncAliyunIssued(id: number, state?: any) {
    const record = await prisma.vendorCertificateOrder.findUnique({ where: { id } });
    if (!record) return;
    const { vendorCredentialId } = this.resolveCredentialIds(record);
    const { auth } = await getAliyunAuthForUser(record.userId, vendorCredentialId);
    const latestState = state || (record.providerOrderId ? await AliyunCasService.describeCertificateState(auth, record.providerOrderId) : null);
    const certificatePem = firstCertificatePem(latestState?.Certificate || '') || normalizeString(latestState?.Certificate || '');
    const privateKeyPem = normalizeString(latestState?.PrivateKey || '');
    if (!certificatePem || !privateKeyPem) throw new Error('阿里云未返回完整证书内容');
    const fullchainPem = normalizeString(latestState?.Certificate || certificatePem);
    const dates = parseCertificateDates(certificatePem);

    await prisma.vendorCertificateOrder.update({
      where: { id: record.id },
      data: {
        status: 'issued',
        providerCertificateId: normalizeNullableString(latestState?.CertId) || record.providerCertificateId,
        certificatePem: encrypt(certificatePem),
        fullchainPem: encrypt(fullchainPem),
        privateKeyPem: encrypt(privateKeyPem),
        issuedAt: dates.issuedAt,
        expiresAt: dates.expiresAt,
        lastError: null,
        lastSyncAt: new Date(),
        validationPayloadJson: JSON.stringify({
          ...parseJson(record.validationPayloadJson, {}),
          state: latestState,
        }),
      },
    });

    await createVendorLog(record.userId, record.primaryDomain, 'vendor:aliyun:issued', 'SUCCESS');
    await notifyVendorIssued(record, dates.issuedAt, dates.expiresAt);
  }

  private static async processUcloudOrder(id: number) {
    const record = await prisma.vendorCertificateOrder.findUnique({ where: { id } });
    if (!record) return;

    const domains = parseJson<string[]>(record.domainsJson, []);
    if (!domains.length) throw new Error('订单域名为空');

    const { vendorCredentialId, validationDnsCredentialId } = this.resolveCredentialIds(record);
    const { auth } = await getUcloudAuthForUser(record.userId, vendorCredentialId);
    const contactProfile = parseJson<CertificateContactProfile | null>(record.contactProfileJson, null) || {};
    const existingPayload = parseJson<any>(record.validationPayloadJson, {});

    if (!record.providerCertificateId) {
      try {
        const purchased = await UcloudSslService.purchaseCertificate(auth, { domainsCount: 1, validYear: 1 });
        if (!purchased.certificateId) throw new Error('UCloud 未返回证书 ID');
        await UcloudSslService.complementCsrInfo(auth, {
          CertificateID: purchased.certificateId,
          Domains: domains[0],
          CSROnline: 1,
          CSREncryptAlgo: 'RSA',
          CSRKeyParameter: '2048',
          CompanyName: normalizeString(contactProfile.companyName) || '个人',
          CompanyAddress: normalizeString(contactProfile.companyAddress) || 'CN',
          CompanyRegion: normalizeString(contactProfile.companyRegion) || 'Shanghai',
          CompanyCity: normalizeString(contactProfile.companyCity) || 'Shanghai',
          CompanyCountry: normalizeString(contactProfile.companyCountry) || 'CN',
          CompanyDivision: normalizeString(contactProfile.companyDivision) || 'Personal',
          CompanyPhone: normalizeString(contactProfile.companyPhone || contactProfile.phone) || normalizeString(contactProfile.phone),
          CompanyPostalCode: normalizeString(contactProfile.companyPostalCode) || '200000',
          AdminName: normalizeString(contactProfile.name),
          AdminPhone: normalizeString(contactProfile.phone),
          AdminEmail: normalizeString(contactProfile.email),
          AdminTitle: normalizeString(contactProfile.title) || 'Owner',
          DVAuthMethod: 'DNS',
        });
        const authInfo = await UcloudSslService.getDvAuthInfo(auth, purchased.certificateId);
        const dnsRecords = await ensureValidationRecords(record.userId, validationDnsCredentialId, extractUcloudValidationRecords(authInfo));
        const detail = await UcloudSslService.getCertificateDetailInfo(auth, purchased.certificateId).catch(() => null);
        const nextStatus = detail ? mapUcloudStatus(detail) : (dnsRecords.length ? 'pending_validation' : 'issuing');

        await prisma.vendorCertificateOrder.update({
          where: { id: record.id },
          data: {
            status: nextStatus,
            providerOrderId: String(purchased.certificateId),
            providerCertificateId: String(purchased.certificateId),
            validationPayloadJson: JSON.stringify({
              ...existingPayload,
              authInfo,
              dnsRecords,
              detail,
            }),
            lastError: detail ? deriveUcloudError(detail) : (nextStatus === 'pending_validation' ? '等待 UCloud 完成域名校验' : null),
            lastSyncAt: new Date(),
          },
        });

        await createVendorLog(record.userId, record.primaryDomain, 'vendor:ucloud:apply', 'SUCCESS');
        if (nextStatus === 'issued') {
          await this.syncUcloudIssued(record.id, detail);
        }
      } catch (error: any) {
        const message = error?.message || 'UCloud 证书申请失败';
        await prisma.vendorCertificateOrder.update({
          where: { id: record.id },
          data: {
            status: 'failed',
            lastError: message,
            lastSyncAt: new Date(),
          },
        });
        await createVendorLog(record.userId, record.primaryDomain, 'vendor:ucloud:apply', 'FAILED', message);
        await notifyVendorFailure(record, message);
        throw error;
      }
      return;
    }

    try {
      const certificateId = Number(record.providerCertificateId);
      const authInfo = await UcloudSslService.getDvAuthInfo(auth, certificateId).catch(() => null);
      const dnsRecords = authInfo ? await ensureValidationRecords(record.userId, validationDnsCredentialId, extractUcloudValidationRecords(authInfo)) : parseJson(existingPayload?.dnsRecords ? JSON.stringify(existingPayload.dnsRecords) : null, [] as VendorDnsValidationRecord[]);
      const detail = await UcloudSslService.getCertificateDetailInfo(auth, certificateId);
      const nextStatus = mapUcloudStatus(detail);

      await prisma.vendorCertificateOrder.update({
        where: { id: record.id },
        data: {
          status: nextStatus,
          validationPayloadJson: JSON.stringify({
            ...existingPayload,
            authInfo: authInfo || existingPayload.authInfo || null,
            dnsRecords,
            detail,
          }),
          lastError: deriveUcloudError(detail),
          lastSyncAt: new Date(),
        },
      });

      if (nextStatus === 'issued') {
        await this.syncUcloudIssued(record.id, detail);
      } else if (nextStatus === 'failed') {
        const failureMessage = deriveUcloudError(detail) || 'UCloud 证书申请失败';
        await createVendorLog(record.userId, record.primaryDomain, 'vendor:ucloud:failed', 'FAILED', failureMessage);
        await notifyVendorFailure(record, failureMessage);
      }
    } catch (error: any) {
      const message = error?.message || 'UCloud 证书状态同步失败';
      await prisma.vendorCertificateOrder.update({
        where: { id: record.id },
        data: {
          lastError: message,
          lastSyncAt: new Date(),
        },
      });
      await createVendorLog(record.userId, record.primaryDomain, 'vendor:ucloud:sync', 'FAILED', message);
      await notifyVendorFailure(record, message);
      throw error;
    }
  }

  private static async syncUcloudIssued(id: number, detail?: any) {
    const record = await prisma.vendorCertificateOrder.findUnique({ where: { id } });
    if (!record?.providerCertificateId) return;
    const { vendorCredentialId } = this.resolveCredentialIds(record);
    const { auth } = await getUcloudAuthForUser(record.userId, vendorCredentialId);
    const certificateId = Number(record.providerCertificateId);
    const latestDetail = detail || await UcloudSslService.getCertificateDetailInfo(auth, certificateId);
    const parsed = await buildUcloudCertificateBundle(auth, certificateId);
    const dates = parseCertificateDates(parsed.certificatePem, latestDetail?.CertificateInfo?.IssuedDate, latestDetail?.CertificateInfo?.ExpiredDate);

    await prisma.vendorCertificateOrder.update({
      where: { id: record.id },
      data: {
        status: 'issued',
        certificatePem: encrypt(parsed.certificatePem),
        fullchainPem: encrypt(parsed.fullchainPem),
        privateKeyPem: encrypt(parsed.privateKeyPem),
        issuedAt: dates.issuedAt,
        expiresAt: dates.expiresAt,
        lastError: null,
        lastSyncAt: new Date(),
        validationPayloadJson: JSON.stringify({
          ...parseJson(record.validationPayloadJson, {}),
          detail: latestDetail,
        }),
      },
    });

    await createVendorLog(record.userId, record.primaryDomain, 'vendor:ucloud:issued', 'SUCCESS');
    await notifyVendorIssued(record, dates.issuedAt, dates.expiresAt);
  }
}
