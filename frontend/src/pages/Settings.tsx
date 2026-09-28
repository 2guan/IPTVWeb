import { useState, useEffect } from 'react';
import { 
  Form, Input, InputNumber, Button, Card, Tabs, Table, 
  Tag, Space, Modal, Typography, Popconfirm, message, Divider, Select, Switch, Upload, Alert
} from 'antd';
import { 
  UserAddOutlined, KeyOutlined, DeleteOutlined,
  DownloadOutlined, UploadOutlined, RollbackOutlined
} from '@ant-design/icons';
import api from '../utils/api';

const { Title, Text } = Typography;
const { TextArea } = Input;

const USER_AGENT_OPTIONS = [
  { label: 'TiviMate', value: 'TiviMate/5.1.0' },
  { label: 'OTT Navigator', value: 'OTT Navigator/1.7.0' },
  { label: 'PotPlayer', value: 'PotPlayer/1.7.21902' },
  { label: 'ExoPlayer', value: 'ExoPlayerLib/2.18.1' },
  { label: 'VLC', value: 'VLC/3.0.20 LibVLC/3.0.20' },
  { label: 'Android TV Browser', value: 'Mozilla/5.0 (Linux; Android 11; TV) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' },
  { label: 'FFmpeg/Lavf', value: 'Lavf/58.76.100' }
];

