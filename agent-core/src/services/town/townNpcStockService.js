// 小镇 NPC 货架：有交易权限的居民每 7 天换一次货，1~5 件。
// 生成参考开宝箱：约一半是宝箱里能开出来的东西，另一半按人格卡与职业自由创作（如奶牛娘卖自产的奶）。
// 图片与描述自由，买下后放进背包，并按随机好感度提升与 NPC 的亲密度。
import { createHash } from 'node:crypto';

import { getDb, getSystemRules, getWorldSetting } from '../../db/index.js';
import { getWorldIntegrationRule } from '../../builtinRules.js';
import { config } from '../../config.js';
import { chatSync } from '../../llm/llm-client.js';
import { extractFirstJson, repairJson } from '../eventGenerator.js';
import { generateImageRaw } from '../imageSkill.js';
import { saveBase64Image } from '../imagePaths.js';
import { broadcast } from '../unifiedStreamBus.js';
import { broadcastTownStateUpdated } from './townBus.js';
import { townError } from './townEventService.js';
import { townCapabilities } from './townCapabilities.js';
import { percentFromProgress } from './progressPercent.js';


export const STOCK_ROLL_MS = 3 * 24 * 3600 * 1000; // 货架 3 天换一批
export const STOCK_MIN_ITEMS = 1;
export const STOCK_MAX_ITEMS = 5;
export const STOCK_PRICE_RANGE = Object.freeze([10, 120]);
export const STOCK_FAVOR_RANGE = Object.freeze([1, 6]);
export const STOCK_IMAGE_PROGRESS_EVENT = 'town_npc_stock_progress';
export const STOCK_IMAGE_READY_EVENT = 'town_npc_stock_ready';
export const STOCK_ROLLED_EVENT = 'town_npc_stock_rolled';
// 单件货品图标最多尝试几次（后台调度器负责补画失败/中断的图）。
export const STOCK_IMAGE_MAX_ATTEMPTS = 3;
const STOCK_SCENE = 'items';

/** 宝箱能开出来的东西（effect_key 与 itemService.ITEM_EFFECTS 对齐）：约一半货品从这里取材。 */
export const CHEST_GOODS = Object.freeze([
  { effectKey: 'favor_candy', name: '好感糖果', hint: '吃下后想对某个人更亲近一点的小糖果' },
  { effectKey: 'mood_fix', name: '心情修复贴', hint: '把糟糕心情一键修好的小贴纸' },
  { effectKey: 'energy', name: '元气符咒', hint: '让人瞬间元气满满的护符' },
  { effectKey: 'tsundere', name: '傲娇药水', hint: '喝下后变得口是心非的药水' },
  { effectKey: 'tipsy', name: '微醺糖果', hint: '吃下后脸颊微红、话变多的糖果' },
  { effectKey: 'twin_tails', name: '双马尾发型卡', hint: '活力高双马尾造型卡' },
  { effectKey: 'bob_cut', name: '波波头发型卡', hint: '利落波波头造型卡' },
  { effectKey: 'high_ponytail', name: '高马尾发型卡', hint: '清爽高马尾造型卡' },
  { effectKey: 'skyward_braids', name: '朝天辫发型卡', hint: '俏皮朝天辫造型卡' },
  { effectKey: 'yukata', name: '浴衣卡', hint: '夏日印花浴衣造型卡' },
  { effectKey: 'maid_outfit', name: '女仆装卡', hint: '黑白经典女仆装造型卡' },
  { effectKey: 'miko', name: '巫女服卡', hint: '传统巫女服造型卡' },
  { effectKey: 'transform', name: '变身形态卡', hint: '变成另一种拟人形态的卡片' },
]);
const CHEST_KEYS = new Set(CHEST_GOODS.map(item => item.effectKey));

function hashSeed(value) {
  return parseInt(createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16);
}

