/**
 * 素材「原始需求快照」的组装。
 *
 * 角色类素材（立绘 / 像素小人）的 meta 里只留了不透明的 appearanceSource 指针
 * （townAppearanceSignature 的口径：外观正文不落库），meta.desc 则是生成当时那一份，
 * 可能已经退化成整卡 / 人格卡全文（角色卡缺标准外观段时的兜底口径）。
 * 所以重写提示词时重新调生成端的包装函数取「short_prompt + 外观段」：
 * 角色卡缺外观段时先按需补全（characterAppearanceService），取不到再回落 meta.desc。
 */
import { getDb } from '../../db/index.js';
import { buildCharacterPersona } from '../characterPersona.js';
import { ensureCharacterAppearanceSection } from '../characterAppearanceService.js';

function isValidAppearanceSource(source) {
  return !!source && source.version === 1
    && ['character', 'npc'].includes(source.sourceKind)
    && Number.isSafeInteger(source.sourceId) && source.sourceId > 0;
}

/**
 * 素材行没有落 appearanceSource 时按可追溯的关联推断来源。
 * 典型场景：复用关联居民立绘登记进来的角色立绘（registerAssetFromUrl，图不是生成出来的，
 * 没有生成证据所以不落 appearanceSource），但 meta.characterId 或 key 前缀仍然指向角色卡。
 */
function inferAppearanceSource(asset) {
  const meta = asset?.meta || {};
  const mode = asset?.kind === 'portrait' ? 'portrait' : 'sprite';
  const characterId = Number(meta.characterId);
  if (Number.isSafeInteger(characterId) && characterId > 0) {
    return { version: 1, sourceKind: 'character', sourceId: characterId, characterId, mode };
  }
  const npcId = Number(meta.npcId);
  if (Number.isSafeInteger(npcId) && npcId > 0) {
    return { version: 1, sourceKind: 'npc', sourceId: npcId, characterId: null, mode };
  }
  const key = String(asset?.key || '');
  const charMatch = /^char_(\d+)_/.exec(key);
  if (charMatch) {
    const id = Number(charMatch[1]);
    return { version: 1, sourceKind: 'character', sourceId: id, characterId: id, mode };
  }
  const npcMatch = /^npc_(\d+)_/.exec(key);
  if (npcMatch) {
    const id = Number(npcMatch[1]);
    return { version: 1, sourceKind: 'npc', sourceId: id, characterId: null, mode };
  }
  return null;
}

/** 素材的外观来源：优先落库的 appearanceSource，其次按关联推断 */
function resolveAppearanceSource(asset) {
  const meta = asset?.meta || {};
  if (isValidAppearanceSource(meta.appearanceSource)) return meta.appearanceSource;
  return inferAppearanceSource(asset);
}

/** 去掉人格卡带过来的 markdown 标题（「## 你的外观」/「## 琪亚娜的外观」），只留正文 */
function stripAppearanceHeading(text) {
  return String(text || '')
    .replace(/^#{1,6}[ \t]*\S*外观[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 取角色卡的「short_prompt + 外观段」；角色卡不存在时返回 '' */
function characterRequestDesc(character, person) {
  if (!character) return '';
  return stripAppearanceHeading(buildCharacterPersona(character, {
    variant: 'short',
    person: person || character.display_name || character.name,
    outfits: 'auto',
  }));
}

/** 读角色卡；没有标准外观段时先按需补全（LLM 只跑一次，结果写回角色卡） */
async function loadCharacterWithAppearance(characterId) {
  try {
    await ensureCharacterAppearanceSection(characterId);
  } catch (err) {
    console.warn('[townAssetRequest] 外观段补全失败，按现有角色卡取需求:', err?.message);
  }
  return getDb().prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
}

/**
 * 角色类素材：实时取「short_prompt + 外观段」；来源缺失或档案已删时返回 ''。
 * @param {object} asset - 素材行（含 kind / key / meta）
 */
export async function buildCharacterRequestDesc(asset) {
  const source = resolveAppearanceSource(asset);
  if (!source) return '';
  const db = getDb();
  if (source.sourceKind === 'character') {
    return characterRequestDesc(await loadCharacterWithAppearance(source.sourceId));
  }
  const npc = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(source.sourceId);
  if (!npc) return '';
  // 关联了酒馆角色就优先用角色卡的 short_prompt + 外观段，否则退回居民人格卡
  if (npc.character_id) {
    const fromCard = characterRequestDesc(await loadCharacterWithAppearance(npc.character_id), npc.display_name);
    if (fromCard) return fromCard;
  }
  return stripAppearanceHeading(buildCharacterPersona({ base_prompt: npc.persona || '' }, {
    variant: 'short',
    person: npc.display_name,
    outfits: null,
  }));
}

/** 组装改写 / 重写用的原始需求快照：角色类素材的 desc 实时重取，其余沿用 meta */
export async function buildAssetRequestSnapshot(asset) {
  const meta = asset?.meta || {};
  return {
    desc: (await buildCharacterRequestDesc(asset)) || String(meta.desc || ''),
    styleTags: meta.styleTags,
    direction: meta.direction,
    footprint: meta.footprint,
    special: meta.special,
  };
}