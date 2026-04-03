import { PrismaClient } from '@prisma/client';
import { decrypt, encrypt } from '../../utils/encryption';
import type { CertificateNotificationPolicy, CertificateSettingsChannels, CertificateSettingsData } from '../../types';

const prisma = new PrismaClient();

function parseJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function normalizeString(value: any): string {
  return String(value || '').trim();
}

function normalizeNullableString(value: any): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeBoolean(value: any, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = normalizeString(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeInt(value: any, fallback: number, min: number, max: number): number {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizePolicy(value: any, fallback: CertificateNotificationPolicy = 'off'): CertificateNotificationPolicy {
  const policy = normalizeString(value).toLowerCase();
  if (policy === 'all' || policy === 'fail_only' || policy === 'off') return policy;
  return fallback;
}

function normalizeStringList(value: any): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeString(item)).filter(Boolean)));
  }
  const raw = normalizeString(value);
  if (!raw) return [];
  return Array.from(new Set(raw.split(',').map((item) => normalizeString(item)).filter(Boolean)));
}

function defaultSettings(): CertificateSettingsData {
  return {
    defaultContact: {
      name: '',
      phone: '',
      email: '',
      companyName: '',
      companyAddress: '',
      companyCountry: 'CN',
      companyRegion: '',
      companyCity: '',
      companyDivision: '',
      companyPhone: '',
      companyPostalCode: '',
      title: '',
    },
    automation: {
      renewDays: 30,
      deployHourStart: 0,
      deployHourEnd: 23,
      timezone: 'Asia/Shanghai',
    },
    notifications: {
      certificate: 'off',
      deployment: 'off',
      vendor: 'off',
      manualRenewExpiry: 'off',
      channels: {
        email: { enabled: false, to: null },
        webhook: { enabled: false, url: null, headers: {} },
        telegram: { enabled: false, botToken: null, chatId: null, baseUrl: null },
        dingtalk: { enabled: false, webhookUrl: null, secret: null, atMobiles: [], atAll: false },
        feishu: { enabled: false, webhookUrl: null, atUserIds: [], atAll: false },
        wecom: { enabled: false, webhookUrl: null },
        wechatTemplate: { enabled: false, appToken: null, uid: null },
      },
    },
  };
}

function mergeSettings(base: CertificateSettingsData, patch?: Partial<CertificateSettingsData> | null): CertificateSettingsData {
  return {
    defaultContact: {
      ...base.defaultContact,
      ...(patch?.defaultContact || {}),
    },
    automation: {
      ...base.automation,
      ...(patch?.automation || {}),
      timezone: 'Asia/Shanghai',
    },
    notifications: {
      ...base.notifications,
      ...(patch?.notifications || {}),
      channels: {
        ...base.notifications.channels,
        ...(patch?.notifications?.channels || {}),
      },
    },
  };
}

function sanitizeSecretChannels(channels: CertificateSettingsChannels | undefined) {
  return {
    telegram: {
      botToken: normalizeNullableString(channels?.telegram?.botToken),
    },
    dingtalk: {
      secret: normalizeNullableString(channels?.dingtalk?.secret),
    },
    wechatTemplate: {
      appToken: normalizeNullableString(channels?.wechatTemplate?.appToken),
    },
  };
}

function stripSecrets(data: CertificateSettingsData) {
  return {
    ...data,
    notifications: {
      ...data.notifications,
      channels: {
        ...data.notifications.channels,
        telegram: {
          ...data.notifications.channels.telegram,
          botToken: undefined,
          hasBotToken: !!data.notifications.channels.telegram?.botToken,
        },
        dingtalk: {
          ...data.notifications.channels.dingtalk,
          secret: undefined,
          hasSecret: !!data.notifications.channels.dingtalk?.secret,
        },
        wechatTemplate: {
          ...data.notifications.channels.wechatTemplate,
          appToken: undefined,
          hasAppToken: !!data.notifications.channels.wechatTemplate?.appToken,
        },
      },
    },
  };
}

