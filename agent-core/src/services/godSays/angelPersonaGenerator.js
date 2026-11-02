import { getSystemRulesWithWorld, getWorldSetting } from '../../db/index.js';
import { config } from '../../config.js';
import { chatSync } from '../lorebook/runtime.js';
import { buildAngelPersonaRequest, parseAngelPersonaOutput } from './angelPersonaPrompt.js';

export async function runAngelPersonaGeneration({ personalities, custom, label = '创造角色:天使', signal, timeout, retries, maxRetries } = {}) {
  const request = buildAngelPersonaRequest({ personalities, custom }, {
    stageRules: getSystemRulesWithWorld({ roleplay: false }), hasWorld: !!getWorldSetting(),
  });
  const result = await chatSync(request.messages, {
    model: config.llm.model || 'deepseek-chat', temperature: 0.7,
    label, signal, timeout, retries, maxRetries, lorebook: request.lorebook,
  });
  return parseAngelPersonaOutput(result);
}
