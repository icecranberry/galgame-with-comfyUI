export function loraPathKey(path) {
  return path.trim().replaceAll('\\', '/');
}

export function loraModelFields(item) {
  return {
    path: typeof item?.path === 'string' ? item.path.trim() : '',
    weight: Number.isFinite(item?.weight) ? item.weight : 0.6,
    triggerWord: typeof item?.triggerWord === 'string' ? item.triggerWord : '',
  };
}

export function loraLibraryFields(item) {
  return {
    ...loraModelFields(item),
    note: typeof item?.note === 'string' ? item.note : '',
  };
}

export function enabledGlobalLoras(loras) {
  return Array.isArray(loras)
    ? loras.filter(item => typeof item?.path === 'string' && item.path.trim() && item.enabled !== false)
    : [];
}

export function matchesGlobalLoraScene(lora, scene) {
  return !scene || !Array.isArray(lora.scenes) || lora.scenes.includes(scene);
}
