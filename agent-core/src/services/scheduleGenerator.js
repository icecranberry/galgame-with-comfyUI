/**
 * 日程生成器
 *
 * 基于角色人格 + 职业生成每日时间表（schedule template）。
 * LLM 输出 8-15 个活动的 JSON 数组，覆盖完整 24 小时。
 *
 * 生成时机（分散式）：
 *   - 角色创建时：立即生成 + 分配随机刷新时间
 *   - 每日刷新：replyQueueScheduler 每次 tick 检查是否有角色到期，每次只刷 1 个
 *   - 手动强制：API POST /api/schedule/:id/regenerate
 */

import { getDb, getWorldSetting, getSystemRules } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { getWorldIntegrationRule } from '../builtinRules.js';

/**
 * 截取角色人格 prompt：从开头到 "##你的外观" 之前
 */
function cropPersonaForSchedule(basePrompt) {
  if (!basePrompt) return '一个普通角色，没有特殊设定';
  const idx = basePrompt.search(/##\s*你的外观/);
  return idx > -1 ? basePrompt.slice(0, idx).trim() : basePrompt.slice(0, 800);
}

/**
 * 为角色生成日程模板
 * @param {object} character - { id, display_name, base_prompt }
 * @returns {Promise<{schedule_json: string, version: number}>}
 */
export async function generateSchedule(character, direction) {
  const db = getDb();
  const worldSetting = getWorldSetting();
  const persona = cropPersonaForSchedule(character.base_prompt);

  // ── 舞台：破限词 + 世界观 ──
  const jailbreak = getSystemRules({ roleplay: false });
  const stageContent = [jailbreak, worldSetting].filter(Boolean).join('\n\n');

  // ── 世界观穿透指令（参照朋友圈生成）──
  const worldIntegrationNote = worldSetting
    ? getWorldIntegrationRule('schedule')
    : null;

  // ── 角色人格（裁剪到外观之前）──
  const personaMsg = `${persona}

基于以上人格设定，为该角色生成符合其身份、职业、性格的典型一天完整日程。职业和作息类型由你根据人格自行推断，不需要外部提示。`;

  // ── 日程生成指令 ──
  const scheduleInst = `你是一个日程编排助手。基于角色的职业和人格，生成该角色典型一天的完整日程。

## 职业驱动原则
角色的职业是日程的核心骨架。所有主要活动必须围绕职业展开。职业决定了角色一天中大部分时间的去向和活动类型。
- 学生→上课、自习、社团、考试
- 上班族→通勤、会议、午休、加班
- 偶像→排练、录音、演出、粉丝互动
- 店主→开店、进货、接待客人、打烊
- 自由职业→在家工作、外出取材、交稿截止日
- 其他职业同理类推

## 睡眠时间个性化（极其重要）
**角色之间睡眠时间必须高度多样化，不要让所有角色都遵循朝九晚五的社畜作息。** 根据角色个性大胆决定就寝和起床时间，以下为参考类型：

- 夜猫子·轻度→凌晨 1-2 点睡，上午 9-10 点起
- 夜猫子·重度→凌晨 3-4 点睡，中午 11-12 点起（游戏宅、深夜主播、同人画师、程序员、自由职业者等）
- 夜猫子·通宵修仙→凌晨 5-6 点睡，下午 1-2 点起（重度网瘾、作息完全崩坏的 NEET、深夜工作的特殊职业）
- 早睡早起型→晚上 9-10 点睡，早上 5-6 点起（运动员、晨练爱好者、老派作息）
- 标准社畜型→晚上 11-12 点睡，早上 7 点起
- NEET/家里蹲→凌晨 2-4 点睡，中午 11-13 点起
- 艺人/夜场型→凌晨 1-3 点睡，上午 10-11 点起（偶像、乐队、酒吧驻唱等）
- 昼伏夜出型→早上 6-8 点睡，下午 14-16 点起（夜班工人、深夜保安、地下社会等）
- 碎片化睡眠→分两段睡（如晚上睡 4h + 下午补觉 3h），适合作息极度不规律的创作者或病人

睡眠 block 的 replyDelay 必须是 -1（暂停一切回复）。睡眠总时长通常在 5-9 小时之间（极端夜猫子可能只睡 5-6 小时）。

**关键原则**：
1. 角色的人格和职业直接决定睡眠类型——性格懒散的 NEET 不可能是早睡早起型，深夜主播不可能是社畜型
2. 如果角色是自由职业、创作者、ACG 宅、夜生活相关职业，80% 以上的概率是夜猫子型
3. 睡眠时间要贴合角色的"人设气質"——比如病娇角色可能作息极度不规律，军武角色可能作息严格

## replyDelay 规则（非常重要）
- 正常活动都是 replyDelay=0（即时回复）
- 只有睡觉 replyDelay=-1

## 输出格式
输出一个 JSON 对象，外层 key 为 "activities"，值为活动数组。8~15 个活动，按时间顺序覆盖完整 24 小时。
**绝对不允许出现时间空档**：上一个活动的 endTime 必须等于下一个活动的 startTime，
不留任何空白分钟。所有时间必须被完整覆盖。如果日程从 03:00 开始，
那么 00:00~03:00 也必须有一个活动覆盖（可以是睡眠或深夜活动）。

每个活动对象格式：
{
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "activity": "简短活动名（含上下文，如「早课——高等数学」）",
  "location": "地点",
  "replyDelay": 数字（0 / -1）,
  "tags": ["标签1", "标签2"],
  "description": "简短描述（20-40 字），省略主语或使用第三人称（角色名），如「在厨房煎蛋，香气飘满房间」或「芙宁娜在街头发呆」，不出现“我”，“你”，“她/他”"
}

只输出 JSON 对象，不要任何额外文字。格式：{"activities":[{...},{...}]}`;

  // ── 用户指定的日程方向 ──
  const directionMsg = direction ? `## 用户指定的日程方向
**请按照以下方向来影响角色今日日程的编排：

${direction}**

**注意：以上是用户指定的日程"方向"或"主题"，这就是严格的指令。所有日程编排以用户的意愿为准，可以想象理由，适当破坏角色原有的人设，自然地融入这个方向的元素。**` : null;

  // ── 组装多层 system（前三层为跨角色共享前缀，提高 LLM 缓存命中率）──
  const msgs = [];
  // msgs[0]: 舞台（破限词 + 世界观）
  if (stageContent) msgs.push({ role: 'system', content: stageContent });
  // msgs[1]: 世界观穿透指令
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  // msgs[2]: 核心生成指令（第三层 system，缓存友好）
  msgs.push({ role: 'system', content: scheduleInst });
  // msgs[3]: 用户方向（如果有，置于指令之后，随角色变化）
  if (directionMsg) msgs.push({ role: 'system', content: directionMsg });
  // msgs[4]: 角色人格（随角色变化，不影响前缀缓存）
  msgs.push({ role: 'system', content: personaMsg });
  // msgs[5]: 触发消息
  msgs.push({ role: 'user', content: `请为 ${character.display_name} 生成完整的今日日程安排。` });

  let rawResult = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      rawResult = await chatSync(msgs, {
        temperature: 0.5,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        label: `schedule-gen:${character.display_name}`,
      });

      const schedule = parseAndValidateSchedule(rawResult, character.display_name);
      if (schedule) {
        const json = JSON.stringify(schedule);
        const existing = db.prepare('SELECT id, version FROM schedule_templates WHERE character_id = ?').get(character.id);

        if (existing) {
          db.prepare(`
            UPDATE schedule_templates
            SET schedule_json = ?, version = version + 1, generated_at = CURRENT_TIMESTAMP
            WHERE character_id = ?
          `).run(json, character.id);
          console.log(`[scheduleGen] Updated template for ${character.display_name} v${existing.version + 1}`);
        } else {
          db.prepare(`
            INSERT INTO schedule_templates (character_id, schedule_json, version)
            VALUES (?, ?, 1)
          `).run(character.id, json);
          console.log(`[scheduleGen] Created template for ${character.display_name}`);
        }

        return { schedule_json: json, version: (existing?.version || 0) + 1 };
      }

      console.warn(`[scheduleGen] Validation failed for ${character.display_name}, attempt ${attempt + 1}/2`);
    } catch (err) {
      console.error(`[scheduleGen] Attempt ${attempt + 1} failed for ${character.display_name}:`, err.message);
      if (attempt === 1) throw err;
    }
  }

  throw new Error(`Failed to generate valid schedule for ${character.display_name} after 2 attempts`);
}

