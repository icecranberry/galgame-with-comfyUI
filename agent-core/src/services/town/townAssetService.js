/**
 * 小镇像素素材服务（ComfyUI 生成 → 后处理 → data/town/assets/ → town_assets 表）
 *
 * - prompt = 固定像素风基础串 + 世界观 styleTags + kind 专属串 + 素材描述（2.2）
 * - 生成走 generateImageRaw 的 town 场景（disableRAG，独立于聊天配图语境）
 * - 全部生图进独立串行队列，不与聊天配图抢 ComfyUI（2.6）
 * - 逐张 SSE town_assets_updated 上报，向导/素材库面板实时刷新
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { generateImageRaw } from '../imageSkill.js';
import { postProcessAsset, detectTileAnchorY, flattenIsoTile } from './assetPostProcess.js';
import { generateBuildingPrompt } from './townPromptBuilder.js';
import { broadcastTownAssetsUpdated } from './townBus.js';

/** 建筑 LLM 出 prompt（酒馆立绘同款结构）；失败回退静态串 */
async function buildBuildingPromptViaLlm(p) {
  try {
    return await generateBuildingPrompt(p);
  } catch (err) {
    console.warn('[townAssets] building llm prompt failed, use fallback:', err?.message);
    return buildAssetPrompt({ kind: 'building', desc: p.desc, styleTags: p.styleTags, special: p.special });
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TOWN_ASSETS_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'town', 'assets');

/** 固定像素风基础串（整套素材共享 → 风格一致） */
const PIXEL_BASE = 'pixel art, clean pixel edges, limited color palette, no anti-aliasing, no text, no watermark, no outline glow';

/** kind 专属生成规格（2.1）：尺寸 / 专属串 / 像素化目标
 *  地砖/道路不带画师串（illustration 画师会把平铺纹理带偏成场景插画） */
export const ASSET_SPECS = {
  ground: {
    size: { width: 1536, height: 1536 },
    // {desc} 会被插进「顶面完全被该材质覆盖」的句子里，避免模型画成花坛（顶面裸土、草只长边缘）
    promptTemplate: 'isometric ground tile, one single flat diamond-shaped block seen from a 45 degree angle, the entire top face is fully covered edge to edge by {desc}, the material reaches every corner of the top face, soil visible only on the thin sides below the top face, tile centered and filling the whole square frame, straight edges, game map tile',
    removeBg: false,
    pixel: { w: 64, h: 32 },
    artist: '',
  },
  road: {
    size: { width: 1536, height: 1536 },
    promptTemplate: 'isometric road tile, one single flat diamond-shaped block seen from a 45 degree angle, the entire top face is fully covered edge to edge by {desc}, the material reaches every corner of the top face, soil visible only on the thin sides below the top face, tile centered and filling the whole square frame, straight edges, game map tile',
    removeBg: false,
    pixel: { w: 64, h: 32 },
    artist: '',
  },
  building: {
    size: { width: 1536, height: 1536 },   // 特殊建筑 1536×2048
    tallSize: { width: 1536, height: 2048 },
    // 英文 prompt 由 LLM 按酒馆立绘同款四层结构生成（townPromptBuilder），此串仅兜底
    prompt: 'isometric building game sprite on an empty white background, seen from a 45 degree angle showing two walls and the roof, the building sits directly on the background with a clean straight bottom edge, no base platform, no foundation slab, no ground tiles, no pavement, nothing attached below or beside the walls, complete building centered and filling the frame, game map asset',
    removeBg: true,
    cropContent: true,
    // 渲染按 (w+h)*HALF_W 画：像素宽做成同尺寸 → 1:1 绘制不模糊
    pixelWidth: (fp) => (fp.w + fp.h) * 32,
  },
  prop: {
    size: { width: 512, height: 512 },
    prompt: 'a single object sprite standing on an empty white background, small soft shadow right under it, nothing else in the image, isolated game sprite, slight three-quarter view from a bit above, complete object visible, centered',
    removeBg: true,
    cropContent: true,
    pixel: { w: 64, h: 64 },
  },
  // 像素小人：600×800 制作 → 裁内容包围盒 → 像素化 48×64（3:4），正/背两面
  npc: {
    size: { width: 600, height: 800 },
    prompt: 'cute chibi pixel art character sprite, full body from head to toe, standing pose, centered, empty pure white background, clean thick pixel outlines, limited color palette, game character sprite asset',
    removeBg: true,
    cropContent: true,
    pixel: { w: 48, h: 64 },
  },
  // 居民/玩家正式立绘：900×1600 白底插画（生成后抠白），不做像素化
  portrait: {
    size: { width: 900, height: 1600 },
    prompt: 'pure white background, simple background',
    removeBg: true,
    pixel: null,
  },
  player: {
    size: { width: 600, height: 800 },
    prompt: 'cute chibi pixel art character sprite, full body from head to toe, standing pose, centered, empty pure white background, clean thick pixel outlines, limited color palette, game character sprite asset',
    removeBg: true,
    cropContent: true,
    pixel: { w: 48, h: 64 },
  },
};

export const SPRITE_DIRECTIONS = ['down', 'up']; // 像素小人只需正面/背面
const DIRECTION_PROMPT = {
  down: 'facing the viewer, front view',
  up: 'seen from behind, back view',
};

/** 各 kind 的默认硬逻辑前缀（用户可在向导/编辑器覆盖 meta.promptPrefix） */
export const DEFAULT_PROMPT_PREFIX = {
  building: 'pixel art, game sprite',
  prop: 'pixel art, game sprite',
  npc: 'pixel art, game sprite, mini human sized, full body',
  player: 'pixel art, game sprite, mini human sized, full body',
  portrait: '',
  ground: '',
  road: '',
};

/** 地砖/道路专用：styleTags 里的聚落类名词会泄漏成「草地上长出小房子」，剥掉 */
const TILE_STYLE_STRIP = /\b(village|town|city|street|hamlet|townsquare|buildings?)\b/gi;

function styleTagsFor(kind, styleTags) {
  if (kind !== 'ground' && kind !== 'road') return styleTags;
  return String(styleTags || '').replace(TILE_STYLE_STRIP, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** 组装素材 prompt（2.2）；ground/road 用 promptTemplate 把 desc 插进材质覆盖句 */
export function buildAssetPrompt({ kind, desc, styleTags = '', direction = null, special = false }) {
  const spec = ASSET_SPECS[kind];
  if (!spec) throw new Error(`unknown asset kind: ${kind}`);
  const material = [desc, styleTagsFor(kind, styleTags)].filter(Boolean).join(', ');
  if (spec.promptTemplate) {
    return [
      PIXEL_BASE,
      spec.promptTemplate.replace('{desc}', material),
      direction && DIRECTION_PROMPT[direction],
      special ? 'landmark building, distinctive and detailed' : null,
    ].filter(Boolean).join(', ');
  }
  const parts = [
    PIXEL_BASE,
    styleTagsFor(kind, styleTags),
    spec.prompt,
    direction && DIRECTION_PROMPT[direction],
    special ? 'landmark building, distinctive and detailed' : null,
    desc,
  ].filter(Boolean);
  return parts.join(', ');
}

// ── 串行队列：小镇生图永远一次只有一张 ──

let assetChain = Promise.resolve();

function enqueueAssetJob(fn) {
  const run = assetChain.then(fn).catch(err => {
    console.warn('[townAssets] job failed:', err?.message || err);
    throw err;
  });
  assetChain = run.catch(() => {});
  return run;
}

// ── 存储 ──

function assetFilePath(id, key) {
  const safeKey = String(key || `asset${id}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(TOWN_ASSETS_DIR, `asset_${id}_${safeKey}.png`);
}

function rowToAsset(row) {
  if (!row) return null;
  let meta = {};
  try { meta = JSON.parse(row.meta_json || '{}'); } catch { /* 忽略坏 meta */ }
  return { ...row, meta };
}

/** 生成一张素材并落盘落库（串行队列内执行） */
async function generateIntoRow(row) {
  const db = getDb();
  const meta = JSON.parse(row.meta_json || '{}');
  const spec = ASSET_SPECS[row.kind];
  const size = row.kind === 'building' && (meta.special || meta.tall)
    ? spec.tallSize
    : spec.size;

  // prompt 来源优先级：meta.promptOverride（立绘/精灵/建筑 LLM 产物，或用户手改）→ 建筑 LLM → 静态组装
  let prompt;
  if (meta.promptOverride) {
    prompt = meta.promptOverride;
  } else if (row.kind === 'building' && meta.useLlmPrompt !== false) {
    prompt = await buildBuildingPromptViaLlm({ name: row.name, desc: meta.desc, footprint: meta.footprint, special: !!meta.special, styleTags: meta.styleTags || '' });
  } else {
    prompt = buildAssetPrompt({
      kind: row.kind,
      desc: meta.desc || row.name,
      styleTags: meta.styleTags || '',
      direction: meta.direction || null,
      special: !!meta.special,
    });
  }

  // 硬逻辑前缀（默认按 kind，用户可在向导/编辑器覆盖）：pixel art, game sprite 等
  const prefix = meta.promptPrefix !== undefined ? meta.promptPrefix : (DEFAULT_PROMPT_PREFIX[row.kind] || '');
  if (prefix) prompt = `${prefix}, ${prompt}`;
  db.prepare(`UPDATE town_assets SET status = 'pending', source_prompt = ? WHERE id = ?`).run(prompt, row.id);

  try {
    const result = await generateImageRaw(prompt, {
      scene: 'town',
      disableRAG: true,
      artist: spec.artist !== undefined ? spec.artist : config.comfyui.artist,
      width: size.width,
      height: size.height,
      loras: Array.isArray(meta.loras) && meta.loras.length ? meta.loras : undefined,
    });
    if (!result?.success || !result.images?.length) {
      throw new Error(result?.error || 'ComfyUI 未返回图片');
    }
    const base64 = result.images[0].base64;
    const buffer = Buffer.from(base64.slice(base64.indexOf(',') + 1), 'base64');

    // 等距地砖：先裁出顶面菱形归一化成 2:1 贴图（接缝完美互锁），再像素化到 64×32
    const isTile = row.kind === 'ground' || row.kind === 'road';
    let work = buffer;
    if (isTile) work = await flattenIsoTile(work);
    let tw;
    let th;
    if (isTile) {
      tw = 64; th = 32;
    } else if (spec.pixelWidth && meta.footprint?.w) {
      // 建筑按等距占格宽 (w+h)*32，渲染 1:1 不模糊
      tw = spec.pixelWidth(meta.footprint);
      th = Math.max(1, Math.round(tw * size.height / size.width));
    } else if (spec.pixel) {
      tw = spec.pixel.w;
      th = spec.pixel.h;
    } else {
      tw = size.width; th = size.height; // portrait 保持原分辨率
    }

    const outBuffer = await postProcessAsset(work, {
      targetW: tw, targetH: th, removeBg: spec.removeBg, cropContent: !!spec.cropContent,
    });

    const filePath = assetFilePath(row.id, row.key);
    fs.mkdirSync(TOWN_ASSETS_DIR, { recursive: true });
    // 旧文件（重生成可能换 key）先清理
    for (const f of fs.readdirSync(TOWN_ASSETS_DIR)) {
      if (f.startsWith(`asset_${row.id}_`) && f !== path.basename(filePath)) {
        try { fs.unlinkSync(path.join(TOWN_ASSETS_DIR, f)); } catch { /* 可容忍 */ }
      }
    }
    fs.writeFileSync(filePath, outBuffer);

    const imagePath = `/town-assets/${path.basename(filePath)}`;
    meta.pixelSize = { w: tw, h: th };
    meta.styleTags = meta.styleTags || '';
    meta.updatedAt = Date.now(); // 前端 URL 缓存穿透标记
    // 等距地砖：检测菱形中心锚点（渲染对齐用），失败回退 0.5
    if (isTile) {
      meta.groundAnchorY = (await detectTileAnchorY(outBuffer)) ?? 0.5;
    }
    db.prepare(`
      UPDATE town_assets SET image_path = ?, meta_json = ?, status = 'ready' WHERE id = ?
    `).run(imagePath, JSON.stringify(meta), row.id);

    const fresh = getAssetById(row.id);
    broadcastTownAssetsUpdated({ asset: fresh });
    console.log(`[townAssets] ready #${row.id} ${row.kind}/${row.key} → ${imagePath}`);
    return fresh;
  } catch (err) {
    db.prepare(`UPDATE town_assets SET status = 'failed' WHERE id = ?`).run(row.id);
    broadcastTownAssetsUpdated({ asset: getAssetById(row.id) });
    throw err;
  }
}

/**
 * 保存前端编辑后的素材图片（点击抠白 / 裁底等编辑产物，dataUrl PNG）
 * 覆盖原文件并 bump meta.updatedAt 供前端缓存穿透
 */
export async function saveEditedAssetImage(id, dataUrl) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) throw new Error(`asset #${id} not found`);
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('invalid image dataUrl');
  }
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  // 尺寸守卫：编辑产物不超过 2048px
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height || meta.width > 2048 || meta.height > 2048) {
    throw new Error('图片尺寸异常');
  }
  const filePath = path.join(TOWN_ASSETS_DIR, path.basename(row.image_path || assetFilePath(id, row.key)));
  fs.mkdirSync(TOWN_ASSETS_DIR, { recursive: true });
  fs.writeFileSync(filePath, buffer);

  const m = JSON.parse(row.meta_json || '{}');
  m.updatedAt = Date.now();
  m.editedAt = m.updatedAt;
  db.prepare('UPDATE town_assets SET image_path = ?, meta_json = ?, status = ? WHERE id = ?')
    .run(`/town-assets/${path.basename(filePath)}`, JSON.stringify(m), 'ready', id);
  const fresh = getAssetById(id);
  broadcastTownAssetsUpdated({ asset: fresh });
  return fresh;
}

