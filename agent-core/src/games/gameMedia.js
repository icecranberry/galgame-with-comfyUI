import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildImageUrl, getImageDir } from '../services/imagePaths.js';
import { invalidateGalleryCache } from '../services/galleryCache.js';
import { encodeImageWithWorkflow } from '../services/imageWorkflowMetadata.js';
import { validId, bad } from './gamePaths.js';

export async function saveGameOutput(result, opts, { sessionExists, workflowSource } = {}) {
  if (opts.outputScope !== 'game' || !result.success) return result;
  const gameId = validId(opts.gameId), sessionId = validId(opts.sessionId);
  if (!sessionExists) {
    const { getDb } = await import('../db/index.js');
    sessionExists = () => !!getDb().prepare('SELECT 1 FROM game_sessions s JOIN installed_games g ON g.id=s.game_id WHERE s.game_id=? AND s.session_id=? AND g.installed=1 AND g.enabled=1').get(gameId, sessionId);
  }
  const { default: sharp } = await import('sharp');
  if (!sessionExists()) throw bad('游戏已卸载、停用或存档已删除，未保存图片', 409);
  if (!result.images?.length) throw bad('生图服务未返回图片', 502);
  const albumDir = getImageDir('game');
  fs.mkdirSync(albumDir, { recursive: true });
  const staged = [];
  const savedFiles = [];
  try {
    for (const image of result.images) {
      const filename = `${Date.now()}_${randomUUID()}.png`;
      const base64 = typeof image === 'string' ? image : image?.base64;
      if (typeof base64 !== 'string' || !base64) throw bad('生图服务返回了无效图片', 502);
      const data = Buffer.from(base64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
      const file = path.join(albumDir, filename);
      const temp = path.join(albumDir, `.${filename}.tmp`);
      staged.push({ filename, file, temp });
      await fs.promises.writeFile(temp, await encodeImageWithWorkflow(sharp(data).png(), workflowSource ?? data, 'png'));
    }
    // Recheck because conversion yields to deletion/uninstall operations.
    if (!sessionExists()) throw bad('存档已删除或游戏已停用', 409);
    for (const { file, temp } of staged) {
      fs.renameSync(temp, file);
      savedFiles.push(file);
    }
    invalidateGalleryCache();
    const urls = staged.map(({ filename }) => buildImageUrl('game', filename));
    return { ...result, images: [], urls, url: urls[0] };
  } catch (error) {
    for (const { temp } of staged) fs.rmSync(temp, { force: true });
    for (const file of savedFiles) fs.rmSync(file, { force: true });
    throw error;
  }
}
