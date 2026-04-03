import { PrismaClient } from '@prisma/client';
import { decrypt } from '../utils/encryption';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { dnsService, DnsServiceContext } from '../services/dns/DnsService';
import { ProviderType, Zone } from '../providers/base/types';
import { DomainExpiryService } from '../services/domainExpiry';
import { CertificateNotificationService, type NotificationChannel } from '../services/cert/CertificateNotificationService';

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(expiresAtIso: string): number {
  const expiresAt = new Date(expiresAtIso);
  if (Number.isNaN(expiresAt.getTime())) return Number.NaN;
  const ms = expiresAt.getTime() - Date.now();
  return Math.floor(ms / 86_400_000);
}

function getLastNotifiedAt(existing: any): Date | undefined {
  const ln = existing?.lastNotifiedAt;
  if (ln instanceof Date && !Number.isNaN(ln.getTime())) return ln;
  const ca = existing?.createdAt;
  if (ca instanceof Date && !Number.isNaN(ca.getTime())) return ca;
  return undefined;
}

async function listAllZones(ctx: DnsServiceContext): Promise<Zone[]> {
  const zones: Zone[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 500; page++) {
    const result = await dnsService.getZones(ctx, page, pageSize);
    zones.push(...(result.zones || []));
    const total = typeof result.total === 'number' ? result.total : 0;
    if (total > 0 && zones.length >= total) break;
    if (!result.zones || result.zones.length === 0) break;
  }
  return zones;
}

async function upsertDomainExpiryNotification(input: {
  userId: number;
  domain: string;
  expiresAt: Date;
  thresholdDays: number;
  channel: string;
  status: 'SENT' | 'FAILED';
  payload: Record<string, any>;
  errorMessage?: string | null;
}) {
  const where = {
    userId_domain_expiresAt_thresholdDays_channel: {
      userId: input.userId,
      domain: input.domain,
      expiresAt: input.expiresAt,
      thresholdDays: input.thresholdDays,
      channel: input.channel,
    },
  } as const;

  await prisma.domainExpiryNotification.upsert({
    where: where.userId_domain_expiresAt_thresholdDays_channel as any,
    create: {
      userId: input.userId,
      domain: input.domain,
      expiresAt: input.expiresAt,
      thresholdDays: input.thresholdDays,
      channel: input.channel,
      status: input.status,
      payload: JSON.stringify(input.payload),
      errorMessage: input.errorMessage || null,
      lastNotifiedAt: new Date(),
    },
    update: {
      status: input.status,
      payload: JSON.stringify(input.payload),
      errorMessage: input.errorMessage || null,
      lastNotifiedAt: new Date(),
    },
  } as any);
}

let isRunning = false;

