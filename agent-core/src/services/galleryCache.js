// 相册缓存（独立服务，避免每次请求都 readdir + stat 阻塞事件循环）。
// 生图/删图等操作通过 invalidateGalleryCache() 失效缓存；
// 服务层与路由层都从这里导入，不再出现 service → route 的反向依赖。
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { getAllImageDirs } from './imagePaths.js';

export const galleryCache = {
  data: null,       // { images: [...], total: number }
  mtime: 0,         // 缓存创建时间
  ttl: 30_000,      // 30 秒 TTL（生图不频繁，短缓存已足够）
};

/** 扫描单个目录，返回带 folder 标记的图片列表 */
async function scanDirectory(dirPath, category, urlPrefix) {
  try {
    const files = await readdir(dirPath);
    const imageFiles = files.filter(f => /\.(png|jpg|jpeg|webp|gif|avif)$/i.test(f));
    if (imageFiles.length === 0) return [];

    const BATCH_SIZE = 64;
    const results = [];
    for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
      const batch = imageFiles.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (name) => {
          const s = await stat(join(dirPath, name));
          return { name, size: s.size, mtime: s.mtimeMs, folder: category, url: `${urlPrefix}/${name}` };
        })
      );
      results.push(...batchResults);
    }
    return results;
  } catch {
    return [];
  }
}

/** 刷新相册缓存：扫描所有子目录 + 历史平铺目录，批量 stat */
export async function refreshGalleryCache() {
  const dirs = getAllImageDirs();
  const allResults = [];

  for (const { category, dir, urlPrefix } of dirs) {
    const results = await scanDirectory(dir, category, urlPrefix);
    allResults.push(...results);
  }

  allResults.sort((a, b) => b.mtime - a.mtime);

  galleryCache.data = { images: allResults, total: allResults.length };
  galleryCache.mtime = Date.now();
}

/** 当新图片生成/删除后调用，使缓存失效 */
export function invalidateGalleryCache() {
  galleryCache.data = null;
  galleryCache.mtime = 0;
}
