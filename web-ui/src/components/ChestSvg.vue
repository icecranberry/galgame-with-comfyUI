<template>
  <svg
    class="chest-svg"
    :class="[`state-${state}`, { 'is-ready': ready, 'charging-max': boost }]"
    viewBox="20 22 480 356"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <!-- 漆木：暗酒红与乌木色构成主材质，避免高饱和卡通棕。 -->
      <linearGradient :id="ids.lacquerBody" x1="0" y1="0" x2="0.92" y2="1">
        <stop offset="0" stop-color="#673f45"/>
        <stop offset="0.3" stop-color="#492a32"/>
        <stop offset="0.72" stop-color="#2f1922"/>
        <stop offset="1" stop-color="#1b1018"/>
      </linearGradient>
      <linearGradient :id="ids.lacquerLid" x1="0.08" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="#85575a"/>
        <stop offset="0.26" stop-color="#5c343c"/>
        <stop offset="0.72" stop-color="#351c27"/>
        <stop offset="1" stop-color="#1d1119"/>
      </linearGradient>
      <linearGradient :id="ids.velvet" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#160e17"/>
        <stop offset="0.55" stop-color="#2b1725"/>
        <stop offset="1" stop-color="#512838"/>
      </linearGradient>
      <linearGradient :id="ids.velvetLight" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c98678" stop-opacity="0"/>
        <stop offset="1" stop-color="#c98678" stop-opacity="0.24"/>
      </linearGradient>

      <!-- 旧香槟金：高光带窄、暗面偏棕，保留金属重量。 -->
      <linearGradient :id="ids.brassV" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff0c5"/>
        <stop offset="0.16" stop-color="#dcb879"/>
        <stop offset="0.48" stop-color="#a77940"/>
        <stop offset="0.78" stop-color="#74502e"/>
        <stop offset="1" stop-color="#3c291f"/>
      </linearGradient>
      <linearGradient :id="ids.brassH" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#4a3021"/>
        <stop offset="0.14" stop-color="#b98b4d"/>
        <stop offset="0.46" stop-color="#f1d497"/>
        <stop offset="0.64" stop-color="#bd8b4d"/>
        <stop offset="1" stop-color="#493022"/>
      </linearGradient>
      <linearGradient :id="ids.brassFine" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f0d8a0"/>
        <stop offset="0.5" stop-color="#a97840"/>
        <stop offset="1" stop-color="#5c3b27"/>
      </linearGradient>
      <linearGradient :id="ids.metalSheen" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff7dc" stop-opacity="0"/>
        <stop offset="0.46" stop-color="#fff7dc" stop-opacity="0"/>
        <stop offset="0.5" stop-color="#fff7dc" stop-opacity="0.88"/>
        <stop offset="0.54" stop-color="#fff7dc" stop-opacity="0"/>
        <stop offset="1" stop-color="#fff7dc" stop-opacity="0"/>
      </linearGradient>
      <radialGradient :id="ids.garnet" cx="0.34" cy="0.28" r="0.78">
        <stop offset="0" stop-color="#ffe2c9"/>
        <stop offset="0.16" stop-color="#d88978"/>
        <stop offset="0.48" stop-color="#8f3548"/>
        <stop offset="0.82" stop-color="#451927"/>
        <stop offset="1" stop-color="#1a0c14"/>
      </radialGradient>
      <radialGradient :id="ids.lockCore" cx="0.5" cy="0.45" r="0.58">
        <stop offset="0" stop-color="#fff6d5"/>
        <stop offset="0.28" stop-color="#edc17d"/>
        <stop offset="0.72" stop-color="#a45c43"/>
        <stop offset="1" stop-color="#562436"/>
      </radialGradient>

      <!-- 光效全部压在低透明度，开启时才成为视觉主角。 -->
      <radialGradient :id="ids.ambient" cx="0.5" cy="0.52" r="0.5">
        <stop offset="0" stop-color="#f1bd75" stop-opacity="0.34"/>
        <stop offset="0.48" stop-color="#b8694d" stop-opacity="0.12"/>
        <stop offset="1" stop-color="#5a2635" stop-opacity="0"/>
      </radialGradient>
      <radialGradient :id="ids.ground" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#140b11" stop-opacity="0.74"/>
        <stop offset="0.66" stop-color="#1b0d14" stop-opacity="0.3"/>
        <stop offset="1" stop-color="#1b0d14" stop-opacity="0"/>
      </radialGradient>
      <linearGradient :id="ids.beam" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#fff1bf" stop-opacity="0.5"/>
        <stop offset="0.48" stop-color="#d99a5f" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#b16051" stop-opacity="0"/>
      </linearGradient>
      <linearGradient :id="ids.spill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f6d18d" stop-opacity="0.38"/>
        <stop offset="1" stop-color="#c56f59" stop-opacity="0"/>
      </linearGradient>

      <clipPath :id="ids.closedLidClip">
        <path d="M98 233V169Q98 133 132 110Q187 74 260 74Q333 74 388 110Q422 133 422 169V233Z"/>
      </clipPath>
      <clipPath :id="ids.openLidClip">
        <path d="M110 231V143Q110 96 154 71Q202 43 260 43Q318 43 366 71Q410 96 410 143V231Z"/>
      </clipPath>
      <clipPath :id="ids.bodyClip">
        <path d="M92 239H428V322Q428 340 410 340H110Q92 340 92 322Z"/>
      </clipPath>
      <clipPath :id="ids.lockClip">
        <path d="M231 213H289V268Q289 286 260 302Q231 286 231 268Z"/>
      </clipPath>
      <filter :id="ids.softGlow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="7"/>
      </filter>
    </defs>

    <!-- 舞台光与落地阴影 -->
    <ellipse class="ambient-halo" cx="260" cy="202" rx="210" ry="174" :fill="paint('ambient')"/>
    <ellipse class="ground-shadow" cx="260" cy="355" rx="177" ry="16" :fill="paint('ground')"/>
    <ellipse class="ground-light" cx="260" cy="350" rx="135" ry="11" :fill="paint('ambient')"/>

    <!-- 箱盖完全开启后的背板。默认沿后铰链收拢，opening 状态再展开。 -->
    <g class="open-lid">
      <path
        d="M110 231V143Q110 96 154 71Q202 43 260 43Q318 43 366 71Q410 96 410 143V231Z"
        :fill="paint('velvet')" stroke="#140b12" stroke-width="4" stroke-linejoin="round"
      />
      <g :clip-path="paint('openLidClip')">
        <path d="M121 226V149Q121 108 160 84Q204 57 260 57Q316 57 360 84Q399 108 399 149V226Z"
          fill="none" :stroke="paint('brassV')" stroke-width="8"/>
        <path d="M133 224V153Q133 116 168 96Q207 71 260 71Q313 71 352 96Q387 116 387 153V224Z"
          fill="none" stroke="#d0a66b" stroke-opacity="0.34" stroke-width="1.4"/>
        <path d="M143 224V158Q143 125 175 106Q212 83 260 83Q308 83 345 106Q377 125 377 158V224Z"
          :fill="paint('velvetLight')" stroke="#5a3c31" stroke-width="1.2"/>
        <path d="M172 207Q202 166 260 148Q318 166 348 207" fill="none" stroke="#b68b52" stroke-width="1.5" opacity="0.54"/>
        <path d="M188 207Q213 179 260 164Q307 179 332 207" fill="none" stroke="#e6c88d" stroke-width="0.8" opacity="0.42"/>
        <path d="M259.5 86V221" stroke="#d5ae71" stroke-width="1" opacity="0.26"/>
        <path class="inner-lid-spill" d="M110 150H410V232H110Z" :fill="paint('spill')"/>
      </g>
      <path d="M246 112L260 96L274 112L260 128Z" fill="#24121c" :stroke="paint('brassFine')" stroke-width="2"/>
      <ellipse cx="260" cy="112" rx="6.4" ry="8.2" :fill="paint('garnet')" stroke="#e0bd82" stroke-width="1"/>
      <path d="M244 226H276L270 236H250Z" :fill="paint('brassH')" stroke="#2c1b18" stroke-width="1.5"/>
    </g>

    <!-- 开盖时从箱内推出的光柱与纵深。 -->
    <g class="inner-light">
      <path class="light-beam beam-left" d="M214 241Q224 162 164 26H256Q241 158 246 241Z" :fill="paint('beam')"/>
      <path class="light-beam beam-right" d="M274 241Q282 158 266 26H356Q296 162 306 241Z" :fill="paint('beam')"/>
      <ellipse class="light-core" cx="260" cy="235" rx="118" ry="54" :fill="paint('ambient')"/>
    </g>

    <g class="chest">
      <!-- 闭合箱盖 -->
      <g class="lid-closed">
        <path
          d="M98 233V169Q98 133 132 110Q187 74 260 74Q333 74 388 110Q422 133 422 169V233Z"
          :fill="paint('lacquerLid')" stroke="#160c13" stroke-width="4" stroke-linejoin="round"
        />
        <g :clip-path="paint('closedLidClip')">
          <path d="M155 94V234M207 76V234M313 76V234M365 94V234" stroke="#170d14" stroke-width="2.2" opacity="0.5"/>
          <path d="M159 94V234M211 76V234M309 76V234M361 94V234" stroke="#c38377" stroke-width="0.9" opacity="0.18"/>
          <path d="M112 155Q132 118 181 93Q220 73 260 73Q300 73 339 93Q388 118 408 155"
            fill="none" stroke="#f1cda0" stroke-width="2.2" opacity="0.36"/>

          <!-- 三段式细金丝嵌线与中央花饰。 -->
          <path d="M141 225V170Q141 142 168 125Q208 98 260 98Q312 98 352 125Q379 142 379 170V225"
            fill="none" :stroke="paint('brassFine')" stroke-width="2.1" opacity="0.78"/>
          <path d="M156 225V176Q156 151 179 137Q214 114 260 114Q306 114 341 137Q364 151 364 176V225"
            fill="none" stroke="#e9c891" stroke-width="0.75" opacity="0.48"/>
          <path d="M199 225V169Q199 144 220 132Q239 121 260 121Q281 121 300 132Q321 144 321 169V225"
            fill="none" stroke="#a87742" stroke-width="1" opacity="0.45"/>
          <path d="M260 121V223" stroke="#c8995f" stroke-width="0.9" opacity="0.3"/>

          <!-- 左右藤蔓纹保持细线工艺感。 -->
          <path d="M167 184C184 168 201 172 211 188C198 179 185 184 180 199C180 184 173 179 167 184Z"
            fill="none" stroke="#c99e64" stroke-width="1.2" opacity="0.56"/>
          <path d="M353 184C336 168 319 172 309 188C322 179 335 184 340 199C340 184 347 179 353 184Z"
            fill="none" stroke="#c99e64" stroke-width="1.2" opacity="0.56"/>

          <path d="M119 110H134V234H119Z" :fill="paint('brassV')" stroke="#291818" stroke-width="2"/>
          <path d="M386 110H401V234H386Z" :fill="paint('brassV')" stroke="#291818" stroke-width="2"/>
          <circle cx="126.5" cy="146" r="2" fill="#533922"/>
          <circle cx="126.5" cy="210" r="2" fill="#533922"/>
          <circle cx="393.5" cy="146" r="2" fill="#533922"/>
          <circle cx="393.5" cy="210" r="2" fill="#533922"/>

          <rect class="lid-sheen" x="56" y="62" width="74" height="190" transform="rotate(12 56 62)" :fill="paint('metalSheen')"/>
        </g>

        <path d="M247 137L260 122L273 137L260 152Z" fill="#24121c" :stroke="paint('brassFine')" stroke-width="2"/>
        <ellipse class="lid-garnet" cx="260" cy="137" rx="6" ry="7.6" :fill="paint('garnet')" stroke="#e0bd82" stroke-width="1"/>
        <path d="M98 224H422V239H98Z" :fill="paint('brassH')" stroke="#2d1b18" stroke-width="2"/>
        <path d="M108 226H412" stroke="#fff0c5" stroke-width="1.4" opacity="0.45"/>
      </g>

      <!-- 箱体 -->
      <g class="chest-body">
        <path d="M112 335V351H142L149 337ZM408 335V351H378L371 337Z" fill="#160d13"/>
        <path d="M92 239H428V322Q428 340 410 340H110Q92 340 92 322Z"
          :fill="paint('lacquerBody')" stroke="#150b12" stroke-width="4" stroke-linejoin="round"/>
        <g :clip-path="paint('bodyClip')">
          <rect x="92" y="239" width="336" height="28" fill="#120a10" opacity="0.34"/>
          <path d="M158 241V340M212 241V340M308 241V340M362 241V340" stroke="#160c13" stroke-width="2" opacity="0.5"/>
          <path d="M162 241V340M216 241V340M304 241V340M358 241V340" stroke="#bd7e70" stroke-width="0.8" opacity="0.14"/>

          <path d="M127 270H225V316Q225 325 216 325H127Z" fill="#21131c" fill-opacity="0.38" stroke="#9f7143" stroke-width="1.5"/>
          <path d="M295 270H393V325H304Q295 325 295 316Z" fill="#21131c" fill-opacity="0.38" stroke="#9f7143" stroke-width="1.5"/>
          <path d="M136 279H216V314Q216 317 213 317H136Z" fill="none" stroke="#d1a766" stroke-width="0.7" opacity="0.44"/>
          <path d="M304 279H384V317H307Q304 317 304 314Z" fill="none" stroke="#d1a766" stroke-width="0.7" opacity="0.44"/>
          <path d="M146 301C165 282 194 282 213 301C194 291 165 291 146 301Z" fill="none" stroke="#a97a47" stroke-width="1" opacity="0.58"/>
          <path d="M374 301C355 282 326 282 307 301C326 291 355 291 374 301Z" fill="none" stroke="#a97a47" stroke-width="1" opacity="0.58"/>

          <rect x="92" y="327" width="336" height="18" fill="#120a10" opacity="0.28"/>
          <rect class="face-spill" x="92" y="238" width="336" height="80" :fill="paint('spill')"/>
        </g>

        <path d="M92 278V322Q92 340 110 340H158V327H114Q107 327 107 320V278Z"
          :fill="paint('brassV')" stroke="#291819" stroke-width="2"/>
        <path d="M428 278V322Q428 340 410 340H362V327H406Q413 327 413 320V278Z"
          :fill="paint('brassV')" stroke="#291819" stroke-width="2"/>
        <path d="M103 333H417" :stroke="paint('brassH')" stroke-width="9"/>
        <path d="M91 234H429Q435 234 435 240V249Q435 255 429 255H91Q85 255 85 249V240Q85 234 91 234Z"
          :fill="paint('brassH')" stroke="#2a1918" stroke-width="2.4"/>
        <path d="M98 238H422" stroke="#fff0c8" stroke-width="1.5" opacity="0.52"/>

        <g class="seam-light">
          <rect x="91" y="231" width="338" height="10" rx="5" fill="#f9d996" :filter="paint('softGlow')"/>
          <path d="M96 235H424" stroke="#fff4cf" stroke-width="3" stroke-linecap="round"/>
        </g>

        <circle cx="101" cy="300" r="2" fill="#51351f"/>
        <circle cx="123" cy="333" r="2" fill="#51351f"/>
        <circle cx="419" cy="300" r="2" fill="#51351f"/>
        <circle cx="397" cy="333" r="2" fill="#51351f"/>
      </g>

      <!-- 锁具：盾形锁牌、双插销与珐琅核心。 -->
      <g class="lock-bolts">
        <path class="lock-bolt bolt-left" d="M205 239H242V251H205Q199 251 199 245Q199 239 205 239Z" :fill="paint('brassH')" stroke="#2a1918" stroke-width="1.8"/>
        <path class="lock-bolt bolt-right" d="M278 239H315Q321 239 321 245Q321 251 315 251H278Z" :fill="paint('brassH')" stroke="#2a1918" stroke-width="1.8"/>
      </g>
      <g class="chest-lock">
        <path d="M231 213H289V268Q289 286 260 302Q231 286 231 268Z"
          :fill="paint('brassV')" stroke="#281617" stroke-width="2.4" stroke-linejoin="round"/>
        <path d="M238 220H282V267Q282 279 260 292Q238 279 238 267Z"
          fill="#34202a" stroke="#8e653c" stroke-width="1.4"/>
        <path d="M242 225Q260 218 278 225" stroke="#ffe6b0" stroke-width="1.3" opacity="0.55" stroke-linecap="round"/>
        <g class="lock-runes" fill="none" stroke="#ddac68" stroke-width="1" opacity="0.62">
          <path d="M246 256L252 250M274 256L268 250"/>
          <path d="M246 266H253M274 266H267"/>
        </g>
        <circle class="lock-aura" cx="260" cy="245" r="22" fill="#e2a461" :filter="paint('softGlow')"/>
        <path d="M260 230L271 241L260 252L249 241Z" :fill="paint('lockCore')" stroke="#f2d29b" stroke-width="1.2"/>
        <circle class="lock-core" cx="260" cy="241" r="4.2" fill="#fff3cf"/>
        <path d="M257 263A3 3 0 1 1 263 263C263 265 262 266 262 268L264 277H256L258 268C258 266 257 265 257 263Z" fill="#120b11"/>
        <g :clip-path="paint('lockClip')">
          <rect class="lock-sheen" x="194" y="191" width="22" height="132" transform="rotate(14 194 191)" :fill="paint('metalSheen')"/>
        </g>
      </g>
    </g>

    <!-- 固定粒子池：待机只见浮尘；开盖只发生一次克制的金屑喷发。 -->
    <g class="dust-field">
      <circle
        v-for="(mote, index) in motes"
        :key="`mote-${index}`"
        class="dust-mote"
        :cx="mote.x" :cy="mote.y" :r="mote.r"
        :style="motionStyle(mote)"
      />
    </g>
    <g class="burst-field">
      <g
        v-for="(spark, index) in sparks"
        :key="`spark-${index}`"
        :transform="`translate(${spark.x} ${spark.y})`"
      >
        <circle v-if="spark.kind === 'dot'" class="burst-particle" :r="spark.size" :style="motionStyle(spark)"/>
        <path v-else class="burst-particle burst-diamond" :d="diamondPath(spark.size)" :style="motionStyle(spark)"/>
      </g>
    </g>
  </svg>
