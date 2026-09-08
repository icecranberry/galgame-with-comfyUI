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
import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { generateImageRaw } from '../imageSkill.js';
import { postProcessAsset, detectTileAnchorY, flattenIsoTile } from './assetPostProcess.js';
import { refineImage } from '../imageRefine.js';
import { generateBuildingPrompt } from './townPromptBuilder.js';
import { broadcastTownAssetsUpdated } from './townBus.js';
import { getTownGenerationSettings, generationStepForAsset, isPortraitAsset, normalizeTownGenerationLoras } from './townGenerationConfig.js';

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
    pixelWidth: (fp) => (fp.w + fp.h) * 32,
  },
  // 像素小人：600×800 制作 → 抠白裁切 → 轻缩存储（保留生成图的画质，像素风由 prompt 控制）
  npc: {
    size: { width: 600, height: 800 },
    prompt: 'cute chibi character sprite, full body from head to toe, standing pose, centered, empty pure white background, clean outlines, game character sprite asset',
    removeBg: true,
    cropContent: true,
    maxSide: 400,
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
    prompt: 'cute chibi character sprite, full body from head to toe, standing pose, centered, empty pure white background, clean outlines, game character sprite asset',
    removeBg: true,
    cropContent: true,
    maxSide: 400,
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
  ground: 'pixel art, game sprite',
  road: 'pixel art, game sprite',
};

function generationDefaultsForAsset(row) {
  const settings = getTownGenerationSettings();
  const step = settings.steps[generationStepForAsset(row)] || {};
  const portrait = isPortraitAsset(row);
  return {
    artist: typeof step.artist === 'string' ? step.artist : '',
    loras: portrait && !step.portraitLoras ? [] : (Array.isArray(step.loras) ? step.loras : []),
    prefix: portrait ? '' : (typeof step.prefix === 'string' ? step.prefix : (DEFAULT_PROMPT_PREFIX[row.kind] || '')),
    portraitLoras: step.portraitLoras === true,
  };
}
/** 地砖/道路专用：styleTags 里的聚落类名词会泄漏成「草地上长出小房子」，剥掉 */
const TILE_STYLE_STRIP = /\b(village|town|city|street|hamlet|townsquare|buildings?)\b/gi;

