import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, Divider,
  DialogContent, DialogTitle, FormControlLabel, IconButton, InputAdornment, Menu, MenuItem, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import {
  Add as AddIcon, CheckCircle as CheckIcon, CloudSync as SyncIcon, ContentCopy as CopyIcon,
  Delete as DeleteIcon, Edit as EditIcon, ExpandLess as ExpandLessIcon, ExpandMore as ExpandMoreIcon,
  MoreVert as MoreVertIcon, PauseCircleOutline as PauseIcon, PlayCircleOutline as ResumeIcon,
  Refresh as RefreshIcon, Search as SearchIcon, Security as EdgeOneIcon,
} from '@mui/icons-material';
import {
  EDGEONE_AREA_OPTIONS, HOST_HEADER_MODE_OPTIONS, ORIGIN_PROTOCOL_OPTIONS,
  createEdgeOneDomain, createEdgeOneSite, deleteEdgeOneDomain, deleteEdgeOneSite,
  enableEdgeOneFreeCertificate, listEdgeOneDomains, listEdgeOnePlans, listEdgeOneSites,
  setEdgeOneDomainStatus, syncEdgeOneSite, updateEdgeOneDomain, verifyEdgeOneSite,
  type CreateDomainResult, type CreateSiteResult, type EdgeOneDomain, type EdgeOneSite,
  type HostHeaderMode,
} from '@/services/tencentEdgeOne';
import { useProvider } from '@/contexts/ProviderContext';

const errorText = (err: unknown) => String((err as any)?.message || err || '操作失败');

type Notice = { severity: 'success' | 'error' | 'info' | 'warning'; text: string };
type ShowNotice = (severity: Notice['severity'], text: string) => void;

/** 与其他 DNS 表格一致：操作列固定在右侧，只有内容列参与横向滚动 */
function useStickyActionColumn(watchKey: unknown) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const isOverflowing = el.scrollWidth > el.clientWidth;
    setHasOverflow(isOverflowing && el.scrollLeft < el.scrollWidth - el.clientWidth);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    checkOverflow();
    el.addEventListener('scroll', checkOverflow);
    window.addEventListener('resize', checkOverflow);
    return () => {
      el.removeEventListener('scroll', checkOverflow);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [checkOverflow, watchKey]);

  const shadow = hasOverflow ? { boxShadow: '-4px 0 8px -4px rgba(0,0,0,0.15)' } : {};
  return {
    containerRef,
    /**
     * 表头沿用 theme 的 #F8FAFC；
     * 数据行用列表本身的背景（background.default），与上下内容一致，
     * 且不跟随行 hover / selected 变色。
     */
    headerCellSx: { position: 'sticky' as const, right: 0, bgcolor: '#F8FAFC', zIndex: 3, ...shadow },
    bodyCellSx: { position: 'sticky' as const, right: 0, bgcolor: 'background.default', zIndex: 1, ...shadow },
  };
}

/** 回源协议已指定时，列表只展示对应的那一个端口，不再同时显示两个 */
function originPortSummary(d: EdgeOneDomain): string {
  const protocol = String(d.originProtocol || 'FOLLOW').toUpperCase();
  const http = d.httpOriginPort ?? 80;
  const https = d.httpsOriginPort ?? 443;
  if (protocol === 'HTTP') return `HTTP · ${http}`;
  if (protocol === 'HTTPS') return `HTTPS · ${https}`;
  return `协议跟随 · ${http} / ${https}`;
}

function originDetail(d: EdgeOneDomain): string {
  const protocol = String(d.originProtocol || 'FOLLOW').toUpperCase();
  const http = d.httpOriginPort ?? '-';
  const https = d.httpsOriginPort ?? '-';
  const ports = protocol === 'HTTP' ? `HTTP ${http}`
    : protocol === 'HTTPS' ? `HTTPS ${https}`
      : `HTTP ${http} / HTTPS ${https}`;
  return `${d.origin || '-'} · ${ports} · Host ${d.hostHeader || '-'}`;
}

/** 操作提示用浮层展示，避免在表格上方插入 Alert 导致列表跳动「闪一下」 */
function FloatingNotice({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => closeRef.current(), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <Box sx={{ position: 'fixed', right: { xs: 16, sm: 32 }, bottom: 24, zIndex: 1400, width: { xs: 'calc(100% - 32px)', sm: 400 } }}>
      <Alert severity={notice.severity} onClose={onClose} sx={{ borderRadius: 2, boxShadow: 3 }}>{notice.text}</Alert>
    </Box>
  );
}

function siteStatus(site: EdgeOneSite) {
  const type = String(site.type || '').toLowerCase();
  if (site.paused || site.activeStatus === 'inactive' || site.status === 'deactivated') {
    return { label: '已停用', color: 'default' as const };
  }
  if (type === 'dnspodaccess') return { label: 'DNSPod 托管接入 · 已启用', color: 'success' as const };
  if (type === 'full' && site.status === 'pending') return { label: '待切换 NS', color: 'warning' as const };
  if (['active', 'finished'].includes(String(site.status || '').toLowerCase())) return { label: '已生效', color: 'success' as const };
  if (type === 'pages') return { label: 'Pages 站点', color: 'info' as const };
  return { label: site.status || '未知', color: 'info' as const };
}

function areaLabel(area?: string) {
  return ({ mainland: '中国大陆', overseas: '全球（不含中国大陆）', global: '全球（含中国大陆）' } as Record<string, string>)[String(area || '')] || area || '未知区域';
}

function domainStatusChip(status?: string) {
  const v = String(status || '').toLowerCase();
  if (['online', 'active', 'finished'].includes(v)) return { label: '已生效', color: 'success' as const };
  if (['process', 'init', 'pending'].includes(v)) return { label: '部署中', color: 'warning' as const };
  if (['offline', 'inactive'].includes(v)) return { label: '已停用', color: 'default' as const };
  return { label: status || '未知', color: 'info' as const };
}

