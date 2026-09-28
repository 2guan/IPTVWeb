import { useState, useEffect, useRef } from 'react';
import { 
  Table, Card, Button, Input, Select, Space, Row, Col, 
  Tag, Typography, Popconfirm, message, Progress, Tooltip, Badge, Switch, Pagination,
  Modal, Form
} from 'antd';
import { 
  SearchOutlined, DeleteOutlined, PlayCircleOutlined, 
  LoadingOutlined, EyeOutlined, EditOutlined
} from '@ant-design/icons';
import api from '../utils/api';
import { formatBeijingTime, isFutureBeijingTime } from '../utils/time';
import VideoPreviewModal from '../components/VideoPreviewModal';

const { Title, Text } = Typography;

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
  if (record.origin === 'extractor') {
    return { text: '官方直采', color: 'cyan' };
  }
  return { text: '手动导入', color: 'orange' };
}

export default function OptimizedSources() {
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
  const [filterIpv, setFilterIpv] = useState<string | undefined>(undefined);
  const [filterIsp, setFilterIsp] = useState<string | undefined>(undefined);
  const [filterSubscription, setFilterSubscription] = useState<string | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  const [filterFrozen, setFilterFrozen] = useState<string | undefined>(undefined);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [testingOptimizedIds, setTestingOptimizedIds] = useState<number[]>([]);

  const onSelectChange = (newSelectedRowKeys: React.Key[]) => {
    setSelectedRowKeys(newSelectedRowKeys);
  };

  // LLM Task Status
  const [optStatus, setOptStatus] = useState<any>({ running: false, total: 0, completed: 0, message: '' });
  const statusTimerRef = useRef<any>(null);
  const singleTestTimersRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});

  // Preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRecord, setPreviewRecord] = useState<any>(null);

  // Edit
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editForm] = Form.useForm();

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
        ipvType: pickFilter('ipvType', filterIpv),
        isp: pickFilter('isp', filterIsp),
        subscriptionId: pickFilter('subscriptionId', filterSubscription),
        status: pickFilter('status', filterStatus),
        frozen: pickFilter('frozen', filterFrozen)
      };

      const res = await api.get('/api/optimizer', { params });
      setData(res.data.items);
      setTotal(res.data.total);
      setFilters(res.data.filters);
      return res.data.items;
    } catch {
      message.error('加载优化直播源失败');
      return [];
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Poll LLM Task status
  const fetchTaskStatus = async () => {
    try {
      const res = await api.get('/api/optimizer/status');
      setOptStatus(res.data);
      if (res.data.running) {
        fetchData();
        if (!statusTimerRef.current) {
          statusTimerRef.current = setInterval(fetchTaskStatus, 2000);
        }
      } else {
        if (statusTimerRef.current) {
          clearInterval(statusTimerRef.current);
          statusTimerRef.current = null;
          fetchData(); // Reload list when optimization completes
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
    fetchTaskStatus();

    return () => {
      if (statusTimerRef.current) clearInterval(statusTimerRef.current);
    };
  // Search text is submitted explicitly; task polling owns its interval lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filterCategory, filterIpv, filterIsp, filterSubscription, filterStatus, filterFrozen]);

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

  const removeTestingOptimizedSource = (id: number) => {
    setTestingOptimizedIds(prev => prev.filter(item => item !== id));
  };

  const pollSingleTestResult = (record: any) => {
    clearSingleTestTimer(record.id);
    let attempts = 0;

    singleTestTimersRef.current[record.id] = setInterval(async () => {
      attempts += 1;

      try {
        const res = await api.get(`/api/sources/${record.original_source_id}`);
        const source = res.data;
        const isDone = source.status !== 'testing';

        if (isDone || attempts >= 60) {
          clearSingleTestTimer(record.id);
          removeTestingOptimizedSource(record.id);
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
          removeTestingOptimizedSource(record.id);
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
      ipvType: undefined,
      isp: undefined,
      subscriptionId: undefined,
      status: undefined,
      frozen: undefined
    };
    setSearchName('');
    setFilterCategory(undefined);
    setFilterIpv(undefined);
    setFilterIsp(undefined);
    setFilterSubscription(undefined);
    setFilterStatus(undefined);
    setFilterFrozen(undefined);
    setPage(1);
    fetchData({ page: 1, filters: resetFilters });
  };

  const resetPageAndSetFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setPage(1);
    setter(value);
  };

  const handleTestSingle = async (record: any) => {
    if (!record.original_source_id) {
      message.error('该优化源缺少原始直播源关联，无法测速');
      return;
    }

    try {
      setTestingOptimizedIds(prev => prev.includes(record.id) ? prev : [...prev, record.id]);
      message.info(`正在测试 [${record.name}] 对应的原始直播源...`);
      await api.post('/api/sources/test', { ids: [record.original_source_id] });
      await fetchData({ showLoading: false });
      pollSingleTestResult(record);
    } catch (err: any) {
      removeTestingOptimizedSource(record.id);
      message.error(err.response?.data?.error || '启动测试失败');
    }
  };

  // Bulk delete optimized sources
  const handleBulkDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    try {
      const res = await api.delete('/api/optimizer', { data: { ids: selectedRowKeys } });
      message.success(res.data.message);
      setSelectedRowKeys([]);
      fetchData();
    } catch {
      message.error('批量删除失败');
    }
  };

  // Trigger full LLM optimization
  const handleTriggerFullLlm = async () => {
    try {
      await api.post('/api/optimizer/run');
      setData([]);
      setTotal(0);
      message.success('已清空旧优化结果，并启动大模型归一化优化任务');
      fetchTaskStatus();
    } catch (err: any) {
      message.error(err.response?.data?.error || '启动大模型优化失败');
    }
  };

  // Trigger incremental LLM optimization
  const handleTriggerIncrementalLlm = async () => {
    try {
      await api.post('/api/optimizer/run-incremental');
      message.success('已启动增量优化任务，将保留现有优化结果');
      fetchTaskStatus();
    } catch (err: any) {
      message.error(err.response?.data?.error || '启动增量优化失败');
    }
  };

  const handleStopOpt = async () => {
    try {
      await api.post('/api/optimizer/stop');
      message.success('已向大模型优化任务发送停止指令');
      fetchTaskStatus();
    } catch (err: any) {
      message.error(err.response?.data?.error || '停止大模型优化失败');
    }
  };

  // Clear optimized sources
  const handleClearAll = async () => {
    try {
      await api.post('/api/optimizer/clear');
      message.success('已清空优化数据');
      setPage(1);
      fetchData();
    } catch {
      message.error('清空失败');
    }
  };

  // Delete all channels with same name
  const handleDeleteChannel = async (name: string) => {
    try {
      await api.delete('/api/optimizer/channel', { data: { name } });
      message.success(`已删除频道 [${name}] 的所有线路`);
      fetchData();
    } catch {
      message.error('删除频道失败');
    }
  };

  const openEdit = (record: any) => {
    setEditingItem(record);
    editForm.setFieldsValue({
      name: record.name,
      url: record.url,
      category: record.category ? [record.category] : [],
      tvg_logo: record.tvg_logo,
      status: record.status || 'unknown'
    });
    setEditModalOpen(true);
  };

  const saveEdit = async () => {
    if (!editingItem) return;

    try {
      const values = await editForm.validateFields();
      await api.put(`/api/optimizer/${editingItem.id}`, {
        category: Array.isArray(values.category) ? values.category[0] : values.category
      });
      message.success('优化直播源分组修改成功');
      setEditModalOpen(false);
      setEditingItem(null);
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
  };

  // Copy link utility
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success('流链接已复制');
  };

  // Columns definition
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
      render: (text: string) => <Tag color="blue">{text || '其他'}</Tag>
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
      responsive: ['md'] as any,
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
      render: (text: string) => {
        if (text === 'active') return <Badge status="success" text="有效" />;
        if (text === 'inactive') return <Badge status="error" text="失效" />;
        if (text === 'testing') return <Badge status="processing" text="测试中" />;
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
      key: 'actions',
      align: 'center' as const,
      width: 150,
      render: (record: any) => (
        <Space>
          <Tooltip title="预览播放">
            <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => { setPreviewRecord(record); setPreviewOpen(true); }} />
          </Tooltip>
          <Tooltip title="测试对应原始源可用性">
            <Button
              size="small"
              type="text"
              icon={<PlayCircleOutlined />}
              loading={testingOptimizedIds.includes(record.id)}
              onClick={() => handleTestSingle(record)}
            />
          </Tooltip>
          <Tooltip title="编辑优化信息">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm
            title={`确定删除该频道的所有线路吗？`}
            description="这将从优化表中移出该频道对应的全部源。"
            onConfirm={() => handleDeleteChannel(record.name)}
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="从优化表中删除该频道">
              <Button size="small" type="text" danger icon={<DeleteOutlined style={{ opacity: 0.6 }} />} />
            </Tooltip>
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
          <Title level={3} style={{ margin: 0 }}>大模型优化直播源</Title>
          <Text type="secondary">使用大模型进行频道名称清洗、去除广告文本，并自动归一化频道分组。</Text>
        </div>
        <Space wrap className="responsive-actions">
          <Popconfirm
            title="确定要全部优化吗？"
            description="这会先清空现有优化结果，再读取所有有效原始直播源重新生成优化数据。"
            onConfirm={handleTriggerFullLlm}
            okText="全部优化"
            cancelText="取消"
            okButtonProps={{ loading: optStatus.running }}
          >
            <Button type="primary" icon={<PlayCircleOutlined />} loading={optStatus.running}>
              全部优化
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确定要增量优化吗？"
            description="只会优化尚未进入优化列表、且状态有效的原始直播源；不会清空现有优化结果。"
            onConfirm={handleTriggerIncrementalLlm}
            okText="增量优化"
            cancelText="取消"
            okButtonProps={{ loading: optStatus.running }}
          >
            <Button icon={<PlayCircleOutlined />} loading={optStatus.running}>
              增量优化
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确定要清空优化过的数据吗？"
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

      {/* LLM Run Progress */}
      {optStatus.running && (
        <Card variant="borderless" className="glass-card" style={{ borderColor: '#722ed1', borderWidth: 1 }}>
          <Space orientation="vertical" style={{ width: '100%' }} size="small">
            <div className="task-progress-header">
              <Text strong>
                <LoadingOutlined style={{ marginRight: 8, color: '#722ed1' }} />
                {optStatus.message}
              </Text>
              <Button size="small" type="primary" danger onClick={handleStopOpt}>停止优化</Button>
            </div>
            <Progress 
              percent={Math.round((optStatus.completed / optStatus.total) * 100) || 0} 
              status="active" 
              strokeColor="#722ed1" 
            />
            <Text type="secondary" style={{ fontSize: '12px' }}>
              进度: {optStatus.completed} / {optStatus.total}，已写入: {optStatus.saved || 0} (大模型处理耗时取决于分组量和网络速度)
            </Text>
          </Space>
        </Card>
      )}

      {/* Filter panel */}
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
              <Select.Option value="extractor">官方直采</Select.Option>
              <Select.Option value="migu">咪咕专区</Select.Option>
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
            <Popconfirm title="确定要删除选中的优化直播源吗？" onConfirm={handleBulkDelete}>
              <Button danger size="small" icon={<DeleteOutlined />}>
                批量删除
              </Button>
            </Popconfirm>
          </Space>
        </div>
      )}

      {/* Data Table for Desktop */}
      <div className="desktop-table-view">
        <Card variant="borderless" className="glass-card">
          <Table 
            rowSelection={{
              selectedRowKeys,
              onChange: onSelectChange,
            }}
            columns={columns} 
            dataSource={data}
            loading={loading}
            rowKey="id"
            pagination={{
              current: page,
              pageSize: pageSize,
              total: total,
              showSizeChanger: true,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); }
            }}
            scroll={{ x: 'max-content' }}
          />
        </Card>
      </div>

      {/* Card List for Mobile */}
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
                <div>分组: <Tag color="blue" style={{ margin: 0 }}>{record.category || '其他'}</Tag></div>
                <div>协议: <Tag style={{ margin: 0 }} color={record.ipv_type === 'ipv6' ? 'purple' : 'cyan'}>{record.ipv_type?.toUpperCase() || '未知'}</Tag></div>
                <div>来源: {(() => {
                  const source = getSourceLabel(record);
                  return <Tag color={source.color} style={{ margin: 0 }}>{source.text}</Tag>;
                })()}</div>
                <div>延迟: {record.delay === -1 || record.status === 'unknown' ? '-' : <Text type={record.delay > 300 ? 'warning' : 'success'}>{record.delay} ms</Text>}</div>
                <div>速度: {record.speed ? <Text strong>{record.speed.toFixed(2)} MB/s</Text> : '-'}</div>
                <div>画质: {record.resolution ? `${record.resolution} (${record.codec || ''})` : '-'}</div>
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
                    loading={testingOptimizedIds.includes(record.id)}
                    onClick={() => handleTestSingle(record)}
                  >
                    测试
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
                  <Popconfirm
                    title={`确定删除该频道的所有线路吗？`}
                    description="这将从优化表中移出该频道对应的全部源。"
                    onConfirm={() => handleDeleteChannel(record.name)}
                    okText="确定"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>删除频道</Button>
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

      {/* Edit Modal */}
      <Modal
        title="编辑优化直播源"
        open={editModalOpen}
        onOk={saveEdit}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingItem(null);
        }}
        destroyOnHidden
        forceRender
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="频道名称" rules={[{ required: true, message: '请输入频道名称' }]}>
            <Input disabled placeholder="例如: CCTV-1" />
          </Form.Item>
          <Form.Item name="url" label="频道流地址" rules={[{ required: true, message: '请输入流 URL' }]}>
            <Input disabled placeholder="http://..." />
          </Form.Item>
          <Form.Item name="category" label="频道分组" rules={[{ required: true, message: '请选择或输入分组' }]}>
            <Select mode="tags" maxCount={1} placeholder="例如: 央视">
              {filters.categories.map((c: string) => (
                <Select.Option key={c} value={c}>{c}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="tvg_logo" label="台标 URL">
            <Input disabled placeholder="http://.../logo.png" />
          </Form.Item>
          <Form.Item name="status" label="当前可用状态">
            <Select disabled>
              <Select.Option value="active">有效</Select.Option>
              <Select.Option value="inactive">失效</Select.Option>
              <Select.Option value="testing">测试中</Select.Option>
              <Select.Option value="unknown">未知</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Video Preview Modal */}
      <VideoPreviewModal
        open={previewOpen}
        url={
          previewRecord?.url?.includes('.flv') || previewRecord?.channel_id?.startsWith('fengshows-')
            ? `/stream/flv/${previewRecord.id}`
            : (previewRecord?.url || '')
        }
        title={previewRecord ? `${previewRecord.name} — 预览` : '频道预览'}
        onClose={() => { setPreviewOpen(false); setPreviewRecord(null); }}
      />
    </Space>
  );
}
