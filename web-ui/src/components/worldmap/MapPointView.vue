<template>
  <div class="mpt">
    <!-- ── 视图切换：全域 / 各片区 ── -->
    <div class="mpt-tabs">
      <button type="button" class="mpt-tab" :class="{ active: !activeArea }" @click="switchArea('')">全域</button>
      <button
        v-for="a in areas" :key="a.name"
        type="button" class="mpt-tab"
        :class="{ active: activeArea === a.name, dim: !a.scenes.length }"
        :title="`${a.name} · ${a.scenes.length} 个场景`"
        @click="switchArea(a.name)"
      >{{ a.name }}</button>
    </div>

    <!-- ── 画布 ── -->
    <div class="mpt-canvas">
      <svg
        ref="svgEl" class="mpt-svg" :viewBox="viewBox"
        preserveAspectRatio="xMidYMid meet" role="img"
        :class="{ 'is-dragging': !!dragging }"
      >
        <!-- 坐标系网格（仅片区视图）-->
        <g v-if="activeArea" class="mpt-grid">
          <line v-for="i in 10" :key="'gx' + i" :x1="40 + i * ((W - 80) / 10)" :y1="40" :x2="40 + i * ((W - 80) / 10)" :y2="H - 40" />
          <line v-for="i in 10" :key="'gy' + i" :x1="40" :y1="40 + i * ((H - 80) / 10)" :x2="W - 40" :y2="40 + i * ((H - 80) / 10)" />
        </g>

        <!-- ═══ 全域视图 ═══
             按**大区**逐块渲染（不再只硬编码两个磁极）：
               · overview —— 登记在官方总览图上的磁极（喜笑区 / 悲泣区），点位用官方像素坐标等比映射
               · cars     —— 星穹列车：画成**车厢条**（3 节车厢并排，房间列在所属车厢里）
               · plain    —— 其余大区：通用面板，子区列成药丸
             ⚠ 之前只有前两类硬编码 + 一个"其他子区"兜底行；星穹列车这种"大区下面是车厢、
               车厢里才是房间"的三层结构会被压平成一行药丸，层级信息全丢。 -->
        <g v-if="!activeArea">
          <g v-for="g in overview.groups" :key="g.key">
            <!-- ⓪ 幻月（二相乐园的月球）—— 居中偏上的独立区块。
                 与双翼不同：它不是地面磁极，而是悬在上方的存在，故单独一种块型。 -->
            <template v-if="g.type === 'moon'">
              <rect :x="g.x" :y="g.y" :width="g.w" :height="g.h" rx="70"
                    class="mpt-moon" />
              <text :x="g.x + 16" :y="g.y + 26" class="mpt-wing-name is-moon">{{ g.key }}</text>
              <text :x="g.x + g.w - 16" :y="g.y + 25" class="mpt-wing-pole" text-anchor="end">{{ g.pole }}</text>
              <g v-for="s in g.spots" :key="s.name"
                 :class="['mpt-spot', { 'is-clickable': !!s.raw }]"
                 @click="s.raw && pick(s.raw)">
                <circle
                  :cx="s.px" :cy="s.py" :r="s.raw ? 7 : 6"
                  class="mpt-mk" :class="[s.raw ? (s.poi ? 'is-poi' : 'is-empty') : 'is-todo',
                                         { selected: s.raw && selectedId === s.raw.id }]"
                >
                  <title>{{ s.raw ? `${s.name} · ${s.count} ${s.unit}${s.count === s.poi ? '' : ' · POI ' + s.poi}` : s.name }}</title>
                </circle>
                <circle v-if="s.raw" :cx="s.px" :cy="s.py" r="2.6" class="mpt-mk-core" />
                <text :x="s.tx" :y="s.ty" class="mpt-mk-label" :class="s.raw ? 'is-on' : 'is-todo'" :text-anchor="s.ta">
                  {{ s.name }}
                </text>
              </g>
            </template>

            <!-- ① 磁极（双翼，官方总览图坐标）-->
            <template v-else-if="g.type === 'overview'">
              <rect :x="g.x" :y="g.y" :width="g.w" :height="g.h" rx="14"
                    class="mpt-wing" :class="g.tone" />
              <text :x="g.x + 16" :y="g.y + 26" class="mpt-wing-name" :class="g.tone">{{ g.key }}</text>
              <text :x="g.x + g.w - 16" :y="g.y + 25" class="mpt-wing-pole" text-anchor="end">{{ g.pole }}</text>

              <g v-for="s in g.spots" :key="s.name"
                 :class="['mpt-spot', { 'is-clickable': !!s.raw }]"
                 @click="s.raw && pick(s.raw)">
                <circle
                  :cx="s.px" :cy="s.py" :r="s.raw ? 7 : 6"
                  class="mpt-mk" :class="[s.raw ? (s.poi ? 'is-poi' : 'is-empty') : 'is-todo',
                                         { selected: s.raw && selectedId === s.raw.id }]"
                >
                  <title>{{ s.raw ? `${s.name} · ${s.count} ${s.unit}${s.count === s.poi ? '' : ' · POI ' + s.poi}` : s.name }}</title>
                </circle>
                <circle v-if="s.raw" :cx="s.px" :cy="s.py" r="2.6" class="mpt-mk-core" />
                <text :x="s.tx" :y="s.ty" class="mpt-mk-label" :class="s.raw ? 'is-on' : 'is-todo'" :text-anchor="s.ta">
                  {{ s.name }}
                </text>
              </g>
              <text v-if="!g.spots.length" :x="g.x + g.w / 2" :y="g.y + g.h / 2" class="mpt-empty" text-anchor="middle">（无子区）</text>

              <g v-if="g.extras.length">
                <text :x="g.x + 16" :y="g.ey" class="mpt-extras-t">自建子区：</text>
                <g v-for="(e, ei) in g.extras" :key="e.name">
                  <rect :x="g.x + 16 + ei * 88" :y="g.ey + 8" width="82" height="20" rx="10"
                        class="mpt-extra" :class="{ selected: selectedId === e.raw.id }"
                        @click="pick(e.raw)" />
                  <text :x="g.x + 16 + ei * 88 + 41" :y="g.ey + 22" class="mpt-extra-t" text-anchor="middle">{{ e.name }}</text>
                </g>
              </g>
            </template>

            <!-- ② 星穹列车：车厢条（车厢并排，房间列在车厢内）-->
            <template v-else-if="g.type === 'cars'">
              <rect :x="g.x" :y="g.y" :width="g.w" :height="g.h" rx="14" class="mpt-wing is-train" />
              <text :x="g.x + 16" :y="g.y + 26" class="mpt-wing-name is-train">{{ g.key }}</text>
              <text :x="g.x + g.w - 16" :y="g.y + 25" class="mpt-wing-pole" text-anchor="end">{{ g.cars.length }} 节车厢</text>

              <g v-for="car in g.cars" :key="car.id">
                <rect :x="car.x" :y="car.y" :width="car.w" :height="car.h" rx="10"
                      class="mpt-car" :class="{ selected: selectedId === car.id }"
                      @click="pick(car.raw)" />
                <text :x="car.x + 12" :y="car.y + 21" class="mpt-car-name">{{ car.name }}</text>
                <text :x="car.x + car.w - 12" :y="car.y + 21" class="mpt-car-n" text-anchor="end">
                  {{ car.kids.length ? `${car.kids.length} 处` : '公共' }}
                </text>
                <!-- 车厢内的地点（房间）—— 可点、可选中 -->
                <g v-for="(k, ki) in car.kids" :key="k.id">
                  <rect :x="car.x + 10" :y="car.y + 31 + ki * 23" :width="car.w - 20" height="19" rx="9"
                        class="mpt-car-kid" :class="{ selected: selectedId === k.id }"
                        @click.stop="pick(k)" />
                  <text :x="car.x + 20" :y="car.y + 44 + ki * 23" class="mpt-car-kid-t">{{ k.name }}</text>
                </g>
                <text v-if="!car.kids.length" :x="car.x + car.w / 2" :y="car.y + car.h / 2 + 4"
                      class="mpt-empty" text-anchor="middle">（公共车厢）</text>
                <text v-if="car.more" :x="car.x + 12" :y="car.y + car.h - 8" class="mpt-car-more">…另有 {{ car.more }} 处</text>
              </g>
            </template>

            <!-- ③ 其余大区：通用面板（子区列成药丸），避免静默消失 -->
            <template v-else>
              <rect :x="g.x" :y="g.y" :width="g.w" :height="g.h" rx="14" class="mpt-wing" />
              <text :x="g.x + 16" :y="g.y + 26" class="mpt-wing-name">{{ g.key }}</text>
              <text :x="g.x + g.w - 16" :y="g.y + 25" class="mpt-wing-pole" text-anchor="end">
                {{ g.pills.length ? `${g.pills.length} 个子区` : '' }}
              </text>
              <g v-for="s in g.pills" :key="s.id">
                <rect :x="s.x" :y="s.y" :width="s.w" height="22" rx="11"
                      class="mpt-extra" :class="{ selected: selectedId === s.id }" @click="pick(s.raw)" />
                <text :x="s.x + s.w / 2" :y="s.y + 15" class="mpt-extra-t" text-anchor="middle">{{ s.name }}</text>
              </g>
              <text v-if="!g.pills.length" :x="g.x + g.w / 2" :y="g.y + g.h / 2" class="mpt-empty" text-anchor="middle">（无子区）</text>
            </template>
          </g>

          <!-- ── 全域比例尺：把「图上距离 = 实际多远」写清楚 ──
               布局是按轨道用时反解出来的（泊地站为基准），不给比例尺的话
               用户无法判断两个点到底"算远还是算近"，也没法自己核对。 -->
          <g v-if="overview.scaleBar" class="mpt-scale-g">
            <line
              :x1="24" :y1="overview.scaleBar.y" :x2="24 + overview.scaleBar.px" :y2="overview.scaleBar.y"
              class="mpt-scale-bar"
            />
            <line :x1="24" :y1="overview.scaleBar.y - 5" :x2="24" :y2="overview.scaleBar.y + 5" class="mpt-scale-bar" />
            <line :x1="24 + overview.scaleBar.px" :y1="overview.scaleBar.y - 5" :x2="24 + overview.scaleBar.px" :y2="overview.scaleBar.y + 5" class="mpt-scale-bar" />
            <text :x="24" :y="overview.scaleBar.y + 15" class="mpt-scale-text">
              比例尺 1 格 ≈ {{ overview.scaleBar.mPerPx.toFixed(1) }} m · 本段 {{ overview.scaleBar.km }} km
            </text>
            <text :x="24" :y="overview.scaleBar.y + 27" class="mpt-scale-text">
              参考：泊地站 → 珠星站 {{ overview.refs.zhuxing }} 分 · → 海原站 {{ overview.refs.haiyuan }} 分 · → 观览云岛站 {{ overview.refs.guanlan }} 分（轨道制式）
            </text>
          </g>
        </g>

        <!-- ═══ 片区视图：坐标针点图（标点可拖拽）═══ -->
        <g v-else>
          <template v-if="plot.nodes.length">
            <g v-for="n in plot.nodes" :key="n.id">
              <circle
                :cx="n.px" :cy="n.py" :r="n.src === 'exact' ? 7 : 5"
                class="mpt-node"
                :class="[n.src === 'exact' ? 'is-exact' : 'is-infer',
                         { selected: selectedId === n.id, moved: n.moved, dragging: dragging && dragging.name === n.name }]"
                @click="pick(n.raw)"
                @pointerdown="onPointerDown($event, n)"
              >
                <title>{{ n.name }}{{ n.src === 'inferred' ? '（示意位置 · 可拖动）' : `（${n.game}）` }}</title>
              </circle>
              <text
                :x="n.px" :y="n.py - (n.src === 'exact' ? 13 : 11)"
                class="mpt-node-label" :class="n.src" text-anchor="middle"
              >{{ n.name }}</text>
            </g>
          </template>
          <text v-else :x="W / 2" :y="H / 2" class="mpt-empty" text-anchor="middle">这个片区还没有场景</text>

          <!-- 比例尺 -->
          <g v-if="plot.hasExact">
            <line x1="52" :y1="H - 52" :x2="52 + plot.barW" :y2="H - 52" class="mpt-scale-bar" />
            <text x="52" :y="H - 38" class="mpt-scale-text">1 格 ≈ 200 坐标单位（等比，未拉伸）</text>
          </g>
        </g>
      </svg>

      <!-- 拖拽提示（仅片区视图）-->
      <div v-if="activeArea" class="mpt-dragbar">
        <span class="mpt-drag-hint">按住标点可拖动</span>
        <span v-if="areaMovedCount" class="mpt-drag-moved">已调 {{ areaMovedCount }}</span>
        <button
          v-if="areaMovedCount" type="button" class="mpt-drag-reset"
          title="把本片区所有手动调整复原" @click="resetArea"
        >重置本区</button>
      </div>
    </div>

    <!-- ── 图例 ── -->
    <div class="mpt-legend">
      <template v-if="!activeArea">
        <span class="mpt-lg"><i class="mpt-sw has-poi"></i>有 POI</span>
        <span class="mpt-lg"><i class="mpt-sw no-poi"></i>POI 为 0</span>
        <span class="mpt-lg"><i class="mpt-sw is-todo"></i>未建</span>
        <span class="mpt-lg"><i class="mpt-sw is-car"></i>车厢 / 车内地点（可点）</span>
      </template>
      <template v-else>
        <span class="mpt-lg"><i class="mpt-sw is-exact"></i>游戏锚点（精确坐标）</span>
        <span class="mpt-lg"><i class="mpt-sw is-infer"></i>二创场景（示意位置）</span>
        <span class="mpt-lg">精确 {{ plot.exactN }} / {{ plot.nodes.length }}</span>
        <span class="mpt-lg">拖动改位置（自动记住）</span>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import coords from '../../data/erxiangCoords.json'
