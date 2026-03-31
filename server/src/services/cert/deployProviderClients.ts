import crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { buildSignedQuery, type AliyunAuth } from '../../providers/aliyun/auth';
import { buildTc3Headers, type Tc3Credentials } from '../../providers/dnspod/auth';
import { buildHuaweiHeaders, type HuaweiCredentials } from '../../providers/huawei/auth';
import { buildBceHeaders, type BceCredentials } from '../../providers/baidu/auth';
import { buildVolcengineHeaders, type VolcengineCredentials } from '../../providers/huoshan/auth';
import { buildUcloudPayload, type UcloudAuth } from '../../providers/ucloud/auth';
import { requestJson, requestText } from './httpClient';

function buildQueryString(params: Record<string, any>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  return search.toString();
}

function parseMaybeJson(raw: string) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ensureHttpOk(status: number, body: any, fallback: string) {
  if (status >= 200 && status < 300) return;
  const message = body?.Message || body?.message || body?.msg || body?.error_msg || body?.error?.message || fallback;
  throw new Error(String(message || fallback));
}

function xmlDecode(input: string) {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractXmlTagValue(raw: string, tag: string) {
  const matched = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return matched ? xmlDecode(matched[1].trim()) : null;
}

function buildAliyunOssQueryString(params: Record<string, any>) {
  const entries: Array<[string, string | null]> = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    entries.push([key, value === '' ? null : String(value)]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries
    .map(([key, value]) => (
      value === null
        ? encodeURIComponent(key)
        : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    ))
    .join('&');
}

function aliyunOssPercentEncode(input: string, keepSlash = false) {
  let encoded = encodeURIComponent(input)
    .replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  if (keepSlash) encoded = encoded.replace(/%2F/g, '/');
  return encoded;
}

function buildAliyunOssCanonicalQuery(params: Record<string, any>) {
  const entries: Array<[string, string | null]> = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    entries.push([
      aliyunOssPercentEncode(key),
      value === '' ? null : aliyunOssPercentEncode(String(value)),
    ]);
  }
  entries.sort((a, b) => (
    a[0] === b[0]
      ? (a[1] || '').localeCompare(b[1] || '')
      : a[0].localeCompare(b[0])
  ));
  return entries.map(([key, value]) => (value === null ? key : `${key}=${value}`)).join('&');
}

function aliyunAcs3PercentEncode(input: string) {
  return encodeURIComponent(input)
    .replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%7E/g, '~');
}

function buildAliyunAcs3CanonicalUri(path: string) {
  const normalized = path && path.startsWith('/') ? path : `/${path || ''}`;
  return normalized
    .split('/')
    .map(part => aliyunAcs3PercentEncode(part))
    .join('/');
}

function buildAliyunAcs3CanonicalQuery(params: Record<string, any>) {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    entries.push([aliyunAcs3PercentEncode(key), aliyunAcs3PercentEncode(String(value))]);
  }
  entries.sort((a, b) => (
    a[0] === b[0]
      ? a[1].localeCompare(b[1])
      : a[0].localeCompare(b[0])
  ));
  return entries.map(([key, value]) => `${key}=${value}`).join('&');
}

function normalizeAliyunOssRegion(endpoint: string) {
  const normalized = endpoint.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const matched = normalized.match(/^oss-([a-z0-9-]+?)(?:-internal)?\.aliyuncs\.com$/i);
  if (!matched?.[1]) {
    throw new Error('Aliyun OSS Endpoint 格式无效，应类似 oss-cn-hangzhou.aliyuncs.com');
  }
  return matched[1];
}

function buildAliyunOssCanonicalUri(path: string) {
  const normalized = path && path.startsWith('/') ? path : `/${path || ''}`;
  return normalized.split('/').map(part => aliyunOssPercentEncode(part, false)).join('/').replace(/%2F/g, '/');
}

