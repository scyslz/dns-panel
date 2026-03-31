import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Download as DownloadIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { getDnsCredentials } from '@/services/dnsCredentials';
import {
  createVendorCertificateOrder,
  downloadVendorCertificateOrder,
  getVendorCertificateProviders,
  getVendorCertificates,
  retryVendorCertificateOrder,
} from '@/services/certificates';
import { DnsCredential } from '@/types/dns';
import {
  CreateVendorCertificateOrderInput,
  VendorCertificate,
  VendorCertificateProvider,
  VendorCertificateProviderDefinition,
  getVendorCertificateProviderLabel,
  getVendorCertificateStatusColor,
  getVendorCertificateStatusLabel,
} from '@/types/cert';
import { formatDateTime, formatRelativeTime } from '@/utils/formatters';
import CertificateEmptyState from './CertificateEmptyState';
import CertificateSearchField from './CertificateSearchField';
import { certificateSecondaryTabsSx, certificateTableSx, certificateToolbarSx, getCertificateStatusChipSx, stickyBodyCellSx, stickyHeaderCellSx } from './certificateTableStyles';
import { triggerDownload } from './certificateUtils';
import VendorCertificateDetailDialog from './VendorCertificateDetailDialog';
import VendorCertificateDialog from './VendorCertificateDialog';

const PENDING_STATUSES = ['queued', 'pending_validation', 'issuing'];

function summarizeValidation(order: VendorCertificate): string {
  if (order.lastError) return order.lastError;
  if (order.provider === 'tencent_ssl') {
    return (
      order.validationPayload?.summary?.awaitingValidationMsg ||
      order.validationPayload?.summary?.statusName ||
      '-'
    );
  }

  return (
    order.validationPayload?.state?.Message ||
    order.validationPayload?.detail?.CertificateInfo?.State ||
    order.validationPayload?.authInfo?.auths?.[0]?.authStatus ||
    '-'
  );
}

