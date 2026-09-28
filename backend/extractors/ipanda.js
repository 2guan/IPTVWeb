/**
 * 央视网 iPanda 熊猫频道 官方全景直播抓取器
 * 18 路官方固定机位，超清画质，官方 CDN 带公开 CORS 标头，长效可用
 */
export async function extractIPanda() {
  const CAMERA_HOST = 'gcwbndali.v.myalicdn.com';
  const LOGO = 'https://p2.img.cctvpic.com/photoAlbum/templet/common/TPTEjtwxdE0E0hk2XE4yFM3D230723/top_H5_logo.png';

  const rows = [
    { name: '熊猫直播·成都成年园A', channel: 'xiongmao01' },
    { name: '熊猫直播·成都成年园B', channel: 'xiongmao02' },
    { name: '熊猫直播·成都六号别墅A', channel: 'xiongmao03' },
    { name: '熊猫直播·成都六号别墅B', channel: 'xiongmao04' },
    { name: '熊猫直播·成都幼儿园A', channel: 'xiongmao05' },
    { name: '熊猫直播·成都幼儿园B', channel: 'xiongmao06' },
    { name: '熊猫直播·成都母子园A', channel: 'xiongmao07' },
    { name: '熊猫直播·成都母子园B', channel: 'xiongmao08' },
    { name: '熊猫直播·成都一号别墅A', channel: 'xiongmao09' },
    { name: '熊猫直播·成都一号别墅B', channel: 'xiongmao10' },
    { name: '熊猫直播·都江堰吉福A', channel: 'xiongmao11' },
    { name: '熊猫直播·都江堰瑞喜乔怡A', channel: 'xiongmao12' },
    { name: '熊猫直播·都江堰新乔', channel: 'xiongmao13' },
    { name: '熊猫直播·都江堰青灵', channel: 'xiongmao14' },
    { name: '熊猫直播·都江堰优悠', channel: 'xiongmao15' },
    { name: '熊猫直播·都江堰瑞喜乔怡B', channel: 'xiongmao16' },
    { name: '熊猫直播·都江堰吉福B', channel: 'xiongmao18' },
    { name: '熊猫直播·都江堰春野秋野', channel: 'xiongmao20' },
    { name: '江苏大丰麋鹿国家级保护区', channel: 'xiongmao23' },
    { name: '云南白马雪山自然保护区', channel: 'xiongmao24' }
  ];

  return rows.map(item => ({
    name: item.name,
    url: `https://${CAMERA_HOST}/gcwbnd/${item.channel}_2/index.m3u8`,
    category: '景区',
    channel_id: `ipanda-${item.channel}`,
    tvg_logo: LOGO,
    origin: 'extractor',
    status: 'active'
  }));
}

export default {
  extractIPanda
};
