import { SentenceSplitter } from '../utils/sentenceSplitter.js';

// 只认行首的旁白标签和本角色的名字，不把正文中的冒号当成角色切换。
function readSpeakerLabel(line, characterName) {
  const match = line.match(/^\s*\*{0,2}([^：:\n]+?)\*{0,2}\s*[:：]\*{0,2}\s*(.*)$/su);
  if (!match) return null;
  const name = match[1].trim();
  if (name === characterName) return { speaker: 'character', text: match[2].trim() };
  if (/^(旁白|独白|narrator)$/i.test(name)) return { speaker: 'narrator', text: match[2].trim() };
  return null;
}

export function hasPrivateSpeakerLabel(content, characterName) {
  return content.split('\n').some(line => readSpeakerLabel(line, characterName));
}

// 完整消息要保留台词原有的标点和表情标记，不能从已分句、去标点的气泡反拼。
export function privateReplyText(content, narration, characterName) {
  if (narration || !hasPrivateSpeakerLabel(content, characterName)) return content;
  let speaker = 'character';
  const dialogue = [];
  for (const line of content.split(/\r?\n/)) {
    const label = readSpeakerLabel(line, characterName);
    if (label) speaker = label.speaker;
    if (speaker === 'character') dialogue.push(label ? label.text : line);
  }
  return dialogue.join('\n').trim();
}

// 旧版关闭开关时，分句器可能把一行旁白拆成多个标为 character 的气泡。
// 同一 raw_id 内的后续碎片继承上一个显式标签，只修正读取结果。
export function normalizePrivateReplyRows(rows, characterName) {
  let rawId, legacySpeaker;
  return rows.map(row => {
    if (row.raw_id == null || row.raw_id !== rawId || row.role !== 'assistant') legacySpeaker = null;
    rawId = row.raw_id;
    if (row.role !== 'assistant' || row.raw_id == null || !row.content) return row;
    if (row.speaker === 'narrator') { legacySpeaker = null; return row; }
    const label = readSpeakerLabel(row.content, characterName);
    if (label) {
      legacySpeaker = label.speaker;
      return { ...row, speaker: label.speaker, content: label.text };
    }
    return legacySpeaker && legacySpeaker !== row.speaker ? { ...row, speaker: legacySpeaker } : row;
  });
}

export function createPrivateReplySplitter(narration, characterName) {
  // 关闭时仅等可能的行首标签补齐；普通文字继续实时分句，命中标签后本轮改为按行解析。
  const plain = new SentenceSplitter();
  const labels = ['旁白', '独白', 'narrator', characterName].filter(Boolean).map(name => name.toLowerCase());
  let tagged = narration;
  let atLineStart = true;
  let pending = '';
  let stopped = false;
  let speaker = 'character';
  function consume(chunk, flush = false) {
    const segments = [];
    function takePlain(result) {
      for (const text of result.segments) segments.push({ text, speaker: 'character' });
      stopped = result.stopped;
    }
    const lines = chunk.split('\n');
    for (const [i, part] of lines.entries()) {
      if (stopped) break;
      const newline = i < lines.length - 1;
      pending += part;
      if (!tagged && atLineStart) {
        if (readSpeakerLabel(pending, characterName)) {
          takePlain(plain.flushAll());
          tagged = true;
        } else if (!newline && !flush) {
          const prefix = pending.trimStart().replace(/^\*{1,2}/, '').replace(/[\s*]+$/, '').toLowerCase();
          if (labels.some(name => name.startsWith(prefix))) continue;
        }
      }
      if (tagged) {
        const stopAt = pending.search(/\{["“”p]/);
        if (stopAt >= 0) { pending = pending.slice(0, stopAt); stopped = true; }
        if (!newline && !flush && !stopped) continue;
        const label = readSpeakerLabel(pending, characterName);
        if (label) speaker = label.speaker;
        const text = label ? label.text : pending.trim();
        if (text) segments.push({ text, speaker });
      } else {
        takePlain(plain.feed(pending + (newline ? '\n' : '')));
      }
      pending = '';
      atLineStart = newline;
    }
    if (flush && !tagged) takePlain(plain.flushAll());
    return { segments, stopped };
  }
  return {
    feed: chunk => consume(chunk),
    flushAll: () => consume('', true),
  };
}

export function splitPrivateReply(content, narration, characterName) {
  const splitter = createPrivateReplySplitter(narration, characterName);
  const parts = [...splitter.feed(content).segments, ...splitter.flushAll().segments];
  return narration ? parts : parts.filter(part => part.speaker !== 'narrator');
}
