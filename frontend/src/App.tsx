import { lazy, Suspense, useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { ConfigProvider, Layout, Menu, Button, Space, Avatar, Dropdown, Drawer, Spin, theme, Typography } from 'antd';
import { 
  DashboardOutlined, PlaySquareOutlined, CloudServerOutlined, 
  ShareAltOutlined, SettingOutlined, MenuUnfoldOutlined, 
  MenuFoldOutlined, MoonOutlined, SunOutlined, LogoutOutlined,
  UserOutlined, ExperimentOutlined
} from '@ant-design/icons';

import './App.css';

const { Header, Sider, Content } = Layout;
const { defaultAlgorithm, darkAlgorithm } = theme;
const { Text } = Typography;

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Sources = lazy(() => import('./pages/Sources'));
const OptimizedSources = lazy(() => import('./pages/OptimizedSources'));
const Subscriptions = lazy(() => import('./pages/Subscriptions'));
const Publish = lazy(() => import('./pages/Publish'));
const Settings = lazy(() => import('./pages/Settings'));

function PageLoading() {
  return (
    <div style={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
      <Spin size="large" description="正在加载页面..." />
    </div>
  );
}

function MainLayout({ children, isDarkMode, setIsDarkMode }: any) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    // Check if token exists, if not redirect to login
    const token = localStorage.getItem('iptv_token');
    if (!token && location.pathname !== '/login') {
      window.location.href = '#/login';
    }

    const userStr = localStorage.getItem('iptv_user');
    if (userStr) {
      setCurrentUser(JSON.parse(userStr));
    }
  }, [location]);

  const handleLogout = () => {
    localStorage.removeItem('iptv_token');
    localStorage.removeItem('iptv_user');
    window.location.href = '#/login';
  };

  const menuItems = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: <Link to="/">信息概览</Link>,
    },
    {
      key: '/sources',
      icon: <PlaySquareOutlined />,
      label: <Link to="/sources">直播源管理</Link>,
    },
    {
      key: '/optimized-sources',
      icon: <ExperimentOutlined style={{ color: '#722ed1' }} />,
      label: <Link to="/optimized-sources">优化直播源</Link>,
    },
    {
      key: '/subscriptions',
      icon: <CloudServerOutlined />,
      label: <Link to="/subscriptions">订阅与EPG</Link>,
    },
    {
      key: '/publish',
      icon: <ShareAltOutlined />,
      label: <Link to="/publish">发布与导出</Link>,
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: <Link to="/settings">系统设置</Link>,
    }
  ];

  const userMenu = {
    items: [
      {
        key: 'username',
        label: <Text strong>{currentUser?.username}</Text>,
        disabled: true,
      },
      {
        key: 'role',
        label: <Text type="secondary">{currentUser?.role === 'admin' ? '系统管理员' : '普通用户'}</Text>,
        disabled: true,
      },
      {
        type: 'divider' as const,
      },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        danger: true,
        label: '退出登录',
        onClick: handleLogout,
      },
    ],
  };

  const toggleTheme = () => {
    const nextMode = !isDarkMode;
    setIsDarkMode(nextMode);
    localStorage.setItem('iptv_theme', nextMode ? 'dark' : 'light');
    document.documentElement.className = nextMode ? 'dark-theme' : 'light-theme';
  };

  // Close mobile drawer on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Sider for Desktop */}
      <Sider 
        trigger={null} 
        collapsible 
        collapsed={collapsed}
        className="desktop-sider"
        width={220}
        theme={isDarkMode ? 'dark' : 'light'}
      >
        <div className="logo-area">
          <PlaySquareOutlined style={{ fontSize: '24px', color: 'var(--accent-color)' }} />
          {!collapsed && <span className="logo-title">订阅管理平台</span>}
        </div>
        <Menu
          theme={isDarkMode ? 'dark' : 'light'}
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
        />
      </Sider>

      {/* Sider for Mobile (Drawer) */}
      <Drawer
        placement="left"
        onClose={() => setMobileMenuOpen(false)}
        open={mobileMenuOpen}
        size={220}
        styles={{ body: { padding: 0 } }}
        closable={false}
      >
        <div className="logo-area">
          <PlaySquareOutlined style={{ fontSize: '24px', color: 'var(--accent-color)' }} />
          <span className="logo-title">IPTV 控制台</span>
        </div>
        <Menu
          theme={isDarkMode ? 'dark' : 'light'}
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
        />
      </Drawer>

      <Layout className="site-layout">
        {/* Header Bar */}
        <Header className="site-header" style={{ background: isDarkMode ? '#141414' : '#fff' }}>
          <Space>
            {/* Mobile Hamburger toggle */}
            <Button
              type="text"
              icon={mobileMenuOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="mobile-trigger"
            />
            {/* Desktop Sider toggle */}
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              className="desktop-trigger"
            />
          </Space>

          <Space size="middle">
            {/* Theme switcher */}
            <Button 
              type="text" 
              icon={isDarkMode ? <SunOutlined /> : <MoonOutlined />} 
              onClick={toggleTheme} 
            />

            {/* User Dropdown */}
            {currentUser && (
              <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
                <Space style={{ cursor: 'pointer' }}>
                  <Avatar icon={<UserOutlined />} style={{ backgroundColor: 'var(--accent-color)' }} />
                  <span className="user-name-header">{currentUser.username}</span>
                </Space>
              </Dropdown>
            )}
          </Space>
        </Header>

        {/* Content body */}
        <Content className="site-content" style={{ background: isDarkMode ? '#000000' : '#f0f2f5' }}>
          <div className="content-inner">{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    // Initial theme set
    const savedTheme = localStorage.getItem('iptv_theme');
    const isDark = savedTheme ? savedTheme === 'dark' : true; // Default dark
    setIsDarkMode(isDark);
    document.documentElement.className = isDark ? 'dark-theme' : 'light-theme';
  }, []);

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? darkAlgorithm : defaultAlgorithm,
        token: {
          colorPrimary: isDarkMode ? '#3b82f6' : '#2563eb',
          colorBgBase: isDarkMode ? '#09090b' : '#f4f4f5',
          colorBgContainer: isDarkMode ? '#121215' : '#ffffff',
          colorBorder: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(9, 9, 11, 0.05)',
          borderRadius: 10,
          fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        },
        components: {
          Card: {
            colorBgContainer: isDarkMode ? 'rgba(18, 18, 20, 0.6)' : '#ffffff',
          },
          Table: {
            colorBgContainer: isDarkMode ? '#121215' : '#ffffff',
            headerBg: isDarkMode ? '#18181c' : '#fafafa',
          }
        }
      }}
    >
      <HashRouter>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <MainLayout isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode}>
                  <Suspense fallback={<PageLoading />}>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/sources" element={<Sources />} />
                      <Route path="/optimized-sources" element={<OptimizedSources />} />
                      <Route path="/subscriptions" element={<Subscriptions />} />
                      <Route path="/publish" element={<Publish />} />
                      <Route path="/settings" element={<Settings />} />
                    </Routes>
                  </Suspense>
                </MainLayout>
              }
            />
          </Routes>
        </Suspense>
      </HashRouter>
    </ConfigProvider>
  );
}
