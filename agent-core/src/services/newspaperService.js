/**
 * 《邻舍日报》——小镇预告报纸
 *
 * 每天零点起（replyQueueScheduler 第一个调度 tick）触发生成一份"预告报纸"：
 *   - 4~5 条今天"将要发生"的新闻（普通新闻 3~4 条 + 1 条绑定随机角色的特稿），
 *     由 LLM 依据 <world_setting> 演算，每条配一幅插画
 *   - 15% 概率出现一条"世界状态"（影响全镇所有人，当天生效）；
 *     注入位置与道具 buff 相同（chat.js 稳定块[1]）
 *   - 绑定角色的特稿会在当天注入：该角色的私聊动态块、其所在群聊的轮次指令（群聊侧限额
 *     GROUP_INJECT_ROUNDS 轮，之后当天不再注入，避免特稿主角被反复提起），
 *     并驱动该角色当天额外发一条吐槽朋友圈（momentScheduler 消费 complaint_after）
 *
 * 纯函数（normalizeNewspaperDraft / build*Block / buildComplaintTopic 等）导出供测试。
 */

import { getDb, getSystemRules, getWorldSetting, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { generateImageRaw } from './imageSkill.js';
import { recordCompletedImageTask } from './imageTaskRecorder.js';
import { saveBase64Image } from './imagePaths.js';
import { config } from '../config.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { getLightNoteWithWeather } from './timeLight.js';
import { extractFirstJson, repairJson } from './eventGenerator.js';
import { buildCharacterPersona } from './characterPersona.js';
import { charArtistOverrideWithFallback } from './characterImageOpts.js';
import { ITEM_EFFECTS, WORLD_OUTFIT_CHANCE } from './itemService.js';

export const NEWSPAPER_NAME = '邻舍日报';
export const NEWSPAPER_TAGLINE = '今日事 · 早知道';
export const WORLD_STATE_PROBABILITY = 0.15;
// 群聊注入限额：报纸块只在该群的前 4 轮群聊里注入，之后当天不再出现。
// 天天每轮都提醒一次"今早的报纸写了谁"，特稿主角会被反复提起；限额让它只当开场谈资。
export const GROUP_INJECT_ROUNDS = 4;
// 每天零点起生成当天报纸：replyQueueScheduler 的第一个调度 tick 触发（内部自带去重/节流/错误兜底）
// 注：日程已不注入报纸素材，无需再等清晨日程刷新；零点刷新让"昨天的预告"与"今天的事"严格对应
export const GENERATION_HOUR = 0;
const FAIL_RETRY_DELAY_MS = 15 * 60 * 1000; // LLM 失败后 15 分钟内不重试

let generating = null;      // 当天生成任务的去重句柄
let lastFailedAt = 0;
let refillingImages = null; // 当天缺图补印的去重句柄
let lastImageRefillFailedAt = 0;

function toSQLiteDate(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// ── 查询 ──

export function getTodayNewspaper() {
  const db = getDb();
  return db.prepare('SELECT * FROM town_newspapers WHERE publish_date = ?').get(getLocalDateKey()) || null;
}

/** 报纸行 → 前端结构（绑定角色补充头像/名字；today 与历史回看共用） */
function mapPaperRowForFrontend(row) {
  const character = row.character_id ? dbCharacterBrief(row.character_id) : null;
  return {
    id: row.id,
    publish_date: row.publish_date,
    name: row.name || NEWSPAPER_NAME,
    edition: row.edition,
    items: safeParseJson(row.items_json) || [],
    character_event: safeParseJson(row.character_event_json),
    world_state: safeParseJson(row.world_state_json),
    world_dismissed: Boolean(row.world_dismissed),
    character: character ? { id: character.id, display_name: character.display_name, avatar_path: character.avatar_path } : null,
  };
}

/** 前端用：今天的报纸，没有则 null */
export function getTodayNewspaperForFrontend() {
  const row = getTodayNewspaper();
  return row ? mapPaperRowForFrontend(row) : null;
}

/** 前端用：历史期简目（最新在前；只给导航要用的轻量字段） */
export function listNewspaperEditions() {
  const rows = getDb().prepare(`
    SELECT id, publish_date, name, edition, items_json, character_event_json
    FROM town_newspapers
    ORDER BY publish_date DESC, edition DESC
  `).all();
  return rows.map(row => ({
    id: row.id,
    publish_date: row.publish_date,
    name: row.name || NEWSPAPER_NAME,
    edition: row.edition,
    item_count: (safeParseJson(row.items_json) || []).length,
    featured_title: safeParseJson(row.character_event_json)?.title || null,
  }));
}

/** 前端用：按日期回看某一期（含今天；没有该日期则 null） */
export function getNewspaperByDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
  const row = getDb().prepare('SELECT * FROM town_newspapers WHERE publish_date = ?').get(dateKey);
  return row ? mapPaperRowForFrontend(row) : null;
}

/**
 * 读者手动消除今天的世界影响：置 world_dismissed=1，当天不再注入任何提示词。
 * 报纸版面保留异闻文本（已印出的历史），只是「影响」被驱散；可再次开启。
 * @param {boolean} dismissed true=消除影响（停注），false=恢复影响（重新注入）
 * @returns {boolean} 是否有世界状态可供操作（没有异闻的报纸返回 false）
 */
export function setWorldStateDismissed(dismissed) {
  const db = getDb();
  const row = getTodayNewspaper();
  if (!row?.world_state_json) return false;
  const changed = db.prepare('UPDATE town_newspapers SET world_dismissed = ? WHERE id = ? AND world_dismissed != ?')
    .run(dismissed ? 1 : 0, row.id, dismissed ? 1 : 0).changes;
  if (changed > 0) {
    console.log(`[newspaper] World state ${dismissed ? 'dismissed' : 'restored'} for ${getLocalDateKey()}`);
  }
  return true;
}

function dbCharacterBrief(characterId) {
  return getDb().prepare('SELECT id, display_name, avatar_path FROM characters WHERE id = ?').get(characterId) || null;
}

// ── 生成调度入口（replyQueueScheduler tick 调用；不阻塞 tick） ──

export function maybeGenerateDailyNewspaper(now = new Date()) {
  if (now.getHours() < GENERATION_HOUR) return null;
  const existing = getTodayNewspaper();
  // 当天报纸已出：只剩补图一条路（生成中途重启 / ComfyUI 当时没开 / 单张失败都靠这里兜底）
  if (existing) return maybeRefillTodayImages(existing);
  if (Date.now() - lastFailedAt < FAIL_RETRY_DELAY_MS) return null;
  if (generating) return generating;
  generating = generateDailyNewspaper()
    .catch(err => {
      lastFailedAt = Date.now();
      console.error('[newspaper] Daily generation failed:', err.message);
    })
    .finally(() => { generating = null; });
  return generating;
}

const IMAGE_REFILL_RETRY_DELAY_MS = FAIL_RETRY_DELAY_MS; // 缺图补印的失败冷却

function maybeRefillTodayImages(row) {
  if (collectImageTasks(row).length === 0) return null;
  if (Date.now() - lastImageRefillFailedAt < IMAGE_REFILL_RETRY_DELAY_MS) return null;
  if (refillingImages) return refillingImages;
  refillingImages = (async () => {
    try {
      const filled = await fillPaperImages(row);
      console.log(`[newspaper] Image refill pass done: ${filled} image(s) filled`);
    } catch (err) {
      console.error('[newspaper] Image refill failed:', err.message);
    } finally {
      // 还有缺图（失败/静默无图）就冷却一段时间再试；补齐了则下次 tick 直接跳过
      const latest = getTodayNewspaper() || row;
      if (collectImageTasks(latest).length > 0) lastImageRefillFailedAt = Date.now();
      refillingImages = null;
    }
  })();
  return refillingImages;
}

// ── 生成 ──

/** 抽当天特稿主角（同步查询；导出供回归测试——此函数曾被误写成 async 导致调用处拿到 Promise） */
export function pickFeaturedCharacter(db) {
  // 需要同时具备聊天（事件注入）与朋友圈（吐槽帖）两条链路，两边都禁用的角色不抽。
  // 注意必须是同步函数：曾误写成 async 而调用处没 await，featured 变成 Promise，
  // id/display_name 全变 undefined，报纸主角链接与提示词一起失效。
  return db.prepare(`
    SELECT id, display_name, avatar_path, short_prompt, base_prompt, loras
    FROM characters
    WHERE events_disabled = 0 AND (moments_disabled IS NULL OR moments_disabled = 0)
    ORDER BY RANDOM() LIMIT 1
  `).get() || null;
}

// 变身日概率（世界状态日内，变身 vs 服装 = 40% vs 60%）
export const WORLD_TRANSFORM_CHANCE = 0.4;

/**
 * 变身日预设形态池：抽中变身日后从这里均匀锁定一种，全镇当天统一变成这同一种。
 * 每种形态的 theme 写死器官组合（外观注入与立绘生成都以它为准），不再让 LLM 自由发挥——
 * 自由发挥会让报纸写出「各家长了不同器官」的五花八门场面，与全镇统一临时外观的注入机制冲突。
 */
export const WORLD_TRANSFORM_FORMS = [
  { name: '猫娘', theme: '猫娘化：头顶一对毛绒猫耳，身后一条细长的猫尾巴，瞳孔变成略扁的竖椭圆；除此之外不多出任何其他器官' },
  { name: '龙娘', theme: '龙娘化：头顶一对小巧的龙角，身后一条覆着细鳞的龙尾巴；不长翅膀，除此之外不多出任何其他器官' },
  { name: '狐娘', theme: '狐娘化：头顶一对尖尖的狐耳，身后一条蓬松的大狐狸尾巴；除此之外不多出任何其他器官' },
  { name: '犬娘', theme: '犬娘化：头顶一对耷拉的狗耳朵，身后一条摇摆的狗尾巴；除此之外不多出任何其他器官' },
  { name: '兔娘', theme: '兔娘化：头顶一对长长的竖立兔耳，身后一个绒球似的短兔尾；除此之外不多出任何其他器官' },
  { name: '精灵耳', theme: '精灵化：只把耳朵变成一对向外伸展的细长精灵耳；不长尾巴、不长角，除此之外不多出任何其他器官' },
  { name: '猪猪', theme: '猪猪化：鼻尖变成可爱的圆猪鼻子，头顶一对小猪耳朵，身后一条卷卷的小猪尾巴；除此之外不多出任何其他器官' },
];

/**
 * 世界影响抽取：服装 / 变身四六开（变身 40%）；服装内部与开箱 rollEffectKey 同口径——
 * 40% 命中世界观服装（WORLD_OUTFIT_CHANCE，需世界观存在，否则回落固定款），
 * 其余在固定款里均匀抽。发型卡、功能道具不参与。
 * 变身不再由 LLM 决定形态：从 WORLD_TRANSFORM_FORMS 预设池里均匀锁定一种，全镇统一。
 * @returns {{ key: string, kind: string, name: string, theme: string }}
 */
export function pickWorldLoot(hasWorldSetting = false) {
  const all = Object.entries(ITEM_EFFECTS);
  const byKind = kind => all.filter(([, e]) => e.kind === kind);
  if (Math.random() < WORLD_TRANSFORM_CHANCE) {
    const form = WORLD_TRANSFORM_FORMS[Math.floor(Math.random() * WORLD_TRANSFORM_FORMS.length)];
    return { key: 'transform', kind: 'transform', name: form.name, theme: form.theme };
  }
  const pool = hasWorldSetting && Math.random() < WORLD_OUTFIT_CHANCE ? byKind('world_outfit') : byKind('outfit');
  const [key, effect] = pool[Math.floor(Math.random() * pool.length)];
  return { key, kind: effect.kind, name: effect.name, theme: effect.theme };
}

export async function generateDailyNewspaper() {
  const db = getDb();
  if (getTodayNewspaper()) {
    console.log('[newspaper] Today\'s paper already exists, skip');
    return getTodayNewspaper();
  }

  const featured = pickFeaturedCharacter(db);
  if (!featured?.id) {
    // pickFeaturedCharacter 正常时必带 id；没有说明数据异常，宁可这期不出也不能落一份没有主角链接的报纸
    console.error('[newspaper] Picked character has no valid id, abort this round:', featured);
    return null;
  }
  const withWorldState = Math.random() < WORLD_STATE_PROBABILITY;
  const worldSetting = getWorldSetting();
  // 世界影响不再由 LLM 自由发挥：直接从宝箱奖励池（服装类 + 变身类）随机抽一样，
  // 全镇居民今天都受到这个效果影响；抽中的主题原文进素材包供编辑部演绎
  const worldLoot = withWorldState ? pickWorldLoot(Boolean(worldSetting)) : null;

  // ── LLM 编辑部：一次调用产出全部文字 ──
  const msgs = [
    { role: 'system', content: [getSystemRules(), worldSetting].filter(Boolean).join('\n\n') },
    { role: 'system', content: buildFormatPrompt(withWorldState, featured.display_name, worldLoot) },
    { role: 'system', content: buildEditorialPrompt(featured.display_name) },
    { role: 'user', content: buildMaterialsPrompt(featured, withWorldState, worldLoot) },
  ];

  let raw = '';
  let draft;
  try {
    raw = await chatSync(msgs, {
      temperature: 0.8,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      label: '报纸编辑部',
    });
    const jsonStr = extractFirstJson(raw);
    if (!jsonStr) throw new Error('No JSON found in LLM response');
    draft = normalizeNewspaperDraft(JSON.parse(repairJson(jsonStr)), { withWorldState });
  } catch (err) {
    console.error('[newspaper] LLM generation failed:', err.message);
    console.log(`[newspaper] Raw LLM response:\n${raw}`);
    throw err;
  }

  // ── 落库（文字先上线，配图后台逐张补）──
  const edition = (db.prepare('SELECT COALESCE(MAX(edition), 0) AS maxEdition FROM town_newspapers').get()?.maxEdition || 0) + 1;
  // 吐槽帖排在 1.5~7 小时后，避开清晨无人的时段
  const complaintAfter = new Date(Date.now() + (1.5 * 3600_000 + Math.random() * 5.5 * 3600_000)).toISOString();
  // 主角身份快照进特稿：报纸是已印出的历史，角色之后被删除也不能失去"这期写的是谁"
  const eventForStore = {
    ...draft.character_event,
    character_name: featured.display_name,
    character_avatar: featured.avatar_path || null,
  };
  const insertResult = db.prepare(`
    INSERT INTO town_newspapers (publish_date, name, edition, items_json, character_id, character_event_json, world_state_json, moment_done, complaint_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    getLocalDateKey(),
    NEWSPAPER_NAME,
    edition,
    JSON.stringify(draft.news),
    featured.id,
    JSON.stringify(eventForStore),
    JSON.stringify(draft.world_state),
    toSQLiteDate(complaintAfter),
  );
  const paperId = Number(insertResult.lastInsertRowid);
  console.log(`[newspaper] 《${NEWSPAPER_NAME}》第${edition}期 published for ${getLocalDateKey()} (featured: ${featured.display_name}, worldState: ${draft.world_state ? draft.world_state.name : 'none'})`);

  // ── 配图：逐张生成（不阻塞文字上线，失败留空由前端占位 + tick 补印兜底）──
  await fillPaperImages(db.prepare('SELECT * FROM town_newspapers WHERE id = ?').get(paperId));

  return db.prepare('SELECT * FROM town_newspapers WHERE id = ?').get(paperId);
}

async function generateNewsImage(prompt, { ragQuery, loras, character } = {}) {
  // 生图参数与朋友圈发帖保持同步（generateMomentImages）：画师优先角色单独设置、
  // 分辨率用 moments 档、有 LoRA 时同样透传角色自定义工作流；scene 也沿用 'moments'
  //（全局 LoRA 面板里勾了「朋友圈」的条目对报纸配图同样生效——报纸 ≈ 全员可见的朋友圈）
  const charArtist = charArtistOverrideWithFallback(character);
  const genResult = await generateImageRaw(prompt, {
    ragQuery: ragQuery || prompt,
    artist: charArtist !== null ? charArtist : config.comfyui.momentsArtist,
    width: config.comfyui.momentsWidth,
    height: config.comfyui.momentsHeight,
    scene: 'moments',
    priority: 'low',
    ...(loras?.length ? { customWorkflow: character?.custom_workflow || null, loras } : {}),
  });
  if (!genResult?.success || !genResult.images?.length) return null;
  const img = genResult.images[0];
  const url = saveBase64Image('newspaper', `np_${Date.now()}_${img.filename || 'comfy.png'}`, img.base64);
  return {
    url,
    refinedPrompt: genResult.promptRefined || prompt,
    wfMode: genResult.wfMode,
    artist: charArtist !== null ? charArtist : config.comfyui.momentsArtist,
  };
}

/**
 * 纯函数：从报纸行收集缺失的配图任务（有 image_prompt 且还没图的才算缺）。
 * 顺序：特稿 → 普通新闻 → 世界状态。
 */
export function collectImageTasks(row) {
  if (!row) return [];
  const tasks = [];
  const event = safeParseJson(row.character_event_json);
  if (event && !event.image && event.image_prompt) {
    tasks.push({ key: 'character_event', image: event.image_prompt, ragQuery: event.content, hasLoras: true });
  }
  for (const item of (safeParseJson(row.items_json) || [])) {
    if (item && !item.image && item.image_prompt) {
      tasks.push({ key: 'news', item, image: item.image_prompt, ragQuery: item.content });
    }
  }
  const ws = safeParseJson(row.world_state_json);
  if (ws && !ws.image && ws.image_prompt) {
    tasks.push({ key: 'world_state', image: ws.image_prompt, ragQuery: ws.description });
  }
  return tasks;
}

/** 给报纸补齐缺失配图（逐张生成；单张失败不阻断其余）。返回补上的张数 */
async function fillPaperImages(row) {
  const tasks = collectImageTasks(row);
  let filled = 0;
  for (const task of tasks) {
    if (await generateAndStorePaperImage(row, task)) filled++;
  }
  return filled;
}

/** 生成一张配图并写回对应槽位（tick 自动补印与前端手动重新生成共用）。返回是否成功 */
async function generateAndStorePaperImage(row, task) {
  const db = getDb();
  try {
    // 特稿画面以主角为主，带角色 LoRA；角色已被删除时退化为无 LoRA 的普通插画
    const character = row.character_id
      ? db.prepare('SELECT loras, artist_override, custom_workflow FROM characters WHERE id = ?').get(row.character_id)
      : null;
    const featuredLoras = parseCharacterLoras(character?.loras);
    const resolution = `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`;
    const result = await generateNewsImage(task.image, {
      ragQuery: task.ragQuery,
      loras: task.hasLoras ? featuredLoras : [],
      character: task.hasLoras ? character : null,
    });
    const fresh = db.prepare('SELECT * FROM town_newspapers WHERE id = ?').get(row.id);
    if (!result || !fresh) return false;
    recordCompletedImageTask({
      conversationId: 'town_newspaper',
      promptOriginal: task.image,
      promptRefined: result.refinedPrompt,
      outputPaths: [result.url],
      style: result.artist,
      resolution,
      workflowTemplate: result.wfMode,
      db,
    });
    if (task.key === 'character_event') {
      const event = safeParseJson(fresh.character_event_json) || {};
      event.image = result.url;
      db.prepare('UPDATE town_newspapers SET character_event_json = ? WHERE id = ?').run(JSON.stringify(event), row.id);
    } else if (task.key === 'world_state') {
      const ws = safeParseJson(fresh.world_state_json) || {};
      ws.image = result.url;
      db.prepare('UPDATE town_newspapers SET world_state_json = ? WHERE id = ?').run(JSON.stringify(ws), row.id);
    } else {
      const items = safeParseJson(fresh.items_json) || [];
      // 常规任务按 image_prompt 认条目；正文兜底任务（image_prompt 为空）按标题认，
      // 否则多条都没 prompt 时会补到同一条上
      const target = items.find(i => !i.image && (task.item.image_prompt
        ? i.image_prompt === task.item.image_prompt
        : i.title === task.item.title));
      if (target) {
        target.image = result.url;
        delete target.image_prompt; // 配图完成后不把生图提示词回传前端
        db.prepare('UPDATE town_newspapers SET items_json = ? WHERE id = ?').run(JSON.stringify(items), row.id);
      }
    }
    console.log(`[newspaper] Image ready: ${result.url}`);
    return true;
  } catch (err) {
    console.error('[newspaper] Image generation failed:', err.message);
    return false;
  }
}

/**
 * 纯函数：按前端槽位标记（lead=特稿 / world=今日异闻 / item=普通新闻下标）从报纸行
 * 找出缺失且可补的配图任务。优先取 LLM 写好的 image_prompt；旧报纸或 LLM 漏写该字段时
 * （这正是「图片一直没出来」的常见原因之一，自动补印对此无能为力）用正文兜底拼一段画面
 * 描述，交给生图管线的润色环节优化，保证手动补图永远有得生。已有图时返回 null。
 */
export function findMissingImageTask(row, slot, index) {
  if (!row) return null;
  const tasks = collectImageTasks(row);
  const event = safeParseJson(row.character_event_json);
  const ws = safeParseJson(row.world_state_json);
  if (slot === 'lead') {
    if (!event || event.image) return null;
    return tasks.find(t => t.key === 'character_event') || (event.title && event.content ? {
      key: 'character_event',
      image: `小镇报纸人物特稿插画，画面以「${event.title}」里的主角为中心：${cleanText(event.content, 200)}`,
      ragQuery: event.content,
      hasLoras: true,
    } : null);
  }
  if (slot === 'world') {
    if (!ws || ws.image) return null;
    return tasks.find(t => t.key === 'world_state') || (ws.name ? {
      key: 'world_state',
      image: `小镇今日异闻插画，全镇居民都呈现统一状态「${ws.name}」后的街景众生相：${cleanText(ws.description || ws.news || ws.name, 200)}`,
      ragQuery: ws.description || ws.news || ws.name,
    } : null);
  }
  if (slot === 'item') {
    if (!Number.isInteger(index) || index < 0) return null;
    const target = (safeParseJson(row.items_json) || [])[index];
    if (!target || target.image) return null;
    return tasks.find(t => t.key === 'news' && t.image === target.image_prompt) || (target.title && target.content ? {
      key: 'news',
      item: target,
      image: `小镇报纸新闻插画：「${target.title}」——${cleanText(target.content, 200)}`,
      ragQuery: target.content,
    } : null);
  }
  return null;
}

/**
 * 手动补印一张缺失的配图（前端「重新生成配图」按钮）。
 * 与 tick 自动补印共用生成落库逻辑，但不受 15 分钟冷却限制；历史期（date）也能补。
 * @param {{ date?: string, slot: 'lead'|'world'|'item', index?: number }} opts
 * @returns {{ ok: boolean, newspaper?: object, error?: string }}
 */
export async function regenerateNewspaperImage({ date, slot, index } = {}) {
  const db = getDb();
  const row = date
    ? db.prepare('SELECT * FROM town_newspapers WHERE publish_date = ?').get(date)
    : getTodayNewspaper();
  if (!row) return { ok: false, error: '没有这一期报纸' };
  const task = findMissingImageTask(row, slot, Number(index));
  if (!task) return { ok: false, error: '这张配图不缺，或没有可用的生图提示词' };
  const success = await generateAndStorePaperImage(row, task);
  if (!success) return { ok: false, error: '配图生成失败，请稍后再试' };
  const fresh = db.prepare('SELECT * FROM town_newspapers WHERE id = ?').get(row.id);
  return { ok: true, newspaper: mapPaperRowForFrontend(fresh) };
}

function parseCharacterLoras(loras) {
  if (!loras) return [];
  try {
    const parsed = typeof loras === 'string' ? JSON.parse(loras) : loras;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── 注入块（chat.js / groupChatEngine.js 调用） ──

/** 世界状态注入块：全员、每天一条；与道具 buff 同位拼进角色基础人格。无状态返回 '' */
export function buildWorldStatePromptBlock(worldState) {
  if (!worldState?.name || !worldState?.effect_prompt) return '';
  return `【小镇今日状态】
今天，整个小镇都笼罩在一种特殊的状态里——「${worldState.name}」。${worldState.effect_prompt}
这是今天全镇居民共同的处境，你和身边的每个人都是如此；这不是你本性的改变，明天会自然消退。请在言行中自然体现这种状态，但不要在对话中提及「状态」「设定」「报纸」这些字眼。`;
}

/** 私聊用：绑定角色的特稿预告块。非当天主角返回 '' */
export function buildCharacterEventBlock(characterName, event) {
  if (!event?.title || !event?.note) return '';
  return `<newspaper_event>
今早的《${NEWSPAPER_NAME}》报道了一件和你有关的事——「${event.title}」：
${event.note}
这是你今天将要经历的事：让它自然地发生在你的一天里，你的情绪、计划与言行都可以围绕它展开，不必逐字复述上面的文字。被聊到今早的报纸或这件事时，可以自然回应。
</newspaper_event>`;
}

/** 群聊用：当日报纸速览（世界状态 + 特稿新闻），全员共享视角。无内容返回 ''。
 *  特稿正文只在主角本人所在的群注入——报纸是镇上晨报，但"报上那个人今天会经历的事"
 *  只对认识主角的群有意义；没有主角的群拿不到特稿正文，只能聊世界状态。 */
export function buildGroupNewspaperBlock({ worldState, characterEvent, featuredMemberName } = {}) {
  const parts = [];
  if (worldState?.name && worldState?.description) {
    parts.push(`【今日状态】全镇今天都处于「${worldState.name}」——${worldState.description}群里的每位成员都在受这个状态影响，言行中自然体现。`);
  }
  if (featuredMemberName && characterEvent?.title && characterEvent?.content) {
    let line = `【今日新闻】「${characterEvent.title}」：${characterEvent.content}`;
    if (featuredMemberName) {
      line += `\n（这条新闻的主角正是${featuredMemberName}本人——ta今天的经历会与此相符；其他成员可以像看过晨报一样自然聊起这条新闻。）`;
    }
    parts.push(line);
  }
  if (parts.length === 0) return '';
  return `<newspaper_today>\n今早的《${NEWSPAPER_NAME}》已经送到镇上各处，大多数人早上都翻过：\n${parts.join('\n')}\n</newspaper_today>`;
}

/** chat.js 注入口：当天世界状态块（无则 ''；被读者手动消除的同样不算） */
export function getWorldStateBlock() {
  const row = getTodayNewspaper();
  const ws = row && !row.world_dismissed ? safeParseJson(row.world_state_json) : null;
  return buildWorldStatePromptBlock(ws);
}

/** chat.js 注入口：该角色的特稿预告块（非主角返回 ''） */
export function getCharacterEventBlockFor(characterId) {
  const row = getTodayNewspaper();
  if (!row?.character_id || !row.character_event_json) return '';
  if (String(row.character_id) !== String(characterId)) return '';
  return buildCharacterEventBlock(null, safeParseJson(row.character_event_json));
}

/**
 * 记账：本轮该群还能不能携带报纸块。能则把「该群对本期报纸已用轮数」+1 并落库，返回 true。
 * 换期（paper_id 不同，即次日新报纸）自动从 0 重算；群行不存在（已删群 / 裸对象）按不发放处理。
 */
function consumeGroupNewspaperRound(groupId, paperId) {
  const db = getDb();
  const row = db.prepare('SELECT newspaper_paper_id, newspaper_rounds_used FROM group_chats WHERE id = ?').get(groupId);
  if (!row) return false;
  const samePaper = Number(row.newspaper_paper_id) === Number(paperId);
  const used = samePaper ? (row.newspaper_rounds_used || 0) : 0;
  if (used >= GROUP_INJECT_ROUNDS) return false;
  db.prepare('UPDATE group_chats SET newspaper_paper_id = ?, newspaper_rounds_used = ? WHERE id = ?')
    .run(paperId, used + 1, groupId);
  console.log(`[newspaper] group ${groupId} got the newspaper block (round ${used + 1}/${GROUP_INJECT_ROUNDS} of paper ${paperId})`);
  return true;
}

/** groupChatEngine.js 注入口：该群的报纸块（限额发放，用满 GROUP_INJECT_ROUNDS 轮后当天不再注入）。
 *
 *  限额：报纸块只在该群的前 GROUP_INJECT_ROUNDS 轮群聊里出现（user/idle/lull/opening 都算一轮），
 *  第 5 轮起当天不再注入——否则每轮都在提醒模型"今早报纸写了谁"，特稿主角会被反复提起。
 *  轮数按 (群, 报纸) 持久化在 group_chats.newspaper_paper_id / newspaper_rounds_used：
 *  次日新一期自动从 0 重新计，进程重启也不会重新发放；
 *  本轮没真正产出内容（buildGroupNewspaperBlock 返回空）不消耗轮数。
 *
 *  主角不在群里 → 整块不注入（同样不消耗轮数）：群成员对着"特稿里陌生人的事"聊天只会出戏；
 *  世界状态不受此影响——它仍经私聊 chat.js 稳定块作用于每个角色（那是全镇效果，与群成员构成无关）。 */
export function takeGroupNewspaperBlockFor(group) {
  const row = getTodayNewspaper();
  if (!row?.character_id || !group?.id) return '';
  const featured = (group.members || []).find(m => String(m.id) === String(row.character_id));
  if (!featured) return '';
  const block = buildGroupNewspaperBlock({
    worldState: row.world_dismissed ? null : safeParseJson(row.world_state_json),
    characterEvent: safeParseJson(row.character_event_json),
    featuredMemberName: featured.display_name || null,
  });
  if (!block) return '';
  if (!consumeGroupNewspaperRound(group.id, row.id)) return '';
  return block;
}

// ── 朋友圈吐槽帖（momentScheduler 消费） ──

export function getPendingComplaint() {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM town_newspapers
    WHERE publish_date = ? AND character_id IS NOT NULL AND moment_done = 0
      AND complaint_after IS NOT NULL AND complaint_after <= datetime('now')
  `).get(getLocalDateKey());
  if (!row) return null;
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(row.character_id);
  if (!character) return null;
  return { newspaper: row, character, event: safeParseJson(row.character_event_json) };
}

export function markComplaintDone(paperId) {
  getDb().prepare('UPDATE town_newspapers SET moment_done = 1 WHERE id = ?').run(paperId);
}

export function postponeComplaint(paperId, minutes = 30) {
  getDb().prepare("UPDATE town_newspapers SET complaint_after = datetime('now', ?) WHERE id = ?")
    .run(`+${minutes} minutes`, paperId);
}

/** 吐槽帖的强制发圈动因（generateMomentPost 的 opts.forcedTopic） */
export function buildComplaintTopic(event, characterName) {
  if (!event?.title || !event?.content) return null;
  return {
    name: '今日报纸吐槽',
    desc: `今早的《${NEWSPAPER_NAME}》报道了一件和你有关的事——「${event.title}」：${event.content} 写一条朋友圈，以你自己的口吻吐槽、感慨或回应这件事（你可以当成看了晨报，也可以当成事情刚落到你头上），是你本人的亲身视角，不要复述新闻原文。`,
  };
}

// ── Prompt 组装 ──

export function buildFormatPrompt(withWorldState, featuredName = '今日主角', worldLoot = null) {
  const worldStateExample = withWorldState ? `,
  "world_state": {
    "name": "状态名（2~6字，要让读者一眼看出今天全镇与素材里给到的「${worldLoot?.name || '今日异变'}」有关，如「全镇换装日」这种叫法，不要照抄示例）",
    "description": "第三人称说明（120~200字：这种状态今天如何笼罩小镇、居民会经历什么、到明天自然消退。全镇居民都受到素材指定的同一种效果影响——换上的是同一套服装/变成的是同一种形态，要写出大家换上/变身后的具体样子与生活变化）",
    "outfit": "第三人称全镇统一外观描述（60~120字：只写外观不写剧情，按素材【今日镇内异变】的效果主题取材，写清居民们换上的服装款式/变身后的形态细节——配色、材质、标志性元素等；这段文字会被作为今天的临时外观注入每个角色的外观段与立绘生成，全镇统一同一种）",
    "news": "报纸对它的报道（120~240字，可带一点「号外」式的打趣口吻，报道全镇居民受这个效果影响的众生相）",
    "effect_prompt": "第二人称状态指令（120~240字：直接告诉每个角色「今天你身上发生了什么变化、言行会有哪些具体表现」；必须紧扣素材指定的效果——今天全镇居民都换上了这套服装/变成了这种形态，把外观细节写具体；这段文字会被逐字注入每个角色的提示词，必须可直接执行，不要写成新闻报道腔）",
    "image_prompt": "英文插画描述（小镇街景整体氛围画面：居民们都呈现素材指定效果后的样子，不聚焦单个人物，画面中不出现文字）"
  }` : '';
  const worldStateRule = withWorldState
    ? `\n- "world_state" 字段：这次报纸要附带一条影响全镇所有人的当日状态。状态内容已由编辑部锁定为素材里【今日镇内异变】给到的效果（${worldLoot?.kind === 'transform' ? '变身形态' : '服装'}：「${worldLoot?.name || ''}」），全镇每个居民今天都受它影响——不得替换成其他类型的状态，也不得只影响部分人。要求：符合<world_setting>；一天内自然消退；好玩、可以被演绎，禁止灾难、死亡、不可逆的恶意向设定。`
    : `\n- 这次报纸不带 "world_state" 字段，输出里不要出现它。`;
  // 全局「图片生成规则」（设置页可编辑）对报纸配图同样生效，口径与朋友圈发帖一致
  const imageRules = String(getGlobalRule('image_prompt')?.rule_content || '').trim();

  return `请严格按照以下 JSON 格式输出，不要输出任何解释或 JSON 以外的文字：

{
  "news": [
    {
      "category": "栏目名（2~4字，从这些方向里选贴合的：市集/民生/邻里/天气/公告/奇闻/闲谈）",
      "title": "新闻标题（≤12字，报纸标题口吻，预告今天的事，如「市集今起增设夜摊」）",
      "content": "新闻正文（120~240字。报纸简讯口吻：第三人称，写清谁/在哪/今天会发生什么，把来龙去脉、现场细节和镇民反应展开写，像小镇周报里的完整报道而不是一句话豆腐块，不要抒情总结）",
      "image_prompt": "英文新闻插画描述（一段完整英文：写清画面主体、动作、地点、光线，报纸编辑插画风格；画面中不出现任何文字、边框或水印）"
    }
  ],
  "character_event": {
    "title": "特稿标题（≤12字，让人一眼看出和${featuredName}有关）",
    "content": "特稿正文（160~280字，报纸口吻报道这件事，可以带点打趣，把事件的起因、现场经过、各方反应写足，预告的是${featuredName}今天将要遇到的事。正文中必须至少一次直接写出「${featuredName}」的名字——主角就是ta本人，禁止替换成「某位居民」「路人」「无名者」或任何其他人）",
    "note": "第二人称预告（160~300字。用「你」称呼${featuredName}本人，具体告诉ta今天将遇到这件事的哪些瞬间、麻烦或机缘，把场景推进和时间线展开写；要落到具体场景和动作，不要空泛）",
    "image_prompt": "英文插画描述（画面以${featuredName}本人为主：必须体现素材里外观段的关键特征——发型发色、瞳色、耳朵尾巴等显著特征与衣着；画面中不出现文字）"
  }${worldStateExample}
}

字段要求：
- "news"：3~4 条普通新闻。它们彼此错开（不同地点、不同人群、不同味道），合计与 character_event 加起来约 4~5 条。
- "character_event"：必须输出。主角只能是素材里指定的「今日主角」；事件要贴合主角的资料，且必须是一件足够上新闻的事——有具体的人、地点和来龙去脉，读起来值得印在报上，主角事后想起这件事也有得说、有得吐槽（这篇特稿会被主角看到并转发吐槽）。禁止写成日常流水账（吃饭、散步、打招呼这类不值一版的小事）。
${worldStateRule}
- 所有内容必须符合<world_setting>的时代感与生活细节，不出现世界观之外的事物。
- 所有 title/content/note 用中文；所有 image_prompt 用英文。${imageRules ? `\n\n生图规则（所有 image_prompt 必须遵守）：\n${imageRules}` : ''}`;
}

export function buildEditorialPrompt(featuredName) {
  return `你是小镇唯一一份报纸《${NEWSPAPER_NAME}》的编辑部。你们的报纸每天零点准时印出，贴在酒馆门口，全镇人清早都会翻一翻。

【报纸定位——预告报纸】
- 你们报道的不是昨天发生的事，而是按小镇的规矩"演算"出的今天将要发生的事。读者拿到手，看到的就是今天这一天会展开的样子。
- 演算的依据只有两个：<world_setting>，以及素材里给到的居民资料。新闻要像这个世界里真实会长出来的生活切片：市集、天气、邻里往来、店铺新招牌、走失的猫、路上的小事故……小事为主，偶尔一件奇事，符合世界观即可。
- 不写宏大剧情，不写灾难猎奇，不出现世界观之外的事物。
- 普通新闻里出现的人物按<world_setting>虚构：名字要有这个世界普通镇民的NPC感，不要罗列一堆名字，重点是生活气息。

【特稿要求】
- 每期报纸恰有一篇「人物特稿」，今天的主角是「${featuredName}」。这件事要自然长在ta的资料上，是今天会发生在ta身上的、足够上新闻的一件事（有具体人与事、有波澜、有谈资），不是对ta人设的复述，也不是不值一版的日常琐事——主角读到这篇特稿时要真的有话可说、可吐槽。
- 特稿从头到尾只写「${featuredName}」本人：正文必须点出ta的名字，禁止把主角替换或稀释成"某位居民""路人"等匿名形象。
- "note" 是写给主角本人看的第二人称预告，会被单独注入ta今天的记忆里，要具体、可执行。

【今日异闻（world_state）】
- 若素材里有【今日镇内异变】：world_state 只能写这个异变——全镇每个居民今天都换上了该主题的服装/变成了该形态，从清晨起持续到明天自然消退；外观细节以异变给的「效果主题」为准，不得自创别的状态类型，也不得只影响部分人。
- 描述与报道要有众生相：镇民们怎么接受、怎么继续过日子、闹出什么趣事。

【口吻】
- 报纸简讯：克制、具体、带一点小镇人情味的打趣。不要写成小说场景，不要抒情总结。`;
}

export function buildMaterialsPrompt(featured, withWorldState, worldLoot = null) {
  const now = new Date();
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  const weatherNote = getLightNoteWithWeather(now);
  // 统一入口：short_prompt + 外观段（含生效外观注入，「你」→主角名），特稿写作与主角配图共用
  const persona = buildCharacterPersona(featured, { variant: 'short', person: featured.display_name });
  const lootBlock = withWorldState && worldLoot ? `\n【今日镇内异变】
今天全镇居民都受到同一个效果影响，world_state 必须围绕它展开，不得自创其他状态：
- 类型：${worldLoot.kind === 'transform' ? '变身形态（全镇每个居民都变成素材指定的同一种拟人形态）' : '服装（每个居民换上同一主题的服装）'}
- 名称：${worldLoot.name}
- 效果主题（外观细节以此为准）：${worldLoot.theme}
${worldLoot.kind === 'transform' ? '- 形态已由编辑部锁定为上面的「名称」与「效果主题」：全镇每个居民都变成这同一种形态，器官组合严格按效果主题、不得增删或替换，禁止写成各家长不同器官；具体外观细节可在主题范围内演绎，全天保持一致' : '- 服装的具体款式细节按上面的效果主题演绎，全镇统一'}` : '';

  return `今天是 ${getLocalDateKey()}（${weekday}）。${weatherNote ? `今日天象参考：${weatherNote}。` : ''}
主编，请基于<world_setting>演算今天的报纸${withWorldState ? '，并按格式附上今天的 world_state' : ''}。

【今日主角】${featured.display_name}
资料：
${persona || '（无补充资料，按<world_setting>里的普通镇民处理）'}
${lootBlock}

请输出今天的报纸。`;
}

// ── LLM 输出防御性规整 ──

function cleanText(value, maxLen) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLen) : '';
}

