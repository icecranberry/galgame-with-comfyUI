/**
 * 角色生图人格统一组装入口
 *
 * 全库所有「角色 base_prompt / short_prompt + ## 你的外观」的生图人格拼接统一走这里，
 * 便于管理外观注入口径（此前各模块内联实现，正则锚点/截断边界/人称替换互不一致）。
 *
 * 两种 variant 对应历史两大拼接口径：
 *   - 'short'（默认）：short_prompt + 「## 你的外观」段到末尾。多角色参考/群聊资料卡/梦境等用。
 *   - 'full'：整卡 base_prompt（缺失时回退 short_prompt）。needImage 配图/日程拍照/事件/礼物/信件等用。
 *
 * 外观注入（角色外观系统）：当角色存在生效中的限时服饰（通用，可多套叠加）或
 * 角色专属形态（同时至多一套）时，注入块安插在「## 你的外观」标题之后、
 * 原外观正文之前，并附着装优先级说明：限时服饰 > 角色专属形态 > 基础外观，
 * 未提及的部位由基础外观填补。无特殊外观时输出与旧逻辑一致。
 */

import { getActiveOutfits } from './outfitService.js';

const APPEARANCE_HEADING_RE = /##\s*你的外观/;

/**
 * 提取「## 你的外观」段（含标题，截到字符串末尾）。
 * 角色卡标准结构中外观是最后一段（见 routes/characters.js buildPersonaSystemPrompt），
 * 因此「到末尾」与「到下一个 ##」等价。
 * @param {string} basePrompt
 * @returns {string} 无该标题时返回 ''
 */
export function extractAppearanceSection(basePrompt) {
  const base = String(basePrompt || '');
  const m = base.match(APPEARANCE_HEADING_RE);
  return m ? base.slice(m.index) : '';
}

/**
 * 由生效外观生成注入文本块（纯函数，便于测试）。
 * 着装优先级说明按生效组合分三种（两者都有 / 只有限时 / 只有专属）；无任何生效外观时整段不生成。
 * @param {{limited?: Array<{name,description}>, exclusive?: {name,description}|null}} outfits
 * @returns {string} 无任何生效外观时返回 ''
 */
export function buildOutfitInjectionBlocks(outfits) {
  const limited = Array.isArray(outfits?.limited) ? outfits.limited : [];
  const exclusive = outfits?.exclusive || null;
  if (limited.length === 0 && !exclusive) return '';

  const blocks = [];
  if (limited.length > 0) {
    const lines = limited.map((o, i) => `${i + 1}. ${o.name}：${o.description}`);
    blocks.push(`【限时服饰（当前生效，优先级最高，多套同时叠加）】\n${lines.join('\n')}`);
  }
  if (exclusive) {
    // 只有专属形态时没有更高优先级，标注为最高
    const rank = limited.length > 0 ? '优先级次之' : '优先级最高';
    blocks.push(`【角色专属形态（当前生效，${rank}）】\n1. ${exclusive.name}：${exclusive.description}`);
  }

  // 着装优先级说明按生效外观组合三选一：两者都有 / 只有限时 / 只有专属（都无时本函数返回 ''，整段不注入）
  const fallbackRule = '未提及的部位（发型、瞳色、五官、体型等）沿用基础外观，冲突描述一律以特殊外观为准。';
  let priorityNote;
  if (limited.length > 0 && exclusive) {
    priorityNote = `着装优先级：限时服饰 > 角色专属形态 > 基础外观。形象必须首先满足限时服饰，其次满足角色专属形态；两者${fallbackRule}`;
  } else if (limited.length > 0) {
    priorityNote = `着装优先级：限时服饰 > 基础外观。形象必须首先满足限时服饰；限时服饰${fallbackRule}`;
  } else {
    priorityNote = `着装优先级：角色专属形态 > 基础外观。形象必须首先满足角色专属形态；角色专属形态${fallbackRule}`;
  }
  return [...blocks, priorityNote].join('\n\n');
}

/**
 * 把注入块安插进外观段：标题行之后、原正文之前；正文包进「基础外观」标注。
 * 原文没有外观段时补一个「## 你的外观」段。
 * @param {string} appearance extractAppearanceSection 的返回值（可为 ''）
 * @param {string} blocks buildOutfitInjectionBlocks 的返回值（'' 时不做任何事）
 * @returns {string}
 */
export function injectOutfitsIntoAppearance(appearance, blocks) {
  if (!blocks) return appearance;
  if (!appearance.trim()) return `## 你的外观\n${blocks}`;
  const headingEnd = appearance.indexOf('\n');
  if (headingEnd === -1) return `${appearance}\n${blocks}`;
  const heading = appearance.slice(0, headingEnd);
  const body = appearance.slice(headingEnd + 1);
  if (!body.trim()) return `${heading}\n${blocks}`;
  return `${heading}\n${blocks}\n\n【基础外观（仅用于填补以上未提及的部位）】\n${body}`;
}

