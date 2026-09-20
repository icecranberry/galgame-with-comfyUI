import sharp from 'sharp';

// 与图片实验室的 AVIF 压缩参数保持一致（quality 50 / effort 4）。
const DATA_URI_RE = /^(data:image\/(?:png|jpe?g|webp|avif|gif);base64,)([A-Za-z0-9+/=\s]+)$/i;

function extensionFromMime(dataUri) {
  const mime = String(dataUri).match(/^data:image\/([^;]+);/i)?.[1] || 'png';
  return mime.toLowerCase() === 'jpeg' ? '.jpg' : `.${mime.toLowerCase()}`;
}

/**
 * 把用户上传/自动生成的图片转成 AVIF。AVIF 编码偶尔大于小体积原图时回退原图。
 * 返回 dataUri 与实际扩展名，避免落盘时把 AVIF 内容存成 .png。
 */
export async function compressDataUriToAvif(dataUri, { maxEdge = 1920, quality = 50, effort = 4 } = {}) {
  const source = String(dataUri || '');
  const match = source.match(DATA_URI_RE);
  if (!match) return { dataUri: source, ext: extensionFromMime(source) };

  const input = Buffer.from(match[2], 'base64');
  const metadata = await sharp(input).metadata();
  const buffer = await sharp(input, { animated: !!metadata.pages && metadata.pages > 1 })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .avif({ quality, effort })
    .toBuffer();

  const compressed = 'data' + ':' + 'image' + '/avif;base64,' + buffer.toString('base64');
  if (compressed.length >= source.length) {
    return { dataUri: source, ext: extensionFromMime(source) };
  }
  return { dataUri: compressed, ext: '.avif' };
}
