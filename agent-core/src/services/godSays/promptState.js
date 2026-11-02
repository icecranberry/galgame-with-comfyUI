// 每个 user 保存一次最终请求片段（动态预设 system + user，含世界书与图片）。
// 当天前缀只保存一次；后续回合重放片段并追加原生 assistant/tool，不回写旧片段。
import { createHash } from 'node:crypto';
import { appendContextUpdates } from './contextUpdates.js';

// 只读取系统组装的开头区块，不匹配用户原话中引用的日程标签；兼容旧版图片消息。
function storedSchedule(messages) {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue;
    const parts = typeof message.content === 'string' ? [message.content]
      : (message.content || []).filter(p => p.type === 'text').map(p => p.text);
    for (const text of parts) {
      const match = /^<dynamic_context>\n(<schedule_context>[\s\S]*?<\/schedule_context>)/.exec(text);
      if (match) return match[1];
    }
  }
  return null;
}

function withSchedule(message, block, replacement) {
  const prefix = `<dynamic_context>\n${block}\n\n`;
  const rewrite = text => text.startsWith(prefix)
    ? `<dynamic_context>\n${replacement ? `${replacement}\n\n` : ''}${text.slice(prefix.length)}` : text;
  return { ...message, content: typeof message.content === 'string' ? rewrite(message.content)
    : message.content.map(part => part.type === 'text' ? { ...part, text: rewrite(part.text) } : part) };
}

export function createGodPromptState(repo, prepareNarrative) {
  const { db } = repo;
  const read = (table, key, id) => {
    const row = db.prepare(`SELECT payload_json FROM ${table} WHERE ${key}=?`).get(id);
    return row ? JSON.parse(row.payload_json) : null;
  };
  async function prepare(run, context, history, signal) {
    const prefix = read('god_prompt_prefixes', 'session_id', run.session_id);
    const currentId = history.messageIds.at(-1);
    const current = db.prepare("SELECT id FROM god_messages WHERE id=? AND run_id=? AND role='user'").get(currentId, run.id);
    if (!current) throw new Error('神说请求缺少本轮用户消息');
    const snapshots = new Map(db.prepare(`SELECT p.message_id,p.payload_json FROM god_prompt_turns p
      JOIN god_messages m ON m.id=p.message_id WHERE m.session_id=?`).all(run.session_id)
      .map(row => [row.message_id, JSON.parse(row.payload_json)]));
    const replay = history.messages.slice(0, -1).flatMap((message, index) =>
      snapshots.get(history.messageIds[index])?.messages || [message]);
    const saved = snapshots.get(currentId);
    if (saved && prefix) return { messages: [...prefix.messages, ...replay, ...saved.messages], commit() {} };

    const previousTurn = history.messageIds.slice(0, -1).map(id => snapshots.get(id)).filter(Boolean).at(-1);
    // 只计仍然存在的、确实携带日程的片段；首轮被删除后需要重新补入日程。
    let previousSchedule = null;
    for (const id of history.messageIds.slice(0, -1).reverse()) {
      const snapshot = snapshots.get(id);
      if (!snapshot) continue;
      previousSchedule = snapshot.scheduleBlock || storedSchedule(snapshot.messages);
      if (previousSchedule) break;
    }
    const scheduleBlock = context.metadata.scheduleBlock;
    const sameSchedule = !!scheduleBlock && previousSchedule === scheduleBlock;
    let currentUser = context.messages.at(-1);
    if (sameSchedule) currentUser = withSchedule(currentUser, scheduleBlock, '');
    else if (scheduleBlock && previousSchedule) currentUser = withSchedule(currentUser, scheduleBlock,
      scheduleBlock.replace('<schedule_context>', '<schedule_context>\n日程更新：以下版本替代此前日程。'));
    const incremental = appendContextUpdates(currentUser, context.metadata.contextBlocks,
      history.messageIds.slice(0, -1).map(id => snapshots.get(id)).filter(Boolean));
    currentUser = incremental.message;
    const sourceRules = context.messages.slice(0, context.lorebookOptions.cacheBoundary.index + 1);
    const sourceRuleHash = createHash('sha256').update(JSON.stringify(sourceRules)).digest('hex');
    const ruleUpdates = prefix && sourceRuleHash !== (previousTurn?.sourceRuleHash ?? prefix.sourceRuleHash)
      ? [{ role: 'system', content: `基础规则与角色资料已更新；从本轮起以下内容替代先前对应的规则与资料：\n\n${sourceRules.map(m => m.content).join('\n\n')}` }] : [];
    const messages = prefix
      ? [...prefix.messages, ...replay, ...ruleUpdates, currentUser]
      : [...context.messages.slice(0, -1), currentUser];
    const frozenLore = [...(prefix?.frozenLore || []), ...[...snapshots.values()].flatMap(s => s.frozenLore || [])];
    const options = { ...context.lorebookOptions, scope: `god:angel:${run.session_id}`, turnKey: run.id,
      step: db.prepare('SELECT COUNT(*) n FROM god_runs WHERE session_id=?').get(run.session_id).n,
      appendOnly: true, immutablePrefix: prefix ? messages.length - 1 : 0, frozenLore,
      ...(prefix ? { historyStart: prefix.messages.length, historyEnd: messages.length,
        cacheBoundary: { index: 0, offset: 0 }, depthTargets: undefined } : {}),
    };
    const prepared = await prepareNarrative(messages, options, { presetPlacement: 'cache', frozenPrefix: !!prefix,
      frozenPresetContent: previousTurn?.presetStableContent ?? prefix?.presetStableContent ?? '',
      frozenPresetActive: previousTurn?.presetActive ?? prefix?.presetActive ?? false });
    signal?.throwIfAborted();
    const userIndex = prepared.messages.findLastIndex(m => m.role === 'user');
    const tailStart = userIndex - (prepared.presetReport?.tailContent ? 1 : 0) - ruleUpdates.length;
    const placements = prepared.report?.placements || [];
    const keys = placements.filter(p => p.frozenKey).map(p => p.frozenKey);
    const presetStableContent = prepared.presetReport?.stableContent || '';
    const presetActive = !!prepared.presetReport?.presetActive;
    const turn = { messages: prepared.messages.slice(tailStart), frozenLore: keys, presetStableContent, presetActive, sourceRuleHash,
      contextUpdates: incremental.contextUpdates,
      ...(!sameSchedule && scheduleBlock ? { scheduleBlock } : {}) };
    // 旧版本会话没有快照，首次升级保留其原始历史；无法凭空还原过去的动态情境。
    const prefixEnd = prepared.messages.findIndex(m => m.role === 'user');
    const initialPrefix = { messages: prepared.messages.slice(0, Math.min(prefixEnd, tailStart)), frozenLore: keys, presetStableContent, presetActive, sourceRuleHash };
    if (prefix && JSON.stringify(prepared.messages.slice(0, tailStart)) !== JSON.stringify(messages.slice(0, -1 - ruleUpdates.length))) {
      throw new Error('神说严格追加校验失败：历史前缀被改写');
    }
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO god_prompt_prefixes(session_id,payload_json) VALUES (?,?)')
        .run(run.session_id, JSON.stringify(initialPrefix));
      db.prepare('INSERT OR IGNORE INTO god_prompt_turns(message_id,payload_json) VALUES (?,?)')
        .run(currentId, JSON.stringify(turn));
    })();
    return prepared;
  }
  return { prepare };
}
