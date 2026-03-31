import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const dryRun = hasFlag('--dry-run');

  console.log('═'.repeat(60));
  console.log('  厂商证书模型迁移');
  console.log('  aliyun_esa_free -> aliyun_ssl');
  console.log('  dnsCredentialId -> vendorCredentialId/validationDnsCredentialId');
  console.log('═'.repeat(60));

  const legacyProviderCount = await prisma.vendorCertificateOrder.count({
    where: { provider: 'aliyun_esa_free' },
  });

  const missingCredentialRows = await prisma.vendorCertificateOrder.findMany({
    where: {
      dnsCredentialId: { not: null },
      OR: [
        { vendorCredentialId: null },
        { validationDnsCredentialId: null },
      ],
    },
    select: {
      id: true,
      dnsCredentialId: true,
      vendorCredentialId: true,
      validationDnsCredentialId: true,
    },
  });

  const missingDeploySourceCount = await prisma.certificateDeployJob.count({
    where: {
      certificateOrderId: null,
      vendorCertificateOrderId: null,
    },
  });

  console.log(`待迁移旧 provider: ${legacyProviderCount}`);
  console.log(`待回填凭证拆分字段: ${missingCredentialRows.length}`);
  console.log(`缺少证书来源的部署任务: ${missingDeploySourceCount}`);

  if (dryRun) {
    console.log('dry-run 模式，不执行更新。');
    return;
  }

  if (legacyProviderCount > 0) {
    const result = await prisma.vendorCertificateOrder.updateMany({
      where: { provider: 'aliyun_esa_free' },
      data: { provider: 'aliyun_ssl' },
    });
    console.log(`已迁移 provider 记录: ${result.count}`);
  }

  let backfilled = 0;
  for (const row of missingCredentialRows) {
    const dnsCredentialId = row.dnsCredentialId;
    if (!dnsCredentialId) continue;
    await prisma.vendorCertificateOrder.update({
      where: { id: row.id },
      data: {
        vendorCredentialId: row.vendorCredentialId ?? dnsCredentialId,
        validationDnsCredentialId: row.validationDnsCredentialId ?? dnsCredentialId,
      },
    });
    backfilled += 1;
  }

  console.log(`已回填凭证拆分字段: ${backfilled}`);

  if (missingDeploySourceCount > 0) {
    console.warn('警告: 存在缺少证书来源的部署任务，请手工检查 certificate_deploy_jobs。');
  }
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