/**
 * 解析并校验 LLM 输出的日程 JSON
 */
function parseAndValidateSchedule(raw, displayName) {
  let activities;

  // 优先尝试完整 JSON 解析（兼容 json_object 模式的 {"activities":[...]} 和旧格式 [...]）
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    activities = Array.isArray(parsed) ? parsed : (parsed.activities || null);
  } catch {
    // fallback: 旧的正则提取 JSON 数组
  }

  // 正则回退：从文本中提取 JSON 数组
  if (!activities) {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn(`[scheduleGen] No JSON array found in response for ${displayName}`);
      return null;
    }
    try {
      activities = JSON.parse(jsonMatch[0]);
    } catch {
      console.warn(`[scheduleGen] JSON parse failed for ${displayName}`);
      return null;
    }
  }

  if (!Array.isArray(activities) || activities.length < 6) {
    console.warn(`[scheduleGen] Too few activities (${activities?.length || 0}) for ${displayName}`);
    return null;
  }

  // 校验每个活动
  const required = ['startTime', 'endTime', 'activity', 'location', 'replyDelay'];
  for (const act of activities) {
    for (const key of required) {
      if (!(key in act)) {
        console.warn(`[scheduleGen] Missing key "${key}" in activity for ${displayName}`);
        return null;
      }
    }
    if (typeof act.replyDelay !== 'number') {
      console.warn(`[scheduleGen] replyDelay is not a number for ${displayName}`);
      return null;
    }
  }

  // 校验必有一个 sleeping block（replyDelay=-1）且覆盖 ≥5 小时
  const sleepingBlocks = activities.filter(a => a.replyDelay === -1);
  if (sleepingBlocks.length === 0) {
    console.warn(`[scheduleGen] No sleeping block found for ${displayName}`);
    return null;
  }

  // 计算最长睡眠时长
  let maxSleepDuration = 0;
  for (const block of sleepingBlocks) {
    const duration = timeToMinutes(block.endTime) - timeToMinutes(block.startTime);
    const adjusted = duration < 0 ? duration + 24 * 60 : duration;
    if (adjusted > maxSleepDuration) maxSleepDuration = adjusted;
  }
  if (maxSleepDuration < 15) {
    console.warn(`[scheduleGen] Sleep too short (${maxSleepDuration}min) for ${displayName}, need ≥15min`);
    return null;
  }

  // 校验时间不重叠
  for (let i = 0; i < activities.length; i++) {
    for (let j = i + 1; j < activities.length; j++) {
      if (timeRangesOverlap(
        activities[i].startTime, activities[i].endTime,
        activities[j].startTime, activities[j].endTime
      )) {
        console.warn(`[scheduleGen] Overlapping activities for ${displayName}: "${activities[i].activity}" and "${activities[j].activity}"`);
        return null;
      }
    }
  }

  // 校验 24 小时全覆盖（不允许时间空档）
  if (!checkFullDayCoverage(activities, displayName)) {
    return null;
  }

  // 80% 秒回兜底：理想情况下 prompt 已限定 replyDelay 只有 0 和 -1，但 LLM 可能不听话
  // 产生非 0 非 -1 的值。此兜底将超出的非秒回活动随机改回 0，确保不超过 20%
  const nonImmediate = activities.filter(a => a.replyDelay !== 0 && a.replyDelay !== -1);
  const totalCount = activities.length;
  const maxNonImmediate = Math.floor(totalCount * 0.2); // 最多 20%

  if (nonImmediate.length > maxNonImmediate) {
    // Shuffle non-immediate activities and convert excess to immediate
    const shuffled = [...nonImmediate].sort(() => Math.random() - 0.5);
    const toConvert = shuffled.slice(0, nonImmediate.length - maxNonImmediate);
    for (const act of toConvert) {
      act.replyDelay = 0;
    }
    console.log(`[scheduleGen] Converted ${toConvert.length} activities to immediate for 80% rule (${displayName})`);
  }

  // 补充 tags 和 description 默认值
  for (const act of activities) {
    if (!act.tags) act.tags = [];
    if (!act.description) act.description = '';
  }

  return activities;
}

