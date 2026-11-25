import { applyThinking, applyForcedThinking, normalizeThinkingEffort } from './thinkingMode.js';

// 原生工具调用流；普通聊天的 string generator 契约保持不变。
export function buildAgentRequest(
  messages,
  tools,
  llm,
  { forceThinking = true, thinkingEffort = 'low', temperature = 0.72, toolChoice = 'auto' } = {},
) {
  const effort = normalizeThinkingEffort(thinkingEffort, 'low');
  if (!forceThinking || effort === 'off') {
    const normal = { model: llm.model, messages, temperature, stream: true };
    const thinking = effort === 'off'
      ? { type: 'disabled' }
      : llm.thinkingMode === 'omit'
        ? null
        : { type: llm.thinkingMode === 'enabled' ? 'enabled' : 'disabled' };
    applyThinking(normal, thinking, llm.connectionType, effort, llm);
    Object.assign(normal, llm.extraBody);
    if (effort === 'off') applyForcedThinking(normal, 'disabled', llm, 'off');
    delete normal.tools; delete normal.tool_choice; delete normal.response_format;
    if (tools?.length) { normal.tools = tools; normal.tool_choice = toolChoice; }
    return normal;
  }
  const params = { ...llm.extraBody, model: llm.model, messages, stream: true };
  delete params.response_format;
  delete params.tools;
  delete params.tool_choice;
  if (tools?.length) { params.tools = tools; params.tool_choice = toolChoice; }
  // 神说的思考不可被全局开关或 extraBody 关闭。按服务商协议设置，不靠 prompt 伪造思考。
  applyForcedThinking(params, 'enabled', llm, effort, { includeThoughts: true, includeExclude: true });
  return params;
}

export async function* readAgentResponse(stream, { signal, allowEmpty = false, terminalTool } = {}) {
  const message = { role: 'assistant', content: '', reasoning_content: '' };
  const calls = new Map();
  const details = new Map();
  const vertexParts = [];
  let finishReason = null;
  for await (const chunk of stream) {
    signal?.throwIfAborted();
    if (chunk.usage) yield { type: 'usage', usage: chunk.usage };
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || {};
    const reasoning = delta.reasoning_content || delta.reasoning || '';
    if (typeof reasoning === 'string' && reasoning) {
      message.reasoning_content += reasoning;
      yield { type: 'reasoning_delta', text: reasoning };
    }
    if (typeof delta.content === 'string' && delta.content) {
      message.content += delta.content;
      yield { type: 'text_delta', text: delta.content };
    }
    if (Array.isArray(delta.vertex_parts)) vertexParts.push(...delta.vertex_parts);
    for (const part of delta.reasoning_details || []) {
      const key = part.index ?? part.id ?? details.size;
      const old = details.get(key) || {};
      details.set(key, { ...old, ...part, ...(part.text ? { text: (old.text || '') + part.text } : {}), ...(part.data ? { data: (old.data || '') + part.data } : {}) });
      if (!reasoning && typeof part.text === 'string') yield { type: 'reasoning_delta', text: part.text };
    }
    for (const piece of delta.tool_calls || []) {
      const index = piece.index ?? calls.size;
      const call = calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (piece.id) call.id = piece.id;
      if (piece.function?.name && call.function.name !== piece.function.name) call.function.name += piece.function.name;
      if (piece.function?.arguments) call.function.arguments += piece.function.arguments;
      if (piece.extra_content) call.extra_content = piece.extra_content;
      if (call.function.arguments.length > 128000 || (!calls.has(index) && calls.size >= 16)) throw new Error('工具请求超过本轮上限');
      calls.set(index, call);
    }
  }
  signal?.throwIfAborted();
  if (!finishReason) throw new Error('模型连接提前结束，未执行未完成的工具请求');
  if (!['stop', 'tool_calls'].includes(finishReason)) throw new Error(`模型未完成本轮回复（${finishReason}），请检查输出额度与模型配置`);
  if (calls.size) {
    message.tool_calls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    const ids = new Set();
    for (const call of message.tool_calls) {
      if (!call.id || !call.function.name || ids.has(call.id)) throw new Error('模型返回了无效的工具调用标识');
      ids.add(call.id);
      // 终结工具的调用方在已配对的前序工具提交后解析参数，并负责恢复格式错误。
      if (call.function.name === terminalTool && call === message.tool_calls.at(-1)) continue;
      try { JSON.parse(call.function.arguments); } catch { throw new Error('模型返回了不完整的工具参数，未执行'); }
    }
  }
  if (details.size) message.reasoning_details = [...details.values()];
  if (vertexParts.length) message.vertex_parts = vertexParts;
  if (!allowEmpty && !message.content && !message.tool_calls?.length) throw new Error('模型未返回回复或工具调用，请使用支持思考与工具的模型');
  yield { type: 'assistant_end', message };
}
