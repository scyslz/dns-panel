import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import {
  DeployTarget,
  DeployTargetConfig,
  DeployTargetType,
  DeployTargetTypeDefinition,
  UpsertDeployTargetInput,
  getDeployTargetTypeLabel,
} from '@/types/cert';
import DynamicDeployFields from './DynamicDeployFields';
import { certificateDialogActionsSx, certificateDialogContentSx, certificateDialogTitleSx } from './certificateTableStyles';

function getTypeSecretFlags(type: DeployTargetType | string, config: DeployTargetConfig): Record<string, boolean> {
  const flags: Record<string, boolean> = {};

  if (type === 'webhook') flags.bearerToken = !!config?.hasBearerToken;
  if (type === 'dokploy' || type === 'onepanel') flags.apiKey = !!config?.hasApiKey;
  if (type === 'nginx_proxy_manager') flags.password = !!config?.hasPassword;
  if (type === 'ftp_server') flags.password = !!config?.hasPassword;
  if (type === 'ssh_server' || type === 'iis') {
    flags.password = !!config?.hasPassword;
    flags.privateKey = !!config?.hasPrivateKey;
    flags.passphrase = !!config?.hasPassphrase;
  }
  if (type === 'qiniu_cdn' || type === 'qiniu_oss' || type === 'dogecloud_cdn') flags.secretKey = !!config?.hasSecretKey;
  if (type === 'aws_cloudfront') flags.secretAccessKey = !!config?.hasSecretAccessKey;
  if (type === 'gcore' || type === 'cachefly') flags.apiToken = !!config?.hasApiToken;
  if (type === 'allwaf') flags.apiKey = !!config?.hasApiKey;

  return flags;
}

function normalizeConfigValues(
  definition: DeployTargetTypeDefinition | null,
  config: DeployTargetConfig | null | undefined
) {
  const source = config || {};
  const values: Record<string, any> = {};

  for (const field of definition?.configFields || []) {
    if (field.type === 'switch') {
      values[field.name] = !!source[field.name];
      continue;
    }
    if (source[field.name] !== undefined && source[field.name] !== null) {
      values[field.name] = source[field.name];
      continue;
    }
    values[field.name] = field.options?.[0]?.value ?? '';
  }

  return values;
}

export default function DeployTargetDialog({
  open,
  target,
  targetTypes,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  target: DeployTarget | null;
  targetTypes: DeployTargetTypeDefinition[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: UpsertDeployTargetInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<DeployTargetType | string>('webhook');
  const [config, setConfig] = useState<Record<string, any>>({});
  const [enabled, setEnabled] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedType = useMemo(
    () => targetTypes.find((item) => item.type === type) || targetTypes[0] || null,
    [targetTypes, type]
  );

  useEffect(() => {
    if (!open) return;
    const nextType = target?.type || targetTypes[0]?.type || 'webhook';
    const nextDefinition = targetTypes.find((item) => item.type === nextType) || targetTypes[0] || null;
    setName(target?.name || '');
    setType(nextType);
    setConfig(normalizeConfigValues(nextDefinition, target?.config));
    setEnabled(target?.enabled ?? true);
    setIsDefault(target?.isDefault ?? false);
    setSubmitError(null);
  }, [open, target, targetTypes]);

  const secretFlags = useMemo(
    () => getTypeSecretFlags(type, target?.config || {}),
    [type, target]
  );

  const visibleConfigFields = useMemo(() => {
    if (!selectedType) return [];

    return selectedType.configFields.filter((field) => {
      if (selectedType.type === 'webhook' && field.name === 'bearerToken') {
        return String(config.authMode || '').trim().toLowerCase() === 'bearer';
      }
      if ((selectedType.type === 'ssh_server' || selectedType.type === 'iis') && field.name === 'password') {
        return String(config.authMode || '').trim().toLowerCase() !== 'private_key';
      }
      if ((selectedType.type === 'ssh_server' || selectedType.type === 'iis') && ['privateKey', 'passphrase'].includes(field.name)) {
        return String(config.authMode || '').trim().toLowerCase() === 'private_key';
      }
      return true;
    });
  }, [selectedType, config.authMode]);

  const handleTypeChange = (nextType: string) => {
    const nextDefinition = targetTypes.find((item) => item.type === nextType) || null;
    setType(nextType);
    setConfig(normalizeConfigValues(nextDefinition, nextType === target?.type ? target?.config : {}));
  };

  const handleConfigChange = (fieldName: string, value: any) => {
    setConfig((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSubmitError('请输入目标名称');
      return;
    }
    if (!selectedType) {
      setSubmitError('当前没有可用部署类型');
      return;
    }

    const nextConfig: Record<string, any> = {};
    for (const field of visibleConfigFields) {
      const raw = config[field.name];
      if (field.type === 'switch') {
        nextConfig[field.name] = !!raw;
        continue;
      }

      const text = String(raw ?? '').trim();
      if (!text) {
        if (field.required && !secretFlags[field.name]) {
          setSubmitError(`请填写${field.label}`);
          return;
        }
        if (secretFlags[field.name]) continue;
        continue;
      }

      nextConfig[field.name] = field.type === 'number' ? Number(text) : text;
    }

    try {
      setSubmitError(null);
      await onSubmit({
        name: trimmedName,
        type: selectedType.type,
        enabled,
        isDefault,
        config: nextConfig,
      });
    } catch (error: any) {
      setSubmitError(typeof error === 'string' ? error : (error?.message || '提交失败'));
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={certificateDialogTitleSx}>{target ? '编辑部署目标' : '新增部署目标'}</DialogTitle>
      <DialogContent sx={certificateDialogContentSx}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="目标名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            fullWidth
            size="small"
            disabled={submitting}
          />

          <TextField
            select
            label="目标类型"
            value={type}
            onChange={(event) => handleTypeChange(event.target.value)}
            fullWidth
            size="small"
            disabled={submitting || !!target}
            helperText={target ? '已有目标暂不允许切换类型' : undefined}
          >
            {targetTypes.map((item) => (
              <MenuItem key={item.type} value={item.type}>
                {getDeployTargetTypeLabel(item.type, targetTypes)}
              </MenuItem>
            ))}
          </TextField>

          {selectedType ? (
            <DynamicDeployFields
              fields={visibleConfigFields}
              values={config}
              disabled={submitting}
              onChange={handleConfigChange}
              secretFlags={secretFlags}
            />
          ) : null}

          <FormControlLabel
            control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={submitting} />}
            label="启用目标"
          />
          <FormControlLabel
            control={<Switch checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} disabled={submitting} />}
            label="设为默认目标"
          />

          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={certificateDialogActionsSx}>
        <Button onClick={onClose} disabled={submitting} color="inherit">
          取消
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting || targetTypes.length === 0}>
          {submitting ? '提交中...' : (target ? '保存变更' : '创建目标')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