/** CNAME 旁的小标签：只表达同步状态，不占单独一列 */
function dnspodTag(d: EdgeOneDomain) {
  const status = d.dnspod.status;
  if (status === 'matched') return { label: 'DNSPod', color: 'success' as const, title: `已同步到 DNSPod：${d.dnspod.currentValue || d.cname || ''}` };
  if (status === 'different') return { label: '值不同', color: 'warning' as const, title: `DNSPod 当前值：${d.dnspod.currentValue || ''}` };
  if (status === 'missing') return { label: '未同步', color: 'default' as const, title: 'DNSPod 里没有对应的 CNAME 记录' };
  return null;
}

export interface EdgeOnePanelProps {
  /** 与 DNS 列表共用账户 Tab：'all' 表示全部 EdgeOne 账户 */
  credentialId: number | 'all' | null;
}

/** 嵌入仪表盘 DNS 列表的 EdgeOne 面板，样式与域名列表保持一致 */
export default function EdgeOnePanel({ credentialId }: EdgeOnePanelProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const queryClient = useQueryClient();
  const { credentials } = useProvider();
  const edgeOneCredentials = useMemo(() => credentials.filter((c) => c.provider === 'edgeone'), [credentials]);

  const activeIds = useMemo(() => {
    if (credentialId === 'all' || credentialId === null) return edgeOneCredentials.map((c) => c.id);
    return edgeOneCredentials.some((c) => c.id === credentialId) ? [credentialId] : edgeOneCredentials.map((c) => c.id);
  }, [credentialId, edgeOneCredentials]);

  const [notice, setNotice] = useState<Notice | null>(null);
  const showNotice: ShowNotice = useCallback((severity, text) => setNotice({ severity, text }), []);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [siteForm, setSiteForm] = useState({ domain: '', area: 'overseas', planId: '', credentialId: 0 });
  const [siteError, setSiteError] = useState<string | null>(null);
  const [createdSite, setCreatedSite] = useState<CreateSiteResult | null>(null);
  const [deleteSite, setDeleteSite] = useState<EdgeOneSite | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const sitesQuery = useQuery({
    queryKey: ['edgeone', 'sites', activeIds.join(',')],
    queryFn: async () => {
      const results = await Promise.allSettled(activeIds.map((id) => listEdgeOneSites({ credentialId: id })));
      const sites: EdgeOneSite[] = [];
      const errors: string[] = [];
      results.forEach((r) => {
        if (r.status === 'fulfilled') sites.push(...(r.value.data?.sites || []));
        else errors.push(errorText(r.reason));
      });
      if (sites.length === 0 && errors.length > 0) throw new Error(errors[0]);
      return { sites, errors };
    },
    enabled: activeIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const sites = sitesQuery.data?.sites || [];
  const partialErrors = sitesQuery.data?.errors || [];

  const filteredSites = useMemo(
    () => sites.filter((s) => s.zoneName.toLowerCase().includes(searchTerm.toLowerCase())),
    [sites, searchTerm],
  );
  useEffect(() => { setExpandedZone(null); }, [searchTerm]);

  const plansQuery = useQuery({
    queryKey: ['edgeone', 'plans', activeIds.join(',')],
    queryFn: async () => (await listEdgeOnePlans(activeIds[0])).data?.plans || [],
    enabled: siteDialogOpen && activeIds.length > 0,
    staleTime: 60_000,
  });

  const invalidateSites = () => { void queryClient.invalidateQueries({ queryKey: ['edgeone', 'sites'] }); };

  const createSiteMutation = useMutation({
    mutationFn: () => {
      if (!siteForm.domain.trim()) throw new Error('请输入站点域名');
      const id = siteForm.credentialId || activeIds[0];
      if (!id) throw new Error('请先选择 EdgeOne 凭证');
      return createEdgeOneSite({ credentialId: id, domain: siteForm.domain.trim(), area: siteForm.area, planId: siteForm.planId || undefined });
    },
    onSuccess: (resp) => { setCreatedSite(resp.data || null); showNotice('success', `站点 ${resp.data?.domain || ''} 创建成功`); invalidateSites(); },
    onError: (err) => setSiteError(errorText(err)),
  });

  const fullSyncMutation = useMutation({
    mutationFn: (site: EdgeOneSite) => syncEdgeOneSite(site.zoneId, site.credentialId),
    onSuccess: (resp) => {
      const r = resp.data; const failed = r?.results?.filter((x) => x.error) || [];
      showNotice(failed.length ? 'warning' : 'success', failed.length
        ? `同步 ${r?.total ?? 0} 个域名，${failed.length} 个失败：${failed[0].error}`
        : `已对齐 ${r?.total ?? 0} 个加速域名到 DNSPod`);
    },
    onError: (err) => showNotice('error', errorText(err)),
  });

  const verifySiteMutation = useMutation({
    mutationFn: (site: EdgeOneSite) => verifyEdgeOneSite(site.zoneId, site.credentialId),
    onSuccess: (resp) => showNotice(resp.data?.status === 'success' ? 'success' : 'info',
      resp.data?.status === 'success' ? `${resp.data?.domain} 归属权验证通过` : `${resp.data?.domain} 归属权状态：${resp.data?.status || 'pending'}`),
    onError: (err) => showNotice('error', errorText(err)),
  });

  const deleteSiteMutation = useMutation({
    mutationFn: (site: EdgeOneSite) => deleteEdgeOneSite(site.zoneId, site.credentialId),
    onSuccess: () => { setDeleteSite(null); setDeleteConfirm(''); showNotice('success', '站点已删除'); invalidateSites(); },
    onError: (err) => showNotice('error', errorText(err)),
  });

  const copyText = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied(null), 1200); }
    catch { showNotice('error', '复制失败，请手动选择文本复制'); }
  };

  const openCreateSite = () => {
    setSiteForm({ domain: '', area: 'overseas', planId: '', credentialId: activeIds[0] || 0 });
    setCreatedSite(null); setSiteError(null); setSiteDialogOpen(true);
  };

  const emptyText = edgeOneCredentials.length === 0
    ? '还没有 EdgeOne 凭证，请到「设置 → DNS 账户管理」添加 EdgeOne 账户'
    : searchTerm ? '没有找到匹配的站点' : '暂无 EdgeOne 站点数据';

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 3 }}>
        <TextField
          placeholder="搜索站点..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ width: { xs: '100%', sm: 300 }, bgcolor: 'background.paper' }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment> }}
          disabled={edgeOneCredentials.length === 0}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent={{ xs: 'stretch', sm: 'flex-end' }}>
          <Button variant="outlined" startIcon={<RefreshIcon />}
            onClick={() => { void sitesQuery.refetch(); }}
            disabled={sitesQuery.isFetching || edgeOneCredentials.length === 0}
            sx={{ borderColor: 'divider', bgcolor: 'background.paper', color: 'text.secondary', '&:hover': { borderColor: 'primary.main', color: 'primary.main' } }}>
            {sitesQuery.isFetching ? '刷新中...' : '同步列表'}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} disabled={edgeOneCredentials.length === 0} onClick={openCreateSite} sx={{ whiteSpace: 'nowrap' }}>
            添加站点
          </Button>
        </Stack>
      </Stack>

      {partialErrors.length > 0 && <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>部分账户加载失败：{partialErrors[0]}</Alert>}

      {sitesQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}><CircularProgress /></Box>
      ) : sitesQuery.isError ? (
        <Alert severity="error" sx={{ borderRadius: 2 }}>无法加载站点列表：{errorText(sitesQuery.error)}</Alert>
      ) : filteredSites.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, color: 'text.secondary' }}>
          <EdgeOneIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
          <Typography variant="body1">{emptyText}</Typography>
        </Box>
      ) : (
        <>
          {isMobile ? (
            <Stack spacing={1.5}>{filteredSites.map((site) => (
              <SiteCard key={site.zoneId} site={site} expanded={expandedZone === site.zoneId}
                status={siteStatus(site)}
                onToggle={() => setExpandedZone(expandedZone === site.zoneId ? null : site.zoneId)}
                onFullSync={() => fullSyncMutation.mutate(site)} onVerify={() => verifySiteMutation.mutate(site)}
                onDelete={() => { setDeleteSite(site); setDeleteConfirm(''); }}
                fullSyncPending={fullSyncMutation.isPending} copied={copied} onCopy={copyText}
                showNotice={showNotice} />
            ))}</Stack>
          ) : (
            <TableContainer sx={{ width: '100%', maxWidth: '100%' }}>
              <Table size="small" sx={{ width: '100%', tableLayout: 'fixed' }}>
                <TableHead><TableRow>
                  <TableCell width={44} />
                  <TableCell>站点域名</TableCell>
                  <TableCell width={230}>Zone ID / 接入方式</TableCell>
                  <TableCell width={190}>状态 / 区域</TableCell>
                  <TableCell width={136} align="right">操作</TableCell>
                </TableRow></TableHead>
                <TableBody>{filteredSites.map((site) => (
                  <SiteRow key={site.zoneId} site={site} status={siteStatus(site)}
                    expanded={expandedZone === site.zoneId}
                    onToggle={() => setExpandedZone(expandedZone === site.zoneId ? null : site.zoneId)}
                    onFullSync={() => fullSyncMutation.mutate(site)} onVerify={() => verifySiteMutation.mutate(site)}
                    onDelete={() => { setDeleteSite(site); setDeleteConfirm(''); }}
                    fullSyncPending={fullSyncMutation.isPending} copied={copied} onCopy={copyText}
                    showNotice={showNotice} />
                ))}</TableBody>
              </Table>
            </TableContainer>
          )}

        </>
      )}

      {/* 创建站点 */}
      <Dialog open={siteDialogOpen} onClose={() => setSiteDialogOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>添加 EdgeOne 站点</DialogTitle>
        <DialogContent><Stack spacing={2.5} sx={{ mt: 1 }}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>一个站点对应一个域名。已有 DNSPod 托管接入的站点无需重复创建，直接展开管理加速域名即可。</Alert>
          {edgeOneCredentials.length > 1 && (
            <TextField select size="small" fullWidth label="账户" value={siteForm.credentialId}
              onChange={(e) => setSiteForm((f) => ({ ...f, credentialId: Number(e.target.value) }))}>
              {edgeOneCredentials.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          )}
          <TextField label="站点域名" size="small" fullWidth value={siteForm.domain}
            onChange={(e) => setSiteForm((f) => ({ ...f, domain: e.target.value }))} placeholder="example.com" />
          <TextField select size="small" fullWidth label="加速区域" value={siteForm.area}
            onChange={(e) => setSiteForm((f) => ({ ...f, area: e.target.value }))}
            helperText={EDGEONE_AREA_OPTIONS.find((o) => o.value === siteForm.area)?.help}>
            {EDGEONE_AREA_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" fullWidth label="绑定套餐" value={siteForm.planId}
            onChange={(e) => setSiteForm((f) => ({ ...f, planId: e.target.value }))}
            helperText={plansQuery.isLoading ? '正在加载套餐...' : '不绑定套餐时站点为未激活状态'}>
            <MenuItem value="">不绑定</MenuItem>
            {(plansQuery.data || []).map((p) => <MenuItem key={p.planId} value={p.planId}>{p.planId}{p.planType ? ` · ${p.planType}` : ''}{p.area ? ` · ${p.area}` : ''}</MenuItem>)}
          </TextField>
          {siteError && <Alert severity="error" sx={{ borderRadius: 2 }}>{siteError}</Alert>}
          {createdSite && <Alert severity="success" sx={{ borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight={600}>站点创建成功：{createdSite.domain}</Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>Zone ID：{createdSite.zoneId}</Typography>
            {createdSite.nameServers.length > 0 && <Box sx={{ mt: 1 }}>
              <Typography variant="body2">请到域名注册商把 NS 改为：</Typography>
              {createdSite.nameServers.map((ns) => <Stack key={ns} direction="row" alignItems="center" spacing={0.5}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{ns}</Typography>
                <IconButton size="small" onClick={() => copyText(ns, ns)}><CopyIcon fontSize="inherit" /></IconButton>
              </Stack>)}
              {copied && <Typography variant="caption" color="success.main">已复制 {copied}</Typography>}
            </Box>}
          </Alert>}
        </Stack></DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button color="inherit" onClick={() => setSiteDialogOpen(false)}>{createdSite ? '完成' : '取消'}</Button>
          {!createdSite && <Button variant="contained" onClick={() => createSiteMutation.mutate()} disabled={createSiteMutation.isPending}>
            {createSiteMutation.isPending ? '创建中...' : '创建站点'}
          </Button>}
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteSite} onClose={() => setDeleteSite(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除站点</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="warning" sx={{ borderRadius: 2 }}>这会删除 EdgeOne 上的站点及其加速域名，操作不可撤销。DNSPod 里的记录不会自动删除。</Alert>
          <Typography variant="body2">请输入站点域名 <strong>{deleteSite?.zoneName}</strong> 以确认：</Typography>
          <TextField size="small" fullWidth value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={deleteSite?.zoneName} />
        </Stack></DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button color="inherit" onClick={() => setDeleteSite(null)}>取消</Button>
          <Button color="error" variant="contained" disabled={deleteConfirm !== deleteSite?.zoneName || deleteSiteMutation.isPending}
            onClick={() => deleteSite && deleteSiteMutation.mutate(deleteSite)}>{deleteSiteMutation.isPending ? '删除中...' : '删除站点'}</Button>
        </DialogActions>
      </Dialog>

      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
    </Box>
  );
}

interface SiteActions {
  site: EdgeOneSite; status: ReturnType<typeof siteStatus>;
  expanded: boolean; onToggle: () => void; onFullSync: () => void;
  onVerify: () => void; onDelete: () => void; fullSyncPending: boolean;
  copied: string | null; onCopy: (k: string, t: string) => void;
  showNotice: ShowNotice;
}

/** 移动端标签统一样式：同高、同字号、圆角一致 */
const mobileTagSx = { height: 20, fontSize: '0.7rem', '& .MuiChip-label': { px: 0.75 } } as const;

/** 只用一个紧凑标签表示 DNSPod 关联，不再单独占一列 */
function DnspodTag({ link }: { link: EdgeOneSite['dnspodLink'] }) {
  if (!link.available) return null;
  return (
    <Tooltip title={`${link.credentialName || 'DNSPod'}${link.domain ? ` · ${link.domain}` : ''}，CNAME 自动同步`}>
      <Chip size="small" label="DNSPod" color="info" variant="outlined" sx={mobileTagSx} />
    </Tooltip>
  );
}

/** 移动端卡片：右上角 ⋮ 菜单，展开内容紧跟在当前卡片下方 */
function SiteCard(props: SiteActions) {
  const { site, status, expanded, onToggle, onFullSync, onVerify, onDelete, fullSyncPending, copied, onCopy, showNotice } = props;
  const link = site.dnspodLink;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = () => setMenuAnchor(null);

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, boxShadow: 'none', borderColor: expanded ? 'primary.main' : 'divider' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: expanded ? 0 : 2 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ wordBreak: 'break-all', minWidth: 0 }}>
            {site.zoneName}
          </Typography>
          <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0, mt: -0.5, mr: -0.5 }}>
            <Tooltip title="更多操作">
              <IconButton size="small" aria-label="站点操作" onClick={(e) => setMenuAnchor(e.currentTarget)}>
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={expanded ? '收起加速域名' : '展开加速域名'}>
              <IconButton size="small" aria-label="展开加速域名" onClick={onToggle}
                sx={{ color: expanded ? 'primary.main' : 'inherit' }}>
                {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={status.label} color={status.color} variant="outlined" sx={mobileTagSx} />
          <DnspodTag link={link} />
          <Chip size="small" label={site.type} variant="outlined" sx={mobileTagSx} />
          <Chip size="small" label={areaLabel(site.area)} variant="outlined" sx={mobileTagSx} />
        </Stack>

        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {site.zoneId}
          </Typography>
          <IconButton size="small" sx={{ p: 0.25 }} onClick={() => onCopy(site.zoneId, site.zoneId)}>
            <CopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
          {copied === site.zoneId && <Typography variant="caption" color="success.main">已复制</Typography>}
        </Stack>

        {site.nameServers.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, wordBreak: 'break-all' }}>
            NS：{site.nameServers.join(', ')}
          </Typography>
        )}
      </CardContent>

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Divider />
        <EdgeOneDomains site={site} isMobile showNotice={showNotice} />
      </Collapse>

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {link.available && (
          <MenuItem onClick={() => { closeMenu(); onFullSync(); }} disabled={fullSyncPending}>
            <SyncIcon fontSize="small" style={{ marginRight: 8 }} />全量同步到 DNSPod
          </MenuItem>
        )}
        <MenuItem onClick={() => { closeMenu(); onVerify(); }}>
          <CheckIcon fontSize="small" style={{ marginRight: 8 }} />检查归属权
        </MenuItem>
        <MenuItem onClick={() => { closeMenu(); onDelete(); }} sx={{ color: 'error.main' }}>
          <DeleteIcon fontSize="small" style={{ marginRight: 8 }} />删除站点
        </MenuItem>
      </Menu>
    </Card>
  );
}

