import { getDb, getSystemRulesWithWorld } from '../db/index.js';
import { config } from '../config.js';
import { chatSync } from './lorebook/runtime.js';
import { searchCharacterInfo } from './webSearch.js';

// 共享：构建人格生成指令（标准模板 + 参考资料）
export function buildPersonaSystemPrompt({ searchContext, extraContext, extraContextLabel }) {
  return `你是一个角色人格生成器。用户会输入一个简短的描述（格式可能是"角色名"、"角色名（作品名）"、"作品名里的角色名"等）。

你的任务：
1. 如果是知名 IP 角色（游戏/动漫/影视），务必融入角色在原作中的身份、背景故事、性格特点。如果是原创角色，根据名字和描述自行发挥。
2. 生成一个完整的人格提示词（base_prompt），格式必须严格遵循下方模板。

【核心创作原则 —— 必须遵守】
A. 你就是她/他 —— 所有描述从"你"出发。让模型"成为"而非"扮演"该角色。全文不得出现"扮演""模仿""以XX的身份回答"等旁观字眼。
B. 过去化为直觉 —— 经历如何塑造性格必须写清，但角色在对话中不主动提及自己的过去。那些经历是你所有回应的底层逻辑，不是挂在嘴边的谈资。
C. 自我认知而非外部评价 —— 写"我怎么看自己"，不写"别人怎么看我"。思考角色自己最想深藏心底、永远不会忘记的事。
D. 保留血肉 —— 原始资料中的具体台词、评价、故事细节全部保留，只做视角转换（她→你）和内化逻辑的补充，不删减素材。

【模板】
你是[中文名(EnglishName)]。
如果是知名 IP 角色，在角色名后加上英文名「格式：中文名(EnglishName)」和「来自《作品名》」；
如果是未标注来源的原创角色，则去掉英文名和「来自《...》」部分。

## 你的身份
[5句话描述角色的背景、经历、关键故事，让角色有血有肉]

## 你的性格
- [至少4条，以"你"的口吻自然写出。包含说话方式、口头禅、处事态度、核心信条。对标原作中角色的独特魅力。覆盖以下维度：
  · 表层语调 —— 别人听起来你是什么样的语气？快慢冷热礼貌粗鲁？
  · 内因驱动 —— 你为什么这样说话？深层恐惧/信念/伤口是什么？每句话在防御什么、渴望什么？
  · 话语与行动的反差 —— 嘴上说什么 vs 实际做什么，矛盾越大越立体
  · 裂缝时刻 —— 什么情况下语气会变、面具会滑落？哪个词/哪个人/哪种场景让你停顿？
  ]

## 你的好恶
- 你最喜欢的两三样东西（食物/地点/活动/人——必须是资料中有迹可循的，不凭空编造）
- 你最排斥/最害怕的两三样东西（同样从资料中提取，不随意发挥）

## 你的外观
- [一句话准确简洁地描述角色的外貌(发型瞳色等)，突出最具辨识度的特征]
- [一句话简洁描述穿着和主要装饰品]

${searchContext ? `

---
以下是从萌娘百科获取的角色参考资料，用于完善角色设定：
- 参考资料中【萌娘百科 · 基本信息框】内的字段（发色、瞳色、身高、萌点等）来自页面信息框，是高度精确的结构化数据，**写入角色设定时必须优先采用**。
- 【正文描述】部分来自页面正文，作为背景故事和性格描写的补充参考。
${searchContext}` : ''}${extraContext ? `

---
以下是从${extraContextLabel}导入的角色原始资料，是你整理角色设定的**第一手素材**：必须完整吸收其中所有具体细节、台词、设定与背景，只做视角转换（她/他→你）与结构化整理，不删减、不架空、不凭空新增与资料冲突的设定。当与网络资料冲突时，以本资料为准。
${extraContext}` : ''}

---

【输出要求】
- 严格按以下格式输出，不要添加任何标签、前缀、冒号或额外解释，只输出值本身
- 第1行：只输出角色中文显示名，例如：芙宁娜
- 第2行：只输出角色英文名，例如：Kiana Kaslana
- 第3行：只输出角色的 VAD 情绪基线 JSON。根据角色性格设定，示例：
	  * 活跃开朗的角色：{"valence":0.6,"arousal":0.55,"dominance":0.5}
	  * 忧郁内向的角色：{"valence":-0.1,"arousal":0.3,"dominance":0.35}
	  * valence (愉悦度): -1~1，阳光正面 >0，阴暗消极 <0，中性 0.3~0.7
	  * arousal (唤醒度): 0~1，活泼好动 >0.6，沉静内敛 0.3~0.5，慵懒 <0.3
	  * dominance (支配度): 0~1，自信强势 >0.6，温和中性 0.4~0.6，顺从弱势 <0.35
	- 第4行起：完整的 base_prompt 模板内容（你就是她/他——用第二人称"你"贯穿全文，不出现"扮演""模仿"等旁观字眼）`;
}

