<template>
  <div class="town-view" ref="viewEl">
    <canvas
      ref="canvasEl"
      class="town-canvas"
      :class="{ 'is-hoverable': !!hoverCharId }"
      @click="onCanvasClick"
      @mousemove="onCanvasHover"
      @mouseleave="hoverCharId = null"
    ></canvas>

    <div class="town-topbar">
      <div class="town-title-row">
        <span class="town-title">世界</span>
        <span class="town-sub">{{ map?.name || '邻舍小镇' }}</span>
      </div>
      <div class="town-chips">
        <span v-if="weatherText" class="town-chip">{{ weatherIcon }} {{ weatherText }}</span>
        <span v-if="weather?.timeDesc" class="town-chip">{{ weather.timeDesc }}</span>
        <span class="town-chip">{{ agents.length }} 位邻居</span>
        <span v-if="!connected" class="town-chip is-warn">连接中…</span>
      </div>
    </div>

    <div class="town-hint">点击空地走过去 · 点一点邻居打个招呼</div>

    <div v-if="loadError" class="town-loadstate">
      <p>{{ loadError }}</p>
      <linshe-button variant="secondary" size="sm" @click="retryLoad">重试</linshe-button>
    </div>

    <!-- 角色资料卡（设计系统：Toast 扩展式弹窗，近实心暖底，不叠毛玻璃） -->
    <Teleport to="body">
      <Transition name="town-modal">
        <div v-if="selectedChar" class="town-card-mask" @click.self="selectedCharId = null">
          <div class="town-card" role="dialog" aria-label="邻居资料">
            <div class="tc-head">
              <div
                class="tc-avatar"
                :style="selectedChar.avatarPath
                  ? { backgroundImage: `url(${selectedChar.avatarPath})` }
                  : { background: 'var(--accent)' }"
              >{{ selectedChar.avatarPath ? '' : selectedChar.displayName.charAt(0) }}</div>
              <div class="tc-head-info">
                <div class="tc-name">{{ selectedChar.displayName }}</div>
                <div class="tc-status-line">
                  <template v-if="selectedChar.sleeping">😴 睡得正香</template>
                  <template v-else-if="encounterPartnerName">💬 正在和 {{ encounterPartnerName }} 聊天</template>
                  <template v-else>📍 {{ selectedChar.locationName || '小镇某处' }} · {{ selectedChar.activityText || '自由活动' }}</template>
                </div>
              </div>
              <linshe-button variant="icon" size="sm" aria-label="关闭" @click="selectedCharId = null">✕</linshe-button>
            </div>

            <div class="tc-tags">
              <span v-if="selectedChar.mood?.dominantEmotion" class="tc-tag">{{ selectedChar.mood.dominantEmotion }}</span>
              <span v-if="selectedChar.locationName" class="tc-tag is-soft">{{ selectedChar.locationName }}</span>
              <span v-if="selectedChar.mood" class="tc-tag is-soft">
                心情 {{ moodLabel(selectedChar.mood.valence) }}
              </span>
            </div>

            <div class="tc-actions">
              <linshe-button variant="primary" size="sm" @click="goChat(selectedChar.characterId)">去聊天</linshe-button>
              <linshe-button variant="ghost" size="sm" @click="selectedCharId = null">先不了</linshe-button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useTownStore } from '../stores/town.js'
import { useChatStore } from '../stores/chat.js'
import LinsheButton from '../components/ui/LinsheButton.vue'

const town = useTownStore()
const chat = useChatStore()
const router = useRouter()
const { map, locations, agents, player, weather, loaded, connected } = storeToRefs(town)

// ── 画布与渲染状态 ──
const viewEl = ref(null)
const canvasEl = ref(null)
const hoverCharId = ref(null)
const selectedCharId = ref(null)
const loadError = ref('')

let ctx = null
let rafId = 0
let staticCanvas = null
let staticDirty = true
let cssW = 0
let cssH = 0
let cell = 24
let originX = 0
let originY = 0
let resizeObserver = null
let lastFrameTs = 0

