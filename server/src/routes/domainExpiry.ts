import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { generalLimiter } from '../middleware/rateLimit';
import { successResponse, errorResponse } from '../utils/response';
import { DomainExpiryService } from '../services/domainExpiry';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const router = Router();

/**
 * POST /api/domain-expiry/lookup
 * 批量查询域名注册到期时间（RDAP 优先，结果缓存）
 */
router.post('/lookup', authenticateToken, generalLimiter, async (req, res) => {
  try {
    const domains = req.body?.domains;
    if (!Array.isArray(domains) || domains.length === 0) {
      return errorResponse(res, '缺少参数: domains (string[])', 400);
    }

    if (domains.length > 500) {
      return errorResponse(res, 'domains 数量过多，最多 500 条', 400);
    }

    const results = await DomainExpiryService.lookupDomains(domains);
    const userId = (req as any).user?.id;

    if (userId) {
      const overrides = await prisma.domainExpiryOverride.findMany({
        where: { userId, domain: { in: domains.map(d => d.toLowerCase()) } }
      });
      const overrideMap = new Map(overrides.map(o => [o.domain.toLowerCase(), o.expiresAt.toISOString()]));

      results.forEach(r => {
        const override = overrideMap.get(r.domain.toLowerCase());
        if (override) {
          r.expiresAt = override;
          r.source = 'manual';
        }
      });
    }

    return successResponse(res, { results }, '获取域名到期信息成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '查询失败', 500);
  }
});

router.post('/override', authenticateToken, generalLimiter, async (req, res) => {
  try {
    const { domain, expiresAt } = req.body;
    const userId = (req as any).user?.id;

    if (!domain || !expiresAt) {
      return errorResponse(res, '缺少参数: domain, expiresAt', 400);
    }

    const date = new Date(expiresAt);
    if (isNaN(date.getTime())) {
      return errorResponse(res, '无效的日期格式', 400);
    }

    await prisma.domainExpiryOverride.upsert({
      where: { userId_domain: { userId, domain: domain.toLowerCase() } },
      create: { userId, domain: domain.toLowerCase(), expiresAt: date },
      update: { expiresAt: date }
    });

    return successResponse(res, null, '设置成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '设置失败', 500);
  }
});

router.delete('/override', authenticateToken, generalLimiter, async (req, res) => {
  try {
    const { domain } = req.body;
    const userId = (req as any).user?.id;

    if (!domain) {
      return errorResponse(res, '缺少参数: domain', 400);
    }

    await prisma.domainExpiryOverride.deleteMany({
      where: { userId, domain: domain.toLowerCase() }
    });

    return successResponse(res, null, '删除成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '删除失败', 500);
  }
});

export default router;
