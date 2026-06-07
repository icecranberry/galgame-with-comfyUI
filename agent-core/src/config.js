import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

export const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  dbPath: process.env.DB_PATH || './data/agent.db',
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
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

export function updateComfyConfig({ artist, width, height }) {
  if (artist !== undefined) config.comfyui.artist = artist;
  if (width !== undefined) config.comfyui.width = parseInt(width, 10) || config.comfyui.width;
  if (height !== undefined) config.comfyui.height = parseInt(height, 10) || config.comfyui.height;
  persistEnv('COMFYUI_ARTIST', config.comfyui.artist);
  persistEnv('COMFYUI_WIDTH', config.comfyui.width);
  persistEnv('COMFYUI_HEIGHT', config.comfyui.height);
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
