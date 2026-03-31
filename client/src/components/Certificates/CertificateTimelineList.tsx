import { Alert, Box, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CertificateTimelineEntry } from '@/types/cert';
import { formatDateTime, formatRelativeTime } from '@/utils/formatters';

const CATEGORY_LABELS: Record<string, string> = {
  status: '状态',
  challenge: '验证',
  log: '事件',
  deployment: '部署',
};

const TONE_COLOR_MAP: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  default: 'default',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

function getToneColor(tone?: string | null) {
  return TONE_COLOR_MAP[String(tone || 'default')] || 'default';
}

function getItemSurfaceSx(tone?: string | null) {
  const color = getToneColor(tone);
  if (color === 'default') {
    return {
      borderColor: 'divider',
      bgcolor: 'background.paper',
    } as const;
  }

  return {
    borderColor: (theme: any) => alpha(theme.palette[color].main, 0.18),
    bgcolor: (theme: any) => alpha(theme.palette[color].main, 0.04),
  } as const;
}

export default function CertificateTimelineList({
  items,
  loading = false,
  error = null,
  emptyText = '暂无时间线记录',
}: {
  items: CertificateTimelineEntry[];
  loading?: boolean;
  error?: string | null;
  emptyText?: string;
}) {
  if (loading) {
    return (
      <Stack alignItems="center" py={2}>
        <CircularProgress size={20} />
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!items.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      {items.map((item) => {
        const color = getToneColor(item.tone);
        return (
          <Box
            key={item.id}
            sx={{
              border: '1px solid',
              borderRadius: 2,
              px: 1.5,
              py: 1.25,
              ...getItemSurfaceSx(item.tone),
            }}
          >
            <Stack spacing={0.75}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" fontWeight={600}>
                    {item.title}
                  </Typography>
                  <Chip
                    size="small"
                    color={color}
                    variant={color === 'default' ? 'outlined' : 'filled'}
                    label={CATEGORY_LABELS[item.category] || item.category}
                  />
                </Stack>
                {item.timestamp ? (
                  <Stack spacing={0} alignItems={{ xs: 'flex-start', sm: 'flex-end' }}>
                    <Typography variant="caption" color="text.secondary">
                      {formatRelativeTime(item.timestamp)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(item.timestamp)}
                    </Typography>
                  </Stack>
                ) : null}
              </Stack>
              {item.description ? (
                <Typography variant="body2" color={color === 'error' ? 'error.main' : 'text.secondary'} sx={{ wordBreak: 'break-word' }}>
                  {item.description}
                </Typography>
              ) : null}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
