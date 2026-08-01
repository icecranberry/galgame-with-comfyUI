import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';
import { config, updateComfyConfig, updateFeatureFlag, getLlmConfig, updateLlmConfig, updateUserConfig, getUserConfig, updateProactiveFreq, updateEventFreq, updateBackgroundConcurrency, updateDisturbMode, updateDisturbSettings, updateWorkflowMode, updateWorkflowScene, getWorkflowConfig, getLlmProfiles, getActiveProfileId, addLlmProfile, deleteLlmProfile, activateLlmProfile, syncActiveLlmProfile, updateWeatherConfig, updateGlobalLora } from '../config.js';
import { resetClient } from '../llm/llm-client.js';
import { getDb } from '../db/index.js';
import { listWorldSettings, getActiveWorldSetting, getWorldSettingById, createWorldSetting, updateWorldSetting, deleteWorldSetting, activateWorldSetting } from '../db/index.js';
import { DEFAULT_GLOBAL_RULES } from '../db/seedData.js';
import { restartProactiveFreq } from '../services/proactiveChatScheduler.js';
import { restartEventScheduler } from '../services/eventScheduler.js';
import { restartComfyClient } from '../services/comfyClient.js';
import { triggerDisturbCheck } from '../services/disturbModeScheduler.js';
import { restartWeatherScheduler } from '../services/weatherService.js';
import { applyFromConfig } from '../services/llmConcurrency.js';
import { BUILTIN_RULE_KEYS } from '../builtinRules.js';
import { getMemorySettings, saveMemorySettings, normalizeMemorySettings } from '../services/memory/memoryConfig.js';
import { getPreferredMemoryEmbeddingProfile, testEmbeddingProvider, testRerankerProvider } from '../services/memory/memoryProviders.js';
import { reindexAllMemories } from '../services/memory/memoryRepository.js';

const router = Router();

// GET/PUT /api/config/memory — 聊天记忆模型配置（Key 仅保存，不回显）
router.get('/memory', (_req, res) => {
  res.json({ ...getMemorySettings(), enabled: config.features.memory });
});

