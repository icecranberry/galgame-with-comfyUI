// 小镇 NPC 服务 / 打工项目：由 LLM 依据人格卡与职业生成，落库 town_npc_offers。
// prompt 结构（与需求一致）：system1 破限+世界观、system2 世界观强化、system3 人格卡、user 本次任务目标。
import { getDb, getSystemRules, getWorldSetting } from '../../db/index.js';
import { getWorldIntegrationRule } from '../../builtinRules.js';
import { chatSync } from '../../llm/llm-client.js';
import { extractFirstJson, repairJson } from '../eventGenerator.js';
import { townError } from './townEventService.js';
import { defaultTownCapabilities, parseCharacterCapabilities } from './townCapabilities.js';

export const TOWN_OFFER_KINDS = Object.freeze(['service', 'work']);
export const MAX_OFFERS_PER_KIND = 3;
export const OFFER_PRICE_RANGE = Object.freeze({ service: [20, 200], work: [15, 150] });

export function describeOfferKind(kind) {
  return kind === 'work' ? '打工' : '服务';
}

/** system1：破限 + 世界观（与日程/奇遇同源）。 */
export function buildOfferSystemBase() {
  return [getSystemRules({ roleplay: false }), getWorldSetting()].filter(Boolean).join('\n\n');
}

/** system2：世界观强化，强制所有创作落在 <world_setting> 框架内。 */
export function buildOfferWorldRule() {
  try {
    return getWorldIntegrationRule('schedule') || '';
  } catch {
    return '';
  }
}