function styleTagsFor(kind, styleTags) {
  if (kind !== 'ground' && kind !== 'road') return styleTags;
  return String(styleTags || '').replace(TILE_STYLE_STRIP, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** 组装素材 prompt（2.2）；ground/road 用 promptTemplate 把 desc 插进材质覆盖句 */
export function buildAssetPrompt({ kind, desc, styleTags = '', direction = null, special = false, footprint = null }) {
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
  const propFootprint = kind === 'prop' && footprint?.w > 0 && footprint?.h > 0
    ? `The sprite base matches an isometric footprint of ${footprint.w}x${footprint.h} tiles`
    : null;
  const parts = [
    PIXEL_BASE,
    styleTagsFor(kind, styleTags),
    spec.prompt,
    direction && DIRECTION_PROMPT[direction],
    special ? 'landmark building, distinctive and detailed' : null,
    propFootprint,
    desc,
  ].filter(Boolean);
  return parts.join(', ');
}

// ── 串行队列：同一 world/epoch 内一次一张，旧世界在途结果隔离 ──

let assetQueue = { key: null, chain: Promise.resolve() };

function enqueueAssetJob(guard, fn) {
  assertAssetCurrent(guard);
  const key = JSON.stringify([guard.worldId, guard.epoch]);
  // 新世界不等待旧世界仍在网络请求中的任务；旧队列醒来后只会被 fence 拒绝。
  if (assetQueue.key !== key) assetQueue = { key, chain: Promise.resolve() };
  const queue = assetQueue;
  const run = queue.chain.then(() => { assertAssetCurrent(guard); return fn(); }).catch(err => {
    // A new, image-less row superseded by an outfit change must not remain pending forever.
    // This is only bookkeeping for our own current-world token; existing ready pixels survive.
    if (guard.appearanceGuard && err?.code === 'TOWN_ASSET_STALE') {
      const db = getDb();
      const changed = db.transaction(() => {
        const world = captureTownAssetWorld();
        if (world.worldId !== guard.worldId || world.epoch !== guard.epoch) return false;
        const current = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(guard.id);
        if (!current || JSON.parse(current.meta_json || '{}')._assetOperation !== guard.token) return false;
        const previous = guard.previousAsset;
        if (previous?.image_path && previous.status === 'ready') {
          const restored = { ...JSON.parse(previous.meta_json || '{}'), _assetOperation: guard.token };
          const latest = JSON.parse(current.meta_json || '{}');
          preserveSavedGenerationConfig(restored, latest);
          db.prepare("UPDATE town_assets SET meta_json = ?, source_prompt = ?, status = 'ready' WHERE id = ?")
            .run(JSON.stringify(restored), previous.source_prompt, guard.id);
          return false;
        }
        if (current.image_path || current.status !== 'pending') return false;
        db.prepare("UPDATE town_assets SET status = 'failed' WHERE id = ?").run(guard.id);
        return true;
      }).immediate();
      if (changed) broadcastTownAssetsUpdated({ asset: getAssetById(guard.id) });
    }
    console.warn('[townAssets] job failed:', err?.message || err);
    throw err;
  });
  queue.chain = run.catch(() => {});
  return run;
}

/** Call before an outer prompt-generation await, then pass expectedWorld to createAsset. */
export function captureTownAssetWorld() {
  const world = getDb().prepare('SELECT world_id, epoch FROM town_world_state WHERE singleton = 1').get();
  if (!world) throw new Error('Town world schema has not been initialized');
  return { worldId: world.world_id, epoch: world.epoch };
}

function staleAsset() {
  return Object.assign(new Error('素材所属世界或生成任务已变化，已丢弃旧结果'), { code: 'TOWN_ASSET_STALE' });
}

function assertWorldCurrent(expected) {
  const current = captureTownAssetWorld();
  if (current.worldId !== expected.worldId || current.epoch !== expected.epoch) throw staleAsset();
}

function claimAsset(row, expectedWorld = captureTownAssetWorld(), appearanceGuard = null) {
  const db = getDb();
  return db.transaction(() => {
    assertWorldCurrent(expectedWorld);
    if (appearanceGuard) {
      if (typeof appearanceGuard.assertCurrent !== 'function' || !appearanceGuard.source?.signature) throw staleAsset();
      appearanceGuard.assertCurrent();
    }
    const token = randomUUID();
    const meta = JSON.parse(row.meta_json || '{}');
    meta._assetOperation = token;
    row.meta_json = JSON.stringify(meta);
    db.prepare('UPDATE town_assets SET meta_json = ? WHERE id = ?').run(row.meta_json, row.id);
    return { ...expectedWorld, id: row.id, token, appearanceGuard };
  }).immediate();
}

function assertAssetCurrent(guard) {
  assertWorldCurrent(guard);
  const row = getDb().prepare('SELECT * FROM town_assets WHERE id = ?').get(guard.id);
  if (!row || JSON.parse(row.meta_json || '{}')._assetOperation !== guard.token) throw staleAsset();
  guard.appearanceGuard?.assertCurrent();
  return row;
}

// All awaited work must finish before this synchronous commit. Use a unique path so
// rejected/rolled-back work cannot overwrite a file still referenced by another row.
function preserveSavedGenerationConfig(meta, latest) {
  // Explicit saves win even for same-value writes or resetting a field to defaults.
  for (const field of ['artist', 'loras', 'promptPrefix']) {
    if (latest._generationConfigEdits?.[field] === meta._generationConfigEdits?.[field]) continue;
    if (Object.hasOwn(latest, field)) meta[field] = latest[field];
    else delete meta[field];
    meta.updatedAt = latest.updatedAt;
  }
  if (latest._generationConfigEdits) meta._generationConfigEdits = latest._generationConfigEdits;
}

function commitAssetImage(guard, row, buffer, meta, status = row.status, sourcePrompt = null) {
  const db = getDb();
  const filePath = assetFilePath(row.id, `${row.key || 'asset'}_${guard.token}`);
  const imagePath = `/town-assets/${path.basename(filePath)}`;
  try {
    db.transaction(() => {
      const latest = assertAssetCurrent(guard);
      preserveSavedGenerationConfig(meta, JSON.parse(latest.meta_json || '{}'));
      fs.mkdirSync(TOWN_ASSETS_DIR, { recursive: true });
      fs.writeFileSync(filePath, buffer);
      db.prepare('UPDATE town_assets SET image_path = ?, meta_json = ?, status = ?, source_prompt = COALESCE(?,source_prompt) WHERE id = ?')
        .run(imagePath, JSON.stringify(meta), status, sourcePrompt, row.id);
    }).immediate();
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch { /* only our unique unpublished file */ }
    throw err;
  }
  if (row.image_path && path.basename(row.image_path) !== path.basename(filePath)) {
    try { fs.unlinkSync(path.join(TOWN_ASSETS_DIR, path.basename(row.image_path))); } catch { /* optional old file */ }
  }
  const fresh = getAssetById(row.id);
  broadcastTownAssetsUpdated({ asset: fresh });
  return fresh;
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
async function generateIntoRow(row, guard) {
  assertAssetCurrent(guard);
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
    assertAssetCurrent(guard);
  } else {
    prompt = buildAssetPrompt({
      kind: row.kind,
      desc: meta.desc || row.name,
      styleTags: meta.styleTags || '',
      direction: meta.direction || null,
      special: !!meta.special,
      footprint: meta.footprint || null,
    });
  }

  // 固定前缀和画师/LoRA 优先使用素材级覆盖；未覆盖时回落到 system_settings 里的类型配置。
  const generationDefaults = generationDefaultsForAsset(row);
  const prefix = meta.promptPrefix !== undefined ? meta.promptPrefix : generationDefaults.prefix;
  if (prefix) prompt = `${prefix}, ${prompt}`;
  db.transaction(() => {
    assertAssetCurrent(guard);
    if (!(row.status === 'ready' && row.image_path)) {
      db.prepare(`UPDATE town_assets SET status = 'pending', source_prompt = ? WHERE id = ?`).run(prompt, row.id);
    }
  }).immediate();

  try {
    const result = await generateImageRaw(prompt, {
      scene: 'town',
      disableRAG: true,
      artist: meta.artist !== undefined ? meta.artist : generationDefaults.artist,
      width: size.width,
      height: size.height,
      loras: Array.isArray(meta.loras) && meta.loras.length ? meta.loras : (generationDefaults.loras.length ? generationDefaults.loras : undefined),
    });
    assertAssetCurrent(guard);
    if (!result?.success || !result.images?.length) {
      throw new Error(result?.error || 'ComfyUI 未返回图片');
    }
    const base64 = result.images[0].base64;
    const buffer = Buffer.from(base64.slice(base64.indexOf(',') + 1), 'base64');

    // 等距地砖：先裁出顶面菱形归一化成 2:1 贴图（接缝完美互锁），再像素化到 64×32
    const isTile = row.kind === 'ground' || row.kind === 'road';
    let work = buffer;
    if (isTile) {
      work = await flattenIsoTile(work);
      assertAssetCurrent(guard);
    }
    let tw;
    let th;
    let smoothResize = false;
    if (isTile) {
      tw = 64; th = 32;
    } else if (spec.pixelWidth && meta.footprint?.w) {
      // 建筑/大件道具按等距占格宽 (w+h)*32，渲染 1:1 不模糊
      tw = spec.pixelWidth(meta.footprint);
      th = Math.max(1, Math.round(tw * size.height / size.width));
    } else if (spec.maxSide) {
      // 插画小人：保留画质，仅轻缩存储（渲染时平滑缩放；像素风由生成 prompt 决定）
      const ratio = Math.min(1, spec.maxSide / Math.max(size.width, size.height));
      tw = Math.round(size.width * ratio);
      th = Math.round(size.height * ratio);
      smoothResize = true;
    } else {
      tw = size.width; th = size.height; // portrait 保持原分辨率
    }

    const outBuffer = await postProcessAsset(work, {
      targetW: tw, targetH: th, removeBg: spec.removeBg, cropContent: !!spec.cropContent, smoothResize,
    });
    assertAssetCurrent(guard);
    const outputMeta = await sharp(outBuffer).metadata();
    assertAssetCurrent(guard);
    meta.pixelSize = { w: outputMeta.width, h: outputMeta.height };
    meta.styleTags = meta.styleTags || '';
    meta.updatedAt = Date.now(); // 前端 URL 缓存穿透标记
    // 等距地砖：检测菱形中心锚点（渲染对齐用），失败回退 0.5
    if (isTile) {
      meta.groundAnchorY = (await detectTileAnchorY(outBuffer)) ?? 0.5;
      assertAssetCurrent(guard);
    }
    // Provenance describes these new pixels, never the prompt merely saved for a future job.
    if (guard.appearanceGuard) meta.appearanceSource = guard.appearanceGuard.source;
    else delete meta.appearanceSource;
    const fresh = commitAssetImage(guard, row, outBuffer, meta, 'ready', prompt);
    console.log(`[townAssets] ready #${row.id} ${row.kind}/${row.key} → ${fresh.image_path}`);
    return fresh;
  } catch (err) {
    db.transaction(() => {
      assertAssetCurrent(guard); // stale failure must not mark a replacement asset failed
      if (!(row.status === 'ready' && row.image_path)) db.prepare(`UPDATE town_assets SET status = 'failed' WHERE id = ?`).run(row.id);
    }).immediate();
    broadcastTownAssetsUpdated({ asset: getAssetById(row.id) });
    throw err;
  }
}

/**
 * 保存前端编辑后的素材图片（点击抠白 / 裁底等编辑产物，dataUrl PNG）
 * 发布新文件路径并 bump meta.updatedAt 供前端缓存穿透
 */
export async function saveEditedAssetImage(id, dataUrl) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) throw new Error(`asset #${id} not found`);
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('invalid image dataUrl');
  }
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const guard = claimAsset(row);
  // 尺寸守卫：编辑产物不超过 2048px
  const meta = await sharp(buffer).metadata();
  assertAssetCurrent(guard);
  if (!meta.width || !meta.height || meta.width > 2048 || meta.height > 2048) {
    throw new Error('图片尺寸异常');
  }
  const m = JSON.parse(row.meta_json || '{}');
  m.updatedAt = Date.now();
  m.editedAt = m.updatedAt;
  delete m.appearanceSource; // arbitrary uploaded pixels have no trusted generation source
  return commitAssetImage(guard, row, buffer, m, 'ready');
}

