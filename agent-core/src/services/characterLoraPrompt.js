import { extractCharacterEnglishName } from './characterPersona.js';
import { parseCharacterLoras } from './groupImageLoraMatcher.js';

export function characterLoraActor(character, { required = false } = {}) {
  const names = [extractCharacterEnglishName(character), character.name, character.display_name].filter(Boolean);
  return { id: character.id, names, loras: parseCharacterLoras(character), required };
}

function appearsInImagePrompt(prompt, names) {
  return names.some(name => {
    const pattern = name.trim().replace(/[.*+?^$(){}|[\]\\]/g, '\\$&').replace(/[ _]+/g, '[ _]+');
    if (!pattern) return false;
    const flags = name.length > 1 ? 'iu' : 'u';
    return new RegExp('(?<![\\p{L}\\p{N}_])' + pattern + '(?![\\p{L}\\p{N}_])', flags).test(prompt);
  });
}

// Collect trigger words independently from the loaders: several entry points
// have already selected a single weight for each path by the time we get here.
export function collectSharedLoraTriggers(prompt, loras, actors, normalizePath) {
  const loaderPaths = new Set(loras.map(lora => normalizePath(lora.path)));
  const seenActors = new Set();
  const ownersByPath = new Map();
  for (const actor of actors) {
    if (actor.id != null && seenActors.has(actor.id)) continue;
    if (!actor.required && !appearsInImagePrompt(prompt, actor.names)) continue;
    seenActors.add(actor.id);

    const actorPaths = new Set();
    for (const lora of actor.loras) {
      const path = normalizePath(lora.path);
      if (!loaderPaths.has(path) || actorPaths.has(path)) continue;
      actorPaths.add(path);
      if (!ownersByPath.has(path)) ownersByPath.set(path, []);
      ownersByPath.get(path).push(lora.triggerWord);
    }
  }

  const sharedTriggers = [];
  for (const [path, triggers] of ownersByPath) {
    if (triggers.length < 2) continue;
    const words = triggers.filter(word => typeof word === 'string')
      .map(word => word.trim().replace(/(?<!\\)[,\s]+$/, '')).filter(Boolean);
    if (words.length) sharedTriggers.push({ path, triggerWord: [...new Set(words)].join(', ') });
  }
  return sharedTriggers;
}
