/**
 * 聊天约定检测 → 单条日程改写
 *
 * 私聊 / 群聊（@ 或提到某角色）回复完成后：
 *   1. 正则粗筛用户消息里像「约好了/今天晚上/我们去…」的约定句式
 *   2. 命中后用双方对话做一次轻量 LLM 判断：是否真的约定了今天的时间段
 *   3. 判定需要 → 走改日程流程（system0 破甲词+世界观 / system1 世界观强化 /
 *      system2 角色人设+我的人设 / user 双方对话+单条日程格式示范），返回单条日程 JSON
 *   4. 合并进该角色当日日程（applyScheduleChange），条目带 edited 标记，
 *      到点后由 scheduleSpecialMoment 队列发特殊朋友圈
 */

import { getSystemRules, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { getWorldIntegrationRule } from '../builtinRules.js';
import { buildCharacterPersona } from './characterPersona.js';
import { applyScheduleChange, queueScheduleChange } from './scheduleEditor.js';
import { config } from '../config.js';
import { getTimeTag } from './timeLight.js';
import { getLocalDateKey } from '../utils/localDate.js';

// 约定句式粗筛：命中任意一个才进入 LLM 判断（宁可多采一点，由 LLM 二次把关）
const APPOINTMENT_PATTERNS = [
  /约[好个了定]|跟.{0,6}约|和.{0,6}约|与你?相约/,
  /说好了|说定了|讲好了|一言为定|不见不散/,
  /今天(早上|上午|中午|下午|傍晚|晚上|夜里|夜晚)/,
  /(我们|咱们|人家)(一起)?(去|吃|喝|玩|看|逛)/,
  /一起去|一起(吃|喝|玩|看|逛|做饭)/,
  /陪(我去|你|着我)|带(你|我)去/,
  /待(会儿|会)见|一会(儿)?见|到时候见|稍后见/,
  /(中午|下午|晚上|傍晚|周末).{0,8}见/,
  // 相对时间与即时邀约：「十分钟后下楼吃宵夜」「走吧」「半小时后见」
  /(\d+|一|两|三|四|五|六|七|八|九|十|几|半)\s*(个?分钟|个?小时)后/,
  /(现在|马上|立刻|这就|等下|等会儿|待会儿)/,
  /(下楼|出门|出来|过来)/,
  /走[，吧,！!]/,
  /一起|一块|陪我/,
  /去(吃|喝|玩|逛)|吃(宵夜|夜宵|午饭|晚饭|早饭|下午茶|火锅|烧烤)/,
];

/** 约定最多排到多少天之后（更远的日期直接放弃） */
const MAX_QUEUE_DAYS = 7;

export function matchesAppointmentIntent(text) {
  const t = String(text || '');
  return APPOINTMENT_PATTERNS.some(re => re.test(t));
}

/** 「我」的用户人设一行描述 */
function buildUserPersonaLine() {
  const u = config.user || {};
  const parts = [`昵称：${u.nickname || '用户'}`, `性别：${u.gender || '未知'}`];
  if (u.appearance) parts.push(`外观：${u.appearance}`);
  if (u.persona) parts.push(`人设：${u.persona}`);
  return parts.join('；');
}

/**
 * 轻量判断：这段对话是否真的约定了今天/明天（或相对时间）的具体时间
 * @returns {Promise<boolean>}
 */
async function judgeAppointmentNeeded(userText, replyText, characterName) {
  const system = `你是对话意图判断助手。判断下面用户与角色的一段对话，双方是否约定了「今天或明天某个具体时间段一起做某件事」（例如约好一起吃饭、一起去某个地方、下午见面等）。

只输出 JSON，格式示例：
{"need": true}

字段要求：
- "need"：布尔值。只有当对话里明确达成了约定——说出了或能自然推断出具体时间——才是 true；
- 具体时间包括：今天的时段（「今天晚上一起吃饭」「约好下午三点见」）、相对时间（「十分钟后下楼吃宵夜」「半小时后见」「现在就走」）、明天的时段（「明天晚上六点吃饭」「明早一起去跑步」）；
- 只是模糊意向（「改天再约」「下次吧」「有空聚聚」）、复述已有计划、纯闲聊或没有时间信息的一律 false；
- 用户单方面提议但角色没有答应的，是 false。

只输出 JSON，不要输出任何解释或 JSON 以外的文字。`;

  const msgs = [
    { role: 'system', content: system },
    { role: 'user', content: `【用户说】\n${userText}\n\n【${characterName}回】\n${replyText}\n\n双方是否约定了今天或明天的具体时间段？只输出 JSON。` },
  ];

  const raw = await chatSync(msgs, {
    temperature: 0,
    max_tokens: 100,
    response_format: { type: 'json_object' },
    label: '约定检测判断',
  });

  try {
    const parsed = JSON.parse(raw);
    return parsed?.need === true;
  } catch {
    console.warn('[appointment] judge output not JSON, treat as no:', String(raw).slice(0, 80));
    return false;
  }
}

/**
 * 改日程流程：按 system0 破甲词+世界观 / system1 世界观强化 / system2 人设 /
 * user 双方对话+单条日程格式示范 组装，让 LLM 返回一条新的单条日程 JSON
 * @returns {Promise<object|null>} 单条日程对象，失败返回 null
 */
async function requestScheduleChange(character, userText, replyText) {
  const worldSetting = getWorldSetting();
  const stageContent = worldSetting
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting
    ? getWorldIntegrationRule('schedule')
    : null;

  const nowForPrompt = new Date();
  const todayKey = getLocalDateKey(nowForPrompt);
  const tomorrowKey = getLocalDateKey(new Date(nowForPrompt.getTime() + 86400000));

  const formatExample = `{
  "date": "2026-09-20",
  "startTime": "19:00",
  "endTime": "20:30",
  "activity": "简短活动名",
  "location": "地点",
  "replyDelay": 0,
  "tags": ["标签1", "标签2"],
  "description": "20-40字的第三人称场景描述"
}

每个字段的要求：
- "date"：约定发生在哪一天，格式 YYYY-MM-DD。今天的日期是 ${todayKey}，明天的日期是 ${tomorrowKey}；「今晚/今天中午」填今天，「明晚/明天下午」填明天，只支持今天起 7 天内；
- "startTime"/"endTime"：HH:MM 24 小时制，endTime 晚于 startTime 且必须是同一天的时间——约定跨过零点时（如深夜宵夜吃到凌晨），endTime 一律填 "23:59"；时长要符合这件事的常理，一般 1~3 小时，最长不超过 6 小时，禁止用 23:59 表示「到天亮」「一整天」；相对时间必须换算：「十分钟后下楼吃宵夜」且当前是 21:40，就填 21:50 开始；「明天晚上六点吃饭」就填 18:00；
- "activity"：简短活动名，带上下文，如「晚餐——和用户的火锅之约」；
- "location"：具体地点；
- "replyDelay"：固定填 0（约定期间可以回复消息）；
- "tags"：1~3 个标签，如 ["约会","晚餐"]；
- "description"：20-40 字，省略主语或用第三人称（角色名）描述这个场景，不出现「我」「你」。`;

  const msgs = [
    // system0：破甲词 + 世界观
    { role: 'system', content: stageContent },
  ];
  // system1：世界观强化
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  // system2：角色人设 + 我的人设
  msgs.push({
    role: 'system',
    content: `${buildCharacterPersona(character, { variant: 'full' })}

【用户（${config.user.nickname || '用户'}）的信息】
${buildUserPersonaLine()}`,
  });
  // user：双方对话内容 + 当前时间 + 单条日程格式示范
  msgs.push({
    role: 'user',
    content: `${worldSetting ? '请遵循<world_setting>来安排这条日程，地点与活动形式要符合世界观。\n\n' : ''}【当前时间】${getTimeTag(nowForPrompt)}

【刚才的对话】
用户：${userText}

${character.display_name}：${replyText}

上面这段对话里双方约定了一起做某件事（可能是今天、相对时间如「十分钟后」，也可能是明天）。请判断这个约定应该安排在哪一天、哪个时间段，输出一条新的单条日程，严格按照下面的 JSON 格式：
${formatExample}

只输出一个 JSON 对象，不要输出任何解释、Markdown 代码块或 JSON 以外的文字。`,
  });

  const raw = await chatSync(msgs, {
    temperature: 0.4,
    max_tokens: 600,
    response_format: { type: 'json_object' },
    label: `约定改日程:${character.display_name}`,
  });

  // 容错：提取第一个 JSON 对象
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    console.warn('[appointment] schedule change output not JSON:', String(raw).slice(0, 80));
    return null;
  }
  return JSON.parse(raw.slice(start, end + 1));
}

