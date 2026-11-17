import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MEDIA_DIR, inside, validId, bad, regularFile } from './gamePaths.js';

export async function saveGameOutput(result, opts, { sessionExists, mediaDir = MEDIA_DIR } = {}) {
  if (opts.outputScope !== 'game' || !result.success) return result;
  const gameId = validId(opts.gameId), sessionId = validId(opts.sessionId);
  // Check after the remote generation, so deleting a save while rendering cannot
  // recreate its media directory. The caller also enforces game ownership.
  if (!sessionExists) {
    const { getDb } = await import('../db/index.js');
    sessionExists = () => !!getDb().prepare('SELECT 1 FROM game_sessions s JOIN installed_games g ON g.id=s.game_id WHERE s.game_id=? AND s.session_id=? AND g.installed=1 AND g.enabled=1').get(gameId, sessionId);
  }
  if (!sessionExists()) throw bad('游戏已卸载、停用或存档已删除，未保存图片', 409);
  const dir = inside(mediaDir, `${gameId}/${sessionId}`);
  fs.mkdirSync(dir, { recursive: true });
  const { default: sharp } = await import('sharp');
  const urls = [];
  try {
    for (const image of result.images || []) {
      const filename = `${Date.now()}_${randomUUID()}.png`;
      const base64 = typeof image === 'string' ? image : image?.base64;
      if (typeof base64 !== 'string' || !base64) throw bad('生图服务返回了无效图片', 502);
      const data = Buffer.from(base64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
      await sharp(data).png().toFile(path.join(dir, filename));
      urls.push(`/game-media/${gameId}/${sessionId}/${filename}`);
    }
    // Recheck because conversion yields to deletion/uninstall operations.
    if (!sessionExists()) throw bad('存档已删除或游戏已停用', 409);
    return { ...result, images: [], urls, url: urls[0] };
  } catch (error) {
    for (const url of urls) fs.rmSync(path.join(dir, path.basename(url)), { force: true });
    throw error;
  }
}
export async function promoteGameMedia(repo, gameId, { sessionId, filename }) {
  if (!repo.session(gameId, sessionId)) throw bad('存档不存在', 404);
  if (typeof filename !== 'string' || !/^[\w-]+\.png$/.test(filename)) throw bad('无效的图片名称');
  const file = regularFile(MEDIA_DIR, `${validId(gameId)}/${validId(sessionId)}/${filename}`);
  const { saveBase64Image } = await import('../services/imagePaths.js');
  const { invalidateGalleryCache } = await import('../services/galleryCache.js');
  const url = saveBase64Image('events', `game_${gameId}_${randomUUID()}.png`, fs.readFileSync(file).toString('base64'));
  invalidateGalleryCache();
  return { url };
}