function buildAliyunOssDate(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

function sha256Hex(input: string) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function hmacSha256(key: Buffer | string, data: string) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha1Hex(input: string) {
  return crypto.createHash('sha1').update(input, 'utf8').digest('hex');
}

function hmacSha1Hex(key: Buffer | string, data: string) {
  return crypto.createHmac('sha1', key).update(data, 'utf8').digest('hex');
}

function tencentCosPercentEncode(input: string) {
  return encodeURIComponent(input)
    .replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildTencentCosCanonicalEntries(input: Record<string, any>) {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(input || {})) {
    if (value === undefined || value === null) continue;
    entries.push([tencentCosPercentEncode(String(key).toLowerCase()), tencentCosPercentEncode(String(value))]);
  }
  entries.sort((a, b) => (
    a[0] === b[0]
      ? a[1].localeCompare(b[1])
      : a[0].localeCompare(b[0])
  ));
  return entries;
}

function buildAliyunOssAuthorization(options: {
  auth: AliyunAuth;
  host: string;
  region: string;
  method: string;
  path: string;
  query?: Record<string, any>;
  contentType?: string | null;
  contentMd5?: string | null;
  dateTime: string;
  additionalHeaders?: string[];
}) {
  const signDate = options.dateTime.slice(0, 8);
  const headers: Record<string, string> = {
    host: options.host.toLowerCase(),
    'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-oss-date': options.dateTime,
  };
  if (options.contentType) headers['content-type'] = options.contentType;
  if (options.contentMd5) headers['content-md5'] = options.contentMd5;

  const additionalHeaders = [...new Set((options.additionalHeaders || ['host']).map(item => item.toLowerCase()))].sort();
  const canonicalHeaders = Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value.trim()}\n`)
    .join('');
  const scope = `${signDate}/${options.region}/oss/aliyun_v4_request`;
  const canonicalRequest = [
    options.method.toUpperCase(),
    buildAliyunOssCanonicalUri(options.path),
    buildAliyunOssCanonicalQuery(options.query || {}),
    canonicalHeaders,
    additionalHeaders.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'OSS4-HMAC-SHA256',
    options.dateTime,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const dateKey = hmacSha256(`aliyun_v4${options.auth.accessKeySecret}`, signDate);
  const regionKey = hmacSha256(dateKey, options.region);
  const serviceKey = hmacSha256(regionKey, 'oss');
  const signingKey = hmacSha256(serviceKey, 'aliyun_v4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    headers: {
      Host: options.host,
      'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-oss-date': options.dateTime,
      ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
      ...(options.contentMd5 ? { 'Content-MD5': options.contentMd5 } : {}),
      Authorization: `OSS4-HMAC-SHA256 Credential=${options.auth.accessKeyId}/${scope}, AdditionalHeaders=${additionalHeaders.join(';')}, Signature=${signature}`,
    },
  };
}

export async function aliyunRpcRequest<T = any>(options: {
  auth: AliyunAuth;
  endpoint: string;
  action: string;
  version: string;
  params?: Record<string, any>;
  method?: 'GET' | 'POST';
}) {
  const method = options.method || 'GET';
  const query = buildSignedQuery(options.auth, options.action, options.params || {}, { version: options.version, method });
  const queryString = buildQueryString(query);
  const url = `https://${options.endpoint}/?${queryString}`;
  const response = await requestText({ url, method, timeoutMs: 10000 });
  const body = parseMaybeJson(response.body);
  ensureHttpOk(response.status, body, `阿里云接口调用失败：${options.action}`);
  return (body || {}) as T;
}

