import api from './api';
import { ApiResponse } from '@/types';

export type DomainExpirySource = 'rdap' | 'whois' | 'manual' | 'unknown';

export interface DomainExpiryResult {
  domain: string;
  expiresAt?: string; // ISO string (UTC)
  source: DomainExpirySource;
  checkedAt: string; // ISO string (UTC)
}

export const lookupDomainExpiry = async (
  domains: string[]
): Promise<ApiResponse<{ results: DomainExpiryResult[] }>> => {
  return api.post('/domain-expiry/lookup', { domains });
};

export const setDomainExpiryOverride = async (
  domain: string,
  expiresAt: string
): Promise<ApiResponse> => {
  return api.post('/domain-expiry/override', { domain, expiresAt });
};

export const deleteDomainExpiryOverride = async (
  domain: string
): Promise<ApiResponse> => {
  return api.delete('/domain-expiry/override', { data: { domain } });
};

