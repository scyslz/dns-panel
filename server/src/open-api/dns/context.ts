/**
 * 开放 API 的 DNS 上下文构建
 *
 * 刻意不复用 routes/dnsRecords.ts 里的私有函数：复制一份很小的逻辑，
 * 换取对现有页面代码零改动、零回归风险。
 */

import { PrismaClient } from '@prisma/client';
import { decrypt } from '../../utils/encryption';
import { DnsServiceContext } from '../../services/dns/DnsService';
import { ProviderType } from '../../providers/base/types';
import { ApiError } from '../errors';

const prisma = new PrismaClient();

export interface ResolvedCredential {
  id: number;
  name: string;
  provider: ProviderType;
  ctx: DnsServiceContext;
}

const RECORD_CAPABLE = new Set<string>(Object.values(ProviderType).filter((p) => p !== ProviderType.EDGEONE));

export function isRecordCapable(provider: string): boolean {
  return RECORD_CAPABLE.has(provider);
}

/**
 * 解析凭证：
 *  - 传 credentialId 时按 id + userId 查（天然隔离越权）
 *  - 不传时取默认凭证
 *  - 任意凭证都必须是当前 Key 所属用户
 */
export async function resolveCredential(
  userId: number,
  credentialId?: number | string | null,
  options?: { requireRecordCapable?: boolean }
): Promise<ResolvedCredential> {
  const idNum = credentialId === undefined || credentialId === null || credentialId === ''
    ? null
    : Number(credentialId);
  if (idNum !== null && !Number.isInteger(idNum)) {
    throw new ApiError('INVALID_ARGUMENT', 'credentialId 必须是整数', 400);
  }

  const credential = idNum !== null
    ? await prisma.dnsCredential.findFirst({ where: { id: idNum, userId } })
    : await prisma.dnsCredential.findFirst({ where: { userId, isDefault: true } });

  if (!credential) {
    throw new ApiError(
      'INVALID_ARGUMENT',
      idNum !== null ? '凭证不存在或无权访问' : '未配置默认凭证，请显式传 credentialId',
      400
    );
  }

  const provider = credential.provider as ProviderType;
  if (options?.requireRecordCapable !== false && !isRecordCapable(provider)) {
    throw new ApiError(
      'PROVIDER_NOT_RECORD_CAPABLE',
      `${credential.name} (${provider}) 不支持 DNS 记录接口`,
      400,
      {
        provider,
        recordTypes: [],
        alternatives: provider === ProviderType.EDGEONE ? ['/api/open/edgeone/sites'] : [],
      }
    );
  }

  let secrets: Record<string, string>;
  try {
    secrets = JSON.parse(decrypt(credential.secrets));
  } catch {
    throw new ApiError('INTERNAL_ERROR', '凭证密钥解析失败，请检查 ENCRYPTION_KEY', 500);
  }

  return {
    id: credential.id,
    name: credential.name,
    provider,
    ctx: {
      provider,
      secrets,
      accountId: credential.accountId || undefined,
      credentialKey: `api-cred-${credential.id}`,
      encrypted: false,
    },
  };
}

/** 校验 Key 绑定的凭证与请求指定的凭证是否一致 */
export function assertCredentialScope(boundCredentialId: number | null, requestedCredentialId?: number | string | null) {
  if (!boundCredentialId) return;
  if (requestedCredentialId === undefined || requestedCredentialId === null || requestedCredentialId === '') return;
  if (Number(requestedCredentialId) !== boundCredentialId) {
    throw new ApiError('SCOPE_DENIED', '该 API Key 仅允许访问绑定的凭证', 403, {
      boundCredentialId,
    });
  }
}
