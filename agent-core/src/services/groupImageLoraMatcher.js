import { getDb } from '../db/index.js';

function normalizeEnglishName(value) {
  const tokens = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  return tokens ? tokens.join(' ') : '';
}

function parseCharacterLoras(character) {
  if (!character?.loras) return [];
  try {
    const parsed = typeof character.loras === 'string'
      ? JSON.parse(character.loras)
      : character.loras;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(lora => lora?.path && typeof lora.path === 'string')
      .map(lora => ({
        path: lora.path,
        weight: typeof lora.weight === 'number' ? lora.weight : 0.6,
        triggerWord: lora.triggerWord || '',
      }));
  } catch {
    return [];
  }
}

const PERSON_PROMPT_RE = /\b(girl|girls|woman|women|boy|boys|man|men|person|people|character|characters|female|male|selfie|portrait|she|her|hers|he|him|his|adult|teen|teenager|child)\b/i;

export function applyGroupImageNameFallback(prompt, matchedCharacters, fallbackCharacter) {
  const cleanPrompt = String(prompt || '').trim();
  if (matchedCharacters.length > 0) return { prompt: cleanPrompt, fallbackApplied: false };
  if (!fallbackCharacter?.name || !PERSON_PROMPT_RE.test(cleanPrompt)) {
    return { prompt: cleanPrompt, fallbackApplied: false };
  }

  return {
    prompt: `${fallbackCharacter.name}, ${cleanPrompt}`,
    fallbackApplied: true,
  };
}

export function matchCharactersInImagePrompt(prompt, characters) {
  const normalizedPrompt = normalizeEnglishName(prompt);
  if (!normalizedPrompt) return [];

  const paddedPrompt = ` ${normalizedPrompt} `;
  const candidates = [];
  characters.forEach((character, characterIndex) => {
    const normalizedName = normalizeEnglishName(character?.name);
    if (normalizedName.replaceAll(' ', '').length < 2) return;

    const needle = ` ${normalizedName} `;
    let fromIndex = 0;
    while (fromIndex < paddedPrompt.length) {
      const start = paddedPrompt.indexOf(needle, fromIndex);
      if (start < 0) break;
      candidates.push({
        character,
        characterIndex,
        start,
        end: start + needle.length,
        specificity: normalizedName.length,
      });
      fromIndex = start + 1;
    }
  });

  // Prefer the longest name when aliases overlap, e.g. raiden_mei over mei.
  candidates.sort((a, b) => b.specificity - a.specificity || a.start - b.start);
  const selectedRanges = [];
  const selectedCharacterIndexes = new Set();
  for (const candidate of candidates) {
    if (selectedCharacterIndexes.has(candidate.characterIndex)) continue;
    const overlaps = selectedRanges.some(range => candidate.start < range.end && candidate.end > range.start);
    if (overlaps) continue;
    selectedRanges.push({ start: candidate.start, end: candidate.end });
    selectedCharacterIndexes.add(candidate.characterIndex);
  }

  return characters.filter((_, index) => selectedCharacterIndexes.has(index));
}

export function collectCharacterLoras(characters) {
  const seenPaths = new Set();
  const loras = [];

  for (const character of characters) {
    for (const lora of parseCharacterLoras(character)) {
      if (seenPaths.has(lora.path)) continue;
      seenPaths.add(lora.path);
      loras.push(lora);
    }
  }

  return loras;
}

export function resolveGroupImageLoras(prompt, { fallbackCharacter = null } = {}) {
  const characters = getDb().prepare(`
    SELECT id, name, display_name, loras
    FROM characters
    WHERE name IS NOT NULL AND trim(name) != ''
    ORDER BY id ASC
  `).all();
  let matchedCharacters = matchCharactersInImagePrompt(prompt, characters);
  const prepared = applyGroupImageNameFallback(prompt, matchedCharacters, fallbackCharacter);
  if (prepared.fallbackApplied) {
    matchedCharacters = matchCharactersInImagePrompt(prepared.prompt, characters);
  }

  return {
    prompt: prepared.prompt,
    fallbackApplied: prepared.fallbackApplied,
    matchedCharacters,
    loras: collectCharacterLoras(matchedCharacters),
  };
}
