/**
 * 小镇像素素材后处理（sharp，纯本地）
 *
 * pixelate(buffer, targetW, targetH)
 *   box 式降采样到目标像素密度，输出小图；前端 nearest-neighbor 放大保持颗粒感。
 *
 * removeWhiteBackground(buffer, tolerance)
 *   白底图（建筑/道具/精灵）抠透明背景：
 *   - 从四边泛洪的「连通」白区判定背景 —— 图内部的白色衣物/白色墙面靠连通性保护，不会误抠；
 *   - 亮度容差阈值（0~128），容忍生成图的暖白/浅灰底；
 *   - alpha 二值化（0/255 硬边），不产生半透明毛边，符合像素风。
 *   抠坏的素材由调用方单张重生成，不在本层补救。
 */
import sharp from 'sharp';

/**
 * 像素化：降采样到 targetW×targetH 的小图（PNG）
 * @param {Buffer} buffer
 * @param {number} targetW
 * @param {number} targetH
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function pixelate(buffer, targetW, targetH) {
  if (!Number.isInteger(targetW) || !Number.isInteger(targetH) || targetW < 1 || targetH < 1) {
    throw new Error(`pixelate: invalid target size ${targetW}x${targetH}`);
  }
  return sharp(buffer)
    .resize(targetW, targetH, { fit: 'fill', kernel: 'cubic' })
    .png()
    .toBuffer();
}

/**
 * 抠白背景：四边连通泛洪 + 亮度容差 → alpha 二值化
 * @param {Buffer} buffer - PNG/JPEG 等 sharp 可解码格式
 * @param {number} [tolerance=28] - 亮度容差（0~128）：RGB 各通道 ≥ 255-tolerance 视为「近白」
 * @returns {Promise<Buffer>} PNG buffer（RGBA，背景 alpha=0，前景 alpha=255）
 */
export async function removeWhiteBackground(buffer, tolerance = 28) {
  tolerance = Math.max(0, Math.min(128, Math.round(tolerance)));
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info; // channels 恒为 4（ensureAlpha）
  const px = data;

  const threshold = 255 - tolerance;
  const idx = (x, y) => (y * width + x) * 4;

  // 近白掩码：RGB 三通道都够亮（不检查 alpha——半透明近白像素同样可作背景候选）
  const isWhiteish = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (px[o] >= threshold && px[o + 1] >= threshold && px[o + 2] >= threshold) {
      isWhiteish[i] = 1;
    }
  }

  // 从四边泛洪：只有与图像边缘连通的近白区才是背景
  const isBackground = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (isWhiteish[i] && !isBackground[i]) {
      isBackground[i] = 1;
      stack.push(x, y);
    }
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // alpha 二值化：背景 0，前景 255（硬边）
  for (let i = 0; i < width * height; i++) {
    px[idx(i % width, Math.floor(i / width)) + 3] = isBackground[i] ? 0 : 255;
  }

  return sharp(px, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/**
 * 素材统一后处理管线
 * @param {Buffer} buffer - 生图原始输出（JPEG/PNG）
 * @param {object} opts
 * @param {number} opts.targetW - 像素化目标宽
 * @param {number} opts.targetH - 像素化目标高
 * @param {boolean} [opts.removeBg=false] - 是否抠白底（建筑/道具/精灵）
 * @param {number} [opts.tolerance=28] - 抠白容差
 */
export async function postProcessAsset(buffer, { targetW, targetH, removeBg = false, tolerance = 28 } = {}) {
  if (removeBg) {
    buffer = await removeWhiteBackground(buffer, tolerance);
  }
  // 先抠白再像素化：避免降采样把背景白边混进前景边缘
  return pixelate(buffer, targetW, targetH);
}
