import { Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated, getStoredUser } from './services/auth';
import { ProviderProvider } from './contexts/ProviderContext';
import Layout from './components/Layout/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import DomainDetail from './pages/DomainDetail';
import CustomHostnames from './pages/CustomHostnames';
import Tunnels from './pages/Tunnels';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import Certificates from './pages/Certificates';
import ApiDocs from './pages/ApiDocs';
import Users from './pages/Users';

import { BreadcrumbProvider } from './contexts/BreadcrumbContext';

/**
 * 受保护的路由组件
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return (
    <ProviderProvider>
      <BreadcrumbProvider>{children}</BreadcrumbProvider>
    </ProviderProvider>
  );
}

/** 子路由的管理员守卫：父级已提供 Provider 上下文，这里只做展示层收敛 */
function AdminOnly({ children }: { children: React.ReactNode }) {
  // 真正的权限校验在后端 /api/users 的 requireAdmin
  // 本地缓存缺失 role（旧版本残留登录态）时一律按普通用户处理
  if (getStoredUser()?.role !== 'admin') {
    return <Navigate to="/?scope=all" replace />;
  }
  return <>{children}</>;
}

/**
 * 主应用组件
 */
function App() {
  return (
    <Routes>
      {/* 公开路由 */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* 受保护的路由 */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="domain/:zoneId" element={<DomainDetail />} />
        <Route path="hostnames/:zoneId" element={<CustomHostnames />} />
        <Route path="tunnels" element={<Tunnels />} />
        <Route path="tunnels/:zoneId" element={<Tunnels />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
        <Route
          path="users"
          element={
            <AdminOnly>
              <Users />
            </AdminOnly>
          }
        />
        <Route path="certificates" element={<Certificates />} />
        <Route path="docs" element={<ApiDocs />} />
      </Route>

      {/* 旧 EdgeOne 独立页面已并入 DNS 服务商列表 */}
      <Route path="/edgeone" element={<Navigate to="/" replace />} />

      {/* 404 重定向 */}
      <Route path="*" element={<Navigate to="/?scope=all" replace />} />
    </Routes>
  );
}

export default App;
