<template>
  <div class="wmap-view page-host">
    <!-- ── 顶栏 ── -->
    <div class="wmap-header">
      <linshe-button
        v-if="isMobile"
        variant="icon"
        title="导航"
        @click="toggleMobileSidebar?.()"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </linshe-button>

      <h2 class="wmap-title">地图</h2>
      <span class="wmap-sub">世界地图骨架 · 大地区 → 子地区 → 场景 → 生活地点</span>
      <span class="wmap-spacer"></span>

      <linshe-button v-if="map" variant="ghost" size="sm" title="导出 Markdown" @click="onExport">导出</linshe-button>
      <linshe-button v-if="maps.length" variant="secondary" size="sm" @click="pickerOpen = true">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px">
          <path d="M3 6h18M3 12h18M3 18h18"/>
        </svg>我的地图<span v-if="maps.length > 1" class="wmap-count">{{ maps.length }}</span>
      </linshe-button>
    </div>

    <!-- ── 空态：强引导（第 0 步）── -->
    <div v-if="!map" class="wmap-empty">
      <div class="we-card">
        <div class="we-icon">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>
          </svg>
        </div>
        <h3>给你的世界画一张地图</h3>
        <p class="we-lead">
          不用从零想。告诉我一句话，AI 会照着你的世界观先搭出<strong>大地区</strong>和<strong>子地区</strong>两级骨架，
          你看过、改过，再逐个区域展开成街道与店铺。
        </p>

        <div class="we-field">
          <label>世界观</label>
          <div class="we-world" :class="{ 'is-missing': worldState === 'none' }">
            <template v-if="worldState === 'loading'">读取中…</template>
            <template v-else-if="worldName">
              <span class="we-world-dot"></span>{{ worldName }}
            </template>
            <template v-else-if="worldState === 'none'">
              没有激活的世界观 —— 请先到「世界观设置」启用一个
            </template>
            <template v-else>
              暂时读不到世界观，仍可直接生成（后端会给明确提示）
            </template>
          </div>
        </div>

        <div class="we-field">
          <label>一句话要求<span class="we-opt">（可留空）</span></label>
          <linshe-input
            v-model="brief"
            type="textarea"
            :rows="2"
            placeholder="例：一座沿海的港口城市，重工业和渔业都在，夜里比白天热闹"
          />
        </div>

        <!-- 只在**确定**没有激活世界观时才禁用；读失败（unknown）不拦，交给后端报错，
             避免「前端读不到 → 用户被永久卡住」这种死路。 -->
        <linshe-button variant="primary" :loading="busy" :disabled="worldState === 'none'" @click="onStartFromScratch">
          开始生成骨架
        </linshe-button>
        <p class="we-hint">只出两级骨架，几秒钟就好；场景和店铺之后再逐区展开。</p>
      </div>
    </div>

    <!-- ── 主体：左树 + 右详情 ──
         树用「扁平化 + 缩进」渲染而不是递归组件：层级不限深，缩进让深度直接可见
         （之前是硬编码两层，第四层的"1F 展示大厅"这类会被压平）。 -->
    <div v-else class="wmap-body">
      <!-- 左：层级树 -->
      <aside class="wmap-tree">
        <div class="wt-head">
          <span class="wt-name">{{ map.name }}</span>
          <linshe-button variant="icon" size="sm" title="重命名 / 备注" @click="openSettings">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
          </linshe-button>
        </div>

        <div class="wt-stats">
          <span>{{ map.places.length }} 个地点</span><i>·</i>
          <span>{{ map.stats.poi }} 生活地点</span>
        </div>

        <div class="wt-list">
          <button
            v-for="n in flatTree" :key="n.id"
            type="button"
            class="wt-node"
            :class="{ active: selected?.id === n.id, [`lv${Math.min(n.level, 4)}`]: true }"
            :style="{ paddingLeft: (6 + n._depth * 13) + 'px' }"
            @click="onNodeClick(n)"
          >
            <svg
              v-if="n.children.length" class="wt-caret" :class="{ open: !collapsed.has(n.id) }"
              viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor"
              stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
              @click.stop="toggleCollapse(n.id)"
            ><polyline points="9 18 15 12 9 6"/></svg>
            <span v-else class="wt-leaf-dot"></span>

            <span class="wt-node-name">{{ n.name }}</span>
            <span v-if="n.kind" class="wt-kind">{{ n.kind }}</span>
            <span v-if="n.children.length" class="wt-badge" :title="`${n.children.length} 个下级地点`">{{ n.children.length }}</span>
            <span v-else-if="n.pois.length" class="wt-badge is-poi" :title="`${n.pois.length} 个生活地点`">{{ n.pois.length }}</span>
          </button>

          <button type="button" class="wt-add is-top" @click="onAddChild(null)">+ 添加顶层地点</button>
        </div>
      </aside>

      <!-- 右：详情（任何层级都是同一套结构） -->
      <section class="wmap-detail">
        <div v-if="!selected" class="wd-placeholder">
          <template v-if="!map.places.length">
            <p class="wd-ph-title">还没有任何地点</p>
            <p class="wd-ph-lead">点左边的「添加顶层地点」手动建，或重新生成一次骨架。</p>
          </template>
          <template v-else>
            <p class="wd-ph-title">选一个地点</p>
            <p class="wd-ph-lead">
              从左边选一个地点，就能看它的<strong>下级地点</strong>与<strong>生活地点</strong>，
              也可以手动添加、编辑。
            </p>
          </template>
        </div>

        <template v-else>
          <div class="wd-head">
            <div>
              <h3 class="wd-name">
                {{ selected.name }}
                <span v-if="selected.name_en" class="wd-en">{{ selected.name_en }}</span>
                <span class="wd-lv">{{ levelLabel(selected.level) }}</span>
              </h3>
              <p v-if="selected.summary" class="wd-summary">{{ selected.summary }}</p>
            </div>
            <div class="wd-head-ops">
              <linshe-button variant="ghost" size="sm" title="编辑名称 / 英文名 / 类型 / 简介" @click="openEdit(selected)">编辑</linshe-button>
              <linshe-button variant="ghost" size="sm" tone="danger" @click="onDelete(selected)">删除</linshe-button>
            </div>
          </div>

          <div class="wd-ops">
            <linshe-button variant="secondary" size="sm" @click="onAddChild(selected)">+ 添加下级地点</linshe-button>
            <linshe-button variant="secondary" size="sm" :loading="busy" @click="onExpand(selected)">
              ✨ 让 AI 展开下一级
            </linshe-button>
            <span class="wd-ops-hint">下面还有 {{ selected.children.length }} 个下级 · {{ selected.pois.length }} 个生活地点</span>
          </div>

          <!-- 下级地点 -->
          <div v-if="selected.children.length" class="wd-sect">
            <p class="wd-sect-title">下级地点<span class="wd-sect-hint">点进去看更细的一层</span></p>
            <div class="wd-scene-grid">
              <button v-for="c in selected.children" :key="c.id" type="button" class="wdistrict-card" @click="onNodeClick(c)">
                <span class="wdistrict-name">{{ c.name }}</span>
                <span v-if="c.kind" class="wt-kind">{{ c.kind }}</span>
                <span class="wdistrict-state">
                  {{ c.children.length ? `${c.children.length} 个下级` : (c.pois.length ? `${c.pois.length} 个生活地点` : '空') }}
                </span>
              </button>
            </div>
          </div>

          <!-- 生活地点：任何层级都能加（一条街本身也可以是"有营生"的那一层） -->
          <div class="wd-sect">
            <p class="wd-sect-title">
              生活地点
              <span class="wd-sect-hint">店 / 设施 · 一行一条</span>
            </p>

            <div v-if="selected.pois.length" class="wpoi-edit">
              <div class="wpoi-head">
                <span class="wpoi-h-type">类型</span>
                <span class="wpoi-h-name">名称</span>
                <span class="wpoi-h-blurb">一句生活气息</span>
              </div>
              <div v-for="(p, i) in selected.pois" :key="i" class="wpoi-row">
                <linshe-select v-model="p.type" :options="poiOptions" size="sm" class="wpoi-type-sel" aria-label="类型" />
                <linshe-input v-model="p.name" size="sm" class="wpoi-name-in" placeholder="名称" @input="poisDirty = true" />
                <linshe-input v-model="p.blurb" size="sm" class="wpoi-blurb-in" placeholder="可留空" @input="poisDirty = true" />
                <button type="button" class="wpoi-del" title="删除这条" @click="removePoi(i)">×</button>
              </div>
            </div>
            <p v-else class="wd-empty">还没有生活地点</p>

            <div class="wpoi-foot">
              <linshe-button variant="ghost" size="sm" @click="addPoi">+ 添加一条</linshe-button>
              <span class="wpoi-spacer"></span>
              <linshe-button v-if="poisDirty" variant="primary" size="sm" :loading="busy" @click="savePois">保存生活地点</linshe-button>
            </div>
          </div>
        </template>
      </section>
    </div>


    <!-- ── 我的地图列表 ── -->
    <linshe-modal v-model="pickerOpen" title="我的地图">
      <div class="wm-picker">
        <div class="wm-create">
          <linshe-input v-model="newMapName" placeholder="新地图名，如：新世界" @keyup.enter="onCreate" />
          <linshe-button variant="primary" :disabled="!newMapName.trim() || busy" :loading="busy" @click="onCreate">
            {{ templateId ? '从模板创建' : '新建空白' }}
          </linshe-button>
        </div>
        <div class="we-field">
          <label>起点<span class="we-opt">（可选：复制一张已有地图作为模板）</span></label>
          <linshe-select
            v-model="templateId"
            size="sm"
            :options="[{ label: '空白地图（用 AI 从世界观生成）', value: '' }, ...maps.map(m => ({ label: `${m.name}（${m.place_count} 个地点）`, value: String(m.id) }))]"
          />
        </div>

        <div class="wm-list">
          <button
            v-for="m in maps" :key="m.id" type="button"
            class="wm-item" :class="{ active: m.id === map?.id }"
            @click="openMap(m.id)"
          >
            <span class="wm-item-name">{{ m.name }}</span>
            <span class="wm-item-meta">{{ m.place_count }} 个地点</span>
            <span class="wm-item-del" title="删除" @click.stop="onDeleteMap(m)">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </span>
          </button>
        </div>
        <p v-if="!maps.length" class="wm-empty">还没有地图。上面输入名字新建一张。</p>
      </div>
    </linshe-modal>

    <!-- ── 地点信息编辑 ── -->
    <linshe-modal v-model="editPlaceOpen" title="编辑地点">
      <div class="wm-picker">
        <div class="we-field">
          <label>名称</label>
          <linshe-input v-model="editPlace.name" placeholder="中文名" />
        </div>
        <div class="we-field">
          <label>英文名<span class="we-opt">（可选，官方风格合成意译）</span></label>
          <linshe-input v-model="editPlace.nameEn" placeholder="如 Duomension City" />
        </div>
        <div class="we-field">
          <label>类型<span class="we-opt">（可选，如 核心区 / 车站 / 商店街）</span></label>
          <linshe-input v-model="editPlace.kind" />
        </div>
        <div class="we-field">
          <label>一句话简介</label>
          <linshe-input v-model="editPlace.summary" type="textarea" :rows="3" placeholder="这块地方长什么样、什么人来" />
        </div>
        <linshe-button variant="primary" :disabled="busy || !editPlace.name.trim()" :loading="busy" @click="onSaveEdit">保存</linshe-button>
      </div>
    </linshe-modal>

    <!-- ── 地图名 / 备注 ── -->
    <linshe-modal v-model="settingsOpen" title="地图信息">
      <div class="wm-picker">
        <div class="we-field">
          <label>名称</label>
          <linshe-input v-model="editName" />
        </div>
        <div class="we-field">
          <label>总体定位<span class="we-opt">（生成时会作为上下文）</span></label>
          <linshe-input v-model="editNote" type="textarea" :rows="3" placeholder="例：沿海港口城市，重工业与渔业并存" />
        </div>
        <linshe-button variant="primary" :disabled="busy" @click="onSaveSettings">保存</linshe-button>
      </div>
    </linshe-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, inject, onMounted } from 'vue'