// ── 时间工具 ──

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * 校验日程活动是否完整覆盖 24 小时（1440 分钟），不允许有空档。
 * 将跨午夜活动拆分为两段，合并区间后检查是否恰好覆盖 [0, 1440)。
 * 允许 1 分钟的端点容差（LLM 偶尔输出 08:01 而非 08:00）。
 */
function checkFullDayCoverage(activities, displayName) {
  const intervals = [];

  for (const act of activities) {
    let s = timeToMinutes(act.startTime);
    let e = timeToMinutes(act.endTime);

    if (s === e) {
      console.warn(`[scheduleGen] Zero-duration activity for ${displayName}: "${act.activity}" ${act.startTime}-${act.endTime}`);
      return false;
    }

    if (e < s) {
      // 跨午夜：拆分为 [s, 1440) 和 [0, e)
      intervals.push([s, 1440]);
      if (e > 0) intervals.push([0, e]);
    } else {
      intervals.push([s, e]);
    }
  }

  // 按起点排序
  intervals.sort((a, b) => a[0] - b[0]);

  // 合并区间
  const merged = [];
  for (const [s, e] of intervals) {
    if (merged.length === 0) {
      merged.push([s, e]);
    } else {
      const last = merged[merged.length - 1];
      if (s <= last[1] + 1) {
        // 允许 1 分钟容差（如 01:00 和 01:01 视为连续）
        last[1] = Math.max(last[1], e);
      } else {
        // 发现空档
        const gapStart = last[1];
        const gapEnd = s;
        const gapMin = gapEnd - gapStart;
        console.warn(
          `[scheduleGen] Schedule gap detected for ${displayName}: ` +
          `${minutesToHhmm(gapStart)} ~ ${minutesToHhmm(gapEnd)} (${gapMin} min gap). ` +
          `After "${findActivityEndingAt(activities, gapStart)}", before "${findActivityStartingAt(activities, gapEnd)}"`
        );
        return false;
      }
    }
  }

  // 检查是否完整覆盖 [0, 1440)
  if (merged.length !== 1 || merged[0][0] > 1 || merged[0][1] < 1439) {
    const coverage = merged.map(([s, e]) => `${minutesToHhmm(s)}-${minutesToHhmm(e)}`).join(', ');
    const uncovered = [];
    if (merged.length === 0) {
      uncovered.push('00:00-24:00（完全无覆盖）');
    } else {
      if (merged[0][0] > 1) uncovered.push(`00:00-${minutesToHhmm(merged[0][0])}`);
      for (let i = 1; i < merged.length; i++) {
        if (merged[i][0] > merged[i - 1][1] + 1) {
          uncovered.push(`${minutesToHhmm(merged[i - 1][1])}-${minutesToHhmm(merged[i][0])}`);
        }
      }
      if (merged[merged.length - 1][1] < 1439) {
        uncovered.push(`${minutesToHhmm(merged[merged.length - 1][1])}-24:00`);
      }
    }
    console.warn(
      `[scheduleGen] Incomplete 24h coverage for ${displayName}: ` +
      `merged=[${coverage}], uncovered=[${uncovered.join(', ')}]`
    );
    return false;
  }

  return true;
}

