import { useCallback, useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MenuItem as MuiMenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  DeleteOutline as DeleteIcon,
  LockReset as ResetIcon,
  People as PeopleIcon,
  Refresh as RefreshIcon,
  Block as BlockIcon,
  CheckCircleOutline as EnableIcon,
  MoreVert as MoreVertIcon,
  HowToReg as ApproveIcon,
  AdminPanelSettings as RoleIcon,
  Person as UserIcon,
} from '@mui/icons-material';
import {
  ManagedUser,
  SystemSettings,
  approveUser,
  createUser,
  deleteUser,
  getUsersContext,
  resetUserPassword,
  setUserActive,
  updateUserRole,
} from '@/services/users';
import { getStoredUser } from '@/services/auth';
import { UserRole } from '@/types';
import { isStrongPassword } from '@/utils/validators';

const cardShadow = '0 4px 20px rgba(0,0,0,0.05)';

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function normalizeError(error: any, fallback: string) {
  const raw = error?.message || String(error || '');
  return raw || fallback;
}

function StatusChips({ user }: { user: ManagedUser }) {
  return (
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
      <Chip
        size="small"
        label={user.role === 'admin' ? '管理员' : '普通用户'}
        color={user.role === 'admin' ? 'warning' : 'default'}
        variant="outlined"
      />
      {user.pendingApproval ? <Chip size="small" label="待审核" color="warning" /> : null}
      {!user.isActive ? <Chip size="small" label="已禁用" color="error" variant="outlined" /> : null}
      {user.isActive && !user.pendingApproval ? <Chip size="small" label="启用" color="success" variant="outlined" /> : null}
    </Stack>
  );
}

function MetaLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 56 }}>{label}</Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{value || '-'}</Typography>
    </Stack>
  );
}