/** 约定日期解析：接受 YYYY-MM-DD / 今天 / 明天 / 后天，缺省按今天 */
export function resolveAppointmentDate(raw, now = new Date()) {
  const today = getLocalDateKey(now);
  const rawDate = String(raw?.date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  if (rawDate.includes('后天')) return getLocalDateKey(new Date(now.getTime() + 2 * 86400000));
  if (rawDate.includes('明天') || rawDate.includes('明晚') || rawDate.includes('明早')) {
    return getLocalDateKey(new Date(now.getTime() + 86400000));
  }
  return today;
}

/**
 * 私聊 / 群聊回复完成后调用（fire-and-forget）
 * @param {object} opts
 * @param {object} opts.character  - 角色（至少含 id、display_name、base_prompt）
 * @param {string} opts.userText   - 用户这句话
 * @param {string} opts.replyText  - 角色（或群聊中被提及角色）的回复
 */
export async function detectAndApplyAppointment({ character, userText, replyText }) {
  try {
    if (!character?.id || config.features.schedule === false) return;
    if (!matchesAppointmentIntent(userText)) return;

    console.log(`[appointment] Pattern hit for ${character.display_name}, judging...`);
    const needed = await judgeAppointmentNeeded(userText, replyText, character.display_name);
    if (!needed) {
      console.log(`[appointment] Judge: no appointment in this round for ${character.display_name}`);
      return;
    }

    const newActivity = await requestScheduleChange(character, userText, replyText);
    if (!newActivity) return;

    const now = new Date();
    const today = getLocalDateKey(now);
    const date = resolveAppointmentDate(newActivity, now);
    const { date: _date, ...activity } = newActivity;

    if (date === today) {
      const result = applyScheduleChange(character.id, activity, now);
      if (result.ok) {
        console.log(`[appointment] Schedule changed for ${character.display_name}: ${result.activity.startTime}-${result.activity.endTime} ${result.activity.activity}`);
      } else {
        console.log(`[appointment] Schedule change skipped for ${character.display_name}: ${result.reason}`);
      }
      return;
    }

    // 过去的日期：LLM 输出异常，直接放弃
    if (date < today) {
      console.log(`[appointment] Date ${date} is in the past for ${character.display_name}, skip`);
      return;
    }

    // 未来某天（最多排 7 天）：先入待应用队列，到那天由 ensurePendingScheduleChanges
    // 合并进当日日程并进入当天的特殊朋友圈队列
    const maxDate = getLocalDateKey(new Date(now.getTime() + MAX_QUEUE_DAYS * 86400000));
    if (date > maxDate) {
      console.log(`[appointment] Date ${date} beyond ${MAX_QUEUE_DAYS} days for ${character.display_name}, skip`);
      return;
    }
    queueScheduleChange(character.id, date, activity);
  } catch (err) {
    console.error('[appointment] detect/apply error:', err.message);
  }
}
