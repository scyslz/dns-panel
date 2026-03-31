import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { getDeployJobRuns } from '@/services/certificates';
import { CertificateTimelineEntry, DeployJob, DeployJobRun, DeployJobRunSummary, getDeployTargetTypeLabel } from '@/types/cert';
import { formatDateTime, formatRelativeTime } from '@/utils/formatters';
import { certificateDialogActionsSx, certificateDialogContentSx, certificateDialogTitleSx } from './certificateTableStyles';
import CertificateTimelineList from './CertificateTimelineList';

function getRunStatusColor(status?: string | null): 'default' | 'info' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'pending':
      return 'info';
    case 'running':
      return 'warning';
    case 'success':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
}

function getRunStatusLabel(status?: string | null) {
  switch (status) {
    case 'pending':
      return '待执行';
    case 'running':
      return '执行中';
    case 'success':
      return '成功';
    case 'failed':
      return '失败';
    case 'skipped':
      return '已跳过';
    default:
      return status || '未知';
  }
}

function getTriggerModeLabel(mode?: string | null) {
  return mode === 'manual' ? '手动' : mode === 'auto' ? '自动' : (mode || '-');
}

function getEventLabel(event?: string | null) {
  return event === 'certificate.renewed' ? '续签' : event === 'certificate.issued' ? '首签' : (event || '-');
}

function RunItem({ run }: { run: DeployJobRun }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 1.5, py: 1.25 }}>
      <Stack spacing={0.75}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" color={getRunStatusColor(run.status)} label={getRunStatusLabel(run.status)} />
            <Chip size="small" variant="outlined" label={getTriggerModeLabel(run.triggerMode)} />
            <Chip size="small" variant="outlined" label={getEventLabel(run.event)} />
          </Stack>
          {run.scheduledAt ? (
            <Stack spacing={0} alignItems={{ xs: 'flex-start', sm: 'flex-end' }}>
              <Typography variant="caption" color="text.secondary">
                {formatRelativeTime(run.scheduledAt)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatDateTime(run.scheduledAt)}
              </Typography>
            </Stack>
          ) : null}
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
            gap: 1,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            入队：{run.scheduledAt ? formatDateTime(run.scheduledAt) : '-'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            开始：{run.startedAt ? formatDateTime(run.startedAt) : '-'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            完成：{run.finishedAt ? formatDateTime(run.finishedAt) : '-'}
          </Typography>
        </Box>

        {run.lastError ? (
          <Typography variant="body2" color="error.main" sx={{ wordBreak: 'break-word' }}>
            {run.lastError}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

export default function DeployJobRunHistoryDialog({
  open,
  job,
  onClose,
}: {
  open: boolean;
  job: DeployJob | null;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<DeployJobRunSummary | null>(null);
  const [runs, setRuns] = useState<DeployJobRun[]>([]);
  const [logs, setLogs] = useState<CertificateTimelineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !job) return;
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await getDeployJobRuns(job.id);
        if (!active) return;
        setSummary(response.data?.job || null);
        setRuns(response.data?.runs || []);
        setLogs(response.data?.logs || []);
      } catch (err: any) {
        if (!active) return;
        setError(typeof err === 'string' ? err : (err?.message || '加载执行记录失败'));
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [open, job]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={certificateDialogTitleSx}>
        <Typography variant="body1" fontWeight={600} noWrap>
          执行记录 · {job?.target?.name || `任务 #${job?.id || '-'}`}
        </Typography>
      </DialogTitle>
      <DialogContent sx={certificateDialogContentSx}>
        <Stack spacing={1.5}>
          {summary ? (
            <Stack spacing={0.5}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip size="small" variant="outlined" label={summary.primaryDomain || '-'} />
                <Chip size="small" variant="outlined" label={getDeployTargetTypeLabel(summary.targetType)} />
                {summary.lastStatus ? (
                  <Chip size="small" color={getRunStatusColor(summary.lastStatus)} label={getRunStatusLabel(summary.lastStatus)} />
                ) : null}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {summary.targetName} · 最近触发 {summary.lastTriggeredAt ? formatDateTime(summary.lastTriggeredAt) : '-'}
              </Typography>
              {summary.lastError ? (
                <Typography variant="body2" color="error.main" sx={{ wordBreak: 'break-word' }}>
                  {summary.lastError}
                </Typography>
              ) : null}
            </Stack>
          ) : null}

          {error ? <Alert severity="error">{error}</Alert> : null}

          <Stack spacing={1}>
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              执行批次
            </Typography>
            {loading ? null : runs.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                暂无执行记录。
              </Typography>
            ) : (
              <Stack spacing={1}>
                {runs.map((run) => (
                  <RunItem key={run.id} run={run} />
                ))}
              </Stack>
            )}
          </Stack>

          <Divider />

          <Stack spacing={1}>
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              相关日志
            </Typography>
            <CertificateTimelineList items={logs} loading={loading && runs.length === 0} emptyText="暂无相关部署日志" />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={certificateDialogActionsSx}>
        <Button onClick={onClose} color="inherit">
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
}
