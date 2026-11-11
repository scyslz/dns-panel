import api from './api';
import { ApiResponse, UserRole } from '@/types';

/** 登录页查询：是否允许公开注册、是否需审核 */
export const getRegistrationStatus = async (): Promise<ApiResponse<{
  enabled: boolean;
  requiresApproval: boolean;
}>> => {
  return api.get('/auth/registration-status');
};

/** 所有登录用户可读：多用户开关（用于隐藏侧边栏入口） */
export const getSystemStatus = async (): Promise<ApiResponse<{ multiUserEnabled: boolean }>> => {
  return api.get('/auth/system-status');
};

export interface SystemSettings {
  multiUserEnabled: boolean;
  registrationEnabled: boolean;
  registrationRequiresApproval: boolean;
  registrationOpen: boolean;
  userCount: number;
  updatedAt: string;
}

export interface ManagedUser {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  pendingApproval: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const getSystemSettings = async (): Promise<ApiResponse<{ settings: SystemSettings }>> => {
  return api.get('/system-settings');
};

export const updateSystemSettings = async (patch: {
  multiUserEnabled?: boolean;
  registrationEnabled?: boolean;
  registrationRequiresApproval?: boolean;
}): Promise<ApiResponse<{ settings: SystemSettings }>> => {
  return api.put('/system-settings', patch);
};

/** 用户列表 + 系统设置一次拉取，供用户管理页使用 */
export const getUsersContext = async (): Promise<ApiResponse<{
  users: ManagedUser[];
  settings: SystemSettings;
}>> => {
  return api.get('/users/context');
};

export const getUsers = async (): Promise<ApiResponse<{ users: ManagedUser[] }>> => {
  return api.get('/users');
};

export const createUser = async (payload: {
  username: string;
  email?: string;
  password: string;
  role?: UserRole;
}): Promise<ApiResponse<{ user: ManagedUser }>> => {
  return api.post('/users', payload);
};

export const updateUserRole = async (id: number, role: UserRole): Promise<ApiResponse<{ user: ManagedUser }>> => {
  return api.patch(`/users/${id}/role`, { role });
};

export const setUserActive = async (id: number, isActive: boolean): Promise<ApiResponse<{ user: ManagedUser }>> => {
  return api.patch(`/users/${id}/active`, { isActive });
};

export const approveUser = async (id: number): Promise<ApiResponse<{ user: ManagedUser }>> => {
  return api.post(`/users/${id}/approve`, {});
};

export const resetUserPassword = async (id: number, newPassword: string): Promise<ApiResponse> => {
  return api.post(`/users/${id}/reset-password`, { newPassword });
};

export const deleteUser = async (id: number): Promise<ApiResponse> => {
  return api.delete(`/users/${id}`);
};