function stripFence(content) {
  return String(content || '')
    .replace(/^\s*```(?:[a-z]+)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

export function clampStockPrice(value) {
  const [min, max] = STOCK_PRICE_RANGE;
  let n = Number(value);
  if (!Number.isFinite(n)) n = Math.round((min + max) / 2);
  n = Math.round(n);
  return Math.min(max, Math.max(min, n));
}

export function clampFavorDelta(value) {
  const [min, max] = STOCK_FAVOR_RANGE;
  let n = Number(value);
  if (!Number.isFinite(n)) n = Math.round((min + max) / 2);
  n = Math.round(n);
  return Math.min(max, Math.max(min, n));
}

export function pickStockCount(seed) {
  const span = STOCK_MAX_ITEMS - STOCK_MIN_ITEMS + 1;
  return STOCK_MIN_ITEMS + (hashSeed(`count:${seed}`) % span);
}

/** 约一半走宝箱取材，其余自由创作；奇数件时宝箱侧取整。 */
export function splitStockPlan(count, seed) {
  const chest = Math.round(count / 2);
  return { chest, free: count - chest, order: hashSeed(`order:${seed}`) % 2 === 0 ? 'chest-first' : 'free-first' };
}

/** system1：破限 + 世界观。 */
export function buildStockSystemBase() {
  return [getSystemRules({ roleplay: false }), getWorldSetting()].filter(Boolean).join('\n\n');
}

/** system2：世界观强化。 */
export function buildStockWorldRule() {
  try {
    return getWorldIntegrationRule('schedule') || '';
  } catch {
    return '';
  }
}

/** system3：人格卡。 */
export function buildStockPersonaBlock(npc) {
  const lines = [`【角色】${npc.display_name || '无名居民'}`];
  if (npc.job) lines.push(`【职业】${npc.job}`);
  if (npc.brief) lines.push(`【一句话简介】${npc.brief}`);
  if (npc.appearance_desc) lines.push(`【外观】${npc.appearance_desc}`);
  const persona = String(npc.persona || '').trim();
  lines.push(persona ? `【人格卡】\n${persona}` : '【人格卡】（缺失，请依据职业与简介合理补全其性格与商品风格）');
  return lines.join('\n');
}

/** user：本次任务目标。 */
export function buildStockTaskPrompt(npc, plan) {
  const name = npc.display_name || '无名居民';
  const chestLines = CHEST_GOODS.map(item => `  - ${item.effectKey}（${item.name}）：${item.hint}`).join('\n');
  return [
    '【本次任务目标】',
    `为有交易权限的居民「${name}」设计本期货架上的 ${plan.count} 件货品。玩家用邻币买下后放进背包，并会因此和这位居民更亲近一点。`,
    `其中 ${plan.chest} 件要从「宝箱里能开出来的东西」里取材（用下面给出的 effect_key，保留其效果定位，只把名称、描述、画面按这位居民的风格重新包装）；`,
    `另外 ${plan.free} 件由你完全自由创作，必须长在这位居民的人格卡与职业上（例：奶牛娘卖自己产的奶、铁匠卖打铁剩下的边角料做的护身符、花店姑娘卖当天没卖完的花束）。`,
    '',
    '【宝箱货品取材池】（chest 件请从中选，effectKey 必须原样使用）',
    chestLines,
    '',
    '【创作要求】',
    '- 货品要像这个小镇里真实会卖的东西，有具体质感、气味或来历，不要写成通用商店条目。',
    '- 自由创作的货品 effectKey 也要从上面的取材池里挑一个最贴近的（它决定玩家在背包里使用时的实际效果）。',
    '- 标题 3~8 个字，像游戏物品名，结尾不加标点。',
    '- 描述 20~60 个字，写清这是什么、为什么出现在这里，带一点这位居民的口吻或小故事。',
    '- imagePrompt 用英文，画一张 512512 的道具图标：单个物品居中、柔和光效、简洁背景、无人物、无文字，60~120 词。',
    `- price 整数，${STOCK_PRICE_RANGE[0]}~${STOCK_PRICE_RANGE[1]} 之间；越稀有/越费工越贵。`,
    `- favor 整数，${STOCK_FAVOR_RANGE[0]}~${STOCK_FAVOR_RANGE[1]} 之间，代表买下后这位居民的好感提升。`,
    '',
    '【输出格式】严格输出如下 JSON，禁止输出 JSON 以外的任何文字、解释、注释或 markdown 代码块：',
    '{',
    '  "goods": [',
    '    {',
    '      "title": "当天没卖完的花束",',
    '      "description": "用报纸随手包着，花瓣上还挂着水珠，她说买回去插在窗台正好。",',
    '      "effectKey": "mood_fix",',
    '      "price": 30,',
    '      "favor": 3,',
    '      "imagePrompt": "game item icon, a small bouquet of wildflowers wrapped in newspaper, dewdrops on petals, floating, soft glow, simple light background, no humans, no text, best quality"',
    '    }',
    '  ]',
    '}',
    '',
    '【字段约束】',
    `- goods：数组，恰好 ${plan.count} 项。`,
    '- title：字符串，3~8 个字。',
    '- description：字符串，20~60 个字。',
    '- effectKey：字符串，必须来自取材池的 effectKey。',
    '- price：整数，不要加引号、不要带单位。',
    '- favor：整数，不要加引号。',
    '- imagePrompt：英文，单行，无中文。',
  ].join('\n');
}

export function buildStockMessages(npc, plan) {
  return [
    { role: 'system', content: buildStockSystemBase() },
    { role: 'system', content: buildStockWorldRule() },
    { role: 'system', content: buildStockPersonaBlock(npc) },
    { role: 'user', content: buildStockTaskPrompt(npc, plan) },
  ].filter(message => String(message.content || '').trim());
}

export function parseStockPayload(text, plan) {
  const raw = stripFence(text);
  const json = extractFirstJson(raw);
  if (!json) throw townError('STOCK_JSON_MISSING');
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    data = JSON.parse(repairJson(json));
  }
  const list = Array.isArray(data?.goods) ? data.goods : [];
  const out = [];
  for (const item of list) {
    const title = String(item?.title || '').trim().slice(0, 24);
    if (!title) continue;
    const effectKey = CHEST_KEYS.has(String(item?.effectKey || '')) ? String(item.effectKey) : 'favor_candy';
    out.push({
      title,
      description: String(item?.description || '').trim().slice(0, 240),
      effectKey,
      price: clampStockPrice(item?.price),
      favor: clampFavorDelta(item?.favor),
      imagePrompt: String(item?.imagePrompt || item?.image_prompt || '').trim(),
    });
  }
  if (!out.length) throw townError('STOCK_EMPTY');
  return out.slice(0, plan.count);
}

//  货架查询 / 生成 

export function getNpcFavor(db, worldId, npcId) {
  const row = db.prepare('SELECT favor FROM town_npc_favor WHERE world_id = ? AND npc_id = ?').get(worldId, npcId);
  return row?.favor ?? 0;
}

function stockDto(row) {
  return {
    id: row.id,
    npcId: row.npc_id,
    title: row.custom_name,
    description: row.custom_desc,
    effectKey: row.effect_key,
    price: row.price,
    favorDelta: row.favor_delta,
    imageUrl: row.image_url || null,
    imageStatus: row.image_status || 'pending',
    imagePrompt: row.image_prompt || '',
    rolledAt: row.rolled_at,
    nextRollAt: row.next_roll_at,
    sold: row.sold_at != null,
  };
}

export function listNpcStock({ worldId = 'default', npcId, includeSold = false } = {}) {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM town_npc_stock WHERE world_id = ? AND npc_id = ?
    ${includeSold ? '' : 'AND sold_at IS NULL'} ORDER BY id`).all(worldId, Number(npcId));
  return rows.map(stockDto);
}

