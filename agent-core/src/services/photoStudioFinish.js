import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { saveBase64Image, deleteImageFileByUrl } from './imagePaths.js';
import { STUDIO_FRAMES, STUDIO_FILTERS, defaultFinishRecipe, normalizeStudioFrame, normalizeStudioFilter, studioFilterLayers } from '../shared/photoStudioFinishRenderer.js';
import { renderAutomaticStudioFinish, readStudioOriginal } from './photoStudioFinishRender.js';

const frames = STUDIO_FRAMES.map(option => option.value);
const filters = STUDIO_FILTERS.map(option => option.value);
const invalid = (message, status = 400) => Object.assign(new Error(message), { status });

export function validateFinishRecipe(value) {
  if (!value || ![1, 2, 3].includes(value.version) || !frames.includes(normalizeStudioFrame(value.frame)) || !filters.includes(normalizeStudioFilter(value.filter))
    || !Number.isFinite(value.intensity) || value.intensity < 0 || value.intensity > 100
    || !['thin', 'wide'].includes(value.border) || !['light', 'dark'].includes(value.tone)
    || typeof value.grain !== 'boolean' || typeof value.caption !== 'string' || value.caption.length > 60
    || (value.cameraSettings !== undefined && (typeof value.cameraSettings !== 'string' || value.cameraSettings.length > 80))) {
    throw invalid('装裱参数无效，请重新选择');
  }
  if (value.filters !== undefined && (!Array.isArray(value.filters) || value.filters.length > filters.length - 1
    || value.filters.some(layer => !layer || !filters.includes(normalizeStudioFilter(layer.filter))
      || !Number.isFinite(layer.intensity) || layer.intensity < 0 || layer.intensity > 100 || typeof layer.grain !== 'boolean'))) {
    throw invalid('滤镜叠加参数无效，请重新选择');
  }
  const layers = studioFilterLayers(value);
  const active = layers.find(layer => layer.filter === normalizeStudioFilter(value.filter) && layer.intensity === value.intensity && layer.grain === value.grain) || layers.at(-1);
  return { version: value.version, frame: normalizeStudioFrame(value.frame), filter: active?.filter || 'none', intensity: active?.intensity ?? value.intensity,
    border: value.border, tone: value.tone, grain: active?.grain ?? value.grain, caption: value.caption.trim(),
    cameraSettings: (value.cameraSettings ?? defaultFinishRecipe().cameraSettings).replace(/[\r\n\t]/g, ' ').trim(),
    ...(value.filters !== undefined ? { filters: layers } : {}) };
}

// Original job/output_url and image task are deliberately never updated here.
export function createPhotoStudioFinishService({ database = getDb, save = saveBase64Image, remove = deleteImageFileByUrl,
  render = renderAutomaticStudioFinish, read = readStudioOriginal } = {}) {
  const decode = row => row ? { ...row, recipe: JSON.parse(row.recipe) } : null;
  const list = () => database().prepare('SELECT * FROM photo_studio_finishes').all().map(decode);
  const get = id => decode(database().prepare('SELECT * FROM photo_studio_finishes WHERE job_id = ?').get(id));
  function defaults() {
    const row = database().prepare('SELECT * FROM photo_studio_finish_defaults WHERE id = 1').get();
    const last = row || database().prepare('SELECT recipe FROM photo_studio_finishes ORDER BY updated_at DESC, rowid DESC LIMIT 1').get();
    const recipe = last ? validateFinishRecipe(JSON.parse(last.recipe)) : defaultFinishRecipe();
    const active = recipe.frame !== 'none' || studioFilterLayers(recipe).length > 0;
    return { enabled: row ? Boolean(row.enabled) && active : active,
      recipe: { ...recipe, version: 3, intensity: recipe.version < 3 ? 100 : recipe.intensity, caption: '' } };
  }
  function setDefaults({ enabled, recipe }) {
    if (typeof enabled !== 'boolean') throw invalid('自动装裱状态无效');
    const normalized = { ...validateFinishRecipe(recipe), version: 3, caption: '' };
    database().prepare(`INSERT INTO photo_studio_finish_defaults (id, recipe, enabled) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET recipe=excluded.recipe, enabled=excluded.enabled, updated_at=datetime('now')`)
      .run(JSON.stringify(normalized), enabled && (normalized.frame !== 'none' || studioFilterLayers(normalized).length > 0) ? 1 : 0);
    return defaults();
  }
  async function store(jobId, recipe, bytes, { automatic = false, persistDefaults = !automatic, reuseForNewPhotos = true } = {}) {
    const db = database();
    const job = db.prepare('SELECT status, stage, output_url FROM photo_studio_jobs WHERE id = ?').get(jobId);
    if (!job) throw invalid('找不到这次拍摄', 404);
    if (!((job.status === 'done' && (automatic || job.stage !== 'finishing')) || (automatic && job.status === 'running' && job.stage === 'finishing')) || !job.output_url) throw invalid('照片仍在处理中，暂时不能装裱', 409);
    const normalized = validateFinishRecipe(recipe);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 32 * 1024 * 1024) throw invalid('成品图片为空或超过 32MB');
    let png, metadata;
    try {
      const image = sharp(bytes, { limitInputPixels: 40_000_000 });
      metadata = await image.metadata();
      if (metadata.format !== 'png' || metadata.pages > 1) throw new Error('format');
      png = await image.png().toBuffer();
    } catch { throw invalid('无法读取成品 PNG，请重新导出'); }
    const output = await save('photo_studio', `finish-${randomUUID()}.png`, `data:image/png;base64,${png.toString('base64')}`);
    let previous;
    try {
      db.transaction(() => {
        previous = db.prepare('SELECT output_url FROM photo_studio_finishes WHERE job_id = ?').get(jobId);
        db.prepare(`INSERT INTO photo_studio_finishes (job_id, source_url, output_url, recipe, width, height) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(job_id) DO UPDATE SET source_url=excluded.source_url, output_url=excluded.output_url,
          recipe=excluded.recipe, width=excluded.width, height=excluded.height, updated_at=datetime('now')`)
          .run(jobId, job.output_url, output, JSON.stringify(normalized), metadata.width, metadata.height);
        db.prepare('UPDATE photo_studio_jobs SET finish_error = NULL WHERE id = ?').run(jobId);
        if (persistDefaults) setDefaults({ enabled: reuseForNewPhotos, recipe: normalized });
      })();
    } catch (error) { await remove(output); throw error; }
    // Only superseded files produced by this feature may be cleaned up.
    if (/^\/images\/photo_studio\/finish-[\w-]+\.png$/.test(previous?.output_url || '')) {
      try { await remove(previous.output_url); } catch { /* Keep the successfully saved new finish. */ }
    }
    return decode(db.prepare('SELECT * FROM photo_studio_finishes WHERE job_id = ?').get(jobId));
  }
  async function automatic(jobId, recipe, bytes) {
    const job = database().prepare('SELECT output_url FROM photo_studio_jobs WHERE id = ?').get(jobId);
    if (!job?.output_url) throw invalid('找不到原片', 404);
    const normalized = { ...validateFinishRecipe(recipe), version: 3 };
    const png = await render(bytes || await read(job.output_url), normalized);
    return store(jobId, normalized, png, { automatic: true });
  }
  return { list, get, defaults, setDefaults, store, automatic };
}
