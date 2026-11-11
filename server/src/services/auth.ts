import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { encrypt, decrypt } from '../utils/encryption';
import { signUserToken } from '../utils/jwt';
import { TwoFactorService } from './twoFactor';
import { UserRole } from '../types';
import {
  canPubliclyRegister,
  createManagedUser,
  isUserRole,
  shouldRequireApproval,
} from './roles';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

export function assertStrongPassword(password: string) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('密码长度至少为 8 位');
  }
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    throw new Error('密码必须包含大小写字母和数字');
  }
}

function validateUsername(username: string) {
  const value = String(username || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(value)) {
    throw new Error('用户名需为 3-32 位字母、数字、_、. 或 -');
  }
  return value;
}

function validateEmail(email?: string | null) {
  if (email === undefined || email === null || email === '') return null;
  const value = String(email).trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('邮箱格式不正确');
  }
  return value;
}

async function assertUniqueUser(username: string, email: string | null, excludeId?: number) {
  const orConditions: Array<{ username?: string; email?: string }> = [{ username }];
  if (email) orConditions.push({ email });
  const existing = await prisma.user.findFirst({
    where: {
      OR: orConditions,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) throw new Error('用户名或邮箱已存在');
}

interface LoginResult {
  requires2FA: boolean;
  tempToken?: string;
  token?: string;
  user?: {
    id: number;
    username: string;
    email: string | null;
    role: UserRole;
    domainExpiryDisplayMode: string;
    domainExpiryThresholdDays: number;
    showNonAuthoritativeDomains: boolean;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecure: boolean | null;
    smtpUser: string | null;
    smtpFrom: string | null;
    smtpPassConfigured: boolean;
  };
}

/**
 * 认证服务
 */
export class AuthService {
  /**
   * 用户注册（仅限空库初始化 / 管理员创建，公开注册策略由路由层控制）
   *
   * registrationMode:
   *  - 'public'：空库且 ALLOW_PUBLIC_REGISTRATION=true 时，匿名创建首个管理员
   *  - 'admin' ：已登录管理员创建用户，角色由 params.role 指定
   * callerId 由已鉴权的路由传入，用于「谁创建了谁」的审计。
   */
  static async register(params: {
    username: string;
    email?: string;
    password: string;
    cfApiToken?: string;
    cfAccountId?: string;
    role?: UserRole;
    registrationMode: 'public' | 'admin';
  }, actor?: { id: number; username: string }) {
    const username = validateUsername(params.username);
    const email = validateEmail(params.email);
    assertStrongPassword(params.password);

    if (params.registrationMode === 'public' && !(await canPubliclyRegister())) {
      throw new Error('公开注册已关闭，请联系管理员创建账号');
    }
    if (params.registrationMode === 'admin') {
      if (!actor) throw new Error('未授权');
      if (params.role && !isUserRole(params.role)) throw new Error('角色无效');
    }
    // 公开注册且开启审核时，新账号进入待审核（空库首个管理员除外）
    const pendingApproval = params.registrationMode === 'public'
      ? await shouldRequireApproval()
      : false;

    await assertUniqueUser(username, email);

    const hashedPassword = await bcrypt.hash(params.password, SALT_ROUNDS);
    const encryptedToken = params.cfApiToken ? encrypt(params.cfApiToken) : undefined;

    try {
      return await createManagedUser({
        username,
        email,
        passwordHash: hashedPassword,
        role: params.registrationMode === 'admin' ? params.role : undefined,
        pendingApproval,
        cfApiToken: encryptedToken,
        cfAccountId: params.cfAccountId,
      });
    } catch (error: any) {
      // 并发下唯一索引冲突，转成可读提示
      if (String(error?.code || '').includes('P2002')) {
        throw new Error('用户名或邮箱已存在');
      }
      throw error;
    }
  }

  /**
   * 用户登录（支持 2FA）
   */
  static async login(params: { username: string; password: string }): Promise<LoginResult> {
    // 查找用户（支持用户名或邮箱登录）
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: params.username }, ...(params.username ? [{ email: params.username }] : [])],
      },
    });

    if (!user || !user.isActive) {
      throw new Error('用户名或密码错误');
    }

    // 开启注册审核后，公开注册的新账号必须经管理员审核才能登录
    if (user.pendingApproval) {
      throw new Error('账号待管理员审核，通过后方可登录');
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(params.password, user.password);

    if (!isPasswordValid) {
      throw new Error('用户名或密码错误');
    }

    // 如果用户启用了 2FA，返回临时 token
    if (user.twoFactorEnabled) {
      const tempToken = TwoFactorService.generateTempToken(user);
      return {
        requires2FA: true,
        tempToken,
      };
    }

    // 未启用 2FA，直接生成 JWT Token
    const token = signUserToken(user);

    return {
      requires2FA: false,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: isUserRole(user.role) ? user.role : 'user',
        domainExpiryDisplayMode: user.domainExpiryDisplayMode,
        domainExpiryThresholdDays: user.domainExpiryThresholdDays,
        showNonAuthoritativeDomains: (user as any).showNonAuthoritativeDomains ?? false,
        smtpHost: (user as any).smtpHost ?? null,
        smtpPort: (user as any).smtpPort ?? null,
        smtpSecure: (user as any).smtpSecure ?? null,
        smtpUser: (user as any).smtpUser ?? null,
        smtpFrom: (user as any).smtpFrom ?? null,
        smtpPassConfigured: !!(user as any).smtpPass,
      },
    };
  }

  /**
   * 获取用户信息
   */
  static async getUserById(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        cfAccountId: true,
        twoFactorEnabled: true,
        domainExpiryDisplayMode: true,
        domainExpiryThresholdDays: true,
        showNonAuthoritativeDomains: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpFrom: true,
        smtpPass: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    const { smtpPass, ...safe } = user as any;
    return {
      ...safe,
      role: isUserRole(safe.role) ? safe.role : 'user',
      smtpPassConfigured: !!smtpPass,
    };
  }

  static async updateDomainExpirySettings(
    userId: number,
    input: {
      displayMode?: 'date' | 'days';
      thresholdDays?: number;
      showNonAuthoritativeDomains?: boolean;
      smtpHost?: string | null;
      smtpPort?: number | null;
      smtpSecure?: boolean | null;
      smtpUser?: string | null;
      smtpPass?: string | null;
      smtpFrom?: string | null;
    }
  ) {
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        showNonAuthoritativeDomains: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpPass: true,
        smtpFrom: true,
      },
    });

    if (!current) {
      throw new Error('用户不存在');
    }

    const smtpTouched =
      input.smtpHost !== undefined ||
      input.smtpPort !== undefined ||
      input.smtpSecure !== undefined ||
      input.smtpUser !== undefined ||
      input.smtpPass !== undefined ||
      input.smtpFrom !== undefined;

    let nextSmtpHost = (current as any).smtpHost ?? null;
    let nextSmtpPort = (current as any).smtpPort ?? null;
    let nextSmtpSecure = (current as any).smtpSecure ?? null;
    let nextSmtpUser = (current as any).smtpUser ?? null;
    let nextSmtpPass = (current as any).smtpPass ?? null;
    let nextSmtpFrom = (current as any).smtpFrom ?? null;

    if (input.smtpHost !== undefined) {
      const raw = typeof input.smtpHost === 'string' ? input.smtpHost.trim() : '';
      if (!raw) {
        nextSmtpHost = null;
        nextSmtpPort = null;
        nextSmtpSecure = null;
        nextSmtpUser = null;
        nextSmtpPass = null;
        nextSmtpFrom = null;
      } else {
        nextSmtpHost = raw;
      }
    }

    const hasCustomSmtp = !!nextSmtpHost;

    if (!hasCustomSmtp) {
      nextSmtpPort = null;
      nextSmtpSecure = null;
      nextSmtpUser = null;
      nextSmtpPass = null;
      nextSmtpFrom = null;
    } else if (smtpTouched) {
      if (input.smtpPort !== undefined) {
        if (input.smtpPort === null) {
          nextSmtpPort = null;
        } else {
          const parsed = Math.floor(Number(input.smtpPort));
          if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
            throw new Error('SMTP 端口无效，应为 1-65535 的整数');
          }
          nextSmtpPort = parsed;
        }
      }

      if (input.smtpSecure !== undefined) {
        nextSmtpSecure = input.smtpSecure === null ? null : !!input.smtpSecure;
      }

      if (input.smtpUser !== undefined) {
        const raw = typeof input.smtpUser === 'string' ? input.smtpUser.trim() : '';
        nextSmtpUser = raw ? raw : null;
        if (!nextSmtpUser) {
          nextSmtpPass = null;
        }
      }

      if (input.smtpPass !== undefined) {
        const raw = typeof input.smtpPass === 'string' ? input.smtpPass.trim() : '';
        nextSmtpPass = raw ? encrypt(raw) : null;
      }

      if (input.smtpFrom !== undefined) {
        const raw = typeof input.smtpFrom === 'string' ? input.smtpFrom.trim() : '';
        nextSmtpFrom = raw ? raw : null;
      }

      if (!String(nextSmtpFrom || '').trim()) {
        throw new Error('使用自定义 SMTP 时需填写 From');
      }

      const authUser = typeof nextSmtpUser === 'string' ? nextSmtpUser.trim() : '';
      const authPassPresent = !!(typeof nextSmtpPass === 'string' ? nextSmtpPass.trim() : '');
      if ((authUser && !authPassPresent) || (!authUser && authPassPresent)) {
        throw new Error('SMTP 认证信息不完整');
      }
    }

    const data: any = {};

    if (input.displayMode) {
      data.domainExpiryDisplayMode = input.displayMode;
    }

    if (input.thresholdDays !== undefined) {
      const parsed = Math.floor(Number(input.thresholdDays));
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 365) {
        throw new Error('阈值天数无效，应为 1-365 的整数');
      }
      data.domainExpiryThresholdDays = parsed;
    }

    if (input.showNonAuthoritativeDomains !== undefined) {
      data.showNonAuthoritativeDomains = !!input.showNonAuthoritativeDomains;
    }

    if (smtpTouched) {
      data.smtpHost = hasCustomSmtp ? nextSmtpHost : null;
      data.smtpPort = hasCustomSmtp ? nextSmtpPort : null;
      data.smtpSecure = hasCustomSmtp ? nextSmtpSecure : null;
      data.smtpUser = hasCustomSmtp ? nextSmtpUser : null;
      data.smtpPass = hasCustomSmtp ? nextSmtpPass : null;
      data.smtpFrom = hasCustomSmtp ? nextSmtpFrom : null;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        domainExpiryDisplayMode: true,
        domainExpiryThresholdDays: true,
        showNonAuthoritativeDomains: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpFrom: true,
        smtpPass: true,
      },
    });

    const { smtpPass, ...safe } = user as any;
    return {
      ...safe,
      role: isUserRole(safe.role) ? safe.role : 'user',
      smtpPassConfigured: !!smtpPass,
    };
  }

  /**
   * 获取用户的 Cloudflare API Token（解密）
   */
  static async getUserCfToken(userId: number): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { cfApiToken: true },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    return decrypt(user.cfApiToken);
  }

  /**
   * 更新用户密码
   */
  static async updatePassword(userId: number, oldPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    // 验证旧密码
    const isPasswordValid = await bcrypt.compare(oldPassword, user.password);

    if (!isPasswordValid) {
      throw new Error('原密码错误');
    }

    // 密码强度验证
    assertStrongPassword(newPassword);

    // 加密新密码，同时递增凭据版本让所有旧 token 立即失效
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        tokenVersion: { increment: 1 },
      },
    });
  }

  /**
   * 更新 Cloudflare API Token
   */
  static async updateCfToken(userId: number, newToken: string) {
    const encryptedToken = encrypt(newToken);

    await prisma.user.update({
      where: { id: userId },
      data: { cfApiToken: encryptedToken },
    });
  }
}
