const HOUR_MS = 60 * 60 * 1000;

// 老设置未记录模式时，1 仍视为默认，其余非零值对应具体时间档。
export function isDefaultMomentTiming(features) {
  return (features.momentFreq ?? 1) === 1 && features.momentFreqMode !== 'interval';
}

/** 角色自己的排期始终使用默认节奏；自定义档不消费这些时间。 */
export function getMomentDelay(_features, { initial = false, random = Math.random } = {}) {
  return (initial ? 1 + random() * 3 : 2 + random() * 6) * HOUR_MS;
}

/** 自定义档是全局固定间隔，不再按角色分别浮动；默认和关闭不启用。 */
export function getMomentIntervalMs(features) {
  const freq = features.momentFreq ?? 1;
  return freq > 0 && !isDefaultMomentTiming(features) ? 2 * HOUR_MS / Math.max(0.01, freq) : null;
}
