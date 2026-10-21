/** 朋友圈发布形态池、单中心提示规则与配图工具——角色发帖（routes/moments.js）与镇民发帖
 * （services/town/townNpcMomentGenerator.js）共用，避免两端口径漂移。 */

export const MOMENT_FORMS = [
  { name: '短句流',  desc: '可以直接说出最想说的感想，保留让意思成立的细节', len: '5-40字', weight: 2.0, nightBoost: false },
  { name: '纯图党',  desc: '照片能传达主要信息时，可以用简短感想或表情回应，不必复述画面', len: '1-30字', weight: 0.5, nightBoost: true },
  { name: '括号吐槽', desc: '有顺口的补充或自我拆台时可以放进括号，不必专门安排反差', len: '15-90字', weight: 0.8, nightBoost: false },
  { name: '发疯文学', desc: '符合角色和当下心情时，可以夸张回应眼前的小刺激，不强行搞笑或堆砌标点', len: '10-90字', weight: 0.5, nightBoost: false },
  { name: '抛个问题', desc: '确实有疑问或需要帮助时可以提问，带够场景让人能回答，不为互动强凑问题', len: '15-90字', weight: 0.9, nightBoost: false },
  { name: '颜文字体', desc: '符合角色习惯时可以用颜文字表达情绪，不用也可以，不挤掉具体感想', len: '1-40字', weight: 1.4, nightBoost: true },
  { name: '只发个语气词', desc: '确实只想给个反应时，可以只用语气词或表情；已有具体感想时保留它', len: '1-24字', weight: 0.2, nightBoost: true },
  { name: '话说一半', desc: '念头自然停住时可以留白，不故意截断意思或强加省略号', len: '5-60字', weight: 0.8, nightBoost: false },
];

/** 图文保持一个中心，日程与动因的主次由请求组装时确定。 */
export const MOMENT_SINGLE_FOCUS_RULE = [
  '- **单中心、按本次主次（最高优先级）**：遵守【本次内容主次】，text 与所有 imagePrompt 围绕主项中的一个分享点展开。人设决定注意什么、有什么态度、愿意透露多少。没有标注主次时，有日程就以日程为主，否则围绕提供的话题或亲历记录写。',
  '- **日程为主时**：从当前日程挑一个细节或反应；动因只是弱参考，不自然相关就忽略，不为照顾动因添加第二件事。',
  '- **动因为主时**：围绕动因选一个分享点；简要日程只作低优先级背景，正文可以完全不提，不必交代日程过程，也不必解释如何从日程联想到动因。',
  '- 弱项不是必须出现的内容，不把两件事各写一遍，不用巧合、额外道具、回忆或因果解释硬串联。其他经历、旧动态也只作背景，不逐项汇报；不编造与已知事实冲突的经历。',
].join('\n');

/** 朋友圈口吻总纲：朋友圈是随手一发的生活碎片，不是成文的作品。角色帖与镇民帖共用。 */
export const MOMENT_TONE_RULES = [
  '- **先有感想，再选表达**：像给熟人随手发一条，保留角色此刻最想分享的具体感想。用角色自己的措辞、节奏和分寸，不把所有人写成同一种俏皮或温柔的声音。',
  '- **长短**：遵守本次正文的字数范围，范围内说清就停，不凑字；需要精简时保留关键意思，不为交代背景或强接素材写长。可以省略主语、自然换行，括号和表情按需要使用。不写标题、列表、Markdown、标签或动作旁白。',
  '- **发布形态仅供参考**：不符合角色习惯或会损失意思时可以不用。不要为了形态强塞表情、截断句子或把具体感想削成语气词；这些写法不是待完成的清单。',
  '- 幽默是可选的，可以来自对具体事情的观察、态度或贴切联想，不必每条玩梗、嘴硬或自我拆台。认真时可以认真，没更多想说的就停，不附加套路式追问、劝导或升华。',
  '- 表达对照（仅示范取舍，不是事实或固定台词）：“电费……又没交”保留了具体处境和无奈，不必为语气词形态删成“电费……啊”；“说好只尝一口的”已经有具体意味，不必补成活动汇报。按本角色和本次事实另写，不照抄示例。',
].join('\n');

/** 配图补足同一个瞬间的可见信息；不把短文案、隐喻或话题建议机械翻译成画面。 */
export const MOMENT_IMAGE_RULES = [
  '- **图文互补**：配图呈现同一瞬间，依上下文补足短文案省略的场景；每张只有一个视觉重点，不把夸张比喻画成实物。',
  '- 只写可见的外观、位置、动作、道具和光线，按分享点取景，不默认看镜头摆拍。遵守已知外观及同行者要求，天气通过合理的环境细节体现。',
  '- 下方生图格式与长度限制仅约束 imagePrompt 等配图字段，不约束中文正文；优先保留人物和主要动作，少堆背景。不画无关字幕、水印或社交界面。',
].join('\n');

