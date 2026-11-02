import { createHash } from 'node:crypto';
import { classifyCacheEntry } from './cachePolicy.js';

export const DEFAULT_SETTINGS = Object.freeze({ scanDepth: 2, vectorQueryMessages: 2, recursive: false, maxRecursionSteps: 32, minActivations: 0, minDepthMax: 100, budgetPercent: 25, budgetCap: 8192, contextTokens: 32768, caseSensitive: false, matchWholeWords: false, includeNames: true, useGroupScoring: false, positionPolicy:'cache' });
export const POSITIONS = ['角色之前', '角色之后', '作者注之前', '作者注之后', '聊天深度', '示例之前', '示例之后', 'Outlet'];
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const estimateTokens = text => Math.ceil(Array.from(String(text)).reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? 1.5 : 0.3), 0));
const finite = (v, fallback, min = 0, max = 100000) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;
const strings = v => Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : [];

export function normalizeBook(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('世界书必须是 JSON 对象');
  const source = input.character_book || input;
  if (!source.entries || typeof source.entries !== 'object') throw new Error('找不到世界书 entries');
  const entries = {}; const warnings = []; const seen = new Set();
  for (const [index, original] of Object.entries(source.entries)) {
    if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error(`条目 ${index} 格式错误`);
    const x = original.extensions || {};
    const uid = String(original.uid ?? original.id ?? index);
    if (seen.has(uid)) throw new Error(`条目 UID 重复：${uid}`);
    seen.add(uid);
    const entry = { ...original, uid: original.uid ?? original.id ?? index,
      key: strings(original.key ?? original.keys), keysecondary: strings(original.keysecondary ?? original.secondary_keys),
      content: String(original.content ?? ''), comment: String(original.comment ?? original.name ?? ''),
      constant: !!original.constant, disable: original.disable ?? original.enabled === false,
      characterFilter: original.characterFilter ?? x.characterFilter ?? x.character_filter,
      position: finite(typeof original.position === 'number' ? original.position : x.position ?? (original.position === 'after_char' ? 1 : 0), 0, 0, 7),
      order: finite(original.order ?? original.insertion_order, 100, -100000),
      depth: finite(original.depth ?? x.depth, 4, 0, 1000), role: finite(original.role ?? x.role, 0, 0, 2),
      selective: original.selective ?? true, selectiveLogic: finite(original.selectiveLogic ?? x.selectiveLogic, 0, 0, 3),
      probability: finite(original.probability ?? x.probability, 100, 0, 100), useProbability: original.useProbability ?? x.useProbability ?? true,
    };
    const aliases = { excludeRecursion: 'exclude_recursion', preventRecursion: 'prevent_recursion', delayUntilRecursion: 'delay_until_recursion', scanDepth: 'scan_depth', caseSensitive: 'case_sensitive', matchWholeWords: 'match_whole_words', useGroupScoring: 'use_group_scoring', groupOverride: 'group_override', groupWeight: 'group_weight', outletName: 'outlet_name', automationId: 'automation_id', ignoreBudget: 'ignore_budget', matchPersonaDescription: 'match_persona_description', matchCharacterDescription: 'match_character_description', matchCharacterPersonality: 'match_character_personality', matchCharacterDepthPrompt: 'match_character_depth_prompt', matchScenario: 'match_scenario', matchCreatorNotes: 'match_creator_notes' };
    for (const key of [...Object.keys(aliases), 'sticky', 'cooldown', 'delay', 'vectorized', 'group', 'triggers']) entry[key] = original[key] ?? x[aliases[key] || key] ?? (key === 'triggers' ? [] : null);
    if (entry.automationId) warnings.push(`${uid}: 自动化 ID 已保留；ST Quick Reply 脚本不在邻舍执行`);
    if (entry.position === 7 && !entry.outletName) warnings.push(`${uid}: Outlet 名称为空，不会自动注入`);
    entries[uid] = entry;
  }
  return { document: { ...source, entries }, warnings };
}

