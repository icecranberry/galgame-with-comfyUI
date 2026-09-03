// 朋友圈分享图渲染器 —— 把一条朋友圈重新排版成 1080×1920 竖版视觉海报。
//
// 设计原则（优先级从高到低）：
//   1. 原始配图是绝对视觉主角（单图约占画布高度 50%~72%）
//   2. 头像 / 名字 / 时间只回答「这是谁、什么时候发的」
//   3. 正文是辅助内容，长度自适应：先缩字号，再压正文区，最后才允许截断
//   4. 装饰只负责氛围，不抢主体；不出现点赞 / 评论 / 网页 UI 元素
//
// 与网页朋友圈 DOM 完全独立：纯 Canvas2D 绘制，坐标全部以 u（= W / 1080）为基准，
// 之后支持 1440×2560 只需把 options.width 传 1440。与网页共用同一份 post 数据，布局独立。

const FONT_STACK = '"HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'

export const MOMENT_SHARE_STYLES = [
  { id: 'magazine', label: '杂志' },
  { id: 'collage', label: '拼贴' },
  { id: 'editorial', label: '刊风' },
  { id: 'minimal', label: '简约' },
  { id: 'immersive', label: '沉浸' },
  { id: 'feature', label: '胶片' },
]

const STYLE_IDS = new Set(MOMENT_SHARE_STYLES.map(s => s.id))

// ── 邻舍基础色板 ──
const C = {
  paperTop: '#fbf8f4',
  paper: '#f3ece3',
  card: '#fffdfb',
  ink: '#332c26',
  muted: '#a3968b',
  coral: '#e07b6c',
  cream: '#f6f1ea',
  scrimDark: '24, 17, 13',
}

// ════════════════════════ 基础工具 ════════════════════════

/** r 支持 number 或 [tl, tr, br, bl] */
function roundRectPath(ctx, x, y, w, h, r) {
  const radii = Array.isArray(r) ? r : [r, r, r, r]
  const clamped = radii.map(rr => Math.max(0, Math.min(rr, w / 2, h / 2)))
  const [tl, tr, br, bl] = clamped
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  ctx.arcTo(x + w, y, x + w, y + tr, tr)
  ctx.lineTo(x + w, y + h - br)
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br)
  ctx.lineTo(x + bl, y + h)
  ctx.arcTo(x, y + h, x, y + h - bl, bl)
  ctx.lineTo(x, y + tl)
  ctx.arcTo(x, y, x + tl, y, tl)
  ctx.closePath()
}

function setFont(ctx, weight, size, letterSpacing = 0) {
  ctx.font = `${weight} ${Math.max(8, Math.round(size))}px ${FONT_STACK}`
  try { ctx.letterSpacing = `${letterSpacing}px` } catch { /* 旧浏览器忽略 */ }
}

function resetDecoration(ctx) {
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

/** 单行文字超出宽度时截断加省略号 */
function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}

const LATIN_CHAR = /[A-Za-z0-9'’"%°.+\-_:]/

/**
 * 按宽度折行。CJK 逐字换行，拉丁单词不从中间断开；
 * 保留手动换行符；超长无断点 token（如 URL）硬切。
 */
function wrapText(ctx, text, maxWidth) {
  const lines = []
  for (const para of String(text || '').split(/\r?\n/)) {
    if (!para) { lines.push(''); continue }
    let cur = ''
    for (let i = 0; i < para.length; i++) {
      const ch = para[i]
      const next = cur + ch
      if (!cur || ctx.measureText(next).width <= maxWidth) {
        cur = next
        continue
      }
      // 超宽：若断点落在拉丁单词内部，回退到最近的词边界
      let cut = cur.length
      if (LATIN_CHAR.test(cur[cut - 1]) && LATIN_CHAR.test(ch)) {
        let j = cut
        while (j > 2 && LATIN_CHAR.test(cur[j - 1]) && LATIN_CHAR.test(cur[j - 2])) j--
        if (cut - j <= 24) cut = j // 过长的连续 token 不回退，交给硬切
      }
      lines.push(cur.slice(0, cut))
      cur = cur.slice(cut) + ch
      while (ctx.measureText(cur).width > maxWidth && cur.length > 1) {
        let k = cur.length - 1
        while (k > 1 && ctx.measureText(cur.slice(0, k)).width > maxWidth) k--
        lines.push(cur.slice(0, k))
        cur = cur.slice(k)
      }
    }
    lines.push(cur)
  }
  return lines
}

/**
 * 自适应文字块：从大到小尝试字号，返回能装进 maxBlockH 的方案；
 * 最小字号仍溢出时按高度截行并加省略号（最后手段）。
 */
function fitTextBlock(ctx, text, { maxWidth, sizes, lineHeight, maxBlockH }) {
  for (const size of sizes) {
    setFont(ctx, 400, size)
    const lh = Math.round(size * lineHeight)
    const lines = wrapText(ctx, text, maxWidth)
    if (lines.length * lh <= maxBlockH) {
      return { size, lh, lines, blockH: lines.length * lh, truncated: false }
    }
  }
  const size = sizes[sizes.length - 1]
  setFont(ctx, 400, size)
  const lh = Math.round(size * lineHeight)
  let lines = wrapText(ctx, text, maxWidth)
  const maxLines = Math.max(1, Math.floor(maxBlockH / lh))
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    let last = lines[maxLines - 1]
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1)
    lines[maxLines - 1] = last + '…'
  }
  return { size, lh, lines, blockH: lines.length * lh, truncated: true }
}

function drawTextBlock(ctx, block, x, y, color, { shadow } = {}) {
  setFont(ctx, 400, block.size)
  ctx.fillStyle = color
  if (shadow) {
    ctx.shadowColor = shadow.color
    ctx.shadowBlur = shadow.blur
    ctx.shadowOffsetY = shadow.y || 0
  }
  block.lines.forEach((line, i) => {
    ctx.fillText(line, x, y + block.lh * (i + 0.78))
  })
  resetDecoration(ctx)
}

// ── 颜色工具 ──

function hexToRgb(hex) {
  const v = String(hex).replace('#', '')
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

function mixHex(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const m = (x, y) => Math.round(x + (y - x) * t)
  return rgbToHex(m(r1, r2), m(g1, g2), m(b1, b2))
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function hslToHex(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return rgbToHex(hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255)
}

/** 从配图中提取主色（压低饱和度，只做氛围染色），失败返回 null */
function extractDominantColor(img) {
  try {
    const n = 14
    const cv = document.createElement('canvas')
    cv.width = n; cv.height = n
    const g = cv.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0, n, n)
    const data = g.getImageData(0, 0, n, n).data
    const buckets = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
      if (s < 0.18 || l < 0.14 || l > 0.9) continue
      const b = Math.min(17, Math.floor(h * 18))
      const w = s * (1 - Math.abs(l - 0.55) * 1.4)
      if (w <= 0) continue
      buckets[b].w += w
      buckets[b].r += data[i] * w
      buckets[b].g += data[i + 1] * w
      buckets[b].b += data[i + 2] * w
    }
    let best = null
    for (const b of buckets) if (!best || b.w > best.w) best = b
    if (!best || best.w < 2.2) return null
    const [h, s] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w)
    return hslToHex(h, Math.min(0.4, s), 0.66)
  } catch {
    return null
  }
}

// ── 图片加载与绘制 ──