import * as api from '../api/index.js'
// ⚠ Linshe 组件是**局部 import**（main.js 里没有 app.component 全局注册）——
//    新页面必须自己引入，否则 <linshe-button> 等会被当成未知标签，
//    表现为"按钮根本不渲染成按钮、弹窗内容直接平铺到页面上"。
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import LinsheSelect from '../components/ui/LinsheSelect.vue'

const toggleMobileSidebar = inject('toggleMobileSidebar', null)
// 项目统一用 provide/inject 拿这两个（见 MediaView 等）
const toastFn = inject('toast')
const isMobile = inject('isMobile')

// ── 状态 ──
const maps = ref([])
const map = ref(null)
const selected = ref(null)
const busy = ref(false)
const brief = ref('')
const worldName = ref('')
const pickerOpen = ref(false)
const settingsOpen = ref(false)

// 新建 / 编辑
const newMapName = ref('')
const editName = ref('')
const editNote = ref('')

/** 折叠的节点 id 集合（默认为空 = 全展开；层级不限深，所以用集合而不是"第几层"） */
const collapsed = ref(new Set())
/** 生活地点有未保存的改动 */
const poisDirty = ref(false)

/** 地点信息编辑（名称/英文名/类型/简介） */
const editPlaceOpen = ref(false)
const editPlace = reactive({ id: null, name: '', nameEn: '', kind: '', summary: '' })