/** 桌面端：展开行紧跟在当前站点行下方；站点表本身不横向滚动，域名表在自己的容器里滚动 */
function SiteRow(props: SiteActions) {
  const { site, status, expanded, onToggle, onFullSync, onVerify, onDelete, fullSyncPending, copied, onCopy, showNotice } = props;
  const link = site.dnspodLink;
  const [rowMenuAnchor, setRowMenuAnchor] = useState<HTMLElement | null>(null);
  const closeRowMenu = () => setRowMenuAnchor(null);
  const cellSx = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
  return (
    <>
      <TableRow hover selected={expanded} sx={{ '& > *': { borderBottom: expanded ? 'none' : undefined } }}>
        <TableCell sx={{ pr: 0 }}>
          <IconButton size="small" aria-label="展开加速域名" onClick={onToggle} sx={{ color: expanded ? 'primary.main' : 'inherit' }}>
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell sx={cellSx}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
            <Tooltip title={site.zoneName}>
              <Typography variant="body2" fontWeight={600} noWrap>{site.zoneName}</Typography>
            </Tooltip>
            <DnspodTag link={link} />
          </Stack>
        </TableCell>
        <TableCell sx={cellSx}>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{site.zoneId}</Typography>
            <Tooltip title="复制 Zone ID">
              <IconButton size="small" sx={{ p: 0.25 }} onClick={() => onCopy(site.zoneId, site.zoneId)}>
                <CopyIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            {copied === site.zoneId && <Typography variant="caption" color="success.main">已复制</Typography>}
          </Stack>
          <Chip size="small" label={site.type} variant="outlined" sx={{ mt: 0.5, height: 20, fontSize: '0.7rem' }} />
        </TableCell>
        <TableCell sx={cellSx}>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={status.label} color={status.color} variant="outlined" sx={{ height: 22 }} />
            <Chip size="small" label={areaLabel(site.area)} variant="outlined" sx={{ height: 22 }} />
          </Stack>
          {site.nameServers.length > 0 && (
            <Tooltip title={site.nameServers.join(', ')}>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.5 }}>NS：{site.nameServers.join(', ')}</Typography>
            </Tooltip>
          )}
        </TableCell>
        <TableCell align="right">
          <Tooltip title="更多操作">
            <IconButton size="small" aria-label="站点操作" onClick={(e) => setRowMenuAnchor(e.currentTarget)}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={5} sx={{ p: 0, borderBottom: expanded ? undefined : 'none' }}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <EdgeOneDomains site={site} isMobile={false} showNotice={showNotice} />
          </Collapse>
        </TableCell>
      </TableRow>
      <Menu anchorEl={rowMenuAnchor} open={!!rowMenuAnchor} onClose={closeRowMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {link.available && (
          <MenuItem onClick={() => { closeRowMenu(); onFullSync(); }} disabled={fullSyncPending}>
            <SyncIcon fontSize="small" style={{ marginRight: 8 }} />全量同步到 DNSPod
          </MenuItem>
        )}
        <MenuItem onClick={() => { closeRowMenu(); onVerify(); }}>
          <CheckIcon fontSize="small" style={{ marginRight: 8 }} />检查归属权
        </MenuItem>
        <MenuItem onClick={() => { closeRowMenu(); onDelete(); }} sx={{ color: 'error.main' }}>
          <DeleteIcon fontSize="small" style={{ marginRight: 8 }} />删除站点
        </MenuItem>
      </Menu>
    </>
  );
}

