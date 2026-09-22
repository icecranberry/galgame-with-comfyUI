/** 朋友圈发布形态池、单中心提示规则与配图工具——角色发帖（routes/moments.js）与镇民发帖
 * （services/town/townNpcMomentGenerator.js）共用，避免两端口径漂移。 */

export const MOMENT_FORMS = [
  { name: '短句流',  desc: '只留一句最想说的话，省略背景', len: '5-20字', weight: 2.0, nightBoost: false },
  { name: '纯图党',  desc: '用 1～3 个 emoji 或极短一句回应照片，不复述画面', len: '1-15字', weight: 0.5, nightBoost: true },
  { name: '括号吐槽', desc: '短正文加一处括号，补同一件事的内心OS或自我拆台', len: '15-45字', weight: 0.8, nightBoost: false },
  { name: '发疯文学', desc: '对眼前的小刺激夸张反应，保留角色口吻，不堆砌标点', len: '10-45字', weight: 0.5, nightBoost: false },
  { name: '抛个问题', desc: '整条就是一个具体问题或求助，带够场景让人能回答；禁止"有没有人懂这种感觉"这类空泛句式', len: '15-45字', weight: 0.9, nightBoost: false },
  { name: '颜文字体', desc: '一个颜文字，可配一句极短的话', len: '1-20字', weight: 1.4, nightBoost: true },
  { name: '只发个语气词', desc: '只有几个语气词或一个 emoji，不解释，场景交给照片', len: '1-12字', weight: 0.2, nightBoost: true },
  { name: '话说一半', desc: '停在一个念头上，可用省略号，不补解释', len: '5-30字', weight: 0.8, nightBoost: false },
];

/** text 必须具备单一中心；同时给出的日程与发圈动因应合并成同一条主线。 */
export const MOMENT_SINGLE_FOCUS_RULE = [
  '- **单中心（最高优先级）**：日程确定地点和活动，动因决定关注什么、为何想发；两者落在同一个细节或互动上，不先汇报日程再另聊动因。无日程时由动因确定场景。',
  '- 动因中的场景及配图建议不是既成事实。与日程冲突时，保留其相容的关注点或分享欲，不换地点、虚构经历，也不靠回忆或比喻硬接。',
  '- 日程和动因不必都明说：照片交代现场，文字留下一个反应；其他经历、旧动态只作背景，不另开主题。',
].join('\n');

/** 朋友圈口吻总纲：朋友圈是随手一发的生活碎片，不是成文的作品。角色帖与镇民帖共用。 */
export const MOMENT_TONE_RULES = [
  '- **口吻优先于字数**：像给熟人随手发一条，用角色自己的语气写具体反应，可省略主语、只说半句，不凑字数或强行玩梗。',
  '- 通常 1～2 个短句、至多一次换行；括号只作口语补充，表情适量。不写标题、列表、Markdown、标签或动作旁白。',
  '- 写完就停，不铺背景、不解释心情，不加总结、感悟、祝福或种草套话。',
].join('\n');

/** 配图补足同一个瞬间的可见信息；不把短文案、隐喻或话题建议机械翻译成画面。 */
export const MOMENT_IMAGE_RULES = [
  '- **图文互补**：配图呈现同一瞬间，依上下文补足短文案省略的场景；每张只有一个视觉重点，不把夸张比喻画成实物。',
  '- 只写可见的外观、位置、动作、道具和光线，按分享点取景，不默认看镜头摆拍。遵守已知外观及同行者要求，天气通过合理的环境细节体现。',
  '- 遵循下方生图格式与长度限制；优先保留人物和主要动作，少堆背景。不画无关字幕、水印或社交界面。',
].join('\n');

/** 随机抽中的话题作为发圈动因；与【此刻正在做】如何合成一条主线由 MOMENT_SINGLE_FOCUS_RULE 规定，
 * 这里只给事实，不再复述规则，避免 user 层与 system 层口径打架。 */
export function buildMomentMotiveDirective(description) {
  const topic = String(description || '').trim();
  if (!topic) return '';
  return `\n**【本次发圈动因】${topic}**`;
}

/** 日程告知此刻真实地点与正在做的事；这里只给事实，如何与发圈动因合成一条主线
 * 由 MOMENT_SINGLE_FOCUS_RULE 规定，不再复述规则，避免 user 层与 system 层口径打架。 */
export function buildMomentScheduleContext(characterName, activity = {}) {
  const name = String(characterName || '').trim();
  const doing = [String(activity.location || '').trim(), String(activity.activity || '').trim()]
    .filter(Boolean).join('');
  const description = String(activity.description || '').trim();
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
export function buildMomentOutputFormat({ imageCount = 1, textRequirement = '中文口语，只围绕一个具体中心，写角色的随口反应' } = {}) {
  if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > MOMENT_IMAGE_FIELDS.length) {
    throw new RangeError('Moment image count must be an integer from 1 to 3');
  }
  const example = {
    text: `朋友圈正文：${textRequirement}；按本次形态与字数，非空，可只有表情，无标题或总结`,
  };
  for (const [index, name] of MOMENT_IMAGE_FIELDS.slice(0, imageCount).entries()) {
    example[name] = `第${index + 1}张照片：非空英文单段，独立写清场景、主体动作和光线，遵守生图格式及长度限制${index > 0 ? '；与首图连续，不写同上' : ''}`;
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
  '- **长度**：以 3~25 字短评为主，偶尔可以长一点到 40 字左右；短到只回一个 emoji、"哈哈哈"、"？？？"、"行吧"也算完整的一条评论，不必凑字数。',
  '- 自然口语化，像熟人刷朋友圈时随口打的字：可以省略主语、可以只有半句话、可以连发两个短句。',
  '- 可以调侃、抬杠、拆台、接梗、追问细节、@ 对方，也可以只是附和一声；不要每条都温柔客套，也不要空洞地夸"好棒""真好看"。',
  '- 禁止客套式的总结、升华、祝福和"点赞+点评"套路；禁止复述对方刚说过的话。',
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