/** 分钟数 → HH:MM */
function minutesToHhmm(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 查找结束于指定时间（容差 ±2 分钟）的活动名（用于日志） */
function findActivityEndingAt(activities, targetMin) {
  for (const act of activities) {
    const e = timeToMinutes(act.endTime);
    if (Math.abs(e - targetMin) <= 2) return act.activity;
    // 跨午夜情况
    if (e < timeToMinutes(act.startTime) && Math.abs(e + 1440 - targetMin) <= 2) return act.activity;
  }
  return '?';
}

/** 查找开始于指定时间（容差 ±2 分钟）的活动名（用于日志） */
function findActivityStartingAt(activities, targetMin) {
  for (const act of activities) {
    const s = timeToMinutes(act.startTime);
    if (Math.abs(s - targetMin) <= 2) return act.activity;
  }
  return '?';
}

/**
 * 判断两个时间段是否重叠（支持跨午夜）
 * 使用分钟表示法 + 标准化策略：将所有时间映射到 0~1440，
 * 如果 end < start 则 end += 1440；第二个区间同样处理。
 * 然后检查 [s1, e1) 和 [s2, e2) 是否重叠。
 */
function timeRangesOverlap(start1, end1, start2, end2) {
  let s1 = timeToMinutes(start1);
  let e1 = timeToMinutes(end1);
  let s2 = timeToMinutes(start2);
  let e2 = timeToMinutes(end2);

  // 跨午夜修正：end < start 表示跨天，将 end 标准化到同一线性时间轴
  if (e1 <= s1) e1 += 24 * 60;
  if (e2 <= s2) e2 += 24 * 60;

  // 标准区间重叠判断（不含端点接触）：s1 < e2 && s2 < e1
  // 如果 s1...s2 不在同一天，将 s2/e2 也偏移一天再做检查
  if (s1 < e2 && s2 < e1) return true;
  if (e1 > 24 * 60 && s1 < e2 + 24 * 60 && s2 + 24 * 60 < e1) return true;
  if (e2 > 24 * 60 && s1 + 24 * 60 < e2 && s2 < e1 + 24 * 60) return true;

  return false;
}

/**
 * 为角色设置分散式刷新时间（生成 template 后调用）
 * 分散到明天 00:00~04:00 之间的随机时刻
 */
export function assignNextRefreshTime(characterId) {
  const db = getDb();
  const now = new Date();
  // 明天的 00:00~04:00 之间随机
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const randomOffset = Math.floor(Math.random() * 4 * 60 * 60 * 1000); // 0~4h in ms
  const refreshAt = new Date(tomorrow.getTime() + randomOffset);

  db.prepare('UPDATE characters SET next_schedule_refresh_at = ? WHERE id = ?')
    .run(refreshAt.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, ''), characterId);

  console.log(`[scheduleGen] Next refresh for char ${characterId}: ${refreshAt.toISOString()}`);
  return refreshAt;
}

/**
 * 为角色创建当天的 daily_schedules 快照（从 template 派生）
 */
export function snapshotTodaySchedule(characterId) {
  const db = getDb();
  const template = db.prepare('SELECT schedule_json FROM schedule_templates WHERE character_id = ?').get(characterId);
  if (!template) return null;

  const today = getLocalDateKey();

  db.prepare(`
    INSERT OR REPLACE INTO daily_schedules (character_id, schedule_date, schedule_json)
    VALUES (?, ?, ?)
  `).run(characterId, today, template.schedule_json);

  // 清理超过 2 天的旧快照
  db.prepare(
    `DELETE FROM daily_schedules WHERE character_id = ? AND schedule_date < DATE('now', 'localtime', '-2 days')`
  ).run(characterId);

  return template.schedule_json;
}