function loadImage(src) {
  if (!src) return Promise.resolve(null)
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** cover 绘制：focusY 为竖向裁剪锚点（0=保顶部，保护头部） */
function drawCover(ctx, img, f, focusY = 0.5) {
  const scale = Math.max(f.w / img.naturalWidth, f.h / img.naturalHeight)
  const sw = f.w / scale, sh = f.h / scale
  const sx = (img.naturalWidth - sw) * 0.5
  const sy = (img.naturalHeight - sh) * Math.max(0, Math.min(1, focusY))
  ctx.drawImage(img, sx, sy, sw, sh, f.x, f.y, f.w, f.h)
}

/**
 * 智能填充：横向裁剪不伤人脸，直接 cover；
 * 任一方向会裁掉太多时改用「模糊延展底 + 完整 contain」，避免裁掉头部/关键内容。
 */
function drawImageSmart(ctx, img, f, tintHex) {
  if (!img) { drawPlaceholder(ctx, f, tintHex); return }
  const imgAspect = img.naturalWidth / img.naturalHeight
  const frameAspect = f.w / f.h
  if (imgAspect >= frameAspect) {
    // 图比框「宽」→ cover 裁左右；裁太多（横图塞进竖框）退化为模糊延展
    const hExcess = 1 - frameAspect / imgAspect
    if (hExcess > 0.5) {
      drawBlurredFill(ctx, img, f, tintHex)
      const scale = Math.min(f.w / img.naturalWidth, f.h / img.naturalHeight)
      const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale
      ctx.drawImage(img, f.x + (f.w - dw) / 2, f.y + (f.h - dh) / 2, dw, dh)
    } else {
      drawCover(ctx, img, f, 0.5)
    }
  } else {
    const excess = 1 - imgAspect / frameAspect // cover 时被裁掉的竖向占比
    if (excess <= 0.24) {
      drawCover(ctx, img, f, 0.2) // 顶部偏置：主要裁底部
    } else {
      drawBlurredFill(ctx, img, f, tintHex)
      const scale = Math.min(f.w / img.naturalWidth, f.h / img.naturalHeight)
      const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale
      ctx.drawImage(img, f.x + (f.w - dw) / 2, f.y + (f.h - dh) / 2, dw, dh)
    }
  }
}

let _ctxFilterSupported = null
function ctxFilterSupported() {
  if (_ctxFilterSupported === null) {
    const c = document.createElement('canvas').getContext('2d')
    c.filter = 'blur(2px)'
    _ctxFilterSupported = c.filter === 'blur(2px)'
  }
  return _ctxFilterSupported
}

/**
 * 背景虚影：把原图变成等比、无颗粒的柔和模糊底。
 * - 优先用 canvas filter 做真高斯模糊（在中等分辨率上模糊，再等比放大；内容已无高频，放大不会出颗粒）
 * - 不支持 filter 时用金字塔逐级降采样→逐级升采样，任何一步放成都 ≤2x，
 *   避免小图一次性放大几十倍产生的双线性颗粒
 * 两种路径都保持源与目标同比例，不拉伸画面。
 */
function drawBlurredFill(ctx, img, f, tintHex) {
  const frameAspect = f.w / f.h
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (ctxFilterSupported()) {
    const LONG = 96
    const ow = frameAspect >= 1 ? LONG : Math.max(8, Math.round(LONG * frameAspect))
    const oh = frameAspect >= 1 ? Math.max(8, Math.round(LONG / frameAspect)) : LONG
    const off = document.createElement('canvas')
    off.width = ow; off.height = oh
    const g = off.getContext('2d')
    g.filter = `blur(${Math.round(LONG * 0.12)}px)`
    // 溢出绘制：给模糊留出采样余量，避免画布边缘混入透明区导致四边发暗
    const m = 1.8
    drawCover(g, img, { x: (ow - ow * m) / 2, y: (oh - oh * m) / 2, w: ow * m, h: oh * m }, 0.5)
    g.filter = 'none'
    ctx.drawImage(off, f.x - f.w * 0.02, f.y - f.h * 0.02, f.w * 1.04, f.h * 1.04)
  } else {
    const START = 128
    let cw = frameAspect >= 1 ? START : Math.max(8, Math.round(START * frameAspect))
    let ch = frameAspect >= 1 ? Math.max(8, Math.round(START / frameAspect)) : START
    let src = document.createElement('canvas')
    src.width = cw; src.height = ch
    drawCover(src.getContext('2d'), img, { x: 0, y: 0, w: cw, h: ch }, 0.5)
    while (cw > 12 && ch > 12) {
      const nw = Math.max(1, Math.round(cw / 2)), nh = Math.max(1, Math.round(ch / 2))
      const next = document.createElement('canvas')
      next.width = nw; next.height = nh
      const nctx = next.getContext('2d')
      nctx.imageSmoothingEnabled = true
      nctx.imageSmoothingQuality = 'high'
      nctx.drawImage(src, 0, 0, nw, nh)
      src = next; cw = nw; ch = nh
    }
    const targetW = f.w * 1.04, targetH = f.h * 1.04
    while (cw < targetW / 2) {
      const next = document.createElement('canvas')
      next.width = cw * 2; next.height = ch * 2
      const nctx = next.getContext('2d')
      nctx.imageSmoothingEnabled = true
      nctx.imageSmoothingQuality = 'high'
      nctx.drawImage(src, 0, 0, next.width, next.height)
      src = next; cw = next.width; ch = next.height
    }
    ctx.drawImage(src, f.x - f.w * 0.02, f.y - f.h * 0.02, targetW, targetH)
  }
  ctx.restore()
  if (tintHex) {
    ctx.fillStyle = rgba(tintHex, 0.2)
    ctx.fillRect(f.x, f.y, f.w, f.h)
  }
}

/** 加载失败占位：柔和渐变 + 简笔画照片符号 */
function drawPlaceholder(ctx, f, tintHex) {
  const grad = ctx.createLinearGradient(f.x, f.y, f.x + f.w, f.y + f.h)
  grad.addColorStop(0, mixHex(tintHex || C.paper, '#ffffff', 0.55))
  grad.addColorStop(1, mixHex(tintHex || C.paper, C.coral, 0.16))
  ctx.fillStyle = grad
  ctx.fillRect(f.x, f.y, f.w, f.h)
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2
  const s = Math.min(f.w, f.h) * 0.16
  ctx.strokeStyle = rgba(C.ink, 0.22)
  ctx.lineWidth = Math.max(2, s * 0.09)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  roundRectPath(ctx, cx - s, cy - s * 0.78, s * 2, s * 1.56, s * 0.24)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx - s * 0.38, cy - s * 0.2, s * 0.2, 0, Math.PI * 2)
  ctx.moveTo(cx - s * 0.72, cy + s * 0.5)
  ctx.lineTo(cx - s * 0.1, cy - s * 0.14)
  ctx.lineTo(cx + s * 0.3, cy + s * 0.26)
  ctx.lineTo(cx + s * 0.56, cy + 0.02)
  ctx.lineTo(cx + s * 0.74, cy + s * 0.18)
  ctx.stroke()
}

/** 圆形头像：图失败/缺失时降级为珊瑚底 + 名字首字 */
function drawAvatar(ctx, img, cx, cy, r, name, ringColor) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = C.coral
  ctx.fill()
  if (img) {
    ctx.clip()
    const scale = Math.max(r * 2 / img.naturalWidth, r * 2 / img.naturalHeight)
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh)
  } else {
    setFont(ctx, 700, r * 0.92)
    ctx.fillStyle = C.card
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((name || '?').charAt(0), cx, cy + r * 0.06)
  }
  ctx.restore()
  if (ringColor) {
    ctx.beginPath()
    ctx.arc(cx, cy, r + r * 0.06, 0, Math.PI * 2)
    ctx.strokeStyle = ringColor
    ctx.lineWidth = Math.max(2, r * 0.07)
    ctx.stroke()
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function drawHeart(ctx, cx, cy, size, color) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(size / 24, size / 24)
  ctx.beginPath()
  ctx.moveTo(0, 8.4)
  ctx.bezierCurveTo(-11, 0.5, -7.4, -7.5, 0, -2.6)
  ctx.bezierCurveTo(7.4, -7.5, 11, 0.5, 0, 8.4)
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

// ════════════════════════ 数据准备 ════════════════════════

/** 海报用绝对时间：「8月2日 00:45」 */
function formatPosterTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = v => String(v).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatPosterDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = v => String(v).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load(`400 42px ${FONT_STACK}`, '邻舍分享Aa0'),
      document.fonts.load(`700 42px ${FONT_STACK}`, '邻舍分享Aa0'),
    ])
    await document.fonts.ready
  } catch { /* 字体缺失时回退系统字体，不阻塞 */ }
}

/** 收集渲染所需数据：加载图片（头 4 张 + 头像）、提取主色 */
async function buildModel(post) {
  const rawImages = (post.images || []).filter(Boolean).slice(0, 4)
  const [avatarImg, ...imgs] = await Promise.all([
    loadImage(post.avatar_path),
    ...rawImages.map(src => loadImage(src)),
  ])
  const images = imgs.map(img => ({ img, aspect: img ? img.naturalWidth / img.naturalHeight : 1 }))
  return {
    post,
    name: post.display_name || '邻友',
    time: formatPosterTime(post.created_at),
    date: formatPosterDate(post.created_at),
    content: String(post.content || '').trim(),
    images,
    avatarImg,
    dominant: images[0]?.img ? extractDominantColor(images[0].img) : null,
  }
}

// ════════════════════════ 公共部件 ════════════════════════

