/**
 * 图片压缩调度器
 *
 * - 定时任务：平时小压缩（30min / 3张），凌晨大压缩（10min / 15张）
 * - 立即压缩：全量处理直到最新文件，SSE 推送进度，可取消
 * - 状态持久化：cursor 机制记录处理进度，重启续传
 * - 两种压缩模式：
 *   OxiPng — 无损重编码 PNG (compressionLevel=9, palette, effort=10)，覆盖原文件
 *   AVIF   — 转 AVIF quality=50, effort=4，删除原 PNG
 */

import sharp from 'sharp';
import { readdir, stat, unlink, rename } from 'fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { broadcast } from './unifiedStreamBus.js';
import { config, updateCompressConfig } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, '..', '..', 'data', 'images');
const STATE_FILE = resolve(__dirname, '..', '..', 'data', 'image-compressor-state.json');

// ── 默认状态 ──
const DEFAULT_STATE = {
  lastProcessedFile: null,
  totalProcessed: 0,
  totalOriginalBytes: 0,
  totalCompressedBytes: 0,
  lastRun: null,
};

// ── 运行时状态 ──
let state = { ...DEFAULT_STATE };
let schedulerTimer = null;
let schedulerProcessing = false;

// 立即压缩任务
let batchTask = null;  // { cancelled, phase, current, total, currentFile, errors }

// ── 状态持久化 ──

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = readFileSync(STATE_FILE, 'utf-8');
      const loaded = JSON.parse(raw);
      state = { ...DEFAULT_STATE, ...loaded };
      // 不恢复 task（重启后立即压缩任务已失效）
      batchTask = null;
    }
  } catch (e) {
    console.warn('[imageCompressor] Failed to load state, using defaults:', e.message);
    state = { ...DEFAULT_STATE };
  }
}

function saveState() {
  try {
    const toSave = { ...state };
    // batchTask 独立保存，不混入持久化
    writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
  } catch (e) {
    console.error('[imageCompressor] Failed to save state:', e.message);
  }
}

// ── 文件列表 ──

async function listPngFiles() {
  if (!existsSync(IMAGES_DIR)) return [];
  const files = await readdir(IMAGES_DIR);
  const pngs = files.filter(f => /\.png$/i.test(f));

  // 按创建时间升序排列
  const withStats = [];
  const BATCH = 64;
  for (let i = 0; i < pngs.length; i += BATCH) {
    const batch = pngs.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (name) => {
        const s = await stat(join(IMAGES_DIR, name));
        return { name, birthtime: s.birthtimeMs, mtime: s.mtimeMs, size: s.size };
      })
    );
    withStats.push(...results);
  }

  withStats.sort((a, b) => a.birthtime - b.birthtime);
  return withStats;
}

// ── 单张压缩 ──

async function compressOne(fileInfo) {
  const { name, size } = fileInfo;
  const inputPath = join(IMAGES_DIR, name);
  const baseName = name.replace(/\.png$/i, '');
  const isAvif = config.compression.type === 'avif';

  const result = {
    filename: name,
    originalSize: size,
    compressedSize: 0,
    success: false,
    elapsed: 0,
  };

  const t0 = performance.now();

  try {
    if (isAvif) {
      const outPath = join(IMAGES_DIR, `${baseName}.avif`);
      await sharp(inputPath)
        .avif({ quality: 50, effort: 4 })
        .toFile(outPath);

      const outStat = await stat(outPath);
      result.compressedSize = outStat.size;
      result.success = true;

      // 先更新 cursor 再删原文件：状态原子化，防崩溃丢文件
      state.lastProcessedFile = name;
      state.totalProcessed++;
      state.totalOriginalBytes += size;
      state.totalCompressedBytes += result.compressedSize;
      state.lastRun = new Date().toISOString();
      saveState();

      await unlink(inputPath);
    } else {
      // OxipNG: 重编码到临时文件，成功后再替换
      const tmpPath = join(IMAGES_DIR, `${name}.tmp`);
      await sharp(inputPath)
        .png({ compressionLevel: 9, palette: true, effort: 10 })
        .toFile(tmpPath);

      const tmpStat = await stat(tmpPath);
      result.compressedSize = tmpStat.size;

      if (tmpStat.size >= size) {
        await unlink(tmpPath);
        console.log(`[imageCompressor] Skipped ${name}: compressed size (${tmpStat.size}) >= original (${size})`);
        result.success = false;
        result.error = 'no_reduction';
      } else {
        await unlink(inputPath);
        await rename(tmpPath, inputPath);
        result.success = true;
      }

      state.lastProcessedFile = name;
      state.totalProcessed++;
      state.totalOriginalBytes += size;
      state.totalCompressedBytes += result.compressedSize;
      state.lastRun = new Date().toISOString();
      saveState();
    }

    return result;
  } catch (err) {
    result.elapsed = Math.round(performance.now() - t0);
    result.error = err.message;
    result.success = false;

    // 清理可能残留的临时文件
    const tmpPath = join(IMAGES_DIR, `${name}.tmp`);
    try { if (existsSync(tmpPath)) await unlink(tmpPath); } catch {}

    return result;
  }
}

