/**
 * 域名 → 厂商 zone 解析
 *
 * 调用方只需要域名：`example.com` 或子域名 `www.example.com`。
 * 解析规则：从完整域名开始逐级去掉最左标签，做精确匹配，命中即 zone；
 * 剩余前缀就是记录名。找不到时给出候选建议，而不是模糊猜测。
 */

import { dnsService } from '../../services/dns/DnsService';
import { Zone } from '../../providers/base/types';
import { ApiError } from '../errors';

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export function normalizeDomain(input: unknown): string {
  let value = String(input ?? '').trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  value = value.replace(/\.+$/, '');
  // 去掉末尾的点、以及误传的 `@.`
  return value;
}

function zoneName(zone: Zone): string {
  return String(zone.name || '').toLowerCase().replace(/\.+$/, '');
}

async function searchZones(ctx: any, keyword: string): Promise<Zone[]> {
  const zones: Zone[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const result = await dnsService.getZones(ctx, page, PAGE_SIZE, keyword);
    zones.push(...result.zones);
    if (result.zones.length < PAGE_SIZE || page * PAGE_SIZE >= result.total) break;
  }
  return zones;
}

const fullListCache = new Map<string, { expiresAt: number; zones: Zone[] }>();
const FULL_LIST_TTL_MS = 5 * 60 * 1000;

async function listAllZones(ctx: any, cacheKey: string): Promise<Zone[]> {
  const cached = fullListCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.zones;

  const zones: Zone[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await dnsService.getZones(ctx, page, PAGE_SIZE);
    zones.push(...result.zones);
    if (result.zones.length < PAGE_SIZE || page * PAGE_SIZE >= result.total) break;
  }

  fullListCache.set(cacheKey, { expiresAt: Date.now() + FULL_LIST_TTL_MS, zones });
  return zones;
}

export interface ResolvedZone {
  zone: Zone;
  /** 相对记录名：'@' 表示根记录 */
  recordName: string;
}

export async function resolveZone(ctx: any, input: string, cacheKey: string): Promise<ResolvedZone> {
  const domain = normalizeDomain(input);
  if (!domain) throw new ApiError('INVALID_ARGUMENT', '缺少参数: domain', 400);

  const labels = domain.split('.').filter(Boolean);
  if (labels.length < 2) {
    throw new ApiError('INVALID_ARGUMENT', `域名不合法: ${input}`, 400);
  }

  // 1) 从最长到最短逐级精确匹配（最多到二级后缀）
  for (let i = 0; i <= labels.length - 2; i += 1) {
    const candidate = labels.slice(i).join('.');
    const zones = await searchZones(ctx, candidate);
    const hit = zones.find((zone) => zoneName(zone) === candidate);
    if (hit) {
      const recordName = i === 0 ? '@' : labels.slice(0, i).join('.');
      return { zone: hit, recordName };
    }
  }

  // 2) 关键词搜索可能被厂商忽略，回退到全量列表做最长后缀匹配
  try {
    const zones = await listAllZones(ctx, cacheKey);
    let best: { zone: Zone; index: number } | null = null;
    for (let i = 0; i <= labels.length - 2; i += 1) {
      const candidate = labels.slice(i).join('.');
      const hit = zones.find((zone) => zoneName(zone) === candidate);
      if (hit) {
        best = { zone: hit, index: i };
        break;
      }
    }
    if (best) {
      return {
        zone: best.zone,
        recordName: best.index === 0 ? '@' : labels.slice(0, best.index).join('.'),
      };
    }

    const suggestions = zones
      .map((zone) => zoneName(zone))
      .filter((name) => name.includes(labels[labels.length - 2]) || labels.some((label) => name.includes(label)))
      .slice(0, 5);

    throw new ApiError('ZONE_NOT_FOUND', `域名不存在或不属于该凭证: ${domain}`, 404, { domain, suggestions });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw error;
  }
}

/** 记录名归一化：FQDN → 相对名，支持 @ / 空 / 通配 */
export function normalizeRecordName(input: unknown, zone: string): string {
  let name = String(input ?? '').trim().toLowerCase().replace(/\.+$/, '');
  const zoneLower = String(zone || '').toLowerCase().replace(/\.+$/, '');

  if (!name || name === '@' || name === zoneLower) return '@';
  if (name.endsWith(`.${zoneLower}`)) name = name.slice(0, -(zoneLower.length + 1));
  if (name.endsWith('.')) name = name.replace(/\.+$/, '');
  return name || '@';
}

export function toFqdn(name: string, zone: string): string {
  const zoneLower = normalizeDomain(zone);
  const record = normalizeRecordName(name, zoneLower);
  return record === '@' ? zoneLower : `${record}.${zoneLower}`;
}
