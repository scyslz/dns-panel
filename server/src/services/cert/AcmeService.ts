import * as acme from 'acme-client';
import { AuthorityKeyIdentifierExtension, X509Certificate } from '@peculiar/x509';
import { config } from '../../config';
import { AcmeProviderType } from '../../types';

export interface CertificateCredentialSecretsInput {
  provider: AcmeProviderType;
  email: string;
  directoryUrl?: string | null;
  eabKid?: string | null;
  eabHmacKey?: string | null;
  accountKeyPem?: string | null;
  accountUrl?: string | null;
}

export interface AcmeProviderOption {
  provider: AcmeProviderType;
  label: string;
  defaultDirectoryUrl: string;
  requiresDirectoryUrl: boolean;
  supportsEab: boolean;
}

export interface CertificateChallengeState {
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
  effectiveDnsCredentialId?: number | null;
  aliasDomain?: string | null;
  aliasStatus?: string | null;
  aliasTargetFqdn?: string | null;
  aliasDnsCredentialId?: number | null;
}

export interface CertificateOrderState {
  orderUrl: string;
  challenges: CertificateChallengeState[];
  workflow?: 'issue' | 'renew';
  phase?: 'pending_dns' | 'manual_dns_required' | 'waiting_dns_propagation' | 'validating';
  replaces?: string | null;
  renewalPrivateKeyPem?: string | null;
}

export interface CertificateRenewalInfo {
  supported: boolean;
  certId: string;
  directoryUrl: string;
  suggestedWindowStart?: Date | null;
  suggestedWindowEnd?: Date | null;
  explanationUrl?: string | null;
  retryAfterSeconds?: number | null;
}

const PROVIDER_OPTIONS: Record<AcmeProviderType, Omit<AcmeProviderOption, 'defaultDirectoryUrl'>> = {
  letsencrypt: { label: "Let's Encrypt", requiresDirectoryUrl: false, supportsEab: false, provider: 'letsencrypt' },
  zerossl: { label: 'ZeroSSL', requiresDirectoryUrl: false, supportsEab: true, provider: 'zerossl' },
  google: { label: 'Google SSL', requiresDirectoryUrl: false, supportsEab: true, provider: 'google' },
  custom: { label: 'Custom ACME', requiresDirectoryUrl: true, supportsEab: true, provider: 'custom' },
};

function toPemString(input: Buffer | string): string {
  return Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
}

function toBase64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeHex(input: string): string {
  return String(input || '').trim().toLowerCase().replace(/[^a-f0-9]/g, '');
}

