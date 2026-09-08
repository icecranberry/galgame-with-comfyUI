/** Weather caches may provide either Celsius measurements or descriptive labels. */
export function formatTownTemperature(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? `${value}°C` : ''
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || /^[+-]?(?:NaN|Infinity)$/i.test(text)) return ''
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    return Number.isFinite(Number(text)) ? `${text}°C` : ''
  }
  return text
}
