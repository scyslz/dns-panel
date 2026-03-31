import path from 'node:path';
import { Readable } from 'node:stream';
import { Client as SshClient, type ConnectConfig } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import { Client as FtpClient } from 'basic-ftp';
import { buildPfxBuffer, quotePowerShellSingle } from './deployMatrixUtils';

export interface SshServerTransportConfig {
  host: string;
  port: number;
  username: string;
  authMode: 'password' | 'private_key';
  password?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
  timeoutMs: number;
  allowInsecureHostKey: boolean;
}

export interface FtpServerTransportConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
  timeoutMs: number;
  allowInsecureTls: boolean;
}

export interface RemoteWriteFile {
  remotePath: string;
  content: string | Buffer;
}

export interface ServerCertificatePayload {
  certificatePem: string;
  fullchainPem: string;
  privateKeyPem: string;
}

function toSshConnectConfig(config: SshServerTransportConfig): ConnectConfig {
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    readyTimeout: config.timeoutMs,
    keepaliveInterval: 5000,
    keepaliveCountMax: 2,
    ...(config.authMode === 'private_key'
      ? {
          privateKey: config.privateKey || '',
          ...(config.passphrase ? { passphrase: config.passphrase } : {}),
        }
      : {
          password: config.password || '',
        }),
    ...(config.allowInsecureHostKey
      ? {
          hostHash: 'sha256' as const,
          hostVerifier: () => true,
        }
      : {}),
  };
}

async function withSshClient<T>(config: SshServerTransportConfig, callback: (client: SshClient) => Promise<T>): Promise<T> {
  const client = new SshClient();
  await new Promise<void>((resolve, reject) => {
    client
      .on('ready', () => resolve())
      .on('error', reject)
      .connect(toSshConnectConfig(config));
  });
  try {
    return await callback(client);
  } finally {
    client.end();
  }
}

export async function testSshConnection(config: SshServerTransportConfig) {
  return await withSshClient(config, async (client) => {
    const output = await execSshCommand(client, 'echo dns-panel-ssh-ok');
    return { ok: true, output: output.stdout.trim() || output.stderr.trim() || 'connected' };
  });
}

export async function execSshCommand(client: SshClient, command: string): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('close', (code: number | null) => {
        if (code && code !== 0 && stderr.trim()) {
          reject(new Error(stderr.trim()));
          return;
        }
        resolve({ stdout, stderr });
      });
      stream.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      stream.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
    });
  });
}

