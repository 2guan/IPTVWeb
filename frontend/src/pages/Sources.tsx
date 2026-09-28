import { useState, useEffect, useRef } from 'react';
import { 
  Table, Tag, Button, Input, Select, Space, Card, Drawer, Form, 
  Modal, Upload, Typography, message, Popconfirm, Tooltip, Row, Col, Badge, Switch, Pagination
} from 'antd';
import { 
  SearchOutlined, PlusOutlined, ImportOutlined, DeleteOutlined, 
  PlayCircleOutlined, EditOutlined, InboxOutlined, 
  ThunderboltOutlined, EyeOutlined, VideoCameraOutlined, StopOutlined, LinkOutlined
} from '@ant-design/icons';
import api from '../utils/api';
import { formatBeijingTime, isFutureBeijingTime } from '../utils/time';
import VideoPreviewModal from '../components/VideoPreviewModal';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;

function getSourceLabel(record: any) {
  if (record.subscription_name) {
    return {
      text: record.subscription_name,
      color: record.origin === 'migu' ? 'magenta' : 'purple'
    };
  }
  if (record.origin === 'migu') {
    return { text: '咪咕', color: 'magenta' };
  }
  return { text: '手动导入', color: 'orange' };
}

export default function Sources() {
  // Data and Loading
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<any>({ categories: [], isps: [], regions: [], subscriptions: [] });

  // Pagination & Filters State
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchName, setSearchName] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  const [filterIpv, setFilterIpv] = useState<string | undefined>(undefined);
  const [filterOrigin, setFilterOrigin] = useState<string | undefined>(undefined);
  const [filterIsp, setFilterIsp] = useState<string | undefined>(undefined);
  const [filterRegion, setFilterRegion] = useState('');
  const [filterFrozen, setFilterFrozen] = useState<string | undefined>(undefined);
  const [filterSubscription, setFilterSubscription] = useState<string | undefined>(undefined);

  // Selected Rows
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [testingSourceIds, setTestingSourceIds] = useState<number[]>([]);
  const [streamStatuses, setStreamStatuses] = useState<Record<number, any>>({});
  const singleTestTimersRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});

  // Drawers and Modals
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  // Preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRecord, setPreviewRecord] = useState<any>(null);

  // Forms
  const [form] = Form.useForm();
  const [importForm] = Form.useForm();

  // Load Data
  const fetchData = async (options: { showLoading?: boolean; page?: number; pageSize?: number; filters?: any } = {}) => {
    const { showLoading = true, filters: filterOverrides = {} } = options;
    const requestPage = options.page ?? page;
    const requestPageSize = options.pageSize ?? pageSize;
    const pickFilter = (key: string, fallback: any) => (
      Object.prototype.hasOwnProperty.call(filterOverrides, key) ? filterOverrides[key] : fallback
    );
    if (showLoading) setLoading(true);
    try {
      const params: any = {
        page: requestPage,
        pageSize: requestPageSize,
        name: pickFilter('name', searchName),
        category: pickFilter('category', filterCategory),
        status: pickFilter('status', filterStatus),
        ipvType: pickFilter('ipvType', filterIpv),
        origin: pickFilter('origin', filterOrigin),
        isp: pickFilter('isp', filterIsp),
        region: pickFilter('region', filterRegion),
        isFrozen: pickFilter('isFrozen', filterFrozen),
        subscriptionId: pickFilter('subscriptionId', filterSubscription)
      };

      const res = await api.get('/api/sources', { params });
      setData(res.data.items);
      setTotal(res.data.total);
      setFilters(res.data.filters);
      loadStreamStatuses();
      return res.data.items;
    } catch {
      message.error('加载直播源失败');
      return [];
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const loadStreamStatuses = async () => {
    try {
      const res = await api.get('/api/streams/status');
      const statusMap = Object.fromEntries((res.data || []).map((item: any) => [item.sourceId, item]));
      setStreamStatuses(statusMap);
    } catch {
      // 推流状态不影响主列表加载。
    }
  };

  useEffect(() => {
    fetchData();
  // Search text is submitted explicitly by the filter button.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filterCategory, filterStatus, filterIpv, filterOrigin, filterIsp, filterFrozen, filterSubscription]);

  useEffect(() => {
    const timers = singleTestTimersRef.current;
    return () => {
      Object.values(timers).forEach(clearInterval);
    };
  }, []);

  const clearSingleTestTimer = (id: number) => {
    const timer = singleTestTimersRef.current[id];
    if (timer) {
      clearInterval(timer);
      delete singleTestTimersRef.current[id];
    }
  };

  const removeTestingSource = (id: number) => {
    setTestingSourceIds(prev => prev.filter(item => item !== id));
  };

  const pollSingleTestResult = (record: any) => {
    clearSingleTestTimer(record.id);
    let attempts = 0;

    singleTestTimersRef.current[record.id] = setInterval(async () => {
      attempts += 1;

      try {
        const res = await api.get(`/api/sources/${record.id}`);
        const source = res.data;
        const isDone = source.status !== 'testing';

        if (isDone || attempts >= 60) {
          clearSingleTestTimer(record.id);
          removeTestingSource(record.id);
          await fetchData({ showLoading: false });

          if (!isDone) {
            message.warning(`[${record.name}] 测试时间较长，已刷新当前列表`);
            return;
          }

          const resultText = source.status === 'active' ? '有效' : '失效';
          const speedText = source.speed ? `，速度 ${Number(source.speed).toFixed(2)} MB/s` : '';
          const delayText = source.delay > 0 ? `，延迟 ${source.delay} ms` : '';
          message.success(`[${record.name}] 测试完成：${resultText}${speedText}${delayText}`);
        }
      } catch {
        if (attempts >= 5) {
          clearSingleTestTimer(record.id);
          removeTestingSource(record.id);
          await fetchData({ showLoading: false });
          message.warning(`[${record.name}] 测试结果暂时无法获取，已刷新当前列表`);
        }
      }
    }, 1000);
  };

  const handleSearch = () => {
    setPage(1);
    fetchData({ page: 1 });
  };

  const handleReset = () => {
    const resetFilters = {
      name: '',
      category: undefined,
      status: undefined,
      ipvType: undefined,
      origin: undefined,
      isp: undefined,
      region: '',
      isFrozen: undefined,
      subscriptionId: undefined
    };
    setSearchName('');
    setFilterCategory(undefined);
    setFilterStatus(undefined);
    setFilterIpv(undefined);
    setFilterOrigin(undefined);
    setFilterIsp(undefined);
    setFilterRegion('');
    setFilterFrozen(undefined);
    setFilterSubscription(undefined);
    setPage(1);
    fetchData({ page: 1, filters: resetFilters });
  };

  const resetPageAndSetFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setPage(1);
    setter(value);
  };

  // Single test
  const handleTestSingle = async (record: any) => {
    try {
      setTestingSourceIds(prev => prev.includes(record.id) ? prev : [...prev, record.id]);
      message.info(`正在测试 [${record.name}] 的可用性...`);
      await api.post('/api/sources/test', { ids: [record.id] });
      await fetchData({ showLoading: false });
      pollSingleTestResult(record);
    } catch (err: any) {
      removeTestingSource(record.id);
      message.error(err.response?.data?.error || '启动测试失败');
    }
  };

  // Bulk test
  const handleBulkTest = async () => {
    if (selectedRowKeys.length === 0) return;
    try {
      await api.post('/api/sources/test', { ids: selectedRowKeys });
      message.success(`已在后台启动对 ${selectedRowKeys.length} 个直播源的测试任务`);
      setSelectedRowKeys([]);
    } catch {
      message.error('启动批量测试失败');
    }
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    try {
      const res = await api.delete('/api/sources', { data: { ids: selectedRowKeys } });
      message.success(res.data.message);
      setSelectedRowKeys([]);
      fetchData();
    } catch {
      message.error('批量删除失败');
    }
  };

  const handleStartStream = async (record: any) => {
    try {
      message.loading({ content: `正在启动 [${record.name}] 推流...`, key: `stream-${record.id}`, duration: 0 });
      await api.post('/api/streams/start', { sourceIds: [record.id] });
      message.success({ content: `[${record.name}] 推流已启动`, key: `stream-${record.id}` });
      loadStreamStatuses();
    } catch (err: any) {
      message.error({ content: err.response?.data?.error || '启动推流失败', key: `stream-${record.id}` });
    }
  };

  const handleStopStream = async (record: any) => {
    try {
      await api.post('/api/streams/stop', { sourceIds: [record.id] });
      message.success(`[${record.name}] 推流已停止`);
      loadStreamStatuses();
    } catch (err: any) {
      message.error(err.response?.data?.error || '停止推流失败');
    }
  };

  const handleToggleStreamEnabled = async (record: any, enabled: boolean) => {
    try {
      await api.post('/api/streams/enable', { sourceIds: [record.id], enabled });
      message.success(enabled ? '已加入 HLS 推流订阅' : '已移出 HLS 推流订阅');
      fetchData({ showLoading: false });
      loadStreamStatuses();
    } catch (err: any) {
      message.error(err.response?.data?.error || '设置推流订阅失败');
    }
  };

  const handleBulkStartStream = async () => {
    if (selectedRowKeys.length === 0) return;
    try {
      message.loading({ content: `正在启动 ${selectedRowKeys.length} 个推流任务...`, key: 'bulk-stream', duration: 0 });
      await api.post('/api/streams/start', { sourceIds: selectedRowKeys });
      message.success({ content: '已提交批量推流任务', key: 'bulk-stream' });
      setSelectedRowKeys([]);
      loadStreamStatuses();
    } catch (err: any) {
      message.error({ content: err.response?.data?.error || '批量启动推流失败', key: 'bulk-stream' });
    }
  };

  const handleBulkStopStream = async () => {
    if (selectedRowKeys.length === 0) return;
    try {
      await api.post('/api/streams/stop', { sourceIds: selectedRowKeys });
      message.success('已停止选中的推流任务');
      setSelectedRowKeys([]);
      loadStreamStatuses();
    } catch (err: any) {
      message.error(err.response?.data?.error || '批量停止推流失败');
    }
  };

  const handleBulkEnableStream = async (enabled: boolean) => {
    if (selectedRowKeys.length === 0) return;
    try {
      await api.post('/api/streams/enable', { sourceIds: selectedRowKeys, enabled });
      message.success(enabled ? '已将选中线路加入 HLS 推流订阅' : '已将选中线路移出 HLS 推流订阅');
      setSelectedRowKeys([]);
      fetchData({ showLoading: false });
      loadStreamStatuses();
    } catch (err: any) {
      message.error(err.response?.data?.error || '批量设置推流订阅失败');
    }
  };

  const copyHlsUrl = (record: any) => {
    const url = `${window.location.origin}/stream/hls/${record.id}/index.m3u8?autostart=1`;
    navigator.clipboard.writeText(url);
    message.success('HLS 推流地址已复制');
  };

  // Single delete
  const handleDelete = async (id: number) => {
    try {
      await api.delete('/api/sources', { data: { ids: [id] } });
      message.success('删除直播源成功');
      fetchData();
    } catch {
      message.error('删除直播源失败');
    }
  };

  // Clear all sources
  const handleClearAll = async () => {
    try {
      const res = await api.post('/api/sources/clear');
      message.success(res.data.message);
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.error || '清空直播源失败');
    }
  };

  // One-click deduplicate sources
  const handleDeduplicate = async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/sources/deduplicate');
      message.success(res.data.message);
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.error || '去重操作失败');
    } finally {
      setLoading(false);
    }
  };



  // Open Edit Modal (New / Modify)
  const openEdit = (record: any = null) => {
    if (record) {
      setIsEditing(true);
      setEditingItem(record);
      form.setFieldsValue({
        name: record.name,
        url: record.url,
        category: record.category,
        tvg_logo: record.tvg_logo,
        request_headers: record.request_headers || '',
        catchup: record.catchup || '',
        stream_enabled: record.stream_enabled === 1,
        status: record.status
      });
    } else {
      setIsEditing(false);
      setEditingItem(null);
      form.resetFields();
      form.setFieldsValue({ stream_enabled: false });
    }
    setEditModalOpen(true);
  };

  // Save Edit Form
  const saveEdit = async () => {
    try {
      const values = await form.validateFields();
      if (isEditing && editingItem) {
        await api.put(`/api/sources/${editingItem.id}`, values);
        message.success('直播源修改成功');
      } else {
        await api.post('/api/sources', values);
        message.success('手动创建直播源成功');
      }
      setEditModalOpen(false);
      fetchData();
    } catch (err: any) {
      const errMsg = err.response?.data?.error || '保存失败';
      message.error(errMsg);
    }
  };

  // Handle Text/File Import
  const handleImport = async () => {
    try {
      const values = await importForm.validateFields();
      await api.post('/api/sources/import', {
        content: values.content,
        category: values.category
      });
      message.success('直播源导入成功');
      setImportDrawerOpen(false);
      importForm.resetFields();
      fetchData();
    } catch (err: any) {
      const errMsg = err.response?.data?.error || '导入失败';
      message.error(errMsg);
    }
  };

  // File Upload parsing
  const handleUploadFile = (file: any) => {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const text = e.target.result;
      importForm.setFieldsValue({ content: text });
      message.success(`成功载入文件: ${file.name}`);
    };
    reader.readAsText(file);
    return false; // Prevent auto upload
  };

  // Utility to copy url
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success('流链接已复制到剪贴板');
  };

  // Table columns definition
  const columns = [
    {
      title: '频道名称',
      dataIndex: 'name',
      key: 'name',
      align: 'center' as const,
      width: 140,
      render: (text: string, record: any) => {
        const isFrozen = isFutureBeijingTime(record.frozen_until);
        return (
          <Space>
            {isFrozen && (
              <Tooltip title={`该源已冷冻，解冻时间: ${formatBeijingTime(record.frozen_until)}`}>
                <span style={{ fontSize: '14px', marginRight: 4 }}>❄️</span>
              </Tooltip>
            )}
            <Text strong>{text}</Text>
          </Space>
        );
      }
    },
    {
      title: '分组',
      dataIndex: 'category',
      key: 'category',
      align: 'center' as const,
      width: 100,
      render: (text: string) => <Tag color="blue">{text || '未知'}</Tag>
    },
    {
      title: '来源/订阅',
      key: 'subscription_name',
      align: 'center' as const,
      width: 110,
      render: (record: any) => {
        const source = getSourceLabel(record);
        return <Tag color={source.color}>{source.text}</Tag>;
      }
    },
    {
      title: 'URL地址',
      dataIndex: 'url',
      key: 'url',
      width: 160,
      responsive: ['md'] as any, // Hide on mobile
      render: (url: string) => (
        <Tooltip title={`点击复制: ${url}`}>
          <div 
            onClick={() => copyToClipboard(url)}
            className="url-clickable-cell"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}
          >
            {url}
          </div>
        </Tooltip>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      align: 'center' as const,
      width: 85,
      render: (status: string) => {
        if (status === 'active') return <Badge status="success" text="有效" />;
        if (status === 'inactive') return <Badge status="error" text="失效" />;
        if (status === 'testing') return <Badge status="processing" text="测试中" />;
        return <Badge status="default" text="未知" />;
      }
    },
    {
      title: '协议',
      dataIndex: 'ipv_type',
      key: 'ipv_type',
      align: 'center' as const,
      width: 70,
      render: (type: string) => {
        if (!type) return <Tag style={{ margin: 0 }}>未知</Tag>;
        return <Tag style={{ margin: 0 }} color={type === 'ipv6' ? 'purple' : 'cyan'}>{type.toUpperCase()}</Tag>;
      }
    },
    {
      title: '延迟',
      dataIndex: 'delay',
      key: 'delay',
      align: 'center' as const,
      width: 80,
      render: (val: number, record: any) => {
        if (val === undefined || val === null || val === -1 || record.status === 'unknown') return <Text type="secondary">-</Text>;
        return <Text type={val > 300 ? 'warning' : 'success'}>{val} ms</Text>;
      }
    },
    {
      title: '速度',
      dataIndex: 'speed',
      key: 'speed',
      align: 'center' as const,
      width: 95,
      render: (val: number, record: any) => {
        if (val === undefined || val === null || !val || record.status === 'unknown') return <Text type="secondary">-</Text>;
        return <Text strong>{val.toFixed(2)} MB/s</Text>;
      }
    },
    {
      title: '画质',
      key: 'media',
      align: 'center' as const,
      width: 100,
      responsive: ['sm'] as any,
      render: (record: any) => {
        if (!record.resolution) return <Text type="secondary">-</Text>;
        return (
          <Space size={4} orientation="vertical" style={{ fontSize: '11px', lineHeight: '1.2' }}>
            <Text type="secondary">{record.resolution}</Text>
            {record.codec && <Tag style={{ margin: 0, fontSize: '9px', padding: '0 4px', lineHeight: '14px' }} color="cyan">{record.codec.toUpperCase()}</Tag>}
          </Space>
        );
      }
    },
    {
      title: '推流',
      key: 'stream',
      align: 'center' as const,
      width: 95,
      render: (record: any) => {
        const status = streamStatuses[record.id];
        const running = status?.running;
        return (
          <Space size={4} direction="vertical">
            <Badge status={running ? 'processing' : record.stream_enabled === 1 ? 'warning' : 'default'} text={running ? '推流中' : record.stream_enabled === 1 ? '已启用' : '未启用'} />
            <Switch
              size="small"
              checked={record.stream_enabled === 1}
              onChange={(checked) => handleToggleStreamEnabled(record, checked)}
            />
          </Space>
        );
      }
    },
    {
      title: '最近测试',
      dataIndex: 'last_tested_at',
      key: 'last_tested_at',
      align: 'center' as const,
      width: 105,
      responsive: ['lg'] as any,
      render: (val: string) => {
        if (!val) return <Text type="secondary">-</Text>;
        return <Text type="secondary" style={{ fontSize: 11 }}>{formatBeijingTime(val)}</Text>;
      }
    },
    {
      title: '操作',
      key: 'action',
      align: 'center' as const,
      width: 150,
      render: (record: any) => (
        <Space size="small">
          <Tooltip title="预览播放">
            <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => { setPreviewRecord(record); setPreviewOpen(true); }} />
          </Tooltip>
          <Tooltip title="测试该源可用性">
            <Button
              size="small"
              type="text"
              icon={<PlayCircleOutlined />}
              loading={testingSourceIds.includes(record.id)}
              onClick={() => handleTestSingle(record)}
            />
          </Tooltip>
          <Tooltip title={streamStatuses[record.id]?.running ? '停止 HLS 推流' : '启动 HLS 推流'}>
            <Button
              size="small"
              type="text"
              icon={streamStatuses[record.id]?.running ? <StopOutlined /> : <VideoCameraOutlined />}
              onClick={() => streamStatuses[record.id]?.running ? handleStopStream(record) : handleStartStream(record)}
            />
          </Tooltip>
          <Tooltip title="复制 HLS 推流地址">
            <Button size="small" type="text" icon={<LinkOutlined />} onClick={() => copyHlsUrl(record)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm title="确定要删除该线路吗？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="仅删除该条流线路">
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      {/* Page Header */}
      <div className="responsive-page-header">
        <div>
          <Title level={3} style={{ margin: 0 }}>直播源列表</Title>
          <Text type="secondary">管理所有手动导入和自动同步的直播流地址。</Text>
        </div>
        <Space wrap className="responsive-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>
            新增
          </Button>
          <Button icon={<ImportOutlined />} onClick={() => setImportDrawerOpen(true)}>
            导入
          </Button>
          <Popconfirm
            title="确定要对所有直播源进行一键去重吗？"
            description="系统将扫描所有直播流的 URL 地址。重复的 URL 中优先删除手动导入的源，其它重复项优先删除较新导入的源（保留老数据）。本操作不可撤销。"
            onConfirm={handleDeduplicate}
            okText="开始去重"
            cancelText="取消"
          >
            <Button icon={<ThunderboltOutlined />}>
              去重
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确定要清空所有直播源吗？"
            description="这将永久删除数据库中所有的直播源，本操作不可恢复！"
            onConfirm={handleClearAll}
            okText="确定清空"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />}>
              清空
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {/* Filter Card */}
      <Card variant="borderless" className="glass-card">
        <Row gutter={[12, 12]} align="middle">
          {/* 1. 频道名称 */}
          <Col xs={12} md={3}>
            <Input 
              placeholder="搜索频道名称" 
              value={searchName} 
              onChange={e => setSearchName(e.target.value)}
              onPressEnter={handleSearch}
              prefix={<SearchOutlined />}
              style={{ width: '100%' }}
            />
          </Col>

          {/* 2. 分组 */}
          <Col xs={12} md={3}>
            <Select 
              placeholder="选择分组" 
              style={{ width: '100%' }} 
              value={filterCategory}
              onChange={resetPageAndSetFilter(setFilterCategory)}
              allowClear
            >
              {filters.categories.map((c: string) => (
                <Select.Option key={c} value={c}>{c}</Select.Option>
              ))}
            </Select>
          </Col>

          {/* 3. 来源/订阅 */}
          <Col xs={12} md={3} className={filtersExpanded ? "" : "mobile-hidden-filter"}>
            <Select 
              placeholder="直播源来源/订阅" 
              style={{ width: '100%' }} 
              value={filterSubscription}
              onChange={resetPageAndSetFilter(setFilterSubscription)}
              allowClear
            >
              <Select.Option value="manual">手动导入</Select.Option>
              {(filters.subscriptions || []).map((sub: any) => (
                <Select.Option key={sub.id} value={sub.id.toString()}>{sub.name}</Select.Option>
              ))}
            </Select>
          </Col>

          {/* 4. 状态 */}
          <Col xs={12} md={3} className={filtersExpanded ? "" : "mobile-hidden-filter"}>
            <Select 
              placeholder="选择状态" 
              style={{ width: '100%' }} 
              value={filterStatus}
              onChange={resetPageAndSetFilter(setFilterStatus)}
              allowClear
            >
              <Select.Option value="active">有效</Select.Option>
              <Select.Option value="inactive">失效</Select.Option>
              <Select.Option value="testing">测试中</Select.Option>
              <Select.Option value="unknown">未知</Select.Option>
            </Select>
          </Col>

          {/* 5. 协议 */}
          <Col xs={12} md={3} className={filtersExpanded ? "" : "mobile-hidden-filter"}>
            <Select 
              placeholder="选择协议" 
              style={{ width: '100%' }} 
              value={filterIpv}
              onChange={resetPageAndSetFilter(setFilterIpv)}
              allowClear
            >
              <Select.Option value="ipv4">IPv4</Select.Option>
              <Select.Option value="ipv6">IPv6</Select.Option>
            </Select>
          </Col>

          {/* 6. 冷冻状态 */}
          <Col xs={12} md={3} className={filtersExpanded ? "" : "mobile-hidden-filter"}>
            <Select 
              placeholder="冷冻冷却状态" 
              style={{ width: '100%' }} 
              value={filterFrozen}
              onChange={resetPageAndSetFilter(setFilterFrozen)}
              allowClear
            >
              <Select.Option value="true">被冷冻</Select.Option>
              <Select.Option value="false">未冷冻</Select.Option>
            </Select>
          </Col>

          {/* Mobile Toggle Button */}
          <Col xs={12} className="mobile-only-filter-toggle">
            <Button type="link" size="small" onClick={() => setFiltersExpanded(!filtersExpanded)} style={{ padding: 0 }}>
              {filtersExpanded ? '收起筛选 ↑' : '展开筛选 ↓'}
            </Button>
          </Col>

          {/* Action Buttons */}
          <Col xs={12} md={6} className="filter-action-col">
            <Space wrap>
              <Button type="primary" onClick={handleSearch}>筛选</Button>
              <Button onClick={handleReset}>重置</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Bulk Operations Toolbar */}
      {selectedRowKeys.length > 0 && (
        <div className="bulk-toolbar animate-fade-in">
          <Space wrap>
            <span>已选择 <Text strong>{selectedRowKeys.length}</Text> 项</span>
            <Button type="primary" size="small" icon={<PlayCircleOutlined />} onClick={handleBulkTest}>
              批量测试
            </Button>
            <Button size="small" icon={<VideoCameraOutlined />} onClick={handleBulkStartStream}>
              启动推流
            </Button>
            <Button size="small" icon={<StopOutlined />} onClick={handleBulkStopStream}>
              停止推流
            </Button>
            <Button size="small" onClick={() => handleBulkEnableStream(true)}>
              加入推流订阅
            </Button>
            <Button size="small" onClick={() => handleBulkEnableStream(false)}>
              移出推流订阅
            </Button>
            <Popconfirm title="确定要删除选中的直播源吗？" onConfirm={handleBulkDelete}>
              <Button danger size="small" icon={<DeleteOutlined />}>
                批量删除
              </Button>
            </Popconfirm>
          </Space>
        </div>
      )}

      {/* Main Table for Desktop */}
      <div className="desktop-table-view">
        <Card variant="borderless" className="glass-card" style={{ padding: 0 }}>
          <Table
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys
            }}
            columns={columns}
            dataSource={data}
            rowKey="id"
            loading={loading}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              }
            }}
            scroll={{ x: 'max-content' }}
          />
        </Card>
      </div>

      {/* Main Card List for Mobile */}
      <div className="mobile-card-view">
        {data.map((record) => {
          const isFrozen = isFutureBeijingTime(record.frozen_until);
          const isSelected = selectedRowKeys.includes(record.id);
          return (
            <Card 
              key={record.id} 
              size="small"
              className="glass-card mobile-source-card"
              style={{
                border: isSelected ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                marginBottom: 8
              }}
            >
              <div className="mobile-card-header">
                <Space size={6} className="mobile-title-space">
                  <Switch 
                    size="small" 
                    checked={isSelected} 
                    onChange={(checked) => {
                      if (checked) {
                        setSelectedRowKeys([...selectedRowKeys, record.id]);
                      } else {
                        setSelectedRowKeys(selectedRowKeys.filter(k => k !== record.id));
                      }
                    }} 
                  />
                  {isFrozen && <span style={{ fontSize: '14px' }}>❄️</span>}
                  <Text strong className="mobile-card-title">{record.name}</Text>
                </Space>
                <div className="mobile-status">
                  {record.status === 'active' && <Badge status="success" text="有效" />}
                  {record.status === 'inactive' && <Badge status="error" text="失效" />}
                  {record.status === 'testing' && <Badge status="processing" text="测试中" />}
                  {record.status === 'unknown' && <Badge status="default" text="未知" />}
                </div>
              </div>

              <div className="mobile-card-meta">
                <div>分组: <Tag color="blue" style={{ margin: 0 }}>{record.category || '未知'}</Tag></div>
                <div>协议: <Tag style={{ margin: 0 }} color={record.ipv_type === 'ipv6' ? 'purple' : 'cyan'}>{record.ipv_type?.toUpperCase() || '未知'}</Tag></div>
                <div>来源: {(() => {
                  const source = getSourceLabel(record);
                  return <Tag color={source.color} style={{ margin: 0 }}>{source.text}</Tag>;
                })()}</div>
                <div>延迟: {record.delay === -1 || record.status === 'unknown' ? '-' : <Text type={record.delay > 300 ? 'warning' : 'success'}>{record.delay} ms</Text>}</div>
                <div>速度: {record.speed ? <Text strong>{record.speed.toFixed(2)} MB/s</Text> : '-'}</div>
                <div>画质: {record.resolution ? `${record.resolution} (${record.codec || ''})` : '-'}</div>
                <div>推流: <Tag color={streamStatuses[record.id]?.running ? 'processing' : record.stream_enabled === 1 ? 'gold' : 'default'} style={{ margin: 0 }}>{streamStatuses[record.id]?.running ? '推流中' : record.stream_enabled === 1 ? '已启用' : '未启用'}</Tag></div>
                <div style={{ gridColumn: '1 / -1' }}>最近测试: {record.last_tested_at ? <Text type="secondary">{formatBeijingTime(record.last_tested_at)}</Text> : '-'}</div>
              </div>

              <div 
                onClick={() => copyToClipboard(record.url)}
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
                  <Button size="small" icon={<EyeOutlined />} onClick={() => { setPreviewRecord(record); setPreviewOpen(true); }}>预览</Button>
                  <Button
                    size="small"
                    icon={<PlayCircleOutlined />}
                    loading={testingSourceIds.includes(record.id)}
                    onClick={() => handleTestSingle(record)}
                  >
                    测试
                  </Button>
                  <Button
                    size="small"
                    icon={streamStatuses[record.id]?.running ? <StopOutlined /> : <VideoCameraOutlined />}
                    onClick={() => streamStatuses[record.id]?.running ? handleStopStream(record) : handleStartStream(record)}
                  >
                    {streamStatuses[record.id]?.running ? '停推' : '推流'}
                  </Button>
                  <Button size="small" icon={<LinkOutlined />} onClick={() => copyHlsUrl(record)}>HLS</Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
                  <Popconfirm title="确定要删除该线路吗？" onConfirm={() => handleDelete(record.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              </div>
            </Card>
          );
        })}
        
        {/* Mobile Pagination */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16, marginBottom: 16 }}>
          <Pagination
            simple
            current={page}
            pageSize={pageSize}
            total={total}
            onChange={(p, ps) => {
              setPage(p);
              setPageSize(ps);
            }}
          />
        </div>
      </div>

      {/* Manual Add / Edit Modal */}
      <Modal
        title={isEditing ? '修改直播源' : '新增直播源'}
        open={editModalOpen}
        onOk={saveEdit}
        onCancel={() => setEditModalOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="频道名称" rules={[{ required: true, message: '请输入频道名称' }]}>
            <Input placeholder="例如: CCTV-1" />
          </Form.Item>
          <Form.Item name="url" label="频道流地址 (URL)" rules={[{ required: true, message: '请输入流 URL' }]}>
            <Input placeholder="http://..." />
          </Form.Item>
          <Form.Item name="category" label="频道分组" rules={[{ required: true, message: '请选择或输入分组' }]}>
            <Select mode="tags" maxCount={1} placeholder="例如: 央视频道">
              {filters.categories.map((c: string) => (
                <Select.Option key={c} value={c}>{c}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="tvg_logo" label="台标 URL (选填)">
            <Input placeholder="http://.../logo.png" />
          </Form.Item>
          <Form.Item name="request_headers" label="请求头 JSON (选填)" tooltip='例如 {"User-Agent":"TiviMate/5.1.0","Referer":"https://example.com"}'>
            <TextArea rows={3} placeholder='{"User-Agent":"TiviMate/5.1.0"}' />
          </Form.Item>
          <Form.Item name="catchup" label="回放属性 JSON (选填)" tooltip='例如 {"catchup":"default","catchup-source":"?playseek=${start}"}'>
            <TextArea rows={3} placeholder='{"catchup":"default","catchup-source":"..."}' />
          </Form.Item>
          <Form.Item name="stream_enabled" label="加入 HLS 推流订阅" valuePropName="checked">
            <Switch />
          </Form.Item>
          {isEditing && (
            <Form.Item name="status" label="当前可用状态">
              <Select>
                <Select.Option value="active">有效</Select.Option>
                <Select.Option value="inactive">失效</Select.Option>
                <Select.Option value="unknown">未知</Select.Option>
              </Select>
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* Import Drawer */}
      <Drawer
        title="批量导入直播源"
        placement="right"
        size={window.innerWidth > 768 ? 580 : '100%'}
        onClose={() => setImportDrawerOpen(false)}
        open={importDrawerOpen}
        extra={
          <Space>
            <Button onClick={() => setImportDrawerOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleImport}>
              开始导入
            </Button>
          </Space>
        }
      >
        <Form form={importForm} layout="vertical">
          <Form.Item label="导入说明" style={{ marginBottom: 12 }}>
            <Text type="secondary">
              支持以下格式批量导入：<br/>
              1. **M3U 格式**：文件包含以 <Text code>#EXTM3U</Text> 开头的直播流信息；<br/>
              2. **TXT 格式**：用换行分割的 <Text code>频道名称,直播流地址</Text>。可以通过添加 <Text code>分组名称,#genre#</Text> 进行行分隔。
            </Text>
          </Form.Item>
          <Form.Item name="category" label="默认分组" tooltip="对于TXT格式，如果行内未配置分组，将自动归类到此分组。">
            <Input placeholder="例如: 手动导入" defaultValue="手动导入" />
          </Form.Item>
          
          <Form.Item label="上传文件导入">
            <div 
              onDragOver={(e) => e.stopPropagation()} 
              onDrop={(e) => e.stopPropagation()}
            >
              <Dragger beforeUpload={handleUploadFile} maxCount={1} fileList={[]}>
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或将 M3U/TXT 文件拖拽到此区域上传</p>
                <p className="ant-upload-hint">支持 .m3u, .m3u8, .txt 纯文本文件</p>
              </Dragger>
            </div>
          </Form.Item>

          <Form.Item name="content" label="或 直接粘贴文本内容" rules={[{ required: true, message: '请输入要导入的文本' }]}>
            <TextArea rows={12} placeholder="CCTV-1,http://...&#10;CCTV-2,http://..." />
          </Form.Item>
        </Form>
      </Drawer>

      {/* Video Preview Modal */}
      <VideoPreviewModal
        open={previewOpen}
        url={previewRecord?.url || ''}
        title={previewRecord ? `${previewRecord.name} — 预览` : '频道预览'}
        onClose={() => { setPreviewOpen(false); setPreviewRecord(null); }}
      />
    </Space>
  );
}
