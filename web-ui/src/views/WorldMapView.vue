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

    <!-- ── 主体：左树 + 右卡 ── -->
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
          <span>{{ map.stats.region }} 大地区</span><i>·</i>
          <span>{{ map.stats.district }} 子地区</span><i>·</i>
          <span>{{ map.stats.scene }} 场景</span><i>·</i>
          <span>{{ map.stats.poi }} 生活地点</span>
        </div>

        <div class="wt-list">
          <template v-for="rg in map.tree" :key="rg.id">
            <!-- L1：大地区（可折叠） -->
            <div class="wt-region" @click="toggleRegion(rg.id)">
              <svg class="wt-caret" :class="{ open: !collapsed.has(rg.id) }" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              <span class="wt-region-name">{{ rg.name }}</span>
              <span v-if="rg.kind" class="wt-kind">{{ rg.kind }}</span>
            </div>

            <template v-if="!collapsed.has(rg.id)">
              <!-- L2：子地区（点击选中 → 右栏显示） -->
              <button
                v-for="d in rg.children" :key="d.id"
                type="button"
                class="wt-district"
                :class="{ active: selected?.id === d.id }"
                @click="selectPlace(d)"
              >
                <span class="wt-district-name">{{ d.name }}</span>
                <span v-if="d.children.length" class="wt-dot-filled" :title="`${d.children.length} 个场景`">{{ d.children.length }}</span>
                <span v-else class="wt-dot-empty" title="还没展开"></span>
              </button>

              <button type="button" class="wt-add" @click="onAddChild(rg)">+ 添加子地区</button>
            </template>
          </template>

          <button type="button" class="wt-add is-top" @click="onAddChild(null)">+ 添加大地区</button>
        </div>
      </aside>

      <!-- 右：详情 -->
      <section class="wmap-detail">
        <!-- 未选中：给出全局下一步（强引导） -->
        <div v-if="!selected" class="wd-placeholder">
          <template v-if="map.stats.district === 0">
            <p class="wd-ph-title">还没有子地区</p>
            <p class="wd-ph-lead">重新生成一次骨架，或手动添加。</p>
          </template>
          <template v-else>
            <p class="wd-ph-title">选一个子地区</p>
            <p class="wd-ph-lead">
              从左边点一个<b>子地区</b>，就能展开它下面的<strong>场景</strong>与<strong>生活地点</strong>。
              <template v-if="pendingDistricts">目前还有 <b>{{ pendingDistricts }}</b> 个子地区没展开。</template>
            </p>
          </template>
        </div>

        <!-- 子地区详情 -->
        <div v-else-if="selected.level === 2" class="wd-district">
          <div class="wd-head">
            <div>
              <h3 class="wd-name">{{ selected.name }}<span v-if="selected.name_en" class="wd-en">{{ selected.name_en }}</span></h3>
              <p v-if="selected.summary" class="wd-summary">{{ selected.summary }}</p>
            </div>
            <linshe-button variant="icon" size="sm" title="删除此子地区" @click="onDelete(selected)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </linshe-button>
          </div>

          <!-- 子地区**自己**的生活地点：有些地方本身就是一条街/一个市集（如「喜悲街」），
               没有下级场景，店直接挂在这一层 —— 这里也要能显示出来。 -->
          <div v-if="selected.pois?.length" class="wd-own-pois">
            <p class="wd-own-title">这里的生活地点</p>
            <div class="wpois">
              <div v-for="(p, i) in selected.pois" :key="i" class="wpoi">
                <span class="wpoi-type" :class="`t-${poiClass(p.type)}`">{{ p.type }}</span>
                <span class="wpoi-name">{{ p.name }}</span>
                <span v-if="p.blurb" class="wpoi-blurb">{{ p.blurb }}</span>
              </div>
            </div>
          </div>

          <div v-if="!selected.children.length" class="wd-cta">
            <p>这块地方还没展开。让 AI 按你的世界观补出它的场景与生活地点。</p>
            <linshe-button variant="primary" :loading="busy" @click="onExpand(selected)">
              展开「{{ selected.name }}」
            </linshe-button>
            <p class="wd-cta-hint">一区 4~7 个场景，每场景 6~9 个生活地点。</p>
          </div>

          <div v-else class="wd-scenes">
            <div class="wd-scenes-bar">
              <span class="wd-scenes-count">{{ selected.children.length }} 个场景 · {{ scenePoiCount(selected) }} 个生活地点</span>
              <linshe-button variant="ghost" size="sm" :loading="busy" @click="onExpand(selected)">换一批</linshe-button>
            </div>

            <div class="wd-scene-grid">
              <div v-for="s in selected.children" :key="s.id" class="wscene">
                <div class="wscene-head">
                  <span class="wscene-name">{{ s.name }}</span>
                  <span v-if="s.name_en" class="wscene-en">{{ s.name_en }}</span>
                  <linshe-button variant="icon" size="sm" title="删除场景" @click="onDelete(s)">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                  </linshe-button>
                </div>
                <p v-if="s.kind" class="wscene-kind">{{ s.kind }}</p>
                <p v-if="s.summary" class="wscene-summary">{{ s.summary }}</p>

                <div v-if="s.pois.length" class="wpois">
                  <div v-for="(p, i) in s.pois" :key="i" class="wpoi">
                    <span class="wpoi-type" :class="`t-${poiClass(p.type)}`">{{ p.type }}</span>
                    <span class="wpoi-name">{{ p.name }}</span>
                    <span v-if="p.blurb" class="wpoi-blurb">{{ p.blurb }}</span>
                  </div>
                </div>
                <p v-else class="wscene-nopoi">还没有生活地点</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 大地区详情：列出子地区，方便逐个展开 -->
        <div v-else class="wd-district">
          <div class="wd-head">
            <div>
              <h3 class="wd-name">{{ selected.name }}<span v-if="selected.name_en" class="wd-en">{{ selected.name_en }}</span></h3>
              <p v-if="selected.summary" class="wd-summary">{{ selected.summary }}</p>
            </div>
            <linshe-button variant="icon" size="sm" title="删除大地区" @click="onDelete(selected)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </linshe-button>
          </div>
          <div class="wd-scene-grid">
            <button v-for="d in selected.children" :key="d.id" type="button" class="wdistrict-card" @click="selectPlace(d)">
              <span class="wdistrict-name">{{ d.name }}</span>
              <span v-if="d.kind" class="wt-kind">{{ d.kind }}</span>
              <span class="wdistrict-state">{{ d.children.length ? d.children.length + ' 个场景' : '未展开' }}</span>
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- ── 我的地图列表 ── -->
    <linshe-modal v-model="pickerOpen" title="我的地图">
      <div class="wm-picker">
        <div class="wm-create">
          <linshe-input v-model="newMapName" placeholder="新地图名，如：二相乐园" @keyup.enter="onCreate" />
          <linshe-button variant="primary" :disabled="!newMapName.trim() || busy" @click="onCreate">新建</linshe-button>
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
import { ref, computed, inject, onMounted } from 'vue'
import * as api from '../api/index.js'
// ⚠ Linshe 组件是**局部 import**（main.js 里没有 app.component 全局注册）——
//    新页面必须自己引入，否则 <linshe-button> 等会被当成未知标签，
//    表现为"按钮根本不渲染成按钮、弹窗内容直接平铺到页面上"。
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'

