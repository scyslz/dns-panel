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
  Switch,
  Typography,
} from '@mui/material';
import {
  Groups as MultiUserIcon,
  HowToReg as RegisterIcon,
  GppGood as ApprovalIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import SettingsSection from '@/components/Settings/SettingsSection';
import { SystemSettings, getSystemSettings, updateSystemSettings } from '@/services/users';

function ToggleRow({
  icon,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start" justifyContent="space-between">
      <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ minWidth: 0 }}>
        <Box sx={{ color: 'primary.main', mt: 0.25, display: 'flex' }}>{icon}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600}>{title}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.5 }}>
            {description}
          </Typography>
        </Box>
      </Stack>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        sx={{ mt: -0.5, flexShrink: 0 }}
      />
    </Stack>
  );
}

/**
 * 账号与注册策略设置（仅管理员）。
 * 设置保存到数据库，保存后立即生效，无需改环境变量或重启。
 */
export default function AccountSettingsCard({ onChanged }: { onChanged?: () => void }) {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [draft, setDraft] = useState({
    multiUserEnabled: true,
    registrationEnabled: false,
    registrationRequiresApproval: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getSystemSettings();
      const next = res?.data?.settings;
      if (!next) return;
      setSettings(next);
      setDraft({
        multiUserEnabled: next.multiUserEnabled,
        registrationEnabled: next.registrationEnabled,
        registrationRequiresApproval: next.registrationRequiresApproval,
      });
    } catch (err: any) {
      setError(err?.message || String(err) || '加载账号设置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = !!settings && (
    draft.multiUserEnabled !== settings.multiUserEnabled ||
    draft.registrationEnabled !== settings.registrationEnabled ||
    draft.registrationRequiresApproval !== settings.registrationRequiresApproval
  );

  // 关闭多用户时，注册与审核开关一并禁用（后端也会强制 registrationEnabled=false）
  const effectiveRegistration = draft.multiUserEnabled ? draft.registrationEnabled : false;

  const onSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const res = await updateSystemSettings({
        multiUserEnabled: draft.multiUserEnabled,
        registrationEnabled: effectiveRegistration,
        registrationRequiresApproval: draft.registrationRequiresApproval,
      });
      const next = res?.data?.settings;
      if (next) {
        setSettings(next);
        setDraft({
          multiUserEnabled: next.multiUserEnabled,
          registrationEnabled: next.registrationEnabled,
          registrationRequiresApproval: next.registrationRequiresApproval,
        });
      }
      setSuccess('设置已保存，立即生效');
      onChanged?.();
    } catch (err: any) {
      setError(err?.message || String(err) || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card sx={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
      <CardHeader
        avatar={<MultiUserIcon color="primary" />}
        title={<Typography variant="h6" fontWeight="bold">账号与注册</Typography>}
      />
      <Divider />
      <CardContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>
        ) : (
          <SettingsSection
            title="账号策略"
            description="未配置时默认：多用户开启、公开注册关闭、注册需审核"
          >
            {error ? <Alert severity="error">{error}</Alert> : null}
            {success ? <Alert severity="success">{success}</Alert> : null}

            <Stack spacing={2} divider={<Divider flexItem />}>
              <ToggleRow
                icon={<MultiUserIcon fontSize="small" />}
                title="启用多用户"
                description="关闭后隐藏「用户管理」菜单，并禁止注册、审核与用户增删；已有账号仍可登录"
                checked={draft.multiUserEnabled}
                onChange={(v) => setDraft({ ...draft, multiUserEnabled: v })}
              />
              <ToggleRow
                icon={<RegisterIcon fontSize="small" />}
                title="允许公开注册"
                description="开启后登录页显示注册入口；空库首个账号自动成为管理员，其余注册为普通用户"
                checked={effectiveRegistration}
                disabled={!draft.multiUserEnabled}
                onChange={(v) => setDraft({ ...draft, registrationEnabled: v })}
              />
              <ToggleRow
                icon={<ApprovalIcon fontSize="small" />}
                title="注册需要审核"
                description="强烈建议开启。开启后新账号为「待审核」，管理员在「用户管理」通过后才能登录"
                checked={draft.registrationRequiresApproval}
                disabled={!draft.multiUserEnabled || !effectiveRegistration}
                onChange={(v) => setDraft({ ...draft, registrationRequiresApproval: v })}
              />
            </Stack>

            {!draft.multiUserEnabled ? (
              <Alert severity="info">
                多用户已关闭：系统将按单用户模式运行，公开注册与用户管理均不可用。
              </Alert>
            ) : null}
            {draft.multiUserEnabled && effectiveRegistration && !draft.registrationRequiresApproval ? (
              <Alert severity="warning">
                关闭审核意味着任何人注册后即可登录并拥有独立账号空间，请确认这是预期行为。
              </Alert>
            ) : null}
            {draft.multiUserEnabled && effectiveRegistration && draft.registrationRequiresApproval ? (
              <Alert severity="success">
                当前策略：允许注册，但新账号需管理员审核通过后才能登录。
              </Alert>
            ) : null}
            {settings ? (
              <Typography variant="caption" color="text.secondary">
                当前共有 {settings.userCount} 个账号 · 最近保存 {new Date(settings.updatedAt).toLocaleString('zh-CN', { hour12: false })}
              </Typography>
            ) : null}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
              <Button
                variant="contained"
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                disabled={!dirty || saving}
                onClick={onSave}
              >
                {saving ? '保存中...' : '保存'}
              </Button>
            </Box>
          </SettingsSection>
        )}
      </CardContent>
    </Card>
  );
}
