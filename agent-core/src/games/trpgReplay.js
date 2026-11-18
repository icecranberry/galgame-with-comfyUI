import { promptTokens, textTokens } from './trpgPromptBudget.js';

export const GAME_REPLAY_RULE = '只执行最新 user 的任务。公开日志按出现顺序累积，以其中登记的叙事和检定结果为准，已经结算的行动无需重做。<public_archive> 是较早公开日志的摘录。<round_state> 是按时间追加的状态更新。actorStates 按姓名和状态字段逐项更新，illustrations 按事件编号合并，其余同名顶层字段整体替换。null 清空对应值，未出现的字段沿用。';
const ARCHIVE_TOKENS = 1200;
const LOG_BLOCK_OVERHEAD = promptTokens([{ role: 'user', content: '<public_log>\n\n</public_log>' }]) - promptTokens([]);

function changedFields(before, after) {
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key =>
    JSON.stringify(before[key]) === JSON.stringify(after[key]) ? [] : [[key, after[key] ?? null]]));
}

function publicLine({ id, speaker, kind, dialogue, action }) {
  if (kind === 'illustration') return `${speaker}：${id}`;
  const label = kind === 'scene' ? `${speaker}（场景）` : speaker;
  return `${label}：${dialogue || ''}${action ? `〔${action}〕` : ''}`.replace(/\r?\n/g, '\n  ');
}

function logRole({ kind, actorId }) {
  return kind === 'dialogue' && actorId && actorId !== 'player' ? 'assistant' : 'user';
}

export function appendReplay(previous, records, fields, task) {
  const prior = previous?.compact && previous.end <= records.length &&
    (!previous.end || previous.lastLogId === records[previous.end - 1]?.id) ? previous : null;
  const before = prior?.fields || {};
  const changes = changedFields(before, fields);
  if (changes.actorStates) {
    const actors = changedFields(before.actorStates || {}, changes.actorStates);
    const patch = Object.fromEntries(Object.entries(actors).flatMap(([id, state]) => {
      if (state === null) return [[id, null]];
      const fields = changedFields(before.actorStates?.[id] || {}, state);
      return Object.keys(fields).length ? [[id, fields]] : [];
    }));
    if (Object.keys(patch).length) changes.actorStates = patch;
    else delete changes.actorStates;
  }
  if (changes.illustrations && before.illustrations) changes.illustrations = changedFields(before.illustrations, changes.illustrations);
  const end = records.length;
  const segments = prior?.segments || [];
  return {
    compact: true, speakerRoles: true, start: prior?.start || 0, end, lastLogId: records[end - 1]?.id ?? null, fields,
    archive: prior?.archive || [],
    segments: [...segments, { end, changes, userTail: `</dynamic_context>\n${task}` }],
  };
}

function segmentBlocks(segment, records, start, archive = [], compact = false) {
  const parts = [];
  const format = compact ? publicLine : row => JSON.stringify(row);
  if (archive.length) parts.push('<public_archive>\n' + archive.map(format).join('\n') + '\n</public_archive>');
  if (segment.end > start) parts.push('<public_log>\n' + records.slice(start, segment.end).map(format).join('\n') + '\n</public_log>');
  if (Object.keys(segment.changes).length) parts.push('<round_state>\n' + JSON.stringify(segment.changes) + '\n</round_state>');
  return parts;
}

export function turnHead(segment, records, start, archive, compact) {
  return `<dynamic_context>\n${segmentBlocks(segment, records, start, archive, compact).join('\n\n')}\n`;
}

