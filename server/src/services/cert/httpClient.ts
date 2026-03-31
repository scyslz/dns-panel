import http from 'node:http';
import https from 'node:https';

interface RequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  allowInsecureTls?: boolean;
}

interface RequestResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export async function requestText(options: RequestOptions): Promise<RequestResult> {
  const url = new URL(options.url);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 8000));

  const body = options.body !== undefined ? (Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body)) : undefined;
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (body !== undefined && !headers['Content-Length'] && !headers['content-length']) {
    headers['Content-Length'] = String(body.length);
  }

  return await new Promise<RequestResult>((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: options.method || 'GET',
        headers,
        rejectUnauthorized: isHttps ? !options.allowInsecureTls : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('请求超时'));
    });

    req.on('error', reject);

    req.end(body);
  });
}

export async function requestJson<T = any>(options: RequestOptions): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: T; raw: string }> {
  const result = await requestText(options);
  let data: any = null;
  try {
    data = result.body ? JSON.parse(result.body) : null;
  } catch {
    throw Object.assign(new Error('远端返回非 JSON 响应'), { httpStatus: result.status, responseBody: result.body });
  }
  return {
    status: result.status,
    headers: result.headers,
    data: data as T,
    raw: result.body,
  };
}
