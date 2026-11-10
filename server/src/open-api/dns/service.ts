/**
 * 开放 API 的 DNS 记录服务
 *
 * 编排：解析域名 → 校验 → 调用 dnsService → 写审计日志 → 映射响应。
 * 所有厂商差异都交给现有 Provider 抽象处理，这里不做特判。
 */

import { dnsService } from '../../services/dns/DnsService';
import { LoggerService } from '../../services/logger';
import { CreateRecordParams, DnsRecord, ProviderCapabilities } from '../../providers/base/types';
import { ApiError } from '../errors';
import { assertCredentialScope, resolveCredential, ResolvedCredential } from './context';
import { findOneRecord, findRecords, isEmptyResultError, listAllRecords, normalizeValue } from './locator';
import { normalizeDomain, normalizeRecordName, resolveZone, toFqdn } from './resolve';
import { RecordInput, validateRecordInput } from './validator';

export interface ApiActor {
  userId: number;
  apiKeyId: number;
  apiKeyName: string;
  ip: string;
  requestId?: string;
  allowedDomains: string[];
}

function assertDomainAllowedForActor(actor: ApiActor, domain: string) {
  const allowed = actor.allowedDomains || [];
  if (allowed.length === 0) return;
  const target = String(domain).toLowerCase().replace(/\.$/, '');
  const ok = allowed.some((rule) => {
    const pattern = String(rule).toLowerCase().replace(/\.$/, '');
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return target.endsWith(suffix) && target.length > suffix.length;
    }
    return target === pattern;
  });
  if (!ok) {
    throw new ApiError('DOMAIN_NOT_ALLOWED', `域名 ${domain} 不在此 Key 的白名单内`, 403, { allowedDomains: allowed });
  }
}

export function mapRecord(record: DnsRecord, domain: string): Record<string, unknown> {
  const zone = domain || record.zoneName;
  const name = normalizeRecordName(record.name, zone);
  return {
    id: record.id,
    domain: record.zoneName || zone,
    name,
    fqdn: toFqdn(name, record.zoneName || zone),
    type: record.type,
    value: record.value,
    ttl: record.ttl,
    line: record.line,
    weight: record.weight,
    priority: record.priority,
    status: record.status,
    proxied: record.proxied,
    remark: record.remark,
    updatedAt: record.updatedAt,
  };
}

async function logWrite(
  actor: ApiActor,
  action: 'CREATE' | 'UPDATE' | 'DELETE',
  data: { domain?: string; recordName?: string; recordType?: string; oldValue?: unknown; newValue?: unknown; error?: string }
) {
  await LoggerService.createLog({
    userId: actor.userId,
    action,
    resourceType: 'DNS',
    domain: data.domain,
    recordName: data.recordName,
    recordType: data.recordType,
    oldValue: data.oldValue === undefined ? undefined : JSON.stringify(data.oldValue),
    newValue:
      data.newValue === undefined
        ? undefined
        : JSON.stringify({
            source: 'api',
            apiKeyId: actor.apiKeyId,
            apiKeyName: actor.apiKeyName,
            requestId: actor.requestId,
            ...(typeof data.newValue === 'object' && data.newValue !== null ? data.newValue : { value: data.newValue }),
          }),
    status: data.error ? 'FAILED' : 'SUCCESS',
    errorMessage: data.error,
    ipAddress: actor.ip,
  });
}

export async function openContext(
  actor: ApiActor,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
): Promise<ResolvedCredential> {
  const hasExplicit = credentialId !== undefined && credentialId !== null && credentialId !== '';
  const effective = hasExplicit ? credentialId : boundCredentialId;
  assertCredentialScope(boundCredentialId, effective);
  return resolveCredential(actor.userId, effective, { requireRecordCapable: true });
}

