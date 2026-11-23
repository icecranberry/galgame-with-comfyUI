import { injectBook } from './engine.js';
import { buildPromptProfile } from './promptProfile.js';

/** Locate depth inside exact serialized envelopes; never split business messages. */
export function applyLorebookLayout(original, activation, options = {}) {
  const profile = buildPromptProfile(original, options);
  const injectionOptions = { ...profile, ...options, anchors: { ...profile.anchors, ...options.anchors }, stableAnchors: { ...profile.stableAnchors, ...options.stableAnchors } };
  const tail = original.findLastIndex(message => message.role === 'user');
  const taskText = original[tail]?.content;
  const dynamicEnd = typeof taskText === 'string' ? taskText.lastIndexOf('</dynamic_context>') : -1;
  const taskTarget = options.fallbackTarget ?? { index: tail, offset: dynamicEnd >= 0 ? dynamicEnd : 0 };
  if (tail >= 0) injectionOptions.fallbackTarget = taskTarget;
  // Examples are prose, not invented API user/assistant turns. Prefer the
  // adjacent system end; otherwise use a dedicated lore-only system slot.
  const exampleTarget = { index: tail < 0 ? original.length : tail, systemOnly:true, label:'末条 user 之前的示例区' };
  injectionOptions.anchors.beforeExamples = options.anchors?.beforeExamples ?? exampleTarget;
  injectionOptions.anchors.afterExamples = options.anchors?.afterExamples ?? exampleTarget;
  injectionOptions.exampleTarget = exampleTarget;
  const locateEnvelope = (index, tag, segments) => {
    const content = original[index]?.content;
    if (typeof content !== 'string' || !segments?.length) return null;
    const envelope = `<${tag}>\n${segments.join('\n')}\n</${tag}>`;
    const start = content.indexOf(envelope);
    if (start < 0) return null;
    let offset = start + `<${tag}>\n`.length;
    const targets = segments.map(segment => {
      const target = { index, offset };
      offset += segment.length + 1;
      return target;
    });
    return { targets, end: { index, offset } };
  };
  const active = locateEnvelope(tail, 'active_chat_history', options.activeSegments);
  if (active) {
    const checkpointTargets = [];
    for (let index = options.historyStart ?? tail; index < tail; index++) checkpointTargets.push({ index });
    // Current user counts toward depth; depth 0 cannot go after the final task.
    injectionOptions.depthTargets = [...checkpointTargets, ...active.targets, taskTarget, taskTarget];
  }
  const transcriptIndex = original.findIndex(message => typeof message.content === 'string' && message.content.startsWith('<group_transcript>'));
  const transcript = locateEnvelope(transcriptIndex, 'group_transcript', options.transcriptSegments);
  if (transcript) injectionOptions.depthTargets = [...transcript.targets, transcript.end];
  return injectBook(original, activation, injectionOptions);
}