type DomainDraft = {
  name: string; origin: string; originProtocol: string;
  httpOriginPort: string; httpsOriginPort: string;
  hostHeaderMode: HostHeaderMode; hostHeader: string;
  applyFreeCert: boolean;
};
const EMPTY_DRAFT: DomainDraft = {
  name: '', origin: '', originProtocol: 'FOLLOW', httpOriginPort: '', httpsOriginPort: '',
  hostHeaderMode: 'default', hostHeader: '', applyFreeCert: false,
};

/** 新建 / 编辑共用同一份字段：不支持修改的项在编辑时置灰 */
function buildDraft(d?: EdgeOneDomain | null): DomainDraft {
  if (!d) return { ...EMPTY_DRAFT };
  const origin = d.origin || '';
  const hh = d.hostHeader || '';
  let hostHeaderMode: HostHeaderMode = 'default';
  if (hh === '$host') hostHeaderMode = 'request';
  else if (hh && hh === origin) hostHeaderMode = 'origin';
  else if (hh) hostHeaderMode = 'custom';
  return {
    name: d.domainName, origin, originProtocol: d.originProtocol || 'FOLLOW',
    httpOriginPort: String(d.httpOriginPort ?? ''), httpsOriginPort: String(d.httpsOriginPort ?? ''),
    hostHeaderMode, hostHeader: hostHeaderMode === 'custom' ? hh : '',
    applyFreeCert: d.certificateStatus === 'enabled',
  };
}