export async function listZones(
  actor: ApiActor,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  params: { keyword?: string; page?: number; pageSize?: number }
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(params.pageSize) || 20), 100);

  const result = await dnsService.getZones(credential.ctx, page, pageSize, params.keyword);
  const visible = result.zones.filter(
    (zone) => (actor.allowedDomains || []).length === 0 || isAllowed(actor, zone.name)
  );

  return {
    credential: { id: credential.id, name: credential.name, provider: credential.provider },
    total: (actor.allowedDomains || []).length > 0 ? visible.length : result.total,
    zones: visible.map((zone) => ({
      id: zone.id,
      name: zone.name,
      status: zone.status,
      recordCount: zone.recordCount,
      authorityStatus: zone.authorityStatus,
      nameServers: (zone.meta as any)?.nameServers,
      updatedAt: zone.updatedAt,
    })),
    page,
    pageSize,
  };
}

function isAllowed(actor: ApiActor, domain: string): boolean {
  const allowed = actor.allowedDomains || [];
  if (allowed.length === 0) return true;
  const target = String(domain).toLowerCase().replace(/\.$/, '');
  return allowed.some((rule) => {
    const pattern = String(rule).toLowerCase().replace(/\.$/, '');
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return target.endsWith(suffix) && target.length > suffix.length;
    }
    return target === pattern;
  });
}

export async function getZoneDetail(
  actor: ApiActor,
  domain: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const zone = await dnsService.getZone(credential.ctx, resolved.zone.id);
  return {
    credential: { id: credential.id, name: credential.name, provider: credential.provider },
    zone: {
      id: zone.id,
      name: zone.name,
      status: zone.status,
      recordCount: zone.recordCount,
      authorityStatus: zone.authorityStatus,
      nameServers: (zone.meta as any)?.nameServers,
      updatedAt: zone.updatedAt,
    },
  };
}

export async function listRecords(
  actor: ApiActor,
  domain: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  params: { name?: string; type?: string; value?: string; page?: number; pageSize?: number }
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(params.pageSize) || 20), 500);
  const type = params.type ? String(params.type).toUpperCase() : undefined;
  const hasFilter = !!params.name || params.value !== undefined;

  let records: DnsRecord[] = [];
  let total = 0;

  if (hasFilter) {
    // 厂商的 keyword 语义不一致（DNSPod 甚至会因无结果直接报错），统一本地精确过滤
    const all = await listAllRecords(credential.ctx, resolved.zone.name, type);
    const wantedName = params.name ? normalizeRecordName(params.name, resolved.zone.name) : undefined;
    const filtered = all.filter((record) => {
      if (wantedName && normalizeRecordName(record.name, resolved.zone.name) !== wantedName) return false;
      if (params.value !== undefined && normalizeValue(record.value) !== normalizeValue(params.value)) return false;
      return true;
    });
    total = filtered.length;
    records = filtered.slice((page - 1) * pageSize, page * pageSize);
  } else {
    try {
      const result = await dnsService.getRecords(credential.ctx, resolved.zone.id, { page, pageSize, type });
      records = result.records;
      total = result.total;
    } catch (error) {
      if (!isEmptyResultError(error)) throw error;
      records = [];
      total = 0;
    }
  }

  const caps = dnsService.getCapabilities(credential.ctx);
  return {
    domain: resolved.zone.name,
    zoneId: resolved.zone.id,
    records: records.map((record) => mapRecord(record, resolved.zone.name)),
    total,
    page,
    pageSize,
    capabilities: capabilitySummary(caps),
  };
}

function capabilitySummary(caps: ProviderCapabilities) {
  return {
    provider: caps.provider,
    name: caps.name,
    recordTypes: caps.recordTypes,
    supportsLine: caps.supportsLine,
    supportsWeight: caps.supportsWeight,
    supportsStatus: caps.supportsStatus,
    supportsRemark: caps.supportsRemark,
  };
}

export async function getRecordDetail(
  actor: ApiActor,
  domain: string,
  recordId: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const record = await dnsService.getRecord(credential.ctx, resolved.zone.id, recordId);
  return { record: mapRecord(record, resolved.zone.name) };
}

async function minTtlOf(credential: ResolvedCredential, zoneId: string): Promise<number | undefined> {
  try {
    return await dnsService.getMinTTL(credential.ctx, zoneId);
  } catch {
    return undefined;
  }
}

function toCreateParams(input: RecordInput, name: string): CreateRecordParams {
  return {
    name,
    type: input.type,
    value: input.value,
    ttl: input.ttl,
    line: input.line,
    weight: input.weight,
    priority: input.priority,
    remark: input.remark,
    proxied: input.proxied,
    options: input.options,
  };
}

