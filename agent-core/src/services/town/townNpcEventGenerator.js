/**
 * 镇民 NPC 奇遇生成器
 *
 * 与 eventGenerator.js（角色奇遇）结构完全对齐：开场 → 分支推进 → 结局，
 * 数据落在 town_npc_events / town_npc_event_history。区别在于主角是镇民
 * （town_npcs 的轻量人格 + 外观描述），没有角色卡、LoRA、关系网与长期记忆，
 * 生成结果通过 `town:{id}` 引用进入前端奇遇标签。
 */

import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../../db/index.js';
import { chatSync as defaultChatSync } from '../../llm/llm-client.js';
import { generateImageRaw as defaultGenerateImageRaw } from '../imageSkill.js';
import { recordCompletedImageTask } from '../imageTaskRecorder.js';
import { saveBase64Image } from '../imagePaths.js';
import { config } from '../../config.js';
import { getTimeTag, getLightNoteWithWeather } from '../timeLight.js';
import { getWorldIntegrationRule } from '../../builtinRules.js';
import { extractFirstJson, repairJson } from '../eventGenerator.js';
import {
  broadcastNewEvent,
  broadcastEventUpdate,
  broadcastEventConclusion,
} from '../eventNotificationBus.js';

export const TOWN_NPC_EVENT_TYPE_KEY = 'town.custom';
export const TOWN_NPC_AMBIENT_EVENT_TYPE_KEY = 'town.ambient';
export const TOWN_NPC_EVENT_DURATION_MIN = 60;

// ── ID 与素材工具 ──

export function townNpcEventRef(id) { return `town:${id}`; }

