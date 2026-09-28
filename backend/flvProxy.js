import { once } from 'node:events';
import { queryOne } from './db.js';
import { buildStreamHeaders } from './playlist.js';

/**
 * 轻量级 HTTP-FLV 直通管道 (零转码、零 CPU 占用)
 * 纯 Node.js Stream 直推，支持 B站、斗鱼、虎牙等平台的 FLV 直播流
 */
export async function pipeFlvStream(targetUrl, req, res, customHeaders = {}) {
  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.once('close', onClose);

  let timer;
  const resetDeadline = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error('FLV 流连接超时')), 20000);
  };

  try {
    if (res.destroyed || req.aborted) {
      controller.abort();
    }

    let currentUrl = targetUrl;
    let response;

    // Follow up to 5 hops of redirects
    for (let hop = 0; hop < 6; hop++) {
      controller.signal.throwIfAborted();
      resetDeadline();

      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          ...customHeaders,
          'Accept-Encoding': 'identity',
          'Accept': '*/*'
        }
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        break;
      }

      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location || hop === 5) {
        throw new Error('直播源调度重定向次数过多');
      }
      currentUrl = new URL(location, currentUrl).href;
    }

    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      return res.status(response.status).send(`上游响应 HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const readChunk = async () => {
      resetDeadline();
      return reader.read();
    };

    // Read first chunk to verify FLV header
    let first = Buffer.alloc(0);
    while (first.length < 3) {
      const chunk = await readChunk();
      if (chunk.done) throw new Error('上游未返回有效直播流数据');
      first = Buffer.concat([first, Buffer.from(chunk.value)]);
    }

    if (first.subarray(0, 3).toString() !== 'FLV') {
      await response.body?.cancel().catch(() => {});
      return res.status(415).send('上游数据不是标准 FLV 直播流');
    }

    res.writeHead(200, {
      'Content-Type': 'video/x-flv',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff'
    });

    // Write first chunk with backpressure
    if (!res.write(first)) {
      await once(res, 'drain', { signal: controller.signal });
    }

    // Stream continuously with backpressure
    while (!controller.signal.aborted) {
      const { done, value } = await readChunk();
      if (done) break;

      const chunkBuf = Buffer.from(value);
      if (!res.write(chunkBuf)) {
        await once(res, 'drain', { signal: controller.signal });
      }
    }

    res.end();

  } catch (err) {
    if (!controller.signal.aborted) {
      console.warn('[FlvProxy] FLV Stream error:', err.message);
      if (!res.headersSent) {
        res.status(502).send(`FLV 转发失败: ${err.message}`);
      }
    }
  } finally {
    clearTimeout(timer);
    res.removeListener('close', onClose);
  }
}

/**
 * Route handler for GET /stream/flv/:sourceId
 */
export async function handleFlvProxyRoute(req, res) {
  const { sourceId } = req.params;
  const source = queryOne('SELECT * FROM sources WHERE id = ?', sourceId);
  if (!source) {
    return res.status(404).json({ error: '直播源不存在' });
  }

  const headers = buildStreamHeaders({}, source);
  await pipeFlvStream(source.url, req, res, headers);
}

export default {
  pipeFlvStream,
  handleFlvProxyRoute
};
