/**
 * 记录参数校验与归一化
 *
 * 只做「确定能提前判断」的校验，避免把明显错误发给厂商；
 * 厂商特有的限制仍以 DnsProviderError 为准。
 */

import net from 'net';
import { ProviderCapabilities } from '../../providers/base/types';
import { ApiError } from '../errors';

export interface RecordInput {
  name: string;
  type: string;
  value: string;
  ttl?: number;
  line?: string;
  weight?: number;
  priority?: number;
  remark?: string;
  proxied?: boolean;
  options?: Record<string, unknown>;
}

const FORBIDDEN_OPTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * 厂商扩展字段：只允许标量 / 标量数组，限制数量与体积，避免原型污染与超大体。
 * 未识别的键会原样透传给 Provider，由 Provider 决定忽略还是使用。
 */
export function sanitizeOptions(input: unknown): Record<string, unknown> | undefined {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError('INVALID_ARGUMENT', 'options 必须是对象', 400);
  }

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 32) {
    throw new ApiError('INVALID_ARGUMENT', 'options 最多 32 个键', 400);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (FORBIDDEN_OPTION_KEYS.has(key)) {
      throw new ApiError('INVALID_ARGUMENT', `options 不允许字段: ${key}`, 400);
    }
    if (value === undefined) continue;

    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 32) throw new ApiError('INVALID_ARGUMENT', `options.${key} 数组过长`, 400);
      if (!value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
        throw new ApiError('INVALID_ARGUMENT', `options.${key} 只支持标量数组`, 400);
      }
      out[key] = value;
      continue;
    }
    throw new ApiError('INVALID_ARGUMENT', `options.${key} 只支持字符串/数字/布尔/数组`, 400);
  }

  if (JSON.stringify(out).length > 4096) {
    throw new ApiError('INVALID_ARGUMENT', 'options 总大小不能超过 4KB', 400);
  }
  return out;
}

const HOSTNAME_RE = /^(?:\*\.)?(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.?$/i;

function isHostname(value: string): boolean {
  if (!value || value.length > 253) return false;
  return HOSTNAME_RE.test(value);
}

export function validateRecordInput(
  input: RecordInput,
  caps: ProviderCapabilities,
  options: { partial?: boolean; minTtl?: number } = {}
): RecordInput {
  const sanitizedOptions = sanitizeOptions(input.options);
  const type = String(input.type || '').trim().toUpperCase();
  const name = String(input.name ?? '').trim();

  if (!options.partial && !name) throw new ApiError('INVALID_ARGUMENT', '缺少必需参数: name', 400);
  if (!options.partial && !type) throw new ApiError('INVALID_ARGUMENT', '缺少必需参数: type', 400);

  if (type) {
    const supported = (caps.recordTypes || []).map((item) => item.toUpperCase());
    if (!supported.includes(type)) {
      throw new ApiError('UNSUPPORTED_RECORD_TYPE', `${caps.name} 不支持记录类型 ${type}`, 400, { supported: caps.recordTypes });
    }
  }

  const value = String(input.value ?? '').trim();

  if (!options.partial || input.value !== undefined) {
    if (!value) throw new ApiError('INVALID_ARGUMENT', '缺少必需参数: value', 400);

    if (type === 'A' && net.isIP(value) !== 4) {
      throw new ApiError('INVALID_ARGUMENT', `A 记录值不是合法 IPv4: ${value}`, 400);
    }
    if (type === 'AAAA' && net.isIP(value) !== 6) {
      throw new ApiError('INVALID_ARGUMENT', `AAAA 记录值不是合法 IPv6: ${value}`, 400);
    }
    if (type === 'CNAME') {
      if (net.isIP(value) > 0) throw new ApiError('INVALID_ARGUMENT', 'CNAME 记录值不能是 IP', 400);
      if (!isHostname(value)) throw new ApiError('INVALID_ARGUMENT', `CNAME 记录值不是合法主机名: ${value}`, 400);
    }
    if (type === 'MX' && input.priority === undefined) {
      throw new ApiError('INVALID_ARGUMENT', 'MX 记录必须提供 priority', 400);
    }
    if (type === 'TXT' && value.length > 2048) {
      throw new ApiError('INVALID_ARGUMENT', 'TXT 记录值过长（上限 2048 字符）', 400);
    }
    if (type === 'CAA' && !/^\d+\s+(issue|issuewild|iodef)\s+/i.test(value)) {
      throw new ApiError('INVALID_ARGUMENT', 'CAA 记录值格式应为 `<flags> issue "<ca>"`', 400);
    }
  }

  if (input.priority !== undefined) {
    if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 65535) {
      throw new ApiError('INVALID_ARGUMENT', 'priority 必须是 0-65535 的整数', 400);
    }
  }

  if (input.ttl !== undefined) {
    if (!Number.isInteger(input.ttl) || input.ttl < 1 || input.ttl > 604800) {
      throw new ApiError('INVALID_ARGUMENT', 'ttl 必须是 1-604800 的整数', 400);
    }
    if (options.minTtl && input.ttl < options.minTtl) {
      throw new ApiError('INVALID_ARGUMENT', `该域名最小 TTL 为 ${options.minTtl}`, 400, { minTtl: options.minTtl });
    }
  }

  if (input.line !== undefined && input.line !== '' && !caps.supportsLine) {
    throw new ApiError('INVALID_ARGUMENT', `${caps.name} 不支持线路参数`, 400);
  }
  if (input.weight !== undefined && !caps.supportsWeight) {
    throw new ApiError('INVALID_ARGUMENT', `${caps.name} 不支持权重参数`, 400);
  }
  if (input.proxied !== undefined && caps.provider !== 'cloudflare') {
    throw new ApiError('INVALID_ARGUMENT', `${caps.name} 不支持 proxied 参数`, 400);
  }

  return {
    ...input,
    name: name || input.name,
    type: type || input.type,
    value: input.value !== undefined ? value : input.value,
    ...(sanitizedOptions !== undefined ? { options: sanitizedOptions } : {}),
  };
}

export function pickDefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}
