import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  IconButton,
  Drawer,
  useTheme,
  useMediaQuery,
  Breadcrumbs,
  Typography,
  Link
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  NavigateNext as NavigateNextIcon
} from '@mui/icons-material';
import Sidebar from './Sidebar';
import { useBreadcrumb } from '@/contexts/BreadcrumbContext';
import { useProvider } from '@/contexts/ProviderContext';
import { getCurrentUser, getStoredUser, mergeStoredUser } from '@/services/auth';
import { getSystemStatus } from '@/services/users';
import { UserRole } from '@/types';

export const SYSTEM_SETTINGS_CHANGED_EVENT = 'dns-panel:system-settings-changed';

const drawerWidth = 260;

const breadcrumbNameMap: Record<string, string> = {
  certificates: '证书中心',
  logs: '操作日志',
  settings: '设置',
  users: '用户管理',
  docs: 'API 文档',
  tunnels: 'Tunnels',
};

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();

  const { labels } = useBreadcrumb();
  const { selectedProvider, providers, selectProvider } = useProvider();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userRole, setUserRole] = useState<UserRole | undefined>(() => getStoredUser()?.role);
  const [multiUserEnabled, setMultiUserEnabled] = useState(true);

  // 旧版本登录态的本地缓存没有 role，进入面板后从服务端同步一次。
  // 后端仍会在每个请求上校验角色，这里只用于正确显示/隐藏管理员入口。
  useEffect(() => {
    getCurrentUser()
      .then((res) => {
        const user = res?.data?.user;
        if (!user) return;
        mergeStoredUser(user);
        setUserRole(user.role);
      })
      .catch(() => {});
  }, []);

  // 多用户开关：关闭后侧边栏不展示「用户管理」入口
  useEffect(() => {
    const sync = () => {
      getSystemStatus()
        .then((res) => setMultiUserEnabled(res?.data?.multiUserEnabled !== false))
        .catch(() => setMultiUserEnabled(true));
    };
    sync();
    window.addEventListener(SYSTEM_SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SYSTEM_SETTINGS_CHANGED_EVENT, sync);
  }, []);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#1e293b' }}>
      <Sidebar
        onClose={() => isMobile && setMobileOpen(false)}
        userRole={userRole}
        multiUserEnabled={multiUserEnabled}
      />
    </Box>
  );

  // 自定义面包屑生成逻辑
  const generateBreadcrumbs = () => {
    const pathParts = location.pathname.split('/').filter(x => x);
    const crumbs: JSX.Element[] = [];

    // 首页 (仪表盘) 总是存在的
    crumbs.push(
      <Link 
        underline="hover" 
        color="inherit" 
        onClick={() => {
          selectProvider(null);
          navigate('/?scope=all');
        }}
        key="home"
        sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
      >
        <DashboardIcon sx={{ mr: 0.5 }} fontSize="inherit" />
        仪表盘
      </Link>
    );

    // 如果选择了供应商，添加供应商面包屑
    if (selectedProvider) {
      const providerConfig = providers.find(p => p.type === selectedProvider);
      const providerName = providerConfig?.name || selectedProvider;
      
      const isAtRoot = location.pathname === '/' || location.pathname === '';
      
      if (isAtRoot) {
        // 在根路径下，显示为当前页（文本）
        crumbs.push(
          <Typography color="text.primary" key="provider" sx={{ fontWeight: 700 }}>
            {providerName}
          </Typography>
        );
      } else {
        // 在子路径下，显示为链接
        crumbs.push(
          <Link 
            underline="hover" 
            color="inherit" 
            onClick={() => navigate('/')} 
            key="provider"
            sx={{ cursor: 'pointer' }}
          >
            {providerName}
          </Link>
        );
      }
    }

    // 处理特殊路由结构
    if (pathParts[0] === 'domain' && pathParts[1]) {
      // /domain/:id
      const domainId = pathParts[1];
      const domainName = labels[domainId] || domainId;
      
      crumbs.push(
        <Typography color="text.primary" key="domain" sx={{ fontWeight: 700 }}>
          {domainName}
        </Typography>
      );
    } else if (pathParts[0] === 'hostnames' && pathParts[1]) {
      // /hostnames/:id
      const domainId = pathParts[1];
      const domainName = labels[domainId] || domainId;
      const credentialId = new URLSearchParams(location.search).get('credentialId');
      const domainLink = credentialId ? `/domain/${domainId}?credentialId=${credentialId}` : `/domain/${domainId}`;

      // 添加上一级：域名详情
      crumbs.push(
        <Link 
          underline="hover" 
          color="inherit" 
          onClick={() => navigate(domainLink)}
          key="domain-parent"
          sx={{ cursor: 'pointer' }}
        >
          {domainName}
        </Link>
      );

      // 添加当前级：主机名
      crumbs.push(
        <Typography color="text.primary" key="hostnames" sx={{ fontWeight: 700 }}>
          主机名管理
        </Typography>
      );
    } else if (pathParts[0] === 'tunnels') {
      // /tunnels
      // /tunnels/:zoneId (legacy) - Tunnel 是账户级功能，不按域名区分
      crumbs.push(
        <Typography color="text.primary" key="tunnels" sx={{ fontWeight: 700 }}>
          Tunnels
        </Typography>
      );
    } else {
      // 默认处理 (如 /logs, /settings)
      // 如果有 selectedProvider 且在根路径，pathParts 为空，循环不会执行
      // 如果 pathParts 不为空，说明在其他页面
      
      pathParts.forEach((value, index) => {
        const last = index === pathParts.length - 1;
        const to = `/${pathParts.slice(0, index + 1).join('/')}`;
        const name = labels[value] || breadcrumbNameMap[value] || value;

        if (last) {
          crumbs.push(
            <Typography color="text.primary" key={to} sx={{ fontWeight: 700 }}>
              {name}
            </Typography>
          );
        } else {
          crumbs.push(
            <Link 
              underline="hover" 
              color="inherit" 
              onClick={() => navigate(to)}
              key={to}
              sx={{ cursor: 'pointer' }}
            >
              {name}
            </Link>
          );
        }
      });
    }

    return crumbs;
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: theme.palette.background.default }}>
      
      {/* 移动端菜单按钮 */}
      <IconButton
        color="inherit"
        aria-label="open drawer"
        edge="start"
        onClick={handleDrawerToggle}
        sx={{ 
          position: 'fixed',
          top: 16,
          left: 16,
          zIndex: (theme) => theme.zIndex.drawer + 2,
          bgcolor: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(4px)',
          boxShadow: 1,
          display: { sm: 'none' },
          '&:hover': { bgcolor: 'white' }
        }}
      >
        <MenuIcon />
      </IconButton>

      {/* 侧边栏容器 */}
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { 
              boxSizing: 'border-box', 
              width: drawerWidth,
              bgcolor: '#1e293b', 
              borderRight: '1px solid rgba(255,255,255,0.1)'
            },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { 
              boxSizing: 'border-box', 
              width: drawerWidth,
              bgcolor: '#1e293b', 
              borderRight: '1px solid rgba(255,255,255,0.1)',
              height: '100%' 
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      {/* 主内容区域 */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 4 },
          pt: { xs: 8, sm: 3 }, 
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          minHeight: '100vh',
          overflowX: 'hidden'
        }}
      >
        {/* 面包屑导航栏 */}
        <Box sx={{ mb: 3, display: { xs: 'none', sm: 'block' } }}>
          <Breadcrumbs 
            separator={<NavigateNextIcon fontSize="small" />} 
            aria-label="breadcrumb"
            sx={{ '& .MuiBreadcrumbs-li': { fontWeight: 500 } }}
          >
            {generateBreadcrumbs()}
          </Breadcrumbs>
        </Box>

        <Outlet />
      </Box>
    </Box>
  );
}