/**
 * 按截取框裁剪素材并覆盖（前端放大查看后划定最终成图范围）
 * @param {number} id - 素材 id
 * @param {{x:number,y:number,w:number,h:number}} rect - 存储图像素坐标的截取框
 */
export async function cropAssetImage(id, rect) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) throw new Error(`asset #${id} not found`);
  const { x, y, w, h } = rect || {};
  if (![x, y, w, h].every(v => Number.isInteger(v) && v >= 0) || w < 8 || h < 8) {
    throw new Error('截取框无效');
  }
  const filePath = path.join(TOWN_ASSETS_DIR, path.basename(row.image_path || assetFilePath(id, row.key)));
  if (!fs.existsSync(filePath)) throw new Error('素材文件不存在');
  const guard = claimAsset(row);
  const meta = await sharp(filePath).metadata();
  assertAssetCurrent(guard);
  if (x + w > meta.width || y + h > meta.height) throw new Error('截取框超出图片范围');
  const out = await sharp(filePath)
    .extract({ left: x, top: y, width: w, height: h })
    .png()
    .toBuffer();
  assertAssetCurrent(guard);

  const m = JSON.parse(row.meta_json || '{}');
  m.updatedAt = Date.now();
  m.croppedAt = m.updatedAt;
  m.pixelSize = { w, h };
  if (row.kind === 'ground' || row.kind === 'road') m.groundAnchorY = 0.5; // 裁切后菱形占满画幅
  return commitAssetImage(guard, row, out, m);
}

