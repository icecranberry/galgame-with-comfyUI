/**
 * 生活片段生成器
 *
 * EVENT_TYPES 描述的是"角色今天的生活进入了哪一种状态"，不是"发生了什么剧情"。
 *
 * 设计理念：
 *   - desc：描述"此刻是什么状态，不需要发生什么特别的事"
 *   - funFrom：这段生活的观看趣味来源（日常感/观察视角/身体感……）
 *   - 所有具体物品/地点/人物/动作均由 LLM 根据角色人格+世界观自由创作
 *
 * - generateEvent(): LLM 结合角色人格+世界观，截取生活片段 + 配图
 * - generateNextBranch(): 用户选择后自然接续 + 配图
 * - concludeEvent(): 到期/完成后生成结局，存入记忆
 */

import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../db/index.js';
import { appendOathRing } from './oathUtils.js';
import { chatSync } from '../llm/llm-client.js';
import { generateImageRaw } from './imageSkill.js';
import { charArtistOverrideWithFallback } from './characterImageOpts.js';
import { recordCompletedImageTask } from './imageTaskRecorder.js';
import { saveBase64Image } from './imagePaths.js';
import { config } from '../config.js';
import { broadcastNewEvent, broadcastEventUpdate, broadcastEventConclusion } from './eventNotificationBus.js';
import { applyMemoryActions, softDeleteMemory } from './memory/memoryRepository.js';
import { getMemorySettings } from './memory/memoryConfig.js';
import { getCurrentActivity } from './scheduleManager.js';
import { getTimeTag, getLightNoteWithWeather } from './timeLight.js';
import { matchAll } from './characterSearch.js';
import { getWorldIntegrationRule } from '../builtinRules.js';

// ── 生活片段类型库（事件类型存于 event_types 表，见 db/index.js 的 seedEventLibraries）──
// 每个类型描述的是"角色今天的生活进入了哪一种状态"，不是"发生了什么剧情"。
// 系统默认条目在启动时种入；用户可在「事件库管理」弹窗中编辑/删除/生成自定义条目。
// LLM 结合角色人格+世界观+当前时间，在这个状态中截取属于该角色的具体的一分钟。
// 事件结束=镜头切走，角色的人生不会有任何变化

/**
 * 读取全部可用的事件类型（来源：event_types 表）
 * @param {object} [db] - better-sqlite3 实例
 * @returns {Array<{ id, key, name, durationMin, urgency, funFrom, desc }>}
 */
export function getAllEventTypes(db = getDb()) {
  const rows = db.prepare(
    `SELECT id, key, name, duration_min AS durationMin, urgency, fun_from AS funFrom, desc
     FROM event_types WHERE is_active = 1 ORDER BY id`
  ).all();
  for (const row of rows) {
    try { row.funFrom = JSON.parse(row.funFrom || '[]'); }
    catch { row.funFrom = []; }
  }
  return rows;
}

/**
 * 按 key 查找事件类型
 */
export function findEventTypeByKey(eventTypeKey, db = getDb()) {
  const row = db.prepare(
    `SELECT id, key, name, duration_min AS durationMin, urgency, fun_from AS funFrom, desc
     FROM event_types WHERE key = ? AND is_active = 1 LIMIT 1`
  ).get(eventTypeKey);
  if (!row) return null;
  try { row.funFrom = JSON.parse(row.funFrom || '[]'); }
  catch { row.funFrom = []; }
  return row;
}

/**
 * 根据角色条件筛选可用的事件类型
 * 目前全部可用，后续可以根据好感度/标签过滤
 */
function getAvailableEventTypes(character, db) {
  return getAllEventTypes(db);
}

