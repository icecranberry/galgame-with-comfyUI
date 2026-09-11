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
 * 检测等距地砖贴图中菱形顶面的纵向中心（占图高比例）。
 * 原理：菱形的横向对角线是整块内容最宽的一行，该行 y / 图高 = 菱形中心锚点。
 * 用于渲染器把相邻地砖的菱形精确对齐（生成图的菱形位置每次都有漂移）。
 * 检测失败返回 null（调用方回退 0.5）。
 * @param {Buffer} buffer - PNG（地砖为不透明图）
 * @returns {Promise<number|null>} 0~1
 */
export async function detectTileAnchorY(buffer) {
  try {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    if (width < 4 || height < 4) return null;

    // 背景色 = 四角像素的众数（地砖贴图四角是画布留白）
    const cornerAt = (x, y) => {
      const o = (y * width + x) * 4;
      return [data[o], data[o + 1], data[o + 2], data[o + 3]];
    };
    const corners = [cornerAt(0, 0), cornerAt(width - 1, 0), cornerAt(0, height - 1), cornerAt(width - 1, height - 1)];
    const bg = corners[0];
    const isBg = (r, g, b, a) => {
      if (a < 128) return true; // 透明也算背景
      return corners.some(c => Math.abs(c[0] - r) <= 24 && Math.abs(c[1] - g) <= 24 && Math.abs(c[2] - b) <= 24);
    };

    let bestRow = -1;
    let bestWidth = 0;
    for (let y = 0; y < height; y++) {
      let left = -1;
      let right = -1;
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (!isBg(data[o], data[o + 1], data[o + 2], data[o + 3])) {
          if (left === -1) left = x;
          right = x;
        }
      }
      const w = left === -1 ? 0 : right - left + 1;
      if (w > bestWidth) {
        bestWidth = w;
        bestRow = y;
      }
    }
    if (bestRow < 0 || bestWidth < width * 0.3) return null; // 内容太小，不可信
    return Math.round((bestRow / height) * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * 检测等距地砖生成图里顶面菱形的包围框。
 * 生成图的菱形位置/侧面厚度每次都不同，直接平铺会在接缝处露出毛刺，需按实际位置裁切。
 * 裁切框由「最宽行」反推：菱形最宽行就是它的竖直中线，所以顶点 = 最宽行 − 菱形高/2。
 * 不能用内容最高行：Anima 常在顶面上加草丛/水晶/道具，那会顶高最高行、把裁切框整体抬偏。
 * 检测失败返回 null（调用方降级成普通方图；素材库改为让用户手动画菱形）。
 * @param {Buffer} buffer - 原始生成图
 * @returns {Promise<{x:number,y:number,w:number}|null>} 菱形包围框：宽 w、高 w/2
 */
export async function detectIsoDiamond(buffer) {
  try {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    // 背景色 = 四角像素（留白），内容 = 与任一角显著不同或透明
    const cornerAt = (x, y) => {
      const o = (y * width + x) * 4;
      return [data[o], data[o + 1], data[o + 2], data[o + 3]];
    };
    const corners = [cornerAt(0, 0), cornerAt(width - 1, 0), cornerAt(0, height - 1), cornerAt(width - 1, height - 1)];
    const isContent = (x, y) => {
      const o = (y * width + x) * 4;
      const r = data[o], g = data[o + 1], b = data[o + 2], a = data[o + 3];
      if (a < 128) return false;
      return !corners.some(c => Math.abs(c[0] - r) <= 22 && Math.abs(c[1] - g) <= 22 && Math.abs(c[2] - b) <= 22);
    };

    // 找内容顶行 + 最宽行（= 菱形横向对角线）
    let minY = -1;
    let bestRow = -1;
    let bestLeft = 0;
    let bestRight = 0;
    let bestWidth = 0;
    for (let y = 0; y < height; y++) {
      let left = -1;
      let right = -1;
      for (let x = 0; x < width; x++) {
        if (isContent(x, y)) {
          if (left === -1) left = x;
          right = x;
        }
      }
      if (left !== -1 && minY === -1) minY = y;
      const w = left === -1 ? 0 : right - left + 1;
      if (w > bestWidth) {
        bestWidth = w;
        bestLeft = left;
        bestRight = right;
        bestRow = y;
      }
    }
    const diamondW = bestRight - bestLeft + 1;
    if (minY < 0 || bestRow < 0 || diamondW < width * 0.35 || bestRow <= minY) return null; // 内容太小，不可信

    const diamondH = Math.round(diamondW / 2); // 2:1 菱形：竖直对角线是水平对角线的一半
    // 顶面顶点由「最宽行」反推：菱形最宽行位于竖直中线，向上推 diamondH/2 即顶面顶点，
    // 向下推 diamondH/2 即底角（砖的侧面/土壤厚度正好全被切掉）。
    const diamondTop = bestRow - Math.round(diamondH / 2);
    if (diamondTop < 0 || diamondTop + diamondH > height) return null;
    return { x: bestLeft, y: diamondTop, w: diamondW };
  } catch {
    return null;
  }
}

/**
 * 按包围框从原图裁出 2:1 菱形顶面（不缩放，菱形之外 alpha=0）。
 * 生成时的自动归一化与素材库里用户手动调菱形走的是同一条管线，改这里两边同时生效。
 * @param {Buffer} buffer - 原始生成图
 * @param {{x:number,y:number,w:number}} rect - 菱形包围框：宽 w、高 w/2（原图像素坐标）
 * @returns {Promise<Buffer>} PNG，w × w/2
 */
export async function extractIsoDiamond(buffer, rect) {
  const x = Math.round(Number(rect?.x));
  const y = Math.round(Number(rect?.y));
  const w = Math.round(Number(rect?.w));
  if (![x, y, w].every(Number.isFinite) || x < 0 || y < 0 || w < 8) throw new Error('菱形裁剪框无效');
  const diamondH = Math.round(w / 2);
  if (diamondH < 4) throw new Error('菱形裁剪框无效');

  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (x + w > width || y + diamondH > height) throw new Error('菱形裁剪框超出图片范围');

  const cropped = await sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left: x, top: y, width: w, height: diamondH })
    .raw()
    .toBuffer();

  // 菱形 alpha 蒙版：2:1 菱形之外全透明（裁剪框四角是侧面/背景残留，互锁时会露出来）。
  // 容差 +6%：边缘略外扩，避免相邻菱形之间出现发丝缝
  const cx = w / 2;
  const cy = diamondH / 2;
  const EPS = 1.06;
  for (let py = 0; py < diamondH; py++) {
    for (let px = 0; px < w; px++) {
      if (Math.abs(px + 0.5 - cx) / cx + Math.abs(py + 0.5 - cy) / cy > EPS) {
        cropped[(py * w + px) * 4 + 3] = 0;
      }
    }
  }

  return sharp(cropped, { raw: { width: w, height: diamondH, channels: 4 } })
    .png()
    .toBuffer();
}

