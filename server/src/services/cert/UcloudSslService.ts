import type { UcloudAuth } from '../../providers/ucloud/auth';
import { UcloudApiService } from './UcloudApiService';

export interface UcloudSslValidationAuth {
  authKey: string;
  authValue: string;
  domain: string;
  authType?: string;
  authMethod?: string;
  authRecord?: string;
}

export class UcloudSslService {
  static async getCertificateList(auth: UcloudAuth) {
    return await UcloudApiService.call<any>(auth, 'GetCertificateList', { Mode: 'free' });
  }

  static async purchaseCertificate(auth: UcloudAuth, input: { domainsCount?: number; validYear?: number }) {
    const response = await UcloudApiService.call<any>(auth, 'PurchaseCertificate', {
      CertificateBrand: 'TrustAsia',
      CertificateName: 'TrustAsiaC1DVFree',
      DomainsCount: Math.max(1, Number(input.domainsCount || 1)),
      ValidYear: Math.max(1, Number(input.validYear || 1)),
    });

    return {
      certificateId: Number(response.CertificateID || 0),
    };
  }

  static async complementCsrInfo(auth: UcloudAuth, input: Record<string, any>) {
    return await UcloudApiService.call<any>(auth, 'ComplementCSRInfo', input);
  }

  static async getDvAuthInfo(auth: UcloudAuth, certificateId: number) {
    const response = await UcloudApiService.call<any>(auth, 'GetDVAuthInfo', {
      CertificateID: certificateId,
    });

    const auths = Array.isArray(response.Auths)
      ? response.Auths.map((item: any) => ({
          authKey: String(item.AuthKey || item.authKey || '').trim(),
          authValue: String(item.AuthValue || item.authValue || '').trim(),
          domain: String(item.Domain || item.domain || '').trim(),
          authType: String(item.AuthType || item.authType || '').trim(),
          authMethod: String(item.AuthMethod || item.authMethod || '').trim(),
          authRecord: String(item.AuthRecord || item.authRecord || '').trim(),
        })).filter((item: UcloudSslValidationAuth) => item.authKey && item.authValue && item.domain)
      : [];

    return {
      authMethod: String(response.AuthMethod || '').trim(),
      auths,
      raw: response,
    };
  }

  static async getCertificateDetailInfo(auth: UcloudAuth, certificateId: number) {
    return await UcloudApiService.call<any>(auth, 'GetCertificateDetailInfo', {
      CertificateID: certificateId,
    });
  }

  static async downloadCertificate(auth: UcloudAuth, certificateId: number) {
    return await UcloudApiService.call<any>(auth, 'DownloadCertificate', {
      CertificateID: certificateId,
    });
  }
}
