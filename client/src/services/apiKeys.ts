import api from './api';
import { ApiResponse } from '@/types';

export interface ApiKeyRecord {
  id: number;
  name: string;
  keyId: string;
  keyPreview: string;
  keySuffix: string | null;
  credentialId: number | null;
  allowedDomains: string[];
  allowedIps: string[];
  rateLimitPerMin: number;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdAt: string;
  active: boolean;
}

export interface ApiKeyListResult {
  keys: ApiKeyRecord[];
}

export interface CreateApiKeyPayload {
  name: string;
  allowedDomains?: string[];
  allowedIps?: string[];
  rateLimitPerMin?: number;
  credentialId?: number | null;
  expiresAt?: string | null;
}

export interface DomainOption {
  domain: string;
  provider: string;
  credentialId: number;
  credentialName: string;
}

export interface DomainOptionsResult {
  domains: DomainOption[];
  errors: Array<{ credentialId: number; credentialName: string; message: string }>;
  cached: boolean;
}

export interface CreatedApiKey extends Omit<ApiKeyRecord, 'keyPreview' | 'active'> {
  key: string;
}

export const getApiKeys = async (): Promise<ApiResponse<ApiKeyListResult>> => {
  return api.get('/api-keys');
};

export const createApiKey = async (payload: CreateApiKeyPayload): Promise<ApiResponse<CreatedApiKey>> => {
  return api.post('/api-keys', payload);
};

export const getDomainOptions = async (refresh = false): Promise<ApiResponse<DomainOptionsResult>> => {
  return api.get('/api-keys/domain-options', { params: refresh ? { refresh: 1 } : undefined });
};

export const revokeApiKey = async (id: number): Promise<ApiResponse> => {
  return api.delete(`/api-keys/${id}`);
};
