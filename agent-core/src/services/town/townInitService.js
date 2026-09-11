/**
 * 世界初始化向导（v2 核心流程）
 *
 * 七步：配置 → LLM 蓝图 → 风格小样 → 批量生图 → 本地布图 → 用户确认 → 落库开镇
 *
 * - job 状态存 data/town/init-state.json，断点续跑（批量可重复触发，已 ready 的素材跳过）
 * - 布图 = 程序化街区路网 + 贴路建筑 + 地皮预算道具；格子结果不交给 LLM 摆放
 * - 全部 LLM 调用按 AGENTS.md 规范带完整 JSON 示例；素材生成走 townAssetService 串行队列
 * - 每次状态变更广播 SSE town_init_progress
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getSystemRules } from '../../db/index.js';
import { config } from '../../config.js';
import { chatSync } from '../../llm/llm-client.js';
import { getWorldIntegrationRule } from '../../builtinRules.js';
import { createAsset, listAssets, captureTownAssetWorld } from './townAssetService.js';
import { getMapRow, saveMap, buildWalkGridFromLayers, getObjectBlockingCells } from './townMapService.js';
import { createNpc, generateRoutine, generateNpcSprites, updateNpc, getNpc, isPersonaCard } from './townNpcService.js';
import { broadcastTownInitProgress, broadcastTownMapUpdated } from './townBus.js';
import { generateLocalLayout } from './townLayoutGenerator.js';
import { refineTownDraftWithLLM } from './townLayoutAI.js';

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
    npcIds: [],            // 向导内提前建档的居民（稳定人格卡，confirm 时复用）
    playerKitDone: false,
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
    // 旧 job 迁移：蓝图里塞在 persona 的一句话人设归位到 brief（口径同 updateBlueprint）
    if (job.blueprint) {
      try { job.blueprint = normalizeBlueprint(job.blueprint, job.config || defaultJob().config); }
      catch (err) { console.warn('[townInit] blueprint normalize on restore failed:', err?.message); }
    }
    if (job.status === 'blueprint') {
      // 蓝图 LLM 调用中断，无法续跑
      job.status = 'failed';
      job.error = '服务重启导致蓝图生成中断，请重新开始';
    }
    // batch_pending（批量可断点续跑）/ layout_pending（重新触发布图即可）原样保留
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
    npcIds: job.npcIds || [],
    wizardNpcs: (job.npcIds || []).map(id => getNpc(id)).filter(Boolean),
    playerKitDone: !!job.playerKitDone,
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

// Capture before enqueue/await: cancellation replaces job without necessarily advancing epoch.
function captureInitGenerationGuard() {
  const expectedJob = job;
  const expectedBlueprint = job?.blueprint;
  const expectedWorld = captureTownAssetWorld();
  const assertCurrent = () => {
    const world = captureTownAssetWorld();
    if (job !== expectedJob || job?.blueprint !== expectedBlueprint
      || world.worldId !== expectedWorld.worldId || world.epoch !== expectedWorld.epoch) {
      throw Object.assign(new Error('初始化任务或世界已变化，已丢弃旧生成结果'), { code: 'TOWN_ASSET_STALE' });
    }
  };
  return { expectedWorld, assertCurrent };
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

export function startInit({ worldSettingId = null, npcCount = 8, mapCols, mapRows } = {}) {
  return enqueueStep(async () => {
    // 初始化 = 全部数据抛弃：旧地图/地点/居民/相遇历史/运行态/素材索引全清（磁盘图片文件保留不删）
    const db = getDb();
    const { resetWorld } = await import('./townService.js');
    resetWorld();
    db.exec('DELETE FROM town_assets');

    job = defaultJob();
    job.createdAt = new Date().toISOString();
    job.config = {
      worldSettingId: worldSettingId ?? null,
      npcCount: Math.max(3, Math.min(16, parseInt(npcCount, 10) || 8)),
      mapCols: Math.max(30, Math.min(80, parseInt(mapCols, 10) || config.town.mapSize || 50)),
      mapRows: Math.max(30, Math.min(80, parseInt(mapRows, 10) || config.town.mapSize || 50)),
    };
    setStatus('blueprint', '正在读取世界观并生成初始化蓝图…');
    try {
      const world = getWorldSetting(job.config.worldSettingId);
      const worldContent = String(world?.content || '').slice(0, 4000);
      const worldName = world?.name || '（未指定）';
      job.config.worldSettingId = world?.id ?? null;

      const bpMsgs = [
        ...townPromptSystemMessages(world),
        { role: 'system', content: buildBlueprintOutputStructure() },
        { role: 'system', content: buildBlueprintTaskRequirements(worldName, job.config) },
        { role: 'user', content: '请执行：输出这个小镇的初始化蓝图 JSON。' },
      ];
      const content = await chatSync(bpMsgs, {
        max_tokens: 6000,
        temperature: 0.85,
        response_format: { type: 'json_object' },
        label: '小镇蓝图',
      });
      const parsed = safeJsonParse(content);
      if (!parsed) throw new Error('蓝图 JSON 解析失败');
      job.blueprint = normalizeBlueprint(parsed, job.config);
      job.blueprint.styleTags = '';
      setStatus('samples_pending', '蓝图已生成，请确认素材清单并出风格小样');
    } catch (err) {
      console.error('[townInit] blueprint failed:', err?.message);
      setStatus('failed', `蓝图生成失败：${err?.message || err}`);
      throw err;
    }
    return getInitState();
  });
}

function buildBlueprintOutputStructure() {
  return [
    '【输出结构】',
    '必须严格按以下 JSON 格式（仅作为演示，实际内容跟随<world_setting>设定输出，禁止输出 JSON 以外的任何文字（解释、注释、markdown 代码块都不允许）：',
    '{',
    '  "groundAssets": [',
    '    { "key": "grass_01", "name": "青草地", "variants": 2 },',
    '    { "key": "plaza_tile", "name": "广场石砖", "variants": 1 },',
    '    { "key": "pond_water", "name": "池塘水面", "variants": 1 }',
    '  ],',
    '  "roadAssets": [',
    '    { "key": "road_01", "name": "石板路", "variants": 1 }',
    '  ],',
    '  "buildings": [',
    '    { "key": "residential", "name": "普通居民楼", "reusable": true, "maxInstances": 6, "footprint": { "w": 4, "h": 3 }, "special": false },',
    '    { "key": "cafe", "name": "兽人咖啡厅", "reusable": false, "maxInstances": 1, "footprint": { "w": 5, "h": 4 }, "special": true }',
    '  ],',
    '  "props": [',
    '    { "key": "tree_01", "name": "橡树", "footprint": { "w": 2, "h": 2 }, "blocking": true },',
    '    { "key": "bench_01", "name": "长椅", "footprint": { "w": 1, "h": 1 }, "blocking": false }',
    '  ],',
    '  "npcs": [',
    '    { "displayName": "咕噜", "brief": "开朗的兽人面包师，嗓门大心肠软，喜欢给邻居塞试吃品", "job": "面包师" },',
    '  ]',
    '}',
  ].join('\n');
}

function buildBlueprintTaskRequirements(worldName, cfg) {
  return [
    '【任务要求】',
    '你是建筑师，为一片居住地设计初始化清单：地砖/道路素材清单、建筑与道具清单、居民名册。',
    '',
    `输出的内容要和<world_setting>强相关，你就是在<world_setting>的设定之下规划居住地。世界观名称：${worldName}`,
    '本步只确认名称和类别，禁止输出任何外观描述、styleTags 或 prompt。',
    '',
    '字段约束：',
    '- groundAssets：3~6 种地皮；variants 是同款变体数 1~3（打散重复感）；地表类型要多样，按<world_setting>挑（草地/泥土/石板/沙地/雪地/水面……），有河流湖泊池塘设定的必须至少 1 种水面，不要只出草地和石砖',
    '- roadAssets：1~2 种道路',
    '- buildings：5~9 栋。一半是通用建筑（reusable=true 且 maxInstances 2~8），一半是世界观专属特色建筑（special=true，唯一）；footprint.w/h 是占格数（2~3）；key 全部小写下划线且不重复',
    '- props：4~8 种；footprint.w/h 是占格数（1~3，橡树一般 2×2，长椅/花丛一般 1×1）；blocking=true 表示不可穿过（树/井），长椅花丛可以是 false',
    `- npcs：恰好 ${cfg.npcCount} 位居民。brief 一句话人设+性格关键词（中文 30~60 字，会作为完整人格卡的设定依据）；job 中文职业`,
    '- 居民职业要和特色建筑呼应（咖啡厅老板/面包师等），名字符合<world_setting>',
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
      desc: String(g.desc || '').slice(0, 800),
      variants: Math.max(1, Math.min(3, parseInt(g.variants, 10) || 1)),
    });
  }
  for (const r of arr(parsed.roadAssets)) {
    if (!r?.name) continue;
    bp.roadAssets.push({
      key: uniqKey(r.key || r.name),
      name: String(r.name).slice(0, 20),
      desc: String(r.desc || '').slice(0, 800),
      variants: Math.max(1, Math.min(3, parseInt(r.variants, 10) || 1)),
    });
  }
  for (const b of arr(parsed.buildings)) {
    if (!b?.name) continue;
    const fp = b.footprint || {};
    bp.buildings.push({
      key: uniqKey(b.key || b.name),
      name: String(b.name).slice(0, 20),
      desc: String(b.desc || '').slice(0, 1000),
      reusable: !!b.reusable,
      maxInstances: Math.max(1, Math.min(8, parseInt(b.maxInstances, 10) || 1)),
      footprint: { w: Math.max(2, Math.min(3, parseInt(fp.w, 10) || 3)), h: Math.max(2, Math.min(3, parseInt(fp.h, 10) || 2)) },
      special: !!b.special,
    });
  }
  for (const p of arr(parsed.props)) {
    if (!p?.name) continue;
    const fp = p.footprint || {};
    bp.props.push({
      key: uniqKey(p.key || p.name),
      name: String(p.name).slice(0, 20),
      desc: String(p.desc || '').slice(0, 800),
      footprint: { w: Math.max(1, Math.min(3, parseInt(fp.w, 10) || 1)), h: Math.max(1, Math.min(3, parseInt(fp.h, 10) || 1)) },
      blocking: p.blocking !== false,
    });
  }
  const npcList = arr(parsed.npcs).slice(0, cfg.npcCount);
  const seenNames = new Set();
  for (const n of npcList) {
    if (!n?.displayName) continue;
    let name = String(n.displayName).slice(0, 20);
    let i = 2;
    while (seenNames.has(name)) name = `${String(n.displayName).slice(0, 17)}${i++}`; // 名单内重名加序号
    seenNames.add(name);
    // persona 只装完整人格卡；名单产出的一句话人设（含旧数据里塞在 persona 的非卡文本）统一归到 brief
    const rawPersona = String(n.persona || '').slice(0, 4000);
    bp.npcs.push({
      displayName: name,
      brief: String(n.brief || (isPersonaCard(rawPersona) ? '' : rawPersona)).slice(0, 300),
      persona: isPersonaCard(rawPersona) ? rawPersona : '',
      job: String(n.job || '').slice(0, 20),
    });
  }
  if (bp.groundAssets.length === 0) bp.groundAssets.push({ key: 'grass_01', name: '草地', desc: '', variants: 2 });
  if (bp.roadAssets.length === 0) bp.roadAssets.push({ key: 'road_01', name: '土路', desc: '', variants: 1 });
  if (bp.buildings.length === 0) bp.buildings.push({ key: 'house', name: '小屋', desc: '', reusable: true, maxInstances: 4, footprint: { w: 4, h: 3 }, special: false });
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

/** 小镇 LLM 统一前两层：system0 = 破甲词 + 世界观，system1 = 世界观强化。 */
function townPromptSystemMessages(world) {
  const worldContent = String(world?.content || '').trim();
  const worldBlock = worldContent ? `<world_setting>\n${worldContent}\n</world_setting>` : '';
  const msgs = [{
    role: 'system',
    content: [getSystemRules({ roleplay: false }), worldBlock].filter(Boolean).join('\n\n'),
  }];
  if (worldBlock) {
    msgs.push({ role: 'system', content: getWorldIntegrationRule('town_asset') });
  }
  return msgs;
}
/** 清单确认后，按当前步骤的名称清单批量生成英文生图提示词 */
export function generateAssetPrompts({ step = 'tiles', styleTags, keys = [] } = {}) {
  const guard = captureInitGenerationGuard();
  return enqueueStep(async () => {
    guard.assertCurrent();
    if (!job?.blueprint) throw new Error('没有进行中的初始化任务');
    const sections = step === 'tiles'
      ? [['groundAssets', 'ground'], ['roadAssets', 'road']]
      : [['buildings', 'building'], ['props', 'prop']];
    const wantedKeys = new Set(Array.isArray(keys) ? keys : []);
    const targets = [];
    for (const [section, kind] of sections) {
      for (const item of job.blueprint[section] || []) {
        if (wantedKeys.size > 0 && !wantedKeys.has(item.key)) continue;
        targets.push({ section, kind, key: item.key, item });
      }
    }
    if (targets.length === 0) return { prompts: [], blueprint: job.blueprint };

    if (styleTags !== undefined) job.blueprint.styleTags = String(styleTags || '').slice(0, 200);
    const world = getWorldSetting(job.config.worldSettingId);
    const inventory = targets.map(({ kind, key, item }) => ({ kind, key, name: item.name, footprint: item.footprint }));

    setStatus(job.status, '正在根据清单生成素材提示词…');
    const msgs = townPromptSystemMessages(world);
    msgs.push({ role: 'system', content: [
      '【输出结构】',
      '必须严格按以下 JSON 格式输出，禁止输出 JSON 以外的任何文字（解释、注释、markdown 代码块都不允许）：',
      '{',
      '  "prompts": {',
      '    "grass_01": "isometric ground game tile, one flat diamond-shaped block, the entire top face fully covered with short green grass, seamless tileable material, clean pixel edges, no buildings, no scene",',
      '    "road_01": "isometric road game tile, one flat diamond-shaped block, the entire top face fully covered with warm cobblestones, seamless tileable material, clean pixel edges, no buildings, no scene",',
      '    "cafe": "isometric building game sprite on pure white background, cozy two-story cafe with wooden walls and warm windows, 45 degree view showing two walls and the roof, complete building centered, walls extending past the bottom edge, no ground and no base",',
      '    "tree_01": "single pixel game prop sprite on pure white background, round oak tree in slight three-quarter view, complete object centered, no ground platform and no scene"',
      '}'
    ].join('\n') });
    msgs.push({ role: 'system', content: [
      '【任务要求】',
      '你是像素游戏素材提示词设计师。清单已确认，请根据清单中的名称逐项生成最终英文生图提示词。',
      '',
      '【素材清单】',
      JSON.stringify(inventory, null, 1),
      '',
      '字段约束：',
      '- prompts 的 key 必须与素材清单完全一致，一项不多、一项不少；value 是一段可直接用于文生图的英文 prompt',
      '- ground/road：描述完整覆盖顶面的单一材质，保证 isometric game tile、seamless tileable material、no buildings/no scene',
      '- building：描述建筑类型、墙体/屋顶/门窗/招牌/配色与世界观气质，保证 pure white background、isometric 45 degree view、no ground/no base；特殊建筑更有辨识度',
      '- prop：描述单个道具的材质/形状/颜色与世界观气质，保证 pure white background、single sprite、no ground platform/no scene；若清单提供 footprint 且大于 1×1，用英文明确 sprite 底面比例符合该等距占格尺寸',
      '- 全英文，不要双引号、换行、列表、标题、中文或代码围栏；不要输出 negative prompt',
    ].join('\n') });
    const extraDirection = String(job.blueprint.styleTags || '').trim();
    msgs.push({
      role: 'user',
      content: [
        extraDirection ? `【用户额外指定】\n${extraDirection}` : '',
        `请执行：为清单中的 ${targets.length} 项素材输出 prompts JSON。没有额外指定时，保持 coherent cozy game-asset look。`
      ].filter(Boolean).join('\n\n')
    });
    const content = await chatSync(msgs, {
      max_tokens: 6000,
      temperature: 0.75,
      response_format: { type: 'json_object' },
      label: '小镇素材提示词',
    });
    guard.assertCurrent();
    const parsed = safeJsonParse(content);
    const generated = parsed?.prompts || null;
    if (!generated || typeof generated !== 'object') throw new Error('素材提示词 JSON 解析失败');

    const prompts = [];
    for (const target of targets) {
      const prompt = String(generated[target.key] || '').trim();
      if (!prompt) throw new Error(`素材「${target.item.name}」缺少提示词`);
      target.item.desc = prompt.slice(0, 1200);
      prompts.push({ section: target.section, key: target.key, kind: target.kind, prompt: target.item.desc });
    }
    persistJob();
    return { prompts, blueprint: job.blueprint };
  });
}

