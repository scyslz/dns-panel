import http from 'node:http';
import https from 'node:https';
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
  private static readonly REQUEST_ATTEMPTS = 3;
  private static readonly PUSH_RETRY_COUNT = 3;
  private agent: http.Agent | https.Agent;
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
    this.agent = this.createAgent();

    if (!this.apiKey) throw new Error('Dokploy API Key 不能为空');
  }

  private createAgent() {
    return this.baseUrl.startsWith('https://')
      ? new https.Agent({
          keepAlive: true,
          maxSockets: 4,
          rejectUnauthorized: !this.allowInsecureTls,
        })
      : new http.Agent({
          keepAlive: true,
          maxSockets: 4,
        });
  }

  private destroyAgent() {
    this.agent.destroy();
  }

  private resetAgent() {
    this.destroyAgent();
    this.agent = this.createAgent();
  }

  private isRetryableError(error: any) {
    const code = String(error?.code || '').toUpperCase();
    const httpStatus = Number(error?.httpStatus || error?.status || 0);
    const message = String(error?.message || '');
    if ([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524].includes(httpStatus)) return true;
    return [
      'ECONNRESET',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EPIPE',
      'ETIMEDOUT',
      'ESOCKETTIMEDOUT',
      'EAI_AGAIN',
    ].includes(code) || /timed?\s*out|请求超时|socket hang up|econnreset|econnrefused|etimedout|network/i.test(message);
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async withRetry<T>(task: () => Promise<T>, attempts: number, baseDelayMs = 1000) {
    let lastError: any;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await task();
      } catch (error: any) {
        lastError = error;
        if (attempt >= attempts || !this.isRetryableError(error)) throw error;
        this.resetAgent();
        await this.sleep(baseDelayMs * attempt);
      }
    }

    throw lastError || new Error('Dokploy 重试失败');
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
    const url = `${this.baseUrl}/api/${String(path || '').replace(/^\/+/, '')}`;

    for (let attempt = 1; attempt <= DokployService.REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const response = await requestText({
          url,
          method: init?.method || 'GET',
          timeoutMs: this.timeoutMs,
          allowInsecureTls: this.allowInsecureTls,
          agent: this.agent,
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
      } catch (error: any) {
        if (attempt >= DokployService.REQUEST_ATTEMPTS || !this.isRetryableError(error)) throw error;
        this.resetAgent();
        await this.sleep(600 * attempt);
      }
    }

    throw new Error('Dokploy 请求失败');
  }

  private withServerId(body?: Record<string, any>) {
    return this.serverId ? { ...(body || {}), serverId: this.serverId } : (body || {});
  }

  async testConnection() {
    try {
      await this.request('settings.health');
      return { mode: 'api_key' as const };
    } finally {
      this.destroyAgent();
    }
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
    try {
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

      await this.withRetry(async () => {
        await this.updateTraefikFile(crtPath, String(input.certificatePem || '').trim());
        await this.updateTraefikFile(keyPath, String(input.privateKeyPem || '').trim());
        await this.updateTraefikFile(ymlPath, yml);

        if (this.reloadTraefikAfterPush) {
          await this.reloadTraefik();
        }
      }, DokployService.PUSH_RETRY_COUNT + 1);

      return {
        fileNamePrefix,
        crtPath,
        keyPath,
        ymlPath,
        reloaded: this.reloadTraefikAfterPush,
      };
    } finally {
      this.destroyAgent();
    }
  }
}