// 生活片段类别 → VAD 情绪偏移（被 chat.js 情绪引擎消费，纯规则零 LLM 开销）
// 正值=提升(V愉悦/A兴奋/D支配感)，负值=降低，范围 [-0.15, +0.15]
// 原则：日常小事不会让情绪剧烈波动，所有偏移量控制在轻度范围
const EVENT_VAD_MODIFIERS = {
  // ═══ 晨间片段 ═══ — 偏安静，轻微启动
  morning_start:        { valence: 0.05, arousal:-0.05, dominance: 0.05 },
  getting_ready:        { valence: 0.00, arousal: 0.10, dominance: 0.05 },
  breakfast_moment:     { valence: 0.10, arousal:-0.05, dominance: 0.00 },

  // ═══ 通勤路上 ═══ — 中性偏安静
  commuting:            { valence: 0.00, arousal:-0.05, dominance: 0.00 },
  wrong_way:            { valence:-0.05, arousal: 0.05, dominance:-0.05 },
  slight_rush:          { valence:-0.10, arousal: 0.15, dominance:-0.10 },

  // ═══ 在学/在工作中 ═══ — 中性到轻微波动
  at_work:              { valence: 0.00, arousal: 0.00, dominance: 0.05 },
  on_break:             { valence: 0.05, arousal:-0.10, dominance: 0.00 },
  stuck_moment:         { valence:-0.10, arousal: 0.05, dominance:-0.10 },
  finished_early:       { valence: 0.15, arousal: 0.10, dominance: 0.10 },

  // ═══ 购物消费 ═══
  buying_something:     { valence: 0.05, arousal: 0.00, dominance: 0.05 },
  trying_new:           { valence: 0.10, arousal: 0.10, dominance: 0.05 },
  good_deal:            { valence: 0.15, arousal: 0.10, dominance: 0.10 },
  just_browsing:        { valence: 0.05, arousal:-0.05, dominance: 0.05 },

  // ═══ 天气变化 ═══
  weather_change:       { valence: 0.00, arousal: 0.05, dominance:-0.05 },
  caught_in_rain:       { valence:-0.10, arousal: 0.10, dominance:-0.10 },

  // ═══ 社交碎片 ═══
  ran_into_friend:      { valence: 0.05, arousal: 0.10, dominance: 0.05 },
  brief_interaction:    { valence: 0.00, arousal: 0.00, dominance: 0.00 },
  got_a_message:        { valence: 0.10, arousal: 0.10, dominance: 0.05 },
  overheard_talk:       { valence: 0.00, arousal: 0.05, dominance: 0.00 },

  // ═══ 一点小情绪 ═══
  sudden_craving:       { valence: 0.10, arousal: 0.10, dominance: 0.10 },
  small_nostalgia:      { valence: 0.05, arousal:-0.05, dominance: 0.00 },
  mild_frustration:     { valence:-0.10, arousal: 0.05, dominance:-0.05 },
  little_lift:          { valence: 0.15, arousal: 0.10, dominance: 0.10 },
  random_thought:       { valence: 0.00, arousal: 0.00, dominance: 0.00 },

  // ═══ 兴趣爱好 ═══
  doing_hobby:          { valence: 0.15, arousal: 0.00, dominance: 0.15 },
  found_interesting:    { valence: 0.10, arousal: 0.10, dominance: 0.10 },
  planning_something:   { valence: 0.10, arousal: 0.05, dominance: 0.10 },

  // ═══ 临时决定 ═══
  changed_mind:         { valence: 0.00, arousal: 0.05, dominance: 0.10 },
  taking_a_minute:      { valence: 0.05, arousal:-0.10, dominance: 0.05 },
  going_long_way:       { valence: 0.10, arousal: 0.00, dominance: 0.10 },

  // ═══ 小幸运/小倒霉 ═══
  just_in_time:         { valence: 0.15, arousal: 0.15, dominance: 0.10 },
  small_inconvenience:  { valence:-0.05, arousal: 0.05, dominance:-0.05 },
  cant_find_thing:      { valence:-0.10, arousal: 0.10, dominance:-0.10 },
  forgot_thing:         { valence:-0.10, arousal: 0.10, dominance:-0.10 },
  awkward_small:        { valence:-0.05, arousal: 0.10, dominance:-0.05 },

  // ═══ 身体感 ═══
  body_moment:          { valence:-0.05, arousal: 0.00, dominance: 0.00 },
  mirror_moment:        { valence: 0.00, arousal: 0.00, dominance: 0.05 },

  // ═══ 注意到什么 ═══
  noticed_detail:       { valence: 0.05, arousal: 0.05, dominance: 0.00 },
  animal_moment:        { valence: 0.15, arousal: 0.05, dominance: 0.05 },
  season_signal:        { valence: 0.05, arousal: 0.00, dominance: 0.00 },
  odd_little:           { valence: 0.00, arousal: 0.05, dominance: 0.00 },

  // ════════════════════════════════════════════════════════
  // 剧情向事件 VAD（与原日常片段偏移量共存）
  // ════════════════════════════════════════════════════════

  // ═══ 日常节奏被打乱 ═══ — V:[-0.15,0], A:[+0.1,+0.35], D:[-0.15,0]
  routine_broken:        { valence:-0.10, arousal: 0.20, dominance:-0.10 },
  running_late:          { valence:-0.15, arousal: 0.35, dominance:-0.15 },
  lost_something:        { valence:-0.10, arousal: 0.15, dominance:-0.10 },
  something_broke:       { valence:-0.15, arousal: 0.25, dominance:-0.15 },

  // ═══ 人际交集 ═══ — 混合：好奇/压力/失控
  stranger_approach:     { valence:-0.10, arousal: 0.25, dominance:-0.15 },
  witness_moment:        { valence:-0.15, arousal: 0.35, dominance:-0.15 },
  put_on_spot:           { valence:-0.25, arousal: 0.35, dominance:-0.30 },

  // ═══ 机会与诱惑 ═══ — 正面为主，带不确定性
  unexpected_offer:      { valence: 0.15, arousal: 0.25, dominance: 0.10 },
  found_item:            { valence: 0.10, arousal: 0.25, dominance: 0.05 },
  tempting_path:         { valence: 0.10, arousal: 0.20, dominance: 0.15 },

  // ═══ 小危机 ═══ — 高压、负价
  mistake_looming:       { valence:-0.30, arousal: 0.35, dominance:-0.25 },
  caught_awkward:        { valence:-0.30, arousal: 0.35, dominance:-0.30 },
  emergency_minor:       { valence:-0.25, arousal: 0.45, dominance:-0.15 },

  // ═══ 新鲜事与发现 ═══
  overheard_info:        { valence:-0.15, arousal: 0.25, dominance:-0.10 },
  new_curiosity:         { valence: 0.25, arousal: 0.20, dominance: 0.10 },

  // ═══ 两难与冒险 ═══
  two_fires:             { valence:-0.30, arousal: 0.35, dominance:-0.25 },
  leap_of_faith:         { valence: 0.10, arousal: 0.30, dominance: 0.15 },
  someone_needs_help:    { valence:-0.10, arousal: 0.25, dominance: 0.05 },

  // ═══ 一个人的道德瞬间 ═══ — 内疚/诱惑/责任，静水深流
  broke_something_secret:{ valence:-0.25, arousal: 0.30, dominance:-0.15 },
  forbidden_to_look:     { valence: 0.10, arousal: 0.25, dominance: 0.10 },

  // ═══ 日常里的异物 ═══ — 好奇+兴奋，"世界比想的大"
  flea_market_find:      { valence: 0.25, arousal: 0.25, dominance: 0.15 },
  mystery_vial:          { valence: 0.15, arousal: 0.30, dominance: 0.10 },
  phantom_shop:          { valence: 0.25, arousal: 0.30, dominance: 0.15 },
  vending_mystery:       { valence: 0.15, arousal: 0.25, dominance: 0.05 },

  // ═══ 喜讯降临 ═══ — 纯粹愉悦：V全正、A中高、D全正
  unexpected_approval:   { valence: 0.30, arousal: 0.30, dominance: 0.20 },
  public_recognition:    { valence: 0.25, arousal: 0.20, dominance: 0.25 },
  surprise_invitation:   { valence: 0.25, arousal: 0.30, dominance: 0.15 },
  second_chance_news:    { valence: 0.25, arousal: 0.25, dominance: 0.15 },
  lucky_timing:          { valence: 0.25, arousal: 0.35, dominance: 0.15 },
  mystery_blessing:      { valence: 0.20, arousal: 0.20, dominance: 0.10 },

  // ═══ 其他 ═══
  pressed_it:            { valence:-0.05, arousal: 0.40, dominance:-0.10 },
  weather_trap:          { valence:-0.05, arousal: 0.15, dominance:-0.15 },
  dare_accepted:         { valence: 0.10, arousal: 0.35, dominance: 0.15 },
};
/**
 * 根据事件类型 key 获取对应的 VAD 情绪偏移量
 * @param {string} eventTypeKey
 * @returns {{ valence: number, arousal: number, dominance: number } | null}
 */
export function getEventVadModifier(eventTypeKey) {
  return EVENT_VAD_MODIFIERS[eventTypeKey] || null;
}

export function getUrgencyLevel(eventTypeKey) {
  const found = findEventTypeByKey(eventTypeKey);
  return found ? found.urgency : 1;
}

/**
 * 生成特殊事件
 *
 * @param {object} character - 角色行
 * @param {object} [options] - 可选参数
 * @param {string} [options.eventTypeKey] - 指定事件类型 key（不指定则随机）
 * @param {boolean} [options.manual] - 是否为手动触发（调试用）
 */
