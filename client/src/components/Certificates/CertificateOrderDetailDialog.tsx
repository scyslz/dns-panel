import { useEffect, useMemo, useState } from 'react';
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
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';
import { getCertificateOrderTimeline } from '@/services/certificates';
import {
  CertificateOrder,
  CertificateTimelineEntry,
  getCertificateStatusColor,
  getCertificateStatusLabel,
  getRetryActionLabel,
} from '@/types/cert';
import { formatDateTime } from '@/utils/formatters';
import { certificateDialogActionsSx, certificateDialogContentSx, certificateDialogTitleSx } from './certificateTableStyles';
import CertificateTimelineList from './CertificateTimelineList';
import DetailItem from './DetailItem';

function renderDate(value?: string | null) {
  if (!value) return '-';
  return formatDateTime(value);
}

export default function CertificateOrderDetailDialog({
  open,
  order,
  retrying,
  downloading,
  onClose,
  onRetry,
  onDownload,
}: {
  open: boolean;
  order: CertificateOrder | null;
  retrying: boolean;
  downloading: boolean;
  onClose: () => void;
  onRetry?: (order: CertificateOrder) => void;
  onDownload?: (order: CertificateOrder) => void;
}) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<CertificateTimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const retryLabel = useMemo(() => {
    if (!order) return '重试';
    return getRetryActionLabel(order.status);
  }, [order]);

  useEffect(() => {
    if (!open || !order) return;
    let active = true;

    const loadTimeline = async () => {
      try {
        setTimelineLoading(true);
        setTimelineError(null);
        const response = await getCertificateOrderTimeline(order.id);
        if (!active) return;
        setTimeline(response.data?.timeline || []);
      } catch (error: any) {
        if (!active) return;
        setTimelineError(typeof error === 'string' ? error : (error?.message || '加载时间线失败'));
      } finally {
        if (active) setTimelineLoading(false);
      }
    };

    loadTimeline();
    return () => {
      active = false;
    };
  }, [open, order?.id]);

  if (!order) return null;

  const handleCopy = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      window.setTimeout(() => setCopiedValue(null), 1200);
    } catch {
      setCopiedValue(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={certificateDialogTitleSx}>
        <Typography variant="body1" fontWeight={600} noWrap>
          订单详情 · {order.primaryDomain}
        </Typography>
      </DialogTitle>
      <DialogContent sx={certificateDialogContentSx}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip color={getCertificateStatusColor(order.status)} label={getCertificateStatusLabel(order.status)} />
            <Typography variant="body2" color="text.secondary">
              订单 #{order.id}
            </Typography>
          </Stack>

          {order.status === 'manual_dns_required' ? (
            <Alert severity="warning">请根据下方 challenge 信息手动添加 TXT 记录，生效后点击“继续验证”。</Alert>
          ) : null}

          {order.lastError ? <Alert severity="error">{order.lastError}</Alert> : null}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            <DetailItem label="主域名" value={order.primaryDomain} />
            <DetailItem label="ACME账户" value={order.certificateCredential?.name || '-'} />
            <DetailItem label="DNS账户" value={order.dnsCredential?.name || '-'} />
            <DetailItem label="签发时间" value={renderDate(order.issuedAt)} />
            <DetailItem label="到期时间" value={renderDate(order.expiresAt)} />
            <DetailItem label="自动续期" value={order.autoRenew ? '已开启' : '已关闭'} />
            <DetailItem label="下次重试" value={renderDate(order.nextRetryAt)} />
            <DetailItem label="更新时间" value={renderDate(order.updatedAt)} />
          </Box>

          <Divider />

          <Stack spacing={1}>
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              证书域名
            </Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {order.domains.join(', ')}
            </Typography>
          </Stack>

          {order.challengeRecords.length > 0 ? (
            <>
              <Divider />
              <Stack spacing={1.25}>
                <Typography variant="body2" fontWeight={600} color="text.secondary">
                  Challenge 信息
                </Typography>
                {order.challengeRecords.map((record) => (
                  <Box
                    key={`${record.identifier}-${record.recordName}`}
                    sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
                  >
                    <Stack spacing={1}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography variant="body2" fontWeight={600}>
                          {record.identifier}
                        </Typography>
                        <Chip
                          size="small"
                          color={record.mode === 'manual' ? 'info' : 'success'}
                          label={record.mode === 'manual' ? '手动' : '自动'}
                          variant="outlined"
                        />
                      </Stack>

                      <DetailItem label="记录主机" value={record.recordHost || '-'} />

                      <Box>
                        <Typography variant="body2" fontWeight={600} color="text.secondary">
                          记录名称
                        </Typography>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            {record.recordName}
                          </Typography>
                          <Tooltip title={copiedValue === record.recordName ? '已复制' : '复制'}>
                            <IconButton size="small" onClick={() => handleCopy(record.recordName)}>
                              <CopyIcon fontSize="inherit" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Box>

                      <Box>
                        <Typography variant="body2" fontWeight={600} color="text.secondary">
                          TXT 值
                        </Typography>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            {record.recordValue}
                          </Typography>
                          <Tooltip title={copiedValue === record.recordValue ? '已复制' : '复制'}>
                            <IconButton size="small" onClick={() => handleCopy(record.recordValue)}>
                              <CopyIcon fontSize="inherit" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Box>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </>
          ) : null}

          <Divider />

          <Stack spacing={1}>
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              时间线
            </Typography>
            <CertificateTimelineList items={timeline} loading={timelineLoading} error={timelineError} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={certificateDialogActionsSx}>
        <Button onClick={onClose} color="inherit">
          关闭
        </Button>
        {order.canRetry && onRetry ? (
          <Button variant="outlined" onClick={() => onRetry(order)} disabled={retrying}>
            {retrying ? '处理中...' : retryLabel}
          </Button>
        ) : null}
        {order.canDownload && onDownload ? (
          <Button variant="contained" onClick={() => onDownload(order)} disabled={downloading}>
            {downloading ? '下载中...' : '下载证书'}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