/** 左对齐身份行：头像 + 名字 + 时间，返回底部 y */
function drawIdentityRow(ctx, m, u, { x, top, avatarD, nameSize, timeSize, color, timeColor, ring }) {
  drawAvatar(ctx, m.avatarImg, x + avatarD / 2, top + avatarD / 2, avatarD / 2, m.name, ring)
  const textX = x + avatarD + 30 * u
  setFont(ctx, 700, nameSize)
  ctx.fillStyle = color
  ctx.fillText(ellipsize(ctx, m.name, 600 * u), textX, top + avatarD * 0.42)
  setFont(ctx, 400, timeSize)
  ctx.fillStyle = timeColor
  ctx.fillText(m.time, textX, top + avatarD * 0.42 + timeSize * 1.42)
  return top + avatarD
}

function drawWatermark(ctx, m, u, { cx, baseline, color, size = 24, align = 'center' }) {
  setFont(ctx, 400, size, Math.round(size * 0.16))
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText('来自邻舍.EXE', cx, baseline)
  ctx.textAlign = 'left'
  try { ctx.letterSpacing = '0px' } catch { /* ignore */ }
}

/** 多图网格布局：1 张满幅；2 张上下；3 张一大两小；≥4 张 2×2 */
function gridFrames(n, x, y, w, h, gap) {
  const frames = []
  if (n <= 1) {
    frames.push({ x, y, w, h })
  } else if (n === 2) {
    frames.push({ x, y, w, h: (h - gap) / 2 })
    frames.push({ x, y: y + (h - gap) / 2 + gap, w, h: (h - gap) / 2 })
  } else if (n === 3) {
    const topH = (h - gap) * 0.58
    frames.push({ x, y, w, h: topH })
    const bw = (w - gap) / 2
    frames.push({ x, y: y + topH + gap, w: bw, h: h - topH - gap })
    frames.push({ x: x + bw + gap, y: y + topH + gap, w: bw, h: h - topH - gap })
  } else {
    const ch = (h - gap) / 2, cw = (w - gap) / 2
    frames.push({ x, y, w: cw, h: ch })
    frames.push({ x: x + cw + gap, y, w: cw, h: ch })
    frames.push({ x, y: y + ch + gap, w: cw, h: ch })
    frames.push({ x: x + cw + gap, y: y + ch + gap, w: cw, h: ch })
  }
  return frames
}

function drawImageGrid(ctx, m, u, { x, y, w, h, gap, radius, tintHex }) {
  const frames = gridFrames(m.images.length, x, y, w, h, gap)
  m.images.forEach((it, i) => {
    const f = frames[i]
    ctx.save()
    roundRectPath(ctx, f.x, f.y, f.w, f.h, radius)
    ctx.clip()
    drawImageSmart(ctx, it.img, f, tintHex)
    ctx.restore()
  })
  // 超过 4 张：在第 4 格角落轻量标注剩余数量
  if (m.images.length > 4) {
    const f = frames[3]
    const label = `+${m.images.length - 4}`
    setFont(ctx, 700, 24 * u)
    const tw = ctx.measureText(label).width
    const pad = 16 * u
    ctx.fillStyle = 'rgba(20, 14, 10, 0.4)'
    roundRectPath(ctx, f.x + f.w - tw - pad * 2, f.y + f.h - 46 * u, tw + pad * 2, 38 * u, 19 * u)
    ctx.fill()
    ctx.fillStyle = C.card
    ctx.fillText(label, f.x + f.w - tw - pad, f.y + f.h - 18 * u)
  }
}

/** 画布底色 + 极低存在感的氛围光斑 */
function drawAmbient(ctx, W, H, { tintHex } = {}) {
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, mixHex(tintHex || C.paperTop, '#ffffff', 0.45))
  grad.addColorStop(1, tintHex ? mixHex(tintHex, C.paper, 0.6) : C.paper)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
  const glow = (cx, cy, r, base, alpha) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, base.replace('ALPHA', alpha))
    g.addColorStop(1, base.replace('ALPHA', 0))
    ctx.fillStyle = g
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  }
  glow(W * 0.94, H * 0.05, W * 0.62, 'rgba(224, 123, 108, ALPHA)', 0.07)
  glow(W * 0.04, H * 0.985, W * 0.55, 'rgba(168, 186, 202, ALPHA)', 0.08)
}

// ════════════════════════ 六套模板 ════════════════════════

// ── A 杂志：竖排角色名压在图版右缘 + 左侧出血主视觉 + editorial 排印 ──
function renderMagazine(ctx, m, u, W, H) {
  const lum = m.images[0]?.img ? extractLuminance(m.images[0].img) : 0.5
  const P = deriveCoverPalette(m.dominant, lum, 'magazine')
  ctx.fillStyle = P.bg
  ctx.fillRect(0, 0, W, H)
  drawCoverKicker(ctx, P, u, 84 * u, 104 * u)
  setFont(ctx, 400, 20 * u, 4 * u)
  ctx.fillStyle = P.sub
  ctx.fillText(editorialDate(m), 84 * u, 144 * u)

  const railW = 170 * u
  const plateW = W - railW
  const py = 190 * u
  const footerLineY = H - 170 * u
  const { block, imgH } = coverBlockAndImageH(ctx, m, u, H, {
    top: py, footerZoneY: footerLineY, captionGap: 84 * u, maxWidth: plateW - 84 * u,
    sizes: [34, 31, 28, 26, 25],
  })

  if (m.images.length) {
    ctx.save()
    roundRectPath(ctx, 0, py, plateW, imgH, [0, 16 * u, 16 * u, 0])
    ctx.clip()
    drawImageSmart(ctx, m.images[0].img, { x: 0, y: py, w: plateW, h: imgH }, null)
    ctx.restore()

    // 竖排角色名压在图版右缘(约 40% 字宽叠进图内),无描边光晕
    const chars = Math.max(1, m.name.length)
    const vSize = Math.min(165 * u, Math.floor((imgH + 140 * u) / chars))
    drawStackedVertical(ctx, m.name, plateW + vSize * 0.1, py + 36 * u, vSize, P.ink)

    if (block) drawTextBlock(ctx, block, 84 * u, py + imgH + 80 * u, P.ink)
  } else if (m.content) {
    // 纯文字:文字即主视觉,垂直居中于剩余空间
    const big = fitTextBlock(ctx, m.content, {
      maxWidth: W - 168 * u, sizes: [50, 46, 42, 38, 34].map(s => s * u), lineHeight: 1.8,
      maxBlockH: Math.max(300 * u, footerLineY - 60 * u - 300 * u),
    })
    const startY = 300 * u + Math.max(0, (footerLineY - 60 * u - 300 * u - big.blockH) / 2)
    drawTextBlock(ctx, big, 84 * u, startY, P.ink)
    drawCoverByline(ctx, m, P, u, 84 * u, Math.min(startY + big.blockH + 96 * u, footerLineY - 60 * u))
  }

  ctx.strokeStyle = rgba(P.sub, 0.35)
  ctx.lineWidth = 2 * u
  ctx.beginPath()
  ctx.moveTo(84 * u, footerLineY)
  ctx.lineTo(plateW - 24 * u, footerLineY)
  ctx.stroke()
  drawCoverFooter(ctx, P, m, u, W, { y: H - 100 * u, x: 84 * u, xRight: plateW - 24 * u })
}

// ── B 沉浸：随图染色的通栏大图 + 极简刊眉 + 图下短注 + 署名页脚 ──
function renderImmersive(ctx, m, u, W, H) {
  const lum = m.images[0]?.img ? extractLuminance(m.images[0].img) : 0.5
  const P = deriveCoverPalette(m.dominant, lum, 'immersive')
  ctx.fillStyle = P.bg
  ctx.fillRect(0, 0, W, H)
  drawCoverKicker(ctx, P, u, 84 * u, 118 * u)
  const nameSize = fitLineSize(ctx, m.name, 700, 74 * u, W - 380 * u, 0.05)
  ctx.fillStyle = P.ink
  ctx.fillText(m.name, 84 * u, 196 * u)
  ctx.fillStyle = P.accent
  roundRectPath(ctx, 84 * u, 228 * u, 92 * u, 7 * u, 4 * u)
  ctx.fill()
  setFont(ctx, 400, 21 * u, 4 * u)
  ctx.fillStyle = P.sub
  ctx.textAlign = 'right'
  ctx.fillText(editorialDate(m), W - 84 * u, 196 * u)
  ctx.textAlign = 'left'

  if (m.images.length) {
    const top = 300 * u
    const footerLineY = H - 190 * u
    const { block, imgH, slack } = coverBlockAndImageH(ctx, m, u, H, {
      top, footerZoneY: footerLineY, captionGap: 88 * u, maxWidth: W - 280 * u,
    })
    // 富余空间的一小部分放到刊眉与图之间作呼吸，其余由图片本身吸收
    const py = top + Math.min(56 * u, slack * 0.4)
    ctx.save()
    roundRectPath(ctx, 0, py, W, imgH, [0, 0, 20 * u, 20 * u])
    ctx.clip()
    drawImageSmart(ctx, m.images[0].img, { x: 0, y: py, w: W, h: imgH }, null)
    ctx.restore()

    if (block) drawTextBlock(ctx, block, 140 * u, py + imgH + 88 * u, P.ink)
  } else if (m.content) {
    // 纯文字:standfirst 垂直居中于剩余空间
    const block = fitTextBlock(ctx, m.content, {
      maxWidth: W - 280 * u, sizes: [50, 46, 42, 38, 34, 30].map(s => s * u), lineHeight: 1.8,
      maxBlockH: H - 260 * u - 480 * u,
    })
    const zoneTop = 300 * u
    const zoneBottom = H - 250 * u
    const startY = zoneTop + Math.max(0, (zoneBottom - zoneTop - block.blockH) / 2)
    drawTextBlock(ctx, block, 140 * u, startY, P.ink)
  }

  ctx.strokeStyle = rgba(P.sub, 0.35)
  ctx.lineWidth = 2 * u
  ctx.beginPath()
  ctx.moveTo(140 * u, H - 190 * u)
  ctx.lineTo(W - 140 * u, H - 190 * u)
  ctx.stroke()
  drawCoverByline(ctx, m, P, u, 140 * u, H - 118 * u)
  drawCoverFooter(ctx, P, m, u, W, { y: H - 118 * u, xRight: W - 140 * u, brand: false })
}

