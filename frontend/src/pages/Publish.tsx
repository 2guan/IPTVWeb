import { useState, useEffect, useMemo } from 'react';
import { Card, Form, Radio, Checkbox, Slider, Button, Typography, Space, Row, Col, message } from 'antd';
import { CopyOutlined, CloudDownloadOutlined, LinkOutlined } from '@ant-design/icons';
import api from '../utils/api';

const { Title, Text, Paragraph } = Typography;

const PROVINCE_CATEGORY_ORDER = [
  '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江',
  '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北',
  '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃',
  '青海', '内蒙古', '广西', '西藏', '宁夏', '新疆'
];

function normalizeCategoryLabel(category = '') {
  return String(category || '')
    .trim()
    .replace(/^[*＊•·\s_【[(（-]+|[*＊•·\s_】\])）-]+$/g, '')
    .replace(/(频道|电视台|电视|直播源|分组|源)$/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function categoryMatchesAny(text: string, words: string[]) {
  return words.some(word => text.includes(word.toLowerCase()));
}

function getExportCategorySortInfo(category = '') {
  const raw = String(category || '').trim();
  const normalized = normalizeCategoryLabel(raw);
  const text = `${normalized} ${raw.toLowerCase()}`;

  if (categoryMatchesAny(text, ['央视', '中央台', 'cctv', 'cntv'])) {
    return { groupRank: 0, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['卫视', '地方卫视', '各省卫视'])) {
    return { groupRank: 1, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['北京', 'bj', 'beijing'])) {
    return { groupRank: 2, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['港澳台', '港台', '香港', '澳门', '台湾', 'hk', 'hongkong', 'macau', 'taiwan', 'tw'])) {
    return { groupRank: 3, provinceRank: -1, normalized };
  }
  if (normalized === 'us' || categoryMatchesAny(text, ['美国', '美洲', 'usa', 'unitedstates', 'united states'])) {
    return { groupRank: 4, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['日本', 'jp', 'japan'])) {
    return { groupRank: 5, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['韩国', 'kr', 'korea'])) {
    return { groupRank: 6, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['国际', '海外', '境外', 'world', 'global', 'international', 'foreign'])) {
    return { groupRank: 7, provinceRank: -1, normalized };
  }

  const provinceRank = PROVINCE_CATEGORY_ORDER.findIndex(name => text.includes(name.toLowerCase()));
  if (provinceRank !== -1) {
    return { groupRank: 8, provinceRank, normalized };
  }

  if (categoryMatchesAny(text, ['景区', '风景', '旅游'])) {
    return { groupRank: 9, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['直播', 'live'])) {
    return { groupRank: 10, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['电影', '影院', '影视', 'movie', 'film'])) {
    return { groupRank: 11, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['广播', '电台', 'radio'])) {
    return { groupRank: 12, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['音乐', 'music', 'mv', 'mtv'])) {
    return { groupRank: 13, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['游戏', '电竞', 'game'])) {
    return { groupRank: 14, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['其它', '其他', '未分类', 'misc'])) {
    return { groupRank: 15, provinceRank: -1, normalized };
  }

  return { groupRank: 16, provinceRank: -1, normalized };
}

function compareExportCategories(a = '', b = '') {
  const aInfo = getExportCategorySortInfo(a);
  const bInfo = getExportCategorySortInfo(b);

  if (aInfo.groupRank !== bInfo.groupRank) {
    return aInfo.groupRank - bInfo.groupRank;
  }
  if (aInfo.provinceRank !== bInfo.provinceRank) {
    return aInfo.provinceRank - bInfo.provinceRank;
  }

  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN');
}

export default function Publish() {
  const [originalCategories, setOriginalCategories] = useState<string[]>([]);
  const [optimizedCategories, setOptimizedCategories] = useState<string[]>([]);
  const [isps, setIsps] = useState<string[]>([]);
  const [token, setToken] = useState('');
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [form] = Form.useForm();

  // Watch current mode in Form
  const currentMode = Form.useWatch('mode', form) || 'original';
  const displayCategories = useMemo(() => {
    const categories = currentMode === 'optimized' ? optimizedCategories : originalCategories;
    return [...categories].sort(compareExportCategories);
  }, [currentMode, optimizedCategories, originalCategories]);

  // Load categories and ISPs for selection options
  useEffect(() => {
    // We fetch api settings and sources to build options
    Promise.all([
      api.get('/api/sources?pageSize=1'),
      api.get('/api/optimizer?pageSize=1'),
      api.get('/api/settings')
    ]).then(([srcRes, optRes, setRes]) => {
      setOriginalCategories(srcRes.data.filters.categories || []);
      setOptimizedCategories(optRes.data.filters.categories || []);
      setIsps(srcRes.data.filters.isps || []);
      setToken(setRes.data.exportToken || '');
      
      // Setup initial form
      form.setFieldsValue({
        mode: setRes.data.llmDefaultMode || 'original',
        delivery: 'normal',
        format: 'm3u',
        ipv: 'all',
        only_active: true,
        limit_per_channel: 5,
        selectedCategories: [],
        selectedIsps: []
      });
      generateLink();
    }).catch(() => {
      message.error('加载选项数据失败');
    });
  // Initial option loading also initializes the form once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateLink = () => {
    const values = form.getFieldsValue();
    const origin = window.location.origin;
    
    // Build path
    let path = '';
    if (values.delivery === 'hls') {
      if (values.ipv === 'all') {
        path = values.format === 'm3u' ? '/hls/m3u' : '/hls/txt';
      } else {
        path = `/hls/${values.ipv}/${values.format}`;
      }
    } else if (values.ipv === 'all') {
      path = values.format === 'm3u' ? '/m3u' : '/txt';
    } else {
      path = `/${values.ipv}/${values.format}`;
    }

    // Build query params
    const params = [];
    
    if (token) {
      params.push(`token=${token}`);
    }

    if (values.delivery !== 'hls' && values.mode === 'optimized') {
      params.push('mode=optimized');
    }
    
    if (values.delivery !== 'hls' && values.only_active) {
      params.push('only_active=1');
    } else if (values.delivery !== 'hls') {
      params.push('only_active=0');
    }

    if (values.delivery !== 'hls' && values.limit_per_channel > 0) {
      params.push(`limit_per_channel=${values.limit_per_channel}`);
    }

    if (values.delivery !== 'hls' && values.selectedCategories && values.selectedCategories.length > 0) {
      params.push(`categories=${values.selectedCategories.join(',')}`);
    }

    if (values.delivery !== 'hls' && values.selectedIsps && values.selectedIsps.length > 0) {
      params.push(`isp=${values.selectedIsps.join(',')}`);
    }

    const queryStr = params.length > 0 ? `?${params.join('&')}` : '';
    setGeneratedUrl(`${origin}${path}${queryStr}`);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(generatedUrl);
    message.success('订阅链接已复制到剪贴板！');
  };

  const downloadPlaylist = () => {
    window.open(generatedUrl, '_blank');
  };

  const handleValuesChange = (changedValues: any) => {
    if (changedValues.mode !== undefined) {
      form.setFieldValue('selectedCategories', []);
    }
    generateLink();
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <div className="page-title-block">
        <Title level={3} style={{ margin: 0 }}>发布与导出订阅</Title>
        <Text type="secondary">在此自定义您的直播源订阅，生成符合播放器格式（如 Tivimate、PotPlayer）的下载链接。</Text>
      </div>

      <Row gutter={[16, 16]}>
        {/* Configurations builder */}
        <Col xs={24} lg={14} className="publish-config-col">
          <Card title="生成配置" variant="borderless" className="glass-card">
            <Form 
              form={form} 
              layout="vertical" 
              onValuesChange={handleValuesChange}
            >
              <Form.Item name="mode" label="数据模式 (Data Mode)">
                <Radio.Group buttonStyle="solid" className="responsive-option-group">
                  <Radio.Button value="original">原始直播源 (原始数据)</Radio.Button>
                  <Radio.Button value="optimized">优化直播源 (大模型归一化)</Radio.Button>
                </Radio.Group>
              </Form.Item>

              <Form.Item name="delivery" label="订阅类型">
                <Radio.Group buttonStyle="solid" className="responsive-option-group">
                  <Radio.Button value="normal">普通直连订阅</Radio.Button>
                  <Radio.Button value="hls">HLS 推流订阅</Radio.Button>
                </Radio.Group>
              </Form.Item>

              <Form.Item name="format" label="导出格式">
                <Radio.Group buttonStyle="solid" className="responsive-option-group">
                  <Radio.Button value="m3u">M3U 格式 (包含台标、分组，播放器推荐)</Radio.Button>
                  <Radio.Button value="txt">TXT 格式 (简单纯文本，带 genre 分类)</Radio.Button>
                </Radio.Group>
              </Form.Item>

              <Form.Item name="ipv" label="IP 协议筛选">
                <Radio.Group buttonStyle="solid" className="responsive-option-group">
                  <Radio.Button value="all">混合 (IPv4 & IPv6)</Radio.Button>
                  <Radio.Button value="ipv4">仅 IPv4</Radio.Button>
                  <Radio.Button value="ipv6">仅 IPv6</Radio.Button>
                </Radio.Group>
              </Form.Item>

              <Form.Item name="only_active" label="仅输出有效源" valuePropName="checked">
                <Checkbox>仅包含测速通过且可播放的流地址 (过滤死链和高延迟源)</Checkbox>
              </Form.Item>

              <Form.Item name="limit_per_channel" label="每个频道最大源数量 (Limit)">
                <Slider 
                  min={1} 
                  max={50} 
                  marks={{ 1: '1', 5: '5', 10: '10', 20: '20', 50: '50' }}
                  tooltip={{ formatter: (v) => `${v} 个` }}
                />
              </Form.Item>

              <Form.Item name="selectedCategories" label="选择包含的频道分组 (默认导出全部)">
                <Checkbox.Group style={{ width: '100%' }}>
                  <Row gutter={[8, 8]}>
                    {displayCategories.map(c => (
                      <Col xs={24} sm={12} md={8} key={c}>
                        <Checkbox value={c}>{c}</Checkbox>
                      </Col>
                    ))}
                  </Row>
                </Checkbox.Group>
              </Form.Item>

              <Form.Item name="selectedIsps" label="选择包含的运营商 (默认导出全部)">
                <Checkbox.Group style={{ width: '100%' }}>
                  <Row gutter={[8, 8]}>
                    {isps.map(i => (
                      <Col xs={24} sm={12} md={8} key={i}>
                        <Checkbox value={i}>{i}</Checkbox>
                      </Col>
                    ))}
                  </Row>
                </Checkbox.Group>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        {/* Dynamic Output Links */}
        <Col xs={24} lg={10} className="publish-output-col">
          <Card title="生成的订阅地址" variant="borderless" className="glass-card glow-border" style={{ height: '100%' }}>
            <Space orientation="vertical" size="large" style={{ width: '100%' }}>
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 8, wordBreak: 'break-all' }}>
                <Text copyable style={{ fontSize: '13px', fontFamily: 'monospace' }}>{generatedUrl}</Text>
              </div>
              
              <div className="responsive-button-row">
                <Button 
                  type="primary" 
                  icon={<CopyOutlined />} 
                  onClick={copyUrl}
                  block
                  size="large"
                >
                  复制订阅链接
                </Button>
                <Button 
                  icon={<CloudDownloadOutlined />} 
                  onClick={downloadPlaylist}
                  block
                  size="large"
                >
                  下载订阅文件
                </Button>
              </div>

              <div style={{ marginTop: 12 }}>
                <Title level={5}><LinkOutlined style={{ marginRight: 8 }} />使用说明</Title>
                <Paragraph style={{ fontSize: '13px', color: '#999' }}>
                  1. 将生成的订阅链接直接粘贴到您的 IPTV 播放器设置中即可实现流媒体订阅更新。<br/><br/>
                  2. 如果您在系统设置中设置了“公开导出 Token”，订阅链接中会自动追加 <Text code>token=xxx</Text>，此参数不可删除，否则会导致 403 拒绝访问。<br/><br/>
                  3. 订阅文件在播放器拉取时是动态渲染生成的，不需要您每次手动导出文件。
                </Paragraph>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
