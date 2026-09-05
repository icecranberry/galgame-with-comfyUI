/**
 * 世界初始化向导（v2 核心流程）
 *
 * 七步：配置 → LLM 蓝图 → 风格小样 → 批量生图 → LLM 布图 → 用户确认 → 落库开镇
 *
 * - job 状态存 data/town/init-state.json，断点续跑（批量可重复触发，已 ready 的素材跳过）
 * - 布图 = 紧凑区域 JSON（不输出逐格矩阵），本地展开 + 洪泛连通校验 + 自动补路
 * - 全部 LLM 调用按 AGENTS.md 规范带完整 JSON 示例；素材生成走 townAssetService 串行队列
 * - 每次状态变更广播 SSE town_init_progress
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { chatSync } from '../../llm/llm-client.js';
import { createAsset, listAssets } from './townAssetService.js';
import { saveMap, buildWalkGridFromLayers, getObjectBlockingCells } from './townMapService.js';
import { createNpc, generateRoutine, generateNpcSprites } from './townNpcService.js';
import { broadcastTownInitProgress, broadcastTownMapUpdated } from './townBus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'town', 'init-state.json');

// ── job 状态 ──

let job = null;          // 内存中的当前 job
let jobChain = Promise.resolve();  // 向导步骤串行化，防止并发触发

function defaultJob() {
  return {
    status: 'idle',        // idle | blueprint | samples_pending | batch_pending | layout_pending | confirm | applying | done | failed
    error: null,
    config: { worldSettingId: null, npcCount: 8, mapCols: 50, mapRows: 50 },
    blueprint: null,       // { styleTags, groundAssets, roadAssets, buildings, props, npcs }
    sampleAssetIds: [],
    progress: { stage: '', done: 0, total: 0, current: '' },
    draftMap: null,        // 布图展开结果（确认前预览）
    warnings: [],
    createdAt: null,
  };
}

function persistJob() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(job, null, 2));
  } catch (err) {
    console.warn('[townInit] persist job failed:', err?.message);
  }
}

function setStatus(status, extraMsg = '') {
  job.status = status;
  job.error = status === 'failed' ? (extraMsg || job.error) : null;
  broadcastTownInitProgress({ status: job.status, stage: job.progress.stage, done: job.progress.done, total: job.progress.total, current: extraMsg || job.progress.current });
  persistJob();
}

/** 启动时恢复：进行中的批量可续跑；卡在 LLM 步骤的标记失败 */
export function restoreInitJob() {
  try {
    if (!fs.existsSync(STATE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object') return;
    job = { ...defaultJob(), ...raw };
    if (['blueprint', 'layout_pending'].includes(job.status)) {
      // LLM 调用中断，无法续跑
      job.status = 'failed';
      job.error = '服务重启导致该步骤中断，请重新执行';
    }
    persistJob();
    console.log(`[townInit] job restored: status=${job.status}`);
  } catch (err) {
    console.warn('[townInit] restore job failed:', err?.message);
  }
}

export function getInitState() {
  if (!job) job = defaultJob();
  return {
    status: job.status,
    error: job.error,
    config: job.config,
    blueprint: job.blueprint,
    sampleAssets: (job.sampleAssetIds || []).map(id => listAssets({}).find(a => a.id === id)).filter(Boolean),
    progress: job.progress,
    warnings: job.warnings || [],
    hasDraft: !!job.draftMap,
  };
}

/** 向导布图预览载荷（与正式地图 getMapPayload 同构，供前端复用渲染器） */
export function getInitPreview() {
  if (!job?.draftMap) return null;
  const { layers, name, cols, rows, tileSize } = job.draftMap;
  return { name, cols, rows, tileSize: tileSize || 32, layers, assets: listAssets({}).filter(a => a.status === 'ready') };
}

function enqueueStep(fn) {
  const run = jobChain.then(fn);
  jobChain = run.catch(() => {});
  return run;
}

// ── 工具 ──

function stripJsonFence(content) {
  return String(content || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function safeJsonParse(content) {
  try { return JSON.parse(stripJsonFence(content)); } catch { return null; }
}

function sanitizeKey(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'asset';
}

function getWorldSetting(id) {
  const db = getDb();
  if (id) {
    const row = db.prepare('SELECT * FROM world_settings WHERE id = ?').get(id);
    if (row) return row;
  }
  return db.prepare('SELECT * FROM world_settings ORDER BY is_active DESC, id LIMIT 1').get() || null;
}

// ── Step 1+2：配置 + LLM 蓝图 ──

export function startInit({ worldSettingId = null, npcCount = 8, mapCols = 50, mapRows = 50 } = {}) {
  return enqueueStep(async () => {
    job = defaultJob();
    job.createdAt = new Date().toISOString();
    job.config = {
      worldSettingId: worldSettingId ?? null,
      npcCount: Math.max(3, Math.min(16, parseInt(npcCount, 10) || 8)),
      mapCols: Math.max(30, Math.min(80, parseInt(mapCols, 10) || 50)),
      mapRows: Math.max(30, Math.min(80, parseInt(mapRows, 10) || 50)),
    };
    setStatus('blueprint', '正在读取世界观并生成初始化蓝图…');
    try {
      const world = getWorldSetting(job.config.worldSettingId);
      const worldContent = String(world?.content || '').slice(0, 4000);
      const worldName = world?.name || '（未指定）';
      job.config.worldSettingId = world?.id ?? null;

      const bpPrompt = buildBlueprintPrompt(worldName, worldContent, job.config);
      const content = await chatSync([
        { role: 'system', content: bpPrompt },
        { role: 'user', content: '请输出这个小镇的初始化蓝图 JSON。' },
      ], {
        max_tokens: 2500,
        temperature: 0.85,
        response_format: { type: 'json_object' },
        label: '小镇蓝图',
      });
      const parsed = safeJsonParse(content);
      if (!parsed) throw new Error('蓝图 JSON 解析失败');
      job.blueprint = normalizeBlueprint(parsed, job.config);
      setStatus('samples_pending', '蓝图已生成，请确认素材清单并出风格小样');
    } catch (err) {
      console.error('[townInit] blueprint failed:', err?.message);
      setStatus('failed', `蓝图生成失败：${err?.message || err}`);
      throw err;
    }
    return getInitState();
  });
}

function buildBlueprintPrompt(worldName, worldContent, cfg) {
  return [
    '你是小镇规划师，为一个像素风 AI 小镇设计初始化蓝图：地砖/道路素材清单、建筑与道具清单、居民名册。',
    '',
    `【世界观】${worldName}`,
    worldContent || '（无具体世界观，设计一个温暖治愈的通用小镇）',
    '',
    '必须严格按以下 JSON 格式输出，禁止输出 JSON 以外的任何文字（解释、注释、markdown 代码块都不允许）：',
    '{',
    '  "styleTags": "warm pastel fantasy village, soft colors, cozy pixel art",',
    '  "groundAssets": [',
    '    { "key": "grass_01", "name": "青草地", "desc": "short green grass with tiny flowers, seamless tileable top-down texture", "variants": 2 },',
    '    { "key": "plaza_tile", "name": "广场石砖", "desc": "warm beige plaza stone tiles, seamless tileable top-down texture", "variants": 1 }',
    '  ],',
    '  "roadAssets": [',
    '    { "key": "road_01", "name": "石板路", "desc": "cobblestone footpath, seamless tileable top-down texture", "variants": 1 }',
    '  ],',
    '  "buildings": [',
    '    { "key": "residential", "name": "普通居民楼", "desc": "simple cozy two-story house with warm windows", "reusable": true, "maxInstances": 6, "footprint": { "w": 4, "h": 3 }, "special": false },',
    '    { "key": "cafe", "name": "兽人咖啡厅", "desc": "cozy cafe run by an orc barista, wooden signboard", "reusable": false, "maxInstances": 1, "footprint": { "w": 5, "h": 4 }, "special": true }',
    '  ],',
    '  "props": [',
    '    { "key": "tree_01", "name": "橡树", "desc": "round oak tree, top-down front view", "blocking": true },',
    '    { "key": "bench_01", "name": "长椅", "desc": "wooden park bench, front view", "blocking": false }',
    '  ],',
    '  "npcs": [',
    '    { "displayName": "咕噜", "persona": "开朗的兽人面包师，嗓门大心肠软，喜欢给邻居塞试吃品", "appearanceDesc": "short stout green orc baker wearing a white apron and a headband, chibi pixel sprite", "job": "面包师" }',
    '  ]',
    '}',
    '字段约束：',
    '- styleTags：英文短语，描述整套素材统一的画风色调，所有素材生成都会拼进 prompt',
    '- groundAssets：3~5 种地砖（草地/广场/水边/花田等），desc 用英文写无缝平铺纹理；variants 是同款变体数 1~3（打散重复感）',
    '- roadAssets：1~2 种道路',
    '- buildings：5~9 栋。一半是通用建筑（普通居民楼/公厕/公交站等，reusable=true 且 maxInstances 2~8），一半是世界观专属特色建筑（special=true，唯一）；footprint.w/h 是占格数（3~6）；key 全部小写下划线且不重复',
    '- props：4~8 种（树/长椅/路灯/花丛/水井等），blocking=true 表示不可穿过（树/井），长椅花丛可以是 false',
    `- npcs：恰好 ${cfg.npcCount} 位居民。persona 一句话人设+性格关键词（中文 30~60 字）；appearanceDesc 英文外观描述（chibi 像素小人用）；job 中文职业`,
    '- 居民职业要和特色建筑呼应（咖啡厅老板/面包师等），名字符合世界观',
  ].join('\n');
}

function normalizeBlueprint(parsed, cfg) {
  const bp = { styleTags: '', groundAssets: [], roadAssets: [], buildings: [], props: [], npcs: [] };
  bp.styleTags = String(parsed.styleTags || '').slice(0, 200);

  const arr = (v) => (Array.isArray(v) ? v : []);
  const usedKeys = new Set();
  const uniqKey = (k) => {
    let key = sanitizeKey(k);
    let i = 1;
    while (usedKeys.has(key)) key = `${sanitizeKey(k)}_${i++}`;
    usedKeys.add(key);
    return key;
  };

  for (const g of arr(parsed.groundAssets)) {
    if (!g?.name) continue;
    bp.groundAssets.push({
      key: uniqKey(g.key || g.name),
      name: String(g.name).slice(0, 20),
      desc: String(g.desc || g.name).slice(0, 200),
      variants: Math.max(1, Math.min(3, parseInt(g.variants, 10) || 1)),
    });
  }
  for (const r of arr(parsed.roadAssets)) {
    if (!r?.name) continue;
    bp.roadAssets.push({
      key: uniqKey(r.key || r.name),
      name: String(r.name).slice(0, 20),
      desc: String(r.desc || r.name).slice(0, 200),
      variants: Math.max(1, Math.min(3, parseInt(r.variants, 10) || 1)),
    });
  }
  for (const b of arr(parsed.buildings)) {
    if (!b?.name) continue;
    const fp = b.footprint || {};
    bp.buildings.push({
      key: uniqKey(b.key || b.name),
      name: String(b.name).slice(0, 20),
      desc: String(b.desc || b.name).slice(0, 200),
      reusable: !!b.reusable,
      maxInstances: Math.max(1, Math.min(8, parseInt(b.maxInstances, 10) || 1)),
      footprint: { w: Math.max(2, Math.min(8, parseInt(fp.w, 10) || 4)), h: Math.max(2, Math.min(8, parseInt(fp.h, 10) || 3)) },
      special: !!b.special,
    });
  }
  for (const p of arr(parsed.props)) {
    if (!p?.name) continue;
    bp.props.push({
      key: uniqKey(p.key || p.name),
      name: String(p.name).slice(0, 20),
      desc: String(p.desc || p.name).slice(0, 200),
      blocking: p.blocking !== false,
    });
  }
  const npcList = arr(parsed.npcs).slice(0, cfg.npcCount);
  for (const n of npcList) {
    if (!n?.displayName) continue;
    bp.npcs.push({
      displayName: String(n.displayName).slice(0, 20),
      persona: String(n.persona || '').slice(0, 120),
      appearanceDesc: String(n.appearanceDesc || n.displayName).slice(0, 200),
      job: String(n.job || '').slice(0, 20),
    });
  }
  if (bp.groundAssets.length === 0) bp.groundAssets.push({ key: 'grass_01', name: '草地', desc: 'plain green grass seamless tileable top-down texture', variants: 2 });
  if (bp.roadAssets.length === 0) bp.roadAssets.push({ key: 'road_01', name: '土路', desc: 'dirt footpath seamless tileable top-down texture', variants: 1 });
  if (bp.buildings.length === 0) bp.buildings.push({ key: 'house', name: '小屋', desc: 'cozy small house', reusable: true, maxInstances: 4, footprint: { w: 4, h: 3 }, special: false });
  return bp;
}

/** 用户编辑蓝图（styleTags / 增删素材 / 调整居民）后保存 */
export function updateBlueprint(blueprint) {
  if (!job || !job.blueprint) return { ok: false, error: '没有进行中的初始化任务' };
  if (!blueprint || typeof blueprint !== 'object') return { ok: false, error: 'invalid blueprint' };
  const normalized = normalizeBlueprint({ ...job.blueprint, ...blueprint }, job.config);
  // normalize 会重排 key，尽量保留原 key
  for (const section of ['groundAssets', 'roadAssets', 'buildings', 'props']) {
    const oldKeys = new Set((job.blueprint[section] || []).map(i => i.key));
    for (const item of normalized[section]) {
      if (oldKeys.has(item.key)) item.key = item.key; // 已保留
    }
  }
  job.blueprint = normalized;
  if (job.status === 'samples_pending' || job.status === 'failed') job.status = 'samples_pending';
  persistJob();
  return { ok: true };
}

// ── Step 3：风格小样 ──

/** 出 3 张小样（草地 + 道路 + 一栋建筑）；已出过则只补缺 */
export function generateSamples() {
  return enqueueStep(async () => {
    if (!job?.blueprint) return { ok: false, error: '没有进行中的初始化任务' };
    setStatus('samples_pending', '正在生成风格小样…');
    job.progress = { stage: 'samples', done: 0, total: 3, current: '' };
    persistJob();

    const bp = job.blueprint;
    const styleTags = bp.styleTags;
    const worldId = job.config.worldSettingId;

    const existing = listAssets({}).filter(a => a.status === 'ready');
    const sampleSpecs = [
      { kind: 'ground', bpItem: bp.groundAssets[0] },
      { kind: 'road', bpItem: bp.roadAssets[0] },
      { kind: 'building', bpItem: bp.buildings.find(b => b.special) || bp.buildings[0] },
    ];

    job.sampleAssetIds = [];
    let done = 0;
    for (const spec of sampleSpecs) {
      if (!spec.bpItem) { done++; continue; }
      const existingAsset = existing.find(a => a.key === spec.bpItem.key && a.status === 'ready');
      if (existingAsset) {
        job.sampleAssetIds.push(existingAsset.id);
      } else {
        try {
          const asset = await createAsset({
            kind: spec.kind,
            key: spec.bpItem.key,
            name: spec.bpItem.name,
            desc: spec.bpItem.desc,
            meta: {
              desc: spec.bpItem.desc, styleTags,
              footprint: spec.kind === 'building' ? spec.bpItem.footprint : undefined,
              special: spec.kind === 'building' ? !!spec.bpItem.special : undefined,
            },
            worldSettingId: worldId,
          });
          job.sampleAssetIds.push(asset.id);
        } catch (err) {
          throw new Error(`小样「${spec.bpItem.name}」生成失败：${err?.message || err}`);
        }
      }
      done++;
      job.progress.done = done;
      job.progress.current = spec.bpItem.name;
      broadcastTownInitProgress({ status: job.status, stage: 'samples', done, total: 3, current: spec.bpItem.name });
      persistJob();
    }
    setStatus('batch_pending', '小样完成，可以开始批量生成');
    return getInitState();
  });
}

// ── Step 4：批量生图 ──

/** 展开蓝图 → 全部待生成素材（幂等：已 ready 的跳过） */
function expandBatchJobs() {
  const bp = job.blueprint;
  const styleTags = bp.styleTags;
  const worldId = job.config.worldSettingId;
  const jobs = [];
  const push = (kind, item, extraMeta = {}, suffix = '') => jobs.push({
    kind,
    key: suffix ? `${item.key}_${suffix}` : item.key,
    name: suffix ? `${item.name} ${suffix}` : item.name,
    desc: item.desc,
    meta: { desc: item.desc, styleTags, ...extraMeta },
    worldSettingId: worldId,
  });

  for (const g of bp.groundAssets) {
    for (let v = 1; v <= (g.variants || 1); v++) push('ground', g, {}, g.variants > 1 ? String(v).padStart(2, '0') : '');
  }
  for (const r of bp.roadAssets) {
    for (let v = 1; v <= (r.variants || 1); v++) push('road', r, {}, r.variants > 1 ? String(v).padStart(2, '0') : '');
  }
  for (const b of bp.buildings) {
    push('building', b, { footprint: b.footprint, special: b.special, reusable: b.reusable, maxInstances: b.maxInstances });
  }
  for (const p of bp.props) {
    push('prop', p, { blocking: p.blocking });
  }
  return jobs;
}

/** 批量生成全部素材（可断点续跑：status=ready 的直接跳过） */
export function startBatch() {
  return enqueueStep(async () => {
    if (!job?.blueprint) return { ok: false, error: '没有进行中的初始化任务' };
    setStatus('batch_pending', '开始批量生成素材…');

    const jobs = expandBatchJobs();
    const existing = listAssets({});
    const pending = jobs.filter(j => !existing.find(a => a.key === j.key && a.kind === j.kind && a.status === 'ready'));

    job.progress = { stage: 'batch', done: 0, total: pending.length, current: '' };
    persistJob();

    let done = 0;
    for (const j of pending) {
      job.progress.current = j.name;
      broadcastTownInitProgress({ status: 'batching', stage: 'batch', done, total: pending.length, current: j.name });
      try {
        await createAsset(j);
      } catch (err) {
        job.warnings.push(`素材「${j.name}」生成失败：${err?.message || err}（可稍后在素材库重试）`);
      }
      done++;
      job.progress.done = done;
      persistJob();
    }

    const readyCount = listAssets({}).filter(a => a.status === 'ready').length;
    if (readyCount < 4) {
      setStatus('failed', `可用素材不足（${readyCount} 张），请检查 ComfyUI 后重试批量`);
      throw new Error('素材批量生成失败');
    }
    setStatus('layout_pending', '素材就绪，可以生成布局');
    return getInitState();
  });
}

// ── Step 5：LLM 布图 + 本地展开 ──

export function generateLayout() {
  return enqueueStep(async () => {
    if (!job?.blueprint) return { ok: false, error: '没有进行中的初始化任务' };
    setStatus('layout_pending', '正在生成小镇布局…');

    const ready = listAssets({}).filter(a => a.status === 'ready' && ['ground', 'road', 'building', 'prop'].includes(a.kind));
    if (ready.length < 4) {
      setStatus('failed', '可用素材不足，请先完成批量生成');
      throw new Error('素材不足');
    }

    const cols = job.config.mapCols;
    const rows = job.config.mapRows;
    const bp = job.blueprint;

    // 供 LLM 的素材清单（类型 + 名 + 占格尺寸 + 复用上限）
    const inventory = ready.map(a => ({
      kind: a.kind, key: a.key, name: a.name,
      footprint: a.meta?.footprint || undefined,
      reusable: a.meta?.reusable || undefined,
      maxInstances: a.meta?.maxInstances || undefined,
      blocking: a.kind === 'prop' ? !!a.meta?.blocking : undefined,
    }));

    const content = await chatSync([
      { role: 'system', content: buildLayoutPrompt(cols, rows, bp, inventory) },
      { role: 'user', content: `请输出 ${cols}×${rows} 小镇的布局 JSON。` },
    ], {
      max_tokens: 3000,
      temperature: 0.8,
      response_format: { type: 'json_object' },
      label: '小镇布图',
    });
    const parsed = safeJsonParse(content);
    if (!parsed) {
      setStatus('failed', '布局 JSON 解析失败，请重试生成布局');
      throw new Error('布局 JSON 解析失败');
    }

    try {
      job.draftMap = expandLayout(parsed, ready, bp, cols, rows);
    } catch (err) {
      setStatus('failed', `布局展开失败：${err?.message || err}`);
      throw err;
    }
    job.warnings = job.draftMap.warnings || [];
    setStatus('confirm', '布局已生成，请预览确认');
    return getInitState();
  });
}

function buildLayoutPrompt(cols, rows, bp, inventory) {
  return [
    `你是像素小镇的地图设计师。请规划一张 ${cols}×${rows} 的小镇布局（格子坐标，x 向右 y 向下，原点左上）。`,
    `小镇风格：${bp.styleTags || '温暖的小镇'}`,
    '',
    '可用素材（key 必须从这里面选）：',
    JSON.stringify(inventory, null, 1),
    '',
    '必须严格按以下 JSON 格式输出，禁止输出 JSON 以外的任何文字（解释、注释、markdown 代码块都不允许）：',
    '{',
    '  "groundRects": [',
    `    { "assetKey": "grass_01", "x": 0, "y": 0, "w": ${cols}, "h": ${rows} },`,
    '    { "assetKey": "plaza_tile", "x": 20, "y": 20, "w": 10, "h": 10 }',
    '  ],',
    '  "roadPaths": [',
    `    { "assetKey": "road_01", "points": [[${Math.floor(cols / 2)}, 0], [${Math.floor(cols / 2)}, ${rows - 1}]] },`,
    '    { "assetKey": "road_01", "points": [[2, 25], [20, 25]] }',
    '  ],',
    '  "placedObjects": [',
    '    { "assetKey": "cafe", "instance": 1, "x": 8, "y": 12 },',
    '    { "assetKey": "residential", "instance": 1, "x": 30, "y": 8 },',
    '    { "assetKey": "tree_01", "x": 15, "y": 18 }',
    '  ],',
    '  "locations": [',
    '    { "key": "cafe", "objectRef": "cafe:1", "name": "兽人咖啡厅", "aliases": ["咖啡厅", "咖啡馆"], "ambient": "咖啡香和烤面包味" },',
    '    { "key": "plaza", "x": 25, "y": 25, "radius": 3, "name": "中央广场", "aliases": ["广场"], "ambient": "镇中心的热闹广场" }',
    '  ],',
    '  "npcSpawns": [',
    '    { "npcRef": "咕噜", "locationKey": "cafe" }',
    '  ]',
    '}',
    '布局规则（务必遵守）：',
    `- groundRects：先用一种地砖铺满整图（x=0,y=0,w=${cols},h=${rows}），再叠加广场/花田等特色区域矩形`,
    '- roadPaths：点列之间按先横后纵的 L 形铺路；主路要纵横贯通（至少一横一纵），路网要连接所有建筑门口',
    `- placedObjects：建筑 x = 建筑左上角列，y = 建筑最底行（占 footprint.h 格向上）；必须完全在图内且互不重叠；每栋建筑门口紧邻道路；reusable 建筑最多放 maxInstances 个（instance 从 1 编号），special 建筑只放 1 个（instance=1）；道具（树/长椅）散布 10~25 个，不要放在路上`,
    '- locations：每栋 special 建筑都要绑定一个地点（objectRef = "key:instance"）；通用居民楼不用每个都绑；再挑 1~3 个开阔处设户外地点（广场/公园，给 x/y/radius）；aliases 是日程文本常用的同义词',
    `- npcSpawns：恰好 ${bp.npcs.length} 位居民，npcRef 用居民 displayName 原文，locationKey 用上面定义的地点 key`,
    '- 建筑之间留出步行空间，不要把地图塞满',
  ].join('\n');
}

/** 紧凑布局 JSON → 图层数据 + POI 草稿（本地展开，含连通校验补路） */
export function expandLayout(parsed, readyAssets, bp, cols, rows) {
  const warnings = [];
  const byKey = new Map(readyAssets.map(a => [a.key, a]));

  const ground = Array.from({ length: rows }, () => Array(cols).fill(null));
  const road = Array.from({ length: rows }, () => Array(cols).fill(null));
  const objects = [];
  const blockOverride = Array.from({ length: rows }, () => Array(cols).fill(-1));

  const clampRect = (r) => {
    const x = Math.max(0, Math.min(cols - 1, parseInt(r.x, 10) || 0));
    const y = Math.max(0, Math.min(rows - 1, parseInt(r.y, 10) || 0));
    const w = Math.max(1, Math.min(cols - x, parseInt(r.w, 10) || 1));
    const h = Math.max(1, Math.min(rows - y, parseInt(r.h, 10) || 1));
    return { x, y, w, h };
  };

  for (const rect of Array.isArray(parsed.groundRects) ? parsed.groundRects : []) {
    const asset = byKey.get(rect.assetKey);
    if (!asset || asset.kind !== 'ground') { warnings.push(`未知地砖 ${rect.assetKey}，跳过`); continue; }
    const { x, y, w, h } = clampRect(rect);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) ground[yy][xx] = asset.id;
  }
  // 保底：没有铺满的地格用第一张地砖兜底
  const fallbackGround = readyAssets.find(a => a.kind === 'ground');
  if (fallbackGround) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (ground[y][x] == null) ground[y][x] = fallbackGround.id;
  }

  const firstRoad = readyAssets.find(a => a.kind === 'road');
  const paintRoadCell = (x, y, assetId) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    road[y][x] = assetId;
  };
  for (const p of Array.isArray(parsed.roadPaths) ? parsed.roadPaths : []) {
    const asset = byKey.get(p.assetKey) || firstRoad;
    if (!asset) continue;
    const pts = Array.isArray(p.points) ? p.points : [];
    for (let i = 1; i < pts.length; i++) {
      const x0 = Math.max(0, Math.min(cols - 1, parseInt(pts[i - 1][0], 10) || 0));
      const y0 = Math.max(0, Math.min(rows - 1, parseInt(pts[i - 1][1], 10) || 0));
      const x1 = Math.max(0, Math.min(cols - 1, parseInt(pts[i][0], 10) || 0));
      const y1 = Math.max(0, Math.min(rows - 1, parseInt(pts[i][1], 10) || 0));
      // 先横后纵 L 形
      const stepX = x1 >= x0 ? 1 : -1;
      for (let x = x0; x !== x1 + stepX; x += stepX) paintRoadCell(x, y0, asset.id);
      const stepY = y1 >= y0 ? 1 : -1;
      for (let y = y0; y !== y1 + stepY; y += stepY) paintRoadCell(x1, y, asset.id);
    }
    if (pts.length === 1) paintRoadCell(parseInt(pts[0][0], 10) || 0, parseInt(pts[0][1], 10) || 0, asset.id);
  }

  // 对象放置（防重叠）
  const placedRects = [];
  const instanceCounters = new Map();
  for (const po of Array.isArray(parsed.placedObjects) ? parsed.placedObjects : []) {
    const asset = byKey.get(po.assetKey);
    if (!asset) { warnings.push(`未知素材 ${po.assetKey}，跳过`); continue; }
    if (asset.kind !== 'building' && asset.kind !== 'prop') continue;

    const fp = asset.meta?.footprint;
    const w = fp?.w || 1;
    const h = fp?.h || 1;
    const x = Math.max(0, Math.min(cols - w, parseInt(po.x, 10) || 0));
    const y = Math.max(h - 1, Math.min(rows - 1, parseInt(po.y, 10) || 0));

    if (asset.kind === 'building') {
      const count = instanceCounters.get(asset.key) || 0;
      const maxI = asset.meta?.reusable ? (asset.meta?.maxInstances || 1) : 1;
      if (count >= maxI) { warnings.push(`「${asset.name}」超过复用上限，跳过多余实例`); continue; }
      instanceCounters.set(asset.key, count + 1);
    }

    const rect = { x, y: y - h + 1, w, h };
    const overlap = placedRects.some(r =>
      rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y);
    if (overlap) { warnings.push(`「${asset.name}」放置重叠，已跳过`); continue; }
    placedRects.push(rect);
    objects.push({ assetId: asset.id, x, y, flip: false, assetKey: asset.key, instance: asset.meta?.reusable ? (instanceCounters.get(asset.key)) : 1 });
  }

  const assetsById = new Map(readyAssets.map(a => [a.id, a]));

  // 连通校验：以地图中心为起点洪泛；不可达的 POI 锚点自动补路（绕开建筑格）
  const walkGrid = buildWalkGridFromLayers(cols, rows, { ground, road, objects, blockOverride }, assetsById);
  const blockingCells = new Set();
  for (const obj of objects) {
    const meta = assetsById.get(obj.assetId)?.meta;
    for (const c of getObjectBlockingCells(obj, meta)) blockingCells.add(`${c.x},${c.y}`);
  }
  const start = { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
  if (blockingCells.has(`${start.x},${start.y}`)) {
    // 中心被占 → 找最近空格当种子
    outer: for (let r = 1; r < Math.max(cols, rows); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = start.x + dx, ny = start.y + dy;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !blockingCells.has(`${nx},${ny}`)) { start.x = nx; start.y = ny; break outer; }
      }
    }
  }
  const reachable = new Set();
  {
    const q = [start];
    reachable.add(`${start.x},${start.y}`);
    while (q.length > 0) {
      const { x, y } = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        const k = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || reachable.has(k)) continue;
        if (blockingCells.has(k) || walkGrid[ny][nx] === 0) continue;
        reachable.add(k);
        q.push({ x: nx, y: ny });
      }
    }
  }
  const carvePath = (from) => {
    // BFS（无视 blockOverride，只绕建筑）找最近的 reachable 格，沿途铺路
    const prev = new Map();
    const q = [from];
    const seen = new Set([`${from.x},${from.y}`]);
    let goal = null;
    while (q.length > 0 && !goal) {
      const cur = q.shift();
      if (reachable.has(`${cur.x},${cur.y}`) && !(cur.x === from.x && cur.y === from.y)) { goal = cur; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx, ny = cur.y + dy;
        const k = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen.has(k)) continue;
        if (blockingCells.has(k)) continue;
        seen.add(k);
        prev.set(k, cur);
        q.push({ x: nx, y: ny });
      }
    }
    if (!goal) return false;
    let cur = goal;
    while (cur && !(cur.x === from.x && cur.y === from.y)) {
      paintRoadCell(cur.x, cur.y, firstRoad?.id ?? null);
      cur = prev.get(`${cur.x},${cur.y}`) || from;
    }
    return true;
  };

  // POI 草稿
  const locations = [];
  const objRefIndex = new Map(objects.map(o => [`${o.assetKey}:${o.instance}`, o]));
  for (const loc of Array.isArray(parsed.locations) ? parsed.locations : []) {
    if (!loc?.key || !loc?.name) continue;
    if (loc.objectRef) {
      const obj = objRefIndex.get(String(loc.objectRef));
      if (!obj) { warnings.push(`地点 ${loc.key} 引用了未放置的建筑 ${loc.objectRef}，跳过`); continue; }
      const asset = assetsById.get(obj.assetId);
      const fp = asset?.meta?.footprint;
      const door = asset?.meta?.doorOffset || { dx: Math.floor((fp?.w || 1) / 2), dy: (fp?.h || 1) - 1 };
      const anchor = { x: obj.x + door.dx, y: obj.y - (fp ? fp.h - 1 - door.dy : 0) };
      locations.push({
        key: sanitizeKey(loc.key), name: String(loc.name).slice(0, 30),
        aliases: Array.isArray(loc.aliases) ? loc.aliases.map(a => String(a).slice(0, 20)).slice(0, 8) : [],
        kind: 'place', x: anchor.x, y: anchor.y, radius: 2,
        ambient: String(loc.ambient || '').slice(0, 80),
        objectId: obj.id ?? null, objectAssetKey: obj.assetKey, objectInstance: obj.instance,
      });
    } else if (Number.isInteger(loc.x) && Number.isInteger(loc.y)) {
      const x = Math.max(0, Math.min(cols - 1, loc.x));
      const y = Math.max(0, Math.min(rows - 1, loc.y));
      locations.push({
        key: sanitizeKey(loc.key), name: String(loc.name).slice(0, 30),
        aliases: Array.isArray(loc.aliases) ? loc.aliases.map(a => String(a).slice(0, 20)).slice(0, 8) : [],
        kind: 'outdoor', x, y, radius: Math.max(1, Math.min(5, parseInt(loc.radius, 10) || 3)),
        ambient: String(loc.ambient || '').slice(0, 80),
      });
    }
  }

  // 补路：POI 锚点不在主连通域 → 自动铺路接上
  if (firstRoad) {
    for (const loc of locations) {
      if (!reachable.has(`${loc.x},${loc.y}`)) {
        const ok = carvePath({ x: loc.x, y: loc.y });
        if (!ok) warnings.push(`「${loc.name}」无法自动补路（被建筑围死），建议手动调整`);
      }
    }
  }

  const npcSpawns = (Array.isArray(parsed.npcSpawns) ? parsed.npcSpawns : [])
    .map(s => ({ npcRef: String(s.npcRef || ''), locationKey: sanitizeKey(s.locationKey) }))
    .filter(s => s.npcRef);

  // 对象 id 补齐
  let nextId = 1;
  for (const o of objects) o.id = nextId++;

  return {
    name: bp.styleTags ? '新小镇' : '新小镇',
    cols, rows, tileSize: 32,
    layers: { ground, road, objects: objects.map(({ assetKey, instance, ...rest }) => rest), blockOverride },
    locations, npcSpawns, warnings,
  };
}