// ── 对外 API ──

export function getAssetById(id) {
  return rowToAsset(getDb().prepare('SELECT * FROM town_assets WHERE id = ?').get(id));
}

export function listAssets({ kind, worldSettingId, keys } = {}) {
  const db = getDb();
  const conds = [];
  const params = [];
  if (kind) { conds.push('kind = ?'); params.push(kind); }
  if (worldSettingId) { conds.push('world_setting_id = ?'); params.push(worldSettingId); }
  if (Array.isArray(keys) && keys.length > 0) {
    conds.push(`key IN (${keys.map(() => '?').join(',')})`);
    params.push(...keys);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM town_assets ${where} ORDER BY kind, id`).all(...params).map(rowToAsset);
}

export function getAssetsByKey(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return [];
  const db = getDb();
  const placeholders = keys.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM town_assets WHERE key IN (${placeholders})`).all(...keys).map(rowToAsset);
}

/**
 * 创建并生成一张素材（入串行队列）
 * @param {object} p - { kind, key, name, desc, meta, worldSettingId }
 * @returns {Promise<object>} 完成后的素材行（ready/failed）
 */
export function createAsset({ kind, key, name, desc, meta = {}, worldSettingId = null }) {
  if (!ASSET_SPECS[kind]) throw new Error(`unknown asset kind: ${kind}`);
  const db = getDb();
  const metaJson = { desc: desc || '', ...meta };
  const result = db.prepare(`
    INSERT INTO town_assets (kind, key, name, image_path, meta_json, world_setting_id, status)
    VALUES (?, ?, ?, '', ?, ?, 'pending')
  `).run(kind, key || null, name, JSON.stringify(metaJson), worldSettingId);
  const id = Number(result.lastInsertRowid);
  broadcastTownAssetsUpdated({ asset: getAssetById(id) });
  return enqueueAssetJob(() => generateIntoRow(getDb().prepare('SELECT * FROM town_assets WHERE id = ?').get(id)));
}

