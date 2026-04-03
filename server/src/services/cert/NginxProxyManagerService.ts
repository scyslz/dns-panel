import { requestJson, requestText } from './httpClient';

export interface NginxProxyManagerConfig {
  baseUrl: string;
  username: string;
  password: string;
  allowInsecureTls?: boolean;
  timeoutMs?: number;
}

export interface NginxProxyHost {
  id: number;
  domainNames: string[];
  certificateId?: number;
  enabled?: boolean;
}

function normalizeBaseUrl(input: string): string {
  const value = String(input || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) throw new Error('Nginx Proxy Manager 地址仅支持 http/https');
  return value;
}

function buildMultipart(parts: Array<{ name: string; filename?: string; contentType?: string; value: string }>) {
  const boundary = `----dns-panel-${Math.random().toString(16).slice(2)}`;
  const buffers: Buffer[] = [];
  for (const part of parts) {
    const headers = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ''}`,
      `Content-Type: ${part.contentType || 'text/plain; charset=utf-8'}`,
      '',
      part.value,
    ].join('\r\n');
    buffers.push(Buffer.from(`${headers}\r\n`, 'utf8'));
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    boundary,
    body: Buffer.concat(buffers),
  };
}

export class NginxProxyManagerService {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly allowInsecureTls: boolean;
  private readonly timeoutMs: number;

  constructor(config: NginxProxyManagerConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.username = String(config.username || '').trim();
    this.password = String(config.password || '').trim();
    this.allowInsecureTls = !!config.allowInsecureTls;
    this.timeoutMs = Math.max(1000, Number(config.timeoutMs || 8000));
    if (!this.username || !this.password) throw new Error('Nginx Proxy Manager 用户名和密码不能为空');
  }

  private async getToken() {
    const response = await requestJson<any>({
      url: `${this.baseUrl}/api/tokens`,
      method: 'POST',
      timeoutMs: this.timeoutMs,
      allowInsecureTls: this.allowInsecureTls,
      body: JSON.stringify({
        identity: this.username,
        secret: this.password,
        scope: 'user',
      }),
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/json',
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new Error(`Nginx Proxy Manager 登录失败: HTTP ${response.status}`), { httpStatus: response.status, responseBody: response.raw });
    }

    const token = response.data?.token || response.data?.result?.token;
    if (!token) throw new Error('Nginx Proxy Manager 登录失败：未返回 token');
    return String(token);
  }

  private async request<T = any>(path: string, init?: { method?: string; body?: any }) {
    const token = await this.getToken();
    const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
    const response = await requestJson<T>({
      url: `${this.baseUrl}/api${path}`,
      method: init?.method || 'GET',
      timeoutMs: this.timeoutMs,
      allowInsecureTls: this.allowInsecureTls,
      body,
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new Error(`Nginx Proxy Manager 请求失败: HTTP ${response.status}`), { httpStatus: response.status, responseBody: response.raw });
    }

    return response.data;
  }

  async testConnection() {
    return await this.listProxyHosts();
  }

  async listProxyHosts(): Promise<NginxProxyHost[]> {
    const data = await this.request<any[]>('/nginx/proxy-hosts?expand=certificate');
    const list = Array.isArray(data) ? data : [];
    return list
      .map((item) => ({
        id: Number(item?.id || 0),
        domainNames: Array.isArray(item?.domain_names) ? item.domain_names.map((name: any) => String(name || '').trim()).filter(Boolean) : [],
        certificateId: item?.certificate_id !== undefined ? Number(item.certificate_id) : undefined,
        enabled: item?.enabled === undefined ? undefined : !!item.enabled,
      }))
      .filter((item) => item.id > 0);
  }

  async createCustomCertificate(niceName: string) {
    const data = await this.request<any>('/nginx/certificates', {
      method: 'POST',
      body: {
        provider: 'other',
        nice_name: niceName,
      },
    });
    const id = Number(data?.id || 0);
    if (!id) throw new Error('Nginx Proxy Manager 创建证书占位失败');
    return id;
  }

  async uploadCustomCertificate(certId: number, input: { certificate: string; certificateKey: string; intermediateCertificate?: string | null }) {
    const token = await this.getToken();
    const multipart = buildMultipart([
      { name: 'certificate', filename: 'certificate.pem', value: input.certificate },
      { name: 'certificate_key', filename: 'private.key', value: input.certificateKey },
      ...(input.intermediateCertificate ? [{ name: 'intermediate_certificate', filename: 'intermediate.pem', value: input.intermediateCertificate }] : []),
    ]);

    const response = await requestText({
      url: `${this.baseUrl}/api/nginx/certificates/${certId}/upload`,
      method: 'POST',
      timeoutMs: this.timeoutMs,
      allowInsecureTls: this.allowInsecureTls,
      body: multipart.body,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${multipart.boundary}`,
        'Content-Length': String(multipart.body.length),
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new Error(`Nginx Proxy Manager 上传证书失败: HTTP ${response.status}`), { httpStatus: response.status, responseBody: response.body });
    }
  }

  async updateProxyHostCertificate(proxyHostId: number, certificateId: number) {
    await this.request(`/nginx/proxy-hosts/${proxyHostId}`, {
      method: 'PUT',
      body: { certificate_id: certificateId },
    });
  }
}
