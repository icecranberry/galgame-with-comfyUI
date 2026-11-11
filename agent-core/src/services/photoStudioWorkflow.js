export const DEFAULT_PHOTO_STUDIO_DIMENSIONS = Object.freeze({ width: 1152, height: 2048 });

export const PHOTO_STUDIO_DIMENSION_LIMITS = Object.freeze({ min: 512, max: 2048, step: 8 });

export function isPairPose(pose) {
  return /双人|pair/i.test(`${pose?.system || ''} ${pose?.id || ''}`);
}

export function buildPhotoStudioPrompt({ pose, characters, instruction = '', backgroundPrompt = '' }) {
  const rawPosePrompt = String(pose?.posePrompt || '').trim();
  if (!rawPosePrompt) throw new Error('该姿势的专属提示词尚未校准，请先选择已有完整描述的姿势');
  if (!Array.isArray(characters) || characters.length < 1 || characters.length > 2) {
    throw new Error('照相馆支持选择一至两位角色');
  }

  const characterNames = characters.map((character, index) => String(character.name || `the ${index === 0 ? 'first' : 'second'} character`).trim());
  const aliases = characters.flatMap((character, index) => (character.aliases || []).filter(alias => /\p{Script=Han}/u.test(alias || '')).map(alias => [alias, characterNames[index]])).sort((a, b) => b[0].length - a[0].length);
  const resolveCharacterNames = text => {
    let result = text.replace(/\bcharacter\s+([12])\b/gi, (_match, number) => characterNames[Number(number) - 1] || `the ${number === '1' ? 'first' : 'second'} character`);
    for (const [alias, name] of aliases) result = result.replaceAll(alias, name);
    return result;
  };
  const posePrompt = resolveCharacterNames(rawPosePrompt);
  const rolePrompts = characters.map((character, index) => {
    const appearance = String(character.appearance || '').trim();
    if (!appearance) throw new Error('入镜角色缺少外观正文');
    const name = characterNames[index];
    let description = resolveCharacterNames(appearance);
    // Only normalize a known identity tag, never arbitrary weighted/tag parentheses.
    const identity = character.identityTag;
    if (identity) {
      const plain = identity.replace(/\\([()])/g, '$1');
      const escaped = plain.replace(/[()]/g, bracket => `\\${bracket}`);
      description = description.replaceAll(escaped, plain);
      if (description.includes(plain)) description = description.replaceAll(plain, escaped);
      else description = `${escaped}, ${description}`;
    }
    return `Character ${index + 1} — Appearance: ${description.startsWith(name) ? description : `${name}, ${description}`}`;
  });
  const parts = [`Pose: ${posePrompt}`, ...rolePrompts];
  if (backgroundPrompt.trim()) parts.push(`Background: ${backgroundPrompt.trim()}`);
  const extra = String(instruction || '').trim();
  if (extra) parts.push(`Direction: ${extra}`);
  return parts.join('\n\n');
}

function sectionMatches(prompt) {
  return [...prompt.matchAll(/^(Pose|Character [12] — Appearance|Background|Direction):/gm)];
}

export function photoStudioSectionHeadings(prompt) {
  return sectionMatches(prompt).map(match => match[1]);
}

// Attach untouched clothing tags after the corresponding appearance, including
// after AI polishing. This keeps actors bound to their own clothes and the
// background at the end, without sending tags through the language model.
export function appendPhotoStudioOutfits(prompt, outfitBlocks = []) {
  const sections = sectionMatches(prompt);
  const insertions = outfitBlocks.flatMap((block, index) => {
    if (!block) return [];
    const section = sections.findIndex(match => match[1] === `Character ${index + 1} — Appearance`);
    if (section < 0) throw new Error('拍摄提示词缺少人物外观分段，无法追加服装');
    return [{ offset: sections[section + 1]?.index ?? prompt.length, block }];
  }).sort((a, b) => b.offset - a.offset);
  let result = prompt;
  for (const { offset, block } of insertions) {
    result = `${result.slice(0, offset).trimEnd()}\n\n${block}\n\n${result.slice(offset).trimStart()}`.trimEnd();
  }
  return result;
}

export function photoStudioDimensions(width = DEFAULT_PHOTO_STUDIO_DIMENSIONS.width, height = DEFAULT_PHOTO_STUDIO_DIMENSIONS.height) {
  const valid = value => Number.isInteger(value)
    && value >= PHOTO_STUDIO_DIMENSION_LIMITS.min
    && value <= PHOTO_STUDIO_DIMENSION_LIMITS.max
    && value % PHOTO_STUDIO_DIMENSION_LIMITS.step === 0;
  if (!valid(width) || !valid(height)) {
    throw new Error(`图片宽高须为 ${PHOTO_STUDIO_DIMENSION_LIMITS.min}–${PHOTO_STUDIO_DIMENSION_LIMITS.max} 之间、且为 ${PHOTO_STUDIO_DIMENSION_LIMITS.step} 的倍数`);
  }
  return { width, height };
}