// 头像 / 立绘图片缓存
const imgCache = new Map()
function getImg(url) {
  if (!url) return null
  let entry = imgCache.get(url)
  if (!entry) {
    const img = new Image()
    entry = { img, ok: false }
    img.onload = () => { entry.ok = true }
    img.onerror = () => { entry.ok = false }
    img.src = url
    imgCache.set(url, entry)
  }
  return entry.ok ? entry.img : null
}

const selectedChar = computed(() => agents.value.find(a => a.characterId === selectedCharId.value) || null)

const encounterPartnerName = computed(() => {
  const c = selectedChar.value
  if (!c?.encounterId) return null
  const enc = town.encountersActive.find(e => e.id === c.encounterId)
  if (!enc) return null
  const otherId = enc.a === c.characterId ? enc.b : enc.a
  return agents.value.find(a => a.characterId === otherId)?.displayName || null
})

const weatherText = computed(() => {
  const w = weather.value
  if (!w) return ''
  return [w.text, w.temperature != null ? `${w.temperature}°C` : ''].filter(Boolean).join(' ')
})

const weatherIcon = computed(() => {
  const t = weather.value?.text || ''
  if (/雷/.test(t)) return '⛈️'
  if (/雨/.test(t)) return '🌧️'
  if (/雪/.test(t)) return '❄️'
  if (/雾|霾/.test(t)) return '🌫️'
  if (/阴/.test(t)) return '☁️'
  if (/云/.test(t)) return '⛅'
  if (/晴/.test(t)) return '☀️'
  return '🌤️'
})

function moodLabel(valence) {
  if (valence == null) return '平静'
  if (valence > 0.3) return '不错'
  if (valence < -0.3) return '有点低落'
  return '平静'
}

// ── 交互 ──

function screenToGrid(cssX, cssY) {
  return {
    x: Math.floor((cssX - originX) / cell),
    y: Math.floor((cssY - originY) / cell),
  }
}

function agentDisplayPos(a, nowMs) {
  // 插值用 epoch 毫秒（与 store 的 moveStartedAt 同基准）；nowMs 只用于动画相位
  if (!a.path || a.path.length === 0 || !a.moveStartedAt) {
    return { x: a.x, y: a.y, moving: false, dx: 0 }
  }
  const cells = ((Date.now() - a.moveStartedAt) / 1000) * (a.speed || 0.5)
  if (cells <= 0) return { x: a.x, y: a.y, moving: true, dx: 0 }
  const idx = Math.floor(cells)
  if (idx >= a.path.length) return { x: a.path[a.path.length - 1].x, y: a.path[a.path.length - 1].y, moving: false, dx: 0 }
  const prev = idx === 0 ? { x: a.x, y: a.y } : a.path[idx - 1]
  const target = a.path[idx]
  const frac = cells - idx
  return {
    x: prev.x + (target.x - prev.x) * frac,
    y: prev.y + (target.y - prev.y) * frac,
    moving: true,
    dx: target.x - prev.x,
  }
}

function hitTestAgent(cssX, cssY, nowMs) {
  for (const a of agents.value) {
    const pos = agentDisplayPos(a, nowMs)
    const px = originX + (pos.x + 0.5) * cell
    const py = originY + (pos.y + 0.5) * cell - cell * 0.35
    const dx = cssX - px
    const dy = cssY - (py - cell * 0.4)
    if (Math.abs(dx) < cell * 0.75 && Math.abs(dy) < cell * 1.1) return a
  }
  return null
}

function onCanvasHover(e) {
  const a = hitTestAgent(e.offsetX, e.offsetY, performance.now())
  hoverCharId.value = a ? a.characterId : null
}

