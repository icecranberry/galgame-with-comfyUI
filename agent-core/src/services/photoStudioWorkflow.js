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

  const characterNames = characters.map((character, index) => String(character.name || `角色${index + 1}`).trim());
  const resolveCharacterNames = text => text.replace(/\bcharacter\s+([12])\b/gi, (_match, number) =>
    characterNames[Number(number) - 1] || `the ${number === '1' ? 'first' : 'second'} character`);
  const posePrompt = resolveCharacterNames(rawPosePrompt);
  const group = text => `(${text})`;
  const rolePrompts = characters.map((character, index) => {
    const appearance = String(character.appearance || '').trim();
    const name = characterNames[index];
    const role = resolveCharacterNames(String(pose.characterRoles?.[index] || '').trim());
    const description = [`${name}, ${appearance || 'preserve this character\'s established identity and appearance'}`];
    if (role) description.push(role);
    return group(description.join('; '));
  });
  const subjectCount = characters.length === 1 ? 'solo, one character' : 'two characters, exactly two people';
  const composition = characters.length === 1 ? subjectCount
    : `${subjectCount}, preserve their distinct identities, hair colors, eye colors and outfits`;
  const parts = [group(composition), group(posePrompt), ...rolePrompts];
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
