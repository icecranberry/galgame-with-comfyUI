// 世界观 / 全局规则 / 系统规则仓储（独立模块，缩小 db/index.js 体积）。
// 依赖方向（单向）：db/index.js 打开数据库后注入句柄并再导出本模块的函数。
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { SYSTEM_RULES_CONTENT, IMAGE_PROMPT_RULE, BUILTIN_RULE_KEYS } from '../builtinRules.js';
import {
  scaffoldProject,
  writeWorldDoc,
  readProject,
  projectDirFor,
  slugForWorld,
  guessSlotsFromContent,
  neutralProject,
} from '../services/worldProjectLibrary.js';

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

/**
 * 获取世界观（独立消息注入，不拼入全局规则）。
 *
 * ⚠ 本函数返回**未经进化的原文**。要用"裁剪后的"版本请走 `getWorldSettingForPrompt()`
 *   或 `getSystemRulesWithWorld()`。
 *
 * ── ★★ 2026-10-07 为什么改成"默认已裁剪"（架构修正）────────────
 * 原先这里返回裸文本，裁剪只挂在 `getSystemRulesWithWorld()` 上 —— 结果全项目
 * **55 处调用点里有 22 处在裸用本函数**，裸文本直接进 prompt，**完全绕过保护**
 * （覆盖日程 / 网络 6 处 / 群聊 / 报纸 / 道具 / 小镇NPC / 叫醒 / 回复队列）。
 * 注释当时写着"所有链路自动生效"，实际没有 —— 因为更常用的入口没一起收口。
 *
 * 现在改为**在此单点收口**：本函数自身即返回裁剪后的文本，
 * 22 处一次性获得保护，且将来新链路不可能再"忘了 opt-in"。
 * 需要原文的场景走显式逃生口 `getWorldSettingRaw()`。
 *
 * 防打扰模式 hideWorld 开启时，时间段内返回 null 但不修改 DB 原值。
 * 优先从 world_settings 表读取激活项，兼容旧 global_rules.world_setting。
 */
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
    if (!active.content?.trim()) return null;
    const raw = `<world_setting>\n${active.content}\n</world_setting>`;
    // ★ 单点收口：按该世界观项目库声明的氛围节裁剪（未声明 → 原样，保守默认）
    return adaptWorldText(raw, 'strip', safeActiveSlots());
  }

  // 兼容旧表（仅 world_settings 表无激活项时）
  const world = getGlobalRule('world_setting');
  if (world?.rule_content && world.is_active) {
    return adaptWorldText(world.rule_content, 'strip', safeActiveSlots());
  }
  return null;
}

/**
 * 取原文（**逃生口**）—— 只有确需例句/原始文本的场景才用。
 * 其余一律用 `getWorldSetting()`（已裁剪）。
 */
export function getWorldSettingRaw() {
  const active = getActiveWorldSetting();
  if (active) return active.content?.trim() ? `<world_setting>\n${active.content}\n</world_setting>` : null;
  const world = getGlobalRule('world_setting');
  return (world?.rule_content && world.is_active) ? world.rule_content : null;
}

/** 读激活世界观的槽位；任何异常都回落中性值（不阻断注入） */
function safeActiveSlots() {
  try {
    const active = getActiveWorldSetting();
    if (!active) return neutralProject();
    return readProject(slugForWorld(active.name, active.id));
  } catch {
    return neutralProject();
  }
}

/**
 * 世界观注入前的默认变换：**裁掉该世界观声明为"氛围节"的段落**。
 *
 * ── ★★ 2026-10-07 架构修正：从"引擎硬编码章节名"改为"由世界观自己声明" ──
 *
 * **修正前的问题**：本函数原先用 `WORLD_BEHAVIOR_HEADING_RE = /^#{1,6}\s*人们的行为\s*$/`
 * 识别要裁的段落 —— 而「人们的行为」**只是某一个世界观的章节名**。
 * 换成「武装JK世界」（用「日常规则」）或「少女与战车」（用「核心设定」），
 * 这道保护**完全不生效，而且是静默的**。
 * 这是"引擎内置具体世界观知识"的典型症状（详见 2026-10-07 引擎实例化污染审计）。
 *
 * **修正后**：要裁哪些节，由**该世界观的独立项目库**声明
 * （`data/world-projects/<slug>/project.json` 的 `ambienceSections`）。
 * 引擎不再认识任何具体章节名，只认识"用户声明了这一节是氛围节"这个**通用概念**。
 *
 * ── 为什么要裁（实测证据仍然成立，2026-10-04 A/B）────────────
 * 氛围节是十几条**例句**，文体是"示例"不是"规则"。它在 prompt 里的位置让 LLM 天然当
 * few-shot 示范，产生两类危害：
 *   1. **文字链路复读措辞** —— 产出「锅还开着」「报数报到三十七了」这类复读式文案；
 *   2. **生图链路搬错意象** —— 例句里塞满具体视觉道具与**自造名词**，LLM 把它们当
 *      "该画的画面清单"，自造名词不认识就退化成最接近的常见概念
 *      （实测：「肋侧还没画完的幻造种」→ 人类肋骨、「袖口里探出来的触手」→ 章鱼触手）。
 *      A/B：完整世界观 → 命中 `rib`+`tentacle`；裁掉后 → 零命中。
 *
 * ⚠ **默认不裁**：项目库缺失或 `ambienceSections` 为空时，**原样返回**。
 *   这是刻意的保守默认 —— 存量世界观还没建项目库，行为必须与"没有这套机制"一致。
 *
 * @param {string} worldSetting 原始 <world_setting> 文本
 * @param {'strip'|'annotate'|'keep'} mode
 *   - strip    ：整段剔除（默认）
 *   - annotate ：保留内容，但段首插一行"这是氛围不是台词"的警示
 *   - keep     ：原样返回
 * @param {{ambienceSections?: string[]}} [slots] 该世界观声明的槽位（来自项目库）
 */
