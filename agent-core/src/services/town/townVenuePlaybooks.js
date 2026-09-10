import { townError } from './townEventService.js';

const TIMING = Object.freeze({ maxTurns: 4, idleMs: 5 * 60000, maxDurationMs: 20 * 60000,
  offerMs: 5 * 60000, leaseMs: 15000 });

/** 通用「玩法原型」（playbook）。一个功能建筑挂哪种玩法只由这里的阶段机决定，
 * 换名字、换材料、换产出都不需要新写一份服务引擎。
 *
 * - payer 'venue'：店方把工资托管，完成付给玩家，取消退回店方（打工/帮工）。
 * - payer 'player'：玩家付费托管，完成付给店方，取消全额退回玩家（消费/定制）。
 * - product：完成后向玩家背包发放一件道具；null 表示只结算钱物。
 * - acceptPhase：接受报价后进入的阶段。老咖啡馆固定进 'serving'，定制类先进 'brief'。
 */
export const VENUE_PLAYBOOKS = Object.freeze({
  shift: Object.freeze({ key: 'shift', label: '当班', payer: 'venue', product: null, acceptPhase: 'prep',
    phases: Object.freeze([
      Object.freeze({ key: 'prep', actions: Object.freeze(['work', 'cancel']) }),
      Object.freeze({ key: 'finish', actions: Object.freeze(['serve', 'clarify', 'cancel']) }),
    ]), progressAction: 'work', completeAction: 'serve', noProgressAction: 'clarify', ...TIMING }),
  help_swap: Object.freeze({ key: 'help_swap', label: '帮工换物', payer: 'venue', product: true, acceptPhase: 'prep',
    phases: Object.freeze([
      Object.freeze({ key: 'prep', actions: Object.freeze(['work', 'cancel']) }),
      Object.freeze({ key: 'finish', actions: Object.freeze(['serve', 'clarify', 'cancel']) }),
    ]), progressAction: 'work', completeAction: 'serve', noProgressAction: 'clarify', ...TIMING }),
  custom_order: Object.freeze({ key: 'custom_order', label: '定做', payer: 'player', product: true, acceptPhase: 'brief',
    phases: Object.freeze([
      Object.freeze({ key: 'brief', actions: Object.freeze(['choose_style', 'cancel']) }),
      Object.freeze({ key: 'make', actions: Object.freeze(['craft', 'clarify', 'cancel']) }),
    ]), progressAction: 'choose_style', completeAction: 'craft', noProgressAction: 'clarify', ...TIMING }),
  // 现成商品点单：玩家付费托管，先确认再取走，完成后发放成品。适合酒馆热食、面包、花束等。
  purchase: Object.freeze({ key: 'purchase', label: '点单', payer: 'player', product: true, acceptPhase: 'order',
    phases: Object.freeze([
      Object.freeze({ key: 'order', actions: Object.freeze(['confirm_order', 'cancel']) }),
      Object.freeze({ key: 'pickup', actions: Object.freeze(['take', 'clarify', 'cancel']) }),
    ]), progressAction: 'confirm_order', completeAction: 'take', noProgressAction: 'clarify', ...TIMING }),
  // 投宿歇脚：先定下住处（付费托管），歇够了再退房；适合客栈、茶馆、温泉、澡堂、静室。
  lodging: Object.freeze({ key: 'lodging', label: '投宿', payer: 'player', product: true, acceptPhase: 'checkin',
    phases: Object.freeze([
      Object.freeze({ key: 'checkin', actions: Object.freeze(['settle_in', 'cancel']) }),
      Object.freeze({ key: 'resting', actions: Object.freeze(['rest_up', 'clarify', 'cancel']) }),
    ]), progressAction: 'settle_in', completeAction: 'rest_up', noProgressAction: 'clarify', ...TIMING }),
  // 跟着学一手：先说想学什么（付束脩托管），再跟着先生动手做一遍；适合书斋、武馆、琴房、花艺班。
  lesson: Object.freeze({ key: 'lesson', label: '学艺', payer: 'player', product: true, acceptPhase: 'ask',
    phases: Object.freeze([
      Object.freeze({ key: 'ask', actions: Object.freeze(['ask_lesson', 'cancel']) }),
      Object.freeze({ key: 'practice', actions: Object.freeze(['take_lesson', 'clarify', 'cancel']) }),
    ]), progressAction: 'ask_lesson', completeAction: 'take_lesson', noProgressAction: 'clarify', ...TIMING }),
  // 咖啡馆既有冻结玩法；阶段名/动作名保持原样，避免改变已存档会话与回执指纹。
  cafe_drink: Object.freeze({ key: 'cafe_drink', label: '饮品', payer: 'player', product: null, acceptPhase: 'serving',
    phases: Object.freeze([
      Object.freeze({ key: 'menu', actions: Object.freeze(['choose_drink', 'cancel']) }),
      Object.freeze({ key: 'serving', actions: Object.freeze(['serve', 'clarify', 'cancel']) }),
    ]), progressAction: 'choose_drink', completeAction: 'serve', noProgressAction: 'clarify', ...TIMING }),
  cafe_shift: Object.freeze({ key: 'cafe_shift', label: '当班', payer: 'venue', product: null, acceptPhase: 'serving',
    phases: Object.freeze([
      Object.freeze({ key: 'menu', actions: Object.freeze(['choose_drink', 'cancel']) }),
      Object.freeze({ key: 'serving', actions: Object.freeze(['serve', 'clarify', 'cancel']) }),
    ]), progressAction: 'choose_drink', completeAction: 'serve', noProgressAction: 'clarify', ...TIMING }),
});

