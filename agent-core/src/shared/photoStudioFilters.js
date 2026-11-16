// Photo studio filters: catalog, legacy identifiers and pixel processing.
// Artwork colors are fixed output colors, independent of the UI theme.
export const STUDIO_FILTERS = [
  {
    "value": "none",
    "label": "原色"
  },
  {
    "value": "clear",
    "label": "闪光过曝"
  },
  {
    "value": "cream",
    "label": "糖果双色"
  },
  {
    "value": "sunset",
    "label": "熔岩日落"
  },
  {
    "value": "moon",
    "label": "赛博霓虹"
  },
  {
    "value": "silver",
    "label": "黑白木刻"
  },
  {
    "value": "pop",
    "label": "波普网点"
  },
  {
    "value": "glitch",
    "label": "RGB 故障"
  },
  {
    "value": "cyanotype",
    "label": "蓝晒负片"
  },
  {
    "value": "risograph",
    "label": "孔版错印"
  },
  {
    "value": "stipple",
    "label": "彩点喷绘"
  },
  {
    "value": "kaleido",
    "label": "万花镜"
  },
  {
    "value": "zoom",
    "label": "放射拖影"
  },
  {
    "value": "triprism",
    "label": "三棱分身"
  },
  {
    "value": "starflare",
    "label": "星芒闪耀"
  },
  {
    "value": "popquad",
    "label": "四宫撞色"
  },
  {
    "value": "bubblelens",
    "label": "泡泡折射"
  },
  {
    "value": "heartglass",
    "label": "粉色心形"
  },
  {
    "value": "markercolor",
    "label": "马克笔稿"
  },
  {
    "value": "papercutprint",
    "label": "剪纸分色"
  },
  {
    "value": "redstamp",
    "label": "朱砂拓印"
  }
]
const retiredFilters = new Set(["spotlight","redroom","cinema","bleach","crossprocess","velvet","peach","aurora","jade","hologram","neonedge","chalk","inkwash","watercolor","impasto","comicink","cmyk","stitch","woven","glass","cubist","papercut","engraving","echo","ripple","fisheye","mirror","disco","panrush","spinrush","spiralfall","burstfocus","crystaltunnel","liquidchrome","lenticular","shutterslice","ribbontwist","vortextunnel","tinyplanet","shattermirror","slitscan","lightwriting","silvernegative","whiteburn","electricarc","contactprint","tornzones","radialdots","giantshadow","chromakey","datamelt","sunleak","dewglass","honeyglass","starglass","orbglass","diamondglass","ninepop","diagonalduo","orbitportraits","photostickers","roundwindows","magazinetrio","heartbokeh","butterflylight","meteors","diamondglitter","pearls","auroradust","floatingcrystal","snowlight","ribbonlight","neonheart","starrings","rosehalo","mangaink","shojotone","heroink","comicpaint","noirpanel","screentone","bluepencil","graphitesketch","charcoaldraw","waxcrayon","colorhatch","cmykpress","bigscreen","crossscreen","typepress","newspaperink","stencilcut","neoncontour","brushreserve","offsetduo","analog","solar","pixel","thermal","infrared","etch","emboss","terminal","contour"])
export function normalizeStudioFilter(filter) { return retiredFilters.has(filter) ? 'none' : filter }

const printFilterIds = new Set(['markercolor', 'papercutprint', 'redstamp'])
const clip = value => Math.max(0, Math.min(255, value))

function createPrintFilter(id, source, width, height, noise) {
  if (!printFilterIds.has(id)) return null
  const s = Math.min(width, height), unit = Math.max(1, s / 330)
  const index = (x, y) => Math.max(0, Math.min(height - 1, Math.round(y))) * width + Math.max(0, Math.min(width - 1, Math.round(x)))
  const lights = new Float32Array(width * height)
  for (let i = 0; i < lights.length; i++) lights[i] = source[i * 4] * .2126 + source[i * 4 + 1] * .7152 + source[i * 4 + 2] * .0722
  const light = (x, y) => lights[index(x, y)]
  const edge = (x, y) => {
    const a = light(x - unit, y - unit), b = light(x, y - unit), c = light(x + unit, y - unit)
    const d = light(x - unit, y), f = light(x + unit, y)
    const g = light(x - unit, y + unit), h = light(x, y + unit), i = light(x + unit, y + unit)
    return Math.hypot(c + 2 * f + i - a - 2 * d - g, g + 2 * h + i - a - 2 * b - c) / 4
  }
  const lineCoverage = (x, y, size, angle, coverage) => {
    const v = (x * Math.cos(angle) + y * Math.sin(angle)) / size
    return v - Math.floor(v) < coverage
  }
  return (x, y, r, g, b, luma) => {
    const color = [r, g, b], e = edge(x, y)
    switch (id) {
      case 'markercolor': {
        const band = Math.floor((x + y * .35) / (unit * 8)), streak = noise(band, 71)
        const q = color.map(v => clip(Math.round(v / 55) * 64 + 5))
        const seam = lineCoverage(x, y, unit * 8, .337, .13)
        return e > 45 ? [40, 27, 66] : q.map(v => v * (seam ? .68 : .88 + streak * .18))
      }
      case 'papercutprint': {
        const palette = [[42, 35, 88], [87, 91, 172], [239, 110, 139], [255, 188, 140], [255, 231, 183]]
        const band = Math.min(4, Math.floor(luma / 51))
        const back = Math.min(4, Math.floor(light(x - unit * 3, y - unit * 4) / 51))
        return back < band ? palette[band].map(v => v * .7) : palette[band]
      }
      case 'redstamp': {
        const grain = noise(Math.floor(x / (unit * 1.5)), Math.floor(y / unit))
        return (luma < 180 || e > 35) && grain > .12 ? [190, 31, 52] : [255, 233, 211]
      }
      default: return color
    }
  }
}