export async function aliyunAcs3Request<T = any>(options: {
  auth: AliyunAuth;
  endpoint: string;
  action: string;
  version: string;
  path: string;
  method?: string;
  query?: Record<string, any>;
  body?: any;
  timeoutMs?: number;
}) {
  const endpoint = options.endpoint.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!endpoint) throw new Error('阿里云 endpoint 不能为空');
  const method = (options.method || 'GET').toUpperCase();
  const path = options.path && options.path.startsWith('/') ? options.path : `/${options.path || ''}`;
  const canonicalPath = buildAliyunAcs3CanonicalUri(path);
  const query = Object.fromEntries(
    Object.entries(options.query || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  const rawBody = options.body === undefined || method === 'GET' || method === 'DELETE'
    ? ''
    : typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body);
  const payloadHash = sha256Hex(rawBody);
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = crypto.randomUUID();
  const signingHeaders: Record<string, string> = {
    host: endpoint.toLowerCase(),
    'x-acs-action': options.action,
    'x-acs-content-sha256': payloadHash,
    'x-acs-date': date,
    'x-acs-signature-nonce': nonce,
    'x-acs-version': options.version,
  };
  if (rawBody) signingHeaders['content-type'] = 'application/json; charset=utf-8';

  const sortedHeaders = Object.entries(signingHeaders).sort(([a], [b]) => a.localeCompare(b));
  const canonicalHeaders = sortedHeaders.map(([key, value]) => `${key}:${value.trim()}\n`).join('');
  const signedHeaders = sortedHeaders.map(([key]) => key).join(';');
  const canonicalRequest = [
    method,
    canonicalPath,
    buildAliyunAcs3CanonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const stringToSign = `ACS3-HMAC-SHA256\n${sha256Hex(canonicalRequest)}`;
  const signature = crypto.createHmac('sha256', options.auth.accessKeySecret).update(stringToSign, 'utf8').digest('hex');
  const headers: Record<string, string> = {
    Host: endpoint,
    'x-acs-action': options.action,
    'x-acs-content-sha256': payloadHash,
    'x-acs-date': date,
    'x-acs-signature-nonce': nonce,
    'x-acs-version': options.version,
    Authorization: `ACS3-HMAC-SHA256 Credential=${options.auth.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`,
  };
  if (rawBody) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = String(Buffer.byteLength(rawBody, 'utf8'));
  }

  const queryString = buildAliyunAcs3CanonicalQuery(query);
  const response = await requestText({
    url: `https://${endpoint}${canonicalPath}${queryString ? `?${queryString}` : ''}`,
    method,
    headers,
    body: rawBody || undefined,
    timeoutMs: options.timeoutMs || 10000,
  });
  const body = parseMaybeJson(response.body);
  ensureHttpOk(response.status, body, `阿里云接口调用失败：${options.action}`);
  return (body || {}) as T;
}

export async function aliyunOssRequest(options: {
  auth: AliyunAuth;
  endpoint: string;
  bucket: string;
  path?: string;
  query?: Record<string, any>;
  method?: string;
  body?: string;
  contentType?: string;
}): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const endpoint = options.endpoint.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const bucket = options.bucket.trim();
  if (!bucket) throw new Error('Aliyun OSS Bucket 不能为空');
  const region = normalizeAliyunOssRegion(endpoint);
  const host = `${bucket}.${endpoint}`;
  const path = options.path || '/';
  const method = (options.method || 'GET').toUpperCase();
  const query = options.query || {};
  const contentType = options.contentType || (options.body !== undefined ? 'application/xml' : undefined);
  const dateTime = buildAliyunOssDate();
  const { headers } = buildAliyunOssAuthorization({
    auth: options.auth,
    host,
    region,
    method,
    path,
    query,
    contentType: contentType || null,
    dateTime,
    additionalHeaders: ['host'],
  });
  if (options.body !== undefined) {
    headers['Content-Length'] = String(Buffer.byteLength(options.body, 'utf8'));
  }
  const queryString = buildAliyunOssQueryString(query);
  const response = await requestText({
    url: `https://${host}${path}${queryString ? `?${queryString}` : ''}`,
    method,
    headers,
    body: options.body,
    timeoutMs: 10000,
  });
  if (response.status < 200 || response.status >= 300) {
    const message = extractXmlTagValue(response.body, 'Message')
      || extractXmlTagValue(response.body, 'Code')
      || '阿里云 OSS 接口调用失败';
    throw new Error(message);
  }
  return response;
}

