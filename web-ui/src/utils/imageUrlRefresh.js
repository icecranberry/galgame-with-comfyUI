/**
 * 扫描页面中的 <img> 与 background-image，把匹配旧 base URL 的图片替换为带 cache-bust 的新地址。
 * 与旧版「重新生成/放大细化后立即刷新页面图片」的行为保持一致。
 */
export function refreshImageUrls(oldUrl) {
  if (!oldUrl) return
  const base = String(oldUrl).replace(/\?.*$/, '')
  const busted = base + `?_t=${Date.now()}`

  document.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || ''
    if (src.replace(/\?.*$/, '') === base) {
      img.setAttribute('src', busted)
    }
  })

  document.querySelectorAll('*').forEach(el => {
    const bg = el.style.backgroundImage
    if (bg && bg.includes(base)) {
      el.style.backgroundImage = bg
        .replace(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?[^)\'"]*)?', 'g'), busted)
    }
  })
}
