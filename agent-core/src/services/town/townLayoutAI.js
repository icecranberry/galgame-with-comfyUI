/**
 * 小镇布局 AI 润色（可选）
 *
 * 不把 2500 格交给 LLM 重排：程序化布局仍是唯一权威，
 * LLM 只返回地点命名/氛围微调和少量装饰地皮建议，全部经过本地约束校验。
 */

import { chatSync } from '../../llm/llm-client.js';

function clampInt(value, min, max) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}

function extractFirstJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

export async function refineTownDraftWithLLM({
  draft,
  readyAssets,
  blueprint = {},
  cols,
  rows,
}) {
  if (!draft || !Array.isArray(draft.locations)) return null;
  const width = Math.max(12, parseInt(cols, 10) || 50);
  const height = Math.max(12, parseInt(rows, 10) || 50);
  const groundAssets = readyAssets.filter(a => a.kind === 'ground');
  const flavoredLocations = draft.locations
    .filter(loc => loc.objectAssetKey || loc.key === 'central_plaza')
    .map(loc => ({ key: loc.key, name: loc.name, assetKey: loc.objectAssetKey || null }));

  const formatPrompt = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{
  "locationFlavors": [
    {
      "key": "从下方地点 key 原样选择",
      "name": "中文名字，4-14字，必须属于该素材/地点的气质",
      "aliases": ["中文别名，1-3个，每个2-8字"],
      "ambient": "一句话氛围描写，最多40字"
    }
  ],
  "plaza": {
    "name": "广场名字，4-14字",
    "aliases": ["中文别名，1-3个"],
    "ambient": "一句话氛围描写，最多40字"
  },
  "groundPatches": [
    {
      "assetKey": "从可用地皮 key 原样选择",
      "x": 1,
      "y": 1,
      "radius": 3
    }
  ]
}

规则：
- locationFlavors 可以只改部分地点，但不能新增 key；每个 key 只能出现一次。
- plaza 可选；若不改，请输出 null。
- groundPatches 最多 4 块；x/y 必须在 2 到地图边长-3 之间，radius 只能是 2、3、4。
- 只允许使用下方提供的地皮 key，不要发明素材。
- 不得输出任何关于移动建筑、改道路或重排对象的指令，这些由本地程序负责。
- 严格输出一个 JSON 对象，禁止 Markdown 代码块和解释。`;

  const userPrompt = JSON.stringify({
    map: { cols: width, rows: height, name: draft.name || '新小镇' },
    styleTags: blueprint.styleTags || '',
    locations: flavoredLocations,
    groundKeys: groundAssets.map(a => a.key),
  });

  const raw = await chatSync(
    [
      { role: 'system', content: formatPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      temperature: 0.75,
      max_tokens: 1600,
      response_format: { type: 'json_object' },
      label: '小镇 AI 布局优化',
      timeout: 30000,
      retries: 1,
      maxRetries: 0,
    },
  );
  const json = extractFirstJson(raw);
  if (!json) throw new Error('LLM 未返回 JSON');
  const parsed = JSON.parse(json);

  const locationByKey = new Map(draft.locations.map(loc => [loc.key, loc]));
  let appliedFlavors = 0;
  for (const item of Array.isArray(parsed.locationFlavors) ? parsed.locationFlavors : []) {
    const target = locationByKey.get(String(item?.key || ''));
    if (!target || typeof item.name !== 'string' || !item.name.trim()) continue;
    target.name = item.name.trim().slice(0, 30);
    if (Array.isArray(item.aliases)) {
      target.aliases = item.aliases
        .filter(a => typeof a === 'string' && a.trim())
        .map(a => a.trim().slice(0, 12))
        .slice(0, 4);
    }
    if (typeof item.ambient === 'string') target.ambient = item.ambient.trim().slice(0, 60);
    appliedFlavors++;
  }

  const plaza = locationByKey.get('central_plaza');
  if (plaza && parsed.plaza && typeof parsed.plaza === 'object') {
    if (typeof parsed.plaza.name === 'string' && parsed.plaza.name.trim()) {
      plaza.name = parsed.plaza.name.trim().slice(0, 30);
    }
    if (Array.isArray(parsed.plaza.aliases)) {
      plaza.aliases = parsed.plaza.aliases
        .filter(a => typeof a === 'string' && a.trim())
        .map(a => a.trim().slice(0, 12))
        .slice(0, 4);
    }
    if (typeof parsed.plaza.ambient === 'string') plaza.ambient = parsed.plaza.ambient.trim().slice(0, 60);
  }

  const groundByKey = new Map(groundAssets.map(a => [a.key, a]));
  const patches = (Array.isArray(parsed.groundPatches) ? parsed.groundPatches : []).slice(0, 4);
  let appliedPatches = 0;
  for (const patch of patches) {
    const asset = groundByKey.get(String(patch?.assetKey || ''));
    if (!asset) continue;
    const x = clampInt(patch.x, 2, width - 3);
    const y = clampInt(patch.y, 2, height - 3);
    const radius = clampInt(patch.radius, 2, 4);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius * 0.78) {
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && px < width && py >= 0 && py < height) draft.layers.ground[py][px] = asset.id;
        }
      }
    }
    appliedPatches++;
  }

  return {
    ok: true,
    applied: { locationFlavors: appliedFlavors, groundPatches: appliedPatches },
  };
}