// ── Step 7：确认开镇 ──

export function confirmInit() {
  return enqueueStep(async () => {
    if (!job?.draftMap) return { ok: false, error: '没有待确认的布局' };
    setStatus('applying', '正在落库开镇…');

    const draft = job.draftMap;
    const bp = job.blueprint;
    const db = getDb();

    // 1. 写地图（version+1 / 新建），清掉旧 POI（先断开 town_characters 的 FK 引用）
    const saved = saveMap({
      name: draft.name, cols: draft.cols, rows: draft.rows,
      tileSize: draft.tileSize || 32, layers: draft.layers,
      worldSettingId: job.config.worldSettingId,
    });
    db.exec("UPDATE town_characters SET home_location_id = NULL");
    db.exec('UPDATE town_npcs SET home_location_id = NULL');
    db.exec('DELETE FROM town_locations');
    db.exec('DELETE FROM town_agent_state');

    // 2. POI 落库
    const insLoc = db.prepare(`
      INSERT INTO town_locations (map_id, key, name, aliases_json, kind, grid_x, grid_y, radius, ambient, object_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const locationIdByKey = new Map();
    for (const loc of draft.locations || []) {
      const r = insLoc.run(saved.mapId, loc.key, loc.name, JSON.stringify(loc.aliases || []), loc.kind, loc.x, loc.y, loc.radius || 2, loc.ambient || '', loc.objectId ?? null);
      locationIdByKey.set(loc.key, Number(r.lastInsertRowid));
    }

    // 3. 批量建轻量 NPC（作息 LLM 逐个生成，失败降级为空作息=自由闲逛）
    const spawnByKey = new Map((draft.npcSpawns || []).map(s => [s.npcRef, s.locationKey]));
    const locationKeys = [...locationIdByKey.keys()];
    for (const n of bp.npcs) {
      const spawnKey = spawnByKey.get(n.displayName);
      const homeLocId = null; // home 在 routine 里用 locationKey 表达
      const npc = createNpc({
        mapId: saved.mapId,
        displayName: n.displayName,
        persona: n.persona,
        appearanceDesc: n.appearanceDesc,
        job: n.job,
        traits: {},
        routine: [],
        homeLocationId: homeLocId,
        townEnabled: 1,
      });
      if (spawnKey && locationIdByKey.has(spawnKey)) {
        db.prepare('UPDATE town_npcs SET home_location_id = ? WHERE id = ?').run(locationIdByKey.get(spawnKey), npc.id);
      }
      try {
        const routine = await generateRoutine(npc, [...locationKeys, 'home']);
        db.prepare('UPDATE town_npcs SET routine_json = ? WHERE id = ?').run(JSON.stringify(routine), npc.id);
      } catch (err) {
        console.warn(`[townInit] routine for ${n.displayName} failed:`, err?.message);
      }
    }

    // 4. 玩家档案 + 精灵（素材队列后台跑，不阻塞开镇）
    const appearance = [config.user.nickname, config.user.gender, config.user.appearance]
      .filter(Boolean).join('，');
    db.prepare(`
      INSERT INTO town_players (id, display_name, appearance_desc) VALUES ('me', ?, ?)
      ON CONFLICT(id) DO UPDATE SET appearance_desc = excluded.appearance_desc
    `).run(config.user.nickname || '我', appearance);
    spawnPlayerSprites(appearance, bp.styleTags);

    // 5. NPC 精灵后台补齐
    const npcIds = db.prepare('SELECT id FROM town_npcs').all().map(r => r.id);
    (async () => {
      for (const id of npcIds) {
        try { await generateNpcSprites(id); } catch (err) { console.warn(`[townInit] npc #${id} sprites failed:`, err?.message); }
      }
    })();

    broadcastTownMapUpdated({ mapId: saved.mapId, version: saved.version });
    setStatus('done', `开镇成功！version=${saved.version}`);
    job.draftMap = draft; // 保留 draft 供查看
    persistJob();
    return getInitState();
  });
}

/** 玩家四方向精灵（后台生成） */
function spawnPlayerSprites(appearance, styleTags) {
  (async () => {
    for (const dir of ['down', 'up', 'left', 'right']) {
      try {
        const existing = listAssets({}).find(a => a.key === `player_${dir}` && a.status === 'ready');
        if (existing) continue;
        await createAsset({
          kind: 'player', key: `player_${dir}`, name: `玩家 ${dir}`,
          desc: appearance || 'a friendly villager', meta: { direction: dir, styleTags: styleTags || '' },
        });
      } catch (err) {
        console.warn(`[townInit] player sprite ${dir} failed:`, err?.message);
      }
    }
  })();
}

/** 取消/重置向导 */
export function cancelInit() {
  job = defaultJob();
  persistJob();
  return { ok: true };
}

/** 重掷布局（复用已生成素材，不重生图） */
export function rerollLayout() {
  return generateLayout();
}
