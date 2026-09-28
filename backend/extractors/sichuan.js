/**
 * 四川广播电视台 官方直播抓取器
 * 提取四川广电 9 个电视频道及当前公开活动直播
 */
import { queryOne } from '../db.js';

export async function extractSichuan() {
  const SICHUAN_PAGE = 'https://www.sctv.com/channelLive';
  const SICHUAN_AUTH_API = 'https://gw.scgchc.com/exp/v1/anti/user/getLiveSecret';
  const SICHUAN_LIVE_API = 'https://gw.scgchc.com/app/v1/lives/list';
  const SICHUAN_IMAGE_BASE = 'https://kscgc.scgchc.com/';

  const channels = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  // Read optional user configured access token
  let accessToken = '';
  try {
    const row = queryOne("SELECT value FROM settings WHERE key = 'sichuanToken'");
    if (row && row.value) {
      accessToken = row.value.trim().replace(/^bearer\s+/i, '');
    }
  } catch {}

  try {
    // 1. 获取官网电视频道目录
    const res = await fetch(SICHUAN_PAGE, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    if (res.ok) {
      const html = await res.text();
      const pattern = /\\"id\\":\\"([^\\]+)\\",\\"name\\":\\"([^\\]+)\\",\\"playAddress\\":\\"(https:[^\\]+\.m3u8[^\\]*)\\"/g;
      const matches = [...html.matchAll(pattern)];

      for (const m of matches) {
        const id = m[1];
        const name = m[2].trim();
        let rawUrl = m[3].replace(/\\\//g, '/');

        // 过滤购物台与纯音频广播
        if (name.includes('购物') || name.includes('广播') || name.includes('频率') || name.includes('之音') || name.includes('音乐')) {
          continue;
        }

        // 尝试提取台标
        let logo = '';
        const imgMatch = html.slice(m.index, m.index + 2000).match(/\\"squareImg\\":\\"([^\\]+)\\"/);
        if (imgMatch && imgMatch[1]) {
          const imgPath = imgMatch[1].replace(/\\\//g, '/');
          logo = imgPath.startsWith('http') ? imgPath : `${SICHUAN_IMAGE_BASE.replace(/\/$/, '')}/${imgPath.replace(/^\//, '')}`;
        }

        // 如果用户配置了官网 access_token，尝试进行官方动态签名
        let finalUrl = rawUrl;
        if (accessToken) {
          try {
            const urlObj = new URL(rawUrl);
            const authUrl = new URL(SICHUAN_AUTH_API);
            authUrl.searchParams.set('streamName', urlObj.pathname);
            authUrl.searchParams.set('host', urlObj.hostname);

            const signRes = await fetch(authUrl.toString(), {
              headers: {
                'authorization': `bearer ${accessToken}`,
                'Origin': 'https://www.sctv.com',
                'Referer': SICHUAN_PAGE,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
              }
            });
            if (signRes.ok) {
              const signData = await signRes.json();
              const authKey = String(signData?.data?.auth_key || signData?.data?.secret || '').replace(/^auth_key=/, '');
              if (authKey) {
                urlObj.searchParams.set('auth_key', authKey);
                finalUrl = urlObj.toString();
              }
            }
          } catch (signErr) {
            console.warn(`[Extractor:Sichuan] 签名失败 (${name}):`, signErr.message);
          }
        }

        channels.push({
          name,
          url: finalUrl,
          category: (name.includes('4K') || name.includes('超高清')) ? '4K' : '四川',
          channel_id: `sctv-${id}`,
          tvg_logo: logo,
          origin: 'extractor',
          request_headers: JSON.stringify({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': SICHUAN_PAGE,
            'Origin': 'https://www.sctv.com'
          }),
          status: 'active'
        });
      }
    }

    // 2. 获取公开活动直播
    try {
      const liveRes = await fetch(SICHUAN_LIVE_API, {
        signal: controller.signal,
        headers: {
          'Origin': 'https://www.sctv.com',
          'Referer': 'https://www.sctv.com/live/list',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        const items = Array.isArray(liveData?.data) ? liveData.data : [];
        for (const item of items) {
          if (Number(item.status) === 1 && item.title) {
            const stream = (Array.isArray(item.stream) ? item.stream : []).map(s => s?.address).find(Boolean);
            if (stream && stream.startsWith('http')) {
              channels.push({
                name: `四川活动 - ${item.title.trim()}`,
                url: stream,
                category: '四川',
                channel_id: `sctv-live-${item.id}`,
                tvg_logo: item.cover || '',
                origin: 'extractor',
                request_headers: JSON.stringify({
                  'Origin': 'https://www.sctv.com',
                  'Referer': 'https://www.sctv.com/live/list',
                  'User-Agent': 'Mozilla/5.0'
                }),
                status: 'active'
              });
            }
          }
        }
      }
    } catch (liveErr) {
      // ignore
    }

  } catch (err) {
    console.warn('[Extractor:Sichuan] 获取失败:', err.message);
  } finally {
    clearTimeout(timer);
  }

  return channels;
}

export default extractSichuan;
