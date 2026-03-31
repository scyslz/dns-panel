import { InputAdornment, TextField } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { certificateSearchFieldSx } from './certificateTableStyles';

export default function CertificateSearchField({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <TextField
      size="small"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      sx={certificateSearchFieldSx}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon color="action" fontSize="small" />
          </InputAdornment>
        ),
      }}
    />
  );
}