function resolveHostHeader(draft: DomainDraft): string {
  switch (draft.hostHeaderMode) {
    case 'request': return '$host';
    case 'origin': return draft.origin.trim();
    case 'custom': return draft.hostHeader.trim();
    default: return '';
  }
}

function DomainFormDialog({ open, mode, site, target, draft, onDraftChange, onClose, onSubmit, pending, error, created }: {
  open: boolean; mode: 'create' | 'edit'; site: EdgeOneSite; target: EdgeOneDomain | null;
  draft: DomainDraft; onDraftChange: (d: DomainDraft) => void; onClose: () => void;
  onSubmit: () => void; pending: boolean; error: string | null; created: CreateDomainResult | null;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isEdit = mode === 'edit';
  const set = (patch: Partial<DomainDraft>) => onDraftChange({ ...draft, ...patch });
  const useHttp = draft.originProtocol !== 'HTTPS';
  const useHttps = draft.originProtocol !== 'HTTP';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle>{isEdit ? '编辑加速域名' : '添加加速域名'} · {isEdit ? target?.domainName : site.zoneName}</DialogTitle>
      <DialogContent><Stack spacing={2.5} sx={{ mt: 1 }}>
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          {isEdit
            ? '仅可修改回源配置。DNS 值、CNAME 和证书由 EdgeOne 管理，灰色项不可修改。'
            : '创建后 EdgeOne 分配 CNAME 并自动写入同一把密钥托管的 DNSPod；删除时自动移除该 CNAME。'}
        </Alert>

        <TextField label="DNS 值" size="small" fullWidth value={draft.name} disabled={isEdit}
          onChange={(e) => set({ name: e.target.value })} placeholder="www / @ / 完整域名"
          helperText={isEdit ? '加速域名创建后不可修改' : '填 www 表示 www.站点域名'} />

        <TextField label="CNAME" size="small" fullWidth disabled value={isEdit ? (target?.cname || '') : ''}
          placeholder={isEdit ? '' : '创建后由 EdgeOne 自动分配'}
          helperText={isEdit ? '由 EdgeOne 分配，修改回源不会改变' : '创建成功后显示'} />

        <TextField label="回源 IP / 域名" size="small" fullWidth value={draft.origin}
          onChange={(e) => set({ origin: e.target.value })} placeholder="1.2.3.4 或 origin.example.com" />

        <TextField select size="small" fullWidth label="回源协议" value={draft.originProtocol}
          onChange={(e) => set({ originProtocol: e.target.value })}>
          {ORIGIN_PROTOCOL_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>

        <Stack direction={useHttp && useHttps ? 'row' : 'column'} spacing={2}>
          {useHttp && <TextField label="HTTP 回源端口" size="small" fullWidth type="number"
            value={draft.httpOriginPort} onChange={(e) => set({ httpOriginPort: e.target.value })}
            placeholder="80" />}
          {useHttps && <TextField label="HTTPS 回源端口" size="small" fullWidth type="number"
            value={draft.httpsOriginPort} onChange={(e) => set({ httpsOriginPort: e.target.value })}
            placeholder="443" />}
        </Stack>

        <TextField select size="small" fullWidth label="回源 Host" value={draft.hostHeaderMode}
          onChange={(e) => set({ hostHeaderMode: e.target.value as HostHeaderMode })}>
          {HOST_HEADER_MODE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
        {draft.hostHeaderMode === 'custom' && (
          <TextField label="自定义回源 Host" size="small" fullWidth value={draft.hostHeader}
            onChange={(e) => set({ hostHeader: e.target.value })} placeholder="例如 vw46.example.com" />
        )}

        <Box>
          <FormControlLabel
            control={<Checkbox size="small" checked={draft.applyFreeCert} disabled={isEdit}
              onChange={(e) => set({ applyFreeCert: e.target.checked })} />}
            label="同时申请 EdgeOne 免费 SSL 证书" />
          {isEdit
            ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4.5 }}>证书请在列表的「免费证书」列申请</Typography>
            : draft.applyFreeCert && <Alert severity="info" sx={{ borderRadius: 2 }}>NS / DNSPod 托管接入由 EdgeOne 自动验证申请；已开启的域名会自动跳过。</Alert>}
        </Box>

        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
        {created && <Alert severity={created.dnspodSync?.error ? 'warning' : 'success'} sx={{ borderRadius: 2 }}>
          <Typography variant="subtitle2" fontWeight={600}>创建成功：{created.domainName}</Typography>
          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>CNAME：{created.cname || 'EdgeOne 尚未返回'}</Typography>
          <Typography variant="body2">DNSPod 同步：{created.dnspodSync?.error || created.dnspodSync?.action || 'none'}</Typography>
          {created.certificate && <Typography variant="body2">证书：{created.certificate.status === 'applying' ? '申请中' : created.certificate.status === 'enabled' ? '已开启' : (created.certificate.reason || '未开启，可在列表开关重试')}</Typography>}
        </Alert>}
      </Stack></DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button color="inherit" onClick={onClose}>{created ? '完成' : '取消'}</Button>
        {!created && <Button variant="contained" disabled={pending} onClick={onSubmit}>
          {pending ? '保存中...' : isEdit ? '保存' : '创建并同步'}
        </Button>}
      </DialogActions>
    </Dialog>
  );
}

