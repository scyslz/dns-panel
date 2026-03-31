import { BaseProvider, DnsProviderError } from '../base/BaseProvider';
import {
  CreateRecordParams,
  DnsLine,
  DnsRecord,
  LineListResult,
  ProviderCapabilities,
  ProviderCredentials,
  ProviderType,
  RecordListResult,
  RecordQueryParams,
  UpdateRecordParams,
  Zone,
  ZoneListResult,
} from '../base/types';
import { buildUcloudPayload } from './auth';
import { requestJson } from '../../services/cert/httpClient';

interface UcloudResponseBase {
  RetCode?: number;
  Action?: string;
  Message?: string;
}

interface UcloudZoneInfo {
  DNSZoneId?: string;
  DNSZoneName?: string;
  Remark?: string;
  CreateTime?: number;
  ExpireTime?: number;
  Tag?: string;
}

interface UcloudRecordValue {
  Data?: string;
  Weight?: number;
  IsEnabled?: number;
}

interface UcloudRecordInfo {
  RecordId?: string;
  DNSRecordId?: string;
  Name?: string;
  Type?: string;
  ValueSet?: UcloudRecordValue[];
  ValueType?: string;
  TTL?: number;
  Remark?: string;
}

const UCLOUD_API_URL = 'https://api.ucloud.cn/';

export const UCLOUD_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.UCLOUD,
  name: 'UCloud DNS',
  supportsWeight: true,
  supportsLine: false,
  supportsStatus: true,
  supportsRemark: true,
  supportsUrlForward: false,
  supportsLogs: true,
  remarkMode: 'inline',
  paging: 'server',
  requiresDomainId: false,
  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'PTR'],
  authFields: [
    { name: 'publicKey', label: 'Public Key', type: 'text', required: true, placeholder: '输入 UCloud Public Key' },
    { name: 'privateKey', label: 'Private Key', type: 'password', required: true, placeholder: '输入 UCloud Private Key' },
    { name: 'region', label: 'Region', type: 'text', required: true, placeholder: '如 cn-bj2 / cn-sh2' },
    { name: 'projectId', label: 'Project ID', type: 'text', required: false, placeholder: '默认项目可留空' },
  ],
  domainCacheTtl: 180,
  recordCacheTtl: 60,
  retryableErrors: ['429', '500', '503'],
  maxRetries: 3,
};

export class UcloudProvider extends BaseProvider {
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly region: string;
  private readonly projectId?: string;

  constructor(credentials: ProviderCredentials) {
    super(credentials, UCLOUD_CAPABILITIES);
    const publicKey = String(credentials.secrets?.publicKey || '').trim();
    const privateKey = String(credentials.secrets?.privateKey || '').trim();
    const region = String(credentials.secrets?.region || '').trim();
    const projectId = String(credentials.secrets?.projectId || '').trim();

    if (!publicKey || !privateKey || !region) {
      throw this.createError('MISSING_CREDENTIALS', '缺少 UCloud PublicKey/PrivateKey/Region');
    }

    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.region = region;
    this.projectId = projectId || undefined;
  }

  private async request<T extends Record<string, any> = Record<string, any>>(action: string, params: Record<string, any> = {}) {
    const payload = buildUcloudPayload(
      { publicKey: this.publicKey, privateKey: this.privateKey },
      action,
      {
        Region: params.Region ?? this.region,
        ProjectId: params.ProjectId ?? this.projectId,
        ...params,
      },
    );

    const response = await this.withRetry(async () => {
      const result = await requestJson<UcloudResponseBase & T>({
        url: UCLOUD_API_URL,
        method: 'POST',
        timeoutMs: 12000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'dns-panel/1.0 (ucloud-provider)',
        },
        body: JSON.stringify(payload),
      });
      return result;
    });

    const data = (response.data || {}) as UcloudResponseBase & T;
    if (typeof data.RetCode === 'number' && data.RetCode !== 0) {
      throw this.createError(String(data.RetCode), String(data.Message || `UCloud API 调用失败: ${action}`), {
        httpStatus: response.status,
        meta: { action },
      });
    }

