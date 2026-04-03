import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  Save as SaveIcon,
  WorkspacePremiumOutlined as CertificateIcon,
} from '@mui/icons-material';
import SettingsSection from '@/components/Settings/SettingsSection';
import { getCertificateSettings, updateCertificateSettings } from '@/services/certificates';
import { CertificateSettingsData } from '@/types/cert';

const TWO_COLUMN_GRID_SX = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
} as const;

const THREE_COLUMN_GRID_SX = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
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

export default function CertificateSettingsCard() {
  const [settings, setSettings] = useState<CertificateSettingsData>(createDefaultSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getCertificateSettings();
      setSettings(response.data?.settings || createDefaultSettings());
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err?.message || '加载证书设置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSettings = (updater: (prev: CertificateSettingsData) => CertificateSettingsData) => {
    setSettings((prev) => updater(prev));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const response = await updateCertificateSettings(settings);
      setSettings(response.data?.settings || settings);
      setSuccess('证书中心设置已保存');
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err?.message || '保存证书中心设置失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card sx={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
        <CardHeader
          avatar={<CertificateIcon color="primary" />}
          title={<Typography variant="h6" fontWeight="bold">证书中心设置</Typography>}
          subheader="默认证书联系人与自动化时间窗"
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
        avatar={<CertificateIcon color="primary" />}
        title={<Typography variant="h6" fontWeight="bold">证书中心设置</Typography>}
        subheader="默认证书联系人与自动化时间窗"
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
              title="证书申请默认联系人"
              description="用于证书申请默认信息，可在具体工单里单独覆盖。"
            >
              <Box sx={TWO_COLUMN_GRID_SX}>
                <TextField
                  fullWidth
                  label="姓名"
                  value={settings.defaultContact.name || ''}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      defaultContact: { ...prev.defaultContact, name: event.target.value },
                    }))
                  }
                />
                <TextField
                  fullWidth
                  label="手机号"
                  value={settings.defaultContact.phone || ''}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      defaultContact: { ...prev.defaultContact, phone: event.target.value },
                    }))
                  }
                />
                <TextField
                  fullWidth
                  label="邮箱"
                  value={settings.defaultContact.email || ''}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      defaultContact: { ...prev.defaultContact, email: event.target.value },
                    }))
                  }
                />
                <TextField
                  fullWidth
                  label="公司名（可选）"
                  value={settings.defaultContact.companyName || ''}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      defaultContact: { ...prev.defaultContact, companyName: event.target.value },
                    }))
                  }
                />
              </Box>
            </SettingsSection>

            <SettingsSection
              title="证书自动化"
              description="统一控制续期提醒阈值与自动部署时间窗。"
            >
              <Box sx={THREE_COLUMN_GRID_SX}>
                <TextField
                  fullWidth
                  type="number"
                  label="到期提醒天数"
                  value={settings.automation.renewDays}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      automation: { ...prev.automation, renewDays: Number(event.target.value || 0) },
                    }))
                  }
                  helperText="手动续期证书提醒阈值"
                  InputProps={{ inputProps: { min: 1, max: 365 } }}
                />
                <TextField
                  fullWidth
                  type="number"
                  label="自动部署开始时段"
                  value={settings.automation.deployHourStart}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      automation: { ...prev.automation, deployHourStart: Number(event.target.value || 0) },
                    }))
                  }
                  helperText="Asia/Shanghai"
                  InputProps={{ inputProps: { min: 0, max: 23 } }}
                />
                <TextField
                  fullWidth
                  type="number"
                  label="自动部署结束时段"
                  value={settings.automation.deployHourEnd}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      automation: { ...prev.automation, deployHourEnd: Number(event.target.value || 0) },
                    }))
                  }
                  helperText="Asia/Shanghai"
                  InputProps={{ inputProps: { min: 0, max: 23 } }}
                />
              </Box>
            </SettingsSection>

            <Box>
              <Button
                variant="contained"
                startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                onClick={handleSave}
                disabled={saving}
              >
                保存证书中心设置
              </Button>
            </Box>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
