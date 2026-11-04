// 原生工具调用流；普通聊天的 string generator 契约保持不变。
export function buildAgentRequest(messages, tools, llm, { forceThinking = true, temperature = 0.72 } = {}) {
  const params = { ...llm.extraBody, model: llm.model, messages, ...(Array.isArray(tools) && tools.length ? { tools, tool_choice: 'auto' } : {}), stream: true };
  delete params.response_format;
  delete params.tools;
  delete params.tool_choice;
  if (tools?.length) { params.tools = tools; params.tool_choice = 'auto'; }
  if (!forceThinking) {
    const normal = { model: llm.model, messages, temperature, stream: true };
    if (llm.thinkingMode !== 'omit') normal.thinking = { type: llm.thinkingMode === 'enabled' ? 'enabled' : 'disabled' };
    Object.assign(normal, llm.extraBody);
    delete normal.tools; delete normal.tool_choice; delete normal.response_format;
    if (tools?.length) { normal.tools = tools; normal.tool_choice = 'auto'; }
    return normal;
  }
  // 神说的思考不可被全局开关或 extraBody 关闭。按服务商协议设置，不靠 prompt 伪造思考。
  const model = String(llm.model || '').toLowerCase();
  if (llm.connectionType === 'vertexai' || /gemini/.test(model)) {
    params.thinking = { type: 'enabled' };
    if (llm.connectionType === 'vertexai') {
      params.generationConfig = { ...params.generationConfig, thinkingConfig: {
        ...(/gemini-3/.test(model) ? { thinkingLevel: 'HIGH' } : { thinkingBudget: -1 }), includeThoughts: true,
      } };
    } else params.reasoning_effort = 'high';
  } else if (/^(o[134](?:-|$)|gpt-[56])/.test(model)) {
    delete params.thinking;
    delete params.temperature;
    params.reasoning_effort = 'high';
    params.max_completion_tokens = llm.maxTokens;
  } else {
    params.thinking = { ...(params.thinking || {}), type: 'enabled' };
    if (/claude/.test(model)) params.thinking.budget_tokens = Math.max(1024, Math.min(4096, Number(llm.maxTokens || 8192) - 1));
    if (/qwen/.test(model)) { params.enable_thinking = true; params.chat_template_kwargs = { ...params.chat_template_kwargs, enable_thinking: true }; }
  }
  if (params.reasoning) params.reasoning = { ...params.reasoning, enabled: true, effort: 'high', exclude: false };
  if ('enable_thinking' in params) params.enable_thinking = true;
  if (params.chat_template_kwargs) params.chat_template_kwargs = { ...params.chat_template_kwargs, enable_thinking: true };
  if ('reasoning_effort' in params) params.reasoning_effort = 'high';
  return params;
}

export async function* readAgentResponse(stream, { signal, allowEmpty = false } = {}) {
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
      try { JSON.parse(call.function.arguments); } catch { throw new Error('模型返回了不完整的工具参数，未执行'); }
    }
  }
  if (details.size) message.reasoning_details = [...details.values()];
  if (vertexParts.length) message.vertex_parts = vertexParts;
  if (!allowEmpty && !message.content && !message.tool_calls?.length) throw new Error('模型未返回回复或工具调用，请使用支持思考与工具的模型');
  yield { type: 'assistant_end', message };
}
