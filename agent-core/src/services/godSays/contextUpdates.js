// 仅比较实际发送且仍在历史中的情境。省略的字段沿用旧值，不把窗口淘汰当成事件结束。
const tags = ['world_events', 'god_work', 'angel_wardrobe'];
const defaultWardrobe = '<angel_wardrobe>可用服装已清空；当前恢复天使人设中的默认服装，不再沿用此前的换装。</angel_wardrobe>';

function entries(tag, block) {
  if (tag === 'world_events') {
    const json = /\n(\[[^\n]*\])\n<\/world_events>$/.exec(block)?.[1];
    try {
      const rows = JSON.parse(json);
      if (Array.isArray(rows) && rows.every(row => Number.isInteger(row?.id))) {
        return rows.map(row => [String(row.id), row]);
      }
    } catch { /* 旧版或非结构化内容保守地按整块去重。 */ }
  } else if (tag === 'god_work') {
    const body = block.slice(0, block.lastIndexOf('</god_work>')).trimEnd();
    const lines = [...body.matchAll(/^- 事件\/任务(\d+)[\s\S]*?(?=\n- 事件\/任务\d+|(?![\s\S]))/gm)];
    if (lines.length) return lines.map(match => [match[1], match[0]]);
  }
  return block ? [['block', block]] : [];
}

function legacyBlocks(messages) {
  const blocks = {};
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = typeof message.content === 'string' ? message.content
      : message.content?.find(part => part.type === 'text' && part.text?.startsWith('<dynamic_context>\n'))?.text;
    if (!text?.startsWith('<dynamic_context>\n')) continue;
    // 时间块结束是系统动态区的末端；用户原话中的同名标签不能成为去重依据。
    const end = text.indexOf('</time_context>\n</dynamic_context>');
    if (end < 0) continue;
    const dynamic = text.slice(0, end);
    for (const tag of tags) {
      const block = new RegExp(`(?:^|\n)<${tag}>[\\s\\S]*?</${tag}>(?=\n|$)`).exec(dynamic)?.[0].trim();
      if (block) blocks[tag] = block;
    }
  }
  return Object.fromEntries(tags.map(tag => [tag, entries(tag, blocks[tag] || '')]));
}

export function appendContextUpdates(message, blocks = {}, snapshots = []) {
  const known = Object.fromEntries(tags.map(tag => [tag, new Map()]));
  for (const snapshot of snapshots) {
    let legacy;
    for (const tag of tags) {
      // 新增去重类型时，旧版元数据可能只有部分字段；按类型回退读取原请求。
      const updates = snapshot.contextUpdates?.[tag] ?? (legacy ??= legacyBlocks(snapshot.messages))[tag];
      for (const [id, value] of updates || []) {
        known[tag].set(id, typeof value === 'object' ? { ...known[tag].get(id), ...value } : value);
      }
    }
  }
  const contextUpdates = {};
  let current = message;
  for (const tag of tags) {
    const clearingWardrobe = tag === 'angel_wardrobe' && !blocks[tag] && known[tag].has('block');
    const block = clearingWardrobe ? defaultWardrobe : blocks[tag];
    if (!block) continue;
    const changes = [];
    for (const [id, value] of entries(tag, block)) {
      const old = known[tag].get(id);
      if (JSON.stringify(old) === JSON.stringify(value)) continue;
      if (old && typeof value === 'object') {
        const fields = Object.entries(value).filter(([key, field]) => key !== 'id' && JSON.stringify(old[key]) !== JSON.stringify(field));
        if (fields.length) changes.push([id, { id: value.id, ...Object.fromEntries(fields) }]);
      } else changes.push([id, value]);
    }
    contextUpdates[tag] = changes;
    let replacement = '';
    if (changes.length) {
      if (changes[0][0] === 'block' || !known[tag].size) replacement = block;
      else {
        const headerEnd = tag === 'world_events' ? block.indexOf('\n[') : block.indexOf('\n- 事件/任务');
        const note = tag === 'world_events'
          ? '以下仅列新增或变化字段，按 id 合并此前事实；未列出的字段和事件不表示删除，时效以 endsAt 与本条时间为准。'
          : '以下仅列新增或状态变化的任务，未列出表示没有新状态；按编号更新，详情按需查询。';
        const body = tag === 'world_events' ? JSON.stringify(changes.map(([, value]) => value))
          : changes.map(([, value]) => value).join('\n');
        replacement = `${block.slice(0, headerEnd)}\n${note}\n${body}\n</${tag}>`;
      }
    }
    const rewrite = text => {
      if (!text.startsWith('<dynamic_context>\n')) return text;
      const end = text.indexOf('</time_context>\n</dynamic_context>');
      if (clearingWardrobe) {
        const timeStart = text.indexOf('<time_context>\n');
        return replacement && timeStart >= 0 && timeStart < end
          ? text.slice(0, timeStart) + `${replacement}\n\n` + text.slice(timeStart) : text;
      }
      const start = text.indexOf(`${block}\n\n`);
      if (start < 0 || end < 0 || start + block.length > end) return text;
      return text.slice(0, start) + (replacement ? `${replacement}\n\n` : '') + text.slice(start + block.length + 2);
    };
    current = { ...current, content: typeof current.content === 'string' ? rewrite(current.content)
      : current.content.map(part => part.type === 'text' ? { ...part, text: rewrite(part.text) } : part) };
  }
  return { message: current, contextUpdates };
}