import * as api from '../../api/index.js'

const props = defineProps({
  map: { type: Object, required: true },
  selected: { type: Object, default: null },
})
const emit = defineEmits(['select', 'layout-saved'])

const W = 780
const H = 760
// 全域视图的画布高是**算出来的**（`overview.height`）—— 大区数量可变，
// 写死高度会让"车厢条 / 其他大区"面板溢出画布（早先只够放两个磁极）。
const activeArea = ref('')
const svgEl = ref(null)

const viewBox = computed(() => `0 0 ${W} ${activeArea.value ? H : overview.value.height}`)

const selectedId = computed(() => props.selected?.id ?? null)

/**
 * 全域视图的锚点位置。
 * 基准是官方「区域总览图」（原图 1920 宽）的像素坐标，已逐点目视校准；
 * `box` 是该翼的内容包围盒（等比映射到翼内绘图区，保证方位关系不变形）。
 * `place` 决定标签挂在圆点的哪一侧，避免相互压字。
 */
const REGION_LAYOUT = {
  喜笑区: {
    pole: '欢乐磁极',
    box: { x: 800, y: 230, w: 900, h: 940 },
    spots: [
      { n: '珠星大厦', x: 1068, y: 268, place: 'r' },
      { n: '绘世学院', x: 1226, y: 430, place: 'r' },
      { n: '二维市', x: 1112, y: 713, place: 'r' },
      { n: '鸽川区', x: 1336, y: 728, place: 'b' },
      { n: '海原电视塔', x: 916, y: 950, place: 'l' },
      // ★ 2026-10-05：按用户的 ☆ 标记落为正式点位（此前只是底部「自建子区」药丸，未画在图内）。
      //   它是线路 A 的中间站（珠星站—异常防御部—泊地站），必须出现在全域图上。
      { n: '异常防御部', x: 1005, y: 503, place: 'l' },
      // ★ 2026-10-05 按用户的轨道交通时间反解调整：要求「泊地站→海原站 = 60 分」。
      //   三条约束（珠星↔泊地 60 / 海原↔泊地 60 / 观览云岛↔泊地 30）**无法用单一比例尺同时满足**
      //   （各自需要的比例系数差 4.8 倍），所以必须移动点位。以泊地站为基准，保持方位角只改径向距离。
      { n: '观览云岛站', x: 905, y: 693, place: 't' },
      { n: '海原市', x: 873, y: 1091, place: 'l' },
    ],
  },
  悲泣区: {
    pole: '悲伤磁极',
    box: { x: 900, y: 300, w: 780, h: 690 },
    spots: [
      { n: '世界尽头酒馆', x: 1320, y: 352, place: 'l' },
      // 贴着翼框左侧、与「鸽川区」同高 —— 喜悲街与鸽川区相邻
      { n: '喜悲街', x: 908, y: 800, place: 'r' },
      { n: '渡画泉隐', x: 1612, y: 834, place: 'l' },
      // ★ 2026-10-06 用户口径：「寂灭空飨妖都」「坠星的摇篮」两个点位**删除**
      //   （库里节点已被用户删除，这里同步清掉登记，否则会渲染成 is-todo 灰点）。
      //   同日：「幻月秘庭」**不在这里** —— 用户在幻月内部（二相乐园的月球），
      //   已移到上方居中的独立「幻月」区块，见 MOON_LAYOUT。
    ],
  },
}

