import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { config as envConfig } from '../config';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

const transporterCache = new Map<string, nodemailer.Transporter>();

function normalizeSmtpConfig(input?: Partial<SmtpConfig> | null): SmtpConfig {
  const host = String(input?.host ?? envConfig.smtp.host ?? '').trim();
  const port = Number(input?.port ?? envConfig.smtp.port);
  const from = String(input?.from ?? envConfig.smtp.from ?? '').trim();

  if (!host) {
    throw new Error('SMTP 未配置: SMTP_HOST');
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('SMTP 未配置: SMTP_PORT');
  }
  if (!from) {
    throw new Error('SMTP 未配置: SMTP_FROM');
  }

  const user = String(input?.user ?? envConfig.smtp.user ?? '').trim();
  const pass = String(input?.pass ?? envConfig.smtp.pass ?? '').trim();

  if ((user && !pass) || (!user && pass)) {
    throw new Error('SMTP 认证信息不完整');
  }

  return {
    host,
    port,
    secure: !!(input?.secure ?? envConfig.smtp.secure),
    ...(user && pass ? { user, pass } : {}),
    from,
  };
}

function smtpKey(smtp: SmtpConfig): string {
  const passHash = smtp.pass ? crypto.createHash('sha256').update(smtp.pass).digest('hex') : '';
  return JSON.stringify({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ? 1 : 0,
    user: smtp.user || '',
    passHash,
  });
}

function getTransporter(smtp: SmtpConfig): nodemailer.Transporter {
  const key = smtpKey(smtp);
  const cached = transporterCache.get(key);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user && smtp.pass ? { auth: { user: smtp.user, pass: smtp.pass } } : {}),
  });

  transporterCache.set(key, transporter);
  return transporter;
}

function isLikelyEmail(addr: string): boolean {
  const s = String(addr || '').trim();
  if (!s || s.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToHtml(text: string) {
  return `<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.6; white-space:pre-wrap;">${escapeHtml(text).replace(/\n/g, '<br/>')}</div>`;
}

export async function sendEmailMessage(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  smtp?: Partial<SmtpConfig> | null;
}): Promise<void> {
  const to = String(params?.to || '').trim();
  if (!isLikelyEmail(to)) {
    throw new Error('收件邮箱无效');
  }

  const subject = String(params?.subject || '').trim();
  if (!subject) {
    throw new Error('邮件标题不能为空');
  }

  const text = String(params?.text || '').trim();
  if (!text) {
    throw new Error('邮件内容不能为空');
  }

  const smtp = normalizeSmtpConfig(params?.smtp);
  const transporter = getTransporter(smtp);
  await transporter.sendMail({
    from: smtp.from,
    to,
    subject,
    text,
    html: String(params?.html || '').trim() || plainTextToHtml(text),
  });
}
