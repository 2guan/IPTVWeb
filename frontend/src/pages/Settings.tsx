import { useState, useEffect } from 'react';
import { 
  Form, Input, InputNumber, Button, Card, Tabs, Table, 
  Tag, Space, Modal, Typography, Popconfirm, message, Divider, Select, Switch
} from 'antd';
import { 
  UserAddOutlined, KeyOutlined, DeleteOutlined 
} from '@ant-design/icons';
import api from '../utils/api';

const { Title, Text } = Typography;
const { TextArea } = Input;

// ─── Cron Helpers ────────────────────────────────────────────────────────────

type CronMode = 'interval' | 'daily' | 'weekly';

interface CronState {
  mode: CronMode;
  intervalHours: number;   // used when mode === 'interval'
  hour: number;            // used when mode === 'daily' | 'weekly'
  minute: number;
  weekday: number;         // 0 = Sun … 6 = Sat, used when mode === 'weekly'
}

function parseCron(cron: string): CronState {
  const parts = (cron || '').trim().split(/\s+/);
  if (parts.length !== 5) return { mode: 'daily', intervalHours: 4, hour: 2, minute: 0, weekday: 0 };
  const [min, hr, , , dow] = parts;

  // every N hours: "0 */N * * *"
  if (hr.startsWith('*/') && dow === '*') {
    return { mode: 'interval', intervalHours: parseInt(hr.slice(2)) || 4, hour: 0, minute: parseInt(min) || 0, weekday: 0 };
  }
  // weekly: "0 H * * D"  where D is 0-6
  if (dow !== '*' && !dow.startsWith('*/')) {
    return { mode: 'weekly', intervalHours: 4, hour: parseInt(hr) || 0, minute: parseInt(min) || 0, weekday: parseInt(dow) || 0 };
  }
  // daily: "0 H * * *"
  return { mode: 'daily', intervalHours: 4, hour: parseInt(hr) || 0, minute: parseInt(min) || 0, weekday: 0 };
}

function buildCron(s: CronState): string {
  if (s.mode === 'interval') return `${s.minute} */${s.intervalHours} * * *`;
  if (s.mode === 'weekly')   return `${s.minute} ${s.hour} * * ${s.weekday}`;
  return `${s.minute} ${s.hour} * * *`;
}

function describeCron(s: CronState): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeStr = `${pad(s.hour)}:${pad(s.minute)}`;
  const days = ['周日','周一','周二','周三','周四','周五','周六'];
  if (s.mode === 'interval') return `每 ${s.intervalHours} 小时触发一次`;
  if (s.mode === 'weekly') return `每${days[s.weekday]} ${timeStr} 触发`;
  return `每天 ${timeStr} 触发`;
}

// ─── CronPicker Component ────────────────────────────────────────────────────

