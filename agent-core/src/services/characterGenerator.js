import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { getWorldIntegrationRule } from '../builtinRules.js';
import { config } from '../config.js';
import { chatSync } from './lorebook/runtime.js';
import { searchCharacterReference } from './webSearch.js';
import { PERSONA_RULES, cleanGeneratedPersona } from './structuredPersonaPrompt.js';
import { cachedAkashaIdentity } from './akashaReference.js';

const CREATION_RULES = `你负责新角色建档。根据用户的设定和已经定稿的人设填写角色资料；外观优先采用用户设定及百科信息框中的原作资料。
只返回一个合法 JSON 对象，严格使用示例的三个必填字段，禁止代码围栏、解释或额外字段。
{"name":"ganyu","appearance":"- 你的浅蓝色长发在颈后束起，眼睛呈紫色。\\n- 你穿着带金色纹饰的工作服，颈间系着铃铛。","emotion_baseline":{"valence":0.4,"arousal":0.35,"dominance":0.45}}
name 为英文名或拼音的 ASCII 标识；appearance 是不带标题的两行外观正文，第一行简述发型、瞳色等外貌，第二行简述穿着与主要装饰品。保留原作或卡片中的辨识特征。emotion_baseline 是角色日常的情绪数值对象，valence（愉悦）介于 -1 和 1，arousal（唤醒）和 dominance（支配）介于 0 和 1，均为数字。`;

function generationRequest({ rules, persona, materials, task, hasWebMaterials }) {
  const world = !hasWebMaterials && getWorldSetting();
  const systemRules = world ? getSystemRulesWithWorld({ roleplay: false }) : getSystemRules({ roleplay: false });
  const stable = [systemRules, world && getWorldIntegrationRule('interaction'), rules].filter(Boolean);
  const messages = stable.map(content => ({ role: 'system', content }));
  const cacheBoundary = { index: messages.length - 1, offset: rules.length };
  if (persona) messages.push({ role: 'system', content: persona });
  if (materials) messages.push({ role: 'system', content: materials });
  const user = { role: 'user', content: [world && '请遵循 <world_setting> 中的世界观设定。', task].filter(Boolean).join('\n') };
  messages.push(user);
  // 世界书属于激活的世界观。按原作资料浓缩时，也跳过该世界书的自动注入。
  return { messages, lorebook: hasWebMaterials ? false : { personaTexts: persona ? [persona] : [], staticTexts: stable, cacheBoundary,
    history: messages.slice(stable.length) } };
}

// 智慧宫招募先随卡写出文字外观，有百科立绘时可继续识图。升级只写人设。
export async function buildStructuredPersona({
  name, ip, description = name, extraContext = '', fetchedMaterials = '', recruitment = false,
  skipWebSearch = false, original = false, onStage = () => {}, label = '重写角色人设', ...options
}, { search = searchCharacterReference, generate = chatSync } = {}) {
  let reference = { text: fetchedMaterials };
  if (!reference.text.trim() && !skipWebSearch && !original) {
    onStage('search');
    try {
      reference = await search(description, { name, ip, includeImage: recruitment, preferAkasha: true, signal: options.signal, onStage });
    } catch (error) {
      console.warn('[characters] 资料检索失败：', error.message);
    }
    if (!reference.text?.trim()) console.warn('[characters] 无可用网络文字资料，使用角色名、作品、现有设定与模型知识生成');
  }
  const materials = reference.text?.trim() || '';
  const akasha = cachedAkashaIdentity(materials);
  const sourceIp = original ? '' : (ip || reference.ip || akasha?.ip || '');
  const hasWebMaterials = Boolean(materials);
  options.signal?.throwIfAborted();
  const targetName = name || reference.name || akasha?.name;
  const includeAppearance = recruitment && Boolean(akasha);
  const source = akasha ? 'akasha' : hasWebMaterials ? 'network' : original ? 'original' : 'not-found';
  onStage('reference', { source, search_context: materials });
  onStage(hasWebMaterials ? 'write' : 'write-local');

  // 招募有网络正文时关闭思考；只有名字、作品名或用户构想时用 medium 塑造人物。旧卡与导入资料整理用 low。
  let forceThinkingMode;
  if (recruitment && !skipWebSearch) {
    if (hasWebMaterials) forceThinkingMode = 'disabled';
    else if (!extraContext.trim()) forceThinkingMode = 'enabled';
  }
  const task = [targetName && `角色名：${targetName}`, sourceIp && `所属作品：${sourceIp}`,
    original && '这是无 IP 的原创角色。', `本次设定：${description}`,
    '按以上角色与设定撰写首行身份句和五段 Markdown 人设。',
    includeAppearance ? '本次招募请在五段人设后一起写出「## 你的外观」，以文字资料中的默认造型为准。' : '写到「你的好恶」结束。'].filter(Boolean).join('\n');
  let correction = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { messages, lorebook } = generationRequest({
      rules: PERSONA_RULES, persona: extraContext, materials: materials && '检索到的文字资料：\n' + materials,
      task: task + correction, hasWebMaterials,
    });
    const raw = await generate(messages, { ...options, model: config.llm.model || 'deepseek-chat', label, lorebook,
      temperature: materials || extraContext ? 0.3 : 0.7, forceThinkingMode,
      thinkingEffort: forceThinkingMode === 'enabled' ? 'medium' : 'low',
      fallbackToConfiguredThinking: forceThinkingMode === 'enabled' });
    options.signal?.throwIfAborted();
    onStage('validate');
    try {
      const result = cleanGeneratedPersona(raw, { name: targetName, ip: sourceIp, original, sourcePersona: extraContext, includeAppearance });
      return { ...result, source, searchContext: materials,
        referenceImage: reference.referenceImage || '', referenceImageInfo: reference.referenceImageInfo || null };
    } catch (error) {
      if (attempt) throw error;
      console.warn(`[characters] ${label}：${error.message}，将再次请求模型`);
      onStage('retry-format');
      correction = '\n上一次格式校验未通过，请重新生成完整人设。' + error.message;
    }
  }
}

