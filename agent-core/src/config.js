import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { setSetting, getSetting } from './db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

export const config = {
  port: parseInt(process.env.PORT, 10) || 3099,
  dbPath: process.env.DB_PATH || './data/agent.db',
  llm: {
    provider: process.env.LLM_PROVIDER || 'deepseek',
    apiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.LLM_MODEL || 'deepseek-v4-flash',
    headers: (() => { try { return JSON.parse(process.env.LLM_HEADERS || '{}'); } catch { return {}; } })(),
    extraBody: (() => { try { return JSON.parse(process.env.LLM_EXTRA_BODY || '{}'); } catch { return {}; } })(),
  },
  vectorService: {
    url: process.env.VECTOR_SERVICE_URL || 'http://localhost:8765',
  },
  comfyui: {
    provider: ['auto', 'comfyui', 'codex'].includes(process.env.IMAGE_PROVIDER)
      ? process.env.IMAGE_PROVIDER
      : 'auto',
    url: (process.env.COMFYUI_URL || 'http://localhost:8188').replace(/\/+$/, ''),
    outputDir: process.env.COMFYUI_OUTPUT_DIR || './output',
    artist: process.env.COMFYUI_ARTIST || '@ebora',
    width: parseInt(process.env.COMFYUI_WIDTH, 10) || 768,
    height: parseInt(process.env.COMFYUI_HEIGHT, 10) || 512,
    momentsArtist: process.env.COMFYUI_MOMENTS_ARTIST || process.env.COMFYUI_ARTIST || '@ebora',
    momentsWidth: parseInt(process.env.COMFYUI_MOMENTS_WIDTH, 10) || 1600,
    momentsHeight: parseInt(process.env.COMFYUI_MOMENTS_HEIGHT, 10) || 1200,
    eventArtist: process.env.COMFYUI_EVENT_ARTIST || process.env.COMFYUI_MOMENTS_ARTIST || process.env.COMFYUI_ARTIST || '@ebora',
    eventWidth: parseInt(process.env.COMFYUI_EVENT_WIDTH, 10) || 1600,
    eventHeight: parseInt(process.env.COMFYUI_EVENT_HEIGHT, 10) || 1200,
    tlsVerify: process.env.COMFYUI_TLS_VERIFY !== 'false',
    globalLora: [],
  },
  features: {
    emotion: process.env.FEATURE_EMOTION !== 'false',
    memory: process.env.FEATURE_MEMORY !== 'false',
    replyGuesses: process.env.FEATURE_REPLY_GUESSES === 'true', // 默认关
    forceImageGen: process.env.FEATURE_FORCE_IMAGE_GEN === 'true', // 默认关：灵性生图
    realtimeAffinityDisplay: process.env.FEATURE_REALTIME_AFFINITY_DISPLAY === 'true', // 默认关：好感度实时显示
    proactiveChat: process.env.FEATURE_PROACTIVE_CHAT !== 'false', // 默认开：主动发起对话
    proactiveChatFreq: parseFloat(process.env.PROACTIVE_CHAT_FREQ) || 0.5, // 主动聊天频率 0~1
    events: process.env.FEATURE_EVENTS !== 'false', // 默认开：奇遇系统
    eventFreq: parseFloat(process.env.EVENT_FREQ) || 1, // 奇遇触发频率 0~1，0=关闭自动触发
    disturbMode: process.env.FEATURE_DISTURB_MODE === 'true', // 默认关：防打扰模式
    schedule: process.env.FEATURE_SCHEDULE !== 'false', // 默认开：日程系统
    serializeBackgroundLLM: process.env.FEATURE_SERIALIZE_BG_LLM === 'true', // 默认关：后台LLM任务串行化
    backgroundLLMMaxConcurrency: parseInt(process.env.BG_LLM_MAX_CONCURRENCY, 10) || 3, // 后台最大并发数 (1-10)
    mergeMessages: process.env.FEATURE_MERGE_MESSAGES === 'true', // 默认关：合并连续同角色消息兼容Jinja模板
    weather: process.env.FEATURE_WEATHER !== 'false', // 默认开：实时天气

  },
  disturb: {
    startTime: process.env.DISTURB_START_TIME || '22:00',
    endTime: process.env.DISTURB_END_TIME || '08:00',
    characterIds: [], // 内存中缓存，启动时从 DB 加载
    hideWorld: false, // 隐藏世界观（DB 加载覆盖）
    skipWeekends: false, // 跳过周末（DB 加载覆盖）
  },
  compression: {
    enabled: false,
    type: 'oxipng',   // 'oxipng' | 'avif'
  },
  workflow: {
    mode: 'turbo',     // 'base' | 'turbo' | 'hybrid'
    scene: {           // hybrid 模式下的场景→工作流映射
      chat: 'turbo',
      moments: 'base',
      events: 'base',
      schedule: 'base',
      mailbox: 'base',
    },
  },
  user: {
    nickname: process.env.USER_NICKNAME || '用户',
    gender: process.env.USER_GENDER || '',
    appearance: process.env.USER_APPEARANCE || '',
    persona: process.env.USER_PERSONA || '',
  },
  weather: {
    city: process.env.WEATHER_CITY || '',
  },
};