export function stockNeedsRoll(db, worldId, npcId, now = Date.now()) {
  const row = db.prepare(`SELECT COUNT(*) AS total, MAX(next_roll_at) AS next FROM town_npc_stock
    WHERE world_id = ? AND npc_id = ?`).get(worldId, npcId);
  if (!row?.total) return true;
  const alive = db.prepare(`SELECT COUNT(*) AS n FROM town_npc_stock WHERE world_id = ? AND npc_id = ? AND sold_at IS NULL`)
    .get(worldId, npcId).n;
  if (!alive) return true;
  return (row.next ?? 0) <= now;
}

function loadNpc(db, npcId) {
  const npc = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(Number(npcId));
  if (!npc) throw townError('NPC_NOT_FOUND');
  return npc;
}

async function requestStock(npc, plan, options = {}) {
  const llm = options.llm?.chatSync || chatSync;
  const text = await llm(buildStockMessages(npc, plan), { temperature: 0.95, max_tokens: 2000, label: '小镇货架生成' });
  return parseStockPayload(text, plan);
}

/** 生成本期货架并落库；图片异步生成。force=true 时无视 7 天周期直接换货。 */
export async function rollNpcStock({ worldId = 'default', npcId, force = false, llm } = {}) {
  const db = getDb();
  const npc = loadNpc(db, npcId);
  const now = Date.now();
  if (!force && !stockNeedsRoll(db, worldId, npc.id, now)) {
    return listNpcStock({ worldId, npcId: npc.id });
  }
  const seed = `${worldId}:${npc.id}:${now}`;
  const count = pickStockCount(seed);
  const plan = { ...splitStockPlan(count, seed), count };
  const parsed = await requestStock(npc, plan, { llm });
  const nextRollAt = now + STOCK_ROLL_MS;
  const inserted = db.transaction(() => {
    db.prepare('DELETE FROM town_npc_stock WHERE world_id = ? AND npc_id = ?').run(worldId, npc.id);
    const insert = db.prepare(`INSERT INTO town_npc_stock
      (world_id, npc_id, template_id, template_version, effect_key, price, custom_name, custom_desc, image_prompt,
       image_url, image_status, favor_delta, source, rolled_at, next_roll_at, sold_at)
      VALUES (?, ?, '', 1, ?, ?, ?, ?, ?, NULL, 'pending', ?, 'llm', ?, ?, NULL)`);
    const ids = [];
    for (const good of parsed) {
      const info = insert.run(worldId, npc.id, good.effectKey, good.price, good.title, good.description,
        good.imagePrompt, good.favor, now, nextRollAt);
      ids.push(Number(info.lastInsertRowid));
    }
    return ids;
  }).immediate();
  for (const id of inserted) {
    generateStockImageAsync(id, { llm: undefined }).catch(() => {});
  }
  broadcastTownStateUpdated({ reason: 'npc_stock_rolled' });
  broadcast(STOCK_ROLLED_EVENT, { worldId, npcId: npc.id, count: inserted.length });
  return listNpcStock({ worldId, npcId: npc.id });
}