/**
 * 生成端地砖归一化：裁出顶面菱形，输出刚好铺满画幅的 2:1 菱形贴图（接缝完美互锁）。
 * 裁掉侧面后所有地砖都是标准菱形，立体感交给建筑/道具。
 * 额外返回检测到的框，记进素材 meta 后素材库可拿它当初始菱形让用户微调。
 * 检测失败时原样返回（调用方按普通方图降级处理）。
 * @param {Buffer} buffer - 原始生成图
 * @returns {Promise<{buffer:Buffer,rect:{x:number,y:number,w:number}|null}>}
 */
export async function flattenIsoTileWithRect(buffer) {
  const rect = await detectIsoDiamond(buffer);
  if (!rect) return { buffer, rect: null };
  try {
    return { buffer: await extractIsoDiamond(buffer, rect), rect };
  } catch {
    return { buffer, rect: null };
  }
}

/**
 * 只要图的老入口：等价于 flattenIsoTileWithRect(buffer).buffer
 * @param {Buffer} buffer - 原始生成图
 * @returns {Promise<Buffer>} PNG，内容为 2:1 菱形顶面
 */
export async function flattenIsoTile(buffer) {
  return (await flattenIsoTileWithRect(buffer)).buffer;
}

/**
 * 裁到内容包围盒（按 alpha）：生成图里的素材常只占画幅中间一小块，
 * 直接整图像素化会把主体压糊。裁掉透明边、保留 margin 比例呼吸边后再像素化。
 */
export async function cropToContent(buffer, marginRatio = 0.04) {
  try {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    let minY = height, maxY = -1, minX = width, maxX = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (maxY < 0) return buffer;
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * marginRatio);
    const left = Math.max(0, minX - pad);
    const top = Math.max(0, minY - pad);
    const w = Math.min(width - left, maxX - minX + 1 + pad * 2);
    const h = Math.min(height - top, maxY - minY + 1 + pad * 2);
    if (w >= width && h >= height) return buffer;
    return sharp(data, { raw: { width, height, channels: 4 } })
      .extract({ left, top, width: w, height: h })
      .png()
      .toBuffer();
  } catch {
    return buffer;
  }
}

/**
 * 素材统一后处理管线
 * @param {Buffer} buffer - 生图原始输出（JPEG/PNG）
 * @param {object} opts
 * @param {number} [opts.targetW] - 像素化目标宽（不传 targetW 时不做像素化）
 * @param {number} [opts.targetH] - 像素化目标高
 * @param {boolean} [opts.removeBg=false] - 是否抠白底（建筑/道具/精灵）
 * @param {number} [opts.tolerance=28] - 抠白容差
 * @param {boolean} [opts.cropContent=false] - 裁到内容包围盒（道具/精灵防「主体只占中间一小块」）
 * @param {boolean} [opts.smoothResize=false] - 平滑缩放到 targetW/H（插画小人用，保留画质不做像素化）
 */
export async function postProcessAsset(buffer, { targetW, targetH, removeBg = false, tolerance = 28, cropContent = false, smoothResize = false } = {}) {
  if (removeBg) {
    buffer = await removeWhiteBackground(buffer, tolerance);
  }
  if (cropContent) {
    buffer = await cropToContent(buffer);
  }
  if (smoothResize && targetW && targetH) {
    // 平滑轻缩：保留插画画质；cropContent 后必须按内容比例适配，不能强填目标画幅；
    // withoutEnlargement：小图不放大（放大只会糊），原样保留分辨率
    return sharp(buffer).resize(targetW, targetH, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  }
  if (targetW && targetH) {
    // 先抠白再像素化：避免降采样把背景白边混进前景边缘
    return pixelate(buffer, targetW, targetH);
  }
  return sharp(buffer).png().toBuffer();
}
