/**
 * 剧情大纲服务（「故事」页的「面」，2026-10-07）—— 构画「点线面」的第三块。
 *
 * ── 这是什么（与前两块的关系）────────────────────────────────
 * · 「线」`eventLineService.js`：一条线跨天演进（起线→…→收束）—— 已交付
 * · 「面」**本模块**：可推进的 **Beat 序列 + 游标** —— 让剧情有"长期打算"
 * · 「点」（构画的剧情事件池）：**不单独做** —— 用户已裁定由「面+线」承担（见方案 O2）
 *
 * ── 移植来源与取舍 ─────────────────────────────────────────
 * 移植自 `ST-SevenDaysCal`（构画）`business/outline/` 的**纯函数部分**：
 * `schema.js` 的解析/编辑、`prompts.js` 的注入文本与生成合同。
 * **不移植**：`repository.js`（ST 的档案存取）、`ui.js`、`chat.js`（局外聊天）。
 *
 * ★★ **不抄构画的游标存储方式** —— 它把大纲存在 `chat_metadata`，
 *   邻舍直接落 SQLite（有表，见迁移 `007_story_outlines`）。
 *
 * ── 一个刻意的设计：raw_text 与 beat_json 并存 ──────────────
 * 构画的 `editOutlineScene` / `deleteOutlineBeatFromRaw` **刻意不重新序列化**，
 * 而是直接改模型原文 —— 为的是**保留未知字段与原始包装**（模型将来多给字段不会被吃掉）。
 * 本模块沿用：`raw_text` 是编辑的操作对象，`beat_json` 是解析结果（供渲染与游标定位）。
 */

import { getDb } from '../../db/index.js';
// ⚠ 世界观走 `db/worldRepository.getWorldSetting()`（已按氛围节裁剪的版本），
//   不要直读 `system_settings` —— 那会绕开"隐藏世界观"与裁剪逻辑。
import { getWorldSetting } from '../../db/worldRepository.js';
import { chatSync } from '../../llm/llm-client.js';
import { extractFirstJson, repairJson } from '../eventGenerator.js';

// ═══════════════════════════════════════════════════════════
// 一、解析（移植构画 schema.js 的纯函数）
// ═══════════════════════════════════════════════════════════

