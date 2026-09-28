/**
 * 澳门莲花卫视 官方直播抓取器
 * 从官网播放器动态提取最新的 HLS 签名入口
 */
export async function extractLotusTv() {
  const LIVE_PAGE = 'https://www.lotustv.mo/live';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(LIVE_PAGE, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.lotustv.mo/'
      }
    });

    if (!res.ok) {
      throw new Error(`官网 HTTP ${res.status}`);
    }

    const html = await res.text();
    const playerBlock = /new\s+QPlayer\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(html)?.[1];
    if (!playerBlock) {
      throw new Error('未在官网页面解析到 QPlayer 播放器配置');
    }

    // 过滤掉注释行 (//url: 等)
    const activeLines = playerBlock
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('//'));

    const match = activeLines
      .map(line => /^url:\s*["']([^"']+)["']\s*,?$/.exec(line)?.[1])
      .find(Boolean);

    if (!match) {
      throw new Error('未找到有效的直播流地址行');
    }

    const fullUrl = match.startsWith('//') ? `https:${match}` : match;

    return [{
      name: '澳门莲花卫视',
      url: fullUrl,
      category: '港澳台',
      channel_id: 'lotustv',
      tvg_logo: 'https://www.lotustv.mo/templates/default/images/logo.png',
      origin: 'extractor',
      request_headers: JSON.stringify({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.lotustv.mo/'
      }),
      status: 'active'
    }];
  } catch (err) {
    console.warn('[Extractor:LotusTV] 获取失败:', err.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default extractLotusTv;
