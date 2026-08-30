// 世界观 / 全局规则 / 系统规则仓储（独立模块，缩小 db/index.js 体积）。
// 依赖方向（单向）：db/index.js 打开数据库后注入句柄并再导出本模块的函数。
import { config } from '../config.js';
import { SYSTEM_RULES_CONTENT, IMAGE_PROMPT_RULE, BUILTIN_RULE_KEYS } from '../builtinRules.js';

let _db = null;

/** db/index.js 打开数据库后注入句柄（此模块不反向依赖 db/index.js） */
export function initWorldRepository(db) {
  _db = db;
}

function handle() {
  if (!_db) throw new Error('worldRepository: db handle not initialized (initWorldRepository)');
  return _db;
}

/**
 * 获取所有激活的全局规则内容（拼接为一个字符串）
 */
// image_intent / image_prompt 是元规则（非 LLM system prompt 内容），不拼入
// world_setting 单独追加到末尾，不在批量拼接中
// BUILTIN_RULE_KEYS 从 builtinRules.js 导入，统一管理所有硬编码规则

export function getActiveGlobalRules() {
  const database = handle();
  const excludeKeys = [...BUILTIN_RULE_KEYS, 'world_setting'];
  const rules = database.prepare(
    `SELECT rule_content FROM global_rules WHERE is_active = 1 AND rule_key NOT IN (${excludeKeys.map(() => '?').join(',')})`
  ).all(...excludeKeys);
  return rules.map(r => r.rule_content).join('\n\n');
}

/** 判断当前时间是否在指定时间段内（24 小时制，支持跨午夜） */
function isInDisturbTimeRange(now, startTime, endTime) {
  const toMinutes = (hhmm) => {
    const parts = String(hhmm).split(':');
    return parseInt(parts[0], 10) * 60 + (parseInt(parts[1], 10) || 0);
  };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = toMinutes(startTime);
  const endMin = toMinutes(endTime);
  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin < endMin;
  } else {
    return nowMin >= startMin || nowMin < endMin;
  }
}

/** 获取世界观（独立消息注入，不拼入全局规则）
 *  防打扰模式 hideWorld 开启时，时间段内返回 null 但不修改 DB 原值
 *  优先从 world_settings 表读取激活项，兼容旧 global_rules.world_setting */
export function getWorldSetting() {
  // 防打扰隐藏世界观：不改 DB，仅在 prompt 构建时返回 null
  if (config.features.disturbMode && config.disturb.hideWorld) {
    const now = new Date();
    if (isInDisturbTimeRange(now, config.disturb.startTime, config.disturb.endTime)) {
      if (!config.disturb.skipWeekends || (now.getDay() !== 0 && now.getDay() !== 6)) {
        return null;
      }
    }
  }

  // 只要存在激活项就以它为准：内容为空视为用户主动选择"无世界观"，不再回退旧表
  const active = getActiveWorldSetting();
  if (active) {
    return active.content?.trim() ? `<world_setting>\n${active.content}\n</world_setting>` : null;
  }

  // 兼容旧表（仅 world_settings 表无激活项时）
  const world = getGlobalRule('world_setting');
  if (world?.rule_content && world.is_active) {
    return world.rule_content;
  }
  return null;
}

/** getSystemRules() + 世界观拼接，供需要世界设定的调用方使用 */
export function getSystemRulesWithWorld(opts = {}) {
  const rules = getSystemRules(opts);
  const world = getWorldSetting();
  return [rules, world].filter(Boolean).join('\n\n');
}

/** 获取单条全局规则（用于元规则如 judge_prompt）。内置规则直接返回硬编码常量。 */
export function getGlobalRule(key) {
  if (BUILTIN_RULE_KEYS.has(key)) {
    return key === 'image_prompt' ? IMAGE_PROMPT_RULE : null;
  }
  const database = handle();
  return database.prepare(`SELECT * FROM global_rules WHERE rule_key = ?`).get(key);
}

/**
 * 获取系统规则（破限词：system_context + core_rules），统一各场景的 jailbreak。
 *
 * @param {object} [options]
 * @param {boolean} [options.roleplay=true] - 是否包含 `<roleplay>` 内的角色扮演激活指令。
 *   为 false 时仅返回基础上下文（虚构文学定位、创作自由），适用于无需角色扮演的流程。
 */
export function getSystemRules({ roleplay = true } = {}) {
  const content = SYSTEM_RULES_CONTENT;

  // 基础内容
  let base = '';
  const rpMatch = content.match(/<roleplay>([\s\S]*?)<\/roleplay>/);
  if (!rpMatch) {
    base = content;  // 无标签（旧数据），向下兼容
  } else {
    const before = content.slice(0, rpMatch.index).trim();
    // 基础上下文始终保留，roleplay 指令按需包含
    base = roleplay ? before + '\n\n' + rpMatch[1].trim() : before;
  }

  return base;
}

// ── 世界观收藏 CRUD ──

export function listWorldSettings() {
  const database = handle();
  return database.prepare(`SELECT * FROM world_settings ORDER BY sort_order, id`).all();
}

export function getActiveWorldSetting() {
  const database = handle();
  return database.prepare(`SELECT * FROM world_settings WHERE is_active = 1`).get() || null;
}

export function getWorldSettingById(id) {
  const database = handle();
  return database.prepare(`SELECT * FROM world_settings WHERE id = ?`).get(id);
}

export function createWorldSetting({ name, content }) {
  const database = handle();
  const maxOrder = database.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM world_settings`).get().m;
  const result = database.prepare(
    `INSERT INTO world_settings (name, content, is_active, sort_order) VALUES (?, ?, 0, ?)`
  ).run(name, content, maxOrder + 1);
  return getWorldSettingById(result.lastInsertRowid);
}

export function updateWorldSetting(id, { name, content }) {
  const database = handle();
  const sets = [];
  const params = [];
  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (content !== undefined) { sets.push('content = ?'); params.push(content); }
  if (sets.length === 0) return null;
  sets.push("updated_at = datetime('now')");
  params.push(id);
  database.prepare(`UPDATE world_settings SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getWorldSettingById(id);
}

export function deleteWorldSetting(id) {
  const database = handle();
  const count = database.prepare(`SELECT COUNT(*) AS c FROM world_settings`).get().c;
  if (count <= 1) return { ok: false, error: '不可删除最后一套世界观' };
  const target = getWorldSettingById(id);
  if (!target) return { ok: false, error: '世界观不存在' };
  database.prepare(`DELETE FROM world_settings WHERE id = ?`).run(id);
  if (target.is_active) {
    const first = database.prepare(`SELECT id FROM world_settings LIMIT 1`).get();
    if (first) {
      database.prepare(`UPDATE world_settings SET is_active = 1 WHERE id = ?`).run(first.id);
    }
  }
  return { ok: true };
}

export function activateWorldSetting(id) {
  const database = handle();
  const target = getWorldSettingById(id);
  if (!target) return null;
  database.prepare(`UPDATE world_settings SET is_active = 0`).run();
  database.prepare(`UPDATE world_settings SET is_active = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  return getWorldSettingById(id);
}
