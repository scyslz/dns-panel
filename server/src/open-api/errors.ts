/**
 * 开放 API 错误模型
 *
 * 与现有页面接口（success/message 信封）完全独立，避免影响 UI 契约。
 */

import { DnsProviderError } from '../providers/base/BaseProvider';

export type ApiErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_RECORD_TYPE'
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'KEY_EXPIRED'
  | 'SCOPE_DENIED'
  | 'DOMAIN_NOT_ALLOWED'
  | 'IP_NOT_ALLOWED'
  | 'ZONE_NOT_FOUND'
  | 'SITE_NOT_FOUND'
  | 'RECORD_NOT_FOUND'
  | 'DOMAIN_NOT_FOUND'
  | 'AMBIGUOUS_RECORD'
  | 'DOMAIN_ALREADY_EXISTS'
  | 'DOMAIN_IN_USE'
  | 'OFFLINE_TIMEOUT'
  | 'ZONE_NOT_RECORD_CAPABLE'
  | 'PROVIDER_NOT_RECORD_CAPABLE'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'RATE_LIMITED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly retriable: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
    retriable = false
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.retriable = retriable;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      retriable: this.retriable,
    };
  }
}

/** 厂商错误的 HTTP 状态映射（尽量保留厂商语义，补齐缺失状态码） */
function statusFromProviderError(error: DnsProviderError): number {
  const explicit = error.details.httpStatus;
  if (typeof explicit === 'number' && explicit >= 400 && explicit <= 599) return explicit;

  const code = String(error.details.code || '').toLowerCase();
  if (/auth|unauthor|forbidden|signature|invalidcredential/.test(code)) return 403;
  if (/notfound|not_found|nonexist/.test(code)) return 404;
  if (/ratelimit|throttl|toomany/.test(code)) return 429;
  if (/conflict|exist|duplicate/.test(code)) return 409;
  return error.details.retriable ? 502 : 422;
}

/** 把任意异常收敛成 ApiError */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof DnsProviderError) {
    const status = statusFromProviderError(error);
    return new ApiError(
      status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED',
      error.details.code ? `${error.details.code}: ${error.message}` : error.message,
      status,
      {
        provider: error.details.provider,
        providerCode: error.details.code,
        retriable: error.details.retriable,
        ...(error.details.meta || {}),
      },
      error.details.retriable
    );
  }

  const anyErr = error as any;
  const status = typeof anyErr?.httpStatus === 'number' ? anyErr.httpStatus : 500;

  // EdgeOne / 腾讯云错误：保留厂商 code 与 RequestId 方便排障
  if (anyErr?.name === 'TeoError') {
    return new ApiError(
      status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED',
      anyErr?.message ? String(anyErr.message) : 'EdgeOne 操作失败',
      status,
      { provider: 'edgeone', providerCode: anyErr.code, requestId: anyErr.requestId },
      status >= 500 || status === 429
    );
  }

  return new ApiError(
    status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_ARGUMENT',
    anyErr?.message ? String(anyErr.message) : '操作失败',
    status,
    anyErr?.code ? { code: anyErr.code } : undefined,
    false
  );
}
