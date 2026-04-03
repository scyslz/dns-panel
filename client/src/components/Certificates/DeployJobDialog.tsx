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
  Typography,
} from '@mui/material';
import { getDeployTargetResources } from '@/services/certificates';
import {
  CertificateOrder,
  DeployFieldOption,
  DeployJob,
  DeployTarget,
  DeployTargetResourcesResponse,
  DeployTargetTypeDefinition,
  UpsertDeployJobInput,
  VendorCertificate,
  getDeployTargetTypeLabel,
  getVendorCertificateProviderLabel,
} from '@/types/cert';
import DynamicDeployFields from './DynamicDeployFields';
import { certificateDialogActionsSx, certificateDialogContentSx, certificateDialogTitleSx } from './certificateTableStyles';

function normalizeBindingValues(
  definition: DeployTargetTypeDefinition | null,
  binding: Record<string, any> | null | undefined
) {
  const source = binding || {};
  const values: Record<string, any> = {};
  for (const field of definition?.bindingFields || []) {
    if (field.type === 'switch') {
      values[field.name] = !!source[field.name];
      continue;
    }
    values[field.name] = source[field.name] ?? '';
  }
  return values;
}

function buildResourceOptions(
  type: string | undefined,
  resources: DeployTargetResourcesResponse['resources']
): Record<string, DeployFieldOption[]> {
  const options: Record<string, DeployFieldOption[]> = {};
  if (!type) return options;

  const mapOptions = (items: Array<Record<string, any>> | undefined, labelBuilder?: (item: Record<string, any>) => string) =>
    (items || [])
      .map((item) => {
        const value = item.id === undefined || item.id === null ? '' : String(item.id);
        if (!value) return null;
        return {
          value,
          label: labelBuilder ? labelBuilder(item) : (item.name ? String(item.name) : value),
        };
      })
      .filter((item): item is DeployFieldOption => !!item);

  switch (type) {
    case 'cloudflare_custom_hostname':
      options.zoneId = mapOptions(resources.zones, (item) => item.name ? `${item.name} (${item.id})` : String(item.id));
      break;
    case 'aliyun_esa':
      options.siteId = mapOptions(resources.sites, (item) => item.name ? `${item.name} (${item.id})` : String(item.id));
      break;
    case 'aliyun_cdn':
    case 'aliyun_dcdn':
    case 'tencent_cdn':
    case 'huawei_cdn':
      options.domain = mapOptions(resources.domains, (item) => item.name ? `${item.name}${item.status ? ` (${item.status})` : ''}` : String(item.id));
      break;
    case 'aliyun_clb':
      options.loadBalancerId = mapOptions(resources.loadBalancers, (item) => item.name ? `${item.name}${item.address ? ` (${item.address})` : ''}` : String(item.id));
      options.listenerPort = mapOptions(resources.listeners, (item) => String(item.name || item.id));
      break;
    case 'aliyun_alb':
    case 'aliyun_nlb':
      options.listenerId = mapOptions(resources.listeners, (item) => {
        const name = String(item.name || item.id);
        return item.loadBalancerId ? `${name} (${item.loadBalancerId})` : name;
      });
      break;
    case 'tencent_edgeone':
      options.zoneId = mapOptions(resources.zones, (item) => item.name ? `${item.name}${item.status ? ` (${item.status})` : ''}` : String(item.id));
      options.domain = mapOptions(resources.hosts, (item) => item.name ? `${item.name}${item.status ? ` (${item.status})` : ''}` : String(item.id));
      break;
    case 'tencent_clb':
      options.loadBalancerId = mapOptions(resources.loadBalancers, (item) => item.name ? `${item.name}${item.address ? ` (${item.address})` : ''}` : String(item.id));
      options.listenerId = mapOptions(resources.listeners, (item) => String(item.name || item.id));
      options.domain = mapOptions(resources.domains, (item) => String(item.name || item.id));
      break;
    case 'huawei_elb':
      options.listenerId = mapOptions(resources.listeners, (item) => {
        const name = String(item.name || item.id);
        return item.loadBalancerId ? `${name} (${item.loadBalancerId})` : name;
      });
      options.certificateId = mapOptions(resources.certificates, (item) => String(item.name || item.id));
      break;
    case 'onepanel':
      options.websiteId = mapOptions(resources.websites, (item) => item.name ? `${item.name} (${item.id})` : String(item.id));
      break;
    case 'nginx_proxy_manager':
      options.proxyHostId = mapOptions(resources.proxyHosts, (item) => item.name ? `${item.name} (${item.id})` : String(item.id));
      break;
    case 'aws_cloudfront':
      options.distributionId = mapOptions(resources.distributions, (item) => item.name ? `${item.name} (${item.id})` : String(item.id));
      break;
    case 'gcore':
      options.certificateId = mapOptions(resources.certificates, (item) => item.name ? `${item.name} (${item.id})` : String(item.id));
      break;
    default:
      break;
  }

  return options;
}