/** `town:12` → 12；其余（纯数字的角色事件 id 等）返回 null。 */
export function parseTownNpcEventId(id) {
  if (typeof id !== 'string' || !id.startsWith('town:')) return null;
  const num = Number(id.slice(5));
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

export function townNpcPortraitUrl(db, npcId) {
  const row = db.prepare("SELECT image_path FROM town_assets WHERE key=? AND status='ready'")
    .get(`npc_${npcId}_portrait`);
  return row?.image_path || null;
}

function toSQLite(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

function toISO(dt) {
  if (!dt) return dt;
  return dt.replace(' ', 'T') + '.000Z';
}

/** 活跃事件行 → 前端 EventCard 可直接消费的 DTO（id 加 town: 前缀避免与角色事件撞号）。 */
export function townNpcEventDto(row, npcName = null) {
  if (!row) return null;
  const npc = npcName ?? getDb().prepare('SELECT display_name FROM town_npcs WHERE id=?').get(row.npc_id)?.display_name;
  return {
    ...row,
    id: townNpcEventRef(row.id),
    npc_event: true,
    npc_id: row.npc_id,
    display_name: npc || '镇民',
    avatar_path: townNpcPortraitUrl(getDb(), row.npc_id),
    choice_history: JSON.parse(row.choice_history || '[]'),
    created_at: toISO(row.created_at),
    expires_at: toISO(row.expires_at),
    last_interaction_at: row.last_interaction_at ? toISO(row.last_interaction_at) : null,
  };
}

/** 历史事件行 → 前端 DTO（与 event_history 的 final_image 口径对齐）。 */
export function townNpcEventHistoryDto(row) {
  if (!row) return null;
  return {
    ...row,
    image: row.final_image,
    id: townNpcEventRef(row.id),
    npc_event: true,
    npc_id: row.npc_id,
    display_name: getDb().prepare('SELECT display_name FROM town_npcs WHERE id=?').get(row.npc_id)?.display_name || '镇民',
    avatar_path: townNpcPortraitUrl(getDb(), row.npc_id),
    choice_history: JSON.parse(row.choice_history || '[]'),
    // 历史表没有 expires_at，用 ended_at 代替，前端据此识别为已结束
    expires_at: toISO(row.ended_at),
    created_at: row.created_at ? toISO(row.created_at) : null,
    last_interaction_at: null,
  };
}

function npcPersonaBlock(npc, playerName, playerAppearance) {
  const lines = [];
  if (playerName) lines.push(`同行玩家名：${playerName}`);
  if (playerAppearance) lines.push(`玩家外观：${playerAppearance}`);
  lines.push(`镇民名：${npc.display_name}`);
  if (npc.job) lines.push(`身份/工作：${npc.job}`);
  if (npc.appearance_desc) lines.push(`外观：${npc.appearance_desc}`);
  const persona = (npc.persona || '').trim() || (npc.brief || '').trim();
  if (persona) lines.push(`人格档案：\n${persona}`);
  return lines.join('\n');
}

/** 双人同框硬约束：无论是否配置全局 image_prompt 规则，画面都必须同时有镇民和玩家。 */
function twoPersonImageNote(npc, playerName, playerAppearance) {
  return `**双人画面**：prompt 中必须同时包含${npc.display_name}和${playerName}两个人。`
    + `${npc.display_name}的外观：${npc.appearance_desc || '见资料'}；${playerName}的外观：${playerAppearance || '普通镇民打扮的旅行者'}。`
    + `描述清楚两人的外观、位置、互动动作。用句号分隔两人描述。`;
}

/** 环境奇遇开场：画面是两位镇民的同框，玩家尚未入场。 */
function ambientImageNote(npc, companion) {
  return `**双人画面**：prompt 中必须同时包含${npc.display_name}和${companion.name}两位镇民，画面中不要出现玩家。`
    + `${npc.display_name}的外观：${npc.appearance_desc || '见资料'}；${companion.name}的外观：${companion.appearance || '见资料'}。`
    + `描述清楚两人的外观、位置、互动动作。用句号分隔两人描述。`;
}

function townPlayerInfo(db) {
  const player = db.prepare("SELECT display_name, appearance_desc FROM town_players WHERE id='me'").get();
  return {
    playerName: (player?.display_name || '').trim() || '玩家',
    playerAppearance: (player?.appearance_desc || '').trim(),
  };
}

// ── 开场生成 ──

/**
 * 生成镇民 NPC 奇遇的开场
 *
 * @param {object} npc - town_npcs 行
 * @param {object} [options]
 * @param {string} [options.customPrompt] - 事件方向（来自小镇互动的线索）
 * @param {string} [options.locationName] - 起点地点名
 * @param {string} [options.playerName] - 玩家名
 * @param {boolean} [options.manual] - 手动触发（生图走高优先级）
 * @param {Function} [options.beforePersist] - 落库前守卫（事务内）
 * @param {Function} [options.afterPersist] - 落库后回填（事务内，收 eventId）
 * @param {object} [options.llm] - 测试注入 { chatSync }
 * @param {object} [options.image] - 测试注入 { generateImageRaw }
 */
export async function generateTownNpcEvent(npc, options = {}) {
  const db = getDb();
  const now = new Date();
  const chatSync = options.llm?.chatSync || defaultChatSync;
  const generateImageRaw = options.image?.generateImageRaw || defaultGenerateImageRaw;

  // 1. 并发保护：每位镇民同时最多一个活跃奇遇（唯一索引兜底）
  const existing = db.prepare(
    `SELECT id FROM town_npc_events WHERE npc_id = ? AND status IN ('open','engaged') LIMIT 1`
  ).get(npc.id);
  if (existing) {
    console.log(`[townNpcEventGen] ${npc.display_name} already has an active event (id=${existing.id})`);
    throw new Error('ALREADY_ACTIVE_EVENT');
  }

  // 2. 上下文与人格
  const worldSetting = getWorldSetting();
  const jailbreakPrompt = worldSetting
    ? getSystemRulesWithWorld({ roleplay: false })
    : getSystemRules({ roleplay: false });
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';
  const worldIntegrationBlock = worldSetting ? getWorldIntegrationRule('event') : '';
  const worldPenetrationLine = worldSetting
    ? '- **严格遵循<world_setting>**：这个奇遇发生在上述<world_setting>中，不是发生在真空或现实世界中。所有感官细节和角色反应必须忠实地在<world_setting>规则下展开。事件方向是一个叙事钩子——它的具体呈现方式必须被<world_setting>重新塑造。\n'
    : '';

  const { playerName, playerAppearance } = options.playerName
    ? { playerName: options.playerName, playerAppearance: '' }
    : townPlayerInfo(db);
  const displayName = npc.display_name;
  const isAmbient = options.ambient === true;
  const companion = isAmbient && options.companionNpc ? options.companionNpc : null;
  const personaMsg = `以下是小镇镇民「${displayName}」的资料，供你参考ta的外貌、身份和行为模式：\n\n${npcPersonaBlock(npc, playerName, playerAppearance)}`
    + (companion ? `\n\n另一位镇民「${companion.name}」的资料：\n${companion.name}的外观：${companion.appearance || '见资料'}；${companion.name}的资料：${companion.persona || '普通镇民'}` : '');

  const timeTag = getTimeTag(now, false);
  const weatherNote = getLightNoteWithWeather(now);
  const weatherHint = weatherNote ? `\n\nEnvironment reference：${weatherNote}。` : '';
  const locationLine = options.locationName ? `起点地点：小镇的${options.locationName}。` : '';

  const imagePromptInstruction = imageRulesText
    || (isAmbient
      ? `描述小镇场景、${displayName}的外观、${companion?.name || '另一位镇民'}的外观、动作与氛围`
      : `描述小镇场景、${displayName}的外观、${playerName}的外观、动作与氛围`);
  const twoPersonNote = isAmbient
    ? ambientImageNote(npc, companion || { name: '另一位镇民', appearance: '' })
    : twoPersonImageNote(npc, playerName, playerAppearance);

  // [2] JSON 格式（与角色奇遇同构，字段约束按镇民奇遇改写；ambient 开场玩家不在现场）
  const sceneConstraint = isAmbient
    ? `"description": "场景叙述（80-150字。不要像讲故事，而像镜头正在发生：镇民${displayName}和${companion?.name || '另一位镇民'}必须同时出现在现场，两人的动作与对话共同推进，此时玩家${playerName}还没有加入，不要描写玩家。行动需要符合当前天气和时间，但禁止直接提及天气时间）"`
    : `"description": "场景叙述（80-150字。不要像讲故事，而像镜头正在发生：玩家${playerName}和${displayName}必须同时出现在现场，两人的动作与对话共同推进，叙述要能看出两人各自在做什么。行动需要符合当前天气和时间，但禁止直接提及天气时间）"`;
  const choiceConstraint = isAmbient
    ? `"choiceA": "选项A（具体行动，8-15字。是玩家${playerName}注意到这场面后可以立刻介入做的事——玩家在附近，随时能走近）",
  "choiceB": "选项B（与A形成真正的行动对比——玩家介入的另一条路径，把奇遇往意料之外但符合小镇日常的情况发展。8-15字）"`
    : `"choiceA": "选项A（具体行动，8-15字。是玩家${playerName}和${displayName}接下来真的会一起做的事）",
  "choiceB": "选项B（与A形成真正的行动对比——把奇遇往意料之外但符合小镇日常的情况发展。8-15字）"`;

  const formatPrompt = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{
  "title": "事件标题（≤8字，口语感叹。从你刚写完的现场里抓最戳人的那个瞬间，用当事人的第一反应喊出来——不要给事件'取名'。正确：这缸布全废了？！|你的手在抖啊。错误：裁缝铺的麻烦|意外的委托——这些是在概括事件。禁止万能感叹'天哪''不是吧'——必须带上这个奇遇的具体信息点）",
  ${sceneConstraint},
  "prompt": "${imagePromptInstruction}${weatherHint}${twoPersonNote}",
  ${choiceConstraint}
}

选项设计原则：
- A和B必须是性质完全不同的两条路径——读者感受到它们通往不同的情绪走向
- 但两条路径都必须能从两人当下的处境中自然推出
- 根据场景选择最合适的对比维度：做vs不做、直面vs绕开、自己解决vs求助、立刻vs等等、坦白vs保留、介入vs旁观`;

  // [3] 创作任务
  const openingRoleLine = isAmbient
    ? `你正在为小镇镇民「${displayName}」与「${companion?.name || '另一位镇民'}」的自发场景截取开场——玩家${playerName}此刻不在画面里，这段场景自己正在发生。`
    : `你正在为小镇镇民「${displayName}」与玩家「${playerName}」的共同奇遇截取开场——这是两个人一起经历的事，不是其中任何一方的独角戏。`;

  const ambientEntryNote = isAmbient
    ? `\n【环境奇遇——镇民自发场景】\n这是镇民之间自发展开的场景：玩家${playerName}是路过或在附近的旅行者，正巧注意到这一幕。开场只写两位镇民的场景，不要描写玩家；选项A/B写的是玩家介入的两种方式，要给玩家留出自然的入场角度。\n`
    : '';

  const directorPrompt = `事件方向：**${options.customPrompt || '一段小镇日常里的意外际遇'}**

【人称】
- 指代镇民只用「${displayName}」「她」「他」「ta」，不使用「你」
- 指代玩家用「${playerName}」或「玩家」，不使用「你」
- 叙述贴着现场中两人的感知与动作，不跳出场景解释世界

【正文——写现场，不写剧情总结】
镜头直接落在一个正在发生的动作上。背景、关系、原因，都随着动作自然露出来，而不是提前说明。

【结尾——停在行动门槛】
结尾停在一个具体动作即将发生之前，下一步由玩家决定。
${ambientEntryNote}
${timeTag}${locationLine}

请以紧密第三人称创作这个奇遇的开场。场景长度 80-150 字。`;

  const msgs = [
    { role: 'system', content: jailbreakPrompt },
    ...(worldIntegrationBlock ? [{ role: 'system', content: worldIntegrationBlock }] : []),
    { role: 'system', content: formatPrompt },
    { role: 'system', content: `${openingRoleLine}

${worldPenetrationLine}
【镇民锚定】${displayName}的行为必须贴合上面资料里的人格与小镇岗位职责；不要声称ta搬入了小镇、改变了工作岗位，或做出与身份相悖的事。
【天气约束】description中行动需要符合当前天气和时间，但禁止直接提及天气时间` },
    { role: 'system', content: personaMsg },
    { role: 'user', content: worldSetting
      ? `请遵循当前<world_setting>来生成奇遇，镇民资料如果和<world_setting>有冲突，则以<world_setting>最高优先级。\n\n${directorPrompt}`
      : directorPrompt },
  ];

  let eventData;
  // 弱模型可能漏字段或输出非 JSON：坏输出本地立即重试一次，仍失败才按业务错误上抛。
  let lastError = null;
  for (let attempt = 0; attempt < 2 && !eventData; attempt++) {
    let rawResult = '';
    try {
      rawResult = await chatSync(msgs, { temperature: 0.7, max_tokens: 4096, response_format: { type: 'json_object' }, label: '镇民奇遇生成' });
      const jsonStr = extractFirstJson(rawResult);
      if (!jsonStr) throw new Error('No JSON found in LLM response');
      eventData = JSON.parse(repairJson(jsonStr));
      if (!eventData.title || !eventData.description || !eventData.choiceA || !eventData.choiceB) {
        throw new Error('Incomplete event data from LLM');
      }
      eventData.prompt = eventData.prompt || eventData.imagePrompt;
    } catch (err) {
      lastError = err;
      console.error(`[townNpcEventGen] LLM generation failed for ${npc.display_name} (attempt ${attempt + 1}):`, err.message);
      console.log(`[townNpcEventGen] Raw LLM response:\n${rawResult}`);
    }
  }
  if (!eventData) {
    throw Object.assign(lastError ?? new Error('story generation failed'), { code: 'STORY_GENERATION_FAILED' });
  }

  // 3. 生图（镇民无 LoRA，走事件画师）
  const originalEventPrompt = eventData.prompt;
  let imageUrl = null;
  try {
    const genResult = await generateImageRaw(eventData.prompt, {
      ragQuery: eventData.description,
      artist: config.comfyui.eventArtist,
      width: config.comfyui.eventWidth,
      height: config.comfyui.eventHeight,
      // 小镇奇遇的全局 LoRA 跟随「日程」勾选框；工作流仍按 events 选。
      scene: 'schedule',
      workflowScene: 'events',
      priority: options.manual ? 'high' : 'low',
    });
    if (genResult.success && genResult.images.length > 0) {
      eventData.prompt = genResult.promptRefined || eventData.prompt;
      const img = genResult.images[0];
      const filename = `town_event_${Date.now()}_${img.filename || 'comfy.png'}`;
      imageUrl = saveBase64Image('events', filename, img.base64);
      recordCompletedImageTask({
        conversationId: `town_npc_${npc.id}_events`,
        promptOriginal: originalEventPrompt,
        promptRefined: eventData.prompt,
        outputPaths: [imageUrl],
        style: config.comfyui.eventArtist,
        resolution: `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
        workflowTemplate: genResult.wfMode,
        db,
      });
      console.log(`[townNpcEventGen] Image generated for ${npc.display_name}: ${imageUrl}`);
    } else {
      console.warn(`[townNpcEventGen] Image generation returned no images for ${npc.display_name}`);
    }
  } catch (err) {
    console.error(`[townNpcEventGen] Image generation failed for ${npc.display_name}:`, err.message);
    // 无图片也继续
  }

  // 4. 写入 DB — 初始场景作为 choice_history[0]
  const initialChoiceEntry = [{
    branch: 0,
    choice_label: '事件开始',
    choice_text: '',
    summary: eventData.description,
    image: imageUrl,
  }];
  const durationMin = Number.isSafeInteger(options.durationMin) && options.durationMin >= 5
    ? Math.min(options.durationMin, 720) : TOWN_NPC_EVENT_DURATION_MIN;
  const expiresAt = new Date(now.getTime() + durationMin * 60 * 1000).toISOString();

  const eventId = db.transaction(() => {
    options.beforePersist?.();
    if (db.prepare("SELECT 1 FROM town_npc_events WHERE npc_id=? AND status IN ('open','engaged') LIMIT 1").get(npc.id)) {
      throw new Error('ALREADY_ACTIVE_EVENT');
    }
    const insertResult = db.prepare(`
    INSERT INTO town_npc_events (npc_id, event_type_key, status, title, description, image, prompt, style, resolution,
      choice_a, choice_b, choice_c_label, current_branch, choice_history, world_id, world_epoch, location_key, expires_at)
    VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, '自由行动', 0, ?, ?, ?, ?, ?)
  `).run(
      npc.id,
      isAmbient ? TOWN_NPC_AMBIENT_EVENT_TYPE_KEY : TOWN_NPC_EVENT_TYPE_KEY,
      eventData.title,
      eventData.description,
      imageUrl,
      eventData.prompt,
      config.comfyui.eventArtist,
      `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
      eventData.choiceA,
      eventData.choiceB,
      JSON.stringify(initialChoiceEntry),
      options.worldId ?? null,
      options.worldEpoch ?? null,
      options.locationKey ?? null,
      toSQLite(expiresAt),
    );
    const id = Number(insertResult.lastInsertRowid);
    options.afterPersist?.(id);
    return id;
  }).immediate();

  const event = db.prepare(`SELECT * FROM town_npc_events WHERE id = ?`).get(eventId);
  broadcastNewEvent(townNpcEventDto(event));

  console.log(`[townNpcEventGen] Event created for ${npc.display_name}: "${event.title}" (expires=${expiresAt})`);
  return event;
}

// ── 分支推进 ──

/**
 * 生成下一步分支（与 generateNextBranch 同构；镇民无关系网/多人/交叉引用/记忆）
 */
export async function generateTownNpcNextBranch(npc, event, choice, deps = {}) {
  const db = getDb();
  const now = new Date();
  const chatSync = deps.llm?.chatSync || defaultChatSync;
  const generateImageRaw = deps.image?.generateImageRaw || defaultGenerateImageRaw;
  const branchTimeExtensionMinutes = 5;

  // 0. 原子性标记处理中（CAS：仅 processing=0 时置 1），防止并发重复提交
  const casResult = db.prepare(
    `UPDATE town_npc_events SET processing = 1 WHERE id = ? AND processing = 0`
  ).run(event.id);
  if (casResult.changes === 0) {
    throw new Error('EVENT_ALREADY_PROCESSING');
  }

  try {
    // 1. 检查是否过期
    const expiresAt = new Date(event.expires_at + 'Z');
    if (now >= expiresAt) {
      db.prepare(`UPDATE town_npc_events SET processing = 0 WHERE id = ?`).run(event.id);
      await concludeTownNpcEvent(npc, event, event.engaged ? 'completed' : 'expired');
      return null;
    }

    // 用户已成功提交一个有效分支选择，立即延长倒计时，避免分支生成期间事件到期。
    db.prepare(`UPDATE town_npc_events SET expires_at = datetime(expires_at, '+' || ? || ' minutes') WHERE id = ?`)
      .run(branchTimeExtensionMinutes, event.id);
    event.expires_at = db.prepare(`SELECT expires_at FROM town_npc_events WHERE id = ?`).get(event.id).expires_at;

    // 2. 构建 choice_history 文本
    const choiceHistory = JSON.parse(event.choice_history || '[]');
    const historyText = choiceHistory.length === 0
      ? `初始场景：${event.description}`
      : choiceHistory.map((h, i) => `第${i + 1}幕：推进「${h.choice_label}」→ ${h.summary}`).join('\n');
    const choiceExtra = choice.choice !== 'C' && choice.customText ? '——' + choice.customText : '';

    const worldSetting = getWorldSetting();
    const jailbreakPrompt = worldSetting
      ? getSystemRulesWithWorld({ roleplay: false })
      : getSystemRules({ roleplay: false });
    const imageRules = getGlobalRule('image_prompt');
    const imageRulesText = imageRules?.rule_content || '';
    const worldIntegrationBlock = worldSetting ? getWorldIntegrationRule('event') : '';
    const worldPenetrationLine = worldSetting
      ? '- **严格遵循<world_setting>**：这个奇遇发生在上述<world_setting>中，不是发生在真空或现实世界中。所有感官细节和角色反应必须忠实地在<world_setting>规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被<world_setting>重新塑造。\n'
      : '';
    const { playerName, playerAppearance } = townPlayerInfo(db);
    const displayName = npc.display_name;

    const branchImagePromptInstruction = imageRulesText
      || `描述小镇场景、${displayName}的外观、${playerName}的外观、动作与氛围`;
    const twoPersonNote = twoPersonImageNote(npc, playerName, playerAppearance);
    const weatherNote = getLightNoteWithWeather(now);
    const weatherHint = weatherNote ? `\n\nEnvironment reference：${weatherNote}。` : '';

    const formatPrompt = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{
  "description": "选择后的场景叙述，承接上一个选择的结果，展现两人此刻的即时感受和新出现的局面，玩家${playerName}和${displayName}必须同时出现在现场。场景转折要出乎意料但又在情理之中（80-150字）。采用紧密第三人称，始终贴着现场中两人的感知与动作。结尾停在『必须做出选择之前』，留下悬念。行动需要符合当前天气和时间，但禁止直接提及天气时间。",
  "prompt": "${branchImagePromptInstruction}${weatherHint}${twoPersonNote}",
  "choiceA": "新选项A（具体行动，8-15字。是玩家${playerName}和${displayName}接下来真的会一起做的事）",
  "choiceB": "新选项B（与A形成真正的行动对比，把奇遇往意料之外但符合小镇日常的情况发展。8-15字）"
}`;

    const directorPrompt = `事件标题：${event.title}
${historyText}

**核心要求——让分支有趣**：接下来的场景不能是"选了A所以A发生了"的平铺直叙。读者选择之后应该经历一个"没想到会这样——但仔细一想确实合理"的转折。

**剧情推进（必须发生）**：${choice.label}${choiceExtra}

请以紧密第三人称创作选择之后发生的下一个场景。场景长度 80-150 字。`;

    const prevSceneBlock = event.prompt
      ? `\n\n【上一幕画面 · 仅参考环境】\n${event.prompt}`
      : '';

    const msgs = [
      { role: 'system', content: jailbreakPrompt },
      ...(worldIntegrationBlock ? [{ role: 'system', content: worldIntegrationBlock }] : []),
      { role: 'system', content: formatPrompt },
      { role: 'system', content: `你正在为小镇镇民「${displayName}」与玩家「${playerName}」的共同奇遇生成下一幕——上一幕中玩家做出了选择，现在展现选择之后发生的事情，选择已经完成，描述的是选择的结果。${displayName}的行为必须贴合ta的人格与小镇岗位职责。
${event.event_type_key === TOWN_NPC_AMBIENT_EVENT_TYPE_KEY && event.current_branch === 0
    ? `\n这是由镇民自发场景升级成的奇遇：开场时玩家${playerName}还在画面之外，现在${playerName}刚按选项介入现场——本幕要自然描写${playerName}走进这一幕的衔接，之后的画面里${playerName}与${displayName}同框。`
    : ''}

${worldPenetrationLine}
【天气约束】description中行动需要符合当前天气和时间，但禁止直接提及天气时间` },
      // 与角色奇遇分支同款：人格卡作为稳定 system 段在每一幕都注入
      { role: 'system', content: `以下是小镇镇民「${displayName}」的资料，供你参考ta的外貌、身份和行为模式：

${npcPersonaBlock(npc, playerName, playerAppearance)}` },
      { role: 'user', content: worldSetting
        ? `请遵循当前<world_setting>来推进奇遇，镇民资料如果和<world_setting>有冲突，则以<world_setting>最高优先级。\n\n${directorPrompt}${prevSceneBlock}`
        : directorPrompt + prevSceneBlock },
    ];

    let branchData = null;
    let rawBranchResult = '';
    const MAX_BRANCH_ATTEMPTS = 3;
    let lastBranchError = null;
    for (let attempt = 1; attempt <= MAX_BRANCH_ATTEMPTS; attempt++) {
      rawBranchResult = '';
      try {
      rawBranchResult = await chatSync(msgs, { temperature: 0.7, max_tokens: 4096, response_format: { type: 'json_object' }, label: '镇民奇遇分支' });
      const jsonStr = extractFirstJson(rawBranchResult);
      if (!jsonStr) throw new Error('No JSON found in LLM response');
      const parsed = JSON.parse(repairJson(jsonStr));
      if (!parsed.description || !parsed.choiceA || !parsed.choiceB) throw new Error('Incomplete branch data');
      branchData = parsed;
      branchData.prompt = branchData.prompt || branchData.imagePrompt || event.prompt;
      break;
      } catch (err) {
        lastBranchError = err;
        console.warn(`[townNpcEventGen] Branch attempt ${attempt}/${MAX_BRANCH_ATTEMPTS} failed:`, err.message);
        console.log(`[townNpcEventGen] Raw branch LLM response (attempt ${attempt}):\n${rawBranchResult}`);
      }
    }

    if (!branchData) {
      console.error('[townNpcEventGen] Branch generation failed after 3 attempts, reverting to pre-choice state:', lastBranchError?.message);
      db.prepare(`UPDATE town_npc_events SET processing = 0 WHERE id = ?`).run(event.id);
      return db.prepare(`SELECT * FROM town_npc_events WHERE id = ?`).get(event.id);
    }

    // 3. 生图
    const originalBranchPrompt = branchData.prompt;
    let imageUrl = null;
    try {
      const genResult = await generateImageRaw(branchData.prompt, {
        ragQuery: branchData.description || event.description,
        artist: config.comfyui.eventArtist,
        width: config.comfyui.eventWidth,
        height: config.comfyui.eventHeight, scene: 'schedule', workflowScene: 'events',
        priority: 'high',
      });
      if (genResult.success && genResult.images.length > 0) {
        branchData.prompt = genResult.promptRefined || branchData.prompt;
        const img = genResult.images[0];
        const filename = `town_event_${Date.now()}_${img.filename || 'comfy.png'}`;
        imageUrl = saveBase64Image('events', filename, img.base64);
        recordCompletedImageTask({
          conversationId: `town_npc_${npc.id}_event_${event.id}_branch_${event.current_branch + 1}`,
          promptOriginal: originalBranchPrompt,
          promptRefined: branchData.prompt,
          outputPaths: [imageUrl],
          style: config.comfyui.eventArtist,
          resolution: `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
          workflowTemplate: genResult.wfMode,
          db,
        });
        console.log(`[townNpcEventGen] Branch image generated: ${imageUrl}`);
      }
    } catch (err) {
      console.error(`[townNpcEventGen] Branch image generation failed:`, err.message);
    }

    // 4. 更新 choice_history（存储上一步选项，供撤回恢复）
    const newChoiceEntry = {
      branch: event.current_branch + 1,
      choice_label: choice.label,
      choice_text: choice.customText || '',
      summary: branchData.description,
      image: imageUrl,
      prev_choice_a: event.choice_a,
      prev_choice_b: event.choice_b,
      prev_choice_c_label: event.choice_c_label || '自由行动',
      prev_prompt: event.prompt || '',
    };
    choiceHistory.push(newChoiceEntry);

    db.prepare(`
    UPDATE town_npc_events SET
      description = ?, image = ?, prompt = ?,
      choice_a = ?, choice_b = ?, choice_c_label = ?,
      current_branch = ?, choice_history = ?,
      engaged = 1, processing = 0, last_interaction_at = datetime('now')
    WHERE id = ?
  `).run(
      branchData.description, imageUrl, branchData.prompt,
      branchData.choiceA, branchData.choiceB, '自由行动',
      event.current_branch + 1, JSON.stringify(choiceHistory),
      event.id,
    );

    const updatedEvent = db.prepare(`SELECT * FROM town_npc_events WHERE id = ?`).get(event.id);
    broadcastEventUpdate(townNpcEventDto(updatedEvent));
    return updatedEvent;
  } catch (err) {
    db.prepare(`UPDATE town_npc_events SET processing = 0 WHERE id = ?`).run(event.id);
    throw err;
  }
}

// ── 结局 ──

/**
 * 把镇民奇遇移入历史表并广播（不调 LLM）。
 * 时间到了就直接结题、玩家未参与的际遇不写文学性结局，也不需要任何模型开销。
 */
export function expireTownNpcEvent(npc, event, outcome = 'expired') {
  const db = getDb();
  const { playerName } = townPlayerInfo(db);
  const displayName = npc.display_name;
  const conclusionData = {
    conclusion: event.engaged
      ? `故事告一段落。${displayName}和${playerName}从这次经历中各有收获。`
      : `这个偶然的际遇悄然结束，没有留下太多痕迹。`,
    summary: `${displayName}和${playerName}经历了一场"${event.title}"——${event.description}。结局：${outcome === 'completed' ? '事件顺利完成。' : '事件因时间流逝而自然结束。'}`,
  };
  return archiveNpcEvent(npc, event, outcome, conclusionData);
}

/** 归档：移入 town_npc_event_history（保留原始 ID）并广播结局 */
function archiveNpcEvent(npc, event, outcome, conclusionData) {
  const db = getDb();
  const { playerName } = townPlayerInfo(db);
  const displayName = npc.display_name;
  db.transaction(() => {
    db.prepare(`
    INSERT INTO town_npc_event_history (id, npc_id, event_type_key, title, description, final_image, summary, conclusion,
      choice_history, total_branches, engaged, outcome, world_id, world_epoch, location_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
      event.id,
      npc.id, event.event_type_key,
      event.title, event.description, event.image,
      conclusionData.summary,
      conclusionData.conclusion || null,
      event.choice_history, event.current_branch || 0,
      event.engaged, outcome,
      event.world_id, event.world_epoch, event.location_key,
      event.created_at,
    );
    db.prepare(`DELETE FROM town_npc_events WHERE id = ?`).run(event.id);
  }).immediate();

  broadcastEventConclusion({
    event_id: townNpcEventRef(event.id),
    npc_event: true,
    character_id: null,
    npc_id: npc.id,
    character_name: displayName,
    event_title: event.title,
    conclusion: conclusionData.conclusion,
    summary: conclusionData.summary,
    outcome,
    engaged: event.engaged,
  });
  console.log(`[townNpcEventGen] Event archived: "${event.title}" → ${outcome}`);
  return { ...conclusionData, outcome };
}

/**
 * 生成结局并移入历史表（镇民无记忆系统，不写记忆）
 */
export async function concludeTownNpcEvent(npc, event, outcome, deps = {}) {
  const db = getDb();
  const chatSync = deps.llm?.chatSync || defaultChatSync;
  console.log(`[townNpcEventGen] Concluding event "${event.title}" for ${npc.display_name} (engaged=${event.engaged}, outcome=${outcome})`);

  const worldSetting = getWorldSetting();
  const permissionPrompt = worldSetting ? getSystemRulesWithWorld() : getSystemRules();
  const worldIntegrationNote = worldSetting ? getWorldIntegrationRule('eventConclusion') : null;
  const worldConsistencyLine = worldSetting
    ? '- **<world_setting>一致性**：结局和摘要必须反映<world_setting>的基本规则。\n'
    : '';
  const { playerName, playerAppearance } = townPlayerInfo(db);
  const displayName = npc.display_name;

  const choiceHistory = JSON.parse(event.choice_history || '[]');
  const historyText = choiceHistory.length > 0
    ? choiceHistory.map((h, i) => `第${i + 1}步：${h.choice_label} → ${h.summary}`).join('\n')
    : `两人经历了：${event.description}（未与玩家互动）`;

  const taskPrompt = `为以下小镇镇民与玩家${playerName}的共同奇遇写一段结局。
事件标题：${event.title}
${historyText}
当前场景：${event.description}

这是写给读者看的小说结尾，不是事件总结。要求：
${worldConsistencyLine}- 【叙事视角·最高优先级】全程第三人称叙事：镇民主语用「${displayName}」或「她/他」，玩家主语用「${playerName}」，叙事部分严禁出现「我」「我的」「我们」等第一人称称谓（唯一例外是台词引号内）
- 只聚焦 1~2 个最有戏的瞬间展开，其余经过一笔带过或不写；严禁按时间顺序复述全程的流水账写法
- 至少三分之一篇幅是"人味"：镇民的内心吐槽、和环境的一点小摩擦、或一个出乎意料的小细节
- 结尾用一句台词或一个小动作收束，留点余韵；禁止"就这样结束了"式的总结句
- 结局叙述 100~180 字，将直接展示在页面上，作为事件的正式收尾
- 摘要 100~180 字，第三人称客观记录整个事件的起因、经过、转折和结果（保持客观简洁即可，无需文学性）

**重要：输出严格 JSON 格式，不要输出任何解释或 JSON 以外的文字**
{"conclusion":"结局叙述（全程第三人称，叙事部分禁止出现「我」，仅台词引号内可例外）","summary":"事件摘要（第三人称，包含完整的事件经过）"}`;

  const msgs = [
    { role: 'system', content: permissionPrompt },
    ...(worldIntegrationNote ? [{ role: 'system', content: worldIntegrationNote }] : []),
    { role: 'system', content: `以下是小镇镇民「${displayName}」的资料，供你参考ta的外貌、身份和行为模式：\n\n${npcPersonaBlock(npc, playerName, playerAppearance)}` },
    { role: 'user', content: worldSetting
      ? `请遵循当前<world_setting>来收束奇遇。\n\n${taskPrompt}`
      : taskPrompt },
  ];

  let conclusionData;
  try {
    const result = await chatSync(msgs, { temperature: 0.7, max_tokens: 1024, response_format: { type: 'json_object' }, label: '镇民奇遇结局' });
    const jsonStr = extractFirstJson(result);
    if (!jsonStr) throw new Error('No JSON found');
    conclusionData = JSON.parse(repairJson(jsonStr));
    if (!conclusionData.summary) throw new Error('No summary generated');
  } catch (err) {
    console.error(`[townNpcEventGen] Conclusion generation failed:`, err.message);
    conclusionData = {
      conclusion: event.engaged
        ? `故事告一段落。${displayName}和${playerName}从这次经历中各有收获。`
        : `这个偶然的际遇悄然结束，没有留下太多痕迹。`,
      summary: `${displayName}和${playerName}经历了一场"${event.title}"——${event.description}。结局：${outcome === 'completed' ? '事件顺利完成。' : '事件因时间流逝而自然结束。'}`,
    };
  }

  console.log(`[townNpcEventGen] Event concluded: "${event.title}" → ${outcome}`);
  return archiveNpcEvent(npc, event, outcome, conclusionData);
}
