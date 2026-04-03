import crypto from 'node:crypto';
import { requestJson } from './httpClient';

interface OnePanelResponse<T = any> {
  code: number;
  message?: string;
  data?: T;
}

export interface OnePanelConfig {
  baseUrl: string;
  apiKey: string;
  allowInsecureTls?: boolean;
  timeoutMs?: number;
}

export interface OnePanelWebsite {
  id: number;
  primaryDomain?: string;
  alias?: string;
  remark?: string;
  type?: string;
  status?: string;
}

interface OnePanelHttpsConfig {
  enable?: boolean;
  SSL?: { id?: number };
  httpConfig?: string;
  SSLProtocol?: string[];
  algorithm?: string;
  http3?: boolean;
}

function normalizeBaseUrl(input: string): string {
  const value = String(input || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) {
    throw new Error('1Panel 地址仅支持 http/https');
  }
  return value;
}

export class OnePanelService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly allowInsecureTls: boolean;
  private readonly timeoutMs: number;

  constructor(config: OnePanelConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = String(config.apiKey || '').trim();
    this.allowInsecureTls = !!config.allowInsecureTls;
    this.timeoutMs = Math.max(1000, Number(config.timeoutMs || 8000));
    if (!this.apiKey) throw new Error('1Panel API Key 不能为空');
  }

  private buildAuthHeaders() {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = crypto.createHash('md5').update(`1panel${this.apiKey}${timestamp}`, 'utf8').digest('hex');
    return {
      '1Panel-Token': token,
      '1Panel-Timestamp': timestamp,
    };
  }

  private async request<T = any>(path: string, init?: { method?: string; body?: any }) {
    const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
    const response = await requestJson<OnePanelResponse<T>>({
      url: `${this.baseUrl}/api/v1${path}`,
      method: init?.method || 'GET',
      body,
      timeoutMs: this.timeoutMs,
      allowInsecureTls: this.allowInsecureTls,
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/json',
        ...this.buildAuthHeaders(),
      },
    });

    const payload = response.data || { code: response.status };
    if (response.status < 200 || response.status >= 300 || payload.code !== 200) {
      throw Object.assign(new Error(String(payload.message || `1Panel 请求失败 (${response.status})`)), {
        httpStatus: response.status,
        responseBody: response.raw,
      });
    }

    return payload.data as T;
  }

  async testConnection() {
    return await this.listWebsites();
  }

  async listWebsites(): Promise<OnePanelWebsite[]> {
    const data = await this.request<any[]>('/websites/list');
    const list = Array.isArray(data) ? data : [];
    return list
      .map((item) => ({
        id: Number(item?.id || 0),
        primaryDomain: item?.primaryDomain ? String(item.primaryDomain) : undefined,
        alias: item?.alias ? String(item.alias) : undefined,
        remark: item?.remark ? String(item.remark) : undefined,
        type: item?.type ? String(item.type) : undefined,
        status: item?.status ? String(item.status) : undefined,
      }))
      .filter((item) => item.id > 0);
  }

  async getHttpsConfig(websiteId: number): Promise<OnePanelHttpsConfig> {
    return await this.request<OnePanelHttpsConfig>(`/websites/${websiteId}/https`);
  }

  async uploadCertificate(input: { certificate: string; privateKey: string; description: string; sslId?: number | null }) {
    await this.request('/websites/ssl/upload', {
      method: 'POST',
      body: {
        type: 'paste',
        certificate: input.certificate,
        privateKey: input.privateKey,
        description: input.description,
        ...(input.sslId ? { sslID: input.sslId } : {}),
      },
    });
  }

  async searchUploadedCertificate(primaryDomain: string) {
    const data = await this.request<{ total?: number; items?: any[] }>('/websites/ssl/search', {
      method: 'POST',
      body: {
        page: 1,
        pageSize: 50,
        domain: primaryDomain,
        orderBy: 'created_at',
        order: 'descending',
      },
    });

    const items = Array.isArray(data?.items) ? data.items : [];
    return items
      .map((item) => ({
        id: Number(item?.id || 0),
        primaryDomain: item?.primaryDomain ? String(item.primaryDomain) : '',
        description: item?.description ? String(item.description) : '',
      }))
      .filter((item) => item.id > 0);
  }

  async bindWebsiteCertificate(websiteId: number, websiteSslId: number) {
    const current = await this.getHttpsConfig(websiteId).catch(() => ({} as OnePanelHttpsConfig));
    await this.request(`/websites/${websiteId}/https`, {
      method: 'POST',
      body: {
        websiteId,
        enable: true,
        websiteSSLId: websiteSslId,
        type: 'existed',
        httpConfig: current.httpConfig || 'HTTPToHTTPS',
        SSLProtocol: Array.isArray(current.SSLProtocol) && current.SSLProtocol.length ? current.SSLProtocol : ['TLSv1.2', 'TLSv1.3'],
        algorithm: current.algorithm || '',
        http3: !!current.http3,
      },
    });
  }
}
