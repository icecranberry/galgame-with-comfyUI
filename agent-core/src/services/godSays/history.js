import { parseJson } from './repository.js';

// 只读取当前会话原始历史，不生成摘要或检索其他会话。
export function createGodHistory(repo) {
  const { db } = repo;
  async function contextHistory(sessionId, { includeIds = false } = {}) {
    // 当前会话完整累积；忽略旧版压缩游标，从原始记录恢复本会话全部历史。
    const rows = db.prepare('SELECT * FROM god_messages WHERE session_id=? ORDER BY id').all(sessionId);
    const toolIds = new Set(rows.filter(m => m.role === 'tool' && m.status === 'done').map(m => `${m.run_id}:${m.tool_call_id}`));
    const acceptedToolIds = new Set();
    const messages = [];
    const messageIds = [];
    for (const row of rows) {
      if (row.status !== 'done') continue;
      const calls = parseJson(row.tool_calls, []);
      if (calls.some(c => !toolIds.has(`${row.run_id}:${c.id}`))) continue;
      for (const call of calls) acceptedToolIds.add(`${row.run_id}:${call.id}`);
      if (row.role === 'tool' && !acceptedToolIds.has(`${row.run_id}:${row.tool_call_id}`)) continue;
      const provider = parseJson(row.provider_json, {});
      messages.push({ role: row.role, content: row.content,
        ...(row.role === 'assistant' ? provider : {}),
        ...(calls.length ? { tool_calls: calls } : {}),
        ...(row.role === 'tool' ? { tool_call_id: row.tool_call_id } : {}),
      });
      messageIds.push(row.id);
    }
    return { messages, ...(includeIds ? { messageIds } : {}) };
  }
  return { contextHistory };
}
