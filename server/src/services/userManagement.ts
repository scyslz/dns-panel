/**
 * 管理员用户管理服务。
 *
 * 安全约束：
 *  - 不能删除 / 禁用自己
 *  - 不能降低自己的角色
 *  - 不能删除或降级系统最后一个启用的管理员
 *  - 所有写操作递增 tokenVersion，令目标用户的旧 JWT / 会话立即失效
 *  - 删除用户会级联清理其凭证、证书、日志、API Key（schema 的 onDelete: Cascade）
 */

import bcrypt from 'bcrypt';
import { AuthService, assertStrongPassword } from './auth';
import {
  canPubliclyRegister,
  getFullSettings,
  getSettingsRow,
  isUserRole,
  managedUserSelect,
  rolePrisma,
  UserRole,
} from './roles';

export class UserService {
  static async getRegistrationStatus() {
    return getSettingsRow().then((row) => ({
      enabled: row.multiUserEnabled && row.registrationEnabled,
      requiresApproval: row.registrationRequiresApproval,
    }));
  }

  static async getSettings() {
    return getFullSettings();
  }

  static async updateSettings(
    actorId: number,
    patch: {
      multiUserEnabled?: boolean;
      registrationEnabled?: boolean;
      registrationRequiresApproval?: boolean;
    }
  ) {
    const row = await getSettingsRow();
    const nextMultiUser = patch.multiUserEnabled ?? row.multiUserEnabled;

    // 关闭多用户时，不允许顺手把公开注册打开
    const nextRegistration = nextMultiUser
      ? (patch.registrationEnabled ?? row.registrationEnabled)
      : false;

    const updated = await rolePrisma.systemSettings.update({
      where: { id: 1 },
      data: {
        multiUserEnabled: nextMultiUser,
        registrationEnabled: nextRegistration,
        ...(patch.registrationRequiresApproval !== undefined
          ? { registrationRequiresApproval: !!patch.registrationRequiresApproval }
          : {}),
      },
    });

    return {
      multiUserEnabled: updated.multiUserEnabled,
      registrationEnabled: updated.registrationEnabled,
      registrationRequiresApproval: updated.registrationRequiresApproval,
      registrationOpen: await canPubliclyRegister(),
      userCount: await rolePrisma.user.count(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  static async listUsers() {
    const rows = await rolePrisma.user.findMany({
      select: managedUserSelect,
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({ ...row, role: isUserRole(row.role) ? row.role : 'user' }));
  }

  static async createUser(
    actor: { id: number; username: string },
    input: {
      username: string;
      email?: string | null;
      password: string;
      role?: string;
    }
  ) {
    if (input.role !== undefined && !isUserRole(input.role)) {
      throw new Error('角色无效');
    }

    return AuthService.register(
      {
        username: input.username,
        email: input.email || undefined,
        password: input.password,
        role: input.role as UserRole | undefined,
        registrationMode: 'admin',
      },
      actor
    );
  }

  private static async guardTarget(targetId: number, actorId: number) {
    const target = await rolePrisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new Error('用户不存在');
    if (target.id === actorId) throw new Error('不能操作当前登录账号');
    return target;
  }

  private static async assertNotLastAdmin(targetId: number) {
    const target = await rolePrisma.user.findUnique({ where: { id: targetId } });
    if (!target || target.role !== 'admin' || !target.isActive) return;

    const otherActiveAdmins = await rolePrisma.user.count({
      where: { role: 'admin', isActive: true, id: { not: targetId } },
    });
    if (otherActiveAdmins === 0) {
      throw new Error('系统必须保留至少一个启用的管理员');
    }
  }

  static async updateRole(actorId: number, targetId: number, role: string) {
    if (!isUserRole(role)) throw new Error('角色无效');
    const target = await this.guardTarget(targetId, actorId);
    if (target.role === 'admin' && role !== 'admin') {
      await this.assertNotLastAdmin(targetId);
    }

    return rolePrisma.user.update({
      where: { id: targetId },
      data: { role, tokenVersion: { increment: 1 } },
      select: managedUserSelect,
    });
  }

  static async setActive(actorId: number, targetId: number, isActive: boolean) {
    const target = await this.guardTarget(targetId, actorId);
    if (target.role === 'admin' && target.isActive && !isActive) {
      await this.assertNotLastAdmin(targetId);
    }

    return rolePrisma.user.update({
      where: { id: targetId },
      data: { isActive, tokenVersion: { increment: 1 } },
      select: managedUserSelect,
    });
  }

  /** 审核通过待注册账号（清除 pendingApproval，之后可正常登录） */
  static async approveUser(actorId: number, targetId: number) {
    const target = await this.guardTarget(targetId, actorId);
    if (!target.pendingApproval) throw new Error('该账号无需审核');

    return rolePrisma.user.update({
      where: { id: targetId },
      data: { pendingApproval: false, isActive: true, tokenVersion: { increment: 1 } },
      select: managedUserSelect,
    });
  }

  static async resetPassword(actorId: number, targetId: number, newPassword: string) {
    await this.guardTarget(targetId, actorId);
    assertStrongPassword(newPassword);
    const hashed = await bcrypt.hash(newPassword, 10);

    await rolePrisma.user.update({
      where: { id: targetId },
      data: {
        password: hashed,
        // 重置密码时同时关闭 2FA，避免管理员接管后仍被旧验证器阻断
        twoFactorEnabled: false,
        twoFactorSecret: null,
        tokenVersion: { increment: 1 },
      },
    });
    return { id: targetId };
  }

  static async deleteUser(actorId: number, targetId: number) {
    const target = await this.guardTarget(targetId, actorId);
    if (target.role === 'admin' && target.isActive) {
      await this.assertNotLastAdmin(targetId);
    }

    await rolePrisma.user.delete({ where: { id: targetId } });
    return { id: targetId };
  }
}