const toggleMobileSidebar = inject('toggleMobileSidebar', null)
// 项目统一用 provide/inject 拿这两个（见 MediaView 等）
const toastFn = inject('toast')
const isMobile = inject('isMobile')

// ── 状态 ──
const maps = ref([])
const map = ref(null)
const selected = ref(null)
const collapsed = ref(new Set())
const busy = ref(false)
const brief = ref('')
const worldName = ref('')
const pickerOpen = ref(false)
const settingsOpen = ref(false)

// 新建 / 编辑
const newMapName = ref('')
const editName = ref('')
const editNote = ref('')

/** 还有多少子地区没展开 —— 空态与占位里的"下一步"提示用 */
const pendingDistricts = computed(() => {
  if (!map.value) return 0
  let n = 0
  for (const rg of map.value.tree) for (const d of rg.children) if (!d.children.length) n++
  return n
})

function poiClass(type) {
  return { 零售: 'retail', 餐饮: 'food', 服务: 'service', 配套: 'misc' }[type] || 'misc'
}
function scenePoiCount(district) {
  return district.children.reduce((n, s) => n + (s.pois?.length || 0), 0)
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
function toggleRegion(id) {
  const s = new Set(collapsed.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  collapsed.value = s
}
function selectPlace(p) { selected.value = p }

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
    const r = await api.createWorldMap({ name: newMapName.value.trim() })
    newMapName.value = ''
    pickerOpen.value = false
    map.value = r.map
    selected.value = null
    await loadMaps()
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
  const name = prompt(parent ? '新子地区名称' : '新大地区名称')
  if (!name?.trim()) return
  try {
    await api.addWorldMapPlace(map.value.id, { parentId: parent?.id ?? null, name: name.trim() })
    await loadMap(map.value.id)
    await loadMaps()
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

.wt-region {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 8px; margin-top: 4px;
  border-radius: var(--radius-sm);
  cursor: pointer; font-weight: 600; font-size: var(--fs-sm);
  transition: background var(--dur-fast);
}
.wt-region:hover { background: var(--accent-light); }
.wt-caret { transition: transform var(--dur-fast); color: var(--text-secondary); flex-shrink: 0; }
.wt-caret.open { transform: rotate(90deg); }
.wt-region-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-kind { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: var(--radius-full); background: var(--fun-purple-light, var(--accent-light)); color: var(--text-secondary); flex-shrink: 0; }

.wt-district {
  display: flex; align-items: center; gap: 7px; width: 100%;
  padding: 6px 8px 6px 22px;
  border: none; background: none; text-align: left;
  border-radius: var(--radius-sm);
  font: inherit; font-size: var(--fs-sm); color: var(--text-primary);
  cursor: pointer; transition: background var(--dur-fast), color var(--dur-fast);
  -webkit-tap-highlight-color: transparent;
}
.wt-district:hover { background: var(--accent-light); }
.wt-district.active { background: var(--accent-light); color: var(--accent); font-weight: 600; }
.wt-district-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-dot-filled { font-size: 10px; padding: 1px 6px; border-radius: var(--radius-full); background: var(--accent); color: #fff; }
.wt-dot-empty { width: 6px; height: 6px; border-radius: 50%; border: 1.5px solid var(--text-secondary); opacity: 0.5; }

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

.wd-cta { padding: 30px 0; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
.wd-cta > p { margin: 0; font-size: var(--fs-sm); color: var(--text-secondary); max-width: 400px; line-height: 1.8; }
.wd-cta-hint { font-size: var(--fs-xs) !important; }

/* 子地区自有的生活地点（该地本身是条街/市集，没有下级场景） */
.wd-own-pois { margin-top: 12px; padding: 11px 13px; border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: var(--card-bg, #fff); }
.wd-own-title { margin: 0 0 6px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); }
.wd-own-pois .wpois { margin-top: 0; padding-top: 0; border-top: none; }

.wd-scenes-bar { display: flex; align-items: center; gap: 10px; padding: 12px 0 8px; }
.wd-scenes-count { flex: 1; font-size: var(--fs-xs); color: var(--text-secondary); }
.wd-scene-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }

/* 场景卡 */
.wscene {
  border: 1px solid var(--glass-border); border-radius: var(--radius-md);
  background: var(--card-bg, #fff); padding: 12px 13px;
  display: flex; flex-direction: column; gap: 6px;
}
.wscene-head { display: flex; align-items: baseline; gap: 7px; }
.wscene-name { flex: 1; font-weight: 700; font-size: var(--fs-sm); }
.wscene-en { font-size: 10px; color: var(--text-secondary); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 44%; }
.wscene-kind { margin: 0; font-size: 10px; color: var(--accent); }
.wscene-summary { margin: 0; font-size: var(--fs-xs); line-height: 1.7; color: var(--text-secondary); }
.wscene-nopoi { margin: 6px 0 0; font-size: var(--fs-xs); color: var(--text-secondary); opacity: 0.7; }

.wpois { margin-top: 6px; padding-top: 8px; border-top: 1px dashed var(--glass-border); display: flex; flex-direction: column; gap: 5px; }
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
