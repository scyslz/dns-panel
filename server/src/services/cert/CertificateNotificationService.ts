import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { decrypt } from '../../utils/encryption';
import type { CertificateNotificationPolicy, CertificateSettingsData, VendorCertificateProvider } from '../../types';
import { sendEmailMessage, SmtpConfig } from '../email';
import { requestText } from './httpClient';
import { CertificateSettingsService } from './CertificateSettingsService';

const prisma = new PrismaClient();

type NotificationCategory = 'certificate' | 'deployment' | 'vendor' | 'manualRenewExpiry';
export type NotificationChannel = 'email' | 'webhook' | 'telegram' | 'dingtalk' | 'feishu' | 'wecom' | 'wechatTemplate';

interface NotificationMessage {
  title: string;
  text: string;
  html?: string;
  payload?: Record<string, any>;
}

interface NotificationResult {
  channel: NotificationChannel;
  success: boolean;
  error?: string;
}

export interface NotificationUserContext {
  email: string | null;
  smtp: Partial<SmtpConfig> | null;
  settings: CertificateSettingsData;
}

function normalizeString(value: any) {
  return String(value || '').trim();
}

function formatDateTime(value?: Date | string | null) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(title: string, text: string) {
  return [
    '<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.6;">',
    `<h2 style="margin:0 0 12px;">${escapeHtml(title)}</h2>`,
    `<div style="white-space:pre-wrap;">${escapeHtml(text).replace(/\n/g, '<br/>')}</div>`,
    '</div>',
  ].join('');
}

function policyAllows(policy: CertificateNotificationPolicy, success: boolean) {
  if (policy === 'all') return true;
  if (policy === 'fail_only') return !success;
  return false;
}

function normalizeWebhookHeaders(headers: Record<string, any> | null | undefined) {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const name = normalizeString(key);
    const content = normalizeString(value);
    if (!name || !content) continue;
    next[name] = content;
  }
  return next;
}

function normalizeVendorProvider(provider: string): VendorCertificateProvider {
  if (provider === 'aliyun_esa_free') return 'aliyun_ssl';
  return provider as VendorCertificateProvider;
}

function vendorProviderLabel(provider: string) {
  switch (normalizeVendorProvider(provider)) {
    case 'tencent_ssl':
      return '腾讯云 SSL';
    case 'aliyun_ssl':
      return '阿里云 SSL';
    case 'ucloud_ssl':
      return 'UCloud SSL';
    default:
      return provider || '厂商证书';
  }
}

async function loadUserContext(userId: number): Promise<NotificationUserContext> {
  const [settings, user] = await Promise.all([
    CertificateSettingsService.getSettingsWithSecrets(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpPass: true,
        smtpFrom: true,
      },
    }),
  ]);

  if (!user) throw new Error('用户不存在');

  let smtp: Partial<SmtpConfig> | null = null;
  if (normalizeString(user.smtpHost) && normalizeString(user.smtpFrom)) {
    smtp = {
      host: normalizeString(user.smtpHost),
      port: Number(user.smtpPort || 587),
      secure: !!user.smtpSecure,
      user: normalizeString(user.smtpUser) || undefined,
      pass: user.smtpPass ? decrypt(user.smtpPass) : undefined,
      from: normalizeString(user.smtpFrom),
    };
  }

  return {
    email: normalizeString(user.email) || null,
    smtp,
    settings,
  };
}

