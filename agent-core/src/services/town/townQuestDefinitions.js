import { townError } from './townEventService.js';

const TIMING = Object.freeze({ offerMs: 30 * 60000, deadlineMs: 4 * 3600000, cooldownMs: 2 * 3600000 });

export const QUEST_STEP_TYPES = Object.freeze(['goto', 'service', 'deliver', 'wait']);
export const QUEST_TRIGGER_TYPES = Object.freeze(['board', 'venue', 'npc']);
export const QUEST_PAYER_TYPES = Object.freeze(['venue', 'fund']);

function step(step) {
  if (!step || !QUEST_STEP_TYPES.includes(step.type) || typeof step.key !== 'string' || !step.key
    || typeof step.label !== 'string' || !step.label) throw townError('INVALID_QUEST_STEP');
  if (step.type === 'goto' && typeof step.locationKey !== 'string') throw townError('INVALID_QUEST_STEP');
  if (step.type === 'service' && typeof step.serviceKey !== 'string') throw townError('INVALID_QUEST_STEP');
  if (step.type === 'wait' && !Number.isSafeInteger(step.waitMs)) throw townError('INVALID_QUEST_STEP');
  if (step.type === 'deliver') {
    if (typeof step.templateId !== 'string' || !Number.isSafeInteger(step.count) || step.count < 1
      || typeof step.locationKey !== 'string') throw townError('INVALID_QUEST_STEP');
  }
  return Object.freeze({ hint: '', ...step });
}

function template(template) {
  if (typeof template.id !== 'string' || !template.id || template.version !== 1) throw townError('INVALID_QUEST_TEMPLATE');
  if (typeof template.title !== 'string' || !template.title || typeof template.intro !== 'string') throw townError('INVALID_QUEST_TEMPLATE');
  if (!template.trigger || !QUEST_TRIGGER_TYPES.includes(template.trigger.type)) throw townError('INVALID_QUEST_TEMPLATE');
  if (template.trigger.type === 'venue' && typeof template.trigger.key !== 'string') throw townError('INVALID_QUEST_TEMPLATE');
  if (!template.payer || !QUEST_PAYER_TYPES.includes(template.payer.type)) throw townError('INVALID_QUEST_TEMPLATE');
  if (template.payer.type === 'venue' && typeof template.payer.businessKey !== 'string') throw townError('INVALID_QUEST_TEMPLATE');
  if (!Array.isArray(template.steps) || !template.steps.length) throw townError('INVALID_QUEST_TEMPLATE');
  const rewards = template.rewards ?? {};
  if (!Number.isSafeInteger(rewards.coins) || rewards.coins < 0) throw townError('INVALID_QUEST_TEMPLATE');
  if (template.minRegularTier != null && (!Number.isSafeInteger(template.minRegularTier) || template.minRegularTier < 0)) throw townError('INVALID_QUEST_TEMPLATE');
  return Object.freeze({
    offerMs: TIMING.offerMs, deadlineMs: TIMING.deadlineMs, cooldownMs: TIMING.cooldownMs,
    repeatable: false, minRegularTier: null,
    ...template,
    rewards: Object.freeze({ coins: rewards.coins, items: Object.freeze((rewards.items ?? []).map(item => Object.freeze({ ...item }))) }),
    steps: Object.freeze(template.steps.map(step)),
    trigger: Object.freeze({ ...template.trigger }),
    payer: Object.freeze({ ...template.payer }),
  });
}

/** 奇遇任务目录。新增一条奇遇＝在这里加一份声明；引擎、账本、经历、前端面板都按声明工作。
 * 步骤校验只在服务端：goto 用与 walkToSpot 同源的到场口径，service 查正式结算回执，
 * deliver 校验背包归属并当场收走物品，wait 只看时间。
 * minRegularTier：需要玩家在 trigger.venue 拥有至少该档熟客等级（town_venue_regulars）才会出现。
 */