function onCanvasClick(e) {
  if (!loaded.value || !map.value) return
  const nowMs = performance.now()
  const hit = hitTestAgent(e.offsetX, e.offsetY, nowMs)
  if (hit) {
    selectedCharId.value = hit.characterId
    return
  }
  const g = screenToGrid(e.offsetX, e.offsetY)
  if (g.x < 0 || g.y < 0 || g.x >= map.value.cols || g.y >= map.value.rows) return
  town.movePlayer(g.x, g.y).catch(err => {
    console.warn('[town] move failed:', err?.message)
  })
}

async function goChat(characterId) {
  selectedCharId.value = null
  try {
    await chat.selectChar(characterId)
    router.push('/chat/' + characterId)
  } catch (err) {
    router.push('/chat/' + characterId)
  }
}

function retryLoad() {
  loadError.value = ''
  town.fetchState().catch(err => {
    loadError.value = '世界暂时联系不上：' + (err?.message || '未知错误')
  })
}

// ── 静态地图层 ──

function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const ROOF_COLORS = {
  cafe: '#e8a598', restaurant: '#e8b98a', library: '#a9b9cf',
  store: '#a8c8a0', apartment: '#cf9a8a', park: '#9dbd94', plaza: '#d9c9a2',
}
const POI_ICONS = {
  cafe: '☕', restaurant: '🍜', library: '📚', store: '🛒',
  apartment: '🏠', park: '🌳', plaza: '⛲',
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

function buildingRect(loc) {
  // 与后端 townSeed.buildingCells 一致：锚点上方 5×4
  return {
    x: originX + (loc.x - 2) * cell,
    y: originY + (loc.y - 4) * cell,
    w: cell * 5,
    h: cell * 4,
  }
}

function drawStatic() {
  if (!map.value) return
  staticCanvas = staticCanvas || document.createElement('canvas')
  staticCanvas.width = Math.max(1, Math.round(cssW * (window.devicePixelRatio || 1)))
  staticCanvas.height = Math.max(1, Math.round(cssH * (window.devicePixelRatio || 1)))
  const c = staticCanvas.getContext('2d')
  c.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0)
  c.clearRect(0, 0, cssW, cssH)
  staticDirty = false

  const rand = mulberry32(20260905)
  const cols = map.value.cols
  const rows = map.value.rows

  // 草地底
  c.fillStyle = '#e9edda'
  c.fillRect(0, 0, cssW, cssH)

  // 草地噪点
  for (let i = 0; i < 420; i++) {
    const x = rand() * cssW
    const y = rand() * cssH
    c.fillStyle = rand() > 0.5 ? 'rgba(213,224,178,0.7)' : 'rgba(244,246,225,0.8)'
    c.beginPath()
    c.arc(x, y, 1 + rand() * 2.2, 0, Math.PI * 2)
    c.fill()
  }

  const locByKey = key => locations.value.find(l => l.key === key)
  const plaza = locByKey('plaza')

  // 小路：广场 → 各 POI 的 L 型路
  if (plaza) {
    c.lineCap = 'round'
    c.lineJoin = 'round'
    for (const loc of locations.value) {
      if (loc.id === plaza.id) continue
      const mx = originX + (plaza.x + 0.5) * cell
      const my = originY + (plaza.y + 0.5) * cell
      const tx = originX + (loc.x + 0.5) * cell
      const ty = originY + (loc.y + 0.5) * cell
      for (const [w, color] of [[cell * 0.85, '#e3d8bd'], [cell * 0.62, '#efe6cf']]) {
        c.strokeStyle = color
        c.lineWidth = w
        c.beginPath()
        c.moveTo(mx, my)
        c.lineTo(tx, my)
        c.lineTo(tx, ty)
        c.stroke()
      }
    }
  }

  // 广场圆盘 + 喷泉
  if (plaza) {
    const px = originX + (plaza.x + 0.5) * cell
    const py = originY + (plaza.y + 0.5) * cell
    c.fillStyle = '#f4edda'
    c.strokeStyle = '#e2d6ba'
    c.lineWidth = 2
    c.beginPath()
    c.arc(px, py, cell * 3.1, 0, Math.PI * 2)
    c.fill()
    c.stroke()
    c.fillStyle = '#cfe3ea'
    c.beginPath()
    c.arc(px, py, cell * 1.15, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.85)'
    c.lineWidth = 1.5
    c.beginPath()
    c.arc(px, py, cell * 0.62, 0, Math.PI * 2)
    c.stroke()
    c.font = `${Math.round(cell * 1.0)}px "HarmonyOS Sans SC", sans-serif`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('⛲', px, py - cell * 0.06)
  }

  // 公园草皮 + 树 + 花
  const park = locByKey('park')
  if (park) {
    const gx = originX + (park.x - 3.4) * cell
    const gy = originY + (park.y - 3.6) * cell
    roundRect(c, gx, gy, cell * 6.8, cell * 6.2, cell * 1.4)
    c.fillStyle = '#dce8c2'
    c.fill()
    const prand = mulberry32(7)
    // 草坪里的小花
    for (let i = 0; i < 8; i++) {
      const fx = gx + prand() * cell * 6.4 + cell * 0.2
      const fy = gy + prand() * cell * 5.8 + cell * 0.2
      c.fillStyle = prand() > 0.5 ? '#efb9c8' : '#f2d98c'
      c.beginPath()
      c.arc(fx, fy, 2.2, 0, Math.PI * 2)
      c.fill()
    }
    // 三棵树（错开锚点与名牌区）
    const treeSpots = [
      [park.x - 2.2, park.y - 2.3],
      [park.x + 2.3, park.y - 2.6],
      [park.x + 0.2, park.y + 2.2],
    ]
    for (const [tx, ty] of treeSpots) {
      const tpx = originX + (tx + 0.5) * cell
      const tpy = originY + (ty + 0.8) * cell
      c.fillStyle = 'rgba(90,70,50,0.12)'
      c.beginPath()
      c.ellipse(tpx, tpy + 2, cell * 0.4, cell * 0.13, 0, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#a3814f'
      c.fillRect(tpx - 2, tpy - cell * 0.5, 4, cell * 0.5)
      c.fillStyle = '#8fb886'
      c.beginPath()
      c.arc(tpx, tpy - cell * 0.85, cell * 0.55, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#a5c79a'
      c.beginPath()
      c.arc(tpx - cell * 0.16, tpy - cell * 1.0, cell * 0.26, 0, Math.PI * 2)
      c.fill()
    }
  }

  // 建筑（place/home POI）
  for (const loc of locations.value) {
    if (loc.kind === 'outdoor') continue
    const r = buildingRect(loc)
    // 落影
    roundRect(c, r.x + 3, r.y + 5, r.w, r.h, 9)
    c.fillStyle = 'rgba(90, 70, 50, 0.10)'
    c.fill()
    // 墙
    roundRect(c, r.x, r.y, r.w, r.h, 9)
    c.fillStyle = '#fbf6ec'
    c.fill()
    c.strokeStyle = '#e7dcc8'
    c.lineWidth = 1.5
    c.stroke()
    // 屋顶
    const roofH = r.h * 0.42
    roundRect(c, r.x - 3, r.y - 4, r.w + 6, roofH + 6, 9)
    c.fillStyle = ROOF_COLORS[loc.key] || '#d9c9a2'
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.35)'
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(r.x + 8, r.y - 1)
    c.lineTo(r.x + r.w - 8, r.y - 1)
    c.stroke()
    // 窗
    c.fillStyle = '#d9c9a8'
    c.fillRect(r.x + r.w * 0.16, r.y + roofH + 10, cell * 0.85, cell * 0.7)
    c.fillRect(r.x + r.w * 0.84 - cell * 0.85, r.y + roofH + 10, cell * 0.85, cell * 0.7)
    // 门（锚点正上方）
    c.fillStyle = '#8a6f52'
    const doorW = cell * 0.9
    const doorX = originX + (loc.x + 0.5) * cell - doorW / 2
    const doorY = r.y + r.h - cell * 1.05
    roundRect(c, doorX, doorY, doorW, cell * 1.05, 4)
    c.fill()
    // 屋顶图标
    c.font = `${Math.round(cell * 1.15)}px "HarmonyOS Sans SC", sans-serif`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(POI_ICONS[loc.key] || '🏠', r.x + r.w / 2, r.y + roofH / 2 + 2)
  }

  // 装饰树（撒在可走格、远离 POI）
  const inAnyRadius = (gx, gy) => locations.value.some(l => Math.max(Math.abs(gx - l.x), Math.abs(gy - l.y)) <= l.radius + 1)
  let planted = 0
  for (let i = 0; i < 400 && planted < 14; i++) {
    const gx = Math.floor(rand() * cols)
    const gy = Math.floor(rand() * rows)
    if (plaza && gx === plaza.x && gy === plaza.y) continue
    if (inAnyRadius(gx, gy)) continue
    const px = originX + (gx + 0.5) * cell
    const py = originY + (gy + 0.8) * cell
    // 阴影
    c.fillStyle = 'rgba(90,70,50,0.12)'
    c.beginPath()
    c.ellipse(px, py + 2, cell * 0.42, cell * 0.14, 0, 0, Math.PI * 2)
    c.fill()
    // 树干 + 树冠
    c.fillStyle = '#a3814f'
    c.fillRect(px - 2, py - cell * 0.5, 4, cell * 0.5)
    c.fillStyle = '#9dbd94'
    c.beginPath()
    c.arc(px, py - cell * 0.85, cell * 0.52, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#b3cfa9'
    c.beginPath()
    c.arc(px - cell * 0.16, py - cell * 0.98, cell * 0.26, 0, Math.PI * 2)
    c.fill()
    planted++
  }

  // POI 名牌（最后画，盖在路上）
  c.font = '10px "HarmonyOS Sans SC", sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  for (const loc of locations.value) {
    const label = loc.name
    const lx = originX + (loc.x + 0.5) * cell
    const ly = loc.kind === 'outdoor'
      ? originY + (loc.y + 1.7) * cell
      : originY + (loc.y + 0.9) * cell
    const wpx = c.measureText(label).width + 14
    roundRect(c, lx - wpx / 2, ly - 9, wpx, 18, 9)
    c.fillStyle = 'rgba(255,253,248,0.95)'
    c.fill()
    c.strokeStyle = '#e8ddd0'
    c.lineWidth = 1
    c.stroke()
    c.fillStyle = '#6b5c4d'
    c.fillText(label, lx, ly + 0.5)
  }
}

// ── 动态层 ──

function wrapText(text, maxChars) {
  const lines = []
  let cur = ''
  for (const ch of String(text)) {
    cur += ch
    if (cur.length >= maxChars) { lines.push(cur); cur = '' }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 3)
}

function drawBubble(c, a, px, py, nowMs) {
  const bubble = a.bubble
  if (!bubble) return
  const remain = bubble.until - Date.now()
  if (remain <= 0) { a.bubble = null; return }
  const alpha = Math.min(1, remain / 1500)

  const lines = wrapText(bubble.text, 12)
  const lineW = Math.max(...lines.map(l => l.length)) * 11 + 18
  const bw = Math.min(190, lineW)
  const bh = lines.length * 16 + 12
  const bx = px - bw / 2
  const by = py - cell * 1.55 - bh

  c.save()
  c.globalAlpha = alpha
  roundRect(c, bx, by, bw, bh, 9)
  c.fillStyle = 'rgba(255,254,250,0.96)'
  c.fill()
  c.strokeStyle = '#e8ddd0'
  c.lineWidth = 1
  c.stroke()
  // 尾巴
  c.beginPath()
  c.moveTo(px - 5, by + bh - 1)
  c.lineTo(px + 5, by + bh - 1)
  c.lineTo(px, by + bh + 6)
  c.closePath()
  c.fillStyle = 'rgba(255,254,250,0.96)'
  c.fill()

  c.fillStyle = '#4a3a2c'
  c.font = '11px "HarmonyOS Sans SC", sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  lines.forEach((line, i) => {
    c.fillText(line, px, by + 12 + i * 16)
  })
  c.restore()
}

