import { getDb } from '../db/index.js';
import { matchAll } from './characterSearch.js';
import { buildCharacterPersona, buildImageCrossRefInfo } from './characterPersona.js';
import { charArtistOverrideWithFallback } from './characterImageOpts.js';

/** 新日程以ID为准；旧日程复用画风测试的姓名检测，不扫描角色人格和关系全文。 */
export function resolveScheduleParticipants(characterId, activity, { db = getDb(), detect = matchAll } = {}) {
  if (!activity) return [];
  const explicit = Array.isArray(activity.participantIds);
  const ids = explicit ? activity.participantIds : detect([activity.activity, activity.location, activity.description].filter(Boolean).join('\n'), Number(characterId)).map(c => c.id);
  return [...new Set(ids.map(Number))].filter(id => Number.isSafeInteger(id) && id !== Number(characterId))
    .map(id => db.prepare("SELECT * FROM characters WHERE id=? AND name!='default'").get(id)).filter(Boolean);
}

export function scheduleMomentCompanions(characterId, activity, options = {}) {
  const db = options.db || getDb();
  return resolveScheduleParticipants(characterId, activity, { ...options, db }).map(other => {
    const outgoing = db.prepare('SELECT relationship_text FROM character_relationships WHERE from_character_id=? AND to_character_id=?').get(characterId, other.id)?.relationship_text;
    const incoming = db.prepare('SELECT relationship_text FROM character_relationships WHERE from_character_id=? AND to_character_id=?').get(other.id, characterId)?.relationship_text;
    return { otherId: other.id, otherName: other.display_name,
      otherPersona: buildCharacterPersona(other, { variant: 'short', person: other.display_name }),
      relDesc: [outgoing && `你对${other.display_name}的关系：${outgoing}`, incoming && `${other.display_name}对你的关系：${incoming}`].filter(Boolean).join('；') || `${other.display_name}正在与你共同活动` };
  });
}

export function parseCharacterLoras(value) {
  try { const data = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(data) ? data.filter(l => l && typeof l === 'object') : []; }
  catch { return []; }
}

export function scheduleImageContext(character, activity, options = {}) {
  const others = resolveScheduleParticipants(character.id, activity, options);
  const loras = [...new Map([character, ...others].flatMap(c => parseCharacterLoras(c.loras)).map(l => [l.name || l.filename || JSON.stringify(l), l])).values()];
  const artist = charArtistOverrideWithFallback(character, others);
  return {
    others, participantIds: [Number(character.id), ...others.map(c => c.id)],
    crossReference: others.length ? `【此刻实际在场的同行者】\n${others.map(c => `[${c.display_name}]\n${buildImageCrossRefInfo(c)}`).join('\n\n')}\n画面包含主角与以上同行者，分别描述每个人的外观与动作，人数准确。` : '',
    imageOptions: { ...(loras.length ? { loras } : {}), ...(artist !== null ? { artist } : {}),
      ...(others.length ? { customWorkflow: null } : character.custom_workflow ? { customWorkflow: character.custom_workflow } : {}) },
  };
}