/** 新建地图时可选的模板（复制已有地图的整棵树） */
const templateId = ref('')

/** POI 类型下拉的选项（口径与后端一致） */
const poiOptions = [
  { label: '零售', value: '零售' },
  { label: '餐饮', value: '餐饮' },
  { label: '服务', value: '服务' },
  { label: '配套', value: '配套' },
]

/** 层级叫法（前三层有惯用名，第四层起统称"子地点"）—— 与后端 levelLabel 同口径 */
function levelLabel(level) {
  return { 1: '大地区', 2: '子地区', 3: '场景' }[level] || `子地点（${level} 级）`
}

/**
 * 树 → 扁平列表（带 _depth 缩进深度）。
 *
 * 为什么扁平化而不是递归组件：层级不限深，扁平 + padding-left 让深度直接可见，
 * 也不用为了递归再拆一个组件出去。折叠的节点不输出其子树。
 */
const flatTree = computed(() => {
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth })
      if (!collapsed.value.has(n.id) && n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(map.value?.tree || [], 0)
  return out
})

/** 还有多少地点没有下级 —— 空态与占位里的"下一步"提示用 */
const pendingDistricts = computed(() => {
  if (!map.value) return 0
  return (map.value.places || []).filter(p => !(p.children?.length) && !p.pois?.length).length
})

