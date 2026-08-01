/**
 * 群聊引擎 — 批量剧本生成 + 流式行协议解析
 *
 * 核心设计（高缓存）：每轮只发起一次 LLM 调用，输出多角色多条消息的"剧本"。
 * 上下文布局按变更频率升序排列，最大化 DeepSeek 前缀缓存命中：
 *   [system] 舞台块（破限词 + 世界观）        ← 全局不变，与 1 对 1 同串
 *   [system] 输出协议（行协议/活人感规则）  ← 全局不变，所有群共享前缀
 *   [system] 群信息（成员资料/关系/用户）    ← 每群稳定，改群设置才变
 *   [system] 群滚动摘要                       ← 每 2 条用户发言推进
 *   [user]   群聊天记录 transcript             ← append-only
 *   [user]   本轮指令（动态尾部）
 *
 * 行协议：
 *   角色名: 消息内容
 *   角色名: {"prompt":"english scene description"}   ← 该角色发图
 *   [END]
 *
 * raw_messages 双表约定（group 会话特有）：
 *   raw content 自带说话人标记：角色使用 "[名字]: 内容"，用户使用只读特殊标记；
 *   messages 每气泡一条，content 为纯文本，speaker_character_id 标记发言角色。
 */
import { getDb, getSystemRules, getWorldSetting, getGlobalRule } from '../db/index.js';
import { chatStream } from '../llm/llm-client.js';
import { config } from '../config.js';
import { generateImage, getLastWorkflowMode } from './imageSkill.js';
import { saveBase64Image, deleteImageFileByUrl } from './imagePaths.js';
import { maybeSummarize, getRecentSummaries } from './summarizer.js';
import { curateChatMemories } from './memoryExtractor.js';
import { getCheckpoint, rollbackMemoriesFromRawId } from './memory/memoryRepository.js';
import { hybridSearch } from './memorySearch.js';
import { getTimeTag } from './timeLight.js';
import { splitText } from '../utils/sentenceSplitter.js';
import { getCurrentActivity } from './scheduleManager.js';
import { resolveGroupImageLoras, parseCharacterLoras } from './groupImageLoraMatcher.js';

export function groupConvId(groupId) { return `group_${groupId}`; }

const MAX_TRANSCRIPT_RAWS = 40;   // 摘要兜底：checkpoint 之后 transcript 超过此数触发边界推进
const TRIM_KEEP_RAWS = 24;        // 边界推进后保留的最近 raw 条数（留出再增长空间，降低跳变频率）
const MAX_ROUND_MESSAGES = 15;     // 每轮剧本最多 10 条消息（按剧本行计，分句后的气泡数不受限）
const IMAGE_NUDGE_PROBABILITY = 0.5;  // 每轮抽卡鼓励发图的概率
// ── 群聊记忆与召回统一使用 paimon 记忆 v2 ──

// ── 群数据读取 ──

export function getGroupWithMembers(groupId) {
  const db = getDb();
  const group = db.prepare('SELECT * FROM group_chats WHERE id = ?').get(groupId);
  if (!group) return null;
  const members = db.prepare(`
    SELECT c.id, c.name, c.display_name, c.short_prompt, c.base_prompt, c.avatar_path, c.loras, c.custom_workflow
    FROM group_members gm JOIN characters c ON c.id = gm.character_id
    WHERE gm.group_id = ? ORDER BY gm.id ASC
  `).all(groupId);
  return { ...group, members };
}

// ── @点名 / 提及检测 ──

export function detectMentions(text, members) {
  const hits = [];
  for (const m of members) {
    if (!m.display_name || m.display_name.length < 1) continue;
    if (text.includes(`@${m.display_name}`) || (m.display_name.length >= 2 && text.includes(m.display_name))) {
      hits.push(m);
    }
  }
  return hits;
}

// ── 上下文组装 ──

/**
 * 稳定块 [1]：输出协议 + 活人感规则
 * 全局不变（仅依赖用户昵称和全局图片规则），排在群名片之前：
 * 所有群共享这段前缀缓存，且改群名/成员不会连带使协议部分失效
 */
function buildProtocolBlock() {
  const chatUserName = config.user.nickname || '用户';
  const imageRule = getGlobalRule('image_prompt')?.rule_content || '完整英文画面描述';
  const imagePromptFieldGuide = imageRule.trim();
  return `<group_chat_rules>
你一个人扮演群聊中的【全部角色】，根据聊天记录续写接下来的群聊消息。

输出协议（严格遵守）：
- 每条消息独占一行，格式为「角色名: 消息内容」，角色名必须是 <group_info> 中的群成员名字
- 每轮最多 ${MAX_ROUND_MESSAGES} 条消息，全部说完后最后单独一行输出 [END]
- **禁止替用户「${chatUserName}」发言**
- <user_message read_only="true">...</user_message> 是真实用户已经说过的话，只用于理解上下文；禁止输出该标记，禁止续写或模仿其中的用户发言
- 发图只有一种合法格式：角色先发一条普通文字，下一行紧跟「角色名: {${imagePromptFieldGuide}}」；花括号内直接填写符合规则的完整英文画面描述，不要写 prompt 字段、JSON、引号或 Markdown 代码块，禁止照抄规则
- 严禁用「[拍了一张图]」「[举起手机]」「（发来照片）」等动作、旁白或占位符代替花括号画面描述；出现发图意图就必须输出合法发图行
- 历史聊天不会提供旧图片的画面描述或占位符；禁止凭空输出空的 {...}，花括号内必须是本轮新写的完整英文画面描述
- 输出发图行前自行检查：人物数量必须正确，画面描述只能由最外层一对花括号包裹；不满足就先修正再输出

像真人一样聊天：
- 口语化、短句，长短错落：很多消息只有几个字、一个语气词或一个即时反应，例如“？？？”“不是吧”“啊？”“行吧”“救命”“然后呢”；禁止每条都是完整、工整的书面句
- 可以省略主语、使用半句话、停顿和口头衔接，例如“我刚才差点……”“不是，你先等会儿”“主要是吧”“算了当我没说”；但不要所有人都使用同一种口癖
- 同一个人可以把一句话拆成两三条连续发送，也可以刚说完就被别人插话。示例（A/B/C 仅表示不同角色，不要原样输出字母）：
  A: 等下
  A: 你认真的？
  C: 我就知道会这样
- 接话要紧贴上一条，而不是每个人各说各的。示例：
  A: 我已经在路上了
  B: 你半小时前也这么说
  A: 这次是真的
  C: 信不了一点
- 日常话题可以一问一答、顺手追问，不需要每句话都推进剧情。示例：
  A: 我刚点了奶茶
  B: 什么味
  A: 芋泥
  B: 给我留一口
- 偶尔需要解释、吐槽或讲事情时可以说稍长一句，随后立刻穿插短反应；不要把所有消息机械地切成相同长度
- 谁有话谁说，同一个人可以连发几条；也允许有人潜水不说话，不必人人到场
- 角色之间互动要真实：接梗、抬杠、拆台、开玩笑、追问细节、@点名怼人都可以，别一团和气互相吹捧
- 允许小跑题：聊着聊着岔开话题、想起别的事，比"围着主题开会"更像真群聊
- 每个角色严守自己的人格、口癖、和其他人的关系，说话方式必须一眼能区分；禁止重复别人刚说过的意思
- 爱发图：聊到正在做的事、看到的东西、吃的喝的、去过的地方、自拍表情包时，主动配一张图
- 禁止括号动作描写、禁止方括号动作描写、禁止旁白、禁止总结式客套发言；颜文字可以正常使用，但不能把动作藏进括号
</group_chat_rules>`;
}

