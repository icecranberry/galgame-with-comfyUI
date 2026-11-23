import { getUserConfig } from '../config.js';
import { availableStandingImages, playerStandingImages, standingSlots } from '../services/expressionStandingAssets.js';
import { imageUrlExists } from '../services/imagePaths.js';
import { listNamedGameCharacters } from './gameBridge.js';

export function getTrpgPlayer() {
  const { nickname, gender, appearance, persona } = getUserConfig();
  const avatar = '/avatars/user_avatar.png';
  return { name: String(nickname || '').trim() || '我', gender, appearance, persona, avatar: imageUrlExists(avatar) ? avatar : null };
}

export function getTrpgCast(db) {
  const slots = standingSlots(db);
  const byCharacter = new Map();
  for (const row of db.prepare(`SELECT character_id, slot_id, image_url FROM expression_standings
    WHERE character_id IS NOT NULL AND image_url IS NOT NULL AND image_url != ''`).all()) {
    if (!byCharacter.has(row.character_id)) byCharacter.set(row.character_id, []);
    byCharacter.get(row.character_id).push(row);
  }
  const { name, avatar } = getTrpgPlayer();
  return {
    slots,
    player: { name, avatar, expressions: playerStandingImages(db, slots) },
    characters: Object.fromEntries(listNamedGameCharacters(db).filter(({ id }) => byCharacter.has(id))
      .map(({ id, name }) => [name, availableStandingImages(byCharacter.get(id), slots)])),
  };
}
