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

/** 图文以当前日程为单一中心；动因只在非常契合日程时作为弱参考。 */
export const MOMENT_SINGLE_FOCUS_RULE = [
  '- **单中心、日程优先（最高优先级）**：有【此刻正在做】时，先从当前日程本身选一个具体细节或互动作为唯一主线，text 与所有 imagePrompt 都围绕它；日程决定地点、活动和分享重点。',
  '- **动因仅作弱参考**：【本次发朋友圈动因】不是必须完成的话题。只有它与当前日程非常契合、无需添加额外事件或转移重点就能自然成立时，才允许轻微影响语气或同一细节的表达；即使采纳，日程仍是主体。仅仅不冲突、勉强能联想，不算非常契合。',
  '- 动因不够契合或无法确定是否契合时，完全忽略它及其场景、情绪、配图建议，直接记录当前日程；不要保留其关注点或分享欲，不为动因改换地点、活动、虚构经历，也不靠回忆、比喻或额外道具硬接。不要在正文解释取舍。',
  '- 照片交代日程现场，文字留下一个反应，不必复述日程或点明动因；其他经历、旧动态只作背景，不另开主题。未提供当前日程时，才可参考动因选取符合人设与已知事实的单一场景。',
  // ★ 实测问题：日程描述本身是「小场景写法」（常常逐字照抄了世界观「人们的行为」里的例句），
  //   朋友圈若照它的措辞写，就会产出「报数报到三十七了，锅还没凉呢～」这种复读式文案。
  //   ⚠ 这里**刻意不列举**被禁的词——列举等于把这些词"喂"给模型（负向 priming），
  //     实测点名「报数」之后模型反而更爱用「报数」。只给原则，不给词表。
  '- **日程描述只是背景事实，不要照抄它的措辞**：【此刻正在做】告诉你她人在哪、在干什么就够；',
  '  写文案时用**你自己的口语**重新说一遍当下的反应。凡是听起来像在复述某段场景描写的词句，一律换掉或删掉。',
].join('\n');

/**
 * ★ 说人话总纲（主帖 / 评论 / 回复三处共用的最高优先级口吻约束）
 *
 * 为什么单独立一条：实测出现过「锅比我会撑，你比我敢写」「报数报到三十七了，锅还没凉呢～」
 * 这类文案 —— 问题不是信息错，而是**根本不像人说的话**：
 *   ① 对仗 + 拟人 + 押韵（文学修辞），真人聊天不会这么讲；
 *   ② 直接把 <world_setting>「人们的行为」里的例句词搬进文案，像在复读设定集。
 *
 * ⚠ 关键经验：**不要把被禁的词列出来**。第一版把「报数」「锅还开着」当反例写进规则，
 *   结果是负向 priming —— 模型照着规则里的词复读了。这一版只给"原则 + 语感对照"，
 *   反例一律只描述**形态**（"把两件不相干的事凑成一句工整的话"），不给具体词。
 */
export const MOMENT_HUMAN_TONE_RULE = [
  '## 说人话（最高优先级，先过这一条再写别的）',
  '',
  '### 一、不搬设定（别当复读机）',
  '- <world_setting>是世界的**空气**，不是你的**台词**。它描述这个世界平时是什么样，**不是给你抄的句子库**。',
  '- 文案里不许出现"设定文案腔"：凡是读起来像在**向读者介绍这个世界**、或者像在**复述某段场景描写**的词句，删掉。',
  '- 换个说法复述同一件事也算复读（同一个梗换动词、换量词，仍然是复读）。',
  '- 代入感来自"她本来就活在这里"：她不会解释什么叫"被看见"，就像你不会在朋友圈解释什么叫"上班"。',
  '- 只写**她此刻自己的一点具体感受或动作**；现场长什么样，交给配图去说。',
  '',
  '### 二、不写"文学腔"',
  '- 不要对仗、拟人、比喻、押韵、双关；不要在句尾接一个漂亮的收束。',
  '  ✗ 反面形态：把两件不相干的事硬凑成一句工整的、带点哲理的话。',
  '  ✓ 正面语感：「累死了，谁懂」「行吧，你赢了」「哈哈哈真的假的」「我服了」「懒得动，先躺会儿」。',
  '- 真人发朋友圈不"造句"，只是把当下一个念头随手打出来。',
  '',
  '### 三、交付前自检（逐条过，任一不过就重写）',
  '1. 念出声：像不像人在微信上随手打的一行？',
  '2. 句子里有没有哪个词，是只有<world_setting>里才会出现的书面词？有 → 换成人话或删掉。',
  '3. 是不是**只说了一件事**？有没有为了凑对仗、凑排比硬塞进第二件事？',
].join('\n');