router.put('/memory', (req, res) => {
  try {
    const previous = getMemorySettings({ includeSecrets: true });
    const previousProfile = getPreferredMemoryEmbeddingProfile(previous).fingerprint;
    if (req.body?.enabled !== undefined) updateFeatureFlag('memory', Boolean(req.body.enabled));
    const saved = saveMemorySettings(req.body || {});
    const nextProfile = getPreferredMemoryEmbeddingProfile(saved).fingerprint;
    if (previousProfile !== nextProfile) {
      getDb().prepare(`UPDATE memory_fragments SET embedding_state = ?, embedding_error = NULL WHERE status = 'active'`)
        .run(nextProfile ? 'stale' : 'disabled');
      setImmediate(() => reindexAllMemories().catch(error => console.error('[memory] profile reindex failed:', error.message)));
    }
    res.json({ ok: true, ...getMemorySettings(), enabled: config.features.memory });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/memory/test-embedding', async (req, res) => {
  try {
    const current = getMemorySettings({ includeSecrets: true });
    const embedding = { ...current.embedding, ...(req.body || {}) };
    if (!embedding.apiKey) embedding.apiKey = current.embedding.apiKey;
    const candidate = normalizeMemorySettings({ ...current, embedding }, current);
    res.json(await testEmbeddingProvider(candidate));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/memory/test-reranker', async (req, res) => {
  try {
    const current = getMemorySettings({ includeSecrets: true });
    const reranker = { ...current.reranker, ...(req.body || {}) };
    if (!reranker.apiKey) reranker.apiKey = current.reranker.apiKey;
    const candidate = normalizeMemorySettings({ ...current, reranker }, current);
    res.json(await testRerankerProvider(candidate));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// GET /api/config — 获取全部配置
router.get('/', (req, res) => {
  res.json({
    comfy: {
      url: config.comfyui.url,
      artist: config.comfyui.artist,
      width: config.comfyui.width,
      height: config.comfyui.height,
      momentsArtist: config.comfyui.momentsArtist,
      momentsWidth: config.comfyui.momentsWidth,
      momentsHeight: config.comfyui.momentsHeight,
      eventArtist: config.comfyui.eventArtist,
      eventWidth: config.comfyui.eventWidth,
      eventHeight: config.comfyui.eventHeight,
      tlsVerify: config.comfyui.tlsVerify,
      globalLora: config.comfyui.globalLora || [],
    },
    features: config.features,
    weather: { city: config.weather.city || '' },
    llm: getLlmConfig(),
    llmProfiles: getLlmProfiles(),
    activeLlmProfileId: getActiveProfileId(),
    disturb: {
      startTime: config.disturb.startTime,
      endTime: config.disturb.endTime,
      characterIds: config.disturb.characterIds || [],
      hideWorld: config.disturb.hideWorld || false,
      skipWeekends: config.disturb.skipWeekends || false,
    },
    workflow: getWorkflowConfig(),
  });
});

// PUT /api/config/comfy — 更新 ComfyUI 参数
router.put('/comfy', (req, res) => {
  const { artist, width, height, url, momentsArtist, momentsWidth, momentsHeight, eventArtist, eventWidth, eventHeight, tlsVerify } = req.body;
  updateComfyConfig({ artist, width, height, url, momentsArtist, momentsWidth, momentsHeight, eventArtist, eventWidth, eventHeight, tlsVerify });
  // URL 或 TLS 设置变更后立即重启 ComfyUI 客户端连接（使新地址/证书策略立即生效）
  if (url !== undefined || tlsVerify !== undefined) {
    restartComfyClient();
  }
  res.json({ ok: true, ...config.comfyui });
});

// PUT /api/config/global-lora — 更新全局 LoRA
router.put('/global-lora', (req, res) => {
  const { loras } = req.body;
  if (loras === undefined) {
    return res.status(400).json({ error: 'loras is required' });
  }
  updateGlobalLora(loras);
  res.json({ ok: true, globalLora: config.comfyui.globalLora });
});

// PUT /api/config/features — 更新功能开关
router.put('/features', (req, res) => {
  const { key, value } = req.body;
  if (!key || !(key in config.features)) {
    return res.status(400).json({ error: `Invalid feature key: ${key}` });
  }
  updateFeatureFlag(key, value);
  if (key === 'serializeBackgroundLLM') {
    applyFromConfig(config);
  }
  if (key === 'weather' && value === true) {
    restartWeatherScheduler();
    triggerWeatherUpdate();
  }
  res.json({ ok: true, features: config.features });
});

// PUT /api/config/proactive-freq — 更新主动聊天频率 0~1
router.put('/proactive-freq', (req, res) => {
  const { value } = req.body;
  if (value == null || typeof value !== 'number' || value < 0 || value > 1) {
    return res.status(400).json({ error: 'value must be 0~1' });
  }
  updateProactiveFreq(value);
  restartProactiveFreq();
  res.json({ ok: true, proactiveChatFreq: config.features.proactiveChatFreq });
});

// PUT /api/config/event-freq — 更新奇遇触发频率 0~1
router.put('/event-freq', (req, res) => {
  const { value } = req.body;
  if (value == null || typeof value !== 'number' || value < 0 || value > 1) {
    return res.status(400).json({ error: 'value must be 0~1' });
  }
  updateEventFreq(value);
  restartEventScheduler();
  res.json({ ok: true, eventFreq: config.features.eventFreq });
});

// PUT /api/config/background-llm-concurrency — 更新后台 LLM 并发数 1~10
router.put('/background-llm-concurrency', (req, res) => {
  const { value } = req.body;
  if (value == null || typeof value !== 'number' || value < 1 || value > 10) {
    return res.status(400).json({ error: 'value must be 1~10' });
  }
  updateBackgroundConcurrency(value);
  applyFromConfig(config);
  res.json({ ok: true, backgroundLLMMaxConcurrency: config.features.backgroundLLMMaxConcurrency });
});

// PUT /api/config/llm — 更新 LLM 配置
router.put('/llm', (req, res) => {
  const { apiKey, baseURL, model, thinkingMode, headers, extraBody } = req.body;
  const result = updateLlmConfig({ apiKey, baseURL, model, thinkingMode, headers, extraBody });
  if (!result.ok) {
    return res.status(400).json(result);
  }
  resetClient();

  const presets = ['https://api.deepseek.com', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://api.moonshot.cn/v1', 'https://api.openai.com/v1'];
  const effectiveUrl = baseURL || config.llm.baseURL;
  if (effectiveUrl && presets.includes(effectiveUrl) && config.features.serializeBackgroundLLM) {
    updateFeatureFlag('serializeBackgroundLLM', false);
    console.log('[config] serializeBackgroundLLM auto-disabled (preset LLM selected)');
  }

  syncActiveLlmProfile();

  res.json({ ok: true, ...getLlmConfig() });
});

// POST /api/config/llm/models — 从 OpenAI-compatible 接口获取可用模型
router.post('/llm/models', async (req, res) => {
  const baseURL = String(req.body?.baseURL || config.llm.baseURL || '').trim().replace(/\/+$/, '');
  if (!baseURL) return res.status(400).json({ error: '请先填写 API 地址' });

  let modelsURL;
  try {
    modelsURL = new URL(`${baseURL}/models`);
    if (!['http:', 'https:'].includes(modelsURL.protocol)) throw new Error('unsupported protocol');
  } catch {
    return res.status(400).json({ error: 'API 地址格式无效' });
  }

  const apiKey = String(req.body?.apiKey || config.llm.apiKey || '').trim();
  const customHeaders = req.body?.headers && typeof req.body.headers === 'object' && !Array.isArray(req.body.headers)
    ? req.body.headers
    : {};
  const requestHeaders = {
    Accept: 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...customHeaders,
  };

  try {
    const response = await fetch(modelsURL, {
      method: 'GET',
      headers: requestHeaders,
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      return res.status(502).json({ error: `模型列表请求失败：${detail}` });
    }

    const rows = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload)
          ? payload
          : [];
    const models = [...new Set(rows
      .map(item => typeof item === 'string' ? item : item?.id || item?.name)
      .filter(Boolean)
      .map(id => String(id).replace(/^models\//, '')))]
      .sort((a, b) => a.localeCompare(b));

    if (!models.length) {
      return res.status(502).json({ error: '接口未返回可识别的模型列表' });
    }
    res.json({ ok: true, models, endpoint: modelsURL.toString() });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? '请求超时' : error.message;
    res.status(502).json({ error: `获取模型失败：${message}` });
  }
});

// ── LLM Profile 管理 ──

// GET /api/config/llm/profiles — 获取所有 profile
router.get('/llm/profiles', (req, res) => {
  res.json({ profiles: getLlmProfiles(), activeProfileId: getActiveProfileId() });
});

// POST /api/config/llm/profiles — 新增 profile（快照当前 LLM 配置）
router.post('/llm/profiles', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = addLlmProfile(name);
  res.json({ ok: true, profiles: getLlmProfiles(), activeProfileId: getActiveProfileId() });
});

// DELETE /api/config/llm/profiles/:id — 删除 profile
router.delete('/llm/profiles/:id', (req, res) => {
  const result = deleteLlmProfile(req.params.id);
  if (!result.ok) return res.status(400).json(result);
  resetClient();
  res.json({ ok: true, profiles: getLlmProfiles(), activeProfileId: getActiveProfileId() });
});

// POST /api/config/llm/profiles/:id/activate — 切换激活 profile
router.post('/llm/profiles/:id/activate', (req, res) => {
  const result = activateLlmProfile(req.params.id);
  if (!result.ok) return res.status(400).json(result);
  resetClient();

  // preset 检测：与 PUT /api/config/llm 一致
  const presets = ['https://api.deepseek.com', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://api.moonshot.cn/v1', 'https://api.openai.com/v1'];
  if (presets.includes(config.llm.baseURL) && config.features.serializeBackgroundLLM) {
    updateFeatureFlag('serializeBackgroundLLM', false);
  }

  res.json({ ok: true, llmConfig: getLlmConfig(), profiles: getLlmProfiles(), activeProfileId: getActiveProfileId() });
});

// PUT /api/config/llm/profiles/active/sync — 同步当前配置到激活的 profile
router.put('/llm/profiles/active/sync', (req, res) => {
  syncActiveLlmProfile();
  res.json({ ok: true });
});

// GET /api/config/rules — 获取全部全局规则
router.get('/rules', (req, res) => {
  const db = getDb();
  const rules = db.prepare(`SELECT id, rule_key, rule_content, is_active, created_at, updated_at FROM global_rules ORDER BY id`).all();
  res.json({ rules: rules.filter(r => !BUILTIN_RULE_KEYS.has(r.rule_key)) });
});

// PUT /api/config/rules/:key — 更新或新建单条全局规则
router.put('/rules/:key', (req, res) => {
  if (BUILTIN_RULE_KEYS.has(req.params.key)) {
    return res.status(403).json({ error: 'This rule is now built-in and cannot be modified via API.' });
  }
  const db = getDb();
  const { rule_content, is_active } = req.body;
  const existing = db.prepare(`SELECT id FROM global_rules WHERE rule_key = ?`).get(req.params.key);
  if (!existing) {
    // 不存在则新建
    const content = rule_content !== undefined ? rule_content : '';
    const active = is_active !== undefined ? (is_active ? 1 : 0) : 1;
    const result = db.prepare(
      `INSERT INTO global_rules (rule_key, rule_content, is_active) VALUES (?, ?, ?)`
    ).run(req.params.key, content, active);
    const created = db.prepare(`SELECT * FROM global_rules WHERE id = ?`).get(result.lastInsertRowid);
    return res.json({ ok: true, rule: created });
  }
  const updates = [];
  const params = [];
  if (rule_content !== undefined) { updates.push('rule_content = ?'); params.push(rule_content); }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  updates.push("updated_at = datetime('now')");
  params.push(req.params.key);
  db.prepare(`UPDATE global_rules SET ${updates.join(', ')} WHERE rule_key = ?`).run(...params);
  const updated = db.prepare(`SELECT * FROM global_rules WHERE rule_key = ?`).get(req.params.key);
  res.json({ ok: true, rule: updated });
});

// GET /api/config/user — 获取用户昵称 + 自我设定
router.get('/user', (req, res) => {
  res.json(getUserConfig());
});

// PUT /api/config/user — 更新用户昵称 + 性别 + 外观 + 其他说明
router.put('/user', (req, res) => {
  const { nickname, gender, appearance, persona } = req.body;
  updateUserConfig({ nickname, gender, appearance, persona });
  res.json({ ok: true, ...getUserConfig() });
});

// GET /api/config/user-avatar — 获取用户头像路径
router.get('/user-avatar', (req, res) => {
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.dirname(path.dirname(path.dirname(__filename)));
  const avatarDir = path.join(projectRoot, 'data', 'avatars');
  const userAvatarPath = path.join(avatarDir, 'user_avatar.png');
  if (fs.existsSync(userAvatarPath)) {
    const mtime = fs.statSync(userAvatarPath).mtimeMs;
    res.json({ avatar_path: `/avatars/user_avatar.png?v=${mtime}` });
  } else {
    res.json({ avatar_path: null });
  }
});

// POST /api/config/user-avatar — 上传用户头像（base64）
router.post('/user-avatar', (req, res) => {
  const { base64 } = req.body;
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.dirname(path.dirname(path.dirname(__filename)));
  const avatarDir = path.join(projectRoot, 'data', 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });

  // null / 空字符串 = 删除头像
  if (!base64) {
    const userAvatarPath = path.join(avatarDir, 'user_avatar.png');
    try { if (fs.existsSync(userAvatarPath)) fs.unlinkSync(userAvatarPath); } catch {}
    return res.json({ ok: true, avatar_path: null });
  }

  const filePath = path.join(avatarDir, 'user_avatar.png');
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  const mtime = fs.statSync(filePath).mtimeMs;

  res.json({ ok: true, avatar_path: `/avatars/user_avatar.png?v=${mtime}` });
});

// GET /api/config/loras-files — 从 launcher_config.json 读取 comfyui_exe，推导 loras 文件夹，并解析 extra_model_paths.yaml 获取外部路径
router.get('/loras-files', (req, res) => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const projectRoot = path.dirname(path.dirname(path.dirname(__filename)));
    const launcherConfigPath = path.join(projectRoot, '..', 'launcher_config.json');

    if (!fs.existsSync(launcherConfigPath)) {
      return res.json({ files: [], lorasDir: null, error: 'launcher_config.json 不存在，请先在启动器中配置 ComfyUI 路径' });
    }

    const launcherConfig = JSON.parse(fs.readFileSync(launcherConfigPath, 'utf-8'));
    const comfyuiExe = launcherConfig.comfyui_exe;
    if (!comfyuiExe) {
      return res.json({ files: [], lorasDir: null, error: 'comfyui_exe 未配置，请先在启动器中设置 ComfyUI 启动器路径' });
    }

    const rootDir = path.dirname(comfyuiExe);
    const defaultLoraDir = path.join(rootDir, 'ComfyUI', 'models', 'loras');

    // 收集所有待扫描目录
    const scanDirs = new Set();
    const dirSourceMap = new Map(); // absPath → source groupName

    if (fs.existsSync(defaultLoraDir)) {
      scanDirs.add(defaultLoraDir);
    }

    // 解析 extra_model_paths.yaml（可能在 rootDir 或 rootDir/ComfyUI 下）
    let yamlPath = path.join(rootDir, 'extra_model_paths.yaml');
    if (!fs.existsSync(yamlPath)) {
      yamlPath = path.join(rootDir, 'ComfyUI', 'extra_model_paths.yaml');
    }
    if (fs.existsSync(yamlPath)) {
      const yamlDir = path.dirname(yamlPath);
      try {
        const yamlContent = yamlLoad(fs.readFileSync(yamlPath, 'utf-8'));
        if (yamlContent && typeof yamlContent === 'object') {
          for (const [groupName, groupConfig] of Object.entries(yamlContent)) {
            if (!groupConfig || typeof groupConfig !== 'object') continue;
            const basePath = groupConfig.base_path;
            const lorasField = groupConfig.loras;
            if (!basePath || lorasField === undefined) continue;

            const lorasValues = Array.isArray(lorasField)
              ? lorasField
              : typeof lorasField === 'string' ? [lorasField] : [];

            for (const lv of lorasValues) {
              if (typeof lv !== 'string') continue;
              const lines = lv.split('\n').map(s => s.trim()).filter(Boolean);
              for (const line of lines) {
                const absPath = path.resolve(yamlDir, basePath, line === '.' ? '.' : line);
                if (fs.existsSync(absPath)) {
                  scanDirs.add(absPath);
                  dirSourceMap.set(absPath, groupName);
                }
              }
            }
          }
        }
      } catch (yamlErr) {
        console.warn('[loras-files] extra_model_paths.yaml 解析失败，仅扫描默认目录:', yamlErr.message);
      }
    }

    // 遍历所有目录收集 .safetensors 文件
    const files = [];
    const seen = new Set();

    function walkDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.safetensors')) {
          const relToDefault = path.relative(defaultLoraDir, fullPath);
          const isDefault = !relToDefault.startsWith('..') && !path.isAbsolute(relToDefault);

          if (isDefault) {
            const name = relToDefault;
            if (!seen.has(name)) {
              seen.add(name);
              files.push({ name, path: fullPath, source: null });
            }
          } else {
            const name = entry.name;
            let source = 'unknown';
            for (const [absPath, groupName] of dirSourceMap) {
              const rel = path.relative(absPath, fullPath);
              if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
                source = groupName;
                break;
              }
            }
            const key = name + '|' + source;
            if (!seen.has(key)) {
              seen.add(key);
              files.push({ name, path: fullPath, source });
            }
          }
        }
      }
    }

    for (const dir of scanDirs) {
      walkDir(dir);
    }

    files.sort((a, b) => a.name.localeCompare(b.name));
    console.log(`[loras-files] ${files.length} files from ${scanDirs.size} dir(s)`);

    res.json({ files, lorasDir: defaultLoraDir });
  } catch (err) {
    res.status(500).json({ files: [], lorasDir: null, error: err.message });
  }
});

// ── 画师串收藏夹 ──

// GET /api/config/artist-favorites
router.get('/artist-favorites', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, label, artist, sort_order, created_at FROM artist_favorites ORDER BY sort_order, created_at DESC`
  ).all();
  res.json({ favorites: rows });
});

// POST /api/config/artist-favorites
router.post('/artist-favorites', (req, res) => {
  const db = getDb();
  const { label, artist } = req.body;
  if (!label || !artist) {
    return res.status(400).json({ error: 'label and artist are required' });
  }
  // 去重检查
  const existing = db.prepare(`SELECT id FROM artist_favorites WHERE artist = ?`).get(artist.trim());
  if (existing) {
    return res.status(409).json({ error: 'duplicate', id: existing.id });
  }
  const result = db.prepare(
    `INSERT INTO artist_favorites (label, artist) VALUES (?, ?)`
  ).run(label.trim(), artist.trim());
  const row = db.prepare(`SELECT * FROM artist_favorites WHERE id = ?`).get(result.lastInsertRowid);
  res.json({ ok: true, favorite: row });
});

// PUT /api/config/artist-favorites/:id
router.put('/artist-favorites/:id', (req, res) => {
  const db = getDb();
  const { label, artist } = req.body;
  const existing = db.prepare(`SELECT id FROM artist_favorites WHERE id = ?`).get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Favorite not found' });
  }
  const updates = [];
  const params = [];
  if (label !== undefined) { updates.push('label = ?'); params.push(label.trim()); }
  if (artist !== undefined) { updates.push('artist = ?'); params.push(artist.trim()); }
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  params.push(req.params.id);
  db.prepare(`UPDATE artist_favorites SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = db.prepare(`SELECT * FROM artist_favorites WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, favorite: updated });
});

// DELETE /api/config/artist-favorites/:id
router.delete('/artist-favorites/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM artist_favorites WHERE id = ?`).get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Favorite not found' });
  }
  db.prepare(`DELETE FROM artist_favorites WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ── 防打扰模式 ──

// PUT /api/config/disturb-mode — 更新防打扰模式总开关
router.put('/disturb-mode', (req, res) => {
  const { value } = req.body;
  if (value == null || typeof value !== 'boolean') {
    return res.status(400).json({ error: 'value must be boolean' });
  }
  updateDisturbMode(value);
  // 总开关变更后立即触发一次检测
  triggerDisturbCheck();
  res.json({ ok: true, disturbMode: config.features.disturbMode });
});

// PUT /api/config/workflow-mode — 更新工作流模式 (base|turbo|hybrid)
router.put('/workflow-mode', (req, res) => {
  const { mode } = req.body;
  if (!mode || !['base', 'turbo', 'hybrid'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be base, turbo, or hybrid' });
  }
  const result = updateWorkflowMode(mode);
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true, workflow: getWorkflowConfig() });
});

// PUT /api/config/workflow-scene — 更新 hybrid 模式下场景→工作流映射
router.put('/workflow-scene', (req, res) => {
  const { scene } = req.body;
  const result = updateWorkflowScene(scene);
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true, workflow: getWorkflowConfig() });
});

// PUT /api/config/disturb-settings — 更新防打扰时间段和角色列表
router.put('/disturb-settings', (req, res) => {
  const { startTime, endTime, characterIds, hideWorld, skipWeekends } = req.body;
  if (startTime !== undefined && !/^\d{2}:\d{2}$/.test(startTime)) {
    return res.status(400).json({ error: 'startTime must be HH:MM format' });
  }
  if (endTime !== undefined && !/^\d{2}:\d{2}$/.test(endTime)) {
    return res.status(400).json({ error: 'endTime must be HH:MM format' });
  }
  if (characterIds !== undefined && !Array.isArray(characterIds)) {
    return res.status(400).json({ error: 'characterIds must be an array' });
  }
  if (hideWorld !== undefined && typeof hideWorld !== 'boolean') {
    return res.status(400).json({ error: 'hideWorld must be boolean' });
  }
  if (skipWeekends !== undefined && typeof skipWeekends !== 'boolean') {
    return res.status(400).json({ error: 'skipWeekends must be boolean' });
  }
  updateDisturbSettings({ startTime, endTime, characterIds, hideWorld, skipWeekends });
  // 设置变更后立即触发一次检测
  triggerDisturbCheck();
  res.json({
    ok: true,
    disturb: {
      startTime: config.disturb.startTime,
      endTime: config.disturb.endTime,
      characterIds: config.disturb.characterIds || [],
      hideWorld: config.disturb.hideWorld || false,
      skipWeekends: config.disturb.skipWeekends || false,
    },
  });
});

// GET /api/config/rules/:key/default — 获取单条规则的默认值（不修改，仅供预览）
router.get('/rules/:key/default', (req, res) => {
  if (BUILTIN_RULE_KEYS.has(req.params.key)) {
    return res.status(403).json({ error: 'This rule is now built-in and cannot be modified via API.' });
  }
  const defaultRule = DEFAULT_GLOBAL_RULES.find(r => r.rule_key === req.params.key);
  if (!defaultRule) {
    return res.status(404).json({ error: `No default value for rule key: ${req.params.key}` });
  }
  res.json({ ok: true, rule_key: defaultRule.rule_key, rule_content: defaultRule.rule_content });
});

// POST /api/config/rules/:key/reset — 重置单条全局规则为默认值
router.post('/rules/:key/reset', (req, res) => {
  if (BUILTIN_RULE_KEYS.has(req.params.key)) {
    return res.status(403).json({ error: 'This rule is now built-in and cannot be modified via API.' });
  }
  const db = getDb();
  const defaultRule = DEFAULT_GLOBAL_RULES.find(r => r.rule_key === req.params.key);
  if (!defaultRule) {
    return res.status(404).json({ error: `No default value for rule key: ${req.params.key}` });
  }
  const existing = db.prepare(`SELECT id FROM global_rules WHERE rule_key = ?`).get(req.params.key);
  if (!existing) {
    // 规则不存在则用默认值新建
    const result = db.prepare(
      `INSERT INTO global_rules (rule_key, rule_content, is_active) VALUES (?, ?, 1)`
    ).run(req.params.key, defaultRule.rule_content);
    const created = db.prepare(`SELECT * FROM global_rules WHERE id = ?`).get(result.lastInsertRowid);
    return res.json({ ok: true, rule: created });
  }
  db.prepare(
    `UPDATE global_rules SET rule_content = ?, updated_at = datetime('now') WHERE rule_key = ?`
  ).run(defaultRule.rule_content, req.params.key);
  const updated = db.prepare(`SELECT * FROM global_rules WHERE rule_key = ?`).get(req.params.key);
  res.json({ ok: true, rule: updated });
});

// ── 世界观收藏 ──

// GET /api/world-settings — 获取全部世界观列表
router.get('/world-settings', (req, res) => {
  res.json({ list: listWorldSettings() });
});

// POST /api/world-settings — 创建新世界观
router.post('/world-settings', (req, res) => {
  const { name, content } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const item = createWorldSetting({ name: name.trim(), content: content?.trim() || '' });
  res.json({ ok: true, item });
});

// PUT /api/world-settings/:id — 编辑某个世界观
router.put('/world-settings/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || !getWorldSettingById(id)) return res.status(404).json({ error: 'not found' });
  const { name, content } = req.body;
  const item = updateWorldSetting(id, { name: name?.trim(), content: content?.trim() });
  res.json({ ok: true, item });
});

// DELETE /api/world-settings/:id — 删除某个世界观
router.delete('/world-settings/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = deleteWorldSetting(id);
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
});

// POST /api/world-settings/:id/activate — 切换激活某个世界观
router.post('/world-settings/:id/activate', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = activateWorldSetting(id);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, item });
});

// PUT /api/config/weather-city — 设置天气城市
router.put('/weather-city', (req, res) => {
  const { city } = req.body;
  if (typeof city !== 'string') {
    return res.status(400).json({ error: 'city must be a string' });
  }
  updateWeatherConfig(city);
  res.json({ ok: true, city: config.weather.city });
});

export default router;
