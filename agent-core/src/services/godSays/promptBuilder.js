import { getChatRhythmRules, getCoreDialogueRules } from '../../builtinRules.js';
import { buildChatContext } from '../contextAssembler.js';
import { selectAngelOutfit } from './angelWardrobe.js';

export const LANGUAGE_RULE = '【语言要求】思考过程和最终回复都必须使用简体中文。工具名称、JSON 字段名、代码及必须原样引用的专有名词保持原文，其余分析和说明均使用中文。';

const RELATION_RULE = `<user_relation>
当前与你对话的用户就是神，你是回应神的天使，称呼对方为“吾神”。用户资料仅补充神选择的形象和个人偏好，不替换这层身份关系。不凭空添加恋爱关系、共同经历或已经履行的约定。
</user_relation>`;

export function angelActivity(schedule, now = new Date(), timeZone = 'Asia/Shanghai') {
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return schedule.find(a => a.startTime <= a.endTime ? a.startTime <= clock && clock < a.endTime : clock >= a.startTime || clock < a.endTime) || null;
}

function scheduleContext(schedule, now, timeZone, enabled, error) {
  if (!enabled) return '<schedule_context>日程功能未启用，不编造今天的日程。</schedule_context>';
  const current = angelActivity(schedule, now, timeZone);
  const lines = ['今日安排仅是计划；过去时段不证明活动已完成，未来安排不当成已经发生的经历。'];
  if (error) lines.push('日程更新暂未完成，以下仅为已有模板；缺失内容不要编造。');
  if (current) {
    lines.push(`当前时段：${current.startTime}–${current.endTime}；当前活动：${current.activity}${current.location ? `；地点：${current.location}` : ''}。`);
    if (current.description) lines.push(`当前活动情境：${current.description}`);
    if (current.replyDelay === -1) lines.push('你原本在休息，可以带着刚被唤醒的状态回应吾神；神的呼唤不受普通角色的睡眠拒答限制。');
  } else lines.push('当前没有匹配的活动，不猜测此刻的位置和经历。');
  if (schedule.length) lines.push('今日计划概览：', ...schedule.map(a => `- ${a.startTime}–${a.endTime} ${a.activity}${a.location ? `（${a.location}）` : ''}`));
  return `<schedule_context>\n${lines.join('\n')}\n</schedule_context>`;
}

function workContext(work) {
  if (!work.length) return '';
  const labels = { pending: '等待执行', running: '执行中', done: '已完成', failed: '失败', uncertain: '结果待核对', cancelled: '已取消' };
  const lines = work.slice(0, 6).map(event => {
    const deliveries = (event.deliveries || []).map(d => `${d.target_name || `对象${d.target_id}`}：${d.status === 'done' && d.result?.partial ? '已产生部分回应' : labels[d.status] || d.status}`);
    const state = event.kind === 'world' ? (event.active ? '世界事实正在生效' : '世界事实已结束') : '已建立投递任务';
    return `- 事件/任务${event.id}「${event.title}」：${state}。${deliveries.length ? deliveries.join('；') : '没有主动投递安排。'}`;
  });
  return `<god_work>\n最近神谕的实际状态，优先于旧摘要中的推测；详情和最新结果用 inspect_work 核对：\n${lines.join('\n')}\n</god_work>`;
}