/** 功能建筑目录。新增一座建筑＝在这里加一条 kind 声明；引擎、账本、订单、
 * 经历、前端面板都按这份声明工作，不新增第二套经济或服务实现。
 */
const TAVERN_MEAL_PRODUCT = Object.freeze({ templateId: 'town.tavern_meal', templateVersion: 1, effectKey: 'tipsy',
  name: '酒馆热食', description: '酒馆灶上现做的一份热食。收下后对一位角色使用，让她短暂放松下来，效果沿用微醺糖果。' });

const INN_TEA_PRODUCT = Object.freeze({ templateId: 'town.inn_tea', templateVersion: 1, effectKey: 'energy',
  name: '客栈醒神茶', description: '客栈替你留的一盏醒神茶。收下后对一位角色使用，让她精神饱满，效果沿用原元气符咒。' });

const STUDY_NOTE_PRODUCT = Object.freeze({ templateId: 'town.study_note', templateVersion: 1, effectKey: 'mood_fix',
  name: '手抄的静心小笺', description: '你照着先生的样子亲手抄成的一页小笺。收下后对一位角色使用，让她的心情恢复开心。' });

export const VENUE_KINDS = Object.freeze({
  tavern: Object.freeze({
    kind: 'tavern', businessKey: 'tavern', displayName: '镇口酒馆', operatorLabel: '酒馆掌柜',
    resourceKey: 'tavern:ingredient', resourceLabel: '食材',
    budget: 480, initialSupplierMaterials: 16, initialMaterials: 8,
    reward: 30, materialQuantity: 1,
    regular: Object.freeze({ businessKey: 'tavern', displayName: '镇口酒馆', label: '熟客',
      tiers: Object.freeze([
        Object.freeze({ visits: 3, topic: '熟客专属：掌柜会给你留靠窗的位子，聊起镇上的传闻。' }),
        Object.freeze({ visits: 6, topic: '熟客专属：后厨会问你今天想吃什么，常客们也会跟你打招呼。' }),
      ]) }),
    services: Object.freeze([
      Object.freeze({ serviceKey: 'town.tavern.shift', playbook: 'shift', name: '酒馆当班',
        description: '到酒馆顶一班，备料、擦桌、端盘，完成后领取当班工资。', wage: 26, price: 0,
        materialQuantity: 1, outcomeKey: 'tavern_shift_done',
        offered: spec => `当班工资 ${spec.wage} 邻币；确认后酒馆会把工资托管，完成后付给你，取消全退。`,
        active: () => '开工了：先备料擦桌，再把这一班收尾，完成后领工资。' }),
      Object.freeze({ serviceKey: 'town.tavern.help_swap', playbook: 'help_swap', name: '帮工换一份酒食',
        description: '帮酒馆做一班零活，不领工钱，换走一份店里的热食；适合手头紧的时候。', wage: 0, price: 0,
        materialQuantity: 1, outcomeKey: 'tavern_meal_taken',
        product: TAVERN_MEAL_PRODUCT,
        offered: () => '帮工不领工钱，完成后酒馆管你一份热食；取消不消耗材料。',
        active: () => '开工了：先备料，再把这一班收尾，完成后就能带走一份热食。' }),
      Object.freeze({ serviceKey: 'town.tavern.buy_meal', playbook: 'purchase', name: '点一份热食',
        description: '点一份酒馆现做的热食带走；付一份价钱、用店里一份食材，做好后成品直接放进背包。',
        wage: 0, price: 12, materialQuantity: 1, outcomeKey: 'tavern_meal_bought',
        product: TAVERN_MEAL_PRODUCT,
        offered: spec => `这份热食 ${spec.price} 邻币、用店里 1 份食材；确认前取消全退，装盘后直接带走。`,
        active: (spec, phase) => phase === 'order' ? '先确认要哪一份，灶上就开火。' : '热食已经装盘，确认后带走。' }),
    ]),
  }),
  clothing_shop: Object.freeze({
    kind: 'clothing_shop', businessKey: 'clothing_shop', displayName: '临街裁缝铺', operatorLabel: '裁缝',
    resourceKey: 'clothing:cloth', resourceLabel: '布料',
    budget: 520, initialSupplierMaterials: 16, initialMaterials: 8,
    reward: 30, materialQuantity: 1,
    regular: Object.freeze({ businessKey: 'clothing_shop', displayName: '临街裁缝铺', label: '熟客',
      tiers: Object.freeze([
        Object.freeze({ visits: 3, topic: '熟客专属：裁缝记得你的尺码，聊起最近流行的样式。' }),
        Object.freeze({ visits: 6, topic: '熟客专属：铺子里会给你留一小块好布，聊起布料与配色。' }),
      ]) }),
    services: Object.freeze([
      Object.freeze({ serviceKey: 'town.clothing.custom_order', playbook: 'custom_order', name: '定做一身衣裳',
        description: '付一笔工费、用店里一份布料，按你挑的样式定做一件可给角色穿上的外观道具。',
        wage: 0, price: 22, materialQuantity: 1, outcomeKey: 'clothing_piece_made',
        product: Object.freeze({ templateId: 'town.clothing_piece', templateVersion: 1, effectKey: 'yukata',
          name: '定做的浴衣', description: '裁缝铺按你挑的样式定做的浴衣。收下后对一位角色使用，她会换上这套衣裳，持续24小时。' }),
        offered: spec => `定做工费 ${spec.price} 邻币、用店里 1 份布料；确认前取消全退，做好后把成品交给你。`,
        active: (spec, phase) => phase === 'brief' ? '先说说你想要什么样式，裁缝再量体裁布。' : '布料已经铺开，确认后裁缝就开始缝制。' }),
      Object.freeze({ serviceKey: 'town.clothing.shift', playbook: 'shift', name: '裁缝铺帮工',
        description: '在裁缝铺帮忙整理布匹、量体记单，完成后领取当班工资。', wage: 22, price: 0,
        materialQuantity: 1, outcomeKey: 'clothing_shift_done',
        offered: spec => `帮工工资 ${spec.wage} 邻币；确认后裁缝铺会把工资托管，完成后付给你，取消全退。`,
        active: () => '开工了：先整理布匹，再把这一班收尾，完成后领工资。' }),
    ]),
  }),
  inn: Object.freeze({
    kind: 'inn', businessKey: 'inn', displayName: '镇东客栈', operatorLabel: '客栈掌柜',
    resourceKey: 'inn:bedding', resourceLabel: '铺盖',
    budget: 460, initialSupplierMaterials: 16, initialMaterials: 8,
    reward: 30, materialQuantity: 1,
    regular: Object.freeze({ businessKey: 'inn', displayName: '镇东客栈', label: '熟客',
      tiers: Object.freeze([
        Object.freeze({ visits: 3, topic: '熟客专属：掌柜会给你留靠里的那间房，聊起南来北往的旅人。' }),
        Object.freeze({ visits: 6, topic: '熟客专属：灶上会给你温着一壶茶，聊起镇上过夜的老规矩。' }),
      ]) }),
    services: Object.freeze([
      Object.freeze({ serviceKey: 'town.inn.stay', playbook: 'lodging', name: '投宿歇脚',
        description: '付一份房钱，用店里一份铺盖，在客栈歇上一阵；歇够了退房，带走灶上温着的醒神茶。',
        wage: 0, price: 16, materialQuantity: 1, outcomeKey: 'inn_stay_done',
        product: INN_TEA_PRODUCT,
        offered: spec => `房钱 ${spec.price} 邻币、用店里 1 份铺盖；确认前取消全退，退房时把醒神茶交给你。`,
        active: (spec, phase) => phase === 'checkin' ? '先说定住哪一间，掌柜就去铺床。' : '铺盖已经铺好，歇够了就退房。' }),
      Object.freeze({ serviceKey: 'town.inn.shift', playbook: 'shift', name: '客栈帮工',
        description: '在客栈帮忙搬行李、烧水扫院，完成后领取当班工资。', wage: 24, price: 0,
        materialQuantity: 1, outcomeKey: 'inn_shift_done',
        offered: spec => `帮工工资 ${spec.wage} 邻币；确认后客栈会把工资托管，完成后付给你，取消全退。`,
        active: () => '开工了：先烧水扫院，再把这一班收尾，完成后领工资。' }),
    ]),
  }),
  study: Object.freeze({
    kind: 'study', businessKey: 'study', displayName: '街尾书斋', operatorLabel: '书斋先生',
    resourceKey: 'study:paper', resourceLabel: '纸墨',
    budget: 420, initialSupplierMaterials: 16, initialMaterials: 8,
    reward: 30, materialQuantity: 1,
    regular: Object.freeze({ businessKey: 'study', displayName: '街尾书斋', label: '熟客',
      tiers: Object.freeze([
        Object.freeze({ visits: 3, topic: '熟客专属：先生会替你留一张临窗的书案，聊起镇上的旧闻抄本。' }),
        Object.freeze({ visits: 6, topic: '熟客专属：先生肯拿出压箱底的字帖，聊起写字与做人的道理。' }),
      ]) }),
    services: Object.freeze([
      Object.freeze({ serviceKey: 'town.study.lesson', playbook: 'lesson', name: '跟着先生学一手',
        description: '付一份束脩，用店里一份纸墨，跟着先生学一样手艺并亲手做一件；做完的成品直接带走。',
        wage: 0, price: 14, materialQuantity: 1, outcomeKey: 'study_lesson_done',
        product: STUDY_NOTE_PRODUCT,
        offered: spec => `束脩 ${spec.price} 邻币、用店里 1 份纸墨；确认前取消全退，做完的手作交给你。`,
        active: (spec, phase) => phase === 'ask' ? '先说想学哪一样，先生再摆开纸墨。' : '纸墨已经摆开，跟着做一遍就成。' }),
      Object.freeze({ serviceKey: 'town.study.shift', playbook: 'shift', name: '书斋帮工',
        description: '在书斋帮忙理书、抄目、晒纸，完成后领取当班工资。', wage: 20, price: 0,
        materialQuantity: 1, outcomeKey: 'study_shift_done',
        offered: spec => `帮工工资 ${spec.wage} 邻币；确认后书斋会把工资托管，完成后付给你，取消全退。`,
        active: () => '开工了：先理书抄目，再把这一班收尾，完成后领工资。' }),
    ]),
  }),
});

