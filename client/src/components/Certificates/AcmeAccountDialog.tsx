import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  AcmeProviderOption,
  CertificateCredential,
  UpsertCertificateCredentialInput,
} from '@/types/cert';
import { certificateDialogActionsSx, certificateDialogContentSx, certificateDialogTitleSx } from './certificateTableStyles';

interface FormState {
  name: string;
  provider: AcmeProviderOption['provider'];
  email: string;
  directoryUrl: string;
  eabKid: string;
  eabHmacKey: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AcmeAccountDialog({
  open,
  account,
  providers,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  account: CertificateCredential | null;
  providers: AcmeProviderOption[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: UpsertCertificateCredentialInput) => Promise<void>;
}) {
  const defaultProvider = providers[0]?.provider || 'letsencrypt';
  const [form, setForm] = useState<FormState>({
    name: '',
    provider: defaultProvider,
    email: '',
    directoryUrl: '',
    eabKid: '',
    eabHmacKey: '',
  });
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setForm({
      name: account?.name || '',
      provider: account?.provider || defaultProvider,
      email: account?.email || '',
      directoryUrl: account?.directoryUrl || '',
      eabKid: account?.eabKid || '',
      eabHmacKey: '',
    });
  }, [open, account, defaultProvider]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.provider === form.provider) || null,
    [providers, form.provider]
  );

  const handleChange = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    const payload: UpsertCertificateCredentialInput = {
      name: form.name.trim(),
      provider: form.provider,
      email: form.email.trim(),
    };

    if (!payload.name) {
      setSubmitError('请输入账户名称');
      return;
    }
    if (!payload.email) {
      setSubmitError('请输入联系邮箱');
      return;
    }
    if (!EMAIL_PATTERN.test(payload.email)) {
      setSubmitError('邮箱格式不正确');
      return;
    }

    const directoryUrl = form.directoryUrl.trim();
    const eabKid = form.eabKid.trim();
    const eabHmacKey = form.eabHmacKey.trim();

    if (selectedProvider?.requiresDirectoryUrl && !directoryUrl) {
      setSubmitError('Custom ACME 必须填写目录地址');
      return;
    }

    if ((eabKid && !eabHmacKey) || (!eabKid && eabHmacKey)) {
      setSubmitError('填写 EAB 时需要同时提供 EAB KID 与 EAB HMAC Key');
      return;
    }

    if (directoryUrl) payload.directoryUrl = directoryUrl;
    if (eabKid) payload.eabKid = eabKid;
    if (eabHmacKey) payload.eabHmacKey = eabHmacKey;

    try {
      setSubmitError(null);
      await onSubmit(payload);
    } catch (error: any) {
      setSubmitError(typeof error === 'string' ? error : (error?.message || '保存失败'));
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={certificateDialogTitleSx}>{account ? '编辑 ACME 账户' : '新增 ACME 账户'}</DialogTitle>
      <DialogContent sx={certificateDialogContentSx}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="账户名称"
            value={form.name}
            onChange={(event) => handleChange('name', event.target.value)}
            fullWidth
            size="small"
            disabled={submitting}
          />

          <TextField
            select
            label="提供商"
            value={form.provider}
            onChange={(event) => handleChange('provider', event.target.value)}
            fullWidth
            size="small"
            disabled={submitting}
          >
            {providers.map((provider) => (
              <MenuItem key={provider.provider} value={provider.provider}>
                {provider.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="联系邮箱"
            value={form.email}
            onChange={(event) => handleChange('email', event.target.value)}
            fullWidth
            size="small"
            disabled={submitting}
          />

          {selectedProvider?.requiresDirectoryUrl ? (
            <TextField
              label="Directory URL"
              value={form.directoryUrl}
              onChange={(event) => handleChange('directoryUrl', event.target.value)}
              fullWidth
              size="small"
              disabled={submitting}
              helperText="Custom ACME 必填，例如 Pebble / Step CA / 企业 ACME 目录地址"
            />
          ) : (
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                当前目录地址
              </Typography>
              <Typography variant="body2">{selectedProvider?.defaultDirectoryUrl || '-'}</Typography>
            </Stack>
          )}

          {selectedProvider?.supportsEab ? (
            <>
              <TextField
                label="EAB KID"
                value={form.eabKid}
                onChange={(event) => handleChange('eabKid', event.target.value)}
                fullWidth
                size="small"
                disabled={submitting}
              />
              <TextField
                label="EAB HMAC Key"
                value={form.eabHmacKey}
                onChange={(event) => handleChange('eabHmacKey', event.target.value)}
                fullWidth
                size="small"
                type="password"
                disabled={submitting}
                helperText={account ? '留空表示保留现有 HMAC Key' : '如当前 ACME 提供商要求 EAB，请填写'}
              />
            </>
          ) : null}

          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={certificateDialogActionsSx}>
        <Button onClick={onClose} color="inherit" disabled={submitting}>
          取消
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || providers.length === 0}>
          {submitting ? '保存中...' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