export default function DeployJobDialog({
  open,
  job,
  orders,
  vendorOrders,
  targets,
  targetTypes,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  job: DeployJob | null;
  orders: CertificateOrder[];
  vendorOrders: VendorCertificate[];
  targets: DeployTarget[];
  targetTypes: DeployTargetTypeDefinition[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: UpsertDeployJobInput) => Promise<void>;
}) {
  const [sourceType, setSourceType] = useState<'acme' | 'vendor'>('acme');
  const [certificateOrderId, setCertificateOrderId] = useState<number>(0);
  const [vendorCertificateOrderId, setVendorCertificateOrderId] = useState<number>(0);
  const [certificateDeployTargetId, setCertificateDeployTargetId] = useState<number>(0);
  const [enabled, setEnabled] = useState(true);
  const [triggerOnIssue, setTriggerOnIssue] = useState(true);
  const [triggerOnRenew, setTriggerOnRenew] = useState(true);
  const [binding, setBinding] = useState<Record<string, any>>({});
  const [resources, setResources] = useState<DeployTargetResourcesResponse['resources']>({});
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedTarget = useMemo(
    () => targets.find((item) => item.id === certificateDeployTargetId) || null,
    [targets, certificateDeployTargetId]
  );

  const selectedType = useMemo(
    () => targetTypes.find((item) => item.type === selectedTarget?.type) || null,
    [targetTypes, selectedTarget]
  );

  const resourceOptions = useMemo(
    () => buildResourceOptions(selectedType?.type, resources),
    [selectedType, resources]
  );

  useEffect(() => {
    if (!open) return;
    const nextTargetId = job?.certificateDeployTargetId || targets[0]?.id || 0;
    const nextTarget = targets.find((item) => item.id === nextTargetId) || null;
    const nextType = targetTypes.find((item) => item.type === nextTarget?.type) || null;
    const nextSourceType = job?.sourceType || (orders.length > 0 ? 'acme' : 'vendor');
    setSourceType(nextSourceType);
    setCertificateOrderId(job?.certificateOrderId || orders[0]?.id || 0);
    setVendorCertificateOrderId(job?.vendorCertificateOrderId || vendorOrders[0]?.id || 0);
    setCertificateDeployTargetId(nextTargetId);
    setEnabled(job?.enabled ?? true);
    setTriggerOnIssue(job?.triggerOnIssue ?? true);
    setTriggerOnRenew(job?.triggerOnRenew ?? true);
    setBinding(normalizeBindingValues(nextType, job?.binding || null));
    setResources({});
    setSubmitError(null);
  }, [open, job, orders, vendorOrders, targets, targetTypes]);

  useEffect(() => {
    if (!open || !selectedTarget || !selectedType?.supportsResourceDiscovery) {
      setResources({});
      setResourcesLoading(false);
      setResourcesError(null);
      return;
    }

    const params: Record<string, any> = {};
    if (selectedType.type === 'cloudflare_custom_hostname' && binding.zoneId) {
      params.zoneId = binding.zoneId;
    }
    if (selectedType.type === 'aliyun_esa' && binding.region) {
      params.region = binding.region;
    }
    if (selectedType.type === 'aliyun_clb' && binding.loadBalancerId) {
      params.loadBalancerId = binding.loadBalancerId;
    }
    if (selectedType.type === 'tencent_edgeone' && binding.zoneId) {
      params.zoneId = binding.zoneId;
    }
    if (selectedType.type === 'tencent_clb' && binding.loadBalancerId) {
      params.loadBalancerId = binding.loadBalancerId;
      if (binding.listenerId) {
        params.listenerId = binding.listenerId;
      }
    }

    let active = true;
    setResourcesLoading(true);
    setResourcesError(null);
    getDeployTargetResources(selectedTarget.id, params)
      .then((response) => {
        if (!active) return;
        setResources(response.data?.resources || {});
      })
      .catch((err: any) => {
        if (!active) return;
        setResources({});
        setResourcesError(typeof err === 'string' ? err : (err?.message || '加载远端资源失败'));
      })
      .finally(() => {
        if (!active) return;
        setResourcesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    open,
    selectedTarget,
    selectedType,
    binding.zoneId,
    binding.region,
    binding.loadBalancerId,
    binding.listenerId,
  ]);

  const handleBindingChange = (fieldName: string, value: any) => {
    setBinding((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleTargetChange = (targetId: number) => {
    const target = targets.find((item) => item.id === targetId) || null;
    const definition = targetTypes.find((item) => item.type === target?.type) || null;
    setCertificateDeployTargetId(targetId);
    setBinding(normalizeBindingValues(definition, null));
    setResources({});
  };

  const handleSourceTypeChange = (next: 'acme' | 'vendor') => {
    setSourceType(next);
    if (next === 'acme') {
      setCertificateOrderId((current) => current || orders[0]?.id || 0);
      setVendorCertificateOrderId(0);
      return;
    }

    setVendorCertificateOrderId((current) => current || vendorOrders[0]?.id || 0);
    setCertificateOrderId(0);
  };

  const handleSubmit = async () => {
    if (sourceType === 'acme' && !certificateOrderId) {
      setSubmitError('请选择证书');
      return;
    }
    if (sourceType === 'vendor' && !vendorCertificateOrderId) {
      setSubmitError('请选择厂商证书');
      return;
    }
    if (!certificateDeployTargetId) {
      setSubmitError('请选择部署目标');
      return;
    }

    const nextBinding: Record<string, any> = {};
    for (const field of selectedType?.bindingFields || []) {
      const raw = binding[field.name];
      if (field.type === 'switch') {
        nextBinding[field.name] = !!raw;
        continue;
      }

      const text = String(raw ?? '').trim();
      if (!text) {
        if (field.required) {
          setSubmitError(`请填写${field.label}`);
          return;
        }
        continue;
      }

      nextBinding[field.name] = field.type === 'number' ? Number(text) : text;
    }

    try {
      setSubmitError(null);
      await onSubmit({
        certificateOrderId: sourceType === 'acme' ? certificateOrderId : null,
        vendorCertificateOrderId: sourceType === 'vendor' ? vendorCertificateOrderId : null,
        certificateDeployTargetId,
        enabled,
        triggerOnIssue,
        triggerOnRenew,
        binding: selectedType?.bindingFields.length ? nextBinding : null,
      });
    } catch (error: any) {
      setSubmitError(typeof error === 'string' ? error : (error?.message || '提交失败'));
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={certificateDialogTitleSx}>{job ? '编辑部署任务' : '新增部署任务'}</DialogTitle>
      <DialogContent sx={certificateDialogContentSx}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {orders.length === 0 && vendorOrders.length === 0 ? <Alert severity="warning">暂无可用证书源，无法创建部署任务。</Alert> : null}
          {targets.length === 0 ? <Alert severity="warning">暂无部署目标，请先新增目标。</Alert> : null}

          <TextField
            select
            label="证书来源"
            value={sourceType}
            onChange={(event) => handleSourceTypeChange(event.target.value as 'acme' | 'vendor')}
            fullWidth
            size="small"
            disabled={submitting || (orders.length === 0 && vendorOrders.length === 0)}
          >
            {orders.length > 0 ? <MenuItem value="acme">ACME 证书</MenuItem> : null}
            {vendorOrders.length > 0 ? <MenuItem value="vendor">厂商证书</MenuItem> : null}
          </TextField>

          <TextField
            select
            label={sourceType === 'vendor' ? '厂商证书' : 'ACME 证书'}
            value={sourceType === 'vendor' ? (vendorCertificateOrderId || '') : (certificateOrderId || '')}
            onChange={(event) => {
              const nextId = parseInt(event.target.value, 10);
              if (sourceType === 'vendor') {
                setVendorCertificateOrderId(nextId);
                return;
              }
              setCertificateOrderId(nextId);
            }}
            fullWidth
            size="small"
            disabled={submitting || (sourceType === 'vendor' ? vendorOrders.length === 0 : orders.length === 0)}
          >
            {sourceType === 'vendor'
              ? vendorOrders.map((order) => (
                  <MenuItem key={order.id} value={order.id}>
                    {order.primaryDomain}（{getVendorCertificateProviderLabel(order.provider)} / 到期：{order.expiresAt || '未知'}）
                  </MenuItem>
                ))
              : orders.map((order) => (
                  <MenuItem key={order.id} value={order.id}>
                    {order.primaryDomain}（到期：{order.expiresAt || '未知'}）
                  </MenuItem>
                ))}
          </TextField>

          <TextField
            select
            label="部署目标"
            value={certificateDeployTargetId || ''}
            onChange={(event) => handleTargetChange(parseInt(event.target.value, 10))}
            fullWidth
            size="small"
            disabled={submitting || targets.length === 0}
          >
            {targets.map((target) => (
              <MenuItem key={target.id} value={target.id}>
                {target.name}（{getDeployTargetTypeLabel(target.type, targetTypes)}）
              </MenuItem>
            ))}
          </TextField>

          {selectedType?.bindingFields.length ? (
            <>
              {resourcesLoading ? <Typography variant="body2" color="text.secondary">正在加载远端资源...</Typography> : null}
              {resourcesError ? <Alert severity="warning">{resourcesError}</Alert> : null}
              <DynamicDeployFields
                fields={selectedType.bindingFields}
                values={binding}
                disabled={submitting}
                onChange={handleBindingChange}
                selectOptions={resourceOptions}
              />
            </>
          ) : null}

          <FormControlLabel
            control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={submitting} />}
            label="启用任务"
          />
          <FormControlLabel
            control={<Switch checked={triggerOnIssue} onChange={(event) => setTriggerOnIssue(event.target.checked)} disabled={submitting} />}
            label="首次签发成功后自动触发"
          />
          <FormControlLabel
            control={<Switch checked={triggerOnRenew} onChange={(event) => setTriggerOnRenew(event.target.checked)} disabled={submitting} />}
            label="每次续期成功后自动触发"
          />

          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={certificateDialogActionsSx}>
        <Button onClick={onClose} disabled={submitting} color="inherit">
          取消
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || (orders.length === 0 && vendorOrders.length === 0) || targets.length === 0}
        >
          {submitting ? '提交中...' : (job ? '保存变更' : '创建任务')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