export async function generateEvent(character, options = {}) {
  const db = getDb();
  const now = new Date();

  // 1. 选事件类型
  const available = getAvailableEventTypes(character, db);
  let eventType;
  if (options.eventTypeKey) {
    eventType = available.find(e => e.key === options.eventTypeKey);
    if (!eventType) throw new Error(`Unknown event type: ${options.eventTypeKey}`);
  } else if (options.customPrompt) {
    // 用户自定义事件动机：跳过随机选类型，使用自定义提示
    eventType = {
      key: 'custom',
      name: '自定义事件',
      durationMin: 60,
      urgency: 1,
      desc: options.customPrompt,
    };
    console.log(`[eventGen] Custom event for ${character.display_name}: "${options.customPrompt.slice(0, 60)}..."`);
  } else {
    eventType = available[Math.floor(Math.random() * available.length)];
  }

  // 2. 并发保护：检查该角色是否已有活跃事件
  const existing = db.prepare(
    `SELECT id FROM character_events WHERE character_id = ? AND status IN ('pending','open','engaged') LIMIT 1`
  ).get(character.id);
  if (existing) {
    console.log(`[eventGen] ${character.display_name} already has an active event (id=${existing.id})`);
    throw new Error('ALREADY_ACTIVE_EVENT');
  }

  // 3. 构建上下文
  // 最近 1h 朋友圈
  const recentMoment = db.prepare(`
    SELECT content FROM moment_posts
    WHERE character_id = ? AND status = 'done'
      AND created_at >= datetime('now', '-1 hour')
    ORDER BY created_at DESC LIMIT 1
  `).get(character.id);

  // 角色关系网
  const relationships = db.prepare(`
    SELECT cr.relationship_text, c.display_name
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
  `).all(character.id);

  // 多人关系：sigmoid 模型，照搬朋友圈算法但降低频率
  // P(多人) = P_min + (P_max - P_min) / (1 + e^(-k * (R - R_mid)))
  const relCount = relationships.length;
  const MULTI_P_MIN = 0.50;  // 最低多人概率
  const MULTI_P_MAX = 0.80;  // 社交达人趋于 50%
  const MULTI_K = 1.0;       // 陡峭度
  const MULTI_R_MID = 5;     // 拐点：R=5 时概率 = 30%

  let multiPerson = null;
  if (relCount > 0) {
    const multiProb = MULTI_P_MIN + (MULTI_P_MAX - MULTI_P_MIN) / (1 + Math.exp(-MULTI_K * (relCount - MULTI_R_MID)));
    console.log(`[eventGen] ${character.display_name} relCount=${relCount}, multiProb=${(multiProb * 100).toFixed(0)}%`);

    if (Math.random() < multiProb) {
      const allRels = db.prepare(`
        SELECT cr.relationship_text,
               c.id AS other_id, c.display_name AS other_name, c.base_prompt AS other_prompt, c.short_prompt AS other_short
        FROM character_relationships cr
        JOIN characters c ON c.id = cr.to_character_id
        WHERE cr.from_character_id = ? AND cr.relationship_text != ''
      `).all(character.id);

      const picked = allRels[Math.floor(Math.random() * allRels.length)];
      const otherShort = picked.other_short || '';
      const base = picked.other_prompt || '';
      const appMatch = base.match(/##\s*你的外观/);
      const appSection = appMatch ? base.slice(appMatch.index).replace(/你/g, picked.other_name) : '';
      const otherPersona = [otherShort, appSection].filter(Boolean).join('\n');

      // 查反向关系，双向注入
      const reverseRel = db.prepare(`
        SELECT relationship_text FROM character_relationships
        WHERE from_character_id = ? AND to_character_id = ? AND relationship_text != ''
      `).get(picked.other_id, character.id);

      let relDesc = `${character.display_name}是${picked.other_name}的${picked.relationship_text}`;
      if (reverseRel) {
        relDesc += `，${picked.other_name}是${character.display_name}的${reverseRel.relationship_text}`;
      }

      multiPerson = {
        otherId: picked.other_id,
        otherName: picked.other_name,
        otherPersona,
        relDesc,
      };
      console.log(`[eventGen] Multi-person event: ${character.display_name} + ${picked.other_name} (${relDesc})`);
    }
  }

  // 4. 生成初始场景
  const worldSetting = getWorldSetting();
  const jailbreakPrompt = worldSetting
    ? getSystemRulesWithWorld({ roleplay: false })
    : getSystemRules({ roleplay: false });
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  const timeTag = getTimeTag(now, false);

  let contextBlock = '';
  if (recentMoment) {
    contextBlock += `\n关联线索——${character.display_name}一小时前刚发了朋友圈："${recentMoment.content}"。事件素材可以与此呼应，提高关联性。\n`;
  }

  // 将角色人格中的"你"替换为角色名（保留引号内对话不变，简单正则处理）
  const displayName = character.display_name;
  let personaText = character.base_prompt.replace(/你/g, displayName);

  // 誓约角色：银白细戒指外观细节
  const ringUserName1 = config.user?.nickname || 'user';
  personaText = appendOathRing(personaText, character.id, ringUserName1, { isFirstPerson: false, charName: displayName });

  // [0] 第三人称叙事声明 + jailbreak + 世界观（有世界观时注入整合指令，无世界观时跳过）
  const worldIntegrationBlock = worldSetting
    ? getWorldIntegrationRule('event')
    : '';

  // 日程注入：获取角色当前活动，让事件起点与当前活动自然衔接
  let scheduleContextLine = '';
  let scheduleSystemBlock = '';
  try {
    if (config.features.schedule !== false) {
      const currentActivity = getCurrentActivity(character.id);
      if (currentActivity && currentActivity.activity !== '自由时间') {
        scheduleContextLine = `此时${displayName}正在${currentActivity.location}${currentActivity.activity}。`;
        const descPart = currentActivity.description ? `——${currentActivity.description}` : '';
        scheduleSystemBlock = `\n【当前日程】${displayName}正在【${currentActivity.location}】${currentActivity.activity}${descPart}。`;
      }
    }
  } catch { /* schedule not available */ }

  const worldPenetrationLine = worldSetting
    ? (eventType.key === 'custom'
        ? '- **严格遵循世界观**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。用户指定的事件方向是本次事件的核心，必须直接发生；世界观重塑的是它的呈现方式，而不是替换它。\n'
        : '- **严格遵循世界观**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被世界观重新塑造。\n')
    : '';

  // [1] 角色人格（"你"已替换为角色名，去角色扮演化）
  let personaMsg = `以下是角色「${displayName}」的人格设定，供你参考角色的外貌、性格和行为模式：

${personaText}`;

  if (multiPerson) {
    personaMsg += `\n\n---\n以下是${multiPerson.otherName}的人格设定（${multiPerson.relDesc}），供事件涉及多人互动时参考：

${multiPerson.otherPersona}`;
  }

  // [2] JSON 格式
  const multiPersonImageNote = multiPerson
    ? `**多人画面**：prompt 中必须包含${displayName}和${multiPerson.otherName}两个人。描述清楚各自的外观、位置、互动动作。用句号分隔两人描述。`
    : '';

  // image_prompt 规则内容直接作为 prompt 字段的格式指令
  const imagePromptInstruction = imageRulesText
    || '≥8个外观锚点，角色名用character(series)格式';

  const weatherNote = getLightNoteWithWeather(now);
  const weatherHint = weatherNote ? `\n\nEnvironment reference：${weatherNote}。` : '';

  const formatPrompt = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{
  "title": "事件标题事件标题（≤8字，口语感叹。从你刚写完的事件场景里抓最戳人的那个瞬间，用角色第一反应的口吻喊出来——不要给事件'取名'，是替角色喊出ta看到/发现/意识到时脑子里蹦出来的那句话。正确：包裹在动……|谁寄来的？！|钥匙怎么还在她这里。错误：神秘包裹降临|意外来客——这些是在概括事件类型。禁止万能感叹'天哪''不是吧''怎么会'——必须带上这个事件的具体信息点）",
  "description": "场景叙述（80-150字。
不要像讲故事，而像镜头正在发生：
- 行动需要符合当前天气和时间，但禁止直接提及天气时间",
  "prompt": "${imagePromptInstruction}${weatherHint}${multiPersonImageNote}",
  "choiceA": "选项A（具体行动，8-15字。符合${displayName}的性格和当下处境）",
  "choiceB": "选项B（与A形成真正的行动对比——不符合${displayName}的个性，会将事件往意料之外但符合世界观的情况发展。8-15字）"
}

选项设计原则：
- A和B必须是性质完全不同的两条路径——读者感受到它们通往不同的情绪走向
- **但两条路径都必须能从${displayName}的性格和当下处境中自然推出**
- 避免两个"本质上差不多"的选项
- 根据场景选择最合适的对比维度：做vs不做、直面vs绕开、自己解决vs求助、立刻vs等等、坦白vs保留、介入vs旁观`;

  // [3] 创作任务
  const multiPersonNote = multiPerson
    ? `\n**多人事件**：${multiPerson.relDesc}。事件中应包含${multiPerson.otherName}作为互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。`
    : '';

  const funFromNote = eventType.funFrom?.length
    ? `\n\n这件事之所以值得成为一个事件，不是因为它"出了大事"——而是因为它天然带有${eventType.funFrom.join('、')}的张力。叙事时往这些层面用力，让读者感受到"就是这个感觉"。`
    : '';

  const customDirectionHeader = eventType.key === 'custom'
    ? `【用户指定事件方向·最高优先级】**${eventType.desc}**`
    : `事件方向：**${eventType.name}**——${eventType.desc}`;

  const customKeyUnderstanding = eventType.key === 'custom'
    ? `**关键理解**：**「${eventType.desc}」是本次事件的核心，不是可选的出发点**——开场必须让${displayName}直接身处这件事之中，让它在正文里具体地发生（场景、动作、对话都围绕它展开）。世界观、日程、人设决定这件事在${displayName}身上如何发生，但不能把用户点名的事替换成别的活动。`
    : `**关键理解**：上面的事件方向只是一个出发点——不是剧本，里面没有具体场景。把方向翻译成${displayName}今天此刻实际遇到的、不可复制到别人身上的生活切片。`;

  const directorPrompt = `${customDirectionHeader}${funFromNote}
${timeTag}${multiPersonNote}
${scheduleContextLine ? scheduleContextLine : ''}${scheduleSystemBlock || ''}${contextBlock ? '\n关联线索：' + contextBlock.trim() : ''}

${customKeyUnderstanding}

请以紧密第三人称创作这个事件的开场。场景长度 80-150 字。`;


  const msgs = [];

  // [0] Base jailbreak rules — most stable, always cache-hit
  msgs.push({ role: 'system', content: jailbreakPrompt });

    // [2] World integration block — stable per world setting
  if (worldIntegrationBlock) {
    msgs.push({ role: 'system', content: worldIntegrationBlock });
  }

  // [1] JSON format — most stable, always cache-hit (template unchanged, only trailing env ref varies)
  msgs.push({ role: 'system', content: formatPrompt });

  // [3] Director instructions — stable per character
  msgs.push({ role: 'system', content: `你正在为「${displayName}」截取今天生活中的一小段。

【人称】
- 指代角色只用「她」「他」「ta」「${displayName}」，不使用「你」
- 叙述始终贴着角色此刻的感知。读者看到什么、听到什么、注意到什么，都应与角色保持一致，不跳出角色视角解释世界。

【角色定制锁——事件触发器根植于角色独有信息】
- 事件的触发点应与${displayName}的独有信息直接相关——习惯、身份、能力、关系网、正在隐瞒的事、雷点、近期状态的改变、或世界观中独有的属性——至少命中一项

【正文——写现场，不写剧情总结】
正文始终停留在现场，而不是剧情总结。

镜头直接落在一个正在发生的动作上。

背景、关系、原因，都随着动作自然露出来，而不是提前说明。

【结尾——停在行动门槛】
结尾停在一个具体动作即将发生之前。

【schedule 起点锁】
- 事件从${displayName}当前所在的地点、手头在做的事、视线范围内的东西中触发。第一句出现的地点、动作、物件，直接从当前 schedule 场景中承接
- 避免为制造戏剧性，直接把角色挪到另一个无关地点再触发事件

${worldPenetrationLine}
【天气约束】description中行动需要符合当前天气和时间，但禁止直接提及天气时间` });

  // [4] Character persona — stable per character
  msgs.push({ role: 'system', content: personaMsg });

  // [4.5] 自定义事件：用户方向锁定——独立成段，防止方向被淹没在长上下文中
  if (eventType.key === 'custom') {
    msgs.push({ role: 'system', content: `【用户指定事件方向·最高优先级】
本次奇遇由用户手动指定方向：**${eventType.desc}**。

- 开场必须直接落在方向这件事本身上：${displayName}此刻正在做、或正要开始这件事，正文让这件事具体发生（场景、动作、对话全部围绕它展开）。
- 方向里的每个要素都要真实呈现：不能只擦边、暗示、用比喻带过，更不能把用户点名的事替换成别的活动。
- 世界观和日程决定"这件事在${displayName}身上如何发生"，但不能淡化或替换"发生的这件事本身"。
- 若方向与世界观有冲突：保留方向的核心行为，只把它的表现方式融入世界观。` });
  }

  // [user] Event-specific creation task — changes per event（有世界观时开头注入遵循规则）
  const customPreamble = eventType.key === 'custom'
    ? '\n用户手动指定的事件方向必须直接发生——世界观负责塑造它的表现方式，不负责替换它。'
    : '';
  const eventUserContent = worldSetting
    ? `请遵循当前世界观来生成奇遇，角色人设如果和世界观有冲突，则以世界观最高优先级，人设会因为世界观改变。${customPreamble}

${directorPrompt}`
    : directorPrompt;
  msgs.push({ role: 'user', content: eventUserContent });

  let eventData;
  let rawResult = '';
  try {
    rawResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 4096, response_format: { type: 'json_object' }, label: '奇遇生成' });
    const jsonStr = extractFirstJson(rawResult);
    if (!jsonStr) throw new Error('No JSON found in LLM response');
    eventData = JSON.parse(repairJson(jsonStr));
    if (!eventData.title || !eventData.description || !eventData.choiceA || !eventData.choiceB) {
      throw new Error('Incomplete event data from LLM');
    }
    // field 兼容：imagePrompt / prompt 两种写法都接受
    const imagePromptText = eventData.prompt || eventData.imagePrompt;
    eventData.prompt = imagePromptText;
  } catch (err) {
    console.error(`[eventGen] LLM generation failed for ${character.display_name}:`, err.message);
    console.log(`[eventGen] Raw LLM response:\n${rawResult}`);
    throw err;
  }

  // 5. 生图（多人时合并两人 LoRA）
  const selfLoras = _parseCharLoras(character.loras);
  let otherChars = [];
  if (multiPerson) {
    const otherChar = db.prepare('SELECT loras, artist_override FROM characters WHERE id = ?').get(multiPerson.otherId);
    if (otherChar) otherChars = [otherChar];
  }
  const otherLoras = otherChars.flatMap(c => _parseCharLoras(c.loras));
  const allLoras = [...selfLoras, ...otherLoras];

  const originalEventPrompt = eventData.prompt;
  let imageUrl = null;
  try {
    const charArtist = charArtistOverrideWithFallback(character, otherChars);
    const genResult = await generateImageRaw(eventData.prompt, {
      artist: charArtist !== null ? charArtist : config.comfyui.eventArtist,
      width: config.comfyui.eventWidth,
      height: config.comfyui.eventHeight,
      scene: 'events',
      priority: options.manual ? 'high' : 'low',
      loras: allLoras,
      ...(!multiPerson && character.custom_workflow ? { customWorkflow: character.custom_workflow } : {}),
    });
    if (genResult.success && genResult.images.length > 0) {
      eventData.prompt = genResult.promptRefined || eventData.prompt;
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      imageUrl = saveBase64Image('events', filename, img.base64);
      recordCompletedImageTask({
        conversationId: `char_${character.id}_events`,
        promptOriginal: originalEventPrompt,
        promptRefined: eventData.prompt,
        outputPaths: [imageUrl],
        style: charArtist !== null ? charArtist : config.comfyui.eventArtist,
        resolution: `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
        workflowTemplate: genResult.wfMode,
        db,
      });
      console.log(`[eventGen] Image generated for ${character.display_name}: ${imageUrl}`);
    } else {
      console.warn(`[eventGen] Image generation returned no images for ${character.display_name}`);
    }
  } catch (err) {
    console.error(`[eventGen] Image generation failed for ${character.display_name}:`, err.message);
    // 无图片也继续
  }

  // 6. 写入 DB — 初始场景作为 choice_history[0]
  const initialChoiceEntry = [{
    branch: 0,
    choice_label: '事件开始',
    choice_text: '',
    summary: eventData.description,
    image: imageUrl,
    // 存储多人模式信息，供后续分支生成时复用
    multiPerson: multiPerson ? { otherId: multiPerson.otherId, otherName: multiPerson.otherName, otherPersona: multiPerson.otherPersona, relDesc: multiPerson.relDesc } : null,
  }];
  const expiresAt = new Date(now.getTime() + eventType.durationMin * 60 * 1000).toISOString();

  const insertResult = db.prepare(`
    INSERT INTO character_events (character_id, event_type_key, status, title, description, image, prompt, style, resolution, choice_a, choice_b, choice_c_label, current_branch, max_branches, choice_history, expires_at)
    VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(
    character.id,
    eventType.key,
    eventData.title,
    eventData.description,
    imageUrl,
    eventData.prompt,
    config.comfyui.eventArtist,
    `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
    eventData.choiceA,
    eventData.choiceB,
    eventData.choiceCLabel || '自由行动',
    JSON.stringify(initialChoiceEntry),
    toSQLite(expiresAt)
  );
  const eventId = insertResult.lastInsertRowid;

  // 7. 构建返回数据
  const event = db.prepare(`SELECT * FROM character_events WHERE id = ?`).get(eventId);

  // 8. SSE 广播
  broadcastNewEvent({
    id: event.id,
    character_id: event.character_id,
    display_name: character.display_name,
    avatar_path: character.avatar_path || null,
    title: event.title,
    description: event.description,
    image: event.image,
    choice_a: event.choice_a,
    choice_b: event.choice_b,
    choice_c_label: event.choice_c_label,
    expires_at: toISO(event.expires_at),
    created_at: toISO(event.created_at),
    current_branch: event.current_branch,
    choice_history: JSON.parse(event.choice_history || '[]'),
  });

  console.log(`[eventGen] Event created for ${character.display_name}: "${event.title}" (type=${eventType.key}, expires=${expiresAt})`);
  return event;
}