// 启动时如果 tlsVerify=false，设置进程级环境变量让 fetch/ws 信任自签名证书
if (config.comfyui.tlsVerify === false) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

function persistEnv(key, value) {
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  } else {
    envContent = '# 此文件由系统自动管理，通过 Settings 页面修改配置即可\n';
  }
  const line = `${key}=${String(value)}`;
  if (envContent.includes(`${key}=`)) {
    envContent = envContent.replace(new RegExp(`^${key}=.*$`, 'm'), line);
  } else {
    envContent += `\n${line}`;
  }
  fs.writeFileSync(envPath, envContent, 'utf8');
}

// 同步写入 DB（内存已更新，DB 写入由 setSetting 同步完成）
function persistSettingSync(key, value) {
  try {
    setSetting(key, value);
  } catch (err) {
    console.error(`[config] persistSetting failed for ${key}:`, err.message);
  }
}

export function updateComfyConfig({ provider, artist, width, height, url, momentsArtist, momentsWidth, momentsHeight, eventArtist, eventWidth, eventHeight, tlsVerify }) {
  if (provider !== undefined) {
    if (!['auto', 'comfyui', 'codex'].includes(provider)) throw new Error(`Invalid image provider: ${provider}`);
    config.comfyui.provider = provider;
    persistSettingSync('image_provider', provider);
  }
  if (artist !== undefined) { config.comfyui.artist = artist; persistSettingSync('comfy_artist', artist); }
  if (width !== undefined) { config.comfyui.width = parseInt(width, 10) || config.comfyui.width; persistSettingSync('comfy_width', config.comfyui.width); }
  if (height !== undefined) { config.comfyui.height = parseInt(height, 10) || config.comfyui.height; persistSettingSync('comfy_height', config.comfyui.height); }
  if (url !== undefined) { const n = String(url).replace(/\/+$/, ''); config.comfyui.url = n; persistEnv('COMFYUI_URL', n); }
  if (momentsArtist !== undefined) { config.comfyui.momentsArtist = momentsArtist; persistSettingSync('comfy_moments_artist', momentsArtist); }
  if (momentsWidth !== undefined) { config.comfyui.momentsWidth = parseInt(momentsWidth, 10) || config.comfyui.momentsWidth; persistSettingSync('comfy_moments_width', config.comfyui.momentsWidth); }
  if (momentsHeight !== undefined) { config.comfyui.momentsHeight = parseInt(momentsHeight, 10) || config.comfyui.momentsHeight; persistSettingSync('comfy_moments_height', config.comfyui.momentsHeight); }
  if (eventArtist !== undefined) { config.comfyui.eventArtist = eventArtist; persistSettingSync('comfy_event_artist', eventArtist); }
  if (eventWidth !== undefined) { config.comfyui.eventWidth = parseInt(eventWidth, 10) || config.comfyui.eventWidth; persistSettingSync('comfy_event_width', config.comfyui.eventWidth); }
  if (eventHeight !== undefined) { config.comfyui.eventHeight = parseInt(eventHeight, 10) || config.comfyui.eventHeight; persistSettingSync('comfy_event_height', config.comfyui.eventHeight); }
  if (tlsVerify !== undefined) {
    config.comfyui.tlsVerify = tlsVerify === true || tlsVerify === 'true';
    persistEnv('COMFYUI_TLS_VERIFY', String(config.comfyui.tlsVerify));
    if (!config.comfyui.tlsVerify) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    } else {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }
  }
  console.log('[config] ComfyUI settings saved');
}

