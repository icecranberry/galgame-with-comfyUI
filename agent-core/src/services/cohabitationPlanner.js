import { getSystemRules, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { getWorldIntegrationRule } from '../builtinRules.js';
import { chatSync } from './lorebook/runtime.js';
import { config } from '../config.js';
import { intervals, overlaps } from './cohabitationSchedule.js';

export const COHABITATION_RULES = `你是共同生活日程编排助手。为下方居室成员规划本轮作息中自然发生的共同活动，供稍后各角色编排完整日程时遵守。
根据世界观、居室成员的简短人格及关系原文决定活动。关系有方向：分别保留双方的关系认知；友好、疏远、竞争、敌对、依赖、单方面关系都按原文应用。敌对或竞争可以体现对峙、争执、谈判、有理由的暂时合作等，不能将原关系直接改写成友好关系。
可以是部分成员组队，或成员与所提供的室外关系对象行动。每件共同活动总人数必须为2～3人（包含室外对象），最多3人一起行动；居室超过3人时分组安排，不生成超过3人的全员活动。每件活动至少有一名本居室成员和另一位角色参加。允许独处，独处留给个人日程，不在这里占一条共同活动。
正常情况下：1～3名成员目标3件，4～5名目标4件，更多成员目标5件；可用时间不足、没有合适活动时可以少于目标甚至0件，最多5件。不要安排睡眠。每件活动建议15～120分钟，最长180分钟，避开已有约定并留下足够的工作、生活和睡眠时间。
所有参与者都必须在候选名单中。已确认活动不可删除、移动、重复输出；只输出新增活动。检查参与者（包括室外对象）的全部已占用时段；同一个人不能在同一时段参加两件事。时间以每天重复的24小时制HH:MM表示，允许跨午夜，不可起止相同。
活动描述用中文第三人称，26～52字，写清在场角色的姓名和正在做的事情，不包含外观。不编造候选名单之外的人物。
严格按以下完整JSON格式输出，不能输出解释、Markdown或JSON以外的文字：
{"activities":[{"startTime":"18:00","endTime":"19:00","activity":"共同准备晚餐","location":"共同居室厨房","participantIds":[1,2],"description":"角色甲和角色乙分头清洗食材与准备餐具，一边讨论晚餐的口味，一边完成开饭前的准备。"}]}
字段约束：startTime/endTime为合法HH:MM时间；activity为1～60字活动名；location为1～60字真实场所；participantIds为2～3个不同的候选角色数字ID，最多3个（示例1、2必须替换成输入中的真实ID）；description为26～52字场景描述。无合适活动时输出{"activities":[]}。`;

export function buildCohabitationRequest({ room, characters, relationships, events, fixed = [], direction = '', batchId, eligibleCharacterIds }) {
  const members = characters.filter(c => room.memberIds.includes(c.id));
  const relations = relationships.filter(r => room.memberIds.includes(r.from_character_id) || room.memberIds.includes(r.to_character_id));
  const candidateIds = new Set([...room.memberIds, ...relations.flatMap(r => [r.from_character_id, r.to_character_id])]);
  const eligible = new Set(eligibleCharacterIds || characters.map(c => c.id));
  const candidates = characters.filter(c => candidateIds.has(c.id) && eligible.has(c.id));
  const candidateSet = new Set(candidates.map(c => c.id));
  const occupancy = [...events, ...fixed].filter(e => e.participantIds.some(id => candidateSet.has(id)));
  const messages = [{ role: 'system', content: getWorldSetting() ? getSystemRulesWithWorld({ roleplay: false }) : getSystemRules({ roleplay: false }) }];
  if (getWorldSetting()) messages.push({ role: 'system', content: getWorldIntegrationRule('schedule') });
  messages.push({ role: 'system', content: COHABITATION_RULES });
  const personaTexts = members.map(c => `【${c.display_name} · ID ${c.id}】\n${String(c.short_prompt || '').trim() || '未提供简短人格。'}`);
  for (const content of personaTexts) messages.push({ role: 'system', content });
  const boundary = { index: messages.length - 1, offset: messages.at(-1).content.length };
  const names = new Map(characters.map(c => [c.id, c.display_name || c.name || `角色${c.id}`]));
  // 与朋友圈“对方是你的……”保持同一方向，第三人称明确关系归属，不推断反向关系。
  const relationshipText = relations.filter(r => String(r.relationship_text || '').trim()).map(r =>
    `- ${names.get(r.to_character_id) || `角色${r.to_character_id}`}是${names.get(r.from_character_id) || `角色${r.from_character_id}`}的${r.relationship_text}`
  ).join('\n') || '未提供关系。';
  const dynamic = JSON.stringify({ room: { id: room.id, name: room.name, memberIds: members.map(c => c.id) },
    candidates: candidates.map(c => ({ id: c.id, name: c.display_name })),
    unavailableMemberIds: members.filter(c => !eligible.has(c.id)).map(c => c.id),
    occupied: occupancy.map(e => ({ sharedEventId: e.sharedEventId, startTime: e.startTime, endTime: e.endTime, participantIds: e.participantIds, activity: e.activity, location: e.location })),
  }) + `\n\n【人物关系】\n${relationshipText}`;
  messages.push({ role: 'system', content: `【本次共同生活资料】\n${dynamic}` });
  const user = `为${room.name}安排当天的非睡眠共同活动。${direction ? `\n本轮用户要求：${direction}` : ''}`;
  messages.push({ role: 'user', content: user });
  return { messages, candidateIds: candidateSet, occupancy, lorebook: {
    personaTexts, staticTexts: [COHABITATION_RULES], cacheBoundary: boundary,
    characterNames: members.map(c => c.display_name), characterName: members[0]?.display_name,
    history: [{ role: 'user', content: `${dynamic}\n${user}` }], scope: `cohabitation:${room.id}`, turnKey: batchId, step: 1,
  } };
}

export function validateCohabitationResult(raw, { room, candidateIds, occupancy, batchId }) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) : raw;
  if (!Array.isArray(parsed?.activities) || parsed.activities.length > 5) throw new Error('共同活动需要0～5件');
  const events = [];
  for (const [i, a] of parsed.activities.entries()) {
    if (!Array.isArray(a.participantIds) || a.participantIds.some(id => !Number.isSafeInteger(id))) throw new Error('参与者ID格式错误');
    const participantIds = [...new Set(a.participantIds)].sort((x, y) => x - y);
    if (participantIds.length > 3) throw new Error('每件共同活动最多3人，包含本居室成员和室外对象，请减少参与者或分组安排');
    if (participantIds.length < 2 || participantIds.some(id => !candidateIds.has(id)) || !participantIds.some(id => room.memberIds.includes(id))) throw new Error('参与者不在候选名单或没有本居室成员');
    const ranges = intervals(a), duration = ranges.reduce((n, [s, e]) => n + e - s, 0);
    if (!ranges.length || duration < 5 || duration > 180) throw new Error('共同活动时间不合法或超过三小时');
    if (['activity', 'location', 'description'].some(key => typeof a[key] !== 'string' || !a[key].trim())) throw new Error('活动名称、地点和描述不能为空');
    if (/睡觉|睡眠|入睡|就寝|午睡|补觉/.test(a.activity) || a.replyDelay === -1) throw new Error('共同活动不包含睡眠');
    const event = { startTime: a.startTime, endTime: a.endTime, activity: a.activity.trim().slice(0, 60), location: a.location.trim().slice(0, 60),
      description: a.description.trim(), participantIds, replyDelay: 0, tags: ['共同生活'],
      sharedEventId: `${batchId}:${room.id}:${i}`, cohabitationBatchId: batchId, sharedStartTime: a.startTime, sharedEndTime: a.endTime };
    // 模型有时把已确认的约定原样再列一遍：视为引用，保留最初版本，不重复预约也不浪费一次重试。
    if ([...occupancy, ...events].some(b => b.sharedEventId && b.startTime === event.startTime && b.endTime === event.endTime
      && b.location === event.location && JSON.stringify([...b.participantIds].sort((x, y) => x - y)) === JSON.stringify(participantIds))) continue;
    if ([...occupancy, ...events].some(b => b.participantIds.some(id => participantIds.includes(id)) && overlaps(event, b))) throw new Error(`「${event.activity}」与已有约定冲突`);
    events.push(event);
  }
  return events;
}

export async function planResidence(input, { chat = chatSync } = {}) {
  const request = buildCohabitationRequest(input);
  if (request.candidateIds.size < 2) return [];
  let error;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = request.messages.map(m => ({ ...m }));
    if (error) messages.at(-1).content += `\n上次输出未通过校验：${error.message}。请修正后重新输出。`;
    try {
      const raw = await chat(messages, { temperature: 0.6, response_format: { type: 'json_object' },
        ...(config.features.scheduleDisableThinking ? { thinking: { type: 'disabled' }, forceDisableThinking: true } : {}),
        label: `cohabitation-plan:${input.room.name}`, lorebook: request.lorebook });
      return validateCohabitationResult(raw, { ...request, ...input });
    } catch (err) { error = err; }
  }
  throw error;
}
