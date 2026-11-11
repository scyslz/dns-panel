import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { errorResponse } from '../utils/response';
import { AuthRequest } from '../types';
import { isUserRole, rolePrisma } from '../services/roles';

/**
 * JWT 验证中间件
 *  - 只接受 type 为 'access' 的正式登录 token，拒绝 2fa_pending 等临时 token
 *  - 每次请求查库，保证「禁用 / 改密 / 角色变更」立即生效，而不是等 7 天 JWT 过期
 */
export async function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return errorResponse(res, '未提供认证令牌', 401);
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch {
      return errorResponse(res, '无效或过期的令牌', 401);
    }

    // 拒绝 2FA 临时 token，只接受正式的 access token
    if (decoded.type !== 'access') {
      return errorResponse(res, '无效或过期的令牌', 401);
    }

    const user = await rolePrisma.user.findUnique({
      where: { id: Number(decoded.id) },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        pendingApproval: true,
        tokenVersion: true,
      },
    });

    if (!user || !user.isActive || user.pendingApproval) {
      return errorResponse(res, user?.pendingApproval ? '账号待管理员审核' : '账号已被禁用', 401);
    }

    // 凭据版本不匹配 => 改密 / 重置密码 / 权限变更后旧 token 立即作废
    if (Number(decoded.tv || 0) !== user.tokenVersion) {
      return errorResponse(res, '登录状态已失效，请重新登录', 401);
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email || '',
      role: isUserRole(user.role) ? user.role : 'user',
    };

    next();
  } catch (error) {
    return errorResponse(res, '认证失败', 401);
  }
}

/** 仅管理员可访问的用户管理接口 */
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (req.user?.role !== 'admin') {
    return errorResponse(res, '需要管理员权限', 403);
  }
  return next();
}