/** 重生成一张素材（沿用原 meta；可传 desc/styleTags/prompt/loras/promptPrefix 覆盖并保存） */
export function regenerateAsset(id, overrides = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) throw new Error(`asset #${id} not found`);
  const meta = JSON.parse(row.meta_json || '{}');
  if (overrides.desc !== undefined) meta.desc = overrides.desc;
  if (overrides.styleTags !== undefined) meta.styleTags = overrides.styleTags;
  if (overrides.prompt !== undefined && String(overrides.prompt).trim()) meta.promptOverride = String(overrides.prompt).trim();
  if (Array.isArray(overrides.loras)) meta.loras = overrides.loras;
  if (overrides.promptPrefix !== undefined) meta.promptPrefix = overrides.promptPrefix;
  db.prepare('UPDATE town_assets SET meta_json = ? WHERE id = ?').run(JSON.stringify(meta), id);
  return enqueueAssetJob(() => generateIntoRow(db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id)));
}

/** 删除素材（含磁盘文件）；引用它的地图对象由调用方负责清理 */
export function deleteAsset(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) return { ok: false, error: '素材不存在' };
  if (row.image_path) {
    const filePath = path.join(TOWN_ASSETS_DIR, path.basename(row.image_path));
    try { fs.unlinkSync(filePath); } catch { /* 文件可能已不存在 */ }
  }
  db.prepare('DELETE FROM town_assets WHERE id = ?').run(id);
  broadcastTownAssetsUpdated({ deleted: id });
  return { ok: true };
}

/**
 * 批量生成（独立串行队列，逐张回调进度）
 * @param {Array<object>} jobs - createAsset 参数数组
 * @param {function} [onProgress] - ({ done, total, asset, error }) => void
 */
export async function generateAssetsBatch(jobs, onProgress) {
  const total = jobs.length;
  let done = 0;
  const results = [];
  for (const job of jobs) {
    try {
      const asset = await createAsset(job);
      results.push({ ok: true, asset });
    } catch (err) {
      console.warn('[townAssets] batch item failed:', err?.message);
      results.push({ ok: false, error: err?.message || '生成失败', job });
    }
    done++;
    if (onProgress) onProgress({ done, total, results });
  }
  return results;
}
