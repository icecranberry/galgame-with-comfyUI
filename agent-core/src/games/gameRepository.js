import { randomUUID } from 'node:crypto';
import { bad, validId } from './gamePaths.js';

export function createGameRepository(db) {
  const game = id => db.prepare('SELECT * FROM installed_games WHERE id=?').get(validId(id));
  const session = (gameId, id) => {
    const row = db.prepare('SELECT * FROM game_sessions WHERE game_id=? AND session_id=?').get(validId(gameId), validId(id));
    return row && { sessionId: row.session_id, gameId: row.game_id, title: row.title, state: JSON.parse(row.state_json), createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
  };
  function write(gameId, id, title, state, expectedRevision) {
    validId(gameId); id = validId(id || randomUUID());
    const installed = game(gameId);
    if (!installed?.installed) throw bad('游戏未安装', 404);
    if (state === null || typeof state !== 'object') throw bad('存档状态必须是 JSON 对象或数组');
    const json = JSON.stringify(state);
    const maxMiB = installed.source === 'official' && gameId === 'trpg-simulator' ? 32 : 4;
    if (Buffer.byteLength(json) > maxMiB * 1024 * 1024) throw bad(`存档超过 ${maxMiB} MiB`);
    db.transaction(() => {
      const previous = db.prepare('SELECT game_id,revision FROM game_sessions WHERE session_id=?').get(id);
      if (previous && previous.game_id !== gameId) throw bad('存档不属于当前游戏', 403);
      if (expectedRevision !== undefined && (previous?.revision || 0) !== expectedRevision) throw bad('存档已在其他窗口更新，请重新载入', 409);
      const now = Date.now();
      db.prepare(`INSERT INTO game_sessions(session_id,game_id,title,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET title=excluded.title,state_json=excluded.state_json,updated_at=excluded.updated_at,revision=game_sessions.revision+1`)
        .run(id, gameId, String(title || '未命名存档').slice(0, 200), json, now, now);
    })();
    return session(gameId, id);
  }
  return { db, game, session, write,
    claims: id => db.prepare(`SELECT id, source, repo_url, zip_fingerprint, installed,
      EXISTS (SELECT 1 FROM game_sessions WHERE game_id=installed_games.id) AS has_sessions
      FROM installed_games WHERE id = ? COLLATE NOCASE`).all(validId(id)),
    list: () => db.prepare('SELECT * FROM installed_games WHERE installed=1 ORDER BY source=\'official\' DESC,name').all(),
    sessions: gameId => db.prepare(`SELECT session_id AS sessionId,title,created_at AS createdAt,updated_at AS updatedAt,revision,
      json_extract(state_json,'$.ended') AS ended,
      CASE WHEN json_type(state_json,'$.round') = 'integer' THEN json_extract(state_json,'$.round') END AS round
      FROM game_sessions WHERE game_id=? ORDER BY updated_at DESC`).all(validId(gameId)).map(row => ({ ...row, ended: row.ended === 1 })),
    deleteSession: (gameId, id) => db.prepare('DELETE FROM game_sessions WHERE game_id=? AND session_id=?').run(validId(gameId), validId(id)),
    register(manifest, source, installPath, repoUrl = null, zipFingerprint = null) {
      const now = Date.now();
      db.prepare(`INSERT INTO installed_games(id,source,name,version,author,repo_url,zip_fingerprint,install_path,manifest_json,installed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET source=excluded.source,name=excluded.name,version=excluded.version,author=excluded.author,
          repo_url=excluded.repo_url,zip_fingerprint=excluded.zip_fingerprint,install_path=excluded.install_path,
          manifest_json=excluded.manifest_json,updated_at=excluded.updated_at,installed=1`)
        .run(manifest.id, source, manifest.name, manifest.version, manifest.author, repoUrl, zipFingerprint, installPath, JSON.stringify(manifest), now, now);
    },
  };
}
