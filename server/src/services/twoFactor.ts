import { PrismaClient } from '@prisma/client';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { config } from '../config';
import { encrypt, decrypt } from '../utils/encryption';
import { signUserToken } from '../utils/jwt';
import { isUserRole, UserRole } from './roles';

const prisma = new PrismaClient();

const APP_NAME = 'DNS Panel';
const TEMP_TOKEN_EXPIRES = '5m';

export class TwoFactorService {
  /**
   * 生成 2FA 密钥和 QR 码
   */
  static async generateSecret(userId: number): Promise<{ secret: string; qrCodeDataUrl: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, twoFactorEnabled: true },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    if (user.twoFactorEnabled) {
      throw new Error('2FA 已启用，请先禁用后再重新设置');
    }

    const secret = speakeasy.generateSecret({
      name: `${APP_NAME}:${user.username}`,
      issuer: APP_NAME,
      length: 20,
    });

    const encryptedSecret = encrypt(secret.base32);

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptedSecret },
    });

    const otpauthUrl = secret.otpauth_url!;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return {
      secret: secret.base32,
      qrCodeDataUrl,
    };
  }

  /**
   * 验证 TOTP 码
   */
  static verifyToken(secret: string, token: string): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1,
    });
  }

  /**
   * 启用 2FA（需要验证 TOTP 码和密码）
   */
  static async enable(userId: number, token: string, password: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, twoFactorSecret: true, twoFactorEnabled: true },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    if (user.twoFactorEnabled) {
      throw new Error('2FA 已启用');
    }

    if (!user.twoFactorSecret) {
      throw new Error('请先生成 2FA 密钥');
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error('密码错误');
    }

    const decryptedSecret = decrypt(user.twoFactorSecret);
    const isValid = this.verifyToken(decryptedSecret, token);

    if (!isValid) {
      throw new Error('验证码错误，请重试');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
  }

  /**
   * 禁用 2FA（需要验证密码）
   */
  static async disable(userId: number, password: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, twoFactorEnabled: true },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    if (!user.twoFactorEnabled) {
      throw new Error('2FA 未启用');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error('密码错误');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });
  }

  /**
   * 获取用户 2FA 状态
   */
  static async getStatus(userId: number): Promise<{ enabled: boolean }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    return { enabled: user.twoFactorEnabled };
  }

  /**
   * 生成临时 Token（用于 2FA 验证流程）
   */
  static generateTempToken(user: {
    id: number;
    username: string;
    tokenVersion: number;
  }): string {
    return jwt.sign(
      {
        id: user.id,
        username: user.username,
        tv: user.tokenVersion,
        type: '2fa_pending',
      },
      config.jwt.secret,
      { expiresIn: TEMP_TOKEN_EXPIRES }
    );
  }

  /**
   * 验证临时 Token
   */
  static verifyTempToken(tempToken: string): { id: number; username: string; tv: number } | null {
    try {
      const decoded = jwt.verify(tempToken, config.jwt.secret) as {
        id: number;
        username: string;
        tv?: number;
        type: string;
      };

      if (decoded.type !== '2fa_pending') {
        return null;
      }

      return { id: decoded.id, username: decoded.username, tv: Number(decoded.tv || 0) };
    } catch {
      return null;
    }
  }

  /**
   * 完成 2FA 验证，生成正式 JWT
   */
  static async verifyAndGenerateToken(
    tempToken: string,
    totpCode: string
  ): Promise<{
    token: string;
    user: {
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
  }> {
    const pending = this.verifyTempToken(tempToken);
    if (!pending) {
      throw new Error('验证已过期，请重新登录');
    }

    const user = await prisma.user.findUnique({
      where: { id: pending.id },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        tokenVersion: true,
        twoFactorSecret: true,
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
      },
    });

    if (!user || !user.isActive) {
      throw new Error('用户不存在');
    }

    if (Number(user.tokenVersion) !== pending.tv) {
      throw new Error('登录状态已变更，请重新登录');
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new Error('2FA 未启用');
    }

    const decryptedSecret = decrypt(user.twoFactorSecret);
    const isValid = this.verifyToken(decryptedSecret, totpCode);

    if (!isValid) {
      throw new Error('验证码错误');
    }

    const token = signUserToken(user);

    return {
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
}
