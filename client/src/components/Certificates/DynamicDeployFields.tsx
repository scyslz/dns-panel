import { FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';
import { DeployFieldDefinition, DeployFieldOption } from '@/types/cert';

export default function DynamicDeployFields({
  fields,
  values,
  disabled,
  onChange,
  secretFlags,
  selectOptions,
}: {
  fields: DeployFieldDefinition[];
  values: Record<string, any>;
  disabled?: boolean;
  onChange: (name: string, value: any) => void;
  secretFlags?: Record<string, boolean>;
  selectOptions?: Record<string, DeployFieldOption[]>;
}) {
  return (
    <Stack spacing={2}>
      {fields.map((field) => {
        const options = (selectOptions?.[field.name]?.length ? selectOptions[field.name] : field.options) || [];
        const value = values[field.name];

        if (field.type === 'switch') {
          return (
            <FormControlLabel
              key={field.name}
              control={
                <Switch
                  checked={value === undefined ? false : !!value}
                  onChange={(event) => onChange(field.name, event.target.checked)}
                  disabled={disabled}
                />
              }
              label={field.label}
            />
          );
        }

        return (
          <TextField
            key={field.name}
            select={options.length > 0}
            label={field.label}
            value={value ?? ''}
            onChange={(event) => onChange(field.name, event.target.value)}
            fullWidth
            size="small"
            disabled={disabled}
            required={field.required}
            type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
            multiline={field.type === 'textarea'}
            minRows={field.type === 'textarea' ? 4 : undefined}
            placeholder={field.placeholder}
            helperText={
              field.description ||
              (secretFlags?.[field.name] ? '留空表示保留现有值' : undefined)
            }
          >
            {options.length > 0 && !field.required ? (
              <MenuItem value="">
                未选择
              </MenuItem>
            ) : null}
            {options.map((option) => (
              <MenuItem key={`${field.name}-${option.value}`} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        );
      })}
    </Stack>
  );
}
