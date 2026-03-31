import { buildCanonicalizedQuery, buildSignedQuery, type AliyunAuth } from '../../providers/aliyun/auth';
import { requestJson } from './httpClient';

interface AliyunCasResponseBase {
  RequestId?: string;
  Code?: string;
  Message?: string;
}

const CAS_HOST = 'cas.aliyuncs.com';
const CAS_VERSION = '2020-04-07';

async function callAliyunCasApi<T extends Record<string, any> = Record<string, any>>(
  auth: AliyunAuth,
  action: string,
  params: Record<string, any> = {},
  timeoutMs = 12000,
): Promise<T> {
  const query = buildSignedQuery(auth, action, params, { version: CAS_VERSION, method: 'GET' });
  const url = `https://${CAS_HOST}/?${buildCanonicalizedQuery(query)}`;
  const response = await requestJson<AliyunCasResponseBase & T>({
    url,
    method: 'GET',
    timeoutMs,
    headers: {
      'User-Agent': 'dns-panel/1.0 (aliyun-cas)',
    },
  });

  const data = (response.data || {}) as AliyunCasResponseBase & T;
  if (data.Code) {
    const error: any = new Error(String(data.Message || data.Code));
    error.code = data.Code;
    error.requestId = data.RequestId;
    throw error;
  }
  if (response.status >= 400) {
    throw new Error(`阿里云 CAS 请求失败: HTTP ${response.status}`);
  }
  return data as T;
}

export class AliyunCasService {
  static async describePackageState(auth: AliyunAuth, productCode = 'digicert-free-1-free') {
    return await callAliyunCasApi<any>(auth, 'DescribePackageState', {
      ProductCode: productCode,
    });
  }

  static async createCertificateRequest(auth: AliyunAuth, input: {
    productCode?: string;
    username: string;
    phone: string;
    email: string;
    domain: string;
    validateType?: 'DNS' | 'FILE';
  }) {
    return await callAliyunCasApi<any>(auth, 'CreateCertificateRequest', {
      ProductCode: input.productCode || 'digicert-free-1-free',
      Username: input.username,
      Phone: input.phone,
      Email: input.email,
      Domain: input.domain,
      ValidateType: input.validateType || 'DNS',
    });
  }

  static async describeCertificateState(auth: AliyunAuth, orderId: string | number) {
    return await callAliyunCasApi<any>(auth, 'DescribeCertificateState', {
      OrderId: orderId,
    });
  }
}