/**
 * 规整 LLM 输出为 {news, character_event, world_state}；不合法的字段丢弃。
 * @throws 无新闻或缺 character_event 时抛错（当次生成作废，等下一轮重试）
 */
export function normalizeNewspaperDraft(raw, { withWorldState } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Newspaper draft is not an object');

  const news = (Array.isArray(raw.news) ? raw.news : [])
    .map(item => ({
      category: cleanText(item?.category, 8) || '民生',
      title: cleanText(item?.title, 30),
      content: cleanText(item?.content, 400),
      image_prompt: cleanText(item?.image_prompt ?? item?.imagePrompt, 1200),
      image: null,
    }))
    .filter(item => item.title && item.content)
    .slice(0, 4);

  const ceRaw = raw.character_event || raw.characterEvent;
  const characterEvent = ceRaw ? {
    title: cleanText(ceRaw.title, 30),
    content: cleanText(ceRaw.content, 500),
    note: cleanText(ceRaw.note, 500),
    image_prompt: cleanText(ceRaw.image_prompt ?? ceRaw.imagePrompt, 1200),
    image: null,
  } : null;
  if (!characterEvent?.title || !characterEvent.content || !characterEvent.note) {
    throw new Error('character_event missing or incomplete');
  }

  let worldState = null;
  const wsRaw = raw.world_state || raw.worldState;
  if (withWorldState && wsRaw) {
    const name = cleanText(wsRaw.name, 12);
    const effectPrompt = cleanText(wsRaw.effect_prompt ?? wsRaw.effectPrompt, 500);
    if (name && effectPrompt) {
      worldState = {
        name,
        description: cleanText(wsRaw.description, 400),
        outfit: cleanText(wsRaw.outfit ?? wsRaw.outfitDescription, 400),
        news: cleanText(wsRaw.news, 400),
        effect_prompt: effectPrompt,
        image_prompt: cleanText(wsRaw.image_prompt ?? wsRaw.imagePrompt, 1200),
        image: null,
      };
    } else {
      console.warn('[newspaper] world_state rolled but LLM output incomplete, skipping it today');
    }
  }

  if (news.length === 0) throw new Error('No valid news items');

  return { news, character_event: characterEvent, world_state: worldState };
}
