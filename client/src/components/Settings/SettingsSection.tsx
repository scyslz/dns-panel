import { PropsWithChildren, ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

interface SettingsSectionProps extends PropsWithChildren {
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function SettingsSection({ title, description, action, children }: SettingsSectionProps) {
  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.25}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'flex-start' }}
      >
        <Stack spacing={0.5}>
          <Typography variant="subtitle1" fontWeight={600}>
            {title}
          </Typography>
          {description ? (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          ) : null}
        </Stack>
        {action ? <Box sx={{ width: { xs: '100%', sm: 'auto' } }}>{action}</Box> : null}
      </Stack>
      {children}
    </Stack>
  );
}