/** 供读取路径使用：缺货/过期时先补货（异步 LLM），再返回当前货架。 */
export async function ensureNpcStock({ worldId = 'default', npcId, force = false, llm } = {}) {
  const db = getDb();
  const npc = loadNpc(db, npcId);
  if (force || stockNeedsRoll(db, worldId, npc.id, Date.now())) {
    return rollNpcStock({ worldId, npcId: npc.id, force: true, llm });
  }
  return listNpcStock({ worldId, npcId: npc.id });
}

/** 原子抢占一件待画/画失败的货品图标；抢不到（已 ready / 次数用尽）直接返回。 */
async function generateStockImageAsync(stockId, options = {}) {
  const db = getDb();
  const maxAttempts = options.maxAttempts ?? STOCK_IMAGE_MAX_ATTEMPTS;
  const claim = db.prepare(`UPDATE town_npc_stock SET image_attempts = image_attempts + 1
    WHERE id = ? AND image_status <> 'ready' AND image_attempts < ?`).run(stockId, maxAttempts);
  if (claim.changes !== 1) return;
  const row = db.prepare('SELECT * FROM town_npc_stock WHERE id = ?').get(stockId);
  if (!row) return;
  const generate = options.generateImageRaw || generateImageRaw;
  const prompt = row.image_prompt
    || `game item icon, ${row.custom_name}, floating, glowing softly, no humans, simple background, best quality`;
  const onProgress = p => {
    const percent = percentFromProgress(p);
    if (percent == null) return;
    broadcast(STOCK_IMAGE_PROGRESS_EVENT, { stockId, npcId: row.npc_id, progress: percent });
  };
  try {
    const result = await generate(prompt, {
      scene: STOCK_SCENE,
      disableRAG: true,
      persistPreparation: false,
      width: 512,
      height: 512,
      artist: '@ebora',
      priority: 'low',
      onProgress,
    });
    if (!result?.success || !Array.isArray(result.images) || !result.images.length) throw new Error('image failed');
    const image = result.images[0];
    const url = saveBase64Image(STOCK_SCENE, `npc_stock_${stockId}_${Date.now()}_${image.filename || 'comfy.png'}`, image.base64);
    db.prepare("UPDATE town_npc_stock SET image_url = ?, image_status = 'ready' WHERE id = ?").run(url, stockId);
    broadcast(STOCK_IMAGE_READY_EVENT, { stockId, npcId: row.npc_id, imageUrl: url });
  } catch (error) {
    db.prepare("UPDATE town_npc_stock SET image_status = 'failed' WHERE id = ?").run(stockId);
    broadcast(STOCK_IMAGE_READY_EVENT, { stockId, npcId: row.npc_id, imageUrl: null, error: error?.message || 'STOCK_IMAGE_FAILED' });
  }
}

