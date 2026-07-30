import { getDb } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { retrieveImagePromptKnowledge } from './imagePromptKnowledge.js';

function cleanModelPrompt(value) {
  let text = String(value || '').trim();
  text = text.replace(/^```(?:text|json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const jsonMatch = text.match(/^\s*\{[\s\S]*\}\s*$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(text);
      text = String(parsed.prompt || parsed.refined_prompt || '').trim();
    } catch {}
  }
  text = text.replace(/^(?:prompt|refined prompt|优化后提示词)\s*[:：]\s*/i, '').trim();
  return text;
}

function persistPreparation(result, db = getDb()) {
  const snapshot = {
    scene: result.scene,
    query: result.promptOriginal,
    items: result.retrieval.items.map(item => ({
      id: item.id,
      category: item.category,
      title: item.title,
      content: item.content,
      score: item.score,
    })),
  };
  const inserted = db.prepare(`
    INSERT INTO image_prompt_preparations (
      scene, prompt_original, prompt_refined, knowledge_ids, knowledge_version,
      retrieval_mode, retrieval_snapshot, optimization_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.scene,
    result.promptOriginal,
    result.promptRefined,
    JSON.stringify(result.retrieval.knowledgeIds),
    result.retrieval.knowledgeVersion,
    result.retrieval.mode,
    JSON.stringify(snapshot),
    result.status,
  );
  return Number(inserted.lastInsertRowid);
}

export async function prepareImagePrompt(prompt, {
  scene = 'chat',
  alreadyPrepared = false,
  skipOptimization = false,
  persist = true,
  db = null,
} = {}) {
  const sceneAliases = { event: 'events', peek: 'schedule', gifts: 'gift', avatargen: 'avatar' };
  scene = sceneAliases[scene] || scene;
  const original = String(prompt || '').trim();
  if (!original) {
    return { promptOriginal: original, promptRefined: original, status: 'empty', scene, retrieval: { mode: 'none', items: [], knowledgeIds: [], knowledgeVersion: '' } };
  }
  if (alreadyPrepared || skipOptimization) {
    return { promptOriginal: original, promptRefined: original, status: 'skipped', scene, retrieval: { mode: 'none', items: [], knowledgeIds: [], knowledgeVersion: '' } };
  }

  const database = db || getDb();
  const retrieval = await retrieveImagePromptKnowledge(original, { scene, db: database });
  const knowledge = retrieval.items
    .map((item, index) => `${index + 1}. [${item.category}] ${item.content}`)
    .join('\n');
  let refined = original;
  let status = 'fallback';

  if (knowledge) {
    try {
      const response = await chatSync([
        {
          role: 'system',
          content: `你是独立的 Stable Diffusion / ComfyUI 提示词整理器。只处理本次生图提示词，不续写对话。\n规则：\n- 忠实保留用户明确指定的人物、动作、服装、镜头和环境，不新增剧情。\n- 按知识规则重排和精简，删除重复与互斥标签；人数、身份、姿态、镜头、视线、服装状态、环境必须自洽。\n- 用户明确要求高于默认知识。\n- 输出适合直接提交生图模型的英文逗号标签或简洁英文描述。\n- 只输出最终提示词，不解释，不加 Markdown。`,
        },
        {
          role: 'user',
          content: `原始提示词：\n${original}\n\n本轮召回知识：\n${knowledge}`,
        },
      ], { max_tokens: 4096, temperature: 0.15, thinking: { type: 'disabled' }, forceThinking: true, label: 'image-prompt-refine', retries: 1 });
      const parsed = cleanModelPrompt(response);
      if (parsed) {
        refined = parsed;
        status = 'refined';
      }
    } catch (error) {
      console.warn(`[imagePromptPreparer] optimization fallback: ${error.message}`);
    }
  }

  const result = { promptOriginal: original, promptRefined: refined, status, scene, retrieval };
  if (persist) result.preparationId = persistPreparation(result, database);
  return result;
}
