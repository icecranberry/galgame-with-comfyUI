export const THINKING_EFFORTS = Object.freeze(['low', 'medium', 'high', 'off']);

export function normalizeThinkingEffort(effort, defaultEffort = 'low') {
  return THINKING_EFFORTS.includes(effort) ? effort : defaultEffort;
}

function claudeBudgetForEffort(effort, maxTokens) {
  const target = effort === 'low' ? 1024 : effort === 'medium' ? 2048 : 4096;
  return Math.max(1024, Math.min(target, Number(maxTokens || 8192) - 1));
}

export function vertexThinkingConfigForEffort(
  model,
  effort = 'low',
  { enabled = true, includeThoughts = false, fallbackProToDynamic = false } = {},
) {
  const lower = String(model || '').toLowerCase();
  const level = normalizeThinkingEffort(effort, 'low');
  let config;
  if (/gemini-3/.test(lower)) {
    const thinkingLevel = !enabled ? 'LOW' : level === 'high' ? 'HIGH' : level === 'medium' ? 'MEDIUM' : 'LOW';
    config = { thinkingLevel };
  } else if (/gemini-2\.5/.test(lower)) {
    const thinkingBudget = !enabled
      ? (fallbackProToDynamic && /-pro/.test(lower) ? -1 : 0)
      : level === 'high' ? -1 : level === 'medium' ? 4096 : 1024;
    config = { thinkingBudget };
  } else {
    config = enabled
      ? { thinkingBudget: level === 'high' ? -1 : level === 'medium' ? 4096 : 1024 }
      : { thinkingBudget: 0 };
  }
  if (enabled && includeThoughts) config.includeThoughts = true;
  return config;
}

export function applyThinking(params, thinking, connectionType, thinkingEffort = 'low', llm = null) {
  const rawEffort = normalizeThinkingEffort(thinkingEffort, 'low');
  if (connectionType === 'magpie') {
    delete params.thinking;
    if (thinking) {
      params.reasoning_effort = thinking.type === 'enabled' && rawEffort !== 'off' ? rawEffort : 'none';
    }
    return;
  }
  if (thinking === null) return;
  const enabled = thinking?.type === 'enabled' && rawEffort !== 'off';
  const model = String(params.model || '').toLowerCase();
  if (/^(o[134](?:-|$)|gpt-[56])/.test(model)) {
    delete params.thinking;
    delete params.temperature;
    params.reasoning_effort = enabled ? rawEffort : 'none';
    if (llm?.maxTokens) params.max_completion_tokens = llm.maxTokens;
    return;
  }
  if (!enabled) {
    params.thinking = thinking;
    return;
  }
  if (connectionType === 'vertexai') {
    params.thinking = thinking;
    params.reasoning_effort = rawEffort;
    return;
  }
  if (/claude/.test(model)) {
    params.thinking = { type: 'enabled', budget_tokens: claudeBudgetForEffort(rawEffort, llm?.maxTokens) };
    return;
  }
  params.thinking = thinking;
  params.reasoning_effort = rawEffort;
  if (/qwen/.test(model)) {
    params.enable_thinking = true;
    params.chat_template_kwargs = { ...params.chat_template_kwargs, enable_thinking: true };
  }
}

// 业务级思考策略在 extraBody 合并之后应用，不修改全局配置或嵌套配置对象。
export function applyForcedThinking(
  params,
  mode,
  llm,
  thinkingEffort = 'high',
  { includeThoughts = false, includeExclude = false } = {},
) {
  const enabled = mode === 'enabled';
  const effort = normalizeThinkingEffort(thinkingEffort, 'high');
  const effectiveEnabled = enabled && effort !== 'off';
  if (llm.connectionType === 'magpie') {
    applyThinking(params, { type: effectiveEnabled ? 'enabled' : 'disabled' }, llm.connectionType, effort, llm);
    return;
  }
  const model = String(params.model || '').toLowerCase();
  params.thinking = { type: effectiveEnabled ? 'enabled' : 'disabled' };
  if (effectiveEnabled && /claude/.test(model)) {
    params.thinking.budget_tokens = claudeBudgetForEffort(effort, llm?.maxTokens);
  }
  if (/^(o[134](?:-|$)|gpt-[56])/.test(model)) {
    delete params.thinking;
    delete params.temperature;
    params.reasoning_effort = effectiveEnabled ? effort : 'none';
    params.max_completion_tokens = llm.maxTokens;
  } else if (effectiveEnabled || /^group\//.test(model) || (/gemini/.test(model) && llm.connectionType !== 'vertexai')) {
    // 开启思考时统一注入强度；中转分组名或非 Vertex Gemini 关闭时显式传 none。
    params.reasoning_effort = effectiveEnabled ? effort : 'none';
  }
  if (/qwen/.test(model) || 'enable_thinking' in params) params.enable_thinking = effectiveEnabled;
  if (/qwen/.test(model) || params.chat_template_kwargs) {
    params.chat_template_kwargs = { ...params.chat_template_kwargs, enable_thinking: effectiveEnabled };
  }
  if (params.reasoning) {
    params.reasoning = {
      ...params.reasoning,
      enabled: effectiveEnabled,
      effort: effectiveEnabled ? effort : 'none',
      ...(effectiveEnabled && includeExclude ? { exclude: false } : {}),
    };
    delete params.reasoning.max_tokens;
  }
  if (!effectiveEnabled && 'reasoning_effort' in params) params.reasoning_effort = 'none';
  // 清除可能冲突的自定义原生参数；强制关闭不能被适配器降成 LOW / 自动思考。
  if (params.generationConfig?.thinkingConfig) {
    params.generationConfig = { ...params.generationConfig };
    delete params.generationConfig.thinkingConfig;
  }
  if (llm.connectionType === 'vertexai') {
    params.generationConfig = {
      ...params.generationConfig,
      thinkingConfig: vertexThinkingConfigForEffort(model, effort, {
        enabled: effectiveEnabled,
        includeThoughts,
        fallbackProToDynamic: false,
      }),
    };
  }
}

