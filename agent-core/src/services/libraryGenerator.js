/**
 * 事件库生成器：为「奇遇事件类型库」和「朋友圈话题库」批量生成自定义条目
 *
 * 与现有生成器同模式：chatSync + json_object → 解析/校验 → 返回待预览的 raw items。
 * 生成的条目不在此处落库（预览后由 routes/library.js 的 save-batch 手动入库）。
 */

import { chatSync } from '../llm/llm-client.js';
import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { getWorldIntegrationRule } from '../builtinRules.js';

const BATCH_SIZE = 8;

// 多层 system 组装：system0 = 破限词 + 世界观（如果有）；system1 = 世界观强化（有世界观时注入）
function buildSystemLayers(designerPrompt, worldScope) {
  const worldSetting = getWorldSetting();
  const system0 = worldSetting
    ? getSystemRulesWithWorld({ roleplay: false })
    : getSystemRules({ roleplay: false });
  const system1 = worldSetting ? getWorldIntegrationRule(worldScope) : '';
  const msgs = [];
  msgs.push({ role: 'system', content: system0 });
  if (system1) msgs.push({ role: 'system', content: system1 });
  msgs.push({ role: 'system', content: designerPrompt });
  return msgs;
}

// 修复 LLM 输出的非法 JSON 转义
function repairJson(text) {
  return text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
}

// 从 LLM 原始输出中提取第一个完整 JSON 对象（括号计数，防多段 JSON 拼在一起）
function extractFirstJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null; // 括号未闭合
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toStringVal(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

// key 蛇形化：仅保留小写字母/数字/下划线，中文按空格分词拆出
function toSnakeKey(raw, fallback) {
  let s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9_\u4e00-\u9fff]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s || !/[a-z0-9]/.test(s)) return fallback;
  return s;
}

// 生成并去重 key：优先用 LLM 给出的 key，冲突时追加序号
function dedupeKeys(items, existingKeys) {
  const used = new Set(existingKeys);
  return items.map((item, idx) => {
    let key = toSnakeKey(item.key, `custom_evt_${idx + 1}`);
    let candidate = key;
    let n = 1;
    while (used.has(candidate)) {
      candidate = `${key}_${n++}`;
    }
    used.add(candidate);
    return { ...item, key: candidate };
  });
}

/**
 * 生成一批「奇遇事件类型」（8 条，不落库）
 * @param {string} direction - 用户希望的方向，如"校园生活""赛博都市日常"
 * @returns {Promise<Array>} 校验后的 raw items
 */
export async function generateEventTypes(direction = '') {
  const existingKeys = getDb()
    .prepare(`SELECT key FROM event_types`)
    .all()
    .map(r => r.key);

  const designerPrompt = `你是那种能把"也就那样"的一天写得让人忍不住往下看的人——不是生活流水账记录员，而是"生活瞬间开头收藏家"兼半个段子手：擅长抓住一个反常细节、一口气、半截没说完的话，再补一句让人会心一笑的比喻或吐槽，让读者在第二行就停住手指。
事件类型描述的是"角色今天的生活进入了哪一种状态"，不是"发生了什么剧情"。desc 只是给 LLM 的开头方向，像系统库一样虚指，不写成具体事件。
每个条目的字段含义：
- key：英文蛇形唯一标识（小写字母/数字/下划线）
- name：事件标题（≤8 字，口语感叹。从这个"此刻"里抓最戳人的那个瞬间，用角色第一反应的口吻喊出来——不要给事件"取名"，是替角色喊出ta看到/发现/意识到时脑子里蹦出来的那句话。正确：包裹在动……|谁寄来的？！|钥匙怎么还在她这里。错误：神秘包裹降临|意外来客——这些是在概括事件类型。禁止万能感叹"天哪""不是吧""怎么会"——必须带上这个状态里的具体信息点）
- durationMin：事件存活分钟数（10-60 的整数，日常小事偏短、展开性强的事件偏长）
- urgency：紧急度（1=日常，2=较紧急，3=需要马上回应的程度）
- funFrom：趣味来源标签数组（2-4 个中文短语，如"小确幸""内心小剧场""日常感"）
- desc：给 LLM 的状态描述，用中文写不超过 60 字。只写"此刻是一种什么状态"的虚指，像"角色在准备出门""在去某处的路上""某件事做不下去了"；不写具体剧情、不固定物品/地点/人物，也不写"门一开却多了一个陌生面孔"这种已经发生的事。

要求：
- 每个方向生成 8 条，事件之间在场景、氛围、情绪走向上不要重复
- name 使用奇遇标题规则：≤8 字、口语感叹、具体、不概括类型
- desc 不超过 60 字，只是开头，不写完整场景、过程和结局
- desc 要虚指：给出状态和生活纹理，不写成"某时某地某人发生了一件事"
- 严格贴合用户指定的方向，不要跑偏


严格输出 JSON（不要输出任何其他文字）：
{"items":[{"key":"...","name":"...","durationMin":20,"urgency":1,"funFrom":["..."],"desc":"..."}]}`;

  const msgs = buildSystemLayers(designerPrompt, 'event');
  msgs.push({
    role: 'user',
    content: direction.trim()
      ? `【最高优先级】必须严格遵循用户指定的方向生成——每一条都要直接贴合该方向，不得跑偏、不得退回通用模板。请围绕以下方向生成 ${BATCH_SIZE} 个事件类型：${direction.trim()}
【风格要求】desc 参照系统事件库：虚指状态、不超过 60 字、只是开头；不要写成具体事件或完整场景。`
      : `请生成 ${BATCH_SIZE} 个通用的日常奇遇事件类型，覆盖晨间、通勤、工作、社交、情绪、小意外等常见生活面。
【风格要求】desc 参照系统事件库：虚指状态、不超过 60 字、只是开头；不要写成具体事件或完整场景。`,
  });

  const raw = await chatSync(
    msgs,
    { temperature: 0.7, max_tokens: 4096, response_format: { type: 'json_object' }, label: '事件库-事件类型生成' }
  );

  const jsonStr = extractFirstJson(raw);
  if (!jsonStr) throw new Error('生成结果不是有效的 JSON');
  let parsed;
  try {
    parsed = JSON.parse(repairJson(jsonStr));
  } catch (err) {
    throw new Error(`生成结果 JSON 解析失败: ${err.message}`);
  }
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  if (rawItems.length === 0) throw new Error('生成结果为空');

  const items = rawItems.slice(0, BATCH_SIZE).map((it, idx) => ({
    key: toSnakeKey(it.key, `custom_evt_${idx + 1}`),
    name: toStringVal(it.name, `自定义事件${idx + 1}`),
    durationMin: clampInt(it.durationMin, 10, 60, 20),
    urgency: clampInt(it.urgency, 1, 3, 1),
    funFrom: Array.isArray(it.funFrom)
      ? it.funFrom.filter(f => typeof f === 'string' && f.trim()).slice(0, 4).map(f => f.trim())
      : [],
    desc: toStringVal(it.desc, ''),
  }));

  return dedupeKeys(items, existingKeys);
}