/** 清掉行首装饰（`> # * -`、粗体星号）—— 模型爱加这些 */
function cleanOutlineLine(value) {
  let text = String(value || '').trim();
  if (/^[|｜].*[|｜]$/.test(text)) text = text.slice(1, -1).trim();
  return text.replace(/^[>#*\-\s]+/, '').replace(/\*+/g, '').trim();
}

/** Beat 的四个要素字段名（构画 `outlineAnchorKind`） */
const BEAT_SECTIONS = ['beat', 'scene', 'subtext', 'think'];

/**
 * 解析大纲原文 → Beat 数组（构画 `parseOutline` 同口径）。
 *
 * 格式：`Beat: 推演时间|标题|类型|所属线|结果`，随后可跟 Scene / Subtext / Think 三段。
 *
 * ⚠ 宽容解析：模型漏一段、多一层包装（`<outline_widget>`）都要能吃下 ——
 *   这是构画"宽容解析 / 严格校验"三段式的第一段。**校验交给前端"编辑后保存"与注入前检查**。
 */
export function parseOutline(raw) {
  const source = String(raw || '');
  const widget = /<outline_widget[^>]*>([\s\S]*?)<\/outline_widget>/i.exec(source);
  const content = widget ? widget[1] : source;
  const beats = [];
  let current = null;
  for (const rawLine of content.split('\n')) {
    const text = cleanOutlineLine(rawLine);
    if (!text) continue;
    if (/^Beat\s*[:：]/i.test(text)) {
      if (current) beats.push(current);
      const parts = text.replace(/^Beat\s*[:：]\s*/i, '').split(/[|｜]/);
      current = {
        time: (parts[0] || '').trim(),
        title: (parts[1] || '').trim(),
        type: (parts[2] || '').trim(),
        line: (parts[3] || '').trim(),
        outcome: parts.slice(4).join('｜').trim(),
        scene: '',
        subtext: '',
        think: '',
      };
    } else if (/^Scene\s*[:：]/i.test(text) && current) {
      current.scene = text.replace(/^Scene\s*[:：]\s*/i, '').trim();
    } else if (/^Subtext\s*[:：]/i.test(text) && current) {
      current.subtext = text.replace(/^Subtext\s*[:：]\s*/i, '').trim();
    } else if (/^Think\s*[:：]/i.test(text) && current) {
      current.think = text.replace(/^Think\s*[:：]\s*/i, '').trim();
    }
  }
  if (current) beats.push(current);
  return beats;
}

/** 「完整 Beat」的判据（构画 `isCompleteOutlineBeat`）：八项全非空 */
export function isCompleteOutlineBeat(beat) {
  return !!beat && ['time', 'title', 'type', 'line', 'outcome', 'scene', 'subtext', 'think']
    .every(key => String(beat[key] || '').trim());
}

/** 只留完整 Beat（构画 `parseCompleteOutline`） */
export function parseCompleteOutline(raw) {
  return parseOutline(raw).filter(isCompleteOutlineBeat);
}

/**
 * 把 Beat 序列**规范化回 `raw_text` 格式**（构画 `normalizeOutlineResponse`）。
 * ⚠ 只在**首次落库**时用；后续编辑走 `editOutlineScene` / `deleteOutlineBeatFromRaw`
 *   （那两个刻意不重新序列化，以保留未知字段）。
 */
export function normalizeOutlineResponse(raw) {
  const beats = parseCompleteOutline(raw);
  if (!beats.length) return '';
  const blocks = beats.map(beat => [
    `Beat: ${beat.time}|${beat.title}|${beat.type}|${beat.line}|${beat.outcome}`,
    `Scene: ${beat.scene}`,
    `Subtext: ${beat.subtext}`,
    `Think: ${beat.think}`,
  ].join('\n'));
  return `<outline_widget>\n${blocks.join('\n')}\n</outline_widget>`;
}

/** 简易可编辑文本规范化（构画 `normalizeEditableText` 的等价最小实现） */
function normalizeEditableText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 只改**某一个 Beat 的 Scene 行**（构画 `editOutlineScene`）。
 *
 * ★★ **不重新序列化** —— 直接改原文，保留未知字段与原始包装。
 *   这是构画刻意为之的设计，别图省事改成"解析→重建"（会吃掉模型将来新增的字段）。
 *
 * @returns {{ok:boolean, raw:string, value?:string, reason?:string}}
 */
export function editOutlineScene(raw, index, value) {
  const source = String(raw || '');
  const widget = /<outline_widget\b[^>]*>([\s\S]*?)<\/outline_widget\s*>/i.exec(source);
  const before = widget ? source.slice(0, widget.index + widget[0].indexOf(widget[1])) : '';
  const after = widget ? source.slice(widget.index + widget[0].indexOf(widget[1]) + widget[1].length) : '';
  const content = widget ? widget[1] : source;
  const lines = content.split('\n');
  const starts = [];
  lines.forEach((line, lineIndex) => {
    if (/^\s*(?:[#>*-]\s*)*Beat\s*[:：]/i.test(line)) starts.push(lineIndex);
  });
  const start = starts[Number(index)];
  const end = starts[Number(index) + 1] ?? lines.length;
  if (start == null) return { ok: false, reason: 'not-found', raw };

  const normalized = normalizeEditableText(value);
  let scene = -1;
  let insert = end;
  for (let i = start + 1; i < end; i++) {
    if (/^\s*Scene\s*[:：]/i.test(lines[i])) scene = i;
    else if (insert === end && /^\s*(?:Subtext|Think)\s*[:：]/i.test(lines[i])) insert = i;
  }
  if (scene >= 0) {
    if (normalized) lines[scene] = lines[scene].replace(/^(\s*)Scene\s*[:：].*$/i, `$1Scene: ${normalized}`);
    else lines.splice(scene, 1);
  } else if (normalized) {
    lines.splice(insert, 0, `Scene: ${normalized}`);
  }
  return {
    ok: true,
    raw: widget ? before + lines.join('\n') + after : lines.join('\n'),
    value: normalized,
  };
}

/** 删掉第 index 个 Beat（构画 `deleteOutlineBeatFromRaw`）；越界返回 null */
export function deleteOutlineBeatFromRaw(raw, index) {
  const source = String(raw || '');
  const widget = /<outline_widget[^>]*>([\s\S]*?)<\/outline_widget>/i.exec(source);
  const contentStart = widget ? widget.index + widget[0].indexOf(widget[1]) : 0;
  const content = widget ? widget[1] : source;
  const contentEnd = contentStart + content.length;
  const starts = [];
  let offset = 0;
  for (const match of content.matchAll(/.*(?:\n|$)/g)) {
    const line = match[0];
    if (!line) continue;
    const text = line.replace(/\r?\n$/, '').trim().replace(/^[>#*\-\s]+/, '').replace(/\*+/g, '');
    if (/^Beat\s*[:：]/i.test(text)) starts.push(contentStart + offset);
    offset += line.length;
  }
  if (!Number.isInteger(index) || index < 0 || index >= starts.length) return null;
  const removeStart = starts[index];
  const removeEnd = index + 1 < starts.length ? starts[index + 1] : contentEnd;
  return source.slice(0, removeStart) + source.slice(removeEnd);
}

/**
 * 判定"是否推进"（构画 `shouldAdvanceOutline`）。
 *
 * ★ 构画的原实现是：**回答里含「推进」且不含否定**才算推进。
 *   本模块把判据收得**更严**（见 `judgeOutlineAdvance`：要求模型只回一个词），
 *   因为邻舍走 JSON 结构化输出，不需要从自然语言里猜。
 */
export function shouldAdvanceOutline(answer) {
  const text = String(answer || '').trim();
  return /推进/.test(text) && !/(未|没|不|无)\s*推进/.test(text);
}

// ═══════════════════════════════════════════════════════════
// 二、存取（邻舍侧：SQLite；构画那边是 chat_metadata）
// ═══════════════════════════════════════════════════════════

function rowToOutline(r) {
  if (!r) return null;
  let beats = [];
  try {
    const v = JSON.parse(r.beat_json || '[]');
    beats = Array.isArray(v) ? v : [];
  } catch { beats = []; }
  return {
    id: r.id,
    beats,
    beatCount: beats.length,
    raw: r.raw_text || '',
    cursor: Number(r.cursor) || 0,
    pin: !!r.pin,
    basisNote: r.basis_note || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 取当前大纲（只保留一份 —— 大纲是"当前故事走向"，不是历史列表） */
export function getOutline() {
  const row = getDb().prepare('SELECT * FROM story_outlines ORDER BY id DESC LIMIT 1').get();
  return rowToOutline(row);
}

/** 落库：`raw_text` + 解析结果 + 游标（首次生成/整体替换用） */
export function saveOutline({ raw, basisNote = '', cursor = 1 } = {}) {
  const text = String(raw || '');
  const beats = parseCompleteOutline(text);
  // ★ 一个 Beat 都没有 = 模型没产出可用内容 → 抛错，不静默把旧大纲清空（红线 0 / L7）
  if (!beats.length) {
    throw Object.assign(new Error('模型没给出可用的大纲节点，已保留原大纲'), { statusCode: 502 });
  }
  const db = getDb();
  const cur = Math.max(1, Math.min(Number(cursor) || 1, beats.length));
  const exist = getOutline();
  if (exist) {
    db.prepare(
      'UPDATE story_outlines SET beat_json = ?, raw_text = ?, cursor = ?, basis_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(JSON.stringify(beats), text, cur, String(basisNote || '').slice(0, 500), exist.id);
    return getOutline();
  }
  db.prepare(
    'INSERT INTO story_outlines (beat_json, raw_text, cursor, pin, basis_note) VALUES (?, ?, ?, 0, ?)'
  ).run(JSON.stringify(beats), text, cur, String(basisNote || '').slice(0, 500));
  return getOutline();
}

/** 改游标（人工重定位 / 自动推进共用） */
export function setOutlineCursor(cursor) {
  const cur = getOutline();
  if (!cur) throw Object.assign(new Error('还没有大纲'), { statusCode: 404 });
  const next = Math.max(0, Math.min(Number(cursor) || 0, cur.beatCount));
  getDb().prepare('UPDATE story_outlines SET cursor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(next, cur.id);
  return getOutline();
}

/** 人工锁定：锁上后**不参与自动推进**（构画的人工锁线保护，同一取向） */
export function setOutlinePin(pin) {
  const cur = getOutline();
  if (!cur) throw Object.assign(new Error('还没有大纲'), { statusCode: 404 });
  getDb().prepare('UPDATE story_outlines SET pin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(pin ? 1 : 0, cur.id);
  return getOutline();
}

/** 改某个 Beat 的 Scene（走原文编辑，保留未知字段） */
export function updateBeatScene(index, value) {
  const cur = getOutline();
  if (!cur) throw Object.assign(new Error('还没有大纲'), { statusCode: 404 });
  const r = editOutlineScene(cur.raw, index, value);
  if (!r.ok) throw Object.assign(new Error('节点不存在'), { statusCode: 404 });
  const beats = parseCompleteOutline(r.raw);
  const db = getDb();
  db.prepare(
    'UPDATE story_outlines SET raw_text = ?, beat_json = ?, cursor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(r.raw, JSON.stringify(beats), Math.min(cur.cursor, Math.max(beats.length, 1)), cur.id);
  return getOutline();
}

/** 删某个 Beat（游标同步回退，避免指向越界） */
export function deleteBeat(index) {
  const cur = getOutline();
  if (!cur) throw Object.assign(new Error('还没有大纲'), { statusCode: 404 });
  const next = deleteOutlineBeatFromRaw(cur.raw, index);
  if (next == null) throw Object.assign(new Error('节点不存在'), { statusCode: 404 });
  const beats = parseCompleteOutline(next);
  const db = getDb();
  db.prepare(
    'UPDATE story_outlines SET raw_text = ?, beat_json = ?, cursor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(next, JSON.stringify(beats), cursorAfterBeatDelete(cur.cursor, index, beats.length), cur.id);
  return getOutline();
}

/** 删 Beat 后游标怎么走（构画 `cursorAfterBeatDelete` 同口径） */
export function cursorAfterBeatDelete(cursor, deletedIndex, remainingCount) {
  const current = Math.max(0, Math.floor(Number(cursor) || 0));
  if (current === 0) return 0;
  return current > deletedIndex + 1 ? current - 1 : Math.min(current, Math.max(0, remainingCount));
}

/** 清空大纲（人工显式操作） */
export function clearOutline() {
  getDb().prepare('DELETE FROM story_outlines').run();
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════
// 三、注入文本（移植构画 prompts.js 的 buildOutlineInjectionText）
// ═══════════════════════════════════════════════════════════

/**
 * 拼「大纲推进参考」注入文本。
 *
 * ★★ 语义（照构画口径，这是整套东西的关键）：
 *   注入的是**当前阶段 + 隐约的未来方向**，并明确要求模型**不要点破** ——
 *   不是给模型一份剧本照着念。构画原文写的是"仅供你把握走向，切勿直接引用或点破"。
 *
 * ⚠ 本函数是**纯函数**，便于单测；调用方（`routes/chat.js`）负责放进 `dynamicBlocks`。
 *
 * @param {Array} beats 完整 Beat 数组
 * @param {number} cursor 当前节点（1-based）
 * @returns {string} 空串表示不注入（没有大纲 / 游标非法）
 */
export function buildOutlineInjectionText(beats, cursor) {
  const list = Array.isArray(beats) ? beats : [];
  const cur = Math.floor(Number(cursor) || 0);
  if (!list.length || cur < 1 || cur > list.length) return '';
  const current = list[cur - 1];
  const next = list[cur];
  const format = beat => `${beat.time ? beat.time + '·' : ''}《${beat.title}》${beat.type ? '·' + beat.type : ''}`;
  const parts = [
    '【剧情大纲·当前进度参考·仅供你把握走向，切勿直接引用或点破】',
    '请把下面的「当前节点」当作此刻所处的阶段；大纲只提供阶段方向，不规定故事推进速度。',
    '自然、含蓄地顺着它叙事；把「下个节点」当作隐约的方向，不要生硬跳进、不要提前抖开。',
    `当前节点：${format(current)}` + (current.scene ? `\n  ${current.scene}` : ''),
  ];
  if (next) {
    parts.push(`下个节点（仅供未来方向）：${format(next)}` + (next.scene ? `\n  ${next.scene}` : ''));
  } else {
    parts.push('已是大纲最后一个节点，可从容收束。');
  }
  return parts.join('\n');
}

/**
 * 供路由直接调用：读出当前大纲并拼注入文本。
 * @returns {string} 空串 = 不注入
 */
export function outlineInjectionForNow() {
  try {
    const cur = getOutline();
    if (!cur || cur.cursor < 1) return '';
    return buildOutlineInjectionText(cur.beats, cur.cursor);
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════
// 四、生成（移植构画 outline/prompts.js 的创作合同）
// ═══════════════════════════════════════════════════════════

/**
 * 大纲创作合同 —— **逐条移植构画 `buildOutlineCreationContract`**。
 *
 * ★ 这些约束是构画反复打磨出来的，直接照抄其语义，不要按"我觉得"改写：
 *   · 节点代表**阶段跨度**，不是日程或单镜头；
 *   · **宁可少而完整，不要凑数**；
 *   · 未确定的事**不凭空增加冲突/阴谋/灾难**；
 *   · Scene 写"这一阶段发生什么"，不写单个镜头；Subtext 是**题记/引言**，不复述 Scene；
 *   · Think 说明"该节点为何成立"与叙事作用，不写成逐项答题。
 */
const OUTLINE_CREATION_CONTRACT = `【完整面创作合同】
- 动笔前先在内部判断当前状态、核心驱动力、主要角色或势力、已有故事线与自然走向；这些判断只用于创作，不要另写分析作文。
- 节点代表阶段跨度，不是日程或单镜头；时间依材料与目标推演，观察尺度不等于速度。
- 节点数量由当前素材、故事阶段与创作目标自由决定；宁可少而完整，也不要凑数。未来尚未确定时，只提出既有材料容许且有动机、条件与因果支撑的合理分支；未确定本身不是凭空增加冲突、阴谋或灾难的理由。
- 故事线随证据设置：有外部目标、任务或核心对抗才设【主线】，纯关系/日常/成长不造外部线；推进可进退，不套模板。强度依材料，平静阶段可持续。
- Scene：精炼写清这一阶段发生什么、故事整体推进到哪里，着眼阶段走向而非单个镜头。
- Subtext：写成文学化的题记或引言，不复述 Scene；形式与长度随内容自然生发。
- Think：简短说明该节点为何成立，以及它承担的叙事作用或转折逻辑；不要写成逐项答题。
- title 是凝练点题的小标题，可用意象、动作、一个词或半句话，贴合节点气质即可。

【理想机器结构】
- 完整输出使用一对闭合的 <outline_widget>...</outline_widget>。
- 每个节点包含 Beat、Scene、Subtext、Think 四项业务内容，建议按 Beat → Scene → Subtext → Think 排列。
- Beat 包含五个字段，以竖线分隔：Beat: 推演时间|标题|类型|所属故事线|结果
- 推演时间使用相对、粗略的时间锚，跨度依已有材料和故事阶段合理确定，不精确到某一天。
- 每项填写真实内容，不得用省略号、占位符或"后续同理"代替节点，不得中途截断。

<outline_widget>
Beat: 推演时间|标题|类型|所属故事线|结果
Scene: 这一阶段发生什么、故事整体推进到哪里
Subtext: 文学化题记或引言
Think: 节点成立原因、叙事作用或转折逻辑
</outline_widget>`;

/** 取「近期剧情」素材：滚动摘要（最近若干条）—— 直连库，不引入新依赖 */
function recentStoryMaterial(limit = 4) {
  try {
    const rows = getDb().prepare(
      'SELECT summary FROM rolling_summaries ORDER BY id DESC LIMIT ?'
    ).all(limit);
    return rows.map(r => String(r.summary || '').trim()).filter(Boolean).reverse();
  } catch { return []; }
}

/** 取已有事件线名（作为"已铺开的线索"，让大纲与之呼应） */
function existingLineNames(limit = 20) {
  try {
    const rows = getDb().prepare('SELECT name FROM event_lines ORDER BY id DESC LIMIT ?').all(limit);
    return rows.map(r => String(r.name || '').trim()).filter(Boolean);
  } catch { return []; }
}

/** 取世界观设定（有则给，让大纲贴合世界）；注意"防打扰模式"下可能返回 null */
function worldContextText() {
  try {
    return String(getWorldSetting() || '').slice(0, 1500);
  } catch { return ''; }
}

/**
 * 生成剧情大纲（**只出草稿，由调用方决定是否保存** —— 与「修正地点」「AI 生成事件线」同一范式）。
 *
 * @param {{direction?:string}} input direction = 用户给的走向提示（可空）
 * @returns {Promise<{raw:string, beats:Array, basisNote:string}>}
 */
export async function generateOutlineDraft(input = {}) {
  const direction = String(input.direction || '').trim();
  const material = recentStoryMaterial();
  const lines = existingLineNames();
  const world = worldContextText();

  // ★ 什么都没得参考时**抛错**，不产出凭空大纲（红线 0：宁可说清"没素材"）
  if (!material.length && !lines.length && !direction) {
    throw Object.assign(new Error('没有可参考的剧情材料：先积累一些对话，或填写一个走向提示'), { statusCode: 400 });
  }

  const blocks = [];
  if (world) blocks.push(`【世界观基调（节选）】\n${world}`);
  if (material.length) {
    blocks.push(`【近期剧情（滚动摘要，按时间从早到晚）】\n${material.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  }
  if (lines.length) {
    blocks.push(`【已铺开的故事线（大纲应与它们呼应，不要另起炉灶）】\n${lines.join('、')}`);
  }
  if (direction) blocks.push(`【本次走向提示（用户给的，必须体现）】\n${direction}`);

  const raw = await chatSync([
    { role: 'system', content: OUTLINE_CREATION_CONTRACT },
    {
      role: 'user',
      content: `${blocks.join('\n\n')}\n\n`
        + '请以编剧顾问的第三人称视角，为这个故事生成大纲。'
        + '直呼角色名字，不要扮演角色，严禁使用"我""我们"。'
        + '严格按上面的机器结构输出。',
    },
  ], { temperature: 0.8, max_tokens: 2400, label: 'story:outline-gen' });

  const normalized = normalizeOutlineResponse(raw);
  const beats = parseCompleteOutline(normalized);
  // ⚠ 全空必须抛错，不能拿空值覆盖既有大纲（与 saveOutline 的双保险）
  if (!beats.length) {
    throw Object.assign(new Error('模型没给出可用的大纲节点，请重试或补一句走向提示'), { statusCode: 502 });
  }
  return {
    raw: normalized,
    beats,
    basisNote: direction ? `按走向提示生成：${direction}` : '按近期剧情生成',
  };
}

// ═══════════════════════════════════════════════════════════
// 五、推进判定（移植构画 outline/judge.js 的语义）
// ═══════════════════════════════════════════════════════════

/**
 * 判定"最近剧情是否已推进到下一节点"。
 *
 * ★★ 与构画的两点差异，都是**有意收严**：
 *   ① 构画用自然语言问答（`shouldAdvanceOutline` 从回答里正则找"推进"），
 *      邻舍走 JSON 结构化输出 —— **要求模型只回一个布尔**，不给它含糊的余地；
 *   2) 边界**不判**：已在最后一个节点 → 直接返回 `{advanced:false, reason:'最后一节点'}`，
 *      **不发起 LLM 调用**（构画那边也是 `cursor >= beats.length` 就 skip）。
 *
 * ⚠ **人工锁定（`pin`）时不自动推进**（构画的人工锁线保护）。
 *
 * @param {{recentText?:string}} input recentText = 最近的对话文本（由调用方截取）
 * @returns {Promise<{advanced:boolean, cursor:number, reason:string}>}
 */
export async function judgeOutlineAdvance(input = {}) {
  const cur = getOutline();
  if (!cur || !cur.beats.length) {
    return { advanced: false, cursor: 0, reason: '还没有大纲' };
  }
  if (cur.pin) {
    return { advanced: false, cursor: cur.cursor, reason: '已人工锁定，不自动推进' };
  }
  if (cur.cursor >= cur.beats.length) {
    return { advanced: false, cursor: cur.cursor, reason: '已是最后一个节点' };
  }
  const recentText = String(input.recentText || '').trim();
  if (!recentText) {
    return { advanced: false, cursor: cur.cursor, reason: '没有可判定的剧情文本' };
  }

  const current = cur.beats[cur.cursor - 1];
  const next = cur.beats[cur.cursor];
  const raw = await chatSync([
    {
      role: 'system',
      content: `你是剧情分析助手。判断下面的正文是否已经把剧情推进到了「下一个节点」。

当前节点：${current.title}${current.scene ? `（${current.scene}）` : ''}
下一个节点：${next.title}${next.scene ? `（${next.scene}）` : ''}

只有当正文已经**明确进入或跨过**「下一个节点」所描述的阶段时，才算推进。
若剧情仍停留在当前节点、或在写与主线无关的日常/支线，都算「没推进」。

只输出 JSON：{"advanced": true} 或 {"advanced": false}
不要解释。`,
    },
    { role: 'user', content: recentText.slice(0, 3000) },
  ], { temperature: 0.1, max_tokens: 60, response_format: { type: 'json_object' }, label: 'story:outline-judge' });

  let advanced = false;
  try {
    const jsonStr = extractFirstJson(String(raw || ''));
    const obj = jsonStr ? JSON.parse(repairJson(jsonStr)) : null;
    // ⚠ 判据要**显式 true** 才算推进 —— 模型给缺字段/给字符串"是"都不算（宁可不动）
    advanced = obj?.advanced === true;
  } catch {
    advanced = false;
  }
  if (!advanced) return { advanced: false, cursor: cur.cursor, reason: '剧情未推进' };
  const updated = setOutlineCursor(cur.cursor + 1);
  return { advanced: true, cursor: updated.cursor, reason: '已推进到下一节点' };
}

/** 把最近对话拼成判定用的文本（调用方给原始消息数组） */
export function composeRecentText(messages, maxChars = 3000) {
  const arr = Array.isArray(messages) ? messages : [];
  const text = arr.slice(-20)
    .map(m => `${m.role === 'user' ? '用户' : (m.display_name || '角色')}：${String(m.content || '').slice(0, 400)}`)
    .join('\n');
  return text.slice(-maxChars);
}