</template>

<script setup>
import { useId } from 'vue'

defineProps({
  /** idle 静候 / charging 蓄力 / opening 开启动作 / opened 开启完成 / exiting 退场 */
  state: {
    type: String,
    default: 'idle',
    validator: (value) => ['idle', 'charging', 'opening', 'opened', 'exiting'].includes(value),
  },
  /** 待机宝箱是否已可开启；就绪时才显示微光提示。 */
  ready: { type: Boolean, default: false },
  /** 蓄力强化阶段（等待较久后切换，光效更明确但仍保持克制）。 */
  boost: { type: Boolean, default: false },
})

const prefix = `chest-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
const ids = Object.fromEntries([
  'lacquerBody', 'lacquerLid', 'velvet', 'velvetLight',
  'brassV', 'brassH', 'brassFine', 'metalSheen', 'garnet', 'lockCore',
  'ambient', 'ground', 'beam', 'spill',
  'closedLidClip', 'openLidClip', 'bodyClip', 'lockClip', 'softGlow',
].map((name) => [name, `${prefix}-${name}`]))

const paint = (name) => `url(#${ids[name]})`

const motes = [
  { x: 111, y: 198, r: 1.25, tx: -8, ty: -36, delay: 0.3, dur: 4.8 },
  { x: 405, y: 186, r: 1.05, tx: 7, ty: -42, delay: 1.8, dur: 5.4 },
  { x: 337, y: 90, r: 0.9, tx: 4, ty: -30, delay: 3.1, dur: 5.1 },
  { x: 184, y: 74, r: 0.85, tx: -3, ty: -26, delay: 4.2, dur: 5.8 },
]

const sparks = [
  { x: 214, y: 235, tx: -58, ty: -86, delay: 0.22, dur: 0.82, size: 2.4, kind: 'diamond' },
  { x: 238, y: 235, tx: -24, ty: -118, delay: 0.3, dur: 0.9, size: 2.1, kind: 'dot' },
  { x: 260, y: 233, tx: 0, ty: -132, delay: 0.18, dur: 0.94, size: 2.8, kind: 'diamond' },
  { x: 284, y: 235, tx: 26, ty: -112, delay: 0.27, dur: 0.88, size: 1.8, kind: 'dot' },
  { x: 306, y: 236, tx: 62, ty: -82, delay: 0.24, dur: 0.84, size: 2.2, kind: 'diamond' },
  { x: 225, y: 237, tx: -38, ty: -60, delay: 0.42, dur: 0.76, size: 1.5, kind: 'dot' },
  { x: 295, y: 237, tx: 42, ty: -64, delay: 0.46, dur: 0.78, size: 1.4, kind: 'dot' },
  { x: 250, y: 237, tx: -12, ty: -78, delay: 0.52, dur: 0.72, size: 1.6, kind: 'diamond' },
  { x: 272, y: 237, tx: 14, ty: -72, delay: 0.56, dur: 0.72, size: 1.35, kind: 'dot' },
]

function motionStyle(item) {
  return {
    '--tx': `${item.tx}px`,
    '--ty': `${item.ty}px`,
    '--delay': `${item.delay}s`,
    '--dur': `${item.dur}s`,
  }
}

function diamondPath(size) {
  const arm = Number(size) * 1.8
  const inset = Number(size) * 0.46
  return `M0 ${-arm} L${inset} ${-inset} L${arm} 0 L${inset} ${inset} L0 ${arm} L${-inset} ${inset} L${-arm} 0 L${-inset} ${-inset} Z`
}
</script>

<style scoped>
.chest-svg {
  display: block;
  width: 100%;
  overflow: visible;
  isolation: isolate;
}

.ambient-halo,
.ground-light,
.inner-light,
.seam-light,
.lock-aura,
.face-spill,
.inner-lid-spill { opacity: 0; }

.ground-shadow { opacity: 0.86; }
.ambient-halo,
.ground-light,
.ground-shadow,
.lock-aura,
.lock-core,
.lid-garnet,
.light-core,
.light-beam,
.inner-light {
  transform-box: fill-box;
  transform-origin: 50% 50%;
}
.light-beam { transform-origin: 50% 100%; }

/* ── 静候：箱体保持重量，只让环境、宝石与金属游光呼吸。 ── */
.state-idle.is-ready .ambient-halo { animation: chest-ambient-ready 5.6s ease-in-out infinite; }
.state-idle.is-ready .ground-light { animation: chest-ground-ready 5.6s ease-in-out infinite; }
.state-idle.is-ready .lid-garnet,
.state-idle.is-ready .lock-core { animation: chest-gem-ready 3.8s ease-in-out infinite; }
.state-idle.is-ready .lid-sheen { animation: chest-sheen 7.2s cubic-bezier(0.2, 0.6, 0.3, 1) infinite; }
.state-idle.is-ready .lock-sheen { animation: chest-lock-sheen 7.2s cubic-bezier(0.2, 0.6, 0.3, 1) 0.18s infinite; }

@keyframes chest-ambient-ready {
  0%, 100% { opacity: 0.08; transform: scale(0.98); }
  50% { opacity: 0.16; transform: scale(1.02); }
}
@keyframes chest-ground-ready {
  0%, 100% { opacity: 0.08; transform: scaleX(0.94); }
  50% { opacity: 0.16; transform: scaleX(1.02); }
}
@keyframes chest-gem-ready {
  0%, 100% { filter: brightness(0.92); }
  50% { filter: brightness(1.18); }
}
@keyframes chest-sheen {
  0%, 62% { transform: translateX(-70px) rotate(12deg); opacity: 0; }
  68% { opacity: 0.26; }
  79%, 100% { transform: translateX(380px) rotate(12deg); opacity: 0; }
}
@keyframes chest-lock-sheen {
  0%, 64% { transform: translateX(-58px) rotate(14deg); opacity: 0; }
  70% { opacity: 0.34; }
  80%, 100% { transform: translateX(94px) rotate(14deg); opacity: 0; }
}

/* ── 蓄力：机械张力取代连续摇晃，缝光和锁芯承担“正在处理”的语义。 ── */
.chest {
  transform-box: fill-box;
  transform-origin: 50% 100%;
}
.state-charging .chest { animation: chest-tension 2.15s ease-in-out infinite; }
.charging-max.state-charging .chest { animation-duration: 1.18s; }
.state-charging .ambient-halo { animation: chest-charge-ambient 1.7s ease-in-out infinite; }
.charging-max.state-charging .ambient-halo { animation-duration: 0.96s; }
.state-charging .ground-light { animation: chest-charge-ground 1.7s ease-in-out infinite; }
.charging-max.state-charging .ground-light { animation-duration: 0.96s; }
.state-charging .seam-light { animation: chest-seam-charge 1.7s ease-in-out infinite; }
.charging-max.state-charging .seam-light { animation-duration: 0.96s; }
.state-charging .lock-aura { animation: chest-lock-aura 1.7s ease-in-out infinite; }
.charging-max.state-charging .lock-aura { animation-duration: 0.96s; }
.state-charging .lock-core { animation: chest-lock-core 1.7s ease-in-out infinite; }
.charging-max.state-charging .lock-core { animation-duration: 0.96s; }
.state-charging .lock-runes { animation: chest-runes 1.7s ease-in-out infinite; }
.charging-max.state-charging .lock-runes { animation-duration: 0.96s; }

@keyframes chest-tension {
  0%, 58%, 100% { transform: translate(0, 0) rotate(0deg); }
  64% { transform: translate(-0.8px, -1px) rotate(-0.12deg); }
  70% { transform: translate(0.9px, 0) rotate(0.12deg); }
  76% { transform: translate(-0.35px, -0.5px) rotate(-0.06deg); }
  84% { transform: translate(0, 0) rotate(0deg); }
}
@keyframes chest-charge-ambient {
  0%, 100% { opacity: 0.12; transform: scale(0.96); }
  50% { opacity: 0.28; transform: scale(1.04); }
}
@keyframes chest-charge-ground {
  0%, 100% { opacity: 0.14; transform: scaleX(0.9); }
  50% { opacity: 0.32; transform: scaleX(1.08); }
}
@keyframes chest-seam-charge {
  0%, 100% { opacity: 0.14; }
  48% { opacity: 0.72; }
  62% { opacity: 0.42; }
}
@keyframes chest-lock-aura {
  0%, 100% { opacity: 0.04; transform: scale(0.7); }
  50% { opacity: 0.32; transform: scale(1.08); }
}
@keyframes chest-lock-core {
  0%, 100% { opacity: 0.62; transform: scale(0.88); }
  50% { opacity: 1; transform: scale(1.08); }
}
@keyframes chest-runes {
  0%, 100% { opacity: 0.24; }
  50% { opacity: 0.92; }
}

/* ── 开启动作：插销退出 → 锁牌释放 → 闭合盖收拢 → 内盖起立 → 光效落稳。 ── */
.lid-closed,
.open-lid,
.chest-body,
.chest-lock,
.lock-bolt,
.light-core,
.light-beam {
  transform-box: fill-box;
}
.lid-closed,
.open-lid { transform-origin: 50% 100%; }
.open-lid { opacity: 0; transform: scaleY(0.035); }
.chest-body { transform-origin: 50% 100%; }
.chest-lock { transform-origin: 50% 12%; }
.bolt-left { transform-origin: 100% 50%; }
.bolt-right { transform-origin: 0 50%; }

.state-opening .bolt-left { animation: chest-bolt-left 0.34s cubic-bezier(0.3, 0.9, 0.4, 1) both; }
.state-opening .bolt-right { animation: chest-bolt-right 0.34s cubic-bezier(0.3, 0.9, 0.4, 1) both; }
.state-opening .chest-lock { animation: chest-lock-release 0.58s cubic-bezier(0.38, 0.8, 0.32, 1) 0.12s both; }
.state-opening .lid-closed { animation: chest-lid-fold 0.76s cubic-bezier(0.5, 0, 0.22, 1) 0.14s both; }
.state-opening .open-lid { animation: chest-lid-rise 0.88s cubic-bezier(0.22, 0.82, 0.32, 1) 0.24s both; }
.state-opening .chest-body { animation: chest-body-recoil 0.64s cubic-bezier(0.28, 0.82, 0.36, 1) 0.18s both; }
.state-opening .inner-light { animation: chest-light-arrive 0.78s ease-out 0.28s both; }
.state-opening .light-core { animation: chest-light-core 0.74s cubic-bezier(0.2, 0.9, 0.28, 1) 0.3s both; }
.state-opening .light-beam { animation: chest-beam-rise 0.78s cubic-bezier(0.24, 0.86, 0.32, 1) 0.34s both; }
.state-opening .beam-right { animation-delay: 0.42s; }
.state-opening .ambient-halo { animation: chest-open-ambient 0.82s ease-out 0.26s both; }
.state-opening .ground-light { animation: chest-open-ground 0.72s ease-out 0.3s both; }
.state-opening .face-spill,
.state-opening .inner-lid-spill { animation: chest-spill-in 0.62s ease-out 0.38s both; }

@keyframes chest-bolt-left {
  0% { transform: translateX(0); opacity: 1; }
  72% { opacity: 1; }
  100% { transform: translateX(-26px); opacity: 0; }
}
@keyframes chest-bolt-right {
  0% { transform: translateX(0); opacity: 1; }
  72% { opacity: 1; }
  100% { transform: translateX(26px); opacity: 0; }
}
@keyframes chest-lock-release {
  0% { transform: translateY(0) rotate(0deg); opacity: 1; }
  30% { transform: translateY(-3px) rotate(-2deg); opacity: 1; }
  72% { transform: translateY(13px) rotate(7deg); opacity: 0.92; }
  100% { transform: translateY(30px) rotate(10deg); opacity: 0; }
}
@keyframes chest-lid-fold {
  0% { transform: translateY(0) scaleY(1); opacity: 1; }
  18% { transform: translateY(-7px) scaleY(1.025); opacity: 1; }
  66% { transform: translateY(3px) scaleY(0.24); opacity: 1; }
  100% { transform: translateY(4px) scaleY(0.035); opacity: 0; }
}
@keyframes chest-lid-rise {
  0% { transform: scaleY(0.035); opacity: 0; }
  18% { opacity: 1; }
  72% { transform: scaleY(1.035); opacity: 1; }
  88% { transform: scaleY(0.992); opacity: 1; }
  100% { transform: scaleY(1); opacity: 1; }
}
@keyframes chest-body-recoil {
  0% { transform: translateY(0); }
  32% { transform: translateY(4px); }
  68% { transform: translateY(-1.5px); }
  100% { transform: translateY(0); }
}
@keyframes chest-light-arrive {
  0% { opacity: 0; }
  46% { opacity: 1; }
  100% { opacity: 0.9; }
}
@keyframes chest-light-core {
  0% { transform: scale(0.28); opacity: 0; }
  62% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 0.78; }
}
@keyframes chest-beam-rise {
  0% { transform: scaleY(0.08); opacity: 0; }
  48% { opacity: 0.78; }
  78% { transform: scaleY(1.04); }
  100% { transform: scaleY(1); opacity: 0.52; }
}
@keyframes chest-open-ambient {
  0% { opacity: 0.12; transform: scale(0.84); }
  62% { opacity: 0.42; transform: scale(1.08); }
  100% { opacity: 0.26; transform: scale(1); }
}
@keyframes chest-open-ground {
  0% { opacity: 0.12; transform: scaleX(0.72); }
  65% { opacity: 0.46; transform: scaleX(1.12); }
  100% { opacity: 0.3; transform: scaleX(1); }
}
@keyframes chest-spill-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* opening 结束后切到 opened，显式固定最终姿态，避免动画状态切换时跳帧。 */
.state-opened .lid-closed,
.state-exiting .lid-closed,
.state-opened .chest-lock,
.state-exiting .chest-lock,
.state-opened .lock-bolts,
.state-exiting .lock-bolts { opacity: 0; }
.state-opened .open-lid,
.state-exiting .open-lid { opacity: 1; transform: scaleY(1); }
.state-opened .inner-light,
.state-exiting .inner-light { opacity: 0.88; }
.state-opened .ambient-halo { opacity: 0.26; }
.state-opened .ground-light { opacity: 0.3; }
.state-opened .face-spill,
.state-opened .inner-lid-spill { opacity: 1; }
.state-opened .light-core { animation: chest-opened-core 2.8s ease-in-out infinite; }
@keyframes chest-opened-core {
  0%, 100% { opacity: 0.72; transform: scale(1); }
  50% { opacity: 0.88; transform: scale(1.025); }
}