/** 小镇素材 HiresFix：沿用素材 source_prompt/meta，并按全局 HiresFix 设置细化后覆盖 */
export async function refineAssetWithHires(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) throw new Error(`asset #${id} not found`);
  if (!row.source_prompt?.trim()) throw new Error('素材缺少生成提示词');
  const filePath = path.join(TOWN_ASSETS_DIR, path.basename(row.image_path || assetFilePath(id, row.key)));
  if (!fs.existsSync(filePath)) throw new Error('素材文件不存在');

  const guard = claimAsset(row);
  const meta = JSON.parse(row.meta_json || '{}');
  fs.mkdirSync(TOWN_ASSETS_DIR, { recursive: true });
  const stagePath = path.join(TOWN_ASSETS_DIR, `.hires-${guard.token}.png`);
  try {
    await refineImage({
      filePath,
      outPath: stagePath,
      promptText: row.source_prompt,
      artist: meta.artist !== undefined ? meta.artist : config.comfyui.artist,
      loras: Array.isArray(meta.loras) ? meta.loras : [],
      scene: 'town',
    });
    assertAssetCurrent(guard);
    const sharpMeta = await sharp(stagePath).metadata();
    assertAssetCurrent(guard);
    meta.updatedAt = Date.now();
    meta.hiresAt = meta.updatedAt;
    meta.pixelSize = { w: sharpMeta.width, h: sharpMeta.height };
    return commitAssetImage(guard, row, fs.readFileSync(stagePath), meta);
  } finally {
    for (const staged of [stagePath, `${stagePath}.refining`]) {
      try { fs.unlinkSync(staged); } catch { /* only this operation's staging files */ }
    }
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
 * @param {object} p - { kind, key, name, desc, meta, worldSettingId, expectedWorld? }
 * @returns {Promise<object>} 完成后的素材行（ready/failed）
 */
export function createAsset({ kind, key, name, desc, meta = {}, worldSettingId = null, expectedWorld = captureTownAssetWorld(), appearanceGuard = null }) {
  if (!ASSET_SPECS[kind]) throw new Error(`unknown asset kind: ${kind}`);
  const db = getDb();
  const metaJson = { desc: desc || '', ...meta };
  delete metaJson.appearanceSource; // client metadata is not generation evidence
  const { row, guard } = db.transaction(() => {
    assertWorldCurrent(expectedWorld);
    const result = db.prepare(`
      INSERT INTO town_assets (kind, key, name, image_path, meta_json, world_setting_id, status)
      VALUES (?, ?, ?, '', ?, ?, 'pending')
    `).run(kind, key || null, name, JSON.stringify(metaJson), worldSettingId);
    const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(Number(result.lastInsertRowid));
    return { row, guard: claimAsset(row, expectedWorld, appearanceGuard) };
  }).immediate();
  broadcastTownAssetsUpdated({ asset: getAssetById(row.id) });
  return enqueueAssetJob(guard, () => generateIntoRow(row, guard));
}

/** 重生成一张素材（沿用原 meta；可传 desc/styleTags/prompt/loras/promptPrefix 与 expectedWorld） */
export function regenerateAsset(id, overrides = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) throw new Error(`asset #${id} not found`);
  const previousAsset = { ...row }; // image provenance/config before this request changes metadata
  const meta = JSON.parse(row.meta_json || '{}');
  if (overrides.desc !== undefined) meta.desc = overrides.desc;
  if (overrides.styleTags !== undefined) meta.styleTags = overrides.styleTags;
  if (overrides.prompt !== undefined && String(overrides.prompt).trim()) meta.promptOverride = String(overrides.prompt).trim();
  if (Array.isArray(overrides.loras)) meta.loras = overrides.loras;
  if (overrides.artist !== undefined) meta.artist = overrides.artist;
  if (overrides.promptPrefix !== undefined) meta.promptPrefix = overrides.promptPrefix;
  row.meta_json = JSON.stringify(meta);
  const guard = claimAsset(row, overrides.expectedWorld, overrides.appearanceGuard);
  guard.previousAsset = previousAsset;
  return enqueueAssetJob(guard, () => generateIntoRow(row, guard));
}

