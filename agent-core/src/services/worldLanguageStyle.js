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
export function appendWorldLanguageStyle(original) {
  const style = activeLanguageStyle();
  if (!style) return original;
  return `${original}\n\n<additional_writing_style>
以下是用户主动指定的语言风格，是本轮正文必须实际执行的写作要求，不是可选参考。
- 全部正文与角色发言都要按这份风格来写，不限于亲密场景：当前内容用不上风格里的某个题材时，仍要用它的句式、用词、节奏和描写密度来写眼前的内容。
- 落笔前先按风格确定叙述方式、句长和细节密度，正文必须真正写出来；只在思考中提及，或只在开头、结尾敷衍一句，都算没有执行。不要自行在风格与默认文风之间折中——用户主动加了这份风格，折中等于没有执行。
- 风格里的示例是写法样本：迁移它们的句法、语感、用词偏好和感官铺陈方式，用在本轮自己的内容上；不要照搬示例中的人物、情节或话题。
- 这份风格优先于默认文风、口语短句习惯、随机临时风格及历史中已有的说话方式；用户本轮的明确要求仍然优先。风格特征要在原有字数、篇幅和条数限制内写出来，不改变任何长度限制。
- 默认规则里的“像真人聊天”“口语化、短句”“禁止括号动作/旁白”，以及“你在聊天软件里发消息，不是写舞台剧本”只在涉及叙述方式时让位于本风格。本风格要求动作、身体和感官描写时，按当前场景的篇幅调整密度：短消息可以用一两句把感官点带出来（可以嵌在对话里，不必另起旁白段），长段再展开角色第一人称的叙述性正文（也可以按风格示例的镜头感客观描写）；括号舞台说明和替别人写的第三人称旁白仍然禁止，但不禁止风格要求的叙述正文。角色第一人称的叙述不是舞台剧本；对白与叙述的比例按风格稿和当前篇幅执行，总字数、篇幅和条数仍以原要求为准。
- 风格示例若是第三人称，只迁移写法与镜头感，不因此改掉角色的第一人称视角、身份或说话习惯。
- 角色身份、关系、当前情境与已知事实不能为了风格而改写；JSON 字段、消息结构、工具调用协议、任务要求和任务给定的字数范围保持原样。风格只约束中文正文的表达，imagePrompt 等英文画面描述仍按原格式规则写。

用户指定的语言风格：
${style}
</additional_writing_style>`;
}

/**
 * 末尾重申（放在各生成入口的稳定前缀末尾，随前缀缓存命中）。
 * 完整风格在静态前缀里只放一次；这里只做一次短提醒，未配置时返回空串。
 */
export function buildWorldLanguageStyleReminder() {
  const style = activeLanguageStyle();
  if (!style) return '';
  // 末尾只带风格开头的一小段要点：完整稿仍以静态前缀的 <additional_writing_style> 为准，
  // 这样既把用户的具体方向送到末位，又不重复整份长规范。
  const flat = style.replace(/\s+/g, ' ').trim();
  const excerpt = flat.length > 160 ? `${flat.slice(0, 160)}……` : flat;
  return `<writing_style_reminder>本轮正文按用户指定的 <additional_writing_style> 落笔（风格要点：${excerpt}）；句式、用词、节奏和感官密度必须实际出现在正文里，不能只在思考中提，也不要与默认文风折中。风格要求动作与感官时按当前场景篇幅调整密度：短消息可把感官点嵌在对话里，长段再展开第一人称叙述；“聊天软件里发消息、不是写舞台剧本”和“禁止旁白/括号动作”只拦括号舞台说明与替别人写的旁白，不拦风格要求的叙述。字数、篇幅和条数仍按原要求，不因风格放大。角色身份、情境事实、JSON 字段、输出格式与任务要求保持不变，imagePrompt 等英文画面描述不套用本风格。</writing_style_reminder>`;
}