export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  for (const [k, max] of Object.entries({ scanDepth: 1000, vectorQueryMessages: 1000, maxRecursionSteps: 100, minActivations: 1000, minDepthMax: 1000, budgetPercent: 100, budgetCap: 1000000, contextTokens: 2000000 })) s[k] = finite(s[k], DEFAULT_SETTINGS[k], 0, max);
  s.vectorQueryMessages = Math.max(1, Math.floor(s.vectorQueryMessages));
  s.maxRecursionSteps = s.maxRecursionSteps || 32;
  return s;
}

export function renderMacros(text, context, variables = {}, random = Math.random, warnings = []) {
  const values = { char: context.characterName || '角色', user: context.userName || '用户', persona: context.personaDescription || '', description: context.characterDescription || '', personality: context.characterPersonality || '', scenario: context.scenario || '', lastmessage: context.history?.at(-1)?.content || '', lastusermessage: [...(context.history || [])].reverse().find(m => m.role === 'user')?.content || '', newline: '\n', trim: '', noop: '' };
  return String(text).replace(/\{\{([^{}]+)\}\}/g, (original, body) => {
    const [name, ...args] = body.split('::'); const key = name.trim().toLowerCase();
    if (Object.hasOwn(values, key)) return values[key];
    if (key === 'outlet') return original; // Resolved after activation, never during scanning.
    if (key === 'getvar') return String(variables[args[0]] ?? '');
    if (key === 'setvar') { variables[args[0]] = args.slice(1).join('::'); return ''; }
    if (key === 'getglobalvar' || key === 'setglobalvar') { warnings.push(`全局变量宏 ${original} 依赖 ST 用户变量，已原样保留`); return original; }
    if (key === 'random' || key === 'pick') { const choices = args.length > 1 ? args : (args[0] || '').split(','); return choices[Math.floor(random() * choices.length)] || ''; }
    if (key === 'date' || key === 'time' || key === 'datetime') { const date = new Date(context.now || Date.now()); return key === 'date' ? date.toLocaleDateString('zh-CN') : key === 'time' ? date.toLocaleTimeString('zh-CN') : date.toLocaleString('zh-CN'); }
    warnings.push(`未支持的宏 ${original} 已原样保留`); return original;
  });
}

function matches(text, key, entry, settings, warnings) {
  if (!key) return false;
  const regex = key.match(/^\/(.*)\/([dgimsuvy]*)$/s);
  if (regex) { try { return new RegExp(regex[1], regex[2]).test(text); } catch { warnings.push(`条目 ${entry.uid} 的正则无效：${key}`); return false; } }
  if (!(entry.caseSensitive ?? settings.caseSensitive)) { text = text.toLowerCase(); key = key.toLowerCase(); }
  if (!(entry.matchWholeWords ?? settings.matchWholeWords) || /\s/.test(key)) return text.includes(key);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ST's whole-word matching uses JS \W boundaries, including its CJK behavior.
  return new RegExp(`(?:^|\\W)(${escaped})(?:$|\\W)`).test(text);
}