/**
 * 生成下一步分支
 */
export async function generateNextBranch(character, event, choice) {
  const db = getDb();
  const now = new Date();
  const branchTimeExtensionMinutes = 5;

  // 0. 原子性标记处理中（CAS：仅 processing=0 时置 1），防止并发重复提交
  // 如果已有其他请求在处理中，直接抛出错误，避免：
  //   - 两次 LLM 调用浪费 token / 并发生图压垮 ComfyUI
  //   - 浏览器 HTTP/1.1 6 连接限制下，双 choose 请求挤占剩余连接导致其他 API 排队 23s+
  const casResult = db.prepare(
    `UPDATE character_events SET processing = 1 WHERE id = ? AND processing = 0`
  ).run(event.id);
  if (casResult.changes === 0) {
    throw new Error('EVENT_ALREADY_PROCESSING');
  }

  // 1. 检查是否过期
  const expiresAt = new Date(event.expires_at + 'Z');
  if (now >= expiresAt) {
    db.prepare(`UPDATE character_events SET processing = 0 WHERE id = ?`).run(event.id);
    await concludeEvent(character, event, event.engaged ? 'completed' : 'expired');
    return null;
  }

  // 用户已成功提交一个有效分支选择，立即延长倒计时，避免分支生成期间事件到期。
  db.prepare(`
    UPDATE character_events
    SET expires_at = datetime(expires_at, '+' || ? || ' minutes')
    WHERE id = ?
  `).run(branchTimeExtensionMinutes, event.id);
  event.expires_at = db.prepare(
    `SELECT expires_at FROM character_events WHERE id = ?`
  ).get(event.id).expires_at;

  // 2. 加载关系网
  const relationships = db.prepare(`
    SELECT cr.relationship_text, c.display_name
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
  `).all(character.id);

  // 2.5 检查是否为多人模式（从 choice_history[0] 读取初始事件时存储的 multiPerson 数据）
  const choiceHistory = JSON.parse(event.choice_history || '[]');
  const storedMultiPerson = choiceHistory.length > 0 ? choiceHistory[0].multiPerson : null;
  let multiPerson2 = null;
  if (storedMultiPerson) {
    multiPerson2 = {
      otherId: storedMultiPerson.otherId,
      otherName: storedMultiPerson.otherName,
      otherPersona: storedMultiPerson.otherPersona,
      relDesc: storedMultiPerson.relDesc,
    };
  }

  // 3. 构建 choice_history 文本
  let historyText = '';
  if (choiceHistory.length === 0) {
    historyText = `初始场景：${event.description}`;
  } else {
    historyText = choiceHistory.map((h, i) =>
      `第${i + 1}幕：推进「${h.choice_label}」→ ${h.summary}`
    ).join('\n');
  }
  // choice.customText 仅在非 C 选项时作为补充说明；C 选项的 label 已等于 customText
  const choiceExtra = choice.choice !== 'C' && choice.customText ? '——' + choice.customText : '';

  // 4. LLM 生成下一步（try-catch 确保失败时清除 processing 标记）
  try {
  const worldSetting2 = getWorldSetting();
  const jailbreakPrompt = worldSetting2
    ? getSystemRulesWithWorld({ roleplay: false })
    : getSystemRules({ roleplay: false });
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  const weatherNote = getLightNoteWithWeather(now);
  const weatherHint = weatherNote ? `\n\nEnvironment reference：${weatherNote}。` : '';
  const timeTag2 = getTimeTag(now, false);

  const displayName2 = character.display_name;
  let personaText2 = character.base_prompt.replace(/你/g, displayName2);

  // 誓约角色：银白细戒指外观细节
  const ringUserName2 = config.user?.nickname || 'user';
  personaText2 = appendOathRing(personaText2, character.id, ringUserName2, { isFirstPerson: false, charName: displayName2 });

  const worldIntegrationBlock2 = worldSetting2
    ? getWorldIntegrationRule('event')
    : '';

  const worldPenetrationLine2 = worldSetting2
    ? '- **严格遵循世界观**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被世界观重新塑造。\n'
    : '';

  let personaMsg2 = `以下是角色「${displayName2}」的人格设定，供你参考角色的外貌、性格和行为模式：

${personaText2}`;

  if (multiPerson2) {
    personaMsg2 += `\n\n---\n以下是${multiPerson2.otherName}的人格设定（${multiPerson2.relDesc}），供事件涉及多人互动时参考：

${multiPerson2.otherPersona}`;
  }

  // 交叉角色引用：从事件上下文中加载被提及的角色信息
  const crossRefIds = JSON.parse(event.referenced_character_ids || '[]');
  let crossRefNames = [];
  if (crossRefIds.length > 0) {
    const crossChars = crossRefIds.map(id =>
      db.prepare('SELECT id, display_name, short_prompt, base_prompt FROM characters WHERE id = ?').get(id)
    ).filter(Boolean);
    if (crossChars.length > 0) {
      crossRefNames = crossChars.map(c => c.display_name);
      const crossBlocks = crossChars.map(c => {
        const parts = [];
        if (c.short_prompt) parts.push(c.short_prompt);
        const base = c.base_prompt || '';
        const m = base.match(/##\s*你的外观/);
        if (m) parts.push(base.slice(m.index).replace(/你/g, c.display_name));
        // 查询角色间关系
        const relParts = [];
        const fwd = db.prepare(
          'SELECT relationship_text FROM character_relationships WHERE from_character_id = ? AND to_character_id = ? AND relationship_text != ?'
        ).get(character.id, c.id, '');
        if (fwd) relParts.push(`${displayName2}是${c.display_name}的${fwd.relationship_text}`);
        const rev = db.prepare(
          'SELECT relationship_text FROM character_relationships WHERE from_character_id = ? AND to_character_id = ? AND relationship_text != ?'
        ).get(c.id, character.id, '');
        if (rev) relParts.push(`${c.display_name}是${displayName2}的${rev.relationship_text}`);
        if (relParts.length > 0) {
          parts.push(`[关系] ${relParts.join('，')}`);
        }
        return `[${c.display_name}]\n${parts.join('\n')}`;
      }).join('\n\n');
      personaMsg2 += `\n\n---\n以下是在当前事件推进中被提及的其他角色信息，必须在生成的分支场景中现身互动：\n\n${crossBlocks}`;
    }
  }

  const branchImagePromptInstruction = imageRulesText
    || '描述场景、角色外观、动作、氛围';

  const allOtherNames = [...new Set([
    ...(multiPerson2 ? [multiPerson2.otherName] : []),
    ...crossRefNames,
  ])];
  const multiPersonImageNote2 = allOtherNames.length > 0
    ? `**多人画面**：prompt 中必须包含${displayName2}和${allOtherNames.join('、')}共${allOtherNames.length + 1}人。描述清楚各自的外观、位置、互动动作。用句号分隔每人描述。`
    : '';

  const formatPrompt2 = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{
  "description": "选择后的场景叙述场景叙述，承接上一个选择的结果，展现角色此刻的即时感受和新出现的局面。场景转折要出乎意料但又在情理之中（80-150字）。

采用紧密第三人称（她/他/ta），始终贴着角色当下的感知与动作，不解释、不总结、不评价。

不要像讲故事，而像镜头正在发生：
- 结尾停在『必须做出选择之前』，留下悬念，不提前进入结果。
- 行动需要符合当前天气和时间，但禁止直接提及天气时间。",
  "prompt": "${branchImagePromptInstruction}${weatherHint}${multiPersonImageNote2}",
  "choiceA": "新选项A（具体行动。必须符合${displayName2}的个性——是ta此刻真的会做出来的事。8-15字）",
  "choiceB": "新选项B（与A形成真正的行动对比——不符合${displayName2}的个性，会将事件往意料之外但符合世界观的情况发展。8-15字）"
}`;

  // 只有多人模式才注入关系信息（和初始事件生成一致）
  const multiNote2 = multiPerson2
    ? `\n**多人事件**：${multiPerson2.relDesc}。事件中应包含${multiPerson2.otherName}作为主要互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。${relationships.map(r => `${displayName2}是${r.display_name}的${r.relationship_text}`).join('；')}`
    : '';

  const eventTypeMeta = findEventTypeByKey(event.event_type_key);
  const funFromNote2 = eventTypeMeta?.funFrom?.length
    ? `\n\n这段生活的质感来自${eventTypeMeta.funFrom.join('、')}——后续中保持这个质感，不用刻意用力。`
    : '';

  const directorPrompt2 = `事件标题：${event.title}
${timeTag2}${historyText}${multiNote2}${funFromNote2}

**核心要求——让分支有趣**：接下来的场景不能是"选了A所以A发生了"的平铺直叙。读者选择之后应该经历一个"没想到会这样——但仔细一想确实合理"的转折。这个转折可以来自：
- 另一个角色的反应方式出乎意料（但符合那个人的人设）

**剧情推进（必须发生）**：${choice.label}${choiceExtra}

请以紧密第三人称创作选择之后发生的下一个场景。场景长度 80-150 字。`;

  // 上一幕画面注入：视觉参考帮助 LLM 保持画面连贯（叙事已有 historyText，此处仅补充视觉信息）
  const prevSceneBlock = event.prompt
    ? `\n\n【上一幕画面 · 仅参考环境】\n${event.prompt}`
    : '';

  const msgs = [];

  // [0] Base jailbreak rules — most stable, always cache-hit
  msgs.push({ role: 'system', content: jailbreakPrompt });

  // [1] World integration block — stable per world setting
  if (worldIntegrationBlock2) {
    msgs.push({ role: 'system', content: worldIntegrationBlock2 });
  }

  // [2] JSON format — most stable, always cache-hit (template unchanged, only trailing env ref varies)
  msgs.push({ role: 'system', content: formatPrompt2 });

  // [3] Branch continuation instructions — stable per character
  msgs.push({ role: 'system', content: `你正在为「${displayName2}」的特殊事件生成下一幕——一段紧密第三人称叙事。上一幕中角色做出了选择，现在展现选择之后发生的事情，选择已经完成，描述的是选择的结果。

${worldPenetrationLine2}
【天气约束】description中行动需要符合当前天气和时间，但禁止直接提及天气时间` });

  // [4] Character persona — stable per character
  msgs.push({ role: 'system', content: personaMsg2 });

  // [user] Branch task（有世界观时开头注入遵循规则）
  const branchUserContent = worldSetting2
    ? `请遵循当前世界观来推进奇遇，角色人设如果和世界观有冲突，则以世界观最高优先级，人设会因为世界观改变。

${directorPrompt2}${prevSceneBlock}`
    : directorPrompt2 + prevSceneBlock;
  msgs.push({ role: 'user', content: branchUserContent });

  let branchData;
  let rawBranchResult = '';
  // 分支结果必须是完整可解析的 JSON；失败最多重试 3 次
  const MAX_BRANCH_ATTEMPTS = 3;
  let lastBranchError = null;
  for (let attempt = 1; attempt <= MAX_BRANCH_ATTEMPTS; attempt++) {
    rawBranchResult = '';
    try {
      rawBranchResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 4096, response_format: { type: 'json_object' }, label: '事件分支' });
      const jsonStr = extractFirstJson(rawBranchResult);
      if (!jsonStr) throw new Error('No JSON found in LLM response');
      branchData = JSON.parse(repairJson(jsonStr));
      const branchPromptText = branchData.prompt || branchData.imagePrompt;
      if (!branchData.description || !branchData.choiceA || !branchData.choiceB) throw new Error('Incomplete branch data');
      branchData.prompt = branchPromptText || event.prompt;
      break;
    } catch (err) {
      lastBranchError = err;
      console.warn(`[eventGen] Branch generation attempt ${attempt}/${MAX_BRANCH_ATTEMPTS} failed:`, err.message);
      console.log(`[eventGen] Raw branch LLM response (attempt ${attempt}):\n${rawBranchResult}`);
    }
  }

  if (!branchData) {
    // 3 次都无法产出有效分支：清除生成中状态，回到用户选择分支之前的状态
    console.error('[eventGen] Branch generation failed after 3 attempts, reverting to pre-choice state:', lastBranchError?.message);
    db.prepare(`UPDATE character_events SET processing = 0 WHERE id = ?`).run(event.id);
    const resetEvent = db.prepare(`SELECT * FROM character_events WHERE id = ?`).get(event.id);
    return resetEvent;
  }

  // 4.5 检测当前事件描述和分支描述中是否提及其他角色
  const branchDescText = (event.description || '') + ' ' + (branchData.description || '');
  const crossRefMatches = matchAll(branchDescText, character.id);
  const filteredMatches = multiPerson2
    ? crossRefMatches.filter(m => m.id !== multiPerson2.otherId)
    : crossRefMatches;
  if (filteredMatches.length > 0) {
    const existing = JSON.parse(event.referenced_character_ids || '[]');
    const merged = [...new Set([...existing, ...filteredMatches.map(c => c.id)])].slice(0, 3);
    db.prepare('UPDATE character_events SET referenced_character_ids = ? WHERE id = ?')
      .run(JSON.stringify(merged), event.id);
    event.referenced_character_ids = JSON.stringify(merged);
  }

  // 5. 生图（合并主角色 + 多人 + 交叉引用角色的 LoRA）
  const branchSelfLoras = _parseCharLoras(character.loras);
  const branchOtherChars = [];
  let branchOtherLoras = [];
  if (multiPerson2) {
    const otherChar = db.prepare('SELECT loras, artist_override FROM characters WHERE id = ?').get(multiPerson2.otherId);
    if (otherChar) { branchOtherChars.push(otherChar); branchOtherLoras = _parseCharLoras(otherChar.loras); }
  }
  let branchCrossRefLoras = [];
  const crossRefIdsForLora = JSON.parse(event.referenced_character_ids || '[]');
  if (crossRefIdsForLora.length > 0) {
    branchCrossRefLoras = crossRefIdsForLora.flatMap(id => {
      const c = db.prepare('SELECT loras, artist_override FROM characters WHERE id = ?').get(id);
      if (c) branchOtherChars.push(c);
      return c ? _parseCharLoras(c.loras) : [];
    });
  }
  const allLoras = [...branchSelfLoras, ...branchOtherLoras, ...branchCrossRefLoras];
  const seen = new Set();
  const branchAllLoras = allLoras.filter(l => {
    if (seen.has(l.path)) return false;
    seen.add(l.path);
    return true;
  });

  const originalBranchPrompt = branchData.prompt;
  let imageUrl = null;
  try {
    const charArtist = charArtistOverrideWithFallback(character, branchOtherChars);
    const genResult = await generateImageRaw(branchData.prompt, {
      artist: charArtist !== null ? charArtist : config.comfyui.eventArtist,
      width: config.comfyui.eventWidth,
      height: config.comfyui.eventHeight, scene: 'events',
      priority: 'high',
      loras: branchAllLoras,
      ...(!multiPerson2 && character.custom_workflow ? { customWorkflow: character.custom_workflow } : {}),
    });
    if (genResult.success && genResult.images.length > 0) {
      branchData.prompt = genResult.promptRefined || branchData.prompt;
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      imageUrl = saveBase64Image('events', filename, img.base64);
      recordCompletedImageTask({
        conversationId: `char_${character.id}_event_${event.id}_branch_${event.current_branch + 1}`,
        promptOriginal: originalBranchPrompt,
        promptRefined: branchData.prompt,
        outputPaths: [imageUrl],
        style: charArtist !== null ? charArtist : config.comfyui.eventArtist,
        resolution: `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
        workflowTemplate: genResult.wfMode,
        db,
      });
      console.log(`[eventGen] Branch image generated: ${imageUrl}`);
    }
  } catch (err) {
    console.error(`[eventGen] Branch image generation failed:`, err.message);
  }

  // 6. 更新 choice_history 和 summary
  // 存储上一步的选项信息，用于撤回（undo）时恢复
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

  // 7. 更新 DB（清除 processing 标记，重置强调标记以便下轮重新通知用户）
  db.prepare(`
    UPDATE character_events SET
      description = ?, image = ?, prompt = ?,
      choice_a = ?, choice_b = ?, choice_c_label = ?,
      current_branch = ?, choice_history = ?,
      engaged = 1, processing = 0, emphasis_delivered = 0, last_interaction_at = datetime('now')
    WHERE id = ?
  `).run(
    branchData.description, imageUrl, branchData.prompt,
    branchData.choiceA, branchData.choiceB, '自由行动',
    event.current_branch + 1, JSON.stringify(choiceHistory),
    event.id
  );

  // 8. 获取更新后的事件（事件只由时间到期结束）
  const updatedEvent = db.prepare(`SELECT * FROM character_events WHERE id = ?`).get(event.id);

  // 10. SSE 广播
  broadcastEventUpdate({
    id: updatedEvent.id,
    character_id: updatedEvent.character_id,
    display_name: character.display_name,
    avatar_path: character.avatar_path || null,
    title: updatedEvent.title,
    description: updatedEvent.description,
    image: updatedEvent.image,
    choice_a: updatedEvent.choice_a,
    choice_b: updatedEvent.choice_b,
    choice_c_label: updatedEvent.choice_c_label,
    current_branch: updatedEvent.current_branch,
    choice_history: JSON.parse(updatedEvent.choice_history || '[]'),
    expires_at: toISO(updatedEvent.expires_at),
    created_at: toISO(updatedEvent.created_at),
  });

    return updatedEvent;
  } catch (err) {
    db.prepare(`UPDATE character_events SET processing = 0 WHERE id = ?`).run(event.id);
    throw err;
  }
}

