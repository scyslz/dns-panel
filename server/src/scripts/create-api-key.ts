/**
 * 命令行签发 API Key（没有管理界面时使用）
 *
 * 用法：
 *   npx tsx src/scripts/create-api-key.ts --user admin --name ci
 *   npx tsx src/scripts/create-api-key.ts --user admin --name deploy \
 *       --credential 12 --domains example.com
 *
 * 参数：
 *   --user        用户名（必填）
 *   --name        Key 名称（必填）
 *   --credential  绑定凭证 ID（可选）
 *   --domains     逗号分隔的域名白名单（可选）
 *   --ips         逗号分隔的 IP/CIDR 白名单（可选）
 *   --rate        每分钟请求上限，默认 60
 *   --expires     ISO 时间或 YYYY-MM-DD（可选）
 */

import { PrismaClient } from '@prisma/client';
import { createApiKey } from '../open-api/keys/service';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

function list(name: string): string[] | undefined {
  const value = arg(name);
  if (!value) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

async function main() {
  const username = arg('user');
  const name = arg('name');

  if (!username || !name) {
    console.error('用法: npx tsx src/scripts/create-api-key.ts --user <用户名> --name <Key 名称>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`用户不存在: ${username}`);
    process.exit(1);
  }

  const credentialArg = arg('credential');
  const created = await createApiKey({
    userId: user.id,
    name,
    credentialId: credentialArg ? Number(credentialArg) : undefined,
    allowedDomains: list('domains'),
    allowedIps: list('ips'),
    rateLimitPerMin: arg('rate') ? Number(arg('rate')) : undefined,
    expiresAt: arg('expires') || undefined,
  });

  console.log('');
  console.log('API Key 创建成功（只显示这一次，请立刻保存）：');
  console.log('');
  console.log(`  ${created.key}`);
  console.log('');
  console.log(`  id:          ${created.id}`);
  console.log(`  name:        ${created.name}`);
  console.log(`  credential:  ${created.credentialId ?? '(不限制)'}`);
  console.log(`  domains:     ${created.allowedDomains.length ? created.allowedDomains.join(', ') : '(不限制)'}`);
  console.log(`  rateLimit:   ${created.rateLimitPerMin}/min`);
  console.log('');
  console.log('测试：');
  console.log(`  curl -s -H "Authorization: Bearer ${created.key}" http://localhost:3000/api/open/me`);
  console.log('');
}

main()
  .catch((error) => {
    console.error('创建失败:', error?.message || error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