// ── Step 3：风格小样 ──

/** 出 3 张小样（草地 + 道路 + 一栋建筑）；已出过则只补缺 */
export function generateSamples() {
  const guard = captureInitGenerationGuard();
  return enqueueStep(async () => {
    guard.assertCurrent();
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
      guard.assertCurrent();
      if (!spec.bpItem) { done++; continue; }
      const existingAsset = existing.find(a => a.key === spec.bpItem.key && a.status === 'ready');
      if (existingAsset) {
        job.sampleAssetIds.push(existingAsset.id);
      } else {
        try {
          const asset = await createAsset({
            expectedWorld: guard.expectedWorld,
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
          guard.assertCurrent();
          job.sampleAssetIds.push(asset.id);
        } catch (err) {
          guard.assertCurrent();
          if (err.code === 'TOWN_ASSET_STALE') throw err;
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
  const guard = captureInitGenerationGuard();
  return enqueueStep(async () => {
    guard.assertCurrent();
    if (!job?.blueprint) return { ok: false, error: '没有进行中的初始化任务' };
    setStatus('batch_pending', '开始批量生成素材…');

    const jobs = expandBatchJobs();
    const existing = listAssets({});
    const pending = jobs.filter(j => !existing.find(a => a.key === j.key && a.kind === j.kind && a.status === 'ready'));

    job.progress = { stage: 'batch', done: 0, total: pending.length, current: '' };
    persistJob();

    let done = 0;
    for (const j of pending) {
      guard.assertCurrent();
      job.progress.current = j.name;
      broadcastTownInitProgress({ status: 'batching', stage: 'batch', done, total: pending.length, current: j.name });
      try {
        await createAsset({ ...j, expectedWorld: guard.expectedWorld });
        guard.assertCurrent();
      } catch (err) {
        guard.assertCurrent();
        if (err.code === 'TOWN_ASSET_STALE') throw err;
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

// ── Step 5：本地程序化布图 ──

export function generateLayout() {
  const guard = captureInitGenerationGuard();
  return enqueueStep(async () => {
    guard.assertCurrent();
    if (!job?.blueprint) return { ok: false, error: '没有进行中的初始化任务' };
    setStatus('layout_pending', '正在生成小镇布局…');

    const ready = listAssets({}).filter(a => a.status === 'ready' && ['ground', 'road', 'building', 'prop'].includes(a.kind));
    if (ready.length < 4) {
      setStatus('failed', '可用素材不足，请先完成批量生成');
      throw new Error('素材不足');
    }

    const bp = job.blueprint;
    guard.assertCurrent();
    try {
      job.draftMap = generateLocalLayout({
        readyAssets: ready,
        blueprint: bp,
        cols: job.config.mapCols,
        rows: job.config.mapRows,
        buildingDensity: config.town.buildingDensity,
        propDensity: config.town.propDensity,
        seed: Date.now(),
      });
      if (config.town.aiLayoutOptimize) {
        try {
          await refineTownDraftWithLLM({ draft: job.draftMap, readyAssets: ready, blueprint: bp, cols: job.config.mapCols, rows: job.config.mapRows });
        } catch (err) {
          console.warn('[town] AI layout optimize skipped:', err?.message || err);
        }
      }
    } catch (err) {
      setStatus('failed', `布局展开失败：${err?.message || err}`);
      throw err;
    }
    job.warnings = job.draftMap.warnings || [];
    setStatus('confirm', '布局已生成，请预览确认');
    return getInitState();
  });
}

function buildLayoutOutputStructure(cols, rows) {
  return [
    '【输出结构】',
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
  ].join('\n');
}

function buildLayoutTaskRequirements(bp, inventory, cols = 50, rows = 50) {
  const cellCount = cols * rows;
  const buildingTarget = Math.max(1, Math.round(cellCount * config.town.buildingDensity / 1000));
  const propTarget = Math.max(buildingTarget + 1, Math.round(cellCount * config.town.propDensity / 1000));
  const averageFootprint = (kind) => {
    const items = inventory.filter(a => a.kind === kind);
    if (!items.length) return 1;
    const total = items.reduce((sum, a) => sum + Math.max(1, (a.footprint?.w || 1) * (a.footprint?.h || 1)), 0);
    return total / items.length;
  };
  const buildingArea = Math.round(buildingTarget * averageFootprint('building'));
  const propArea = Math.round(propTarget * averageFootprint('prop'));
  return [
    '【任务要求】',
    '你是像素小镇的地图设计师。请规划符合世界观的小镇布局（格子坐标，x 向右 y 向下，原点左上）。',
    '',
    '【可用素材】',
    JSON.stringify(inventory, null, 1),
    '',
    `【密度目标】地图地皮面积 = ${cols}×${rows} = ${cellCount} 格。建筑约 ${buildingTarget} 个实例，按平均 footprint 折算约 ${buildingArea} 格地皮（可上下浮动 20%）；道具约 ${propTarget} 个实例，按平均 footprint 折算约 ${propArea} 格地皮（必须多于建筑，可上下浮动 20%）。大 footprint 的道具数量不要机械按小块道具类推，必须同时满足这里的数量和地皮预算。`,
    '布局规则（务必遵守）：',
    '- groundRects：先用草地/泥土这类基础地砖铺满整图（x=0,y=0,w=地图宽度,h=地图高度），再叠加特色区域；广场/花田等特色区域合计只占全图 10%~20%，不要让广场砖盖满全图',
    '- roadPaths：点列之间按先横后纵的 L 形铺路；主路要纵横贯通（至少一横一纵），路网要连接所有建筑门口；道路从地图边缘通到中心广场',
    '- placedObjects：建筑 x = 建筑占格矩形的左上角列，y = 底行（占 footprint.h 格向上）；必须完全在图内且互不重叠；建筑要分布在地图各处（不要全挤在边缘），每栋建筑门口紧邻道路；reusable 建筑最多放 maxInstances 个（instance 从 1 编号），special 建筑只放 1 个（instance=1）。道具（树/长椅）按密度目标和各自 footprint 散布在建筑之间，不要放在路上',
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
    for (const c of getObjectBlockingCells(obj, meta, assetsById.get(obj.assetId)?.kind)) blockingCells.add(`${c.x},${c.y}`);
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
      const door = asset?.meta?.doorOffset || { dx: (fp?.w || 1) - 1, dy: (fp?.h || 1) - 1 };
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

/**
 * 生成完整人格卡；失败时回退到一句话人设，保证居民始终有 persona 可用。
 * 沿用本文件既有的动态 import 写法，避免与素材/LLM 模块的加载顺序耦合。
 */
async function generateWizardPersonaCard({ displayName, job, brief, worldHint, fallback = '' }) {
  try {
    const { generateNpcPersonaCard } = await import('./townNpcService.js');
    const { card } = await generateNpcPersonaCard({ displayName, job, brief, worldHint });
    return card;
  } catch (err) {
    console.warn(`[townInit] persona card for ${displayName} failed, keep brief:`, err?.message);
    return fallback;
  }
}

/**
 * 向导居民步：按蓝图提前建档 town_npcs（稳定人格卡，不入 characters 表）。
 * 幂等：按 displayName 对齐 job.npcIds；蓝图改动（增删改）会同步到已建档行。
 * 作息不在这里生成：此时真实地点还没落库，进镇后（confirmInit）按真实地点 key 后台补齐。
 */
export function commitWizardNpcs() {
  return enqueueStep(async () => {
    if (!job?.blueprint) return { ok: false, error: '没有进行中的初始化任务' };
    const db = getDb();
    job.npcIds = job.npcIds || [];

    // 蓝图外的居民全部清掉（含名单换代后的孤儿、重名多建的多余行）
    const wanted = new Set(job.blueprint.npcs.map(n => n.displayName));
    const seen = new Set();
    for (const row of db.prepare('SELECT id, display_name FROM town_npcs').all()) {
      if (!wanted.has(row.display_name) || seen.has(row.display_name)) {
        db.prepare('DELETE FROM town_npcs WHERE id = ?').run(row.id);
        job.npcIds = job.npcIds.filter(x => x !== row.id);
        continue;
      }
      seen.add(row.display_name);
    }

    for (const n of job.blueprint.npcs) {
      const existingId = job.npcIds.find(nid => {
        const row = db.prepare('SELECT display_name FROM town_npcs WHERE id = ?').get(nid);
        return row?.display_name === n.displayName;
      });
      if (existingId) {
        const currentNpc = getNpc(existingId);
        const brief = String(n.brief || '').trim();
        let persona = String(n.persona || '');
        // 旧版本会把完整人格卡截到 120 字；若数据库里还保留更完整版本，优先找回。
        if (persona.length === 120 && (currentNpc.persona || '').length > 120) {
          persona = currentNpc.persona;
        }
        // 蓝图里还没有完整卡（旧数据把一句话人设塞在 persona、或被截断）→ 按一句话人设补生成一次
        if (!isPersonaCard(persona)) {
          persona = await generateWizardPersonaCard({
            displayName: n.displayName,
            job: n.job,
            brief,
            worldHint: job.blueprint.styleTags,
            fallback: brief || persona,
          });
        }
        updateNpc(existingId, { persona, brief, job: n.job });
        n.persona = persona;
        n.brief = brief;
        continue;
      }
      // 酒馆招募式：先生成结构化人格卡（跳过网络搜索，低温稳定特征）
      setStatus(job.status, `正在为「${n.displayName}」撰写人格卡…`);
      const brief = String(n.brief || '').trim();
      const persona = await generateWizardPersonaCard({
        displayName: n.displayName,
        job: n.job,
        brief,
        worldHint: job.blueprint.styleTags,
        fallback: brief || String(n.persona || ''),
      });
      const npc = createNpc({
        mapId: null,
        displayName: n.displayName,
        persona,
        brief,
        job: n.job,
        traits: {},
        routine: [],
      });
      job.npcIds.push(npc.id);
      n.persona = persona;         // 同步回蓝图（前端卡展示完整人格卡）
      n.brief = brief;
    }
    persistJob();
    return getInitState();
  });
}

/** 按数量重新生成居民名单（向导拉条用；LLM 参照世界观出一版新人设卡） */
export function regenerateNpcRoster(count) {
  return enqueueStep(async () => {
    if (!job?.blueprint) return { ok: false, error: '没有进行中的初始化任务' };
    const n = Math.max(3, Math.min(16, parseInt(count, 10) || job.config.npcCount));
    job.config.npcCount = n;
    setStatus(job.status, `正在重新规划 ${n} 位居民…`);

    const world = getWorldSetting(job.config.worldSettingId);
    const rosterMsgs = [
      ...townPromptSystemMessages(world),
      {
        role: 'system',
        content: [
          '【输出结构】',
          '必须严格按以下 JSON 格式输出，禁止输出 JSON 以外的任何文字（解释、注释、markdown 代码块都不允许）：',
          '{',
          '  "npcs": [',
          '    { "displayName": "咕噜", "brief": "开朗的兽人面包师，嗓门大心肠软（一句话人设+性格关键词，中文30~60字）", "job": "面包师" }',
          '  ]',
          '}',
        ].join('\n'),
      },
      {
        role: 'system',
        content: [
          '【任务要求】',
          '你是小镇的人事导演，为像素小镇重新规划一份居民名册。',
          '',
          '字段约束：',
          `- 恰好 ${n} 位；displayName 中文 2~6 字不重复`,
          '- 职业要和小镇特色建筑/业态呼应、互相错开',
          '- brief 一句话人设+性格关键词（中文30~60字），符合世界观，会作为完整人格卡的设定依据',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          job.blueprint.styleTags ? `【用户额外指定】\n${job.blueprint.styleTags}` : '',
          `请执行：输出 ${n} 位居民的名单 JSON。`,
        ].filter(Boolean).join('\n\n'),
      },
    ];
    const content = await chatSync(rosterMsgs, {
      max_tokens: 6000,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      label: '小镇居民名册',
    });
    const parsed = safeJsonParse(content);
    const roster = Array.isArray(parsed?.npcs) ? parsed.npcs : null;
    if (!roster || roster.length === 0) throw new Error('居民名册 JSON 解析失败');

    const seenNames = new Set();
    job.blueprint.npcs = roster
      .filter(x => x?.displayName)
      .slice(0, n)
      .map(x => {
        let name = String(x.displayName).slice(0, 20);
        let i = 2;
        while (seenNames.has(name)) name = `${String(x.displayName).slice(0, 17)}${i++}`;
        seenNames.add(name);
        const rawBrief = String(x.brief || x.persona || '');
        return {
          displayName: name,
          brief: isPersonaCard(rawBrief) ? '' : rawBrief.slice(0, 300),
          persona: '',           // 名单换了，人格卡要按新 brief 重新生成
          job: String(x.job || '').slice(0, 20),
        };
      });
    // 名单变了：已建档的旧居民作废（confirm 时会清理）
    job.npcIds = [];
    setStatus(job.status, `居民名单已更新（${job.blueprint.npcs.length} 位）`);
    return getInitState();
  });
}

export function confirmInit() {
  return enqueueStep(async () => {
    if (!job?.draftMap) return { ok: false, error: '没有待确认的布局' };
    setStatus('applying', '正在落库开镇…');

    const draft = job.draftMap;
    const bp = job.blueprint;
    const db = getDb();

    // 1. 地图与 POI 统一保存：同 key 保留 id/家地址，移除的地点由 saveMap 解除引用。
    const saved = saveMap({
      name: draft.name, cols: draft.cols, rows: draft.rows,
      tileSize: draft.tileSize || 32, layers: draft.layers,
      worldSettingId: job.config.worldSettingId,
      locations: draft.locations ?? [],
    });
    db.exec('DELETE FROM town_agent_state');

    // 2. 从已提交的地点读取真实 id，供蓝图出生点/作息分配使用。
    const locationIdByKey = new Map(
      db.prepare('SELECT key, id FROM town_locations WHERE map_id = ?').all(saved.mapId)
        .map(loc => [loc.key, loc.id])
    );

    // 3. 居民落库：向导内已建档的直接挂到新地图；否则按蓝图新建（作息统一在开镇后后台补齐）
    const spawnByKey = new Map((draft.npcSpawns || []).map(s => [s.npcRef, s.locationKey]));
    const locationKeys = [...locationIdByKey.keys()];
    const wizardIds = job.npcIds || [];
    if (wizardIds.length > 0) {
      // 复用向导人格卡（素材已生成，作息随后台补齐），清掉名单外的旧居民
      const keep = wizardIds.join(',');
      db.exec(`DELETE FROM town_npc_chat_messages WHERE npc_id NOT IN (${keep})`);
      db.exec(`DELETE FROM town_npcs WHERE id NOT IN (${keep})`);
      db.prepare(`UPDATE town_npcs SET map_id = ? WHERE id IN (${keep})`).run(saved.mapId);
      for (const id of wizardIds) {
        const row = db.prepare('SELECT display_name FROM town_npcs WHERE id = ?').get(id);
        const spawnKey = row ? spawnByKey.get(row.display_name) : null;
        if (spawnKey && locationIdByKey.has(spawnKey)) {
          db.prepare('UPDATE town_npcs SET home_location_id = ? WHERE id = ?').run(locationIdByKey.get(spawnKey), id);
        }
      }
    } else {
      for (const n of bp.npcs) {
        const spawnKey = spawnByKey.get(n.displayName);
        const npc = createNpc({
          mapId: saved.mapId,
          displayName: n.displayName,
          persona: n.persona || n.brief || '',
          brief: n.brief || '',
          job: n.job,
          traits: {},
          routine: [],
        });
        if (spawnKey && locationIdByKey.has(spawnKey)) {
          db.prepare('UPDATE town_npcs SET home_location_id = ? WHERE id = ?').run(locationIdByKey.get(spawnKey), npc.id);
        }
      }
    }

    // 4. 玩家档案 + spirit（素材队列后台跑，不阻塞开镇）
    const appearance = [config.user.nickname, config.user.gender, config.user.appearance]
      .filter(Boolean).join('，');
    db.prepare(`
      INSERT INTO town_players (id, display_name, appearance_desc) VALUES ('me', ?, ?)
      ON CONFLICT(id) DO UPDATE SET appearance_desc = excluded.appearance_desc
    `).run(config.user.nickname || '我', appearance);
    spawnPlayerSprites(appearance, bp.styleTags);

    // 5. NPC 作息后台补齐：建档时不再提前生成作息，进镇后按已落库的真实地点 key 逐个 LLM 生成
    //    （失败降级为空作息自由闲逛；已有作息的跳过，重复确认不覆盖）
    const npcRows = db.prepare('SELECT id, routine_json FROM town_npcs').all();
    const routineKeys = [...locationKeys, 'home'];
    const { refreshNpcRoutine } = await import('./townService.js');
    (async () => {
      for (const row of npcRows) {
        if (safeJsonParse(row.routine_json || '[]')?.length) continue;
        try {
          const routine = await generateRoutine(getNpc(row.id), routineKeys);
          db.prepare('UPDATE town_npcs SET routine_json = ? WHERE id = ?').run(JSON.stringify(routine), row.id);
          refreshNpcRoutine(row.id); // 小镇可能已 reload 开跑，同步内存 agent 的作息
        } catch (err) {
          console.warn(`[townInit] background routine for npc #${row.id} failed:`, err?.message);
        }
      }
    })().catch(err => console.warn('[townInit] routine pass stopped:', err?.message));

    // 6. NPC spirit后台补齐
    (async () => {
      for (const { id } of npcRows) {
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

/** 玩家正/背像素spirit（LLM 出 prompt，后台生成） */
function spawnPlayerSprites(appearance, styleTags) {
  const guard = captureInitGenerationGuard();
  (async () => {
    const { playerAppearanceInfo } = await import('./townNpcService.js');
    guard.assertCurrent();
    const { generateSpritePrompt } = await import('./townPromptBuilder.js');
    guard.assertCurrent();
    for (const dir of ['down', 'up']) {
      guard.assertCurrent();
      try {
        const existing = listAssets({}).find(a => a.key === `player_${dir}` && a.status === 'ready');
        if (existing) continue;
        const prompt = await generateSpritePrompt({ appearanceInfo: playerAppearanceInfo(), direction: dir });
        guard.assertCurrent();
        await createAsset({
          expectedWorld: guard.expectedWorld,
          kind: 'player', key: `player_${dir}`, name: `玩家 ${dir}`,
          desc: appearance || 'a friendly villager',
          meta: { direction: dir, styleTags: styleTags || '', promptOverride: prompt },
        });
        guard.assertCurrent();
      } catch (err) {
        guard.assertCurrent();
        if (err.code === 'TOWN_ASSET_STALE') throw err;
        console.warn(`[townInit] player sprite ${dir} failed:`, err?.message);
      }
    }
  })().catch(err => console.warn('[townInit] player sprites stopped:', err?.message));
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

/** 管理面板重新布局：复用现有素材与居民，仅重建地图/道路/POI */
export function relayoutWorld() {
  const guard = captureInitGenerationGuard();
  return enqueueStep(async () => {
    guard.assertCurrent();
    const mapRow = getMapRow();
    if (!mapRow) return { ok: false, error: '小镇尚未初始化' };
    const desiredSize = Math.max(30, Math.min(80, parseInt(config.town.mapSize, 10) || mapRow.grid_cols || 50));
    const cols = desiredSize;
    const rows = desiredSize;
    const ready = listAssets({}).filter(a => a.status === 'ready' && ['ground', 'road', 'building', 'prop'].includes(a.kind));
    if (ready.length < 4) return { ok: false, error: '可用素材不足，无法重新布局' };

    const db = getDb();
    const npcRows = db.prepare('SELECT display_name FROM town_npcs ORDER BY id').all();
    const bp = {
      styleTags: job?.blueprint?.styleTags || config.town.generation?.styleTags || '',
      npcs: npcRows.map(r => ({ displayName: r.display_name })),
    };
    guard.assertCurrent();
    const draft = generateLocalLayout({
      readyAssets: ready,
      blueprint: bp,
      cols,
      rows,
      buildingDensity: config.town.buildingDensity,
      propDensity: config.town.propDensity,
      seed: Date.now(),
    });
    if (config.town.aiLayoutOptimize) {
      try {
        await refineTownDraftWithLLM({ draft, readyAssets: ready, blueprint: bp, cols, rows });
      } catch (err) {
        console.warn('[town] AI layout optimize skipped:', err?.message || err);
      }
    }
    const saved = saveMap({
      name: mapRow.name || '小镇',
      cols, rows,
      tileSize: mapRow.tile_size || 32,
      layers: draft.layers,
      worldSettingId: mapRow.world_setting_id || null,
      locations: draft.locations,
    });

    return { ok: true, mapId: saved.mapId, version: saved.version, warnings: draft.warnings || [] };
  });
}
