/**
 * 宝箱橱窗（loot window）
 *
 * 与旧的「盲盒单抽」不同，这里一次给 8 个候选让你挑。清单来自外部（E:\邻舍-local\loot-catalog\），
 * 经导入工具写进 loot_catalog 表；本服务负责：分页配置、刷新橱窗、带走、单件生图缓存。
 *
 * 几个刻意的设计
 *  1. 橱窗状态存库（loot_offers），不放内存 —— 刷新页面不该把橱窗清空。
 *  2. 图片按「单件」缓存（loot_catalog.image_url）。候选组合随机、几乎不重复，
 *     按整套生图等于每次刷新都烧 8 次算力；按单件缓存后每种只生一次，之后刷新近乎零成本。
 *  3. 生图串行排队。一次刷 8 张并行会把 ComfyUI 撑爆。
 *  4. 分页配置存在 system_settings（导入时写入），运行时后端不依赖外部文件是否存在。
 */
import { getDb, getSetting, setSetting } from '../db/index.js';
import { generateImageRaw } from './imageSkill.js';
import { saveBase64Image, imageUrlExists, deleteImageFileByUrl } from './imagePaths.js';
import { broadcast } from './unifiedStreamBus.js';

/** 分页配置的 settings key */
export const LOOT_PAGES_KEY = 'loot_pages';
/** 每页格子数。4 而非 8：一次刷新要等 4 张图生成完才看得齐，8 张等待太久了 */
export const PAGE_SIZE = 4;

/** cat → useItem 的落地 kind */
const KIND_BY_CAT = {
  clothes: 'outfit',
  accessory: 'outfit',
  hairstyle: 'hairstyle',
  transform: 'transform',
  adult_toy: 'buff',
};

/**
 * 各类别的生图提示词。
 *
 * 服装 / 配饰 / 发型：用清单里的 Danbooru tag 直接出图，效果稳定（实测女仆装、束缚套装、
 *   耳罩都准确），且能吃到 tag 本身的风格。
 *
 * 成人用品：**不能用 tag 直生** —— 实测 `butt_plug` 会画成一只黄色小生物（模型把生僻 tag
 *   自由发挥成了角色）。改用英文描述「商品 + 单件 + 白底 + 无人无脸无生物」才稳定出商品图。
 *   所以这类走 TOY_PROMPT 表；表里没有的 tag 回落到标签的中文名英文意译兜底。
 */