export async function runPersonaGeneration({
  description, name, ip, extraContext = '', skipWebSearch = false, cachedSearchContext = '',
  label = '创造角色', ...options
}, deps = {}) {
  const result = await buildStructuredPersona({ ...options, name, ip, description, extraContext, skipWebSearch,
    fetchedMaterials: cachedSearchContext, recruitment: true, label }, deps);
  if (result.appearance) {
    const english = /^\s*你是[^。\n(（]*[(（]([^()（）\n]+)[)）]/.exec(result.persona)?.[1] || result.displayName;
    return { ...result, charName: availableCharacterName(english), basePrompt: result.persona + '\n\n## 你的外观\n' + result.appearance, searchFound: true,
      emotionBaseline: '{"valence":0.5,"arousal":0.5,"dominance":0.5}' };
  }
  const { messages, lorebook } = generationRequest({
    rules: CREATION_RULES, persona: result.persona, materials: [extraContext, result.searchContext].filter(Boolean).join('\n\n'),
    task: `请为${result.displayName}填写英文标识、外观与初始情绪，遵循本次设定「${description}」，只输出约定的 JSON 对象。`,
    hasWebMaterials: Boolean(result.searchContext),
  });
  // low：已有完整人设，只需独立整理原作外观与建档字段。
  const raw = await (deps.generate || chatSync)(messages, { ...options, label: '新角色外观与建档', model: config.llm.model || 'deepseek-chat',
    temperature: 0.3, response_format: { type: 'json_object' }, thinkingEffort: 'low', lorebook });
  const meta = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  const vad = meta?.emotion_baseline;
  const appearance = typeof meta?.appearance === 'string' ? meta.appearance.trim() : '';
  if (!appearance || /^ *#/m.test(appearance) || typeof meta.name !== 'string' ||
    !['valence', 'arousal', 'dominance'].every(key => Number.isFinite(vad?.[key]) && vad[key] >= (key === 'valence' ? -1 : 0) && vad[key] <= 1)) {
    throw new Error('新角色外观或初始情绪格式无效，请重新生成');
  }
  return { ...result, charName: availableCharacterName(meta.name), emotionBaseline: JSON.stringify(vad), basePrompt: result.persona + '\n\n## 你的外观\n' + appearance,
    searchFound: Boolean(result.searchContext) };
}

function availableCharacterName(name) {
  let charName = name.replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'char_' + Date.now();
  if (getDb().prepare('SELECT id FROM characters WHERE name = ?').get(charName)) charName += '_' + Date.now();
  return charName;
}