export async function tencentCloudRequest<T = any>(options: {
  creds: Tc3Credentials;
  host: string;
  service: string;
  action: string;
  version: string;
  region?: string | null;
  payload?: Record<string, any>;
}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(options.payload && Object.keys(options.payload).length ? options.payload : {});
  const headers = buildTc3Headers(options.creds, {
    host: options.host,
    service: options.service,
    action: options.action,
    version: options.version,
    timestamp,
    payload,
  });
  if (options.region) {
    headers['X-TC-Region'] = String(options.region);
  }
  const response = await requestJson<{ Response?: T & { Error?: { Message?: string } } }>({
    url: `https://${options.host}/`,
    method: 'POST',
    headers,
    body: payload,
    timeoutMs: 10000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`腾讯云接口调用失败：${options.action}`);
  }
  if (response.data?.Response && (response.data.Response as any).Error) {
    throw new Error((response.data.Response as any).Error.Message || `腾讯云接口调用失败：${options.action}`);
  }
  return (response.data?.Response || {}) as T;
}

export async function tencentCosRequest(options: {
  creds: Tc3Credentials;
  method?: string;
  host?: string;
  path?: string;
  query?: Record<string, any>;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const method = (options.method || 'GET').toUpperCase();
  const host = (options.host || 'service.cos.myqcloud.com').toLowerCase();
  const path = options.path || '/';
  const date = new Date().toUTCString();
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 600}`;
  const rawHeaders: Record<string, string> = {
    date,
    host,
    ...(options.creds.token ? { 'x-cos-security-token': options.creds.token } : {}),
    ...(options.headers || {}),
  };
  const queryEntries = buildTencentCosCanonicalEntries(options.query || {});
  const headerEntries = buildTencentCosCanonicalEntries(rawHeaders);
  const httpParameters = queryEntries.map(([key, value]) => `${key}=${value}`).join('&');
  const urlParamList = queryEntries.map(([key]) => key).join(';');
  const httpHeaders = headerEntries.map(([key, value]) => `${key}=${value}`).join('&');
  const headerList = headerEntries.map(([key]) => key).join(';');
  const httpString = `${method.toLowerCase()}\n${path}\n${httpParameters}\n${httpHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1Hex(httpString)}\n`;
  const signKey = hmacSha1Hex(options.creds.secretKey, keyTime);
  const signature = hmacSha1Hex(signKey, stringToSign);
  const authorization = [
    'q-sign-algorithm=sha1',
    `q-ak=${options.creds.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=${urlParamList}`,
    `q-signature=${signature}`,
  ].join('&');
  const headers: Record<string, string> = {
    Date: date,
    Host: host,
    Authorization: authorization,
    ...(options.creds.token ? { 'x-cos-security-token': options.creds.token } : {}),
    ...(options.headers || {}),
  };
  const queryString = queryEntries.map(([key, value]) => `${key}=${value}`).join('&');
  return await requestText({
    url: `https://${host}${path}${queryString ? `?${queryString}` : ''}`,
    method,
    headers,
    timeoutMs: options.timeoutMs || 10000,
  });
}

export async function huaweiCloudRequest<T = any>(options: {
  creds: HuaweiCredentials;
  host: string;
  path: string;
  method?: string;
  query?: Record<string, any>;
  body?: any;
}) {
  const method = (options.method || 'GET').toUpperCase();
  const queryParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value === undefined || value === null || value === '') continue;
    queryParams[key] = String(value);
  }
  const rawBody = options.body === undefined ? '' : JSON.stringify(options.body);
  const headers = buildHuaweiHeaders(options.creds, {
    method,
    host: options.host,
    path: options.path,
    query: queryParams,
    body: rawBody,
    headers: rawBody ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
  });
  if (rawBody) {
    headers['Content-Length'] = String(Buffer.byteLength(rawBody));
  }
  const queryString = buildQueryString(queryParams);
  const response = await requestText({
    url: `https://${options.host}${options.path}${queryString ? `?${queryString}` : ''}`,
    method,
    headers,
    body: rawBody || undefined,
    timeoutMs: 10000,
  });
  const body = parseMaybeJson(response.body);
  ensureHttpOk(response.status, body, '华为云接口调用失败');
  return (body || {}) as T;
}

