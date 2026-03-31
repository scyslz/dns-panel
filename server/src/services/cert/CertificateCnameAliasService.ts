import { resolveCname } from 'node:dns/promises';
import { PrismaClient } from '@prisma/client';
import type { CertificateChallengeState } from './AcmeService';

const prisma = new PrismaClient();

function normalizeDomain(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
}

function normalizeZoneName(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '');
}

function normalizeRr(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '');
}

function buildTargetFqdn(rr: string, zoneName: string) {
  return `${normalizeRr(rr)}.${normalizeZoneName(zoneName)}`;
}

function mapAlias(record: any) {
  return {
    id: record.id,
    domain: record.domain,
    dnsCredentialId: record.dnsCredentialId,
    zoneName: record.zoneName,
    rr: record.rr,
    targetFqdn: record.targetFqdn,
    status: record.status,
    lastCheckedAt: record.lastCheckedAt,
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    dnsCredential: record.dnsCredential
      ? {
          id: record.dnsCredential.id,
          name: record.dnsCredential.name,
          provider: record.dnsCredential.provider,
          isDefault: !!record.dnsCredential.isDefault,
        }
      : undefined,
  };
}

async function getAliasRecord(userId: number, id: number) {
  const record = await prisma.certificateCnameAlias.findFirst({
    where: { id, userId },
    include: {
      dnsCredential: {
        select: {
          id: true,
          name: true,
          provider: true,
          isDefault: true,
        },
      },
    },
  });
  if (!record) throw new Error('CNAME Alias 不存在');
  return record;
}

export class CertificateCnameAliasService {
  static async listAliases(userId: number) {
    const rows = await prisma.certificateCnameAlias.findMany({
      where: { userId },
      include: {
        dnsCredential: {
          select: {
            id: true,
            name: true,
            provider: true,
            isDefault: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map(mapAlias);
  }

  static async createAlias(userId: number, input: { domain: string; dnsCredentialId: number; zoneName: string; rr: string }) {
    const domain = normalizeDomain(input.domain);
    const zoneName = normalizeZoneName(input.zoneName);
    const rr = normalizeRr(input.rr);
    if (!domain) throw new Error('domain 不能为空');
    if (!zoneName) throw new Error('zoneName 不能为空');
    if (!rr) throw new Error('rr 不能为空');

    const dnsCredential = await prisma.dnsCredential.findFirst({
      where: { id: Number(input.dnsCredentialId), userId },
      select: { id: true },
    });
    if (!dnsCredential) throw new Error('DNS 凭证不存在');

    const created = await prisma.certificateCnameAlias.create({
      data: {
        userId,
        domain,
        dnsCredentialId: dnsCredential.id,
        zoneName,
        rr,
        targetFqdn: buildTargetFqdn(rr, zoneName),
        status: 'pending',
      },
      include: {
        dnsCredential: {
          select: { id: true, name: true, provider: true, isDefault: true },
        },
      },
    });

    return mapAlias(created);
  }

  static async updateAlias(userId: number, id: number, input: Partial<{ domain: string; dnsCredentialId: number; zoneName: string; rr: string }>) {
    const existing = await getAliasRecord(userId, id);
    const domain = input.domain !== undefined ? normalizeDomain(input.domain) : existing.domain;
    const zoneName = input.zoneName !== undefined ? normalizeZoneName(input.zoneName) : existing.zoneName;
    const rr = input.rr !== undefined ? normalizeRr(input.rr) : existing.rr;
    if (!domain) throw new Error('domain 不能为空');
    if (!zoneName) throw new Error('zoneName 不能为空');
    if (!rr) throw new Error('rr 不能为空');

    let dnsCredentialId = existing.dnsCredentialId;
    if (input.dnsCredentialId !== undefined) {
      const dnsCredential = await prisma.dnsCredential.findFirst({
        where: { id: Number(input.dnsCredentialId), userId },
        select: { id: true },
      });
      if (!dnsCredential) throw new Error('DNS 凭证不存在');
      dnsCredentialId = dnsCredential.id;
    }

    const updated = await prisma.certificateCnameAlias.update({
      where: { id: existing.id },
      data: {
        domain,
        dnsCredentialId,
        zoneName,
        rr,
        targetFqdn: buildTargetFqdn(rr, zoneName),
        status: 'pending',
        lastCheckedAt: null,
        lastError: null,
      },
      include: {
        dnsCredential: {
          select: { id: true, name: true, provider: true, isDefault: true },
        },
      },
    });

    return mapAlias(updated);
  }

  static async deleteAlias(userId: number, id: number) {
    await getAliasRecord(userId, id);
    await prisma.certificateCnameAlias.delete({ where: { id } });
  }

  static async checkAlias(userId: number, id: number) {
    const record = await getAliasRecord(userId, id);
    const sourceName = `_acme-challenge.${record.domain}`;
    let status = 'ready';
    let lastError: string | null = null;

    try {
      const answers = await resolveCname(sourceName);
      const matched = answers.map((item) => normalizeZoneName(item)).includes(normalizeZoneName(record.targetFqdn));
      if (!matched) {
        status = 'error';
        lastError = `CNAME 未指向 ${record.targetFqdn}`;
      }
    } catch (error: any) {
      status = 'error';
      lastError = error?.message || 'CNAME 查询失败';
    }

    const updated = await prisma.certificateCnameAlias.update({
      where: { id: record.id },
      data: {
        status,
        lastCheckedAt: new Date(),
        lastError,
      },
      include: {
        dnsCredential: {
          select: { id: true, name: true, provider: true, isDefault: true },
        },
      },
    });

    return mapAlias(updated);
  }

  static async findAliasForDomain(userId: number, domain: string) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return null;
    return await prisma.certificateCnameAlias.findFirst({
      where: { userId, domain: normalized },
      include: {
        dnsCredential: {
          select: { id: true, name: true, provider: true, isDefault: true },
        },
      },
    });
  }

  static async attachAliasGuidance(userId: number, challenges: CertificateChallengeState[]) {
    const next: CertificateChallengeState[] = [];
    for (const challenge of challenges) {
      const alias = await this.findAliasForDomain(userId, challenge.identifier);
      if (!alias) {
        next.push(challenge);
        continue;
      }
      next.push({
        ...challenge,
        mode: challenge.mode || 'manual',
        recordName: alias.targetFqdn,
        zoneName: alias.zoneName,
        ...(alias.status === 'ready'
          ? { zoneId: challenge.zoneId || null }
          : {}),
        aliasDomain: alias.domain,
        aliasStatus: alias.status,
        aliasTargetFqdn: alias.targetFqdn,
        aliasDnsCredentialId: alias.dnsCredentialId,
      } as CertificateChallengeState);
    }
    return next;
  }
}
