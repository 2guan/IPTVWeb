import { queryOne } from '../db.js';

/**
 * 凤凰秀 / 凤凰卫视 官方直播抓取器
 * 涵盖 凤凰资讯、凤凰中文、凤凰香港 3 路官方直播源
 */
export async function extractFengshows(customToken = null) {
  let token = customToken;
  if (token === null) {
    try {
      const row = queryOne("SELECT value FROM settings WHERE key = 'fengshowsToken'");
      token = row?.value || '';
    } catch {
      token = '';
    }
  }

  const API = 'https://api.fengshows.cn/';
  const CLIENT = 'app(fs-web,1000000);';

  const CHANNELS = [
    { key: 'info', id: '7c96b084-60e1-40a9-89c5-682b994fb680', name: '凤凰资讯', logo: 'https://q1.fengshows.com/a/2021_22/79dcc3a9da358a3.png' },
    { key: 'chinese', id: 'f7f48462-9b13-485b-8101-7b54716411ec', name: '凤凰中文', logo: 'https://q1.fengshows.com/a/2021_22/ede3d9e09be28e5.png' },
    { key: 'hongkong', id: '15e02d92-1698-416c-af2f-3e9a872b4d78', name: '凤凰香港', logo: 'https://q1.fengshows.com/a/2021_23/325d941090bee17.png' },
  ];

  async function api(path, params) {
    const url = new URL(path, API);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const headers = { Accept: 'application/json', 'fengshows-client': CLIENT };
    if (token) {
      const cleanToken = token.trim();
      headers['fengshows-token'] = cleanToken;
      headers['authorization'] = cleanToken.toLowerCase().startsWith('bearer ') ? cleanToken : `Bearer ${cleanToken}`;
    }
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    return body?.status === undefined ? body : body.data;
  }

  const results = [];
  for (const ch of CHANNELS) {
    try {
      const ticket = await api('hub/live/auth-url', { live_qa: 'hd', live_id: ch.id });
      if (ticket?.live_url) {
        results.push({
          name: ch.name,
          url: ticket.live_url,
          category: '港澳台',
          channel_id: `fengshows-${ch.key}`,
          tvg_logo: ch.logo,
          origin: 'extractor',
          status: 'active'
        });
      }
    } catch (err) {
      console.warn(`[Extractor:Fengshows] ${ch.name} failed:`, err.message);
    }
  }

  return results;
}

/**
 * 校验凤凰秀 Token 凭据有效性
 */
export async function verifyFengshowsToken(token) {
  if (!token || typeof token !== 'string' || !token.trim()) {
    throw new Error('Token 不能为空');
  }
  const testResults = await extractFengshows(token.trim());
  if (!testResults || testResults.length === 0) {
    throw new Error('未能通过该 Token 获取到凤凰秀官方直播流，请检查 Token 是否有效或已失效');
  }
  const sampleUrl = testResults[0].url;
  const isHd = sampleUrl.includes('pin72') || sampleUrl.includes('pin108') || !sampleUrl.includes('pin48');

  return {
    success: true,
    quality: isHd ? '720p/高清' : '480p/标清 (游客或基础权限)',
    isHd,
    message: isHd
      ? '校验成功！已识别到有效用户登录态，已成功签发 720p 官方高清直播流！'
      : '校验通过！已成功连接凤凰秀官方直播接口并获取有效播放地址。',
    sampleUrl: sampleUrl.slice(0, 80) + '...'
  };
}

export default {
  extractFengshows,
  verifyFengshowsToken
};
