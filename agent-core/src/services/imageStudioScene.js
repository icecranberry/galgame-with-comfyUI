import { getDb, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { IMAGE_PROMPT_RULE, getWorldIntegrationRule } from '../builtinRules.js';
import { parseLoras } from '../maibot-bridge/generate.js';
import { buildImageCrossRefInfo, buildUserImageCrossRefInfo } from './characterPersona.js';
import { matchAll } from './characterSearch.js';
import { getUserName, matchUser } from './userSearch.js';
import { chatSync } from './lorebook/runtime.js';
import { extractImagePromptResponse } from './imagePromptResponse.js';

export async function generateStudioScenePrompt(desc, { explicitCharacters = null, angelReference, includeUser, userName = getUserName(),
  scope = 'image:studio', style = '', roleplay = true, signal } = {}) {
  const msgs = [{ role: 'system', content: getSystemRulesWithWorld({ roleplay }) || '你是一个角色扮演 AI。' }];
  try {
    if (getWorldSetting()) msgs.push({ role: 'system', content: getWorldIntegrationRule('photo') });
  } catch { /* 规则缺失非致命 */ }
  msgs.push({ role: 'system', content: `【生图规则】\n${IMAGE_PROMPT_RULE.rule_content}` });
  const staticTexts = msgs.map(message => message.content);
  const cacheBoundary = { index: msgs.length - 1, offset: msgs.at(-1).content.length };

  const loras = [];
  const crossBlocks = [];
  const characterNames = [];
  const matched = explicitCharacters === null ? matchAll(desc) : [];
  if (explicitCharacters !== null || matched.length > 0) {
    const db = getDb();
    const chars = explicitCharacters ?? matched.map(m =>
      db.prepare('SELECT id, display_name, base_prompt, loras FROM characters WHERE id = ?').get(m.id)
    ).filter(Boolean);
    crossBlocks.push(...chars.map(c => `[${c.display_name}]\n${buildImageCrossRefInfo(c)}`));
    characterNames.push(...chars.map(c => c.display_name));
    loras.push(...chars.flatMap(c => parseLoras(c)));
  }
  if (angelReference) {
    crossBlocks.push(angelReference.text);
    characterNames.push(angelReference.display_name);
  }
  // 画面描述里提到用户本人时同样注入其资料（用户不是角色：没有 id、没有 LoRA）
  if (includeUser ?? matchUser(desc)) {
    crossBlocks.push(`[${userName}]\n${buildUserImageCrossRefInfo()}`);
  }
  if (crossBlocks.length > 0) {
    msgs.push({
      role: 'system',
      content: `【画面交叉参考】以下角色/用户的身份与外观信息必须体现在生成的画面中：\n\n${crossBlocks.join('\n\n')}`,
    });
  }

  msgs.push({
    role: 'user',
    content: `【画面描述】\n${desc}${style ? `\n\n【画面要求】\n${style}` : ''}\n\n【当前任务】\n根据上面的画面描述，直接输出对应的英文生图 prompt（严格遵循【生图规则】）。不要任何格式包装或额外文字。`,
  });

  const raw = await chatSync(msgs, { temperature: 0.7, label: '图片实验室', signal, lorebook: {
    scope, personaTexts: crossBlocks, staticTexts, cacheBoundary,
    characterNames, characterDescription: crossBlocks.join('\n\n'), history: [msgs.at(-1)],
  } });
  const prompt = extractImagePromptResponse(raw);
  if (!prompt) throw new Error('模型未返回有效的提示词');
  return { prompt, loras };
}
