import { Box, Typography } from '@mui/material';
import { ReactNode } from 'react';

export default function CertificateEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Box
      sx={{
        border: (theme) => `1px dashed ${theme.palette.divider}`,
        borderRadius: 2,
        px: 2.5,
        py: 3,
        bgcolor: 'background.default',
      }}
    >
      <Typography variant="body2" fontWeight={600}>
        {title}
      </Typography>
      {description ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      ) : null}
      {action ? <Box sx={{ mt: 1.5 }}>{action}</Box> : null}
    </Box>
  );
}
