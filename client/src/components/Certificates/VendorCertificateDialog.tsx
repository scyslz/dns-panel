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
import { DnsCredential } from '@/types/dns';
import {
  CreateVendorCertificateOrderInput,
  CertificateContactProfile,
  VendorCertificateProvider,
  VendorCertificateProviderDefinition,
  getVendorCertificateProviderLabel,
} from '@/types/cert';
import { getCertificateSettings } from '@/services/certificates';
import { certificateDialogActionsSx, certificateDialogContentSx, certificateDialogTitleSx } from './certificateTableStyles';
import { parseDomains } from './certificateUtils';

export default function VendorCertificateDialog({
  open,
  providers,
  credentials,
  preferredProvider,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  providers: VendorCertificateProviderDefinition[];
  credentials: DnsCredential[];
  preferredProvider?: VendorCertificateProvider;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateVendorCertificateOrderInput) => Promise<void>;
}) {
  const [provider, setProvider] = useState<string>('');
  const [vendorCredentialId, setVendorCredentialId] = useState<number>(0);
  const [validationDnsCredentialId, setValidationDnsCredentialId] = useState<number>(0);
  const [domainsText, setDomainsText] = useState('');
  const [contactProfile, setContactProfile] = useState<CertificateContactProfile>({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => providers.find((item) => item.provider === provider) || providers[0] || null,
    [provider, providers]
  );

  const filteredCredentials = useMemo(
    () => credentials.filter((item) => item.provider === selectedProvider?.vendorCredentialProvider),
    [credentials, selectedProvider]
  );

  const parsedDomains = useMemo(() => parseDomains(domainsText), [domainsText]);

  useEffect(() => {
    if (!open) return;
    const nextProvider = providers.find((item) => item.provider === preferredProvider)?.provider || providers[0]?.provider || '';
    const nextProviderMeta = providers.find((item) => item.provider === nextProvider) || providers[0] || null;
    setProvider(nextProvider);
    setVendorCredentialId(credentials.find((item) => item.provider === nextProviderMeta?.vendorCredentialProvider)?.id || 0);
    setValidationDnsCredentialId(credentials[0]?.id || 0);
    setDomainsText('');
    setContactProfile({});
    setSubmitError(null);
  }, [open, providers, credentials, preferredProvider]);

  useEffect(() => {
    if (!selectedProvider) return;
    const nextCredential = credentials.find((item) => item.provider === selectedProvider.vendorCredentialProvider);
    setVendorCredentialId(nextCredential?.id || 0);
  }, [selectedProvider, credentials]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setSettingsLoading(true);
    getCertificateSettings()
      .then((response) => {
        if (!active) return;
        const defaults = response.data?.settings?.defaultContact || {};
        setContactProfile({
          name: defaults.name || '',
          phone: defaults.phone || '',
          email: defaults.email || '',
          companyName: defaults.companyName || '',
        });
      })
      .catch(() => {
        if (!active) return;
        setContactProfile({});
      })
      .finally(() => {
        if (active) setSettingsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open]);

  const handleSubmit = async () => {
    if (!selectedProvider) {
      setSubmitError('当前没有可用厂商渠道');
      return;
    }
    if (!vendorCredentialId) {
      setSubmitError('请选择云厂商凭证');
      return;
    }
    if (!validationDnsCredentialId) {
      setSubmitError('请选择验证 DNS 凭证');
      return;
    }
    if (!parsedDomains.length) {
      setSubmitError('请至少填写一个域名');
      return;
    }
    if (!selectedProvider.supportsMultipleDomains && parsedDomains.length > 1) {
      setSubmitError(`${getVendorCertificateProviderLabel(selectedProvider.provider)} 当前仅支持单域名申请`);
      return;
    }

    if (selectedProvider.requiresContactProfile) {
      if (!String(contactProfile.name || '').trim()) {
        setSubmitError('请填写联系人姓名');
        return;
      }
      if (!String(contactProfile.phone || '').trim()) {
        setSubmitError('请填写联系人手机号');
        return;
      }
      if (!String(contactProfile.email || '').trim()) {
        setSubmitError('请填写联系人邮箱');
        return;
      }
    }

    try {
      setSubmitError(null);
      await onSubmit({
        provider: selectedProvider.provider,
        vendorCredentialId,
        validationDnsCredentialId,
        domains: parsedDomains,
        contactProfile,
      });
    } catch (error: any) {
      setSubmitError(typeof error === 'string' ? error : (error?.message || '提交失败'));
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={certificateDialogTitleSx}>申请厂商证书</DialogTitle>
      <DialogContent sx={certificateDialogContentSx}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            label="厂商渠道"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            fullWidth
            size="small"
            disabled={submitting || providers.length === 0}
          >
            {providers.map((item) => (
              <MenuItem key={item.provider} value={item.provider}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>

          {selectedProvider ? (
            <Typography variant="body2" color="text.secondary">
              {selectedProvider.description}
              {!selectedProvider.supportsMultipleDomains ? ' 当前只支持单域名。' : ''}
            </Typography>
          ) : null}

          {selectedProvider && filteredCredentials.length === 0 ? (
            <Alert severity="warning">
              当前没有可用于 {getVendorCertificateProviderLabel(selectedProvider.provider)} 的 DNS 凭证。
            </Alert>
          ) : null}

          <TextField
            select
            label="云厂商凭证"
            value={vendorCredentialId || ''}
            onChange={(event) => setVendorCredentialId(parseInt(event.target.value, 10))}
            fullWidth
            size="small"
            disabled={submitting || filteredCredentials.length === 0}
            helperText={
              selectedProvider
                ? `将过滤为 ${selectedProvider.vendorCredentialProvider} 类型凭证`
                : undefined
            }
          >
            {filteredCredentials.map((credential) => (
              <MenuItem key={credential.id} value={credential.id}>
                {credential.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="验证 DNS 凭证"
            value={validationDnsCredentialId || ''}
            onChange={(event) => setValidationDnsCredentialId(parseInt(event.target.value, 10))}
            fullWidth
            size="small"
            disabled={submitting || credentials.length === 0}
            helperText="用于写入 DNS 校验记录，可与云厂商凭证不同。"
          >
            {credentials.map((credential) => (
              <MenuItem key={credential.id} value={credential.id}>
                {credential.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="域名列表"
            value={domainsText}
            onChange={(event) => setDomainsText(event.target.value)}
            placeholder={'example.com\nwww.example.com'}
            multiline
            minRows={4}
            fullWidth
            disabled={submitting}
            helperText={`支持空格/逗号/换行分隔，已去重 ${parsedDomains.length} 个`}
          />

          {parsedDomains.length > 0 ? (
            <Stack spacing={0.5}>
              <Typography variant="body2" color="text.secondary">
                本次将申请：
              </Typography>
              <Typography variant="body2">{parsedDomains.join(', ')}</Typography>
            </Stack>
          ) : null}

          <Typography variant="body2" fontWeight={600} color="text.secondary" sx={{ mt: 0.5 }}>
            联系人信息
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="联系人姓名"
              value={contactProfile.name || ''}
              onChange={(event) => setContactProfile((prev) => ({ ...prev, name: event.target.value }))}
              fullWidth
              size="small"
              disabled={submitting || settingsLoading}
            />
            <TextField
              label="联系人手机号"
              value={contactProfile.phone || ''}
              onChange={(event) => setContactProfile((prev) => ({ ...prev, phone: event.target.value }))}
              fullWidth
              size="small"
              disabled={submitting || settingsLoading}
            />
            <TextField
              label="联系人邮箱"
              value={contactProfile.email || ''}
              onChange={(event) => setContactProfile((prev) => ({ ...prev, email: event.target.value }))}
              fullWidth
              size="small"
              disabled={submitting || settingsLoading}
              helperText="默认值来自 Settings > 证书申请默认联系人，可在这里覆盖。"
            />
          </Stack>

          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={certificateDialogActionsSx}>
        <Button onClick={onClose} disabled={submitting} color="inherit">
          取消
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting || providers.length === 0}>
          {submitting ? '提交中...' : '创建申请'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