function drawNameTag(c, px, py, name) {
  c.font = '10px "HarmonyOS Sans SC", sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  const w = c.measureText(name).width + 10
  roundRect(c, px - w / 2, py - 7, w, 15, 7)
  c.fillStyle = 'rgba(255,253,248,0.9)'
  c.fill()
  c.fillStyle = '#7a6a58'
  c.fillText(name, px, py + 0.5)
}

function drawToken(c, nowMs) {
  const drawables = []
  for (const a of agents.value) {
    const pos = agentDisplayPos(a, nowMs)
    drawables.push({ kind: 'agent', a, pos })
  }
  if (player.value) {
    const pos = agentDisplayPos({ ...player.value, path: player.value.path || [] }, nowMs)
    drawables.push({ kind: 'player', a: player.value, pos })
  }
  drawables.sort((p, q) => p.pos.y - q.pos.y)

  for (const d of drawables) {
    const px = originX + (d.pos.x + 0.5) * cell
    const baseY = originY + (d.pos.y + 0.5) * cell
    const isAgent = d.kind === 'agent'
    const a = d.a
    const phase = (a.characterId || 0) % 7
    const bob = d.pos.moving ? Math.sin(nowMs / 110 + phase) * 1.8 : Math.sin(nowMs / 900 + phase) * 1.1
    const sleeping = isAgent && a.sleeping
    const alpha = sleeping ? 0.85 : 1

    // 落影
    c.save()
    c.globalAlpha = alpha * 0.22
    c.fillStyle = '#3c2f22'
    c.beginPath()
    c.ellipse(px, baseY + cell * 0.34, cell * 0.5, cell * 0.17, 0, 0, Math.PI * 2)
    c.fill()
    c.restore()

    // 悬停 / 选中光环
    if (isAgent && (a.characterId === hoverCharId.value || a.characterId === selectedCharId.value)) {
      c.save()
      c.strokeStyle = 'rgba(224,123,108,0.55)'
      c.lineWidth = 2
      c.beginPath()
      c.ellipse(px, baseY + cell * 0.34, cell * 0.62, cell * 0.26, 0, 0, Math.PI * 2)
      c.stroke()
      c.restore()
    }

    const standing = isAgent ? getImg(a.standingUrl) : null
    const avatar = getImg(a.avatarPath)

    if (standing) {
      const h = cell * 2.15
      const w = h * (standing.naturalWidth && standing.naturalHeight ? standing.naturalWidth / standing.naturalHeight : 0.7)
      const flip = d.pos.moving && d.pos.dx < 0
      c.save()
      c.globalAlpha = alpha
      c.translate(px, baseY + cell * 0.38 - (sleeping ? 0 : Math.abs(bob)))
      if (flip) c.scale(-1, 1)
      try { c.drawImage(standing, -w / 2, -h, w, h) } catch { /* 图异常时跳过 */ }
      c.restore()
    } else {
      // 圆形头像 token（或玩家珊瑚色 token）
      const r = cell * 0.52
      const cy = baseY - cell * (isAgent ? 0.55 : 0.5) - bob
      c.save()
      c.globalAlpha = alpha
      c.beginPath()
      c.arc(px, cy, r, 0, Math.PI * 2)
      c.fillStyle = isAgent ? '#f6efe4' : '#e07b6c'
      c.fill()
      c.lineWidth = 2
      c.strokeStyle = 'rgba(255,255,255,0.95)'
      c.stroke()
      if (isAgent && avatar) {
        c.beginPath()
        c.arc(px, cy, r - 2, 0, Math.PI * 2)
        c.clip()
        const aw = r * 2
        try { c.drawImage(avatar, px - r, cy - r, aw, aw) } catch { /* ignore */ }
      } else {
        c.fillStyle = '#ffffff'
        c.font = `700 ${Math.round(cell * 0.5)}px "HarmonyOS Sans SC", sans-serif`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText(isAgent ? (a.displayName || '?').charAt(0) : '我', px, cy + 1)
      }
      c.restore()
    }

    // 名牌
    drawNameTag(c, px, baseY + cell * 0.62, a.displayName || '我')

    // 状态角标
    if (isAgent && sleeping) {
      c.font = `${Math.round(cell * 0.62)}px "HarmonyOS Sans SC", sans-serif`
      c.textAlign = 'center'
      c.globalAlpha = 0.5 + 0.5 * Math.sin(nowMs / 500 + phase)
      c.fillText('💤', px + cell * 0.62, baseY - cell * 1.35)
      c.globalAlpha = 1
    } else if (isAgent && a.encounterId) {
      c.font = `${Math.round(cell * 0.55)}px "HarmonyOS Sans SC", sans-serif`
      c.textAlign = 'center'
      c.fillText('💬', px + cell * 0.62, baseY - cell * 1.3)
    }

    // 气泡
    if (isAgent) drawBubble(c, a, px, baseY - cell * (standing ? 2.35 : 1.35), nowMs)
  }
}

