// SillyTavern 提示词管理器适配：预设文档只作为数据处理，不作为脚本执行。
import { estimateTokens } from '../lorebook/engine.js';
export const DEFAULT_ORDER_ID = 100001;
const MAX_SIZE = 4 * 1024 * 1024;
const MAX_OUTPUT = 2 * 1024 * 1024;
export const MARKERS = new Set(['worldInfoBefore', 'worldInfoAfter', 'charDescription', 'charPersonality', 'personaDescription', 'scenario', 'dialogueExamples', 'chatHistory', 'agentSystemPrompt', 'agentTask', 'agentResults']);

export function normalizePreset(input) {
  const source = input?.data?.prompts ? input.data : input;
  if (!source || !Array.isArray(source.prompts)) throw new Error('请选择含 prompts 的 SillyTavern 聊天补全预设或提示词管理器导出文件');
  if (JSON.stringify(input).length > MAX_SIZE || source.prompts.length > 2000) throw new Error('预设过大（最多 4 MiB、2000 个条目）');
  const document = structuredClone(source);
  const ids = new Set();
  for (const p of document.prompts) {
    if (!p || typeof p !== 'object' || typeof p.identifier !== 'string' || !p.identifier || ids.has(p.identifier)) throw new Error('条目标识缺失或重复');
    ids.add(p.identifier);
    if (p.content != null && typeof p.content !== 'string') throw new Error('提示词正文必须是文本');
    // 邻舍将预设统一装入独立的 system 层；导入或读取旧预设时，
    // 丢弃这些酒馆专用控制字段，避免它们成为不可见的注入规则。
    for (const field of ['injection_trigger', 'injection_position', 'injection_depth', 'injection_order', 'forbid_overrides']) delete p[field];
  }
  if (document.prompt_order == null) document.prompt_order = [{ character_id: DEFAULT_ORDER_ID, order: document.prompts.map(p => ({ identifier: p.identifier, enabled: p.enabled !== false })) }];
  if (!Array.isArray(document.prompt_order)) throw new Error('prompt_order 必须是数组');
  // 提示词管理器的角色导出使用扁平排序，完整预设则使用排序配置列表。
  if (document.prompt_order.length && document.prompt_order[0]?.identifier) document.prompt_order = [{ character_id: DEFAULT_ORDER_ID, order: document.prompt_order }];
  const profileIds = new Set();
  for (const profile of document.prompt_order) {
    if (!profile || !Array.isArray(profile.order)) throw new Error('排序配置缺少 order 数组');
    if (!['string','number'].includes(typeof profile.character_id) || profileIds.has(String(profile.character_id))) throw new Error('排序配置 ID 缺失或重复');
    profileIds.add(String(profile.character_id));
    const seen = new Set();
    for (const entry of profile.order) {
      if (!entry || typeof entry.identifier !== 'string' || seen.has(entry.identifier) || typeof entry.enabled !== 'boolean') throw new Error('排序条目必须含唯一 identifier 与布尔 enabled');
      seen.add(entry.identifier);
    }
  }
  return document;
}

export function getPresetOrder(document, orderId) {
  return document.prompt_order.find(p => String(p.character_id) === String(orderId ?? DEFAULT_ORDER_ID))
    || document.prompt_order.find(p => String(p.character_id) === String(DEFAULT_ORDER_ID))
    || document.prompt_order[0] || { character_id: DEFAULT_ORDER_ID, order: [] };
}

export function messageText(message) {
  return typeof message?.content === 'string' ? message.content : Array.isArray(message?.content) ? message.content.filter(p => p.type === 'text').map(p => p.text).join('\n') : '';
}

// 按配对括号解析宏，支持变量赋值中的嵌套宏，并限制解析开销。
// 变量仅在本次请求内有效，预览也一样；不写入聊天变量或全局变量。
function macroArguments(text) {
  const parts = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text.startsWith('{{',i)) { depth++; i++; }
    else if (text.startsWith('}}',i)) { depth--; i++; }
    else if (!depth && text.startsWith('::',i)) { parts.push(text.slice(start,i)); start = i + 2; i++; }
  }
  parts.push(text.slice(start));
  return parts;
}