/** 只保存素材的生成配置（画师串/LoRA/固定前缀），不触发生图 */
export function updateAssetGenerationConfig(id, overrides = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) throw new Error(`asset #${id} not found`);
  const meta = JSON.parse(row.meta_json || '{}');
  if (overrides.artist !== undefined) {
    if (overrides.artist === null) delete meta.artist;
    else meta.artist = String(overrides.artist);
  }
  if (overrides.loras !== undefined) {
    if (overrides.loras === null) delete meta.loras;
    else meta.loras = normalizeTownGenerationLoras(overrides.loras);
  }
  if (overrides.promptPrefix !== undefined) {
    if (overrides.promptPrefix === null) delete meta.promptPrefix;
    else meta.promptPrefix = String(overrides.promptPrefix);
  }
  for (const field of ['artist', 'loras', 'promptPrefix']) {
    if (overrides[field] !== undefined) {
      meta._generationConfigEdits = { ...meta._generationConfigEdits, [field]: randomUUID() };
    }
  }
  meta.updatedAt = Date.now();
  db.prepare('UPDATE town_assets SET meta_json = ? WHERE id = ?').run(JSON.stringify(meta), id);
  return rowToAsset(db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id));
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
export async function generateAssetsBatch(jobs, onProgress, { expectedWorld = captureTownAssetWorld() } = {}) {
  const total = jobs.length;
  let done = 0;
  const results = [];
  for (const job of jobs) {
    assertWorldCurrent(expectedWorld);
    try {
      const asset = await createAsset({ ...job, expectedWorld });
      assertWorldCurrent(expectedWorld);
      results.push({ ok: true, asset });
    } catch (err) {
      assertWorldCurrent(expectedWorld); // stop old batch; never enqueue remaining jobs in new epoch
      console.warn('[townAssets] batch item failed:', err?.message);
      results.push({ ok: false, error: err?.message || '生成失败', job });
    }
    done++;
    if (onProgress) onProgress({ done, total, results });
  }
  return results;
}

/** 地砖/道路专用：styleTags 里的聚落类名词会泄漏成「草地上长出小房子」，剥掉 */
