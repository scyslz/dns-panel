import api from './api';
import { ApiResponse, LoginResponse, User } from '@/types';

/**
 * 用户注册
 */
export const register = async (params: {
  username: string;
  email?: string;
  password: string;
}): Promise<ApiResponse<{ user: User; requiresApproval?: boolean }>> => {
  return api.post('/auth/register', params);
};

/**
 * 用户登录
 */
export const login = async (params: {
  username: string;
  password: string;
}): Promise<LoginResponse> => {
  return api.post('/auth/login', params);
};

/**
 * 验证 2FA 码完成登录
 */
export const verify2FA = async (params: {
  tempToken: string;
  code: string;
}): Promise<LoginResponse> => {
  return api.post('/auth/2fa/verify', params);
};

/**
 * 获取 2FA 状态
 */
export const get2FAStatus = async (): Promise<ApiResponse<{ enabled: boolean }>> => {
  return api.get('/auth/2fa/status');
};

/**
 * 生成 2FA 密钥和 QR 码
 */
export const setup2FA = async (): Promise<ApiResponse<{ secret: string; qrCodeDataUrl: string }>> => {
  return api.post('/auth/2fa/setup');
};

/**
 * 启用 2FA（需要验证码和密码）
 */
export const enable2FA = async (code: string, password: string): Promise<ApiResponse> => {
  return api.post('/auth/2fa/enable', { code, password });
};

/**
 * 禁用 2FA
 */
export const disable2FA = async (password: string): Promise<ApiResponse> => {
  return api.post('/auth/2fa/disable', { password });
};

/**
 * 获取当前用户信息
 */
export const getCurrentUser = async (): Promise<ApiResponse<{ user: User }>> => {
  return api.get('/auth/me');
};

/**
 * 修改密码
 */
export const updatePassword = async (params: {
  oldPassword: string;
  newPassword: string;
}): Promise<ApiResponse> => {
  return api.put('/auth/password', params);
};

export const updateDomainExpirySettings = async (params: {
  displayMode?: 'date' | 'days';
  thresholdDays?: number;
  showNonAuthoritativeDomains?: boolean;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  smtpPass?: string | null;
  smtpFrom?: string | null;
}): Promise<ApiResponse<{ user: User }>> => {
  return api.put('/auth/domain-expiry-settings', params);
};

/**
 * 更新 Cloudflare API Token
 */
export const updateCfToken = async (cfApiToken: string): Promise<ApiResponse> => {
  return api.put('/auth/cf-token', { cfApiToken });
};

/**
 * 保存登录信息到本地存储
 */
export const saveAuthData = (token: string, user: User) => {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
};

/**
 * 用接口返回的部分用户信息更新本地缓存。
 *
 * 部分接口（如域名到期设置）只返回部分字段，直接覆盖会丢失 role 等登录态字段，
 * 导致管理员菜单消失。这里做浅合并，并用服务端返回值优先。
 */
export const mergeStoredUser = (patch: Partial<User>) => {
  const current = getStoredUser();
  localStorage.setItem('user', JSON.stringify({ ...(current || {}), ...patch }));
};

/**
 * 清除登录信息
 */
export const clearAuthData = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};

/**
 * 获取本地存储的用户信息
 */
export const getStoredUser = (): User | null => {
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    const parsed = JSON.parse(userStr);
    return parsed && typeof parsed === 'object' ? parsed as User : null;
  } catch {
    // 缓存损坏时不让登录页/路由守卫崩溃
    localStorage.removeItem('user');
    return null;
  }
};

/**
 * 检查是否已登录
 */
export const isAuthenticated = (): boolean => {
  return !!localStorage.getItem('token');
};