function EdgeOneDomains({ site, isMobile, showNotice }: { site: EdgeOneSite; isMobile: boolean; showNotice: ShowNotice }) {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formTarget, setFormTarget] = useState<EdgeOneDomain | null>(null);
  const [draft, setDraft] = useState<DomainDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateDomainResult | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EdgeOneDomain | null>(null);
  const [applyingDomains, setApplyingDomains] = useState<Set<string>>(new Set());

  const domainsQuery = useQuery({
    queryKey: ['edgeone', 'domains', site.credentialId, site.zoneId],
    queryFn: async () => (await listEdgeOneDomains({ credentialId: site.credentialId, zoneId: site.zoneId })).data,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const domains = domainsQuery.data?.domains || [];
  const domainsTable = useStickyActionColumn(`${site.zoneId}-${domains.length}`);
  const link = domainsQuery.data?.dnspodLink;
  /** 只刷新当前域名列表，不连带刷新站点列表，避免整页重渲染闪烁 */
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['edgeone', 'domains', site.credentialId, site.zoneId] }); };

  const openCreate = () => { setFormMode('create'); setFormTarget(null); setDraft({ ...EMPTY_DRAFT }); setFormError(null); setCreated(null); setFormOpen(true); };
  const openEdit = (d: EdgeOneDomain) => { setFormMode('edit'); setFormTarget(d); setDraft(buildDraft(d)); setFormError(null); setCreated(null); setFormOpen(true); };

  const formMutation = useMutation({
    mutationFn: () => {
      if (formMode === 'create' && !draft.name.trim()) throw new Error('请填写 DNS 值');
      if (!draft.origin.trim()) throw new Error('请填写回源 IP / 域名');
      if (draft.hostHeaderMode === 'custom' && !draft.hostHeader.trim()) throw new Error('请填写自定义回源 Host');
      const httpPort = httpDisabled(draft) ? undefined : Number(draft.httpOriginPort || 80);
      const httpsPort = httpsDisabled(draft) ? undefined : Number(draft.httpsOriginPort || 443);
      for (const [label, port] of [['HTTP 回源端口', httpPort], ['HTTPS 回源端口', httpsPort]] as const) {
        if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error(`${label} 取值范围为 1 ~ 65535`);
      }
      if (formMode === 'edit') {
        if (!formTarget) throw new Error('未选择域名');
        return updateEdgeOneDomain({
          credentialId: site.credentialId, zoneId: site.zoneId, domainName: formTarget.domainName,
          origin: draft.origin.trim(), originProtocol: draft.originProtocol,
          httpOriginPort: httpPort, httpsOriginPort: httpsPort,
          hostHeader: resolveHostHeader(draft),
        });
      }
      return createEdgeOneDomain({
        credentialId: site.credentialId, zoneId: site.zoneId,
        name: draft.name.trim(), origin: draft.origin.trim(), originProtocol: draft.originProtocol,
        httpOriginPort: httpPort, httpsOriginPort: httpsPort,
        hostHeaderMode: draft.hostHeaderMode, hostHeader: draft.hostHeader.trim() || undefined,
        applyFreeCert: draft.applyFreeCert,
      });
    },
    onSuccess: (resp) => {
      if (formMode === 'create') {
        setCreated(resp.data as CreateDomainResult || null);
        showNotice('success', `加速域名已创建，CNAME 已同步 DNSPod`);
      } else {
        setFormOpen(false);
        showNotice('success', `${formTarget?.domainName || '域名'} 已更新`);
      }
      invalidate();
    },
    onError: (err) => setFormError(errorText(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (d: EdgeOneDomain) => deleteEdgeOneDomain({ credentialId: site.credentialId, zoneId: site.zoneId, domainName: d.domainName }),
    onSuccess: () => { setDeleteTarget(null); showNotice('success', '加速域名已删除，DNSPod CNAME 已移除'); invalidate(); },
    onError: (err) => showNotice('error', errorText(err)),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { d: EdgeOneDomain; status: 'online' | 'offline' }) => setEdgeOneDomainStatus({
      credentialId: site.credentialId, zoneId: site.zoneId, domainName: vars.d.domainName, status: vars.status,
    }),
    onSuccess: (_resp, vars) => {
      showNotice('success', `${vars.d.domainName} 已${vars.status === 'online' ? '启用' : '停用'}${vars.status === 'offline' ? '，现在可以删除' : ''}`);
      invalidate();
      window.setTimeout(invalidate, 1500);
    },
    onError: (err, vars) => showNotice('error', `${vars.d.domainName}：${errorText(err)}`),
  });

  const certMutation = useMutation({
    mutationFn: (d: EdgeOneDomain) => {
      setApplyingDomains((prev) => new Set(prev).add(d.domainName));
      return enableEdgeOneFreeCertificate({ credentialId: site.credentialId, zoneId: site.zoneId, domainName: d.domainName });
    },
    onSuccess: (resp, d) => {
      const r = resp.data;
      showNotice(r?.status === 'disabled' ? 'error' : 'success',
        r?.status === 'applying' ? `${d.domainName} 免费证书申请已提交，EdgeOne 正在自动验证`
          : r?.status === 'enabled' ? `${d.domainName} 免费证书已开启` : (r?.reason || '申请失败，可重试'));
      invalidate();
    },
    onError: (err, d) => showNotice('error', `${d.domainName}：${errorText(err)}`),
    onSettled: (_r, _e, d) => {
      setApplyingDomains((prev) => { const next = new Set(prev); next.delete(d.domainName); return next; });
      window.setTimeout(invalidate, 1500);
    },
  });

  const canDelete = (d: EdgeOneDomain) => ['offline', 'init'].includes(String(d.domainStatus || '').toLowerCase());
  const statusPending = (d: EdgeOneDomain) => statusMutation.isPending && statusMutation.variables?.d.domainName === d.domainName;

  /**
   * 免费证书是单向操作（只能申请，不能在此关闭）。
   * 用紧凑的 TLS 标签表示，不再单独占一列；未开启时点击即申请。
   */
  const certTag = (d: EdgeOneDomain) => {
    const applying = applyingDomains.has(d.domainName) || certMutation.isPending && certMutation.variables?.domainName === d.domainName;
    const chipSx = { height: 20, fontSize: '0.7rem', '& .MuiChip-label': { px: 0.75 } } as const;
    if (applying) {
      return <Chip size="small" variant="outlined" color="warning" label="TLS" sx={chipSx} />;
    }
    if (d.certificateStatus === 'enabled') {
      return (
        <Tooltip title="已启用 EdgeOne 免费证书">
          <Chip size="small" variant="outlined" color="secondary" label="TLS" sx={chipSx} />
        </Tooltip>
      );
    }
    if (d.certificateStatus === 'unknown') {
      return <Tooltip title="未获取到证书状态"><Chip size="small" variant="outlined" label="TLS" sx={chipSx} /></Tooltip>;
    }
    return (
      <Tooltip title="申请 EdgeOne 免费证书">
        <Chip size="small" variant="outlined" label="TLS" clickable onClick={() => certMutation.mutate(d)} sx={chipSx} />
      </Tooltip>
    );
  };

  /** 操作区沿用其它列表样式：gap 1 + 小号 IconButton，编辑主色、删除错误色 */
  const actionButtons = (d: EdgeOneDomain) => (
    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', whiteSpace: 'nowrap', flexWrap: 'nowrap', '& > *': { flexShrink: 0 } }}>
      <Tooltip title="编辑回源配置">
        <IconButton size="small" onClick={() => openEdit(d)} sx={{ color: 'primary.main' }}>
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {String(d.domainStatus || '').toLowerCase() === 'offline' ? (
        <Tooltip title="启用">
          <IconButton size="small" onClick={() => statusMutation.mutate({ d, status: 'online' })} disabled={statusPending(d)} sx={{ color: 'success.main' }}>
            <ResumeIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Tooltip title="停用（删除前需先停用）">
          <IconButton size="small" onClick={() => statusMutation.mutate({ d, status: 'offline' })} disabled={statusPending(d)} sx={{ color: 'warning.main' }}>
            <PauseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title={canDelete(d) ? '删除记录' : '请先停用后再删除'}>
        <span>
          <IconButton size="small" color="error" disabled={!canDelete(d)} onClick={() => setDeleteTarget(d)}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );

  const linkAlert = (
    <Alert severity={link?.available ? 'info' : 'warning'} sx={{ mb: 2, borderRadius: 2 }}>
      {link?.available
        ? `已用同一把密钥自动关联 DNSPod：${link.credentialName || ''} / ${link.domain}。新增域名自动写 CNAME，删除自动移除；证书开关以 EdgeOne 自身状态为准。`
        : `未发现自动关联的 DNSPod 域名${link?.reason ? `：${link.reason}` : ''}。EdgeOne 域名仍可管理，但 CNAME 不会自动同步。`}
    </Alert>
  );

  return (
    <Box sx={{ py: { xs: 1, sm: 2 }, px: { xs: 2, sm: 3 }, bgcolor: 'background.default', width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={{ xs: 2, sm: 0 }} sx={{ borderBottom: { xs: 'none', sm: '1px solid rgba(0, 0, 0, 0.12)' }, mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="subtitle1" fontWeight={600}>加速域名</Typography>
          <Chip size="small" label={`${domains.length} 个`} variant="outlined" />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mb: 1, width: { xs: '100%', sm: 'auto' } }}>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={() => { void domainsQuery.refetch(); }}
            disabled={domainsQuery.isFetching} sx={{ flex: { xs: 1, sm: 'none' } }}>
            {domainsQuery.isFetching ? '刷新中...' : '刷新'}
          </Button>
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ flex: { xs: 1, sm: 'none' } }}>添加域名</Button>
        </Stack>
      </Stack>

      {linkAlert}
      {domainsQuery.isError && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>无法加载加速域名：{errorText(domainsQuery.error)}</Alert>}

      {domainsQuery.isLoading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>
        : isMobile ? (domains.length === 0
          ? <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}><Typography variant="body1">暂无加速域名</Typography></Box>
          : <Stack spacing={1.5}>{domains.map((d) => {
          const tag = dnspodTag(d);
          const st = domainStatusChip(d.domainStatus);
          return <Card key={d.domainName} variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
              <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-all', minWidth: 0 }}>
                {d.domainName}
              </Typography>
              <Box sx={{ flexShrink: 0, mt: -0.5, mr: -0.5 }}>{actionButtons(d)}</Box>
            </Stack>

            <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={st.label} color={st.color} variant="outlined" sx={mobileTagSx} />
              {certTag(d)}
              {tag && (
                <Tooltip title={tag.title}>
                  <Chip size="small" label={tag.label} color={tag.color} variant="outlined" sx={mobileTagSx} />
                </Tooltip>
              )}
            </Stack>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, wordBreak: 'break-all' }}>
              CNAME：{d.cname || '-'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, wordBreak: 'break-all' }}>
              回源：{d.origin || '-'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-all' }}>
              协议：{originPortSummary(d)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-all' }}>
              Host：{d.hostHeader || '-'}
            </Typography>
          </CardContent></Card>;
        })}</Stack>)
        : <TableContainer ref={domainsTable.containerRef} sx={{ width: '100%', overflowX: 'auto', maxWidth: '100%' }}>
          <Table size="small" sx={{ minWidth: 920, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
            <TableHead><TableRow>
              <TableCell sx={{ minWidth: 190 }}>DNS 值</TableCell>
              <TableCell sx={{ minWidth: 90 }}>状态</TableCell>
              <TableCell sx={{ minWidth: 190, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>CNAME</TableCell>
              <TableCell sx={{ minWidth: 180, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>回源</TableCell>
              <TableCell align="right" sx={{ minWidth: 150, ...domainsTable.headerCellSx }}>操作</TableCell>
            </TableRow></TableHead>
            <TableBody>{domains.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 8 }}>
                  <Typography variant="body1" color="text.secondary">暂无加速域名</Typography>
                </TableCell>
              </TableRow>
            ) : domains.map((d) => {
              const st = domainStatusChip(d.domainStatus);
              const tag = dnspodTag(d);
              const cellSx = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
              return <TableRow key={d.domainName} hover>
                <TableCell sx={{ ...cellSx, fontFamily: 'monospace' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                    <Tooltip title={d.domainName}><span>{d.domainName}</span></Tooltip>
                    {certTag(d)}
                  </Box>
                </TableCell>
                <TableCell><Chip size="small" label={st.label} color={st.color} variant="outlined" /></TableCell>
                <TableCell sx={{ ...cellSx, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                    <Tooltip title={d.cname || '-'}><span>{d.cname || '-'}</span></Tooltip>
                    {tag && (
                      <Tooltip title={tag.title}>
                        <Chip size="small" label={tag.label} color={tag.color} variant="outlined"
                          sx={{ height: 18, fontSize: '0.65rem', flexShrink: 0, '& .MuiChip-label': { px: 0.6 } }} />
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>
                <TableCell sx={cellSx}>
                  <Tooltip title={originDetail(d)}><span>{d.origin || '-'}</span></Tooltip>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>{originPortSummary(d)}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>Host {d.hostHeader || '-'}</Typography>
                </TableCell>
                <TableCell align="right" sx={domainsTable.bodyCellSx}>{actionButtons(d)}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </TableContainer>}

      <DomainFormDialog open={formOpen} mode={formMode} site={site} target={formTarget}
        draft={draft} onDraftChange={setDraft} onClose={() => setFormOpen(false)}
        onSubmit={() => { setFormError(null); formMutation.mutate(); }}
        pending={formMutation.isPending} error={formError} created={created} />

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除加速域名</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="warning" sx={{ borderRadius: 2 }}>
            将删除 EdgeOne 加速域名 <strong>{deleteTarget?.domainName}</strong>，并自动移除 DNSPod 中指向其 CNAME 的记录。
          </Alert>
          <Typography variant="caption" color="text.secondary">
            当前状态：{deleteTarget?.domainStatus || '未知'}。仅已停用或未生效的域名可以删除；若删除按钮为灰色，请先点停用。
          </Typography>
        </Stack></DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button color="inherit" onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button color="error" variant="contained" disabled={deleteMutation.isPending}
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}>
            {deleteMutation.isPending ? '删除中...' : '删除并同步'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const httpDisabled = (draft: DomainDraft) => draft.originProtocol === 'HTTPS';
const httpsDisabled = (draft: DomainDraft) => draft.originProtocol === 'HTTP';
