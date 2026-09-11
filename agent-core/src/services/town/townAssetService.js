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
import { postProcessAsset, detectTileAnchorY, flattenIsoTileWithRect, extractIsoDiamond } from './assetPostProcess.js';
import { refineImage } from '../imageRefine.js';
import { generateBuildingPrompt } from './townPromptBuilder.js';
import { broadcastTownAssetsUpdated } from './townBus.js';
import { removeDeletedAssetReferences } from './townMapService.js';
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
    // 成品是 64×32 的平铺贴图，生成端不需要 1536：800×800 出图更省时间/显存，缩到像素尺寸前细节仍够
    size: { width: 800, height: 800 },
    // {desc} 会被插进「顶面完全被该材质覆盖」的句子里，避免模型画成花坛（顶面裸土、草只长边缘）
    promptTemplate: 'isometric ground tile, one single flat diamond-shaped block seen from a 45 degree angle, the entire top face is fully covered edge to edge by {desc}, the material reaches every corner of the top face, soil visible only on the thin sides below the top face, tile centered and filling the whole square frame, straight edges, game map tile',
    removeBg: false,
    pixel: { w: 64, h: 32 },
    artist: '',
  },
  road: {
    size: { width: 800, height: 800 }, // 与 ground 一致，见上
    promptTemplate: 'isometric road tile, one single flat diamond-shaped block seen from a 45 degree angle, the entire top face is fully covered edge to edge by {desc}, the material reaches every corner of the top face, soil visible only on the thin sides below the top face, tile centered and filling the whole square frame, straight edges, game map tile',
    removeBg: false,
    pixel: { w: 64, h: 32 },
    artist: '',
  },
  building: {
    size: { width: 1200, height: 1200 },
    // 英文 prompt 由 LLM 按酒馆立绘同款四层结构生成（townPromptBuilder），此串仅兜底
    prompt: 'isometric building game sprite on an empty white background, seen from a 45 degree angle showing two walls and the roof, the building sits directly on the background with a clean straight bottom edge, no base platform, no foundation slab, no ground tiles, no pavement, nothing attached below or beside the walls, complete building centered and filling the frame, game map asset',
    removeBg: true,
    cropContent: true,
    // 按等距占格宽 (w+h)*32 画：烘焙成 2× 做超采样，zoom=1 时约 2 texel/px，放到 2.5 倍仍有富余
    pixelWidth: (fp) => (fp.w + fp.h) * 64, // 2× 烘焙：贴图密度高于屏幕需求，缩小/放大都由 GPU 采样
  },
  prop: {
    size: { width: 512, height: 512 },
    prompt: 'a single object sprite standing on an empty white background, small soft shadow right under it, nothing else in the image, isolated game sprite, slight three-quarter view from a bit above, complete object visible, centered',
    removeBg: true,
    cropContent: true,
    pixel: { w: 64, h: 64 },
    pixelWidth: (fp) => (fp.w + fp.h) * 64, // 2× 烘焙：贴图密度高于屏幕需求，缩小/放大都由 GPU 采样
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
  building: 'pixel art, game sprite, white background',
  prop: 'pixel art, game sprite, white background',
  npc: 'pixel art, game sprite, mini human sized, full body',
  player: 'pixel art, game sprite, mini human sized, full body',
  portrait: '',
  ground: 'pixel art, game sprite, white background',
  road: 'pixel art, game sprite, white background',
};

/** 像素小人（npc/player 的正/背小人）固定追加的硬 tag：Q 版大头，保证各世界头身比一致 */
export const SPRITE_HARD_TAGS = ['chibi', 'big head'];

/** tag 是否已整词出现（大小写不敏感），避免与用户前缀 / LLM 正文重复 */
function hasPromptTag(text, tag) {
  const escaped = tag.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/).join('\\s+');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