// ── C 卡片拼贴风：暖底 + 拍立得相片卡 + 手作细节 ──
function renderCollage(ctx, m, u, W, H) {
  // 画布底：奶油纸 + 角落几何小点缀
  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, W, H)
  const blob = (cx, cy, r, color) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  }
  blob(W * 0.1, H * 0.03, W * 0.5, rgba(C.coral, 0.1))
  blob(W * 0.96, H * 0.97, W * 0.45, 'rgba(178, 196, 214, 0.18)')
  ctx.strokeStyle = rgba(C.coral, 0.3)
  ctx.lineWidth = 5 * u
  ctx.beginPath()
  ctx.arc(102 * u, H - 92 * u, 13 * u, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(W - 148 * u, 116 * u)
  ctx.lineTo(W - 148 * u, 148 * u)
  ctx.moveTo(W - 164 * u, 132 * u)
  ctx.lineTo(W - 132 * u, 132 * u)
  ctx.stroke()
  ctx.fillStyle = rgba(C.coral, 0.32)
  ctx.beginPath()
  ctx.arc(W - 84 * u, H - 148 * u, 7 * u, 0, Math.PI * 2)
  ctx.fill()

  // 主卡片
  const cardX = 64 * u, cardW = W - 128 * u, cardTop = 92 * u, cardH = H - 184 * u
  const cardBottom = cardTop + cardH
  ctx.save()
  ctx.shadowColor = 'rgba(84, 61, 50, 0.12)'
  ctx.shadowBlur = 56 * u
  ctx.shadowOffsetY = 20 * u
  ctx.fillStyle = C.card
  roundRectPath(ctx, cardX, cardTop, cardW, cardH, 44 * u)
  ctx.fill()
  ctx.restore()

  const inner = 64 * u
  const contentX = cardX + inner
  const contentW = cardW - inner * 2

  // 身份行
  const headTop = cardTop + 56 * u
  const headBottom = drawIdentityRow(ctx, m, u, {
    x: contentX, top: headTop, avatarD: 104 * u, nameSize: 42 * u, timeSize: 24 * u,
    color: C.ink, timeColor: C.muted,
  })

  const footerBaseline = cardBottom - 62 * u
  const dividerY = footerBaseline - 52 * u
  const textBottomLimit = dividerY - 44 * u
  const hasImages = m.images.length > 0
  const cursorStart = headBottom + 52 * u

  const block = m.content
    ? fitTextBlock(ctx, m.content, {
        maxWidth: contentW,
        sizes: [40, 36, 32, 28, 26].map(s => s * u),
        lineHeight: 1.72,
        maxBlockH: Math.max(240 * u, textBottomLimit - cursorStart - (hasImages ? 900 * u : 0)),
      })
    : null
  const textTop = block ? textBottomLimit - block.blockH : null

  let cursor = cursorStart

  if (hasImages) {
    // 拍立得：主照片 + 后面探出的相片角 + 和纸胶带
    const photoBottom = textTop ? textTop - 48 * u : dividerY - 60 * u
    const areaH = Math.max(560 * u, photoBottom - cursor)
    const stackH = Math.min(areaH, cardBottom - 160 * u - cursor)
    const tiltBleed = 34 * u
    const stackW = Math.min(contentW - tiltBleed * 2, 820 * u)
    const stackX = contentX + (contentW - stackW) / 2
    const chrome = 22 * u
    const captionH = 58 * u

    const drawPolaroid = (frame, rot, imgItem, behind) => {
      ctx.save()
      ctx.translate(frame.x + frame.w / 2, frame.y + frame.h / 2)
      ctx.rotate(rot)
      const px = -frame.w / 2, py = -frame.h / 2
      ctx.shadowColor = 'rgba(84, 61, 50, 0.16)'
      ctx.shadowBlur = 34 * u
      ctx.shadowOffsetY = 14 * u
      ctx.fillStyle = '#ffffff'
      roundRectPath(ctx, px, py, frame.w, frame.h, 10 * u)
      ctx.fill()
      resetDecoration(ctx)
      if (imgItem) {
        const imgF = { x: px + chrome, y: py + chrome, w: frame.w - chrome * 2, h: frame.h - chrome * 2 - captionH }
        ctx.save()
        roundRectPath(ctx, imgF.x, imgF.y, imgF.w, imgF.h, 6 * u)
        ctx.clip()
        if (behind) {
          ctx.fillStyle = mixHex(m.dominant || C.cream, '#ffffff', 0.35)
          ctx.fillRect(imgF.x, imgF.y, imgF.w, imgF.h)
        } else {
          drawImageSmart(ctx, imgItem.img, imgF, m.dominant)
        }
        ctx.restore()
        if (!behind && m.date) {
          setFont(ctx, 400, 24 * u)
          ctx.fillStyle = C.muted
          ctx.textAlign = 'center'
          ctx.fillText(m.date, 0, frame.h / 2 - captionH * 0.36)
          ctx.textAlign = 'left'
        }
      }
      ctx.restore()
    }

    if (m.images.length === 2) {
      // 两张并排，各自微微倾角
      const halfW = (stackW - 26 * u) / 2
      const halfH = stackH * 0.74
      drawPolaroid({ x: stackX, y: cursor + 34 * u, w: halfW, h: halfH }, -0.035, m.images[0], false)
      drawPolaroid({ x: stackX + halfW + 26 * u, y: cursor + 8 * u, w: halfW, h: halfH }, 0.03, m.images[1], false)
    } else {
      const mainW = m.images.length === 1 ? stackW : stackW * 0.84
      const mainFrame = { x: stackX + (stackW - mainW) / 2, y: cursor + 14 * u, w: mainW, h: stackH }
      if (m.images.length >= 3) {
        drawPolaroid({ ...mainFrame, x: mainFrame.x - 30 * u, y: mainFrame.y + 18 * u }, -0.075, m.images[1], true)
        drawPolaroid({ ...mainFrame, x: mainFrame.x + 30 * u, y: mainFrame.y - 10 * u }, 0.055, m.images[2], true)
      }
      drawPolaroid(mainFrame, -0.02, m.images[0], false)
      // 和纸胶带压在主照片顶边
      ctx.save()
      ctx.translate(mainFrame.x + mainFrame.w / 2, mainFrame.y - 4 * u)
      ctx.rotate(-0.05)
      ctx.fillStyle = rgba(C.coral, 0.38)
      ctx.fillRect(-74 * u, -22 * u, 148 * u, 44 * u)
      ctx.restore()
    }
    if (block) {
      drawTextBlock(ctx, block, contentX, textTop, C.ink)
    }
  } else if (block) {
    // 纯文字帖：卡片里排大字 + 引号点缀
    setFont(ctx, 700, 150 * u)
    ctx.fillStyle = rgba(C.coral, 0.15)
    ctx.fillText('”', cardX + cardW - 200 * u, headTop + 158 * u)
    drawTextBlock(ctx, block, contentX, cursor + 30 * u, C.ink)
  }

  // 手写感虚线分隔 + 水印
  ctx.save()
  ctx.strokeStyle = rgba(C.coral, 0.38)
  ctx.lineWidth = 4 * u
  ctx.setLineDash([14 * u, 12 * u])
  ctx.beginPath()
  ctx.moveTo(contentX + contentW / 2 - 90 * u, dividerY)
  ctx.lineTo(contentX + contentW / 2 + 90 * u, dividerY)
  ctx.stroke()
  ctx.restore()

  drawWatermark(ctx, m, u, { cx: W / 2, baseline: footerBaseline, color: C.muted, size: 23 })
}

