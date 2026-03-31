import { requestText } from './httpClient';

export interface DokployConfig {
  baseUrl: string;
  apiKey: string;
  serverId?: string | null;
  dynamicRoot?: string;
  allowInsecureTls?: boolean;
  timeoutMs?: number;
  reloadTraefikAfterPush?: boolean;
}

function normalizeBaseUrl(input: string): string {
  const value = String(input || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) throw new Error('Dokploy 地址仅支持 http/https');
  return value;
}

function normalizeDynamicRoot(input?: string): string {
  const value = String(input || '').trim().replace(/\/+$/, '');
  return value || '/etc/dokploy/traefik/dynamic';
}

function sanitizeFileNamePrefix(input: string): string {
  const value = String(input || '')
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || 'cert-default';
}

export class DokployService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly serverId: string;
  private readonly dynamicRoot: string;
  private readonly allowInsecureTls: boolean;
  private readonly timeoutMs: number;
  private readonly reloadTraefikAfterPush: boolean;

  constructor(config: DokployConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = String(config.apiKey || '').trim();
    this.serverId = String(config.serverId || '').trim();
    this.dynamicRoot = normalizeDynamicRoot(config.dynamicRoot);
    this.allowInsecureTls = !!config.allowInsecureTls;
    this.timeoutMs = Math.max(1000, Number(config.timeoutMs || 8000));
    this.reloadTraefikAfterPush = !!config.reloadTraefikAfterPush;

    if (!this.apiKey) throw new Error('Dokploy API Key 不能为空');
  }

  private buildHeaders(contentType = true) {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      'User-Agent': 'dns-panel/1.0 (dokploy-deploy)',
    };

    if (contentType) headers['Content-Type'] = 'application/json';
    headers['x-api-key'] = this.apiKey;

    return headers;
  }

  private async request(path: string, init?: { method?: string; body?: Record<string, any> }) {
    const response = await requestText({
      url: `${this.baseUrl}/api/${String(path || '').replace(/^\/+/, '')}`,
      method: init?.method || 'GET',
      timeoutMs: this.timeoutMs,
      allowInsecureTls: this.allowInsecureTls,
      headers: this.buildHeaders(true),
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new Error(`Dokploy 请求失败: HTTP ${response.status}`), {
        httpStatus: response.status,
        responseBody: response.body,
      });
    }

    return response;
  }

  private withServerId(body?: Record<string, any>) {
    return this.serverId ? { ...(body || {}), serverId: this.serverId } : (body || {});
  }

  async testConnection() {
    await this.request('settings.health');
    return { mode: 'api_key' as const };
  }

  async updateTraefikFile(path: string, traefikConfig: string) {
    await this.request('settings.updateTraefikFile', {
      method: 'POST',
      body: this.withServerId({
        path,
        traefikConfig,
      }),
    });
  }

  async reloadTraefik() {
    await this.request('settings.reloadTraefik', {
      method: 'POST',
      body: this.withServerId({}),
    });
  }

  async pushFlatFiles(input: { certificatePem: string; privateKeyPem: string; fileNamePrefix: string }) {
    const fileNamePrefix = sanitizeFileNamePrefix(input.fileNamePrefix);
    const crtPath = `${this.dynamicRoot}/${fileNamePrefix}.crt`;
    const keyPath = `${this.dynamicRoot}/${fileNamePrefix}.key`;
    const ymlPath = `${this.dynamicRoot}/${fileNamePrefix}.yml`;
    const yml = [
      'tls:',
      '  certificates:',
      `    - certFile: ${crtPath}`,
      `      keyFile: ${keyPath}`,
      '',
    ].join('\n');

    await this.updateTraefikFile(crtPath, String(input.certificatePem || '').trim());
    await this.updateTraefikFile(keyPath, String(input.privateKeyPem || '').trim());
    await this.updateTraefikFile(ymlPath, yml);

    if (this.reloadTraefikAfterPush) {
      await this.reloadTraefik();
    }

    return {
      fileNamePrefix,
      crtPath,
      keyPath,
      ymlPath,
      reloaded: this.reloadTraefikAfterPush,
    };
  }
}