// 检查未启用条目的变量引用，不执行其中的赋值或随机宏。
function variableReads(text, depth = 0) {
  if (depth > 32) return [];
  const names = [];
  for (let cursor = 0; cursor < text.length;) {
    const start = text.indexOf('{{',cursor);
    if (start < 0) break;
    let level = 1, end = start + 2;
    while (end < text.length && level) {
      if (text.startsWith('{{',end)) { level++; end += 2; }
      else if (text.startsWith('}}',end)) { level--; if (level) end += 2; }
      else end++;
    }
    if (level) break;
    const [command,...args] = macroArguments(text.slice(start+2,end));
    cursor = end + 2;
    const key = command.trim().toLowerCase();
    if (key.startsWith('//')) continue;
    if (key === 'getvar' && args[0]?.trim() && !args[0].includes('{{')) names.push(args[0].trim());
    for (const arg of args) names.push(...variableReads(arg,depth+1));
  }
  return names;
}

function mergeSourceRanges(ranges) {
  const bySource = new Map();
  for (const range of ranges) {
    if (!bySource.has(range.identifier)) bySource.set(range.identifier, []);
    bySource.get(range.identifier).push(range);
  }
  return [...bySource.values()].flatMap(source => {
    const merged = [];
    for (const range of source.sort((a,b) => a.start - b.start || a.end - b.end)) {
      const last = merged.at(-1);
      if (last && range.start <= last.end) last.end = Math.max(last.end,range.end);
      else merged.push({...range});
    }
    return merged;
  });
}