    return data as T;
  }

  private mapZone(item: UcloudZoneInfo): Zone {
    return this.normalizeZone({
      id: String(item.DNSZoneId || ''),
      name: String(item.DNSZoneName || '').trim().toLowerCase(),
      status: 'active',
      updatedAt: item.CreateTime ? new Date(item.CreateTime * 1000).toISOString() : undefined,
      meta: {
        remark: item.Remark || '',
        tag: item.Tag || '',
        raw: item,
      },
    });
  }

  private mapRecord(zoneId: string, zoneName: string, item: UcloudRecordInfo): DnsRecord {
    const values = Array.isArray(item.ValueSet) ? item.ValueSet : [];
    const primary = values[0] || {};
    return this.normalizeRecord({
      id: String(item.RecordId || item.DNSRecordId || ''),
      zoneId,
      zoneName,
      name: String(item.Name || '@'),
      type: String(item.Type || ''),
      value: String(primary.Data || ''),
      ttl: Number(item.TTL || 600),
      weight: typeof primary.Weight === 'number' ? primary.Weight : undefined,
      status: Number(primary.IsEnabled) === 0 ? '0' : '1',
      remark: item.Remark || undefined,
      meta: {
        valueType: item.ValueType || 'Normal',
        valueSet: values,
        raw: item,
      },
    });
  }

  private async getZoneByIdOrName(zoneIdOrName: string) {
    const trimmed = String(zoneIdOrName || '').trim();
    if (!trimmed) throw this.createError('INVALID_ZONE', '缺少域名标识');

    const direct = await this.request<{ DNSZoneInfos?: UcloudZoneInfo[] }>('DescribeUDNSZone', {
      ...(trimmed.includes('.') ? {} : { 'DNSZoneIds.0': trimmed }),
      Limit: 100,
      Offset: 0,
    });
    const zones = Array.isArray(direct.DNSZoneInfos) ? direct.DNSZoneInfos.map((item) => this.mapZone(item)) : [];
    const matched = zones.find((item) => item.id === trimmed || item.name === trimmed.toLowerCase());
    if (matched) return matched;

    let offset = 0;
    while (offset <= 1000) {
      const listed = await this.request<{ DNSZoneInfos?: UcloudZoneInfo[]; TotalCount?: number }>('DescribeUDNSZone', {
        Limit: 100,
        Offset: offset,
      });
      const items = Array.isArray(listed.DNSZoneInfos) ? listed.DNSZoneInfos.map((item) => this.mapZone(item)) : [];
      const found = items.find((item) => item.id === trimmed || item.name === trimmed.toLowerCase());
      if (found) return found;
      if (!items.length || items.length < 100) break;
      offset += 100;
    }

    throw this.createError('ZONE_NOT_FOUND', '域名不存在');
  }

  private async getRecordInternal(zoneIdOrName: string, recordId: string) {
    const zone = await this.getZoneByIdOrName(zoneIdOrName);
    const response = await this.request<{ RecordInfos?: UcloudRecordInfo[] }>('DescribeUDNSRecord', {
      DNSZoneId: zone.id,
      'RecordIds.0': recordId,
      Limit: 1,
      Offset: 0,
    });
    const item = Array.isArray(response.RecordInfos) ? response.RecordInfos[0] : null;
    if (!item) throw this.createError('RECORD_NOT_FOUND', '记录不存在');
    return this.mapRecord(zone.id, zone.name, item);
  }

  private encodeValue(params: CreateRecordParams | UpdateRecordParams, current?: DnsRecord) {
    const value = String(params.value ?? current?.value ?? '').trim();
    if (!value) throw this.createError('INVALID_VALUE', '记录值不能为空');
    const weight = Number(params.weight ?? current?.weight ?? 1) || 1;
    const enabled = params.type || current ? (params as any).status ?? current?.status ?? '1' : '1';
    return `${value}|${Math.max(1, Math.min(10, weight))}|${enabled === '0' ? 0 : 1}`;
  }

  async checkAuth(): Promise<boolean> {
    await this.request('DescribeUDNSZone', { Limit: 1, Offset: 0 });
    return true;
  }

  async getZones(page = 1, pageSize = 20, keyword?: string): Promise<ZoneListResult> {
    const response = await this.request<{ DNSZoneInfos?: UcloudZoneInfo[]; TotalCount?: number }>('DescribeUDNSZone', {
      Limit: Math.max(1, pageSize),
      Offset: Math.max(0, (page - 1) * pageSize),
    });
    const zones = Array.isArray(response.DNSZoneInfos) ? response.DNSZoneInfos.map((item) => this.mapZone(item)) : [];
    const filtered = keyword ? zones.filter((item) => item.name.includes(String(keyword).trim().toLowerCase())) : zones;
    return { total: Number(response.TotalCount || filtered.length), zones: filtered };
  }

  async getZone(zoneId: string): Promise<Zone> {
    return await this.getZoneByIdOrName(zoneId);
  }

  async getRecords(zoneId: string, params: RecordQueryParams = {}): Promise<RecordListResult> {
    const zone = await this.getZoneByIdOrName(zoneId);
    const response = await this.request<{ RecordInfos?: UcloudRecordInfo[]; TotalCount?: number }>('DescribeUDNSRecord', {
      DNSZoneId: zone.id,
      Limit: Math.max(1, params.pageSize || 20),
      Offset: Math.max(0, ((params.page || 1) - 1) * (params.pageSize || 20)),
      Query: params.keyword || params.subDomain || params.value || undefined,
      SortKey: 'update_time',
      SortDir: 'desc',
    });

    let records = Array.isArray(response.RecordInfos) ? response.RecordInfos.map((item) => this.mapRecord(zone.id, zone.name, item)) : [];
    if (params.type) records = records.filter((item) => item.type === params.type);
    if (params.subDomain) records = records.filter((item) => item.name === params.subDomain);
    if (params.value) records = records.filter((item) => item.value.includes(String(params.value)));
    if (params.status) records = records.filter((item) => item.status === params.status);
    return { total: Number(response.TotalCount || records.length), records };
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    return await this.getRecordInternal(zoneId, recordId);
  }

  async createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord> {
    const zone = await this.getZoneByIdOrName(zoneId);
    const response = await this.request<{ RecordId?: string; DNSRecordId?: string }>('CreateUDNSRecord', {
      DNSZoneId: zone.id,
      Name: params.name || '@',
      Type: params.type,
      Value: this.encodeValue(params),
      ValueType: 'Normal',
      TTL: Math.max(5, Math.min(600, Number(params.ttl || 600))),
      Remark: params.remark || undefined,
    });
    return await this.getRecordInternal(zone.id, String(response.RecordId || response.DNSRecordId || ''));
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    const zone = await this.getZoneByIdOrName(zoneId);
    const current = await this.getRecordInternal(zone.id, recordId);
    await this.request('ModifyUDNSRecord', {
      DNSZoneId: zone.id,
      RecordId: recordId,
      Type: params.type || current.type,
      Value: this.encodeValue(params, current),
      ValueType: 'Normal',
      TTL: Math.max(5, Math.min(600, Number(params.ttl || current.ttl || 600))),
      Remark: params.remark ?? current.remark ?? undefined,
    });
    return await this.getRecordInternal(zone.id, recordId);
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    const zone = await this.getZoneByIdOrName(zoneId);
    await this.request('DeleteUDNSRecord', {
      DNSZoneId: zone.id,
      'RecordIds.0': recordId,
    });
    return true;
  }

  async setRecordStatus(zoneId: string, recordId: string, enabled: boolean): Promise<boolean> {
    const current = await this.getRecordInternal(zoneId, recordId);
    await this.request('ModifyUDNSRecord', {
      DNSZoneId: current.zoneId,
      RecordId: recordId,
      Type: current.type,
      Value: `${current.value}|${Math.max(1, Math.min(10, Number(current.weight || 1)))}|${enabled ? 1 : 0}`,
      ValueType: String((current.meta as any)?.valueType || 'Normal'),
      TTL: current.ttl,
      Remark: current.remark || undefined,
    });
    return true;
  }

  async getLines(_zoneId?: string): Promise<LineListResult> {
    const lines: DnsLine[] = [{ code: 'default', name: '默认' }];
    return { lines };
  }

  async getMinTTL(): Promise<number> {
    return 5;
  }
}
