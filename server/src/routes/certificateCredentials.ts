import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { encrypt, decrypt } from '../utils/encryption';
import { AcmeProviderType } from '../types';
import { AcmeService } from '../services/cert/AcmeService';
import { createLog } from '../services/logger';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticateToken);

function isAcmeProviderType(value: string): value is AcmeProviderType {
  return ['letsencrypt', 'zerossl', 'google', 'custom'].includes(value);
}

router.get('/providers', async (_req, res) => {
  try {
    return successResponse(res, { providers: AcmeService.listProviders() }, '获取证书账户提供商成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取证书账户提供商失败', 500);
  }
});

router.get('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const credentials = await prisma.certificateCredential.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        provider: true,
        email: true,
        directoryUrl: true,
        eabKid: true,
        accountUrl: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return successResponse(res, { credentials }, '获取证书账户列表成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '获取证书账户列表失败', 500);
  }
});

router.post('/', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const body = req.body || {};
  try {
    const provider = String(body.provider || '').trim() as AcmeProviderType;
    if (!isAcmeProviderType(provider)) return errorResponse(res, '不支持的证书账户类型', 400);

    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    if (!name || !email) return errorResponse(res, 'name 和 email 不能为空', 400);

    const validated = await AcmeService.validateAndProvisionCredential({
      provider,
      email,
      directoryUrl: body.directoryUrl,
      eabKid: body.eabKid,
      eabHmacKey: body.eabHmacKey,
      accountKeyPem: body.accountKeyPem,
      accountUrl: body.accountUrl,
    });

    const existingCount = await prisma.certificateCredential.count({ where: { userId } });
    const shouldDefault = existingCount === 0 || body.isDefault === true;
    if (shouldDefault) {
      await prisma.certificateCredential.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }

    const created = await prisma.certificateCredential.create({
      data: {
        userId,
        name,
        provider,
        email,
        directoryUrl: validated.directoryUrl,
        eabKid: body.eabKid ? String(body.eabKid).trim() : null,
        eabHmacKey: body.eabHmacKey ? encrypt(String(body.eabHmacKey)) : null,
        accountKeyPem: encrypt(validated.accountKeyPem),
        accountUrl: validated.accountUrl,
        isDefault: shouldDefault,
      },
      select: {
        id: true,
        name: true,
        provider: true,
        email: true,
        directoryUrl: true,
        eabKid: true,
        accountUrl: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await createLog({ userId, action: 'CREATE', resourceType: 'CERTIFICATE_CREDENTIAL', domain: created.provider, recordName: created.name, status: 'SUCCESS', ipAddress: req.ip });
    return successResponse(res, { credential: created }, '创建证书账户成功', 201);
  } catch (error: any) {
    await createLog({ userId, action: 'CREATE', resourceType: 'CERTIFICATE_CREDENTIAL', recordName: String(body?.name || ''), status: 'FAILED', errorMessage: error?.message || '创建证书账户失败', ipAddress: req.ip });
    return errorResponse(res, error?.message || '创建证书账户失败', 400);
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const credentialId = parseInt(req.params.id, 10);
  const body = req.body || {};
  try {
    if (!Number.isFinite(credentialId)) return errorResponse(res, '无效的账户 ID', 400);
    const existing = await prisma.certificateCredential.findFirst({ where: { id: credentialId, userId } });
    if (!existing) return errorResponse(res, '证书账户不存在', 404);

    const provider = String(body.provider || existing.provider || '').trim() as AcmeProviderType;
    if (!isAcmeProviderType(provider)) return errorResponse(res, '不支持的证书账户类型', 400);

    const name = String(body.name || existing.name || '').trim();
    const email = String(body.email || existing.email || '').trim();
    if (!name || !email) return errorResponse(res, 'name 和 email 不能为空', 400);

    const validated = await AcmeService.validateAndProvisionCredential({
      provider,
      email,
      directoryUrl: body.directoryUrl ?? existing.directoryUrl,
      eabKid: body.eabKid ?? existing.eabKid,
      eabHmacKey: body.eabHmacKey !== undefined ? body.eabHmacKey : (existing.eabHmacKey ? decrypt(existing.eabHmacKey) : null),
      accountKeyPem: body.accountKeyPem !== undefined ? body.accountKeyPem : decrypt(existing.accountKeyPem),
      accountUrl: body.accountUrl ?? existing.accountUrl,
    });

    const shouldDefault = body.isDefault === true || existing.isDefault;
    if (shouldDefault) {
      await prisma.certificateCredential.updateMany({ where: { userId, isDefault: true, id: { not: credentialId } }, data: { isDefault: false } });
    }

    const updated = await prisma.certificateCredential.update({
      where: { id: credentialId },
      data: {
        name,
        provider,
        email,
        directoryUrl: validated.directoryUrl,
        eabKid: body.eabKid !== undefined ? (body.eabKid ? String(body.eabKid).trim() : null) : existing.eabKid,
        eabHmacKey: body.eabHmacKey !== undefined
          ? (body.eabHmacKey ? encrypt(String(body.eabHmacKey)) : null)
          : existing.eabHmacKey,
        accountKeyPem: encrypt(validated.accountKeyPem),
        accountUrl: validated.accountUrl,
        isDefault: shouldDefault,
      },
      select: {
        id: true,
        name: true,
        provider: true,
        email: true,
        directoryUrl: true,
        eabKid: true,
        accountUrl: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await createLog({ userId, action: 'UPDATE', resourceType: 'CERTIFICATE_CREDENTIAL', domain: updated.provider, recordName: updated.name, status: 'SUCCESS', ipAddress: req.ip });
    return successResponse(res, { credential: updated }, '更新证书账户成功');
  } catch (error: any) {
    await createLog({ userId, action: 'UPDATE', resourceType: 'CERTIFICATE_CREDENTIAL', recordName: String(body?.name || ''), status: 'FAILED', errorMessage: error?.message || '更新证书账户失败', ipAddress: req.ip });
    return errorResponse(res, error?.message || '更新证书账户失败', 400);
  }
});

router.post('/:id/default', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const credentialId = parseInt(req.params.id, 10);
    if (!Number.isFinite(credentialId)) return errorResponse(res, '无效的账户 ID', 400);

    const existing = await prisma.certificateCredential.findFirst({ where: { id: credentialId, userId } });
    if (!existing) return errorResponse(res, '证书账户不存在', 404);

    await prisma.$transaction([
      prisma.certificateCredential.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
      prisma.certificateCredential.update({ where: { id: credentialId }, data: { isDefault: true } }),
    ]);

    return successResponse(res, null, '设置默认账户成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '设置默认账户失败', 500);
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const credentialId = parseInt(req.params.id, 10);
    if (!Number.isFinite(credentialId)) return errorResponse(res, '无效的账户 ID', 400);

    const existing = await prisma.certificateCredential.findFirst({ where: { id: credentialId, userId } });
    if (!existing) return errorResponse(res, '证书账户不存在', 404);

    const orderCount = await prisma.certificateOrder.count({ where: { certificateCredentialId: credentialId } });
    if (orderCount > 0) return errorResponse(res, '该证书账户下存在订单，无法删除', 400);

    await prisma.certificateCredential.delete({ where: { id: credentialId } });
    if (existing.isDefault) {
      const next = await prisma.certificateCredential.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
      if (next) {
        await prisma.certificateCredential.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }

    return successResponse(res, null, '删除证书账户成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '删除证书账户失败', 500);
  }
});

export default router;