// ── D 角色杂志风：巨字刊头 + 全幅出血主视觉 + 骑缝日期签，随图染色 ──
function renderEditorial(ctx, m, u, W, H) {
  const tint = m.dominant
  const padX = 84 * u
  drawAmbient(ctx, W, H, { tintHex: tint })

  // 刊头：名字巨字 + 珊瑚粗短线
  setFont(ctx, 700, 88 * u)
  ctx.fillStyle = C.ink
  ctx.fillText(ellipsize(ctx, m.name, W - padX * 2), padX, 196 * u)
  ctx.fillStyle = C.coral
  roundRectPath(ctx, padX, 232 * u, 96 * u, 10 * u, 5 * u)
  ctx.fill()

  const footerLineY = H - 128 * u
  const textW = W - padX * 2 - 34 * u
  const block = m.content
    ? fitTextBlock(ctx, m.content, {
        maxWidth: textW, sizes: [38, 34, 31, 28].map(s => s * u), lineHeight: 1.72, maxBlockH: 460 * u,
      })
    : null

  if (m.images.length) {
    // 主视觉：左右出血顶满画布
    const imgTop = 292 * u
    let imgH = H - imgTop - 224 * u - (block ? block.blockH + 128 * u : 0)
    imgH = Math.max(760 * u, Math.min(imgH, 1230 * u))
    const imgFrame = { x: 0, y: imgTop, w: W, h: imgH }
    ctx.save()
    roundRectPath(ctx, 0, imgTop, W, imgH, [0, 0, 26 * u, 26 * u])
    ctx.clip()
    drawImageSmart(ctx, m.images[0].img, imgFrame, tint)
    // 底缘轻压暗，衬浮层元素
    const footShade = ctx.createLinearGradient(0, imgTop + imgH - 170 * u, 0, imgTop + imgH)
    footShade.addColorStop(0, 'rgba(20, 14, 10, 0)')
    footShade.addColorStop(1, 'rgba(20, 14, 10, 0.2)')
    ctx.fillStyle = footShade
    ctx.fillRect(0, imgTop + imgH - 170 * u, W, 170 * u)
    ctx.restore()

    // 骑缝日期签：珊瑚胶囊从左缘探出，压在图片下边缘上
    const edgeY = imgTop + imgH
    setFont(ctx, 700, 26 * u)
    const tw = ctx.measureText(m.time).width
    const pillH = 62 * u
    ctx.fillStyle = C.coral
    roundRectPath(ctx, 0, edgeY - pillH / 2, tw + 64 * u, pillH, [0, pillH / 2, pillH / 2, 0])
    ctx.fill()
    ctx.fillStyle = C.card
    ctx.fillText(m.time, 32 * u, edgeY + 9 * u)

    // 头像印记：白环圆片骑在图片下边缘右侧
    drawAvatar(ctx, m.avatarImg, W - padX - 62 * u, edgeY, 62 * u, m.name, '#fffdfb')

    // 正文：左肩珊瑚引言竖线
    if (block) {
      const textTop = edgeY + 104 * u
      ctx.fillStyle = rgba(C.coral, 0.55)
      roundRectPath(ctx, padX, textTop + 10 * u, 7 * u, block.blockH - 14 * u, 4 * u)
      ctx.fill()
      drawTextBlock(ctx, block, padX + 34 * u, textTop, C.ink)
    }
  } else if (block) {
    // 纯文字：巨字日期底纹 + 引言竖线大字正文
    const day = (m.date || '').split('.')[2]
    if (day) {
      setFont(ctx, 700, 470 * u)
      ctx.fillStyle = rgba(C.coral, 0.09)
      ctx.textAlign = 'right'
      ctx.fillText(day, W - padX * 0.5, 640 * u)
      ctx.textAlign = 'left'
    }
    const big = fitTextBlock(ctx, m.content, {
      maxWidth: textW, sizes: [52, 48, 44, 40, 36, 32].map(s => s * u), lineHeight: 1.78,
      maxBlockH: footerLineY - 330 * u,
    })
    const textTop = 330 * u
    ctx.fillStyle = rgba(C.coral, 0.55)
    roundRectPath(ctx, padX, textTop + 10 * u, 7 * u, Math.min(big.blockH, footerLineY - 380 * u) - 14 * u, 4 * u)
    ctx.fill()
    drawTextBlock(ctx, big, padX + 34 * u, textTop, C.ink)
  }

  // 底栏：细线 + 品牌 + 小心心
  ctx.strokeStyle = rgba(C.ink, 0.15)
  ctx.lineWidth = 2 * u
  ctx.beginPath()
  ctx.moveTo(padX, footerLineY)
  ctx.lineTo(W - padX, footerLineY)
  ctx.stroke()
  setFont(ctx, 400, 24 * u, 4)
  ctx.fillStyle = C.muted
  ctx.fillText('邻舍.EXE', padX, footerLineY + 54 * u)
  try { ctx.letterSpacing = '0px' } catch { /* ignore */ }
  drawHeart(ctx, W - padX - 12 * u, footerLineY + 46 * u, 26 * u, rgba(C.coral, 0.8))
}

// ── E 极简社交分享风：暖白、居中、大留白 ──
function renderMinimal(ctx, m, u, W, H) {
  ctx.fillStyle = C.card
  ctx.fillRect(0, 0, W, H)

  // 居中身份
  const cx = W / 2
  const avatarR = 58 * u
  drawAvatar(ctx, m.avatarImg, cx, 104 * u + avatarR, avatarR, m.name)
  setFont(ctx, 700, 42 * u)
  ctx.fillStyle = C.ink
  ctx.textAlign = 'center'
  ctx.fillText(ellipsize(ctx, m.name, 640 * u), cx, 104 * u + avatarR * 2 + 64 * u)
  setFont(ctx, 400, 25 * u)
  ctx.fillStyle = C.muted
  ctx.fillText(m.time, cx, 104 * u + avatarR * 2 + 112 * u)
  ctx.textAlign = 'left'

  const contentTop = 104 * u + avatarR * 2 + 172 * u
  const footerBaseline = H - 72 * u
  const padX = 96 * u
  const textW = W - padX * 2

  const block = m.content
    ? fitTextBlock(ctx, m.content, {
        maxWidth: textW, sizes: [40, 36, 32, 28, 26].map(s => s * u), lineHeight: 1.76, maxBlockH: 560 * u,
      })
    : null

  if (m.images.length) {
    const hasText = !!block
    const naturalImgH = m.images.length === 1 && m.images[0].img
      ? (W - padX * 2) / Math.max(0.42, m.images[0].aspect)
      : Infinity
    const textSpace = hasText ? block.blockH + 72 * u : 0
    let imgH = Math.min(1280 * u, H - contentTop - 44 * u - textSpace - 140 * u, Math.max(naturalImgH, 820 * u))
    imgH = Math.max(imgH, Math.min(820 * u, H - contentTop - 44 * u - textSpace - 140 * u))

    ctx.save()
    ctx.shadowColor = 'rgba(84, 61, 50, 0.08)'
    ctx.shadowBlur = 40 * u
    ctx.shadowOffsetY = 14 * u
    ctx.fillStyle = '#ffffff'
    roundRectPath(ctx, padX, contentTop, W - padX * 2, imgH, 26 * u)
    ctx.fill()
    ctx.restore()
    drawImageGrid(ctx, m, u, {
      x: padX, y: contentTop, w: W - padX * 2, h: imgH, gap: 14 * u, radius: 26 * u, tintHex: m.dominant,
    })

    if (hasText) drawTextBlock(ctx, block, padX, contentTop + imgH + 70 * u, C.ink)
  } else if (block) {
    // 纯文字：居中排版
    ctx.textAlign = 'center'
    const startY = contentTop + Math.max(0, (H - 240 * u - contentTop - block.blockH) / 2)
    ctx.fillStyle = C.ink
    setFont(ctx, 400, block.size)
    block.lines.forEach((line, i) => {
      ctx.fillText(line, cx, startY + block.lh * (i + 0.78))
    })
    ctx.textAlign = 'left'
    ctx.fillStyle = rgba(C.coral, 0.55)
    roundRectPath(ctx, cx - 44 * u, startY + block.blockH + 56 * u, 88 * u, 6 * u, 3 * u)
    ctx.fill()
  }

  drawWatermark(ctx, m, u, { cx, baseline: footerBaseline, color: C.muted, size: 23 })
}

