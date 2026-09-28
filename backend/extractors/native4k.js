/**
 * 地方卫视官方超高清 4K 原生直连源抓取器
 * 涵盖 BesTV/东方卫视 4K、新蓝网/浙江卫视 4K、芒果TV/湖南卫视 4K 等官方直连流
 */
export async function extractNative4K() {
  return [
    {
      name: '东方卫视4K',
      url: 'https://bp-resource-dfl.bestv.cn/148/3/video.m3u8',
      category: '4K',
      channel_id: 'cctv-dfws-4k',
      tvg_logo: 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/icon/东方卫视.png',
      origin: 'extractor',
      status: 'active'
    },
    {
      name: '浙江卫视4K',
      url: 'http://ali-xwl.cztv.com/live/channel4k2160p.m3u8',
      category: '4K',
      channel_id: 'cctv-zjws-4k',
      tvg_logo: 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/icon/浙江卫视.png',
      origin: 'extractor',
      status: 'active'
    },
    {
      name: '湖南卫视4K',
      url: 'http://hlsal-ldvt.qing.mgtv.com/nn_live/nn_x64/Y2RuZXhfaWQ9YWxfaGxzX2xkdnQmZT02OTE0NjA0JnY9MSZpZD1ITldTWkdTVCZzPTcwN2RiYTc2YzJjNmJmMTQ4MmUyZGYzOWU2NWM3YWFi/HNWSZGST.m3u8',
      category: '4K',
      channel_id: 'cctv-hnws-4k',
      tvg_logo: 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/icon/湖南卫视.png',
      origin: 'extractor',
      status: 'active'
    }
  ];
}

export default {
  extractNative4K
};
