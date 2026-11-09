export const DEFAULT_PHOTO_STUDIO_DIMENSIONS = Object.freeze({ width: 1200, height: 1600 });

export const PHOTO_STUDIO_DIMENSION_LIMITS = Object.freeze({ min: 512, max: 2048, step: 8 });

export function isPairPose(pose) {
  return /双人|pair/i.test(`${pose?.system || ''} ${pose?.id || ''}`);
}

export function buildPhotoStudioPrompt({ pose, characters, instruction = '' }) {
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
  const group = text => `(${text})`;
  const rolePrompts = characters.map((character, index) => {
    const appearance = String(character.appearance || '').trim();
    if (!appearance) throw new Error('入镜角色缺少外观正文');
    const name = characterNames[index];
    const description = resolveCharacterNames(appearance);
    return group(description.startsWith(name) ? description : `${name}, ${description}`);
  });
  const parts = [group(posePrompt), ...rolePrompts];
  const extra = String(instruction || '').trim();
  if (extra) parts.push(group(extra));
  return parts.join('\n\n');
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
