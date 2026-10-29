function withoutPromptObjects(text) {
  const start = /\{\s*["“”']?prompt["“”']?\s*:/gi;
  let output = '', from = 0, match;
  while ((match = start.exec(text))) {
    output += text.slice(from, match.index);
    let depth = 0, quote = null, escaped = false, end = text.length;
    for (let index = match.index; index < text.length; index++) {
      const char = text[index];
      if (escaped) { escaped = false; continue; }
      if (quote) {
        if (char === '\\') escaped = true;
        else if (char === quote || (quote === '”' && char === '“')) quote = null;
      } else if (char === '"' || char === "'" || char === '“' || char === '”') quote = char === '“' ? '”' : char;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) { end = index + 1; break; }
    }
    from = end; start.lastIndex = end;
  }
  return output + text.slice(from);
}

/** Presentation-only cleanup. Never write this text back to raw_messages. */
export function cleanDialogueText(content, { role = 'assistant', emojiKeys = [] } = {}) {
  if (role !== 'assistant') return String(content || '').trim();
  const keys = new Set(emojiKeys);
  return withoutPromptObjects(String(content || ''))
    .replace(/<generate\b[^>]*>[\s\S]*?(?:<\/generate>|$)/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, '')
    .replace(/<\/?(?:needImage|context)\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[([^\]\n]*)\]|【([^】\n]*)】/g, (match, square, wide) => keys.has((square ?? wide).trim()) ? '' : match)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cursor pagination is over raw IDs, including attachment-only rows. */
export function readDialogueTranscript(db, characterId, { before, after, limit = 40, refreshIds = '' } = {}) {
  const conversationId = `char_${Number(characterId)}`;
  const count = Math.min(100, Math.max(1, Math.floor(Number(limit) || 40)));
  const forward = Number(after) > 0;
  const cursor = forward ? Number(after) : Number(before);
  const params = [conversationId];
  let condition = '';
  if (cursor > 0) { condition = ` AND id ${forward ? '>' : '<'} ?`; params.push(cursor); }
  const rows = db.prepare(`SELECT id, role, content, created_at FROM raw_messages
    WHERE conversation_id = ? AND role IN ('user','assistant')${condition}
    ORDER BY id ${forward ? 'ASC' : 'DESC'} LIMIT ?`).all(...params, count + 1);
  const hasMore = rows.length > count;
  const page = rows.slice(0, count);
  if (!forward) page.reverse();
  // 图片会在台词保存后才挂到分句消息上；刷新已读 raw ID，不移动增量游标。
  const ids = [...new Set(String(refreshIds).split(',').map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 100);
  const refreshed = ids.length ? db.prepare(`SELECT id, role, content, created_at FROM raw_messages
    WHERE conversation_id = ? AND role IN ('user','assistant') AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(conversationId, ...ids) : [];
  const attachmentIds = [...new Set([...page, ...refreshed].map(row => row.id))];
  const images = new Map(), speechSegments = new Map();
  const emojiKeys = db.prepare('SELECT emoji_key FROM emoji_categories').all().map(row => row.emoji_key);
  if (attachmentIds.length) {
    const attachments = db.prepare(`SELECT id, raw_id, role, content, images FROM messages WHERE conversation_id = ?
      AND raw_id IN (${attachmentIds.map(() => '?').join(',')}) ORDER BY seq, id`).all(conversationId, ...attachmentIds);
    for (const row of attachments) {
      const content = cleanDialogueText(row.content, { role: row.role, emojiKeys });
      if (row.role === 'assistant' && /[\p{L}\p{N}]/u.test(content)) {
        const segments = speechSegments.get(row.raw_id) || [];
        segments.push({ id: row.id, content });
        speechSegments.set(row.raw_id, segments);
      }
      let urls;
      try { urls = JSON.parse(row.images); } catch { continue; }
      if (!Array.isArray(urls)) continue;
      const existing = images.get(row.raw_id) || new Set();
      for (const url of urls) {
        if (typeof url !== 'string' || !/^(?:\/images\/|\/avatars\/|https?:\/\/)/i.test(url)) continue;
        // messages.images 混存配图和表情包；与普通聊天一样按 emoji 存储目录区分。
        // 只检查 URL 路径，普通图片的查询参数提及表情包地址时不误删。
        if (/\/images\/emoji\//i.test(url.split(/[?#]/, 1)[0])) continue;
        existing.add(url);
      }
      images.set(row.raw_id, existing);
    }
  }
  const latest = db.prepare("SELECT id, role FROM raw_messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY id DESC LIMIT 1").get(conversationId);
  const present = row => ({ ...row, content: cleanDialogueText(row.content, { role: row.role, emojiKeys }), images: [...(images.get(row.id) || [])], speech_segments: row.role === 'assistant' ? speechSegments.get(row.id) || [] : [] });
  return {
    messages: page.map(present),
    refreshed: refreshed.map(present),
    hasMore, latestId: latest?.id || null, latestRole: latest?.role || null,
  };
}
