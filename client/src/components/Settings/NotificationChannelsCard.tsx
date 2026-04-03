import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  CampaignOutlined as NotificationIcon,
  Save as SaveIcon,
  Send as SendIcon,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import SettingsSection from '@/components/Settings/SettingsSection';
import {
  getCertificateSettings,
  testCertificateSettingsChannel,
  updateCertificateSettings,
} from '@/services/certificates';
import { getCurrentUser, updateDomainExpirySettings } from '@/services/auth';
import { User } from '@/types';
import {
  CertificateNotificationChannelKey,
  CertificateNotificationPolicy,
  CertificateSettingsData,
} from '@/types/cert';

interface SmtpFormState {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  pass: string;
  passConfigured: boolean;
  from: string;
}

const POLICY_OPTIONS: Array<{ value: CertificateNotificationPolicy; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'fail_only', label: '仅失败' },
  { value: 'all', label: '全部' },
];

const CHANNEL_OPTIONS: Array<{ value: CertificateNotificationChannelKey; label: string }> = [
  { value: 'email', label: '邮件' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'feishu', label: '飞书' },
  { value: 'wecom', label: '企业微信' },
  { value: 'wechatTemplate', label: '微信公众号模板消息' },
];

const TWO_COLUMN_GRID_SX = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
} as const;

function createDefaultSettings(): CertificateSettingsData {
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
        email: { enabled: false, to: '' },
        webhook: { enabled: false, url: '', headers: {} },
        telegram: { enabled: false, chatId: '', baseUrl: '', hasBotToken: false },
        dingtalk: { enabled: false, webhookUrl: '', atMobiles: [], atAll: false, hasSecret: false },
        feishu: { enabled: false, webhookUrl: '', atUserIds: [], atAll: false },
        wecom: { enabled: false, webhookUrl: '' },
        wechatTemplate: { enabled: false, uid: '', hasAppToken: false },
      },
    },
  };
}

function createDefaultSmtpState(): SmtpFormState {
  return {
    host: '',
    port: '587',
    secure: false,
    user: '',
    pass: '',
    passConfigured: false,
    from: '',
  };
}

function normalizeError(error: any, fallback: string) {
  return typeof error === 'string' ? error : error?.message || fallback;
}

function ChannelPanel({
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  description?: string;
  enabled: boolean;
  onToggle: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Stack spacing={1.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        spacing={1.5}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
      >
        <Box>
          <Typography variant="subtitle2" fontWeight={600}>
            {title}
          </Typography>
          {description ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
          ) : null}
        </Box>
        <Switch checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
      </Stack>
      {children}
    </Stack>
  );
}

