/**
 * pool_draw / daily_fortune 执行器（计划 §4.5、§12）。
 *
 * 随机性纪律：
 *   - 随机种子由服务端在操作创建时生成并持久化；重试、刷新、异步失败返回同一结果。
 *   - 奖池只含已绑定真实库存的产物，权重是有界正整数；服务端按剩余库存重算有效
 *     权重，空奖池禁止扣款（OUT_OF_STOCK）。
 *   - 每日签运从建档签文池按当日固定种子选择：同一天同建筑同玩家必出同一签，
 *     不因换目标、换配置版本或设备而变化；结果在揭晓后写入 usage，即使展示失败
 *     也不重抽。
 */
import { createHash, randomBytes } from 'node:crypto';
import { townError } from '../townEventService.js';
import { getLocalDateKey } from '../../../utils/localDate.js';
import { config } from '../../../config.js';

/** 服务端随机种子（操作创建时持久化到 operations.random_seed） */
export function createRandomSeed() {
  return randomBytes(16).toString('hex');
}

/** 种子 → 确定性伪随机数流（mulberry32） */
export function seededRandom(seedText) {
  const seedHex = createHash('sha256').update(String(seedText)).digest('hex').slice(0, 8);
  let state = Number.parseInt(seedHex, 16) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 加权选择（weights 为正整数） */
export function weightedPick(random, entries, weightOf) {
  const weights = entries.map(entry => {
    const weight = weightOf(entry);
    if (!Number.isSafeInteger(weight) || weight < 1) throw townError('INVALID_SELECTION');
    return weight;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = random() * total;
  for (let i = 0; i < entries.length; i++) {
    roll -= weights[i];
    if (roll < 0) return entries[i];
  }
  return entries[entries.length - 1];
}

/** 每日键：世界/建筑/功能/玩家/配置时区日期，不因换目标或设备变化（计划 §4.5、§7.4）。
 * 日期窗口取 config.town.timeZone（统一时间工具），默认 Asia/Shanghai。 */
export function dailyKey({ worldId, buildingInstanceId, featureId, playerActorId },
  dateKey = getLocalDateKey(new Date(Date.now()), config.town.timeZone)) {
  return { windowDate: dateKey, seed: createHash('sha256')
    .update(`${worldId}|${buildingInstanceId}|${featureId}|${playerActorId}|${dateKey}`).digest('hex') };
}

/**
 * 奖池抽取结果（不落库、不改库存——结算由运行时在事务内完成）。
 * 空奖池抛 OUT_OF_STOCK；availability 提供各资源剩余可用量（调用方从 economy 读取）。
 */
export function drawFromPool({ seed, pool, availability }) {
  const drawable = pool.filter(entry => (availability?.[entry.resourceKey] ?? 0) > 0);
  if (!drawable.length) throw townError('OUT_OF_STOCK');
  const picked = weightedPick(seededRandom(seed), drawable, entry => entry.weight);
  return picked;
}

/** 每日签运结果：当日固定种子从签文池加权选择 */
export function drawDailyFortune({ seed, entries }) {
  return weightedPick(seededRandom(seed), entries, entry => entry.weight);
}