/**
 * 组装最终 prompt：固定前缀 + 像素小人硬 tag 在最前，描述正文在后。
 * 像素小人的 chibi / big head 是硬逻辑：只看前缀有没有手写过，缺的补齐，
 * 保证最终 prompt 一定带这两个 tag（LLM 正文写没写不影响）。
 * verbatim = true 表示 prompt 是用户在「图片提示词」弹窗里手写的完整提示词：
 * 原样送 ComfyUI，不再补前缀 / 硬 tag——这是弹窗「改动后完全按新提示词出图」的兑现口径，
 * 否则用户想删掉前缀里的 tag（如 chibi / big head）会被重新补回来，看起来像没生效。
 * @param {object} p - { kind, prefix, prompt, verbatim }
 */
export function composeAssetPrompt({ kind, prefix = '', prompt = '', verbatim = false }) {
  const body = String(prompt || '').trim();
  if (verbatim && body.trim()) return body.trim();
  const tags = kind === 'npc' || kind === 'player'
    ? SPRITE_HARD_TAGS.filter(tag => !hasPromptTag(prefix, tag))
    : [];
  const head = [prefix, tags.join(', ')].filter(Boolean).join(', ');
  if (!head) return body;
  return body ? `${head}, ${body}` : head;
}

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

function commitAssetImage(guard, row, buffer, meta, status = row.status, sourcePrompt = null, extraFiles = null) {
  const db = getDb();
  const filePath = assetFilePath(row.id, `${row.key || 'asset'}_${guard.token}`);
  const imagePath = `/town-assets/${path.basename(filePath)}`;
  const writtenExtras = [];
  try {
    db.transaction(() => {
      const latest = assertAssetCurrent(guard);
      preserveSavedGenerationConfig(meta, JSON.parse(latest.meta_json || '{}'));
      fs.mkdirSync(TOWN_ASSETS_DIR, { recursive: true });
      fs.writeFileSync(filePath, buffer);
      // 附属文件（地砖的裁剪前原图）与成品同批落盘：事务失败时一起删，不留孤儿文件
      for (const extra of extraFiles || []) {
        fs.writeFileSync(extra.path, extra.buffer);
        writtenExtras.push(extra.path);
      }
      db.prepare('UPDATE town_assets SET image_path = ?, meta_json = ?, status = ?, source_prompt = COALESCE(?,source_prompt) WHERE id = ?')
        .run(imagePath, JSON.stringify(meta), status, sourcePrompt, row.id);
    }).immediate();
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch { /* only our unique unpublished file */ }
    for (const extraPath of writtenExtras) { try { fs.unlinkSync(extraPath); } catch { /* optional extra */ } }
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

/** 文件名安全片段：素材 key 可能带中文 / 空格 */
function safeAssetKey(id, key) {
  return String(key || `asset${id}`).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 地砖裁剪前原图（固定名，每次重新生成覆盖）：素材库的菱形裁剪要拿它当底图 */
function tileSourceFilePath(id, key) {
  return path.join(TOWN_ASSETS_DIR, `asset_${id}_${safeAssetKey(id, key)}_source.png`);
}

function assetFilePath(id, key) {
  return path.join(TOWN_ASSETS_DIR, `asset_${id}_${safeAssetKey(id, key)}.png`);
}

function rowToAsset(row) {
  if (!row) return null;
  let meta = {};
  try { meta = JSON.parse(row.meta_json || '{}'); } catch { /* 忽略坏 meta */ }
  return { ...row, meta };
}

/**
 * 把「源图」处理成该素材可用的成品并落盘落库：地砖归一成 2:1 菱形贴图、抠白、裁到内容、按规格缩放。
 * ComfyUI 生成与用户手动上传共用这条后处理管线，保证尺寸 / 画幅约定一致。
 * @param {object} p - { row, guard, meta, spec, size, buffer, prompt }
 */
async function commitProcessedSource({ row, guard, meta, spec, size, buffer, prompt = null }) {
  // 等距地砖：先裁出顶面菱形归一化成 2:1 贴图（接缝完美互锁），再像素化到 64×32
  const isTile = row.kind === 'ground' || row.kind === 'road';
  let work = buffer;
  let tileRect = null;
  if (isTile) {
    const flattened = await flattenIsoTileWithRect(work);
    work = flattened.buffer;
    tileRect = flattened.rect; // 自动检测到的菱形框：素材库拿它当初始裁剪框
    assertAssetCurrent(guard);
  }
  let tw;
  let th;
  let smoothResize = false;
  if (isTile) {
    tw = 64; th = 32;
  } else if (spec.pixelWidth && meta.footprint?.w) {
    // 建筑/大件道具按等距占格宽 (w+h)*32 的 2× 烘焙：配 linear+mipmap，放大不结块
    tw = spec.pixelWidth(meta.footprint);
    th = Math.max(1, Math.round(tw * size.height / size.width));
  } else if (spec.maxSide) {
    // 插画小人：保留画质，仅轻缩存储（渲染时平滑缩放；像素风由生成 prompt 决定）
    const ratio = Math.min(1, spec.maxSide / Math.max(size.width, size.height));
    tw = Math.round(size.width * ratio);
    th = Math.round(size.height * ratio);
    smoothResize = true;
  } else {
    // portrait：不强制 fill 拉伸到规格画幅（生成端实际返回尺寸可能与规格不一致，
    // fit:'fill' 会把原图硬拉变形+重采样发糊）。按原分辨率存储，仅超出规格时轻缩。
    tw = size.width; th = size.height;
    smoothResize = true;
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
  // 地砖：一并留下裁剪前的原图（素材库里可在这张图上手动画菱形重裁）
  let tileSourceFile = null;
  if (isTile) {
    const sourcePath = tileSourceFilePath(row.id, row.key);
    meta.sourceImage = `/town-assets/${path.basename(sourcePath)}`;
    meta.sourceUpdatedAt = meta.updatedAt; // 原图是固定名：用生成时间做 URL 缓存穿透，重裁不换原图
    if (tileRect) meta.sourceDiamond = tileRect;
    else delete meta.sourceDiamond;
    tileSourceFile = { path: sourcePath, buffer };
  }
  const fresh = commitAssetImage(guard, row, outBuffer, meta, 'ready', prompt, tileSourceFile ? [tileSourceFile] : null);
  console.log(`[townAssets] ready #${row.id} ${row.kind}/${row.key} → ${fresh.image_path}`);
  return fresh;
}
/** 生成一张素材并落盘落库（串行队列内执行） */
async function generateIntoRow(row, guard) {
  assertAssetCurrent(guard);
  const db = getDb();
  const meta = JSON.parse(row.meta_json || '{}');
  const spec = ASSET_SPECS[row.kind];
  const size = spec.size;

  // prompt 来源优先级：meta.promptOverride（用户手改 / 立绘 LLM 产物）→ source_prompt（当前生效提示词，直接复用）
  // → 建筑 LLM → 静态组装。「重新生成」= 用当前提示词换种子重出图，不重新生成提示词；
  // source_prompt 是上次落库的最终完整 prompt（已含前缀 / 硬 tag），按 verbatim 原样送 ComfyUI。
  let prompt;
  let promptVerbatim = meta.promptVerbatim === true;
  if (meta.promptOverride) {
    prompt = meta.promptOverride;
  } else if (String(row.source_prompt || '').trim()) {
    prompt = String(row.source_prompt).trim();
    promptVerbatim = true;
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
  // promptVerbatim = true 表示 prompt 已是完整提示词（弹窗手写或 source_prompt 复用）：
  // 原样送 ComfyUI，不再补前缀 / 硬 tag（弹窗「改动后完全按新提示词出图」的兑现口径）。
  const generationDefaults = generationDefaultsForAsset(row);
  const prefix = meta.promptPrefix !== undefined ? meta.promptPrefix : generationDefaults.prefix;
  prompt = composeAssetPrompt({ kind: row.kind, prefix, prompt, verbatim: promptVerbatim });
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

    return commitProcessedSource({ row, guard, meta, spec, size, buffer, prompt });

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

const UPLOAD_MIME_RE = /^data:image\/(png|jpe?g|webp);base64,/i;

/**
 * 手动上传本地图片替换素材（base64 dataUrl）。
 * 走与生成同一条后处理管线（见 commitProcessedSource）：地砖归一成菱形贴图、其余按素材规格抠白/裁切/缩放，
 * 上传什么尺寸都能直接被小镇渲染，不需要用户自己裁成 64×32 之类的成品尺寸。
 */
export async function importAssetImage(id, dataUrl) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) throw new Error(`asset #${id} not found`);
  if (typeof dataUrl !== 'string' || !UPLOAD_MIME_RE.test(dataUrl)) throw new Error('请上传 PNG / JPG / WEBP 图片');
  // 前端已限 6MB；这里拦一道解码前超限的（base64 约为原大小 4/3）
  if (dataUrl.length > 8 * 1024 * 1024) throw new Error('图片过大，请压缩后再上传（不超过 6MB）');
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (!buffer.length) throw new Error('图片内容为空');
  const spec = ASSET_SPECS[row.kind];
  const guard = claimAsset(row);
  let info;
  try {
    info = await sharp(buffer).metadata();
  } catch {
    throw new Error('无法识别这张图片，请换一张 PNG / JPG / WEBP');
  }
  assertAssetCurrent(guard);
  if (!info.width || !info.height) throw new Error('图片尺寸异常');
  if (Math.max(info.width, info.height) > 4096) throw new Error('图片边长请控制在 4096px 以内');
  const meta = JSON.parse(row.meta_json || '{}');
  meta.uploadedAt = Date.now();
  const fresh = await commitProcessedSource({ row, guard, meta, spec, size: spec.size, buffer });
  console.log(`[townAssets] uploaded #${row.id} ${row.kind}/${row.key} → ${fresh.image_path}`);
  return fresh;
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

/**
 * 地砖专用裁剪：在「裁剪前原图」上按用户选定的 2:1 菱形重裁 → 像素化到 64×32 覆盖成品。
 * 与生成时的自动归一化走同一条管线（extractIsoDiamond → pixelate），用户可微调菱形避开侧面 / 顶面装饰。
 * @param {number} id - 素材 id
 * @param {{x:number,y:number,w:number}} diamond - 原图像素坐标的菱形包围框（高 = 宽 / 2）
 */
export async function cropTileAssetImage(id, diamond) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) throw new Error(`asset #${id} not found`);
  if (row.kind !== 'ground' && row.kind !== 'road') throw new Error('只有地皮/道路支持菱形裁剪');
  const m = JSON.parse(row.meta_json || '{}');
  if (!m.sourceImage) throw new Error('这张地皮没有裁剪前原图，请先重新生成');
  const sourcePath = path.join(TOWN_ASSETS_DIR, path.basename(m.sourceImage));
  if (!fs.existsSync(sourcePath)) throw new Error('裁剪前原图已丢失，请先重新生成');

  const guard = claimAsset(row);
  const diamondBuffer = await extractIsoDiamond(fs.readFileSync(sourcePath), diamond);
  assertAssetCurrent(guard);
  const spec = ASSET_SPECS[row.kind] || {};
  const out = await postProcessAsset(diamondBuffer, { targetW: spec.pixel?.w ?? 64, targetH: spec.pixel?.h ?? 32 });
  assertAssetCurrent(guard);
  const outMeta = await sharp(out).metadata();
  assertAssetCurrent(guard);

  m.updatedAt = Date.now();
  m.croppedAt = m.updatedAt;
  m.tileCrop = { x: Math.round(diamond.x), y: Math.round(diamond.y), w: Math.round(diamond.w) };
  m.pixelSize = { w: outMeta.width, h: outMeta.height };
  m.groundAnchorY = (await detectTileAnchorY(out)) ?? 0.5; // 裁切后菱形占满画幅
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

/**
 * 把一张**已经存在**的图片登记为小镇素材：只落库不动图片、不触发生图。
 * 用途：邀请入邻舍的角色复用关联居民已有的小镇立绘 / 小人，接进素材库后与 NPC 走同一套
 * 「素材 → 管理面板 → 小镇渲染」口径，不重复生图。
 * 注意：酒馆立绘（characters.standing_url）**不走这里** —— 它不是小镇素材，不进素材库、面板也不显示。
 *
 * 覆盖规则：已有 ready 素材且图片不同时**保留原图**，除非那条素材本身就是登记来的同一来源
 * （meta.importedFrom === 它的 image_path）——这样用户在小镇里重绘 / 手工编辑过的立绘不会被酒馆立绘顶掉。
 * 登记进来的图片文件不归素材库所有（见 deleteAsset）：删除素材只删记录，不删原文件。
 */
export function registerAssetFromUrl({ kind, key, name, url, desc = '', meta = {} }) {
  if (!ASSET_SPECS[kind]) throw new Error(`unknown asset kind: ${kind}`);
  const imagePath = typeof url === 'string' ? url.trim() : '';
  if (!key || !imagePath) throw new Error('登记素材需要 key 与图片地址');
  const db = getDb();
  const existing = db.prepare('SELECT * FROM town_assets WHERE key = ?').get(key);
  const prevMeta = rowToAsset(existing)?.meta || {};
  if (existing?.status === 'ready' && existing.image_path && existing.image_path !== imagePath
    && prevMeta.importedFrom !== existing.image_path) {
    return rowToAsset(existing);
  }
  const metaJson = JSON.stringify({
    ...prevMeta, ...meta, desc: desc || prevMeta.desc || '',
    importedFrom: imagePath, updatedAt: Date.now(),
  });
  if (existing) {
    db.prepare(`UPDATE town_assets SET name = ?, image_path = ?, meta_json = ?, status = 'ready' WHERE id = ?`)
      .run(name || existing.name, imagePath, metaJson, existing.id);
  } else {
    db.prepare(`
      INSERT INTO town_assets (kind, key, name, image_path, meta_json, world_setting_id, status)
      VALUES (?, ?, ?, ?, ?, NULL, 'ready')
    `).run(kind, key, name, imagePath, metaJson);
  }
  const asset = rowToAsset(db.prepare('SELECT * FROM town_assets WHERE key = ?').get(key));
  console.log(`[townAssets] registered ${kind}/${key} → ${imagePath}`);
  broadcastTownAssetsUpdated({ asset });
  return asset;
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
  if (overrides.prompt !== undefined && String(overrides.prompt).trim()) {
    meta.promptOverride = String(overrides.prompt).trim();
    // 弹窗带 verbatim: true → 用户手写的完整提示词；其他调用方（NPC/建筑 LLM）不带 → 仍按常规补前缀/硬 tag
    meta.promptVerbatim = overrides.verbatim === true;
  }
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
/** 删除素材（含磁盘文件）；引用它的地图图层由 removeDeletedAssetReferences 统一清理并广播地图更新 */
export function deleteAsset(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_assets WHERE id = ?').get(id);
  if (!row) return { ok: false, error: '素材不存在' };
  const meta = rowToAsset(row)?.meta || {};
  // 登记进来的站外图片（酒馆立绘、关联居民素材）不属于素材库，删记录不删原文件
  if (row.image_path && meta.importedFrom !== row.image_path) {
    const filePath = path.join(TOWN_ASSETS_DIR, path.basename(row.image_path));
    try { fs.unlinkSync(filePath); } catch { /* 文件可能已不存在 */ }
  }
  if (meta.sourceImage) { // 地砖的裁剪前原图
    try { fs.unlinkSync(path.join(TOWN_ASSETS_DIR, path.basename(meta.sourceImage))); } catch { /* 原图已不存在 */ }
  }
  db.prepare('DELETE FROM town_assets WHERE id = ?').run(id);
  const scrubbed = removeDeletedAssetReferences();
  if (scrubbed) {
    console.log(`[townAssets] deleted #${id}: map cleaned (objects -${scrubbed.removedObjects}, ground -${scrubbed.groundCells}, road -${scrubbed.roadCells})`);
  }
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
