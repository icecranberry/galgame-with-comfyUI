import { getDb } from '../../db/index.js';
import { buildImageCrossRefInfo, extractEditableAppearanceBody } from '../characterPersona.js';

// 天使的唯一资料源是 god_angel；不创建酒馆居民，也不借用普通角色的数字编号、服装或 LoRA。
// 显式空名单用于“仅被提及但不入镜”；未传名单时兼容实验室的自然语言描述。
export function resolveAngelImageReference(description, specialCharacters, db) {
  if (specialCharacters !== undefined) {
    if (!Array.isArray(specialCharacters) || specialCharacters.length > 1
      || specialCharacters.some(value => value !== 'angel')) {
      throw new Error('special_characters 必须是 [] 或 ["angel"]');
    }
    if (specialCharacters.length === 0) return null;
    if (typeof description !== 'string' || !description.trim()) {
      throw new Error('指定天使入镜时必须提供 sceneDesc 画面描述');
    }
  }
  if (typeof description !== 'string' || !description.trim()) return null;
  const angel = (db || getDb()).prepare('SELECT display_name, persona FROM god_angel WHERE id = 1').get();
  const name = angel?.display_name?.trim() || '天使';
  const mentioned = description.includes('天使') || (name.length >= 2 && description.toLowerCase().includes(name.toLowerCase()));
  if (specialCharacters === undefined && !mentioned) return null;
  const appearance = extractEditableAppearanceBody(angel?.persona);
  if (!appearance) {
    throw new Error('天使尚未设置外观，请先在神说中完善天使外观再生成图片');
  }
  const info = buildImageCrossRefInfo({ id: 'god:angel', display_name: name,
    base_prompt: `你是神说中的天使「${name}」。\n## 你的外观\n${appearance}` }, { outfits: null });
  return { id: 'god:angel', display_name: name,
    text: `[${name === '天使' ? name : `天使（${name}）`}]\n${info}` };
}
