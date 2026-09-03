// 系统设置存储与 DB→config 装载（独立模块，打破 config.js ↔ db/index.js 的循环依赖）。
//
// 依赖方向（单向）：
//   db/index.js → settings.js（打开数据库后注入句柄并触发装载）
//   config.js  → settings.js（读写系统设置）
//   settings.js → （无内部依赖，db 句柄由 initSettingsHandle 注入）
import { config } from '../config.js';

let _db = null;

/** db/index.js 打开数据库后注入句柄（此模块不反向依赖 db/index.js） */
export function initSettingsHandle(db) {
  _db = db;
}

function handle() {
  if (!_db) throw new Error('settings: db handle not initialized (initSettingsHandle)');
  return _db;
}

/** 按 key 读取系统设置 */
export function getSetting(key) {
  return handle().prepare(`SELECT setting_value FROM system_settings WHERE setting_key = ?`).pluck().get(key) ?? null;
}

// 有意不纳入 SETTING_TO_CONFIG 的 DB-only 键（用于存储时间戳等运行时状态，不走 config 加载路径）
const DB_ONLY_KEYS = new Set([
  'last_moments_seen_at',
  'last_events_seen_at',
  'llm_profiles',
  'active_llm_profile_id',
  'memory_settings',
  'workflow_mode_auto_detected',
  'maibot_webui_url',
  'maibot_webui_token',
  'emoji_fixed_tags',
  'emoji_style_mode',
]);

