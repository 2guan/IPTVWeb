/**
 * 亚洲与国际官方直连直播源抓取器 (Asian & International Live)
 * 包含 YTN News (韩国动态更新)、NHK World (日本动态更新)
 * 以及 16 个已验证稳定可用的官方直连/FAST/国际频道
 */
export async function extractAsianLive() {
  const channels = [];

  // 1. YTN News (动态解析)
  try {
    const res = await fetch(`https://www.ytn.co.kr/_hd/cdnurl.js?_=${Date.now()}`, {
      signal: AbortSignal.timeout(6000),
      headers: { Referer: 'https://m.ytn.co.kr/', 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.ok) {
      const text = await res.text();
      const match = /\bvar\s+liveUrl\s*=\s*(\{[^;]+\})\s*;?/.exec(text);
      if (match) {
        const data = JSON.parse(match[1]);
        if (data?.hls) {
          channels.push({
            name: 'YTN News',
            url: data.hls,
            category: '韩国',
            channel_id: 'asian-ytn',
            tvg_logo: 'https://m.ytn.co.kr/img/common/ytnlogo_2024.jpg',
            origin: 'extractor',
            status: 'active'
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Extractor:AsianLive] YTN News fetch failed:', err.message);
  }

  // 2. NHK World (动态解析)
  try {
    const res = await fetch('https://livepl.nhkworld.jp/hlslive_web.json', {
      signal: AbortSignal.timeout(6000),
      headers: { Referer: 'https://www3.nhk.or.jp/nhkworld/en/live_tv/', 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.ok) {
      const data = await res.json();
      const url = data?.main?.jstrm;
      if (url) {
        channels.push({
          name: 'NHK World',
          url,
          category: '日本',
          channel_id: 'asian-nhk-world',
          tvg_logo: 'https://www3.nhk.or.jp/nhkworld/common/site_images/nw_logo_270x270.png',
          origin: 'extractor',
          status: 'active'
        });
      }
    }
  } catch (err) {
    console.warn('[Extractor:AsianLive] NHK World fetch failed:', err.message);
  }

  // 3. 官方验证直连频道 (FAST 与官方直连)
  const fixedSources = [
    { name: '耀才财经', category: '港澳台', url: 'https://v3.mediacast.hk/webcast/bshdlive-pc/playlist.m3u8', logo: 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/icon/耀才财经.png' },
    { name: '面包台', category: '港澳台', url: 'https://video.bread-tv.com:8091/hls-live24/online/index.m3u8', logo: 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/icon/面包台.png' },
    { name: '大立电视台', category: '港澳台', url: 'http://www.dalitv.com.tw:4568/live/dali/index.m3u8', logo: 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/icon/大立电视台.png' },
    { name: 'Pet Club TV', category: '国际', url: 'https://petclub-samsungaus.amagi.tv/playlist.m3u8', logo: '' },
    { name: 'WildEarth', category: '国际', url: 'https://wildearth-plex.amagi.tv/masterR1080p.m3u8', logo: '' },
    { name: 'Love Nature 4K', category: '国际', url: 'https://pb-ehs1glsha1juy.akamaized.net/v1/manifest/3722c60a815c199d9c0ef36c5b73da68a62b09d1/pb-ehs1glsha1juy/f2141f37-1f48-475b-ba54-b9efb62346db/0.m3u8', logo: '' },
    { name: 'CGTN Documentary', category: '央视', url: 'https://english-livebkali.cgtn.com/live/doccgtn.m3u8', logo: 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/icon/CGTN纪录.png' },
    { name: 'CNA', category: '国际', url: 'https://d2e1asnsl7br7b.cloudfront.net/7782e205e72f43aeb4a48ec97f66ebbe/index.m3u8', logo: '' },
    { name: 'Reuters', category: '国际', url: 'https://dbrb49pjoymg4.cloudfront.net/manifest/3fec3e5cac39a52b2132f9c66c83dae043dc17d4/prod_default_xumo-ams-aws/e7493ea5-5c1c-4d7a-a3f7-e95516048ad8/3.m3u8', logo: '' },
    { name: 'France 24 Français', category: '国际', url: 'https://live.france24.com/hls/live/2037179-b/F24_FR_HI_HLS/master_5000.m3u8', logo: '' },
    { name: 'France 24 English', category: '国际', url: 'https://live.france24.com/hls/live/2037218-b/F24_EN_HI_HLS/master_5000.m3u8', logo: '' },
    { name: 'World Poker Tour', category: '国际', url: 'https://amg00477-samsungelectron-worldpokertour-samsunguk-81igb.amagi.tv/playlist/amg00477-samsungelectron-worldpokertour-samsunguk/playlist.m3u8', logo: '' },
    { name: 'Red Bull TV', category: '国际', url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8', logo: '' },
    { name: 'NHL FAST', category: '国际', url: 'https://nhl-firetv.amagi.tv/playlist1080p.m3u8', logo: '' },
    { name: 'UFC 24/7', category: '国际', url: 'https://dbrb49pjoymg4.cloudfront.net/manifest/3fec3e5cac39a52b2132f9c66c83dae043dc17d4/prod_default_xumo-ams-aws/194a140c-0cf5-443e-b747-08bf621d75a8/0.m3u8', logo: '' },
    { name: 'China Travel', category: '国际', url: 'https://fastlive.cctvplus.com/out/v1/ca6f9297b7314a63959435028af287fc/index.m3u8', logo: '' }
  ];

  for (const item of fixedSources) {
    channels.push({
      name: item.name,
      url: item.url,
      category: item.category,
      channel_id: `intl-${item.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      tvg_logo: item.logo,
      origin: 'extractor',
      status: 'active'
    });
  }

  return channels;
}

export default {
  extractAsianLive
};
