import { promptTokens, textTokens } from './trpgPromptBudget.js';

export const GAME_REPLAY_RULE = '只执行最新 user 的任务，历史工具调用已处理，勿重复执行。历史回复中的行动提案以公开日志确认的结果为准。公开日志按出现顺序累积。<public_archive> 是较早公开日志的摘录。<round_state> 是按时间追加的状态更新。同名 JSON 顶层字段以最新一份整体替换，null 清空字段，未更新的字段沿用。';
const ARCHIVE_TOKENS = 1200;

export function appendReplay(previous, records, fields, task) {
  const prior = previous?.segments && previous.end <= records.length &&
    (!previous.end || previous.lastLogId === records[previous.end - 1]?.id) ? previous : null;
  const changes = {};
  const before = prior?.fields || {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(fields)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(fields[key])) changes[key] = fields[key] ?? null;
  }
  const end = records.length;
  const segments = prior?.segments || [];
  return {
    start: prior?.start || 0, end, lastLogId: records[end - 1]?.id ?? null, fields,
    archive: prior?.archive || [],
    segments: [...segments, { end, changes, userTail: `</dynamic_context>\n${task}` }],
  };
}

function segmentBlocks(segment, records, start, archive = []) {
  const parts = [];
  if (archive.length) parts.push('<public_archive>\n' + archive.map(row => JSON.stringify(row)).join('\n') + '\n</public_archive>');
  if (segment.end > start) parts.push('<public_log>\n' + records.slice(start, segment.end).map(row => JSON.stringify(row)).join('\n') + '\n</public_log>');
  if (Object.keys(segment.changes).length) parts.push('<round_state>\n' + JSON.stringify(segment.changes) + '\n</round_state>');
  return parts;
}

export function turnHead(segment, records, start, archive) {
  return `<dynamic_context>\n${segmentBlocks(segment, records, start, archive).join('\n\n')}\n`;
}

export function replayTurns(replay, records) {
  let start = replay.start;
  return replay.segments.flatMap((segment, index) => {
    const content = turnHead(segment, records, start, index === 0 ? replay.archive : []) + segment.userTail;
    start = segment.end;
    return [{ role: 'user', content }, ...(segment.responses || [])];
  });
}

export function replayMessage(replay, records) {
  let start = replay.start;
  const parts = replay.segments.flatMap((segment, index) => {
    const blocks = segmentBlocks(segment, records, start, index === 0 ? replay.archive : []);
    start = segment.end;
    return blocks;
  });
  return { role: 'system', content: parts.join('\n\n') };
}

function archivedExcerpts(records, end) {
  const important = new Set(['scene', 'clue', 'item', 'objective', 'stat', 'encounter']);
  const excerpts = [];
  let facts = Math.floor(ARCHIVE_TOKENS * 2 / 3);
  let dialogue = ARCHIVE_TOKENS - facts;
  for (let i = end - 1; i >= 0 && Math.max(facts, dialogue) >= 48; i--) {
    const { round, sceneId, kind, speaker, dialogue: say, action } = records[i];
    const row = { round, sceneId, kind, speaker, excerpt: [say, action].filter(Boolean).join(' ').slice(0, 160) };
    const tokens = textTokens(JSON.stringify(row) + '\n');
    if (important.has(kind)) {
      if (tokens > facts) continue;
      facts -= tokens;
    } else {
      if (tokens > dialogue) continue;
      dialogue -= tokens;
    }
    excerpts.push(row);
  }
  return excerpts.reverse();
}

export function fitReplay(replay, records, prefix, tail, tools, inputLimit) {
  return fitMessages(replay, records, current => [...prefix, replayMessage(current, records), ...tail], tools, inputLimit);
}

export function fitNativeReplay(replay, records, prefix, continuation, tools, inputLimit) {
  return fitMessages(replay, records, current => [...prefix, ...replayTurns(current, records), ...continuation], tools, inputLimit);
}

function fitMessages(replay, records, assemble, tools, inputLimit) {
  const current = assemble(replay);
  if (promptTokens(current, tools) <= Math.floor(inputLimit * 0.9)) return { replay, messages: current };

  const baseline = { ...replay, start: replay.end, archive: [], segments: [{ ...replay.segments.at(-1), end: replay.end, changes: replay.fields }] };
  const fixed = promptTokens(assemble(baseline), tools);
  const retain = Math.max(0, Math.min(Math.floor(inputLimit * 0.75) - fixed, inputLimit - fixed) - ARCHIVE_TOKENS - 32);
  let start = replay.end;
  let used = 0;
  while (start > replay.start) {
    used += textTokens(JSON.stringify(records[start - 1]) + '\n');
    if (used > retain) break;
    start--;
  }
  if (start > replay.start && start < replay.end && records[start - 1].round === records[start].round) {
    const boundary = records.findIndex((row, i) => i > start && i < replay.end && row.round !== records[start].round);
    if (boundary > start) start = boundary;
  }
  const archive = start === replay.start ? replay.archive : archivedExcerpts(records, start);
  const compacted = { ...baseline, start, archive };
  const messages = assemble(compacted);
  // The recap is optional if a single fixed scene, user message or tool transcript nearly fills the window.
  if (archive.length && promptTokens(messages, tools) > inputLimit) {
    const minimal = { ...compacted, archive: [] };
    return { replay: minimal, messages: assemble(minimal) };
  }
  return { replay: compacted, messages };
}