function CronPicker({ label, description, value, onChange }: {
  label: string;
  description: string;
  value: string;
  onChange: (cron: string) => void;
}) {
  const [state, setState] = useState<CronState>(() => parseCron(value));

  // Sync initial value on mount
  useEffect(() => {
    setState(parseCron(value));
  }, [value]);

  const update = (patch: Partial<CronState>) => {
    const next = { ...state, ...patch };
    setState(next);
    onChange(buildCron(next));
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 5, 10, 15, 20, 30, 45];
  const intervalOptions = [1, 2, 3, 4, 6, 8, 12, 24];
  const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];

  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <Text strong>{label}</Text>
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{description}</Text>
      </div>

      {/* Mode selector */}
      <Space wrap className="cron-mode-buttons" style={{ marginBottom: 12 }}>
        {(['interval','daily','weekly'] as CronMode[]).map(m => (
          <Button
            key={m}
            size="small"
            type={state.mode === m ? 'primary' : 'default'}
            onClick={() => update({ mode: m })}
          >
            { m === 'interval' ? '每隔几小时' : m === 'daily' ? '每天固定时间' : '每周固定' }
          </Button>
        ))}
      </Space>

      {/* Controls */}
      <Space wrap align="center" className="cron-controls">
        {state.mode === 'interval' && (
          <>
            <Text type="secondary">每隔</Text>
            <Select
              value={state.intervalHours}
              onChange={v => update({ intervalHours: v })}
              style={{ width: 90 }}
              size="small"
            >
              {intervalOptions.map(h => (
                <Select.Option key={h} value={h}>{h} 小时</Select.Option>
              ))}
            </Select>
            <Text type="secondary">触发一次</Text>
          </>
        )}

        {(state.mode === 'daily' || state.mode === 'weekly') && (
          <>
            {state.mode === 'weekly' && (
              <>
                <Text type="secondary">每</Text>
                <Select
                  value={state.weekday}
                  onChange={v => update({ weekday: v })}
                  style={{ width: 80 }}
                  size="small"
                >
                  {weekdays.map((d, i) => (
                    <Select.Option key={i} value={i}>{d}</Select.Option>
                  ))}
                </Select>
              </>
            )}
            <Text type="secondary">在</Text>
            <Select
              value={state.hour}
              onChange={v => update({ hour: v })}
              style={{ width: 72 }}
              size="small"
            >
              {hours.map(h => (
                <Select.Option key={h} value={h}>{String(h).padStart(2,'0')} 时</Select.Option>
              ))}
            </Select>
            <Select
              value={state.minute}
              onChange={v => update({ minute: v })}
              style={{ width: 72 }}
              size="small"
            >
              {minutes.map(m => (
                <Select.Option key={m} value={m}>{String(m).padStart(2,'0')} 分</Select.Option>
              ))}
            </Select>
            <Text type="secondary">触发</Text>
          </>
        )}
      </Space>

      {/* Preview */}
      <div style={{ marginTop: 10 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          规则预览：<Text code style={{ fontSize: 12 }}>{buildCron(state)}</Text>
          <Text style={{ marginLeft: 8, color: 'var(--accent-color)', fontSize: 12 }}>→ {describeCron(state)}</Text>
        </Text>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Settings() {

  const [activeTab, setActiveTab] = useState('config');
  const [settings, setSettings] = useState<any>({});
  const [users, setUsers] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  // Reactive cron values for CronPicker
  const [syncCron, setSyncCron] = useState('0 */4 * * *');
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [testCron, setTestCron] = useState('0 2 * * *');
  const [testEnabled, setTestEnabled] = useState(true);
  const [epgCron, setEpgCron] = useState('0 3 * * *');
  const [epgEnabled, setEpgEnabled] = useState(true);
  const [optimizeCron, setOptimizeCron] = useState('0 4 * * *');
  const [optimizeEnabled, setOptimizeEnabled] = useState(false);

  // Forms
  const [configForm] = Form.useForm();
  const [rulesForm] = Form.useForm();
  const [cronForm] = Form.useForm();
  const [llmForm] = Form.useForm();
  const [userForm] = Form.useForm();
  const [pwForm] = Form.useForm();

  // Modals state
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  useEffect(() => {
    // Check if current user is admin
    const userStr = localStorage.getItem('iptv_user');
    const user = userStr ? JSON.parse(userStr) : null;
    if (user && user.role === 'admin') {
      setIsAdmin(true);
    }

    // Load settings
    loadSettings();
  // Initial settings and current user are loaded once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'users' && isAdmin) {
      loadUsers();
    }
  // User list only needs reloading when entering the users tab.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/settings');
      setSettings(res.data);
      
      // Populate forms
      configForm.setFieldsValue({
        concurrency: parseInt(res.data.concurrency || 5),
        timeout: parseInt(res.data.timeout || 10000),
        minSpeed: parseFloat(res.data.minSpeed || 0.2),
        exportToken: res.data.exportToken,
        logoRepositoryUrl: res.data.logoRepositoryUrl,
        defaultExportFormat: res.data.defaultExportFormat || 'm3u',
        limitPerChannel: parseInt(res.data.limitPerChannel || 5)
      });

      rulesForm.setFieldsValue({
        blacklist: res.data.blacklist,
        whitelist: res.data.whitelist,
        alias: res.data.alias
      });

      const sc = res.data.syncCron || '';
      const tc = res.data.testCron || '';
      const ec = res.data.epgCron || '';
      const oc = res.data.optimizeCron || '';
      cronForm.setFieldsValue({ syncCron: sc, testCron: tc, epgCron: ec, optimizeCron: oc });
      setSyncCron(sc || '0 */4 * * *');
      setSyncEnabled(!!sc);
      setTestCron(tc || '0 2 * * *');
      setTestEnabled(!!tc);
      setEpgCron(ec || '0 3 * * *');
      setEpgEnabled(!!ec);
      setOptimizeCron(oc || '0 4 * * *');
      setOptimizeEnabled(!!oc);

      llmForm.setFieldsValue({
        llmApiKey: res.data.llmApiKey || '',
        llmBaseUrl: res.data.llmBaseUrl || '',
        llmModelName: res.data.llmModelName || '',
        llmDefaultMode: res.data.llmDefaultMode || 'original',
        llmChunkSize: parseInt(res.data.llmChunkSize || 80)
      });
    } catch {
      message.error('加载设置项失败');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await api.get('/api/settings/users');
      setUsers(res.data);
    } catch {
      message.error('获取用户列表失败');
    }
  };

  const saveSettings = async (values: any) => {
    setLoading(true);
    try {
      const updatedSettings = { ...settings, ...values };
      await api.post('/api/settings', updatedSettings);
      message.success('设置保存成功');
      loadSettings();
    } catch {
      message.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  // User Management actions
  const handleAddUser = async () => {
    try {
      const values = await userForm.validateFields();
      await api.post('/api/settings/users', values);
      message.success('用户创建成功');
      setUserModalOpen(false);
      userForm.resetFields();
      loadUsers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '创建用户失败');
    }
  };

  const handleResetPw = async () => {
    if (selectedUserId === null) return;
    try {
      const values = await pwForm.validateFields();
      await api.put(`/api/settings/users/${selectedUserId}/password`, { password: values.password });
      message.success('密码重置成功');
      setPwModalOpen(false);
      pwForm.resetFields();
      setSelectedUserId(null);
    } catch (err: any) {
      message.error(err.response?.data?.error || '密码重置失败');
    }
  };

  const handleDeleteUser = async (id: number) => {
    try {
      const res = await api.delete(`/api/settings/users/${id}`);
      message.success(res.data.message);
      loadUsers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除用户失败');
    }
  };

  // User Table columns
  const userColumns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => <Text strong>{text}</Text>
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => (
        <Tag color={role === 'admin' ? 'red' : 'blue'}>
          {role === 'admin' ? '管理员' : '普通用户'}
        </Tag>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => new Date(val).toLocaleString()
    },
    {
      title: '操作',
      key: 'action',
      render: (record: any) => (
        <Space size="middle">
          <Button 
            size="small" 
            type="text" 
            icon={<KeyOutlined />} 
            onClick={() => {
              setSelectedUserId(record.id);
              setPwModalOpen(true);
            }}
          >
            重置密码
          </Button>
          <Popconfirm title="确定要删除该用户吗？" onConfirm={() => handleDeleteUser(record.id)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <div className="page-title-block">
        <Title level={3} style={{ margin: 0 }}>系统设置</Title>
        <Text type="secondary">配置直播源测速引擎规则、定时任务以及系统用户权限。</Text>
      </div>

      <Tabs 
        activeKey={activeTab} 
        onChange={setActiveTab}
        className="responsive-tabs"
        items={[
          // Configs Tab
          {
            key: 'config',
            label: '测速与过滤配置',
            children: (
              <Card variant="borderless" className="glass-card">
                <Form 
                  form={configForm} 
                  layout="vertical" 
                  onFinish={saveSettings}
                  style={{ maxWidth: 650 }}
                >
                  <Form.Item name="concurrency" label="测速最大并发数" rules={[{ required: true, message: '请输入测速最大并发数' }]}>
                    <InputNumber min={1} max={50} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="timeout" label="测试超时时间 (毫秒/ms)" rules={[{ required: true, message: '请输入超时时间' }]}>
                    <InputNumber min={1000} max={60000} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="minSpeed" label="合格直播源最低速度限制 (MB/s)" rules={[{ required: true, message: '请输入最低速度' }]}>
                    <InputNumber min={0.01} max={10} step={0.1} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="limitPerChannel" label="每个频道导出的最大直播源数 (最优保留)" rules={[{ required: true, message: '请输入最大保留数' }]}>
                    <InputNumber min={1} max={100} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="exportToken" label="公开导出安全 Token (防盗链)" tooltip="配置后，客户端获取 M3U/TXT 必须在 URL 后拼上 ?token=此值">
                    <Input placeholder="例如: my_secret_token" />
                  </Form.Item>
                  <Form.Item name="logoRepositoryUrl" label="台标库基础路径 (Logo Repository URL)">
                    <Input placeholder="https://raw.githubusercontent.com/Guovin/iptv-api/master/static/images/logo.svg" />
                  </Form.Item>
                  <Form.Item name="defaultExportFormat" label="默认导出格式 (直接访问 / 根路径时)">
                    <Select>
                      <Select.Option value="m3u">M3U 格式</Select.Option>
                      <Select.Option value="txt">TXT 格式</Select.Option>
                    </Select>
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={loading} size="large">保存设置</Button>
                  </Form.Item>
                </Form>
              </Card>
            )
          },
          // Rules Tab
          {
            key: 'rules',
            label: '黑白名单与别名规则',
            children: (
              <Card variant="borderless" className="glass-card">
                <Form 
                  form={rulesForm} 
                  layout="vertical" 
                  onFinish={saveSettings}
                >
                  <Form.Item name="blacklist" label="直播流黑名单关键字 (每行一个)">
                    <TextArea rows={6} placeholder="输入包含的域名、关键字等，符合的流地址将被测试过滤丢弃。例如:&#10;/audio/&#10;bxtv.3a.ink" />
                  </Form.Item>
                  <Form.Item name="whitelist" label="直播流白名单关键字/URL (每行一个)" tooltip="匹配白名单的直播源将免于有效性测试，且始终排在分组结果的最前面。">
                    <TextArea rows={6} placeholder="输入白名单 URL，或关键字（支持频道名称匹配）" />
                  </Form.Item>
                  <Form.Item name="alias" label="频道名称别名对照表 (每行一组)" tooltip="规范化不同订阅源的名称以便 EPG 匹配。格式: 标准频道名,别名1|别名2">
                    <TextArea rows={8} placeholder="CCTV-1,CCTV1|CCTV1 高清&#10;湖南卫视,湖南卫视高清|湖南卫视HD" />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={loading} size="large">保存规则</Button>
                  </Form.Item>
                </Form>
              </Card>
            )
          },
          // Cron Scheduler Tab
          {
            key: 'cron',
            label: '定时更新配置',
            children: (
              <Card variant="borderless" className="glass-card">
                <Space orientation="vertical" size="large" style={{ width: '100%', maxWidth: 650 }}>

                  {/* Task 1: Subscription Sync */}
                  <div>
                    <div className="settings-task-row">
                      <Switch
                        checked={syncEnabled}
                        onChange={(checked) => {
                          setSyncEnabled(checked);
                          cronForm.setFieldsValue({ syncCron: checked ? syncCron : '' });
                        }}
                        size="small"
                      />
                      <Text strong>自动同步直播订阅</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>定时从各订阅源拉取最新的 M3U 播放列表</Text>
                    </div>
                    {syncEnabled && (
                      <CronPicker
                        label="" description=""
                        value={syncCron}
                        onChange={(cron: string) => {
                          setSyncCron(cron);
                          cronForm.setFieldsValue({ syncCron: cron });
                        }}
                      />
                    )}
                  </div>

                  <Divider />

                  {/* Task 2: Source Testing */}
                  <div>
                    <div className="settings-task-row">
                      <Switch
                        checked={testEnabled}
                        onChange={(checked) => {
                          setTestEnabled(checked);
                          cronForm.setFieldsValue({ testCron: checked ? testCron : '' });
                        }}
                        size="small"
                      />
                      <Text strong>直播源有效性自动检测</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>自动检测全部直播源的可用性与速度</Text>
                    </div>
                    {testEnabled && (
                      <CronPicker
                        label="" description=""
                        value={testCron}
                        onChange={(cron: string) => {
                          setTestCron(cron);
                          cronForm.setFieldsValue({ testCron: cron });
                        }}
                      />
                    )}
                  </div>

                  <Divider />

                  {/* Task 3: LLM Optimization (optional) */}
                  <div>
                    <div className="settings-task-row">
                      <Switch
                        checked={optimizeEnabled}
                        onChange={(checked) => {
                          setOptimizeEnabled(checked);
                          cronForm.setFieldsValue({ optimizeCron: checked ? optimizeCron : '' });
                        }}
                        size="small"
                      />
                      <Text strong>自动优化直播源</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>调用大模型对直播源进行归一化优化（需先配置大模型）</Text>
                    </div>
                    {optimizeEnabled && (
                      <CronPicker
                        label="" description=""
                        value={optimizeCron}
                        onChange={(cron: string) => {
                          setOptimizeCron(cron);
                          cronForm.setFieldsValue({ optimizeCron: cron });
                        }}
                      />
                    )}
                  </div>

                  <Divider />

                  {/* Task 4: EPG Sync */}
                  <div>
                    <div className="settings-task-row">
                      <Switch
                        checked={epgEnabled}
                        onChange={(checked) => {
                          setEpgEnabled(checked);
                          cronForm.setFieldsValue({ epgCron: checked ? epgCron : '' });
                        }}
                        size="small"
                      />
                      <Text strong>EPG 节目单自动同步</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>定时拉取并编译合并电子节目单</Text>
                    </div>
                    {epgEnabled && (
                      <CronPicker
                        label="" description=""
                        value={epgCron}
                        onChange={(cron: string) => {
                          setEpgCron(cron);
                          cronForm.setFieldsValue({ epgCron: cron });
                        }}
                      />
                    )}
                  </div>

                  <Button
                    type="primary"
                    size="large"
                    loading={loading}
                    onClick={() => saveSettings(cronForm.getFieldsValue())}
                  >
                    保存定时任务
                  </Button>

                  {/* Hidden form fields to carry the cron values */}
                  <Form form={cronForm} style={{ display: 'none' }}>
                    <Form.Item name="syncCron"><Input /></Form.Item>
                    <Form.Item name="testCron"><Input /></Form.Item>
                    <Form.Item name="epgCron"><Input /></Form.Item>
                    <Form.Item name="optimizeCron"><Input /></Form.Item>
                  </Form>

                </Space>
              </Card>
            )
          },
          // LLM Config Tab
          {
            key: 'llm',
            label: '大模型优化配置',
            children: (
              <Card variant="borderless" className="glass-card">
                <Form 
                  form={llmForm} 
                  layout="vertical" 
                  onFinish={saveSettings}
                  style={{ maxWidth: 650 }}
                >
                  <Form.Item name="llmApiKey" label="API Key (密钥)" rules={[{ required: true, message: '请输入 API Key' }]}>
                    <Input.Password placeholder="例如: your-api-key" />
                  </Form.Item>
                  <Form.Item name="llmBaseUrl" label="Base URL (接口地址)" rules={[{ required: true, message: '请输入 Base URL' }]}>
                    <Input placeholder="例如: https://api.example.com/v1" />
                  </Form.Item>
                  <Form.Item name="llmModelName" label="Model Name (模型名称)" rules={[{ required: true, message: '请输入模型名称' }]}>
                    <Input placeholder="例如: gpt-4o-mini" />
                  </Form.Item>
                  <Form.Item name="llmDefaultMode" label="发布与导出默认数据源" rules={[{ required: true }]}>
                    <Select>
                      <Select.Option value="original">原始直播源 (original)</Select.Option>
                      <Select.Option value="optimized">优化直播源 (optimized)</Select.Option>
                    </Select>
                  </Form.Item>
                  <Form.Item name="llmChunkSize" label="大模型单次提交数量 (Batch Size)" rules={[{ required: true, message: '请输入单次提交数量' }]} tooltip="大模型单次上传处理的直播源行数。数值越小生成越快、越不易超时出错；数值越大所需请求次数越少但容易超时（推荐 50 - 150）">
                    <InputNumber min={10} max={1000} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={loading} size="large">保存配置</Button>
                  </Form.Item>
                </Form>
              </Card>
            )
          },
          // User Tab (only rendered for Admins)
          {
            key: 'users',
            label: '系统用户管理',
            disabled: !isAdmin,
            children: (
              <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                <div className="responsive-page-header settings-users-header">
                  <Text type="secondary">管理可以使用本系统控制台的用户列表（注：自主注册默认关闭）。</Text>
                  <Button type="primary" icon={<UserAddOutlined />} onClick={() => setUserModalOpen(true)}>新增用户</Button>
                </div>
                <Card variant="borderless" className="glass-card settings-users-card" style={{ padding: 0 }}>
                  <Table 
                    columns={userColumns} 
                    dataSource={users} 
                    rowKey="id" 
                    pagination={false}
                    scroll={{ x: 'max-content' }}
                  />
                </Card>
              </Space>
            )
          }
        ]}
      />

      {/* User Create Modal */}
      <Modal
        title="创建新用户"
        open={userModalOpen}
        onOk={handleAddUser}
        onCancel={() => setUserModalOpen(false)}
        destroyOnHidden
      >
        <Form form={userForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item name="role" label="权限角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select placeholder="请选择角色">
              <Select.Option value="user">普通用户 (可查看、导入、测试直播源)</Select.Option>
              <Select.Option value="admin">管理员 (拥有所有系统及设置权限)</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        title="重置用户密码"
        open={pwModalOpen}
        onOk={handleResetPw}
        onCancel={() => setPwModalOpen(false)}
        destroyOnHidden
      >
        <Form form={pwForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="password" label="输入新密码" rules={[{ required: true, message: '请输入新密码' }]}>
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
