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
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { generateImageRaw } from '../imageSkill.js';
import { postProcessAsset, detectTileAnchorY, flattenIsoTile } from './assetPostProcess.js';
import { broadcastTownAssetsUpdated } from './townBus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TOWN_ASSETS_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'town', 'assets');

/** 固定像素风基础串（整套素材共享 → 风格一致） */
const PIXEL_BASE = 'pixel art, clean pixel edges, limited color palette, no anti-aliasing, no text, no watermark, no outline glow';

/** kind 专属生成规格（2.1）：尺寸 / 专属串 / 像素化目标
 *  地砖/道路不带画师串（illustration 画师会把平铺纹理带偏成场景插画） */
export const ASSET_SPECS = {
  ground: {
    size: { width: 512, height: 512 },
    // {desc} 会被插进「顶面完全被该材质覆盖」的句子里，避免模型画成花坛（顶面裸土、草只长边缘）
    promptTemplate: 'isometric ground tile, one single flat diamond-shaped block seen from a 45 degree angle, the entire top face is fully covered edge to edge by {desc}, the material reaches every corner of the top face, soil visible only on the thin sides below the top face, tile centered and filling the whole square frame, straight edges, game map tile',
    removeBg: false,
    pixel: { w: 64, h: 64 },
    artist: '',
  },
  road: {
    size: { width: 512, height: 512 },
    promptTemplate: 'isometric road tile, one single flat diamond-shaped block seen from a 45 degree angle, the entire top face is fully covered edge to edge by {desc}, the material reaches every corner of the top face, soil visible only on the thin sides below the top face, tile centered and filling the whole square frame, straight edges, game map tile',
    removeBg: false,
    pixel: { w: 64, h: 64 },
    artist: '',
  },
  building: {
    size: { width: 768, height: 768 },   // 特殊建筑 768×1024
    tallSize: { width: 768, height: 1024 },
    prompt: 'isometric building game sprite on an empty white background, seen from a 45 degree angle showing two walls and the roof, the building sits directly on the background with a clean straight bottom edge, no base platform, no foundation slab, no terrain chunk, no fence, nothing attached below or beside the walls, complete building centered and filling the frame, game map asset',
    removeBg: true,
    // 像素密度按等距占格比例：横向 (w+h)*16（渲染时按 (w+h)*HALF_W 放大 2 倍）
    pixelPerCell: 16,
    pixelWidth: (fp) => (fp.w + fp.h) * 16,
  },
  prop: {
    size: { width: 512, height: 512 },
    prompt: 'a single object sprite standing on an empty white background, small soft shadow right under it, nothing else in the image, isolated game sprite, slight three-quarter view from a bit above, complete object visible, centered',
    removeBg: true,
    pixel: { w: 48, h: 48 },
  },
  npc: {
    size: { width: 768, height: 768 },
    prompt: 'white background, full body, chibi pixel sprite, single character, centered, game asset',
    removeBg: true,
    pixel: { w: 32, h: 48 },
  },
  player: {
    size: { width: 768, height: 768 },
    prompt: 'white background, full body, chibi pixel sprite, single character, centered, game asset',
    removeBg: true,
    pixel: { w: 32, h: 48 },
  },
};

export const SPRITE_DIRECTIONS = ['down', 'up', 'left', 'right'];
const DIRECTION_PROMPT = {
  down: 'facing down toward the viewer',
  up: 'facing up, back to the viewer',
  left: 'facing left, side view',
  right: 'facing right, side view',
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

  const prompt = buildAssetPrompt({
    kind: row.kind,
    desc: meta.desc || row.name,
    styleTags: meta.styleTags || '',
    direction: meta.direction || null,
    special: !!meta.special,
  });

  db.prepare(`UPDATE town_assets SET status = 'pending', source_prompt = ? WHERE id = ?`).run(prompt, row.id);

  try {
    const result = await generateImageRaw(prompt, {
      scene: 'town',
      disableRAG: true,
      artist: spec.artist !== undefined ? spec.artist : config.comfyui.artist,
      width: size.width,
      height: size.height,
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
    let tw = isTile ? 64 : (spec.pixel?.w ?? 64);
    let th = isTile ? 32 : (spec.pixel?.h ?? 64);
    if (!isTile && spec.pixelWidth && meta.footprint?.w) {
      // 建筑按等距占格宽 (w+h)*16
      tw = spec.pixelWidth(meta.footprint);
      th = Math.max(1, Math.round(tw * size.height / size.width));
    }

    const outBuffer = await postProcessAsset(work, {
      targetW: tw, targetH: th, removeBg: spec.removeBg,
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
    if (row.kind === 'ground' || row.kind === 'road') {
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
  return db.prepare(`SELECT * FROM town_assets ${where} ORDER BY kind, id`).all().map(rowToAsset);
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

/** 重生成一张素材（沿用原 meta；可传 desc/styleTags 覆盖） */
export function regenerateAsset(id, overrides = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) throw new Error(`asset #${id} not found`);
  const meta = JSON.parse(row.meta_json || '{}');
  if (overrides.desc !== undefined) meta.desc = overrides.desc;
  if (overrides.styleTags !== undefined) meta.styleTags = overrides.styleTags;
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
