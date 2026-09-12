import { townCapabilities, defaultTownCapabilities } from './townCapabilities.js';

/** 功能建筑种类档案：只保留名称与岗位标签，玩法目录由能力(capabilities)与奇遇承载。 */
export const TOWN_VENUE_KINDS = Object.freeze({
  tavern: Object.freeze({ kind: 'tavern', businessKey: 'tavern', displayName: '镇口酒馆', operatorLabel: '酒馆掌柜' }),
  clothing_shop: Object.freeze({ kind: 'clothing_shop', businessKey: 'clothing_shop', displayName: '临街裁缝铺', operatorLabel: '裁缝' }),
  inn: Object.freeze({ kind: 'inn', businessKey: 'inn', displayName: '镇东客栈', operatorLabel: '客栈掌柜' }),
  study: Object.freeze({ kind: 'study', businessKey: 'study', displayName: '街尾书斋', operatorLabel: '书斋先生' }),
  salon: Object.freeze({ kind: 'salon', businessKey: 'salon', displayName: '理发店', operatorLabel: '理发师' }),
  massage: Object.freeze({ kind: 'massage', businessKey: 'massage', displayName: '按摩店', operatorLabel: '按摩师' }),
});

// Building purpose is independent of its artwork/name and of whether an operator exists yet.
export const TOWN_BUSINESS_ROLES = Object.freeze({
  board: { actorRole: 'commissioner', name: '邻里公告站', job: '委托员', match: /公告|委托|事务|镇长|居委|board|town_hall/i },
  supplier: { actorRole: 'supplier', name: '材料补给站', job: '供货员', match: /供货|补给|仓库|杂货|货郎|材料|supplier|warehouse|general_store/i },
  workshop: { actorRole: 'workshop', name: '手作工坊', job: '工坊师傅', match: /工坊|手作|铁匠|木匠|工匠|workshop|smith/i },
  cafe: { actorRole: 'cafe', name: '咖啡馆', job: '咖啡师', match: /咖啡|cafe|coffee/i },
  ...Object.fromEntries(Object.values(TOWN_VENUE_KINDS).map(kind => [kind.businessKey, {
    actorRole: kind.businessKey, name: kind.displayName, job: kind.operatorLabel,
    match: {
      tavern: /酒馆|酒吧|餐馆|饭馆|餐厅|食堂|厨师|酒保|tavern|restaurant|pub|diner/i,
      clothing_shop: /服装|裁缝|时装|裁衣|clothing|tailor|boutique/i,
      inn: /客栈|旅馆|旅店|酒店|旅舍|inn|hotel|lodge/i,
      study: /书斋|书店|书屋|学堂|图书|教书|先生|study|library|bookshop|school/i,
      salon: /理发|美发|发型|salon|barber/i,
      massage: /按摩|推拿|护理|massage|spa/i,
    }[kind.businessKey],
  }]))
});
export const townBusinessKinds = () => ['none', ...Object.keys(TOWN_BUSINESS_ROLES)];
export function inferTownBusinessKind(value) {
  return Object.entries(TOWN_BUSINESS_ROLES).find(([, role]) => role.match?.test(String(value || '')))?.[0] || 'none';
}
export function townBuildingKind(building = {}) {
  const explicit = building.businessKind ?? building.business_kind ?? building.meta?.businessKind;
  if (townBusinessKinds().includes(explicit)) return explicit;
  return inferTownBusinessKind([building.key, building.name].filter(Boolean).join(' '));
}

/** Complete the editable generation plan BEFORE persona/art generation. Missing essential
 * staff join the roster here, so they follow the same persona/sprite pipeline as everyone else. */
export function prepareTownBlueprintResponsibilities(bp) {
  for (const b of bp.buildings) {
    b.businessKind = townBuildingKind(b);
    b.capabilities = townCapabilities(b, defaultTownCapabilities(b.businessKind));
  }
  for (const kind of ['supplier', 'workshop']) {
    if (bp.buildings.some(b => b.businessKind === kind)) continue;
    const role = TOWN_BUSINESS_ROLES[kind];
    let key = kind;
    while ([...bp.buildings, ...bp.groundAssets, ...bp.roadAssets, ...bp.props].some(b => b.key === key)) key += '_site';
    bp.buildings.push({ key, name: role.name, businessKind: kind, capabilities: defaultTownCapabilities(kind), desc: '', special: true,
      reusable: false, maxInstances: 1, footprint: { w: 3, h: 2 } });
  }
  const occupied = new Set();
  const buildings = [{ key: 'central_plaza', businessKind: 'board' }, ...bp.buildings];
  const kinds = new Set();
  for (const building of buildings) {
    const kind = building.businessKind, role = TOWN_BUSINESS_ROLES[kind]
      || (building.capabilities?.includes('trade') ? { name: building.name, job: '商贩' } : null);
    const dutyKey = kind === 'none' ? building.key : kind;
    if (!role || kinds.has(dutyKey)) continue;
    kinds.add(dutyKey);
    if (kind !== 'board') { building.special = true; building.reusable = false; building.maxInstances = 1; }
    let npc = bp.npcs.find(n => !occupied.has(n) && n.workplaceKey === building.key)
      || (kind !== 'none' && bp.npcs.find(n => !occupied.has(n) && inferTownBusinessKind(n.job) === kind));
    if (!npc) {
      let displayName = role.job, suffix = 2;
      while (bp.npcs.some(n => n.displayName === displayName)) displayName = `${role.job}${suffix++}`;
      npc = { displayName, job: role.job, persona: '',
        brief: `在${building.name || role.name}工作的${role.job}，做事认真，熟悉街坊，乐意和来访者聊镇上的日常。` };
      bp.npcs.push(npc);
    }
    npc.workplaceKey = building.key;
    npc.capabilities = townCapabilities(npc, building.capabilities || defaultTownCapabilities(kind));
    occupied.add(npc);
  }
  for (const npc of bp.npcs) npc.capabilities = townCapabilities(npc, defaultTownCapabilities(inferTownBusinessKind(npc.job), npc.job));
  return bp;
}