function createPrismFilter(id, source, width, height, noise) {
  if (id !== 'heartglass') return createPrintFilter(id, source, width, height, noise)
  const cell = Math.min(width, height) * .3
  return (x, y, r, g, b) => {
    const row = Math.floor(y / cell), shift = row % 2 * cell * .5
    const cx = Math.floor((x + shift) / cell) * cell - shift + cell / 2, cy = row * cell + cell / 2
    const u = (x - cx) / (cell * .41), v = (y - cy) / (cell * .41)
    const a = u * u + v * v - 1
    return a * a * a + u * u * v * v * v <= 0 ? [r, g, b] : [255, 164, 197]
  }
}

const opticalFilterIds = new Set(['triprism', 'starflare', 'popquad', 'bubblelens'])
const clamp = v => Math.max(0, Math.min(255, v))
const lum = color => color[0] * .2126 + color[1] * .7152 + color[2] * .0722
const posterPalettes = [
  [[47, 15, 92], [217, 48, 154], [255, 158, 184], [255, 228, 111]],
  [[29, 13, 67], [163, 13, 69], [255, 75, 27], [255, 229, 78]],
  [[17, 12, 62], [92, 26, 210], [246, 20, 192], [96, 255, 236]],
  [[16, 52, 62], [0, 150, 136], [189, 228, 25], [255, 245, 201]],
]
const poster = (color, palette) => palette[Math.min(3, Math.floor(lum(color) / 64))]


