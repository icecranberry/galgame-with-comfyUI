import { createHash } from 'node:crypto';
import { canonicalJson, townError } from './townEventService.js';

/** NPC 固定功能按职业分配，functions_json 持久化。
 * 模型只负责"知道并表达"这些功能，是否给、给什么、什么价，全部由服务端决定。
 */
export const NPC_FUNCTION_TYPES = Object.freeze(['dialogue', 'gift_giver', 'trader']);

const GIFT_POOL = Object.freeze([
  Object.freeze({ templateId: 'town.mood_patch', templateVersion: 1 }),
  Object.freeze({ templateId: 'town.energy_charm', templateVersion: 1 }),
]);
const GIFT_COOLDOWN_MS = 24 * 3600000;

const TRADER_SELLS = Object.freeze([
  Object.freeze({ templateId: 'town.mood_patch', templateVersion: 1, price: 15 }),
  Object.freeze({ templateId: 'town.energy_charm', templateVersion: 1, price: 15 }),
  Object.freeze({ templateId: 'town.tavern_meal', templateVersion: 1, price: 10 }),
]);
const TRADER_STARTING_BALANCE = 200;

const JOB_TRADE_KEYWORDS = Object.freeze(['商', '店', '摊', '市', '掌柜', '老板', '货郎', '杂货']);
const JOB_GIFT_KEYWORDS = Object.freeze(['医', '师', '匠', '厨', '花', '茶', '糕', '裁缝', '教书', '先生']);

/** NPC 视角的功能描述：只写给模型看的功能事实，不含价格与库存细节。 */
export function describeNpcFunctions(functions) {
  const lines = [];
  if (functions?.gift_giver) lines.push('你随身带着亲手做的小物件，遇到聊得来的来访者会大方送出去（一天最多一份）。');
  if (functions?.trader) lines.push(functions.trader.sells?.length
    ? '你在做点小买卖，只卖不收；让对方在交易面板操作，不要擅自报价或声称已完成交易。'
    : '你的店通过店内柜台卖货，不摆个人货摊；不要擅自报价或声称已完成交易。');
  return lines.join('');
}

const hashSeed = value => parseInt(createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16);

function validate(functions) {
  if (!functions || typeof functions !== 'object' || Array.isArray(functions)) throw townError('INVALID_NPC_FUNCTIONS');
  const keys = Object.keys(functions);
  if (!keys.length || keys.some(key => !NPC_FUNCTION_TYPES.includes(key))) throw townError('INVALID_NPC_FUNCTIONS');
  if (keys.length !== new Set(keys).size) throw townError('INVALID_NPC_FUNCTIONS');
  if (functions.dialogue && (functions.dialogue.version !== 2 || typeof functions.dialogue.job !== 'string')) throw townError('INVALID_NPC_FUNCTIONS');
  if (functions.gift_giver != null) {
    const pool = functions.gift_giver.itemPool, cooldown = functions.gift_giver.cooldownMs;
    if (!Array.isArray(pool) || !pool.length || !pool.every(item => typeof item?.templateId === 'string'
      && Number.isSafeInteger(item?.templateVersion))) throw townError('INVALID_NPC_FUNCTIONS');
    if (!Number.isSafeInteger(cooldown) || cooldown < 60000) throw townError('INVALID_NPC_FUNCTIONS');
  }
  if (functions.trader != null) {
    const list = functions.trader.sells;
    if (!Array.isArray(list) || !list.length || !list.every(spec => typeof spec?.templateId === 'string'
      && Number.isSafeInteger(spec?.templateVersion) && Number.isSafeInteger(spec?.price) && spec.price >= 0)) throw townError('INVALID_NPC_FUNCTIONS');
  }
  return functions;
}

/** 分配规则：job 关键词优先，其余按稳定种子二选一。 */
function legacyNpcFunctions(npc) {
  const seed = Number.isSafeInteger(npc?.id) ? npc.id : hashSeed(npc?.id ?? npc?.display_name ?? '');
  const job = String(npc?.job || '');
  const isTrader = JOB_TRADE_KEYWORDS.some(keyword => job.includes(keyword));
  const isGiftGiver = !isTrader && JOB_GIFT_KEYWORDS.some(keyword => job.includes(keyword));
  const specialty = isTrader ? 'trader' : isGiftGiver ? 'gift_giver' : (seed % 2 === 0 ? 'trader' : 'gift_giver');
  const functions = {};
  if (specialty === 'trader') functions.trader = { sells: TRADER_SELLS };
  else functions.gift_giver = { itemPool: GIFT_POOL, cooldownMs: GIFT_COOLDOWN_MS };
  return validate(functions);
}

/** 职责决定固定功能；普通居民保留对话，不再按编号随机开店。 */
export function assignNpcFunctions(npc) {
  const job = String(npc?.job || '');
  const functions = { dialogue: { version: 2, job } };
  if (/服装|裁缝|时装|裁衣/.test(job)) functions.trader = {
    sells: [{ templateId: 'town.ready_yukata', templateVersion: 1, price: 18 },
      { templateId: 'town.clothing_piece', templateVersion: 1, price: 22 }],
  };
  else if (!/理发|按摩|护理/.test(job) && JOB_TRADE_KEYWORDS.some(keyword => job.includes(keyword))) {
    functions.trader = { sells: TRADER_SELLS };
  } else if (/茶艺|花艺|医师|糕点/.test(job)) {
    functions.gift_giver = { itemPool: GIFT_POOL, cooldownMs: GIFT_COOLDOWN_MS };
  }
  return validate(functions);
}

export const NPC_TRADE_STARTING_BALANCE = TRADER_STARTING_BALANCE;
export { GIFT_COOLDOWN_MS, GIFT_POOL, TRADER_SELLS };

/** 读取（并按需补齐）某居民的 functions_json；损坏的声明按重新分配处理，绝不把坏数据吐给调用方。 */
export function ensureNpcFunctions(db, npcRow) {
  if (!npcRow?.id) throw townError('NPC_NOT_FOUND');
  if (npcRow.functions_json) {
    try {
      const saved = validate(JSON.parse(npcRow.functions_json));
      // 只迁移旧自动分配的原样声明；手工维护的功能保留。
      if (saved.dialogue) {
        if (saved.dialogue.job === String(npcRow.job || '')
          || canonicalJson(saved) !== canonicalJson(assignNpcFunctions({ ...npcRow, job: saved.dialogue.job }))) return saved;
      } else if (canonicalJson(saved) !== canonicalJson(legacyNpcFunctions(npcRow))) return saved;
    }
    catch { /* fall through to reassign */ }
  }
  const functions = assignNpcFunctions(npcRow);
  db.prepare('UPDATE town_npcs SET functions_json = ? WHERE id = ?')
    .run(canonicalJson(functions), npcRow.id);
  return functions;
}