/**
 * ★ 2026-10-06 新增：**幻月**（二相乐园的月球）—— 独立于双翼的居中偏上区块。
 *
 * 用户口径：「幻月秘庭实际上在幻月内部（二相乐园的月球），所以应该移动到居中靠上的位置」。
 * 它不属于喜笑/悲泣任何一翼（那是地面上的两个磁极），而是一个**悬在上方**的存在，
 * 所以单独给一个区块、居中排布；双翼随之下移让位。
 *
 * 坐标用**区块内相对比例**（0~1），不与双翼的官方总览图像素坐标混用 ——
 * 月球不在那张总览图的坐标系里，硬套会把方位关系搞乱。
 */
const MOON_LAYOUT = {
  pole: '二相乐园的月球',
  spots: [
    { n: '幻月秘庭', rx: 0.5, ry: 0.62, place: 'b' },
  ],
}

/** 官方锚点名 → 本库子区名（不一致时在此登记，别散落到各处） */
const SPOT_ALIAS = { 珠星大厦: '珠星集团CBD区' }

const PLACE = {
  r: { dx: 11, dy: 4, ta: 'start' },
  l: { dx: -11, dy: 4, ta: 'end' },
  b: { dx: 0, dy: 23, ta: 'middle' },
  t: { dx: 0, dy: -13, ta: 'middle' },
}