/** 写入单条系统设置 */
export function setSetting(key, value) {
  handle().prepare(`INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
    .run(key, String(value));
  // 写入时校验：如果 key 不在映射表、也不在 disturb 前缀、也不在 DB-only 白名单，说明重启后会丢失
  if (!(key in SETTING_TO_CONFIG) && !key.startsWith('disturb_') && !DB_ONLY_KEYS.has(key)) {
    console.warn(`[config] setSetting("${key}"): key is not registered in SETTING_TO_CONFIG — value will NOT survive restart. Add it to the mapping in db/settings.js.`);
  }
}

// 需要从 DB 迁移到 config 的字段映射
export const SETTING_TO_CONFIG = {
  comfy_artist:            { obj: 'comfyui',   key: 'artist',          type: 'string'  },
  comfy_width:             { obj: 'comfyui',   key: 'width',           type: 'int'     },
  comfy_height:            { obj: 'comfyui',   key: 'height',          type: 'int'     },
  comfy_moments_artist:    { obj: 'comfyui',   key: 'momentsArtist',   type: 'string'  },
  comfy_moments_width:     { obj: 'comfyui',   key: 'momentsWidth',    type: 'int'     },
  comfy_moments_height:    { obj: 'comfyui',   key: 'momentsHeight',   type: 'int'     },
  comfy_event_artist:      { obj: 'comfyui',   key: 'eventArtist',     type: 'string'  },
  comfy_event_width:       { obj: 'comfyui',   key: 'eventWidth',      type: 'int'     },
  comfy_event_height:      { obj: 'comfyui',   key: 'eventHeight',     type: 'int'     },
  comfy_quality_prompt:    { obj: 'comfyui',   key: 'qualityPrompt',   type: 'string'  },
  feature_emotion:               { obj: 'features', key: 'emotion',          type: 'bool' },
  feature_memory:                { obj: 'features', key: 'memory',           type: 'bool' },
  feature_replyGuesses:          { obj: 'features', key: 'replyGuesses',     type: 'bool' },
  feature_forceImageGen:               { obj: 'features', key: 'forceImageGen',            type: 'bool' },
  feature_realtimeAffinityDisplay: { obj: 'features', key: 'realtimeAffinityDisplay', type: 'bool' },
  feature_proactiveChat:             { obj: 'features', key: 'proactiveChat',          type: 'bool' },
  feature_proactiveChatFreq:         { obj: 'features', key: 'proactiveChatFreq',     type: 'float' },
  feature_events:                    { obj: 'features', key: 'events',               type: 'bool' },
  feature_eventFreq:                 { obj: 'features', key: 'eventFreq',          type: 'float' },
  feature_disturbMode:              { obj: 'features', key: 'disturbMode',         type: 'bool' },
  feature_schedule:                 { obj: 'features', key: 'schedule',             type: 'bool' },
  feature_serializeBackgroundLLM:     { obj: 'features', key: 'serializeBackgroundLLM',    type: 'bool' },
  feature_backgroundLLMMaxConcurrency: { obj: 'features', key: 'backgroundLLMMaxConcurrency', type: 'int' },
  feature_mergeMessages:             { obj: 'features', key: 'mergeMessages',             type: 'bool' },
  feature_weather:                   { obj: 'features', key: 'weather',                type: 'bool' },
  feature_groupChat:                 { obj: 'features', key: 'groupChat',              type: 'bool' },
  feature_groupIdleBudget:           { obj: 'features', key: 'groupIdleBudget',        type: 'int'  },
  feature_deepThinkMode:             { obj: 'features', key: 'deepThinkMode',          type: 'bool' },
  group_temperature:                 { obj: 'groupChat', key: 'temperature',           type: 'float' },
  group_summary_interval:            { obj: 'groupChat', key: 'summaryInterval',      type: 'int' },
  weather_city:                      { obj: 'weather',  key: 'city',                  type: 'string' },
  compression_enabled:              { obj: 'compression', key: 'enabled',          type: 'bool' },
  compression_type:                 { obj: 'compression', key: 'type',             type: 'string' },
  user_nickname:                   { obj: 'user',     key: 'nickname',          type: 'string' },
  user_gender:                     { obj: 'user',     key: 'gender',            type: 'string' },
  user_appearance:                 { obj: 'user',     key: 'appearance',        type: 'string' },
  user_persona:                    { obj: 'user',     key: 'persona',           type: 'string' },
  workflow_mode:                   { obj: 'workflow',key: 'mode',             type: 'string' },
  comfy_global_lora:              { obj: 'comfyui',  key: 'globalLora',       type: 'json' },
  comfy_hires_lora:               { obj: 'comfyui',  key: 'hiresLora',        type: 'json' },
  comfy_hires_steps:              { obj: 'comfyui',  key: 'hiresSteps',       type: 'int'   },
  comfy_hires_cfg:                { obj: 'comfyui',  key: 'hiresCfg',         type: 'float' },
  comfy_hires_denoise:            { obj: 'comfyui',  key: 'hiresDenoise',     type: 'float' },
  comfy_hires_max_size:           { obj: 'comfyui',  key: 'hiresMaxSize',     type: 'int' },
  comfy_hires_artist_mode:        { obj: 'comfyui',  key: 'hiresArtistMode',  type: 'string' },
  comfy_hires_artist:             { obj: 'comfyui',  key: 'hiresArtist',      type: 'string' },
};

function castValue(raw, type) {
  if (raw == null) return undefined;
  switch (type) {
    case 'int':  { const v = parseInt(raw, 10); return Number.isNaN(v) ? undefined : v; }
    case 'float': { const v = parseFloat(raw); return Number.isNaN(v) ? undefined : v; }
    case 'bool': return raw === 'true' || raw === '1';
    case 'json': { try { const v = JSON.parse(raw); return v; } catch { return undefined; } }
    default:     return raw;
  }
}

// 从 DB 读取 system_settings 覆盖 config 内存（DB 优先于代码默认值）
export function loadSystemSettings(db) {
  const rows = db.prepare(`SELECT setting_key, setting_value FROM system_settings`).all();
  let applied = 0;
  for (const row of rows) {
    const mapping = SETTING_TO_CONFIG[row.setting_key];
    if (mapping) {
      let value = castValue(row.setting_value, mapping.type);
      if (value !== undefined) {
        // 群聊记忆轮数历史遗留值收敛到 2~6
        if (row.setting_key === 'group_summary_interval') value = Math.max(2, Math.min(6, value));
        config[mapping.obj][mapping.key] = value;
        applied++;
      }
      continue;
    }
    // 额外处理 disturb 配置（不在 SETTING_TO_CONFIG 映射中）
    if (row.setting_key === 'disturb_start_time') {
      config.disturb.startTime = row.setting_value;
      applied++;
    } else if (row.setting_key === 'disturb_end_time') {
      config.disturb.endTime = row.setting_value;
      applied++;
    } else if (row.setting_key === 'disturb_character_ids') {
      try {
        config.disturb.characterIds = JSON.parse(row.setting_value);
      } catch {
        config.disturb.characterIds = [];
      }
      applied++;
    } else if (row.setting_key === 'disturb_hide_world') {
      config.disturb.hideWorld = row.setting_value === 'true' || row.setting_value === '1';
      applied++;
    } else if (row.setting_key === 'disturb_skip_weekends') {
      config.disturb.skipWeekends = row.setting_value === 'true' || row.setting_value === '1';
      applied++;
    }
    // workflow_scene JSON 配置
    if (row.setting_key === 'workflow_scene') {
      try {
        config.workflow.scene = { ...config.workflow.scene, ...JSON.parse(row.setting_value) };
      } catch {
        /* keep defaults */
      }
      applied++;
    }
  }
  if (applied > 0) {
    console.log(`[db] system_settings: ${applied} keys applied to config`);
  }
}
