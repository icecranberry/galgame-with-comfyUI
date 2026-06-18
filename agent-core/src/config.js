import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { setSetting } from './db/index.js';

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
    model: process.env.LLM_MODEL || 'deepseek-chat',
  },
  vectorService: {
    url: process.env.VECTOR_SERVICE_URL || 'http://localhost:8765',
  },
  comfyui: {
    url: process.env.COMFYUI_URL || 'http://localhost:8188',
    outputDir: process.env.COMFYUI_OUTPUT_DIR || './output',
    artist: process.env.COMFYUI_ARTIST || '@ebora',
    width: parseInt(process.env.COMFYUI_WIDTH, 10) || 768,
    height: parseInt(process.env.COMFYUI_HEIGHT, 10) || 512,
    momentsArtist: process.env.COMFYUI_MOMENTS_ARTIST || process.env.COMFYUI_ARTIST || '@ebora',
    momentsWidth: parseInt(process.env.COMFYUI_MOMENTS_WIDTH, 10) || 1600,
    momentsHeight: parseInt(process.env.COMFYUI_MOMENTS_HEIGHT, 10) || 1200,
  },
  features: {
    emotion: process.env.FEATURE_EMOTION !== 'false',
    memory: process.env.FEATURE_MEMORY !== 'false',
    autoImageJudge: process.env.FEATURE_AUTO_IMAGE_JUDGE !== 'false', // 默认开
    promptOptimize: process.env.FEATURE_PROMPT_OPTIMIZE === 'true', // 默认关
    replyGuesses: process.env.FEATURE_REPLY_GUESSES === 'true', // 默认关
    forceImageGen: process.env.FEATURE_FORCE_IMAGE_GEN === 'true', // 默认关：灵性生图
  },
  user: {
    nickname: process.env.USER_NICKNAME || '',
    persona: process.env.USER_PERSONA || '',
  },
};

function persistEnv(key, value) {
  let envContent = fs.readFileSync(envPath, 'utf8');
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

export function updateComfyConfig({ artist, width, height, url, momentsArtist, momentsWidth, momentsHeight }) {
  if (artist !== undefined) { config.comfyui.artist = artist; persistSettingSync('comfy_artist', artist); }
  if (width !== undefined) { config.comfyui.width = parseInt(width, 10) || config.comfyui.width; persistSettingSync('comfy_width', config.comfyui.width); }
  if (height !== undefined) { config.comfyui.height = parseInt(height, 10) || config.comfyui.height; persistSettingSync('comfy_height', config.comfyui.height); }
  if (url !== undefined) { config.comfyui.url = url; persistEnv('COMFYUI_URL', url); }
  if (momentsArtist !== undefined) { config.comfyui.momentsArtist = momentsArtist; persistSettingSync('comfy_moments_artist', momentsArtist); }
  if (momentsWidth !== undefined) { config.comfyui.momentsWidth = parseInt(momentsWidth, 10) || config.comfyui.momentsWidth; persistSettingSync('comfy_moments_width', config.comfyui.momentsWidth); }
  if (momentsHeight !== undefined) { config.comfyui.momentsHeight = parseInt(momentsHeight, 10) || config.comfyui.momentsHeight; persistSettingSync('comfy_moments_height', config.comfyui.momentsHeight); }
  console.log('[config] ComfyUI settings saved');
}

export function updateFeatureFlag(key, value) {
  const boolVal = value === true || value === 'true';
  config.features[key] = boolVal;
  persistSettingSync(`feature_${key}`, String(boolVal));
  console.log(`[config] Feature ${key} = ${boolVal}`);
}

export function getLlmConfig() {
  const key = config.llm.apiKey || '';
  const preview = !key ? '' : (key.length <= 12 ? '***' : `${key.slice(0, 5)}...${key.slice(-4)}`);
  return {
    provider: config.llm.provider,
    hasApiKey: !!key,
    preview,
    baseURL: config.llm.baseURL,
    model: config.llm.model,
  };
}

export function updateLlmConfig({ apiKey, baseURL, model }) {
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
  console.log('[config] LLM settings saved');
  return { ok: true };
}

export function updateUserConfig({ nickname, persona }) {
  if (nickname !== undefined) {
    config.user.nickname = nickname;
    persistEnv('USER_NICKNAME', nickname);
  }
  if (persona !== undefined) {
    config.user.persona = persona;
    persistEnv('USER_PERSONA', persona);
  }
  console.log('[config] User settings saved');
}

export function getUserConfig() {
  return { ...config.user };
}