export async function uploadFilesViaSsh(config: SshServerTransportConfig, files: RemoteWriteFile[]) {
  const sftp = new SftpClient();
  await sftp.connect(toSshConnectConfig(config) as any);
  try {
    for (const file of files) {
      const remotePath = String(file.remotePath || '').trim();
      if (!remotePath) throw new Error('远端路径不能为空');
      const directory = path.posix.dirname(remotePath.replace(/\\/g, '/'));
      if (directory && directory !== '.' && directory !== '/') {
        await sftp.mkdir(directory, true).catch(() => undefined);
      }
      await sftp.put(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8'), remotePath);
    }
  } finally {
    await sftp.end().catch(() => undefined);
  }
}

export async function deployPemViaSsh(config: SshServerTransportConfig, binding: {
  certificateFilePath: string;
  privateKeyFilePath: string;
  postCommand?: string | null;
}, payload: ServerCertificatePayload) {
  await uploadFilesViaSsh(config, [
    { remotePath: binding.certificateFilePath, content: payload.fullchainPem || payload.certificatePem },
    { remotePath: binding.privateKeyFilePath, content: payload.privateKeyPem },
  ]);

  const commands = String(binding.postCommand || '')
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (commands.length === 0) return;
  await withSshClient(config, async (client) => {
    for (const command of commands) {
      await execSshCommand(client, command);
    }
  });
}

export async function deployPfxViaSsh(config: SshServerTransportConfig, binding: {
  pfxFilePath: string;
  pfxPassword?: string | null;
  postCommand?: string | null;
}, payload: ServerCertificatePayload) {
  const pfx = buildPfxBuffer(payload.fullchainPem || payload.certificatePem, payload.privateKeyPem, binding.pfxPassword || '');
  await uploadFilesViaSsh(config, [{ remotePath: binding.pfxFilePath, content: pfx }]);
  const commands = String(binding.postCommand || '')
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
  if (commands.length === 0) return;
  await withSshClient(config, async (client) => {
    for (const command of commands) {
      await execSshCommand(client, command);
    }
  });
}

function toPowerShellEncodedCommand(script: string) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export async function deployIisViaSsh(config: SshServerTransportConfig, binding: {
  siteName: string;
  bindingHost?: string | null;
  port: number;
  pfxPath: string;
  pfxPassword?: string | null;
  certStore?: string | null;
}, payload: ServerCertificatePayload) {
  const pfx = buildPfxBuffer(payload.fullchainPem || payload.certificatePem, payload.privateKeyPem, binding.pfxPassword || '');
  await uploadFilesViaSsh(config, [{ remotePath: binding.pfxPath, content: pfx }]);

  const store = binding.certStore || 'My';
  const hostHeader = String(binding.bindingHost || '').trim();
  const secureStringExpr = binding.pfxPassword
    ? `$secure = ConvertTo-SecureString '${quotePowerShellSingle(binding.pfxPassword)}' -AsPlainText -Force`
    : "$secure = ConvertTo-SecureString '' -AsPlainText -Force";
  const bindingArgs = hostHeader
    ? `-HostHeader '${quotePowerShellSingle(hostHeader)}' -SslFlags 1`
    : '';
  const siteName = quotePowerShellSingle(binding.siteName);
  const pfxPath = quotePowerShellSingle(binding.pfxPath);
  const bindingHostExpr = hostHeader ? `'${quotePowerShellSingle(hostHeader)}'` : "''";
  const script = `
${secureStringExpr}
$cert = Import-PfxCertificate -FilePath '${pfxPath}' -CertStoreLocation 'Cert:\\LocalMachine\\${quotePowerShellSingle(store)}' -Password $secure
Import-Module WebAdministration
$existing = Get-WebBinding -Name '${siteName}' -Protocol https -Port ${binding.port} -HostHeader ${bindingHostExpr} -ErrorAction SilentlyContinue
if (-not $existing) {
  New-WebBinding -Name '${siteName}' -Protocol https -Port ${binding.port} ${bindingArgs}
  $existing = Get-WebBinding -Name '${siteName}' -Protocol https -Port ${binding.port} -HostHeader ${bindingHostExpr}
}
$existing.AddSslCertificate($cert.Thumbprint, '${quotePowerShellSingle(store)}')
Write-Output $cert.Thumbprint
`.trim();

  await withSshClient(config, async (client) => {
    await execSshCommand(client, `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${toPowerShellEncodedCommand(script)}`);
  });
}

export async function testFtpConnection(config: FtpServerTransportConfig) {
  const client = new FtpClient(config.timeoutMs);
  client.ftp.verbose = false;
  await client.access({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    secure: config.secure,
    secureOptions: config.allowInsecureTls ? { rejectUnauthorized: false } : undefined,
  });
  try {
    const currentDir = await client.pwd();
    return { ok: true, currentDir };
  } finally {
    client.close();
  }
}

async function uploadReadableToFtp(client: FtpClient, remotePath: string, content: Buffer | string) {
  const directory = path.posix.dirname(remotePath.replace(/\\/g, '/'));
  if (directory && directory !== '.' && directory !== '/') {
    await client.ensureDir(directory);
  }
  await client.uploadFrom(Readable.from(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')), remotePath);
}

export async function deployViaFtp(config: FtpServerTransportConfig, binding: {
  format: 'pem' | 'pfx';
  certificateFilePath?: string | null;
  privateKeyFilePath?: string | null;
  pfxFilePath?: string | null;
  pfxPassword?: string | null;
}, payload: ServerCertificatePayload) {
  const client = new FtpClient(config.timeoutMs);
  client.ftp.verbose = false;
  await client.access({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    secure: config.secure,
    secureOptions: config.allowInsecureTls ? { rejectUnauthorized: false } : undefined,
  });
  try {
    if (binding.format === 'pfx') {
      if (!binding.pfxFilePath) throw new Error('PFX 远端路径不能为空');
      const pfx = buildPfxBuffer(payload.fullchainPem || payload.certificatePem, payload.privateKeyPem, binding.pfxPassword || '');
      await uploadReadableToFtp(client, binding.pfxFilePath, pfx);
      return;
    }
    if (!binding.certificateFilePath || !binding.privateKeyFilePath) {
      throw new Error('PEM 远端路径不能为空');
    }
    await uploadReadableToFtp(client, binding.certificateFilePath, payload.fullchainPem || payload.certificatePem);
    await uploadReadableToFtp(client, binding.privateKeyFilePath, payload.privateKeyPem);
  } finally {
    client.close();
  }
}