async function postJson(url: string, body: Record<string, any>, headers?: Record<string, string>, timeoutMs = 8000) {
  const response = await requestText({
    url,
    method: 'POST',
    timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'dns-panel/1.0 (certificate-notify)',
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response;
}

async function sendWebhook(url: string, payload: Record<string, any>, headers?: Record<string, string>, timeoutMs = 8000) {
  return await postJson(url, payload, headers, timeoutMs);
}

async function sendTelegram(channel: NonNullable<CertificateSettingsData['notifications']['channels']['telegram']>, message: NotificationMessage) {
  const token = normalizeString(channel.botToken);
  const chatId = normalizeString(channel.chatId);
  if (!token || !chatId) throw new Error('Telegram Token/Chat ID 未配置');
  const baseUrl = normalizeString(channel.baseUrl) || 'https://api.telegram.org';
  const html = `<b>${escapeHtml(message.title)}</b>\n${escapeHtml(message.text)}`;
  return await postJson(`${baseUrl.replace(/\/+$/, '')}/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

async function sendDingtalk(channel: NonNullable<CertificateSettingsData['notifications']['channels']['dingtalk']>, message: NotificationMessage) {
  const webhookUrl = normalizeString(channel.webhookUrl);
  if (!webhookUrl) throw new Error('钉钉 Webhook 未配置');
  const url = new URL(webhookUrl);
  const secret = normalizeString(channel.secret);
  if (secret) {
    const timestamp = Date.now();
    const sign = crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', sign);
  }
  return await postJson(url.toString(), {
    msgtype: 'text',
    text: { content: `${message.title}\n\n${message.text}` },
    at: {
      atMobiles: Array.isArray(channel.atMobiles) ? channel.atMobiles.filter(Boolean) : [],
      isAtAll: !!channel.atAll,
    },
  });
}

async function sendFeishu(channel: NonNullable<CertificateSettingsData['notifications']['channels']['feishu']>, message: NotificationMessage) {
  const webhookUrl = normalizeString(channel.webhookUrl);
  if (!webhookUrl) throw new Error('飞书 Webhook 未配置');
  return await postJson(webhookUrl, {
    msg_type: 'text',
    content: {
      text: `${message.title}\n\n${message.text}`,
    },
  });
}

async function sendWecom(channel: NonNullable<CertificateSettingsData['notifications']['channels']['wecom']>, message: NotificationMessage) {
  const webhookUrl = normalizeString(channel.webhookUrl);
  if (!webhookUrl) throw new Error('企业微信 Webhook 未配置');
  return await postJson(webhookUrl, {
    msgtype: 'text',
    text: {
      content: `${message.title}\n\n${message.text}`,
    },
  });
}

async function sendWechatTemplate(channel: NonNullable<CertificateSettingsData['notifications']['channels']['wechatTemplate']>, message: NotificationMessage) {
  const appToken = normalizeString(channel.appToken);
  const uid = normalizeString(channel.uid);
  if (!appToken || !uid) throw new Error('微信公众号模板消息参数未配置');
  return await postJson('https://wxpusher.zjiecode.com/api/send/message', {
    appToken,
    content: `${message.title}\n\n${message.text}`,
    summary: message.title,
    contentType: 1,
    uids: [uid],
  });
}

async function sendConfiguredChannel(channel: NotificationChannel, context: NotificationUserContext, message: NotificationMessage) {
  const channels = context.settings.notifications.channels;

  if (channel === 'email') {
    const to = normalizeString(channels.email?.to) || context.email;
    if (!to) throw new Error('邮件接收地址未配置');
    await sendEmailMessage({
      to,
      subject: message.title,
      text: message.text,
      html: message.html || textToHtml(message.title, message.text),
      smtp: context.smtp,
    });
    return;
  }

  if (channel === 'webhook') {
    const url = normalizeString(channels.webhook?.url);
    if (!url) throw new Error('Webhook URL 未配置');
    await sendWebhook(url, {
      title: message.title,
      text: message.text,
      payload: message.payload || null,
      sentAt: new Date().toISOString(),
    }, normalizeWebhookHeaders(channels.webhook?.headers));
    return;
  }

  if (channel === 'telegram') {
    await sendTelegram(context.settings.notifications.channels.telegram || {}, message);
    return;
  }

  if (channel === 'dingtalk') {
    await sendDingtalk(context.settings.notifications.channels.dingtalk || {}, message);
    return;
  }

  if (channel === 'feishu') {
    await sendFeishu(context.settings.notifications.channels.feishu || {}, message);
    return;
  }

  if (channel === 'wecom') {
    await sendWecom(context.settings.notifications.channels.wecom || {}, message);
    return;
  }

  await sendWechatTemplate(context.settings.notifications.channels.wechatTemplate || {}, message);
}

function enabledChannels(settings: CertificateSettingsData) {
  const channels = settings.notifications.channels;
  return (['email', 'webhook', 'telegram', 'dingtalk', 'feishu', 'wecom', 'wechatTemplate'] as NotificationChannel[])
    .filter((channel) => !!(channels as any)?.[channel]?.enabled);
}

export class CertificateNotificationService {
  static async loadContext(userId: number): Promise<NotificationUserContext> {
    return await loadUserContext(userId);
  }

  static getEnabledChannels(settings: CertificateSettingsData): NotificationChannel[] {
    return enabledChannels(settings);
  }

  static async sendEvent(userId: number, category: NotificationCategory, success: boolean, message: NotificationMessage): Promise<NotificationResult[]> {
    const context = await loadUserContext(userId);
    const policy = context.settings.notifications[category];
    if (!policyAllows(policy, success)) {
      return [];
    }

    const results: NotificationResult[] = [];
    for (const channel of enabledChannels(context.settings)) {
      try {
        await sendConfiguredChannel(channel, context, message);
        results.push({ channel, success: true });
      } catch (error: any) {
        results.push({ channel, success: false, error: error?.message || '发送失败' });
      }
    }

    return results;
  }

  static async notifyDomainExpiryWithContext(
    context: NotificationUserContext,
    input: {
      domain: string;
      expiresAt: Date | string;
      daysLeft: number;
      thresholdDays: number;
      checkedAt?: Date | string | null;
      accounts?: Array<{ credentialName?: string | null; provider?: string | null }>;
      payload?: Record<string, any>;
    },
    channels?: NotificationChannel[]
  ): Promise<NotificationResult[]> {
    const accountSummary = Array.isArray(input.accounts)
      ? input.accounts
          .map((item) => {
            const name = normalizeString(item?.credentialName) || 'unknown';
            const provider = normalizeString(item?.provider) || '-';
            return `${name} (${provider})`;
          })
          .join(', ')
      : '';

    const message: NotificationMessage = {
      title: `域名即将到期：${input.domain}`,
      text: [
        `域名：${input.domain}`,
        `到期时间：${formatDateTime(input.expiresAt)}`,
        `剩余天数：${input.daysLeft}`,
        `提醒阈值：${input.thresholdDays}`,
        ...(accountSummary ? [`关联账户：${accountSummary}`] : []),
        `检查时间：${formatDateTime(input.checkedAt || new Date())}`,
      ].join('\n'),
      payload: input.payload || {
        type: 'domain_expiry',
        domain: input.domain,
        expiresAt: input.expiresAt,
        daysLeft: input.daysLeft,
        thresholdDays: input.thresholdDays,
        checkedAt: input.checkedAt || new Date().toISOString(),
        accounts: input.accounts || [],
      },
    };

    const targets = channels && channels.length > 0 ? channels : enabledChannels(context.settings);
    const results: NotificationResult[] = [];

    for (const channel of targets) {
      try {
        await sendConfiguredChannel(channel, context, message);
        results.push({ channel, success: true });
      } catch (error: any) {
        results.push({ channel, success: false, error: error?.message || '发送失败' });
      }
    }

    return results;
  }

  static async sendTest(userId: number, channel?: NotificationChannel) {
    const context = await loadUserContext(userId);
    const message: NotificationMessage = {
      title: '证书通知测试',
      text: `这是一条测试通知。\n时间：${formatDateTime(new Date())}`,
      payload: { type: 'certificate.notification.test' },
    };

    const targets = channel ? [channel] : enabledChannels(context.settings);
    const results: NotificationResult[] = [];

    for (const item of targets) {
      try {
        await sendConfiguredChannel(item, context, message);
        results.push({ channel: item, success: true });
      } catch (error: any) {
        results.push({ channel: item, success: false, error: error?.message || '发送失败' });
      }
    }

    return results;
  }

  static async notifyCertificateIssued(userId: number, input: {
    primaryDomain: string;
    domains: string[];
    provider: string;
    issuedAt?: Date | string | null;
    expiresAt?: Date | string | null;
  }) {
    return await this.sendEvent(userId, 'certificate', true, {
      title: `证书签发成功：${input.primaryDomain}`,
      text: [
        `主域名：${input.primaryDomain}`,
        `域名列表：${input.domains.join(', ') || input.primaryDomain}`,
        `签发渠道：${input.provider}`,
        `签发时间：${formatDateTime(input.issuedAt)}`,
        `到期时间：${formatDateTime(input.expiresAt)}`,
      ].join('\n'),
      payload: input,
    });
  }

  static async notifyCertificateFailed(userId: number, input: {
    primaryDomain: string;
    domains: string[];
    provider: string;
    error: string;
  }) {
    return await this.sendEvent(userId, 'certificate', false, {
      title: `证书签发失败：${input.primaryDomain}`,
      text: [
        `主域名：${input.primaryDomain}`,
        `域名列表：${input.domains.join(', ') || input.primaryDomain}`,
        `签发渠道：${input.provider}`,
        `失败原因：${input.error}`,
        `时间：${formatDateTime(new Date())}`,
      ].join('\n'),
      payload: input,
    });
  }

  static async notifyRenewSucceeded(userId: number, input: {
    primaryDomain: string;
    domains: string[];
    provider: string;
    issuedAt?: Date | string | null;
    expiresAt?: Date | string | null;
  }) {
    return await this.sendEvent(userId, 'certificate', true, {
      title: `证书续期成功：${input.primaryDomain}`,
      text: [
        `主域名：${input.primaryDomain}`,
        `域名列表：${input.domains.join(', ') || input.primaryDomain}`,
        `签发渠道：${input.provider}`,
        `续期时间：${formatDateTime(input.issuedAt)}`,
        `新到期时间：${formatDateTime(input.expiresAt)}`,
      ].join('\n'),
      payload: input,
    });
  }

  static async notifyRenewFailed(userId: number, input: {
    primaryDomain: string;
    domains: string[];
    provider: string;
    error: string;
  }) {
    return await this.sendEvent(userId, 'certificate', false, {
      title: `证书续期失败：${input.primaryDomain}`,
      text: [
        `主域名：${input.primaryDomain}`,
        `域名列表：${input.domains.join(', ') || input.primaryDomain}`,
        `签发渠道：${input.provider}`,
        `失败原因：${input.error}`,
        `时间：${formatDateTime(new Date())}`,
      ].join('\n'),
      payload: input,
    });
  }

  static async notifyVendorIssued(userId: number, input: {
    primaryDomain: string;
    domains: string[];
    provider: string;
    issuedAt?: Date | string | null;
    expiresAt?: Date | string | null;
  }) {
    return await this.sendEvent(userId, 'vendor', true, {
      title: `厂商证书签发成功：${input.primaryDomain}`,
      text: [
        `主域名：${input.primaryDomain}`,
        `域名列表：${input.domains.join(', ') || input.primaryDomain}`,
        `厂商渠道：${vendorProviderLabel(input.provider)}`,
        `签发时间：${formatDateTime(input.issuedAt)}`,
        `到期时间：${formatDateTime(input.expiresAt)}`,
      ].join('\n'),
      payload: input,
    });
  }

  static async notifyVendorFailed(userId: number, input: {
    primaryDomain: string;
    domains: string[];
    provider: string;
    error: string;
  }) {
    return await this.sendEvent(userId, 'vendor', false, {
      title: `厂商证书签发失败：${input.primaryDomain}`,
      text: [
        `主域名：${input.primaryDomain}`,
        `域名列表：${input.domains.join(', ') || input.primaryDomain}`,
        `厂商渠道：${vendorProviderLabel(input.provider)}`,
        `失败原因：${input.error}`,
        `时间：${formatDateTime(new Date())}`,
      ].join('\n'),
      payload: input,
    });
  }

  static async notifyDeploymentResult(userId: number, input: {
    primaryDomain: string;
    targetName: string;
    targetType: string;
    event: string;
    success: boolean;
    triggerMode?: string | null;
    sourceType?: string;
    error?: string | null;
  }) {
    return await this.sendEvent(userId, 'deployment', !!input.success, {
      title: `证书部署${input.success ? '成功' : '失败'}：${input.primaryDomain}`,
      text: [
        `主域名：${input.primaryDomain}`,
        `部署目标：${input.targetName}`,
        `目标类型：${input.targetType}`,
        `触发事件：${input.event}`,
        `触发方式：${input.triggerMode || 'unknown'}`,
        `证书来源：${input.sourceType || 'unknown'}`,
        ...(input.error ? [`错误信息：${input.error}`] : []),
        `时间：${formatDateTime(new Date())}`,
      ].join('\n'),
      payload: input,
    });
  }

  static async notifyManualRenewExpiry(userId: number, input: {
    primaryDomain: string;
    domains: string[];
    expiresAt: Date | string;
    daysLeft: number;
  }) {
    return await this.sendEvent(userId, 'manualRenewExpiry', false, {
      title: `手动续期证书即将到期：${input.primaryDomain}`,
      text: [
        `主域名：${input.primaryDomain}`,
        `域名列表：${input.domains.join(', ') || input.primaryDomain}`,
        `到期时间：${formatDateTime(input.expiresAt)}`,
        `剩余天数：${input.daysLeft}`,
        '当前证书未开启自动续期，请尽快手动续签。',
      ].join('\n'),
      payload: input,
    });
  }
}