export async function baiduCloudRequest<T = any>(options: {
  creds: BceCredentials;
  host: string;
  path: string;
  method?: string;
  query?: Record<string, any>;
  body?: any;
}) {
  const method = (options.method || 'GET').toUpperCase();
  const queryParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value === undefined || value === null || value === '') continue;
    queryParams[key] = String(value);
  }
  const rawBody = options.body === undefined ? '' : JSON.stringify(options.body);
  const headers = buildBceHeaders(options.creds, {
    method,
    host: options.host,
    path: options.path,
    query: queryParams,
    headers: rawBody ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
  });
  if (rawBody) {
    headers['Content-Length'] = String(Buffer.byteLength(rawBody));
  }
  const queryString = buildQueryString(queryParams);
  const response = await requestText({
    url: `https://${options.host}${options.path}${queryString ? `?${queryString}` : ''}`,
    method,
    headers,
    body: rawBody || undefined,
    timeoutMs: 10000,
  });
  const body = parseMaybeJson(response.body);
  ensureHttpOk(response.status, body, '百度云接口调用失败');
  return (body || {}) as T;
}

export async function volcengineRequest<T = any>(options: {
  creds: VolcengineCredentials;
  host: string;
  service: string;
  version: string;
  region: string;
  action?: string;
  method?: string;
  path?: string;
  query?: Record<string, any>;
  body?: any;
}) {
  const method = (options.method || 'POST').toUpperCase();
  const queryParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value === undefined || value === null || value === '') continue;
    queryParams[key] = String(value);
  }
  if (options.action) {
    queryParams.Action = options.action;
    queryParams.Version = options.version;
  }
  const rawBody = options.body === undefined
    ? ''
    : method === 'GET'
      ? ''
      : JSON.stringify(options.body);
  const headers = buildVolcengineHeaders(options.creds, {
    method,
    host: options.host,
    service: options.service,
    region: options.region,
    path: options.path || '/',
    query: queryParams,
    body: rawBody,
    headers: rawBody ? { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Sha256': 'required' } : undefined,
  });
  if (rawBody) {
    headers['Content-Length'] = String(Buffer.byteLength(rawBody));
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  const queryString = buildQueryString(queryParams);
  const response = await requestText({
    url: `https://${options.host}${options.path || '/'}${queryString ? `?${queryString}` : ''}`,
    method,
    headers,
    body: rawBody || undefined,
    timeoutMs: 10000,
  });
  const body = parseMaybeJson(response.body);
  ensureHttpOk(response.status, body, `火山引擎接口调用失败：${options.action || options.path || '/'}`);
  if (body?.ResponseMetadata?.Error) {
    throw new Error(body.ResponseMetadata.Error.Message || '火山引擎接口调用失败');
  }
  return (body?.Result || body || {}) as T;
}

export async function ucloudRequest<T = any>(options: {
  auth: UcloudAuth;
  action: string;
  params?: Record<string, any>;
}) {
  const payload = buildUcloudPayload(options.auth, options.action, options.params || {});
  const body = buildQueryString(payload);
  const response = await requestText({
    url: 'https://api.ucloud.cn',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    timeoutMs: 10000,
  });
  const parsed = parseMaybeJson(response.body);
  ensureHttpOk(response.status, parsed, `UCloud 接口调用失败：${options.action}`);
  if (parsed?.RetCode && Number(parsed.RetCode) !== 0) {
    throw new Error(parsed.Message || `UCloud 接口调用失败：${options.action}`);
  }
  return (parsed || {}) as T;
}

function base64Url(data: Buffer) {
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

export async function qiniuRequest<T = any>(options: {
  accessKey: string;
  secretKey: string;
  path: string;
  method?: string;
  query?: Record<string, any>;
  body?: any;
}) {
  const method = (options.method || 'GET').toUpperCase();
  const queryString = buildQueryString(options.query || {});
  const url = `https://api.qiniu.com${options.path}${queryString ? `?${queryString}` : ''}`;
  const rawBody = options.body === undefined ? '' : JSON.stringify(options.body);
  const signTarget = `${options.path}${queryString ? `?${queryString}` : ''}\n`;
  const digest = crypto.createHmac('sha1', options.secretKey).update(signTarget).digest();
  const authorization = `QBox ${options.accessKey}:${base64Url(digest)}`;
  const response = await requestText({
    url,
    method,
    headers: rawBody ? { Authorization: authorization, 'Content-Type': 'application/json' } : { Authorization: authorization },
    body: rawBody || undefined,
    timeoutMs: 10000,
  });
  const parsed = parseMaybeJson(response.body);
  ensureHttpOk(response.status, parsed, '七牛接口调用失败');
  return (parsed || true) as T;
}

export async function dogeCloudRequest<T = any>(options: {
  accessKey: string;
  secretKey: string;
  path: string;
  method?: string;
  body?: Record<string, any>;
}) {
  const method = (options.method || 'POST').toUpperCase();
  const rawBody = options.body ? new URLSearchParams(options.body as Record<string, string>).toString() : '';
  const signTarget = `${options.path}\n${rawBody}`;
  const signature = crypto.createHmac('sha1', options.secretKey).update(signTarget).digest('hex');
  const response = await requestText({
    url: `https://api.dogecloud.com${options.path}`,
    method,
    headers: {
      Authorization: `TOKEN ${options.accessKey}:${signature}`,
      ...(rawBody ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: rawBody || undefined,
    timeoutMs: 10000,
  });
  const parsed = parseMaybeJson(response.body);
  if (response.status < 200 || response.status >= 300 || parsed?.code !== 200) {
    throw new Error(parsed?.msg || 'DogeCloud 接口调用失败');
  }
  return (parsed?.data || true) as T;
}

export async function gcoreRequest<T = any>(options: {
  apiToken: string;
  path: string;
  method?: string;
  body?: any;
}) {
  const rawBody = options.body === undefined ? '' : JSON.stringify(options.body);
  const response = await requestText({
    url: `https://api.gcore.com${options.path}`,
    method: options.method || (rawBody ? 'POST' : 'GET'),
    headers: {
      Authorization: `apikey ${options.apiToken}`,
      ...(rawBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: rawBody || undefined,
    timeoutMs: 10000,
  });
  const parsed = parseMaybeJson(response.body);
  ensureHttpOk(response.status, parsed, 'Gcore 接口调用失败');
  if (parsed?.errors) {
    const firstKey = Object.keys(parsed.errors)[0];
    throw new Error(parsed.errors[firstKey]?.[0] || 'Gcore 接口调用失败');
  }
  return (parsed || true) as T;
}

export async function cacheflyRequest<T = any>(options: {
  apiToken: string;
  path: string;
  method?: string;
  body?: any;
}) {
  const rawBody = options.body === undefined ? '' : JSON.stringify(options.body);
  const response = await requestText({
    url: `https://api.cachefly.com/api/2.6${options.path}`,
    method: options.method || (rawBody ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bearer ${options.apiToken}`,
      'x-cf-authorization': `Bearer ${options.apiToken}`,
      ...(rawBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: rawBody || undefined,
    timeoutMs: 10000,
  });
  const parsed = parseMaybeJson(response.body);
  ensureHttpOk(response.status, parsed, 'CacheFly 接口调用失败');
  return (parsed || true) as T;
}

export async function btwafRequest<T = any>(options: {
  baseUrl: string;
  apiKey: string;
  path: string;
  body?: any;
  timeoutMs?: number;
}) {
  const now = String(Math.floor(Date.now() / 1000));
  const token = crypto.createHash('md5').update(now + crypto.createHash('md5').update(options.apiKey).digest('hex')).digest('hex');
  const rawBody = JSON.stringify(options.body || {});
  const response = await requestText({
    url: `${options.baseUrl.replace(/\/+$/, '')}${options.path}`,
    method: 'POST',
    headers: {
      waf_request_time: now,
      waf_request_token: token,
      'Content-Type': 'application/json',
    },
    body: rawBody,
    timeoutMs: options.timeoutMs || 10000,
  });
  const parsed = parseMaybeJson(response.body);
  ensureHttpOk(response.status, parsed, '堡塔云 WAF 接口调用失败');
  if (parsed?.code !== 0) {
    throw new Error(parsed?.res || parsed?.message || '堡塔云 WAF 接口调用失败');
  }
  return (parsed?.res ?? parsed ?? true) as T;
}