function poiClass(type) {
  return { 零售: 'retail', 餐饮: 'food', 服务: 'service', 配套: 'misc' }[type] || 'misc'
}

/** 选中项要跟着最新数据走（刷新后对象会被替换，直接存旧引用会拿到陈旧节点） */
function refreshSelected() {
  const id = selected.value?.id
  if (!id || !map.value) { selected.value = null; return }
  const flat = map.value.places || []
  selected.value = flat.find(p => p.id === id) || null
  // 选中项需要 children 才能渲染场景列表 —— 从树里取带 children 的那个
  const findInTree = nodes => {
    for (const n of nodes) {
      if (n.id === id) return n
      const hit = findInTree(n.children || [])
      if (hit) return hit
    }
    return null
  }
  const node = findInTree(map.value.tree)
  if (node) selected.value = node
}

// ── 数据加载 ──
async function loadMaps() {
  try { maps.value = (await api.listWorldMaps()).maps || [] } catch { maps.value = [] }
}
async function loadMap(id) {
  try {
    const r = await api.getWorldMap(id)
    map.value = r.map
    if (selected.value) refreshSelected()
  } catch (err) {
    toastFn?.('加载地图失败：' + (err?.message || ''), 'error')
  }
}

onMounted(async () => {
  await Promise.all([loadMaps(), loadWorldName()])
  if (maps.value.length) await loadMap(maps.value[0].id)
})

/** 世界观读取状态：loading / ok / none（确定没有激活项）/ unknown（读取失败） */
const worldState = ref('loading')

async function loadWorldName() {
  worldState.value = 'loading'
  try {
    const r = await api.getWorldSettings()
    // ⚠ 这个接口返回的是 `{ list: [...] }` —— 不是 `world_settings` 也不是 `items`。
    //   之前读错字段 → 世界观名恒为空 → 空态按钮被禁用 → 表现为「无法完成地图创建」。
    //   这里按优先级多认几个键，后端换字段名时也不至于直接失灵。
    const list = Array.isArray(r) ? r
      : (r?.list || r?.world_settings || r?.items || [])
    const active = list.find(w => w.is_active) || null
    worldName.value = active?.name || ''
    worldState.value = active ? 'ok' : 'none'
  } catch {
    worldName.value = ''
    worldState.value = 'unknown'   // 读失败 ≠ 没有：不拦用户
  }
}

