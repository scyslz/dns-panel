import jwt from 'jsonwebtoken';
import { config } from '../config';

/**
 * 签发正式登录 JWT。
 * 带 type=access 与凭据版本 tv；认证中间件每次请求查库校验，
 * 因此禁用账号 / 改密 / 重置密码 / 角色变更都能让旧 token 立即失效。
 */
export function signUserToken(user: {
  id: number;
  username: string;
  email: string | null;
  tokenVersion: number;
}) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      tv: user.tokenVersion,
      type: 'access',
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as any }
  );
}