export default function NotificationChannelsCard() {
  const [settings, setSettings] = useState<CertificateSettingsData>(createDefaultSettings());
  const [smtp, setSmtp] = useState<SmtpFormState>(createDefaultSmtpState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [testChannel, setTestChannel] = useState<CertificateNotificationChannelKey>('email');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [dingtalkSecret, setDingtalkSecret] = useState('');
  const [wechatAppToken, setWechatAppToken] = useState('');

  const syncSmtpFromUser = useCallback((user?: User | null) => {
    setSmtp({
      host: typeof user?.smtpHost === 'string' ? user.smtpHost : '',
      port: typeof user?.smtpPort === 'number' && Number.isFinite(user.smtpPort) ? String(user.smtpPort) : '587',
      secure: typeof user?.smtpSecure === 'boolean' ? user.smtpSecure : false,
      user: typeof user?.smtpUser === 'string' ? user.smtpUser : '',
      pass: '',
      passConfigured: !!user?.smtpPassConfigured,
      from: typeof user?.smtpFrom === 'string' ? user.smtpFrom : '',
    });
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [certificateResponse, userResponse] = await Promise.all([
        getCertificateSettings(),
        getCurrentUser(),
      ]);

      setSettings(certificateResponse.data?.settings || createDefaultSettings());
      const user = userResponse.data?.user;
      if (user) {
        localStorage.setItem('user', JSON.stringify(user));
      }
      syncSmtpFromUser(user || null);
      setTelegramBotToken('');
      setDingtalkSecret('');
      setWechatAppToken('');
    } catch (err: any) {
      setError(normalizeError(err, '加载通知设置失败'));
    } finally {
      setLoading(false);
    }
  }, [syncSmtpFromUser]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const enabledChannels = useMemo(
    () => CHANNEL_OPTIONS.filter((item) => (settings.notifications.channels as any)?.[item.value]?.enabled),
    [settings]
  );

  const updateSettings = (updater: (prev: CertificateSettingsData) => CertificateSettingsData) => {
    setSettings((prev) => updater(prev));
  };

  const updateChannel = (key: CertificateNotificationChannelKey, patch: Record<string, any>) => {
    updateSettings((prev) => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        channels: {
          ...prev.notifications.channels,
          [key]: {
            ...((prev.notifications.channels as any)?.[key] || {}),
            ...patch,
          },
        },
      },
    }));
  };

  const handleSave = async () => {
    const smtpHostTrim = smtp.host.trim();
    const hasCustomSmtp = !!smtpHostTrim;
    const smtpUserTrim = smtp.user.trim();
    const smtpPassTrim = smtp.pass.trim();
    const smtpFromTrim = smtp.from.trim();

    let smtpPortValue: number | null = null;
    if (hasCustomSmtp && smtp.port.trim()) {
      const parsedPort = parseInt(smtp.port.trim(), 10);
      if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        setError('SMTP 端口无效，应为 1-65535 的整数');
        return;
      }
      smtpPortValue = parsedPort;
    }

    if (hasCustomSmtp && !smtpFromTrim) {
      setError('使用自定义 SMTP 时需填写 From');
      return;
    }

    if (hasCustomSmtp) {
      if (!smtpUserTrim && smtpPassTrim) {
        setError('填写 SMTP 密码时需同时填写 SMTP 用户名');
        return;
      }
      if (smtpUserTrim && !smtpPassTrim && !smtp.passConfigured) {
        setError('请填写 SMTP 密码');
        return;
      }
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const nextSettings: CertificateSettingsData = JSON.parse(JSON.stringify(settings));
      if (telegramBotToken.trim()) {
        nextSettings.notifications.channels.telegram = {
          ...nextSettings.notifications.channels.telegram,
          botToken: telegramBotToken.trim(),
        };
      }
      if (dingtalkSecret.trim()) {
        nextSettings.notifications.channels.dingtalk = {
          ...nextSettings.notifications.channels.dingtalk,
          secret: dingtalkSecret.trim(),
        };
      }
      if (wechatAppToken.trim()) {
        nextSettings.notifications.channels.wechatTemplate = {
          ...nextSettings.notifications.channels.wechatTemplate,
          appToken: wechatAppToken.trim(),
        };
      }

      const smtpPayload: any = {
        smtpHost: hasCustomSmtp ? smtpHostTrim : null,
        smtpPort: hasCustomSmtp ? smtpPortValue : null,
        smtpSecure: hasCustomSmtp ? smtp.secure : null,
        smtpUser: hasCustomSmtp ? (smtpUserTrim ? smtpUserTrim : null) : null,
        smtpFrom: hasCustomSmtp ? (smtpFromTrim ? smtpFromTrim : null) : null,
      };

      if (!hasCustomSmtp) {
        smtpPayload.smtpPass = null;
      } else if (smtpPassTrim) {
        smtpPayload.smtpPass = smtpPassTrim;
      }

      const userResponse = await updateDomainExpirySettings(smtpPayload);
      const user = userResponse.data?.user;
      if (user) {
        localStorage.setItem('user', JSON.stringify(user));
      }
      syncSmtpFromUser(user || null);

      const settingsResponse = await updateCertificateSettings(nextSettings);
      setSettings(settingsResponse.data?.settings || nextSettings);
      setTelegramBotToken('');
      setDingtalkSecret('');
      setWechatAppToken('');
      setSuccess('通知设置已保存');
    } catch (err: any) {
      setError(normalizeError(err, '保存通知设置失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      setError(null);
      setSuccess(null);
      const response = await testCertificateSettingsChannel(testChannel);
      const results = response.data?.results || [];
      const failed = results.filter((item) => !item.success);
      if (failed.length > 0) {
        setError(failed.map((item) => `${item.channel}: ${item.error || '发送失败'}`).join('；'));
        return;
      }
      setSuccess(results.length > 0 ? '测试通知已发送' : '当前没有可测试的渠道');
    } catch (err: any) {
      setError(normalizeError(err, '测试通知失败'));
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Card sx={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
        <CardHeader
          avatar={<NotificationIcon color="primary" />}
          title={<Typography variant="h6" fontWeight="bold">通知设置</Typography>}
          subheader="SMTP、域名/证书通知策略与渠道测试"
        />
        <Divider />
        <CardContent>
          <Stack alignItems="center" py={4}>
            <CircularProgress size={24} />
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
      <CardHeader
        avatar={<NotificationIcon color="primary" />}
        title={<Typography variant="h6" fontWeight="bold">通知设置</Typography>}
        subheader="SMTP、域名/证书通知策略与渠道测试"
      />
      <Divider />
      <CardContent>
        <Stack spacing={2.5}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {success ? (
            <Alert severity="success" onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          ) : null}

          <Stack spacing={3} divider={<Divider flexItem />}>
            <SettingsSection
              title="SMTP 设置"
              description="所有邮件通知统一复用这里的发信配置；留空时回退服务端环境变量 SMTP_*。"
            >
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label="SMTP 主机"
                  value={smtp.host}
                  onChange={(event) => setSmtp((prev) => ({ ...prev, host: event.target.value }))}
                  placeholder="smtp.example.com"
                />

                <Box
                  sx={{
                    display: 'grid',
                    gap: 2,
                    gridTemplateColumns: { xs: '1fr', sm: '240px 1fr' },
                    alignItems: { sm: 'center' },
                  }}
                >
                  <TextField
                    fullWidth
                    label="端口"
                    type="number"
                    value={smtp.port}
                    onChange={(event) => setSmtp((prev) => ({ ...prev, port: event.target.value }))}
                    disabled={!smtp.host.trim()}
                    placeholder="587"
                    InputProps={{ inputProps: { min: 1, max: 65535 } }}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={smtp.secure}
                        onChange={(event) => setSmtp((prev) => ({ ...prev, secure: event.target.checked }))}
                        disabled={!smtp.host.trim()}
                      />
                    }
                    label="使用 SMTPS"
                    sx={{ m: 0 }}
                  />
                </Box>

                <Box sx={TWO_COLUMN_GRID_SX}>
                  <TextField
                    fullWidth
                    label="SMTP 用户名（可选）"
                    value={smtp.user}
                    onChange={(event) => setSmtp((prev) => ({ ...prev, user: event.target.value }))}
                    disabled={!smtp.host.trim()}
                    placeholder="user@example.com"
                    helperText="如不需要认证，用户名/密码都留空"
                  />
                  <TextField
                    fullWidth
                    label="SMTP 密码（可选）"
                    type={showSmtpPassword ? 'text' : 'password'}
                    value={smtp.pass}
                    onChange={(event) => setSmtp((prev) => ({ ...prev, pass: event.target.value }))}
                    disabled={!smtp.host.trim()}
                    placeholder={smtp.passConfigured ? '已设置（留空不修改）' : '留空表示不使用认证'}
                    helperText={smtp.passConfigured ? '已设置（留空不修改）' : undefined}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton onClick={() => setShowSmtpPassword((prev) => !prev)} edge="end">
                            {showSmtpPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />
                </Box>

                <TextField
                  fullWidth
                  label="From（发件人）"
                  value={smtp.from}
                  onChange={(event) => setSmtp((prev) => ({ ...prev, from: event.target.value }))}
                  disabled={!smtp.host.trim()}
                  placeholder="DNS Panel <no-reply@example.com>"
                />
              </Stack>
            </SettingsSection>

            <SettingsSection
              title="通知策略"
              description="控制证书签发、部署和续期提醒的发送范围；域名到期会自动复用下方已启用的通知方式。"
            >
              <Box sx={TWO_COLUMN_GRID_SX}>
                <TextField
                  select
                  fullWidth
                  label="ACME 签发/续期"
                  value={settings.notifications.certificate}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      notifications: {
                        ...prev.notifications,
                        certificate: event.target.value as CertificateNotificationPolicy,
                      },
                    }))
                  }
                >
                  {POLICY_OPTIONS.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  fullWidth
                  label="部署通知"
                  value={settings.notifications.deployment}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      notifications: {
                        ...prev.notifications,
                        deployment: event.target.value as CertificateNotificationPolicy,
                      },
                    }))
                  }
                >
                  {POLICY_OPTIONS.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  fullWidth
                  label="厂商证书通知"
                  value={settings.notifications.vendor}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      notifications: {
                        ...prev.notifications,
                        vendor: event.target.value as CertificateNotificationPolicy,
                      },
                    }))
                  }
                >
                  {POLICY_OPTIONS.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  fullWidth
                  label="手动续期到期提醒"
                  value={settings.notifications.manualRenewExpiry}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      notifications: {
                        ...prev.notifications,
                        manualRenewExpiry: event.target.value as CertificateNotificationPolicy,
                      },
                    }))
                  }
                >
                  {POLICY_OPTIONS.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            </SettingsSection>

            <SettingsSection
              title="通知设置"
              description="按渠道分别维护接收地址、Webhook 或机器人参数。"
            >
              <Stack spacing={2.5} divider={<Divider flexItem />}>
                <ChannelPanel
                  title="邮件"
                  description="默认回退到当前登录邮箱。"
                  enabled={!!settings.notifications.channels.email?.enabled}
                  onToggle={(checked) => updateChannel('email', { enabled: checked })}
                >
                  <TextField
                    fullWidth
                    label="邮件接收地址"
                    value={settings.notifications.channels.email?.to || ''}
                    onChange={(event) => updateChannel('email', { to: event.target.value })}
                  />
                </ChannelPanel>

                <ChannelPanel
                  title="Webhook"
                  enabled={!!settings.notifications.channels.webhook?.enabled}
                  onToggle={(checked) => updateChannel('webhook', { enabled: checked })}
                >
                  <TextField
                    fullWidth
                    label="Webhook URL"
                    value={settings.notifications.channels.webhook?.url || ''}
                    onChange={(event) => updateChannel('webhook', { url: event.target.value })}
                    placeholder="https://example.com/webhook"
                  />
                </ChannelPanel>

                <ChannelPanel
                  title="Telegram"
                  enabled={!!settings.notifications.channels.telegram?.enabled}
                  onToggle={(checked) => updateChannel('telegram', { enabled: checked })}
                >
                  <Stack spacing={1.5}>
                    <TextField
                      fullWidth
                      label="Telegram Chat ID"
                      value={settings.notifications.channels.telegram?.chatId || ''}
                      onChange={(event) => updateChannel('telegram', { chatId: event.target.value })}
                      helperText={settings.notifications.channels.telegram?.hasBotToken ? 'Bot Token 已保存；留空不改。' : '需同时填写 Bot Token。'}
                    />
                    <TextField
                      fullWidth
                      label="Telegram Bot Token（留空不改）"
                      value={telegramBotToken}
                      onChange={(event) => setTelegramBotToken(event.target.value)}
                    />
                  </Stack>
                </ChannelPanel>

                <ChannelPanel
                  title="钉钉"
                  enabled={!!settings.notifications.channels.dingtalk?.enabled}
                  onToggle={(checked) => updateChannel('dingtalk', { enabled: checked })}
                >
                  <Stack spacing={1.5}>
                    <TextField
                      fullWidth
                      label="钉钉 Webhook"
                      value={settings.notifications.channels.dingtalk?.webhookUrl || ''}
                      onChange={(event) => updateChannel('dingtalk', { webhookUrl: event.target.value })}
                    />
                    <TextField
                      fullWidth
                      label="钉钉 Secret（留空不改）"
                      value={dingtalkSecret}
                      onChange={(event) => setDingtalkSecret(event.target.value)}
                      helperText={settings.notifications.channels.dingtalk?.hasSecret ? 'Secret 已保存。' : undefined}
                    />
                  </Stack>
                </ChannelPanel>

                <ChannelPanel
                  title="飞书"
                  enabled={!!settings.notifications.channels.feishu?.enabled}
                  onToggle={(checked) => updateChannel('feishu', { enabled: checked })}
                >
                  <TextField
                    fullWidth
                    label="飞书 Webhook"
                    value={settings.notifications.channels.feishu?.webhookUrl || ''}
                    onChange={(event) => updateChannel('feishu', { webhookUrl: event.target.value })}
                  />
                </ChannelPanel>

                <ChannelPanel
                  title="企业微信"
                  enabled={!!settings.notifications.channels.wecom?.enabled}
                  onToggle={(checked) => updateChannel('wecom', { enabled: checked })}
                >
                  <TextField
                    fullWidth
                    label="企业微信 Webhook"
                    value={settings.notifications.channels.wecom?.webhookUrl || ''}
                    onChange={(event) => updateChannel('wecom', { webhookUrl: event.target.value })}
                  />
                </ChannelPanel>

                <ChannelPanel
                  title="微信公众号模板消息"
                  description="当前使用 WxPusher AppToken / UID。"
                  enabled={!!settings.notifications.channels.wechatTemplate?.enabled}
                  onToggle={(checked) => updateChannel('wechatTemplate', { enabled: checked })}
                >
                  <Stack spacing={1.5}>
                    <TextField
                      fullWidth
                      label="WxPusher UID"
                      value={settings.notifications.channels.wechatTemplate?.uid || ''}
                      onChange={(event) => updateChannel('wechatTemplate', { uid: event.target.value })}
                      helperText={settings.notifications.channels.wechatTemplate?.hasAppToken ? 'AppToken 已保存；留空不改。' : '需同时填写 AppToken。'}
                    />
                    <TextField
                      fullWidth
                      label="WxPusher AppToken（留空不改）"
                      value={wechatAppToken}
                      onChange={(event) => setWechatAppToken(event.target.value)}
                    />
                  </Stack>
                </ChannelPanel>
              </Stack>
            </SettingsSection>

            <SettingsSection
              title="渠道测试"
              description={`当前已启用 ${enabledChannels.length} 个渠道；测试基于当前已保存配置。`}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                justifyContent="space-between"
              >
                <TextField
                  select
                  size="small"
                  label="测试渠道"
                  value={testChannel}
                  onChange={(event) => setTestChannel(event.target.value as CertificateNotificationChannelKey)}
                  sx={{ minWidth: { xs: '100%', sm: 220 } }}
                >
                  {CHANNEL_OPTIONS.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button
                    variant="outlined"
                    startIcon={testing ? <CircularProgress size={16} /> : <SendIcon />}
                    onClick={handleTest}
                    disabled={testing}
                  >
                    发送测试
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                    onClick={handleSave}
                    disabled={saving}
                  >
                    保存通知设置
                  </Button>
                </Stack>
              </Stack>
            </SettingsSection>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
