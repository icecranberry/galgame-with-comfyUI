import { OUTFIT_SCENES } from '../outfitScene.js';
import { splitAppearanceSection } from '../characterPersona.js';

export { OUTFIT_SCENES };
const parse = text => { try { const value = JSON.parse(text); return Array.isArray(value) ? value : []; } catch { return []; } };
const bad = text => Object.assign(new Error(text), { status: 400 });
export const validAngelScene = scene => OUTFIT_SCENES.some(item => item.key === scene);

export function angelBaseAppearance(persona = '') {
  persona = String(persona || '');
  const { before, after } = splitAppearanceSection(persona);
  if (before.length > persona.length) return '';
  const section = persona.slice(before.length, after ? -after.length : undefined);
  return section.slice(section.indexOf('\n') + 1).trim();
}

export function angelOutfits(angel) {
  const stored = parse(angel.scene_outfits_json);
  return OUTFIT_SCENES.map(scene => {
    const row = stored.find(outfit => outfit.scene === scene.key);
    return { scene: scene.key, sceneLabel: scene.label, defaultName: scene.defaultName,
      name: row?.name || scene.defaultName,
      description: scene.key === 'work' ? angelBaseAppearance(angel.persona) : row?.description || '' };
  });
}
export function angelStandings(angel) {
  const stored = parse(angel.scene_standings_json);
  return OUTFIT_SCENES.map(scene => ({ scene: scene.key, sceneLabel: scene.label,
    image_url: stored.find(row => row.scene === scene.key)?.image_url || (scene.key === 'work' ? angel.standing_url : null),
    prompt_text: stored.find(row => row.scene === scene.key)?.prompt_text || '' }));
}
export function cleanAngelOutfits(value) {
  if (!Array.isArray(value) || value.length > 4) throw bad('服装必须为最多四套的数组');
  const seen = new Set();
  return value.map(outfit => {
    if (!outfit || !validAngelScene(outfit.scene) || seen.has(outfit.scene) || typeof outfit.description !== 'string'
      || outfit.description.length > 30000 || (outfit.name != null && (typeof outfit.name !== 'string' || outfit.name.length > 60))) throw bad('服装场景、名称或描述无效');
    seen.add(outfit.scene);
    return { scene: outfit.scene, name: outfit.name?.trim() || OUTFIT_SCENES.find(scene => scene.key === outfit.scene).defaultName, description: outfit.description.trim() };
  });
}
// 独立的系统角色衣柜不会用单例 id=1 去读取普通角色的服装。
export function selectAngelOutfit(angel, request = {}) {
  const outfits = angelOutfits(angel);
  if (!request.activity) return outfits.find(outfit => outfit.scene === (request.scene || 'work'));
  const index = request.activity_index ?? 0;
  if (Number(request.activity.replyDelay) === -1) return outfits.find(outfit => outfit.scene === 'sleep' && outfit.description) || outfits[0];
  const activities = angel.schedule || [];
  for (let step = 0; step < activities.length; step++) {
    const activity = step === 0 ? request.activity : activities[(index - step + activities.length) % activities.length];
    if (step > 0 && Number(activity?.replyDelay) === -1) break;
    const label = activity?.outfit;
    if (!label) continue;
    const found = outfits.find(outfit => outfit.description && [outfit.name, outfit.scene, outfit.defaultName].includes(String(label).trim()));
    if (found) return found.scene === 'sleep' ? outfits[0] : found;
  }
  return outfits[0];
}

export function writeAngelStanding(db, scene, imageUrl, prompt = '') {
  if (!validAngelScene(scene)) throw bad('服装场景无效');
  const angel = db.prepare('SELECT * FROM god_angel WHERE id=1').get();
  const rows = parse(angel.scene_standings_json).filter(row => row.scene !== scene);
  if (imageUrl) rows.push({ scene, image_url: imageUrl, prompt_text: prompt });
  db.prepare('UPDATE god_angel SET scene_standings_json=? WHERE id=1').run(JSON.stringify(rows));
  if (scene === 'work') db.prepare('UPDATE god_angel SET standing_url=? WHERE id=1').run(imageUrl);
}