export function updateGlobalLora(loras) {
  if (!Array.isArray(loras)) loras = [];
  const cleaned = loras.filter(l => l.path && typeof l.path === 'string').map(l => ({
    path: l.path,
    weight: typeof l.weight === 'number' ? l.weight : 0.6,
    triggerWord: l.triggerWord || '',
    enabled: l.enabled !== false,
    scenes: Array.isArray(l.scenes) ? l.scenes : [],
  }));
  config.comfyui.globalLora = cleaned;
  persistSettingSync('comfy_global_lora', JSON.stringify(cleaned));
  console.log(`[config] Global lora updated: ${cleaned.length} item(s)`);
}

export function updateFeatureFlag(key, value) {
  const boolVal = value === true || value === 'true';
  config.features[key] = boolVal;
  persistSettingSync(`feature_${key}`, String(boolVal));
  console.log(`[config] Feature ${key} = ${boolVal}`);
}

/**
 * 更新主动聊天频率 0~1
 * freq=0 → 双线全关；freq>0 → 启用以频率为基准的定时触发线
 */
export function updateProactiveFreq(value) {
  const f = Math.max(0, Math.min(1, parseFloat(value) || 0));
  config.features.proactiveChatFreq = f;
  config.features.proactiveChat = f > 0;
  persistSettingSync('feature_proactiveChatFreq', String(f));
  console.log(`[config] proactiveChatFreq = ${f}`);
}

/**
 * 更新奇遇触发频率 0~1
 * freq=0 → 关闭自动触发；freq>0 → 以频率为基准的定时触发
 */
export function updateEventFreq(value) {
  const f = Math.max(0, Math.min(1, parseFloat(value) || 0));
  config.features.eventFreq = f;
  persistSettingSync('feature_eventFreq', String(f));
  console.log(`[config] eventFreq = ${f}`);
}

/**
 * 更新后台 LLM 任务最大并发数 1~10
 * 仅在 serializeBackgroundLLM 为 true 时生效
 */
export function updateBackgroundConcurrency(value) {
  const n = Math.max(1, Math.min(10, parseInt(value, 10) || 3));
  config.features.backgroundLLMMaxConcurrency = n;
  persistSettingSync('feature_backgroundLLMMaxConcurrency', String(n));
  console.log(`[config] backgroundLLMMaxConcurrency = ${n}`);
}

export function getLlmConfig() {
  // 实时读取 .env 中的 API Key（兼容用户手动编辑 .env 不重启的场景）
  let envKey = '';
  try {
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, 'utf8');
      const m = raw.match(/^LLM_API_KEY=(.+)$/m);
      if (m) envKey = m[1].trim();
    }
  } catch {}
  // 优先用内存值（可能通过 UI 刚保存但还没写盘），回退到 .env 文件值
  const key = config.llm.apiKey || envKey || '';
  const preview = !key ? '' : (key.length <= 12 ? '***' : `${key.slice(0, 5)}...${key.slice(-4)}`);
  return {
    provider: config.llm.provider,
    hasApiKey: !!key,
    preview,
    baseURL: config.llm.baseURL,
    model: config.llm.model,
    headers: config.llm.headers || {},
    extraBody: config.llm.extraBody || {},
  };
}

export function updateLlmConfig({ apiKey, baseURL, model, headers, extraBody }) {
  if (apiKey !== undefined) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return { ok: false, error: 'API Key cannot be empty' };
    }
    config.llm.apiKey = apiKey.trim();
    persistEnv('LLM_API_KEY', config.llm.apiKey);
  }
  if (baseURL !== undefined) {
    config.llm.baseURL = baseURL;
    persistEnv('LLM_BASE_URL', baseURL);
  }
  if (model !== undefined) {
    config.llm.model = model;
    persistEnv('LLM_MODEL', model);
  }
  if (headers !== undefined) {
    config.llm.headers = typeof headers === 'string' ? JSON.parse(headers) : headers;
    persistEnv('LLM_HEADERS', JSON.stringify(config.llm.headers));
  }
  if (extraBody !== undefined) {
    config.llm.extraBody = typeof extraBody === 'string' ? JSON.parse(extraBody) : extraBody;
    persistEnv('LLM_EXTRA_BODY', JSON.stringify(config.llm.extraBody));
  }
  console.log('[config] LLM settings saved');
  return { ok: true };
}

