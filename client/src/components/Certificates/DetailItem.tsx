import { Box, Typography } from '@mui/material';

export default function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="body2" fontWeight={600} color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
        {value || '-'}
      </Typography>
    </Box>
  );
}

export function renderDate(value?: string | null, formatter?: (v: string) => string) {
  if (!value) return '-';
  return formatter ? formatter(value) : value;
}