// ── 获取待处理文件列表 ──

async function getPendingFiles(limit, cursorOnly = false) {
  const allFiles = await listPngFiles();
  if (allFiles.length === 0) return [];

  // 从 cursor 之后开始
  let startIdx = 0;
  if (state.lastProcessedFile) {
    const cursorIdx = allFiles.findIndex(f => f.name === state.lastProcessedFile);
    startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0;
  }

  // 跳过最近 5 分钟内创建的文件（避免和 ComfyUI 写盘冲突）
  const now = Date.now();
  const safeBoundary = now - 5 * 60 * 1000;

  const candidates = allFiles.slice(startIdx).filter(f => f.birthtime < safeBoundary);

  if (limit > 0 && !cursorOnly) {
    return candidates.slice(0, limit);
  }
  return candidates;
}

// ── 批量压缩 ──

async function compressBatch(limit) {
  const files = await getPendingFiles(limit);
  if (files.length === 0) return { processed: 0, files: [] };

  const results = [];
  for (const file of files) {
    const result = await compressOne(file);
    results.push(result);
  }

  return { processed: results.filter(r => r.success).length, files: results };
}

// ── 定时调度器 ──

const SCHEDULE_CONFIG = {
  peak:   { interval: 10 * 60 * 1000, batch: 3  },  // 白天：10min / 3张
  offPeak: { interval: 10 * 60 * 1000, batch: 15 },  // 凌晨：10min / 15张
  offPeakStart: 2,  // 凌晨2点
  offPeakEnd: 5,    // 早上5点
};

function isOffPeak() {
  const hour = new Date().getHours();
  return hour >= SCHEDULE_CONFIG.offPeakStart && hour < SCHEDULE_CONFIG.offPeakEnd;
}

function getScheduleConfig() {
  return isOffPeak() ? SCHEDULE_CONFIG.offPeak : SCHEDULE_CONFIG.peak;
}

async function schedulerTick() {
  if (schedulerProcessing) return;
  if (!config.compression.enabled) return;
  if (batchTask?.processing) {
    // 立即压缩进行中，跳过定时（避免抢文件）
    return;
  }

  schedulerProcessing = true;
  try {
    const cfg = getScheduleConfig();
    const result = await compressBatch(cfg.batch);
    if (result.processed > 0) {
      console.log(`[imageCompressor] Scheduled: ${result.processed} files compressed (${isOffPeak() ? 'off-peak' : 'peak'})`);
    }
  } catch (err) {
    console.error('[imageCompressor] Scheduler tick error:', err.message);
  } finally {
    schedulerProcessing = false;
  }
}

function reschedule() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (!config.compression.enabled) return;

  // 先等 60 秒再开始第一个 tick
  schedulerTimer = setTimeout(() => {
    schedulerTick();
    // 后续按当前时段间隔轮询
    schedulerTimer = setInterval(() => {
      schedulerTick();
      // 动态调整间隔（可能在 tick 中途跨时段）
      const cfg = getScheduleConfig();
      if (schedulerTimer._interval !== cfg.interval) {
        clearInterval(schedulerTimer);
        schedulerTimer = setInterval(schedulerTick, cfg.interval);
      }
    }, getScheduleConfig().interval);
  }, 60_000);
}