function createOpticalFilter(id, source, width, height, noise) {
  if (!opticalFilterIds.has(id)) return createPrismFilter(id, source, width, height, noise)
  const s = Math.min(width, height)
  const sample = (x, y, c) => source[(Math.max(0, Math.min(height - 1, Math.round(y))) * width + Math.max(0, Math.min(width - 1, Math.round(x)))) * 4 + c]
  const rgb = (x, y) => [sample(x, y, 0), sample(x, y, 1), sample(x, y, 2)]
  const light = (x, y) => sample(x, y, 0) * .2126 + sample(x, y, 1) * .7152 + sample(x, y, 2) * .0722
  const screen = (color, glow) => color.map((v, c) => 255 - (255 - clamp(v)) * (1 - clamp(glow[c]) / 255))
  const contrast = (color, gain = 1.25) => color.map(v => (v - 110) * gain + 115)
  // Use local highlight contrast, not a bright paper background, to place a handful of star flares.
  const stars = []
  if (id === 'starflare') {
    const candidates = []
    for (let j = 1; j < 20; j++) for (let i = 1; i < 16; i++) {
      const x = width * i / 16, y = height * j / 20, l = light(x, y)
      const neighbors = (light(x + s * .025, y) + light(x - s * .025, y) + light(x, y + s * .025) + light(x, y - s * .025)) / 4
      candidates.push({ x, y, score: (l - neighbors) * Math.max(0, l - 130) })
    }
    candidates.sort((a, b) => b.score - a.score)
    for (const point of candidates) if (point.score > 0 && stars.every(other => Math.hypot(other.x - point.x, other.y - point.y) > s * .16)) { stars.push(point); if (stars.length === 6) break }
  }
  return (x, y, r, g, b) => {
    const original = [r, g, b], nx = x / width, ny = y / height
    switch (id) {
      case 'triprism': {
        const left = rgb(x + width * .23, y + height * .035), right = rgb(x - width * .23, y - height * .035)
        const pane = nx < .34 ? left : nx > .66 ? right : original
        const tint = nx < .34 ? [1.12, .72, 1.3] : nx > .66 ? [.65, 1.15, 1.2] : [1.1, 1, .9]
        const seam = Math.min(Math.abs(nx - .34), Math.abs(nx - .66)) < .006
        return seam ? [255, 246, 221] : pane.map((v, c) => (v - 95) * tint[c] * 1.3 + 90)
      }
      case 'starflare': {
        let sparkle = 0, halo = 0
        for (const point of stars) {
          const ax = Math.abs(x - point.x) / s, ay = Math.abs(y - point.y) / s
          sparkle += Math.exp(-ay / .0025 - ax / .12) + Math.exp(-ax / .0025 - ay / .12)
          sparkle += .35 * Math.exp(-Math.abs(ax - ay) / .0025 - (ax + ay) / .1)
          halo += Math.exp(-(ax * ax + ay * ay) / .0025)
        }
        return screen(contrast(original, 1.3).map(v => v * .48), [sparkle * 300 + halo * 110, sparkle * 265 + halo * 45, sparkle * 230 + halo * 145])
      }
      case 'popquad': {
        const col = Math.floor(nx * 2), row = Math.floor(ny * 2), u = nx * 2 % 1, v = ny * 2 % 1
        if (u < .012 || v < .012) return [245, 231, 201]
        return poster(rgb(u * width, v * height), posterPalettes[row * 2 + col])
      }
      case 'bubblelens': {
        const size = s / 7, row = Math.floor(y / size), shift = row % 2 * size / 2
        const cx = Math.floor((x + shift) / size) * size - shift + size / 2, cy = row * size + size / 2
        const ox = (x - cx) / (size * .47), oy = (y - cy) / (size * .47), distance = Math.hypot(ox, oy)
        if (distance > 1) return [25, 29, 64]
        const color = rgb(cx + ox * size * (.25 + distance * .3), cy + oy * size * (.25 + distance * .3))
        const glint = Math.exp(-((ox + .35) ** 2 + (oy + .4) ** 2) * 45) * 160 + (distance > .94 ? 70 : 0)
        return screen(color, [glint, glint, glint + 10])
      }
      default: return original
    }
  }
}

function createEffectFilter(id, source, width, height, noise) {
  if (id !== 'zoom') return createOpticalFilter(id, source, width, height, noise)
  const sample = (x, y, c) => source[(Math.max(0, Math.min(height - 1, Math.round(y))) * width + Math.max(0, Math.min(width - 1, Math.round(x)))) * 4 + c]
  return (x, y, r, g, b) => {
    const color = [r * .3, g * .3, b * .3]
    for (let j = 1; j <= 7; j++) { const factor = 1 - j * .024; for (let c = 0; c < 3; c++) color[c] += sample(width / 2 + (x - width / 2) * factor, height / 2 + (y - height / 2) * factor, c) * .1 }
    return color.map(v => (v - 100) * 1.25 + 110)
  }
}