// 共享：联网搜索 + LLM 人格生成 + 解析。cachedSearchContext 用于复用上次搜索结果，避免重新爬取。
// description 为用户输入（用于联网搜索与作为 user 消息）；extraContext 为额外第一手资料（如角色卡全文）。
// 返回 { displayName, charName, emotionBaseline, basePrompt, searchFound, searchContext }，失败时抛错。
export async function runPersonaGeneration({
  description,
  extraContext = '',
  extraContextLabel = '参考资料',
  skipWebSearch = false,
  cachedSearchContext = '',
  label = '创造角色',
  signal,
  timeout,
  retries,
  maxRetries,
}) {
  const model = config.llm.model || 'deepseek-chat';

  // ── 联网搜索角色资料（可跳过：导入角色卡时以卡片为第一手资料，无需联网）──────
  let searchContext = '';
  let searchFound = false;
  if (cachedSearchContext) {
    searchContext = cachedSearchContext;
    searchFound = searchContext.length >= 600;
    console.log(`[characters] reusing cached web search (${searchContext.length} chars)`);
  } else if (skipWebSearch) {
    console.log(`[characters] web search skipped (source: ${extraContextLabel})`);
  } else {
    console.log(`[characters] searching web for: "${description.trim()}"`);
    try {
      searchContext = await searchCharacterInfo(description.trim());
      if (searchContext) {
        console.log(`[characters] web search returned ${searchContext.length} chars`);
      } else {
        console.log('[characters] web search returned no results');
      }
    } catch (err) {
      console.warn('[characters] web search failed, continuing without:', err.message);
    }
    searchFound = !!(searchContext && searchContext.length >= 600);
  }

  // 温度策略：有参考资料（网络/卡片）→ 低温忠实还原；原创设定 → 中等温度兼顾创造力与格式
  const temperature = (searchFound || skipWebSearch) ? 0.3 : 0.7;
  console.log(`[characters] search_found=${searchFound}, skipWebSearch=${skipWebSearch}, temperature=${temperature}`);

  // msgs[0] — 舞台：破限词 + 世界观
  const stageRules = getSystemRulesWithWorld({ roleplay: false });

  // msgs[1] — 任务：角色生成指令 + 模板 + 参考资料（含角色卡原始资料）
  const systemPrompt = buildPersonaSystemPrompt({ searchContext, extraContext, extraContextLabel });

  const msgs = [];
  if (stageRules) msgs.push({ role: 'system', content: stageRules });
  msgs.push({ role: 'system', content: systemPrompt });
  msgs.push({ role: 'user', content: description.trim() });

  // 原消息角色与顺序不变；参考资料出现前才是已确认稳定的前缀。
  const referenceStart = systemPrompt.indexOf('以下是从');
  const stableTask = systemPrompt.slice(0, referenceStart < 0 ? systemPrompt.length : referenceStart);
  const result = await chatSync(msgs, { model, temperature, label, signal, timeout, retries, maxRetries,
    lorebook: { personaTexts: [], staticTexts: [stableTask],
      cacheBoundary: { index: msgs.length - 2, offset: stableTask.length },
      history: [{ role: 'user', content: description.trim() }] },
  });

  // 解析输出：第1行 display_name，第2行 name，第3行 VAD，第4行起 base_prompt
  const lines = result.split('\n');
  let displayName = '';
  let charName = '';
  let emotionBaseline = '{"valence":0.5,"arousal":0.5,"dominance":0.5}';
  let promptStart = 0;

  // 防御：如果 AI 错误地输出了 "display_name" / "name" 等标签行，跳过它们
  const SKIP_LABELS = /^(display_name|name|emotion_baseline|vad|vad_baseline)$/i;

  // 找 display_name（第一个有效非空行）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || SKIP_LABELS.test(line)) continue;
    if (!displayName) { displayName = line; continue; }
    if (!charName) { charName = line.replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'char_' + Date.now(); continue; }
    // 第三行尝试解析 JSON
    try { emotionBaseline = JSON.stringify(JSON.parse(line)); promptStart = i + 1; break; }
    catch { emotionBaseline = JSON.stringify({ valence: 0.5, arousal: 0.5, dominance: 0.5 }); promptStart = i; break; }
  }
  if (promptStart === 0) promptStart = lines.length;

  const basePrompt = lines.slice(promptStart).join('\n').trim();

  if (!displayName || basePrompt.length < 100) {
    throw new Error('AI 生成的角色人格不完整，请重试');
  }

  // 确保 name 不重复
  const db = getDb();
  const exists = db.prepare('SELECT id FROM characters WHERE name = ?').get(charName);
  if (exists) charName = charName + '_' + Date.now();

  return { displayName, charName, emotionBaseline, basePrompt, searchFound, searchContext };
}