/** Pure evaluation. state is copied; preview/retry never mutate the caller's state. */
export function evaluateBook(document, settingsInput, context = {}, state = {}, { random = Math.random, countTokens = estimateTokens } = {}) {
  const settings = normalizeSettings(settingsInput); const warnings = []; const trace = [];
  const variables = { ...(state.variables || {}) }; const nextState = structuredClone(state); nextState.entries ||= {};
  const step = context.step ?? 0; const history = context.history || [];
  const hardLimit = context.availableTokens ?? Infinity;
  const budget = Math.max(1, Math.min(Math.round((context.contextTokens || settings.contextTokens) * settings.budgetPercent / 100), settings.budgetCap || Infinity, context.availableTokens ?? Infinity));
  const profiles = new Map(Object.values(document.entries).map(entry => [String(entry.uid), classifyCacheEntry(entry)]));
  const stablePriority = entry => settings.positionPolicy !== 'anchors' && profiles.get(String(entry.uid)).tier === 'stable' ? 1 : 0;
  // Conditional hits cannot displace an always-on prefix merely by taking its
  // budget first. The hard context limit still applies to every entry.
  const entries = Object.values(document.entries).sort((a, b) => stablePriority(b) - stablePriority(a) || b.order - a.order || String(a.uid).localeCompare(String(b.uid), 'en', { numeric: true }));
  const activated = new Map(); const failed = new Set(); const rolls = new Map(); const chosenGroups = new Set();
  let recursionText = ''; let depth = settings.scanDepth; let phase = 'initial'; let delayLevel = 0; let overflow = false; let tokens = 0;
  const levels = [...new Set(entries.map(e => Number(e.delayUntilRecursion) || 0).filter(Boolean))].sort((a,b) => a-b);
  const log = (e, reason, extra = {}) => trace.push({ uid: e.uid, title: e.comment, phase, reason, ...extra });
  for (let pass = 0; pass < settings.maxRecursionSteps; pass++) {
    const candidates = [];
    for (const entry of entries) {
      const id = String(entry.uid); if (activated.has(id) || failed.has(id)) continue;
      const effect = state.entries?.[id]?.hash === hash(entry) ? state.entries[id] : {};
      const sticky = step < (effect.stickyUntil ?? -1); const cooldown = step < (effect.cooldownUntil ?? -1);
      if (entry.disable) { if (!pass) log(entry, 'disabled'); continue; }
      if (entry.triggers?.length && !entry.triggers.includes(context.trigger || 'normal')) { if (!pass) log(entry, 'trigger'); continue; }
      const filter = entry.characterFilter || {};
      const names = strings(filter.names); const tags = strings(filter.tags);
      if (tags.length && !context.characterTags) warnings.push('当前请求没有角色标签来源；标签筛选按空标签集合处理，不猜测 ST 标签');
      if ((names.length && (names.some(n => (context.characterNames?.length ? context.characterNames : [context.characterName]).includes(n)) === !!filter.isExclude)) || (tags.length && (tags.some(t => context.characterTags?.includes(t)) === !!filter.isExclude))) { if (!pass) log(entry, 'character-filter'); continue; }
      if (step < Number(entry.delay || 0) || (cooldown && !sticky)) { log(entry, cooldown ? 'cooldown' : 'delay'); continue; }
      if (!sticky && entry.delayUntilRecursion && (phase !== 'recursion' || Number(entry.delayUntilRecursion) > delayLevel)) continue;
      if (!sticky && phase === 'recursion' && settings.recursive && entry.excludeRecursion) continue;
      if (/^@@dont_activate\s*$/m.test(entry.content) && !/^@@activate\s*$/m.test(entry.content)) { log(entry, 'decorator-disabled'); continue; }
      let reason = sticky ? 'sticky' : entry.constant ? 'constant' : context.forcedIds?.includes(id) ? 'external' : context.vectorIds?.includes(id) ? 'vector' : /^@@activate\s*$/m.test(entry.content) ? 'decorator' : '';
      let score = 0;
      if (!reason || (entry.group && (entry.useGroupScoring ?? settings.useGroupScoring) && !sticky)) {
        const d = entry.scanDepth ?? depth;
        const parts = d > 0 ? history.slice(-d).map(m => {
          const name = m.name || (m.role === 'user' ? context.userName : m.role === 'assistant' && !context.group ? context.characterName : '');
          return settings.includeNames && name ? `${name}: ${m.content}` : m.content;
        }) : [];
        if (d > 0) {
          for (const [flag, key] of Object.entries({ matchPersonaDescription: 'personaDescription', matchCharacterDescription: 'characterDescription', matchCharacterPersonality: 'characterPersonality', matchCharacterDepthPrompt: 'characterDepthPrompt', matchScenario: 'scenario', matchCreatorNotes: 'creatorNotes' })) if (entry[flag] && context[key]) parts.push(context[key]);
          parts.push(...(context.scanTexts || [])); if (phase !== 'minimum') parts.push(recursionText);
        }
        const text = parts.join('\n\x01');
        const primary = entry.key.map(k => matches(text, renderMacros(k, context, { ...variables }, random, warnings).trim(), entry, settings, warnings));
        if (!reason && !primary.some(Boolean)) { if (!pass) log(entry, 'no-key-match'); continue; }
        score = primary.filter(Boolean).length;
        if (entry.selective && entry.keysecondary.length) {
          const secondary = entry.keysecondary.map(k => matches(text, renderMacros(k, context, { ...variables }, random, warnings).trim(), entry, settings, warnings));
          const ok = [secondary.some(Boolean), !secondary.every(Boolean), !secondary.some(Boolean), secondary.every(Boolean)][entry.selectiveLogic];
          if (!reason && !ok) { log(entry, 'secondary'); continue; }
          if ([0, 3].includes(entry.selectiveLogic)) score += secondary.filter(Boolean).length;
        }
        reason ||= 'keyword';
      }
      candidates.push({ entry, reason, sticky, score });
    }
    candidates.sort((a,b) => stablePriority(b.entry)-stablePriority(a.entry) || Number(b.sticky)-Number(a.sticky) || entries.indexOf(a.entry)-entries.indexOf(b.entry));
    const removed = new Set(); const groups = new Map();
    for (const candidate of candidates) for (const group of strings(candidate.entry.group)) { if (!groups.has(group)) groups.set(group, []); groups.get(group).push(candidate); }
    for (const [group, members] of groups) {
      const pool = members.filter(m => !removed.has(m)); if (!pool.length) continue;
      let eligible = pool.filter(m => m.sticky);
      if (!eligible.length && chosenGroups.has(group)) { pool.forEach(m => removed.add(m)); continue; }
      if (!eligible.length) eligible = pool;
      if (!eligible.some(m=>m.sticky) && eligible.some(m => m.entry.useGroupScoring ?? settings.useGroupScoring)) { const max = Math.max(...eligible.map(m => m.score)); eligible = eligible.filter(m => !(m.entry.useGroupScoring ?? settings.useGroupScoring) || m.score === max); }
      let winner = eligible.find(m => m.entry.groupOverride) || eligible.find(m => m.sticky);
      if (!winner) { let roll = random() * eligible.reduce((n,m) => n + Number(m.entry.groupWeight ?? 100),0); winner = eligible.find(m => (roll -= Number(m.entry.groupWeight ?? 100)) <= 0) || eligible[0]; }
      for (const member of pool) if (member !== winner) { removed.add(member); log(member.entry, 'group', { group }); }
    }
    const newly = [];
    for (const candidate of candidates) {
      if (removed.has(candidate)) continue;
      const { entry, sticky, reason } = candidate; const id = String(entry.uid);
      if (!sticky && entry.useProbability && entry.probability < 100) { if (!rolls.has(id)) rolls.set(id, random()*100); if (rolls.get(id) >= entry.probability) { failed.add(id); log(entry, 'probability'); continue; } }
      const candidateVariables = {...variables};
      const content = renderMacros(entry.content.replace(/^@@(?:activate|dont_activate)\s*\r?\n?/gm, ''), context, candidateVariables, random, warnings);
      const hasText = !!content.trim();
      const hasVariableEffect = /\{\{\s*setvar\s*::/i.test(entry.content);
      if (!hasText && !hasVariableEffect) { log(entry, 'empty'); continue; }
      const cost = hasText ? countTokens(content + '\n') : 0;
      if (tokens + cost > hardLimit) { log(entry, 'context-limit', {tokens:cost}); continue; }
      if (!entry.ignoreBudget && (overflow || tokens + cost >= budget)) { overflow = true; log(entry, 'budget', { tokens: cost }); continue; }
      tokens += cost;
      Object.assign(variables,candidateVariables);
      const resolved = { ...entry, content, tokens: cost, reason, cacheProfile: profiles.get(id) };
      activated.set(id, resolved); newly.push(resolved); strings(entry.group).forEach(g => chosenGroups.add(g));
      log(entry, 'activated', { via: reason, tokens: cost });
      if (!sticky) nextState.entries[id] = { hash: hash(entry), activatedAt: step, stickyUntil: step + Number(entry.sticky || 0) + 1, cooldownUntil: step + Number(entry.sticky || 0) + Number(entry.cooldown || 0) + 1 };
    }
    const recursive = newly.filter(e => !e.preventRecursion && e.content.trim());
    if (recursive.length) recursionText += '\n' + recursive.map(e => e.content).join('\n');
    if (!overflow && settings.recursive && recursive.length) { phase = 'recursion'; continue; }
    if (!overflow && activated.size < settings.minActivations && depth < Math.min(settings.minDepthMax || 1000, history.length)) { depth++; phase = 'minimum'; continue; }
    if (!overflow && levels.length) { delayLevel = levels.shift(); phase = 'recursion'; continue; }
    if (pass === settings.maxRecursionSteps - 1) warnings.push('达到最大扫描步数');
    break;
  }
  nextState.variables = variables;
  const result = [...activated.values()].sort((a,b) => a.order-b.order || String(a.uid).localeCompare(String(b.uid), 'en', { numeric: true }));
  return { entries: result, trace, warnings: [...new Set(warnings)], budget, tokens, nextState, fingerprint: hash(result.map(e => [e.uid,e.content,e.position,e.depth,e.role])) };
}

/** Add lore inside existing system/user messages. Only allocate a system slot
 * when neither side of the requested boundary can carry text. Never rewrite
 * business message roles, history envelopes or attachments.
 */
export function injectBook(messages, activation, { anchors = {}, stableAnchors = {}, exampleTarget, historyStart, historyEnd, depthTargets, fallbackTarget, stableTarget, protectedPrefix = 0, regexRules = [], cachePlacement = false, appendOnly = false, immutablePrefix = 0, frozenLore = [] } = {}) {
  if (appendOnly) cachePlacement = true;
  if (!activation.entries.length) return { messages, placements: [], warnings: activation.warnings || [], stablePrefixHash: hash(messages.slice(0, protectedPrefix)) };
  const warnings = [...(activation.warnings || [])];
  const placements = []; const groups = new Map(); const outlets = new Map();
  const lastUser = messages.findLastIndex(m => m.role === 'user');
  const tail = lastUser < 0 ? messages.length : lastUser;
  const canCarry = message => message && ['system', 'user'].includes(message.role)
    && (typeof message.content === 'string' || Array.isArray(message.content));
  const textOf = content => typeof content === 'string' ? content : (Array.isArray(content) ? content.filter(p => p.type === 'text').map(p => p.text).join('\n') : '');
  const mapText = (content, transform) => Array.isArray(content) ? content.map(part => part.type === 'text' ? { ...part, text: transform(part.text) } : part) : transform(content);
  const outletNames = content => [...textOf(content).matchAll(/\{\{outlet::([^}]+)\}\}/gi)].map(match => match[1].trim());
  const replaceBody = content => {
    for (const rule of (Array.isArray(regexRules) ? regexRules : []).filter(r => r && typeof r.pattern === 'string' && !r.disabled)) {
      try { content = content.replace(new RegExp(rule.pattern, rule.flags || 'g'), rule.replacement || ''); }
      catch { warnings.push(`正文正则无效：${rule.pattern}`); }
    }
    return content;
  };
  const block = content => `\n\n<worldbook>\n${content}\n</worldbook>\n\n`;
  for (const entry of activation.entries) if (entry.position === 7 && entry.outletName) {
    if (!outlets.has(entry.outletName)) outlets.set(entry.outletName, []);
    outlets.get(entry.outletName).push(replaceBody(entry.content));
  }
  const resolveOutlets = content => !cachePlacement && typeof content === 'string' ? content.replace(/\{\{outlet::([^}]+)\}\}/gi,
    (original, name) => outlets.has(name.trim()) ? block(outlets.get(name.trim()).join('\n')) : original) : content;
  const fallback = fallbackTarget || { index: tail };
  // Known static first layers can append lore after their existing rules.
  // Generic creative calls may pack variable material in their first system:
  // prepend there so no unknown dynamic text can precede the stable lore.
  const stable = stableTarget || { index: 0, offset: protectedPrefix > 0 && messages[0]?.role === 'system' && typeof messages[0].content === 'string' ? messages[0].content.length : 0 };
  const locate = requested => {
    const target = typeof requested === 'number' ? { index: requested } : requested;
    const index = Math.max(0, Math.min(target.index, tail));
    const current = messages[index];
    if (canCarry(current) && (!target.systemOnly || current.role === 'system')) {
      const offset = typeof current.content === 'string' ? Math.max(0, Math.min(target.offset || 0, current.content.length)) : 0;
      return { index, offset, role: current.role, mode: 'inline' };
    }
    const previous = messages[index - 1];
    if (canCarry(previous) && (!target.systemOnly || previous.role === 'system') && !(cachePlacement && index <= protectedPrefix && !target.systemOnly)) {
      return { index: index - 1, offset: typeof previous.content === 'string' ? previous.content.length : -1, role: previous.role, mode: 'inline' };
    }
    return { index, role: 'system', mode: 'slot' };
  };
  for (const entry of activation.entries) {
    if (!entry.content.trim()) continue; // Stateful macro-only entries have no prompt payload.
    const profile = entry.cacheProfile || classifyCacheEntry(entry);
    const frozenKey = hash([entry.uid, entry.content]);
    if (appendOnly && profile.tier === 'stable' && frozenLore.includes(frozenKey)) continue;
    let references;
    if (entry.position === 7) {
      const targets = messages.flatMap((message, index) => canCarry(message) && outletNames(message.content).includes(entry.outletName)
        ? [{ index, role: message.role, mode: 'inline' }] : []);
      const referencedByEntry = activation.entries.some(other => other !== entry && outletNames(other.content).includes(entry.outletName));
      if (!cachePlacement || (!targets.length && !referencedByEntry)) {
        placements.push({ uid: entry.uid, requested: 'Outlet', outlet: entry.outletName, used: targets.length > 0, targets, ...targets[0], cacheTier: profile.tier, cacheReasons: profile.reasons });
        continue;
      }
      references = targets;
    }
    let target; let mapped = false;
    const name = ['beforeCharacter', 'afterCharacter', 'beforeAuthorNote', 'afterAuthorNote', null, 'beforeExamples', 'afterExamples'][entry.position];
    if (cachePlacement) {
      target = profile.tier === 'stable'
        ? { ...(stableAnchors[name] || stable), systemOnly:true }
        : ([5,6].includes(entry.position) && exampleTarget ? exampleTarget : fallback);
      mapped = true;
    } else if (entry.position === 4 && depthTargets?.length) {
      target = depthTargets[Math.max(0, depthTargets.length - 1 - entry.depth)];
      mapped = entry.depth >= depthTargets.length;
    } else if (entry.position === 4 && Number.isInteger(historyStart) && Number.isInteger(historyEnd)) {
      target = { index: Math.min(tail, Math.max(historyStart, historyEnd - entry.depth)) };
      mapped = historyEnd - entry.depth > tail || historyEnd - entry.depth < historyStart;
    } else {
      target = name ? anchors[name] : undefined;
      if (target == null) { target = fallback; mapped = true; }
    }
    if (appendOnly && (profile.tier !== 'stable' || immutablePrefix > 0)) {
      target = { ...fallback, label: '严格追加：本轮 user 动态尾部' };
      mapped = true;
    }
    const location = locate(target);
    if (!cachePlacement && location.index < tail && profile.tier === 'dynamic') warnings.push(`条目 ${entry.uid} 按原位置注入动态内容，可能缩短缓存前缀`);
    let content = resolveOutlets(replaceBody(entry.content));
    if (cachePlacement && entry.position === 7) content = `【世界书 Outlet：${entry.outletName}】\n${content}`;
    if ([5, 6].includes(entry.position)) content = `<example_dialogue>\n${content}\n</example_dialogue>`;
    const key = `${location.mode}:${location.index}:${location.offset ?? ''}`;
    if (!groups.has(key)) groups.set(key, { ...location, entries: [] });
    groups.get(key).entries.push({ ...entry, content, cacheProfile: profile });
    placements.push({ uid: entry.uid, requested: POSITIONS[entry.position], depth: entry.position === 4 ? entry.depth : null, requestedRole: entry.role, ...location, actualAnchor:target.label || (cachePlacement ? profile.tier === 'stable' ? '稳定区末尾（深度/缺失锚点适配）' : '末条 user 任务之前' : '历史深度/指定边界'), mapped, cacheTier: profile.tier, cacheReasons: profile.reasons, ...(appendOnly && profile.tier === 'stable' ? { frozenKey } : {}), ...(references ? { outlet: entry.outletName, used: true, references } : {}) });
  }
  const additions = [...groups.values()].map(group => ({ ...group, content: block(group.entries
    .sort((a, b) => (cachePlacement ? Number(b.cacheProfile.tier === 'stable') - Number(a.cacheProfile.tier === 'stable') : (b.position === 4 ? b.depth : 0) - (a.position === 4 ? a.depth : 0)) || (a.position===5?1:a.position===6?2:0)-(b.position===5?1:b.position===6?2:0) || a.order - b.order || String(a.uid).localeCompare(String(b.uid), 'en', { numeric: true }))
    .map(entry => entry.content).join('\n')) }));
  const result = [];
  for (let index = 0; index <= messages.length; index++) {
    for (const addition of additions.filter(a => a.index === index && a.mode === 'slot')) result.push({ role: 'system', content: addition.content.trim() });
    if (index === messages.length) break;
    const message = messages[index]; let content = message.content;
    const inline = additions.filter(a => a.index === index && a.mode === 'inline').sort((a, b) => b.offset - a.offset);
    for (const addition of inline) {
      if (typeof content === 'string') content = content.slice(0, addition.offset) + addition.content + content.slice(addition.offset);
      else content = addition.offset === -1 ? [...content, { type: 'text', text: addition.content }] : [{ type: 'text', text: addition.content }, ...content];
    }
    if (canCarry(message) && outletNames(message.content).some(name => outlets.has(name))) content = mapText(content, resolveOutlets);
    result.push(content === message.content ? message : { ...message, content });
  }
  if (placements.some(p => p.mapped)) warnings.push(cachePlacement ? '高缓存适配：常驻按世界观/角色锚点放在稳定区，越过动态内容的锚点提前到稳定区末尾；条件条目后置，示例在 user 前，深度映射到稳定区或动态尾部' : '缺少对应锚点或深度超出历史时，复用可用的原消息位置；原始条目配置未改写');
  if (cachePlacement && placements.some(p => p.references)) warnings.push('Outlet 内容按缓存分层放置，原占位符保留，避免条件触发改变前缀');
  const firstChanged = Math.min(messages.length, ...placements.flatMap(p => p.targets || (Number.isInteger(p.index) ? [p] : [])).map(p => p.index));
  const stableEntries = additions.flatMap(group => group.entries.filter(entry => entry.cacheProfile.tier === 'stable').map(entry => [entry.uid, entry.content]));
  return { messages: result, placements, warnings: [...new Set(warnings)], stablePrefixHash: hash(messages.slice(0, firstChanged)), stableLoreHash: hash(stableEntries) };
}

