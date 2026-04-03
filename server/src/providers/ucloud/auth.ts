import crypto from 'crypto';

export interface UcloudAuth {
  publicKey: string;
  privateKey: string;
  region?: string | null;
  projectId?: string | null;
}

export function signUcloudParams(params: Record<string, any>, privateKey: string): string {
  const entries = Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null);
  entries.sort(([left], [right]) => left.localeCompare(right));
  const payload = entries.map(([key, value]) => `${key}${String(value)}`).join('') + privateKey;
  return crypto.createHash('sha1').update(payload, 'utf8').digest('hex');
}

export function buildUcloudPayload(auth: UcloudAuth, action: string, params: Record<string, any> = {}) {
  const payload: Record<string, any> = {
    Action: action,
    PublicKey: auth.publicKey,
  };

  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    payload[key] = value;
  }

  payload.Signature = signUcloudParams(payload, auth.privateKey);
  return payload;
}