const TOY_PROMPT = {
  vibrator: 'a sleek handheld wand vibrator massager, rounded head and slim handle, glossy finish',
  wand_vibrator: 'a magic-wand style massager with a round ball head and long slim handle',
  egg_vibrator: 'a small egg-shaped vibrator with a thin cord tail',
  remote_control_vibrator: 'an egg vibrator paired with a small square remote control',
  bullet_vibrator: 'a tiny bullet-shaped mini vibrator, short cylinder',
  rabbit_vibrator: 'a wand vibrator with a pair of small rabbit-ear attachments',
  dildo: 'a smooth realistic-shaped silicone dildo, flat base',
  double_ended_dildo: 'a long double-ended smooth silicone dildo, symmetric shape',
  suction_cup_dildo: 'a smooth silicone dildo with a round suction cup base',
  dragon_dildo: 'a fantasy textured silicone dildo with scale-like ridges, gradient color',
  butt_plug: 'a small silicone butt plug with a flared flat base, teardrop shape',
  tail_plug: 'a silicone anal plug with a fluffy animal tail attached to its base',
  anal_beads: 'a string of smooth graduated silicone anal beads on a thin cord with a pull ring',
  nipple_clamps: 'a pair of small metal nipple clamps connected by a chain',
  nipple_suction: 'a pair of small bell-shaped transparent suction cups with squeeze bulbs',
  clitoral_suction_device: 'a small rounded pebble-shaped suction sex toy with buttons',
  cervical_cap: 'a small shallow bowl-shaped silicone cervical cap, translucent',
  bondage_rope: 'a coil of braided bondage rope, neatly wound bundle',
  shibari: 'several bundles of natural hemp bondage rope, japanese style',
  handcuffs: 'a pair of metal handcuffs linked by a short chain, silver',
  padded_cuffs: 'a pair of padded leather wrist cuffs with metal buckles, black and red',
  leg_cuffs: 'a pair of wide padded leather ankle cuffs connected by a chain',
  bondage_straps: 'a set of nylon bondage straps with metal buckles, black',
  bondage_harness: 'a strappy leather body harness with metal O-rings, black',
  spreader_bar: 'a straight metal spreader bar with rings at both ends',
  bondage_bed: 'a dark wooden bed frame with metal rings at the four corners and straps',
  ball_gag: 'a ball gag with a red silicone ball and black leather straps',
  ring_gag: 'a metal O-ring gag with black leather straps',
  blindfold: 'a wide satin sleep blindfold with long tie ribbons, black',
  collar: 'a wide black leather collar with a metal ring and studs',
  leash: 'a short leather leash with a metal clasp at one end',
  choke_chain: 'a thin metal chain necklace with a small pendant',
  riding_crop: 'a slim leather riding crop with a flat leather tongue at the tip',
  flogger: 'a leather flogger with a handle and many thin leather tails',
  paddle: 'a flat rectangular leather paddle with a handle, black',
  feather_teaser: 'a slim wand tipped with a cluster of soft feathers',
  low_temperature_candle: 'a colored low-temperature massage candle in a glass jar',
  lubricant: 'a pump bottle of clear lubricant with a minimal white label',
  condom: 'a small square foil condom wrapper with a serrated edge',
  crotchless_panties: 'a pair of black lace crotchless panties with side ties',
  sheer_lingerie: 'a sheer black lace lingerie set with frilled trim',
  garter_belt: 'a black satin garter belt with several straps and clips',
  pasties: 'a pair of small heart-shaped pasties with sequins',
  body_stocking: 'a sheer fishnet full body stocking',
  bunny_suit: 'a black bunny girl suit with white fluffy cuffs and a pair of rabbit ears',
  anal_plug_tail: 'a silicone anal plug with a fluffy fox tail attached to its base',
  bullet: 'a tiny bullet-shaped mini vibrator, short cylinder',
  rabbit: 'a wand vibrator with a pair of small rabbit-ear attachments',
  plug: 'a small silicone butt plug with a flared flat base, teardrop shape',
};

const TOY_FRAME = 'single object, centered, floating, seamless plain white studio background, no humans, no person, no face, no eyes, no creature, product photograph for an adult shop catalogue, soft even lighting, best quality';

const IMAGE_FRAME_BY_KEY = {
  'clothes/full': tag => `${tag}, the outfit alone displayed as a clothing item, no humans, no person, flat front view, plain white background, soft even lighting, product photograph, best quality`,
  // 逆装/露出向：这类衣服的「开口在哪」就是它的全部卖点，只摆一件衣服看不出结构，
  // 所以展示在无头人体模型上（无头无脸，只到躯干与胯），开口位置才一目了然。
  'clothes/lewd': tag => `${tag}, the outfit displayed on a headless dress form mannequin, torso down to hips only, no head, no face, no person, plain white background, soft even lighting, product photograph, best quality`,
  'clothes/lewd_socks': tag => `${tag}, legwear alone displayed as a clothing item, no humans, no person, flat lay, plain white background, product photograph, best quality`,
  'clothes/socks': tag => `${tag}, legwear alone displayed as a clothing item, no humans, no person, flat lay, plain white background, product photograph, best quality`,
  'hairstyle/hair': tag => `${tag}, hairstyle sample shown on a mannequin head silhouette, no face, plain white background, reference sheet, best quality`,
  'transform/body': tag => `${tag}, creature form, full body, plain white background, concept art, best quality`,
  'accessory/lewd_acc': tag => `${tag}, the item alone displayed as a wearable accessory, no humans, no person, plain white background, soft even lighting, product photograph, best quality`,
  'accessory/head': tag => `${tag}, headwear accessory alone, no humans, plain white background, product photograph, best quality`,
  'accessory/hair': tag => `${tag}, hair accessory alone, no humans, plain white background, product photograph, best quality`,
  'accessory/ear': tag => `${tag}, ear accessory alone, no humans, plain white background, product photograph, best quality`,
  'accessory/hand': tag => `${tag}, hand accessory alone, no humans, plain white background, product photograph, best quality`,
};