// ════════════════════════ F 角色特刊 Editorial Cover ════════════════════════
// 刻意区别于前五套的「卡片式社交 UI」：这一套把帖子重排成一本角色杂志的封面/画册页。
// - 头像不再是视觉主体：只作为角落里的作者署名，或在部分构图中隐藏
// - 角色名字本身是版面元素：巨字 / 竖排名 / 图版后的背景字
// - 日期与品牌用 editorial 排印（09 / 02 / 2026、CHARACTER EDITION、邻舍.EXE、VOL.）
// - 底色 / 墨色 / 点缀全部由原图主色 + 整体明度推导，暗图深底银白字，亮图米白底深字
// - 人脸保护区：大字只压画面下部或躲在图版后方，不与上部人物主体争夺

function extractLuminance(img) {
  try {
    const n = 10
    const cv = document.createElement('canvas')
    cv.width = n; cv.height = n
    const g = cv.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0, n, n)
    const d = g.getImageData(0, 0, n, n).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    return sum / (n * n * 255)
  } catch {
    return 0.5
  }
}

/** 由主色 + 明度推导特刊调色板：暗图 → 深底银白字；亮图 → 米白底深字 */
function deriveCoverPalette(dominant, lum, variant = 'immersive') {
  let h = 0.07, s = 0.45
  if (dominant) {
    const [hh, ss] = rgbToHsl(...hexToRgb(dominant))
    h = hh; s = ss
  }
  const dark = lum < 0.52
  if (dark) {
    if (variant === 'magazine') {
      // 杂志深色:柔和炭色底,低饱和、更轻,像哑光铜版纸
      return {
        dark,
        bg: hslToHex(h, Math.min(0.18, Math.max(0.08, s * 0.5)), 0.23),
        bgDeep: hslToHex(h, Math.min(0.22, s * 0.6), 0.17),
        ink: hslToHex(h, 0.12, 0.95),
        sub: hslToHex(h, 0.1, 0.68),
        accent: hslToHex(h, Math.min(0.45, Math.max(0.28, s * 0.9)), 0.64),
      }
    }
    // 沉浸深色:更深、色相更足的电影感染色深底
    return {
      dark,
      bg: hslToHex(h, Math.min(0.32, Math.max(0.14, s * 0.75)), 0.16),
      bgDeep: hslToHex(h, Math.min(0.36, Math.max(0.16, s * 0.85)), 0.11),
      ink: hslToHex(h, 0.14, 0.95),
      sub: hslToHex(h, 0.12, 0.72),
      accent: hslToHex(h, Math.min(0.55, Math.max(0.32, s)), 0.7),
    }
  }
  const tint = hslToHex(h, Math.min(0.42, s), 0.86)
  if (variant === 'magazine') {
    // 杂志亮色:更轻、更中性的暖纸,主色倾向收得更淡
    return {
      dark,
      bg: mixHex('#f7f3ec', tint, 0.12),
      bgDeep: mixHex('#efe9df', tint, 0.18),
      ink: '#332c26',
      sub: '#8c8074',
      accent: hslToHex(h, Math.min(0.46, Math.max(0.28, s * 0.9)), 0.54),
    }
  }
  // 沉浸亮色:暖纸底,主色倾向更明显、更暖
  return {
    dark,
    bg: mixHex('#f5efe7', tint, 0.22),
    bgDeep: mixHex('#ece4d8', tint, 0.3),
    ink: '#332c26',
    sub: '#8c8074',
    accent: hslToHex(h, Math.min(0.5, Math.max(0.3, s)), 0.52),
  }
}

function editorialDate(m) {
  const d = m.post && m.post.created_at ? new Date(m.post.created_at) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  const p = v => String(v).padStart(2, '0')
  return `${p(d.getMonth() + 1)} / ${p(d.getDate())} / ${d.getFullYear()}`
}

