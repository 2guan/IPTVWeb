import db, { run, query, queryOne } from './db.js';
import { DEFAULT_LLM_OPTIMIZE_PROMPT } from './defaults.js';
import { ensureChannelId } from './channelIdentity.js';
import { isMiguSource } from './tester.js';

// Global active optimization status
export const optimizerStatus = {
  running: false,
  total: 0,
  completed: 0,
  saved: 0,
  message: ''
};

// Helper to clean LLM markdown wrappers and reasoning tokens
function cleanJsonResponse(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text.trim();
  // Strip <think>...</think> reasoning blocks (complete or unclosed)
  cleaned = cleaned.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim();
  } else if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}

/**
 * Robustly parses LLM response into an array of objects.
 * Handles standard JSON arrays, NDJSON (newline-delimited JSON objects),
 * missing array brackets [ ], missing commas between objects, trailing commas,
 * objects wrapped in root keys (e.g. { channels: [...] }), and regex extraction.
 */
export function parseLlmJsonResponse(text) {
  if (!text || typeof text !== 'string') return [];
  const cleaned = cleanJsonResponse(text);
  if (!cleaned) return [];

  // 1. Direct JSON.parse
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val)) return val;
      }
      if (parsed.id != null) return [parsed];
    }
  } catch {}

  // 2. Try auto-fixing missing outer brackets or missing commas between objects
  try {
    let candidate = cleaned;
    const firstBrace = candidate.search(/[\{\[]/);
    const lastBrace = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      candidate = candidate.substring(firstBrace, lastBrace + 1);
    }

    if (!candidate.startsWith('[')) {
      // It's a sequence of objects without outer [ ] -> wrap in [ ] and add commas
      const withCommas = candidate.replace(/}\s*,?\s*\{/g, '},{');
      const parsed = JSON.parse(`[${withCommas}]`);
      if (Array.isArray(parsed)) return parsed;
    } else {
      // It starts with [ but might have missing commas or trailing comma
      const fixed = candidate
        .replace(/}\s*,?\s*\{/g, '},{')
        .replace(/,\s*\]$/, ']');
      const parsed = JSON.parse(fixed);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  // 3. Line-by-line parsing (NDJSON)
  const lineResults = [];
  const lines = cleaned.split('\n');
  for (const line of lines) {
    const trimmed = line.trim().replace(/^,|,$/g, '');
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === 'object' && obj.id != null) {
          lineResults.push(obj);
        }
      } catch {}
    }
  }
  if (lineResults.length > 0) return lineResults;

  // 4. Regex extraction for individual JSON objects
  const regexResults = [];
  const objectRegex = /\{[^{}]*\"id\"[^{}]*\}/g;
  let match;
  while ((match = objectRegex.exec(cleaned)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && typeof obj === 'object' && obj.id != null) {
        regexResults.push(obj);
      }
    } catch {}
  }
  if (regexResults.length > 0) return regexResults;

  throw new Error('解析大模型返回的 JSON 数据失败，请重试');
}

function deleteOptimizedSourcesByOriginalIds(sourceIds) {
  const ids = [...new Set(sourceIds.map(normalizeSourceId).filter(Boolean))];
  if (ids.length === 0) return;

  const batchSize = 500;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const placeholders = batch.map(() => '?').join(',');
    run(`DELETE FROM optimized_sources WHERE original_source_id IN (${placeholders})`, ...batch);
  }
}

