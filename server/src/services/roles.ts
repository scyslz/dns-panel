/**
 * 系统设置（单行表）与账号开通策略。
 *
 * 设计：
 *  - 设置页保存到数据库，不再依赖环境变量 + 重启
 *  - 未配置（无记录）时的默认值：多用户开启、公开注册关闭、注册审核开启
 *  - 环境变量只用于「首次创建记录」时给一个初始值，之后以数据库为准
 */

import { PrismaClient } from '@prisma/client';
import { config } from '../config';

const prisma = new PrismaClient();

export type UserRole = 'admin' | 'user';

const ROLES: UserRole[] = ['admin', 'user'];

export interface PublicSystemSettings {
  multiUserEnabled: boolean;
  registrationEnabled: boolean;
  registrationRequiresApproval: boolean;
  registrationOpen: boolean;
  userCount: number;
}

export interface FullSystemSettings extends PublicSystemSettings {
  updatedAt: string;
}

export interface ManagedUser {
  id: number;
  username: string;
  email: string | null;
  role: string;
  isActive: boolean;
  pendingApproval: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ROLES as string[]).includes(value);
}

/** 用户管理接口返回的脱敏字段（绝不返回 password/token/secret） */
export const managedUserSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  pendingApproval: true,
  twoFactorEnabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function toManagedUser(user: ManagedUser) {
  return {
    ...user,
    role: isUserRole(user.role) ? user.role : 'user',
  };
}

/** 读取设置；无记录时用默认值创建（首次启动 / 旧库升级） */
export async function getSettingsRow() {
  const existing = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;

  const defaults = {
    multiUserEnabled: config.defaults.multiUser,
    registrationEnabled: config.defaults.publicRegistration,
    registrationRequiresApproval: true,
  };
  try {
    return await prisma.systemSettings.create({ data: { id: 1, ...defaults } });
  } catch {
    // 并发下可能已被其他请求创建
    return (await prisma.systemSettings.findUnique({ where: { id: 1 } })) || { id: 1, ...defaults, createdAt: new Date(), updatedAt: new Date() };
  }
}

export async function getFullSettings(): Promise<FullSystemSettings> {
  const row = await getSettingsRow();
  const userCount = await prisma.user.count();
  return {
    multiUserEnabled: row.multiUserEnabled,
    registrationEnabled: row.registrationEnabled,
    registrationRequiresApproval: row.registrationRequiresApproval,
    // 真正是否开放：开关开启 + 多用户开启 + 尚无用户（空库初始化）或允许追加（见 canPubliclyRegister）
    registrationOpen: await canPubliclyRegister(),
    userCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 登录/注册页用的最小公开状态，不暴露用户总数 */
export async function getPublicRegistrationStatus(): Promise<{ enabled: boolean; requiresApproval: boolean }> {
  const row = await getSettingsRow();
  const enabled = await canPubliclyRegister();
  return { enabled, requiresApproval: row.registrationRequiresApproval };
}

/**
 * 公开注册是否可用。
 *  - 多用户关闭 => 永不开放
 *  - 设置里的注册开关关闭 => 不开放
 *  - 空库（0 用户）：允许匿名注册首个管理员（不受审核限制，否则系统无法初始化）
 *  - 已有用户：只要开关开启就允许注册普通用户；是否可登录由「审核开关」决定
 */
export async function canPubliclyRegister(): Promise<boolean> {
  const row = await getSettingsRow();
  if (!row.multiUserEnabled || !row.registrationEnabled) return false;
  return true;
}

/** 判断一次「公开注册」是否应进入待审核 */
export async function shouldRequireApproval(): Promise<boolean> {
  const row = await getSettingsRow();
  const userCount = await prisma.user.count();
  // 空库首个账号必须立刻可用，否则系统无人管理
  if (userCount === 0) return false;
  return row.registrationRequiresApproval;
}

/**
 * 启动时保证系统至少有一个管理员。
 * 旧版本没有 role 字段，db push 后所有历史账号都是 user，这里提升最早的账号。
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const adminCount = await prisma.user.count({ where: { role: 'admin' } });
  if (adminCount > 0) return;

  const preferred = config.bootstrap.adminUsername
    ? await prisma.user.findFirst({ where: { username: config.bootstrap.adminUsername } })
    : null;
  const target = preferred || await prisma.user.findFirst({ orderBy: { id: 'asc' } });
  if (!target) return;

  await prisma.user.update({
    where: { id: target.id },
    data: { role: 'admin', isActive: true, pendingApproval: false },
  });
  console.log(`[auth] 已将账号 "${target.username}" 提升为管理员（bootstrap）`);
}

/**
 * 创建用户（管理员手动创建 / 公开注册共用）。
 * 任何调用方都必须已经完成策略判断，这里只负责数据层。
 */
export async function createManagedUser(input: {
  username: string;
  email?: string | null;
  passwordHash: string;
  role?: UserRole;
  pendingApproval?: boolean;
  cfApiToken?: string;
  cfAccountId?: string;
}) {
  const userCount = await prisma.user.count();
  // 空库的第一个账号必须是管理员且直接可用
  const role: UserRole = userCount === 0 ? 'admin' : (input.role || 'user');

  return prisma.user.create({
    data: {
      username: input.username,
      ...(input.email ? { email: input.email } : {}),
      password: input.passwordHash,
      role,
      isActive: true,
      pendingApproval: userCount === 0 ? false : !!input.pendingApproval,
      ...(input.cfApiToken ? { cfApiToken: input.cfApiToken } : {}),
      ...(input.cfAccountId ? { cfAccountId: input.cfAccountId } : {}),
    },
    select: managedUserSelect,
  });
}

export { prisma as rolePrisma };
