// 业务级思考策略在 extraBody 合并之后应用，不修改全局配置或嵌套配置对象。
export function applyForcedThinking(params, mode, llm) {
  const enabled = mode === 'enabled';
  const model = String(params.model || '').toLowerCase();
  params.thinking = { type: mode };
  if (enabled && /claude/.test(model)) {
    params.thinking.budget_tokens = Math.max(1024, Math.min(4096, Number(llm.maxTokens || 8192) - 1));
  }
  if (/^(o[134](?:-|$)|gpt-[56])/.test(model)) {
    delete params.thinking;
    delete params.temperature;
    params.reasoning_effort = enabled ? 'high' : 'none';
    params.max_completion_tokens = llm.maxTokens;
  } else if (/^group\//.test(model) || (/gemini/.test(model) && llm.connectionType !== 'vertexai')) {
    // 中转分组名隐藏实际模型，不能靠模型家族识别；Chat 路由用此字段传递关闭意图。
    params.reasoning_effort = enabled ? 'high' : 'none';
  }
  if (/qwen/.test(model) || 'enable_thinking' in params) params.enable_thinking = enabled;
  if (/qwen/.test(model) || params.chat_template_kwargs) {
    params.chat_template_kwargs = { ...params.chat_template_kwargs, enable_thinking: enabled };
  }
  if (params.reasoning) {
    params.reasoning = { ...params.reasoning, enabled, effort: enabled ? 'high' : 'none' };
    delete params.reasoning.max_tokens;
  }
  if ('reasoning_effort' in params) params.reasoning_effort = enabled ? 'high' : 'none';
  // 清除可能冲突的自定义原生参数；强制关闭不能被适配器降成 LOW / 自动思考。
  if (params.generationConfig?.thinkingConfig) {
    params.generationConfig = { ...params.generationConfig };
    delete params.generationConfig.thinkingConfig;
  }
  if (llm.connectionType === 'vertexai') {
    params.generationConfig = { ...params.generationConfig, thinkingConfig: enabled
      ? (/gemini-3/.test(model) ? { thinkingLevel: 'HIGH' } : { thinkingBudget: -1 })
      : { thinkingBudget: 0 } };
  }
}

export function isThinkingModeRejected(error) {
  const status = Number(error?.status || error?.response?.status);
  if (![400, 422, 501].includes(status)) return false;
  const detail = [error?.message, error?.param, error?.code,
    error?.error?.message, error?.error?.param, error?.error?.code].filter(Boolean).join(' ');
  return /thinking|reasoning|思考|推理/i.test(detail);
}
