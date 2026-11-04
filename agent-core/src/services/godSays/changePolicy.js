import { extractEditableAppearanceBody, replaceAppearanceSection } from '../characterPersona.js';
import { validateReplacement } from './replacementPrompt.js';
import { parseSceneOutfitDesign } from '../sceneOutfitPrompt.js';
// Explicit business policy: routine gameplay and generated media are not persistent configuration edits.
export const CONFIRMED_TOOLS = new Set([
  'update_character', 'apply_character_appearance', 'generate_scene_outfits', 'create_outfit', 'set_outfit_enabled', 'recruit_character',
  'rewrite_world_setting', 'create_world_setting', 'update_world_setting', 'activate_world_setting',
  'create_relationship', 'update_relationship', 'create_group', 'update_group', 'add_group_members',
  'create_moment_topic', 'create_event_type', 'create_media_outlet', 'create_media_board',
  'create_emoji_set', 'set_emoji_set_enabled',
]);
export function createChangePolicy(db, api, generateReplacement) {
  function snapshot({ name, args: a }) {
    const row = (table, id) => {
      const value = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
      if (!value) throw new Error('目标已不存在');
      return value;
    };
    const char = id => {
      const c = row('characters', id);
      return { id: c.id, name: c.name, display_name: c.display_name, base_prompt: c.base_prompt };
    };
    if (name === 'update_character' || name === 'apply_character_appearance' || name === 'create_outfit' || name === 'create_emoji_set') return char(a.character_id);
    if (name === 'generate_scene_outfits') return {
      character: { ...char(a.character_id), short_prompt: row('characters', a.character_id).short_prompt || '' },
      outfits: db.prepare('SELECT id,scene,name,description FROM character_outfits WHERE character_id=? ORDER BY id').all(a.character_id).filter(outfit => a.scenes.includes(outfit.scene)),
    };
    if (name === 'set_outfit_enabled') return { character: char(a.character_id), outfits: db.prepare('SELECT * FROM character_outfits WHERE character_id=? ORDER BY id').all(a.character_id) };
    if (name === 'update_world_setting' || name === 'rewrite_world_setting') return row('world_settings', a.world_id);
    if (name === 'activate_world_setting') return { target: row('world_settings', a.world_id), active: db.prepare('SELECT id FROM world_settings WHERE is_active=1 ORDER BY id').all() };
    if (name === 'update_relationship') return row('character_relationships', a.relationship_id);
    if (name === 'create_relationship') return { from: char(a.from_character_id), to: char(a.to_character_id) };
    if (name === 'create_group') return a.member_ids.map(char);
    if (name === 'update_group' || name === 'add_group_members') return { group: row('group_chats', a.group_id), members: db.prepare('SELECT character_id FROM group_members WHERE group_id=? ORDER BY character_id').all(a.group_id) };
    if (name === 'create_media_board') return row('media_outlets', a.outlet_id);
    if (name === 'set_emoji_set_enabled') return row('emoji_sets', a.set_id);
    return null;
  }
  async function prepare(operation, signal, before) {
    if (operation.name === 'generate_scene_outfits') {
      const { character, outfits: previous } = before;
      const baseAppearance = extractEditableAppearanceBody(character.base_prompt);
      if (!baseAppearance?.trim()) throw new Error('没有找到默认外观，请先补全角色“你的外观”');
      const response = await api({ method: 'POST', path: `/api/characters/${character.id}/outfits/generate`,
        body: { scenes: operation.args.scenes, instruction: operation.args.instruction, baseAppearance, save: false, generateImages: false } }, { signal });
      if (response.data?._truncated) throw new Error('服装草稿不完整，请重新生成');
      const outfits = parseSceneOutfitDesign(JSON.stringify(response.data), operation.args.scenes);
      const labels = { casual: '私服', home: '居家服', sleep: '睡衣' };
      return { ...operation, label: character.display_name || character.name,
        preview: outfits.flatMap(outfit => {
          const old = previous.find(item => item.scene === outfit.scene);
          return [
            { label: `${labels[outfit.scene]}名称`, before: old?.name ?? '', after: outfit.name },
            { label: `${labels[outfit.scene]}完整外观`, before: old?.description ?? '', after: outfit.description },
          ];
        }),
        replacement: { method: 'PUT', path: `/api/characters/${character.id}/outfits/scene`, body: { outfits } },
      };
    }
    if (operation.name === 'apply_character_appearance' || operation.name === 'rewrite_world_setting') {
      if (!generateReplacement) throw new Error('替换草稿生成器尚未连接');
      const appearance = operation.name === 'apply_character_appearance';
      const source = appearance ? extractEditableAppearanceBody(before.base_prompt) : before.content;
      if (!source?.trim()) throw new Error(appearance ? '没有找到可修改的“你的外观”正文，请先补全角色外观' : '世界观原文为空');
      const kind = appearance ? 'appearance' : 'world';
      const next = validateReplacement(await generateReplacement({ kind, source, instruction: operation.args.instruction,
        ...(appearance ? { character: before } : {}) }, signal), kind);
      const body = appearance ? { base_prompt: replaceAppearanceSection(before.base_prompt, next) } : { name: before.name, content: next };
      return { ...operation, label: before.display_name || before.name,
        preview: [{ label: appearance ? '你的外观' : '世界观正文', before: source, after: next }],
        replacement: { method: 'PUT', path: appearance ? `/api/characters/${before.id}` : `/api/config/world-settings/${before.id}`, body } };
    }
    if (operation.name === 'update_world_setting') return { ...operation,
      preview: [{ label: '世界观名称', before: before.name, after: operation.args.name }, { label: '世界观正文', before: before.content, after: operation.args.content }] };
    if (operation.name === 'update_character') return { ...operation,
      preview: [{ label: '角色完整资料', before: before.base_prompt, after: operation.args.base_prompt }] };
    if (operation.name !== 'recruit_character') return operation;
    const response = await api({ method: 'POST', path: '/api/characters/generate', body: { description: operation.args.description, save: false } }, { signal });
    const { name, display_name, base_prompt, emotion_baseline } = response.data;
    if (!name || !base_prompt || response.data._truncated) throw new Error('角色候选资料不完整，未创建角色');
    return { ...operation, args: { name, display_name, base_prompt, emotion_baseline } };
  }
  return { snapshot, prepare };
}