function drawWeatherOverlay(c, nowMs) {
  const w = weather.value
  if (!w) return
  const hour = w.hour ?? new Date().getHours()
  let tint = null
  if (hour >= 20 || hour < 5) tint = 'rgba(30, 38, 72, 0.32)'
  else if (hour >= 17) tint = 'rgba(244, 160, 92, 0.14)'
  else if (hour < 8) tint = 'rgba(255, 205, 130, 0.10)'
  if (tint) {
    c.fillStyle = tint
    c.fillRect(0, 0, cssW, cssH)
  }
  const t = w.text || ''
  if (/雨/.test(t) && !/雷/.test(t)) {
    c.fillStyle = 'rgba(120, 140, 170, 0.12)'
    c.fillRect(0, 0, cssW, cssH)
    c.strokeStyle = 'rgba(160, 180, 210, 0.4)'
    c.lineWidth = 1.2
    c.beginPath()
    for (let i = 0; i < 36; i++) {
      const speed = 0.45 + (i % 5) * 0.07
      const x = (i * 173 + 40) % cssW
      const y = ((nowMs * speed + i * 137) % (cssH + 80)) - 40
      c.moveTo(x, y)
      c.lineTo(x - 4, y + 13)
    }
    c.stroke()
  } else if (/雪/.test(t)) {
    c.fillStyle = 'rgba(240, 245, 250, 0.5)'
    for (let i = 0; i < 28; i++) {
      const speed = 0.12 + (i % 4) * 0.03
      const x = (i * 211 + 60 + Math.sin(nowMs / 900 + i) * 14) % cssW
      const y = ((nowMs * speed + i * 97) % (cssH + 40)) - 20
      c.beginPath()
      c.arc(x, y, 1.6 + (i % 3) * 0.6, 0, Math.PI * 2)
      c.fill()
    }
  }
}

