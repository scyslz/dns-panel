/**
 * 记录定位：按 name/type/value 精确查找
 *
 * 不依赖厂商的 keyword / subDomain 模糊搜索（各家语义不一致），
 * 只把 type 作为服务端过滤条件，剩下的在本地精确比对。
 */

import { dnsService } from '../../services/dns/DnsService';
import { DnsRecord } from '../../providers/base/types';
import { normalizeRecordName } from './resolve';

const PAGE_SIZE = 500;
const MAX_PAGES = 10;

export interface RecordMatch {
  name: string;
  type?: string;
  value?: string;
  line?: string;
}

export function normalizeValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\.+$/, '')
    .toLowerCase();
}

function recordNameKey(record: DnsRecord): string {
  const zoneName = String(record.zoneName || '').toLowerCase().replace(/\.+$/, '');
  let name = String(record.name || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!name || name === '@' || name === zoneName) return '@';
  if (zoneName && name.endsWith(`.${zoneName}`)) name = name.slice(0, -(zoneName.length + 1));
  return name;
}

function matchRecord(record: DnsRecord, target: RecordMatch): boolean {
  if (target.type && String(record.type || '').toUpperCase() !== target.type.toUpperCase()) return false;
  if (recordNameKey(record) !== target.name) return false;
  if (target.value !== undefined && normalizeValue(record.value) !== normalizeValue(target.value)) return false;
  if (target.line !== undefined && String(record.line || '') !== String(target.line)) return false;
  return true;
}

export function isEmptyResultError(error: any): boolean {
  const code = String(error?.details?.code || error?.code || '');
  const message = String(error?.message || '');
  return /NoDataOfRecord|NoData|记录列表为空|记录不存在/i.test(`${code} ${message}`);
}

/** 拉取该 zone 的全部记录（分页 + 空结果容错） */
export async function listAllRecords(ctx: any, zoneIdOrName: string, type?: string): Promise<DnsRecord[]> {
  const records: DnsRecord[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let result;
    try {
      result = await dnsService.getRecords(ctx, zoneIdOrName, {
        page,
        pageSize: PAGE_SIZE,
        type: type ? type.toUpperCase() : undefined,
      });
    } catch (error) {
      if (isEmptyResultError(error)) break;
      throw error;
    }

    records.push(...result.records);
    if (result.records.length < PAGE_SIZE) break;
    if (result.total && page * PAGE_SIZE >= result.total) break;
  }

  return records;
}

/**
 * 返回所有精确匹配的记录；调用方负责处理 0 条 / 多条。
 */
export async function findRecords(
  ctx: any,
  zoneIdOrName: string,
  target: RecordMatch
): Promise<DnsRecord[]> {
  const wantedName = normalizeRecordName(target.name, zoneIdOrName);
  const all = await listAllRecords(ctx, zoneIdOrName, target.type);
  return all.filter((record) => matchRecord(record, { ...target, name: wantedName }));
}

/** 单条定位：0 → 404，>1 → 409（附带候选） */
export async function findOneRecord(
  ctx: any,
  zoneIdOrName: string,
  target: RecordMatch
): Promise<DnsRecord> {
  const matches = await findRecords(ctx, zoneIdOrName, target);
  if (matches.length === 0) {
    const { ApiError } = await import('../errors');
    throw new ApiError('RECORD_NOT_FOUND', `记录不存在: ${target.name} ${target.type || ''}`.trim(), 404, {
      name: target.name,
      type: target.type,
      value: target.value,
    });
  }
  if (matches.length > 1) {
    const { ApiError } = await import('../errors');
    throw new ApiError(
      'AMBIGUOUS_RECORD',
      `匹配到 ${matches.length} 条记录，请补充 type/value 或改用 recordId`,
      409,
      {
        candidates: matches.slice(0, 20).map((record) => ({
          id: record.id,
          name: record.name,
          type: record.type,
          value: record.value,
          line: record.line,
        })),
      }
    );
  }
  return matches[0];
}
