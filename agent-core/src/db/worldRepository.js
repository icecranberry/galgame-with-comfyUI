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

/**
 * 世界观注入前的默认变换：**裁掉「## 人们的行为」整段**。
 *
 * ── 为什么必须裁（实测证据，2026-10-04 A/B）────────────────────
 * 那一节是十几条**氛围例句**（「在街上看到幻造种的时候，大家通常会多看两眼…」），
 * 文体是"示例"，不是"规则"。它在 prompt 里的位置（紧跟在规则之后的一整列生动描写）
 * 让 LLM 天然把它当 few-shot 示范，产生两类危害：
 *
 *   1. **文字链路复读措辞** —— 产出「锅还开着」「报数报到三十七了」这类复读式文案；
 *      规则层写「不要照抄设定」压不过上下文里的生动范例。
 *   2. **生图链路搬错意象**（用户报的核心问题）—— 那些例句里塞满了具体视觉道具
 *      （折叠凳、石栏、闸口、卡座、直播机位、折叠桌…）与**自造名词**（幻造种、愿宝、
 *      谒者、假面愚者）。LLM 会把它们当成"该画的画面清单"，而自造名词它不认识，
 *      会退化成最接近的常见概念：**"肋侧还没画完的幻造种"→ 人类肋骨**、
 *      **"袖口里探出来的触手"→ 章鱼触手**。
 *      A/B 实测：完整世界观 → 命中 `rib` + `tentacle`；裁掉后 → 零命中，
 *      且画面反而正确用上了「视觉锚点」章节（@雕塑、银杏并木道、扭蛋机、AR 投影）。
 *
 * ── 裁什么、留什么 ─────────────────────────────────────────
 * **只裁这一节**。「世界背景 / 视觉锚点 / 日间区域 / 夜间区域 / 世界尽头酒馆 /
 * 日常规则 / 深层逻辑」全部保留 —— 世界观照样生效，因为：
 *   · 文字链路需要的是"知道什么是正常的"（规则），不是"背例句"；
 *   · 生图链路需要的是"视觉锚点 + 该画什么"（日常规则里的生图约束仍在）。
 *
 * ── 2026-10-04 后续：该节已按用户要求「精简为纯原则」 ─────────
 * 二相乐园那份世界观里的「## 人们的行为」已被改写为纯原则并**改名为「## 社会基调」**，
 * 于是不再命中本函数的裁剪规则 → 新内容正常注入（内容安全了就不必再裁）。
 * **本函数保留作通用兜底**：其他世界观（如「武装JK世界」）若仍有「## 人们的行为」
 * 这类例句节，仍会被自动裁掉 —— 与其逐个世界观去改内容，不如在注入层统一守一道。
 *
 * @param {string} worldSetting 原始 <world_setting> 文本
 * @param {'strip'|'annotate'|'keep'} mode
 *   - strip    ：整段剔除（默认）
 *   - annotate ：保留内容，但段首插一行"这是氛围不是台词"的警示
 *   - keep     ：原样返回
 */
const WORLD_BEHAVIOR_HEADING_RE = /^#{1,6}\s*人们的行为\s*$/;

export function adaptWorldText(worldSetting, mode = 'strip') {
  const text = String(worldSetting || '');
  if (!text || mode === 'keep') return text;

  const lines = text.split('\n');
  const out = [];
  let skipping = false;
  let found = false;

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      const isBehavior = WORLD_BEHAVIOR_HEADING_RE.test(line.trim());
      if (isBehavior) {
        found = true;
        if (mode === 'annotate') {
          out.push(line, '');
          out.push('> 【氛围参考，不是台词库，更不是画面清单】以下描述的是这个世界"平时是什么样"，用来理解这里的常态；**不要引用、复述或改写其中任何一句的措辞，也不要把其中的具体物件当作画面元素**。世界感靠"理所当然"透出来即可。');
          skipping = false;
        } else {
          skipping = true; // strip：标题也不保留
        }
        continue;
      }
      skipping = false;
    }
    if (!skipping) out.push(line);
  }

  if (!found) return text; // 世界观里没有这一节 → 原样返回，不动
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** getSystemRules() + 世界观拼接，供需要世界设定的调用方使用。
 *
 * ★ **默认会裁掉「## 人们的行为」整段**（见 `adaptWorldText`）。这是刻意的默认值：
 *   那一节是十几条**生动的氛围例句**，任何链路把它喂给 LLM 都会被当成 few-shot 示范 ——
 *   文字链路复读其措辞，生图链路更是把其中的**具体意象直接搬进画面**并理解错
 *   （实测：那条「肋侧还没画完的幻造种 / 袖口里探出来的触手」会被画成**人类肋骨与章鱼触手**）。
 *   而世界规则本身在「世界背景 / 视觉锚点 / 区域设定 / 日常规则 / 深层逻辑」里都完整保留。
 *
 * @param {object} [opts]
 * @param {(world: string) => string|null} [opts.worldTransform] - 覆盖默认的世界观变换。
 *   - 不传 → 用默认的 `adaptWorldText`（裁例句段）
 *   - 传函数 → 用传入的（如 `adaptWorldText.bind(null, ...)` 换 mode）
 *   - 传 `null` → **显式保留原文**（逃生口，仅供确需例句的场景）
 * @param {boolean} [opts.roleplay] - 透传给 getSystemRules()
 */
export function getSystemRulesWithWorld(opts = {}) {
  const { worldTransform, ...ruleOpts } = opts;
  const rules = getSystemRules(ruleOpts);
  const rawWorld = getWorldSetting();
  // 注意：这里要能区分「没传」与「显式传 null」——用 in 判断，不能用默认参数
  const transform = 'worldTransform' in opts ? worldTransform : adaptWorldText;
  const world = rawWorld && typeof transform === 'function' ? transform(rawWorld) : rawWorld;
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
