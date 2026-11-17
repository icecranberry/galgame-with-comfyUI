import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';
import { broadcast } from './unifiedStreamBus.js';
import { createStandingDisplay } from './standingDisplayState.js';
import { imageUrlExists } from './imagePaths.js';
import { withCharacterStandingStates } from './characterStandingDisplay.js';

let display;
export function getStandingDisplay() {
  if (display) return display;
  const db = getDb();
  const options = {
    epoch: randomUUID(),
    initialCharacter: db.prepare('SELECT character_id FROM standing_display_selection WHERE id=1').get()?.character_id || null,
    persist: id => db.prepare('INSERT INTO standing_display_selection(id,character_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET character_id=excluded.character_id').run(id),
    emit: state => broadcast('standing_display_state', state),
    resolveImage: (id, slot) => {
      const row = db.prepare(`SELECT slot_id,version,image_url,bounds_json FROM expression_standings WHERE character_id=? AND slot_id IN (?, 'normal') AND image_url IS NOT NULL ORDER BY CASE WHEN slot_id=? THEN 0 ELSE 1 END`).all(id, slot, slot).find(r => imageUrlExists(r.image_url));
      if (row) return { ...row, bounds: JSON.parse(row.bounds_json || 'null') };
      const slots = ['normal', ...db.prepare('SELECT id FROM emoji_categories').all().map(r => `emoji:${r.id}`)];
      const available = new Set(db.prepare('SELECT slot_id,image_url FROM expression_standings WHERE character_id=? AND image_url IS NOT NULL').all(id).filter(r => imageUrlExists(r.image_url)).map(r => r.slot_id));
      return { missingCount: slots.filter(key => !available.has(key)).length };
    },
  };
  display = withCharacterStandingStates(createStandingDisplay(options), {
    epoch: options.epoch,
    resolveImage: options.resolveImage,
    emit: state => broadcast('character_standing_state', state),
  });
  return display;
}

export function publishStandingKeys(turn, keys) {
  if (!keys?.length) return;
  const lookup = getDb().prepare('SELECT id FROM emoji_categories WHERE emoji_key=?');
  for (const key of keys) {
    const category = lookup.get(key);
    if (category) getStandingDisplay().expression(turn, `emoji:${category.id}`);
  }
}
