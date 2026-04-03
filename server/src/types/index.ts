import { Request } from 'express';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    email: string;
  };
}

export type DNSRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'CAA' | 'NS' | 'PTR';

export type ActionType = 'CREATE' | 'UPDATE' | 'DELETE';

export type ResourceType =
  | 'DNS'
  | 'ZONE'
  | 'HOSTNAME'
  | 'TUNNEL'
  | 'USER'
  | 'FALLBACK_ORIGIN'
  | 'CREDENTIAL'
  | 'DOMAIN_EXPIRY'
  | 'CERTIFICATE'
  | 'CERTIFICATE_CREDENTIAL'
  | 'CERTIFICATE_DEPLOY';

export type OperationStatus = 'SUCCESS' | 'FAILED';

export interface DNSRecord {
  id: string;
  type: DNSRecordType;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number;
}

export interface Domain {
  id: string;
  name: string;
  status: string;
  recordCount?: number;
  updatedAt?: string;
  type?: string;
  nameServers?: string[];
  vanityNameServers?: string[];
  activatedOn?: string;
}

export interface LogCreateParams {
  userId: number;
  action: ActionType;
  resourceType: ResourceType;
  domain?: string;
  recordName?: string;
  recordType?: string;
  oldValue?: string;
  newValue?: string;
  status: OperationStatus;
  errorMessage?: string;
  ipAddress?: string;
}

export type CertificateStatus =
  | 'draft'
  | 'queued'
  | 'pending_dns'
  | 'manual_dns_required'
  | 'waiting_dns_propagation'
  | 'validating'
  | 'issued'
  | 'failed';

export type AcmeProviderType = 'letsencrypt' | 'zerossl' | 'google' | 'custom';

export type CertificateDeployTargetType =
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

export type VendorCertificateProvider = 'tencent_ssl' | 'aliyun_ssl' | 'ucloud_ssl';

export type VendorCertificateStatus = 'queued' | 'pending_validation' | 'issuing' | 'issued' | 'failed';

export type CertificateAliasStatus = 'pending' | 'ready' | 'error';

export type CertificateDeployEvent = 'certificate.issued' | 'certificate.renewed';
export type CertificateDeployRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';
export type CertificateDeployTriggerMode = 'manual' | 'auto';
export type CertificateNotificationPolicy = 'off' | 'all' | 'fail_only';

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
    chatId?: string | null;
    baseUrl?: string | null;
  };
  dingtalk?: {
    enabled?: boolean;
    webhookUrl?: string | null;
    secret?: string | null;
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
