/**
 * 开放 API v1
 *
 * 挂载点：/api/open
 * 鉴权：API Key（Authorization: Bearer / X-API-Key），与页面 JWT 完全分离。
 */

import { Router } from 'express';
import { apiErrorHandler, apiNotFound, requestId } from '../../respond';
import { authenticateApiKeyMiddleware } from '../../middleware/auth';
import { perKeyRateLimit } from '../../middleware/rateLimit';
import metaRoutes from './meta';
import domainRoutes from './domains';
import edgeoneRoutes from './edgeone';

const router = Router();

router.use(requestId);
router.use(authenticateApiKeyMiddleware);
router.use(perKeyRateLimit);

router.use('/', metaRoutes);
router.use('/domains', domainRoutes);
router.use('/edgeone', edgeoneRoutes);

router.use(apiNotFound);
router.use(apiErrorHandler);

export default router;
