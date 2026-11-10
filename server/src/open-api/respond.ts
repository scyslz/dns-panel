/**
 * 开放 API 响应封装 + 通用中间件
 */

import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { ApiError, toApiError } from './errors';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = `req_${crypto.randomBytes(5).toString('hex')}`;
  (req as any).requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function sendOk(res: Response, data: unknown, status = 200, headers?: Record<string, string>) {
  if (headers) {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  }
  return res.status(status).json({
    ok: true,
    data,
    requestId: (res.req as any)?.requestId,
  });
}

export function sendError(res: Response, error: unknown) {
  const apiError = toApiError(error);
  if (apiError.status === 429) {
    res.setHeader('Retry-After', String((apiError.details?.retryAfter as number) || 60));
  }
  return res.status(apiError.status).json({
    ok: false,
    error: apiError.toJSON(),
    requestId: (res.req as any)?.requestId,
  });
}

type Handler = (req: any, res: Response, next: NextFunction) => Promise<unknown> | unknown;

/** 异步路由包装：把 reject 转给 v1 错误中间件 */
export function asyncHandler(fn: Handler) {
  return (req: any, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 挂在 v1 路由末尾的统一错误处理 */
export function apiErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  sendError(res, err);
}

/** 健康检查/调试用：保证未知路径返回 JSON 而不是 SPA */
export function apiNotFound(req: Request, res: Response) {
  sendError(
    res,
    new ApiError('NOT_IMPLEMENTED', `未知接口: ${req.method} ${req.originalUrl}`, 404)
  );
}

export function apiError(code: string, message: string, status = 400, details?: Record<string, unknown>) {
  return new ApiError(code as any, message, status, details);
}
