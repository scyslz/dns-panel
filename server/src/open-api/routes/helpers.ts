/**
 * 幂等路由辅助：把 Idempotency-Key 的占位/回放逻辑收在这里，路由保持干净。
 */

import { Response } from 'express';
import { getClientIp } from '../../middleware/logger';
import { withIdempotency } from '../dns/idempotency';
import { ApiActor } from '../dns/service';
import { ApiRequest } from '../middleware/auth';
import { sendOk } from '../respond';

export function actorOf(req: ApiRequest): ApiActor {
  const key = req.apiKey!;
  return {
    userId: key.userId,
    apiKeyId: key.id,
    apiKeyName: key.name,
    ip: getClientIp(req as any),
    requestId: req.requestId,
    allowedDomains: key.allowedDomains,
  };
}

export function credentialQuery(req: ApiRequest): string | undefined {
  const value = req.query.credentialId ?? req.body?.credentialId;
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

export async function runIdempotent(
  req: ApiRequest,
  res: Response,
  handler: () => Promise<{ status?: number; data: any }>
) {
  const key = req.apiKey!;
  const result = await withIdempotency<any>(
    {
      userId: key.userId,
      apiKeyId: key.id,
      header: req.headers['idempotency-key'] as string | undefined,
      method: req.method,
      path: req.originalUrl,
      body: req.body,
      auto: req.method === 'POST',
    },
    async () => {
      const output = await handler();
      return { status: output.status || 200, body: output.data };
    }
  );

  if (result.replay) res.setHeader('Idempotent-Replay', 'true');
  if (result.auto) res.setHeader('Idempotent-Auto', 'true');
  return sendOk(res, result.body, result.status);
}