function draw(nowMs) {
  rafId = 0
  if (!ctx) return
  lastFrameTs = nowMs

  const dpr = window.devicePixelRatio || 1
  if (staticDirty) drawStatic()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  if (staticCanvas) ctx.drawImage(staticCanvas, 0, 0, cssW, cssH)

  drawWeatherOverlay(ctx, nowMs)
  if (loaded.value) drawToken(ctx, nowMs)
  else {
    ctx.fillStyle = '#8c8074'
    ctx.font = '13px "HarmonyOS Sans SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('正在唤醒这个世界…', cssW / 2, cssH / 2)
  }

  if (!document.hidden) rafId = requestAnimationFrame(draw)
}

// ── 布局 ──

function relayout() {
  if (!viewEl.value || !canvasEl.value || !map.value) return
  const rect = viewEl.value.getBoundingClientRect()
  cssW = Math.max(200, rect.width)
  cssH = Math.max(200, rect.height)
  const dpr = window.devicePixelRatio || 1
  canvasEl.value.width = Math.round(cssW * dpr)
  canvasEl.value.height = Math.round(cssH * dpr)
  canvasEl.value.style.width = `${cssW}px`
  canvasEl.value.style.height = `${cssH}px`
  const pad = 14
  cell = Math.min((cssW - pad * 2) / map.value.cols, (cssH - pad * 2 - 44) / map.value.rows)
  originX = (cssW - cell * map.value.cols) / 2
  originY = (cssH - cell * map.value.rows) / 2 + 14
  staticDirty = true
}