/** 仅供抽中做梦/幻想的候选分支使用；是否采纳仍由当前日程决定。 */
export const MOMENT_DREAM_IMAGE_RULES = [
  '- **梦境配图（仅在采纳做梦/幻想动因后生效）**：每个 imagePrompt 都必须以 "A surreal dreamscape scene:" 开头，直接描绘正文中梦内的场景，不画现实中躺床睡觉的人，也不只在普通生活照末尾加 dreamy 标签。未采纳梦境时完全忽略本条，正常记录日程，不添加梦境前缀或梦幻效果。',
  '- **可见的超现实意象**：围绕梦里同一个核心事件，具体写出至少两处相互关联的非现实变化，例如失重漂浮、巨大与微小的尺度反差、物体变成光或星屑、不可能的空间连接；写清什么在何处如何变化及角色的互动，不能只罗列 surreal / magical 等形容词。意象从角色人设和这场梦生长，不照抄示例或堆砌无关奇观。',
  '- **梦幻光影**：用自然英文写明 ethereal soft lighting、hazy magical glow 或同义的可见光影表现，并结合梦的情绪选择柔和渐变色、微光粒子、发光边缘等具体细节，营造 dreamlike atmosphere；噩梦可用冷色、异样阴影与幽光，不强行甜美。保持人物和主体动作清楚。',
  '- **梦内画面优先**：采纳后，现实时间、天气和 Environment reference 只约束醒着时的叙述，不覆盖梦内的天空、光线、空间和尺度；通用的“不把夸张比喻画成实物”不限制正文明确发生的梦内超现实事件。仍须保留角色辨识特征、生效外观和指定同行者，遵守生图格式与长度限制。多图共享同一梦境的意象、色调和光线，只推进相邻瞬间。',
].join('\n');

export const MOMENT_DREAM_IMAGE_REQUIREMENT = '若采纳做梦/幻想动因，以 A surreal dreamscape scene: 开头，描述正文梦内场景、至少两处关联的超现实变化及梦幻光影；若未采纳，正常描绘当前日程，不加梦境前缀或效果';

/** 随机抽中的话题提供动因；与日程的主次由本次内容主次决定，
 * 这里只给候选内容，不再复述规则，避免 user 层与 system 层口径打架。 */
export function buildMomentMotiveDirective(description) {
  const topic = String(description || '').trim();
  if (!topic) return '';
  return `\n**【本次发朋友圈动因】${topic}**`;
}

/** 用户话题始终以动因为主；系统随机话题在有日程时等概率确定主次。
 * 显式点题（含报纸任务）保留围绕指定话题生成的语义，不再随机弱化它。 */
export function pickMomentFocus({ hasSchedule, hasMotive, topicSource = 'default', explicitTopic = false, random = Math.random }) {
  if (!hasMotive) return hasSchedule ? 'schedule' : 'free';
  if (!hasSchedule || explicitTopic || topicSource === 'custom') return 'motive';
  return random() < 0.5 ? 'schedule' : 'motive';
}

export function buildMomentFocusDirective(focus) {
  if (focus === 'schedule') return '\n**【本次内容主次】日程为主，动因为弱参考；动因不自然相关就忽略，不必将两者串联。**';
  if (focus === 'motive') return '\n**【本次内容主次】动因为主，简要日程仅作低优先级背景；正文可以不提日程，不必交代两者的联系。**';
  return '';
}

/** 日程告知此刻真实地点与正在做的事；这里只给事实，主次规则
 * 由 MOMENT_SINGLE_FOCUS_RULE 规定，不再复述规则，避免 user 层与 system 层口径打架。 */
export function buildMomentScheduleContext(characterName, activity = {}, { includeDescription = true } = {}) {
  const name = String(characterName || '').trim();
  const doing = [String(activity.location || '').trim(), String(activity.activity || '').trim()]
    .filter(Boolean).join('');
  const description = includeDescription ? String(activity.description || '').trim() : '';
  if (!name || !doing) return '';
  const descPart = description ? `（${description}）` : '';
  return `\n**【此刻正在做】${name}此刻正在${doing}${descPart}**`;
}

/** 已入账经历等记录量可能很大，必须防止模型逐条总结、变成多主题流水账。 */
export const MOMENT_RECORD_BACKDROP_RULE = '下面的经历/动态只是背景素材：最多选取一条能补充唯一主线的细节，禁止逐条概括、把多条并列成多个重点，也不得为了塞素材而另写一段；都与主线无关就全部忽略。';

export const MOMENT_IMAGE_COUNT_DIST = [
  { count: 1, weight: 0.70 },
  { count: 2, weight: 0.20 },
  { count: 3, weight: 0.10 },
];
export const MOMENT_IMAGE_FIELDS = ['imagePrompt', 'imagePrompt2', 'imagePrompt3'];
export const CHINESE_NUM = ['', '一', '两', '三'];