/** 朋友圈口吻总纲：朋友圈是随手一发的生活碎片，不是成文的作品。角色帖与镇民帖共用。 */
export const MOMENT_TONE_RULES = [
  MOMENT_HUMAN_TONE_RULE,
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

/** 随机抽中的话题仅作为候选动因；日程优先与契合门槛由 MOMENT_SINGLE_FOCUS_RULE 规定，
 * 这里只给候选内容，不再复述规则，避免 user 层与 system 层口径打架。 */
export function buildMomentMotiveDirective(description) {
  const topic = String(description || '').trim();
  if (!topic) return '';
  return `\n**【本次发朋友圈动因】${topic}**`;
}

/** 日程告知此刻真实地点与正在做的事。
 *
 * ★ 为什么不默认注入 description（A/B 实测，2026-10-04）：
 *   日程 description 是"小场景写法"，**常常逐字照抄 <world_setting>「人们的行为」里的例句**
 *   （例如"锅还开着……有人替她报数，报一下笑一阵"）。把它放进 prompt 之后，LLM 会把这段
 *   现成文字直接改写进朋友圈正文，产出"报数报到三十七了，锅还没凉呢～"这种复读式文案。
 *   对照测试：带 description → 干净 0～1/3；只给 地点+活动 → 干净 2/3（唯一命中还是活动名误报）。
 *   所以这里默认只给"她在哪、在干什么"两个事实，"现场长什么样"交给模型按人设+世界观自己生成。
 *
 *   需要连描述一起给时显式传 `{ withDescription: true }`，并自行确认该描述不含世界观原句。
 *
 * 日程优先规则由 MOMENT_SINGLE_FOCUS_RULE 规定，这里不重复，避免 user 层与 system 层口径打架。
 */
export function buildMomentScheduleContext(characterName, activity = {}, { withDescription = false } = {}) {
  const name = String(characterName || '').trim();
  const doing = [String(activity.location || '').trim(), String(activity.activity || '').trim()]
    .filter(Boolean).join('');
  if (!name || !doing) return '';
  const description = withDescription ? String(activity.description || '').trim() : '';
  const descPart = description
    ? `\n（以下描述只是背景，帮你确认她此刻的处境；写文案时请换成人话，不要沿用它的句式、书面词或比喻。）\n背景：${description}`
    : '';
  return `\n**【此刻正在做】${name}此刻正在${doing}**${descPart}`;
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
  MOMENT_HUMAN_TONE_RULE,
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

// ═══════════════════════════════════════════════════════════
// 世界观裁剪（仅朋友圈/评论链路使用）
// ═══════════════════════════════════════════════════════════
/**
 * <world_setting> 里的「## 人们的行为」是一整列**氛围例句**（十几条非常生动的场景描写）。
 *
 * 实测（A/B，2026-10-04）：把这一段原样喂给朋友圈生成时，LLM 会把它当成
 * "朋友圈该长什么样"的 few-shot 示范，**直接复读其中的措辞**（锅还开着 / 报数 / 坐到底 …）；
 * 而且复读源就是这个 section —— 即使把日程素材里的描述整段剥掉，模型照样复读。
 * 规则层（"不要照抄设定"）压不过上下文里的生动范例，所以必须在**注入层**做手脚。
 *
 * 注意：只处理这一段；「日常规则」「深层逻辑」「区域设定」等**规则性**章节一律保留，
 * 世界观照样生效——朋友圈需要的是"知道什么是正常的"，不需要"背例句"。
 *
 * @param {string} worldSetting 原始 <world_setting> 文本
 * @param {'strip'|'annotate'|'keep'} mode
 *   - strip    ：整段剔除（默认）
 *   - annotate ：保留内容，但在段首插一行"这是氛围不是台词"的警示
 *   - keep     ：原样返回
 */
const WORLD_BEHAVIOR_HEADING_RE = /^#{1,6}\s*人们的行为\s*$/;

export function adaptWorldForMoment(worldSetting, mode = 'strip') {
  const text = String(worldSetting || '');
  if (!text || mode === 'keep') return text;

  const lines = text.split('\n');
  const out = [];
  let skipping = false;
  let found = false;

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      const isBehavior = WORLD_BEHAVIOR_HEADING_RE.test(line.trim());
      if (isBehavior) {
        found = true;
        if (mode === 'annotate') {
          out.push(line, '');
          out.push('> 【氛围参考，不是台词库】以下描述的是这个世界"平时是什么样"，用来理解这里的常态；**写内容时不要引用、复述或改写其中任何一句的措辞**，世界感靠"理所当然"透出来即可。');
          skipping = false;
        } else {
          skipping = true; // strip：标题也不保留
        }
        continue;
      }
      skipping = false;
    }
    if (!skipping) out.push(line);
  }

  if (!found) return text; // 世界观里没有这一节 → 原样返回，不动
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
