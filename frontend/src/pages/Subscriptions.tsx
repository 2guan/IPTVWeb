import { useState, useEffect } from 'react';
import { 
  Tabs, Table, Button, Modal, Form, Input, Switch, 
  Space, Card, Tooltip, message, Popconfirm, Badge, Typography, Divider
} from 'antd';
import { 
  PlusOutlined, SyncOutlined, EditOutlined, DeleteOutlined, 
  CopyOutlined, InfoCircleOutlined, CloudDownloadOutlined 
} from '@ant-design/icons';
import api from '../utils/api';
import { formatBeijingTime } from '../utils/time';

const { Title, Text, Paragraph } = Typography;

export default function Subscriptions() {
  const [activeTab, setActiveTab] = useState('subs');
  const [subsData, setSubsData] = useState<any[]>([]);
  const [epgData, setEpgData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Modals state
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [epgModalOpen, setEpgModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  // Forms
  const [subForm] = Form.useForm();
  const [epgForm] = Form.useForm();

  // Load subscriptions
  const fetchSubscriptions = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/subscriptions');
      setSubsData(res.data);
    } catch {
      message.error('加载订阅源失败');
    } finally {
      setLoading(false);
    }
  };

  // Load EPG sources
  const fetchEpgSources = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/epg');
      setEpgData(res.data);
    } catch {
      message.error('加载 EPG 失败');
    } finally {
      setLoading(false);
    }
  };

  const loadData = () => {
    if (activeTab === 'subs') {
      fetchSubscriptions();
    } else {
      fetchEpgSources();
    }
  };

  useEffect(() => {
    loadData();
  // Reload only when switching between subscription and EPG tabs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // CRUD for Subscriptions
  const openSubEdit = (record: any = null) => {
    if (record) {
      setIsEditing(true);
      setEditingItem(record);
      subForm.setFieldsValue({
        name: record.name,
        url: record.url,
        user_agent: record.user_agent,
        auto_update: record.auto_update === 1
      });
    } else {
      setIsEditing(false);
      setEditingItem(null);
      subForm.resetFields();
      subForm.setFieldsValue({ auto_update: true });
    }
    setSubModalOpen(true);
  };

  const saveSub = async () => {
    try {
      const values = await subForm.validateFields();
      values.auto_update = values.auto_update ? 1 : 0;
      
      if (isEditing && editingItem) {
        await api.put(`/api/subscriptions/${editingItem.id}`, values);
        message.success('订阅更新成功');
      } else {
        await api.post('/api/subscriptions', values);
        message.success('订阅创建成功');
      }
      setSubModalOpen(false);
      fetchSubscriptions();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const deleteSub = async (id: number) => {
    try {
      await api.delete(`/api/subscriptions/${id}`);
      message.success('成功删除订阅源');
      fetchSubscriptions();
    } catch {
      message.error('删除订阅源失败');
    }
  };

  const syncSubSingle = async (id: number) => {
    try {
      message.loading({ content: '正在同步订阅流地址...', key: 'sync_sub', duration: 0 });
      await api.post(`/api/subscriptions/${id}/sync`);
      message.success({ content: '同步订阅源成功！', key: 'sync_sub' });
      fetchSubscriptions();
    } catch (err: any) {
      const errMsg = err.response?.data?.error || '同步失败';
      message.error({ content: errMsg, key: 'sync_sub' });
    }
  };

  // CRUD for EPG Sources
  const openEpgEdit = (record: any = null) => {
    if (record) {
      setIsEditing(true);
      setEditingItem(record);
      epgForm.setFieldsValue({
        name: record.name,
        url: record.url
      });
    } else {
      setIsEditing(false);
      setEditingItem(null);
      epgForm.resetFields();
    }
    setEpgModalOpen(true);
  };

  const saveEpg = async () => {
    try {
      const values = await epgForm.validateFields();
      if (isEditing && editingItem) {
        await api.put(`/api/epg/${editingItem.id}`, values);
        message.success('EPG 订阅更新成功');
      } else {
        await api.post('/api/epg', values);
        message.success('EPG 订阅创建成功');
      }
      setEpgModalOpen(false);
      fetchEpgSources();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const deleteEpg = async (id: number) => {
    try {
      await api.delete(`/api/epg/${id}`);
      message.success('删除 EPG 订阅成功');
      fetchEpgSources();
    } catch {
      message.error('删除失败');
    }
  };

  const syncEpgSingle = () => {
    try {
      message.info('正在拉取与编译合并节目单，请稍后刷新查看状态...');
      api.post('/api/epg/sync');
    } catch {
      message.error('启动 EPG 同步失败');
    }
  };

  // Status helper
  const renderStatus = (status: string, errorMsg: string) => {
    if (status === 'fetching') return <Badge status="processing" text="同步中..." />;
    if (status === 'success') return <Badge status="success" text="同步成功" />;
    if (status === 'failed') {
      return (
        <Tooltip title={errorMsg || '同步错误'}>
          <Space size={4} style={{ cursor: 'pointer' }}>
            <Badge status="error" text="失败" />
            <InfoCircleOutlined style={{ color: '#ff4d4f', fontSize: '12px' }} />
          </Space>
        </Tooltip>
      );
    }
    return <Badge status="default" text="未同步" />;
  };

  // M3U/TXT exports URL generator
  const copyPublicLink = (path: string) => {
    const origin = window.location.origin;
    api.get('/api/settings').then(res => {
      const token = res.data.exportToken || '';
      const fullUrl = `${origin}${path}${token ? `?token=${token}` : ''}`;
      navigator.clipboard.writeText(fullUrl);
      message.success('链接已复制到剪切板');
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success('已复制到剪切板');
  };

  // Subscriptions Table Columns
  const subColumns = [
    {
      title: '订阅名称',
      dataIndex: 'name',
      key: 'name',
      align: 'center' as const,
      render: (text: string) => <Text strong>{text}</Text>
    },
    {
      title: '订阅 URL',
      dataIndex: 'url',
      key: 'url',
      responsive: ['md'] as any,
      render: (url: string) => (
        <Tooltip title={`点击复制: ${url}`}>
          <div 
            onClick={() => copyToClipboard(url)}
            className="url-clickable-cell"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}
          >
            {url}
          </div>
        </Tooltip>
      )
    },
    {
      title: '自动更新',
      dataIndex: 'auto_update',
      key: 'auto_update',
      align: 'center' as const,
      render: (val: number) => <Switch checked={val === 1} disabled />
    },
    {
      title: '同步状态',
      key: 'status',
      align: 'center' as const,
      render: (record: any) => renderStatus(record.status, record.error_message)
    },
    {
      title: '最近同步',
      dataIndex: 'last_fetched_at',
      key: 'last_fetched_at',
      align: 'center' as const,
      render: (val: string) => val ? formatBeijingTime(val) : <Text type="secondary">-</Text>
    },
    {
      title: '操作',
      key: 'action',
      align: 'center' as const,
      render: (record: any) => (
        <Space size="middle">
          <Tooltip title="立即同步">
            <Button size="small" type="text" icon={<SyncOutlined />} onClick={() => syncSubSingle(record.id)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openSubEdit(record)} />
          </Tooltip>
          <Popconfirm title="确定要删除该订阅源吗？这会清空由此拉取的直播源！" onConfirm={() => deleteSub(record.id)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  // EPG Columns
  const epgColumns = [
    {
      title: '节目单名称',
      dataIndex: 'name',
      key: 'name',
      align: 'center' as const,
      render: (text: string) => <Text strong>{text}</Text>
    },
    {
      title: 'XML 链接',
      dataIndex: 'url',
      key: 'url',
      responsive: ['md'] as any,
      render: (url: string) => (
        <Tooltip title={`点击复制: ${url}`}>
          <div 
            onClick={() => copyToClipboard(url)}
            className="url-clickable-cell"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 350 }}
          >
            {url}
          </div>
        </Tooltip>
      )
    },
    {
      title: '同步状态',
      key: 'status',
      align: 'center' as const,
      render: (record: any) => renderStatus(record.status, record.error_message)
    },
    {
      title: '最近同步',
      dataIndex: 'last_fetched_at',
      key: 'last_fetched_at',
      align: 'center' as const,
      render: (val: string) => val ? formatBeijingTime(val) : <Text type="secondary">-</Text>
    },
    {
      title: '操作',
      key: 'action',
      align: 'center' as const,
      render: (record: any) => (
        <Space size="middle">
          <Tooltip title="立即拉取">
            <Button size="small" type="text" icon={<SyncOutlined />} onClick={() => syncEpgSingle()} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEpgEdit(record)} />
          </Tooltip>
          <Popconfirm title="确定删除该 EPG 吗？" onConfirm={() => deleteEpg(record.id)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      {/* Header */}
      <div className="responsive-page-header">
        <div>
          <Title level={3} style={{ margin: 0 }}>订阅与 EPG 管理</Title>
          <Text type="secondary">配置直播源的外部 M3U 订阅和 EPG 电子节目单 XML 地址。</Text>
        </div>
        <Button 
          type="primary" 
          icon={<PlusOutlined />} 
          onClick={() => activeTab === 'subs' ? openSubEdit() : openEpgEdit()}
        >
          {activeTab === 'subs' ? '新增直播订阅' : '新增 EPG 订阅'}
        </Button>
      </div>

      <Tabs 
        activeKey={activeTab} 
        onChange={setActiveTab}
        items={[
          {
            key: 'subs',
            label: '直播源订阅列表',
            children: (
              <>
                {/* Desktop View */}
                <div className="desktop-table-view">
                  <Card variant="borderless" className="glass-card" style={{ padding: 0 }}>
                    <Table 
                      columns={subColumns} 
                      dataSource={subsData} 
                      rowKey="id" 
                      loading={loading} 
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                    />
                  </Card>
                </div>

                {/* Mobile View */}
                <div className="mobile-card-view">
                  {subsData.map((record) => (
                    <Card key={record.id} size="small" className="glass-card" style={{ marginBottom: 8 }}>
                      <div className="mobile-card-header">
                        <Text strong className="mobile-card-title">{record.name}</Text>
                        <div className="mobile-status">{renderStatus(record.status, record.error_message)}</div>
                      </div>
                      
                      <div className="mobile-card-meta">
                        <div>自动更新: <Switch checked={record.auto_update === 1} disabled size="small" /></div>
                        <div>最近同步: {record.last_fetched_at ? formatBeijingTime(record.last_fetched_at) : '-'}</div>
                      </div>

                      <div 
                        onClick={() => copyPublicLink(`/m3u/${record.id}`)}
                        className="url-clickable-cell"
                        style={{ 
                          fontSize: '11px', 
                          background: 'rgba(255,255,255,0.02)', 
                          padding: '4px 8px', 
                          borderRadius: '4px',
                          border: '1px solid rgba(255,255,255,0.04)',
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          whiteSpace: 'nowrap',
                          marginBottom: 8
                        }}
                      >
                        {record.url}
                      </div>

                      <div className="mobile-card-actions">
                        <Space wrap>
                          <Button size="small" icon={<SyncOutlined />} onClick={() => syncSubSingle(record.id)}>同步</Button>
                          <Button size="small" icon={<EditOutlined />} onClick={() => openSubEdit(record)}>编辑</Button>
                          <Popconfirm title="确定要删除该订阅源吗？这会清空由此拉取的直播源！" onConfirm={() => deleteSub(record.id)}>
                            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                          </Popconfirm>
                        </Space>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )
          },
          {
            key: 'epg',
            label: 'EPG XML 节目单订阅',
            children: (
              <Space orientation="vertical" size="large" style={{ width: '100%' }}>
                {/* Desktop View */}
                <div className="desktop-table-view">
                  <Card variant="borderless" className="glass-card" style={{ padding: 0 }}>
                    <Table 
                      columns={epgColumns} 
                      dataSource={epgData} 
                      rowKey="id" 
                      loading={loading} 
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                    />
                  </Card>
                </div>

                {/* Mobile View */}
                <div className="mobile-card-view">
                  {epgData.map((record) => (
                    <Card key={record.id} size="small" className="glass-card" style={{ marginBottom: 8 }}>
                      <div className="mobile-card-header">
                        <Text strong className="mobile-card-title">{record.name}</Text>
                        <div className="mobile-status">{renderStatus(record.status, record.error_message)}</div>
                      </div>
                      
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 8 }}>
                        最近同步: {record.last_fetched_at ? formatBeijingTime(record.last_fetched_at) : '-'}
                      </div>

                      <div 
                        className="url-clickable-cell"
                        style={{ 
                          fontSize: '11px', 
                          background: 'rgba(255,255,255,0.02)', 
                          padding: '4px 8px', 
                          borderRadius: '4px',
                          border: '1px solid rgba(255,255,255,0.04)',
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          whiteSpace: 'nowrap',
                          marginBottom: 8
                        }}
                      >
                        {record.url}
                      </div>

                      <div className="mobile-card-actions">
                        <Space wrap>
                          <Button size="small" icon={<SyncOutlined />} onClick={() => syncEpgSingle()}>拉取</Button>
                          <Button size="small" icon={<EditOutlined />} onClick={() => openEpgEdit(record)}>编辑</Button>
                          <Popconfirm title="确定删除该 EPG 吗？" onConfirm={() => deleteEpg(record.id)}>
                            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                          </Popconfirm>
                        </Space>
                      </div>
                    </Card>
                  ))}
                </div>

                {/* EPG XML Download Section */}
                <Card title="生成的节目单下载地址 (公开)" variant="borderless" className="glass-card">
                  <Paragraph>
                    系统定时抓取并解析 EPG 订阅源，结合频道别名合并对齐，最终生成唯一的 XMLTV 文件：
                  </Paragraph>
                  <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                    <div>
                      <Badge status="processing" text={<Text strong>XMLTV 原生电子节目单 (XML)</Text>} />
                      <div className="responsive-button-row">
                        <Button icon={<CopyOutlined />} onClick={() => copyPublicLink('/epg.xml')}>复制 EPG XML 链接</Button>
                        <Button icon={<CloudDownloadOutlined />} href={`${import.meta.env.DEV ? 'http://localhost:4010' : ''}/epg.xml`} target="_blank">下载 XML 文件</Button>
                      </div>
                    </div>
                    <Divider style={{ margin: '8px 0' }} />
                    <div>
                      <Badge status="success" text={<Text strong>XMLTV 压缩电子节目单 (XML.GZ - 推荐)</Text>} />
                      <div className="responsive-button-row">
                        <Button icon={<CopyOutlined />} onClick={() => copyPublicLink('/epg.xml.gz')}>复制 EPG XML.GZ 链接</Button>
                        <Button icon={<CloudDownloadOutlined />} href={`${import.meta.env.DEV ? 'http://localhost:4010' : ''}/epg.xml.gz`} target="_blank">下载 GZ 压缩文件</Button>
                      </div>
                    </div>
                  </Space>
                </Card>
              </Space>
            )
          }
        ]}
      />

      {/* Subscription Modal */}
      <Modal
        title={isEditing ? '修改直播源订阅' : '添加直播源订阅'}
        open={subModalOpen}
        onOk={saveSub}
        onCancel={() => setSubModalOpen(false)}
        destroyOnHidden
      >
        <Form form={subForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="订阅名称" rules={[{ required: true, message: '请输入订阅名称' }]}>
            <Input placeholder="例如: 某公益 m3u 订阅" />
          </Form.Item>
          <Form.Item name="url" label="订阅 URL 链接" rules={[{ required: true, message: '请输入订阅 URL' }]}>
            <Input placeholder="http://.../playlist.m3u" />
          </Form.Item>
          <Form.Item name="user_agent" label="自定义 User-Agent (选填)">
            <Input placeholder="Mozilla/5.0 ... (留空使用全局配置)" />
          </Form.Item>
          <Form.Item name="auto_update" label="开启自动定时同步" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* EPG Modal */}
      <Modal
        title={isEditing ? '修改 EPG 订阅' : '添加 EPG 订阅'}
        open={epgModalOpen}
        onOk={saveEpg}
        onCancel={() => setEpgModalOpen(false)}
        destroyOnHidden
      >
        <Form form={epgForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="节目单名称" rules={[{ required: true, message: '请输入节目单名称' }]}>
            <Input placeholder="例如: 112111 EPG" />
          </Form.Item>
          <Form.Item name="url" label="XML 链接地址 (支持 .gz 压缩格式)" rules={[{ required: true, message: '请输入 XML 链接' }]}>
            <Input placeholder="http://.../epg.xml.gz" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
