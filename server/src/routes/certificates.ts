import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { CertificateOrderService } from '../services/cert/CertificateOrderService';
import { CertificateActivityService } from '../services/cert/CertificateActivityService';

const router = Router();
router.use(authenticateToken);

router.get('/', async (req: AuthRequest, res) => {
  try {
    const orders = await CertificateOrderService.listOrders(req.user!.id);
    return successResponse(res, { orders }, '获取证书订单成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取证书订单失败', 500);
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const body = req.body || {};
    const mode = body.mode;
    if (mode !== 'draft' && mode !== 'apply') {
      return errorResponse(res, 'mode 必须为 draft 或 apply', 400);
    }
    const order = await CertificateOrderService.createOrder(req.user!.id, {
      mode,
      certificateCredentialId: Number(body.certificateCredentialId),
      dnsCredentialId: Number(body.dnsCredentialId),
      domains: Array.isArray(body.domains) ? body.domains : [],
      autoRenew: body.autoRenew !== undefined ? body.autoRenew !== false : true,
    });
    return successResponse(res, { order }, body.mode === 'draft' ? '保存草稿成功' : '创建并申请成功', 201);
  } catch (error: any) {
    return errorResponse(res, error?.message || '创建证书订单失败', 400);
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) return errorResponse(res, '无效的订单 ID', 400);
    const order = await CertificateOrderService.getOrder(req.user!.id, orderId);
    return successResponse(res, { order }, '获取证书订单详情成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取证书订单详情失败', 404);
  }
});

router.get('/:id/timeline', async (req: AuthRequest, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) return errorResponse(res, '无效的订单 ID', 400);
    const result = await CertificateActivityService.getCertificateTimeline(req.user!.id, orderId);
    return successResponse(res, result, '获取证书时间线成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取证书时间线失败', 404);
  }
});

router.post('/:id/retry', async (req: AuthRequest, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) return errorResponse(res, '无效的订单 ID', 400);
    const order = await CertificateOrderService.retryOrder(req.user!.id, orderId);
    return successResponse(res, { order }, '已提交重试');
  } catch (error: any) {
    return errorResponse(res, error?.message || '提交重试失败', 400);
  }
});

router.post('/:id/auto-renew', async (req: AuthRequest, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) return errorResponse(res, '无效的订单 ID', 400);
    const enabled = req.body?.enabled !== false;
    const order = await CertificateOrderService.setAutoRenew(req.user!.id, orderId, enabled);
    return successResponse(res, { order }, enabled ? '已开启自动续期' : '已关闭自动续期');
  } catch (error: any) {
    return errorResponse(res, error?.message || '更新自动续期失败', 400);
  }
});

router.get('/:id/download', async (req: AuthRequest, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) return errorResponse(res, '无效的订单 ID', 400);
    const zipBuffer = await CertificateOrderService.buildDownloadZip(req.user!.id, orderId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=certificate-${orderId}.zip`);
    return res.send(zipBuffer);
  } catch (error: any) {
    return errorResponse(res, error?.message || '下载证书失败', 400);
  }
});

export default router;
