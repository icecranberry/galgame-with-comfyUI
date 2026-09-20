import { createHash } from 'node:crypto';
import sharp from 'sharp';

// DeepSeek 图片输入只接受 JPEG / PNG / GIF / WebP，AVIF 会在上游被拒。
// 这里统一在 LLM 请求边界把已落盘为 AVIF 的图转成兼容 WebP，并限制给模型的长边。
const LLM_IMAGE_MAX_EDGE = 1600;
const DATA_URI_PREFIX = 'data' + ':' + 'image' + '/webp;base64,';
const DATA_URI_RE = /^data:image\/(?:png|jpe?g|webp|avif|gif);base64,([A-Za-z0-9+/=\s]+)$/i;
const CACHE_LIMIT = 8;
const compressedCache = new Map();

function cloneMessages(messages) {
  return messages.map(message => ({ ...message }));
}

async function compressForLlm(dataUri) {
  const match = String(dataUri || '').match(DATA_URI_RE);
  if (!match) return dataUri;

  const cacheKey = createHash('sha256').update(match[1]).digest('hex');
  if (compressedCache.has(cacheKey)) return compressedCache.get(cacheKey);

  const input = Buffer.from(match[1], 'base64');
  try {
    const buffer = await sharp(input)
      .rotate()
      .resize({
        width: LLM_IMAGE_MAX_EDGE,
        height: LLM_IMAGE_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80, effort: 4, smartSubsample: true })
      .toBuffer();

    const compressed = DATA_URI_PREFIX + buffer.toString('base64');
    if (compressedCache.size >= CACHE_LIMIT) {
      compressedCache.delete(compressedCache.keys().next().value);
    }
    compressedCache.set(cacheKey, compressed);
    return compressed;
  } catch (err) {
    throw new Error(`图片预处理失败: ${err.message}`);
  }
}

/**
 * 在进入任意 LLM 请求前统一压缩多模态 image_url content part。
 * 只处理 data URI；远程 URL 与测试中使用的非 data URI 占位串保持不变。
 */
export async function compressLlmImageInputs(messages) {
  if (!Array.isArray(messages)) return messages;

  const prepared = await Promise.all(cloneMessages(messages).map(async (message) => {
    if (!Array.isArray(message.content)) return message;
    const content = await Promise.all(message.content.map(async (part) => {
      const url = part?.type === 'image_url' ? part.image_url?.url : null;
      if (typeof url !== 'string' || !url.startsWith('data' + ':' + 'image' + '/')) return part;
      return { ...part, image_url: { ...part.image_url, url: await compressForLlm(url) } };
    }));
    return { ...message, content };
  }));

  return prepared.length === messages.length && prepared.every((m, i) => m === messages[i])
    ? messages
    : prepared;
}

export function resetLlmImageInputCache() {
  compressedCache.clear();
}