export function replayTurns(replay, records) {
  let start = replay.start;
  return replay.segments.flatMap((segment, index) => {
    const messages = [];
    let logStart = start;
    let archive = index === 0 ? replay.archive : [];
    // An older in-flight checkpoint still uses its original user-only format.
    if (replay.speakerRoles) {
      for (let cursor = start; cursor < segment.end;) {
        if (logRole(records[cursor]) !== 'assistant') {
          cursor++;
          continue;
        }
        const blocks = segmentBlocks({ end: cursor, changes: {} }, records, logStart, archive, replay.compact);
        if (blocks.length) messages.push({ role: 'user', content: blocks.join('\n\n') });
        archive = [];
        let end = cursor + 1;
        while (end < segment.end && logRole(records[end]) === 'assistant') end++;
        messages.push({ role: 'assistant', content: records.slice(cursor, end).map(publicLine).join('\n') });
        logStart = cursor = end;
      }
    }
    const content = turnHead(segment, records, logStart, archive, replay.compact) + segment.userTail;
    start = segment.end;
    return [...messages, { role: 'user', content }];
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

function archivedExcerpts(records, end, compact) {
  const important = new Set(['scene', 'clue', 'item', 'objective', 'stat', 'encounter']);
  const excerpts = [];
  let facts = Math.floor(ARCHIVE_TOKENS * 2 / 3);
  let dialogue = ARCHIVE_TOKENS - facts;
  for (let i = end - 1; i >= 0 && Math.max(facts, dialogue) >= 48; i--) {
    const { round, sceneId, kind, speaker, dialogue: say, action } = records[i];
    if (kind === 'illustration') continue;
    const excerpt = [say, action].filter(Boolean).join(' ').slice(0, 160);
    const row = compact ? { kind, speaker, dialogue: excerpt } : { round, sceneId, kind, speaker, excerpt };
    const tokens = textTokens((compact ? publicLine(row) : JSON.stringify(row)) + '\n');
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
  // Legacy saves kept completed provider messages here. The active checkpoint is separate.
  if (replay.segments.some(segment => Object.hasOwn(segment, 'responses'))) {
    replay = { ...replay, segments: replay.segments.map(({ responses, ...segment }) => segment) };
  }
  const current = assemble(replay);
  if (promptTokens(current, tools) <= Math.floor(inputLimit * 0.9)) return { replay, messages: current };

  const baseline = { ...replay, start: replay.end, archive: [], segments: [{ ...replay.segments.at(-1), end: replay.end, changes: replay.fields }] };
  if (replay.compact) {
    // Consolidate state snapshots before cutting the dialogue transcript.
    const transcript = { ...baseline, start: replay.start, archive: replay.archive };
    const transcriptMessages = assemble(transcript);
    if (promptTokens(transcriptMessages, tools) <= Math.floor(inputLimit * 0.9)) return { replay: transcript, messages: transcriptMessages };
  }
  const fixed = promptTokens(assemble(baseline), tools);
  const retain = Math.max(0, Math.min(Math.floor(inputLimit * 0.75) - fixed, inputLimit - fixed) - ARCHIVE_TOKENS - 32);
  let start = replay.end;
  let used = 0;
  let nextRole;
  while (start > replay.start) {
    const row = records[start - 1];
    if (replay.speakerRoles) {
      const role = logRole(row);
      if (role !== nextRole) used += LOG_BLOCK_OVERHEAD;
      nextRole = role;
    }
    used += textTokens((replay.compact ? publicLine(row) : JSON.stringify(row)) + '\n');
    if (used > retain) break;
    start--;
  }
  if (start > replay.start && start < replay.end && records[start - 1].round === records[start].round) {
    const boundary = records.findIndex((row, i) => i > start && i < replay.end && row.round !== records[start].round);
    if (boundary > start) start = boundary;
  }
  const archive = start === replay.start ? replay.archive : archivedExcerpts(records, start, replay.compact);
  const compacted = { ...baseline, start, archive };
  const messages = assemble(compacted);
  // The recap is optional if a single fixed scene, user message or tool transcript nearly fills the window.
  if (archive.length && promptTokens(messages, tools) > inputLimit) {
    const minimal = { ...compacted, archive: [] };
    return { replay: minimal, messages: assemble(minimal) };
  }
  return { replay: compacted, messages };
}
