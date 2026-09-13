/** 朋友圈发布形态池、单中心提示规则与配图工具——角色发帖（routes/moments.js）与镇民发帖
 * （services/town/townNpcMomentGenerator.js）共用，避免两端口径漂移。 */

export const MOMENT_FORMS = [
  { name: '短句流', desc: '一句话说清楚，极简不解释', len: '5-20字', weight: 0.8, nightBoost: false },
  { name: '碎碎念', desc: '围绕同一件小事写两三行短句，想到哪说到哪，像随手记', len: '20-60字', weight: 1.2, nightBoost: false },
  { name: '纯图党', desc: '文字只用 0-3 个 emoji 加上极短一句，主要靠图说话', len: '0-10字', weight: 0.6, nightBoost: true },
  { name: '括号吐槽', desc: '正文加一句括号里的内心OS或吐槽', len: '30-80字', weight: 1.0, nightBoost: false },
  { name: '自言自语', desc: '像没写完的心里话，带点欲言又止', len: '10-40字', weight: 1.0, nightBoost: true },
  { name: '冷幽默', desc: '一句或几句自嘲冷幽默，结尾抖个小包袱', len: '15-50字', weight: 0.7, nightBoost: false },
  { name: '清单体', desc: '围绕同一件事或同一个主题把细节逐条列出来，条目感强，不要混入另一件事', len: '30-100字', weight: 0.7, nightBoost: false },
  { name: '发疯文学', desc: '语气夸张、情绪上头的无厘头输出，标点和语气词拉满', len: '20-80字', weight: 0.6, nightBoost: false },
];

/** text 必须具备单一中心；同时给出的日程与发圈动因应合并成同一条主线。 */
export const MOMENT_SINGLE_FOCUS_RULE = [
  '- **单中心（最高优先级）**：text 只能围绕一段连续发生的经历、一件具体的事或一种情绪展开，开头选定后不再转移到另一件事。',
  '- 当同时给出【此刻正在做】和【本次发圈动因】时，它们是这条主线的两个同等重要的构成条件，不是两个重点：必须让它们在同一场景或同一段连续经历里共同成立，并在因果或细节上自然衔接。',
  '- 可以补充同一场景里的内心OS、吐槽、感官细节和结果；禁止把日程、经历、旧动态、世界观分别写成几个独立段落，也禁止用“另外、再说、其实我还发现、顺便”另起第二件事。',
].join('\n');

/** 随机抽中的话题作为发圈动因，与日程中的此刻场景共同构成主线，不能二者择一。 */
export function buildMomentMotiveDirective(description) {
  const topic = String(description || '').trim();
  if (!topic) return '';
  return `\n**【本次发圈动因（与此刻正在做同等重要）】你是正在做或想到这件事：【${topic}】。它不是独立段落，必须被放进【此刻正在做】真实发生的同一场景或同一段连续经历里，成为这趟经历的一部分。**`;
}

/** 日程告知此刻真实地点与正在做的事；与发圈动因同等重要，不能被合理化改写。 */
export function buildMomentScheduleContext(characterName, activity = {}) {
  const name = String(characterName || '').trim();
  const doing = [String(activity.location || '').trim(), String(activity.activity || '').trim()]
    .filter(Boolean).join('');
  const description = String(activity.description || '').trim();
  if (!name || !doing) return '';
  const descPart = description ? `（${description}）` : '';
  return `\n**【此刻正在做（与本次发圈动因同等重要）】${name}此刻正在${doing}${descPart}。它规定了这条朋友圈真实发生的场所和正在进行的事：正文必须保留它，并让它与【本次发圈动因】在同一段连续经历里产生自然联系；不要为了贴合动因而把地点或活动改成另一个，也不要在文末单独补一句汇报。**`;
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
