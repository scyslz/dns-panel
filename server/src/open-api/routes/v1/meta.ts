/**
 * /api/open/meta —— 当前 Key 信息
 */

import { Router } from 'express';
import { asyncHandler, sendOk } from '../../respond';
import { actorOf } from '../helpers';

const router = Router();

router.get(
  '/me',
  asyncHandler(async (req: any, res) => {
    const key = req.apiKey;
    return sendOk(res, {
      key: {
        id: key.id,
        name: key.name,
        credentialId: key.credentialId,
        allowedDomains: key.allowedDomains,
        allowedIps: key.allowedIps,
        rateLimitPerMin: key.rateLimitPerMin,
      },
      user: req.user,
      limits: {
        batchSize: 100,
        recordPageSize: 500,
        idempotencyTtlSeconds: 86400,
      },
    });
  })
);

router.get(
  '/ping',
  asyncHandler(async (req: any, res) => sendOk(res, { pong: true, actor: actorOf(req).apiKeyName }))
);

export default router;
