import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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
    artist: process.env.COMFYUI_ARTIST || '@tony taka',
    width: parseInt(process.env.COMFYUI_WIDTH, 10) || 1600,
    height: parseInt(process.env.COMFYUI_HEIGHT, 10) || 1200,
  },
  features: {
    emotion: process.env.FEATURE_EMOTION !== 'false',
    memory: process.env.FEATURE_MEMORY !== 'false',
    memoryExtract: process.env.FEATURE_MEMORY_EXTRACT === 'true', // 默认关
    autoImageJudge: process.env.FEATURE_AUTO_IMAGE_JUDGE !== 'false', // 默认开
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

export function updateComfyConfig({ artist, width, height, url }) {
  if (artist !== undefined) config.comfyui.artist = artist;
  if (width !== undefined) config.comfyui.width = parseInt(width, 10) || config.comfyui.width;
  if (height !== undefined) config.comfyui.height = parseInt(height, 10) || config.comfyui.height;
  if (url !== undefined) config.comfyui.url = url;
  persistEnv('COMFYUI_ARTIST', config.comfyui.artist);
  persistEnv('COMFYUI_WIDTH', config.comfyui.width);
  persistEnv('COMFYUI_HEIGHT', config.comfyui.height);
  if (url !== undefined) persistEnv('COMFYUI_URL', url);
  console.log('[config] ComfyUI settings saved');
}

export function updateFeatureFlag(key, value) {
  const boolVal = value === true || value === 'true';
  config.features[key] = boolVal;
  const envKey = `FEATURE_${key.toUpperCase().replace(/([A-Z])/g, '_$1').toUpperCase()}`;
  // 简化的 key 映射
  const keyMap = { emotion: 'FEATURE_EMOTION', memory: 'FEATURE_MEMORY', memoryExtract: 'FEATURE_MEMORY_EXTRACT', autoImageJudge: 'FEATURE_AUTO_IMAGE_JUDGE' };
  persistEnv(keyMap[key] || `FEATURE_${key.toUpperCase()}`, boolVal);
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
