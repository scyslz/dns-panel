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
import { getVendorCertificateOrder, getVendorCertificateTimeline } from '@/services/certificates';
import {
  CertificateTimelineEntry,
  VendorCertificate,
  getVendorCertificateProviderLabel,
  getVendorCertificateStatusColor,
  getVendorCertificateStatusLabel,
} from '@/types/cert';
import { formatDateTime } from '@/utils/formatters';
import { certificateDialogActionsSx, certificateDialogContentSx, certificateDialogTitleSx } from './certificateTableStyles';
import CertificateTimelineList from './CertificateTimelineList';
import DetailItem from './DetailItem';

function renderDate(value?: string | null) {
  if (!value) return '-';
  return formatDateTime(value);
}

function CopyableValue({
  label,
  value,
  copiedValue,
  onCopy,
}: {
  label: string;
  value?: string | null;
  copiedValue: string | null;
  onCopy: (value: string) => void;
}) {
  return (
    <Box>
      <Typography variant="body2" fontWeight={600} color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" sx={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>
          {value || '-'}
        </Typography>
        {value ? (
          <Tooltip title={copiedValue === value ? '已复制' : '复制'}>
            <IconButton size="small" onClick={() => onCopy(value)}>
              <CopyIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
    </Box>
  );
}

export default function VendorCertificateDetailDialog({
  open,
  orderId,
  initialOrder,
  retrying,
  downloading,
  onClose,
  onRetry,
  onDownload,
}: {
  open: boolean;
  orderId: number | null;
  initialOrder: VendorCertificate | null;
  retrying: boolean;
  downloading: boolean;
  onClose: () => void;
  onRetry?: (order: VendorCertificate) => void;
  onDownload?: (order: VendorCertificate) => void;
}) {
  const [order, setOrder] = useState<VendorCertificate | null>(initialOrder);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<CertificateTimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const isPending = useMemo(
    () => !!order && ['queued', 'pending_validation', 'issuing'].includes(order.status),
    [order]
  );

  useEffect(() => {
    if (!open) return;
    setOrder(initialOrder);
  }, [open, initialOrder]);

  useEffect(() => {
    if (!open || !orderId) return;

    let active = true;
    const loadOrder = async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const response = await getVendorCertificateOrder(orderId);
        if (!active) return;
        setOrder(response.data?.order || null);
      } catch (error: any) {
        if (!active) return;
        setLoadError(typeof error === 'string' ? error : (error?.message || '加载详情失败'));
      } finally {
        if (active) setLoading(false);
      }
    };

    loadOrder();
    return () => {
      active = false;
    };
  }, [open, orderId]);

  useEffect(() => {
    if (!open || !orderId) return;

    let active = true;
    const loadTimeline = async () => {
      try {
        setTimelineLoading(true);
        setTimelineError(null);
        const response = await getVendorCertificateTimeline(orderId);
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
  }, [open, orderId]);

  useEffect(() => {
    if (!open || !orderId || !isPending) return;
    let active = true;
    let timer: number;
    const poll = async () => {
      try {
        const [orderResponse, timelineResponse] = await Promise.all([
          getVendorCertificateOrder(orderId),
          getVendorCertificateTimeline(orderId),
        ]);
        if (!active) return;
        setOrder(orderResponse.data?.order || null);
        setTimeline(timelineResponse.data?.timeline || []);
      } catch {
        // ignore polling errors
      }
      if (active) timer = window.setTimeout(poll, 15000);
    };
    timer = window.setTimeout(poll, 15000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, orderId, isPending]);

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

  if (!order) return null;

  const tencentSummary = order.provider === 'tencent_ssl' ? order.validationPayload?.summary || null : null;
  const aliyunState = order.provider === 'aliyun_ssl' ? order.validationPayload?.state || null : null;
  const ucloudDetail = order.provider === 'ucloud_ssl' ? order.validationPayload?.detail || null : null;
  const validationRecords = Array.isArray(order.validationPayload?.dnsRecords) ? order.validationPayload.dnsRecords : [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={certificateDialogTitleSx}>
        <Typography variant="body1" fontWeight={600} noWrap>
          厂商证书详情 · {order.primaryDomain}
        </Typography>
      </DialogTitle>
      <DialogContent sx={certificateDialogContentSx}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip color={getVendorCertificateStatusColor(order.status)} label={getVendorCertificateStatusLabel(order.status)} />
            <Chip variant="outlined" label={getVendorCertificateProviderLabel(order.provider)} />
            <Typography variant="body2" color="text.secondary">
              订单 #{order.id}
            </Typography>
          </Stack>

          {loading ? <Typography variant="body2" color="text.secondary">正在刷新最新状态...</Typography> : null}
          {loadError ? <Alert severity="error">{loadError}</Alert> : null}
          {order.lastError ? <Alert severity="error">{order.lastError}</Alert> : null}
          {isPending ? <Typography variant="body2" color="text.secondary">当前订单处理中，详情会每 15 秒自动刷新一次。</Typography> : null}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
              gap: 2,
            }}
          >
            <DetailItem label="主域名" value={order.primaryDomain} />
            <DetailItem label="厂商渠道" value={getVendorCertificateProviderLabel(order.provider)} />
            <DetailItem label="厂商凭证" value={order.vendorCredential?.name || '-'} />
            <DetailItem label="验证 DNS" value={order.validationDnsCredential?.name || '-'} />
            <DetailItem label="创建时间" value={renderDate(order.createdAt)} />
            <DetailItem label="签发时间" value={renderDate(order.issuedAt)} />
            <DetailItem label="到期时间" value={renderDate(order.expiresAt)} />
            <DetailItem label="最近同步" value={renderDate(order.lastSyncAt)} />
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

          <Divider />

          <Stack spacing={1.5}>
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              渠道信息
            </Typography>
            <CopyableValue label="Provider Order ID" value={order.providerOrderId} copiedValue={copiedValue} onCopy={handleCopy} />
            <CopyableValue label="Provider Certificate ID" value={order.providerCertificateId} copiedValue={copiedValue} onCopy={handleCopy} />

            {order.provider === 'tencent_ssl' ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2,
                }}
              >
                <DetailItem label="状态名称" value={String(tencentSummary?.statusName || '-')} />
                <DetailItem label="验证方式" value={String(tencentSummary?.verifyType || '-')} />
                <DetailItem
                  label="允许下载"
                  value={
                    tencentSummary?.allowDownload === null || tencentSummary?.allowDownload === undefined
                      ? '-'
                      : (tencentSummary.allowDownload ? '是' : '否')
                  }
                />
                <DetailItem label="等待校验信息" value={String(tencentSummary?.awaitingValidationMsg || '-')} />
              </Box>
            ) : (
              <Stack spacing={1.5}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                    gap: 2,
                  }}
                >
                  <DetailItem label="订单状态" value={String(aliyunState?.Type || ucloudDetail?.CertificateInfo?.State || '-')} />
                  <DetailItem label="说明" value={String(aliyunState?.Message || ucloudDetail?.CertificateInfo?.StateCode || '-')} />
                  <DetailItem label="厂商证书 ID" value={String(aliyunState?.CertId || ucloudDetail?.CertificateInfo?.CertificateID || order.providerCertificateId || '-')} />
                  <DetailItem label="主机名" value={String(aliyunState?.Domain || ucloudDetail?.CertificateInfo?.Domains || order.primaryDomain)} />
                  <DetailItem label="签发开始" value={renderDate(ucloudDetail?.CertificateInfo?.IssuedDate || null)} />
                  <DetailItem label="厂商到期" value={renderDate(ucloudDetail?.CertificateInfo?.ExpiredDate || null)} />
                </Box>

                {validationRecords.length > 0 ? (
                  <Stack spacing={1}>
                    <Typography variant="body2" fontWeight={600}>
                      DNS 校验记录
                    </Typography>
                    {validationRecords.map((record: any, index: number) => (
                      <Box
                        key={`${record?.fqdn || 'record'}-${index}`}
                        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
                      >
                        <Stack spacing={0.5}>
                          <Typography variant="body2" fontWeight={600}>
                            {String(record?.fqdn || '-')}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            类型：{String(record?.type || '-')} / Host：{String(record?.host || '-')} / Value：{String(record?.value || '-')}
                          </Typography>
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
                ) : null}
              </Stack>
            )}
          </Stack>

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
            {retrying ? '处理中...' : '重试'}
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
