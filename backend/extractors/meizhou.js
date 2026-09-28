/**
 * 梅州市广播电视台 客家生活频道 官方直播抓取器
 * 官方公网全天候 HLS 直播源
 */
export async function extractMeizhou() {
  return [{
    name: '梅州客家生活',
    url: 'https://livepull.hellohakka.cn/live/ch_kejiashenghuo.m3u8',
    category: '广东',
    channel_id: 'meizhou-hakka',
    tvg_logo: 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/icon/客家生活.png',
    origin: 'extractor',
    status: 'active'
  }];
}

export default {
  extractMeizhou
};
