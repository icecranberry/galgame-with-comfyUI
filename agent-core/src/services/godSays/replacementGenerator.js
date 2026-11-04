import { getSystemRulesWithWorld, getWorldSetting } from '../../db/index.js';
import { getWorldIntegrationRule } from '../../builtinRules.js';
import { chatSync } from '../lorebook/runtime.js';
import { buildReplacementRequest, validateReplacement } from './replacementPrompt.js';

export async function generateReplacement(input, signal) {
  const request = buildReplacementRequest(input, { stageRules: getSystemRulesWithWorld({ roleplay: false }),
    worldRule: getWorldSetting() ? getWorldIntegrationRule(input.kind === 'appearance' ? 'photo' : 'interaction') : '' });
  return validateReplacement(await chatSync(request.messages, { label: '神说替换草稿', signal, temperature: 0.3, lorebook: request.lorebook }), input.kind);
}
