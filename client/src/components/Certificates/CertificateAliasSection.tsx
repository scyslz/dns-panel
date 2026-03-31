import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Autorenew as CheckIcon,
  DeleteOutline as DeleteIcon,
  EditOutlined as EditIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { getDnsCredentials } from '@/services/dnsCredentials';
import {
  checkCertificateAlias,
  createCertificateAlias,
  deleteCertificateAlias,
  getCertificateAliases,
  updateCertificateAlias,
} from '@/services/certificates';
import { DnsCredential } from '@/types/dns';
import {
  CertificateAlias,
  UpsertCertificateAliasInput,
  getCertificateAliasStatusColor,
  getCertificateAliasStatusLabel,
} from '@/types/cert';
import { formatDateTime } from '@/utils/formatters';
import CertificateEmptyState from './CertificateEmptyState';
import CertificateSearchField from './CertificateSearchField';
import CertificateAliasDialog from './CertificateAliasDialog';
import { certificateDialogActionsSx, certificateTableSx, certificateToolbarSx, stickyBodyCellSx, stickyHeaderCellSx } from './certificateTableStyles';

export default function CertificateAliasSection() {
  const [aliases, setAliases] = useState<CertificateAlias[]>([]);
  const [credentials, setCredentials] = useState<DnsCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<CertificateAlias | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CertificateAlias | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [aliasesRes, credentialsRes] = await Promise.all([getCertificateAliases(), getDnsCredentials()]);
      setAliases(aliasesRes.data?.aliases || []);
      setCredentials(credentialsRes.data?.credentials || []);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '加载 CNAME Alias 失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const normalizedSearch = searchKeyword.trim().toLowerCase();
  const visibleAliases = useMemo(() => {
    if (!normalizedSearch) return aliases;
    return aliases.filter((alias) =>
      [alias.domain, alias.zoneName, alias.rr, alias.targetFqdn, alias.dnsCredential?.name, alias.lastError]
        .some((value) => String(value || '').toLowerCase().includes(normalizedSearch))
    );
  }, [aliases, normalizedSearch]);

  const handleSubmit = async (payload: UpsertCertificateAliasInput) => {
    try {
      setSubmitting(true);
      if (editingAlias) {
        await updateCertificateAlias(editingAlias.id, payload);
        setSuccessMessage('CNAME Alias 已更新');
      } else {
        await createCertificateAlias(payload);
        setSuccessMessage('CNAME Alias 已创建');
      }
      setDialogOpen(false);
      setEditingAlias(null);
      await loadData();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheck = async (alias: CertificateAlias) => {
    try {
      setCheckingId(alias.id);
      setError(null);
      await checkCertificateAlias(alias.id);
      setSuccessMessage(`Alias 已检查：${alias.domain}`);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || 'Alias 校验失败'));
    } finally {
      setCheckingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeletingId(deleteTarget.id);
      setError(null);
      await deleteCertificateAlias(deleteTarget.id);
      setSuccessMessage('CNAME Alias 已删除');
      setDeleteTarget(null);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '删除 CNAME Alias 失败'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          sx={certificateToolbarSx}
        >
          <CertificateSearchField value={searchKeyword} onChange={setSearchKeyword} placeholder="搜索源域名 / Alias 目标..." />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={loadData} disabled={loading} sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}>
              刷新列表
            </Button>
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => {
                setEditingAlias(null);
                setDialogOpen(true);
              }}
              disabled={credentials.length === 0}
              sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}
            >
              新增 Alias
            </Button>
          </Stack>
        </Stack>

        <Typography variant="body2" color="text.secondary">
          当当前 DNS 凭证无法直接写入 _acme-challenge 记录时，系统会尝试命中这里配置的 CNAME Alias，并改写目标 TXT 记录。
        </Typography>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {successMessage ? <Alert severity="success" onClose={() => setSuccessMessage(null)}>{successMessage}</Alert> : null}

        {loading ? (
          <Stack alignItems="center" py={4}>
            <CircularProgress size={24} />
          </Stack>
        ) : visibleAliases.length === 0 ? (
          <CertificateEmptyState
            title={normalizedSearch ? '未找到匹配的 CNAME Alias' : '暂无 CNAME Alias'}
            description={normalizedSearch ? '试试更换源域名、Zone 或目标记录关键词。' : '新增后可在 ACME 证书申请时自动命中 Alias。'}
          />
        ) : (
          <TableContainer sx={{ width: '100%', overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 1120, ...certificateTableSx }}>
              <TableHead>
                <TableRow>
                  <TableCell>源域名</TableCell>
                  <TableCell>目标记录</TableCell>
                  <TableCell>目标 DNS 凭证</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>最近校验</TableCell>
                  <TableCell>错误信息</TableCell>
                  <TableCell align="right" sx={stickyHeaderCellSx}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleAliases.map((alias) => (
                  <TableRow
                    key={alias.id}
                    hover
                    sx={{
                      '&:hover .certificate-alias-sticky-action': {
                        bgcolor: '#F8FAFC',
                      },
                    }}
                  >
                    <TableCell sx={{ minWidth: 180 }}>
                      <Typography variant="body1" fontWeight={600}>{alias.domain}</Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 240 }}>
                      <Stack spacing={0.25}>
                        <Typography variant="body2" fontWeight={600}>{alias.targetFqdn}</Typography>
                        <Typography variant="body2" color="text.secondary">RR: {alias.rr} / Zone: {alias.zoneName}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>{alias.dnsCredential?.name || `#${alias.dnsCredentialId}`}</TableCell>
                    <TableCell sx={{ minWidth: 120 }}>
                      <Chip size="small" color={getCertificateAliasStatusColor(alias.status)} label={getCertificateAliasStatusLabel(alias.status)} />
                    </TableCell>
                    <TableCell sx={{ minWidth: 160 }}>{alias.lastCheckedAt ? formatDateTime(alias.lastCheckedAt) : '-'}</TableCell>
                    <TableCell sx={{ minWidth: 220 }}>
                      <Typography variant="body2" color="text.secondary">{alias.lastError || '-'}</Typography>
                    </TableCell>
                    <TableCell align="right" className="certificate-alias-sticky-action" sx={stickyBodyCellSx}>
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<CheckIcon />}
                          onClick={() => handleCheck(alias)}
                          disabled={checkingId === alias.id}
                        >
                          {checkingId === alias.id ? '检查中...' : '检查'}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<EditIcon />}
                          onClick={() => {
                            setEditingAlias(alias);
                            setDialogOpen(true);
                          }}
                        >
                          编辑
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          startIcon={<DeleteIcon />}
                          onClick={() => setDeleteTarget(alias)}
                          disabled={deletingId === alias.id}
                        >
                          删除
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>

      <CertificateAliasDialog
        open={dialogOpen}
        alias={editingAlias}
        credentials={credentials}
        submitting={submitting}
        onClose={() => {
          if (submitting) return;
          setDialogOpen(false);
          setEditingAlias(null);
        }}
        onSubmit={handleSubmit}
      />

      <Dialog open={!!deleteTarget} onClose={deletingId !== null ? undefined : () => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除 CNAME Alias</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ pt: 1 }}>
            确认删除 "{deleteTarget?.domain}" 的 CNAME Alias 吗？
          </Typography>
        </DialogContent>
        <DialogActions sx={certificateDialogActionsSx}>
          <Button onClick={() => setDeleteTarget(null)} color="inherit" disabled={deletingId !== null}>
            取消
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deletingId !== null}>
            {deletingId !== null ? '删除中...' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
