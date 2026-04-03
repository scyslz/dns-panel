import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import {
  Language as DomainIcon,
  Save as SaveIcon,
  Security as SecurityIcon,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import {
  getCurrentUser,
  getStoredUser,
  updateDomainExpirySettings,
  updatePassword,
} from '@/services/auth';
import CertificateSettingsCard from '@/components/Settings/CertificateSettingsCard';
import DnsCredentialManagement from '@/components/Settings/DnsCredentialManagement';
import NotificationChannelsCard from '@/components/Settings/NotificationChannelsCard';
import TwoFactorSettings from '@/components/Settings/TwoFactorSettings';
import { isStrongPassword } from '@/utils/validators';

interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const DOMAINS_PER_PAGE_STORAGE_KEY = 'dns_domains_per_page';
const DOMAINS_PER_PAGE_CHANGED_EVENT = 'dns_domains_per_page_changed';

export default function Settings() {
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [domainsPerPage, setDomainsPerPage] = useState<string>('20');
  const [domainsPerPageSuccess, setDomainsPerPageSuccess] = useState('');
  const [domainsPerPageError, setDomainsPerPageError] = useState('');

  const [expirySettingsSuccess, setExpirySettingsSuccess] = useState('');
  const [expirySettingsError, setExpirySettingsError] = useState('');
  const [expirySettingsSaving, setExpirySettingsSaving] = useState(false);
  const [expiryDisplayMode, setExpiryDisplayMode] = useState<'date' | 'days'>('date');
  const [expiryThresholdDays, setExpiryThresholdDays] = useState<string>('7');
  const [showNonAuthoritativeDomains, setShowNonAuthoritativeDomains] = useState(false);

  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    watch,
    reset: resetPassword,
    formState: { errors: passwordErrors, isSubmitting: isPasswordSubmitting },
  } = useForm<PasswordForm>();

  const newPassword = watch('newPassword');

  useEffect(() => {
    const raw = localStorage.getItem(DOMAINS_PER_PAGE_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= 20) {
      setDomainsPerPage(String(parsed));
    }

    const stored = getStoredUser();
    if (stored?.domainExpiryDisplayMode === 'days' || stored?.domainExpiryDisplayMode === 'date') {
      setExpiryDisplayMode(stored.domainExpiryDisplayMode);
    }
    if (typeof stored?.domainExpiryThresholdDays === 'number' && Number.isFinite(stored.domainExpiryThresholdDays)) {
      setExpiryThresholdDays(String(stored.domainExpiryThresholdDays));
    }
    if (typeof stored?.showNonAuthoritativeDomains === 'boolean') {
      setShowNonAuthoritativeDomains(stored.showNonAuthoritativeDomains);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await getCurrentUser();
        const user = res?.data?.user;
        if (!user) return;

        localStorage.setItem('user', JSON.stringify(user));

        if (user.domainExpiryDisplayMode === 'days' || user.domainExpiryDisplayMode === 'date') {
          setExpiryDisplayMode(user.domainExpiryDisplayMode);
        }
        if (typeof user.domainExpiryThresholdDays === 'number' && Number.isFinite(user.domainExpiryThresholdDays)) {
          setExpiryThresholdDays(String(user.domainExpiryThresholdDays));
        }
        if (typeof user.showNonAuthoritativeDomains === 'boolean') {
          setShowNonAuthoritativeDomains(user.showNonAuthoritativeDomains);
        }
      } catch {}
    })();
  }, []);

  const onPasswordSubmit = async (data: PasswordForm) => {
    try {
      setPasswordError('');
      setPasswordSuccess('');

      await updatePassword({
        oldPassword: data.oldPassword,
        newPassword: data.newPassword,
      });

      setPasswordSuccess('密码修改成功');
      resetPassword();
    } catch (err: any) {
      setPasswordError(err?.message || String(err) || '密码修改失败');
    }
  };

  const onSaveDomainsPerPage = () => {
    setDomainsPerPageSuccess('');
    setDomainsPerPageError('');

    const parsed = parseInt(domainsPerPage, 10);
    if (!Number.isFinite(parsed) || parsed < 20) {
      setDomainsPerPageError('单页显示域名数量最低为 20');
      return;
    }

    const safe = Math.max(20, Math.floor(parsed));
    localStorage.setItem(DOMAINS_PER_PAGE_STORAGE_KEY, String(safe));
    window.dispatchEvent(new CustomEvent(DOMAINS_PER_PAGE_CHANGED_EVENT, { detail: safe }));
    setDomainsPerPage(String(safe));
    setDomainsPerPageSuccess('设置已保存');
  };

  const onSaveExpirySettings = async () => {
    setExpirySettingsSuccess('');
    setExpirySettingsError('');

    const threshold = Math.floor(Number(expiryThresholdDays));
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 365) {
      setExpirySettingsError('到期阈值应为 1-365 的整数');
      return;
    }

    setExpirySettingsSaving(true);
    try {
      const res = await updateDomainExpirySettings({
        displayMode: expiryDisplayMode,
        thresholdDays: threshold,
        showNonAuthoritativeDomains,
      });

      const user = res?.data?.user;
      if (user) {
        localStorage.setItem('user', JSON.stringify(user));
        setShowNonAuthoritativeDomains(!!user.showNonAuthoritativeDomains);
      }
      setExpirySettingsSuccess('设置已保存');
    } catch (err: any) {
      setExpirySettingsError(err?.message || '设置保存失败');
    } finally {
      setExpirySettingsSaving(false);
    }
  };

  return (
    <Box>
      <Grid container spacing={3}>
        <Grid item xs={12} md={5} sx={{ order: { xs: 2, md: 1 } }}>
          <Stack spacing={3}>
            <Card sx={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
              <CardHeader
                avatar={<SecurityIcon color="primary" />}
                title={<Typography variant="h6" fontWeight="bold">安全设置</Typography>}
                subheader="修改您的登录密码"
              />
              <Divider />
              <CardContent>
                {passwordSuccess ? <Alert severity="success" sx={{ mb: 3 }}>{passwordSuccess}</Alert> : null}
                {passwordError ? <Alert severity="error" sx={{ mb: 3 }}>{passwordError}</Alert> : null}

                <form onSubmit={handlePasswordSubmit(onPasswordSubmit)}>
                  <Stack spacing={2}>
                    <TextField
                      fullWidth
                      type={showOldPassword ? 'text' : 'password'}
                      label="当前密码"
                      {...registerPassword('oldPassword', { required: '请输入当前密码' })}
                      error={!!passwordErrors.oldPassword}
                      helperText={passwordErrors.oldPassword?.message}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton onClick={() => setShowOldPassword((prev) => !prev)} edge="end">
                              {showOldPassword ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />

                    <TextField
                      fullWidth
                      type={showNewPassword ? 'text' : 'password'}
                      label="新密码"
                      {...registerPassword('newPassword', {
                        required: '请输入新密码',
                        validate: (value) =>
                          isStrongPassword(value) || '密码至少 8 位，包含大小写字母和数字',
                      })}
                      error={!!passwordErrors.newPassword}
                      helperText={passwordErrors.newPassword?.message}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton onClick={() => setShowNewPassword((prev) => !prev)} edge="end">
                              {showNewPassword ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />

                    <TextField
                      fullWidth
                      type="password"
                      label="确认新密码"
                      {...registerPassword('confirmPassword', {
                        required: '请确认新密码',
                        validate: (value) => value === newPassword || '两次密码输入不一致',
                      })}
                      error={!!passwordErrors.confirmPassword}
                      helperText={passwordErrors.confirmPassword?.message}
                    />

                    <Box sx={{ pt: 1 }}>
                      <Button
                        type="submit"
                        variant="contained"
                        startIcon={<SaveIcon />}
                        disabled={isPasswordSubmitting}
                      >
                        修改密码
                      </Button>
                    </Box>
                  </Stack>
                </form>

                <Divider sx={{ my: 3 }} />

                <TwoFactorSettings />
              </CardContent>
            </Card>

            <Card sx={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
              <CardHeader
                avatar={<DomainIcon color="primary" />}
                title={<Typography variant="h6" fontWeight="bold">域名设置</Typography>}
                subheader="列表显示与到期规则；通知设置已单独拆分管理"
              />
              <Divider />
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="subtitle1" fontWeight={600}>
                    域名列表
                  </Typography>

                  {domainsPerPageSuccess ? <Alert severity="success">{domainsPerPageSuccess}</Alert> : null}
                  {domainsPerPageError ? <Alert severity="error">{domainsPerPageError}</Alert> : null}

                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    alignItems={{ xs: 'stretch', sm: 'flex-end' }}
                  >
                    <TextField
                      value={domainsPerPage}
                      onChange={(event) => setDomainsPerPage(event.target.value)}
                      type="number"
                      label="每页域名数量"
                      sx={{ width: { xs: '100%', sm: 240 } }}
                      InputProps={{ inputProps: { min: 20 } }}
                    />
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<SaveIcon />}
                      onClick={onSaveDomainsPerPage}
                      sx={{ height: 40 }}
                    >
                      保存
                    </Button>
                  </Stack>

                  <FormControlLabel
                    control={
                      <Switch
                        checked={showNonAuthoritativeDomains}
                        onChange={(event) => setShowNonAuthoritativeDomains(event.target.checked)}
                      />
                    }
                    label="显示非权威域名"
                  />
                  <Typography variant="body2" color="text.secondary">
                    默认隐藏仅注册或当前未托管在本项目 DNS 提供商的域名；开启后仅用于排查，不影响 ESA / 自动 DNS。
                  </Typography>
                </Stack>

                <Divider sx={{ my: 3 }} />

                <Stack spacing={2}>
                  <Typography variant="subtitle1" fontWeight={600}>
                    域名到期
                  </Typography>

                  {expirySettingsSuccess ? <Alert severity="success">{expirySettingsSuccess}</Alert> : null}
                  {expirySettingsError ? <Alert severity="error">{expirySettingsError}</Alert> : null}

                  <FormControl sx={{ mt: -0.5 }}>
                    <RadioGroup
                      row
                      aria-label="列表显示"
                      sx={{ gap: 2 }}
                      value={expiryDisplayMode}
                      onChange={(event) => setExpiryDisplayMode((event.target as HTMLInputElement).value as 'date' | 'days')}
                    >
                      <FormControlLabel sx={{ m: 0 }} value="date" control={<Radio />} label="到期日期" />
                      <FormControlLabel sx={{ m: 0 }} value="days" control={<Radio />} label="剩余天数" />
                    </RadioGroup>
                  </FormControl>

                  <TextField
                    value={expiryThresholdDays}
                    onChange={(event) => setExpiryThresholdDays(event.target.value)}
                    type="number"
                    label="到期阈值（天）"
                    sx={{ width: { xs: '100%', sm: 240 } }}
                    InputProps={{ inputProps: { min: 1, max: 365 } }}
                    helperText="当域名剩余天数 ≤ 阈值时触发通知"
                  />

                  <Box>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={expirySettingsSaving ? <CircularProgress size={16} /> : <SaveIcon />}
                      onClick={onSaveExpirySettings}
                      disabled={expirySettingsSaving}
                      sx={{ height: 40 }}
                    >
                      保存
                    </Button>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            <CertificateSettingsCard />
            <NotificationChannelsCard />
          </Stack>
        </Grid>

        <Grid item xs={12} md={7} sx={{ order: { xs: 1, md: 2 } }}>
          <DnsCredentialManagement />
        </Grid>
      </Grid>
    </Box>
  );
}
