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
} from '@mui/material';
import { DnsCredential } from '@/types/dns';
import { CertificateAlias, UpsertCertificateAliasInput } from '@/types/cert';
import { certificateDialogActionsSx, certificateDialogContentSx, certificateDialogTitleSx } from './certificateTableStyles';

export default function CertificateAliasDialog({
  open,
  alias,
  credentials,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  alias: CertificateAlias | null;
  credentials: DnsCredential[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: UpsertCertificateAliasInput) => Promise<void>;
}) {
  const [domain, setDomain] = useState('');
  const [dnsCredentialId, setDnsCredentialId] = useState<number>(0);
  const [zoneName, setZoneName] = useState('');
  const [rr, setRr] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const firstCredentialId = useMemo(() => credentials[0]?.id || 0, [credentials]);

  useEffect(() => {
    if (!open) return;
    setDomain(alias?.domain || '');
    setDnsCredentialId(alias?.dnsCredentialId || firstCredentialId);
    setZoneName(alias?.zoneName || '');
    setRr(alias?.rr || '');
    setSubmitError(null);
  }, [open, alias, firstCredentialId]);

  const handleSubmit = async () => {
    const payload: UpsertCertificateAliasInput = {
      domain: domain.trim(),
      dnsCredentialId,
      zoneName: zoneName.trim(),
      rr: rr.trim(),
    };

    if (!payload.domain) {
      setSubmitError('请填写源域名');
      return;
    }
    if (!payload.dnsCredentialId) {
      setSubmitError('请选择目标 DNS 凭证');
      return;
    }
    if (!payload.zoneName) {
      setSubmitError('请填写 Alias Zone');
      return;
    }
    if (!payload.rr) {
      setSubmitError('请填写 Alias RR');
      return;
    }

    try {
      setSubmitError(null);
      await onSubmit(payload);
    } catch (error: any) {
      setSubmitError(typeof error === 'string' ? error : (error?.message || '提交失败'));
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={certificateDialogTitleSx}>{alias ? '编辑 CNAME Alias' : '新增 CNAME Alias'}</DialogTitle>
      <DialogContent sx={certificateDialogContentSx}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="源域名"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            fullWidth
            size="small"
            disabled={submitting}
            placeholder="example.com"
            helperText="用于匹配 _acme-challenge.<domain> 的 CNAME Alias。"
          />

          <TextField
            select
            label="目标 DNS 凭证"
            value={dnsCredentialId || ''}
            onChange={(event) => setDnsCredentialId(parseInt(event.target.value, 10))}
            fullWidth
            size="small"
            disabled={submitting || credentials.length === 0}
          >
            {credentials.map((credential) => (
              <MenuItem key={credential.id} value={credential.id}>
                {credential.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Alias Zone"
            value={zoneName}
            onChange={(event) => setZoneName(event.target.value)}
            fullWidth
            size="small"
            disabled={submitting}
            placeholder="alias.example.net"
            helperText="Alias 最终会写到此 Zone 内。"
          />

          <TextField
            label="Alias RR"
            value={rr}
            onChange={(event) => setRr(event.target.value)}
            fullWidth
            size="small"
            disabled={submitting}
            placeholder="_acme-challenge.app"
            helperText="最终目标 FQDN = <rr>.<zoneName>"
          />

          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={certificateDialogActionsSx}>
        <Button onClick={onClose} disabled={submitting} color="inherit">
          取消
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting || credentials.length === 0}>
          {submitting ? '提交中...' : (alias ? '保存' : '创建')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
