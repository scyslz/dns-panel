import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';
import { errorResponse, successResponse } from '../utils/response';
import { CertificateDeployService } from '../services/cert/CertificateDeployService';
import { CertificateActivityService } from '../services/cert/CertificateActivityService';

const router = Router();
router.use(authenticateToken);

router.get('/types', async (_req: AuthRequest, res) => {
  try {
    const types = CertificateDeployService.listTypes();
    return successResponse(res, { types }, '获取部署类型成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取部署类型失败', 500);
  }
});

router.get('/targets', async (req: AuthRequest, res) => {
  try {
    const targets = await CertificateDeployService.listTargets(req.user!.id);
    return successResponse(res, { targets }, '获取部署目标成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取部署目标失败', 500);
  }
});

router.post('/targets', async (req: AuthRequest, res) => {
  try {
    const target = await CertificateDeployService.createTarget(req.user!.id, req.body || {});
    return successResponse(res, { target }, '创建部署目标成功', 201);
  } catch (error: any) {
    return errorResponse(res, error?.message || '创建部署目标失败', 400);
  }
});

router.put('/targets/:id', async (req: AuthRequest, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) return errorResponse(res, '无效的目标 ID', 400);
    const target = await CertificateDeployService.updateTarget(req.user!.id, targetId, req.body || {});
    return successResponse(res, { target }, '更新部署目标成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '更新部署目标失败', 400);
  }
});

router.delete('/targets/:id', async (req: AuthRequest, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) return errorResponse(res, '无效的目标 ID', 400);
    await CertificateDeployService.deleteTarget(req.user!.id, targetId);
    return successResponse(res, null, '删除部署目标成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '删除部署目标失败', 400);
  }
});

router.get('/targets/:id/resources', async (req: AuthRequest, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) return errorResponse(res, '无效的目标 ID', 400);
    const result = await CertificateDeployService.listTargetResources(req.user!.id, targetId, req.query as Record<string, any>);
    return successResponse(res, result, '获取目标资源成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取目标资源失败', 400);
  }
});

router.post('/targets/:id/test', async (req: AuthRequest, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) return errorResponse(res, '无效的目标 ID', 400);
    const result = await CertificateDeployService.testTarget(req.user!.id, targetId);
    return successResponse(res, { result }, '部署目标测试成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '部署目标测试失败', 400);
  }
});

router.get('/jobs', async (req: AuthRequest, res) => {
  try {
    const jobs = await CertificateDeployService.listJobs(req.user!.id);
    return successResponse(res, { jobs }, '获取部署任务成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取部署任务失败', 500);
  }
});

router.post('/jobs', async (req: AuthRequest, res) => {
  try {
    const job = await CertificateDeployService.createJob(req.user!.id, {
      certificateOrderId: req.body?.certificateOrderId !== undefined && req.body?.certificateOrderId !== null ? Number(req.body.certificateOrderId) : null,
      vendorCertificateOrderId: req.body?.vendorCertificateOrderId !== undefined && req.body?.vendorCertificateOrderId !== null ? Number(req.body.vendorCertificateOrderId) : null,
      certificateDeployTargetId: Number(req.body?.certificateDeployTargetId),
      enabled: req.body?.enabled,
      triggerOnIssue: req.body?.triggerOnIssue,
      triggerOnRenew: req.body?.triggerOnRenew,
      binding: req.body?.binding,
    });
    return successResponse(res, { job }, '创建部署任务成功', 201);
  } catch (error: any) {
    return errorResponse(res, error?.message || '创建部署任务失败', 400);
  }
});

router.put('/jobs/:id', async (req: AuthRequest, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    if (!Number.isFinite(jobId)) return errorResponse(res, '无效的任务 ID', 400);
    const job = await CertificateDeployService.updateJob(req.user!.id, jobId, {
      certificateOrderId: req.body?.certificateOrderId !== undefined ? (req.body.certificateOrderId === null ? null : Number(req.body.certificateOrderId)) : undefined,
      vendorCertificateOrderId: req.body?.vendorCertificateOrderId !== undefined ? (req.body.vendorCertificateOrderId === null ? null : Number(req.body.vendorCertificateOrderId)) : undefined,
      certificateDeployTargetId: req.body?.certificateDeployTargetId !== undefined ? Number(req.body.certificateDeployTargetId) : undefined,
      enabled: req.body?.enabled,
      triggerOnIssue: req.body?.triggerOnIssue,
      triggerOnRenew: req.body?.triggerOnRenew,
      binding: req.body?.binding,
    });
    return successResponse(res, { job }, '更新部署任务成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '更新部署任务失败', 400);
  }
});

router.get('/jobs/:id/runs', async (req: AuthRequest, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    if (!Number.isFinite(jobId)) return errorResponse(res, '无效的任务 ID', 400);
    const result = await CertificateActivityService.getDeployJobRuns(req.user!.id, jobId);
    return successResponse(res, result, '获取部署执行记录成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取部署执行记录失败', 404);
  }
});

router.delete('/jobs/:id', async (req: AuthRequest, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    if (!Number.isFinite(jobId)) return errorResponse(res, '无效的任务 ID', 400);
    await CertificateDeployService.deleteJob(req.user!.id, jobId);
    return successResponse(res, null, '删除部署任务成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '删除部署任务失败', 400);
  }
});

router.post('/jobs/:id/run', async (req: AuthRequest, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    if (!Number.isFinite(jobId)) return errorResponse(res, '无效的任务 ID', 400);
    const event = req.body?.event === 'certificate.renewed' ? 'certificate.renewed' : 'certificate.issued';
    const job = await CertificateDeployService.runJob(req.user!.id, jobId, event);
    return successResponse(res, { job }, '部署任务执行成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '部署任务执行失败', 400);
  }
});

export default router;