/**
 * 后台补画：把待画 / 画失败 / 进程中断的货品图标补齐（有次数上限）。
 * 由 townNpcStockScheduler 周期调用，保证玩家打开货摊时图片已经生成好，而不是点开才画。
 */
export async function ensureStockImages({ worldId = null, limit = 4, minAgeMs = 60_000, generateImageRaw: injected } = {}) {
  const db = getDb();
  const cutoff = Date.now() - minAgeMs;
  const rows = db.prepare(`SELECT id FROM town_npc_stock
    WHERE image_status <> 'ready' AND image_attempts < ? AND rolled_at <= ?
    ${worldId ? 'AND world_id = ?' : ''}
    ORDER BY rolled_at ASC LIMIT ?`).all(
      ...(worldId ? [STOCK_IMAGE_MAX_ATTEMPTS, cutoff, worldId, limit] : [STOCK_IMAGE_MAX_ATTEMPTS, cutoff, limit]),
    );
  let done = 0;
  for (const row of rows) {
    await generateStockImageAsync(row.id, { generateImageRaw: injected });
    done++;
  }
  return done;
}

// -- 购买 --

/** 货品直接写进背包（与开宝箱同构：不进 item_templates，避免为每件随机货建模板）。 */
function insertBackpackItem(db, { worldId, sourceId, effectKey, name, description, imageUrl }) {
  const info = db.prepare(`INSERT INTO backpack_items
    (effect_key, name, description, rarity, image_url, status, payload_json, owner_key, source_type, world_id,
     source_id, source_index, collected_at, acquired_at, version)
    VALUES (?, ?, ?, 'common', ?, 'ready', '{}', 'me', 'trade', ?, ?, 0, datetime('now'), datetime('now'), 1)`)
    .run(effectKey, name, description, imageUrl || null, worldId, sourceId);
  return Number(info.lastInsertRowid);
}

/**
 * 买下货架上的货品：扣邻币 -> 进背包 -> 随机提升好感度。
 * 幂等：同一件货的 sourceId 只入包一次，重放请求直接返回同一份收据。
 */
