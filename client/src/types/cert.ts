import { ProviderType } from './dns';

export type AcmeProviderType = 'letsencrypt' | 'zerossl' | 'google' | 'custom';

export type CertificateStatus =
  | 'draft'
  | 'queued'
  | 'pending_dns'
  | 'manual_dns_required'
  | 'waiting_dns_propagation'
  | 'validating'
  | 'issued'
  | 'failed';

export type CertificateAliasStatus = 'pending' | 'ready' | 'error';
export type CertificateDeploySourceType = 'acme' | 'vendor';
export type CertificateTimelineTone = 'default' | 'info' | 'success' | 'warning' | 'error';
export type CertificateTimelineCategory = 'status' | 'challenge' | 'log' | 'deployment';
export type CertificateNotificationPolicy = 'off' | 'all' | 'fail_only';
export type CertificateNotificationChannelKey = 'email' | 'webhook' | 'telegram' | 'dingtalk' | 'feishu' | 'wecom' | 'wechatTemplate';

export interface CertificateChallengeRecord {
  domain: string;
  identifier: string;
  authorizationUrl: string;
  challengeUrl: string;
  token: string;
  type: string;
  recordHost: string;
  recordName: string;
  recordValue: string;
  zoneId?: string | null;
  zoneName?: string | null;
  recordId?: string | null;
  mode?: 'auto' | 'manual';
  aliasDomain?: string | null;
  aliasStatus?: string | null;
  aliasTargetFqdn?: string | null;
  aliasDnsCredentialId?: number | null;
  effectiveDnsCredentialId?: number | null;
}

export interface CertificateCredentialSummary {
  id: number;
  name: string;
  provider: AcmeProviderType;
  email: string;
  isDefault: boolean;
}

export interface CertificateOrderDnsCredential {
  id: number;
  name: string;
  provider: ProviderType;
  isDefault: boolean;
}

export interface CertificateOrder {
  id: number;
  primaryDomain: string;
  domains: string[];
  status: CertificateStatus;
  challengeRecords: CertificateChallengeRecord[];
  autoRenew: boolean;
  retryCount: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  certificateCredential?: CertificateCredentialSummary;
  dnsCredential?: CertificateOrderDnsCredential;
  canRetry: boolean;
  canDownload: boolean;
  deployJobsCount?: number;
}

