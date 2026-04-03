import { requestJson } from './httpClient';
import { buildUcloudPayload, type UcloudAuth } from '../../providers/ucloud/auth';

const UCLOUD_API_URL = 'https://api.ucloud.cn/';

interface UcloudResponseBase {
  RetCode?: number;
  Action?: string;
  Message?: string;
}

export class UcloudApiService {
  static async call<T extends Record<string, any> = Record<string, any>>(
    auth: UcloudAuth,
    action: string,
    params: Record<string, any> = {},
    timeoutMs = 12000,
  ): Promise<T> {
    const payload = buildUcloudPayload(auth, action, params);
    const response = await requestJson<UcloudResponseBase & T>({
      url: UCLOUD_API_URL,
      method: 'POST',
      timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'dns-panel/1.0 (ucloud-api)',
      },
      body: JSON.stringify(payload),
    });

    const data = (response.data || {}) as UcloudResponseBase & T;
    if (typeof data.RetCode === 'number' && data.RetCode !== 0) {
      const error: any = new Error(String(data.Message || `UCloud API 调用失败: ${action}`));
      error.code = data.RetCode;
      throw error;
    }

    return data as T;
  }

}