/**
 * 不生成图片的槽位。
 *
 * `adult_toy/play`（情趣玩法：无内衣 / 只穿衬衫 / 走光 / 半脱装…）描述的是**状态**而不是物件，
 * 硬生图只会得到一张难看的怪图；而且不给它生图也顺带省下等待时间。
 * 这类卡片由前端显示名称 + 说明即可。
 */
const NO_IMAGE_SLOTS = new Set(['adult_toy/play']);

/** 该条目是否需要生成图片 */
export function needsImage(row) {
  return !NO_IMAGE_SLOTS.has(`${row.cat}/${row.slot}`);
}

function imagePromptFor(row) {
  // 成人用品走独立的英文描述表（这类必须用完整英文描述，tag 直生会画出生物）
  if (row.cat === 'adult_toy' && row.slot !== 'play') {
    const desc = TOY_PROMPT[row.tag] || `${row.name} sex toy`;
    return `${desc}, ${TOY_FRAME}`;
  }
  // 其余一律以 **image_tags（英文 Danbooru tag 组合）** 为准。
  //
  // 为什么不用 `tag` 字段：词典里大量 tag 是生僻写法（如 sheer_babydoll），模型不认识就会自由发挥
  // —— A/B 实测「纯 tag」画出的是一个玻璃罐子；「中文描述」同样无效（Danbooru 系模型不吃中文）；
  // 「英文 tag 组合」才准确，且细节最完整。image_tags 由 backfill 脚本用 LLM 生成后存库。
  const core = String(row.image_tags || '').trim() || row.tag;
  const key = `${row.cat}/${row.slot}`;
  const fn = IMAGE_FRAME_BY_KEY[key] || ((t) => `${t}, no humans, plain white background, product photograph, best quality`);
  return fn(core);
}

// ── 分页 ────────────────────────────────────────────────────

