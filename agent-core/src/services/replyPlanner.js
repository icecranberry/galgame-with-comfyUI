import { chatStream } from '../llm/llm-client.js';
import { getDb } from '../db/index.js';

/**
 * 深度思考 Planner：在主聊天流之前规划回复的媒介组合（纯文字 / 表情包 / 生成图片）。
 *
 * 同构设计：planner 与主回复共用 buildChatContext 产出的完全相同的消息结构，不新增独立 user 消息：
 *   - planner 请求：任务块合并到 user 消息头部，触发提醒追加到 user 消息末尾（贴生成点强化输出契约）
 *   - 执行器请求：盘算结果（<reply_plan>）追加到 user 消息末尾，紧贴回复生成点
 *
 * 角色视角：不切换"导演"身份，始终是角色本人——任务块提示"进入回复前的心理活动"，
 * <think> 以第一人称内心独白输出（用户看到的流式小字即角色的内心活动），<plan> 是盘算结果；
 * 执行块把计划呈现为"你刚在心里盘算好的安排"，角色自然地把回复说出来。
 *
 * 一次流式调用同时产出两段内容：
 *   <think> 给用户看的自然语言思考（SSE plan_delta 流式小字展示，默认折叠）
 *   <plan>  给机器执行的结构化计划（JSON，由调用方转成执行块合并进主回复请求）
 *
 * 设计要点：
 *   - 图片完全由 planner 决策并直连生图管线（handleNeedImageFlow + scene 提示），
 *     主回复 LLM 不产出 {"prompt"}；文字与表情包仍复用主聊天流既有输出约定，执行管线零改动
 *   - 任何失败（超时 / 解析失败 / 清洗后无有效块）都由调用方静默回退现有五路生图决策流程
 */

// planner 总耗时上限：超时后停止读取流，放弃规划
const PLANNER_TIMEOUT_MS = 20_000;

/**
 * 把文本合并到最后一条 user 消息的最前面（不新增独立消息，保持与主回复相同的消息结构）。
 * 找不到 user 消息时兜底为尾部追加一条 user 消息。
 */
export function prependToLastUserMessage(messages, text) {
  const merged = messages.map(m => ({ ...m }));
  const reverseIdx = [...merged].reverse().findIndex(m => m.role === 'user');
  if (reverseIdx < 0) {
    merged.push({ role: 'user', content: text });
    return merged;
  }
  const idx = merged.length - 1 - reverseIdx;
  merged[idx] = { ...merged[idx], content: `${text}\n\n${merged[idx].content}` };
  return merged;
}

/**
 * 把文本追加到最后一条 user 消息的末尾（同样不新增独立消息）。
 * 与 prependToLastUserMessage 配对使用：规则块放消息头部，触发提醒贴着生成点（消息尾部），
 * 避免长动态块稀释格式要求。
 */
export function appendToLastUserMessage(messages, text) {
  const merged = messages.map(m => ({ ...m }));
  const reverseIdx = [...merged].reverse().findIndex(m => m.role === 'user');
  if (reverseIdx < 0) {
    merged.push({ role: 'user', content: text });
    return merged;
  }
  const idx = merged.length - 1 - reverseIdx;
  merged[idx] = { ...merged[idx], content: `${merged[idx].content}\n\n${text}` };
  return merged;
}

/**
 * planner 的任务块：合并到最后一条 user 消息最前面。
 * 不切换身份——仍是角色本人，提示"进入回复前的心理活动"；
 * 只携带主结构里没有的信息（媒介规则、可用表情、上一轮媒介、硬性约束）与输出格式要求，
 * 其余上下文（人设、历史、情绪、日程）全部复用主结构，不做重复注入。
 */
/**
 * planner 的任务块：合并到最后一条 user 消息最前面。
 * 不切换身份——仍是角色本人，提示"进入回复前的心理活动"；
 * 只携带主结构里没有的信息（媒介规则、可用表情、上一轮媒介、硬性约束）与输出格式要求，
 * 其余上下文（人设、历史、情绪、日程）全部复用主结构，不做重复注入。
 *
 * imagePolicy：'off' = 不提照片工具（不提即禁）；'auto' = planner 按需决策；
 *              'must' = 强制生图，本轮必须包含一个 image 块（照片作为文字的配图）。
 */