/** 从 map.tree 取 大区 → 子区 → 场景 */
const areas = computed(() => {
  const out = []
  for (const root of props.map?.tree ?? []) {
    const pole = root.name
    for (const sub of root.children ?? []) {
      out.push({
        name: sub.name, pole, id: sub.id, kind: sub.kind, raw: sub,
        scenes: sub.children ?? [],
        poi: (sub.children ?? []).reduce((s, c) => s + (c.pois?.length ?? 0), 0) + (sub.pois?.length ?? 0),
      })
    }
  }
  return out
})

/**
 * 星穹列车的**根部名字** —— 它用「车厢条」渲染，而不是磁极点位图。
 *
 * 为什么单独给它一条渲染路径：列车是「大区 → 车厢 → 房间」三层，
 * 而磁极是「大区 → 子区 → 场景」三层里的点位。把车厢当磁极点去画，
 * 房间那一层就无处安放，只能压平成一排药丸（层级信息全丢）。
 */
const TRAIN_ROOT = '星穹列车'

/** 全域视图的排版常量 */
const MARGIN = 24
const GAP = 24
const ROW1_Y = 26
const WING_H = 430

/**
 * ★ 全域比例尺：1 个锚点单位 = 多少米。
 *
 * 这个值不是拍脑袋来的 —— 它是**按轨道交通用时反解**出来的：
 *   用户给的约束「泊地站 → 珠星站 = 60 分」，轨道制式 32km/h + 进站 4 分
 *   → 需要 29.87 km；两站锚点距 447 px → **1 px ≈ 66.8 m**。
 * 布局里的点位坐标就是照这个尺度摆的，改了坐标就必须同步改它，否则比例尽失。
 *
 * ⚠ 说明为什么"只改比例尺"做不到：三条约束（珠星↔泊地 60 / 海原↔泊地 60 /
 *   观览云岛↔泊地 30）各自需要的比例系数是 66.8 / 142.6 / 29.6，**差 4.8 倍**，
 *   单一 k 无解 —— 所以是**移点位**而不是改比例尺。这里只把结果记录下来并展示。
 */
const M_PER_PX = 66.8
const TRAIN_H = 210
const PLAIN_H = 132
/** 车厢内最多列出几个地点（再多就折叠成「…另有 N 处」） */
const CAR_KID_MAX = 5

/** 全库节点索引（子区优先于同名场景，遍历顺序天然保证） */
const allNodes = computed(() => {
  const m = new Map()
  const walk = ns => { for (const n of ns) { if (!m.has(n.name)) m.set(n.name, n); walk(n.children ?? []) } }
  walk(props.map?.tree ?? [])
  return m
})

/**
 * 全域视图布局 —— **按大区逐块排**，高度动态累加。
 *
 * 三种块型：
 *   overview —— 登记在 `REGION_LAYOUT` 的磁极（左右并列，点位用官方总览图像素坐标等比映射）
 *   cars     —— 星穹列车：车厢并排，房间列在所属车厢内
 *   plain    —— 其余大区：子区列成药丸（泛化后的兜底，替掉早先那行"其他子区"）
 *
 * 用 computed 而不是常量：`viewBox` 的高度要跟着块数走。
 */
