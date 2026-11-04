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
