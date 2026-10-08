/**
 * characterStanding.js — 四套场景立绘（工装 / 私服 / 居家 / 睡衣）
 *
 * ── 解决什么问题 ──
 *
 * 角色原本只有一张立绘（characters.standing_url）。做完「场景服装」之后，角色在不同场合
 * 穿不同衣服，但形象面板只能看到那一张 —— 本模块让每个角色在四个场景下各有一张立绘，
 * 详情页可以左右切换查看。
 *
 * ── 三条数据的关系（别搞混）──
 *
 *   characters.standing_url      角色「默认形象」。全库各处（聊天 / 朋友圈 / 群聊 / 小镇）引用它，
 *                                本模块**不写它**，只在读 work 槽时拿它兜底。
 *   character_outfits(scene)     场景服装的**文字描述**，驱动生图。本模块出图时读它当穿着。
 *   character_standings(scene)   场景立绘的**图片**。本模块独占。
 *
 * ── 兜底规则 ──
 *
 * work（工装）槽没图时回落到 characters.standing_url —— 于是「用户已有的那张立绘」
 * 天然就是工装形象，切换过去不会是空白，用户不会觉得立绘凭空消失。
 */

import { getDb } from '../db/index.js';
import { OUTFIT_SCENES } from './outfitScene.js';

const SCENE_KEYS = OUTFIT_SCENES.map(s => s.key);
const LABEL_BY_KEY = Object.fromEntries(OUTFIT_SCENES.map(s => [s.key, s.label]));

/**
 * 该角色的四套场景立绘（四行始终齐全、顺序固定）。
 * work 槽用 characters.standing_url 兜底；is_fallback 标记该行的图其实是兜底来的
 * （「删除」时应清空 work 槽的显式记录，而不是去删那张默认立绘 —— 见路由层）。
 * @returns {Array<{scene, sceneLabel, image_url, prompt_text, is_fallback}>}
 */
export function listSceneStandings(characterId) {
  if (!characterId) return [];
  const db = getDb();
  const rows = db
    .prepare('SELECT scene, image_url, prompt_text FROM character_standings WHERE character_id = ?')
    .all(characterId);
  const byScene = new Map(rows.map(r => [r.scene, r]));
  const char = db.prepare('SELECT standing_url FROM characters WHERE id = ?').get(characterId);
  const fallback = String(char?.standing_url || '') || null;

  return OUTFIT_SCENES.map(s => {
    const hit = byScene.get(s.key);
    const explicit = String(hit?.image_url || '') || null;
    const useFallback = !explicit && s.key === 'work' && !!fallback;
    return {
      scene: s.key,
      sceneLabel: s.label,
      image_url: explicit || (useFallback ? fallback : null),
      prompt_text: hit?.prompt_text || '',
      is_fallback: useFallback,
    };
  });
}

/** 取某场景立绘的**原始行**（不含兜底），路由层据此决定要不要删旧文件 */
export function getSceneStandingRow(characterId, scene) {
  if (!characterId || !SCENE_KEYS.includes(scene)) return null;
  return getDb()
    .prepare('SELECT * FROM character_standings WHERE character_id = ? AND scene = ?')
    .get(characterId, scene) || null;
}

/** 写一套场景立绘（同场景覆盖）。imageUrl 传空表示清空该槽（保留行，便于记 prompt） */
export function upsertSceneStanding(characterId, scene, { imageUrl, promptText } = {}) {
  if (!characterId || !SCENE_KEYS.includes(scene)) return null;
  getDb()
    .prepare(
      `INSERT INTO character_standings (character_id, scene, image_url, prompt_text, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(character_id, scene)
       DO UPDATE SET image_url = excluded.image_url,
                     prompt_text = excluded.prompt_text,
                     updated_at = CURRENT_TIMESTAMP`
    )
    .run(characterId, scene, imageUrl || null, promptText || null);
  return listSceneStandings(characterId).find(s => s.scene === scene) || null;
}

/** 删掉某场景立绘那一行（文件由调用方负责删） */
export function deleteSceneStanding(characterId, scene) {
  if (!characterId || !SCENE_KEYS.includes(scene)) return false;
  const r = getDb()
    .prepare('DELETE FROM character_standings WHERE character_id = ? AND scene = ?')
    .run(characterId, scene);
  return r.changes > 0;
}

export { SCENE_KEYS as STANDING_SCENE_KEYS, LABEL_BY_KEY as STANDING_SCENE_LABELS };
