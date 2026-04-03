import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';
import { errorResponse, successResponse } from '../utils/response';
import { CertificateCnameAliasService } from '../services/cert/CertificateCnameAliasService';

const router = Router();
router.use(authenticateToken);

router.get('/', async (req: AuthRequest, res) => {
  try {
    const aliases = await CertificateCnameAliasService.listAliases(req.user!.id);
    return successResponse(res, { aliases }, '获取 CNAME Alias 成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取 CNAME Alias 失败', 500);
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const alias = await CertificateCnameAliasService.createAlias(req.user!.id, {
      domain: req.body?.domain,
      dnsCredentialId: Number(req.body?.dnsCredentialId),
      zoneName: req.body?.zoneName,
      rr: req.body?.rr,
    });
    return successResponse(res, { alias }, '创建 CNAME Alias 成功', 201);
  } catch (error: any) {
    return errorResponse(res, error?.message || '创建 CNAME Alias 失败', 400);
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return errorResponse(res, '无效的 Alias ID', 400);
    const alias = await CertificateCnameAliasService.updateAlias(req.user!.id, id, {
      domain: req.body?.domain,
      dnsCredentialId: req.body?.dnsCredentialId !== undefined ? Number(req.body.dnsCredentialId) : undefined,
      zoneName: req.body?.zoneName,
      rr: req.body?.rr,
    });
    return successResponse(res, { alias }, '更新 CNAME Alias 成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '更新 CNAME Alias 失败', 400);
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return errorResponse(res, '无效的 Alias ID', 400);
    await CertificateCnameAliasService.deleteAlias(req.user!.id, id);
    return successResponse(res, null, '删除 CNAME Alias 成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '删除 CNAME Alias 失败', 400);
  }
});

router.post('/:id/check', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return errorResponse(res, '无效的 Alias ID', 400);
    const alias = await CertificateCnameAliasService.checkAlias(req.user!.id, id);
    return successResponse(res, { alias }, 'Alias 校验完成');
  } catch (error: any) {
    return errorResponse(res, error?.message || 'Alias 校验失败', 400);
  }
});

export default router;