export interface CertificateCredential {
  id: number;
  name: string;
  provider: AcmeProviderType;
  email: string;
  directoryUrl?: string | null;
  eabKid?: string | null;
  accountUrl?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AcmeProviderOption {
  provider: AcmeProviderType;
  label: string;
  defaultDirectoryUrl: string;
  requiresDirectoryUrl: boolean;
  supportsEab: boolean;
}

export interface CreateCertificateOrderInput {
  mode: 'draft' | 'apply';
  certificateCredentialId: number;
  dnsCredentialId: number;
  domains: string[];
  autoRenew?: boolean;
}

export interface UpsertCertificateCredentialInput {
  name: string;
  provider: AcmeProviderType;
  email: string;
  directoryUrl?: string;
  eabKid?: string;
  eabHmacKey?: string;
}

export type DeployTargetType =
  | 'webhook'
  | 'dokploy'
  | 'cloudflare_custom_hostname'
  | 'aliyun_esa'
  | 'aliyun_cdn'
  | 'aliyun_dcdn'
  | 'aliyun_clb'
  | 'aliyun_alb'
  | 'aliyun_nlb'
  | 'aliyun_oss'
  | 'aliyun_waf'
  | 'aliyun_fc'
  | 'onepanel'
  | 'nginx_proxy_manager'
  | 'tencent_cdn'
  | 'tencent_edgeone'
  | 'tencent_clb'
  | 'tencent_cos'
  | 'tencent_tke'
  | 'tencent_scf'
  | 'huawei_cdn'
  | 'huawei_elb'
  | 'huawei_waf'
  | 'ucloud_cdn'
  | 'qiniu_cdn'
  | 'qiniu_oss'
  | 'baidu_cdn'
  | 'volcengine_cdn'
  | 'dogecloud_cdn'
  | 'aws_cloudfront'
  | 'gcore'
  | 'cachefly'
  | 'allwaf'
  | 'ssh_server'
  | 'ftp_server'
  | 'iis'
  | 'local_directory';

export type DeployFieldType = 'text' | 'password' | 'number' | 'switch' | 'textarea';
export type DeployTargetConfig = Record<string, any>;
export type DeployBindingConfig = Record<string, any> | null;

export interface DeployFieldOption {
  value: string;
  label: string;
}

export interface DeployFieldDefinition {
  name: string;
  label: string;
  type: DeployFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  options?: DeployFieldOption[];
}

export interface DeployTargetTypeDefinition {
  type: DeployTargetType;
  label: string;
  supportsResourceDiscovery: boolean;
  supportsTest: boolean;
  configFields: DeployFieldDefinition[];
  bindingFields: DeployFieldDefinition[];
}

export interface DeployTarget {
  id: number;
  name: string;
  type: DeployTargetType | string;
  enabled: boolean;
  isDefault: boolean;
  config: DeployTargetConfig;
  jobCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertDeployTargetInput {
  name: string;
  type?: DeployTargetType;
  enabled?: boolean;
  isDefault?: boolean;
  config: DeployTargetConfig;
}

export interface DeployJobOrderSummary {
  id: number;
  primaryDomain: string;
  status: CertificateStatus;
  expiresAt?: string | null;
  autoRenew: boolean;
}

export interface DeployJobVendorOrderSummary {
  id: number;
  provider: VendorCertificateProvider;
  primaryDomain: string;
  status: VendorCertificateStatus;
  expiresAt?: string | null;
}

export interface DeployJobTargetSummary {
  id: number;
  name: string;
  type: DeployTargetType | string;
  enabled: boolean;
}

export interface DeployJob {
  id: number;
  certificateOrderId?: number | null;
  vendorCertificateOrderId?: number | null;
  sourceType: CertificateDeploySourceType;
  certificateDeployTargetId: number;
  enabled: boolean;
  triggerOnIssue: boolean;
  triggerOnRenew: boolean;
  binding?: DeployBindingConfig;
  lastStatus?: string | null;
  lastError?: string | null;
  lastTriggeredAt?: string | null;
  lastSucceededAt?: string | null;
  createdAt: string;
  updatedAt: string;
  certificateOrder?: DeployJobOrderSummary;
  vendorCertificateOrder?: DeployJobVendorOrderSummary;
  target?: DeployJobTargetSummary;
}

export interface CertificateTimelineEntry {
  id: string;
  category: CertificateTimelineCategory;
  tone: CertificateTimelineTone;
  title: string;
  description?: string | null;
  timestamp?: string | null;
  meta?: Record<string, any> | null;
}

export interface DeployJobRun {
  id: number;
  event: 'certificate.issued' | 'certificate.renewed' | string;
  triggerMode: 'manual' | 'auto' | string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | string;
  scheduledAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastError?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface DeployJobRunSummary {
  id: number;
  sourceType: CertificateDeploySourceType;
  primaryDomain: string;
  targetName: string;
  targetType: DeployTargetType | string;
  lastStatus?: string | null;
  lastError?: string | null;
  lastTriggeredAt?: string | null;
  lastSucceededAt?: string | null;
}

export interface UpsertDeployJobInput {
  certificateOrderId?: number | null;
  vendorCertificateOrderId?: number | null;
  certificateDeployTargetId: number;
  enabled?: boolean;
  triggerOnIssue?: boolean;
  triggerOnRenew?: boolean;
  binding?: DeployBindingConfig;
}

export interface DeployTargetResourcesResponse {
  type: DeployTargetType | string;
  resources: Record<string, Array<Record<string, any>>>;
}

export type VendorCertificateProvider = 'tencent_ssl' | 'aliyun_ssl' | 'ucloud_ssl';

export type VendorCertificateStatus =
  | 'queued'
  | 'pending_validation'
  | 'issuing'
  | 'issued'
  | 'failed';

export interface CertificateContactProfile {
  name?: string;
  phone?: string;
  email?: string;
  companyName?: string;
  companyAddress?: string;
  companyCountry?: string;
  companyRegion?: string;
  companyCity?: string;
  companyDivision?: string;
  companyPhone?: string;
  companyPostalCode?: string;
  title?: string;
}

export interface VendorCertificateProviderDefinition {
  provider: VendorCertificateProvider;
  label: string;
  description: string;
  vendorCredentialProvider: ProviderType;
  supportsDownload: boolean;
  supportsMultipleDomains: boolean;
  supportsWildcardDomains: boolean;
  requiresContactProfile: boolean;
}

export interface VendorCertificate {
  id: number;
  provider: VendorCertificateProvider;
  primaryDomain: string;
  domains: string[];
  status: VendorCertificateStatus;
  providerOrderId?: string | null;
  providerCertificateId?: string | null;
  contactProfile?: CertificateContactProfile | null;
  validationPayload?: Record<string, any> | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  canRetry: boolean;
  canDownload: boolean;
  deployJobsCount?: number;
  vendorCredentialId?: number | null;
  validationDnsCredentialId?: number | null;
  vendorCredential?: CertificateOrderDnsCredential;
  validationDnsCredential?: CertificateOrderDnsCredential;
}

export interface CreateVendorCertificateOrderInput {
  provider: VendorCertificateProvider;
  vendorCredentialId: number;
  validationDnsCredentialId: number;
  domains: string[];
  contactProfile?: CertificateContactProfile | null;
}

export interface CertificateAlias {
  id: number;
  domain: string;
  dnsCredentialId: number;
  zoneName: string;
  rr: string;
  targetFqdn: string;
  status: CertificateAliasStatus;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  dnsCredential?: CertificateOrderDnsCredential;
}

export interface UpsertCertificateAliasInput {
  domain: string;
  dnsCredentialId: number;
  zoneName: string;
  rr: string;
}

export interface CertificateSettingsChannels {
  email?: {
    enabled?: boolean;
    to?: string | null;
  };
  webhook?: {
    enabled?: boolean;
    url?: string | null;
    headers?: Record<string, string>;
  };
  telegram?: {
    enabled?: boolean;
    botToken?: string | null;
    hasBotToken?: boolean;
    chatId?: string | null;
    baseUrl?: string | null;
  };
  dingtalk?: {
    enabled?: boolean;
    webhookUrl?: string | null;
    secret?: string | null;
    hasSecret?: boolean;
    atMobiles?: string[];
    atAll?: boolean;
  };
  feishu?: {
    enabled?: boolean;
    webhookUrl?: string | null;
    atUserIds?: string[];
    atAll?: boolean;
  };
  wecom?: {
    enabled?: boolean;
    webhookUrl?: string | null;
  };
  wechatTemplate?: {
    enabled?: boolean;
    appToken?: string | null;
    hasAppToken?: boolean;
    uid?: string | null;
  };
}

export interface CertificateSettingsData {
  defaultContact: CertificateContactProfile;
  automation: {
    renewDays: number;
    deployHourStart: number;
    deployHourEnd: number;
    timezone: 'Asia/Shanghai';
  };
  notifications: {
    certificate: CertificateNotificationPolicy;
    deployment: CertificateNotificationPolicy;
    vendor: CertificateNotificationPolicy;
    manualRenewExpiry: CertificateNotificationPolicy;
    channels: CertificateSettingsChannels;
  };
}

export interface TestCertificateNotificationResult {
  channel: CertificateNotificationChannelKey;
  success: boolean;
  error?: string;
}

export const ACME_PROVIDER_LABELS: Record<AcmeProviderType, string> = {
  letsencrypt: "Let's Encrypt",
  zerossl: 'ZeroSSL',
  google: 'Google SSL',
  custom: 'Custom ACME',
};

export const DNS_PROVIDER_LABELS: Partial<Record<ProviderType, string>> = {
  cloudflare: 'Cloudflare',
  aliyun: '阿里云',
  dnspod: '腾讯云',
  dnspod_token: '腾讯云',
  ucloud: 'UCloud',
  huawei: '华为云',
  baidu: '百度云',
  west: '西部数码',
  huoshan: '火山引擎',
  jdcloud: '京东云',
  dnsla: 'DNSLA',
  namesilo: 'NameSilo',
  powerdns: 'PowerDNS',
  spaceship: 'Spaceship',
};

export const CERTIFICATE_STATUS_LABELS: Record<CertificateStatus, string> = {
  draft: '草稿',
  queued: '已排队',
  pending_dns: '准备写入 DNS',
  manual_dns_required: '需手动 DNS',
  waiting_dns_propagation: '等待 DNS 生效',
  validating: '验证中',
  issued: '已签发',
  failed: '失败',
};

export const DEPLOY_TARGET_TYPE_LABELS: Record<DeployTargetType, string> = {
  webhook: 'Webhook',
  dokploy: 'Dokploy',
  cloudflare_custom_hostname: 'Cloudflare Custom Hostname',
  aliyun_esa: '阿里云 ESA',
  aliyun_cdn: '阿里云 CDN',
  aliyun_dcdn: '阿里云 DCDN',
  aliyun_clb: '阿里云 CLB',
  aliyun_alb: '阿里云 ALB',
  aliyun_nlb: '阿里云 NLB',
  aliyun_oss: '阿里云 OSS',
  aliyun_waf: '阿里云 WAF',
  aliyun_fc: '阿里云函数计算',
  onepanel: '1Panel',
  nginx_proxy_manager: 'Nginx Proxy Manager',
  tencent_cdn: '腾讯云 CDN',
  tencent_edgeone: '腾讯云 EdgeOne',
  tencent_clb: '腾讯云 CLB',
  tencent_cos: '腾讯云 COS',
  tencent_tke: '腾讯云 TKE',
  tencent_scf: '腾讯云 SCF',
  huawei_cdn: '华为云 CDN',
  huawei_elb: '华为云 ELB',
  huawei_waf: '华为云 WAF',
  ucloud_cdn: 'UCloud CDN',
  qiniu_cdn: '七牛 CDN',
  qiniu_oss: '七牛 OSS',
  baidu_cdn: '百度云 CDN',
  volcengine_cdn: '火山引擎 CDN',
  dogecloud_cdn: 'DogeCloud CDN',
  aws_cloudfront: 'AWS CloudFront',
  gcore: 'Gcore',
  cachefly: 'Cachefly',
  allwaf: 'AllWAF',
  ssh_server: 'SSH Server',
  ftp_server: 'FTP Server',
  iis: 'IIS',
  local_directory: '本地目录',
};

export const VENDOR_CERTIFICATE_PROVIDER_LABELS: Record<VendorCertificateProvider, string> = {
  tencent_ssl: '腾讯云 SSL',
  aliyun_ssl: '阿里云 SSL',
  ucloud_ssl: 'UCloud SSL',
};

export const VENDOR_CERTIFICATE_STATUS_LABELS: Record<VendorCertificateStatus, string> = {
  queued: '排队中',
  pending_validation: '等待校验',
  issuing: '签发中',
  issued: '已签发',
  failed: '失败',
};

export const CERTIFICATE_ALIAS_STATUS_LABELS: Record<CertificateAliasStatus, string> = {
  pending: '待校验',
  ready: '已就绪',
  error: '异常',
};

export function getAcmeProviderLabel(provider?: AcmeProviderType | null): string {
  if (!provider) return '-';
  return ACME_PROVIDER_LABELS[provider] || provider;
}

export function getDnsProviderLabel(provider?: ProviderType | null): string {
  if (!provider) return '-';
  return DNS_PROVIDER_LABELS[provider] || provider;
}

export function getCertificateStatusLabel(status: CertificateStatus): string {
  return CERTIFICATE_STATUS_LABELS[status] || status;
}

export function getCertificateStatusColor(status: CertificateStatus): 'default' | 'info' | 'warning' | 'success' | 'error' {
  switch (status) {
    case 'draft':
      return 'default';
    case 'queued':
    case 'pending_dns':
    case 'waiting_dns_propagation':
    case 'validating':
      return 'warning';
    case 'manual_dns_required':
      return 'info';
    case 'issued':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
}

export function getRetryActionLabel(status: CertificateStatus): string {
  if (status === 'manual_dns_required') return '继续验证';
  if (status === 'draft') return '开始申请';
  return '重试';
}

export function getDeployTargetTypeLabel(type?: DeployTargetType | string | null, definitions?: DeployTargetTypeDefinition[]): string {
  if (!type) return '-';
  const matched = definitions?.find((item) => item.type === type);
  if (matched?.label) return matched.label;
  return DEPLOY_TARGET_TYPE_LABELS[type as DeployTargetType] || type;
}

export function getVendorCertificateProviderLabel(provider?: VendorCertificateProvider | null): string {
  if (!provider) return '-';
  return VENDOR_CERTIFICATE_PROVIDER_LABELS[provider] || provider;
}

export function getVendorCertificateStatusLabel(status?: VendorCertificateStatus | null): string {
  if (!status) return '-';
  return VENDOR_CERTIFICATE_STATUS_LABELS[status] || status;
}

export function getVendorCertificateStatusColor(status?: VendorCertificateStatus | null): 'default' | 'warning' | 'success' | 'error' | 'info' {
  switch (status) {
    case 'queued':
    case 'issuing':
      return 'warning';
    case 'pending_validation':
      return 'info';
    case 'issued':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
}

export function getCertificateAliasStatusLabel(status?: CertificateAliasStatus | null): string {
  if (!status) return '-';
  return CERTIFICATE_ALIAS_STATUS_LABELS[status] || status;
}

export function getCertificateAliasStatusColor(status?: CertificateAliasStatus | null): 'default' | 'warning' | 'success' | 'error' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'ready':
      return 'success';
    case 'error':
      return 'error';
    default:
      return 'default';
  }
}

export function getDeployJobSourceLabel(job: DeployJob): string {
  if (job.sourceType === 'vendor') {
    return job.vendorCertificateOrder?.primaryDomain || `厂商证书 #${job.vendorCertificateOrderId || '-'}`;
  }
  return job.certificateOrder?.primaryDomain || `ACME 证书 #${job.certificateOrderId || '-'}`;
}

export function summarizeDeployTargetConfig(target: DeployTarget): string {
  switch (target.type) {
    case 'webhook':
      return String(target.config?.url || '-');
    case 'dokploy':
      return String(target.config?.baseUrl || '-');
    case 'cloudflare_custom_hostname':
      return `DNS 凭证 #${target.config?.dnsCredentialId || '-'}`;
    case 'aliyun_esa':
      return `DNS 凭证 #${target.config?.dnsCredentialId || '-'}${target.config?.defaultRegion ? ` / ${target.config.defaultRegion}` : ''}`;
    case 'aliyun_cdn':
    case 'aliyun_dcdn':
    case 'aliyun_clb':
    case 'aliyun_alb':
    case 'aliyun_nlb':
    case 'aliyun_oss':
    case 'aliyun_waf':
    case 'aliyun_fc':
    case 'tencent_cdn':
    case 'tencent_edgeone':
    case 'tencent_clb':
    case 'tencent_cos':
    case 'tencent_tke':
    case 'tencent_scf':
    case 'huawei_cdn':
    case 'ucloud_cdn':
    case 'baidu_cdn':
    case 'volcengine_cdn':
      return `DNS 凭证 #${target.config?.dnsCredentialId || '-'}${target.config?.defaultRegion ? ` / ${target.config.defaultRegion}` : ''}`;
    case 'huawei_elb':
    case 'huawei_waf':
      return [
        `DNS 凭证 #${target.config?.dnsCredentialId || '-'}`,
        target.config?.defaultRegion,
        target.config?.defaultProjectId,
      ].filter(Boolean).join(' / ');
    case 'qiniu_cdn':
    case 'qiniu_oss':
      return target.config?.accessKey ? `AK ${String(target.config.accessKey).slice(0, 6)}...` : '-';
    case 'dogecloud_cdn':
      return target.config?.accessKey ? `AK ${String(target.config.accessKey).slice(0, 6)}...` : '-';
    case 'aws_cloudfront':
      return target.config?.accessKeyId ? `AK ${String(target.config.accessKeyId).slice(0, 6)}...` : '-';
    case 'gcore':
      return target.config?.hasApiToken ? 'API Token 已配置' : '-';
    case 'cachefly':
      return target.config?.hasApiToken ? 'API Token 已配置' : '-';
    case 'allwaf':
      return String(target.config?.baseUrl || '-');
    case 'ssh_server':
    case 'iis':
      return [target.config?.host, target.config?.port || 22, target.config?.username]
        .filter(Boolean)
        .join(' / ') || '-';
    case 'ftp_server':
      return `${target.config?.secure ? 'FTPS' : 'FTP'} / ${target.config?.host || '-'}:${target.config?.port || 21}`;
    case 'onepanel':
    case 'nginx_proxy_manager':
      return String(target.config?.baseUrl || '-');
    case 'local_directory':
      return '本机目录写入';
    default:
      return '-';
  }
}

export function summarizeDeployJobBinding(job: DeployJob): string {
  const binding = job.binding || {};
  const type = job.target?.type;

  switch (type) {
    case 'dokploy':
      return String(binding.fileNamePrefix || '{primaryDomain}');
    case 'cloudflare_custom_hostname':
      return [binding.zoneId, binding.hostname].filter(Boolean).join(' / ') || '-';
    case 'aliyun_esa':
      return String(binding.siteId || '-');
    case 'aliyun_cdn':
    case 'aliyun_dcdn':
    case 'tencent_cdn':
    case 'tencent_edgeone':
    case 'huawei_cdn':
    case 'qiniu_cdn':
    case 'qiniu_oss':
    case 'baidu_cdn':
    case 'volcengine_cdn':
    case 'dogecloud_cdn':
      return String(binding.domain || binding.domains || '-');
    case 'aliyun_clb':
      return [binding.loadBalancerId, binding.listenerPort].filter(Boolean).join(' / ') || '-';
    case 'aliyun_alb':
    case 'aliyun_nlb':
      return String(binding.listenerId || '-');
    case 'aliyun_oss':
      return [binding.endpoint, binding.bucket, binding.domain].filter(Boolean).join(' / ') || '-';
    case 'aliyun_waf':
      return [binding.instanceId, binding.domain].filter(Boolean).join(' / ') || String(binding.domain || '-');
    case 'aliyun_fc':
      return [binding.regionId, binding.customDomain].filter(Boolean).join(' / ') || '-';
    case 'tencent_clb':
      return [binding.loadBalancerId, binding.listenerId || binding.domain].filter(Boolean).join(' / ') || '-';
    case 'tencent_cos':
      return [binding.bucket, binding.regionId].filter(Boolean).join(' / ') || '-';
    case 'tencent_tke':
      return [binding.clusterId, binding.namespace, binding.secretName].filter(Boolean).join(' / ') || '-';
    case 'tencent_scf':
      return [binding.regionId, binding.namespace, binding.functionName].filter(Boolean).join(' / ') || '-';
    case 'huawei_elb':
      return [binding.listenerId, binding.certificateId].filter(Boolean).join(' / ') || '-';
    case 'huawei_waf':
      return [binding.domain, binding.certificateId].filter(Boolean).join(' / ') || '-';
    case 'ucloud_cdn':
      return String(binding.domainId || '-');
    case 'aws_cloudfront':
      return [binding.distributionId, binding.acmCertificateArn].filter(Boolean).join(' / ') || '-';
    case 'gcore':
      return [binding.certificateId, binding.certificateName].filter(Boolean).join(' / ') || '-';
    case 'cachefly':
      return String(binding.serviceId || binding.domains || '-');
    case 'allwaf':
      return String(binding.domain || binding.siteId || '-');
    case 'ssh_server':
      if (binding.format === 'pfx') return binding.pfxFilePath ? `PFX / ${binding.pfxFilePath}` : 'PFX';
      return [binding.certificateFilePath, binding.privateKeyFilePath].filter(Boolean).join(' / ') || 'PEM';
    case 'ftp_server':
      if (binding.format === 'pfx') return binding.pfxFilePath ? `PFX / ${binding.pfxFilePath}` : 'PFX';
      return [binding.certificateFilePath, binding.privateKeyFilePath].filter(Boolean).join(' / ') || 'PEM';
    case 'iis':
      return [binding.siteName, binding.bindingHost || `:${binding.port || 443}`].filter(Boolean).join(' / ') || '-';
    case 'onepanel':
      return binding.websiteId ? `网站 #${binding.websiteId}` : '-';
    case 'nginx_proxy_manager':
      return binding.proxyHostId ? `Proxy Host #${binding.proxyHostId}` : '-';
    case 'local_directory':
      return String(binding.certificateFilePath || '-');
    default:
      return '-';
  }
}
