import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AccessTime as TimeIcon,
  Add as AddIcon,
  Check as CheckIcon,
  ContentCopy as CopyIcon,
  DeleteOutline as DeleteIcon,
  DescriptionOutlined as DocsIcon,
  Key as KeyIcon,
  Speed as SpeedIcon,
} from '@mui/icons-material';
import {
  ApiKeyRecord,
  CreatedApiKey,
  DomainOption,
  createApiKey,
  getApiKeys,
  getDomainOptions,
  revokeApiKey,
} from '@/services/apiKeys';
import { copyTextToClipboard } from '@/utils/clipboard';

function shortTime(value: string | null): string {
  if (!value) return '从未';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function MetaItem({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary', minWidth: 0 }}>
      {icon}
      <Typography variant="caption" noWrap>
        {children}
      </Typography>
    </Stack>
  );
}

function KeyPreview({ item, plainKey }: { item: ApiKeyRecord; plainKey: string | null }) {
  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        borderRadius: '8px',
        bgcolor: 'action.hover',
        border: '1px solid',
        borderColor: 'divider',
        minWidth: 0,
      }}
    >
      {plainKey ? (
        <Typography
          variant="caption"
          sx={{ display: 'block', fontFamily: 'monospace', letterSpacing: 0.2, wordBreak: 'break-all' }}
        >
          {plainKey}
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            lineHeight: 1.6,
            letterSpacing: 0.2,
          }}
        >
          <Box component="span" sx={{ flexShrink: 0 }}>
            dns_live_{item.keyId}_
          </Box>
          <Box
            component="span"
            aria-hidden
            sx={{ flexShrink: 0, mx: 0.25, color: 'text.disabled', letterSpacing: '0.12em' }}
          >
            ••••••••
          </Box>
          {item.keySuffix ? (
            <Box component="span" sx={{ flexShrink: 0 }}>
              {item.keySuffix}
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

function DomainTags({ domains }: { domains: string[] }) {
  const [expanded, setExpanded] = useState(false);

  if (domains.length === 0) {
    return <Chip size="small" label="全部域名" variant="outlined" sx={{ borderRadius: '6px' }} />;
  }

  const visible = expanded ? domains : domains.slice(0, 2);
  const hidden = domains.length - visible.length;

  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ rowGap: 0.75 }}>
      {visible.map((domain) => (
        <Chip
          key={domain}
          size="small"
          label={domain}
          variant="outlined"
          sx={{ maxWidth: 180, borderRadius: '6px', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        />
      ))}
      {domains.length > 2 ? (
        <Chip
          size="small"
          variant="outlined"
          color="primary"
          label={expanded ? '收起' : `+${hidden}`}
          sx={{ borderRadius: '6px' }}
          onClick={() => setExpanded((value) => !value)}
        />
      ) : null}
    </Stack>
  );
}

const softStatusChipSx = (color: 'success' | 'warning') => (theme: any) => ({
  bgcolor: alpha(theme.palette[color].main, 0.1),
  color: theme.palette[color].dark,
  fontWeight: 600,
  border: 'none',
});

export default function ApiKeyManagement() {
  const navigate = useNavigate();

  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [allDomains, setAllDomains] = useState(true);
  const [domainOptions, setDomainOptions] = useState<DomainOption[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [rateLimit, setRateLimit] = useState('60');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [revoking, setRevoking] = useState(false);

  const load = async () => {
    setLoading(true);
    setPageError('');
    try {
      const res = await getApiKeys();
      // 已吊销的 Key 不再展示
      setKeys((res.data?.keys || []).filter((item) => !item.revokedAt));
    } catch (err: any) {
      setPageError(typeof err === 'string' ? err : err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadDomainOptions = async () => {
    if (domainOptions.length > 0 || loadingDomains) return;
    setLoadingDomains(true);
    setFormError('');
    try {
      const res = await getDomainOptions();
      setDomainOptions(res.data?.domains || []);
    } catch (err: any) {
      setFormError(typeof err === 'string' ? err : err?.message || '加载域名失败');
    } finally {
      setLoadingDomains(false);
    }
  };

  const openCreate = () => {
    setName('');
    setAllDomains(true);
    setSelectedDomains([]);
    setRateLimit('60');
    setFormError('');
    setCreateOpen(true);
  };

  const onCreate = async () => {
    if (!name.trim()) {
      setFormError('请填写名称');
      return;
    }
    const rate = Number(rateLimit);
    if (!Number.isFinite(rate) || rate < 1) {
      setFormError('每分钟上限必须是正整数');
      return;
    }

    setCreating(true);
    setFormError('');
    try {
      const res = await createApiKey({
        name: name.trim(),
        allowedDomains: allDomains ? [] : selectedDomains,
        rateLimitPerMin: Math.floor(rate),
      });
      setCreatedKey(res.data || null);
      setCopiedId(null);
      setCreateOpen(false);
      await load();
    } catch (err: any) {
      setFormError(typeof err === 'string' ? err : err?.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const onCopy = async (value: string, id: number) => {
    const ok = await copyTextToClipboard(value);
    if (!ok) {
      setPageError('复制失败，请手动选择密钥文本');
      return;
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
  };

  const onRevoke = async () => {
    if (!revokeTarget || deleteConfirm !== revokeTarget.name) return;
    setRevoking(true);
    try {
      await revokeApiKey(revokeTarget.id);
      setKeys((prev) => prev.filter((item) => item.id !== revokeTarget.id));
      setNotice(`已删除 ${revokeTarget.name}`);
      setRevokeTarget(null);
      setDeleteConfirm('');
      await load();
    } catch (err: any) {
      setPageError(typeof err === 'string' ? err : err?.message || '删除失败');
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Card
      sx={{
        border: 'none',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)',
      }}
    >
      <CardHeader
        sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 2.5 }, pb: 1.5 }}
        avatar={<KeyIcon color="primary" />}
        title={
          <Typography variant="h6" fontWeight={600}>
            API Key
          </Typography>
        }
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={loading}>
            创建 Key
          </Button>
        }
      />
      <Divider />
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        {pageError ? (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setPageError('')}>
            {pageError}
          </Alert>
        ) : null}
        {notice ? (
          <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setNotice('')}>
            {notice}
          </Alert>
        ) : null}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : keys.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: { xs: 5, sm: 8 } }}>
            <KeyIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
            <Typography variant="subtitle1" fontWeight={600}>
              还没有 API Key
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
              创建后即可调用开放 API
            </Typography>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={openCreate}>
              创建第一个 Key
            </Button>
          </Box>
        ) : (
          <Stack spacing={2}>
            {keys.map((item) => {
              const plainKey = createdKey?.id === item.id ? createdKey.key : null;
              return (
              <Box
                key={item.id}
                sx={{
                  p: { xs: 2, sm: 2.5 },
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '12px',
                  transition: 'background-color .15s ease',
                  '&:hover': {
                    bgcolor: 'rgba(37, 99, 235, 0.04)',
                  },
                  '&:hover .api-key-delete, &:focus-within .api-key-delete': {
                    opacity: 1,
                  },
                }}
              >
                <Stack direction="row" spacing={1.5} alignItems="flex-start">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ maxWidth: '100%' }}>
                        {item.name}
                      </Typography>
                      {plainKey ? <Chip size="small" label="新" sx={softStatusChipSx('success')} /> : null}
                      {item.revokedAt ? <Chip size="small" label="已吊销" sx={{ bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 600 }} /> : null}
                      {!item.revokedAt && !item.active ? (
                        <Chip size="small" label="已过期" sx={softStatusChipSx('warning')} />
                      ) : null}
                      <Stack
                        direction="row"
                        spacing={2}
                        alignItems="center"
                        sx={{ ml: 'auto', display: { xs: 'none', sm: 'flex' }, flexShrink: 0 }}
                      >
                        <Box sx={{ width: { sm: 240, md: 300 }, flexShrink: 0 }}>
                          <KeyPreview item={item} plainKey={plainKey} />
                        </Box>
                        <MetaItem icon={<SpeedIcon sx={{ fontSize: 15 }} />}>{item.rateLimitPerMin}/min</MetaItem>
                        <MetaItem icon={<TimeIcon sx={{ fontSize: 15 }} />}>
                          {item.lastUsedAt ? `最近 ${shortTime(item.lastUsedAt)}` : '从未使用'}
                        </MetaItem>
                      </Stack>
                    </Stack>

                    <Box sx={{ mt: 1.25, display: { xs: 'block', sm: 'none' } }}>
                      <KeyPreview item={item} plainKey={plainKey} />
                    </Box>

                    <Box sx={{ mt: 1.25 }}>
                      <DomainTags domains={item.allowedDomains} />
                    </Box>

                    <Stack
                      direction="row"
                      spacing={{ xs: 1.5, sm: 2.5 }}
                      flexWrap="wrap"
                      useFlexGap
                      sx={{ mt: 1.25, rowGap: 0.75, display: { xs: 'flex', sm: 'none' } }}
                    >
                      <MetaItem icon={<SpeedIcon sx={{ fontSize: 15 }} />}>{item.rateLimitPerMin}/min</MetaItem>
                      <MetaItem icon={<TimeIcon sx={{ fontSize: 15 }} />}>
                        {item.lastUsedAt ? `最近 ${shortTime(item.lastUsedAt)}` : '从未使用'}
                      </MetaItem>
                    </Stack>
                  </Box>

                  <Stack direction="row" spacing={0.5} sx={{ mt: -0.5, mr: -0.5 }}>
                    {plainKey ? (
                      <Tooltip title={copiedId === item.id ? '已复制' : '复制密钥'}>
                        <IconButton size="small" onClick={() => onCopy(plainKey, item.id)}>
                          {copiedId === item.id ? (
                            <CheckIcon fontSize="small" color="success" />
                          ) : (
                            <CopyIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    {!item.revokedAt ? (
                      <Tooltip title="删除">
                        <IconButton
                          size="small"
                          color="error"
                          className="api-key-delete"
                          onClick={() => { setRevokeTarget(item); setDeleteConfirm(''); }}
                          sx={{
                            opacity: 1,
                            transition: 'opacity .15s ease',
                            '@media (hover: hover)': { opacity: 0 },
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Stack>
                </Stack>
              </Box>
              );
            })}
          </Stack>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2.5 }}>
          <Button
            size="small"
            startIcon={<DocsIcon />}
            onClick={() => navigate('/docs')}
            sx={{ color: 'text.secondary' }}
          >
            API 文档
          </Button>
        </Box>
      </CardContent>

      <Dialog open={createOpen} onClose={() => (creating ? null : setCreateOpen(false))} fullWidth maxWidth="sm">
        <DialogTitle sx={{ px: 3, pt: 2.5, pb: 1 }}>创建 API Key</DialogTitle>
        <DialogContent>
          {formError ? (
            <Alert severity="error" sx={{ mt: 1, borderRadius: 2 }}>
              {formError}
            </Alert>
          ) : null}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              fullWidth
              label="名称"
              placeholder="CI / 证书脚本 / HomeLab"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={creating}
            />

            <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: '12px' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={allDomains}
                    onChange={(event) => {
                      setAllDomains(event.target.checked);
                      if (!event.target.checked) loadDomainOptions();
                    }}
                    disabled={creating}
                  />
                }
                label="全部域名"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {allDomains ? '可访问账号下所有域名' : '仅允许访问所选域名'}
              </Typography>
              {!allDomains ? (
                <Autocomplete
                  multiple
                  freeSolo
                  options={domainOptions.map((item) => item.domain)}
                  value={selectedDomains}
                  onChange={(_, value) => setSelectedDomains(value.map((item) => String(item)))}
                  loading={loadingDomains}
                  disabled={creating}
                  sx={{ mt: 1.5 }}
                  renderInput={(params) => (
                    <TextField {...params} label="选择域名" placeholder="选择或输入域名" />
                  )}
                />
              ) : null}
            </Box>

            <TextField
              fullWidth
              type="number"
              label="每分钟请求上限"
              value={rateLimit}
              onChange={(event) => setRateLimit(event.target.value)}
              InputProps={{ inputProps: { min: 1, max: 10000 } }}
              disabled={creating}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
          <Button color="inherit" onClick={() => setCreateOpen(false)} disabled={creating}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={onCreate}
            disabled={creating}
            startIcon={creating ? <CircularProgress size={16} /> : <KeyIcon />}
          >
            {creating ? '创建中...' : '创建 Key'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!revokeTarget} onClose={() => (revoking ? null : setRevokeTarget(null))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ px: 3, pt: 2.5, pb: 1 }}>删除 API Key</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              删除后使用该 Key 的脚本会立即失效，且无法恢复。
            </Alert>
            <Typography variant="body2">
              请输入 Key 名称 <strong>{revokeTarget?.name}</strong> 以确认：
            </Typography>
            <TextField
              size="small"
              fullWidth
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              placeholder={revokeTarget?.name}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
          <Button color="inherit" onClick={() => { setRevokeTarget(null); setDeleteConfirm(''); }} disabled={revoking}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={onRevoke}
            disabled={revoking || deleteConfirm !== revokeTarget?.name}
          >
            {revoking ? '删除中...' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