export function buildPlannerTaskBlock({
  characterName = '角色',
  userName = '用户',
  stickerKeys = [],
  imagePolicy = 'auto',
  lastReplyMedia = '',
}) {
  const imageEnabled = imagePolicy !== 'off';
  const stickerList = [...new Set(stickerKeys.filter(Boolean))];
  const constraints = [];
  if (stickerList.length === 0) constraints.push(`${characterName}没有任何表情包，禁止规划 sticker`);
  // 关闭生图时不把照片列入可用工具（不提即禁），而不是注入"禁止规划 image"的约束；
  // sanitizePlan 仍会剥离 image 块兜底
  const points = [
    imagePolicy === 'must' && '- **用户开启了强制生图：本次回复必须包含一个 image 块**——照片作为文字的配图（先写文字再配图），设计最贴合此刻氛围的画面',
    imagePolicy !== 'must' && '- 大多数对话，纯文字就是最优解（默认）；媒介为表达服务，不为炫技',
    '- 表情包：想放大情绪、撒娇、吐槽、缓解尴尬时用一个就好（一条回复最多1张，不与上一轮重复）',
    imageEnabled && '- 照片作为文字的配图：分享必须"看见"才生动的东西（食物/穿搭/风景/礼物）时，先写文字再配一张图',
    imagePolicy === 'auto' && '- 只有当画面感明显胜过文字时才发照片；上一轮已经发过图或表情包时，这一轮优先纯文字',
    lastReplyMedia && `- 上一轮的情况：${lastReplyMedia}`,
    `- 可用表情：${stickerList.length > 0 ? stickerList.join(',') : '（无）'}`,
  ].filter(Boolean).join('\n');
  const typeDesc = imageEnabled ? '块类型，只能填 text 或 sticker 或 image' : '块类型，只能填 text 或 sticker';
  const imageFieldDesc = imageEnabled
    ? `, "scene": "仅 type=image 时填，不超过30字的中文画面描述，用第三人称写（出现自己时用「${characterName}」这个名字，不要用「我」），像手机随手拍的画面，如：${characterName}撑着伞站在街角，手里拎着油纸包的烤串｜其他类型此字段填空字符串"`
    : '';
  const thinkImageHint = imagePolicy === 'off' ? '' : (imagePolicy === 'must' ? '；画面具体是什么（本次必发图）' : '；若发图，画面具体是什么');
  // must 模式下默认"只盘算一个 text 块"与强制令冲突，契约行改为强制带图
  const blocksRule = imagePolicy === 'must'
    ? 'blocks 数量1~3个，且其中必须有一个 image 块（照片作为文字的配图）：'
    : 'blocks 数量1~3个，日常闲聊默认只盘算一个 text 块：';

  return `<inner_thought>
【回复前的心理活动】${userName}刚发来了一条新消息（见本条消息末尾）。在开口回复之前，先在心里快速盘算一下：这条回复用什么形式表达最自然、最动人。这是你自己的内心活动，用你自己的视角想，人设、关系、情绪、聊天历史、日程都在上文，直接基于它们判断。

盘算要点：
${points}
${constraints.length > 0 ? `- 硬性约束：${constraints.join('；')}` : ''}
【本轮输出契约】想清楚后，本轮的输出有且只有以下两段——<think> 内心活动 + <plan> 发话安排。回复正文一个字都不要出现在本轮输出里（想完之后你自然会说出口，那是在下一步）；写完 </plan> 立即停下。${blocksRule}

<think>
（用2~4句话、第一人称内心独白的语气：${userName}这句话真正想要什么；我此刻的心情；我决定怎么发${thinkImageHint}；若发表情，用哪个）
</think>
<plan>
{
  "blocks": [
    {"type": "${typeDesc}", "key": "仅 type=sticker 时填，必须从可用表情里原样选取，如：开心｜其他类型此字段填空字符串", "note": "仅 type=text 时填，不超过20字，说明这句话想怎么开口，如：假装淡定地说刚到楼下｜其他类型此字段填空字符串"${imageFieldDesc}}
  ],
  "summary": "一句内心活动的总结，不超过18字，如：想想怎么用一张图回答位置"
}
</plan>
</inner_thought>`;
}