export default function Users() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const currentUserId = getStoredUser()?.id;

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 行操作菜单（PC / 移动端共用）
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuUser, setMenuUser] = useState<ManagedUser | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', email: '', password: '', role: 'user' as UserRole });
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetting, setResetting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getUsersContext();
      setUsers(res?.data?.users || []);
      setSettings(res?.data?.settings || null);
    } catch (err: any) {
      setError(normalizeError(err, '获取用户列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (message: string) => {
    setSuccess(message);
    setActionError('');
    window.setTimeout(() => setSuccess(''), 4000);
  };

  const multiUserEnabled = settings?.multiUserEnabled !== false;

  const openMenu = (event: ReactMouseEvent<HTMLElement>, user: ManagedUser) => {
    setMenuAnchor(event.currentTarget);
    setMenuUser(user);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuUser(null);
  };

  const runAction = async (fn: () => Promise<void>, okMessage: string) => {
    try {
      setActionError('');
      await fn();
      flash(okMessage);
      await load();
    } catch (err: any) {
      setActionError(normalizeError(err, '操作失败'));
    }
  };

  const handleRole = (user: ManagedUser, role: UserRole) => {
    closeMenu();
    if (!multiUserEnabled) return;
    void runAction(
      () => updateUserRole(user.id, role).then(() => undefined),
      `已将 ${user.username} 设为${role === 'admin' ? '管理员' : '普通用户'}`
    );
  };

  const handleActive = (user: ManagedUser, isActive: boolean) => {
    closeMenu();
    if (!multiUserEnabled) return;
    void runAction(
      () => setUserActive(user.id, isActive).then(() => undefined),
      `账号 ${user.username} 已${isActive ? '启用' : '禁用'}`
    );
  };

  const handleApprove = (user: ManagedUser) => {
    closeMenu();
    if (!multiUserEnabled) return;
    void runAction(
      () => approveUser(user.id).then(() => undefined),
      `${user.username} 审核通过，现在可以登录`
    );
  };

  const handleCreate = async () => {
    setCreateError('');
    if (!createForm.username.trim()) return setCreateError('请输入用户名');
    if (createForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createForm.email.trim())) {
      return setCreateError('邮箱格式不正确');
    }
    if (!isStrongPassword(createForm.password)) {
      return setCreateError('密码至少 8 位，包含大小写字母和数字');
    }
    try {
      setCreating(true);
      await createUser({
        username: createForm.username.trim(),
        email: createForm.email.trim() || undefined,
        password: createForm.password,
        role: createForm.role,
      });
      setCreateOpen(false);
      setCreateForm({ username: '', email: '', password: '', role: 'user' });
      flash('用户创建成功');
      await load();
    } catch (err: any) {
      setCreateError(normalizeError(err, '创建用户失败'));
    } finally {
      setCreating(false);
    }
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    setResetError('');
    if (!isStrongPassword(resetPassword)) {
      return setResetError('密码至少 8 位，包含大小写字母和数字');
    }
    try {
      setResetting(true);
      await resetUserPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword('');
      flash('密码已重置，该账号的旧会话已失效');
    } catch (err: any) {
      setResetError(normalizeError(err, '重置密码失败'));
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      setActionError('');
      await deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      flash('用户已删除，其关联数据已清理');
      await load();
    } catch (err: any) {
      setActionError(normalizeError(err, '删除用户失败'));
    } finally {
      setDeleting(false);
    }
  };

  const header = (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      justifyContent="space-between"
      alignItems={{ xs: 'stretch', sm: 'center' }}
      sx={{ mb: 3 }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <PeopleIcon color="primary" />
        <Box>
          <Typography variant="h5" fontWeight="bold">用户管理</Typography>
          <Typography variant="body2" color="text.secondary">
            仅管理员可见。普通用户只能管理自己的凭证、域名与证书数据。
          </Typography>
        </Box>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>刷新</Button>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          disabled={!multiUserEnabled}
        >
          创建用户
        </Button>
      </Stack>
    </Stack>
  );

  const feedback = (
    <>
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {actionError ? <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert> : null}
      {success ? <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert> : null}
      {!multiUserEnabled ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          多用户功能已在「设置 → 账号与注册」中关闭，用户管理目前为只读。
        </Alert>
      ) : null}
    </>
  );

  const emptyState = (
    <Box sx={{ border: '1px dashed divider', borderRadius: 2, px: 2.5, py: 4, bgcolor: 'background.default', textAlign: 'center' }}>
      <PeopleIcon sx={{ fontSize: 40, opacity: 0.3, mb: 1 }} />
      <Typography variant="body2" fontWeight={600}>暂无用户</Typography>
    </Box>
  );

  const renderDesktop = () => (
    <Card sx={{ boxShadow: cardShadow, border: 'none', overflow: 'hidden' }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>用户名</TableCell>
              <TableCell>邮箱</TableCell>
              <TableCell>角色 / 状态</TableCell>
              <TableCell>2FA</TableCell>
              <TableCell>创建时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <TableRow key={user.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" fontWeight={600}>{user.username}</Typography>
                      {isSelf ? <Chip size="small" label="当前账号" color="primary" variant="outlined" /> : null}
                    </Stack>
                  </TableCell>
                  <TableCell>{user.email || '-'}</TableCell>
                  <TableCell><StatusChips user={user} /></TableCell>
                  <TableCell>{user.twoFactorEnabled ? '已开启' : '-'}</TableCell>
                  <TableCell>{formatTime(user.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="更多操作">
                      <span>
                        <IconButton size="small" disabled={isSelf || !multiUserEnabled} onClick={(e) => openMenu(e, user)}>
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {users.length === 0 ? (
              <TableRow><TableCell colSpan={6} sx={{ p: 0, border: 0 }}>{emptyState}</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );

  const renderMobile = () => (
    <Stack spacing={2}>
      {users.length === 0 ? emptyState : users.map((user) => {
        const isSelf = user.id === currentUserId;
        return (
          <Card key={user.id} variant="outlined" sx={{ borderRadius: 2, boxShadow: cardShadow }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                    <Typography variant="subtitle1" fontWeight={600} sx={{ wordBreak: 'break-all' }}>
                      {user.username}
                    </Typography>
                    {isSelf ? <Chip size="small" label="当前账号" color="primary" variant="outlined" /> : null}
                  </Stack>
                  <Box sx={{ mt: 1 }}><StatusChips user={user} /></Box>
                </Box>
                <Tooltip title="更多操作">
                  <span>
                    <IconButton size="small" disabled={isSelf || !multiUserEnabled} onClick={(e) => openMenu(e, user)}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              <Stack spacing={0.75}>
                <MetaLine label="邮箱" value={user.email} />
                <MetaLine label="2FA" value={user.twoFactorEnabled ? '已开启' : '未开启'} />
                <MetaLine label="创建" value={formatTime(user.createdAt)} />
              </Stack>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );

  return (
    <Box>
      {header}
      {feedback}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : isMobile ? renderMobile() : renderDesktop()}

      {/* 行操作菜单：PC 与移动端共用，符合 UI/UX §8.3 */}
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {menuUser?.pendingApproval ? (
          <MenuItem onClick={() => menuUser && handleApprove(menuUser)}>
            <ListItemIcon><ApproveIcon fontSize="small" color="success" /></ListItemIcon>
            <ListItemText>通过审核</ListItemText>
          </MenuItem>
        ) : null}
        <MenuItem onClick={() => menuUser && handleRole(menuUser, 'admin')} disabled={menuUser?.role === 'admin'}>
          <ListItemIcon><RoleIcon fontSize="small" /></ListItemIcon>
          <ListItemText>设为管理员</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => menuUser && handleRole(menuUser, 'user')} disabled={menuUser?.role === 'user'}>
          <ListItemIcon><UserIcon fontSize="small" /></ListItemIcon>
          <ListItemText>设为普通用户</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { if (menuUser) { const u = menuUser; closeMenu(); setResetTarget(u); setResetPassword(''); setResetError(''); } }}>
          <ListItemIcon><ResetIcon fontSize="small" /></ListItemIcon>
          <ListItemText>重置密码</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => menuUser && handleActive(menuUser, !menuUser.isActive)}>
          <ListItemIcon>
            {menuUser?.isActive ? <BlockIcon fontSize="small" /> : <EnableIcon fontSize="small" color="success" />}
          </ListItemIcon>
          <ListItemText>{menuUser?.isActive ? '禁用账号' : '启用账号'}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { if (menuUser) { const u = menuUser; closeMenu(); setDeleteTarget(u); } }}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText sx={{ color: 'error.main' }}>删除用户</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} fullWidth maxWidth="sm" fullScreen={isMobile}>
        <DialogTitle>创建用户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {createError ? <Alert severity="error">{createError}</Alert> : null}
            <TextField
              label="用户名"
              fullWidth
              value={createForm.username}
              onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
              helperText="3-32 位字母、数字、_、. 或 -"
            />
            <TextField
              label="邮箱（可选）"
              fullWidth
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
            />
            <TextField
              label="初始密码"
              type="password"
              fullWidth
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              helperText="至少 8 位，包含大小写字母和数字"
            />
            <FormControl fullWidth>
              <InputLabel id="create-user-role-label">角色</InputLabel>
              <Select
                labelId="create-user-role-label"
                label="角色"
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as UserRole })}
              >
                <MuiMenuItem value="user">普通用户（仅管理自己的数据）</MuiMenuItem>
                <MuiMenuItem value="admin">管理员（可管理用户）</MuiMenuItem>
              </Select>
            </FormControl>
            {createForm.role === 'admin' ? (
              <Alert severity="warning">管理员可以创建、禁用、删除其他用户并重置其密码，请谨慎授予。</Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>取消</Button>
          <Button variant="contained" onClick={handleCreate} disabled={creating}>创建</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!resetTarget} onClose={() => !resetting && setResetTarget(null)} fullWidth maxWidth="xs" fullScreen={isMobile}>
        <DialogTitle>重置密码</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              为 <strong>{resetTarget?.username}</strong> 设置新密码。该账号的旧登录会话与 2FA 将立即失效，需要重新登录。
            </Typography>
            {resetError ? <Alert severity="error">{resetError}</Alert> : null}
            <TextField
              label="新密码"
              type="password"
              fullWidth
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              helperText="至少 8 位，包含大小写字母和数字"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetTarget(null)} disabled={resetting}>取消</Button>
          <Button variant="contained" onClick={handleReset} disabled={resetting}>确认重置</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} fullWidth maxWidth="xs" fullScreen={isMobile}>
        <DialogTitle>删除用户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              确定删除 <strong>{deleteTarget?.username}</strong> 吗？
            </Typography>
            <Alert severity="warning">
              该用户的 DNS 凭证、证书订单、部署目标、API Key 与操作日志会一并删除，且不可恢复。
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>确认删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
