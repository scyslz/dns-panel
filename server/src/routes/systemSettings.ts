/**
 * 系统设置接口（仅管理员）。
 *
 * 挂载点：/api/system-settings
 * 设置保存到数据库，改完立即生效，无需重启或改环境变量。
 */

import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimit';
import { successResponse, errorResponse } from '../utils/response';
import { AuthRequest } from '../types';
import { getClientIp } from '../middleware/logger';
import { LoggerService } from '../services/logger';
import { getFullSettings } from '../services/roles';
import { UserService } from '../services/userManagement';

const router = Router();
router.use(authenticateToken, requireAdmin);

router.get('/', async (_req, res) => {
  try {
    const settings = await getFullSettings();
    return successResponse(res, { settings }, '获取系统设置成功');
  } catch (error: any) {
    return errorResponse(res, error.message || '获取系统设置失败', 400);
  }
});

router.put('/', sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    const body = req.body || {};
    for (const key of ['multiUserEnabled', 'registrationEnabled', 'registrationRequiresApproval'] as const) {
      if (body[key] !== undefined && typeof body[key] !== 'boolean') {
        return errorResponse(res, `${key} 必须为布尔值`, 400);
      }
    }

    const settings = await UserService.updateSettings(req.user!.id, {
      multiUserEnabled: body.multiUserEnabled,
      registrationEnabled: body.registrationEnabled,
      registrationRequiresApproval: body.registrationRequiresApproval,
    });

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'USER',
      recordName: req.user?.username,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ action: 'system_settings', ...settings }),
    });

    return successResponse(res, { settings }, '系统设置已保存，立即生效');
  } catch (error: any) {
    return errorResponse(res, error.message || '保存系统设置失败', 400);
  }
});

export default router;