/**
 * 组装角色完整外观段（含标题「## 你的外观」与生效外观注入）。
 * 供需要单独拿外观段的场景使用（如表情包 system3，自行决定是否保留标题行）。
 * @param {object} character - 至少含 base_prompt（注入查询需要 id）
 * @param {object} [opts] - 同 buildCharacterPersona 的 opts.outfits
 * @returns {string} base_prompt 无外观段且无生效外观时返回 ''
 */
export function buildCharacterAppearanceSection(character, opts = {}) {
  const outfits = resolveOutfits(character, opts.outfits);
  const appearance = extractAppearanceSection(character?.base_prompt);
  return injectOutfitsIntoAppearance(appearance, buildOutfitInjectionBlocks(outfits));
}

function resolveOutfits(character, outfits) {
  if (outfits === null) return { limited: [], exclusive: null };
  if (outfits && typeof outfits === 'object') {
    if (Array.isArray(outfits)) return { limited: outfits, exclusive: null };
    return outfits;
  }
  return getActiveOutfits(character?.id);
}

/**
 * ★ 统一入口：组装角色生图人格。
 *
 * @param {object} character - characters 表行（至少含 base_prompt；short variant 还需要 short_prompt 与 id）
 * @param {object} [opts]
 * @param {'short'|'full'} [opts.variant='short'] - 'short' = short_prompt + 外观段（皆空时兜底整卡）；
 *                                                  'full' = 整卡 base_prompt（缺失回退 short_prompt）
 * @param {string|null} [opts.person=null] - 把该部分文本中的「你」替换为它（如 display_name、'角色'）。
 *                                           short variant 只替换外观段（short_prompt 本就是第三人称）；full variant 替换整卡。
 * @param {'auto'|null|Array|{limited,exclusive}} [opts.outfits='auto'] - 外观来源：
 *                                           'auto'/缺省 = 按 character.id 查询生效外观并注入；
 *                                           null = 不注入；数组 = 视作多套限时服饰；对象 = 显式 {limited, exclusive}
 * @param {string} [opts.joiner='\n'] - short variant 中 short_prompt 与外观段的连接符
 * @returns {string}
 */
export function buildCharacterPersona(character, opts = {}) {
  const variant = opts.variant || 'short';
  const person = typeof opts.person === 'string' ? opts.person : null;
  const joiner = typeof opts.joiner === 'string' ? opts.joiner : '\n';
  const outfits = resolveOutfits(character, opts.outfits);

  if (variant === 'full') {
    const base = String(character?.base_prompt || character?.short_prompt || '');
    const appearance = extractAppearanceSection(base);
    const injected = injectOutfitsIntoAppearance(appearance, buildOutfitInjectionBlocks(outfits));
    let result;
    if (appearance) {
      result = base.slice(0, base.length - appearance.length) + injected;
    } else if (injected) {
      result = `${base.trimEnd()}\n\n${injected}`;
    } else {
      result = base;
    }
    return person ? result.replace(/你/g, person) : result;
  }

  // short variant
  const basePrompt = String(character?.base_prompt || '');
  const short = String(character?.short_prompt || '').trim();
  const appearance = extractAppearanceSection(basePrompt);
  if (!short && !appearance) {
    // short_prompt 与外观段皆空：兜底整卡（与旧 maibot/dreamService 口径一致），
    // 此时无处锚定注入，跳过外观注入
    return basePrompt.trim();
  }
  let appearancePart = injectOutfitsIntoAppearance(appearance, buildOutfitInjectionBlocks(outfits)).trim();
  if (person) appearancePart = appearancePart.replace(/你/g, person);
  return [short, appearancePart].filter(Boolean).join(joiner);
}

/**
 * 生图交叉参考信息（私聊 needImage / 画风测试共用）：身份行 + 外观段（含外观注入），
 * 「你」→角色名替换。
 * @param {object} char - characters 表行（至少含 base_prompt, display_name）
 * @param {object} [opts] - 同 buildCharacterPersona 的 opts.outfits / opts.variant 无关字段
 * @returns {string}
 */
export function buildImageCrossRefInfo(char, opts = {}) {
  const base = String(char?.base_prompt || '');
  const person = char?.display_name || '';
  const parts = [];

  const nl = base.indexOf('\n');
  const firstLine = (nl >= 0 ? base.slice(0, nl) : base).trim();
  if (firstLine) {
    let cut = -1;
    let start = 0;
    for (let i = 0; i < firstLine.length; i++) {
      if (firstLine[i] === '，' || firstLine[i] === '。') {
        if (firstLine.slice(start, i).includes('来自')) { cut = i; break; }
        start = i + 1;
      }
    }
    const identity = (cut >= 0 ? firstLine.slice(0, cut) : firstLine).replace(/^你是/, '').replace(/。$/, '').trim();
    if (identity) parts.push(identity);
  }

  const appearance = extractAppearanceSection(base);
  const injected = injectOutfitsIntoAppearance(appearance, buildOutfitInjectionBlocks(resolveOutfits(char, opts.outfits)));
  if (injected) {
    parts.push(person ? injected.replace(/你/g, person) : injected);
  }
  return parts.join('\n');
}
