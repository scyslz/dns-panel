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
import {
  Add as AddIcon,
  CheckCircle as EnabledIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  PauseCircleOutline as DisabledIcon,
  PlayArrow as TestIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import {
  createDeployTarget,
  deleteDeployTarget,
  getDeployTargets,
  getDeployTargetTypes,
  testDeployTarget,
  updateDeployTarget,
} from '@/services/certificates';
import {
  DeployTarget,
  DeployTargetTypeDefinition,
  UpsertDeployTargetInput,
  getDeployTargetTypeLabel,
  summarizeDeployTargetConfig,
} from '@/types/cert';
import { formatRelativeTime } from '@/utils/formatters';
import CertificateEmptyState from './CertificateEmptyState';
import CertificateSearchField from './CertificateSearchField';
import { certificateTableSx, certificateToolbarSx, certificateDialogActionsSx, getCertificateStatusChipSx, stickyBodyCellSx, stickyHeaderCellSx } from './certificateTableStyles';
import DeployTargetDialog from './DeployTargetDialog';

function renderTargetStatus(enabled: boolean) {
  if (enabled) {
    return (
      <Chip
        size="small"
        icon={<EnabledIcon fontSize="small" />}
        label="已启用"
        sx={getCertificateStatusChipSx('success')}
      />
    );
  }

  return (
      <Chip
        size="small"
        icon={<DisabledIcon fontSize="small" />}
        label="已停用"
        sx={getCertificateStatusChipSx('default')}
      />
    );
  }

export default function DeployTargetSection() {
  const [targets, setTargets] = useState<DeployTarget[]>([]);
  const [targetTypes, setTargetTypes] = useState<DeployTargetTypeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<DeployTarget | null>(null);
  const [deleteTargetRow, setDeleteTargetRow] = useState<DeployTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [targetsRes, typesRes] = await Promise.all([
        getDeployTargets(),
        getDeployTargetTypes(),
      ]);
      setTargets(targetsRes.data?.targets || []);
      setTargetTypes(typesRes.data?.types || []);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '加载部署目标失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const normalizedSearch = searchKeyword.trim().toLowerCase();
  const visibleTargets = useMemo(() => {
    if (!normalizedSearch) return targets;
    return targets.filter((target) =>
      [
        target.name,
        getDeployTargetTypeLabel(target.type, targetTypes),
        summarizeDeployTargetConfig(target),
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch))
    );
  }, [targets, targetTypes, normalizedSearch]);

  const getTypeDefinition = useCallback(
    (type?: string | null) => targetTypes.find((item) => item.type === type) || null,
    [targetTypes]
  );

  const handleSubmit = async (payload: UpsertDeployTargetInput) => {
    try {
      setSubmitting(true);
      if (editingTarget) {
        await updateDeployTarget(editingTarget.id, payload);
        setSuccessMessage('部署目标已更新');
      } else {
        await createDeployTarget(payload);
        setSuccessMessage('部署目标已创建');
      }
      setDialogOpen(false);
      setEditingTarget(null);
      await loadData();
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async (target: DeployTarget) => {
    try {
      setTestingId(target.id);
      setError(null);
      await testDeployTarget(target.id);
      setSuccessMessage(`部署目标测试成功：${target.name}`);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '部署目标测试失败'));
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTargetRow) return;
    try {
      setDeletingId(deleteTargetRow.id);
      setError(null);
      await deleteDeployTarget(deleteTargetRow.id);
      setSuccessMessage('部署目标已删除');
      setDeleteTargetRow(null);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '删除部署目标失败'));
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
          <CertificateSearchField
            value={searchKeyword}
            onChange={setSearchKeyword}
            placeholder="搜索名称 / 类型 / 配置..."
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={loadData} disabled={loading} sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}>
              刷新列表
            </Button>
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => {
                setEditingTarget(null);
                setDialogOpen(true);
              }}
              disabled={targetTypes.length === 0}
              sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}
            >
              新增目标
            </Button>
          </Stack>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {successMessage ? <Alert severity="success" onClose={() => setSuccessMessage(null)}>{successMessage}</Alert> : null}

        {loading ? (
          <Stack alignItems="center" py={4}>
            <CircularProgress size={24} />
          </Stack>
        ) : visibleTargets.length === 0 ? (
          <CertificateEmptyState
            title={normalizedSearch ? '未找到匹配的部署目标' : '暂无部署目标'}
            description={normalizedSearch ? '试试更换名称、类型或配置关键词。' : '先新增一个目标，再到“部署任务”里绑定证书。'}
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
                  <TableCell>类型</TableCell>
                  <TableCell>配置摘要</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>更新时间</TableCell>
                  <TableCell align="right" sx={stickyHeaderCellSx}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleTargets.map((target) => {
                  const typeDefinition = getTypeDefinition(target.type);
                  return (
                    <TableRow
                      key={target.id}
                      hover
                      sx={{
                        '&:hover .certificate-deploy-target-sticky-action': {
                          bgcolor: '#F8FAFC',
                        },
                      }}
                    >
                    <TableCell sx={{ minWidth: 220 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="nowrap" sx={{ minWidth: 0 }}>
                        <Typography variant="body1" fontWeight={600} noWrap>
                          {target.name}
                        </Typography>
                        {target.isDefault ? <Chip size="small" label="默认" color="primary" variant="outlined" /> : null}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <Typography variant="body1">{getDeployTargetTypeLabel(target.type, targetTypes)}</Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                        {summarizeDeployTargetConfig(target)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {renderTargetStatus(target.enabled)}
                    </TableCell>
                    <TableCell sx={{ minWidth: 160, color: 'text.secondary' }}>
                      {formatRelativeTime(target.updatedAt)}
                    </TableCell>
                    <TableCell
                      align="right"
                      className="certificate-deploy-target-sticky-action"
                      sx={{
                        ...stickyBodyCellSx,
                        minWidth: 148,
                      }}
                    >
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="nowrap">
                        {typeDefinition?.supportsTest ? (
                          <Tooltip title="测试">
                            <span>
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => handleTest(target)}
                                disabled={testingId === target.id}
                              >
                                {testingId === target.id ? <CircularProgress size={18} /> : <TestIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        ) : null}
                        <Tooltip title="编辑">
                          <IconButton
                            size="small"
                            onClick={() => {
                              setEditingTarget(target);
                              setDialogOpen(true);
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={target.jobCount > 0 ? '已绑定任务，无法删除' : '删除'}>
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => setDeleteTargetRow(target)}
                              disabled={target.jobCount > 0}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>

      <DeployTargetDialog
        open={dialogOpen}
        target={editingTarget}
        targetTypes={targetTypes}
        submitting={submitting}
        onClose={() => {
          if (submitting) return;
          setDialogOpen(false);
          setEditingTarget(null);
        }}
        onSubmit={handleSubmit}
      />

      <Dialog open={!!deleteTargetRow} onClose={() => setDeleteTargetRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除部署目标</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ pt: 1 }}>
            删除目标“{deleteTargetRow?.name}”？已绑定任务时无法删除。
          </Typography>
        </DialogContent>
        <DialogActions sx={certificateDialogActionsSx}>
          <Button onClick={() => setDeleteTargetRow(null)} color="inherit" disabled={deletingId !== null}>
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
