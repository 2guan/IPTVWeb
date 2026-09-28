/**
 * 频道名称长期屏蔽与动态分组通配规则引擎 (基于 akiralereal/iptv 实践)
 */

export function normalizeBlockRules(rules) {
  if (!rules) return [];
  const list = Array.isArray(rules) 
    ? rules 
    : String(rules).split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  const seen = new Set();
  const out = [];

  for (const item of list) {
    let mode = 'contains';
    let value = '';

    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('=')) {
        mode = 'exact';
        value = trimmed.slice(1).trim();
      } else {
        mode = 'contains';
        value = trimmed;
      }
    } else if (item && typeof item === 'object') {
      value = String(item.value || '').trim();
      mode = item.mode === 'exact' ? 'exact' : 'contains';
    }

    if (!value) continue; // 安全底线：空值规则绝不保留，避免误杀所有频道

    const key = `${mode}\n${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value, mode });
  }

  return out;
}

/**
 * 检查频道是否被名称屏蔽规则命中
 * @param {string|string[]} names 频道名称（可传原始名与归一名）
 * @param {Array|string} blockRules 屏蔽规则列表
 * @returns {{ value: string, mode: string } | null} 命中的规则，未命中返回 null
 */
export function matchBlockRule(names, blockRules) {
  const rules = normalizeBlockRules(blockRules);
  if (rules.length === 0) return null;

  const candidates = (Array.isArray(names) ? names : [names])
    .filter(n => typeof n === 'string' && n.trim())
    .map(n => n.trim().toLowerCase());

  if (candidates.length === 0) return null;

  for (const rule of rules) {
    const target = rule.value.toLowerCase();
    const hit = rule.mode === 'exact'
      ? candidates.some(name => name === target)
      : candidates.some(name => name.includes(target));
    if (hit) return rule;
  }

  return null;
}

/**
 * 检查分组是否被通配符规则隐藏 (如 体育-*)
 * @param {string} groupName 分组名称
 * @param {string|string[]} hiddenGroupRules 通配符规则，换行或数组隔开
 * @returns {boolean}
 */
export function matchGroupWildcard(groupName, hiddenGroupRules) {
  if (!groupName) return false;
  const rawRules = Array.isArray(hiddenGroupRules)
    ? hiddenGroupRules
    : String(hiddenGroupRules || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  if (rawRules.length === 0) return false;

  const target = String(groupName).trim().toLowerCase();

  for (const rule of rawRules) {
    const pattern = rule.trim().toLowerCase();
    if (!pattern) continue;

    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (prefix && target.startsWith(prefix)) {
        return true;
      }
    } else if (target === pattern) {
      return true;
    }
  }

  return false;
}

export default {
  normalizeBlockRules,
  matchBlockRule,
  matchGroupWildcard
};