export default function VendorCertificateSection() {
  const [orders, setOrders] = useState<VendorCertificate[]>([]);
  const [providers, setProviders] = useState<VendorCertificateProviderDefinition[]>([]);
  const [credentials, setCredentials] = useState<DnsCredential[]>([]);
  const [activeProvider, setActiveProvider] = useState<VendorCertificateProvider>('tencent_ssl');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<VendorCertificate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');

  const loadData = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const [ordersRes, providersRes, credentialsRes] = await Promise.all([
        getVendorCertificates(),
        getVendorCertificateProviders(),
        getDnsCredentials(),
      ]);
      setOrders(ordersRes.data?.orders || []);
      setProviders(providersRes.data?.providers || []);
      setCredentials(credentialsRes.data?.credentials || []);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '加载厂商证书失败'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (providers.length === 0) return;
    if (providers.some((item) => item.provider === activeProvider)) return;
    setActiveProvider(providers[0].provider);
  }, [providers, activeProvider]);

  const normalizedSearch = searchKeyword.trim().toLowerCase();
  const providerOrders = useMemo(
    () => orders.filter((order) => order.provider === activeProvider),
    [orders, activeProvider]
  );
  const visibleOrders = useMemo(() => {
    const scoped = providerOrders;
    if (!normalizedSearch) return scoped;
    return scoped.filter((order) =>
      [
        order.primaryDomain,
        ...(order.domains || []),
        order.vendorCredential?.name,
        order.validationDnsCredential?.name,
        getVendorCertificateProviderLabel(order.provider),
        getVendorCertificateStatusLabel(order.status),
        order.status,
        summarizeValidation(order),
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch))
    );
  }, [providerOrders, normalizedSearch]);
  const hasPendingOrders = useMemo(
    () => providerOrders.some((order) => PENDING_STATUSES.includes(order.status)),
    [providerOrders]
  );

  useEffect(() => {
    if (!detailOrder) return;
    const nextOrder = orders.find((order) => order.id === detailOrder.id) || null;
    if (!nextOrder) {
      setDetailOrder(null);
      return;
    }
    if (nextOrder.id === detailOrder.id && nextOrder.updatedAt !== detailOrder.updatedAt) {
      setDetailOrder(nextOrder);
    }
  }, [orders, detailOrder]);

  useEffect(() => {
    if (!hasPendingOrders) return;
    const timer = window.setInterval(() => {
      loadData({ silent: true });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [hasPendingOrders, loadData]);

  const handleCreate = async (payload: CreateVendorCertificateOrderInput) => {
    try {
      setSubmitting(true);
      await createVendorCertificateOrder(payload);
      setDialogOpen(false);
      setSuccessMessage('厂商证书订单已创建');
      await loadData();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async (order: VendorCertificate) => {
    try {
      setRetryingId(order.id);
      setError(null);
      await retryVendorCertificateOrder(order.id);
      setSuccessMessage(`已提交重试：${order.primaryDomain}`);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '提交重试失败'));
    } finally {
      setRetryingId(null);
    }
  };

  const handleDownload = async (order: VendorCertificate) => {
    try {
      setDownloadingId(order.id);
      setError(null);
      const blob = await downloadVendorCertificateOrder(order.id);
      triggerDownload(blob, `vendor-certificate-${order.id}.zip`);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '下载厂商证书失败'));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleOpenDetail = (order: VendorCertificate) => {
    setDetailOrder(order);
  };

  const handleRetryClick = async (event: MouseEvent<HTMLButtonElement>, order: VendorCertificate) => {
    event.stopPropagation();
    await handleRetry(order);
  };

  const handleDownloadClick = async (event: MouseEvent<HTMLButtonElement>, order: VendorCertificate) => {
    event.stopPropagation();
    await handleDownload(order);
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
            placeholder="搜索域名 / 厂商凭证 / 验证 DNS..."
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={() => loadData()} disabled={loading} sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}>
              刷新列表
            </Button>
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => setDialogOpen(true)}
              disabled={providers.length === 0}
              sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}
            >
              新增申请
            </Button>
          </Stack>
        </Stack>

        {hasPendingOrders ? (
          <Typography variant="body2" color="text.secondary">
            当前渠道有待处理订单，列表会每 15 秒自动刷新。
          </Typography>
        ) : null}
        {providers.length > 0 ? (
          <Tabs
            value={activeProvider}
            onChange={(_event, nextValue) => setActiveProvider(nextValue)}
            variant="scrollable"
            scrollButtons="auto"
            sx={certificateSecondaryTabsSx}
          >
            {providers.map((provider) => (
              <Tab
                key={provider.provider}
                value={provider.provider}
                label={provider.label}
              />
            ))}
          </Tabs>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {successMessage ? <Alert severity="success" onClose={() => setSuccessMessage(null)}>{successMessage}</Alert> : null}

        {loading ? (
          <Stack alignItems="center" py={4}>
            <CircularProgress size={24} />
          </Stack>
        ) : visibleOrders.length === 0 ? (
          <CertificateEmptyState
            title={normalizedSearch ? '未找到匹配的厂商证书订单' : '当前渠道暂无订单'}
            description={normalizedSearch ? '试试更换域名、DNS 凭证或状态关键词。' : '可以直接发起新的厂商证书申请。'}
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
                  <TableCell>域名</TableCell>
                  <TableCell>渠道</TableCell>
                  <TableCell>厂商凭证</TableCell>
                  <TableCell>验证 DNS</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>验证/错误信息</TableCell>
                  <TableCell>到期</TableCell>
                  <TableCell>最近同步</TableCell>
                  <TableCell align="right" sx={stickyHeaderCellSx}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleOrders.map((order) => (
                  <TableRow
                    key={order.id}
                    hover
                    onClick={() => handleOpenDetail(order)}
                    sx={{
                      cursor: 'pointer',
                      '&:hover .certificate-vendor-sticky-action': {
                        bgcolor: '#F8FAFC',
                      },
                    }}
                  >
                    <TableCell sx={{ minWidth: 220 }}>
                      <Stack spacing={0.5}>
                        <Typography variant="body1" fontWeight={600}>
                          {order.primaryDomain}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {order.domains.join(', ')}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ minWidth: 140 }}>
                      <Typography variant="body1">{getVendorCertificateProviderLabel(order.provider)}</Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <Typography variant="body1">{order.vendorCredential?.name || '-'}</Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <Typography variant="body1">{order.validationDnsCredential?.name || '-'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" icon={undefined} label={getVendorCertificateStatusLabel(order.status)} sx={getCertificateStatusChipSx(getVendorCertificateStatusColor(order.status) as any)} />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography
                        variant="body2"
                        color={order.lastError ? 'error.main' : 'text.primary'}
                        sx={{ wordBreak: 'break-word' }}
                      >
                        {summarizeValidation(order)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 150 }}>
                      <Typography variant="body1">{order.expiresAt ? formatDateTime(order.expiresAt) : '-'}</Typography>
                    </TableCell>
                    <TableCell>
                      {order.lastSyncAt ? (
                        <Stack spacing={0.25}>
                          <Typography variant="body1">{formatRelativeTime(order.lastSyncAt)}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {formatDateTime(order.lastSyncAt)}
                          </Typography>
                        </Stack>
                      ) : '-'}
                    </TableCell>
                    <TableCell
                      align="right"
                      className="certificate-vendor-sticky-action"
                      sx={{
                        ...stickyBodyCellSx,
                        minWidth: 220,
                      }}
                    >
                      <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="nowrap" sx={{ whiteSpace: 'nowrap' }}>
                        <Button
                          size="small"
                          color="inherit"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenDetail(order);
                          }}
                        >
                          详情
                        </Button>
                        {order.canRetry ? (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={(event) => handleRetryClick(event, order)}
                            disabled={retryingId === order.id}
                          >
                            {retryingId === order.id ? '提交中...' : '重试'}
                          </Button>
                        ) : null}
                        {order.canDownload ? (
                          <Button
                            size="small"
                            startIcon={<DownloadIcon />}
                            onClick={(event) => handleDownloadClick(event, order)}
                            disabled={downloadingId === order.id}
                          >
                            {downloadingId === order.id ? '下载中...' : '下载'}
                          </Button>
                        ) : null}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>

      <VendorCertificateDialog
        open={dialogOpen}
        providers={providers}
        credentials={credentials}
        preferredProvider={activeProvider}
        submitting={submitting}
        onClose={() => {
          if (submitting) return;
          setDialogOpen(false);
        }}
        onSubmit={handleCreate}
      />
      <VendorCertificateDetailDialog
        open={!!detailOrder}
        orderId={detailOrder?.id || null}
        initialOrder={detailOrder}
        retrying={retryingId === detailOrder?.id}
        downloading={downloadingId === detailOrder?.id}
        onClose={() => setDetailOrder(null)}
        onRetry={handleRetry}
        onDownload={handleDownload}
      />
    </>
  );
}
