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
  CheckCircle as SuccessIcon,
  ErrorOutline as ErrorIcon,
  History as HistoryIcon,
  Pending as PendingIcon,
  PlayArrow as RunIcon,
  RadioButtonUnchecked as IdleIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import {
  createDeployJob,
  deleteDeployJob,
  getCertificateOrders,
  getDeployJobs,
  getDeployTargets,
  getDeployTargetTypes,
  getVendorCertificates,
  runDeployJob,
  updateDeployJob,
} from '@/services/certificates';
import {
  CertificateOrder,
  DeployJob,
  DeployTarget,
  DeployTargetTypeDefinition,
  UpsertDeployJobInput,
  VendorCertificate,
  getDeployJobSourceLabel,
  getDeployTargetTypeLabel,
  summarizeDeployJobBinding,
} from '@/types/cert';
import { formatDateTime, formatRelativeTime } from '@/utils/formatters';
import CertificateEmptyState from './CertificateEmptyState';
import CertificateSearchField from './CertificateSearchField';
import { certificateTableSx, certificateToolbarSx, certificateDialogActionsSx, getCertificateStatusChipSx, stickyBodyCellSx, stickyHeaderCellSx } from './certificateTableStyles';
import DeployJobDialog from './DeployJobDialog';
import DeployJobRunHistoryDialog from './DeployJobRunHistoryDialog';

function getStatusColor(status?: string | null): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'success':
      return 'success';
    case 'running':
      return 'warning';
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
}

function getDeployJobStatusLabel(status?: string | null): string {
  switch (status) {
    case 'success':
      return '成功';
    case 'running':
      return '执行中';
    case 'failed':
      return '失败';
    default:
      return '未执行';
  }
}

function getDeployJobStatusIcon(status?: string | null) {
  switch (status) {
    case 'success':
      return <SuccessIcon fontSize="small" />;
    case 'running':
      return <PendingIcon fontSize="small" />;
    case 'failed':
      return <ErrorIcon fontSize="small" />;
    default:
      return <IdleIcon fontSize="small" />;
  }
}

function getTriggerLabel(job: DeployJob): string {
  if (job.triggerOnIssue && job.triggerOnRenew) return '首签 + 续签';
  if (job.triggerOnIssue) return '仅首签';
  if (job.triggerOnRenew) return '仅续签';
  return '仅手动';
}