function normalizeSettingsInput(current: CertificateSettingsData, input: any): CertificateSettingsData {
  const merged = mergeSettings(current, input || {});
  const channels = input?.notifications?.channels || {};

  return {
    defaultContact: {
      name: normalizeString(merged.defaultContact.name),
      phone: normalizeString(merged.defaultContact.phone),
      email: normalizeString(merged.defaultContact.email),
      companyName: normalizeString(merged.defaultContact.companyName),
      companyAddress: normalizeString(merged.defaultContact.companyAddress),
      companyCountry: normalizeString(merged.defaultContact.companyCountry || 'CN') || 'CN',
      companyRegion: normalizeString(merged.defaultContact.companyRegion),
      companyCity: normalizeString(merged.defaultContact.companyCity),
      companyDivision: normalizeString(merged.defaultContact.companyDivision),
      companyPhone: normalizeString(merged.defaultContact.companyPhone),
      companyPostalCode: normalizeString(merged.defaultContact.companyPostalCode),
      title: normalizeString(merged.defaultContact.title),
    },
    automation: {
      renewDays: normalizeInt(merged.automation.renewDays, 30, 1, 365),
      deployHourStart: normalizeInt(merged.automation.deployHourStart, 0, 0, 23),
      deployHourEnd: normalizeInt(merged.automation.deployHourEnd, 23, 0, 23),
      timezone: 'Asia/Shanghai',
    },
    notifications: {
      certificate: normalizePolicy(merged.notifications.certificate, 'off'),
      deployment: normalizePolicy(merged.notifications.deployment, 'off'),
      vendor: normalizePolicy(merged.notifications.vendor, 'off'),
      manualRenewExpiry: normalizePolicy(merged.notifications.manualRenewExpiry, 'off'),
      channels: {
        email: {
          enabled: normalizeBoolean(merged.notifications.channels.email?.enabled, false),
          to: normalizeNullableString(merged.notifications.channels.email?.to),
        },
        webhook: {
          enabled: normalizeBoolean(merged.notifications.channels.webhook?.enabled, false),
          url: normalizeNullableString(merged.notifications.channels.webhook?.url),
          headers: merged.notifications.channels.webhook?.headers && typeof merged.notifications.channels.webhook.headers === 'object'
            ? Object.fromEntries(Object.entries(merged.notifications.channels.webhook.headers).map(([key, value]) => [normalizeString(key), normalizeString(value)]).filter(([key, value]) => key && value))
            : {},
        },
        telegram: {
          enabled: normalizeBoolean(merged.notifications.channels.telegram?.enabled, false),
          botToken: Object.prototype.hasOwnProperty.call(channels.telegram || {}, 'botToken')
            ? normalizeNullableString(channels.telegram?.botToken)
            : merged.notifications.channels.telegram?.botToken || null,
          chatId: normalizeNullableString(merged.notifications.channels.telegram?.chatId),
          baseUrl: normalizeNullableString(merged.notifications.channels.telegram?.baseUrl),
        },
        dingtalk: {
          enabled: normalizeBoolean(merged.notifications.channels.dingtalk?.enabled, false),
          webhookUrl: normalizeNullableString(merged.notifications.channels.dingtalk?.webhookUrl),
          secret: Object.prototype.hasOwnProperty.call(channels.dingtalk || {}, 'secret')
            ? normalizeNullableString(channels.dingtalk?.secret)
            : merged.notifications.channels.dingtalk?.secret || null,
          atMobiles: normalizeStringList(merged.notifications.channels.dingtalk?.atMobiles),
          atAll: normalizeBoolean(merged.notifications.channels.dingtalk?.atAll, false),
        },
        feishu: {
          enabled: normalizeBoolean(merged.notifications.channels.feishu?.enabled, false),
          webhookUrl: normalizeNullableString(merged.notifications.channels.feishu?.webhookUrl),
          atUserIds: normalizeStringList(merged.notifications.channels.feishu?.atUserIds),
          atAll: normalizeBoolean(merged.notifications.channels.feishu?.atAll, false),
        },
        wecom: {
          enabled: normalizeBoolean(merged.notifications.channels.wecom?.enabled, false),
          webhookUrl: normalizeNullableString(merged.notifications.channels.wecom?.webhookUrl),
        },
        wechatTemplate: {
          enabled: normalizeBoolean(merged.notifications.channels.wechatTemplate?.enabled, false),
          appToken: Object.prototype.hasOwnProperty.call(channels.wechatTemplate || {}, 'appToken')
            ? normalizeNullableString(channels.wechatTemplate?.appToken)
            : merged.notifications.channels.wechatTemplate?.appToken || null,
          uid: normalizeNullableString(merged.notifications.channels.wechatTemplate?.uid),
        },
      },
    },
  };
}

