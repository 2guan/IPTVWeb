import db, { run, query, queryOne } from './db.js';

// Global active optimization status
export const optimizerStatus = {
  running: false,
  total: 0,
  completed: 0,
  saved: 0,
  message: ''
};

// Helper to clean LLM markdown wrappers
function cleanJsonResponse(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}

function saveOptimizedResults(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  let saved = 0;
  db.exec('BEGIN TRANSACTION');
  try {
    for (const item of items) {
      if (!item.id || item.category === 'delete') continue;

      // Fetch original attributes
      const orig = queryOne("SELECT * FROM sources WHERE id = ?", item.id);
      if (!orig) continue;

      run("DELETE FROM optimized_sources WHERE original_source_id = ?", orig.id);
      run(`
        INSERT INTO optimized_sources (
          original_source_id, name, category, url, origin, subscription_id, 
          tvg_logo, ipv_type, region, isp, status, delay, speed, resolution, codec
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        orig.id, item.name, item.category, orig.url, orig.origin, orig.subscription_id,
        orig.tvg_logo, orig.ipv_type, orig.region, orig.isp, orig.status, orig.delay,
        orig.speed, orig.resolution, orig.codec
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

  const { clearBeforeRun = true, incremental = false } = options;

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
    const activeSources = incremental
      ? query(`
          SELECT s.id, s.name, s.category
          FROM sources s
          WHERE s.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM optimized_sources os WHERE os.original_source_id = s.id
            )
        `)
      : query("SELECT id, name, category FROM sources WHERE status = 'active'");
    if (activeSources.length === 0) {
      throw new Error(incremental
        ? '数据库中没有可增量优化的有效原始直播源'
        : '数据库中没有可优化的有效直播源（有效源的检测状态应为 active/有效）'
      );
    }

    optimizerStatus.total = activeSources.length;
    optimizerStatus.message = `共发现 ${activeSources.length} 个${incremental ? '待增量优化的' : ''}有效直播源，开始分批上传大模型优化...`;

    // 3. Clear existing optimized sources to overwrite
    if (clearBeforeRun) {
      run("DELETE FROM optimized_sources");
    }

    // 4. Process in chunks to prevent LLM timeout or context limit
    const chunkSize = parseInt(queryOne("SELECT value FROM settings WHERE key = 'llmChunkSize'")?.value || '80');
    let savedTotal = 0;

    const systemPrompt = `你是一个专业的 IPTV 直播源整理与归一化助手。
任务规则：
1. 优化和规范频道名称 (name)：
   - 合并同类频道，统一命名（例如将 'CCTV1-综合', 'CCTV1', 'CCTV-1综合', 'CCTV-1 综合' 统一规范为 'CCTV-1'）。
   - 去除不必要的修饰词（例如将 '湖南卫视高清', '湖南卫视[蓝光]', '湖南卫视[4K]' 统一规范为 '湖南卫视'）。
   - 保持常用的卫视、央视、地方台等主流频道的规范格式。
2. 合并和规范频道分组 (category)：
   - 统一同类的分组标签，让分组数量保持精简（例如将 '北京频道', '北京本地', '北京' 合并为 '北京'；将 'CCTV', '央视频道', '中央台' 合并为 '央视'；将 '地方卫视', '卫视频道', '各省卫视' 合并为 '卫视'；把各类体育赛事合并为 '体育'）。
   - Youtube 分组需要进一步检查频道属性：如果频道内容属于港澳台地区，请归入 '港澳台'；如果属于国际频道或海外内容，请归入 '国际'。
   - 省市类分组只能使用省级行政区，不要细化到城市或区县。北京单独归入 '北京'；其它省级行政区使用 '上海'、'天津'、'重庆'、'河北'、'山西'、'辽宁'、'吉林'、'黑龙江'、'江苏'、'浙江'、'安徽'、'福建'、'江西'、'山东'、'河南'、'湖北'、'湖南'、'广东'、'海南'、'四川'、'贵州'、'云南'、'陕西'、'甘肃'、'青海'、'内蒙古'、'广西'、'西藏'、'宁夏'、'新疆' 等省级名称。不要输出 '广州'、'深圳'、'杭州'、'成都'、'南京' 等城市级分组，应归并到对应省级分组。
   - 主要分类和优先顺序为：'央视'、'卫视'、'北京'、'港澳台'、'日本'、'韩国'、'国际'、其它省级行政区、'景区'、'直播'、'电影'、'广播'、'音乐'、'游戏'、'其它'、剩余无法归类的原始分组。能归入这些分类的频道，不要再创建新的近义分组。
3. 过滤并剔除无效的文本广播或非频道直播源：
   - 如果遇到广告、免责声明等根本不是电视台直播的频道名称（例如 '免费订阅：请勿贩卖', '看不了联系微信xxx', '公告：本站永久免费'），请将其分组设置为 "delete" 或者在返回的 JSON 中忽略该 id。
4. 返回格式：
   - 必须只返回一个紧凑且合法的 JSON 数组，其中每一项为：{"id": 原始ID, "name": "优化后的频道名称", "category": "优化后的分组名称"}。
   - 不要包含任何 markdown 包裹框（不要用 \`\`\`json 开头），不要包含任何额外的对话文字。`;

    for (let i = 0; i < activeSources.length; i += chunkSize) {
      if (!optimizerStatus.running) {
        break;
      }
      const chunk = activeSources.slice(i, i + chunkSize);
      optimizerStatus.message = `正在优化第 ${i + 1} 到 ${Math.min(i + chunkSize, activeSources.length)} 个直播源...`;

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: JSON.stringify(chunk) }
            ],
            temperature: 0.1
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API HTTP Error: ${response.status} - ${errText}`);
        }

        const resData = await response.json();
        const responseText = resData.choices?.[0]?.message?.content || '';
        const cleanedText = cleanJsonResponse(responseText);

        let parsedResults = [];
        try {
          parsedResults = JSON.parse(cleanedText);
        } catch (parseErr) {
          console.error('LLM response JSON parse failed:', responseText);
          throw new Error('解析大模型返回的 JSON 数据失败，请重试');
        }

        if (Array.isArray(parsedResults)) {
          const saved = saveOptimizedResults(parsedResults);
          savedTotal += saved;
          optimizerStatus.saved = savedTotal;
        }

        optimizerStatus.completed += chunk.length;
        optimizerStatus.message = `已优化 ${optimizerStatus.completed} / ${optimizerStatus.total} 个直播源，已写入 ${savedTotal} 个规范源。`;
      } catch (chunkErr) {
        console.error(`LLM chunk optimization error (offset: ${i}):`, chunkErr);
        optimizerStatus.message = `优化分块失败，正在继续后续处理: ${chunkErr.message}`;
        // Continue to avoid halting the whole run
      }
    }

    const isCancelled = !optimizerStatus.running;

    // 5. Results have already been saved after every successful model response.
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