export function isThinkingModeRejected(error) {
  const status = Number(error?.status || error?.response?.status);
  if (![400, 422, 501].includes(status)) return false;
  const detail = [error?.message, error?.param, error?.code,
    error?.error?.message, error?.error?.param, error?.error?.code].filter(Boolean).join(' ');
  return /thinking|reasoning|budget_tokens|thinking_budget|thinking_level|思考|推理/i.test(detail);
}

/**
 * 兼容降级：当 OpenAI 兼容接口返回 400/422/501 拒绝自动注入的思考强度或开关字段时，
 * 优先剥离强度参数（reasoning_effort / budget_tokens / reasoning.effort）以保留 thinking；
 * 若非强制请求且接口明确拒绝 thinking 字段本身，则继续剥离 thinking/enable_thinking 后重试一次。
 */
export function stripRejectedThinkingParams(params, error, { extraBody = {}, forced = false, thinkingEnabled = false } = {}) {
  if (!thinkingEnabled || !isThinkingModeRejected(error)) return null;
  const detail = [error?.message, error?.param, error?.code,
    error?.error?.message, error?.error?.param, error?.error?.code].filter(Boolean).join(' ');
  if (/\bdisabled\b/i.test(detail) && params?.thinking?.type === 'disabled') return null;

  const hasUserKey = key => Boolean(extraBody && Object.hasOwn(extraBody, key));
  const next = { ...params };
  let changed = false;

  const rejectsEffort = /reasoning_effort|budget_tokens|thinking_budget|thinking_level|\beffort\b/i.test(detail)
    || (/\breasoning\b/i.test(detail) && !/\bthinking\b/i.test(detail));
  const rejectsThinkingObj = /\bthinking\b|enable_thinking|chat_template_kwargs/i.test(detail);

  const stripEffort = () => {
    let stripped = false;
    if ('reasoning_effort' in next && (!hasUserKey('reasoning_effort') || forced)) {
      delete next.reasoning_effort;
      stripped = true;
    }
    if (next.thinking && typeof next.thinking === 'object' && 'budget_tokens' in next.thinking && (!extraBody?.thinking?.budget_tokens || forced)) {
      const { budget_tokens, ...rest } = next.thinking;
      next.thinking = rest;
      stripped = true;
    }
    if (next.reasoning && typeof next.reasoning === 'object' && 'effort' in next.reasoning && (!extraBody?.reasoning?.effort || forced)) {
      const { effort, ...rest } = next.reasoning;
      next.reasoning = rest;
      stripped = true;
    }
    return stripped;
  };

  const stripThinkingSwitch = () => {
    let stripped = false;
    if (!forced) {
      if ('thinking' in next && !hasUserKey('thinking')) {
        delete next.thinking;
        stripped = true;
      }
      if ('enable_thinking' in next && !hasUserKey('enable_thinking')) {
        delete next.enable_thinking;
        stripped = true;
      }
      if (next.chat_template_kwargs && 'enable_thinking' in next.chat_template_kwargs && !extraBody?.chat_template_kwargs) {
        delete next.chat_template_kwargs;
        stripped = true;
      }
    }
    return stripped;
  };

  if (rejectsThinkingObj && !rejectsEffort) {
    changed = stripThinkingSwitch() || stripEffort();
  } else {
    changed = stripEffort();
    if ((!changed || (rejectsThinkingObj && rejectsEffort)) && rejectsThinkingObj) {
      changed = stripThinkingSwitch() || changed;
    }
  }
  return changed ? next : null;
}