async function runOnce(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  const startedAt = Date.now();

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        domainExpiryThresholdDays: true,
      },
    });

    for (const user of users) {
      const thresholdDays = Number.isFinite(user.domainExpiryThresholdDays)
        ? Math.max(1, Math.min(365, user.domainExpiryThresholdDays))
        : 7;

      const creds = await prisma.dnsCredential.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, provider: true, secrets: true, accountId: true },
      });

      const domainAccounts = new Map<string, Array<{ credentialId: number; credentialName: string; provider: string }>>();

      for (const cred of creds) {
        const provider = cred.provider as ProviderType;
        if (!ProviderRegistry.isSupported(provider)) continue;

        let secrets: any;
        try {
          secrets = JSON.parse(decrypt(cred.secrets));
        } catch {
          continue;
        }

        const ctx: DnsServiceContext = {
          provider,
          secrets,
          accountId: cred.accountId || undefined,
          credentialKey: `cred-${cred.id}`,
          encrypted: false,
        };

        let zones: Zone[] = [];
        try {
          zones = await listAllZones(ctx);
        } catch {
          continue;
        }

        for (const z of zones) {
          const name = String(z?.name || '').trim().toLowerCase();
          if (!name) continue;
          const list = domainAccounts.get(name) || [];
          list.push({ credentialId: cred.id, credentialName: cred.name, provider: cred.provider });
          domainAccounts.set(name, list);
        }
      }

      const domains = Array.from(domainAccounts.keys());
      if (domains.length === 0) continue;

      const expiryResults = await DomainExpiryService.lookupDomains(domains, { concurrency: 3 });
      const notificationContext = await CertificateNotificationService.loadContext(user.id);
      const activeChannels = CertificateNotificationService.getEnabledChannels(notificationContext.settings);
      if (activeChannels.length === 0) continue;

      const domainsInThreshold = expiryResults
        .filter(r => typeof r?.expiresAt === 'string')
        .filter(r => {
          const dLeft = daysLeft(r.expiresAt as string);
          return Number.isFinite(dLeft) && dLeft >= 0 && dLeft <= thresholdDays;
        })
        .map(r => r.domain);

      let notifyResults = expiryResults;
      if (domainsInThreshold.length > 0) {
        const refreshed = await DomainExpiryService.lookupDomains(domainsInThreshold, { concurrency: 3, forceRefresh: true });
        const refreshedByDomain = new Map<string, (typeof refreshed)[number]>();
        refreshed.forEach(r => refreshedByDomain.set(String(r.domain || '').toLowerCase(), r));
        notifyResults = expiryResults.map(r => {
          const fresh = refreshedByDomain.get(String(r.domain || '').toLowerCase());
          if (!fresh) return r;
          if (!fresh.expiresAt && r.expiresAt) return r;
          return fresh;
        });
      }

      {
        const now = new Date();
        const prefix = `domainExpiryFailureLog:${user.id}:`;
        const existing = await prisma.cache.findMany({
          where: {
            key: { startsWith: prefix },
            expiresAt: { gt: now },
          },
          select: { key: true },
        });
        const loggedDomains = new Set(existing.map(r => r.key.slice(prefix.length)));

        const ttlMs = 7 * DAY_MS;
        for (const info of notifyResults) {
          if (info.expiresAt) continue;
          const domain = typeof info.domain === 'string' ? info.domain : '';
          if (!domain) continue;
          if (loggedDomains.has(domain)) continue;

          const err = typeof info.error === 'string' ? info.error.trim() : '';
          if (!err) continue;

          loggedDomains.add(domain);
          const cacheKey = `${prefix}${domain}`;
          const cacheExpiresAt = new Date(Date.now() + ttlMs);

          const value = JSON.stringify({ domain, error: err, checkedAt: info.checkedAt });
          await prisma.cache.upsert({
            where: { key: cacheKey },
            create: {
              key: cacheKey,
              value,
              expiresAt: cacheExpiresAt,
            },
            update: {
              value,
              expiresAt: cacheExpiresAt,
            },
          });

          const logValue = JSON.stringify({ action: 'domain_expiry_lookup_failed', domain, error: err, checkedAt: info.checkedAt });
          await prisma.log.create({
            data: {
              userId: user.id,
              action: 'UPDATE',
              resourceType: 'DOMAIN_EXPIRY',
              domain,
              recordName: domain,
              status: 'FAILED',
              errorMessage: err,
              newValue: logValue,
            },
          });
        }
      }

      for (const info of notifyResults) {
        if (!info.expiresAt) continue;
        const dLeft = daysLeft(info.expiresAt);
        if (!Number.isFinite(dLeft)) continue;
        if (dLeft < 0 || dLeft > thresholdDays) continue;

        const expiresAtDate = new Date(info.expiresAt);
        if (Number.isNaN(expiresAtDate.getTime())) continue;

        const accounts = domainAccounts.get(info.domain) || [];
        const payload = {
          type: 'domain_expiry',
          user: { id: user.id, username: user.username },
          domain: info.domain,
          expiresAt: info.expiresAt,
          daysLeft: dLeft,
          thresholdDays,
          accounts,
          checkedAt: info.checkedAt,
        };

        const pendingChannels: NotificationChannel[] = [];
        for (const channel of activeChannels) {
          const where = {
            userId_domain_expiresAt_thresholdDays_channel: {
              userId: user.id,
              domain: info.domain,
              expiresAt: expiresAtDate,
              thresholdDays,
              channel,
            },
          } as const;

          const existing = await prisma.domainExpiryNotification.findUnique({
            where: where.userId_domain_expiresAt_thresholdDays_channel as any,
            select: { status: true, createdAt: true, lastNotifiedAt: true },
          } as any);

          const ls = getLastNotifiedAt(existing);
          if (ls && Date.now() - ls.getTime() < DAY_MS) {
            continue;
          }
          pendingChannels.push(channel);
        }

        if (pendingChannels.length === 0) continue;

        const results = await CertificateNotificationService.notifyDomainExpiryWithContext(
          notificationContext,
          {
            domain: info.domain,
            expiresAt: info.expiresAt,
            daysLeft: dLeft,
            thresholdDays,
            checkedAt: info.checkedAt,
            accounts,
            payload,
          },
          pendingChannels
        );

        for (const result of results) {
          await upsertDomainExpiryNotification({
            userId: user.id,
            domain: info.domain,
            expiresAt: expiresAtDate,
            thresholdDays,
            channel: result.channel,
            status: result.success ? 'SENT' : 'FAILED',
            payload,
            errorMessage: result.success ? null : (result.error || '发送失败'),
          });
        }
      }
    }
  } catch (err) {
    console.error('[domain-expiry] job failed:', err);
  } finally {
    isRunning = false;
    const ms = Date.now() - startedAt;
    console.log(`[domain-expiry] job finished in ${ms}ms`);
  }
}

function msUntilNext(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function startDomainExpiryScheduler() {
  const delay = msUntilNext(3, 0);
  console.log(`[domain-expiry] scheduler armed, next run in ${Math.round(delay / 1000)}s`);
  setTimeout(() => {
    runOnce();
    setInterval(runOnce, DAY_MS);
  }, delay);
}