function featureVolNo(m) {
  const d = m.post && m.post.created_at ? new Date(m.post.created_at) : null
  if (!d || Number.isNaN(d.getTime())) return 'VOL.0000'
  const p = v => String(v).padStart(2, '0')
  return `VOL.${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** 单行展示文字：从上限字号收缩到能放进 maxWidth */
function fitLineSize(ctx, text, weight, maxSize, maxWidth, trackingRatio = 0) {
  let size = maxSize
  for (; size > 22; size -= 4) {
    setFont(ctx, weight, size, Math.round(size * trackingRatio))
    if (ctx.measureText(text).width <= maxWidth) break
  }
  setFont(ctx, weight, size, Math.round(size * trackingRatio))
  return size
}

/** 竖排文字（逐字下排），返回结束 y */
function drawStackedVertical(ctx, text, cx, startY, size, color, weight = 700) {
  setFont(ctx, weight, size)
  ctx.textAlign = 'center'
  let y = startY
  ctx.fillStyle = color
  for (const ch of String(text)) {
    ctx.fillText(ch, cx, y + size * 0.78)
    y += size * 1.08
  }
  ctx.textAlign = 'left'
  return y
}

function drawCoverKicker(ctx, palette, u, x, y, { onPhoto = false } = {}) {
  setFont(ctx, 400, 23 * u, 9 * u)
  ctx.fillStyle = onPhoto ? 'rgba(255, 253, 251, 0.92)' : palette.sub
  if (onPhoto) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
    ctx.shadowBlur = 10 * u
  }
  ctx.fillText('CHARACTER EDITION', x, y)
  resetDecoration(ctx)
}

function drawCoverFooter(ctx, palette, m, u, W, { y, x = 84 * u, xRight = null, brand = true }) {
  if (brand) {
    setFont(ctx, 400, 21 * u, 6 * u)
    ctx.fillStyle = palette.sub
    ctx.fillText('邻舍.EXE', x, y)
  }
  setFont(ctx, 400, 21 * u, 4 * u)
  ctx.fillStyle = palette.sub
  ctx.textAlign = 'right'
  ctx.fillText(featureVolNo(m), xRight ?? (W - x), y)
  ctx.textAlign = 'left'
  try { ctx.letterSpacing = '0px' } catch { /* ignore */ }
}

/** 作者署名：小头像 + 名字 + 品牌，头像在这里只是角落里的一枚印记 */
function drawCoverByline(ctx, m, palette, u, x, baselineY, { avatarR = 22, nameSize = 25 } = {}) {
  const r = avatarR * u, ns = nameSize * u
  drawAvatar(ctx, m.avatarImg, x + r, baselineY - r * 0.42, r, m.name)
  const nx = x + r * 2 + 18 * u
  setFont(ctx, 700, ns)
  ctx.fillStyle = palette.ink
  ctx.fillText(m.name, nx, baselineY)
  const nw = ctx.measureText(m.name).width
  setFont(ctx, 400, ns - 3 * u, 3 * u)
  ctx.fillStyle = palette.sub
  ctx.fillText('邻舍.EXE', nx + nw + 20 * u, baselineY)
}

/**
 * 特刊通用几何：正文先排版，主图吃掉剩余空间的绝大部分。
 * 图高下限/上限可调(占画布高比例)—— 无论正文长短，图片都不会失去视觉重点；
 * 正文与图之间只保留最小缝，消除大段死留白。
 * 入参 top / footerZoneY / captionGap 均为已乘 u 的像素值。
 */
function coverBlockAndImageH(ctx, m, u, H, { top, footerZoneY, captionGap, maxWidth, minFooterGap = 60, sizes = [36, 33, 30, 27], minImg = 0.45, maxImg = 0.58 }) {
  const avail = footerZoneY - minFooterGap * u - top
  const minImgH = minImg * H
  const block = m.content
    ? fitTextBlock(ctx, m.content, {
        maxWidth,
        sizes: sizes.map(s => s * u),
        lineHeight: 1.7,
        maxBlockH: Math.max(180 * u, avail - captionGap - minImgH),
      })
    : null
  const textH = block ? block.blockH : 0
  const imgH = Math.max(minImgH, Math.min(maxImg * H, avail - textH - captionGap))
  return { block, imgH, slack: Math.max(0, avail - imgH - textH - captionGap) }
}

// ════════════════════════ G 胶片日记 Film Diary ════════════════════════
// 把一条朋友圈当成从角色私人胶卷里抽出来的一帧：
// 齿孔 + 片基 + ROLL/FRAME 印刷编号 + 拍摄备注 + 拍摄者署名。
// 片基颜色随原图气质变化：暖图 → 米棕暖白；冷图/暗图 → 石墨黑；高饱和 → 中性黑。
// 照片只加极轻的暗角与颗粒，不改动原始颜色与人脸细节。

function filmStamp(post) {
  const id = Number(post && post.id) || 1
  return {
    roll: `ROLL ${String((id % 48) + 1).padStart(3, '0')}`,
    frameNo: (id % 36) + 1,
    frame: `FRAME ${String((id % 36) + 1).padStart(2, '0')}`,
  }
}

function filmDateTime(m) {
  const d = m.post && m.post.created_at ? new Date(m.post.created_at) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  const p = v => String(v).padStart(2, '0')
  return `${p(d.getMonth() + 1)} / ${p(d.getDate())} / ${d.getFullYear()}   ${p(d.getHours())}:${p(d.getMinutes())}`
}

function deriveFilmPalette(dominant, lum) {
  let h = 0.07, s = 0.45
  if (dominant) {
    const [hh, ss] = rgbToHsl(...hexToRgb(dominant))
    h = hh; s = ss
  }
  const warm = h <= 0.13 || h >= 0.92
  if (lum < 0.46 || s > 0.58) {
    // 冷 / 暗 / 高饱和 → 黑片基 + 银白印字
    return {
      base: hslToHex(h, Math.min(0.16, s * 0.4), 0.08),
      hole: hslToHex(h, 0.1, 0.15),
      print: 'rgba(238, 235, 228, 0.82)',
      printSub: 'rgba(238, 235, 228, 0.48)',
      note: '#f2efe8',
    }
  }
  if (warm) {
    // 暖图 → 米棕片基 + 深棕印字
    return {
      base: hslToHex(h, 0.26, 0.88),
      hole: hslToHex(h, 0.24, 0.77),
      print: 'rgba(70, 50, 36, 0.82)',
      printSub: 'rgba(70, 50, 36, 0.5)',
      note: hslToHex(h, 0.3, 0.2),
    }
  }
  // 冷色亮图 → 蓝灰片基 + 石墨印字
  return {
    base: hslToHex(h, 0.09, 0.88),
    hole: hslToHex(h, 0.09, 0.77),
    print: 'rgba(50, 56, 64, 0.82)',
    printSub: 'rgba(50, 56, 64, 0.5)',
    note: hslToHex(h, 0.16, 0.22),
  }
}

/** 35mm 齿孔列：孔 44×34u、节距 78u,克制不抢戏 */
function drawSprocketRail(ctx, P, u, cx, H) {
  const holeW = 44 * u, holeH = 34 * u, pitch = 78 * u, r = 9 * u
  let y = (pitch - holeH) / 2 + 8 * u
  ctx.fillStyle = P.hole
  while (y + holeH <= H - 8 * u) {
    roundRectPath(ctx, cx - holeW / 2, y, holeW, holeH, r)
    ctx.fill()
    y += pitch
  }
}

/** 胶片帧照片：原图 + 极轻暗角/颗粒/灰尘,帧线勾边 */
function drawFilmFramePhoto(ctx, img, f, u, P) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(f.x, f.y, f.w, f.h)
  ctx.clip()
  if (img) {
    drawImageSmart(ctx, img, f, null)
  } else {
    // 无图时画一帧「空曝光」
    const g = ctx.createLinearGradient(f.x, f.y, f.x + f.w, f.y + f.h)
    g.addColorStop(0, P.hole)
    g.addColorStop(1, P.base)
    ctx.fillStyle = g
    ctx.fillRect(f.x, f.y, f.w, f.h)
  }
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2
  const vg = ctx.createRadialGradient(cx, cy, Math.min(f.w, f.h) * 0.44, cx, cy, Math.max(f.w, f.h) * 0.74)
  vg.addColorStop(0, 'rgba(8, 6, 4, 0)')
  vg.addColorStop(1, 'rgba(8, 6, 4, 0.15)')
  ctx.fillStyle = vg
  ctx.fillRect(f.x, f.y, f.w, f.h)
  ctx.globalAlpha = 0.045
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = i % 2 ? '#ffffff' : '#0a0806'
    ctx.fillRect(f.x + Math.random() * f.w, f.y + Math.random() * f.h, 2 * u, 2 * u)
  }
  ctx.globalAlpha = 0.16
  ctx.fillStyle = '#fff6ea'
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(f.x + Math.random() * f.w, f.y + Math.random() * f.h, 1.6 * u, 1.6 * u + Math.random() * 3 * u)
  }
  ctx.globalAlpha = 1
  ctx.restore()
  ctx.strokeStyle = P.printSub
  ctx.lineWidth = 2 * u
  ctx.strokeRect(f.x - 8 * u, f.y - 8 * u, f.w + 16 * u, f.h + 16 * u)
}

/** 胶片日记内部构图：A 单帧 / B 连续底片(接触印样) / C 拍摄手记 */
function pickFilmLayout(m, override = null, rand = Math.random) {
  if (override && ['A', 'B', 'C'].includes(override)) return override
  if (!m.images.length) return 'C'
  const weighted = pool => {
    const total = pool.reduce((s, [, w]) => s + w, 0)
    let r = rand() * total
    for (const [id, w] of pool) {
      if ((r -= w) <= 0) return id
    }
    return pool[0][0]
  }
  return weighted([['A', 4], ['C', 3], ['B', 2]])
}

// A：Single Frame —— 经典单帧,大图居中,下方 ROLL/FRAME + 日期时间 + 拍摄备注
function filmLayoutA(ctx, m, P, u, W, H) {
  drawSprocketRail(ctx, P, u, 52 * u, H)
  drawSprocketRail(ctx, P, u, W - 52 * u, H)

  const fx = 150 * u, fw = W - 300 * u
  const top = 140 * u
  const attrY = H - 88 * u
  const footerZoneY = attrY - 56 * u
  const { block, imgH } = coverBlockAndImageH(ctx, m, u, H, {
    top, footerZoneY, captionGap: 88 * u, maxWidth: fw, minImg: 0.5, maxImg: 0.62,
  })
  drawFilmFramePhoto(ctx, m.images[0]?.img, { x: fx, y: top, w: fw, h: imgH }, u, P)

  const stamp = filmStamp(m.post)
  const infoY = top + imgH + 66 * u
  setFont(ctx, 700, 24 * u, 3 * u)
  ctx.fillStyle = P.print
  ctx.fillText(`${stamp.roll} / ${stamp.frame}`, fx, infoY)
  setFont(ctx, 400, 22 * u, 2 * u)
  ctx.fillStyle = P.printSub
  ctx.textAlign = 'right'
  ctx.fillText(filmDateTime(m), fx + fw, infoY)
  ctx.textAlign = 'left'

  if (block) drawTextBlock(ctx, block, fx, infoY + 46 * u, P.note)

  // 署名:这卷胶片是谁拍的
  const r = 24 * u
  drawAvatar(ctx, m.avatarImg, fx + r, attrY - r * 0.5, r, m.name)
  const nx = fx + r * 2 + 16 * u
  setFont(ctx, 700, 25 * u)
  ctx.fillStyle = P.note
  ctx.fillText(m.name, nx, attrY)
  setFont(ctx, 400, 20 * u, 3 * u)
  ctx.fillStyle = P.printSub
  ctx.textAlign = 'right'
  ctx.fillText('邻舍.EXE', fx + fw, attrY)
  ctx.textAlign = 'left'
  try { ctx.letterSpacing = '0px' } catch { /* ignore */ }
}

// B：Contact Sheet —— 主图之下带一排「前一帧 / 当前帧 / 下一帧」的空白缩略帧位
function filmLayoutB(ctx, m, P, u, W, H) {
  drawSprocketRail(ctx, P, u, 52 * u, H)
  drawSprocketRail(ctx, P, u, W - 52 * u, H)

  const fx = 150 * u, fw = W - 300 * u
  const top = 130 * u
  const attrY = H - 88 * u
  const stripH = 116 * u
  const footerZoneY = attrY - 56 * u
  const { block, imgH } = coverBlockAndImageH(ctx, m, u, H, {
    top, footerZoneY, captionGap: 56 * u + stripH + 48 * u + 44 * u, maxWidth: fw, minImg: 0.48, maxImg: 0.56,
  })
  drawFilmFramePhoto(ctx, m.images[0]?.img, { x: fx, y: top, w: fw, h: imgH }, u, P)

  // 连续胶片暗示:三个空白帧位,中间是当前 FRAME,只有编号没有内容
  const stamp = filmStamp(m.post)
  const stripY = top + imgH + 56 * u
  const cw = (fw - 48 * u) / 3
  for (let i = 0; i < 3; i++) {
    const cx0 = fx + i * (cw + 24 * u)
    const isCurrent = i === 1
    ctx.fillStyle = isCurrent ? P.hole : mixHex(P.base, P.hole, 0.45)
    roundRectPath(ctx, cx0, stripY, cw, stripH, 6 * u)
    ctx.fill()
    if (isCurrent) {
      ctx.strokeStyle = P.print
      ctx.lineWidth = 3 * u
      roundRectPath(ctx, cx0 + 7 * u, stripY + 7 * u, cw - 14 * u, stripH - 14 * u, 4 * u)
      ctx.stroke()
    }
    setFont(ctx, 400, 20 * u, 2 * u)
    ctx.fillStyle = isCurrent ? P.print : P.printSub
    ctx.textAlign = 'center'
    ctx.fillText(`FRAME ${String(Math.max(1, stamp.frameNo - 1 + i)).padStart(2, '0')}`, cx0 + cw / 2, stripY + stripH / 2 + 7 * u)
    ctx.textAlign = 'left'
  }

  const infoY = stripY + stripH + 52 * u
  setFont(ctx, 700, 24 * u, 3 * u)
  ctx.fillStyle = P.print
  ctx.fillText(`${stamp.roll} / ${stamp.frame}`, fx, infoY)
  setFont(ctx, 400, 22 * u, 2 * u)
  ctx.fillStyle = P.printSub
  ctx.textAlign = 'right'
  ctx.fillText(filmDateTime(m), fx + fw, infoY)
  ctx.textAlign = 'left'

  if (block) drawTextBlock(ctx, block, fx, infoY + 46 * u, P.note)

  const r = 24 * u
  drawAvatar(ctx, m.avatarImg, fx + r, attrY - r * 0.5, r, m.name)
  const nx = fx + r * 2 + 16 * u
  setFont(ctx, 700, 25 * u)
  ctx.fillStyle = P.note
  ctx.fillText(m.name, nx, attrY)
  setFont(ctx, 400, 20 * u, 3 * u)
  ctx.fillStyle = P.printSub
  ctx.textAlign = 'right'
  ctx.fillText('邻舍.EXE', fx + fw, attrY)
  ctx.textAlign = 'left'
  try { ctx.letterSpacing = '0px' } catch { /* ignore */ }
}

// C：Film Diary —— 大图占上半,下方像摄影师手记:日期 / 拍摄者 / 备注,更温暖生活化
function filmLayoutC(ctx, m, P, u, W, H) {
  drawSprocketRail(ctx, P, u, 52 * u, H)
  drawSprocketRail(ctx, P, u, W - 52 * u, H)

  const fx = 150 * u, fw = W - 300 * u
  const top = 120 * u
  const attrY = H - 84 * u
  const footerZoneY = attrY - 48 * u
  const { imgH } = coverBlockAndImageH(ctx, m, u, H, {
    top, footerZoneY, captionGap: 210 * u, maxWidth: fw, minImg: 0.5, maxImg: 0.62,
    sizes: [36, 33, 30, 28, 26],
  })
  drawFilmFramePhoto(ctx, m.images[0]?.img, { x: fx, y: top, w: fw, h: imgH }, u, P)

  const stamp = filmStamp(m.post)
  const dateY = top + imgH + 72 * u
  setFont(ctx, 400, 23 * u, 3 * u)
  ctx.fillStyle = P.print
  ctx.fillText(filmDateTime(m), fx, dateY)

  setFont(ctx, 700, 46 * u)
  ctx.fillStyle = P.note
  ctx.fillText(m.name, fx, dateY + 64 * u)

  if (m.content) {
    const noteTop = dateY + 108 * u
    const block = fitTextBlock(ctx, m.content, {
      maxWidth: fw, sizes: [36, 33, 30, 28, 26].map(s => s * u), lineHeight: 1.72,
      maxBlockH: Math.max(160 * u, footerZoneY - 40 * u - noteTop),
    })
    drawTextBlock(ctx, block, fx, noteTop, P.note)
  }

  const r = 24 * u
  drawAvatar(ctx, m.avatarImg, fx + r, attrY - r * 0.5, r, m.name)
  const nx = fx + r * 2 + 16 * u
  setFont(ctx, 700, 24 * u, 2 * u)
  ctx.fillStyle = P.print
  ctx.fillText(`${stamp.roll} / ${stamp.frame}`, nx, attrY)
  setFont(ctx, 400, 20 * u, 3 * u)
  ctx.fillStyle = P.printSub
  ctx.textAlign = 'right'
  ctx.fillText('邻舍.EXE', fx + fw, attrY)
  ctx.textAlign = 'left'
  try { ctx.letterSpacing = '0px' } catch { /* ignore */ }
}

function renderFilmDiary(ctx, m, u, W, H) {
  const lum = m.images[0]?.img ? extractLuminance(m.images[0].img) : 0.5
  const P = deriveFilmPalette(m.dominant, lum)
  // 片基底色 + 边缘微暗,让整张看起来是一截真实胶片
  ctx.fillStyle = P.base
  ctx.fillRect(0, 0, W, H)
  const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.74)
  edge.addColorStop(0, 'rgba(0, 0, 0, 0)')
  edge.addColorStop(1, 'rgba(0, 0, 0, 0.1)')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, W, H)

  const layout = pickFilmLayout(m, m.featureLayoutOverride || null)
  if (layout === 'B') filmLayoutB(ctx, m, P, u, W, H)
  else if (layout === 'C') filmLayoutC(ctx, m, P, u, W, H)
  else filmLayoutA(ctx, m, P, u, W, H)
}

const RENDERERS = {
  magazine: renderMagazine,
  immersive: renderImmersive,
  collage: renderCollage,
  editorial: renderEditorial,
  minimal: renderMinimal,
  feature: renderFilmDiary,
}

// ════════════════════════ 版式选择 ════════════════════════

/**
 * 按内容智能 + 加权随机挑一套版式：
 * - 无图 → 文字排版型（杂志 / 拼贴 / 刊风 / 简约；特刊依赖配图，不参与）
 * - 单图竖/方 + 文字不长 → 沉浸式权重最高，特刊次之
 * - 单图横图 / 超长图 → 杂志 / 简约（模糊延展 / 完整展示）
 * - 多图 → 拼贴 / 杂志网格
 */
export function pickMomentStyle(post, { firstImageAspect = 1, rand = Math.random } = {}) {
  const n = (post.images || []).filter(Boolean).length
  const textLen = String(post.content || '').trim().length
  const weighted = pool => {
    const total = pool.reduce((s, [, w]) => s + w, 0)
    let r = rand() * total
    for (const [id, w] of pool) {
      if ((r -= w) <= 0) return id
    }
    return pool[0][0]
  }
  if (!n) return weighted([['magazine', 3], ['collage', 3], ['editorial', 2], ['minimal', 2]])
  if (n === 1) {
    if (firstImageAspect >= 0.85 && textLen <= 180) {
      return weighted([['immersive', 5], ['editorial', 3], ['feature', 3], ['magazine', 2], ['minimal', 1]])
    }
    if (firstImageAspect < 0.45) {
      return weighted([['magazine', 3], ['minimal', 3], ['feature', 2], ['collage', 2], ['editorial', 1]])
    }
    return weighted([['magazine', 3], ['editorial', 3], ['feature', 2], ['minimal', 2], ['collage', 2]])
  }
  return weighted([['collage', 4], ['minimal', 2], ['feature', 1], ['magazine', 1]])
}

// ════════════════════════ 主入口 ════════════════════════

/**
 * 渲染朋友圈分享海报。
 * @param {Object} post  朋友圈帖子（images / avatar_path / display_name / content / created_at）
 * @param {Object} [options]
 * @param {string} [options.styleId] 版式 id（见 MOMENT_SHARE_STYLES）；'auto' 或缺省 = 智能选择
 * @param {number} [options.width]  画布宽，默认 1080（高 = width * 16 / 9，即 1080×1920；传 1440 得 1440×2560）
 * @returns {Promise<{ canvas: HTMLCanvasElement, styleId: string }>}
 */
export async function renderMomentShareCard(post, options = {}) {
  const { styleId = 'auto', width = 1080, featureLayout = null } = options
  await ensureFonts()
  const m = await buildModel(post)
  if (featureLayout) m.featureLayoutOverride = featureLayout

  const resolved = STYLE_IDS.has(styleId)
    ? styleId
    : pickMomentStyle(post, { firstImageAspect: m.images[0]?.aspect || 1 })
  const W = Math.round(width)
  const H = Math.round(width * 16 / 9)
  const u = W / 1080
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  RENDERERS[resolved](ctx, m, u, W, H)
  return { canvas, styleId: resolved }
}