const overview = computed(() => {
  const roots = props.map?.tree ?? []
  const known = new Set(Object.keys(REGION_LAYOUT))
  const groups = []

  // ── 行 0：★ 幻月（二相乐园的月球）—— 居中偏上，独立于双翼 ──
  //   用户口径：幻月秘庭在幻月内部，应「居中靠上」。双翼（喜笑/悲泣）随之下移。
  const moonUsed = new Set()
  const moonH = 150
  const moonY = ROW1_Y
  const moonW = Math.min(420, W - MARGIN * 2)
  const moonX = (W - moonW) / 2
  {
    const used = moonUsed
    const spots = MOON_LAYOUT.spots.map(sp => {
      const node = allNodes.value.get(SPOT_ALIAS[sp.n] ?? sp.n) ?? null
      const kids = node?.children ?? []
      const isArea = kids.length > 0
      used.add(node?.name ?? sp.n)
      const poi = kids.reduce((a, c) => a + (c.pois?.length ?? 0), 0) + (node?.pois?.length ?? 0)
      const p = PLACE[sp.place] ?? PLACE.b
      // 区块内相对比例 → 屏幕坐标（月球不在官方总览图坐标系里，故用比例而非像素）
      const px = moonX + 24 + sp.rx * (moonW - 48)
      const py = moonY + 42 + sp.ry * (moonH - 42 - 20)
      return {
        name: sp.n, raw: node,
        count: isArea ? kids.length : poi, unit: isArea ? '场景' : 'POI', poi,
        px, py, tx: px + p.dx, ty: py + p.dy, ta: p.ta,
      }
    })
    groups.push({
      type: 'moon', key: '幻月', pole: MOON_LAYOUT.pole, tone: 'is-moon',
      spots, extras: [], x: moonX, y: moonY, w: moonW, h: moonH, ey: moonY + moonH - 10,
      plotScale: 1,
    })
  }

  // ── 行 1：磁极（左右并列）—— 在幻月之下 ──
  const WINGS_Y = moonY + moonH + GAP
  const poleRoots = roots.filter(r => known.has(r.name))
  const cols = Math.max(1, poleRoots.length)
  const colW = (W - MARGIN * 2 - GAP * (cols - 1)) / cols
  poleRoots.forEach((root, i) => {
    const cfg = REGION_LAYOUT[root.name]
    const x = MARGIN + i * (colW + GAP)
    const plot = { x: x + 30, w: colW - 60, y: WINGS_Y + 54, h: WING_H - 54 - 56 }
    const s = Math.min(plot.w / cfg.box.w, plot.h / cfg.box.h)
    const ox = plot.x + (plot.w - cfg.box.w * s) / 2
    const oy = plot.y + (plot.h - cfg.box.h * s) / 2
    const used = new Set()
    const spots = cfg.spots.map(sp => {
      const node = allNodes.value.get(SPOT_ALIAS[sp.n] ?? sp.n) ?? null
      // 有下级的都当容器看（子区是 lv2；个别次级容器如「海原电视塔」是 lv3 但带 5 个子场景）
      const kids = node?.children ?? []
      const isArea = kids.length > 0
      // ★ 只要登记在 REGION_LAYOUT.spots 里，就算「已画在图上」——**不能反过来要求它有下级**。
      //   异常防御部是 lv2 但零子场景（isArea=false），曾被画成一个点位 + 又落进
      //   底部「自建子区」药丸，同一个节点渲染两次。
      used.add(node?.name ?? SPOT_ALIAS[sp.n] ?? sp.n)
      const poi = kids.reduce((a, c) => a + (c.pois?.length ?? 0), 0) + (node?.pois?.length ?? 0)
      const p = PLACE[sp.place] ?? PLACE.r
      const px = ox + (sp.x - cfg.box.x) * s, py = oy + (sp.y - cfg.box.y) * s
      return {
        name: sp.n, raw: node,
        count: isArea ? kids.length : poi, unit: isArea ? '场景' : 'POI', poi,
        px, py, tx: px + p.dx, ty: py + p.dy, ta: p.ta,
      }
    })
    // 同一磁极下、总览图上没画到的子区（本库自建）→ 收到翼框底部。
    // ★★ 必须**同时排除幻月区块已消费的节点**（`moonUsed`）——
    //   否则「幻月秘庭」会既画在上方幻月区块里、又落进悲泣区底部「自建子区」药丸，
    //   同一个节点渲染两次（实测踩到）。
    const extras = areas.value.filter(a => a.pole === root.name && !used.has(a.name) && !moonUsed.has(a.name))
      .map(a => ({ name: a.name, raw: a.raw }))
    groups.push({
      type: 'overview', key: root.name, pole: cfg.pole, tone: i === 0 ? 'is-joy' : 'is-grief',
      spots, extras, x, y: WINGS_Y, w: colW, h: WING_H, ey: WINGS_Y + WING_H - 34,
      // ★ 把「原始锚点 → 屏幕」的实际缩放率带出去：
      //   比例尺显示的必须是**屏幕上量到的距离**对应的真实公里数，
      //   直接用原始锚点差算会差一个 s 倍（这里是缩小过的）。
      plotScale: s,
    })
  })

  let cursor = WINGS_Y + WING_H
  let bottom = cursor

  // ── 行 2：星穹列车（车厢条，通栏）──
  const train = roots.find(r => r.name === TRAIN_ROOT)
  if (train) {
    const x = MARGIN, y = cursor + 20, w = W - MARGIN * 2, h = TRAIN_H
    const kids = (train.children ?? []).filter(c => !c._isDangling)
    const n = Math.max(1, kids.length)
    const pad = 14
    const carW = (w - pad * 2 - GAP * 0.5 * (n - 1)) / n
    const cars = kids.map((car, i) => {
      const cx = x + pad + i * (carW + GAP * 0.5)
      const cy = y + 40
      const ch = h - 40 - 16
      const all = car.children ?? []
      return {
        id: car.id, name: car.name, raw: car,
        x: cx, y: cy, w: carW, h: ch,
        kids: all.slice(0, CAR_KID_MAX), more: Math.max(0, all.length - CAR_KID_MAX),
      }
    })
    groups.push({ type: 'cars', key: train.name, root: train, cars, x, y, w, h })
    cursor = y + h
    bottom = cursor
  }

  // ── 行 3+：其余大区（通用面板）──
  for (const root of roots) {
    if (known.has(root.name) || root.name === TRAIN_ROOT) continue
    const y = cursor + 14
    const x = MARGIN, w = W - MARGIN * 2, h = PLAIN_H
    const subs = root.children ?? []
    const perRow = Math.max(1, Math.floor((w - 32) / 118))
    const pw = Math.min(112, (w - 32 - (perRow - 1) * 8) / perRow)
    const pills = subs.map((s, i) => ({
      id: s.id, name: s.name, raw: s,
      x: x + 16 + (i % perRow) * (pw + 8),
      y: y + 44 + Math.floor(i / perRow) * 28,
      w: pw,
    }))
    groups.push({ type: 'plain', key: root.name, root, pills, x, y, w, h })
    cursor = y + h
    bottom = cursor
  }

  // ── 比例尺与参考用时：全域布局是按轨道用时反解出来的，
  //    不把「图上距离 = 实际多远」写出来，用户无从判断远近，也没法自己核对。
  const g0 = groups.find(x => x.type === 'overview')
  let scaleBar = null
  const refs = { zhuxing: '—', haiyuan: '—', guanlan: '—' }
  if (g0) {
    const plotW = g0.x + g0.w - 24
    const px100 = (100000 / M_PER_PX) * (g0.plotScale ?? 1)   // 100km 在图上的像素
    scaleBar = {
      y: bottom + 26,
      px: Math.min(px100, Math.max(40, plotW * 0.55)),
      mPerPx: M_PER_PX / (g0.plotScale ?? 1),
      km: ((Math.min(px100, Math.max(40, plotW * 0.55)) * M_PER_PX) / (g0.plotScale ?? 1) / 1000).toFixed(0),
    }
    const pt = (n) => {
      const cfg = REGION_LAYOUT[g0.key]
      const sp = cfg?.spots.find(s => s.n === n || SPOT_ALIAS[s.n] === n)
      return sp ? [sp.x, sp.y] : null
    }
    const d2 = (a, b) => (a && b) ? Math.hypot(a[0] - b[0], a[1] - b[1]) * M_PER_PX / 1000 : null
    const eta = (km) => km == null ? '—' : Math.round(4 + km / 32 * 60)   // 轨道 32km/h + 进站 4 分
    const o = pt('二维市')
    refs.zhuxing = eta(d2(o, pt('珠星集团CBD区')))
    refs.haiyuan = eta(d2(o, pt('海原市')))
    refs.guanlan = eta(d2(o, pt('观览云岛站')))
  }

  return { groups, height: Math.max(bottom + MARGIN + (scaleBar ? 44 : 0), WINGS_Y + WING_H + MARGIN), scaleBar, refs }
})