// ── 立即压缩（全量，SSE 推送进度）──

async function runFullCompression() {
  const allFiles = await listPngFiles();
  if (allFiles.length === 0) {
    batchTask = { phase: 'complete', current: 0, total: 0, processing: false };
    return;
  }

  // 从头开始（忽略 cursor）
  let startIdx = 0;
  if (state.lastProcessedFile) {
    const cursorIdx = allFiles.findIndex(f => f.name === state.lastProcessedFile);
    startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0;
  }

  // 不过滤最近文件（立即压缩就是要全量）
  const pending = allFiles.slice(startIdx);

  if (pending.length === 0) {
    batchTask = { phase: 'complete', current: 0, total: 0, processing: false };
    broadcast('image_compress_progress', { phase: 'complete', current: state.totalProcessed, total: allFiles.length });
    return;
  }

  batchTask = {
    cancelled: false,
    phase: 'running',
    current: state.totalProcessed,
    total: allFiles.length,
    currentFile: '',
    errors: [],
    processing: true,
  };

  broadcast('image_compress_progress', {
    phase: 'running',
    current: state.totalProcessed,
    total: allFiles.length,
    currentFile: '',
  });

  for (const file of pending) {
    if (batchTask.cancelled) break;

    batchTask.current++;
    batchTask.currentFile = file.name;

    broadcast('image_compress_progress', {
      phase: 'running',
      current: batchTask.current,
      total: batchTask.total,
      currentFile: file.name,
    });

    const result = await compressOne(file);
    if (!result.success && result.error) {
      batchTask.errors.push({ file: file.name, error: result.error });
    }
  }

  batchTask.processing = false;
  const finalPhase = batchTask.cancelled ? 'cancelled' : 'complete';
  batchTask.phase = finalPhase;

  broadcast('image_compress_progress', {
    phase: finalPhase,
    current: batchTask.current,
    total: batchTask.total,
    currentFile: '',
    errors: batchTask.errors,
  });

  console.log(`[imageCompressor] Full compression ${finalPhase}: ${batchTask.current}/${batchTask.total}, errors: ${batchTask.errors.length}`);
}

// ── 公共 API ──

export function getState() {
  return {
    enabled: config.compression.enabled,
    compressionType: config.compression.type,
    totalProcessed: state.totalProcessed,
    totalOriginalBytes: state.totalOriginalBytes,
    totalCompressedBytes: state.totalCompressedBytes,
    lastRun: state.lastRun,
    task: batchTask ? {
      phase: batchTask.phase,
      current: batchTask.current,
      total: batchTask.total,
      currentFile: batchTask.currentFile,
      errors: batchTask.errors?.length || 0,
      processing: batchTask.processing,
    } : null,
  };
}

export function updateServiceConfig({ enabled, type }) {
  if (enabled !== undefined || type !== undefined) {
    updateCompressConfig({ enabled, type });
  }
  reschedule();
  return getState();
}

export function startFullCompression() {
  if (batchTask?.processing) {
    return { error: '已有压缩任务进行中', busy: true };
  }

  // 不阻塞 HTTP 响应，异步执行
  runFullCompression().catch(err => {
    console.error('[imageCompressor] Full compression error:', err.message);
    if (batchTask) {
      batchTask.phase = 'error';
      batchTask.processing = false;
    }
    broadcast('image_compress_progress', { phase: 'error', error: err.message });
  });

  return { started: true };
}

export function cancelCompression() {
  if (!batchTask?.processing) {
    return { error: '没有进行中的压缩任务' };
  }
  batchTask.cancelled = true;
  return { cancelled: true };
}

export function startScheduler() {
  loadState();
  console.log(`[imageCompressor] Loaded: enabled=${config.compression.enabled}, type=${config.compression.type}, cursor at ${state.totalProcessed}`);
  reschedule();
}