function stripFence(content) {
  return String(content || '')
    .replace(/^\s*```(?:[a-z]+)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

export function normalizeOfferKind(kind) {
  const value = String(kind || '').trim().toLowerCase();
  if (!TOWN_OFFER_KINDS.includes(value)) throw townError('INVALID_OFFER_KIND');
  return value;
}

export function clampOfferPrice(kind, value) {
  const [min, max] = OFFER_PRICE_RANGE[kind] || [1, 200];
  let n = Number(value);
  if (!Number.isFinite(n)) n = Math.round((min + max) / 2);
  n = Math.round(n);
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

/** system3：人格卡（含职业、简介、外观），决定这个人会提供什么、会雇人做什么。 */
export function buildNpcOfferPersonaBlock(npc) {
  const lines = [];
  lines.push(`【角色】${npc.display_name || '无名居民'}`);
  if (npc.job) lines.push(`【职业】${npc.job}`);
  if (npc.brief) lines.push(`【一句话简介】${npc.brief}`);
  if (npc.appearance_desc) lines.push(`【外观】${npc.appearance_desc}`);
  const persona = String(npc.persona || '').trim();
  if (persona) {
    lines.push('【人格卡】');
    lines.push(persona);
  } else {
    lines.push('【人格卡】（缺失，请依据职业与简介合理补全其性格与说话方式）');
  }
  return lines.join('\n');
}

﻿/** user：本次任务目标。 */
export function buildNpcOfferTaskPrompt(kind, npc) {
  const isService = kind === 'service';
  const [min, max] = OFFER_PRICE_RANGE[kind] || [1, 200];
  const mid = Math.round((min + max) / 2);
  const examplePrice = Math.min(max, Math.max(min, isService ? mid : mid - 10));
  const name = npc.display_name || '无名居民';
  const roleLine = isService
    ? `本次要为「${name}」生成 1~3 个【服务项目】：玩家花钱买「${name}」本人提供的服务，动手的人是 ${name}，玩家是坐在一旁被服务、被照顾的顾客。price 是玩家付出的钱（整数，${min}~${max}）。`
    : `本次要为「${name}」生成 1~3 个【打工项目】：玩家出力替「${name}」干活换工资，动手的人是玩家，${name} 是站在旁边使唤、验收的雇主。price 是 ${name} 付给玩家的工资（整数，${min}~${max}）。`;
  const priceHint = isService
    ? `- price 体现服务的分量：轻省的小服务偏低（${min}~${mid}），费力、耗时或私密的服务偏高（${mid}~${max}）。`
    : `- price 体现活儿的辛苦程度：轻松活儿偏低（${min}~${mid}），又累又脏的活儿偏高（${mid}~${max}）。`;
  const directionRule = isService
    ? `- 动手的人必须是「${name}」：描述要写她/他为你做了什么、怎么照顾你。只要出现「你替她/他」「你负责」「她/他递给你工具」这类玩家在干活的句子，就是写反了。`
    : `- 动手的人必须是玩家：描述要写「你」做了什么、${name} 怎么在旁边使唤或验收。只要出现「她/他替你」「她/他动手」这类居民在干活的句子，就是写反了。`;
  const kindRule = isService
    ? '- 服务是这位居民拿出来卖的本事：她/他的职业手艺（理发、按摩、裁缝、占卜、跑腿代办），或者顺手能替顾客做的一件事。'
    : '- 打工是这位居民不想自己动手、愿意花钱找人代劳的活：脏活、累活、跑腿、看店、搬运、看守都算。';
  const example = isService
    ? [
        '    {',
        '      "title": "庭院除草",',
        `      "description": "${name}扛着镰刀来你家后院，蹲了一下午把杂草连根清干净，还顺手把墙角那丛野薄荷挪到向阳处，末了拍着土问你要不要来杯凉茶。",`,
        `      "price": ${examplePrice}`,
        '    }',
      ]
    : [
        '    {',
        '      "title": "清理牛棚",',
        `      "description": "${name}把铁叉塞给你就拎着桶去挤奶了，牛棚里的垫草沤了半个月，你清到一半她才回来，笑你比她家奶牛还慢。",`,
        `      "price": ${examplePrice}`,
        '    }',
      ];
  return [
    '【本次任务目标】',
    roleLine,
    '',
    '【方向铁律（写反了整条作废）】',
    directionRule,
    kindRule,
    '',
    '【创作要求】',
    '- 项目必须贴合这位居民的「职业」与「人格卡」：她/他的性格、说话方式、专长、身份决定了会提供什么服务、会雇人做什么。',
    '- 项目要具体、有画面感，是这个小镇里真实会发生的事，不要抽象的口号式条目。',
    '- 项目之间要有明显区别，不要换词重复同一件事。',
    '- 标题 4~10 个字，像游戏里的任务名，直接点出这件事（例：「庭院除草」「陪酒三杯」「修补渔网」「看守仓库」）。',
    '- 描述 30~80 个字，写清楚谁做了什么、会经历什么，带一点这位居民的个性口吻或小细节，不要写成说明书。',
    priceHint,
    '',
    '【输出格式】严格输出如下 JSON，禁止输出 JSON 以外的任何文字、解释、注释或 markdown 代码块：',
    '{',
    '  "offers": [',
    ...example,
    '  ]',
    '}',
    '',
    '【字段约束】',
    '- offers：数组，1~3 项，每项是一个独立项目。',
    '- title：字符串，4~10 个字，游戏任务名风格，结尾不加标点。',
    '- description：字符串，30~80 个字，写清谁做了什么、有什么细节，贴合这位居民的人格。',
    `- price：整数，${min}~${max} 之间的金币数量，不要加引号、不要带单位。`,
    '- 必须严格按上面的示例格式输出，不要输出任何解释或 JSON 以外的文字。',
  ].join('\n');
}

/** 组装四条消息：system1 破限+世界观 / system2 世界观强化 / system3 人格卡 / user 任务目标。 */
export function buildNpcOfferMessages(kind, npc) {
  return [
    { role: 'system', content: buildOfferSystemBase() },
    { role: 'system', content: buildOfferWorldRule() },
    { role: 'system', content: buildNpcOfferPersonaBlock(npc) },
    { role: 'user', content: buildNpcOfferTaskPrompt(kind, npc) },
  ].filter(message => String(message.content || '').trim());
}

export function parseNpcOfferPayload(text) {
  const raw = stripFence(text);
  const json = extractFirstJson(raw);
  if (!json) throw townError('OFFER_JSON_MISSING');
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    data = JSON.parse(repairJson(json));
  }
  const list = Array.isArray(data?.offers) ? data.offers : [];
  const out = [];
  for (const item of list) {
    const title = String(item?.title || '').trim().slice(0, 40);
    if (!title) continue;
    out.push({ title, description: String(item?.description || '').trim(), price: item?.price });
  }
  if (!out.length) throw townError('OFFER_EMPTY');
  return out.slice(0, MAX_OFFERS_PER_KIND);
}

function loadNpc(db, npcId) {
  const npc = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(Number(npcId));
  if (!npc) throw townError('NPC_NOT_FOUND');
  return npc;
}

async function requestOffers(kind, npc, options = {}) {
  const llm = options.llm?.chatSync || chatSync;
  const label = kind === 'service' ? '小镇服务项目生成' : '小镇打工项目生成';
  const out = await llm(buildNpcOfferMessages(kind, npc), { temperature: 0.9, max_tokens: 1600, label });
  return parseNpcOfferPayload(out);
}

export function listNpcOffers({ worldId = 'default', npcId, kind = null } = {}) {
  const db = getDb();
  const id = Number(npcId);
  if (!Number.isFinite(id)) throw townError('NPC_NOT_FOUND');
  if (kind) {
    const normalized = normalizeOfferKind(kind);
    return db
      .prepare('SELECT * FROM town_npc_offers WHERE world_id = ? AND npc_id = ? AND kind = ? ORDER BY sort_order, id')
      .all(worldId, id, normalized);
  }
  return db
    .prepare('SELECT * FROM town_npc_offers WHERE world_id = ? AND npc_id = ? ORDER BY kind, sort_order, id')
    .all(worldId, id);
}

export async function generateNpcOffers({ worldId = 'default', npcId, kind, llm } = {}) {
  const db = getDb();
  const normalized = normalizeOfferKind(kind);
  const npc = loadNpc(db, npcId);
  const parsed = await requestOffers(normalized, npc, { llm });
  const now = Date.now();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM town_npc_offers WHERE world_id = ? AND npc_id = ? AND kind = ?').run(worldId, npc.id, normalized);
    const insert = db.prepare(
      'INSERT INTO town_npc_offers (world_id, npc_id, kind, title, description, price, sort_order, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    parsed.forEach((offer, index) => {
      insert.run(
        worldId,
        npc.id,
        normalized,
        offer.title,
        offer.description,
        clampOfferPrice(normalized, offer.price),
        index,
        'llm',
        now,
        now,
      );
    });
    return db
      .prepare('SELECT * FROM town_npc_offers WHERE world_id = ? AND npc_id = ? AND kind = ? ORDER BY sort_order, id')
      .all(worldId, npc.id, normalized);
  });
  return run.immediate();
}

export async function rerollNpcOffer({ worldId = 'default', npcId, offerId, llm } = {}) {
  const db = getDb();
  const npc = loadNpc(db, npcId);
  const offer = db
    .prepare('SELECT * FROM town_npc_offers WHERE id = ? AND world_id = ? AND npc_id = ?')
    .get(Number(offerId), worldId, npc.id);
  if (!offer) throw townError('OFFER_NOT_FOUND');
  const parsed = await requestOffers(offer.kind, npc, { llm });
  const picked = parsed[0];
  const now = Date.now();
  db.prepare('UPDATE town_npc_offers SET title = ?, description = ?, price = ?, source = ?, updated_at = ? WHERE id = ?').run(
    picked.title,
    picked.description,
    clampOfferPrice(offer.kind, picked.price),
    'llm',
    now,
    offer.id,
  );
  return db.prepare('SELECT * FROM town_npc_offers WHERE id = ?').get(offer.id);
}

export function deleteNpcOffers({ worldId = 'default', npcId, kind = null } = {}) {
  const db = getDb();
  const id = Number(npcId);
  if (kind) {
    const normalized = normalizeOfferKind(kind);
    return db.prepare('DELETE FROM town_npc_offers WHERE world_id = ? AND npc_id = ? AND kind = ?').run(worldId, id, normalized).changes;
  }
  return db.prepare('DELETE FROM town_npc_offers WHERE world_id = ? AND npc_id = ?').run(worldId, id).changes;
}

/**
 * 服务管理面板用：有 service/work 权限的居民 + 已有项目数量。
 * 由酒馆角色接管身份的居民（town_npcs.character_id 有值）职能以**角色自己的配置**为准，
 * 与小镇运行时同一口径；同时带出角色档案，面板据此筛查「酒馆角色」。
 */
export function listOfferOverview({ worldId = 'default' } = {}) {
  const db = getDb();
  const npcs = db.prepare(`
    SELECT n.*, c.display_name AS character_name, cc.capabilities_json AS character_capabilities,
           COALESCE(tc.map_id, n.map_id) AS resident_map_id
    FROM town_npcs n
    LEFT JOIN characters c ON c.id = n.character_id
    LEFT JOIN town_characters tc ON tc.character_id = c.id
    LEFT JOIN town_character_capabilities cc ON cc.character_id = n.character_id
    ORDER BY n.id
  `).all();
  const counts = db.prepare(`SELECT npc_id, kind, COUNT(*) AS n FROM town_npc_offers WHERE world_id = ? GROUP BY npc_id, kind`)
    .all(worldId);
  const byNpc = new Map();
  for (const row of counts) {
    if (!byNpc.has(row.npc_id)) byNpc.set(row.npc_id, { service: 0, work: 0 });
    byNpc.get(row.npc_id)[row.kind] = row.n;
  }
  return npcs.map(npc => {
    const characterId = npc.character_id ?? null;
    // 角色单独配过职能就以角色为准，没配过才用居民自己的权限
    const capabilities = (characterId ? parseCharacterCapabilities(npc.character_capabilities) : null)
      ?? parseCapabilities(npc);
    const tally = byNpc.get(npc.id) || { service: 0, work: 0 };
    return {
      npcId: npc.id,
      mapId: npc.resident_map_id ?? null,
      characterId,
      source: characterId ? 'character' : 'npc',
      displayName: npc.display_name || npc.character_name || '',
      job: npc.job || '',
      brief: npc.brief || '',
      capabilities,
      serviceCount: tally.service || 0,
      workCount: tally.work || 0,
    };
  }).filter(item => item.capabilities.includes('service') || item.capabilities.includes('work'))
    .concat(listPendingCharacterProfiles(db));
}

/**
 * 服务管理名单的第二段：已经入住、有服务 / 打工职能、但还没有镇上档案的酒馆角色。
 * 未单独配置职能时沿用默认服务权限，与角色详情及建档逻辑一致。
 * 这些角色要先生成托管居民档案，项目才有地方落库。
 */
function listPendingCharacterProfiles(db) {
  const rows = db.prepare(`
    SELECT c.id, c.display_name, tc.map_id, cc.capabilities_json AS character_capabilities
    FROM characters c
    JOIN town_characters tc ON tc.character_id = c.id AND tc.town_enabled = 1
    LEFT JOIN town_character_capabilities cc ON cc.character_id = c.id
    WHERE NOT EXISTS (SELECT 1 FROM town_npcs n WHERE n.character_id = c.id)
    ORDER BY c.id
  `).all();
  return rows.map(row => ({
    npcId: null,
    mapId: row.map_id ?? null,
    characterId: row.id,
    source: 'character',
    pendingProfile: true,
    displayName: row.display_name || '',
    job: '',
    brief: '',
    capabilities: parseCharacterCapabilities(row.character_capabilities) ?? defaultTownCapabilities(null),
    serviceCount: 0,
    workCount: 0,
  })).filter(item => item.capabilities.includes('service') || item.capabilities.includes('work'));
}

function parseCapabilities(npc) {
  try {
    const value = JSON.parse(npc.capabilities_json || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
