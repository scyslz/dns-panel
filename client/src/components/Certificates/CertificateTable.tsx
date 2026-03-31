import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
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
  CheckCircle as SuccessIcon,
  Description as DraftIcon,
  ErrorOutline as ErrorIcon,
  InfoOutlined as InfoIcon,
  Pending as PendingIcon,
} from '@mui/icons-material';
import { CertificateOrder, CertificateStatus, getCertificateStatusColor, getCertificateStatusLabel, getRetryActionLabel } from '@/types/cert';
import { formatDateTime, formatRelativeTime } from '@/utils/formatters';
import CertificateEmptyState from './CertificateEmptyState';
import { certificateTableSx, getCertificateStatusChipSx, stickyBodyCellSx, stickyHeaderCellSx } from './certificateTableStyles';

function renderDate(value?: string | null) {
  if (!value) return '-';
  return formatDateTime(value);
}

function getOrderStatusIcon(status: CertificateStatus) {
  switch (status) {
    case 'draft':
      return <DraftIcon fontSize="small" />;
    case 'manual_dns_required':
      return <InfoIcon fontSize="small" />;
    case 'issued':
      return <SuccessIcon fontSize="small" />;
    case 'failed':
      return <ErrorIcon fontSize="small" />;
    default:
      return <PendingIcon fontSize="small" />;
  }
}

export default function CertificateTable({
  orders,
  loading,
  error,
  retryingId,
  downloadingId,
  deletingId,
  togglingAutoRenewId,
  emptyTitle,
  emptyDescription,
  onView,
  onRetry,
  onDownload,
  onDelete,
  onToggleAutoRenew,
}: {
  orders: CertificateOrder[];
  loading: boolean;
  error: string | null;
  retryingId: number | null;
  downloadingId: number | null;
  deletingId: number | null;
  togglingAutoRenewId: number | null;
  emptyTitle?: string;
  emptyDescription?: string;
  onView: (order: CertificateOrder) => void;
  onRetry: (order: CertificateOrder) => void;
  onDownload: (order: CertificateOrder) => void;
  onDelete: (order: CertificateOrder) => void;
  onToggleAutoRenew: (order: CertificateOrder, enabled: boolean) => void;
}) {
  if (loading) {
    return (
      <Stack alignItems="center" py={4}>
        <CircularProgress size={24} />
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (orders.length === 0) {
    return <CertificateEmptyState title={emptyTitle || '暂无证书订单'} description={emptyDescription || '可以先创建并申请，或先保存一份草稿。'} />;
  }

  return (
    <TableContainer sx={{ width: '100%', overflowX: 'auto' }}>
      <Table
        size="small"
        sx={{
          minWidth: 980,
          ...certificateTableSx,
          '& .MuiFormControlLabel-label': {
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'text.primary',
          },
        }}
      >
        <TableHead>
          <TableRow>
            <TableCell>主域名</TableCell>
            <TableCell>ACME账户</TableCell>
            <TableCell>DNS账户</TableCell>
            <TableCell>状态</TableCell>
            <TableCell>自动续期</TableCell>
            <TableCell>更新时间</TableCell>
            <TableCell>到期时间</TableCell>
            <TableCell align="right" sx={stickyHeaderCellSx}>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {orders.map((order) => {
            const retryLabel = getRetryActionLabel(order.status);
            const hasDeployJobs = (order.deployJobsCount || 0) > 0;

            const deleteAction = (
              <Button
                size="small"
                color="error"
                onClick={() => onDelete(order)}
                disabled={deletingId === order.id || hasDeployJobs}
              >
                {deletingId === order.id ? '删除中...' : '删除'}
              </Button>
            );

            const deleteActionWithTooltip = hasDeployJobs ? (
              <Tooltip title="该订单已绑定部署任务，无法删除">
                <span>{deleteAction}</span>
              </Tooltip>
            ) : deleteAction;

            return (
              <TableRow
                key={order.id}
                hover
                sx={{
                  '&:hover .certificate-order-sticky-action': {
                    bgcolor: '#F8FAFC',
                  },
                }}
              >
                <TableCell sx={{ minWidth: 220 }}>
                  <Typography variant="body1" fontWeight={600} color="text.primary">
                    {order.primaryDomain}
                  </Typography>
                </TableCell>
                <TableCell sx={{ minWidth: 220 }}>
                  <Typography variant="body1" fontWeight={500} color="text.primary">
                    {order.certificateCredential?.name || '-'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body1">{order.dnsCredential?.name || '-'}</Typography>
                </TableCell>
                <TableCell sx={{ minWidth: 170 }}>
                  <Stack spacing={0.75} alignItems="flex-start">
                    <Chip
                      size="small"
                      icon={getOrderStatusIcon(order.status)}
                      label={getCertificateStatusLabel(order.status)}
                      sx={getCertificateStatusChipSx(getCertificateStatusColor(order.status))}
                    />
                    {order.lastError ? (
                      <Tooltip title={order.lastError}>
                        <Typography variant="caption" color="error.main" sx={{ cursor: 'help' }}>
                          {order.lastError}
                        </Typography>
                      </Tooltip>
                    ) : null}
                  </Stack>
                </TableCell>
                <TableCell sx={{ minWidth: 120 }}>
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={
                      <Switch
                        size="small"
                        checked={order.autoRenew}
                        disabled={togglingAutoRenewId === order.id}
                        onChange={(event) => onToggleAutoRenew(order, event.target.checked)}
                      />
                    }
                    label={togglingAutoRenewId === order.id ? '提交中...' : (order.autoRenew ? '已开启' : '已关闭')}
                  />
                </TableCell>
                <TableCell sx={{ minWidth: 140, color: 'text.secondary' }}>
                  {formatRelativeTime(order.updatedAt)}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {renderDate(order.expiresAt)}
                </TableCell>
                <TableCell
                  align="right"
                  className="certificate-order-sticky-action"
                  sx={{
                    ...stickyBodyCellSx,
                    minWidth: 280,
                  }}
                >
                  <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="nowrap" sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" onClick={() => onView(order)}>
                      查看详情
                    </Button>
                    {order.canRetry ? (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => onRetry(order)}
                        disabled={retryingId === order.id}
                      >
                        {retryingId === order.id ? '处理中...' : retryLabel}
                      </Button>
                    ) : null}
                    {order.canDownload ? (
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => onDownload(order)}
                        disabled={downloadingId === order.id}
                      >
                        {downloadingId === order.id ? '下载中...' : '下载证书'}
                      </Button>
                    ) : null}
                    {deleteActionWithTooltip}
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
