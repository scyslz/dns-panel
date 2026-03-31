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
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Refresh as RefreshIcon, Star as StarIcon } from '@mui/icons-material';
import {
  createCertificateCredential,
  deleteCertificateCredential,
  getCertificateCredentialProviders,
  getCertificateCredentials,
  setDefaultCertificateCredential,
  updateCertificateCredential,
} from '@/services/certificates';
import { AcmeProviderOption, CertificateCredential, UpsertCertificateCredentialInput, getAcmeProviderLabel } from '@/types/cert';
import { formatRelativeTime } from '@/utils/formatters';
import AcmeAccountDialog from './AcmeAccountDialog';
import CertificateEmptyState from './CertificateEmptyState';
import CertificateSearchField from './CertificateSearchField';
import { certificateDialogActionsSx, certificateTableSx, certificateToolbarSx, stickyBodyCellSx, stickyHeaderCellSx } from './certificateTableStyles';

export default function AcmeAccountSection() {
  const [providers, setProviders] = useState<AcmeProviderOption[]>([]);
  const [accounts, setAccounts] = useState<CertificateCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<CertificateCredential | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CertificateCredential | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingDefaultId, setSettingDefaultId] = useState<number | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [providersRes, accountsRes] = await Promise.all([
        getCertificateCredentialProviders(),
        getCertificateCredentials(),
      ]);
      setProviders(providersRes.data?.providers || []);
      setAccounts(accountsRes.data?.credentials || []);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '加载 ACME 账户失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt)),
    [accounts]
  );
  const normalizedSearch = searchKeyword.trim().toLowerCase();
  const visibleAccounts = useMemo(() => {
    if (!normalizedSearch) return sortedAccounts;
    return sortedAccounts.filter((account) =>
      [
        account.name,
        getAcmeProviderLabel(account.provider),
        account.email,
        account.directoryUrl,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch))
    );
  }, [sortedAccounts, normalizedSearch]);

  const handleCreate = () => {
    setEditingAccount(null);
    setDialogOpen(true);
  };

  const handleEdit = (account: CertificateCredential) => {
    setEditingAccount(account);
    setDialogOpen(true);
  };

  const handleSubmit = async (payload: UpsertCertificateCredentialInput) => {
    try {
      setSubmitting(true);
      if (editingAccount) {
        await updateCertificateCredential(editingAccount.id, payload);
      } else {
        await createCertificateCredential(payload);
      }
      setDialogOpen(false);
      setEditingAccount(null);
      await loadData();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetDefault = async (account: CertificateCredential) => {
    try {
      setSettingDefaultId(account.id);
      await setDefaultCertificateCredential(account.id);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '设置默认账户失败'));
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await deleteCertificateCredential(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '删除账户失败'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={2}
          sx={certificateToolbarSx}
        >
          <CertificateSearchField
            value={searchKeyword}
            onChange={setSearchKeyword}
            placeholder="搜索名称 / 邮箱 / 提供商..."
          />
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ justifyContent: { xs: 'stretch', sm: 'flex-end' } }}
          >
            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={loadData} disabled={loading} sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}>
              刷新列表
            </Button>
            <Button startIcon={<AddIcon />} variant="contained" onClick={handleCreate} sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}>
              新增账户
            </Button>
          </Stack>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {loading ? (
          <Stack alignItems="center" py={4}>
            <CircularProgress size={24} />
          </Stack>
        ) : visibleAccounts.length === 0 ? (
          <CertificateEmptyState
            title={normalizedSearch ? '未找到匹配的 ACME 账户' : '暂无 ACME 账户'}
            description={normalizedSearch ? '试试更换名称、邮箱或提供商关键词。' : '先新增一个账户，再回来创建证书。'}
          />
        ) : (
          <TableContainer sx={{ width: '100%', overflowX: 'auto' }}>
            <Table
              size="small"
              sx={{
                minWidth: 980,
                ...certificateTableSx,
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>名称</TableCell>
                  <TableCell>提供商</TableCell>
                  <TableCell>邮箱</TableCell>
                  <TableCell>目录地址</TableCell>
                  <TableCell>更新时间</TableCell>
                  <TableCell align="right" sx={stickyHeaderCellSx}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleAccounts.map((account) => (
                  <TableRow
                    key={account.id}
                    hover
                    sx={{
                      '&:hover .certificate-acme-sticky-action': {
                        bgcolor: '#F8FAFC',
                      },
                    }}
                  >
                    <TableCell sx={{ minWidth: 220 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography variant="body1" fontWeight={600}>
                          {account.name}
                        </Typography>
                        {account.isDefault ? <Chip size="small" color="primary" label="默认" /> : null}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ minWidth: 160 }}>
                      <Typography variant="body1">{getAcmeProviderLabel(account.provider)}</Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 220 }}>
                      <Typography variant="body1">{account.email}</Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Tooltip title={account.directoryUrl || '-'}>
                        <Typography variant="body2" noWrap>
                          {account.directoryUrl || '-'}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ minWidth: 160, color: 'text.secondary' }}>
                      {formatRelativeTime(account.updatedAt)}
                    </TableCell>
                    <TableCell
                      align="right"
                      className="certificate-acme-sticky-action"
                      sx={{
                        ...stickyBodyCellSx,
                        minWidth: 132,
                      }}
                    >
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="nowrap">
                        <Tooltip title="编辑">
                          <IconButton size="small" onClick={() => handleEdit(account)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {!account.isDefault ? (
                          <Tooltip title="设为默认">
                            <span>
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => handleSetDefault(account)}
                                disabled={settingDefaultId === account.id}
                              >
                                {settingDefaultId === account.id ? <CircularProgress size={18} /> : <StarIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        ) : null}
                        <Tooltip title="删除">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteTarget(account)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>

      <AcmeAccountDialog
        open={dialogOpen}
        account={editingAccount}
        providers={providers}
        submitting={submitting}
        onClose={() => {
          if (submitting) return;
          setDialogOpen(false);
          setEditingAccount(null);
        }}
        onSubmit={handleSubmit}
      />

      <Dialog open={!!deleteTarget} onClose={deleting ? undefined : () => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除 ACME 账户</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ pt: 1 }}>
            删除账户“{deleteTarget?.name}”？若已关联订单，后端会拒绝删除。
          </Typography>
        </DialogContent>
        <DialogActions sx={certificateDialogActionsSx}>
          <Button onClick={() => setDeleteTarget(null)} color="inherit" disabled={deleting}>
            取消
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
            {deleting ? '删除中...' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
