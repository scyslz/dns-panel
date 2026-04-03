import { buildTc3Headers, Tc3Credentials } from '../../providers/dnspod/auth';
import { requestJson } from './httpClient';

const TENCENT_SSL_HOSTS = ['ssl.tencentcloudapi.com', 'ssl.intl.tencentcloudapi.com'];
const TENCENT_SSL_VERSION = '2019-12-05';

interface TencentResponse<T> {
  Response?: T & {
    RequestId?: string;
    Error?: { Code?: string; Message?: string };
  };
}

export interface TencentSslCertificateSummary {
  certificateId: string;
  domain: string;
  alias?: string;
  status?: number;
  statusName?: string;
  verifyType?: string;
  certBeginTime?: string;
  certEndTime?: string;
  subjectAltName: string[];
  allowDownload?: boolean | null;
  isDnsPodResolve?: boolean | null;
  awaitingValidationMsg?: string | null;
}

async function callTencentSslApi<T>(
  creds: Tc3Credentials,
  action: string,
  payload: Record<string, any>,
  timeoutMs = 12000
): Promise<T> {
  const body = JSON.stringify(payload || {});
  let lastError: any;

  for (const host of TENCENT_SSL_HOSTS) {
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const response = await requestJson<TencentResponse<T>>({
        url: `https://${host}/`,
        method: 'POST',
        timeoutMs,
        body,
        headers: {
          ...buildTc3Headers(creds, {
            host,
            service: 'ssl',
            action,
            version: TENCENT_SSL_VERSION,
            timestamp,
            payload: body,
          }),
        },
      });

      const data = response.data?.Response;
      if (data?.Error?.Code) {
        const err: any = new Error(data.Error.Message || data.Error.Code);
        err.code = data.Error.Code;
        err.requestId = data.RequestId;
        throw err;
      }

      if (response.status >= 200 && response.status < 300 && data) {
        return data as T;
      }

      throw new Error(`腾讯云 SSL 请求失败: HTTP ${response.status}`);
    } catch (error: any) {
      lastError = error;
      const message = String(error?.message || '');
      if (!/network|timeout|econn|fetch|socket|enotfound|tls/i.test(message)) {
        break;
      }
    }
  }

  throw lastError || new Error('腾讯云 SSL 请求失败');
}

function mapCertificate(item: any): TencentSslCertificateSummary {
  return {
    certificateId: String(item?.CertificateId || '').trim(),
    domain: String(item?.Domain || '').trim(),
    alias: item?.Alias ? String(item.Alias) : undefined,
    status: typeof item?.Status === 'number' ? item.Status : (typeof item?.Status === 'string' ? Number(item.Status) : undefined),
    statusName: item?.StatusName ? String(item.StatusName) : undefined,
    verifyType: item?.VerifyType ? String(item.VerifyType) : undefined,
    certBeginTime: item?.CertBeginTime ? String(item.CertBeginTime) : undefined,
    certEndTime: item?.CertEndTime ? String(item.CertEndTime) : undefined,
    subjectAltName: Array.isArray(item?.SubjectAltName) ? item.SubjectAltName.map((name: any) => String(name || '').trim()).filter(Boolean) : [],
    allowDownload: item?.AllowDownload === undefined || item?.AllowDownload === null ? null : !!item.AllowDownload,
    isDnsPodResolve: item?.IsDNSPODResolve === undefined || item?.IsDNSPODResolve === null ? null : !!item.IsDNSPODResolve,
    awaitingValidationMsg: item?.AwaitingValidationMsg ? String(item.AwaitingValidationMsg) : null,
  };
}

export class TencentSslService {
  static async applyCertificate(creds: Tc3Credentials, input: { domain: string; alias?: string; oldCertificateId?: string | null; authMethod?: 'DNS' | 'DNS_AUTO'; contactEmail?: string | null; csrEncryptAlgo?: 'RSA' | 'ECC'; csrKeyParameter?: string | null }) {
    const response = await callTencentSslApi<{ CertificateId: string; RequestId?: string }>(creds, 'ApplyCertificate', {
      DvAuthMethod: input.authMethod || 'DNS_AUTO',
      DomainName: input.domain,
      ContactEmail: input.contactEmail || undefined,
      PackageType: '83',
      ValidityPeriod: '3',
      CsrEncryptAlgo: input.csrEncryptAlgo || 'RSA',
      CsrKeyParameter: input.csrKeyParameter || (input.csrEncryptAlgo === 'ECC' ? 'prime256v1' : '2048'),
      Alias: input.alias || undefined,
      OldCertificateId: input.oldCertificateId || undefined,
      DeleteDnsAutoRecord: input.authMethod === 'DNS_AUTO' ? false : undefined,
    });

    return {
      certificateId: String(response.CertificateId || '').trim(),
      requestId: response.RequestId ? String(response.RequestId) : undefined,
    };
  }

  static async describeCertificate(creds: Tc3Credentials, certificateId: string) {
    return await callTencentSslApi<any>(creds, 'DescribeCertificate', {
      CertificateId: certificateId,
    });
  }

  static async completeCertificate(creds: Tc3Credentials, certificateId: string) {
    return await callTencentSslApi<any>(creds, 'CompleteCertificate', {
      CertificateId: certificateId,
    });
  }

  static async describeCertificates(creds: Tc3Credentials, input?: { certificateIds?: string[]; searchKey?: string; limit?: number; offset?: number }) {
    const response = await callTencentSslApi<{ TotalCount?: number; Certificates?: any[]; RequestId?: string }>(creds, 'DescribeCertificates', {
      Limit: Math.max(1, Math.min(100, Number(input?.limit || 20))),
      Offset: Math.max(0, Number(input?.offset || 0)),
      SearchKey: input?.searchKey || undefined,
      CertIds: Array.isArray(input?.certificateIds) && input!.certificateIds!.length ? input!.certificateIds : undefined,
      CertificateType: 'SVR',
    });

    const certificates = Array.isArray(response.Certificates) ? response.Certificates.map(mapCertificate).filter((item) => item.certificateId) : [];
    return {
      total: typeof response.TotalCount === 'number' ? response.TotalCount : certificates.length,
      certificates,
      requestId: response.RequestId ? String(response.RequestId) : undefined,
    };
  }

  static async downloadCertificate(creds: Tc3Credentials, certificateId: string) {
    const response = await callTencentSslApi<{ Content?: string; ContentType?: string; RequestId?: string }>(creds, 'DownloadCertificate', {
      CertificateId: certificateId,
    });

    return {
      contentBase64: response.Content ? String(response.Content) : '',
      contentType: response.ContentType ? String(response.ContentType) : '',
      requestId: response.RequestId ? String(response.RequestId) : undefined,
    };
  }
}