export function updateUserConfig({ nickname, gender, appearance, persona }) {
  if (nickname !== undefined) {
    config.user.nickname = nickname;
    persistSettingSync('user_nickname', nickname);
  }
  if (gender !== undefined) {
    config.user.gender = gender;
    persistSettingSync('user_gender', gender);
  }
  if (appearance !== undefined) {
    config.user.appearance = appearance;
    persistSettingSync('user_appearance', appearance);
  }
  if (persona !== undefined) {
    config.user.persona = persona;
    persistSettingSync('user_persona', persona);
  }
  console.log('[config] User settings saved');
}

/**
 * 更新防打扰模式总开关
 */
export function updateDisturbMode(value) {
  const boolVal = value === true || value === 'true';
  config.features.disturbMode = boolVal;
  persistSettingSync('feature_disturbMode', String(boolVal));
  console.log(`[config] disturbMode = ${boolVal}`);
}

/**
 * 更新防打扰时间段和角色列表
 */
export function updateDisturbSettings({ startTime, endTime, characterIds, hideWorld, skipWeekends }) {
  if (startTime !== undefined) {
    config.disturb.startTime = startTime;
    persistSettingSync('disturb_start_time', startTime);
  }
  if (endTime !== undefined) {
    config.disturb.endTime = endTime;
    persistSettingSync('disturb_end_time', endTime);
  }
  if (characterIds !== undefined) {
    config.disturb.characterIds = characterIds;
    persistSettingSync('disturb_character_ids', JSON.stringify(characterIds));
  }
  if (hideWorld !== undefined) {
    config.disturb.hideWorld = hideWorld === true || hideWorld === 'true';
    persistSettingSync('disturb_hide_world', String(config.disturb.hideWorld));
  }
  if (skipWeekends !== undefined) {
    config.disturb.skipWeekends = skipWeekends === true || skipWeekends === 'true';
    persistSettingSync('disturb_skip_weekends', String(config.disturb.skipWeekends));
  }
  console.log('[config] disturb settings saved');
}

export function getUserConfig() {
  return { ...config.user };
}

export function updateCompressConfig({ enabled, type }) {
  if (enabled !== undefined) {
    config.compression.enabled = enabled === true || enabled === 'true';
    persistSettingSync('compression_enabled', String(config.compression.enabled));
  }
  if (type !== undefined) {
    config.compression.type = type;
    persistSettingSync('compression_type', type);
  }
  console.log(`[config] compression: enabled=${config.compression.enabled} type=${config.compression.type}`);
}

export function updateWorkflowMode(mode) {
  if (!['base', 'turbo', 'hybrid'].includes(mode)) {
    return { ok: false, error: 'mode must be base, turbo, or hybrid' };
  }
  config.workflow.mode = mode;
  persistSettingSync('workflow_mode', mode);
  console.log(`[config] workflowMode = ${mode}`);
  return { ok: true };
}

export function updateWorkflowScene(scene) {
  if (!scene || typeof scene !== 'object') {
    return { ok: false, error: 'scene must be an object' };
  }
  for (const [k, v] of Object.entries(scene)) {
    if (['chat', 'moments', 'events', 'schedule', 'mailbox'].includes(k) && ['base', 'turbo'].includes(v)) {
      config.workflow.scene[k] = v;
    }
  }
  persistSettingSync('workflow_scene', JSON.stringify(config.workflow.scene));
  console.log(`[config] workflowScene =`, config.workflow.scene);
  return { ok: true };
}

export function getWorkflowConfig() {
  return { ...config.workflow };
}

export function updateWeatherConfig(city) {
  config.weather.city = city;
  persistSettingSync('weather_city', city);
  console.log(`[config] weather city = ${city || '(auto)'}`);
}

// ── LLM 多配置 Profile 管理 ──

