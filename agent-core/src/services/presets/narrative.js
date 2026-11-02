import { preparePreset } from './runtime.js';
import { prepareLorebook } from '../lorebook/runtime.js';
import { estimateTokens } from '../lorebook/engine.js';

// 创作请求显式接入预设；LLM 客户端和世界书适配器均不自动加载预设。
// 仅由生成用户可见正文的业务调用点选择此组装入口。
export function createNarrativeRuntime({ preset = preparePreset, lorebook = prepareLorebook,
  client = () => import('../../llm/llm-client.js') } = {}) {
  async function prepareNarrativePrompt(messages, lorebookOptions = {}, presetOptions = {}) {
    const compiled = await preset(messages, { ...presetOptions, lorebook:lorebookOptions });
    const presetContent = presetOptions.presetPlacement === 'cache'
      ? [!presetOptions.frozenPrefix && compiled.report?.stableContent, compiled.report?.tailContent].filter(Boolean).join('\n\n')
      : compiled.report?.content;
    const reservedTokens = presetContent ? estimateTokens(presetContent) + 4 : 0;
    // 添加 system1 前按原消息结构解析锚点，并先为预设预留 token 预算。
    const book = await lorebook(messages, lorebookOptions === false ? false : {
      ...lorebookOptions, reservedTokens:(lorebookOptions.reservedTokens || 0) + reservedTokens,
    });
    return {
      ...book,
      messages:compiled.apply(book.messages),
      lorebookMessages:book.messages, // 规划请求可复用上下文，不附带预设文风。
      presetReport:compiled.report,
      async reapply(originalMessages) { return compiled.apply(await book.reapply(originalMessages)); },
    };
  }

  // 简单创作请求在此完成一次组装；包含多种用途的服务必须在具体正文请求处
  // 显式调用本函数，不得替换通用客户端入口，避免生图、分析和规划请求误接入预设。
  async function chatWithPreset(messages, opts = {}) {
    const prepared = await prepareNarrativePrompt(messages, opts.lorebook ?? {}, opts);
    const result = await (await client()).chatSync(prepared.messages, opts);
    prepared.commit();
    return result;
  }
  return { prepareNarrativePrompt, chatWithPreset };
}

export const { prepareNarrativePrompt, chatWithPreset } = createNarrativeRuntime();
