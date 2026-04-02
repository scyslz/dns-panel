import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';
import { errorResponse, successResponse } from '../utils/response';
import { VendorCertificateService } from '../services/cert/VendorCertificateService';
import { CertificateActivityService } from '../services/cert/CertificateActivityService';

const router = Router();
router.use(authenticateToken);

router.get('/providers', async (_req: AuthRequest, res) => {
  try {
    const providers = VendorCertificateService.listProviders();
    return successResponse(res, { providers }, '获取厂商证书渠道成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取厂商证书渠道失败', 500);
  }
});

router.get('/', async (req: AuthRequest, res) => {
  try {
    const orders = await VendorCertificateService.listOrders(req.user!.id);
    return successResponse(res, { orders }, '获取厂商证书订单成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取厂商证书订单失败', 500);
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const body = req.body || {};
    const order = await VendorCertificateService.createOrder(req.user!.id, {
      provider: body.provider,
      vendorCredentialId: Number(body.vendorCredentialId),
      validationDnsCredentialId: Number(body.validationDnsCredentialId),
      domains: Array.isArray(body.domains) ? body.domains : [],
      contactProfile: body.contactProfile || null,
    });
    return successResponse(res, { order }, '创建厂商证书订单成功', 201);
  } catch (error: any) {
    return errorResponse(res, error?.message || '创建厂商证书订单失败', 400);
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return errorResponse(res, '无效的订单 ID', 400);
    const order = await VendorCertificateService.getOrder(req.user!.id, id);
    return successResponse(res, { order }, '获取厂商证书订单详情成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取厂商证书订单详情失败', 404);
  }
});

router.get('/:id/timeline', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return errorResponse(res, '无效的订单 ID', 400);
    const result = await CertificateActivityService.getVendorTimeline(req.user!.id, id);
    return successResponse(res, result, '获取厂商证书时间线成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取厂商证书时间线失败', 404);
  }
});

router.post('/:id/retry', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return errorResponse(res, '无效的订单 ID', 400);
    const order = await VendorCertificateService.retryOrder(req.user!.id, id);
    return successResponse(res, { order }, '已提交重试');
  } catch (error: any) {
    return errorResponse(res, error?.message || '提交重试失败', 400);
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return errorResponse(res, '无效的订单 ID', 400);
    const result = await VendorCertificateService.deleteOrder(req.user!.id, id);
    return successResponse(res, result, '厂商证书订单已删除');
  } catch (error: any) {
    return errorResponse(res, error?.message || '删除厂商证书订单失败', 400);
  }
});

router.get('/:id/download', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return errorResponse(res, '无效的订单 ID', 400);
    const zipBuffer = await VendorCertificateService.buildDownloadZip(req.user!.id, id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=vendor-certificate-${id}.zip`);
    return res.send(zipBuffer);
  } catch (error: any) {
    return errorResponse(res, error?.message || '下载厂商证书失败', 400);
  }
});

export default router;
