/**
 * 图片压缩调度器
 *
 * - 定时任务：平时小压缩（30min / 3张），凌晨大压缩（10min / 15张）
 * - 立即压缩：全量处理直到最新文件，SSE 推送进度，可取消
 * - 状态持久化：cursor 机制记录处理进度，重启续传
 * - 多目录支持：历史平铺 + chat/moments/events/gifts/avatargen/peek 子目录
 * - 两种压缩模式：
 *   OxiPng — 无损重编码 PNG (compressionLevel=9, palette, effort=10)，覆盖原文件
 *   AVIF   — 转 AVIF quality=50, effort=4，删除原 PNG
 */

import sharp from 'sharp';
import { readdir, stat, unlink, rename } from 'fs/promises';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { broadcast } from './unifiedStreamBus.js';
import { config, updateCompressConfig } from '../config.js';
import { getAllImageDirs } from './imagePaths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = resolve(__dirname, '..', '..', 'data', 'image-compressor-state.json');

// ── 默认状态 ──
const DEFAULT_STATE = {
  groups: {},        // { flat: { lastProcessedFile, totalProcessed }, chat: { ... }, ... }
  totalProcessed: 0,
  totalOriginalBytes: 0,
  totalCompressedBytes: 0,
  lastRun: null,
};

// ── 运行时状态 ──
let state = { ...DEFAULT_STATE };
let schedulerTimer = null;
let schedulerProcessing = false;

let batchTask = null;

// ── 状态持久化 ──

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = readFileSync(STATE_FILE, 'utf-8');
      const loaded = JSON.parse(raw);

      // 检测旧格式并自动升级
      if (loaded.lastProcessedFile && !loaded.groups) {
        const oldFile = loaded.lastProcessedFile;
        state = { ...DEFAULT_STATE };
        state.groups.history = { lastProcessedFile: oldFile, totalProcessed: loaded.totalProcessed || 0 };
        state.totalProcessed = loaded.totalProcessed || 0;
        state.totalOriginalBytes = loaded.totalOriginalBytes || 0;
        state.totalCompressedBytes = loaded.totalCompressedBytes || 0;
        state.lastRun = loaded.lastRun || null;
        console.log('[imageCompressor] State upgraded from legacy format');
      } else {
        state = { ...DEFAULT_STATE, ...loaded };
        if (!state.groups) state.groups = {};
      }
      validateCursorsAgainstDisk();
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
    writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
  } catch (e) {
    console.error('[imageCompressor] Failed to save state:', e.message);
  }
}

function ensureGroup(groupKey) {
  if (!state.groups[groupKey]) {
    state.groups[groupKey] = { lastProcessedFile: null, totalProcessed: 0 };
  }
}

/**
 * 数据复制/迁移后，文件创建时间会变成复制时间，旧 cursor 指向的文件不再是同一物理文件。
 * 如果 cursor 文件的创建时间晚于状态里最后一次运行时间，说明状态来自旧安装，丢弃该组 cursor。
 */
function validateCursorsAgainstDisk() {
  const lastRunMs = state.lastRun ? Date.parse(state.lastRun) : 0;
  if (!lastRunMs) return;
  const dirs = new Map(getAllImageDirs().map(d => [d.category, d.dir]));
  for (const [folder, group] of Object.entries(state.groups)) {
    if (!group?.lastProcessedFile) continue;
    const dir = dirs.get(folder);
    if (!dir) continue;
    const filePath = join(dir, group.lastProcessedFile);
    let currentBirthtimeMs = 0;
    if (existsSync(filePath)) {
      try { currentBirthtimeMs = statSync(filePath).birthtimeMs; } catch {}
    }
    if (isCursorFileStaleAfterCopy(lastRunMs, currentBirthtimeMs)) {
      const staleTotal = group.totalProcessed || 0;
      state.groups[folder] = { lastProcessedFile: null, totalProcessed: 0 };
      state.totalProcessed = Math.max(0, (state.totalProcessed || 0) - staleTotal);
      console.warn(`[imageCompressor] Cursor for ${folder} invalidated after data copy/migration`);
    }
  }
}

// ── 文件列表（多目录扫描）──

async function listAllPngFiles() {
  const dirs = getAllImageDirs();
  const allFiles = [];

  for (const { category, dir } of dirs) {
    if (!existsSync(dir)) continue;
    const files = await readdir(dir);
    const pngs = files.filter(f => /\.png$/i.test(f));

    const BATCH = 64;
    for (let i = 0; i < pngs.length; i += BATCH) {
      const batch = pngs.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (name) => {
          const fullPath = join(dir, name);
          try {
            const s = await stat(fullPath);
            return { name, fullPath, folder: category, mtime: s.mtimeMs, size: s.size };
          } catch { return null; }
        })
      );
      for (const r of results) if (r) allFiles.push(r);
    }
  }

  allFiles.sort((a, b) => a.mtime - b.mtime);
  return allFiles;
}

// ── 单张压缩 ──

