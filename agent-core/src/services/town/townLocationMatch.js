/**
 * 日程自由文本地点 → 地图 POI 匹配
 *
 * daily_schedules.location 是 LLM 生成的自由文本（"公寓书房""咖啡厅打工"），
 * 通过 town_locations.aliases_json 的别名数组做包含匹配，把角色"钉"到地图坐标。
 * 纯函数：buildLocationMatcher 预编译一次供 tick 复用。
 */

/**
 * 归一化地点文本：去空白（含全角空格）、转小写
 */
export function normalizeLocationText(text) {
  return String(text ?? '').replace(/[\s\u3000]+/g, '').toLowerCase();
}

/**
 * 预编译匹配器
 * @param {Array<{id:number, key:string, name:string, aliases:string[]}>} locations
 * @returns {(text: string) => object|null} 命中的 location；匹配不到返回 null
 *
 * 匹配优先级：
 *   1. key / name / 别名 与文本完全相等（含 key 自身，如 "cafe"）
 *   2. 文本包含别名（"咖啡厅打工" ⊃ "咖啡厅"），最长别名优先
 *   3. 别名包含文本（"家" ⊂ "家里"），文本长度 ≥2 才参与，避免单字误命中
 */
export function buildLocationMatcher(locations) {
  const entries = [];
  for (const loc of locations || []) {
    const aliases = [...new Set([loc.key, loc.name, ...(loc.aliases || [])]
      .map(normalizeLocationText)
      .filter(Boolean))];
    for (const alias of aliases) {
      entries.push({ alias, loc });
    }
  }
  // 最长优先：同等长度保持声明顺序（声明顺序即 POI 定义顺序）
  entries.sort((a, b) => b.alias.length - a.alias.length);

  return function match(text) {
    const norm = normalizeLocationText(text);
    if (!norm) return null;
    for (const { alias, loc } of entries) {
      if (norm === alias) return loc;
    }
    for (const { alias, loc } of entries) {
      if (norm.includes(alias)) return loc;
    }
    if (norm.length >= 2) {
      for (const { alias, loc } of entries) {
        if (alias.includes(norm)) return loc;
      }
    }
    return null;
  };
}