export const QUEST_TEMPLATES = Object.freeze({
  // ── 建筑线：每座功能建筑至少一条本地奇遇 ──
  // 酒馆：晚市人手不足，打一班工领额外赏钱（净 +38：工资 26 + 赏钱 12）。
  'quest.tavern.busy_night': template({
    id: 'quest.tavern.busy_night', version: 1,
    title: '酒馆的忙夜', intro: '掌柜正为晚市发愁，人手明显不够。去搭把手，事后少不了你的好处。',
    trigger: Object.freeze({ type: 'venue', key: 'tavern' }),
    payer: Object.freeze({ type: 'venue', businessKey: 'tavern' }),
    repeatable: true,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'tavern', label: '走到镇口酒馆', hint: '到店才算接下这单。' }),
      step({ key: 'shift', type: 'service', serviceKey: 'town.tavern.shift', label: '替酒馆当一班工', hint: '在酒馆接一单「当班」并完成结算。' })],
    rewards: { coins: 12, items: [] },
  }),
  // 酒馆熟客线（熟客 1 档 / 3 次消费解锁）：帮工换的饭替掌柜捎给公告站（净 +18，不花钱）。
  'quest.tavern.regular_round': template({
    id: 'quest.tavern.regular_round', version: 1,
    title: '熟客的差事', intro: '掌柜认得你了，托你把一份热食捎去公告站给值夜的镇公所职员——帮工换饭正好用上。',
    trigger: Object.freeze({ type: 'venue', key: 'tavern' }),
    payer: Object.freeze({ type: 'venue', businessKey: 'tavern' }),
    repeatable: true, minRegularTier: 1,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'tavern', label: '到镇口酒馆帮一班工', hint: '用「帮工换一份酒食」换出热食。' }),
      step({ key: 'meal', type: 'service', serviceKey: 'town.tavern.help_swap', label: '帮工换出一份热食', hint: '不领工钱，换走一份热食。' }),
      step({ key: 'hand_in', type: 'deliver', templateId: 'town.tavern_meal', templateVersion: 1, count: 1,
        locationKey: 'board', label: '把热食捎到公告站', hint: '热食到手后走到公告站交货。' })],
    rewards: { coins: 18, items: [] },
  }),
  // 裁缝铺：打一班工的额外赏钱（净 +32）。
  'quest.clothing.pincushion': template({
    id: 'quest.clothing.pincushion', version: 1,
    title: '裁缝铺的赶工日', intro: '铺子里积了三件改袖口的活。搭把手理理布匹，掌柜额外封一份谢仪。',
    trigger: Object.freeze({ type: 'venue', key: 'clothing_shop' }),
    payer: Object.freeze({ type: 'venue', businessKey: 'clothing_shop' }),
    repeatable: true,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'clothing_shop', label: '走到临街裁缝铺', hint: '到店才算接下这单。' }),
      step({ key: 'shift', type: 'service', serviceKey: 'town.clothing.shift', label: '在裁缝铺帮一班工', hint: '接「裁缝铺帮工」并完成结算。' })],
    rewards: { coins: 10, items: [] },
  }),
  // 客栈：替远客先踩点投宿（净 -2 + 醒神茶；买体验送道具）。
  'quest.inn.turned_down': template({
    id: 'quest.inn.turned_down', version: 1,
    title: '替朋友踩点客栈', intro: '一位要来的旅人托邻居打听客栈好坏。你干脆自己投宿一回，把醒神茶捎回来作证。',
    trigger: Object.freeze({ type: 'venue', key: 'inn' }),
    payer: Object.freeze({ type: 'venue', businessKey: 'inn' }),
    repeatable: true,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'inn', label: '走到镇东客栈', hint: '投宿要在店里办。' }),
      step({ key: 'stay', type: 'service', serviceKey: 'town.inn.stay', label: '投宿歇脚一回', hint: '付房钱、歇够了退房，带走醒神茶。' })],
    rewards: { coins: 14, items: [] },
  }),
  // 书斋：晒纸理书的零活（净 +30）。
  'quest.study.ink_helper': template({
    id: 'quest.study.ink_helper', version: 1,
    title: '书斋的晒纸天', intro: '今儿日头好，先生要把积了一橱的纸墨搬出来晒。来搭把手，束脩之外再给你算一份工钱。',
    trigger: Object.freeze({ type: 'venue', key: 'study' }),
    payer: Object.freeze({ type: 'venue', businessKey: 'study' }),
    repeatable: true,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'study', label: '走到街尾书斋', hint: '到店才算接下这单。' }),
      step({ key: 'shift', type: 'service', serviceKey: 'town.study.shift', label: '在书斋帮一班工', hint: '接「书斋帮工」并完成结算。' })],
    rewards: { coins: 10, items: [] },
  }),
  // 咖啡馆：常客挑战（净 +2 + 手冲的体验）。
  'quest.cafe.cup_count': template({
    id: 'quest.cafe.cup_count', version: 1,
    title: '咖啡馆的第一杯', intro: '咖啡师想听听镇上人对新豆子的看法。去点一杯手冲，认真喝完，咖啡师替你付一半。',
    trigger: Object.freeze({ type: 'venue', key: 'cafe' }),
    payer: Object.freeze({ type: 'venue', businessKey: 'cafe' }),
    repeatable: true,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'cafe', label: '走到咖啡馆', hint: '咖啡要到店里点。' }),
      step({ key: 'coffee', type: 'service', serviceKey: 'town.cafe.drink_coffee', label: '点一杯手冲咖啡', hint: '按店里价格付费。' })],
    rewards: { coins: 20, items: [] },
  }),
  // ── 公告站线 ──
  // 公告站跑腿：买热食送回公告站（净 +8）。
  'quest.board.hot_meal_run': template({
    id: 'quest.board.hot_meal_run', version: 1,
    title: '一份热食的跑腿', intro: '公告站替镇公所收货：从酒馆带一份现做的热食回来，验货后付跑腿钱。',
    trigger: Object.freeze({ type: 'board' }),
    payer: Object.freeze({ type: 'fund' }),
    repeatable: true,
    steps: [step({ key: 'buy', type: 'goto', locationKey: 'tavern', label: '到镇口酒馆点一份热食', hint: '在酒馆用「点一份热食」买下成品。' }),
      step({ key: 'meal', type: 'service', serviceKey: 'town.tavern.buy_meal', label: '买下这份热食', hint: '确认后成品会直接放进背包。' }),
      step({ key: 'hand_in', type: 'deliver', templateId: 'town.tavern_meal', templateVersion: 1, count: 1,
        locationKey: 'board', label: '把热食带回公告站', hint: '带着热食走到公告站，货到手就当场收走。' })],
    rewards: { coins: 20, items: [] },
  }),
  // 公告站招工：咖啡馆临时人手（净 +34：工资 24 + 赏钱 10）。
  'quest.board.cafe_hand': template({
    id: 'quest.board.cafe_hand', version: 1,
    title: '咖啡馆招临时工', intro: '公告站贴了张告示：咖啡馆这阵子缺人手，去顶一班，工钱之外镇公所再补一份。',
    trigger: Object.freeze({ type: 'board' }),
    payer: Object.freeze({ type: 'fund' }),
    repeatable: true,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'cafe', label: '走到咖啡馆', hint: '临时工要在店里干活。' }),
      step({ key: 'shift', type: 'service', serviceKey: 'town.cafe.work_shift', label: '在咖啡馆顶一班', hint: '接「临时代班」并完成结算。' })],
    rewards: { coins: 10, items: [] },
  }),
  // ── NPC 线（quest_giver 功能点按人轮派）──
  'quest.npc.first_favor': template({
    id: 'quest.npc.first_favor', version: 1,
    title: '邻里的托付', intro: '一位邻居想喝镇上咖啡馆的手冲咖啡，可自己实在走不开。替他捎一杯，顺便替你留了份谢礼。',
    trigger: Object.freeze({ type: 'npc' }),
    payer: Object.freeze({ type: 'fund' }),
    repeatable: true,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'cafe', label: '走到咖啡馆', hint: '咖啡要到店里现买。' }),
      step({ key: 'coffee', type: 'service', serviceKey: 'town.cafe.drink_coffee', label: '点一杯手冲咖啡', hint: '确认后按店里价格付费，咖啡入账。' })],
    rewards: { coins: 20, items: [{ templateId: 'town.mood_patch', templateVersion: 1, count: 1 }] },
  }),
  // 替不识字的朋友学一手（净 +2 + 手抄小笺）。
  'quest.npc.study_letter': template({
    id: 'quest.npc.study_letter', version: 1,
    title: '代笔的先生', intro: '邻居想给远方的亲人写封信，可自己不识字。替他去书斋学一手，抄成一页带回来。',
    trigger: Object.freeze({ type: 'npc' }),
    payer: Object.freeze({ type: 'fund' }),
    repeatable: true,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'study', label: '走到街尾书斋', hint: '学艺要当面向先生求。' }),
      step({ key: 'lesson', type: 'service', serviceKey: 'town.study.lesson', label: '跟着先生学一手', hint: '付束脩、做完手作，成品归你。' })],
    rewards: { coins: 16, items: [] },
  }),
  // 陪胆小的邻居去定做衣裳（净 -10 + 定做浴衣，物件价值 22）。
  'quest.npc.tailor_moral': template({
    id: 'quest.npc.tailor_moral', version: 1,
    title: '壮胆的陪伴', intro: '邻居攒了半年的钱想做一身新衣裳，又一个人不敢进店。陪她去定做，掌柜看在两个人份上让了点工钱。',
    trigger: Object.freeze({ type: 'npc' }),
    payer: Object.freeze({ type: 'fund' }),
    repeatable: true,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'clothing_shop', label: '陪邻居走到裁缝铺', hint: '定做要在店里量体。' }),
      step({ key: 'order', type: 'service', serviceKey: 'town.clothing.custom_order', label: '定做一身衣裳', hint: '付工费、选好样式，成品归你。' })],
    rewards: { coins: 12, items: [] },
  }),
  // 替赶路的邻居先试试客栈（净 -4 + 醒神茶）。
  'quest.npc.warm_stay': template({
    id: 'quest.npc.warm_stay', version: 1,
    title: '远客的行李', intro: '邻居的亲戚这几日要来投宿，先替他去客栈问一晚价钱——掌柜说，住过才知道好坏。',
    trigger: Object.freeze({ type: 'npc' }),
    payer: Object.freeze({ type: 'fund' }),
    repeatable: true,
    steps: [step({ key: 'arrive', type: 'goto', locationKey: 'inn', label: '走到镇东客栈', hint: '投宿要在店里办。' }),
      step({ key: 'stay', type: 'service', serviceKey: 'town.inn.stay', label: '替亲戚投宿一回', hint: '付房钱、歇够了退房。' })],
    rewards: { coins: 12, items: [] },
  }),
});

/** 模块加载即校验全部声明，坏内容在启动期暴露而不是接到玩家才炸。 */
for (const entry of Object.values(QUEST_TEMPLATES)) {
  if (QUEST_TEMPLATES[entry.id] !== entry) throw townError('INVALID_QUEST_TEMPLATE');
}

export function getQuestTemplate(id) { return QUEST_TEMPLATES[id] ?? null; }
export function questTemplateList() { return Object.values(QUEST_TEMPLATES); }
export function requireQuestTemplate(id) {
  const found = getQuestTemplate(id);
  if (!found) throw townError('INVALID_QUEST_TEMPLATE');
  return found;
}
