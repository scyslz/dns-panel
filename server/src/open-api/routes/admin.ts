/**
 * API Key 管理接口（页面 JWT 认证）
 *
 * 挂载点：/api/api-keys
 * 与开放 API 分开：这里用登录态，只有本人能管理自己的 Key。
 */

import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth';
import { successResponse, errorResponse } from '../../utils/response';
import { createApiKey, listApiKeys, revokeApiKey } from '../keys/service';
import { listDomainOptions } from '../keys/domainOptions';
import type { AuthRequest } from '../../types';

const router = Router();
router.use(authenticateToken);

router.get('/', async (req: AuthRequest, res) => {
  try {
    const keys = await listApiKeys(req.user!.id);
    return successResponse(res, { keys }, '获取 API Key 列表成功');
  } catch (error: any) {
    return errorResponse(res, error.message || '获取 API Key 列表失败', 400);
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const body = req.body || {};
    const created = await createApiKey({
      userId: req.user!.id,
      name: body.name,
      credentialId: body.credentialId,
      allowedDomains: body.allowedDomains,
      allowedIps: body.allowedIps,
      rateLimitPerMin: body.rateLimitPerMin,
      expiresAt: body.expiresAt,
    });
    return successResponse(res, created, 'API Key 创建成功（密钥只显示一次）', 201);
  } catch (error: any) {
    return errorResponse(res, error.message || '创建 API Key 失败', error.status || 400);
  }
});

router.get('/domain-options', async (req: AuthRequest, res) => {
  try {
    const result = await listDomainOptions(req.user!.id, req.query.refresh === '1');
    return successResponse(res, result, '获取可选域名成功');
  } catch (error: any) {
    return errorResponse(res, error.message || '获取可选域名失败', 400);
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return errorResponse(res, '无效的 ID', 400);
    const result = await revokeApiKey(req.user!.id, id);
    return successResponse(res, result, 'API Key 已吊销');
  } catch (error: any) {
    return errorResponse(res, error.message || '吊销 API Key 失败', error.status || 400);
  }
});

export default router;