export function createTownNpcStockService({ db, clock, registry, economy }) {
  if (!db?.transaction || !clock?.now || !registry?.getWorldEpoch || !economy?.transfer) {
    throw townError('MISSING_DEPENDENCY');
  }
  const now = () => clock.now();
  function epoch(input) {
    if (!Number.isSafeInteger(input?.worldEpoch) || registry.getWorldEpoch(input.worldId) !== input.worldEpoch) {
      throw townError('STALE_EPOCH');
    }
  }
  function ensureFavor(worldId, npcId) {
    const existing = db.prepare('SELECT favor FROM town_npc_favor WHERE world_id = ? AND npc_id = ?').get(worldId, npcId);
    if (existing) return existing.favor;
    db.prepare('INSERT INTO town_npc_favor (world_id, npc_id, favor, updated_at) VALUES (?, ?, 0, ?)')
      .run(worldId, npcId, now());
    return 0;
  }
  function grantFavor(worldId, npcId, delta) {
    const before = ensureFavor(worldId, npcId);
    const after = before + delta;
    db.prepare(`INSERT INTO town_npc_favor (world_id, npc_id, favor, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(world_id, npc_id) DO UPDATE SET favor = excluded.favor, updated_at = excluded.updated_at`)
      .run(worldId, npcId, after, now());
    return { before, after, delta };
  }
  function npcBusinessAccountId(input, npcId) {
    return economy.ensureAccount({ ...input, ownerKey: `npc:${npcId}`, accountType: 'business' }).accountId;
  }
  function playerAccount(input) {
    const me = registry.resolveAgentKey('me');
    return economy.ensureAccount({ ...input, ownerKey: `actor:${me.actorId}`, actorId: me.actorId, accountType: 'actor' });
  }
  function receipt(stock, itemRow, favor) {
    return {
      stock: stockDto({ ...stock, sold_at: stock.sold_at ?? now() }),
      money: { delta: -stock.price, amount: stock.price, direction: 'pay' },
      favor,
      item: itemRow ? { id: itemRow.id, name: itemRow.name, description: itemRow.description, imageUrl: itemRow.image_url } : null,
    };
  }
  function buyStock(npcId, stockId, input) {
    epoch(input);
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) throw townError('INVALID_IDEMPOTENCY_KEY');
    return db.transaction(() => {
      const npc = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(Number(npcId));
      if (!npc) throw townError('NPC_NOT_FOUND');
      const stock = db.prepare('SELECT * FROM town_npc_stock WHERE id = ? AND world_id = ? AND npc_id = ?')
        .get(Number(stockId), input.worldId, npc.id);
      if (!stock) throw townError('STOCK_NOT_FOUND');
      const sourceId = `npc-stock:${stock.id}`;
      const existingItem = db.prepare(`SELECT * FROM backpack_items WHERE world_id = ? AND owner_key = 'me'
        AND source_type = 'trade' AND source_id = ?`).get(input.worldId, sourceId);
      if (stock.sold_at != null || existingItem) {
        if (!existingItem) throw townError('STOCK_SOLD');
        // 同一件货只入包一次：重放请求返回同一份收据，不再扣款。
        const favorNow = getNpcFavor(db, input.worldId, npc.id);
        return { ...receipt(stock, existingItem, { before: favorNow, delta: 0, after: favorNow }),
          alreadyOwned: true, money: { delta: 0, amount: 0, direction: 'none' } };
      }
      const player = playerAccount(input);
      const npcAccountId = npcBusinessAccountId(input, npc.id);
      economy.transfer({
        ...input,
        idempotencyKey: `npc-stock:${input.idempotencyKey}`,
        sourceKey: `npc-stock:${stock.id}:${input.idempotencyKey}`,
        reasonCode: 'NPC_STOCK_PURCHASE',
        amount: stock.price,
        fromAccountId: player.accountId,
        toAccountId: npcAccountId,
      });
      const favor = grantFavor(input.worldId, npc.id, stock.favor_delta);
      const itemId = insertBackpackItem(db, {
        worldId: input.worldId,
        sourceId,
        effectKey: stock.effect_key || 'favor_candy',
        name: stock.custom_name,
        description: stock.custom_desc,
        imageUrl: stock.image_url,
      });
      db.prepare('UPDATE town_npc_stock SET sold_at = ? WHERE id = ? AND sold_at IS NULL').run(now(), stock.id);
      const itemRow = db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(itemId);
      return receipt({ ...stock, sold_at: now() }, itemRow, favor);
    }).immediate();
  }
  return { buyStock, getFavor: (worldId, npcId) => getNpcFavor(db, worldId, npcId), grantFavor, ensureFavor };
}

/** 运行时装配：真实 economy 由调用方注入（见 townEconomyRuntime）。 */
export async function getTownNpcStockView({ worldId = 'default', npcId, refresh = false } = {}) {
  const db = getDb();
  const npc = loadNpc(db, npcId);
  // 只有拥有交易权限的居民才有货架，避免给普通居民误生成货品。
  if (!townCapabilities(npc).includes('trade')) throw townError('NOT_A_TRADER');
  // 显式刷新（服务管理面板）才等待换货；正常读取只读，绝不在点开时现生成。
  if (refresh) {
    const goods = await rollNpcStock({ worldId, npcId: npc.id, force: true });
    return { npcId: npc.id, displayName: npc.display_name, favor: getNpcFavor(db, worldId, npc.id), goods, rolling: false };
  }
  const rolling = stockNeedsRoll(db, worldId, npc.id, Date.now());
  if (rolling) rollNpcStock({ worldId, npcId: npc.id, force: true }).catch(() => {});
  return { npcId: npc.id, displayName: npc.display_name, favor: getNpcFavor(db, worldId, npc.id),
    goods: listNpcStock({ worldId, npcId: npc.id }), rolling };
}
