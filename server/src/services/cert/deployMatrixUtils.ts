import { X509Certificate } from 'node:crypto';
import forge from 'node-forge';

export interface ParsedCertificateMeta {
  commonName: string;
  serialNumber: string;
  validFromTimestamp: number;
  validToTimestamp: number;
}

export function splitPemCertificates(pem: string): string[] {
  return String(pem || '')
    .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
    ?.map((item) => item.trim()) || [];
}

export function getLeafCertificatePem(fullchainPem: string): string {
  return splitPemCertificates(fullchainPem)[0] || String(fullchainPem || '').trim();
}

export function parseCertificateMeta(fullchainPem: string, fallbackCommonName: string): ParsedCertificateMeta {
  const leafPem = getLeafCertificatePem(fullchainPem);
  const certificate = new X509Certificate(leafPem);
  const subject = certificate.subject || '';
  const match = subject.match(/(?:^|\n|,\s*)CN=([^,\n]+)/i);
  const commonName = (match?.[1] || fallbackCommonName || '').trim();
  const validFromTimestamp = Date.parse(certificate.validFrom);
  const validToTimestamp = Date.parse(certificate.validTo);
  return {
    commonName,
    serialNumber: certificate.serialNumber || '',
    validFromTimestamp: Number.isFinite(validFromTimestamp) ? Math.floor(validFromTimestamp / 1000) : Math.floor(Date.now() / 1000),
    validToTimestamp: Number.isFinite(validToTimestamp) ? Math.floor(validToTimestamp / 1000) : Math.floor(Date.now() / 1000),
  };
}

export function buildRemoteCertificateName(fullchainPem: string, fallbackPrimaryDomain: string): string {
  const meta = parseCertificateMeta(fullchainPem, fallbackPrimaryDomain);
  return `${meta.commonName.replace(/^\*\./, '') || fallbackPrimaryDomain}-${meta.validFromTimestamp}`;
}

export function parseTextareaList(value: any): string[] {
  const set = new Set<string>();
  const output: string[] = [];
  for (const raw of String(value || '').split(/[\n,;]+/g)) {
    const item = raw.trim();
    if (!item) continue;
    if (set.has(item)) continue;
    set.add(item);
    output.push(item);
  }
  return output;
}

export function mergeBinding<T extends Record<string, any> | null | undefined>(current: T, patch: Record<string, any>) {
  return {
    ...(current && typeof current === 'object' ? current : {}),
    ...patch,
  };
}

export function buildPfxBuffer(fullchainPem: string, privateKeyPem: string, password?: string | null): Buffer {
  const certChain = splitPemCertificates(fullchainPem).map((item) => forge.pki.certificateFromPem(item));
  if (certChain.length === 0) {
    throw new Error('证书链为空，无法生成 PFX');
  }
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, certChain, password || '', {
    algorithm: '3des',
  });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(der, 'binary');
}

export function quotePowerShellSingle(value: string): string {
  return String(value || '').replace(/'/g, "''");
}
