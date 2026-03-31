import { PrismaClient } from '@prisma/client';
import { decrypt } from '../../utils/encryption';
import { CloudflareService } from '../cloudflare';
import type { AliyunAuth } from '../../providers/aliyun/auth';
import type { BceCredentials } from '../../providers/baidu/auth';
import type { Tc3Credentials } from '../../providers/dnspod/auth';
import type { HuaweiCredentials } from '../../providers/huawei/auth';
import type { VolcengineCredentials } from '../../providers/huoshan/auth';
import type { UcloudAuth } from '../../providers/ucloud/auth';

const prisma = new PrismaClient();

export async function getDnsCredentialForUser(userId: number, dnsCredentialId: number) {
  const credential = await prisma.dnsCredential.findFirst({
    where: { id: dnsCredentialId, userId },
  });
  if (!credential) throw new Error('DNS 凭证不存在');
  return credential;
}

export function parseDnsCredentialSecrets(credential: { secrets: string }) {
  try {
    return JSON.parse(decrypt(credential.secrets));
  } catch (error: any) {
    throw new Error(error?.message || 'DNS 凭证解析失败');
  }
}

export async function getCloudflareServiceForUser(userId: number, dnsCredentialId: number) {
  const credential = await getDnsCredentialForUser(userId, dnsCredentialId);
  if (credential.provider !== 'cloudflare') throw new Error('该凭证不是 Cloudflare 账户');
  const secrets = parseDnsCredentialSecrets(credential);
  const apiToken = String(secrets?.apiToken || '').trim();
  if (!apiToken) throw new Error('缺少 Cloudflare API Token');
  return {
    credential,
    service: new CloudflareService(apiToken),
  };
}

export async function getAliyunAuthForUser(userId: number, dnsCredentialId: number): Promise<{ credential: Awaited<ReturnType<typeof getDnsCredentialForUser>>; auth: AliyunAuth }> {
  const credential = await getDnsCredentialForUser(userId, dnsCredentialId);
  if (credential.provider !== 'aliyun') throw new Error('该凭证不是阿里云账户');
  const secrets = parseDnsCredentialSecrets(credential);
  const accessKeyId = String(secrets?.accessKeyId || '').trim();
  const accessKeySecret = String(secrets?.accessKeySecret || '').trim();
  if (!accessKeyId || !accessKeySecret) throw new Error('缺少阿里云 AccessKeyId/AccessKeySecret');
  return {
    credential,
    auth: { accessKeyId, accessKeySecret },
  };
}

export async function getDnspodTc3CredentialsForUser(userId: number, dnsCredentialId: number): Promise<{ credential: Awaited<ReturnType<typeof getDnsCredentialForUser>>; creds: Tc3Credentials }> {
  const credential = await getDnsCredentialForUser(userId, dnsCredentialId);
  if (credential.provider !== 'dnspod') throw new Error('腾讯云 SSL 渠道仅支持 dnspod 凭证');
  const secrets = parseDnsCredentialSecrets(credential);
  const secretId = String(secrets?.secretId || '').trim();
  const secretKey = String(secrets?.secretKey || '').trim();
  const token = String(secrets?.token || secrets?.sessionToken || '').trim();
  if (!secretId || !secretKey) throw new Error('缺少腾讯云 SecretId/SecretKey');
  return {
    credential,
    creds: {
      secretId,
      secretKey,
      ...(token ? { token } : {}),
    },
  };
}

export async function getUcloudAuthForUser(userId: number, dnsCredentialId: number): Promise<{ credential: Awaited<ReturnType<typeof getDnsCredentialForUser>>; auth: UcloudAuth }> {
  const credential = await getDnsCredentialForUser(userId, dnsCredentialId);
  if (credential.provider !== 'ucloud') throw new Error('该凭证不是 UCloud 账户');
  const secrets = parseDnsCredentialSecrets(credential);
  const publicKey = String(secrets?.publicKey || '').trim();
  const privateKey = String(secrets?.privateKey || '').trim();
  const region = String(secrets?.region || '').trim();
  const projectId = String(secrets?.projectId || '').trim();
  if (!publicKey || !privateKey || !region) throw new Error('缺少 UCloud PublicKey/PrivateKey/Region');
  return {
    credential,
    auth: {
      publicKey,
      privateKey,
      region,
      ...(projectId ? { projectId } : {}),
    },
  };
}

export async function getHuaweiAuthForUser(userId: number, dnsCredentialId: number): Promise<{ credential: Awaited<ReturnType<typeof getDnsCredentialForUser>>; creds: HuaweiCredentials }> {
  const credential = await getDnsCredentialForUser(userId, dnsCredentialId);
  if (credential.provider !== 'huawei') throw new Error('该凭证不是华为云账户');
  const secrets = parseDnsCredentialSecrets(credential);
  const accessKeyId = String(secrets?.accessKeyId || '').trim();
  const secretAccessKey = String(secrets?.secretAccessKey || '').trim();
  if (!accessKeyId || !secretAccessKey) throw new Error('缺少华为云 AccessKeyId/SecretAccessKey');
  return {
    credential,
    creds: {
      accessKeyId,
      secretAccessKey,
    },
  };
}

export async function getBaiduAuthForUser(userId: number, dnsCredentialId: number): Promise<{ credential: Awaited<ReturnType<typeof getDnsCredentialForUser>>; creds: BceCredentials }> {
  const credential = await getDnsCredentialForUser(userId, dnsCredentialId);
  if (credential.provider !== 'baidu') throw new Error('该凭证不是百度云账户');
  const secrets = parseDnsCredentialSecrets(credential);
  const accessKey = String(secrets?.accessKey || '').trim();
  const secretKey = String(secrets?.secretKey || '').trim();
  if (!accessKey || !secretKey) throw new Error('缺少百度云 AccessKey/SecretKey');
  return {
    credential,
    creds: {
      accessKey,
      secretKey,
    },
  };
}

export async function getVolcengineAuthForUser(userId: number, dnsCredentialId: number): Promise<{ credential: Awaited<ReturnType<typeof getDnsCredentialForUser>>; creds: VolcengineCredentials }> {
  const credential = await getDnsCredentialForUser(userId, dnsCredentialId);
  if (credential.provider !== 'huoshan') throw new Error('该凭证不是火山引擎账户');
  const secrets = parseDnsCredentialSecrets(credential);
  const accessKeyId = String(secrets?.accessKeyId || '').trim();
  const secretAccessKey = String(secrets?.secretAccessKey || '').trim();
  if (!accessKeyId || !secretAccessKey) throw new Error('缺少火山引擎 AccessKeyId/SecretAccessKey');
  return {
    credential,
    creds: {
      accessKeyId,
      secretAccessKey,
    },
  };
}