export async function createRecord(
  actor: ApiActor,
  domain: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  body: RecordInput
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const caps = dnsService.getCapabilities(credential.ctx);
  const input = validateRecordInput(
    { ...body, name: normalizeRecordName(body.name, resolved.zone.name) },
    caps,
    { minTtl: body.ttl !== undefined ? await minTtlOf(credential, resolved.zone.id) : undefined }
  );

  try {
    const record = await dnsService.createRecord(
      credential.ctx,
      resolved.zone.id,
      toCreateParams(input, input.name)
    );
    const mapped = mapRecord(record, resolved.zone.name);
    await logWrite(actor, 'CREATE', {
      domain: resolved.zone.name,
      recordName: String(mapped.name),
      recordType: String(mapped.type),
      newValue: mapped,
    });
    return { record: mapped };
  } catch (error: any) {
    await logWrite(actor, 'CREATE', {
      domain: resolved.zone.name,
      recordName: input.name,
      recordType: input.type,
      error: error?.message,
    });
    throw error;
  }
}

function buildMergedParams(record: DnsRecord, zone: string, patch: Partial<RecordInput>): RecordInput {
  return {
    name: patch.name !== undefined ? normalizeRecordName(patch.name, zone) : normalizeRecordName(record.name, zone),
    type: String(patch.type || record.type).toUpperCase(),
    value: patch.value !== undefined ? String(patch.value) : String(record.value),
    ttl: patch.ttl !== undefined ? patch.ttl : record.ttl,
    line: patch.line !== undefined ? patch.line : record.line,
    weight: patch.weight !== undefined ? patch.weight : record.weight,
    priority: patch.priority !== undefined ? patch.priority : record.priority,
    remark: patch.remark !== undefined ? patch.remark : record.remark,
    proxied: patch.proxied !== undefined ? patch.proxied : record.proxied,
    options: patch.options,
  };
}

export async function updateRecord(
  actor: ApiActor,
  domain: string,
  recordId: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  body: Partial<RecordInput>,
  mode: 'patch' | 'put'
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const existing = await dnsService.getRecord(credential.ctx, resolved.zone.id, recordId);
  const caps = dnsService.getCapabilities(credential.ctx);

  if (mode === 'put' && (!body.name || !body.type || body.value === undefined)) {
    throw new ApiError('INVALID_ARGUMENT', 'PUT 需要完整字段: name, type, value', 400);
  }

  const merged = buildMergedParams(existing, resolved.zone.name, body);
  const input = validateRecordInput(merged, caps, {
    minTtl: body.ttl !== undefined ? await minTtlOf(credential, resolved.zone.id) : undefined,
  });

  try {
    const updated = await dnsService.updateRecord(
      credential.ctx,
      resolved.zone.id,
      recordId,
      toCreateParams(input, input.name)
    );
    const mapped = mapRecord(updated, resolved.zone.name);
    await logWrite(actor, 'UPDATE', {
      domain: resolved.zone.name,
      recordName: String(mapped.name),
      recordType: String(mapped.type),
      oldValue: mapRecord(existing, resolved.zone.name),
      newValue: mapped,
    });
    return { record: mapped };
  } catch (error: any) {
    await logWrite(actor, 'UPDATE', {
      domain: resolved.zone.name,
      recordName: input.name,
      recordType: input.type,
      error: error?.message,
    });
    throw error;
  }
}

export async function deleteRecordById(
  actor: ApiActor,
  domain: string,
  recordId: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const existing = await dnsService.getRecord(credential.ctx, resolved.zone.id, recordId).catch(() => null);
  await dnsService.deleteRecord(credential.ctx, resolved.zone.id, recordId);

  await logWrite(actor, 'DELETE', {
    domain: resolved.zone.name,
    recordName: existing ? normalizeRecordName(existing.name, resolved.zone.name) : undefined,
    recordType: existing?.type,
    oldValue: existing ? mapRecord(existing, resolved.zone.name) : undefined,
    newValue: { deleted: 1, id: recordId },
  });

  return { deleted: 1 };
}