function macroRenderer(context, warnings, trace) {
  const vars = new Map(), origins = new Map();
  let sourceId, writes, hasComment, hasMacro;
  const attributed = (text, ranges = []) => ({ text, ranges: trace && text.length ? mergeSourceRanges([...ranges, { identifier: sourceId, start: 0, end: text.length }]) : [] });
  const transformed = (text, ...values) => attributed(text, trace ? [...new Set(values.flatMap(v => v.ranges.map(r => r.identifier)))].map(identifier => ({ identifier, start: 0, end: text.length })) : []);
  let operations = 0; let expandedCharacters = 0; let dynamic = false;
  const charge = length => { expandedCharacters += length; if (expandedCharacters > 8 * MAX_OUTPUT) throw new Error('预设宏累计展开过大'); };
  const basic = {
    char: context.characterName || '角色', user: context.userName || '用户',
    description: context.characterDescription || '', personality: context.characterPersonality || '',
    persona: context.personaDescription || '', scenario: context.scenario || '',
    lastusermessage: context.lastUserMessage || '', lastcharmessage: context.lastCharMessage || '',
    lastmessage: context.lastMessage || '', original: '', newline: '\n', noop: '',
  };
  const render = (text, depth = 0) => {
    if (depth > 32) throw new Error('预设宏嵌套超过 32 层');
    let output = ''; let cursor = 0; let ranges = [];
    while (cursor < text.length) {
      if (++operations > 30000) throw new Error('预设宏展开超过处理上限');
      const start = text.indexOf('{{', cursor);
      if (start < 0) { output += text.slice(cursor); break; }
      output += text.slice(cursor, start);
      let level = 1; let end = start + 2;
      while (end < text.length && level) {
        if (text.startsWith('{{', end)) { level++; end += 2; }
        else if (text.startsWith('}}', end)) { level--; if (level) end += 2; }
        else end++;
      }
      if (level) { warnings.add('存在未闭合的宏，已保留原文'); dynamic = true; output += text.slice(start); break; }
      const raw = text.slice(start + 2, end); cursor = end + 2;
      const [command, ...args] = macroArguments(raw); const key = command.trim().toLowerCase();
      let value = '', valueRanges = [];
      if (key.startsWith('//')) { hasComment = true; continue; }
      hasMacro = true;
      if (key === 'trim') { output = output.replace(/\s+$/, ''); ranges = ranges.map(r => ({...r,end:Math.min(r.end,output.length)})).filter(r => r.end > r.start); while (/\s/.test(text[cursor] || '') && cursor < text.length) cursor++; continue; }
      if (Object.hasOwn(basic, key)) { value = basic[key]; if (!['original', 'newline', 'noop'].includes(key)) dynamic = true; }
      else if (['setvar', 'addvar', 'getvar', 'incvar', 'decvar'].includes(key)) {
        const name = render(args.shift() || '', depth + 1).text.trim();
        let current = {text:vars.get(name) || '', ranges:origins.get(name) || []};
        if (key === 'getvar') { value = String(vars.get(name) ?? ''); valueRanges = current.ranges; }
        else {
          writes.add(name);
          let next;
          if (key === 'setvar') next = render(args.join('::'), depth + 1);
          else if (key === 'addvar') {
            const addition = render(args.join('::'), depth + 1);
            current = {text:vars.get(name) || '', ranges:origins.get(name) || []};
            let array; try { array = JSON.parse(current.text); } catch { /* 按普通字符串处理。 */ }
            if (Array.isArray(array)) next = transformed(JSON.stringify([...array, addition.text]), current, addition);
            else if (Number.isNaN(Number(addition.text)) || Number.isNaN(Number(current.text))) {
              next = {text:current.text + addition.text, ranges:[...current.ranges, ...addition.ranges.map(r => ({...r,start:r.start + current.text.length,end:r.end + current.text.length}))]};
            } else next = transformed(String(Number(current.text) + Number(addition.text)), current, addition);
          } else {
            next = transformed(String(Number(current.text || 0) + (key === 'incvar' ? 1 : -1)), current);
            value = next.text; valueRanges = next.ranges;
          }
          vars.set(name, next.text); origins.set(name, next.ranges);
          charge(next.text.length);
        }
        if (String(vars.get(name) || '').length > MAX_OUTPUT) throw new Error('预设变量展开过大');
      } else if (key === 'random' || key === 'pick') {
        dynamic = true;
        const values = args.length > 1 ? args : (args[0] || '').split(',');
        const picked = render(values[Math.floor((context.random || Math.random)() * values.length)] || '', depth + 1);
        value = picked.text; valueRanges = picked.ranges;
      } else if (key === 'date' || key === 'time' || key === 'weekday') {
        dynamic = true; const date = context.now || new Date();
        value = key === 'date' ? date.toLocaleDateString('zh-CN') : key === 'time' ? date.toLocaleTimeString('zh-CN') : date.toLocaleDateString('zh-CN', { weekday: 'long' });
      } else { warnings.add(`未支持的宏保留原文：${command.trim().slice(0, 80)}`); dynamic = true; value = text.slice(start, cursor); }
      if (trace) for (const r of valueRanges) ranges.push({...r,start:r.start + output.length,end:r.end + output.length});
      output += value;
      if (output.length > MAX_OUTPUT) throw new Error('预设展开超过 2 MiB');
    }
    if (output.length > MAX_OUTPUT) throw new Error('预设展开超过 2 MiB');
    charge(output.length);
    return attributed(output, ranges);
  };
  return {
    render(text, identifier) {
      sourceId = identifier; writes = new Set(); hasComment = false; hasMacro = false;
      const expanded = render(text);
      return {...expanded, variableWrites:[...writes], emptyKind:writes.size ? 'assignment' : hasComment && !hasMacro ? 'comment' : hasMacro ? 'expansion' : 'blank'};
    },
    isDynamic: () => dynamic,
  };
}

