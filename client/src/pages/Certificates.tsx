import { Box } from '@mui/material';
import { useEffect } from 'react';
import CertificateTabs from '@/components/Certificates/CertificateTabs';
import { useProvider } from '@/contexts/ProviderContext';

export default function Certificates() {
  const { selectProvider } = useProvider();

  useEffect(() => {
    selectProvider(null);
  }, [selectProvider]);

  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
        <CertificateTabs />
    </Box>
  );
}