/** 咖啡馆是冻结实例，不登记在 VENUE_KINDS 里；熟客档案单独声明，口径与其它建筑一致。 */
export const CAFE_REGULAR_PROFILE = Object.freeze({ businessKey: 'cafe', displayName: '咖啡馆', label: '熟客',
  tiers: Object.freeze([
    Object.freeze({ visits: 3, topic: '熟客专属：咖啡师记得你常点的口味，聊起最近的天气和豆子。' }),
    Object.freeze({ visits: 6, topic: '熟客专属：可以聊起店里的老故事和常客们的近况。' }),
  ]) });

const regularProfiles = new Map([[CAFE_REGULAR_PROFILE.businessKey, CAFE_REGULAR_PROFILE],
  ...Object.values(VENUE_KINDS).map(kind => [kind.businessKey, kind.regular])]);
export function venueRegularProfile(businessKey) { return regularProfiles.get(businessKey) || null; }
export function venueRegularProfiles() { return [...regularProfiles.values()]; }

/** 供前端设置面板列出可开张建筑；新增建筑只改 VENUE_KINDS，无需再改页面硬编码。 */
export function venueKindDescriptors() {
  return Object.values(VENUE_KINDS).map(kind => ({ businessKey: kind.businessKey, kind: kind.kind,
    displayName: kind.displayName, operatorLabel: kind.operatorLabel, resourceLabel: kind.resourceLabel,
    serviceKeys: kind.services.map(service => service.serviceKey) }));
}

