import { alpha, type Theme } from '@mui/material/styles';

export const certificateTableSx = {
  '& .MuiTableCell-root': {
    px: 1.75,
    py: 1.5,
    verticalAlign: 'top',
    fontSize: '0.875rem',
  },
  '& .MuiTypography-body1': {
    fontSize: '0.875rem',
    lineHeight: 1.5,
  },
  '& .MuiTypography-body2': {
    lineHeight: 1.5,
  },
  '& .MuiTableCell-head': {
    py: 1.75,
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    fontWeight: 600,
  },
} as const;

export const stickyHeaderCellSx = {
  position: 'sticky' as const,
  right: 0,
  zIndex: 2,
  bgcolor: '#F8FAFC',
  boxShadow: '-4px 0 8px -4px rgba(0,0,0,0.12)',
};

export const stickyBodyCellSx = {
  position: 'sticky' as const,
  right: 0,
  zIndex: 1,
  bgcolor: 'background.paper',
  boxShadow: '-4px 0 8px -4px rgba(0,0,0,0.08)',
};

export const certificateToolbarSx = {
  mb: 1,
};

export const certificateSearchFieldSx = {
  width: { xs: '100%', sm: 300 },
  '& .MuiOutlinedInput-root': {
    bgcolor: 'background.paper',
  },
} as const;

export const certificateStatusChipBaseSx = {
  fontWeight: 600,
  border: 'none',
  '& .MuiChip-icon': {
    color: 'inherit',
  },
} as const;

export function getCertificateStatusChipSx(color: 'default' | 'success' | 'warning' | 'error' | 'info') {
  if (color === 'default') {
    return {
      ...certificateStatusChipBaseSx,
      bgcolor: '#F8FAFC',
      color: 'text.secondary',
    };
  }

  return {
    ...certificateStatusChipBaseSx,
    bgcolor: (theme: Theme) => alpha(theme.palette[color].main, 0.1),
    color: (theme: Theme) => theme.palette[color].dark,
  };
}

export const certificateSecondaryTabsSx = {
  minHeight: 48,
  px: 0.5,
  pb: 0.5,
  borderBottom: '1px solid',
  borderColor: 'divider',
  '& .MuiTabs-indicator': {
    display: 'none',
  },
  '& .MuiTab-root': {
    minHeight: 40,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    mr: 1,
    px: 1.5,
    borderRadius: '10px',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: 'text.secondary',
    '&.Mui-selected': {
      color: 'primary.main',
      bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.1),
      fontWeight: 700,
    },
    '&:hover': {
      bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.04),
    },
  },
} as const;

export const certificateDialogTitleSx = {
  px: 3,
  pt: 2.5,
  pb: 1,
};

export const certificateDialogContentSx = {
  px: 3,
  pt: '12px !important',
  pb: 2,
};

export const certificateDialogActionsSx = {
  px: 3,
  pb: 2.5,
  pt: 1,
};