function readProfilesFromDb() {
  try {
    const raw = getSetting('llm_profiles');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeProfilesToDb(profiles) {
  setSetting('llm_profiles', JSON.stringify(profiles));
}

function maskApiKey(key) {
  if (!key) return { hasApiKey: false, preview: '' };
  return {
    hasApiKey: true,
    preview: key.length <= 12 ? '***' : `${key.slice(0, 5)}...${key.slice(-4)}`,
  };
}

export function getLlmProfiles() {
  const profiles = readProfilesFromDb();
  return profiles.map(p => ({
    id: p.id,
    name: p.name,
    ...maskApiKey(p.apiKey),
    baseURL: p.baseURL || '',
    model: p.model || '',
    createdAt: p.createdAt || '',
  }));
}

export function getActiveProfileId() {
  return getSetting('active_llm_profile_id') || null;
}

export function addLlmProfile(name) {
  const profiles = readProfilesFromDb();
  const id = 'p_' + Date.now();
  const now = new Date().toISOString();
  const profile = {
    id,
    name: name.trim(),
    apiKey: config.llm.apiKey || '',
    baseURL: config.llm.baseURL || 'https://api.deepseek.com',
    model: config.llm.model || 'deepseek-v4-flash',
    headers: config.llm.headers || {},
    extraBody: config.llm.extraBody || {},
    serializeBackgroundLLM: config.features.serializeBackgroundLLM || false,
    mergeMessages: config.features.mergeMessages || false,
    backgroundConcurrency: config.features.backgroundLLMMaxConcurrency || 3,
    createdAt: now,
  };
  profiles.push(profile);
  writeProfilesToDb(profiles);
  return { ok: true, profile: { ...profile, ...maskApiKey(profile.apiKey) } };
}

export function deleteLlmProfile(id) {
  let profiles = readProfilesFromDb();
  if (profiles.length <= 1) {
    return { ok: false, error: '不可删除最后一套配置' };
  }
  const target = profiles.find(p => p.id === id);
  if (!target) {
    return { ok: false, error: '配置不存在' };
  }
  const activeId = getActiveProfileId();
  profiles = profiles.filter(p => p.id !== id);
  writeProfilesToDb(profiles);

  if (activeId === id) {
    const first = profiles[0];
    setSetting('active_llm_profile_id', first.id);
    _applyProfileToConfig(first);
  }
  return { ok: true };
}

function _applyProfileToConfig(profile) {
  if (profile.apiKey) {
    config.llm.apiKey = profile.apiKey;
    persistEnv('LLM_API_KEY', profile.apiKey);
  }
  if (profile.baseURL !== undefined) {
    config.llm.baseURL = profile.baseURL;
    persistEnv('LLM_BASE_URL', profile.baseURL);
  }
  if (profile.model !== undefined) {
    config.llm.model = profile.model;
    persistEnv('LLM_MODEL', profile.model);
  }
  config.llm.headers = profile.headers || {};
  persistEnv('LLM_HEADERS', JSON.stringify(config.llm.headers));
  config.llm.extraBody = profile.extraBody || {};
  persistEnv('LLM_EXTRA_BODY', JSON.stringify(config.llm.extraBody));

  if (profile.serializeBackgroundLLM !== undefined) {
    updateFeatureFlag('serializeBackgroundLLM', profile.serializeBackgroundLLM);
  }
  if (profile.mergeMessages !== undefined) {
    updateFeatureFlag('mergeMessages', profile.mergeMessages);
  }
  if (profile.backgroundConcurrency !== undefined) {
    updateBackgroundConcurrency(profile.backgroundConcurrency);
  }
}

export function activateLlmProfile(id) {
  const profiles = readProfilesFromDb();
  const profile = profiles.find(p => p.id === id);
  if (!profile) {
    return { ok: false, error: '配置不存在' };
  }
  setSetting('active_llm_profile_id', id);
  _applyProfileToConfig(profile);

  // resetClient is imported dynamically to avoid circular dependency at module level
  return { ok: true };
}

export function syncActiveLlmProfile() {
  const activeId = getActiveProfileId();
  if (!activeId) return;
  const profiles = readProfilesFromDb();
  const idx = profiles.findIndex(p => p.id === activeId);
  if (idx === -1) return;
  profiles[idx] = {
    ...profiles[idx],
    apiKey: config.llm.apiKey || '',
    baseURL: config.llm.baseURL || '',
    model: config.llm.model || '',
    headers: config.llm.headers || {},
    extraBody: config.llm.extraBody || {},
    serializeBackgroundLLM: config.features.serializeBackgroundLLM || false,
    mergeMessages: config.features.mergeMessages || false,
    backgroundConcurrency: config.features.backgroundLLMMaxConcurrency || 3,
  };
  writeProfilesToDb(profiles);
}