const byServiceKey = new Map();
for (const kind of Object.values(VENUE_KINDS)) {
  for (const service of kind.services) {
    byServiceKey.set(service.serviceKey, { kind, service, playbook: VENUE_PLAYBOOKS[service.playbook] });
  }
}

export const VENUE_SERVICE_KEYS = Object.freeze([...byServiceKey.keys()]);
export function isVenueServiceKey(serviceKey) { return byServiceKey.has(serviceKey); }
export function getVenueServiceSpec(serviceKey) { return byServiceKey.get(serviceKey) || null; }
export function getVenueKind(kind) { return VENUE_KINDS[kind] || null; }
/** 引擎与道具模板服务共用的产出清单；新增建筑产出只改这里。 */
export function venueProductTemplates() {
  const seen = new Map();
  for (const kind of Object.values(VENUE_KINDS)) {
    for (const service of kind.services) {
      if (service.product) seen.set(service.product.templateId, { ...service.product });
    }
  }
  return [...seen.values()];
}

export function requireVenueServiceSpec(serviceKey) {
  const found = getVenueServiceSpec(serviceKey);
  if (!found) throw townError('INVALID_SERVICE_KEY');
  return found;
}

/** 一座功能建筑的冻结模板：会话里存的就是它，版本变化必须显式升级。
 * 只放钱物/时长字段；玩法阶段与产出由 serviceKey 在注册表里解析。
 */
export function venueServiceTemplate(spec) {
  const playbook = VENUE_PLAYBOOKS[spec.playbook];
  return Object.freeze({ key: spec.serviceKey, version: 1, price: spec.price, wage: spec.wage,
    materialQuantity: spec.materialQuantity, outcomeKey: spec.outcomeKey, maxTurns: playbook.maxTurns,
    idleMs: playbook.idleMs, maxDurationMs: playbook.maxDurationMs, offerMs: playbook.offerMs, leaseMs: playbook.leaseMs });
}

/** 目录文案只读入口；入参是注册表条目 {kind, service, playbook}，不要在调用点自己拼名字或价格。 */
export function venueServiceCatalog(entry) {
  const template = venueServiceTemplate(entry.service);
  return { serviceKey: entry.service.serviceKey, name: entry.service.name, description: entry.service.description,
    price: template.price, wage: template.wage, playbook: entry.service.playbook,
    businessKey: entry.kind.businessKey, available: true, reason: null };
}
