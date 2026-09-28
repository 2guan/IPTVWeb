/**
 * 上海松江区融媒体中心「松江融媒慢直播」抓取器
 * 从官方融媒 API 动态获取最新的 HLS 慢直播流
 */
export async function extractSongjiang() {
  const SCENE_URL = 'https://media.sjmedia.net/json/live/1964/scene.json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(SCENE_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Referer': 'https://media.sjmedia.net/statics/xhmm-live-h5/index.html#/?liveId=1964&siteId=570a50fba2c146ca9efa552ed8300ec4'
      }
    });

    if (!res.ok) {
      throw new Error(`官方接口 HTTP ${res.status}`);
    }

    const json = await res.json();
    const items = Array.isArray(json?.data) ? json.data : [];
    const mainLive = items.find(item => item?.title === '松江慢直播' && item?.resource?.hlsUrl);

    if (!mainLive || !mainLive.resource?.hlsUrl) {
      throw new Error('未在官方接口返回中找到有效的松江慢直播流');
    }

    return [{
      name: '松江融媒慢直播',
      url: mainLive.resource.hlsUrl,
      category: '景区',
      channel_id: 'songjiang-slow-live',
      tvg_logo: mainLive.coverImg || 'https://media.sjmedia.net/live/default/image/2023/09/21/ddb41672d73d419880879e6d32f5cb1e.jpg',
      origin: 'extractor',
      status: 'active'
    }];
  } catch (err) {
    console.warn('[Extractor:Songjiang] 获取失败:', err.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default {
  extractSongjiang
};