function normalizeSourceId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function saveOptimizedResults(items, replaceSourceIds = []) {
  if (!Array.isArray(items)) return 0;

  let saved = 0;
  const normalizedReplaceIds = [...new Set(replaceSourceIds.map(normalizeSourceId).filter(Boolean))];
  const allowedSourceIds = normalizedReplaceIds.length > 0
    ? new Set(normalizedReplaceIds.map(String))
    : null;
  const rowsBySourceId = new Map();
  const deletedSourceIds = new Set();
  const previousChannelIds = new Map();

  if (normalizedReplaceIds.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < normalizedReplaceIds.length; i += batchSize) {
      const batch = normalizedReplaceIds.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const previousRows = query(`
        SELECT original_source_id, channel_id
        FROM optimized_sources
        WHERE original_source_id IN (${placeholders})
          AND channel_id IS NOT NULL
          AND TRIM(channel_id) != ''
      `, ...batch);
      for (const row of previousRows) {
        if (!previousChannelIds.has(row.original_source_id)) {
          previousChannelIds.set(row.original_source_id, row.channel_id);
        }
      }
    }
  }

  for (const item of items) {
    const sourceId = normalizeSourceId(item?.id);
    if (!sourceId) continue;
    const sourceKey = String(sourceId);
    if (allowedSourceIds && !allowedSourceIds.has(sourceKey)) continue;

    if (item.category === 'delete') {
      deletedSourceIds.add(sourceKey);
      rowsBySourceId.delete(sourceKey);
      continue;
    }

    rowsBySourceId.set(sourceKey, {
      id: sourceId,
      name: item.name,
      category: item.category
    });
  }

  // Missing model rows are treated as "keep original" rather than "delete".
  // Migu and other provider bundles often contain many duplicate-looking
  // channel names; LLMs may omit repeats even when the prompt asks for every id.
  for (const sourceId of normalizedReplaceIds) {
    const sourceKey = String(sourceId);
    if (rowsBySourceId.has(sourceKey) || deletedSourceIds.has(sourceKey)) continue;
    const orig = queryOne("SELECT id, name, category FROM sources WHERE id = ?", sourceId);
    if (!orig) continue;
    rowsBySourceId.set(sourceKey, {
      id: orig.id,
      name: orig.name,
      category: orig.category
    });
  }

  db.exec('BEGIN TRANSACTION');
  try {
    deleteOptimizedSourcesByOriginalIds(normalizedReplaceIds);

    for (const item of rowsBySourceId.values()) {
      // Fetch original attributes
      const orig = queryOne("SELECT * FROM sources WHERE id = ?", item.id);
      if (!orig) continue;

      const isMigu = isMiguSource(orig);
      run(`
        INSERT INTO optimized_sources (
          original_source_id, name, category, url, origin, subscription_id, 
          channel_id, tvg_logo, request_headers, catchup, ipv_type, region, isp, status, delay, speed, resolution, codec
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        orig.id, item.name, item.category, orig.url, orig.origin, orig.subscription_id,
        previousChannelIds.get(orig.id) || ensureChannelId(orig),
        orig.tvg_logo, orig.request_headers, orig.catchup, orig.ipv_type,
        orig.region || (isMigu ? '全国' : ''),
        orig.isp || (isMigu ? '中国移动' : ''),
        isMigu ? 'active' : orig.status,
        isMigu && (Number(orig.delay) <= 0) ? 50 : orig.delay,
        isMigu && (Number(orig.speed) <= 0) ? 5.0 : orig.speed,
        orig.resolution || (isMigu ? '1920x1080' : null),
        orig.codec || (isMigu ? 'h264' : null)
      );
      saved++;
    }

    db.exec('COMMIT');
    return saved;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Run LLM Live Source Optimization in the background
 */
export async function runLlmOptimization(options = {}) {
  if (optimizerStatus.running) {
    throw new Error('LLM optimization task is already running');
  }

  const { incremental = false } = options;

  optimizerStatus.running = true;
  optimizerStatus.total = 0;
  optimizerStatus.completed = 0;
  optimizerStatus.saved = 0;
  optimizerStatus.message = '正在加载直播源数据...';

  try {
    // 1. Get LLM Settings
    const apiKey = queryOne("SELECT value FROM settings WHERE key = 'llmApiKey'")?.value || '';
    const baseUrl = queryOne("SELECT value FROM settings WHERE key = 'llmBaseUrl'")?.value || '';
    const modelName = queryOne("SELECT value FROM settings WHERE key = 'llmModelName'")?.value || '';

    if (!apiKey || !baseUrl || !modelName) {
      throw new Error('大模型配置不完整，请先在系统设置中保存配置');
    }

    // 2. Fetch valid sources. Incremental mode skips sources already present in optimized results.
    const miguWhereClause = `
      (s.status = 'active'
       OR s.origin = 'migu'
       OR s.url LIKE '%miguvideo.com%'
       OR s.url LIKE '%cmvideo.cn%'
       OR LOWER(COALESCE(sub.name, '')) LIKE '%migu%'
       OR COALESCE(sub.name, '') LIKE '%咪咕%')
    `;

    const activeSources = incremental
      ? query(`
          SELECT s.id, s.name, s.category
          FROM sources s
          LEFT JOIN subscriptions sub ON s.subscription_id = sub.id
          WHERE ${miguWhereClause}
            AND NOT EXISTS (
              SELECT 1 FROM optimized_sources os WHERE os.original_source_id = s.id
            )
        `)
      : query(`
          SELECT s.id, s.name, s.category
          FROM sources s
          LEFT JOIN subscriptions sub ON s.subscription_id = sub.id
          WHERE ${miguWhereClause}
        `);
    if (activeSources.length === 0) {
      throw new Error(incremental
        ? '数据库中没有可增量优化的有效原始直播源'
        : '数据库中没有可优化的有效直播源（有效源的检测状态应为 active/有效）'
      );
    }

    optimizerStatus.total = activeSources.length;
    optimizerStatus.message = `共发现 ${activeSources.length} 个${incremental ? '待增量优化的' : ''}有效直播源，开始分批上传大模型优化...`;

    // 3. Process in chunks to prevent LLM timeout or context limit
    const chunkSize = parseInt(queryOne("SELECT value FROM settings WHERE key = 'llmChunkSize'")?.value || '80');
    let savedTotal = 0;

    const systemPrompt = queryOne("SELECT value FROM settings WHERE key = 'llmOptimizePrompt'")?.value || DEFAULT_LLM_OPTIMIZE_PROMPT;
    const enableThinking = ['1', 'true'].includes(
      String(queryOne("SELECT value FROM settings WHERE key = 'llmEnableThinking'")?.value || '0').toLowerCase()
    );

    for (let i = 0; i < activeSources.length; i += chunkSize) {
      if (!optimizerStatus.running) {
        break;
      }
      const chunk = activeSources.slice(i, i + chunkSize);
      optimizerStatus.message = `正在优化第 ${i + 1} 到 ${Math.min(i + chunkSize, activeSources.length)} 个直播源...`;

      try {
        const isMimo = /mimo|xiaomi/i.test(modelName) || /mimo|xiaomi/i.test(baseUrl);
        const requestBody = {
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(chunk) }
          ],
          temperature: 0.1
        };

        if (isMimo) {
          requestBody.thinking = {
            type: enableThinking ? 'enabled' : 'disabled'
          };
        } else if (enableThinking) {
          requestBody.thinking = {
            type: 'enabled'
          };
        }

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API HTTP Error: ${response.status} - ${errText}`);
        }

        const resData = await response.json();
        const responseText = resData.choices?.[0]?.message?.content || '';
        let parsedResults = [];
        try {
          parsedResults = parseLlmJsonResponse(responseText);
        } catch (parseErr) {
          console.error('LLM response JSON parse failed:', responseText);
          throw new Error('解析大模型返回的 JSON 数据失败，请重试');
        }

        if (Array.isArray(parsedResults) && parsedResults.length > 0) {
          const saved = saveOptimizedResults(parsedResults, chunk.map(source => source.id));
          savedTotal += saved;
          optimizerStatus.saved = savedTotal;
        } else {
          const fallbackSaved = saveOptimizedResults([], chunk.map(source => source.id));
          savedTotal += fallbackSaved;
          optimizerStatus.saved = savedTotal;
        }

      } catch (chunkErr) {
        console.error(`LLM chunk optimization error (offset: ${i}):`, chunkErr);
        // Fallback: save chunk preserving original names and categories so channels are never dropped
        try {
          const fallbackSaved = saveOptimizedResults([], chunk.map(source => source.id));
          savedTotal += fallbackSaved;
          optimizerStatus.saved = savedTotal;
        } catch (saveErr) {
          console.error('Fallback save error:', saveErr);
        }
        optimizerStatus.completed += chunk.length;
        optimizerStatus.message = `大模型调用失败，已按原始信息保留入库: ${chunkErr.message}`;
      }
    }

    const isCancelled = !optimizerStatus.running;

    // 4. Results have already been saved after every successful model response.
    if (isCancelled) {
      optimizerStatus.message = `大模型优化任务已终止。已保存当前已处理的 ${savedTotal} 个规范源。`;
    } else {
      optimizerStatus.message = `大模型优化任务圆满完成！共处理 ${activeSources.length} 个源，成功保存 ${savedTotal} 个规范源。`;
    }

  } catch (error) {
    console.error('LLM optimization failed:', error);
    optimizerStatus.message = `优化任务失败: ${error.message}`;
  } finally {
    optimizerStatus.running = false;
  }
}