export async function deleteRecordsByMatch(
  actor: ApiActor,
  domain: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  query: { name?: string; type?: string; value?: string; line?: string; all?: boolean }
) {
  if (!query.name || !query.type) {
    throw new ApiError('INVALID_ARGUMENT', '按内容删除需要 name 和 type 参数', 400);
  }

  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const matches = await findRecords(credential.ctx, resolved.zone.name, {
    name: normalizeRecordName(query.name, resolved.zone.name),
    type: String(query.type).toUpperCase(),
    value: query.value,
    line: query.line,
  });

  if (matches.length === 0) return { deleted: 0 };
  if (matches.length > 1 && !query.all) {
    throw new ApiError('AMBIGUOUS_RECORD', `匹配到 ${matches.length} 条记录，请补充 value 或传 all=true`, 409, {
      candidates: matches.slice(0, 20).map((record) => ({
        id: record.id,
        name: record.name,
        type: record.type,
        value: record.value,
        line: record.line,
      })),
    });
  }

  for (const record of matches) {
    await dnsService.deleteRecord(credential.ctx, resolved.zone.id, record.id);
  }

  await logWrite(actor, 'DELETE', {
    domain: resolved.zone.name,
    recordName: normalizeRecordName(query.name, resolved.zone.name),
    recordType: String(query.type).toUpperCase(),
    oldValue: matches.map((record) => mapRecord(record, resolved.zone.name)),
    newValue: { deleted: matches.length, all: !!query.all },
  });

  return { deleted: matches.length };
}

export async function upsertRecord(
  actor: ApiActor,
  domain: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  body: RecordInput & { match?: { value?: string; line?: string } }
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const caps = dnsService.getCapabilities(credential.ctx);
  const input = validateRecordInput(
    { ...body, name: normalizeRecordName(body.name, resolved.zone.name) },
    caps,
    { minTtl: body.ttl !== undefined ? await minTtlOf(credential, resolved.zone.id) : undefined }
  );

  const matches = await findRecords(credential.ctx, resolved.zone.name, {
    name: input.name,
    type: input.type,
    value: body.match?.value,
    line: body.match?.line ?? body.line,
  });

  if (matches.length > 1) {
    throw new ApiError('AMBIGUOUS_RECORD', `匹配到 ${matches.length} 条记录，请用 match.value 消歧`, 409, {
      candidates: matches.slice(0, 20).map((record) => ({
        id: record.id,
        name: record.name,
        type: record.type,
        value: record.value,
        line: record.line,
      })),
    });
  }

  if (matches.length === 0) {
    const created = await createRecord(actor, resolved.zone.name, credential.id, boundCredentialId, input);
    return { action: 'created', record: created.record };
  }

  const existing = matches[0];
  const changed =
    normalizeValue(existing.value) !== normalizeValue(input.value) ||
    (input.ttl !== undefined && existing.ttl !== input.ttl) ||
    (input.line !== undefined && existing.line !== input.line) ||
    (input.weight !== undefined && existing.weight !== input.weight) ||
    (input.priority !== undefined && existing.priority !== input.priority) ||
    (input.remark !== undefined && existing.remark !== input.remark) ||
    (input.proxied !== undefined && existing.proxied !== input.proxied) ||
    (input.options !== undefined && JSON.stringify(input.options) !== '{}') ||
    normalizeRecordName(existing.name, resolved.zone.name) !== input.name;

  if (!changed) {
    return { action: 'unchanged', record: mapRecord(existing, resolved.zone.name) };
  }

  const updated = await updateRecord(
    actor,
    resolved.zone.name,
    existing.id,
    credential.id,
    boundCredentialId,
    { ...input, name: input.name },
    'patch'
  );
  return { action: 'updated', record: updated.record };
}

export async function setRecordStatus(
  actor: ApiActor,
  domain: string,
  recordId: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  enabled: boolean
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const caps = dnsService.getCapabilities(credential.ctx);
  if (!caps.supportsStatus) {
    throw new ApiError('INVALID_ARGUMENT', `${caps.name} 不支持启用/禁用记录`, 400);
  }

  await dnsService.setRecordStatus(credential.ctx, resolved.zone.id, recordId, enabled);
  const record = await dnsService.getRecord(credential.ctx, resolved.zone.id, recordId).catch(() => null);

  await logWrite(actor, 'UPDATE', {
    domain: resolved.zone.name,
    recordName: record ? normalizeRecordName(record.name, resolved.zone.name) : undefined,
    recordType: record?.type,
    newValue: { id: recordId, enabled },
  });

  return { record: record ? mapRecord(record, resolved.zone.name) : { id: recordId, status: enabled ? '1' : '0' } };
}