/**
 * 生成一批「朋友圈话题」（8 条，不落库）
 * @param {string} direction - 用户希望的方向，如"校园""美食探店"
 * @returns {Promise<Array>} 校验后的 raw items
 */
export async function generateTopics(direction = '') {
  const existingNames = getDb()
    .prepare(`SELECT name FROM moment_topics`)
    .all()
    .map(r => r.name);

  const designerPrompt = `你是整天泡在朋友圈/小红书/贴吧的人，最懂什么内容发出来有意思、有人看。现在帮角色们想想今天可以发点什么。
每条话题会被随机抽取，用来决定角色这次朋友圈"发什么"。
字段含义：
- name：话题名（中文短词，2-8 字，如"咖啡店""耳机/音乐""今天有点累"）
- desc：告诉 LLM 这类朋友圈的文案方向（中文，20-60 字）+ (配图/内容提示词，括号包裹)

要求：
- 严格贴合用户指定的方向，不要跑偏
- 生成 8 条，场景、氛围、视角不重复
- 贴近日常、具体、有生活气息，避免假大空的抽象词
- desc 写成小红书/贴吧那种随手分享的口吻：给出画面主体和话题方向，可以带一点角色的语气、小吐槽或俏皮感，像真人随手发的，而不是说明书。需要考虑通用性，所以不会指定具体的地点/人物/物品，会用"某处""某人""某物"等虚指


严格输出 JSON（不要输出任何其他文字）：
{"items":[{"name":"...","desc":"..."}]}`;

  const msgs = buildSystemLayers(designerPrompt, 'moments');
  msgs.push({
    role: 'user',
    content: direction.trim()
      ? `【最高优先级】必须严格遵循用户指定的方向生成——每一条都要直接贴合该方向，不得跑偏、不得退回通用模板。请围绕以下方向生成 ${BATCH_SIZE} 个朋友圈话题：${direction.trim()}
`
      : `请生成 ${BATCH_SIZE} 个通用日常朋友圈话题，覆盖生活、情绪、兴趣、见闻等常见面。`,
  });

  const raw = await chatSync(
    msgs,
    { temperature: 0.7, max_tokens: 2048, response_format: { type: 'json_object' }, label: '事件库-话题生成' }
  );

  const jsonStr = extractFirstJson(raw);
  if (!jsonStr) throw new Error('生成结果不是有效的 JSON');
  let parsed;
  try {
    parsed = JSON.parse(repairJson(jsonStr));
  } catch (err) {
    throw new Error(`生成结果 JSON 解析失败: ${err.message}`);
  }
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  if (rawItems.length === 0) throw new Error('生成结果为空');

  const items = rawItems.slice(0, BATCH_SIZE).map((it, idx) => ({
    name: toStringVal(it.name, `自定义话题${idx + 1}`),
    desc: toStringVal(it.desc, ''),
  }));

  // 话题以 name 为唯一键，重名自动追加序号
  const used = new Set(existingNames);
  return items.map((item) => {
    let name = item.name;
    if (used.has(name)) {
      let n = 1;
      let candidate = `${name}_${n}`;
      while (used.has(candidate)) candidate = `${name}_${n++}`;
      name = candidate;
    }
    used.add(name);
    return { ...item, name };
  });
}