/** 读分页配置（导入工具写入；没导入过时返回空数组） */
export function getPages() {
  try {
    const raw = getSetting(LOOT_PAGES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 导入工具用：写入分页配置 */
export function savePages(pages) {
  setSetting(LOOT_PAGES_KEY, JSON.stringify(pages || []));
}

/** 各页当前有多少可选商品（前端显示用） */
export function getPageStats() {
  const db = getDb();
  // 注意：SQLite 里双引号是「标识符」，判空串必须用单引号 ''，否则会报 no such column: ""
  const rows = db.prepare(`SELECT page, COUNT(*) AS n,
      SUM(CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 ELSE 0 END) AS withImage
    FROM loot_catalog GROUP BY page`).all();
  const map = new Map(rows.map(r => [r.page, r]));
  return getPages().map(p => {
    const r = map.get(p.key) || { n: 0, withImage: 0 };
    return { ...p, count: r.n || 0, withImage: r.withImage || 0 };
  });
}

// ── 清单导入 ────────────────────────────────────────────────

/**
 * 导入商品清单（幂等）。
 * 以 tag 为键 upsert，**不动 image_url / image_status** —— 重跑导入不该把已生成的图丢掉。
 * 清单里已消失的条目会被删除（连带清理它的图片文件与橱窗格子）。
 */
export function importCatalog(items, pages) {
  const db = getDb();
  const result = { added: 0, updated: 0, removed: 0, total: 0 };
  const tx = db.transaction(() => {
    const existing = new Map(db.prepare('SELECT id, tag FROM loot_catalog').all().map(r => [r.tag, r.id]));
    const upsert = db.prepare(`
      INSERT INTO loot_catalog (tag, name, meaning, cat, slot, page)
      VALUES (@tag, @name, @meaning, @cat, @slot, @page)
      ON CONFLICT(tag) DO UPDATE SET
        name = excluded.name, meaning = excluded.meaning,
        cat = excluded.cat, slot = excluded.slot, page = excluded.page,
        updated_at = CURRENT_TIMESTAMP
    `);
    const incoming = new Set();
    for (const it of items) {
      const row = {
        tag: it.tag, name: it.name, meaning: it.meaning || '',
        cat: it.cat, slot: it.slot,
        // page 决定它归哪个标签页；导入的清单里已带，缺省时回落到 cat
        page: it.page || it.cat,
      };
      incoming.add(row.tag);
      const before = existing.get(row.tag);
      upsert.run(row);
      if (before) result.updated++; else result.added++;
    }
    // 清单里已不存在的条目 → 删（同时清图与橱窗格子）
    const gone = [];
    for (const [tag, id] of existing) if (!incoming.has(tag)) gone.push({ tag, id });
    for (const g of gone) {
      const row = db.prepare('SELECT image_url FROM loot_catalog WHERE id = ?').get(g.id);
      if (row?.image_url) { try { deleteImageFileByUrl(row.image_url); } catch { /* 文件可能已被清 */ } }
      db.prepare('DELETE FROM loot_offers WHERE item_id = ?').run(g.id);
      db.prepare('DELETE FROM loot_catalog WHERE id = ?').run(g.id);
      result.removed++;
    }
    result.total = items.length;
  });
  tx();
  if (pages) savePages(pages);
  console.log(`[loot] catalog imported: +${result.added} ~${result.updated} -${result.removed} = ${result.total}`);
  return result;
}

// ── 橱窗 ────────────────────────────────────────────────────

function serializeCatalogItem(row) {
  if (!row) return null;
  const needs = needsImage(row);
  return {
    id: row.id,
    tag: row.tag,
    name: row.name,
    meaning: row.meaning || '',
    cat: row.cat,
    slot: row.slot,
    page: row.page,
    imageUrl: row.image_url || null,
    // imageStatus：'none' 表示这类条目本就不生成图（玩法/状态类），
    // 前端据此**不要**为它轮询等待，否则会一直等不到图。
    imageStatus: !needs ? 'none' : (row.image_url ? 'done' : (row.image_status || 'pending')),
    needsImage: needs,
  };
}

/** 读某页当前橱窗（按插槽顺序，空位为 null） */
export function getWindow(page) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT o.slot_index, c.* FROM loot_offers o
    JOIN loot_catalog c ON c.id = o.item_id
    WHERE o.page = ? ORDER BY o.slot_index ASC
  `).all(page);
  const slots = new Array(PAGE_SIZE).fill(null);
  for (const r of rows) {
    if (r.slot_index >= 0 && r.slot_index < PAGE_SIZE) slots[r.slot_index] = serializeCatalogItem(r);
  }
  return { page, pageSize: PAGE_SIZE, slots };
}

/** 该页当前橱窗里的商品 id（用于刷新时避开重复） */
function currentOfferIds(db, page) {
  return new Set(db.prepare('SELECT item_id FROM loot_offers WHERE page = ?').all(page).map(r => r.item_id));
}

/**
 * 刷新某页：重抽 8 个，替换该页橱窗。
 * 尽量避开页内已有商品（`excludeCurrent` 默认开），否则连点刷新总是看到同样几个。
 * 抽中的商品若尚未生图，异步排队生成（不阻塞返回）。
 */
export function rollWindow(page, { excludeCurrent = true } = {}) {
  const db = getDb();
  const pools = db.prepare('SELECT * FROM loot_catalog WHERE page = ?').all(page);
  if (!pools.length) return { ok: false, error: `「${page}」页还没有商品，请先导入清单` };

  const avoid = excludeCurrent ? currentOfferIds(db, page) : new Set();
  // 优先从「不在当前橱窗里」的池子抽；不够 8 个再补上（不能因为排除而抽不满）
  const primary = pools.filter(p => !avoid.has(p.id));
  const secondary = pools.filter(p => avoid.has(p.id));
  const need = Math.min(PAGE_SIZE, pools.length);
  // 洗牌后取前 need 个：先 primary 后 secondary
  const pick = [];
  for (const src of [primary, secondary]) {
    const arr = [...src];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    for (const x of arr) { if (pick.length < need) pick.push(x); }
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM loot_offers WHERE page = ?').run(page);
    const ins = db.prepare('INSERT INTO loot_offers (page, slot_index, item_id) VALUES (?, ?, ?)');
    pick.forEach((it, i) => ins.run(page, i, it.id));
  });
  tx();

  // 缺图的排队生成（玩法/状态类条目不需要图，跳过）
  for (const it of pick) {
    if (!needsImage(it)) continue;
    if (!it.image_url || !imageUrlExists(it.image_url)) enqueueImage(it.id);
  }
  return { ok: true, ...getWindow(page) };
}

/**
 * 带走选中的格子：写进背包并从橱窗移除该格（留空位）。
 * @param {string} page
 * @param {number[]} slotIndexes
 */
export function takeItems(page, slotIndexes) {
  const db = getDb();
  const idxs = (Array.isArray(slotIndexes) ? slotIndexes : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < PAGE_SIZE);
  if (!idxs.length) return { ok: false, error: '没有选中任何商品' };

  const taken = [];
  const tx = db.transaction(() => {
    for (const idx of idxs) {
      const offer = db.prepare('SELECT item_id FROM loot_offers WHERE page = ? AND slot_index = ?').get(page, idx);
      if (!offer) continue;
      const item = db.prepare('SELECT * FROM loot_catalog WHERE id = ?').get(offer.item_id);
      if (!item) { db.prepare('DELETE FROM loot_offers WHERE page = ? AND slot_index = ?').run(page, idx); continue; }

      const hasImg = item.image_url && imageUrlExists(item.image_url);
      // 玩法/状态类不需要图，直接算就绪（否则会永远停在 generating）
      const needImg = needsImage(item);
      const payload = buildPayload(item);
      const r = db.prepare(`
        INSERT INTO backpack_items (effect_key, name, description, image_url, status, payload_json, owner_key, source_type, collected_at)
        VALUES (?, ?, ?, ?, ?, ?, 'me', 'loot', datetime('now'))
      `).run(
        item.tag,
        item.name,
        item.meaning || item.name,
        hasImg ? item.image_url : null,
        (hasImg || !needImg) ? 'ready' : 'generating',
        JSON.stringify(payload),
      );
      db.prepare('DELETE FROM loot_offers WHERE page = ? AND slot_index = ?').run(page, idx);
      if (needImg && !hasImg) enqueueImage(item.id);   // 图还没好，顺手排上
      taken.push({ catalogId: item.id, backpackId: r.lastInsertRowid, name: item.name, imageUrl: hasImg ? item.image_url : null });
    }
  });
  tx();
  if (taken.length) broadcast('loot_taken', { page, count: taken.length });
  return { ok: true, taken };
}

/** 背包条目要带的落地数据（useItem 会读 payload.outfit_name / outfit_description） */
function buildPayload(item) {
  const kind = KIND_BY_CAT[item.cat];
  if (kind === 'outfit' || kind === 'hairstyle' || kind === 'transform') {
    return { outfit_name: item.name, outfit_description: item.meaning || item.name, lootTag: item.tag };
  }
  return { lootTag: item.tag };
}

// ── 供 useItem 回落：把清单条目当作道具效果 ────────────────

/**
 * 旧道具池（ITEM_EFFECTS）里没有的 effect_key，回落到清单里查。
 * 这样带走的商品可以直接「使用」，不必为 454 条各写一份效果定义。
 */
export function getLootEffect(tag) {
  try {
    const row = getDb().prepare('SELECT * FROM loot_catalog WHERE tag = ?').get(tag);
    if (!row) return null;
    const kind = KIND_BY_CAT[row.cat] || 'outfit';
    const base = { kind, name: row.name, theme: row.meaning || row.name, lootTag: row.tag };
    if (kind === 'buff') {
      // 成人用品走 buff：注入一段状态描述影响对话。按大类给模板，避免为 45 条各写一段。
      base.effectText = toyEffectText(row);
      base.durationHours = 6;
    }
    return base;
  } catch {
    return null;
  }
}

/** 成人用品的状态描述模板（按 tag 关键词归类；用户可在清单里改 tag 归属来调整） */
function toyEffectText(row) {
  const t = `${row.tag} ${row.name}`.toLowerCase();
  if (/rope|shibari|bondage|cuff|strap|harness|spreader|collar|leash|chain|gag|blindfold|拘束|束缚|绳|手铐|口球|项圈|牵引|分腿|遮眼/.test(t)) {
    return '身上还留着束缚的痕迹，动作放不太开，被人多看两眼就会想起刚才的处境，语气里带着没散尽的紧绷。';
  }
  if (/lingerie|panty|pasties|garter|stocking|bunny|透明|蕾丝|内衣|吊袜|乳贴|连身袜|兔女郎/.test(t)) {
    return '身上穿得比平时少得多，布料贴着皮肤，随便动一下都在提醒自己现在的样子，注意力很难从这上面移开。';
  }
  if (/vibrat|wand|egg|bullet|rabbit|dildo|plug|beads|suction|按摩|震动|跳蛋|仿真|后庭|珠链|吸吮/.test(t)) {
    return '小腹里还留着钝钝的胀感，腿总忍不住想并紧，说话的节奏比平时慢半拍，容易走神。';
  }
  if (/whip|crop|flogger|paddle|鞭|拍板/.test(t)) {
    return '皮肤上还留着发烫的印子，坐下来会想起来，被碰到时下意识缩一下。';
  }
  return '身上还带着刚才那件东西留下的感觉，注意力时不时会飘回去。';
}

// ── 单件生图（串行队列 + 缓存） ──────────────────────────────

const imageQueue = [];
let imageRunning = false;
const queued = new Set();

function enqueueImage(catalogId) {
  if (queued.has(catalogId)) return;
  queued.add(catalogId);
  imageQueue.push(catalogId);
  pumpImageQueue();
}

async function pumpImageQueue() {
  if (imageRunning) return;
  imageRunning = true;
  try {
    while (imageQueue.length) {
      const id = imageQueue.shift();
      queued.delete(id);
      try { await generateOneImage(id); } catch (err) { console.error('[loot] 生图异常:', err.message); }
    }
  } finally {
    imageRunning = false;
  }
}

async function generateOneImage(catalogId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM loot_catalog WHERE id = ?').get(catalogId);
  if (!row) return;
  if (row.image_url && imageUrlExists(row.image_url)) return;   // 已有图，跳过

  db.prepare(`UPDATE loot_catalog SET image_status = 'generating', image_error = NULL WHERE id = ?`).run(catalogId);
  try {
    const result = await generateImageRaw(imagePromptFor(row), {
      scene: 'items', disableRAG: true, persistPreparation: false, width: 512, height: 512, artist: '@ebora',
    });
    if (!result.success || !result.images?.length) throw new Error(result.error || 'ComfyUI 未返回图片');
    const url = saveBase64Image('items', `loot_${row.tag}_${Date.now()}.png`, result.images[0].base64);
    db.prepare(`UPDATE loot_catalog SET image_url = ?, image_status = 'done', image_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(url, catalogId);
    // 背包里已经带走、但当时还没图的同款，一并回填
    db.prepare(`UPDATE backpack_items SET image_url = ?, status = 'ready'
                WHERE effect_key = ? AND source_type = 'loot' AND status = 'generating' AND image_url IS NULL`).run(url, row.tag);
    broadcast('loot_image_ready', { catalogId, tag: row.tag, imageUrl: url });
  } catch (err) {
    db.prepare(`UPDATE loot_catalog SET image_status = 'failed', image_error = ? WHERE id = ?`).run(String(err.message).slice(0, 300), catalogId);
    console.error(`[loot] 生图失败 ${row.tag}:`, err.message);
  }
}

/** 手动补图（管理用）：给缺图的商品排队，返回排队数。传 tags 可只补指定的几件 */
export function repairMissingImages({ limit = 50, tags = null } = {}) {
  const db = getDb();
  let rows;
  if (Array.isArray(tags) && tags.length) {
    const ph = tags.map(() => '?').join(',');
    rows = db.prepare(`SELECT id, tag, image_url FROM loot_catalog WHERE tag IN (${ph})`).all(...tags);
  } else {
    rows = db.prepare('SELECT id, tag, image_url FROM loot_catalog WHERE image_status != \'generating\' ORDER BY id').all();
  }
  const targets = rows
    .filter(r => needsImage(r))                     // 玩法/状态类不生成图，跳过（否则会永远排队）
    .filter(r => !r.image_url || !imageUrlExists(r.image_url))
    .slice(0, Math.max(0, limit));
  for (const r of targets) enqueueImage(r.id);
  return { queued: targets.length, running: imageRunning };
}

/** 队列状态（前端可显示"还有几张在生成"） */
export function getImageQueueState() {
  return { pending: imageQueue.length + (imageRunning ? 1 : 0) };
}
