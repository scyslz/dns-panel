import { alpha, Box, Card, CardContent, Divider, Tab, Tabs } from '@mui/material';
import { useState, type SyntheticEvent } from 'react';
import AcmeAccountSection from './AcmeAccountSection';
import CertificateAliasSection from './CertificateAliasSection';
import CertificateOrderSection from './CertificateOrderSection';
import DeployJobSection from './DeployJobSection';
import DeployTargetSection from './DeployTargetSection';
import VendorCertificateSection from './VendorCertificateSection';

const TABS = ['证书订单', 'ACME账户', '部署目标', '部署任务', '厂商渠道', 'CNAME代理'] as const;

export default function CertificateTabs() {
  const [tab, setTab] = useState(0);

  const handleChange = (_event: SyntheticEvent, next: number) => {
    setTab(next);
  };

  return (
    <Card
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ bgcolor: 'background.paper', pt: 0.75 }}>
        <Tabs
          value={tab}
          onChange={handleChange}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{
            minHeight: 56,
            px: 2,
            '& .MuiTabs-indicator': { display: 'none' },
            '& .MuiTab-root': {
              minHeight: 48,
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.95rem',
              mr: 1,
              borderRadius: '12px',
              transition: 'all 0.2s',
              color: 'text.secondary',
              whiteSpace: 'nowrap',
              '&.Mui-selected': {
                color: 'primary.main',
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                fontWeight: 700,
              },
              '&:hover': {
                bgcolor: (theme) => alpha(theme.palette.text.primary, 0.04),
              },
            },
          }}
        >
          {TABS.map((label) => (
            <Tab key={label} label={label} />
          ))}
        </Tabs>
      </Box>
      <Divider />
      <CardContent
        sx={{
          p: { xs: 2, sm: 2.5 },
          '&:last-child': {
            pb: { xs: 2, sm: 2.5 },
          },
        }}
      >
        {tab === 0 && <CertificateOrderSection />}
        {tab === 1 && <AcmeAccountSection />}
        {tab === 2 && <DeployTargetSection />}
        {tab === 3 && <DeployJobSection />}
        {tab === 4 && <VendorCertificateSection />}
        {tab === 5 && <CertificateAliasSection />}
      </CardContent>
    </Card>
  );
}