/**
 * planner 的触发提醒：追加到最后一条 user 消息末尾，紧贴生成点。
 * 任务块在消息头部、中间隔着全部动态块，角色扮演惯性容易稀释格式要求——
 * 这一行在生成前最后一次强化"本轮只输出盘算，不输出正文"的契约；
 * must 模式下同时重申强制带图（防止模型盘算完只给了 text）。
 */
export function buildPlannerTriggerLine(imagePolicy = 'auto') {
  const mustReminder = imagePolicy === 'must'
    ? '本次必须规划一张图——blocks 里必须有一个 image 块（照片作为文字的配图）。'
    : '';
  return `【先别开口】按上方 <inner_thought> 的本轮输出契约：只输出 <think> 与 <plan> 两段，写完 </plan> 立即停下，回复正文一个字都不要说。${mustReminder}`;
}

/**
 * 流式运行 planner：think 段通过 onDelta 增量回调（供 SSE plan_delta），
 * 结束后返回 { thinkText, plan, raw }；失败/超时返回 null。
 */
export async function runPlanner({ messages, onDelta = null, timeoutMs = PLANNER_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  let buffer = '';
  let thinkClosed = false;
  let sentLen = 0;

  const extractThink = (source) => source.replace(/<\/?think[^>]*>/gi, '');
  // 尾部若存在未闭合的 '<'（标签可能跨 chunk），截断等待下一块补全，避免把残缺标签发给前端
  const safeCut = (text) => {
    const lastOpen = text.lastIndexOf('<');
    const lastClose = text.lastIndexOf('>');
    return lastOpen > lastClose ? text.slice(0, lastOpen) : text;
  };

  try {
    for await (const chunk of chatStream(messages, { temperature: 0.6, max_tokens: 1024, label: '深度思考' })) {
      if (Date.now() > deadline) break;
      buffer += chunk;
      // 检测到 </plan> → 计划已完整，立即跳出解析返回，不等流正式关闭（省去尾部等待）
      if (buffer.toLowerCase().includes('</plan>')) break;
      if (thinkClosed) continue;
      const closeIdx = buffer.toLowerCase().indexOf('</think>');
      const planIdx = buffer.toLowerCase().indexOf('<plan');
      let source = buffer;
      if (closeIdx >= 0) source = buffer.slice(0, closeIdx);
      else if (planIdx >= 0) source = buffer.slice(0, planIdx);
      const thinkClosedNow = closeIdx >= 0 || planIdx >= 0;
      const safe = safeCut(extractThink(source));
      if (onDelta && safe.length > sentLen) {
        onDelta(safe.slice(sentLen));
        sentLen = safe.length;
      }
      if (thinkClosedNow) thinkClosed = true;
    }
  } catch (err) {
    console.error('[planner] stream error:', err.message);
    return null;
  }

  if (!buffer.trim()) return null;
  const parsed = parsePlannerOutput(buffer);
  if (!parsed) return null;
  // 流结束后补发被 safeCut 截住的尾巴
  if (onDelta && parsed.thinkText.length > sentLen) {
    onDelta(parsed.thinkText.slice(sentLen));
  }
  return parsed;
}

/** 从 planner 原始输出中拆出思考文本与计划 JSON；解析失败返回 null */
export function parsePlannerOutput(raw) {
  const text = String(raw || '');
  const planMatch = text.match(/<plan>([\s\S]*?)<\/plan>/i);
  const thinkPart = planMatch ? text.slice(0, planMatch.index) : text;
  const thinkText = thinkPart.replace(/<\/?think[^>]*>/gi, '').trim();

  let jsonStr = planMatch ? planMatch[1].trim() : extractFirstJson(text);
  if (!jsonStr) return null;
  let plan = null;
  try {
    plan = JSON.parse(jsonStr);
  } catch {
    try { plan = JSON.parse(repairJson(jsonStr)); } catch { return null; }
  }
  return { thinkText, plan };
}

/**
 * 清洗计划：剥离非法块、校验表情 key、关闭图片时剔除 image 块。
 * 照片一律作为文字的配图。
 * 返回 { blocks, summary, plannedImage }；无有效块返回 null。
 */
export function sanitizePlan(plan, { emojiKeys = [], allowImage = true } = {}) {
  if (!plan || !Array.isArray(plan.blocks)) return null;
  const keySet = new Set(emojiKeys.filter(Boolean));
  const blocks = [];
  for (const b of plan.blocks.slice(0, 3)) {
    const type = String(b?.type || '').trim().toLowerCase();
    if (type === 'text') {
      blocks.push({ type: 'text', note: String(b?.note || '').slice(0, 60) });
    } else if (type === 'sticker' && keySet.size > 0) {
      const key = String(b?.key || '').trim().replace(/[\[\]【】]/g, '');
      if (keySet.has(key)) blocks.push({ type: 'sticker', key });
    } else if (type === 'image' && allowImage) {
      blocks.push({ type: 'image', scene: String(b?.scene || '').slice(0, 120) });
    }
  }
  if (blocks.length === 0) return null;

  return {
    blocks,
    summary: String(plan.summary || '').slice(0, 40),
    plannedImage: blocks.some(b => b.type === 'image'),
  };
}

/**
 * 把盘算结果渲染成执行块：追加到最后一条 user 消息末尾，紧贴回复生成点。
 * 极简设计——回复时只需要知道刚刚的内心活动，加上本次带上的媒介提示：
 *   - 表情包：plan 里有 sticker 块时，提示这次带上了哪个表情（否则模型不会输出表情标记）
 *   - 照片：plan 里有 image 块时，描述刚发出了什么照片（planner 的画面需求；
 *           照片由生图管线单独产出，主回复不描述画面、不输出 {"prompt"}）
 * 无任何可写内容时返回空字符串（调用方跳过追加）。
 */
export function buildPlanExecuteBlock(plan, { thinkText = '' } = {}) {
  const parts = [];
  if (thinkText) parts.push(`你刚才的内心活动：\n${thinkText}`);
  const sticker = plan.blocks.find(b => b.type === 'sticker');
  if (sticker) parts.push(`（这次带上了[${sticker.key}]表情包，把它自然地写进回复里）`);
  if (plan.plannedImage) {
    const scene = plan.blocks.find(b => b.type === 'image')?.scene || '一张随手拍的照片';
    parts.push(`（你刚发出了一张照片：${scene}）`);
  }
  if (parts.length === 0) return '';
  return `<reply_plan>\n${parts.join('\n\n')}\n</reply_plan>`;
}

/** 检测上一条 assistant 回复用了什么媒介（防连续刷图/刷表情） */
export function detectLastReplyMedia(conversationId, emojiMap = new Map()) {
  try {
    const row = getDb().prepare(`
      SELECT content FROM raw_messages
      WHERE conversation_id = ? AND role = 'assistant'
      ORDER BY id DESC LIMIT 1
    `).get(conversationId);
    if (!row) return '这是本轮对话的开场';
    const content = row.content || '';
    if (/\{["'“”]?prompt["'“”]?\s*:/.test(content)) return '上一条回复带了图片';
    const hasSticker = [...emojiMap.keys()].some(k =>
      content.includes(`[${k}]`) || content.includes(`【${k}】`));
    if (hasSticker) return '上一条回复带了表情包';
    return '上一条回复是纯文字';
  } catch {
    return '';
  }
}

// ── 局部工具：与 eventGenerator.js 中同名函数逻辑一致（那边未导出，此处独立实现）──

function repairJson(text) {
  return text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
}

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
  return null;
}
