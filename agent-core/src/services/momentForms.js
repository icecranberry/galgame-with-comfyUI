/** 朋友圈发布形态池、单中心提示规则与配图工具——角色发帖（routes/moments.js）与镇民发帖
 * （services/town/townNpcMomentGenerator.js）共用，避免两端口径漂移。 */

export const MOMENT_FORMS = [
  { name: '短句流',  desc: '一句话说清楚，极简不解释',                     len: '5-20字',  weight: 2.0, nightBoost: false },
  { name: '纯图党',  desc: '文字只用 0-3 个 emoji 加上极短一句，主要靠图说话', len: '0-15字',  weight: 0.5, nightBoost: true },
  { name: '括号吐槽', desc: '正文加一句括号里的内心OS或吐槽',                len: '20-60字', weight: 0.8, nightBoost: false },
  { name: '发疯文学', desc: '语气夸张、情绪上头的输出，标点和语气词拉满', len: '15-60字', weight: 0.5, nightBoost: false },
  { name: '抛个问题', desc: '整条就是一个具体问题或求助，带够场景让人能回答；禁止"有没有人懂这种感觉"这类空泛句式', len: '15-45字', weight: 0.9, nightBoost: false },
  { name: '颜文字体', desc: '用颜文字或半角符号代替 emoji 表达状态，配一句极短的话', len: '0-20字', weight: 1.4, nightBoost: true },
  { name: '只发个语气词', desc: '整条只有几个语气词或一个 emoji（如「唉」「困了」「？」），不解释、不展开、不交代前因后果', len: '0-12字', weight: 0.2, nightBoost: true },
  { name: '话说一半', desc: '写到一半就停下，像是话到嘴边又懒得说完，可以用省略号收尾', len: '5-30字', weight: 0.8, nightBoost: false },
];

/** text 必须具备单一中心；同时给出的日程与发圈动因应合并成同一条主线。 */
export const MOMENT_SINGLE_FOCUS_RULE = [
  '- **单中心（最高优先级）**：text 只能围绕一件具体的事或一种情绪展开，不要写流水账，要有重点描写。',
  '- 当同时给出【此刻正在做】和【本次发圈动因】时，优先保证【此刻正在做】，如果在因果或细节上【本次发圈动因】可以自然衔接，那就自然衔接，否则只以【此刻正在做】为中心。',
  '- 可以补充同一场景里的内心OS、吐槽、感官细节和结果；禁止把日程、经历、旧动态、世界观分别写成几个独立段落，也禁止用“另外、再说、其实我还发现、顺便”另起第二件事。',
].join('\n');

/** 朋友圈口吻总纲：朋友圈是随手一发的生活碎片，不是成文的作品。角色帖与镇民帖共用。 */
export const MOMENT_TONE_RULES = [
  '- **口吻总纲（优先级高于字数）**：你是在刷朋友圈时顺手发一条，不是写文章、写总结、交作业。写完不用回头检查，也不用交代前因后果——看到的人本来就知道你是谁、在过什么日子。',
  '- **只写一个瞬间**：写此刻正在发生或刚刚发生的这一小下，允许只写半句话、只写一个动作、只冒出一个念头，写完就停。不要起承转合，不要"今天…不过…总之"这种完整叙事。',
  '- **不要升华**：结尾禁止总结感悟、人生道理、心灵鸡汤和"金句"，也不要在末尾补祝福或自我点评。事情写完就结束，不用点题。',
  '- **不要写成小作文或种草文案**：不要铺陈背景、不要排比抒情、不要堆砌心情词，不要"又是元气满满的一天""被治愈了"这类模板句。',
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
    ? '- 第 1 张建立场景和动作的起点；第 2 张推进到动作细节、人物反应、身旁同伴或刚出现的结果。可以换景别或机位，但不跳到另一段时间。'
    : '- 第 1 张建立场景和动作的起点；第 2 张推进到动作中段、互动或关键细节；第 3 张收束到动作结果、特写、反应或合影。三张之间要有可看出的前后推进。';
  return `- **本次要发${CHINESE_NUM[imageCount]}张照片**：${fields} 是同一段连续经历里的${CHINESE_NUM[imageCount]}帧，不是${CHINESE_NUM[imageCount]}个平行素材。先选定一条时间线，每张都完整复述同一组连续性锚点：人物、同伴、地点、关键道具、天气光线、服装和正在发生的事。
${sequence}
- 每张描述仍要独立完整、英文，并贴合 text 写的事；只允许改变镜头距离、角度、拍摄时机或画面主体。禁止换活动、换房间、换时间、换造型，禁止互不相关的摆拍合集，也禁止写"同上"或"参考第一张"。`;
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
