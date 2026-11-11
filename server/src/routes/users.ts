/**
 * 用户管理接口（仅管理员）。
 *
 * 挂载点：/api/users
 * 所有路由都经过 authenticateToken + requireAdmin；不存在任何匿名/普通用户可调用的入口。
 */

import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimit';
import { successResponse, errorResponse } from '../utils/response';
import { AuthRequest } from '../types';
import { getClientIp } from '../middleware/logger';
import { LoggerService } from '../services/logger';
import { UserService } from '../services/userManagement';
import { getFullSettings, getSettingsRow } from '../services/roles';

const router = Router();
router.use(authenticateToken, requireAdmin);

function parseId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('无效的用户 ID');
  return id;
}

async function audit(req: AuthRequest, action: 'CREATE' | 'UPDATE' | 'DELETE', recordName: string, detail: any, error?: string) {
  await LoggerService.createLog({
    userId: req.user!.id,
    action,
    resourceType: 'USER',
    recordName,
    status: error ? 'FAILED' : 'SUCCESS',
    ipAddress: getClientIp(req),
    ...(error ? { errorMessage: error } : { newValue: JSON.stringify(detail) }),
  });
}

/** 多用户关闭时，禁止任何新增用户 / 审核 / 删除等写操作（列表仍可只读查看） */
async function assertMultiUserEnabled(): Promise<void> {
  const row = await getSettingsRow();
  if (!row.multiUserEnabled) throw new Error('多用户功能已关闭');
}

/** 设置页读取：用户列表 + 系统设置一次返回，避免两个请求竞态 */
router.get('/context', async (_req, res) => {
  try {
    const [users, settings] = await Promise.all([
      UserService.listUsers(),
      getFullSettings(),
    ]);
    return successResponse(res, { users, settings }, '获取用户管理上下文成功');
  } catch (error: any) {
    return errorResponse(res, error.message || '获取用户管理上下文失败', 400);
  }
});

router.get('/', async (_req, res) => {
  try {
    const users = await UserService.listUsers();
    return successResponse(res, { users }, '获取用户列表成功');
  } catch (error: any) {
    return errorResponse(res, error.message || '获取用户列表失败', 400);
  }
});

router.post('/', sensitiveLimiter, async (req: AuthRequest, res) => {
  const username = String(req.body?.username || '');
  try {
    await assertMultiUserEnabled();
    const user = await UserService.createUser(
      { id: req.user!.id, username: req.user!.username },
      {
        username,
        email: req.body?.email,
        password: req.body?.password,
        role: req.body?.role,
      }
    );
    await audit(req, 'CREATE', username, { id: user.id, role: user.role });
    return successResponse(res, { user }, '用户创建成功', 201);
  } catch (error: any) {
    await audit(req, 'CREATE', username, null, error?.message);
    return errorResponse(res, error.message || '创建用户失败', 400);
  }
});

router.patch('/:id/role', sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    const id = parseId(req.params.id);
    await assertMultiUserEnabled();
    const user = await UserService.updateRole(req.user!.id, id, req.body?.role);
    await audit(req, 'UPDATE', user.username, { id, role: user.role });
    return successResponse(res, { user }, '角色已更新');
  } catch (error: any) {
    await audit(req, 'UPDATE', req.params.id, null, error?.message);
    return errorResponse(res, error.message || '更新角色失败', 400);
  }
});

router.patch('/:id/active', sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    const id = parseId(req.params.id);
    await assertMultiUserEnabled();
    const user = await UserService.setActive(req.user!.id, id, !!req.body?.isActive);
    await audit(req, 'UPDATE', user.username, { id, isActive: user.isActive });
    return successResponse(res, { user }, user.isActive ? '账号已启用' : '账号已禁用');
  } catch (error: any) {
    await audit(req, 'UPDATE', req.params.id, null, error?.message);
    return errorResponse(res, error.message || '更新账号状态失败', 400);
  }
});

router.post('/:id/approve', sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    const id = parseId(req.params.id);
    await assertMultiUserEnabled();
    const user = await UserService.approveUser(req.user!.id, id);
    await audit(req, 'UPDATE', user.username, { id, approved: true });
    return successResponse(res, { user }, '审核通过，该账号现在可以登录');
  } catch (error: any) {
    await audit(req, 'UPDATE', req.params.id, null, error?.message);
    return errorResponse(res, error.message || '审核失败', 400);
  }
});

router.post('/:id/reset-password', sensitiveLimiter, async (req: AuthRequest, res) => {
  try {
    const id = parseId(req.params.id);
    const result = await UserService.resetPassword(req.user!.id, id, req.body?.newPassword);
    const target = await UserService.listUsers();
    const name = target.find((u) => u.id === id)?.username || String(id);
    await audit(req, 'UPDATE', name, { id, passwordReset: true });
    return successResponse(res, result, '密码已重置，该账号的旧会话已失效');
  } catch (error: any) {
    await audit(req, 'UPDATE', req.params.id, null, error?.message);
    return errorResponse(res, error.message || '重置密码失败', 400);
  }
});

router.delete('/:id', sensitiveLimiter, async (req: AuthRequest, res) => {
  let name = req.params.id;
  try {
    const id = parseId(req.params.id);
    await assertMultiUserEnabled();
    const users = await UserService.listUsers();
    name = users.find((u) => u.id === id)?.username || name;
    const result = await UserService.deleteUser(req.user!.id, id);
    await audit(req, 'DELETE', name, { id });
    return successResponse(res, result, '用户已删除，其关联数据已清理');
  } catch (error: any) {
    await audit(req, 'DELETE', name, null, error?.message);
    return errorResponse(res, error.message || '删除用户失败', 400);
  }
});

export default router;