function isEnabledSetting(value: any) {
  return value === true || value === 1 || ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

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

  // Backup & Snapshot state
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);

  useEffect(() => {
    // Check if current user is admin
    const userStr = localStorage.getItem('iptv_user');
    const user = userStr ? JSON.parse(userStr) : null;
    if (user && user.role === 'admin') {
      setIsAdmin(true);
    }

    // Load settings & backup status
    loadSettings();
    loadBackupStatus();
  // Initial settings and current user are loaded once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBackupStatus = async () => {
    try {
      const res = await api.get('/api/settings/backup/status');
      setHasSnapshot(!!res.data?.hasSnapshot);
    } catch {
      // ignore
    }
  };

  const handleExportBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await api.get('/api/settings/backup/export', { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `iptv-backup-${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      message.success('配置备份导出成功');
    } catch {
      message.error('导出备份失败');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleImportBackup = async (file: File) => {
    try {
      const text = await file.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        message.error('文件不是有效的 JSON 格式');
        return false;
      }
      const res = await api.post('/api/settings/backup/import', json);
      message.success(res.data?.message || '配置导入成功！已自动创建安全快照');
      await loadSettings();
      await loadBackupStatus();
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || '配置导入失败');
    }
    return false;
  };

  const handleRollbackBackup = async () => {
    setRollbackLoading(true);
    try {
      const res = await api.post('/api/settings/backup/rollback');
      message.success(res.data?.message || '已成功回滚到导入前配置快照');
      await loadSettings();
      await loadBackupStatus();
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || '回滚失败');
    } finally {
      setRollbackLoading(false);
    }
  };

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
        userAgent: res.data.userAgent || 'TiviMate/5.1.0',
        testFastMode: isEnabledSetting(res.data.testFastMode ?? '1'),
        ffprobeMetadataEnabled: isEnabledSetting(res.data.ffprobeMetadataEnabled),
        ffprobeFallbackEnabled: isEnabledSetting(res.data.ffprobeFallbackEnabled),
        multicastDefaultActive: isEnabledSetting(res.data.multicastDefaultActive),
        announcementEnabled: isEnabledSetting(res.data.announcementEnabled ?? '1'),
        announcementName: res.data.announcementName || '',
        announcementCategory: res.data.announcementCategory || '',
        announcementUrl: res.data.announcementUrl || '',
        announcementLogo: res.data.announcementLogo || '',
        hlsProxyEnabled: isEnabledSetting(res.data.hlsProxyEnabled),
        sichuanToken: res.data.sichuanToken || '',
        exportToken: res.data.exportToken,
        logoRepositoryUrl: res.data.logoRepositoryUrl,
        defaultExportFormat: res.data.defaultExportFormat || 'm3u',
        limitPerChannel: parseInt(res.data.limitPerChannel || 5),
        streamTranscodeMode: res.data.streamTranscodeMode || 'copy',
        streamMaxStreams: parseInt(res.data.streamMaxStreams || 6),
        streamIdleTimeout: parseInt(res.data.streamIdleTimeout || 300),
        streamSegmentSeconds: parseInt(res.data.streamSegmentSeconds || 4),
        streamListSize: parseInt(res.data.streamListSize || 8)
      });

      rulesForm.setFieldsValue({
        blacklist: res.data.blacklist,
        whitelist: res.data.whitelist,
        alias: res.data.alias,
        blockRules: res.data.blockRules || '',
        hiddenGroupRules: res.data.hiddenGroupRules || ''
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
        llmChunkSize: parseInt(res.data.llmChunkSize || 80),
        llmOptimizePrompt: res.data.llmOptimizePrompt || ''
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
                  <Form.Item name="userAgent" label="测速请求 User-Agent" tooltip="用于直播源测活、测速和播放器兜底探测。">
                    <Select
                      showSearch
                      allowClear
                      placeholder="选择 User-Agent"
                      options={USER_AGENT_OPTIONS}
                      optionFilterProp="label"
                    />
                  </Form.Item>
                  <Form.Item
                    name="testFastMode"
                    label="快速测速模式"
                    valuePropName="checked"
                    tooltip="开启后减少媒体分片抽样量，优先判断可用性，适合大批量直播源。"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="ffprobeMetadataEnabled"
                    label="使用 ffprobe 补充分辨率"
                    valuePropName="checked"
                    tooltip="关闭可明显减少批量测速耗时；开启后会在缺少分辨率信息时调用 ffprobe。"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="ffprobeFallbackEnabled"
                    label="失败后使用 ffprobe 兜底"
                    valuePropName="checked"
                    tooltip="关闭可避免无效源额外等待；开启后部分浏览器 fetch 失败但 ffprobe 可播放的源可能被救回。"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="multicastDefaultActive"
                    label="组播源默认判定有效"
                    valuePropName="checked"
                    tooltip="开启后，rtp://、udp:// 以及 224.0.0.0/4、ff00::/8 组播地址在测活时直接标记为有效，适合公网服务器无法接收 IPTV 组播的场景。"
                  >
                    <Switch />
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
                  <Divider>播放与导出高级选项</Divider>
                  <Form.Item
                    name="announcementEnabled"
                    label="系统公告虚拟频道"
                    valuePropName="checked"
                    tooltip="开启后，在导出的 M3U / TXT 播放列表首位自动插入系统公告频道，提供欢迎短片与电视端播放指南。"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prevValues, currentValues) => prevValues.announcementEnabled !== currentValues.announcementEnabled}
                  >
                    {({ getFieldValue }) =>
                      getFieldValue('announcementEnabled') ? (
                        <>
                          <Form.Item
                            name="announcementName"
                            label="系统公告频道名称"
                            tooltip="在播放列表中显示的公告标题频道名称。留空默认为：Guan‘s IPTV。公告分组下方将自动追加第二个频道：更新时间:MM-DD HH:mm，两个频道均仅供电视端直观查看，不可播放。"
                          >
                            <Input placeholder="留空默认: Guan‘s IPTV" />
                          </Form.Item>
                          <Form.Item
                            name="announcementCategory"
                            label="系统公告频道分组"
                            tooltip="在播放列表中显示的分组类别名称。留空默认为：公告"
                          >
                            <Input placeholder="公告" />
                          </Form.Item>
                          <Form.Item
                            name="announcementUrl"
                            label="系统公告视频地址 (选填)"
                            tooltip="若希望公告频道播放实际视频，可在此输入 MP4 或 M3U8 视频直链；留空则两个公告频道均不挂链接（仅供电视端查看，不可播放）。"
                          >
                            <Input placeholder="留空不挂链接（仅供查看不可播放）" />
                          </Form.Item>
                          <Form.Item
                            name="announcementLogo"
                            label="系统公告台标地址 (Logo URL)"
                            tooltip="公告频道台标图标。留空默认使用内置的高清系统台标（/assets/announcement-logo.png）。"
                          >
                            <Input placeholder="留空使用内置台标，或输入 http(s)://.../logo.png" />
                          </Form.Item>
                        </>
                      ) : null
                    }
                  </Form.Item>
                  <Form.Item
                    name="hlsProxyEnabled"
                    label="HLS 同源全代理模式"
                    valuePropName="checked"
                    tooltip="开启后，导出播放列表中的 m3u8 地址将重写为本机同源相对路径（分片由服务器内存透传，不写磁盘），解决极空间极影视等 TV 播放器跨域或超长 URL 解析异常问题。"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="sichuanToken"
                    label="四川广电官网 access_token (选填)"
                    tooltip="用于四川广电官网 9 个高清电视频道动态官方换签。可直接粘贴 Bearer Token，支持从官网个人中心获取。不填则仅采集免密公开活动直播。"
                  >
                    <Input.Password placeholder="粘贴四川官网 access_token" />
                  </Form.Item>
                  <Divider>HLS 推流</Divider>
                  <Form.Item name="streamTranscodeMode" label="推流转码模式" tooltip="copy 低 CPU；auto 会先尝试 copy，失败后自动转码；transcode 固定输出 H.264/AAC。">
                    <Select>
                      <Select.Option value="copy">copy：直接封装，低 CPU</Select.Option>
                      <Select.Option value="auto">auto：失败时自动转码</Select.Option>
                      <Select.Option value="transcode">transcode：强制 H.264/AAC</Select.Option>
                    </Select>
                  </Form.Item>
                  <Form.Item name="streamMaxStreams" label="最大同时推流频道数">
                    <InputNumber min={1} max={50} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="streamIdleTimeout" label="无人访问自动停止时间 (秒)">
                    <InputNumber min={30} max={86400} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="streamSegmentSeconds" label="HLS 分片时长 (秒)">
                    <InputNumber min={1} max={20} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="streamListSize" label="HLS 播放列表分片数量">
                    <InputNumber min={3} max={30} style={{ width: '100%' }} />
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
                    <TextArea rows={6} placeholder="CCTV-1,CCTV1|CCTV1 高清&#10;湖南卫视,湖南卫视高清|湖南卫视HD" />
                  </Form.Item>
                  <Form.Item name="blockRules" label="频道名长期屏蔽规则 (每行一个)" tooltip="按频道名称长期屏蔽。以 = 开头为全名精确匹配（如 =CCTV-1），否则为包含匹配（如 购物、导视）。源更新换地址或换签名依然生效。">
                    <TextArea rows={4} placeholder="=CCTV-1&#10;购物&#10;导视" />
                  </Form.Item>
                  <Form.Item name="hiddenGroupRules" label="动态分组通配隐藏规则 (每行一个)" tooltip="支持通配符 *，例如 体育-* 将自动隐藏所有同前缀的每日动态比赛分组。">
                    <TextArea rows={3} placeholder="体育-*" />
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
                      <Text strong>自动增量优化直播源</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>定时只优化尚未进入优化列表的有效直播源（需先配置大模型）</Text>
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
                  <Form.Item
                    name="llmOptimizePrompt"
                    label="直播源优化提示词"
                    rules={[{ required: true, message: '请输入直播源优化提示词' }]}
                    tooltip="优化直播源时作为 system prompt 发送给大模型。请保留 JSON 返回格式要求，否则可能导致优化结果解析失败。"
                  >
                    <TextArea rows={16} placeholder="请输入频道名称、分组归一化、过滤规则和 JSON 返回格式要求" />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={loading} size="large">保存配置</Button>
                  </Form.Item>
                </Form>
              </Card>
            )
          },
          // Backup & Restore Tab
          {
            key: 'backup',
            label: '配置备份与恢复',
            disabled: !isAdmin,
            children: (
              <Space orientation="vertical" size="large" style={{ width: '100%', maxWidth: 720 }}>
                <Card variant="borderless" className="glass-card" title="单文件全量配置备份">
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Text type="secondary">
                      将系统设置、定时任务、所有订阅源（含咪咕及普通订阅配置）、EPG 订阅以及手动导入的直播源一次性完整打包导出为单个 JSON 文件。
                    </Text>
                    <div>
                      <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        onClick={handleExportBackup}
                        loading={backupLoading}
                        size="large"
                      >
                        导出完整配置备份 (.json)
                      </Button>
                    </div>
                  </Space>
                </Card>

                <Card variant="borderless" className="glass-card" title="配置文件导入与覆盖">
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Alert
                      type="info"
                      showIcon
                      message="自动快照安全防护"
                      description="每次点击导入配置前，系统都会在服务端自动生成一份 pre-import-backup.json 导入前快照。若新配置出现问题，可随时一键回滚。"
                    />
                    <Upload
                      beforeUpload={handleImportBackup}
                      showUploadList={false}
                      accept=".json"
                    >
                      <Button icon={<UploadOutlined />} size="large">
                        选择备份 JSON 文件并导入
                      </Button>
                    </Upload>
                  </Space>
                </Card>

                <Card variant="borderless" className="glass-card" title="导入前快照回滚">
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Text type="secondary">
                      {hasSnapshot 
                        ? '检测到最近一次导入前自动生成的配置快照，可随时恢复至导入前的状态。' 
                        : '当前暂无导入前快照记录（系统在首次执行配置导入前将自动生成）。'}
                    </Text>
                    <div>
                      <Popconfirm
                        title="确定回滚到最近一次导入前的快照吗？"
                        description="此操作将覆盖当前系统设置并还原为上次导入前的全量数据。"
                        onConfirm={handleRollbackBackup}
                        okText="确定回滚"
                        cancelText="取消"
                        disabled={!hasSnapshot}
                      >
                        <Button
                          danger
                          icon={<RollbackOutlined />}
                          disabled={!hasSnapshot}
                          loading={rollbackLoading}
                          size="large"
                        >
                          一键回滚到导入前快照
                        </Button>
                      </Popconfirm>
                    </div>
                  </Space>
                </Card>
              </Space>
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
