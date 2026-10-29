// Configuration only: touching a portrait never reaches this service or a model.
import { readTouchLines } from './standingTouchLines.js';
export const INTERACTION_ACTIONS = ['pat', 'stroke', 'poke', 'overstimulated', 'feather', 'plush'];
const SEMANTICS = ['pleased', 'surprised', 'annoyed'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('互动配置包含无效字段');
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('配置版本无效');
  return value;
}
export function defaultStandingInteraction() {
  return { style: 'calm', expressionsEnabled: false, bindings: Object.fromEntries(SEMANTICS.map(k => [k, null])), compatibleSources: [], linesEnabled: false, lines: Object.fromEntries(INTERACTION_ACTIONS.map(k => [k, []])) };
}
export function createStandingInteractionService({ db, imageExists, emit = () => {}, readLines = readTouchLines }) {
  if (!db?.prepare || typeof imageExists !== 'function') throw new TypeError('standing interaction dependencies missing');
  function character(id) {
    if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) fail('角色不存在', 404);
    const row = db.prepare('SELECT id, display_name, is_sleeping FROM characters WHERE id=?').get(Number(id));
    if (!row) fail('角色不存在', 404);
    return row;
  }
  function images(id) {
    return db.prepare(`SELECT s.*, c.emoji_key FROM character_expression_standings s
      LEFT JOIN emoji_categories c ON s.slot_id = 'emoji:' || c.id WHERE s.character_id=?`).all(id)
      .filter(row => row.image_url && imageExists(row.image_url));
  }
  function ref(value, available) {
    if (value === null) return null;
    keys(value, ['slotId', 'imageVersion']);
    if (typeof value.slotId !== 'string') fail('立绘引用无效');
    version(value.imageVersion);
    if (!available.some(row => row.slot_id === value.slotId && row.version === value.imageVersion)) fail('立绘已更新，请重新选择图片', 409);
    return { slotId: value.slotId, imageVersion: value.imageVersion };
  }
  function normalizeConfig(value, available) {
    keys(value, ['style', 'expressionsEnabled', 'bindings', 'compatibleSources', 'linesEnabled', 'lines']);
    if (!['calm', 'lively', 'shy'].includes(value.style) || typeof value.expressionsEnabled !== 'boolean' || typeof value.linesEnabled !== 'boolean') fail('表现设置无效');
    keys(value.bindings, SEMANTICS);
    const bindings = Object.fromEntries(SEMANTICS.map(key => [key, ref(value.bindings[key], available)]));
    if (!Array.isArray(value.compatibleSources) || value.compatibleSources.length > 16) fail('兼容图片数量无效');
    const compatibleSources = value.compatibleSources.map(item => ref(item, available));
    if (compatibleSources.some(item => !item) || new Set(compatibleSources.map(item => item.slotId)).size !== compatibleSources.length) fail('兼容图片重复或无效');
    keys(value.lines, INTERACTION_ACTIONS);
    const lines = Object.fromEntries(INTERACTION_ACTIONS.map(key => {
      const list = value.lines[key];
      if (!Array.isArray(list) || list.length > 3 || list.some(line => typeof line !== 'string' || [...line.trim()].length < 4 || [...line.trim()].length > 24 || /[\r\n]/.test(line))) fail('每个动作最多三句短句，每句 4–24 字');
      return [key, [...new Set(list.map(line => line.trim()))]];
    }));
    return { style: value.style, expressionsEnabled: value.expressionsEnabled, bindings, compatibleSources, linesEnabled: value.linesEnabled, lines };
  }
  function get(id) {
    const char = character(id);
    const row = db.prepare('SELECT * FROM character_standing_interactions WHERE character_id=?').get(char.id);
    const regions = db.prepare('SELECT * FROM standing_interaction_regions WHERE character_id=?').all(char.id);
    return {
      characterId: char.id, name: char.display_name, isSleeping: Boolean(char.is_sleeping), version: row?.version || 0,
      touchLines: readLines(db, char.id),
      config: row ? parse(row.config_json, defaultStandingInteraction()) : defaultStandingInteraction(),
      slots: images(char.id).map(image => {
        const region = regions.find(r => r.slot_id === image.slot_id);
        const draft = region ? parse(region.regions_json, null) : null;
        return { slotId: image.slot_id, name: image.slot_id === 'normal' ? '正常' : image.emoji_key || image.slot_id,
          imageUrl: image.image_url, imageVersion: image.version, bounds: parse(image.bounds_json, null),
          regionVersion: region?.version || 0, regions: region?.image_version === image.version ? draft : null,
          regionDraft: draft, regionsStale: Boolean(draft && region.image_version !== image.version) };
      }),
    };
  }
  function save(id, body) {
    keys(body, ['expectedVersion', 'config']);
    version(body.expectedVersion);
    if (JSON.stringify(body).length > 16384) fail('互动配置过大');
    const result = db.transaction(() => {
      const char = character(id);
      const current = db.prepare('SELECT version FROM character_standing_interactions WHERE character_id=?').get(char.id);
      if ((current?.version || 0) !== body.expectedVersion) fail('设置已在其他窗口修改，请重新读取', 409);
      const config = normalizeConfig(body.config, images(char.id));
      db.prepare(`INSERT INTO character_standing_interactions(character_id,config_json,version) VALUES(?,?,1)
        ON CONFLICT(character_id) DO UPDATE SET config_json=excluded.config_json,version=version+1,updated_at=CURRENT_TIMESTAMP`).run(char.id, JSON.stringify(config));
      return get(char.id);
    })();
    emit('expression_standings_updated', { characterId: Number(id), scope: 'interaction', version: result.version });
    return result;
  }
  function saveRegions(id, slotId, body) {
    keys(body, ['expectedVersion', 'expectedImageVersion', 'regions']);
    version(body.expectedVersion); version(body.expectedImageVersion);
    const result = db.transaction(() => {
      const char = character(id);
      const image = images(char.id).find(row => row.slot_id === slotId);
      if (!image) fail('立绘不存在', 404);
      if (image.version !== body.expectedImageVersion) fail('立绘已更新，请重新标记', 409);
      const previous = db.prepare('SELECT version FROM standing_interaction_regions WHERE character_id=? AND slot_id=?').get(char.id, slotId);
      if ((previous?.version || 0) !== body.expectedVersion) fail('触碰位置已在其他窗口修改，请重新读取', 409);
      const bounds = parse(image.bounds_json, null);
      if (body.regions !== null) {
        keys(body.regions, ['head', 'cheek']);
        if (!bounds?.imageWidth || !bounds?.imageHeight || !body.regions.head && !body.regions.cheek) fail('请至少标记一个有效区域');
        for (const key of ['head', 'cheek']) {
          const ellipse = body.regions[key];
          if (ellipse === null) continue;
          keys(ellipse, ['cx', 'cy', 'rx', 'ry']);
          if (['cx', 'cy', 'rx', 'ry'].some(k => typeof ellipse[k] !== 'number' || !Number.isFinite(ellipse[k]))) fail('触碰位置无效');
          const { cx, cy, rx, ry } = ellipse;
          if (rx <= 0 || ry <= 0 || cx - rx < 0 || cx + rx > 1 || cy - ry < 0 || cy + ry > 1) fail('触碰区域超出图片');
          if (cx * bounds.imageWidth < bounds.x || cx * bounds.imageWidth > bounds.x + bounds.width || cy * bounds.imageHeight < bounds.y || cy * bounds.imageHeight > bounds.y + bounds.height) fail('触碰位置应位于人物范围内');
        }
      }
      db.prepare(`INSERT INTO standing_interaction_regions(character_id,slot_id,image_version,regions_json,version) VALUES(?,?,?,?,1)
        ON CONFLICT(character_id,slot_id) DO UPDATE SET image_version=excluded.image_version,regions_json=excluded.regions_json,version=version+1,updated_at=CURRENT_TIMESTAMP`).run(char.id, slotId, image.version, JSON.stringify(body.regions));
      return get(char.id);
    })();
    emit('expression_standings_updated', { characterId: Number(id), scope: 'interaction', slotId });
    return result;
  }
  return { get, save, saveRegions };
}
