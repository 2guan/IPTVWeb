import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, message, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import api from '../utils/api';

const { Title, Text } = Typography;

export default function Login() {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If already logged in, redirect
    if (localStorage.getItem('iptv_token')) {
      window.location.href = '/';
    }
  }, []);

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const response = await api.post('/api/auth/login', {
        username: values.username,
        password: values.password
      });

      const { token, user } = response.data;
      localStorage.setItem('iptv_token', token);
      localStorage.setItem('iptv_user', JSON.stringify(user));
      
      message.success('登录成功，欢迎使用 IPTV 管理系统');
      setTimeout(() => {
        window.location.href = '/';
      }, 1000);
    } catch (error: any) {
      const errMsg = error.response?.data?.error || '登录失败，请检查网络或账号';
      message.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-bg-glow"></div>
      <Card className="login-card" variant="borderless">
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <Title level={2} style={{ margin: 0, fontWeight: 700, letterSpacing: '1px' }}>
            IPTV 管理系统
          </Title>
          <Text type="secondary" style={{ fontSize: '13px' }}>
            IPTV-API 直播源与节目单控制台 v2.0
          </Text>
        </div>

        <Form
          name="login_form"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input 
              prefix={<UserOutlined style={{ color: 'rgba(255,255,255,0.45)' }} />} 
              placeholder="用户名" 
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: 'rgba(255,255,255,0.45)' }} />}
              placeholder="密码"
            />
          </Form.Item>

          <Form.Item style={{ marginTop: 40, marginBottom: 10 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              className="login-btn"
            >
              登 录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
