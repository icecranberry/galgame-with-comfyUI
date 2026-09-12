import { createHash } from 'node:crypto';
import { canonicalJson, townError } from './townEventService.js';

/** NPC 功能点声明：每个镇上居民至少有一个功能（给任务 / 送东西 / 做买卖），
 * 由 job 关键词与稳定种子自动分配， functions_json 落库后不再漂移。
 * 模型只负责"知道并表达"这些功能，是否给、给什么、什么价，全部由服务端决定。
 */
export const NPC_FUNCTION_TYPES = Object.freeze(['quest_giver', 'gift_giver', 'trader']);

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
const TRADER_BUYS = Object.freeze([
  Object.freeze({ templateId: 'town.tavern_meal', templateVersion: 1, price: 8 }),
  Object.freeze({ templateId: 'town.inn_tea', templateVersion: 1, price: 8 }),
  Object.freeze({ templateId: 'town.study_note', templateVersion: 1, price: 8 }),
]);
const TRADER_STARTING_BALANCE = 200;

const JOB_TRADE_KEYWORDS = Object.freeze(['商', '店', '摊', '市', '掌柜', '老板', '货郎', '杂货']);
const JOB_GIFT_KEYWORDS = Object.freeze(['医', '师', '匠', '厨', '花', '茶', '糕', '裁缝', '教书', '先生']);

/** NPC 视角的功能描述：只写给模型看的功能事实，不含价格与库存细节。 */
export function describeNpcFunctions(functions) {
  const lines = [];
  if (functions?.quest_giver) lines.push('你偶尔会有一件想请来访者搭把手的小事，托付完成后你会请对方去公告站或你这里领一份心意。');
  if (functions?.gift_giver) lines.push('你随身带着亲手做的小物件，遇到聊得来的来访者会大方送出去（一天最多一份）。');
  if (functions?.trader) lines.push('你在做点小买卖，手上有几样常备的小货可以卖，也回收客人手里的同类物件；聊到买卖就让对方直接在交易面板里操作，不要在对话里报价或承诺价格。');
  return lines.join('');
}

const hashSeed = value => parseInt(createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16);

function validate(functions) {
  if (!functions || typeof functions !== 'object' || Array.isArray(functions)) throw townError('INVALID_NPC_FUNCTIONS');
  const keys = Object.keys(functions);
  if (!keys.length || keys.some(key => !NPC_FUNCTION_TYPES.includes(key))) throw townError('INVALID_NPC_FUNCTIONS');
  if (keys.length !== new Set(keys).size) throw townError('INVALID_NPC_FUNCTIONS');
  if (functions.quest_giver != null) {
    const ids = functions.quest_giver.questTemplateIds;
    if (!Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === 'string' && id.length)) throw townError('INVALID_NPC_FUNCTIONS');
  }
  if (functions.gift_giver != null) {
    const pool = functions.gift_giver.itemPool, cooldown = functions.gift_giver.cooldownMs;
    if (!Array.isArray(pool) || !pool.length || !pool.every(item => typeof item?.templateId === 'string'
      && Number.isSafeInteger(item?.templateVersion))) throw townError('INVALID_NPC_FUNCTIONS');
    if (!Number.isSafeInteger(cooldown) || cooldown < 60000) throw townError('INVALID_NPC_FUNCTIONS');
  }
  if (functions.trader != null) {
    for (const key of ['sells', 'buys']) {
      const list = functions.trader[key];
      if (!Array.isArray(list) || !list.length || !list.every(spec => typeof spec?.templateId === 'string'
        && Number.isSafeInteger(spec?.templateVersion) && Number.isSafeInteger(spec?.price) && spec.price >= 0)) throw townError('INVALID_NPC_FUNCTIONS');
    }
  }
  return functions;
}

/** 分配规则：job 关键词优先，其余按稳定种子二选一；quest_giver 人人都算，
 * NPC 线奇遇按种子轮派两条，让不同居民托付的事不一样。
 */
export function assignNpcFunctions(npc, { npcQuestTemplateIds = [], npcQuestsPerNpc = 2 } = {}) {
  const seed = Number.isSafeInteger(npc?.id) ? npc.id : hashSeed(npc?.id ?? npc?.display_name ?? '');
  const job = String(npc?.job || '');
  const isTrader = JOB_TRADE_KEYWORDS.some(keyword => job.includes(keyword));
  const isGiftGiver = !isTrader && JOB_GIFT_KEYWORDS.some(keyword => job.includes(keyword));
  const specialty = isTrader ? 'trader' : isGiftGiver ? 'gift_giver' : (seed % 2 === 0 ? 'trader' : 'gift_giver');
  const questIds = npcQuestTemplateIds.length
    ? [...npcQuestTemplateIds.slice(seed % npcQuestTemplateIds.length),
      ...npcQuestTemplateIds.slice(0, seed % npcQuestTemplateIds.length)].slice(0, Math.min(npcQuestsPerNpc, npcQuestTemplateIds.length))
    : ['quest.npc.first_favor'];
  const functions = { quest_giver: { questTemplateIds: questIds } };
  if (specialty === 'trader') functions.trader = { sells: TRADER_SELLS, buys: TRADER_BUYS };
  else functions.gift_giver = { itemPool: GIFT_POOL, cooldownMs: GIFT_COOLDOWN_MS };
  return validate(functions);
}

export const NPC_TRADE_STARTING_BALANCE = TRADER_STARTING_BALANCE;
export { GIFT_COOLDOWN_MS, GIFT_POOL, TRADER_SELLS, TRADER_BUYS };

/** 读取（并按需补齐）某居民的 functions_json；损坏的声明按重新分配处理，绝不把坏数据吐给调用方。 */
export function ensureNpcFunctions(db, npcRow, { npcQuestTemplateIds = [] } = {}) {
  if (!npcRow?.id) throw townError('NPC_NOT_FOUND');
  if (npcRow.functions_json) {
    try { return validate(JSON.parse(npcRow.functions_json)); }
    catch { /* fall through to reassign */ }
  }
  const functions = assignNpcFunctions(npcRow, { npcQuestTemplateIds });
  db.prepare('UPDATE town_npcs SET functions_json = ? WHERE id = ?')
    .run(canonicalJson(functions), npcRow.id);
  return functions;
}