/** 用合法 JSON 展示完整字段结构，动态文本中的引号、换行、反斜杠不能破坏示例。 */
export function buildMomentOutputFormat({ imageCount = 1, textRequirement = '中文口语，只围绕一个具体中心，用角色自己的语气表达', textLength = '30-160字', imageRequirement = '' } = {}) {
  if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > MOMENT_IMAGE_FIELDS.length) {
    throw new RangeError('Moment image count must be an integer from 1 to 3');
  }
  const example = {
    text: `朋友圈正文：${textRequirement}；字数范围：${textLength}，不凑字；形态仅供参考，保留关键意思；非空，可只有表情，无标题`,
  };
  for (const [index, name] of MOMENT_IMAGE_FIELDS.slice(0, imageCount).entries()) {
    example[name] = `第${index + 1}张照片：非空英文单段，独立写清场景、主体动作和光线，遵守生图格式及长度限制${index > 0 ? '；与首图连续，不写同上' : ''}${imageRequirement ? `；${imageRequirement}` : ''}`;
  }
  return `输出格式（严格 JSON）：\n${JSON.stringify(example)}\n严格按示例字段输出，所有值为字符串并正确转义，不加字段或 JSON 以外的文字。`;
}

export function pickMomentImageCount() {
  let roll = Math.random() * MOMENT_IMAGE_COUNT_DIST.reduce((sum, i) => sum + i.weight, 0);
  for (const item of MOMENT_IMAGE_COUNT_DIST) {
    roll -= item.weight;
    if (roll <= 0) return item.count;
  }
  return 1;
}

export function weightedPick(arr, weightMap = {}) {
  const items = arr.map(item => ({ item, weight: weightMap[item.name] || 1.0 }));
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const { item, weight } of items) {
    rand -= weight;
    if (rand <= 0) return item;
  }
  return items[items.length - 1].item;
}

/** 多图朋友圈共用一条连续帧规则：所有帧共享锚点，只推进同一经历，不另开素材。 */
export function buildMomentMultiImageRule(imageCount) {
  if (!Number.isInteger(imageCount) || imageCount <= 1) return '';
  const fields = MOMENT_IMAGE_FIELDS.slice(0, imageCount).join('、');
  const sequence = imageCount === 2
    ? '- 第 1 张建立场景，第 2 张推进到细节或反应，可只换机位。'
    : '- 第 1 张建立场景，第 2 张推进到细节，第 3 张收束到反应；不必编完整故事。';
  return `- ${fields} 是同一段连续经历里的${CHINESE_NUM[imageCount]}帧，沿用同一组连续性锚点：人物、地点、服装、道具和光线。
${sequence}
- 每张独立写全，只换景别、机位或相邻动作；禁止换活动、换地点或造型，不写“同上”，不做拼贴。`;
}

/** 朋友圈评论区通用规则：角色帖与镇民帖、首评/回评/续评共用，避免各处模板各自演化。 */
export const MOMENT_COMMENT_RULES = [
  '- **长度**：以 3~50 字短评为主，偶尔可以长一点到 80 字左右；短到只回一个 emoji、"哈哈哈"、"？？？"、"行吧"也算完整的一条评论，不必凑字数。',
  '- 自然口语化，像熟人刷朋友圈时随口打的字：可以省略主语、可以只有半句话、可以连发两个短句。',
  '- 可以调侃、抬杠、拆台、接梗、追问细节、@ 对方，也可以只是附和一声；不要每条都温柔客套，也不要空洞地夸"好棒""真好看"。',
  '- 不机械复述帖子，不套用“点赞+点评”、总结升华或通用祝福；确实有值得祝贺或关心的事，可以按角色和关系自然表达。',
  '- 有趣与否由人设和场合决定，不必每条调侃或追问；对方认真时先接住内容，不强加笑点，回应完可以停。',
  '- 保持你自身的人设、语气和口癖；不用刻意称呼对方名字，熟人之间不需要每句都叫。',
  '- 禁止括号里的动作描写（如（笑）（点头））和旁白，禁止解释自己在评论什么。',
  '- 只输出评论/回复的文本本身，不要任何前缀、引号、JSON 或说明。',
].join('\n');

/** 评论侧取帖子首张配图的画面描述：帖子落库的 prompt 多图用 `\n---\n` 拼接，
 * 评论只需要第一张；无 prompt（用户手发帖 / 未落提示词）返回空串，不注入默认兜底词。 */
export function firstMomentImagePrompt(prompt) {
  if (!prompt) return '';
  const segments = String(prompt).split(/\n?\s*---\s*\n?/).map(s => s.trim()).filter(Boolean);
  return segments[0] || '';
}

/** 评论 prompt 的配图说明段：帮角色理解照片里是什么，从而把图聊进评论里。 */
export function buildMomentImagePromptNote(prompt) {
  const first = firstMomentImagePrompt(prompt);
  if (!first) return '';
  return `\n配图的画面描述（帮你理解照片里是什么，评论时可以自然提到照片内容）：${first}`;
}