function pick(raw) { emit('select', raw) }

// ── 手动布局（拖拽）──────────────────────────────────────────
// ⚠ 2026-10-06 用户反馈：「被拖动过的点位不能保存最后点位的坐标，对 LLM 计算距离造成阻碍」。
//   原实现只写 localStorage —— **只有本机这个浏览器看得见**，后端与 LLM 完全读不到，
//   所以日程/通勤那条链路根本不知道用户把点位摆到了哪儿。
//   现在改为**双写**：localStorage 保即时渲染（刷新即见），**同时落库到后端**
//   （world_map_places.pos_x / pos_y），后者才是 LLM 能读到的真源。
const LS_KEY = 'linshe.worldmap.pointLayout'
const overrides = ref({})
try {
  const raw = localStorage.getItem(LS_KEY)
  if (raw) overrides.value = JSON.parse(raw) || {}
} catch { overrides.value = {} }

/** 后端落库队列：按 节点/时间 去抖，避免拖一次发一串请求 */
const pendingSaves = new Map()
let saveTimer = null
const saveState = ref('idle')          // idle | saving | saved | error
const lastSaveError = ref('')

async function flushSaves() {
  saveTimer = null
  const batch = [...pendingSaves.entries()]
  pendingSaves.clear()
  if (!batch.length) return
  saveState.value = 'saving'
  lastSaveError.value = ''
  try {
    // 串行写（本项目后端单实例，并发无益）；单个失败不回滚其它
    for (const [id, pos] of batch) {
      await api.updateWorldMapPlace(id, { pos_x: pos.nx, pos_y: pos.ny })
    }
    saveState.value = 'saved'
    emit('layout-saved', { count: batch.length })
  } catch (err) {
    saveState.value = 'error'
    lastSaveError.value = err?.message || '保存失败'
    // ⚠ 失败时**把没写成的放回队列**，下次拖拽/重试还能补上（否则坐标静默丢失）
    for (const [id, pos] of batch) if (!pendingSaves.has(id)) pendingSaves.set(id, pos)
  }
}

/**
 * 记一次手动摆放。
 * @param {number} placeId 该点位对应的地图节点 id（没有 id 时只落 localStorage）
 * @param {number} nx 归一化 x；**-1 表示"清除摆放"**（重置片区时用）
 */
function queueSave(placeId, nx, ny) {
  if (!placeId) return
  pendingSaves.set(placeId, { nx, ny })
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSaves, 500)     // 去抖：连续拖拽只发最后一次
}

function saveOverrides() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(overrides.value)) } catch { /* 隐私模式等，忽略 */ }
}
/** 标点的键：地图 + 片区 + 名称（名称是稳定标识，id 会随重建变） */
function okey(area, name) { return `${props.map?.id ?? 0}::${area}::${name}` }

const dragging = ref(null)