// ── 交互 ──
function toggleCollapse(id) {
  const s = new Set(collapsed.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  collapsed.value = s
}
/**
 * 点树节点：选中它。若已有子级，**同时切换折叠** —— 这样一次点击既能看到内容、
 * 又能收起来，不用去点那个很小的三角（触屏尤其需要）。
 */
function onNodeClick(n) {
  selectPlace(n)
  if (n.children?.length) toggleCollapse(n.id)
}
function selectPlace(p) { selected.value = p; poisDirty.value = false }

// ── 生活地点编辑（本地改动 → 显式保存）──
function addPoi() {
  if (!selected.value) return
  if (!Array.isArray(selected.value.pois)) selected.value.pois = []
  selected.value.pois.push({ name: '', type: '配套', blurb: '' })
  poisDirty.value = true
}
function removePoi(i) {
  if (!selected.value) return
  selected.value.pois.splice(i, 1)
  poisDirty.value = true
}
async function savePois() {
  const s = selected.value
  if (!s || busy.value) return
  // 名称为空的条目丢掉（用户点了「添加一条」又没填）
  const clean = (s.pois || [])
    .map(p => ({ name: String(p.name || '').trim(), type: p.type || '配套', blurb: String(p.blurb || '').trim() }))
    .filter(p => p.name)
  busy.value = true
  try {
    await api.updateWorldMapPlace(s.id, { pois: clean })
    await loadMap(map.value.id)
    refreshSelected()
    // 展开到该节点，让用户看到改动落到了哪
    const sc = new Set(collapsed.value); sc.delete(s.id); collapsed.value = sc
    poisDirty.value = false
    await loadMaps()
    toastFn?.('生活地点已保存', 'success')
  } catch (err) {
    toastFn?.('保存失败：' + (err?.message || ''), 'error')
  } finally { busy.value = false }
}

// ── 地点信息编辑 ──
function openEdit(p) {
  editPlace.id = p.id
  editPlace.name = p.name
  editPlace.nameEn = p.name_en || ''
  editPlace.kind = p.kind || ''
  editPlace.summary = p.summary || ''
  editPlaceOpen.value = true
}
async function onSaveEdit() {
  if (!editPlace.id || busy.value) return
  busy.value = true
  try {
    await api.updateWorldMapPlace(editPlace.id, {
      name: editPlace.name.trim(),
      name_en: editPlace.nameEn.trim(),
      kind: editPlace.kind.trim(),
      summary: editPlace.summary.trim(),
    })
    editPlaceOpen.value = false
    await loadMap(map.value.id)
    refreshSelected()
    toastFn?.('已保存', 'success')
  } catch (err) {
    toastFn?.('保存失败：' + (err?.message || ''), 'error')
  } finally { busy.value = false }
}

async function onStartFromScratch() {
  if (busy.value) return
  busy.value = true
  try {
    // 空态直接开始 → 顺手建一张图（名字取自世界观，用户之后可改）
    const created = await api.createWorldMap({
      name: worldName.value || '我的地图',
      note: brief.value.trim(),
      worldSettingId: null,
    })
    const r = await api.generateWorldMapSkeleton(created.map.id, { brief: brief.value.trim() })
    map.value = r.map
    await loadMaps()
    toastFn?.('骨架生成好了', 'success')
  } catch (err) {
    toastFn?.('生成失败：' + (err?.message || ''), 'error')
  } finally { busy.value = false }
}

async function onCreate() {
  if (!newMapName.value.trim() || busy.value) return
  busy.value = true
  try {
    // 选了模板 → 复制它的整棵树（比从零生成快，也比在代码里再维护一份模板数据可靠）
    const r = templateId.value
      ? await api.duplicateWorldMap(Number(templateId.value), newMapName.value.trim())
      : await api.createWorldMap({ name: newMapName.value.trim() })
    newMapName.value = ''
    templateId.value = ''
    pickerOpen.value = false
    map.value = r.map
    selected.value = null
    collapsed.value = new Set()
    await loadMaps()
    toastFn?.(r.map.places.length ? `已从模板创建（${r.map.places.length} 个地点）` : '已新建空白地图', 'success')
  } catch (err) {
    toastFn?.('新建失败：' + (err?.message || ''), 'error')
  } finally { busy.value = false }
}

async function openMap(id) {
  pickerOpen.value = false
  selected.value = null
  await loadMap(id)
}

async function onDeleteMap(m) {
  if (!confirm(`删除地图「${m.name}」？其下所有地点会一并删除。`)) return
  try {
    await api.deleteWorldMap(m.id)
    await loadMaps()
    if (map.value?.id === m.id) {
      map.value = null; selected.value = null
      if (maps.value.length) await loadMap(maps.value[0].id)
    }
  } catch (err) { toastFn?.('删除失败：' + (err?.message || ''), 'error') }
}

async function onAddChild(parent) {
  const label = parent ? `在「${parent.name}」下新建` : '新建顶层地点'
  const name = prompt(`${label} —— 名称`)
  if (!name?.trim()) return
  try {
    const r = await api.addWorldMapPlace(map.value.id, { parentId: parent?.id ?? null, name: name.trim() })
    await loadMap(map.value.id)
    // 新建后自动选中它并展开父级，省得用户再找一遍
    if (parent) { const s = new Set(collapsed.value); s.delete(parent.id); collapsed.value = s }
    if (r?.place?.id) {
      const fresh = (map.value.places || []).find(p => p.id === r.place.id)
      if (fresh) selectPlace(fresh)
    }
    await loadMaps()
    toastFn?.('已添加，可在右侧「编辑」里补英文名/类型/简介', 'success')
  } catch (err) { toastFn?.('添加失败：' + (err?.message || ''), 'error') }
}

async function onDelete(p) {
  if (!confirm(`删除「${p.name}」？其下级会一并删除。`)) return
  try {
    await api.deleteWorldMapPlace(p.id)
    selected.value = null
    await loadMap(map.value.id)
    await loadMaps()
  } catch (err) { toastFn?.('删除失败：' + (err?.message || ''), 'error') }
}

async function onExpand(d) {
  if (busy.value) return
  busy.value = true
  const isReroll = d.children?.length > 0
  try {
    await api.expandWorldMapPlace(d.id)
    await loadMap(map.value.id)
    refreshSelected()
    await loadMaps()
    toastFn?.(isReroll ? '换了一批' : `「${d.name}」展开好了`, 'success')
  } catch (err) {
    toastFn?.('展开失败：' + (err?.message || ''), 'error')
  } finally { busy.value = false }
}

function openSettings() {
  editName.value = map.value.name
  editNote.value = map.value.note || ''
  settingsOpen.value = true
}
async function onSaveSettings() {
  busy.value = true
  try {
    await api.updateWorldMap(map.value.id, { name: editName.value.trim(), note: editNote.value.trim() })
    settingsOpen.value = false
    await loadMap(map.value.id)
    await loadMaps()
    toastFn?.('已保存', 'success')
  } catch (err) { toastFn?.('保存失败：' + (err?.message || ''), 'error') }
  finally { busy.value = false }
}

async function onExport() {
  try {
    const r = await api.exportWorldMapMarkdown(map.value.id)
    // 用下载而不是复制：地图可能很长，落成 .md 文件更方便贴回知识库
    const blob = new Blob([r.markdown || ''], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${map.value.name}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (err) { toastFn?.('导出失败：' + (err?.message || ''), 'error') }
}
</script>

<style scoped>
.wmap-view { display: flex; flex-direction: column; height: 100%; padding: 0 20px 18px; box-sizing: border-box; }

/* ── 顶栏 ── */
.wmap-header { display: flex; align-items: center; gap: 10px; padding: 14px 0 12px; flex-shrink: 0; flex-wrap: wrap; }
.wmap-title { margin: 0; font-size: var(--fs-xl); font-weight: 700; }
.wmap-sub { font-size: var(--fs-xs); color: var(--text-secondary); }
.wmap-spacer { flex: 1; }
.wmap-count { margin-left: 6px; padding: 0 6px; border-radius: var(--radius-full); background: var(--accent); color: #fff; font-size: 10px; }

/* ── 空态引导卡 ── */
.wmap-empty { flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; }
.we-card {
  width: 100%; max-width: 520px;
  padding: 26px 26px 22px;
  border: var(--border-strong); border-radius: var(--radius-lg);
  background: var(--card-bg, var(--glass-bg));
  box-shadow: var(--shadow-md);
  display: flex; flex-direction: column; gap: 14px;
}
.we-icon { width: 52px; height: 52px; border-radius: var(--radius-md); background: var(--accent-light); color: var(--accent); display: flex; align-items: center; justify-content: center; }
.we-card h3 { margin: 0; font-size: var(--fs-lg); }
.we-lead { margin: 0; font-size: var(--fs-sm); line-height: 1.85; color: var(--text-secondary); }
.we-lead strong { color: var(--accent); font-weight: 600; }
.we-field { display: flex; flex-direction: column; gap: 6px; }
.we-field label { font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); }
.we-opt { font-weight: 400; color: var(--text-tertiary, var(--text-secondary)); }
.we-world { display: flex; align-items: center; gap: 7px; padding: 8px 12px; border-radius: var(--radius-sm); background: var(--glass-bg); font-size: var(--fs-sm); }
.we-world.is-missing { color: var(--danger, #d9534f); }
.we-world-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.we-hint { margin: 0; font-size: var(--fs-xs); color: var(--text-secondary); text-align: center; }

/* ── 主体 ── */
.wmap-body { flex: 1; display: flex; gap: 14px; min-height: 0; }

/* 左树 */
.wmap-tree {
  width: 268px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border: var(--border-strong); border-radius: var(--radius-lg);
  background: var(--glass-bg); overflow: hidden;
}
.wt-head { display: flex; align-items: center; gap: 6px; padding: 11px 12px 6px; }
.wt-name { flex: 1; font-weight: 700; font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-stats { padding: 0 12px 9px; font-size: var(--fs-xs); color: var(--text-secondary); display: flex; gap: 5px; flex-wrap: wrap; }
.wt-stats i { opacity: 0.4; font-style: normal; }
.wt-list { flex: 1; overflow-y: auto; padding: 0 8px 12px; }

/* 树节点：统一一种（层级靠 paddingLeft 缩进表达，不再区分 region/district 两套样式）。
   缩进由模板的行内 style 给，这里只管外观。 */
.wt-node {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 6px 8px; margin: 1px 0;
  border: none; background: none; text-align: left;
  border-radius: var(--radius-sm);
  font: inherit; font-size: var(--fs-sm); color: var(--text-primary);
  cursor: pointer; transition: background var(--dur-fast), color var(--dur-fast);
  -webkit-tap-highlight-color: transparent;
}
.wt-node:hover { background: var(--accent-light); }
.wt-node.active { background: var(--accent-light); color: var(--accent); font-weight: 600; }
/* 前两层稍重，一眼能分出骨架与细节 */
.wt-node.lv1 { font-weight: 600; }
.wt-node.lv2 { font-weight: 500; }
.wt-node-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wt-caret { transition: transform var(--dur-fast); color: var(--text-secondary); flex-shrink: 0; }
.wt-caret.open { transform: rotate(90deg); }
/* 叶子节点：一个小圆点占位，让缩进对齐不歪 */
.wt-leaf-dot { width: 11px; flex-shrink: 0; display: inline-flex; justify-content: center; }
.wt-leaf-dot::before {
  content: ''; width: 4px; height: 4px; border-radius: 50%;
  background: var(--text-secondary); opacity: 0.45;
}
.wt-kind { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: var(--radius-full); background: var(--fun-purple-light, var(--accent-light)); color: var(--text-secondary); flex-shrink: 0; }
.wt-badge { font-size: 10px; padding: 1px 6px; border-radius: var(--radius-full); background: var(--accent); color: #fff; flex-shrink: 0; }
.wt-badge.is-poi { background: var(--glass-border); color: var(--text-secondary); }

.wt-add {
  width: 100%; margin: 3px 0 0; padding: 5px 8px 5px 22px;
  border: none; background: none; text-align: left;
  font: inherit; font-size: var(--fs-xs); color: var(--text-secondary);
  cursor: pointer; border-radius: var(--radius-sm);
}
.wt-add:hover { color: var(--accent); background: var(--accent-light); }
.wt-add.is-top { padding-left: 8px; margin-top: 10px; border-top: 1px dashed var(--glass-border); padding-top: 8px; }

/* 右详情 */
.wmap-detail {
  flex: 1; min-width: 0; overflow-y: auto;
  border: var(--border-strong); border-radius: var(--radius-lg);
  background: var(--glass-bg); padding: 16px 18px 20px;
}
.wd-placeholder { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; }
.wd-ph-title { margin: 0; font-size: var(--fs-md); font-weight: 600; }
.wd-ph-lead { margin: 0; max-width: 430px; font-size: var(--fs-sm); line-height: 1.85; color: var(--text-secondary); }
.wd-ph-lead b { color: var(--accent); }

.wd-head { display: flex; align-items: flex-start; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--glass-border); }
.wd-head > div { flex: 1; min-width: 0; }
.wd-name { margin: 0; font-size: var(--fs-lg); font-weight: 700; }
.wd-en { margin-left: 8px; font-size: var(--fs-xs); font-weight: 400; color: var(--text-secondary); font-style: italic; }
.wd-summary { margin: 5px 0 0; font-size: var(--fs-sm); line-height: 1.75; color: var(--text-secondary); }

.wd-head-ops { display: flex; gap: 6px; flex-shrink: 0; }

/* 层级徽标（跟在名称后，说明这是第几级） */
.wd-lv {
  margin-left: 8px; padding: 1px 7px; border-radius: var(--radius-full);
  font-size: 10px; font-weight: 500; vertical-align: 2px;
  background: var(--glass-bg); color: var(--text-secondary);
}

/* 操作行：添加下级 / AI 展开 */
.wd-ops { display: flex; align-items: center; gap: 8px; padding: 12px 0 4px; flex-wrap: wrap; }
.wd-ops-hint { font-size: var(--fs-xs); color: var(--text-secondary); }

/* 详情里的分区 */
.wd-sect { margin-top: 14px; }
.wd-sect-title {
  margin: 0 0 8px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary);
  display: flex; align-items: baseline; gap: 7px;
}
.wd-sect-hint { font-weight: 400; opacity: 0.75; }
.wd-empty { margin: 0 0 8px; font-size: var(--fs-xs); color: var(--text-secondary); opacity: 0.75; }

.wd-scene-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }

/* ── 生活地点编辑（可增删改）── */
.wpoi-edit { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.wpoi-head, .wpoi-row { display: grid; grid-template-columns: 82px 1fr 1.6fr 26px; gap: 7px; align-items: center; }
.wpoi-head { font-size: 10.5px; color: var(--text-secondary); padding: 0 2px; }
.wpoi-h-type, .wpoi-h-name, .wpoi-h-blurb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wpoi-del {
  width: 24px; height: 24px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--glass-border); border-radius: 7px;
  background: none; color: var(--text-secondary);
  font-size: 15px; line-height: 1; cursor: pointer;
  transition: color var(--dur-fast), border-color var(--dur-fast);
}
.wpoi-del:hover { color: var(--danger, #d9534f); border-color: var(--danger, #d9534f); }
.wpoi-foot { display: flex; align-items: center; gap: 8px; }
.wpoi-spacer { flex: 1; }

/* 只读展示（下层地点卡里的 POI 摘要） */
.wpois { display: flex; flex-direction: column; gap: 5px; }
.wpoi { display: flex; align-items: baseline; gap: 6px; font-size: var(--fs-xs); }
.wpoi-type { flex-shrink: 0; padding: 1px 5px; border-radius: 4px; font-size: 10px; font-weight: 600; }
.wpoi-type.t-retail { background: var(--fun-blue-light, #e6f0ff); color: #2f6fb5; }
.wpoi-type.t-food { background: var(--fun-orange-light, #ffeede); color: #b5691f; }
.wpoi-type.t-service { background: var(--fun-teal-light, #e0f5f2); color: #217a6c; }
.wpoi-type.t-misc { background: var(--glass-bg); color: var(--text-secondary); }
.wpoi-name { font-weight: 600; flex-shrink: 0; }
.wpoi-blurb { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wdistrict-card {
  display: flex; align-items: baseline; gap: 8px;
  padding: 11px 13px; text-align: left;
  border: 1px solid var(--glass-border); border-radius: var(--radius-md);
  background: var(--card-bg, #fff); font: inherit; cursor: pointer;
  transition: border-color var(--dur-fast), transform var(--dur-fast);
}
.wdistrict-card:hover { border-color: var(--accent); transform: translateY(-1px); }
.wdistrict-name { font-weight: 600; font-size: var(--fs-sm); }
.wdistrict-state { margin-left: auto; font-size: var(--fs-xs); color: var(--text-secondary); }

/* 地图列表 / 表单 */
.wm-picker { display: flex; flex-direction: column; gap: 12px; }
.wm-create { display: flex; gap: 8px; }
.wm-list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
.wm-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border: 1px solid var(--glass-border); border-radius: var(--radius-sm);
  background: none; font: inherit; font-size: var(--fs-sm); text-align: left; cursor: pointer;
}
.wm-item:hover { border-color: var(--accent); }
.wm-item.active { border-color: var(--accent); background: var(--accent-light); color: var(--accent); font-weight: 600; }
.wm-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wm-item-meta { font-size: var(--fs-xs); color: var(--text-secondary); }
.wm-item-del { opacity: 0.45; display: inline-flex; }
.wm-item-del:hover { opacity: 1; color: var(--danger, #d9534f); }
.wm-empty { margin: 0; font-size: var(--fs-xs); color: var(--text-secondary); text-align: center; }

/* ── 响应式 ── */
@media (max-width: 767px) {
  .wmap-view { padding: 0 12px 14px; }
  .wmap-body { flex-direction: column; }
  .wmap-tree { width: 100%; max-height: 42vh; }
  .wd-scene-grid { grid-template-columns: 1fr; }
  .we-card { padding: 20px 18px; }
}
</style>
