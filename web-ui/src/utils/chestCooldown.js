/**
 * 宝箱冷却文案。
 *
 * 冷却时长由后端 `CHEST_COOLDOWN_SECONDS` 决定。本地补丁把它从上游的 16 小时改成了 1 分钟，
 * 所以这里不能写死「小时」——按秒数挑合适单位，免得出现「每 0.0167 小时可开启一次」这种数字。
 */
export const DEFAULT_CHEST_COOLDOWN_SECONDS = 60

export function formatChestCooldown(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  if (s === 0) return '开启后立即刷新'
  if (s % 3600 === 0) return `每 ${s / 3600} 小时可开启一次`
  if (s % 60 === 0) return `每 ${s / 60} 分钟可开启一次`
  return `每 ${s} 秒可开启一次`
}