function onVisibility() {
  if (!document.hidden && rafId === 0) rafId = requestAnimationFrame(draw)
}

// ── 生命周期 ──

onMounted(async () => {
  ctx = canvasEl.value.getContext('2d')
  town.startTownStream()
  relayout()
  resizeObserver = new ResizeObserver(() => { relayout() })
  resizeObserver.observe(viewEl.value)
  document.addEventListener('visibilitychange', onVisibility)
  rafId = requestAnimationFrame(draw)

  try {
    await town.fetchState()
  } catch (err) {
    loadError.value = '世界暂时联系不上：' + (err?.message || '未知错误')
  }
  // 地图尺寸随快照到来后重排一次
  watch(map, () => { relayout() })
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
  document.removeEventListener('visibilitychange', onVisibility)
  town.stopTownStream()
})
</script>

<style scoped>
.town-view {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #e9edda;
}

.town-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.town-canvas.is-hoverable {
  cursor: pointer;
}

/* ── 顶栏浮层 ── */
.town-topbar {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 16px;
  background: rgba(252, 250, 247, 0.92);
  border: 1px solid rgba(232, 221, 208, 0.8);
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(54, 42, 38, 0.08);
  max-width: calc(100% - 24px);
}

.town-title-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}

.town-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-bright);
}

