import { useState, useEffect, useRef } from 'react';
import { Card, Row, Col, Statistic, Button, Progress, Tag, Badge, Space, Typography, message, Spin, Popconfirm } from 'antd';
import { 
  PlayCircleOutlined, SyncOutlined, DeleteOutlined, 
  CheckCircleOutlined, CloseCircleOutlined,
  CompassOutlined, LoadingOutlined, FileTextOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import api from '../utils/api';

const { Title, Text } = Typography;

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [testState, setTestState] = useState<any>({ running: false });
  const [syncState, setSyncState] = useState<any>({ running: false });
  const [epgState, setEpgState] = useState<any>({ running: false });
  const [optState, setOptState] = useState<any>({ running: false });
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<any>(null);

  const fetchStats = async () => {
    try {
      const res = await api.get('/api/sources/stats');
      setStats(res.data);
    } catch (error) {
      console.error('Fetch stats error:', error);
    }
  };

  const fetchTaskStatus = async () => {
    try {
      const [tRes, sRes, eRes, oRes] = await Promise.all([
        api.get('/api/sources/test/status'),
        api.get('/api/subscriptions/sync/status'),
        api.get('/api/epg/sync/status'),
        api.get('/api/optimizer/status')
      ]);
      setTestState(tRes.data);
      setSyncState(sRes.data);
      setEpgState(eRes.data);
      setOptState(oRes.data);
    } catch (error) {
      console.error('Fetch task status error:', error);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchStats(), fetchTaskStatus()]);
      setLoading(false);
    };
    init();

    // Poll task progress every 2 seconds
    timerRef.current = setInterval(() => {
      fetchStats();
      fetchTaskStatus();
    }, 2000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const triggerTest = async (onlyUntested = false) => {
    try {
      await api.post('/api/sources/test', { onlyUntested });
      message.success(onlyUntested ? '已在后台启动新增直播源检测任务' : '已在后台启动全量直播源检测任务');
      fetchTaskStatus();
    } catch (err: any) {
      message.error(err.response?.data?.error || '启动检测失败');
    }
  };

  const handleStopTest = async () => {
    try {
      await api.post('/api/sources/test/stop');
      message.success('已向检测任务发送停止指令');
      fetchTaskStatus();
    } catch (err: any) {
      message.error(err.response?.data?.error || '停止检测失败');
    }
  };

  const triggerSync = async () => {
    try {
      await api.post('/api/subscriptions/sync');
      message.success('已在后台启动订阅同步任务');
      fetchTaskStatus();
    } catch (err: any) {
      message.error(err.response?.data?.error || '启动同步失败');
    }
  };

  const triggerEpgSync = async () => {
    try {
      await api.post('/api/epg/sync');
      message.success('已在后台启动 EPG 节目单拉取任务');
      fetchTaskStatus();
    } catch (err: any) {
      message.error(err.response?.data?.error || '启动 EPG 同步失败');
    }
  };

  const triggerOptimizer = async () => {
    try {
      await api.post('/api/optimizer/run');
      message.success('已启动优化全量直播源任务');
      fetchTaskStatus();
    } catch (err: any) {
      message.error(err.response?.data?.error || '启动优化失败');
    }
  };

  const clearOptimizedSources = async () => {
    try {
      const res = await api.post('/api/optimizer/clear');
      message.success(res.data.message || '已清空优化直播源');
      fetchStats();
    } catch (err: any) {
      message.error(err.response?.data?.error || '清空优化直播源失败');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" description="正在加载系统数据统计..." />
      </div>
    );
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <div className="page-title-block">
        <Title level={3} style={{ margin: 0 }}>信息概览</Title>
        <Text type="secondary">实时监测您的直播源质量，同步节目单与订阅状态。</Text>
      </div>

      {/* Stats Cards */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={12} md={6}>
          <Card variant="borderless" className="glass-card stats-card">
            <Statistic 
              title="直播源总数" 
              value={stats?.totalSources || 0} 
              styles={{ content: { fontWeight: 700 } }}
              prefix={<FileTextOutlined style={{ color: 'var(--accent-color)', marginRight: 8 }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card variant="borderless" className="glass-card stats-card">
            <Statistic 
              title="在线有效源" 
              value={stats?.activeSources || 0} 
              styles={{ content: { color: '#52c41a', fontWeight: 700 } }}
              prefix={<CheckCircleOutlined style={{ marginRight: 8 }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card variant="borderless" className="glass-card stats-card">
            <Statistic 
              title="订阅源总数" 
              value={stats?.totalSubscriptions || 0} 
              styles={{ content: { fontWeight: 700 } }}
              prefix={<CompassOutlined style={{ color: '#722ed1', marginRight: 8 }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card variant="borderless" className="glass-card stats-card">
            <Statistic 
              title="冷冻冷却源" 
              value={stats?.frozenSources || 0} 
              styles={{ content: { color: stats?.frozenSources > 0 ? '#faad14' : 'inherit', fontWeight: 700 } }}
              prefix={<CloseCircleOutlined style={{ marginRight: 8 }} />}
            />
          </Card>
        </Col>
      </Row>

      {/* Task Progress */}
      {(testState.running || syncState.running || epgState.running || optState.running) && (
        <Card title="后台任务进度" variant="borderless" className="glass-card glow-border">
          <Row gutter={[24, 16]}>
            {testState.running && (
              <Col span={24}>
                <div className="task-progress-header">
                  <div>
                    <Badge status="processing" text={<Text strong>直播源有效性测试中...</Text>} />
                    {testState.currentItem && (
                      <div className="task-current-item">
                        当前检测: <Text code>{testState.currentItem}</Text>
                      </div>
                    )}
                  </div>
                  <Button size="small" type="primary" danger onClick={handleStopTest}>停止检测</Button>
                </div>
                <Progress 
                  percent={Math.round((testState.completed / testState.total) * 100) || 0} 
                  status="active" 
                  strokeColor="var(--accent-color)"
                />
                <div className="task-stat-row">
                  <span>已完成: {testState.completed} / {testState.total}</span>
                  <span>
                    <span style={{ color: '#52c41a' }}>成功: {testState.successCount}</span> | 
                    <span style={{ color: '#ff4d4f', marginLeft: 4 }}> 失败: {testState.failedCount}</span>
                  </span>
                </div>
              </Col>
            )}

            {syncState.running && (
              <Col span={24}>
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Text strong><LoadingOutlined style={{ marginRight: 8 }} />{syncState.message}</Text>
                  <Progress percent={50} showInfo={false} status="active" />
                </Space>
              </Col>
            )}

            {epgState.running && (
              <Col span={24}>
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Text strong><LoadingOutlined style={{ marginRight: 8 }} />{epgState.message}</Text>
                  <Progress percent={75} showInfo={false} status="active" strokeColor="#722ed1" />
                </Space>
              </Col>
            )}

            {optState.running && (
              <Col span={24}>
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Text strong><LoadingOutlined style={{ marginRight: 8 }} />{optState.message}</Text>
                  <Progress
                    percent={Math.round((optState.completed / optState.total) * 100) || 0}
                    status="active"
                    strokeColor="#722ed1"
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    进度: {optState.completed || 0} / {optState.total || 0}
                  </Text>
                </Space>
              </Col>
            )}
          </Row>
        </Card>
      )}

      {/* Quick Actions & Details */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={10}>
          <Card title="快捷操作" variant="borderless" className="glass-card" style={{ height: '100%' }}>
            <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
              <div className="dashboard-action-section">
                <Text strong className="dashboard-action-title">订阅更新</Text>
                <div className="dashboard-action-grid">
                  <Button 
                    icon={<SyncOutlined />} 
                    onClick={triggerSync} 
                    loading={syncState.running}
                    size="large"
                  >
                    同步所有外部订阅
                  </Button>
                  <Button 
                    icon={<SyncOutlined style={{ color: '#722ed1' }} />} 
                    onClick={triggerEpgSync} 
                    loading={epgState.running}
                    size="large"
                  >
                    同步抓取EPG节目单
                  </Button>
                </div>
              </div>

              <div className="dashboard-action-section">
                <Text strong className="dashboard-action-title">检测优化</Text>
                <div className="dashboard-action-grid">
                  <Button 
                    type="primary" 
                    icon={<PlayCircleOutlined />} 
                    onClick={() => triggerTest(false)} 
                    loading={testState.running}
                    size="large"
                  >
                    检测全部直播源
                  </Button>
                  <Button 
                    type="primary" 
                    ghost
                    icon={<PlayCircleOutlined />} 
                    onClick={() => triggerTest(true)} 
                    loading={testState.running}
                    size="large"
                  >
                    检测增量直播源
                  </Button>
                  <Button
                    icon={<ThunderboltOutlined />}
                    onClick={triggerOptimizer}
                    loading={optState.running}
                    size="large"
                  >
                    优化全量直播源
                  </Button>
                  <Popconfirm
                    title="确定要清空所有优化直播源吗？"
                    onConfirm={clearOptimizedSources}
                    okText="确定清空"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button danger icon={<DeleteOutlined />} size="large">
                      清空优化直播源
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            </Space>
          </Card>
        </Col>

        {/* Categories Breakdown */}
        <Col xs={24} md={14}>
          <Card title="来源/订阅统计" variant="borderless" className="glass-card" style={{ height: '100%' }}>
            <div className="source-stats-list">
              {(stats?.categories || []).map((item: any) => (
                <div key={item.category || 'uncategorized'} className="source-stats-list-item">
                  <div className="stats-grid-item source-stats-item">
                    <div className="source-stats-header">
                      <Tag color="blue" className="source-stats-tag">
                        {item.category || '未分类'}
                      </Tag>
                      <Tag color="default" className="source-stats-total-tag">
                        {item.count || 0}
                      </Tag>
                    </div>
                    <div className="source-stats-counts">
                      <div className="source-stats-count source-stats-count-active">
                        <span>有效</span>
                        <strong>{item.activeCount || 0}</strong>
                      </div>
                      <div className="source-stats-count source-stats-count-inactive">
                        <span>无效</span>
                        <strong>{item.inactiveCount || 0}</strong>
                      </div>
                      <div className="source-stats-count source-stats-count-unknown">
                        <span>未知</span>
                        <strong>{item.unknownCount ?? Math.max((item.count || 0) - (item.activeCount || 0) - (item.inactiveCount || 0), 0)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