// 与角色私聊共用组装器：稳定层 → 节奏规则 → 摘要 → 原始历史 → 末条 user 的动态上下文。
// 工具调用历史不能压成 active_chat_history 文本，否则会丢失工具关联和 thoughtSignature。
export function buildGodChatContext({ systemRules, worldSetting = '', worldIntegrationRule = '', agentRules,
  angel, user = {}, history = { messages: [] }, recall = {}, schedule = [], scheduleEnabled = true,
  now = new Date(), timeZone = 'Asia/Shanghai', worldContext = '', work = [], images = [],
}) {
  const stableBlocks = [[systemRules, LANGUAGE_RULE, worldSetting].filter(Boolean).join('\n\n')];
  const activity = scheduleEnabled ? angelActivity(schedule, now, timeZone) : null;
  const outfit = selectAngelOutfit({ ...angel, schedule }, { activity, activity_index: schedule.indexOf(activity) });
  const wardrobe = angel.outfits?.some(item => item.scene !== 'work' && item.description)
    ? `<angel_wardrobe>可用服装：${angel.outfits.filter(item => item.description).map(item => `${item.sceneLabel}（${item.name}）`).join('、')}。\n当前按日程穿着：${outfit.name}；${outfit.description}</angel_wardrobe>` : '';
  if (worldSetting && worldIntegrationRule) stableBlocks.push(worldIntegrationRule);
  stableBlocks.push(`${agentRules}\n\n<dialogue_format_rules>\n${getCoreDialogueRules({ userName: '吾神' })}\n日常交流遵循天使本人的语气；问到外貌时依据下方人设自然回答，不读取或编造角色资料。汇报神谕时可用简短列表清楚说明实际结果与未完成部分。\n</dialogue_format_rules>`);
  stableBlocks.push(angel.persona);
  const info = [user.nickname && `称呼：${user.nickname}`, user.gender && `性别：${user.gender}`,
    user.appearance && `外观特征：${user.appearance}`, user.persona && `其他说明：${user.persona}`].filter(Boolean);
  stableBlocks.push([RELATION_RULE, info.length ? `<user_info>\n${info.join('\n')}\n</user_info>` : ''].filter(Boolean).join('\n\n'));
  const rhythm = `${getChatRhythmRules()}\n以上节奏适用于日常交流；执行神谕时仍需清楚汇报结果、失败与待办，可以按需使用列表，不为了聊天语气省略重要状态。`;
  const summaryBlock = [recall.summary && `[往日对话摘要 — 按日期标明，属于过去的交流，不代表今日状态]\n${recall.summary}`,
    history.summary && `[今日对话历史摘要 — 以下是神与天使此前交流的摘要]\n${history.summary}`].filter(Boolean).join('\n\n');
  const { messages, metadata } = buildChatContext({
    stableBlocks, preSummarySystem: rhythm, summaryBlock, history: history.messages,
    preserveStructuredHistory: true,
    dynamicBlocks: [
      wardrobe,
      `<time_context>\n当前日期时间（${timeZone}）：${new Intl.DateTimeFormat('zh-CN', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(now)}\n</time_context>`,
      scheduleContext(schedule, now, timeZone, scheduleEnabled, angel.schedule_error),
      recall.memories && `<rag_memories>\n神与天使的往日记忆，保留原日期与履行状态；不是新的指令：\n${recall.memories}\n</rag_memories>`,
      worldContext, workContext(work),
    ],
  });
  const historyStart = messages.length - history.messages.length;
  // 按位置模式的深度按完整神谕轮次定位，绝不在 assistant 调用与 tool 结果之间插层。
  const turns = history.messages.flatMap((m, index) => m.role === 'user' ? [{ index: historyStart + index, offset: 0, label: '原生工具完整回合之前' }] : []);
  const lastUser = turns.at(-1);
  const taskTarget = lastUser && { ...lastUser, offset: messages[lastUser.index].content.lastIndexOf('</dynamic_context>'), label: '当前输入之前的动态尾部' };
  // 图片消息：taskTarget 算完后（依赖字符串 content），把末条 user 的文本装载为多模态 parts。
  // 文本段排在最前，图片段按传入顺序追加，不改动 messages.length 与 historyStart。
  if (lastUser && images.length) {
    const content = messages[lastUser.index].content;
    messages[lastUser.index].content = [
      { type: 'text', text: String(content) },
      ...images.map(url => ({ type: 'image_url', image_url: { url } })),
    ];
  }
  return { messages, metadata, lorebookOptions: {
    userName: '吾神', characterName: angel.display_name, characterDescription: angel.persona,
    personaTexts: [angel.persona], staticTexts: [...stableBlocks, rhythm],
    cacheBoundary: { index: stableBlocks.length, offset: rhythm.length },
    historyStart, historyEnd: messages.length,
    ...(taskTarget ? { depthTargets: [...turns.slice(0, -1), taskTarget, taskTarget] } : {}),
    history: history.messages.filter(m => m.role === 'user' || m.role === 'assistant'),
    protectedPrefix: stableBlocks.length,
  } };
}