/**
 * 生成结局并存入记忆
 */
export async function concludeEvent(character, event, outcome) {
  const db = getDb();
  console.log(`[eventGen] Concluding event "${event.title}" for ${character.display_name} (engaged=${event.engaged}, outcome=${outcome})`);

  // 1. LLM 生成结局和摘要
  const worldSetting3 = getWorldSetting();
  const permissionPrompt = worldSetting3
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting3
    ? getWorldIntegrationRule('eventConclusion')
    : null;

  const choiceHistory = JSON.parse(event.choice_history || '[]');
  const historyText = choiceHistory.length > 0
    ? choiceHistory.map((h, i) => `第${i + 1}步：${h.choice_label} → ${h.summary}`).join('\n')
    : `角色经历了：${event.description}（未与用户互动）`;

  const worldConsistencyLine = worldSetting3
    ? '- **世界观一致性**：结局和记忆摘要必须反映世界观的基本规则。角色做出的选择及其后果、环境的反应、事件的收束方式，都必须在世界观框架内自然发生。\n'
    : '';

  const taskPrompt = event.engaged
    ? `为以下特殊事件生成结局叙述和记忆摘要。
事件标题：${event.title}
${historyText}
当前场景：${event.description}

要求：
${worldConsistencyLine}- 结局叙述 80-150 字，收束整个事件的来龙去脉，给故事一个自然的结果
- 记忆摘要 150-300 字，用第三人称视角客观记录整个事件的起因、经过、转折和结果，作为角色长期记忆的一部分

**重要：输出严格 JSON 格式**
{"conclusion":"结局叙述","summary":"记忆摘要（第三人称，包含完整的事件经过）"}`
    : `角色刚刚经历了一场无人参与的特殊事件。请基于事件描述想象它会如何自然结束。
事件标题：${event.title}
${historyText}

要求：
${worldConsistencyLine}- 结局叙述 80-150 字
- 记忆摘要 150-300 字，用第三人称视角客观记录事件

**重要：输出严格 JSON 格式**
{"conclusion":"结局叙述","summary":"记忆摘要（第三人称）"}`;

  const conclusionUserContent = worldSetting3
    ? `请遵循当前世界观来收束奇遇，角色人设如果和世界观有冲突，则以世界观最高优先级，人设会因为世界观改变。

${taskPrompt}`
    : taskPrompt;

  const msgs = [
    { role: 'system', content: permissionPrompt },
    ...(worldIntegrationNote ? [{ role: 'system', content: worldIntegrationNote }] : []),
    { role: 'system', content: character.base_prompt },
    { role: 'user', content: conclusionUserContent },
  ];

  let conclusionData;
  try {
    const result = await chatSync(msgs, { temperature: 0.7, max_tokens: 1024, response_format: { type: 'json_object' }, label: '事件结局' });
    const jsonStr = extractFirstJson(result);
    if (!jsonStr) throw new Error('No JSON found');
    conclusionData = JSON.parse(repairJson(jsonStr));
    if (!conclusionData.summary) throw new Error('No summary generated');
  } catch (err) {
    console.error(`[eventGen] Conclusion generation failed:`, err.message);
    conclusionData = {
      conclusion: event.engaged
        ? `故事告一段落。${character.display_name}从这次经历中有所收获。`
        : `这个偶然的际遇悄然结束，没有留下太多痕迹。`,
      summary: `${character.display_name}经历了一场"${event.title}"——${event.description}。结局：${outcome === 'completed' ? '事件顺利完成。' : '事件因时间流逝而自然结束。'}`,
    };
  }

  // 2. 存入记忆
  const conversationId = `char_${character.id}`;

  try {
    const parsedHistory = JSON.parse(event.choice_history || '[]');
    const branchReasoning = parsedHistory
      .filter(item => item.branch !== 0)
      .map(item => `选择「${item.choice_label}」后：${item.summary}`)
      .join('；');
    if (!event.engaged) {
      const oldRows = db.prepare(`
        SELECT memory_id FROM memory_fragments
        WHERE conversation_id = ? AND memory_type = 'event' AND subject = 'character'
          AND status = 'active' AND judgment LIKE '未互动事件：%'
      `).all(conversationId);
      for (const row of oldRows) softDeleteMemory(row.memory_id);
    }
    const skipUnengaged = !event.engaged && !getMemorySettings().recordUnengagedEvents;
    if (!skipUnengaged) {
      applyMemoryActions({
        conversationId,
        sourceRawStartId: null,
        sourceRawEndId: null,
        actions: [{
          action: 'create',
          sourceMemoryIds: [],
          memory: {
            memoryType: 'event',
            subject: 'character',
            judgment: `${event.engaged ? '已完成事件' : '未互动事件'}：${event.title}。${conclusionData.summary}`,
            reasoning: [event.description, branchReasoning].filter(Boolean).join('；'),
            tags: [character.display_name, event.title, '事件'],
          },
        }],
      });
    }
  } catch (memErr) {
    console.error(`[eventGen] Memory save failed:`, memErr.message);
  }

  // 3. 移到 event_history（保留原始 ID，确保分享卡片等引用不失效）
  db.prepare(`
    INSERT INTO event_history (id, character_id, event_type_key, title, description, final_image, summary, choice_history, total_branches, engaged, outcome, referenced_character_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    character.id, event.event_type_key,
    event.title, event.description, event.image,
    conclusionData.summary,
    event.choice_history, event.current_branch || 0,
    event.engaged, outcome,
    event.referenced_character_ids || '[]'
  );

  // 4. 删除活跃事件
  db.prepare(`DELETE FROM character_events WHERE id = ?`).run(event.id);

  // 5. SSE 广播
  broadcastEventConclusion({
    character_id: character.id,
    character_name: character.display_name,
    event_title: event.title,
    conclusion: conclusionData.conclusion,
    summary: conclusionData.summary,
    outcome,
    engaged: event.engaged,
  });

  console.log(`[eventGen] Event concluded: "${event.title}" → ${outcome}`);
}

/**
 * 生成运行中的事件摘要（每步更新）
 */
// ── 工具函数 ──

function toSQLite(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// 修复 LLM 输出的非法 JSON 转义（image_prompt 规则中的 \( \) 等不是合法 JSON 转义）
function repairJson(text) {
  return text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
}

// 从 LLM 原始输出中提取第一个完整 JSON 对象（括号计数，防 LLM 输出多段 JSON 拼在一起）
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

function toISO(dt) {
  if (!dt) return dt;
  return dt.replace(' ', 'T') + '.000Z';
}

function _parseCharLoras(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return [];
}