export function adaptWorldText(worldSetting, mode = 'strip', slots = null) {
  const text = String(worldSetting || '');
  if (!text || mode === 'keep') return text;

  // ★ 引擎不认识具体章节名 —— 只认"被声明为氛围节"的标题集合
  const declared = (slots?.ambienceSections || []).map(s => String(s).trim()).filter(Boolean);
  if (declared.length === 0) return text;   // 没声明 → 不裁（保守默认）

  const isAmbience = (heading) => declared.includes(heading);

  const lines = text.split('\n');
  const out = [];
  let skipping = false;
  let found = false;

  for (const line of lines) {
    const m = line.match(/^#{1,6}\s*(.+?)\s*$/);
    if (m) {
      if (isAmbience(m[1])) {
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

  if (!found) return text; // 声明的节在这份世界观里不存在 → 原样返回，不动
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 取【当前激活世界观】的项目库槽位。
 * 读不到（存量世界观无项目库）→ 返回中性值，**等价于"没有这套机制"**。
 */
export function getActiveWorldSlots() {
  const active = getActiveWorldSetting();
  if (!active) return neutralProject();
  try {
    return readProject(slugForWorld(active.name, active.id));
  } catch (err) {
    console.warn(`[worldRepository] 读取世界观项目库失败，回落中性默认值: ${err.message}`);
    return neutralProject();
  }
}

/** getSystemRules() + 世界观拼接，供需要世界设定的调用方使用。
 *
 * ★ 裁剪**由世界观自己声明**（项目库 `ambienceSections`），引擎不内置任何章节名。
 *   未声明 → 不裁（保守默认，保证存量行为不变）。
 *
 * @param {object} [opts]
 * @param {(world: string) => string|null} [opts.worldTransform] - 覆盖默认的世界观变换。
 *   - 不传 → 用默认的 `adaptWorldText`（按项目库声明裁剪）
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
  const slots = getActiveWorldSlots();
  const world = rawWorld && typeof transform === 'function'
    // 默认变换需要槽位；用户自定义的 transform 按其自身签名调用，不替它塞参数
    ? (transform === adaptWorldText ? adaptWorldText(rawWorld, 'strip', slots) : transform(rawWorld))
    : rawWorld;
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
  const created = getWorldSettingById(result.lastInsertRowid);

  // ── 同步建立**独立项目库**（2026-10-07 用户裁定）────────────────
  // 目的：给这个世界观的专属知识一个"安放之处"，引擎从此只读取、不内置。
  // ⚠ 失败**不能**阻断创建：项目库只是增强，DB 才是真源（世界观建不出来才是事故）。
  try {
    const guessed = guessSlotsFromContent(content);
    scaffoldProject({ name, id: created.id, content, ambienceSections: guessed.ambienceSections });
  } catch (err) {
    console.warn(`[worldRepository] 世界观项目库建立失败（不影响创建）: ${err.message}`);
  }

  return created;
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
  const updated = getWorldSettingById(id);

  // 项目库同步：正文镜像跟着写；**不改** project.json 里的槽位（那是用户/引擎的选择，正文编辑不该覆盖）
  try {
    const slug = slugForWorld(updated.name, updated.id);
    writeWorldDoc(slug, updated.name, updated.content);
    const pj = path.join(projectDirFor(slug), 'project.json');
    if (!fs.existsSync(pj)) {
      scaffoldProject({ name: updated.name, id: updated.id, content: updated.content });
    }
  } catch (err) {
    console.warn(`[worldRepository] 世界观项目库同步失败（不影响保存）: ${err.message}`);
  }

  return updated;
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

  // ── 项目库：**不删目录，改名为 .deleted-<时间戳>** ──────────────
  // 理由：项目库里可能有用户手写的槽位与素材（不可再生）。
  // 删世界观是常规操作，不该顺手毁掉人工内容 —— 归档可逆，删除不可逆。
  try {
    const slug = slugForWorld(target.name, target.id);
    const dir = projectDirFor(slug);
    if (fs.existsSync(dir)) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      fs.renameSync(dir, `${dir}.deleted-${stamp}`);
      console.log(`[worldRepository] 世界观项目库已归档: ${slug}.deleted-${stamp}`);
    }
  } catch (err) {
    console.warn(`[worldRepository] 项目库归档失败（已删世界观，目录留在原地）: ${err.message}`);
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