async function compressOne(fileInfo) {
  const { name, fullPath: inputPath, folder, size } = fileInfo;
  const baseName = name.replace(/\.png$/i, '');
  const dir = dirname(inputPath);
  const isAvif = config.compression.type === 'avif';

  const result = {
    filename: name,
    folder,
    originalSize: size,
    compressedSize: 0,
    success: false,
    elapsed: 0,
  };

  const t0 = performance.now();

  try {
    if (isAvif) {
      const outPath = join(dir, `${baseName}.avif`);
      await sharp(inputPath)
        .avif({ quality: 50, effort: 4 })
        .toFile(outPath);

      const outStat = await stat(outPath);
      result.compressedSize = outStat.size;
      result.success = true;

      ensureGroup(folder);
      state.groups[folder].lastProcessedFile = name;
      state.groups[folder].totalProcessed = (state.groups[folder].totalProcessed || 0) + 1;
      state.totalProcessed++;
      state.totalOriginalBytes += size;
      state.totalCompressedBytes += result.compressedSize;
      state.lastRun = new Date().toISOString();
      saveState();

      await unlink(inputPath);
    } else {
      const tmpPath = join(dir, `${name}.tmp`);
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

      ensureGroup(folder);
      state.groups[folder].lastProcessedFile = name;
      state.groups[folder].totalProcessed = (state.groups[folder].totalProcessed || 0) + 1;
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

    const tmpPath = join(dir, `${name}.tmp`);
    try { if (existsSync(tmpPath)) await unlink(tmpPath); } catch {}

    return result;
  }
}

// ── 获取待处理文件列表 ──

function isCursorFileStaleAfterCopy(lastRunMs, fileBirthtimeMs) {
  return !fileBirthtimeMs || fileBirthtimeMs > lastRunMs;
}

function selectPendingFilesAfterCursors(candidates, folderCursors) {
  const folderFileMap = {};
  for (const file of candidates) {
    if (!folderFileMap[file.folder]) folderFileMap[file.folder] = [];
    folderFileMap[file.folder].push(file);
  }

  const pending = [];
  for (const [folder, files] of Object.entries(folderFileMap)) {
    files.sort((a, b) => a.mtime - b.mtime);
    const cursor = folderCursors[folder];
    if (cursor) {
      const cursorIdx = files.findIndex(f => f.name === cursor);
      const startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0;
      pending.push(...files.slice(startIdx));
    } else {
      pending.push(...files);
    }
  }

  pending.sort((a, b) => a.mtime - b.mtime);
  return pending;
}

async function getPendingFiles(limit, cursorOnly = false, includeRecent = false, ignoreCursor = false) {
  const allFiles = await listAllPngFiles();
  if (allFiles.length === 0) return [];

  // 每个 folder 内跳过 cursor 之前的文件
  const folderCursors = {};
  for (const [folder, group] of Object.entries(state.groups)) {
    folderCursors[folder] = group.lastProcessedFile || null;
  }

  const now = Date.now();
  const safeBoundary = now - 5 * 60 * 1000;

  const candidates = [];
  for (const file of allFiles) {
    if (!includeRecent && file.mtime >= safeBoundary) continue;

    candidates.push(file);
  }

  if (ignoreCursor) {
    const pending = [...candidates];
    pending.sort((a, b) => a.mtime - b.mtime);
    return limit > 0 && !cursorOnly ? pending.slice(0, limit) : pending;
  }

  const pending = selectPendingFilesAfterCursors(candidates, folderCursors);

  if (limit > 0 && !cursorOnly) {
    return pending.slice(0, limit);
  }
  return pending;
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
  peak:   { interval: 10 * 60 * 1000, batch: 3  },
  offPeak: { interval: 10 * 60 * 1000, batch: 15 },
  offPeakStart: 2,
  offPeakEnd: 5,
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
  if (batchTask?.processing) return;

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

  schedulerTimer = setTimeout(() => {
    schedulerTick();
    schedulerTimer = setInterval(() => {
      schedulerTick();
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
  const allFiles = await listAllPngFiles();
  if (allFiles.length === 0) {
    batchTask = { phase: 'complete', current: 0, total: 0, processing: false };
    return;
  }

  const pending = await getPendingFiles(0, true, true, true);

  if (pending.length === 0) {
    batchTask = { phase: 'complete', current: 0, total: 0, processing: false };
    broadcast('image_compress_progress', { phase: 'complete', current: state.totalProcessed, total: allFiles.length });
    return;
  }

  batchTask = {
    cancelled: false,
    phase: 'running',
    current: state.totalProcessed,
    total: state.totalProcessed + pending.length,
    currentFile: '',
    errors: [],
    processing: true,
  };

  broadcast('image_compress_progress', {
    phase: 'running',
    current: state.totalProcessed,
    total: batchTask.total,
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
  console.log(`[imageCompressor] Loaded: enabled=${config.compression.enabled}, type=${config.compression.type}, total=${state.totalProcessed}`);
  reschedule();
}

// 仅测试用：暴露纯逻辑，避免测试直接依赖真实 data 目录。
export const __test = {
  isCursorFileStaleAfterCopy,
  selectPendingFilesAfterCursors,
};