export async function listLines(
  actor: ApiActor,
  domain: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const result = await dnsService.getLines(credential.ctx, resolved.zone.id);
  return { lines: result.lines };
}

export async function getCapabilitiesForDomain(
  actor: ApiActor,
  domain: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null
) {
  const credential = await openContext(actor, credentialId, boundCredentialId);
  const resolved = await resolveZone(credential.ctx, domain, `cred-${credential.id}`);
  assertDomainAllowedForActor(actor, resolved.zone.name);

  const caps = dnsService.getCapabilities(credential.ctx);
  return {
    domain: resolved.zone.name,
    ...capabilitySummary(caps),
    minTtl: await minTtlOf(credential, resolved.zone.id),
  };
}

export interface BatchOperation {
  op: 'create' | 'update' | 'delete' | 'upsert';
  id?: string;
  name?: string;
  type?: string;
  value?: string;
  ttl?: number;
  line?: string;
  weight?: number;
  priority?: number;
  remark?: string;
  proxied?: boolean;
  options?: Record<string, unknown>;
  match?: { value?: string; line?: string };
}

export async function runBatch(
  actor: ApiActor,
  domain: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  operations: BatchOperation[]
) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new ApiError('INVALID_ARGUMENT', 'operations 不能为空', 400);
  }
  if (operations.length > 100) {
    throw new ApiError('INVALID_ARGUMENT', '单次批量最多 100 条操作', 400, { max: 100 });
  }

  const results: Array<Record<string, unknown>> = [];
  let succeeded = 0;
  let failed = 0;

  // 同一 zone 内串行：多数厂商对同域名并发写有风控
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    try {
      const result = await runBatchItem(actor, domain, credentialId, boundCredentialId, operation);
      results.push({ index, ok: true, ...result });
      succeeded += 1;
    } catch (error: any) {
      results.push({
        index,
        ok: false,
        action: operation.op,
        error: {
          code: error instanceof ApiError ? error.code : 'PROVIDER_REJECTED',
          message: error?.message || '操作失败',
          ...(error instanceof ApiError && error.details ? { details: error.details } : {}),
        },
      });
      failed += 1;
    }
  }

  return { results, summary: { total: operations.length, succeeded, failed } };
}

async function runBatchItem(
  actor: ApiActor,
  domain: string,
  credentialId: number | string | null | undefined,
  boundCredentialId: number | null,
  operation: BatchOperation
) {
  switch (operation.op) {
    case 'create': {
      const created = await createRecord(actor, domain, credentialId, boundCredentialId, operation as RecordInput);
      return { action: 'created', record: created.record };
    }
    case 'update': {
      if (!operation.id) throw new ApiError('INVALID_ARGUMENT', 'update 操作需要 id', 400);
      const updated = await updateRecord(actor, domain, operation.id, credentialId, boundCredentialId, operation, 'patch');
      return { action: 'updated', record: updated.record };
    }
    case 'upsert': {
      const result = await upsertRecord(actor, domain, credentialId, boundCredentialId, operation as any);
      return { action: result.action, record: result.record };
    }
    case 'delete': {
      if (operation.id) {
        const result = await deleteRecordById(actor, domain, operation.id, credentialId, boundCredentialId);
        return { action: 'deleted', deleted: result.deleted };
      }
      const result = await deleteRecordsByMatch(actor, domain, credentialId, boundCredentialId, {
        name: operation.name,
        type: operation.type,
        value: operation.value,
        line: operation.line,
      });
      return { action: 'deleted', deleted: result.deleted };
    }
    default:
      throw new ApiError('INVALID_ARGUMENT', `未知操作: ${(operation as any).op}`, 400);
  }
}

export { normalizeDomain, normalizeRecordName };
