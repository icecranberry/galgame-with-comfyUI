import { getSystemRulesWithWorld, getWorldSetting } from '../db/worldRepository.js';
import { getWorldIntegrationRule } from '../builtinRules.js';
import { chatSync } from '../llm/llm-client.js';

// 从 seedMedia 的刊社人格 / 核心规则 / 多样性 / 写作要求提炼；固定前缀不含本次需求。
export const MEDIA_OUTLET_DESIGN_PROMPT = `你是一位媒体栏目策划师。根据用户想法，设计一家可以持续产出内容的媒体，生成供设置表单使用的草稿，不生成某一期文章。
参考现有媒体的设计方法，而非照抄它们的名字和世界专属名词：
- 访谈周刊：有鲜明编辑部人格、自称与口头禅；抓人的标题；不同嘉宾互动的问答、榜单、读者跟帖；明确署名规则。
- 八卦小报：用反差与抓拍选题、短促旁白和辨识度强的标题；每期有新话题，不能只换人物重复同一件事。
- 社交论坛：不同身份、职业、阶层的用户独立发帖；求助、经验、吐槽、讨论等动机多样，评论有不同观点。

编辑风格 prompt 必须是可直接复用的中文指令，包含【身份与读者】【语气与署名】【选题与板块】【多样性】【写作规则】。
要具体说明谁在发声、对谁说话、关注什么、怎么起标题、如何组织正文与互动。结合当前世界观；未提供世界观时不要擅自套用现有媒体的专有名词。
所有板块须有独立定位，prompt 中说明各板块的内容职责。避免重复旧内容、同批选题雷同、模板化开头、全围着主角转；只谈当前已知信息，不预告未来事件。
用户指定数字报刊（portal）时：适配每期恰好四个栏目，先产标题/导语/配图描述，按需展开栏目正文；不要强制单张海报、固定排版或一次输出整期长文。
用户指定社交平台（feed）时：模拟不同用户发布独立帖子及评论，板块用于分类。
prompt 只写长期有效的编辑规则，不含今天日期、期号、某一期具体事件、JSON/XML 输出协议；实际内容输出格式由系统另行注入。

严格按以下完整 JSON 示例格式输出，不要输出解释、Markdown 围栏或 JSON 以外的文字：
{
  "name": "街角观察报（2至24字，独特中文名称，不照搬已有媒体）",
  "icon": "📰",
  "tagline": "记录街巷里的小事与新鲜见闻（1至60字的一句话定位）",
  "prompt": "你是《街角观察报》的编辑部。\\n【身份与读者】……\\n【语气与署名】……\\n【选题与板块】……\\n【多样性】……\\n【写作规则】……（整体400至2000字，具体可执行，替换省略号为完整规则）",
  "boards": [
    { "name": "街头新鲜事", "desc": "记录普通居民的新鲜日常（名称1至16字；定位1至60字）" },
    { "name": "人物访谈", "desc": "采访不同职业的人，呈现独立视角（与其他板块不重复）" },
    { "name": "生活榜单", "desc": "比较本地生活体验，提供有依据的榜单（具体说明题材）" },
    { "name": "读者来信", "desc": "呈现求助与不同意见的交流（具体说明互动方式）" }
  ]
}
icon 为一个适合主题的 emoji，最多8字符；boards 必须恰好4项，名称各不相同；每个示例值里的括号说明是约束，不要原样输出。`;

export function normalizeMediaOutletDraft(raw) {
  const text = (value, max, field) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
      throw new Error(`栏目草稿的${field}缺失或过长，请重新生成`);
    }
    return value.trim();
  };
  const draft = {
    name: text(raw?.name, 24, '名称'), icon: text(raw?.icon, 8, '图标'),
    tagline: text(raw?.tagline, 60, '介绍'), prompt: text(raw?.prompt, 8000, '编辑风格'),
  };
  if (!Array.isArray(raw?.boards) || raw.boards.length !== 4) throw new Error('栏目草稿必须包含4个板块，请重新生成');
  draft.boards = raw.boards.map(b => ({ name: text(b?.name, 16, '板块名称'), desc: text(b?.desc, 60, '板块定位') }));
  if (new Set(draft.boards.map(b => b.name)).size !== 4) throw new Error('板块名称重复，请重新生成');
  return draft;
}

export async function generateMediaOutletDraft({ brief, layout = 'portal' } = {}) {
  if (typeof brief !== 'string' || !brief.trim() || brief.length > 2000) {
    throw Object.assign(new Error('请填写1至2000字的栏目想法'), { statusCode: 400 });
  }
  if (!['portal', 'feed'].includes(layout)) throw Object.assign(new Error('媒体类型无效'), { statusCode: 400 });
  const messages = [{ role: 'system', content: getSystemRulesWithWorld({ roleplay: false }) }];
  if (getWorldSetting()) messages.push({ role: 'system', content: getWorldIntegrationRule('moments') });
  messages.push({ role: 'system', content: MEDIA_OUTLET_DESIGN_PROMPT });
  messages.push({ role: 'user', content: `设计一个${layout === 'portal' ? '数字报刊（portal）' : '社交平台（feed）'}栏目，按示例 JSON 返回草稿。\n我的想法：${brief.trim()}` });
  const raw = await chatSync(messages, {
    temperature: 0.8, max_tokens: 4000, response_format: { type: 'json_object' }, label: 'media:栏目生成助手',
  });
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('栏目草稿格式不正确，请重新生成'); }
  return { ...normalizeMediaOutletDraft(parsed), layout };
}