/** 稳定块 [2]：群信息（成员资料/关系/用户信息变更前恒定，利于前缀缓存） */
function buildGroupCard(group) {
  const chatUserName = config.user.nickname || '用户';
  const db = getDb();
  const parts = [];

  parts.push(`群聊名称：${group.name}${group.topic ? `\n群主题：${group.topic}` : ''}\n群成员：${group.members.map(m => m.display_name).join('、')}，以及用户「${chatUserName}」。`);

  // 群成员资料：仅 short_prompt + base_prompt 外观段（"你"→角色名）
  const roster = group.members.map(m => {
    const short = (m.short_prompt || '').trim();
    const base = m.base_prompt || '';
    const appMatch = base.match(/##\s*你的外观/);
    const appSection = appMatch ? base.slice(appMatch.index).replace(/你/g, m.display_name) : '';
    const persona = [short, appSection].filter(Boolean).join('\n');
    return `### ${m.display_name}\n${persona}`;
  }).join('\n\n');
  parts.push(`群成员资料：\n${roster}`);

  // 成员间关系（有向边，只取群内成员之间的）
  const memberIds = group.members.map(m => m.id);
  if (memberIds.length >= 2) {
    const ph = memberIds.map(() => '?').join(',');
    // ORDER BY 保证行序确定：群名片是稳定前缀块，字符串必须逐字节可复现，否则前缀缓存失效
    const rels = db.prepare(`
      SELECT cr.relationship_text, cf.display_name AS from_name, ct.display_name AS to_name
      FROM character_relationships cr
      JOIN characters cf ON cf.id = cr.from_character_id
      JOIN characters ct ON ct.id = cr.to_character_id
      WHERE cr.from_character_id IN (${ph}) AND cr.to_character_id IN (${ph}) AND cr.relationship_text != ''
      ORDER BY cr.id ASC
    `).all(...memberIds, ...memberIds);
    if (rels.length > 0) {
      const relLines = rels.map(r => `- ${r.to_name}是${r.from_name}的${r.relationship_text}`).join('\n');
      parts.push(`成员之间的关系：\n${relLines}\n发言时自然体现这些关系（称呼、语气、互动方式），不必刻意说明。`);
    }
  }

  // 用户信息 + 各成员与用户的关系
  const userInfoLines = [];
  if (config.user.gender) userInfoLines.push(`性别：${config.user.gender}`);
  if (config.user.appearance) userInfoLines.push(`外观：${config.user.appearance}`);
  if (config.user.persona) userInfoLines.push(`说明：${config.user.persona}`);
  const memberUserRels = memberIds.length > 0 ? db.prepare(`
    SELECT ur.relationship_text, c.display_name
    FROM user_relationships ur JOIN characters c ON c.id = ur.character_id
    WHERE ur.character_id IN (${memberIds.map(() => '?').join(',')}) AND ur.relationship_text != ''
    ORDER BY ur.character_id ASC
  `).all(...memberIds) : [];
  const relToUser = memberUserRels.map(r => `- 对${chatUserName}而言，${r.display_name}的身份是其${r.relationship_text}`).join('\n');
  parts.push(`用户信息：\n群里标记为「${chatUserName}」的发言来自真实用户。${userInfoLines.length ? '\n' + userInfoLines.join('。') : ''}${relToUser ? '\n用户与角色之间的关系：\n' + relToUser : ''}`);

  return `<group_info>\n${parts.join('\n\n')}\n</group_info>`;
}

/**
 * 群聊天记录（checkpoint 之后的 raw，append-only；raw 已自带名字前缀）
 *
 * 缓存关键设计：不能用"最近 N 条"滑动窗口 —— 超限后每新增一条就挤掉最旧一条，
 * transcript 开头每轮都变，前缀缓存从此每轮全灭。
 * 改用粘性边界（per-conversation 内存态，只增不减）：超过 MAX_TRANSCRIPT_RAWS 时
 * 一次性把边界前移到只剩 TRIM_KEEP_RAWS 条，之后边界保持不动直到再次超限。
 * 两次跳变之间 transcript 严格 append-only，前缀缓存稳定命中。
 */
const transcriptBoundaries = new Map();  // conversationId -> 粘性边界 raw id

export function invalidateGroupTranscriptBoundary(groupId) {
  transcriptBoundaries.delete(groupConvId(groupId));
}

/**
 * transcript 中的生图行完全不回传（省 token，并避免模型照抄 prompt 或 {...} 占位符）。
 * 纯函数：同一 raw 输出稳定，不破坏 transcript 的 append-only 前缀缓存。
 */
export function stripImagePromptLines(content) {
  if (!content.includes('{')) return content;
  return content.split('\n').map(line => {
    const separator = line.match(/^\[?[^:：\[\]]{1,20}\]?\s*[:：]\s*(.*)$/);
    const body = separator ? separator[1].trim() : line.trim();
    if (!extractGroupImagePrompt(body)) return line;
    return null;
  }).filter(Boolean).join('\n');
}

/** 用户发言使用独占的只读标记，不再伪装成与角色相同的「名字: 台词」格式。 */
export function formatGroupUserMessage(content, chatUserName = config.user.nickname || '用户') {
  let text = String(content || '');
  const marked = text.match(/^<user_message read_only="true">\n?([\s\S]*?)\n?<\/user_message>$/);
  if (marked) return text;

  // 兼容旧记录：[用户名]: 内容 / 用户名: 内容。
  const escapedName = String(chatUserName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  text = text.replace(new RegExp(`^\\[?${escapedName}\\]?\\s*[:：]\\s*`), '');
  return `<user_message read_only="true">\n${text}\n</user_message>`;
}

function buildTranscript(db, conversationId) {
  const checkpoint = db.prepare(`
    SELECT id, end_msg_id, summary FROM rolling_summaries
    WHERE conversation_id = ? AND end_msg_id > 0 AND checkpoint_version = 1
    ORDER BY end_msg_id DESC, id DESC LIMIT 1
  `).get(conversationId);
  // 边界取 checkpoint 与粘性边界中更靠后的一个（checkpoint 推进后自动接管）
  let afterId = Math.max(checkpoint?.end_msg_id || 0, transcriptBoundaries.get(conversationId) || 0);

  const count = db.prepare(`
    SELECT COUNT(*) AS c FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND role IN ('user','assistant')
  `).get(conversationId, afterId).c;

  if (count > MAX_TRANSCRIPT_RAWS) {
    // 块状推进：跳过最旧的 (count - TRIM_KEEP_RAWS) 条，新边界 = 保留段第一条的前一条
    const skip = count - TRIM_KEEP_RAWS;
    const firstKept = db.prepare(`
      SELECT id FROM raw_messages
      WHERE conversation_id = ? AND id > ? AND role IN ('user','assistant')
      ORDER BY id ASC LIMIT 1 OFFSET ?
    `).get(conversationId, afterId, skip);
    if (firstKept) {
      afterId = firstKept.id - 1;
      transcriptBoundaries.set(conversationId, afterId);
      console.log(`[group] transcript boundary advanced for ${conversationId}: keep last ${TRIM_KEEP_RAWS} raws (cache reset this round only)`);
    }
  }

  const raws = db.prepare(`
    SELECT id, role, content FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND role IN ('user','assistant')
    ORDER BY id ASC
  `).all(conversationId, afterId);

  const text = raws.map(r => r.role === 'user'
    ? formatGroupUserMessage(r.content)
    : stripImagePromptLines(r.content.trim())
  ).filter(Boolean).join('\n');
  return { transcript: text, rawCount: raws.length };
}

/**
 * 组装一轮群聊生成的完整 messages
 * @param {object} group - getGroupWithMembers 结果
 * @param {string[]} directiveBlocks - 本轮动态指令块
 */
export function buildGroupContext(group, directiveBlocks = []) {
  const db = getDb();
  const conversationId = groupConvId(group.id);

  const stage = [getSystemRules(), getWorldSetting()].filter(Boolean).join('\n\n');
  const groupCard = buildGroupCard(group);

  const messages = [];
  if (stage) messages.push({ role: 'system', content: stage });
  messages.push({ role: 'system', content: buildProtocolBlock() });
  messages.push({ role: 'system', content: groupCard });

  const summaries = getRecentSummaries(conversationId, 1);
  if (summaries.length > 0) {
    messages.push({ role: 'system', content: '[群聊历史摘要 — 更早的群聊内容摘要]\n' + summaries[0].summary });
  }

  const { transcript } = buildTranscript(db, conversationId);
  messages.push({
    role: 'user',
    content: `<group_transcript>\n${transcript || '（群聊刚建立，还没有消息）'}\n</group_transcript>`,
  });

  const directive = directiveBlocks.filter(Boolean).join('\n');
  messages.push({ role: 'user', content: `<round_directive>\n${directive}\n</round_directive>\n\n现在按输出协议续写群聊：` });

  return messages;
}

// ── 成员动态话题引子（后台闲聊用：奇遇/朋友圈/日程三源采集，随机抽一条） ──

function pickMemberDynamic(group) {
  const db = getDb();
  const candidates = [];
  for (const m of group.members) {
    // 奇遇：活跃事件
    const ev = db.prepare(`
      SELECT title, description FROM character_events
      WHERE character_id = ? AND status IN ('open','engaged') ORDER BY id DESC LIMIT 1
    `).get(m.id);
    if (ev?.title) {
      candidates.push({ member: m, text: `「${m.display_name}」最近正在经历一场奇遇：「${ev.title}」${ev.description ? '——' + ev.description.slice(0, 80) : ''}` });
    }
    // 朋友圈：24 小时内最新一条
    const post = db.prepare(`
      SELECT content FROM moment_posts
      WHERE character_id = ? AND status = 'done' AND created_at > datetime('now', '-1 day')
      ORDER BY id DESC LIMIT 1
    `).get(m.id);
    if (post?.content) {
      candidates.push({ member: m, text: `「${m.display_name}」刚发了一条朋友圈：「${post.content.slice(0, 80)}」` });
    }
    // 日程：当前活动（跳过睡觉和自由时间）
    try {
      const act = getCurrentActivity(m.id);
      if (act && act.activity && act.activity !== '自由时间' && act.replyDelay !== -1) {
        candidates.push({ member: m, text: `「${m.display_name}」现在正在【${act.location}】${act.activity}${act.description ? '（' + act.description + '）' : ''}` });
      }
    } catch { /* 日程未生成时跳过 */ }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ── 行协议解析 ──

const LEGACY_IMG_LINE_RE = /\{["'“”]?prompt["'“”]?\s*:\s*["“]((?:[^"”\\]|\\.)*)["”]\s*\}/i;
const DIRECT_IMG_LINE_RE = /^\{([\s\S]+)\}$/;
const EMBEDDED_IMG_RE = /\{([^{}]*)\}/g;

/** 提取群聊发图画面描述。新格式为 {description}，旧 JSON 格式仅用于历史兼容。 */
export function extractGroupImagePrompt(body) {
  const text = String(body || '').trim();
  const legacy = text.match(LEGACY_IMG_LINE_RE);
  if (legacy) return legacy[1].replace(/\\"/g, '"').trim() || null;

  const direct = text.match(DIRECT_IMG_LINE_RE);
  if (!direct) return null;
  const prompt = direct[1].trim();
  return prompt && !/^["'“”]?prompt["'“”]?\s*:/i.test(prompt) ? prompt : null;
}

/**
 * 兜底提取任意位置的 {...}。群聊协议将花括号保留给生图，因此即使模型把它
 * 单独换行或粘在台词后面，也不能让其中内容进入聊天气泡。
 */
export function extractEmbeddedGroupImagePrompt(body) {
  const source = String(body || '');
  const matches = [...source.matchAll(EMBEDDED_IMG_RE)];
  if (matches.length === 0) return null;

  const prompts = matches.map((match) => {
    let prompt = match[1].trim();
    const fieldWrapped = prompt.match(/^["'“”]?prompt["'“”]?\s*:\s*([\s\S]+)$/i);
    if (fieldWrapped) prompt = fieldWrapped[1].trim().replace(/^["'“]|["'”]$/g, '').trim();
    return prompt && !/^\.{3}$/.test(prompt) ? prompt : null;
  }).filter(Boolean);

  // 同一行出现多个花括号块时合并为一次图片任务，并确保所有块都不会泄漏到气泡。
  const text = source.replace(EMBEDDED_IMG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { prompt: prompts.length > 0 ? prompts.join(', ') : null, text };
}

/** 将纠错后的图片指令统一写回当前群聊协议格式。 */
export function formatGroupImageLine(speakerName, prompt) {
  return `[${String(speakerName || '').trim()}]: {${String(prompt || '').trim()}}`;
}

/** 解析一行剧本。返回 {speaker, text, imagePrompt} 或 null（无效行） */
export function parseScriptLine(line, membersByName) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^\[?END\]?$/i.test(trimmed)) return { end: true };

  const m = trimmed.match(/^\[?([^:：\[\]]{1,20})\]?\s*[:：]\s*([\s\S]*)$/);
  if (!m) {
    const embeddedImage = extractEmbeddedGroupImagePrompt(trimmed);
    if (embeddedImage) {
      if (!embeddedImage.prompt) {
        return embeddedImage.text ? { continuation: embeddedImage.text } : null;
      }
      return {
        continuation: embeddedImage.text || null,
        imagePrompt: embeddedImage.prompt,
      };
    }
    return { continuation: trimmed };
  }

  const name = m[1].trim();
  const body = m[2].trim();
  const member = membersByName.get(name);
  // 有说话人格式但不是群成员：整行丢弃，避免用户台词被拼进上一位角色气泡。
  if (!member) return null;
  if (!body) return null;
  // 防御：模型照抄 transcript 里的图片占位符 → 丢弃，发图必须走 {...} 格式
  if (/^\[?发了一张图片\]?$/.test(body)) return null;
  if (/^<image_sent\s*\/>$/i.test(body)) return null;

  const embeddedImage = extractEmbeddedGroupImagePrompt(body);
  if (embeddedImage) {
    const visibleText = embeddedImage.text
      .replace(/\[[^\]]*(?:拍|自拍|照片|图片|手机|镜头|发来)[^\]]*\]/g, '')
      .trim();
    if (!embeddedImage.prompt) return visibleText ? { speaker: member, text: visibleText } : null;
    return {
      speaker: member,
      text: visibleText || null,
      imagePrompt: embeddedImage.prompt,
    };
  }

  // 防御：丢弃模型用方括号伪装的发图动作，发图只能走 {...}。
  if (/\[[^\]]*(?:拍|自拍|照片|图片|手机|镜头|发来)[^\]]*\]/.test(body)) {
    const cleaned = body.replace(/\[[^\]]*(?:拍|自拍|照片|图片|手机|镜头|发来)[^\]]*\]/g, '').trim();
    return cleaned ? { speaker: member, text: cleaned } : null;
  }
  return { speaker: member, text: body };
}

// ── 群内生图 ──

async function generateGroupImage(group, speaker, prompt, targetMsgId, emit) {
  const db = getDb();
  const conversationId = groupConvId(group.id);
  const taskResult = db.prepare(
    `INSERT INTO image_tasks (conversation_id, source_msg_id, prompt_original, prompt_refined, status)
     VALUES (?, ?, ?, ?, 'running')`
  ).run(conversationId, targetMsgId, prompt, prompt);
  const taskId = taskResult.lastInsertRowid;
  emit('generate_start', { group_id: group.id, taskId, prompt, speaker_character_id: speaker.id, msg_id: targetMsgId });

  try {
    const loraOpts = {};

    // 按 prompt 中的英文名匹配其他角色 LoRA，再强制注入发图角色自身的 LoRA。
    const {
      prompt: preparedPrompt,
      fallbackApplied,
      matchedCharacters,
      loras: matchedLoras,
    } = resolveGroupImageLoras(prompt, speaker);

    // 强制注入发送者 LoRA（去重合并）
    const speakerLoras = parseCharacterLoras(speaker);
    const seenPaths = new Set(speakerLoras.map(l => l.path));
    const allLoras = [...speakerLoras, ...matchedLoras.filter(l => !seenPaths.has(l.path))];
    if (allLoras.length > 0) loraOpts.loras = allLoras;

    if (matchedCharacters.length > 0) {
      const matchedNames = matchedCharacters.map(char => `${char.display_name}(${char.name})`).join(', ');
      console.log(`[group] image character matches: ${matchedNames}; LoRAs: ${allLoras.map(lora => lora.path).join(', ') || 'none'}`);
    }
    console.log(`[group] forced speaker LoRA for ${speaker.display_name}(${speaker.name}): ${speakerLoras.map(l => l.path).join(', ') || 'none'}`);

    if (fallbackApplied) {
      console.log(`[group] image prompt added speaker name fallback: ${speaker.name}`);
    }
    const result = await generateImage(preparedPrompt, {
      scene: 'group',
      workflowScene: 'group',
      promptScene: 'chat',
      onProgress: (p) => {
        if (p.stage === 'retrying') emit('generate_retrying', { taskId, msg_id: targetMsgId, attempt: p.attempt, maxRetries: p.maxRetries });
        else emit('generate_progress', { taskId, msg_id: targetMsgId, ...p });
      },
      ...loraOpts,
    });
    if (result.promptRefined) {
      db.prepare(`UPDATE image_tasks SET prompt_refined = ? WHERE id = ?`).run(result.promptRefined, taskId);
    }
    if (!result.success || result.images.length === 0) {
      throw new Error(result.error || 'No images generated');
    }
    const urls = [];
    for (const img of result.images) {
      const filename = `${Date.now()}_${img.filename || 'comfy.png'}`;
      urls.push(saveBase64Image('chat', filename, img.base64));
    }
    db.prepare(`UPDATE messages SET images = ? WHERE id = ?`).run(JSON.stringify(urls), targetMsgId);
    db.prepare(`UPDATE image_tasks SET status='done', output_paths=?, workflow_template=?, finished_at=datetime('now') WHERE id=?`)
      .run(JSON.stringify(urls), result.wfMode, taskId);
    // 相册缓存失效（动态 import 避免 service→route 静态循环依赖）
    try {
      const { invalidateGalleryCache } = await import('../routes/images.js');
      invalidateGalleryCache();
    } catch { /* gallery 缓存失效失败不影响主流程 */ }
    emit('generate_done', { group_id: group.id, taskId, msg_id: targetMsgId, images: urls, speaker_character_id: speaker.id });
    console.log(`[group] image done for ${speaker.display_name} in group ${group.id}: ${urls[0]}`);
  } catch (err) {
    console.error(`[group] image failed for group ${group.id}:`, err.message);
    db.prepare(`UPDATE image_tasks SET status='failed', error_message=?, workflow_template=?, finished_at=datetime('now') WHERE id=?`)
      .run(err.message, getLastWorkflowMode(), taskId);
    emit('generate_error', { group_id: group.id, taskId, msg_id: targetMsgId, error: err.message });
  }
}

// ── 用户消息写入 ──

/** 写入用户的群聊消息（raw 使用只读特殊标记 + messages 展示原文），幂等 client_msg_id */
export function writeGroupUserMessage(groupId, content, clientMsgId = null) {
  const db = getDb();
  const conversationId = groupConvId(groupId);
  if (clientMsgId) {
    const existing = db.prepare('SELECT id FROM raw_messages WHERE client_msg_id = ?').get(clientMsgId);
    if (existing) {
      const msg = db.prepare(`SELECT id FROM messages WHERE raw_id = ? AND role = 'user' LIMIT 1`).get(existing.id);
      return { rawId: existing.id, msgId: msg?.id, duplicate: true };
    }
  }
  const raw = db.prepare(
    `INSERT INTO raw_messages (conversation_id, role, content, client_msg_id) VALUES (?, 'user', ?, ?)`
  ).run(conversationId, formatGroupUserMessage(content), clientMsgId || null);
  const msg = db.prepare(
    `INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'user', ?, 0)`
  ).run(conversationId, raw.lastInsertRowid, content);
  db.prepare(`UPDATE group_chats SET last_message_at = datetime('now') WHERE id = ?`).run(groupId);
  return { rawId: raw.lastInsertRowid, msgId: msg.lastInsertRowid, duplicate: false };
}

function countCompletedGroupRoundsAfter(db, conversationId, afterRawId) {
  const rows = db.prepare(`
    SELECT role FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND role IN ('user', 'assistant')
    ORDER BY id ASC
  `).all(conversationId, afterRawId);
  let waitingForAssistant = false;
  let rounds = 0;
  for (const row of rows) {
    if (row.role === 'user') waitingForAssistant = true;
    else if (waitingForAssistant) {
      rounds++;
      waitingForAssistant = false;
    }
  }
  return rounds;
}

/**
 * 截断被用户打断的剧本尾巴：前端播放中途用户发言时，未上屏的分句被抛弃，
 * 这里同步删掉 afterMsgId 之后的 assistant 分句，并按剩余分句重建 raw 剧本，
 * 让 LLM 视角与用户实际看到的对齐
 */
export function truncateRoundAfter(groupId, afterMsgId) {
  const db = getDb();
  const conversationId = groupConvId(groupId);
  const doomed = db.prepare(`
    SELECT id, raw_id, images FROM messages
    WHERE conversation_id = ? AND role = 'assistant' AND id > ?
  `).all(conversationId, afterMsgId);
  if (doomed.length === 0) return 0;

  const rawIds = [...new Set(doomed.map(row => row.raw_id).filter(Boolean))];
  const rollbackRawId = rawIds.length > 0 ? Math.min(...rawIds) : null;
  const doomedMsgIds = doomed.map(row => row.id);
  const doomedImageUrls = [...new Set(doomed.flatMap(row => {
    try {
      const urls = JSON.parse(row.images || '[]');
      return Array.isArray(urls) ? urls.filter(Boolean) : [];
    } catch {
      return [];
    }
  }))];

  // raw 剧本即将变化，先恢复所有由该 raw 及其后续内容派生的记忆版本。
  if (rollbackRawId !== null) rollbackMemoriesFromRawId(conversationId, rollbackRawId);
  const checkpointBoundary = getCheckpoint(conversationId).last_raw_msg_id || 0;

  const transaction = db.transaction(() => {
    if (doomedMsgIds.length > 0) {
      const placeholders = doomedMsgIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM image_tasks WHERE conversation_id = ? AND source_msg_id IN (${placeholders})`)
        .run(conversationId, ...doomedMsgIds);
    }
    if (rollbackRawId !== null) {
      db.prepare(`DELETE FROM rolling_summaries WHERE conversation_id = ? AND end_msg_id >= ?`)
        .run(conversationId, rollbackRawId);
    }
    db.prepare(`DELETE FROM messages WHERE conversation_id = ? AND role = 'assistant' AND id > ?`)
      .run(conversationId, afterMsgId);

    // 重建受影响的 raw：只保留已上屏分句。若整条剧本都未上屏，则删除 raw。
    for (const rawId of rawIds) {
      const rest = db.prepare(`
        SELECT m.content, c.display_name FROM messages m
        LEFT JOIN characters c ON c.id = m.speaker_character_id
        WHERE m.raw_id = ? ORDER BY m.seq ASC, m.id ASC
      `).all(rawId);
      const lines = rest
        .filter(row => row.content && row.content.trim())
        .map(row => `[${row.display_name || '?'}]: ${row.content.replace(/\n/g, ' ')}`);
      if (lines.length > 0) {
        db.prepare(`UPDATE raw_messages SET content = ? WHERE id = ?`).run(lines.join('\n'), rawId);
      } else {
        db.prepare(`DELETE FROM raw_messages WHERE id = ?`).run(rawId);
      }
    }

    const pendingRounds = countCompletedGroupRoundsAfter(db, conversationId, checkpointBoundary);
    const lastMessageAt = db.prepare(`SELECT MAX(created_at) AS value FROM messages WHERE conversation_id = ?`)
      .get(conversationId).value;
    db.prepare(`
      UPDATE group_chats
      SET rag_user_rounds_pending = ?, last_message_at = ?
      WHERE id = ?
    `).run(pendingRounds, lastMessageAt, groupId);
  });
  transaction();

  for (const url of doomedImageUrls) {
    const stillReferenced = db.prepare(`SELECT 1 FROM messages WHERE images LIKE ? LIMIT 1`).get(`%${url}%`);
    if (!stillReferenced) {
      try { deleteImageFileByUrl(url); } catch { /* 文件清理失败不影响消息截断 */ }
    }
  }
  if (doomedImageUrls.length > 0) {
    import('../routes/images.js')
      .then(({ invalidateGalleryCache }) => invalidateGalleryCache())
      .catch(() => {});
  }

  console.log(`[group] truncated ${doomed.length} undelivered segments after msg #${afterMsgId} for group ${groupId}`);
  return doomed.length;
}

// ── 核心：跑一轮群聊 ──

// 每群同时只允许一轮生成（用户发言/后台闲聊/冷场续聊互斥）
const runningGroups = new Set();

export function isGroupRoundRunning(groupId) {
  return runningGroups.has(Number(groupId));
}

/**
 * 发起一次批量剧本生成，流式解析行协议，逐条写库并通过 emit 回调推送。
 *
 * @param {number} groupId
 * @param {object} opts
 * @param {'user'|'idle'|'opening'|'lull'} [opts.trigger='user'] - 触发来源（lull = 用户在场但冷场）
 * @param {string} [opts.userMessage] - trigger='user' 时用户刚发的内容（用于 @检测与 RAG）
 * @param {function} [opts.emit] - (event, data) => void，SSE 推送回调
 * @returns {Promise<{messages: object[], rawId: number|null, busy?: boolean}>}
 */
export async function runGroupRound(groupId, { trigger = 'user', userMessage = '', emit = () => {} } = {}) {
  const numericGroupId = Number(groupId);
  if (runningGroups.has(numericGroupId)) {
    console.log(`[group] round already running for group ${groupId}, skip (trigger=${trigger})`);
    return { messages: [], rawId: null, busy: true };
  }
  runningGroups.add(numericGroupId);
  try {
    return await _runGroupRound(groupId, { trigger, userMessage, emit });
  } finally {
    runningGroups.delete(numericGroupId);
  }
}

async function _runGroupRound(groupId, { trigger = 'user', userMessage = '', emit = () => {} } = {}) {
  const db = getDb();
  const group = getGroupWithMembers(groupId);
  if (!group || group.members.length === 0) {
    throw new Error(`group ${groupId} not found or has no members`);
  }
  const conversationId = groupConvId(groupId);
  const chatUserName = config.user.nickname || '用户';
  const membersByName = new Map(group.members.map(m => [m.display_name, m]));

  // ── 动态指令块 ──
  const directiveBlocks = [];
  directiveBlocks.push(`<time_context>${getTimeTag(new Date())}</time_context>`);

  if (trigger === 'user') {
    directiveBlocks.push(`「${chatUserName}」刚刚发了消息，接下来角色们要接话。`);
    const mentions = detectMentions(userMessage, group.members);
    if (mentions.length > 0) {
      directiveBlocks.push(`「${mentions[0].display_name}」被点名/提到了，必须第一个回应。`);
    }
  } else if (trigger === 'idle') {
    directiveBlocks.push(`用户「${chatUserName}」现在不在线。角色们自发闲聊几句，氛围自然随意，不要频繁@用户。`);
    // 必带一条成员动态作为话题引子（奇遇/朋友圈/日程），避免凭空尬聊
    const dyn = pickMemberDynamic(group);
    if (dyn) {
      directiveBlocks.push(`<topic_seed>\n话题引子：${dyn.text}。\n让「${dyn.member.display_name}」自然地主动聊起这件事（分享/吐槽/炫耀都行，很适合配一张图），其他人围绕它接话。\n</topic_seed>`);
    }
  } else if (trigger === 'opening') {
    directiveBlocks.push(`群聊刚刚建立${group.topic ? `，主题是「${group.topic}」` : ''}。角色们打个招呼、暖个场，可以对建群这件事发表点评论。`);
  } else if (trigger === 'lull') {
    directiveBlocks.push(`群里冷场了一会儿，角色们自然地把话题接下去（延伸刚才的话题、开个新话头），不要重复已经说过的话。`);
  }

  // 记忆召回范围：本群 + 全体成员各自私聊。
  if (config.features.memory && trigger === 'user' && userMessage) {
    try {
      const conversationIds = [conversationId, ...group.members.map(member => `char_${member.id}`)];
      const memories = await hybridSearch(userMessage, { conversationIds, topK: 6 });
      if (memories.length > 0) {
        const lines = memories.map((memory, index) => `${index + 1}. [${memory.memory_type}] ${memory.judgment}`).join('\n');
        directiveBlocks.push(`<rag_memories>\n相关记忆（角色们可能记得的事）：\n${lines}\n</rag_memories>`);
      }
    } catch (err) {
      console.error('[group] RAG failed:', err.message);
    }
  }

  // 行数/[END] 限制已入驻稳定协议块，动态尾部不再重复

  // 抽卡鼓励发图（idle 已由 topic_seed 引导，不重复加）
  if (trigger !== 'idle' && Math.random() < IMAGE_NUDGE_PROBABILITY) {
    directiveBlocks.push(`本轮安排一个合适的角色发一张图（配合话题的照片/自拍/表情包），按发图协议输出花括号画面描述行。`);
  }

  const msgs = buildGroupContext(group, directiveBlocks);

  // ── 先插 raw 占位（messages.raw_id FK 需要），流结束后回填完整剧本 ──
  const rawResult = db.prepare(
    `INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, 'assistant', '')`
  ).run(conversationId);
  const rawId = rawResult.lastInsertRowid;

  const written = [];       // 已写入的 messages 行（含 speaker；分句后每段一条）
  const rawLines = [];      // 回填 raw 用（每个剧本行一条，图片行已补齐角色前缀）
  const imagePromises = [];
  let buffer = '';
  let pendingBraceLine = '';
  let ended = false;
  let seq = 0;
  let lineCount = 0;        // 剧本行计数（MAX_ROUND_MESSAGES 按行限制，不受分句膨胀影响）

  const insertMsg = db.prepare(
    `INSERT INTO messages (conversation_id, raw_id, role, content, seq, speaker_character_id) VALUES (?, ?, 'assistant', ?, ?, ?)`
  );

  const handleParsed = (parsed) => {
    if (!parsed || ended) return;
    if (parsed.end) { ended = true; return; }

    // 模型偶尔把台词和 {...} 粘在同一行：台词照常落库，花括号内容单独生图。
    if (parsed.imagePrompt && parsed.text) {
      handleParsed({ speaker: parsed.speaker, text: parsed.text });
      handleParsed({ speaker: parsed.speaker, imagePrompt: parsed.imagePrompt });
      return;
    }

    if (parsed.continuation) {
      // 无法识别说话人的行：拼到上一条消息（模型换行续写）
      const last = written[written.length - 1];
      if (last && !last.hasImage) {
        last.content += '\n' + parsed.continuation;
        db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(last.content, last.id);
        rawLines[last.rawLineIdx] += ' ' + parsed.continuation.replace(/\n/g, ' ');
        emit('group_msg_update', { id: last.id, content: last.content });
      }
      if (!parsed.imagePrompt) return;
    }
    if (lineCount >= MAX_ROUND_MESSAGES && parsed.text) return;

    if (parsed.imagePrompt) {
      // 独立的 {...} 行继承最近发言角色；若它出现在本轮开头，则归到首位群成员。
      const recent = written[written.length - 1];
      const speaker = parsed.speaker
        || group.members.find(member => member.id === recent?.speaker_character_id)
        || group.members[0];
      if (!speaker) return;

      // 图片行：优先挂到该角色本轮最后一条消息；没有则新建空文本气泡承载图片
      let target = [...written].reverse().find(w => w.speaker_character_id === speaker.id && !w.hasImage);
      if (!target) {
        const r = insertMsg.run(conversationId, rawId, '', seq, speaker.id);
        target = {
          id: r.lastInsertRowid, content: '', seq, rawLineIdx: rawLines.length,
          speaker_character_id: speaker.id, speaker_name: speaker.display_name,
        };
        rawLines.push('');
        written.push(target);
        seq++;
        emit('group_msg', serializeMsg(target, groupId));
      }
      target.hasImage = true;
      rawLines.push(formatGroupImageLine(speaker.display_name, parsed.imagePrompt));
      imagePromises.push(generateGroupImage(
        group,
        speaker,
        parsed.imagePrompt,
        target.id,
        emit,
      ));
      return;
    }

    // 文本行：与私聊同款分句，每段一个气泡；raw 保留完整原行（LLM 视角不变）
    lineCount++;
    const rawLineIdx = rawLines.length;
    rawLines.push(`[${parsed.speaker.display_name}]: ${parsed.text}`);
    const segments = splitText(parsed.text);
    const segs = segments.length > 0 ? segments : [parsed.text];
    for (const seg of segs) {
      const r = insertMsg.run(conversationId, rawId, seg, seq, parsed.speaker.id);
      const rec = {
        id: r.lastInsertRowid, content: seg, seq, rawLineIdx,
        speaker_character_id: parsed.speaker.id, speaker_name: parsed.speaker.display_name,
      };
      written.push(rec);
      seq++;
      emit('group_msg', serializeMsg(rec, groupId));
    }
  };

  try {
    for await (const chunk of chatStream(msgs, { temperature: 0.8, max_tokens: 800, label: `群聊#${groupId}` })) {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const candidate = pendingBraceLine ? `${pendingBraceLine}\n${line}` : line;
        const openCount = (candidate.match(/\{/g) || []).length;
        const closeCount = (candidate.match(/\}/g) || []).length;
        if (openCount > closeCount) {
          // 不完整的多行图片提示词先缓存，绝不能把半截 prompt 写进聊天气泡。
          pendingBraceLine = candidate;
          continue;
        }
        pendingBraceLine = '';
        handleParsed(parseScriptLine(candidate, membersByName));
        if (ended) break;
      }
      if (ended) break;
    }
    if (!ended) {
      const tail = pendingBraceLine
        ? `${pendingBraceLine}${buffer ? `\n${buffer}` : ''}`
        : buffer;
      const openCount = (tail.match(/\{/g) || []).length;
      const closeCount = (tail.match(/\}/g) || []).length;
      // 流结束仍未闭合的 {prompt 直接丢弃，优先避免提示词泄漏到聊天区。
      if (tail.trim() && openCount <= closeCount) {
        handleParsed(parseScriptLine(tail, membersByName));
      }
    }
  } catch (err) {
    // 流中断：已写入的消息保留，回填已有内容
    console.error(`[group] stream error for group ${groupId}:`, err.message);
    if (written.length === 0) {
      db.prepare(`DELETE FROM raw_messages WHERE id = ?`).run(rawId);
      throw err;
    }
  }

  // ── 回填 raw 完整剧本 ──
  const rawContent = rawLines.filter(Boolean).join('\n');
  if (rawContent) {
    db.prepare(`UPDATE raw_messages SET content = ? WHERE id = ?`).run(rawContent, rawId);
  } else {
    db.prepare(`DELETE FROM raw_messages WHERE id = ?`).run(rawId);
  }
  if (written.length > 0) {
    db.prepare(`UPDATE group_chats SET last_message_at = datetime('now') WHERE id = ?`).run(groupId);
  }

  // 等待本轮生图收尾（emit 在 SSE 关闭前送达）
  if (imagePromises.length > 0) {
    await Promise.allSettled(imagePromises);
  }

  // ── 后处理：用户轮次按两轮节奏整理 v2 记忆，同时推进群聊摘要 ──
  markGroupPostProcessing(group.id, 1);
  setImmediate(async () => {
    try {
      try {
        await maybeExtractGroupMemory(group, { incrementUserRound: trigger === 'user' });
      } catch (err) {
        console.error('[group] memory post-processing error:', err.message);
      }
      if (trigger === 'user') {
        try {
          await maybeSummarize(conversationId, {
            characterName: '群聊记录',
            userName: chatUserName,
            triggerRole: 'user',
            interval: 2,
          });
        } catch (err) {
          console.error('[group] summarization error:', err.message);
        }
      }
    } finally {
      markGroupPostProcessing(group.id, -1);
    }
  });

  return { messages: written, rawId: rawContent ? rawId : null };
}

function serializeMsg(rec, groupId) {
  return {
    id: rec.id,
    group_id: groupId,
    role: 'assistant',
    content: rec.content,
    seq: rec.seq,
    speaker_character_id: rec.speaker_character_id,
    speaker_name: rec.speaker_name,
    created_at: new Date().toISOString(),
  };
}

const groupMemoryExtractionRunning = new Set();
const groupPostProcessingCounts = new Map();

function markGroupPostProcessing(groupId, delta) {
  const id = Number(groupId);
  const next = Math.max(0, (groupPostProcessingCounts.get(id) || 0) + delta);
  if (next === 0) groupPostProcessingCounts.delete(id);
  else groupPostProcessingCounts.set(id, next);
}

export function isGroupPostProcessing(groupId) {
  return (groupPostProcessingCounts.get(Number(groupId)) || 0) > 0;
}

/** 每累计 2 轮用户发言，使用 v2 checkpoint 增量整理群聊 raw。 */
async function maybeExtractGroupMemory(group, { incrementUserRound = false } = {}) {
  if (!config.features.memory) return;
  const db = getDb();
  const conversationId = groupConvId(group.id);

  if (incrementUserRound) {
    db.prepare(`
      UPDATE group_chats
      SET rag_user_rounds_pending = COALESCE(rag_user_rounds_pending, 0) + 1
      WHERE id = ?
    `).run(group.id);
  }

  if (groupMemoryExtractionRunning.has(group.id)) return;
  const initialState = db.prepare(`
    SELECT COALESCE(rag_user_rounds_pending, 0) AS pendingRounds
    FROM group_chats WHERE id = ?
  `).get(group.id);
  if (!initialState || initialState.pendingRounds < 2) return;

  groupMemoryExtractionRunning.add(group.id);
  try {
    while (true) {
      const groupState = db.prepare(`
        SELECT COALESCE(rag_user_rounds_pending, 0) AS pendingRounds
        FROM group_chats WHERE id = ?
      `).get(group.id);
      if (!groupState || groupState.pendingRounds < 2) break;

      const checkpoint = getCheckpoint(conversationId);
      const endRow = db.prepare(`
        SELECT MAX(id) AS id FROM raw_messages
        WHERE conversation_id = ? AND role = 'assistant' AND content != '' AND id > ?
      `).get(conversationId, checkpoint.last_raw_msg_id);
      const throughRawId = endRow?.id || 0;
      if (throughRawId <= checkpoint.last_raw_msg_id) break;

      const roundsBeingProcessed = groupState.pendingRounds;
      const chatUserName = config.user.nickname || '用户';
      console.log(`[group] curate v2 memory for group ${group.id}: raw (${checkpoint.last_raw_msg_id}, ${throughRawId}], user rounds=${roundsBeingProcessed}`);

      await curateChatMemories({
        conversationId,
        throughRawMsgId: throughRawId,
        characterPrompt: `这是群聊「${group.name}」的聊天记录；assistant raw 内每行开头的 [名字] 是真实发言角色。`,
        characterName: '群聊角色',
        userName: chatUserName,
      });

      const completedCheckpoint = getCheckpoint(conversationId);
      if (completedCheckpoint.last_raw_msg_id < throughRawId || completedCheckpoint.status !== 'idle') {
        console.error(`[group] memory checkpoint did not advance for group ${group.id}: status=${completedCheckpoint.status}, raw=${completedCheckpoint.last_raw_msg_id}`);
        break;
      }

      // 只扣除本批开始时已计入的轮数；整理期间新增的用户轮次继续保留。
      db.prepare(`
        UPDATE group_chats
        SET rag_user_rounds_pending = MAX(0, COALESCE(rag_user_rounds_pending, 0) - ?)
        WHERE id = ?
      `).run(roundsBeingProcessed, group.id);
    }
  } catch (err) {
    // checkpoint 失败时不推进，pending 也不扣减；后续用户轮次会重试同一批。
    console.error(`[group] memory curation failed for group ${group.id}:`, err.message);
  } finally {
    groupMemoryExtractionRunning.delete(group.id);
  }
}