export function applyStudioFilter(context, width, height, recipe, noise) {
  if (recipe.filter === 'none' || recipe.intensity === 0) return
  const image = context.getImageData(0, 0, width, height), data = image.data
  const source = new Uint8ClampedArray(data), amount = recipe.intensity / 100
  const unit = Math.max(1, Math.round(Math.min(width, height) / 180)), dot = Math.max(3, unit * 3)
  const at = (x, y, channel) => source[(Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4 + channel]
  const luminance = (r, g, b) => r * .2126 + g * .7152 + b * .0722
  const lumAt = (x, y) => luminance(at(x, y, 0), at(x, y, 1), at(x, y, 2))
  const clamp = value => Math.max(0, Math.min(255, value))
  const art = createEffectFilter(recipe.filter, source, width, height, noise)
  const palettes = {
    cream: [[66, 24, 95], [218, 71, 174], [255, 164, 190], [255, 231, 129]],
    sunset: [[27, 13, 69], [113, 16, 79], [243, 47, 34], [255, 153, 21], [255, 238, 128]],
    moon: [[10, 4, 40], [72, 18, 172], [238, 20, 190], [20, 219, 245], [193, 255, 246]],
    pop: [[35, 22, 78], [233, 44, 125], [24, 195, 219], [255, 213, 43], [255, 248, 201]],
  }
  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % width, y = Math.floor(i / 4 / width)
    const r = source[i], g = source[i + 1], b = source[i + 2], luma = luminance(r, g, b)
    let rr = r, gg = g, bb = b
    const palette = palettes[recipe.filter]
    if (art) {
      ;[rr, gg, bb] = art(x, y, r, g, b, luma)
    } else if (palette) {
      let value = luma
      const index = Math.max(0, Math.min(palette.length - 1, Math.floor(value / 256 * palette.length)))
      ;[rr, gg, bb] = palette[index]
      // Candy and neon retain a little local hue while radically remapping the tonal structure.
      if (recipe.filter === 'cream' || recipe.filter === 'moon') { rr = rr * .88 + r * .12; gg = gg * .88 + g * .12; bb = bb * .88 + b * .12 }
      if (recipe.filter === 'pop') {
        const dx = (x % dot) - dot / 2, dy = (y % dot) - dot / 2
        const radius = dot * (.12 + (1 - luma / 255) * .32)
        if (dx * dx + dy * dy < radius * radius) { rr *= .2; gg *= .2; bb *= .25 }
      }
    } else switch (recipe.filter) {
      case 'clear': {
        const q = value => Math.round(Math.max(0, Math.min(255, (value - 90) * 2.3 + 105)) / 64) * 64
        rr = q(r); gg = q(g); bb = q(b) + 14
        break
      }
      case 'silver': {
        const edge = Math.abs(luma - luminance(at(x + unit, y, 0), at(x + unit, y, 1), at(x + unit, y, 2)))
        const hatch = (x + y) % Math.max(3, unit * 4) < unit
        rr = gg = bb = edge > 20 || luma < 92 || (luma < 185 && hatch) ? 12 : luma < 150 ? 90 : 250
        break
      }
      case 'glitch': {
        const band = Math.floor(y / Math.max(2, unit * 7))
        const shift = Math.round((noise(band, 31) - .5) * unit * (band % 5 === 0 ? 24 : 5))
        rr = (at(x + shift + unit * 3, y, 0) - 100) * 1.5 + 120
        gg = (at(x + shift, y, 1) - 100) * 1.3 + 100
        bb = (at(x + shift - unit * 3, y, 2) - 100) * 1.5 + 135
        if (y % Math.max(2, unit * 3) < unit) { rr *= .65; gg *= .65; bb *= .65 }
        break
      }
      case 'cyanotype': {
        const exposure = Math.pow(1 - luma / 255, .7)
        rr = 8 + exposure * 217; gg = 28 + exposure * 222; bb = 94 + exposure * 158
        break
      }
      case 'risograph': {
        const blueInk = clamp((175 - lumAt(x + unit * 3, y)) * 2) / 255
        const redInk = clamp((205 - lumAt(x - unit * 3, y + unit)) * 1.6) / 255
        const coverage = ((x + y) % (unit * 4) < unit ? .42 : 1)
        rr = 248 - blueInk * 214 * coverage; gg = 233 - redInk * 158 - blueInk * 70; bb = 205 - redInk * 130 + blueInk * 20
        break
      }
      case 'stipple': {
        const size = unit * 5, cx = Math.floor(x / size), cy = Math.floor(y / size)
        const px = cx * size + Math.round(size * .5), py = cy * size + Math.round(size * .5)
        const value = lumAt(px, py), jitterX = (noise(cx, cy) - .5) * size * .35, jitterY = (noise(cy, cx + 17) - .5) * size * .35
        const radius = size * (.13 + (1 - value / 255) * .42)
        const inside = (x - px - jitterX) ** 2 + (y - py - jitterY) ** 2 < radius * radius
        ;[rr, gg, bb] = inside ? [at(px, py, 0) * 1.25, at(px, py, 1) * .85, at(px, py, 2) * 1.15] : [255, 237, 188]
        break
      }
      case 'kaleido': {
        const dx = (x - width / 2) / width, dy = (y - height / 2) / height
        const radius = Math.hypot(dx, dy), sector = Math.PI / 3
        let angle = ((Math.atan2(dy, dx) % sector) + sector) % sector
        if (angle > sector / 2) angle = sector - angle
        const px = Math.round(width * (.5 + Math.cos(angle + Math.PI / 3) * radius)), py = Math.round(height * (.5 - Math.sin(angle + Math.PI / 3) * radius))
        rr = (at(px, py, 0) - 110) * 1.35 + 135; gg = (at(px, py, 1) - 110) * 1.2 + 100; bb = (at(px, py, 2) - 110) * 1.4 + 150
        break
      }
    }
    const texture = recipe.grain && ['silver', 'glitch'].includes(recipe.filter) ? (noise(x, y) - .5) * 26 : 0
    data[i] = r + (clamp(rr + texture) - r) * amount
    data[i + 1] = g + (clamp(gg + texture) - g) * amount
    data[i + 2] = b + (clamp(bb + texture) - b) * amount
  }
  context.putImageData(image, 0, 0)
}