.town-sub {
  font-size: 11px;
  color: var(--text-secondary);
}

.town-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.town-chip {
  font-size: 11px;
  color: var(--text-primary);
  background: rgba(240, 236, 232, 0.85);
  border-radius: 999px;
  padding: 3px 9px;
  white-space: nowrap;
}

.town-chip.is-warn {
  color: var(--accent-hover);
}

/* ── 底部提示 ── */
.town-hint {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: rgba(90, 76, 60, 0.75);
  background: rgba(252, 250, 247, 0.82);
  padding: 4px 12px;
  border-radius: 999px;
  pointer-events: none;
  white-space: nowrap;
}

/* ── 加载失败 ── */
.town-loadstate {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(233, 237, 218, 0.9);
}

.town-loadstate p {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ── 资料卡 ── */
.town-card-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.town-card {
  width: 300px;
  max-width: calc(100vw - 40px);
  background: #f4f1eeed;
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.2);
  padding: 18px;
}

.tc-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tc-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
}

.tc-head-info {
  flex: 1;
  min-width: 0;
}

.tc-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-bright);
}

.tc-status-line {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tc-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}

.tc-tag {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(224, 123, 108, 0.12);
  color: var(--accent-hover);
}

.tc-tag.is-soft {
  background: rgba(240, 236, 232, 0.9);
  color: var(--text-secondary);
}

.tc-actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.tc-actions > * {
  flex: 1;
}

/* 弹窗过渡（与页面 fade 同族） */
.town-modal-enter-active,
.town-modal-leave-active {
  transition: opacity 0.2s ease;
}

.town-modal-enter-active .town-card,
.town-modal-leave-active .town-card {
  transition: transform 0.2s ease;
}

.town-modal-enter-from,
.town-modal-leave-to {
  opacity: 0;
}

.town-modal-enter-from .town-card,
.town-modal-leave-to .town-card {
  transform: scale(0.96);
}

@media (max-width: 767px) {
  .town-topbar {
    top: 8px;
    padding: 6px 12px;
    gap: 8px;
  }

  .town-title {
    font-size: 14px;
  }

  .town-hint {
    bottom: 10px;
  }
}
</style>
