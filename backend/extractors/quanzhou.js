/**
 * 泉州广播电视台 闽南语频道官方抓取器
 * 请求官网公开接口获取官方签名 HLS 直播地址
 */
export async function extractQuanzhou() {
  const PLAY_APIS = [
    'https://wxqz2.qztv.cn/index/medias/getLivepath',
    'https://www.qztv.cn/index/medias/getLivepath'
  ];
  const MEDIA_ID = 'wq95wqbDnMKyd8KiwqzChnt0w5nChcKofcKh';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    let playUrl = null;

    for (const api of PLAY_APIS) {
      try {
        const res = await fetch(api, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://wxqz2.qztv.cn/index/Medias/index/media_id/wq95wqbDnMKyd8KiwqzChnt0w5nChcKofcKh/stream_name/mny.html'
          },
          body: new URLSearchParams({ media_id: MEDIA_ID })
        });

        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.error_code === 0 && typeof data.data === 'string' && data.data.startsWith('http')) {
          playUrl = data.data;
          break;
        }
      } catch {
        // Try next fallback endpoint
      }
    }

    if (!playUrl) {
      throw new Error('官网接口未能返回有效播放地址');
    }

    return [{
      name: '泉州闽南语',
      url: playUrl,
      category: '福建',
      channel_id: 'qztv-mny',
      tvg_logo: 'https://www.qztv.cn/index/images/home/crad-02.jpg',
      origin: 'extractor',
      request_headers: JSON.stringify({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://wxqz2.qztv.cn/'
      }),
      status: 'active'
    }];
  } catch (err) {
    console.warn('[Extractor:Quanzhou] 获取失败:', err.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default extractQuanzhou;
