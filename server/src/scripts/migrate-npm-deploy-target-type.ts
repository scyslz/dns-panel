import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FROM_TYPE = 'nginx_proxy_manager_experimental';
const TO_TYPE = 'nginx_proxy_manager';

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const dryRun = hasFlag('--dry-run');

  console.log('═'.repeat(60));
  console.log('  Nginx Proxy Manager Deploy Target 类型迁移');
  console.log(`  ${FROM_TYPE} -> ${TO_TYPE}`);
  console.log('═'.repeat(60));

  const beforeCount = await prisma.certificateDeployTarget.count({
    where: { type: FROM_TYPE },
  });

  console.log(`待迁移记录: ${beforeCount}`);

  if (beforeCount === 0) {
    console.log('无需迁移，已是最新类型。');
    return;
  }

  if (dryRun) {
    console.log('dry-run 模式，不执行更新。');
    return;
  }

  const result = await prisma.certificateDeployTarget.updateMany({
    where: { type: FROM_TYPE },
    data: { type: TO_TYPE },
  });

  const afterOldCount = await prisma.certificateDeployTarget.count({
    where: { type: FROM_TYPE },
  });
  const afterNewCount = await prisma.certificateDeployTarget.count({
    where: { type: TO_TYPE },
  });

  console.log(`已更新记录: ${result.count}`);
  console.log(`旧类型剩余: ${afterOldCount}`);
  console.log(`新类型总数: ${afterNewCount}`);
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