export function compilePreset(input, context = {}, orderId, { trace = false } = {}) {
  const document = normalizePreset(input); const profile = getPresetOrder(document, orderId);
  const prompts = new Map(document.prompts.map(p => [p.identifier, p]));
  const warnings = new Set(); const renderer = macroRenderer(context, warnings, trace);
  const entries = []; const chunks = []; const outputRanges = []; let size = 0;
  const stableChunks = [], dynamicChunks = [];
  for (const item of profile.order) {
    const prompt = prompts.get(item.identifier);
    const row = { identifier: item.identifier, name: prompt?.name || item.identifier, actualRole: 'system', actualAnchor: 'after-system0' };
    entries.push(row);
    if (!prompt) { row.reason = 'missing'; warnings.add(`排序引用了缺失条目：${item.identifier}`); continue; }
    if (!item.enabled) { row.reason = 'disabled'; continue; }
    if (prompt.marker || MARKERS.has(prompt.identifier)) { row.reason = 'marker'; continue; }
    const expanded = renderer.render(prompt.content || '', item.identifier);
    const content = expanded.text;
    if (trace) { row.variableWrites = expanded.variableWrites; row.emptyKind = expanded.emptyKind; }
    row.reason = content.trim() ? 'included' : 'variables'; row.characters = content.length;
    // 记录最终正文中的 UTF-16 偏移，包含条目之间的分隔符。
    // 预览定位必须使用展开后的输出位置，不能搜索原始提示词。
    if (content.trim()) {
      for (const r of expanded.ranges) outputRanges.push({...r,start:r.start + size,end:r.end + size});
      row.start = size; row.end = size + content.length; chunks.push(content); size += content.length + 2;
      // 从首个动态宏起整个后缀后置，保留变量赋值/引用与条目输出的先后语义。
      // 不把后续看似纯文本的条目搬回前方，也不重新执行随机宏。
      row.cacheTier = renderer.isDynamic() ? 'dynamic' : 'stable';
      (renderer.isDynamic() ? dynamicChunks : stableChunks).push(content);
    }
    if (size > MAX_OUTPUT) throw new Error('预设展开超过 2 MiB');
  }
  if (renderer.isDynamic()) warnings.add('预设含动态或未知宏；其后提示词的前缀缓存可能随请求变化');
  const content = chunks.join('\n\n');
  if (trace) for (const row of entries) {
    // 变量来源可能出现在后续输出中、被多次引用，也可能被覆盖。
    // 合并嵌套展开产生的重叠范围，避免通过文本搜索误匹配重复内容。
    row.ranges = [];
    for (const range of outputRanges.filter(r => r.identifier === row.identifier).sort((a,b) => a.start - b.start || a.end - b.end)) {
      const last = row.ranges.at(-1);
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else row.ranges.push({start:range.start,end:range.end});
    }
  }
  const outputSuggestions = [];
  if (trace && !content) {
    const assigned = new Set(entries.flatMap(row => row.variableWrites || []));
    const enabled = new Set(profile.order.filter(row => row.enabled).map(row => row.identifier));
    for (const prompt of document.prompts) {
      if (enabled.has(prompt.identifier) || prompt.marker || MARKERS.has(prompt.identifier)) continue;
      const variables = [...new Set(variableReads(prompt.content || '').filter(name => assigned.has(name)))];
      if (variables.length) outputSuggestions.push({identifier:prompt.identifier,name:prompt.name || prompt.identifier,variables});
    }
  }
  return { content, stableContent: stableChunks.join('\n\n'), dynamicContent: dynamicChunks.join('\n\n'), entries, ...(trace ? {outputSuggestions} : {}), warnings: [...warnings], dynamic: renderer.isDynamic(), estimatedTokens: estimateTokens(content), orderId: profile.character_id };
}

export function injectPreset(messages, compiled, { placement = 'prefix', frozenPrefix = false } = {}) {
  if (!compiled?.content?.trim() && !compiled?.tailContent?.trim()) return messages;
  if (placement === 'cache') {
    let result = messages;
    if (!frozenPrefix && compiled.stableContent) result = injectPreset(result, { content: compiled.stableContent });
    const tailContent = compiled.tailContent ?? compiled.dynamicContent;
    if (tailContent) {
      const index = result.findLastIndex(m => m.role === 'user');
      if (index < 0) throw new Error('动态预设需要末条 user 作为任务边界');
      result = [...result.slice(0, index), { role: 'system', content: tailContent }, ...result.slice(index)];
    }
    return result;
  }
  const systemIndex = messages.findIndex(m => m.role === 'system');
  const index = systemIndex < 0 ? 0 : systemIndex + 1;
  return [...messages.slice(0, index), { role: 'system', content: compiled.content }, ...messages.slice(index)];
}
