// ── cache-bust 覆盖登记表（模块级，跨组件实例 / 弹窗开合存活）──
// 重新生成/细化确认覆盖后原图 URL 不变、文件内容已换，浏览器会继续用 HTTP 缓存里的旧图。
// 任务确认（imageEditTasks）与灯箱展示都登记/读取这张表：base URL → 最近覆盖时间戳，
// 命中时统一给 URL 追加 ?_t=，保证详情卡/灯箱重开（哪怕当时组件已销毁、数据仍是旧 URL）也拿到新图。
import { ref } from 'vue'

const overwriteBusts = new Map()
const OVERWRITE_BUSTS_CAP = 200
// 登记表本身非响应式，用 tick 让依赖它的 computed（详情卡立绘 URL 等）在登记后自动重算
export const overwriteBustTick = ref(0)

export function recordOverwriteBust(base, ts = Date.now()) {
  overwriteBusts.set(base.replace(/\?.*$/, ''), ts)
  overwriteBustTick.value++
  if (overwriteBusts.size > OVERWRITE_BUSTS_CAP) {
    overwriteBusts.delete(overwriteBusts.keys().next().value)
  }
}

/** 命中覆盖登记表的 URL 追加 cache-bust 时间戳；未覆盖过则原样返回 */
export function bustUrlIfOverwritten(url) {
  if (!url) return url
  const base = String(url).replace(/\?.*$/, '')
  const ts = overwriteBusts.get(base)
  return ts ? `${base}?_t=${ts}` : url
}

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