function onPointerDown(e, n) {
  if (e.button !== undefined && e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  dragging.value = { area: activeArea.value, name: n.name, id: n.id }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}
function onPointerMove(e) {
  const d = dragging.value
  const svg = svgEl.value
  if (!d || !svg) return
  // 用 SVG 的屏幕变换矩阵反算 —— preserveAspectRatio 的留白也自动算进去
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const loc = pt.matrixTransform(svg.getScreenCTM().inverse())
  const nx = Math.min(1, Math.max(0, loc.x / W))
  const ny = Math.min(1, Math.max(0, loc.y / H))
  overrides.value = { ...overrides.value, [okey(d.area, d.name)]: { nx, ny } }
  lastPos.value = { nx, ny }
}
const lastPos = ref(null)
function onPointerUp() {
  const d = dragging.value
  if (d) {
    saveOverrides()                                    // 本地：刷新即见
    if (lastPos.value) queueSave(d.id, lastPos.value.nx, lastPos.value.ny)  // ★ 落库：LLM 才读得到
    dragging.value = null
    lastPos.value = null
  }
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}
onBeforeUnmount(onPointerUp)

/** 本片区被手动调过的标点数 */
const areaMovedCount = computed(() => {
  const a = activeArea.value
  if (!a) return 0
  const pre = `${props.map?.id ?? 0}::${a}::`
  return Object.keys(overrides.value).filter(k => k.startsWith(pre)).length
})
function resetArea() {
  const a = activeArea.value
  if (!a) return
  const pre = `${props.map?.id ?? 0}::${a}::`
  const next = {}
  for (const [k, v] of Object.entries(overrides.value)) if (!k.startsWith(pre)) next[k] = v
  overrides.value = next
  saveOverrides()
  // ★ 同时**清掉后端落库的坐标**（写 -1 = 未摆放），否则刷新后旧坐标又回来了。
  const area = areas.value.find(x => x.name === a)
  for (const s of area?.scenes || []) {
    const r = s.raw || s
    if (typeof r.pos_x === 'number' && r.pos_x >= 0 && r.id) {
      queueSave(r.id, -1, -1)
    }
  }
}

function switchArea(name) { activeArea.value = name }

/** 手动调整优先于自动排布 */
function applyOverrides(area, nodes) {
  for (const n of nodes) {
    // ★ **后端坐标优先**：pos_x/pos_y 是用户之前拖拽时落库的权威值（换浏览器/清缓存也在）。
    //   localStorage 只作为"尚未落库成功"时的即时兜底（如后端写失败、离线）。
    const raw = n.raw || {}
    const hasServer = typeof raw.pos_x === 'number' && raw.pos_x >= 0
      && typeof raw.pos_y === 'number' && raw.pos_y >= 0
    if (hasServer) {
      n.px = raw.pos_x * W
      n.py = raw.pos_y * H
      n.moved = true
      continue
    }
    const o = overrides.value[okey(area, n.name)]
    if (o) { n.px = o.nx * W; n.py = o.ny * H; n.moved = true }
  }
}

// ── 片区视图的投影 ──────────────────────────────────────────
const plot = computed(() => {
  const area = activeArea.value
  const a = areas.value.find(x => x.name === area)
  if (!a) return { nodes: [], hasExact: false, exactN: 0, barW: 0 }
  const cmap = coords.areas?.[area] ?? {}
  const nodes = a.scenes.map(s => {
    const c = cmap.nodes?.[s.name] ?? { x: null, y: null, src: 'inferred' }
    return { id: s.id, name: s.name, raw: s, x: c.x, y: c.y, src: c.src || 'inferred', game: c.game }
  })
  const ex = nodes.filter(n => n.src === 'exact' && n.x !== null)
  const infl = nodes.filter(n => n.src !== 'exact' || n.x === null)

  /** 没有游戏坐标的场景：排到画布下缘的网格里（不占精确点群），由用户拖到该去的地方 */
  function layoutLoose(list, bottomBand) {
    if (!list.length) return
    const cols = Math.min(list.length, 6)
    const rows = Math.ceil(list.length / cols)
    const usable = W - 160
    const cw = usable / cols
    const yTop = bottomBand ? H - 56 - (rows - 1) * 48 : H / 2 - ((rows - 1) * 48) / 2
    list.forEach((n, i) => {
      const r = Math.floor(i / cols), c = i % cols
      const cnt = (r === rows - 1 && list.length % cols) ? list.length % cols : cols
      const off = (usable - (cnt - 1) * cw) / 2
      n.px = 80 + off + c * cw
      n.py = yTop + r * 48
    })
  }

  if (!ex.length) {
    layoutLoose(nodes, false)
    applyOverrides(area, nodes)
    return { nodes, hasExact: false, exactN: 0, barW: 0 }
  }

  const pad = 76
  const xs = ex.map(n => n.x), ys = ex.map(n => n.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1)
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const PX = x => W / 2 + (x - cx) * scale
  // ⚠ 游戏坐标 y 是**向下为正**（实测：lx = 0.5x + 974.95，ly = 0.5y + 705.95，两轴斜率同为正）
  const PY = y => H / 2 + (y - cy) * scale
  for (const n of ex) { n.px = PX(n.x); n.py = PY(n.y) }
  layoutLoose(infl, true)
  applyOverrides(area, nodes)
  return { nodes, hasExact: true, exactN: ex.length, barW: 200 * scale }
})
</script>

<style scoped>
.mpt { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: 10px; }

/* 视图切换 */
.mpt-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.mpt-tab {
  padding: 4px 12px; border-radius: var(--radius-full); cursor: pointer;
  border: var(--border); background: var(--glass-bg); color: var(--text-secondary);
  font-size: var(--fs-xs); transition: all var(--dur-fast) var(--ease-out);
}
.mpt-tab:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
.mpt-tab.active { background: var(--accent-solid); border-color: var(--accent); color: #fff; font-weight: 600; }
.mpt-tab.dim { opacity: .5; }

/* 画布 */
.mpt-canvas {
  position: relative;
  flex: 1; min-height: 0; border: var(--border-strong); border-radius: var(--radius-lg);
  background: var(--bg-sunken); overflow: hidden;
}
.mpt-svg { width: 100%; height: 100%; display: block; }
.mpt-svg.is-dragging { cursor: grabbing; }

/* 全域（按官方区域总览图排布） */
.mpt-wing { fill: var(--glass-bg); stroke: var(--border-strong); stroke-width: 1; }
.mpt-wing.is-joy { fill: color-mix(in srgb, var(--fun-gold) 7%, transparent); stroke: color-mix(in srgb, var(--fun-gold) 42%, transparent); }
.mpt-wing.is-grief { fill: color-mix(in srgb, var(--fun-blue) 7%, transparent); stroke: color-mix(in srgb, var(--fun-blue) 42%, transparent); }
.mpt-wing.is-train { fill: color-mix(in srgb, var(--accent) 6%, transparent); stroke: color-mix(in srgb, var(--accent) 40%, transparent); }
/* ★ 幻月（月球）：居中偏上的独立区块。用胶囊形（rx 70）与地面双翼的方角区分，
   色调取中性偏紫（不是 joy 金 / grief 蓝 —— 它不属于任何一翼）。 */
.mpt-moon {
  fill: color-mix(in srgb, var(--accent) 9%, transparent);
  stroke: color-mix(in srgb, var(--accent) 46%, transparent);
  stroke-width: 1;
  stroke-dasharray: 6 5;
}
.mpt-wing-name { font-size: 15px; font-weight: 700; }
.mpt-wing-name.is-joy { fill: var(--fun-gold); }
.mpt-wing-name.is-grief { fill: var(--fun-blue); }
.mpt-wing-name.is-train { fill: var(--accent); }
.mpt-wing-name.is-moon { fill: var(--accent); }
.mpt-wing-pole { font-size: 10px; fill: var(--text-secondary); }

/* ── 车厢条（星穹列车）── */
.mpt-car {
  fill: var(--bg-secondary); stroke: var(--border-strong); stroke-width: 1;
  cursor: pointer; transition: stroke-width var(--dur-fast) var(--ease-out);
}
.mpt-car:hover { stroke: var(--accent); stroke-width: 2; }
.mpt-car.selected { stroke: var(--accent); stroke-width: 2.6; }
.mpt-car-name { font-size: 11.5px; font-weight: 700; fill: var(--text-primary); pointer-events: none; }
.mpt-car-n { font-size: 9.5px; fill: var(--text-secondary); pointer-events: none; }
/* 车内地点（房间）：可点可选 */
.mpt-car-kid {
  fill: color-mix(in srgb, var(--accent) 10%, transparent);
  stroke: color-mix(in srgb, var(--accent) 42%, transparent); stroke-width: 1; cursor: pointer;
}
.mpt-car-kid:hover { fill: color-mix(in srgb, var(--accent) 22%, transparent); }
.mpt-car-kid.selected { fill: var(--accent); }
.mpt-car-kid-t { font-size: 10px; fill: var(--text-primary); pointer-events: none; }
.mpt-car-more { font-size: 9px; fill: var(--text-secondary); pointer-events: none; }

.mpt-spot.is-clickable { cursor: pointer; }
.mpt-spot.is-clickable:hover .mpt-mk { stroke-width: 3; }
.mpt-mk { stroke-width: 1.8; transition: stroke-width var(--dur-fast) var(--ease-out); }
.mpt-mk.is-poi { fill: color-mix(in srgb, var(--accent-3) 26%, transparent); stroke: var(--accent-3); }
.mpt-mk.is-empty { fill: color-mix(in srgb, var(--danger) 22%, transparent); stroke: var(--danger); }
.mpt-mk.is-todo { fill: none; stroke: var(--text-secondary); stroke-width: 1.4; stroke-dasharray: 2 3; opacity: .7; }
.mpt-mk.selected { stroke: var(--accent); stroke-width: 3.4; }
.mpt-mk-core { fill: var(--text-primary); opacity: .9; pointer-events: none; }
.mpt-mk-label { font-size: 10.5px; font-weight: 600; pointer-events: none; }
.mpt-mk-label.is-on { fill: var(--text-primary); }
.mpt-mk-label.is-todo { fill: var(--text-secondary); font-weight: 400; }

.mpt-extras-t { font-size: 9.5px; fill: var(--text-secondary); }
.mpt-extra { fill: color-mix(in srgb, var(--accent) 12%, transparent); stroke: color-mix(in srgb, var(--accent) 55%, transparent); cursor: pointer; }
.mpt-extra:hover { fill: color-mix(in srgb, var(--accent) 22%, transparent); }
.mpt-extra.selected { fill: var(--accent); }
.mpt-extra-t { font-size: 10px; fill: var(--text-primary); cursor: pointer; }

/* 片区 · 标点（可拖拽）*/
.mpt-grid line { stroke: var(--border); stroke-width: .5; opacity: .5; }
.mpt-node { cursor: grab; touch-action: none; }
.mpt-node.is-exact { fill: var(--fun-gold); stroke: color-mix(in srgb, var(--fun-gold) 60%, #000); stroke-width: 1.5; }
.mpt-node.is-infer { fill: var(--bg-secondary); stroke: var(--text-secondary); stroke-width: 1.2; }
.mpt-node.selected { stroke: var(--accent); stroke-width: 3; }
.mpt-node.moved { stroke-dasharray: 2 2; }   /* 手动调过的用虚线描边，与自动排布区分 */
.mpt-node.dragging { cursor: grabbing; }
.mpt-node-label { font-size: 11px; pointer-events: none; }
.mpt-node-label.exact { fill: var(--text-primary); font-weight: 600; }
.mpt-node-label.inferred { fill: var(--text-secondary); }
.mpt-scale-bar { stroke: var(--text-secondary); stroke-width: 2; }
.mpt-scale-text { font-size: 10px; fill: var(--text-secondary); }
.mpt-empty { font-size: 13px; fill: var(--text-secondary); }

/* 拖拽提示条 */
.mpt-dragbar {
  position: absolute; top: 8px; right: 10px;
  display: flex; align-items: center; gap: 8px;
  padding: 3px 8px; border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
  border: var(--border); font-size: 10px; color: var(--text-secondary);
}
.mpt-drag-moved { color: var(--fun-gold); }
.mpt-drag-reset {
  border: 0; background: transparent; cursor: pointer; padding: 0;
  font-size: 10px; color: var(--accent); text-decoration: underline;
}
.mpt-drag-reset:hover { color: var(--accent-hover); }

/* 图例 */
.mpt-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: var(--fs-xs); color: var(--text-secondary); flex-shrink: 0; }
.mpt-lg { display: inline-flex; align-items: center; gap: 5px; }
.mpt-sw { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.mpt-sw.has-poi { background: var(--accent-3); }
.mpt-sw.no-poi { background: var(--danger); }
.mpt-sw.is-todo { background: transparent; border: 1.5px dashed var(--text-secondary); }
.mpt-sw.is-car { background: color-mix(in srgb, var(--accent) 40%, transparent); border: 1px solid var(--accent); }
.mpt-sw.is-exact { background: var(--fun-gold); }
.mpt-sw.is-infer { background: var(--bg-secondary); border: 1.5px solid var(--text-secondary); }
</style>
