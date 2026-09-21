/**
 * 角色卡「## 你的外观」段的按需补全。
 *
 * 老角色卡常常只有人设正文、没有标准外观段：这时 buildCharacterPersona 的 short 口径
 * 会兜底整卡，小镇立绘 / 像素小人拿不到任何外观锚点（生成与重写提示词都会跑偏）。
 * 这里用一次 LLM 从人格卡推断外观，按既有口径重组回「## 你的外观」段并写回角色卡：
 * 一次补全，之后酒馆详情卡可见、可编辑，小镇侧也一直拿得到。
 */
import { getDb, getSystemRules } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { extractAppearanceSection, replaceAppearanceSection } from './characterPersona.js';

const BUILD_APPEARANCE_SYSTEM_PROMPT = `你是角色外观设定助手。
用户会提供一张角色卡（人设文本）。请依据卡里的身份、作品背景、性格与职业线索，为这个角色写一段用于 AI 生图的「外观描述」。

要求：
- 输出一段连贯英文（danbooru 风格 tag 或简短英文短语），不要换行、不要中文、不要 markdown、列表、引号或任何解释
- 先写脸与发型（发型、发色、瞳色、五官特征、体型），再写服装与饰品
- 忠于卡里已经写明的外观线索；卡里没有外观信息时，按身份与职业设计一套辨识度高的合理外观
- 只描述静态外观：不要表情、动作、姿势、场景、背景、画质与镜头描述
- 80 到 200 个字符`;

/** 剥掉代码围栏、引号包装，压成单行 */
function normalizeAppearance(text) {
  return String(text || '').trim()
    .replace(/^```(?:[a-z]+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 确保角色卡有标准外观段；没有就用 LLM 补一段并写回 base_prompt。
 * @param {number} characterId
 * @param {object} [deps] - { chatSync } 便于测试注入
 * @returns {Promise<{ appearance: string, basePrompt: string, generated: boolean } | null>}
 */
export async function ensureCharacterAppearanceSection(characterId, deps = {}) {
  const db = getDb();
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!character) return null;
  const existing = extractAppearanceSection(character.base_prompt);
  if (existing.trim()) return { appearance: existing, basePrompt: character.base_prompt, generated: false };

  const callLlm = deps.chatSync || chatSync;
  const name = character.display_name || character.name || '这个角色';
  const card = String(character.base_prompt || '').slice(0, 4000);
  const out = await callLlm([
    { role: 'system', content: getSystemRules({ roleplay: false }) },
    { role: 'system', content: BUILD_APPEARANCE_SYSTEM_PROMPT },
    { role: 'user', content: `角色名：${name}\n\n角色卡：\n${card}` },
  ], { temperature: 0.6, max_tokens: 512, label: '补全角色外观段' });

  const appearance = normalizeAppearance(out);
  if (appearance.length < 20) throw new Error('LLM 没能从人格卡里推断出可用的外观描述');

  const basePrompt = replaceAppearanceSection(character.base_prompt, appearance);
  db.prepare('UPDATE characters SET base_prompt = ? WHERE id = ?').run(basePrompt, characterId);
  console.log(`[char appearance] backfilled "## 你的外观" for "${name}" (id=${characterId}, ${appearance.length} chars)`);
  return { appearance, basePrompt, generated: true };
}