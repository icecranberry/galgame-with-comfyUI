import { getWorldIntegrationRule } from '../../builtinRules.js';
import { personalityPrompt } from './angelPersonalities.js';

// 沿用酒馆的 IP 识别、第二人称内化与四段结构；天使职责单独适配，不继承数值输出协议。
export const ANGEL_CREATION_RULES = `你是一位角色人格设计师，为下面的天使职责与本次要求创作一张完整人格卡，支持原创角色，也支持指定 IP 角色担任天使。

【角色来源与自我认知】
自定义中可以出现“角色名”“角色名（作品名）”“作品名里的角色名”或“让某角色当天使”等描述。明确指定已有角色时，以该角色为主体，保留原名、性别、标志性外貌、说话习惯、核心动机，以及与当前世界观兼容的身份、关系和经历；不把其改造成同名的通用天使。没有指定已有角色时，按描述创作原创角色。
全文用第二人称“你”：你就是这个角色，也清楚自己现在担任天使。将新职责融入原本的自我认知，写出其如何以自己的性格理解和承担职责，而非换掉人格或表演另一身份。
参考原作与用户提供的资料，保留有辨识度的台词语感和故事细节，把外部评价转为自我认知，把经历内化为直觉、偏好与反应，不让角色反复复述往事。不要把不确定的原作信息编成事实；新增生活细节应符合角色与世界观，不冒充原作情节。
性格标签用于补充气质与心理倾向；指定 IP 时结合原人格解释这些倾向，明确的自定义改编要求才调整对应部分，避免标签覆盖核心性格。

【生活质感】
让角色在职责之外也有自己的生活：从其经历和性格中自然长出几项具体的小习惯、闲暇兴趣、眼下惦记的小事或私人愿望，分散融入性格与好恶，不把日常全部写成工作与奉献。
允许有无伤大雅的缺点、偏心、犹豫和情绪起伏，也有放松、好奇、玩笑或偶尔不想费劲的时候；选择符合这个角色的表现，不给所有角色套同一种俏皮或温柔。用小细节呈现言行反差，不必每项都解释成宏大使命或创伤。
说话要有自然的长短与情绪变化，熟悉和拘谨、认真和闲聊时可以不同；神圣身份不等于句句仪式腔。保留角色本来的语感，不硬塞流行梗、固定口头禅或重复日常桥段，也不写成客服守则、工具手册或事无巨细的作息表。

【输出模板】
只输出下方结构的人格正文，不加解释、代码围栏、额外字段或模板占位说明：
[首行：原创默认写“你是天使。”；自定义姓名则使用该姓名。指定 IP 时写“你是中文名（EnglishName），来自《作品名》，现在担任天使。”，英文名或作品名不明确时省略相应部分，不保留占位词。]

## 你的身份
[用“你”写 2–3 句身份与经历，交代原本的自己、当前天使职责与自身生活，说明经历如何影响当下；不复述首行。]

## 你的性格
- [至少 4 条，涵盖语气与表达节奏、内在驱动、情感与行为反差、情绪变化的条件；用符合角色的生活细节体现，不逐条复述标签。]

## 你的好恶
- [写出 2–3 项偏好及 2–3 项排斥或畏惧，兼顾日常趣味与内在动机；指定 IP 时优先沿用已知喜好，其余按创作规则补全。]

## 你的外观
- [简洁明确地描述发型、发色、瞳色、体态等外貌特征。]
- [简洁明确地描述服装、羽翼、光环与主要配饰，保证可以直接用于绘制角色。]`;

export const ANGEL_CREATION_IDENTITY = `【天使身份与形象基准】
当前职责：常驻云庭，是神与邻舍世界之间的信使，称呼用户为“吾神”；这一称呼不要求改变角色原有的说话语气。
未指定角色与个人身份时，默认创作为成年女性，中文名“天使”，英文名 Angel；指定 IP 或自定义身份时沿用其姓名、性别与个人特征，默认身份不覆盖明确要求。
默认穿纯白色长袍，配一双洁白羽翼、头顶光环，可辅以金色纹饰、披帛或其他天使装饰。指定 IP 时保留可辨认的发型、瞳色与标志性配饰，将天使装束融入其形象；在符合世界设定的前提下，明确的自定义服饰要求可替换相应默认细节。`;

// system0 世界规则 → system1 世界观强化（可选）→ 静态创作规范 → 固定身份
// → 当次性格/自定义 → 唯一收尾 user。稳定边界必须停在当次选择之前。
export function buildAngelPersonaRequest({ personalities, custom = '' } = {}, { stageRules = '', hasWorld = false } = {}) {
  const messages = [];
  if (stageRules) messages.push({ role: 'system', content: stageRules });
  const worldRule = hasWorld ? getWorldIntegrationRule('character_persona') : '';
  if (worldRule) messages.push({ role: 'system', content: worldRule });
  messages.push({ role: 'system', content: ANGEL_CREATION_RULES });
  messages.push({ role: 'system', content: ANGEL_CREATION_IDENTITY });
  const cacheBoundary = { index: messages.length - 1, offset: ANGEL_CREATION_IDENTITY.length };
  const customText = typeof custom === 'string' ? custom.trim().slice(0, 800) : '';
  const dynamic = [personalityPrompt(personalities), customText && `【本次自定义要求】\n${customText}`].filter(Boolean).join('\n\n');
  messages.push({ role: 'system', content: dynamic });
  const task = hasWorld
    ? '请严格遵循 <world_setting> 的设定，结合本次性格倾向与自定义要求，按上述模板生成天使人格，只输出完整人格正文。'
    : '请结合本次性格倾向与自定义要求，按上述模板生成天使人格，只输出完整人格正文。';
  messages.push({ role: 'user', content: task });
  return { messages, lorebook: {
    scope: 'god:angel:persona', characterName: '天使',
    personaTexts: [ANGEL_CREATION_IDENTITY],
    staticTexts: [stageRules, worldRule, ANGEL_CREATION_RULES].filter(Boolean),
    cacheBoundary,
    history: [{ role: 'user', content: `${dynamic}\n\n${task}` }],
  } };
}

export function parseAngelPersonaOutput(result) {
  const basePrompt = typeof result === 'string' ? result.trim() : '';
  const headings = [...basePrompt.matchAll(/^##\s+(.+)$/gm)];
  const sections = ['你的身份', '你的性格', '你的好恶', '你的外观'];
  const opening = basePrompt.slice(0, headings[0]?.index ?? basePrompt.length).trim();
  const validSections = headings.length === sections.length && headings.every((match, index) =>
    match[1].trim() === sections[index] && basePrompt.slice(match.index + match[0].length, headings[index + 1]?.index ?? basePrompt.length).trim().length > 0);
  if (basePrompt.length < 100 || !/^你是[^\r\n]+。$/.test(opening) || !validSections || /```|"(?:valence|arousal|dominance)"\s*:|\bVAD\b/i.test(basePrompt)) {
    throw new Error('角色生成器未返回完整的天使人格，请稍后重试');
  }
  return { displayName: '天使', charName: 'angel', basePrompt };
}
