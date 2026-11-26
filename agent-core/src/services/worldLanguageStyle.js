import { getActiveWorldSetting, isWorldSettingHidden } from '../db/worldRepository.js';

function activeLanguageStyle() {
  if (isWorldSettingHidden()) return '';
  return getActiveWorldSetting()?.language_style?.trim() || '';
}

/**
 * 只在正文表达规则的原位追加，不改变历史、输出协议或未配置时的字节。
 * 指导按「用户主动指定 → 全部正文生效 → 示例用于迁移写法 → 优先于默认口吻、长度限制不变」写，
 * 让这份风格真正进入正文，而不是被默认的短句聊天腔稀释。
 */
export function appendWorldLanguageStyle(original, { narration = false } = {}) {
  const style = activeLanguageStyle();
  if (!style) return original;
  return `${original}\n\n<additional_writing_style>
以下是用户主动指定的语言风格，是本轮正文必须实际执行的写作要求，不是可选参考。
- 全部正文与角色发言都要按这份风格来写，不限于亲密场景：当前内容用不上风格里的某个题材时，仍要用它的句式、用词、节奏和描写密度来写眼前的内容。
- 落笔前先按风格确定叙述方式、句长和细节密度，正文必须真正写出来；只在思考中提及，或只在开头、结尾敷衍一句，都算没有执行。不要自行在风格与默认文风之间折中——用户主动加了这份风格，折中等于没有执行。
- 风格里的示例是写法样本：迁移它们的句法、语感、用词偏好和感官铺陈方式，用在本轮自己的内容上；不要照搬示例中的人物、情节或话题。
- 这份风格优先于默认文风、口语短句习惯、随机临时风格及历史中已有的说话方式；用户本轮的明确要求仍然优先。风格特征要在原有字数、篇幅和条数限制内写出来，不改变任何长度限制。
${narration ? '- 台词与上下旁白分别沿用三段式格式和人称。用本风格写台词的用词与节奏、旁白可见可闻的细节。台词总量单独计算。' : `- 沿用本任务规定的人称和消息格式；要求“禁止括号动作/旁白”时，风格示例里的舞台说明、第三人称旁白不照搬。风格要求动作、身体或感官描写时，按当前场景的篇幅调整密度：短消息可以用一两句把感官点带出来，长文可以展开。`}
- 角色身份、关系、当前情境与已知事实不能为了风格而改写；JSON 字段、消息结构、工具调用协议、任务要求和任务给定的字数范围保持原样。风格只约束中文正文的表达，imagePrompt 等英文画面描述仍按原格式规则写。

用户指定的语言风格：
${style}
</additional_writing_style>`;
}

/**
 * 是否配置了激活世界观的语言风格（隐藏世界观时视为未配置）。
 * 只用于 allowNarration 变体与末条 user 短指针等布尔判断，
 * 不复制风格正文：完整风格只由 appendWorldLanguageStyle 注入一次。
 */
export function hasActiveWorldLanguageStyle() {
  return Boolean(activeLanguageStyle());
}