function resolveStoredSettings(record: { email: string | null; certificateSettingsJson: string | null; certificateSettingsSecrets: string | null }) {
  const defaults = defaultSettings();
  const raw = parseJson<CertificateSettingsData>(record.certificateSettingsJson, defaults);
  const secretsRaw = record.certificateSettingsSecrets ? parseJson<any>(decrypt(record.certificateSettingsSecrets), {}) : {};
  const merged = mergeSettings(defaults, raw);
  merged.defaultContact.email = normalizeString(merged.defaultContact.email || record.email || '');
  merged.notifications.channels.email = {
    ...merged.notifications.channels.email,
    to: normalizeNullableString(merged.notifications.channels.email?.to) || normalizeNullableString(record.email),
  };
  merged.notifications.channels.telegram = {
    ...merged.notifications.channels.telegram,
    botToken: secretsRaw?.telegram?.botToken || null,
  };
  merged.notifications.channels.dingtalk = {
    ...merged.notifications.channels.dingtalk,
    secret: secretsRaw?.dingtalk?.secret || null,
  };
  merged.notifications.channels.wechatTemplate = {
    ...merged.notifications.channels.wechatTemplate,
    appToken: secretsRaw?.wechatTemplate?.appToken || null,
  };
  return merged;
}

export class CertificateSettingsService {
  static async getSettings(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        certificateSettingsJson: true,
        certificateSettingsSecrets: true,
      },
    });
    if (!user) throw new Error('用户不存在');
    return stripSecrets(resolveStoredSettings(user));
  }

  static async getSettingsWithSecrets(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        certificateSettingsJson: true,
        certificateSettingsSecrets: true,
      },
    });
    if (!user) throw new Error('用户不存在');
    return resolveStoredSettings(user);
  }

  static async updateSettings(userId: number, input: any) {
    const current = await this.getSettingsWithSecrets(userId);
    const normalized = normalizeSettingsInput(current, input);
    const secrets = sanitizeSecretChannels(normalized.notifications.channels);

    await prisma.user.update({
      where: { id: userId },
      data: {
        certificateSettingsJson: JSON.stringify({
          ...normalized,
          notifications: {
            ...normalized.notifications,
            channels: {
              ...normalized.notifications.channels,
              telegram: {
                ...normalized.notifications.channels.telegram,
                botToken: undefined,
              },
              dingtalk: {
                ...normalized.notifications.channels.dingtalk,
                secret: undefined,
              },
              wechatTemplate: {
                ...normalized.notifications.channels.wechatTemplate,
                appToken: undefined,
              },
            },
          },
        }),
        certificateSettingsSecrets: encrypt(JSON.stringify(secrets)),
      },
    });

    return stripSecrets(normalized);
  }

  static async getDeployWindow(userId: number) {
    const settings = await this.getSettingsWithSecrets(userId);
    return settings.automation;
  }

  static isHourWithinWindow(hour: number, start: number, end: number) {
    if (start === end) return true;
    if (start < end) return hour >= start && hour <= end;
    return hour >= start || hour <= end;
  }

  static async isWithinDeployWindow(userId: number, now = new Date()) {
    const automation = await this.getDeployWindow(userId);
    const localHour = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    }).format(now), 10);
    return this.isHourWithinWindow(localHour, automation.deployHourStart, automation.deployHourEnd);
  }
}
