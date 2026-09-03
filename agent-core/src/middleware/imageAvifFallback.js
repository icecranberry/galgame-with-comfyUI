import path from 'path';
import fs from 'fs';

/**
 * AVIF 自适应回退：请求 .png 时若原 PNG 已被压缩为同名 .avif 并删除，直接返回 AVIF 内容。
 *
 * 注意 req.path 是百分号编码的原始路径：表情包等文件名含中文（如 char_1_开心_123.png），
 * 必须先解码才能命中磁盘文件，否则压缩后所有中文文件名图片都会 404。
 * 解码结果必须限制在数据目录内，防止 %2e%2e(%2f) 编码逃逸。
 */
export function imageAvifFallback(dataDir = 'data/images') {
  const root = path.resolve(dataDir);
  return (req, res, next) => {
    if (!/\.png$/i.test(req.path)) return next();

    let decoded;
    try { decoded = decodeURIComponent(req.path); } catch { return next(); }
    const pngPath = path.resolve(root, '.' + decoded);
    if (!pngPath.startsWith(root + path.sep)) return next();

    // 原 PNG 存在 → 交给后续 static 中间件
    if (fs.existsSync(pngPath)) return next();

    // PNG 不存在（已被 AVIF 压缩后删除），检查同名 .avif
    const avifPath = pngPath.replace(/\.png$/i, '.avif');
    if (fs.existsSync(avifPath)) {
      res.setHeader('Content-Type', 'image/avif');
      return res.sendFile(avifPath);
    }

    next();
  };
}