/* ── 一次性粒子爆发。粒子固定在 DOM 中，opening 时飞出并完全消失。 ── */
.dust-mote,
.burst-particle { fill: #efc887; opacity: 0; transform-box: fill-box; transform-origin: center; }
.state-idle.is-ready .dust-mote,
.state-charging .dust-mote {
  animation: chest-dust var(--dur) ease-out var(--delay) infinite;
}
.state-opening .burst-particle {
  animation: chest-spark var(--dur) cubic-bezier(0.18, 0.7, 0.28, 1) var(--delay) both;
}
.burst-diamond { fill: #f6dca3; }
@keyframes chest-dust {
  0% { opacity: 0; transform: translate(0, 0); }
  25% { opacity: 0.28; }
  100% { opacity: 0; transform: translate(var(--tx), var(--ty)); }
}
@keyframes chest-spark {
  0% { opacity: 0; transform: translate(0, 0) scale(0.45) rotate(0deg); }
  18% { opacity: 0.92; }
  72% { opacity: 0.56; }
  100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(1.08) rotate(46deg); }
}

/* ── 退场：开箱成果留在原位，宝箱自身向下、向后收走。 ── */
.state-exiting .chest,
.state-exiting .open-lid,
.state-exiting .inner-light {
  animation: chest-exit 0.78s cubic-bezier(0.55, 0, 0.78, 0.32) both;
}
.state-exiting .ambient-halo,
.state-exiting .ground-light {
  animation: chest-stage-exit 0.68s ease-in both;
}
.state-exiting .ground-shadow { animation: chest-shadow-exit 0.68s ease-in both; }
@keyframes chest-exit {
  0% { opacity: 1; transform: translateY(0) scale(1); }
  24% { opacity: 1; transform: translateY(4px) scale(0.99); }
  100% { opacity: 0; transform: translateY(92px) scale(0.86); }
}
@keyframes chest-stage-exit {
  0% { opacity: 0.26; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.74); }
}
@keyframes chest-shadow-exit {
  0% { opacity: 0.86; transform: scaleX(1); }
  100% { opacity: 0; transform: scaleX(0.64); }
}

@media (prefers-reduced-motion: reduce) {
  .chest-svg * { animation: none !important; }

  .state-opening .lid-closed,
  .state-opening .chest-lock,
  .state-opening .lock-bolts,
  .state-opened .lid-closed,
  .state-opened .chest-lock,
  .state-opened .lock-bolts { opacity: 0; }

  .state-opening .open-lid,
  .state-opened .open-lid { opacity: 1; transform: scaleY(1); }
  .state-opening .inner-light,
  .state-opened .inner-light { opacity: 0.88; }
  .state-opening .ambient-halo,
  .state-opened .ambient-halo { opacity: 0.26; }
  .state-exiting .chest,
  .state-exiting .open-lid,
  .state-exiting .inner-light,
  .state-exiting .ambient-halo,
  .state-exiting .ground-light,
  .state-exiting .ground-shadow { opacity: 0; }
}
</style>