function parseDateValue(value: any): Date | null {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function toAsciiDomain(domain: string): string {
  const normalized = String(domain || '').trim().toLowerCase();
  if (!normalized) return '';
  const wildcard = normalized.startsWith('*.') ? '*.' : '';
  const body = wildcard ? normalized.slice(2) : normalized;
  return `${wildcard}${body}`;
}

function buildRecordHost(identifier: string, zoneName: string): string {
  const normalizedIdentifier = toAsciiDomain(identifier).replace(/^\*\./, '');
  const normalizedZone = toAsciiDomain(zoneName).replace(/^\*\./, '');
  if (normalizedIdentifier === normalizedZone) return '_acme-challenge';
  if (normalizedIdentifier.endsWith(`.${normalizedZone}`)) {
    const prefix = normalizedIdentifier.slice(0, -(normalizedZone.length + 1));
    return `_acme-challenge.${prefix}`;
  }
  return `_acme-challenge.${normalizedIdentifier}`;
}

function buildManualRecordName(identifier: string): string {
  const normalized = toAsciiDomain(identifier).replace(/^\*\./, '');
  return `_acme-challenge.${normalized}`;
}

export class AcmeService {
  static listProviders(): AcmeProviderOption[] {
    return (Object.keys(PROVIDER_OPTIONS) as AcmeProviderType[]).map((provider) => ({
      ...PROVIDER_OPTIONS[provider],
      defaultDirectoryUrl: provider === 'custom' ? '' : this.resolveDirectoryUrl(provider, undefined),
    }));
  }

  static resolveDirectoryUrl(provider: AcmeProviderType, customDirectoryUrl?: string | null): string {
    const env = config.acme.env;
    switch (provider) {
      case 'letsencrypt':
        return env === 'production' ? acme.directory.letsencrypt.production : acme.directory.letsencrypt.staging;
      case 'google':
        return env === 'production' ? acme.directory.google.production : acme.directory.google.staging;
      case 'zerossl':
        return acme.directory.zerossl.production;
      case 'custom': {
        const resolved = String(customDirectoryUrl || '').trim();
        if (!resolved) throw new Error('Custom ACME 必须填写 directoryUrl');
        return resolved;
      }
      default:
        throw new Error(`不支持的 ACME 提供商: ${provider}`);
    }
  }

  static async createAccountKeyPem(): Promise<string> {
    const key = await acme.crypto.createPrivateRsaKey(2048);
    return toPemString(key);
  }

  static createClient(input: Required<Pick<CertificateCredentialSecretsInput, 'provider' | 'email'>> & {
    directoryUrl?: string | null;
    eabKid?: string | null;
    eabHmacKey?: string | null;
    accountKeyPem: string;
    accountUrl?: string | null;
  }): acme.Client {
    const directoryUrl = this.resolveDirectoryUrl(input.provider, input.directoryUrl);
    const externalAccountBinding = input.eabKid && input.eabHmacKey
      ? { kid: input.eabKid, hmacKey: input.eabHmacKey }
      : undefined;

    return new acme.Client({
      directoryUrl,
      accountKey: input.accountKeyPem,
      accountUrl: input.accountUrl || undefined,
      externalAccountBinding,
    });
  }

  static async validateAndProvisionCredential(input: CertificateCredentialSecretsInput): Promise<{
    accountKeyPem: string;
    accountUrl: string;
    directoryUrl: string;
  }> {
    const provider = input.provider;
    const email = String(input.email || '').trim();
    if (!email) throw new Error('邮箱不能为空');

    const accountKeyPem = String(input.accountKeyPem || '').trim() || await this.createAccountKeyPem();
    const directoryUrl = this.resolveDirectoryUrl(provider, input.directoryUrl);
    const client = this.createClient({
      provider,
      email,
      directoryUrl,
      eabKid: input.eabKid || undefined,
      eabHmacKey: input.eabHmacKey || undefined,
      accountKeyPem,
      accountUrl: input.accountUrl || undefined,
    });

    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${email}`],
    });

    const accountUrl = client.getAccountUrl();
    if (!accountUrl) throw new Error('ACME 账户注册成功但未返回 accountUrl');

    return { accountKeyPem, accountUrl, directoryUrl };
  }

  static async createOrderState(input: CertificateCredentialSecretsInput & {
    domains: string[];
    existingPrivateKeyPem?: string | null;
    replaces?: string | null;
  }): Promise<{
    orderState: CertificateOrderState;
    privateKeyPem: string;
    accountUrl: string;
    directoryUrl: string;
  }> {
    const provider = input.provider;
    const email = String(input.email || '').trim();
    const accountKeyPem = String(input.accountKeyPem || '').trim();
    if (!accountKeyPem) throw new Error('缺少 ACME 账户私钥');

    const directoryUrl = this.resolveDirectoryUrl(provider, input.directoryUrl);
    const client = this.createClient({
      provider,
      email,
      directoryUrl,
      eabKid: input.eabKid || undefined,
      eabHmacKey: input.eabHmacKey || undefined,
      accountKeyPem,
      accountUrl: input.accountUrl || undefined,
    });

    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${email}`],
    });

    const order = await client.createOrder({
      identifiers: input.domains.map((domain) => ({ type: 'dns', value: toAsciiDomain(domain) })),
      ...(input.replaces ? { replaces: input.replaces } : {}),
    });

    const authorizations = await client.getAuthorizations(order);
    const challenges: CertificateChallengeState[] = [];

    for (const authz of authorizations) {
      const identifier = String(authz.identifier?.value || '').trim();
      const dnsChallenge = (authz.challenges || []).find((item) => item.type === 'dns-01');
      if (!identifier || !dnsChallenge) {
        throw new Error(`域名 ${identifier || '(unknown)'} 未返回 dns-01 challenge`);
      }

      const recordValue = await client.getChallengeKeyAuthorization(dnsChallenge);
      const manualRecordName = buildManualRecordName(identifier);
      challenges.push({
        domain: identifier,
        identifier,
        authorizationUrl: authz.url,
        challengeUrl: dnsChallenge.url,
        token: dnsChallenge.token,
        type: dnsChallenge.type,
        recordHost: manualRecordName,
        recordName: manualRecordName,
        recordValue,
        mode: 'manual',
      });
    }

    const privateKeyPem = String(input.existingPrivateKeyPem || '').trim() || toPemString(await acme.crypto.createPrivateRsaKey(2048));
    return {
      orderState: {
        orderUrl: order.url,
        challenges,
        workflow: 'issue',
        phase: 'pending_dns',
        replaces: input.replaces || null,
      },
      privateKeyPem,
      accountUrl: client.getAccountUrl(),
      directoryUrl,
    };
  }

  static async finalizeOrder(input: CertificateCredentialSecretsInput & {
    domains: string[];
    privateKeyPem: string;
    orderState: CertificateOrderState;
  }): Promise<{
    certificatePem: string;
    fullchainPem: string;
    issuedAt?: Date;
    expiresAt?: Date;
    accountUrl: string;
  }> {
    const provider = input.provider;
    const email = String(input.email || '').trim();
    const accountKeyPem = String(input.accountKeyPem || '').trim();
    if (!accountKeyPem) throw new Error('缺少 ACME 账户私钥');
    const directoryUrl = this.resolveDirectoryUrl(provider, input.directoryUrl);

    const client = this.createClient({
      provider,
      email,
      directoryUrl,
      eabKid: input.eabKid || undefined,
      eabHmacKey: input.eabHmacKey || undefined,
      accountKeyPem,
      accountUrl: input.accountUrl || undefined,
    });

    const orderRef: acme.Order = { url: input.orderState.orderUrl } as acme.Order;

    for (const item of input.orderState.challenges) {
      const authzRef = {
        url: item.authorizationUrl,
        identifier: { type: 'dns', value: item.identifier },
      } as any;
      const challengeRef = {
        url: item.challengeUrl,
        token: item.token,
        type: item.type,
      } as any;
      await client.verifyChallenge(authzRef, challengeRef);
      await client.completeChallenge(challengeRef);
      await client.waitForValidStatus(challengeRef);
    }

    const [, csr] = await acme.crypto.createCsr({
      commonName: input.domains[0],
      altNames: input.domains,
    }, input.privateKeyPem);

    const liveOrder = await client.getOrder(orderRef);
    const finalizedOrder = await client.finalizeOrder(liveOrder, csr);
    const validOrder = await client.waitForValidStatus(finalizedOrder);
    const fullchainPem = await client.getCertificate(validOrder);
    const pemChain = acme.crypto.splitPemChain(fullchainPem);
    const certificatePem = pemChain[0] || fullchainPem;
    const info = acme.crypto.readCertificateInfo(certificatePem);

    return {
      certificatePem,
      fullchainPem,
      issuedAt: info?.notBefore,
      expiresAt: info?.notAfter,
      accountUrl: client.getAccountUrl(),
    };
  }

  static getChallengeRecordHost(identifier: string, zoneName: string): string {
    return buildRecordHost(identifier, zoneName);
  }

  static buildAriCertId(certificatePem: string): string {
    const cert = new X509Certificate(certificatePem);
    const akiExt = cert.extensions.find((item) => item.type === '2.5.29.35') as AuthorityKeyIdentifierExtension | undefined;
    const akiHex = normalizeHex((akiExt as any)?.keyId || '');
    if (!akiHex) throw new Error('证书缺少 AKI，无法查询 ARI');

    const serialRaw = normalizeHex(cert.serialNumber);
    if (!serialRaw) throw new Error('证书缺少序列号，无法查询 ARI');
    let serialHex = serialRaw.length % 2 === 1 ? `0${serialRaw}` : serialRaw;
    const firstByte = parseInt(serialHex.slice(0, 2), 16);
    if (Number.isFinite(firstByte) && firstByte >= 0x80) {
      serialHex = `00${serialHex}`;
    }

    return `${toBase64Url(Buffer.from(akiHex, 'hex'))}.${toBase64Url(Buffer.from(serialHex, 'hex'))}`;
  }

  static async getRenewalInfo(input: CertificateCredentialSecretsInput & {
    certificatePem: string;
  }): Promise<CertificateRenewalInfo> {
    const directoryUrl = this.resolveDirectoryUrl(input.provider, input.directoryUrl);
    const certId = this.buildAriCertId(input.certificatePem);

    const directoryResp = await fetch(directoryUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'dns-panel/1.0 (certificate-renewal-ari)',
      },
    });
    if (!directoryResp.ok) {
      throw new Error(`获取 ACME Directory 失败: HTTP ${directoryResp.status}`);
    }

    const directory = await directoryResp.json().catch(() => null) as any;
    const renewalInfoBase = String(directory?.renewalInfo || '').trim();
    if (!renewalInfoBase) {
      return {
        supported: false,
        certId,
        directoryUrl,
      };
    }

    const renewalInfoUrl = `${renewalInfoBase.replace(/\/+$/g, '')}/${certId}`;
    const renewalResp = await fetch(renewalInfoUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'dns-panel/1.0 (certificate-renewal-ari)',
      },
    });
    if (!renewalResp.ok) {
      throw new Error(`获取 ARI renewalInfo 失败: HTTP ${renewalResp.status}`);
    }

    const renewalInfo = await renewalResp.json().catch(() => null) as any;
    const retryAfterRaw = renewalResp.headers.get('retry-after');
    const retryAfterSeconds = retryAfterRaw && /^\d+$/.test(retryAfterRaw) ? parseInt(retryAfterRaw, 10) : null;

    return {
      supported: true,
      certId,
      directoryUrl,
      suggestedWindowStart: parseDateValue(renewalInfo?.suggestedWindow?.start),
      suggestedWindowEnd: parseDateValue(renewalInfo?.suggestedWindow?.end),
      explanationUrl: typeof renewalInfo?.explanationURL === 'string' ? renewalInfo.explanationURL.trim() || null : null,
      retryAfterSeconds,
    };
  }
}