export default function DeployJobSection() {
  const [jobs, setJobs] = useState<DeployJob[]>([]);
  const [orders, setOrders] = useState<CertificateOrder[]>([]);
  const [vendorOrders, setVendorOrders] = useState<VendorCertificate[]>([]);
  const [targets, setTargets] = useState<DeployTarget[]>([]);
  const [targetTypes, setTargetTypes] = useState<DeployTargetTypeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<DeployJob | null>(null);
  const [historyJob, setHistoryJob] = useState<DeployJob | null>(null);
  const [deleteJobRow, setDeleteJobRow] = useState<DeployJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [jobsRes, targetsRes, ordersRes, typesRes, vendorOrdersRes] = await Promise.all([
        getDeployJobs(),
        getDeployTargets(),
        getCertificateOrders(),
        getDeployTargetTypes(),
        getVendorCertificates(),
      ]);
      setJobs(jobsRes.data?.jobs || []);
      setTargets(targetsRes.data?.targets || []);
      setTargetTypes(typesRes.data?.types || []);
      setOrders((ordersRes.data?.orders || []).filter((item) => item.status === 'issued'));
      setVendorOrders((vendorOrdersRes.data?.orders || []).filter((item) => item.status === 'issued'));
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '加载部署任务失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const normalizedSearch = searchKeyword.trim().toLowerCase();
  const visibleJobs = useMemo(() => {
    if (!normalizedSearch) return jobs;
    return jobs.filter((job) =>
      [
        getDeployJobSourceLabel(job),
        job.target?.name,
        getDeployTargetTypeLabel(job.target?.type, targetTypes),
        summarizeDeployJobBinding(job),
        getTriggerLabel(job),
        job.lastStatus,
        job.lastError,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch))
    );
  }, [jobs, normalizedSearch, targetTypes]);

  const handleSubmit = async (payload: UpsertDeployJobInput) => {
    try {
      setSubmitting(true);
      if (editingJob) {
        await updateDeployJob(editingJob.id, payload);
        setSuccessMessage('部署任务已更新');
      } else {
        await createDeployJob(payload);
        setSuccessMessage('部署任务已创建');
      }
      setDialogOpen(false);
      setEditingJob(null);
      await loadData();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRun = async (job: DeployJob) => {
    try {
      setRunningId(job.id);
      setError(null);
      await runDeployJob(job.id);
      setSuccessMessage(`部署任务执行成功：${job.target?.name || job.id}`);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '执行部署任务失败'));
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteJobRow) return;
    try {
      setDeletingId(deleteJobRow.id);
      setError(null);
      await deleteDeployJob(deleteJobRow.id);
      setSuccessMessage('部署任务已删除');
      setDeleteJobRow(null);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '删除部署任务失败'));
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
            placeholder="搜索证书 / 目标 / 绑定..."
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={loadData} disabled={loading} sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}>
              刷新列表
            </Button>
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => {
                setEditingJob(null);
                setDialogOpen(true);
              }}
              disabled={(orders.length === 0 && vendorOrders.length === 0) || targets.length === 0}
              sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}
            >
              新增任务
            </Button>
          </Stack>
        </Stack>

        {!loading && orders.length === 0 && vendorOrders.length === 0 ? (
          <Alert severity="warning">暂无可部署证书，请先完成至少一张 ACME 或厂商证书签发。</Alert>
        ) : null}
        {!loading && targets.length === 0 ? <Alert severity="warning">暂无部署目标，请先到「部署目标」Tab 新增目标。</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {successMessage ? <Alert severity="success" onClose={() => setSuccessMessage(null)}>{successMessage}</Alert> : null}

        {loading ? (
          <Stack alignItems="center" py={4}>
            <CircularProgress size={24} />
          </Stack>
        ) : visibleJobs.length === 0 ? (
          <CertificateEmptyState
            title={normalizedSearch ? '未找到匹配的部署任务' : '暂无部署任务'}
            description={normalizedSearch ? '试试更换证书域名、目标名或绑定关键词。' : '把已签发证书绑定到部署目标后，就能自动推送或手动重推。'}
          />
        ) : (
          <TableContainer sx={{ width: '100%', overflowX: 'auto' }}>
            <Table
              size="small"
              sx={{
                minWidth: 1180,
                ...certificateTableSx,
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>证书</TableCell>
                  <TableCell>目标</TableCell>
                  <TableCell>绑定</TableCell>
                  <TableCell>自动触发</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>最近执行</TableCell>
                  <TableCell>最近成功</TableCell>
                  <TableCell align="right" sx={stickyHeaderCellSx}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleJobs.map((job) => (
                  <TableRow
                    key={job.id}
                    hover
                    sx={{
                      '&:hover .certificate-deploy-job-sticky-action': {
                        bgcolor: '#F8FAFC',
                      },
                    }}
                  >
                    <TableCell sx={{ minWidth: 220 }}>
                      <Stack spacing={0.5}>
                        <Typography variant="body1" fontWeight={600}>
                          {getDeployJobSourceLabel(job)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {job.sourceType === 'vendor'
                            ? `厂商订单 #${job.vendorCertificateOrderId || '-'}`
                            : `订单 #${job.certificateOrderId || '-'}`
                          }
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ minWidth: 200 }}>
                      <Stack spacing={0.5}>
                        <Typography variant="body1" fontWeight={500}>
                          {job.target?.name || `#${job.certificateDeployTargetId}`}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {getDeployTargetTypeLabel(job.target?.type, targetTypes)}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 180 }}>
                      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                        {summarizeDeployJobBinding(job)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Typography variant="body1">{getTriggerLabel(job)}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {job.enabled ? '任务已启用' : '任务已停用'}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ minWidth: 160 }}>
                      <Stack spacing={0.75} alignItems="flex-start">
                        <Chip
                          size="small"
                          icon={getDeployJobStatusIcon(job.lastStatus)}
                          label={getDeployJobStatusLabel(job.lastStatus)}
                          sx={getCertificateStatusChipSx(getStatusColor(job.lastStatus))}
                        />
                        {job.lastError ? (
                          <Typography variant="body2" color="error.main" sx={{ wordBreak: 'break-word' }}>
                            {job.lastError}
                          </Typography>
                        ) : null}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {job.lastTriggeredAt ? (
                        <Stack spacing={0.25}>
                          <Typography variant="body1">{formatRelativeTime(job.lastTriggeredAt)}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {formatDateTime(job.lastTriggeredAt)}
                          </Typography>
                        </Stack>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {job.lastSucceededAt ? (
                        <Stack spacing={0.25}>
                          <Typography variant="body1">{formatRelativeTime(job.lastSucceededAt)}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {formatDateTime(job.lastSucceededAt)}
                          </Typography>
                        </Stack>
                      ) : '-'}
                    </TableCell>
                    <TableCell
                      align="right"
                      className="certificate-deploy-job-sticky-action"
                      sx={{
                        ...stickyBodyCellSx,
                        minWidth: 320,
                      }}
                    >
                      <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="nowrap" sx={{ whiteSpace: 'nowrap' }}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<HistoryIcon />}
                          onClick={() => setHistoryJob(job)}
                        >
                          执行记录
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            setEditingJob(job);
                            setDialogOpen(true);
                          }}
                        >
                          编辑
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<RunIcon />}
                          onClick={() => handleRun(job)}
                          disabled={runningId === job.id}
                        >
                          {runningId === job.id ? '执行中...' : '手动执行'}
                        </Button>
                        <Button size="small" color="error" onClick={() => setDeleteJobRow(job)}>
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

      <DeployJobDialog
        open={dialogOpen}
        job={editingJob}
        orders={orders}
        vendorOrders={vendorOrders}
        targets={targets}
        targetTypes={targetTypes}
        submitting={submitting}
        onClose={() => {
          if (submitting) return;
          setDialogOpen(false);
          setEditingJob(null);
        }}
        onSubmit={handleSubmit}
      />

      <DeployJobRunHistoryDialog
        open={!!historyJob}
        job={historyJob}
        onClose={() => setHistoryJob(null)}
      />

      <Dialog open={!!deleteJobRow} onClose={() => setDeleteJobRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除部署任务</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ pt: 1 }}>
            确认删除任务 “{deleteJobRow?.target?.name || deleteJobRow?.id}” 吗？
          </Typography>
        </DialogContent>
        <DialogActions sx={certificateDialogActionsSx}>
          <Button onClick={() => setDeleteJobRow(null)} color="inherit" disabled={deletingId !== null}>
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
