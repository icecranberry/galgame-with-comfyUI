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

      <!-- 视图切换：树形（编辑）/ 点位图（浏览）。默认树形，两个都留着 -->
      <div v-if="map" class="wmap-viewswitch" role="group" aria-label="视图">
        <button
          type="button" class="wvs-btn" :class="{ active: viewMode === 'tree' }"
          title="树形：便于增删改" @click="viewMode = 'tree'"
        >树形</button>
        <button
          type="button" class="wvs-btn" :class="{ active: viewMode === 'points' }"
          title="点位图：双翼全域 / 各片区坐标针点图" @click="viewMode = 'points'"
        >点位图</button>
      </div>

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
      <!-- 左：层级树（编辑）／点位图（浏览）——右侧详情栏两者共用，选中逻辑完全一致 -->
      <MapPointView v-if="viewMode === 'points'" :map="map" :selected="selected" @select="selectPlace" />
      <aside v-else class="wmap-tree">
        <div class="wt-head">
          <span class="wt-name">{{ map.name }}</span>
          <!-- 全部展开 / 收起：默认是**全折叠**，深层节点靠一路点开太累，给个总开关 -->
          <button
            type="button" class="wt-bulk" :title="allExpanded ? '全部收起' : '全部展开'"
            @click="toggleAllExpanded"
          >{{ allExpanded ? '收起全部' : '展开全部' }}</button>
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
            <!-- ★ 语义是**展开状**（默认折叠）：`expanded` 里有它才显示朝下 -->
            <svg
              v-if="n.children.length" class="wt-caret" :class="{ open: expanded.has(n.id) }"
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
          <!-- ═══ 内联编辑态：直接在右侧面板里改，不再弹窗 ═══
               用户口径（2026-10-06）：编辑没必要用弹窗，界面有大片空位可直接填。
               好处：能一边看着下面的「下级地点/生活地点」一边改，不必遮住上下文。 -->
          <div v-if="editingInline" class="wd-head wd-head--edit">
            <div class="we-inline-title">编辑地点</div>
            <div class="wd-head-ops">
              <linshe-button variant="ghost" size="sm" @click="cancelEdit">取消</linshe-button>
              <linshe-button variant="primary" size="sm" :disabled="busy || !editPlace.name.trim()" :loading="busy" @click="onSaveEdit">保存</linshe-button>
            </div>
          </div>
          <div v-if="editingInline" class="wm-picker we-inline">
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
            <div class="we-field">
              <label>准入权限<span class="we-opt">（日程不会把角色安排到「谢绝外人／私人」的地点）</span></label>
              <div class="we-chips">
                <button
                  v-for="o in ACCESS_OPTIONS" :key="o.value" type="button"
                  class="we-chip" :class="{ on: editPlace.access === o.value }"
                  :title="o.tip"
                  @click="editPlace.access = (editPlace.access === o.value ? '' : o.value)"
                >{{ o.label }}</button>
              </div>
              <p v-if="editPlace.access === 'time_window'" class="we-hint">限时段：再填下面的开放时间（不填则只写「仅特定时段」）</p>
            </div>
            <div v-if="editPlace.access === 'time_window'" class="we-row2">
              <div class="we-field">
                <label>开放时间</label>
                <linshe-input v-model="editPlace.openAt" placeholder="18:00" />
              </div>
              <div class="we-field">
                <label>关闭时间</label>
                <linshe-input v-model="editPlace.closeAt" placeholder="02:00" />
              </div>
            </div>
            <div class="we-field">
              <label>区域性质<span class="we-opt">（影响角色在这儿的着装）</span></label>
              <div class="we-chips">
                <button
                  v-for="o in ZONE_OPTIONS" :key="o.value" type="button"
                  class="we-chip" :class="{ on: editPlace.zone === o.value }"
                  :title="o.tip"
                  @click="editPlace.zone = (editPlace.zone === o.value ? '' : o.value)"
                >{{ o.label }}</button>
              </div>
            </div>
            <div class="we-field">
              <label>上级地点<span class="we-opt">（改这里 = 移动它的位置）</span></label>
              <linshe-select v-model="editPlace.parentId" :options="parentOptions" size="sm" />
            </div>
          </div>

          <template v-if="!editingInline">
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
              <linshe-button variant="ghost" size="sm" title="名称 / 英文名 / 类型 / 简介 / 权限 / 区域性质" @click="openEdit(selected)">编辑</linshe-button>
              <linshe-button variant="ghost" size="sm" tone="danger" @click="onDelete(selected)">删除</linshe-button>
            </div>
          </div>

          <div class="wd-ops">
            <linshe-button variant="secondary" size="sm" @click="onAddChild(selected)">+ 添加下级地点</linshe-button>
            <linshe-button variant="secondary" size="sm" :loading="busy" @click="onExpand(selected)">
              ✨ 让 AI 展开下一级
            </linshe-button>
            <!-- ⚠ 用 `selChildren.length` 而不是 `selected.children.length`：
                 后端 `places`（扁平行）**没有 children 键**，直接取会抛错 →
                 整页渲染失败变成空白页（实测踩过，见 onSaveAdd 的注释）。 -->
            <span class="wd-ops-hint">下面还有 {{ selChildren.length }} 个下级 · {{ selPois.length }} 个生活地点</span>
          </div>

          <!-- 下级地点 -->
          <div v-if="selChildren.length" class="wd-sect">
            <p class="wd-sect-title">下级地点<span class="wd-sect-hint">点进去看更细的一层</span></p>
            <div class="wd-scene-grid">
              <button v-for="c in selChildren" :key="c.id" type="button" class="wdistrict-card" @click="onNodeClick(c)">
                <span class="wdistrict-name">{{ c.name }}</span>
                <span v-if="c.kind" class="wt-kind">{{ c.kind }}</span>
                <span class="wdistrict-state">
                  {{ (c.children || []).length ? `${c.children.length} 个下级` : ((c.pois || []).length ? `${c.pois.length} 个生活地点` : '空') }}
                </span>
              </button>
            </div>
          </div>
          </template>

          <!-- 生活地点：任何层级都能加（一条街本身也可以是"有营生"的那一层） -->
          <div class="wd-sect">
            <p class="wd-sect-title">
              生活地点
              <span class="wd-sect-hint">店 / 设施 · 一行一条</span>
            </p>

            <div v-if="selPois.length" class="wpoi-edit">
              <div class="wpoi-head">
                <span class="wpoi-h-type">类型</span>
                <span class="wpoi-h-name">名称</span>
                <span class="wpoi-h-blurb">一句生活气息</span>
              </div>
              <div v-for="(p, i) in selPois" :key="i" class="wpoi-row">
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

    <!-- ── 新增地点（弹窗式；取代早先的原生 prompt）── -->
    <linshe-modal
      v-model="addPlaceOpen"
      :title="addPlace.parent ? `在「${addPlace.parent.name}」下新增地点` : '新增顶层地点'"
    >
      <div class="wm-picker">
        <p class="wm-where">
          将建在
          <b>{{ addPlace.parent ? addPlace.parent.name : '顶层' }}</b>
          之下<template v-if="addPlace.parent"> · 第 {{ addPlace.parent.level + 1 }} 层（{{ levelLabel(addPlace.parent.level + 1) }}）</template>
          <template v-else> · 第 1 层（大地区）</template>
        </p>
        <div class="we-field">
          <label>名称</label>
          <linshe-input v-model="addPlace.name" placeholder="如 客舱走廊 / 铃兰茶馆" @keyup.enter="onSaveAdd" />
        </div>
        <div class="we-field">
          <label>英文名<span class="we-opt">（可选，官方风格合成意译）</span></label>
          <linshe-input v-model="addPlace.nameEn" placeholder="如 Duomension City" />
        </div>
        <div class="we-field">
          <label>类型<span class="we-opt">（可选，如 核心区 / 车厢 / 房间）</span></label>
          <linshe-input v-model="addPlace.kind" />
        </div>
        <div class="we-field">
          <label>一句话简介<span class="we-opt">（可留空）</span></label>
          <linshe-input v-model="addPlace.summary" type="textarea" :rows="3" placeholder="这块地方长什么样、什么人来" />
        </div>
        <div class="wm-modal-foot">
          <linshe-button variant="secondary" @click="addPlaceOpen = false">取消</linshe-button>
          <linshe-button variant="primary" :disabled="busy || !addPlace.name.trim()" :loading="busy" @click="onSaveAdd">创建</linshe-button>
        </div>
      </div>
    </linshe-modal>

    <!-- ── 地点信息编辑（含「上级」= 移动位置）── -->
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
        <div class="wm-modal-foot">
          <linshe-button variant="secondary" @click="settingsOpen = false">取消</linshe-button>
          <linshe-button variant="primary" :disabled="busy" :loading="busy" @click="onSaveSettings">保存</linshe-button>
        </div>
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
import MapPointView from '../components/worldmap/MapPointView.vue'
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
/** 'tree'（默认·便于编辑）| 'points'（点位图·便于浏览）。不持久化，每次进页面回树形。 */
const viewMode = ref('tree')
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

/*
 * 树的展开状态 —— **默认全折叠**，并按地图分别记住。
 *
 * ★ 语义是 `expanded`（不是 `collapsed`）：用户口径要「默认折叠」，
 *   而记忆一份"折叠名单"的默认值是"全展开"，恰好相反 —— 那样一进来就是
 *   整棵树全铺开（二相乐园 98 个地点，翻起来很累）。用"展开名单"，
 *   空集合天然等于全折叠，且**新增的地点默认也是折叠的**（不会突然撑开一大片）。
 *
 * 持久化用 localStorage（与点位图拖拽同一套思路）：不碰后端、不用重启 agent-core。
 * 代价：只存在本机这个浏览器里（换浏览器 / 清缓存会丢）。
 */
const EXPANDED_LS_KEY = 'linshe.worldmap.expanded'
const expanded = ref(new Set())

function loadExpanded(mapId) {
  try {
    const all = JSON.parse(localStorage.getItem(EXPANDED_LS_KEY) || '{}')
    const arr = all?.[String(mapId)]
    return new Set(Array.isArray(arr) ? arr.filter(x => Number.isFinite(x)) : [])
  } catch { return new Set() }
}
function saveExpanded() {
  try {
    const all = JSON.parse(localStorage.getItem(EXPANDED_LS_KEY) || '{}')
    all[String(map.value?.id ?? 0)] = [...expanded.value]
    localStorage.setItem(EXPANDED_LS_KEY, JSON.stringify(all))
  } catch { /* 隐私模式等，忽略 */ }
}

/** 生活地点有未保存的改动 */
const poisDirty = ref(false)

/** 地点信息编辑（名称/英文名/类型/简介/上级=移动） */
const editPlaceOpen = ref(false)
const editPlace = reactive({
  id: null, name: '', nameEn: '', kind: '', summary: '', parentId: '',
  // 准入 / 分区（2026-10-05）：地图数据即真源，日程生成会按它过滤与联动服装
  access: '', zone: '', openAt: '', closeAt: '',
})

// ★ 准入权限选项 —— 与后端 `worldMapService.ACCESS_LEVELS` / `ACCESS_LABEL` 同口径。
//   ⚠ 这里只负责渲染，值必须与后端一致；后端才是唯一真源（项目红线 8）。
const ACCESS_OPTIONS = [
  { value: 'restricted', label: '谢绝外人', tip: '需要身份或受邀才能进；日程默认不安排角色来这儿' },
  { value: 'private', label: '私人空间', tip: '属于某个角色的私人空间（房间等）；日程默认不安排' },
  { value: 'time_window', label: '限时段', tip: '只在特定时段开放（夜市、深夜档）；日程会带上开放时间' },
]
// ★ 区域性质 → 与服装联动。值同后端 `ZONE_LEVELS`。
const ZONE_OPTIONS = [
  { value: 'residence', label: '居住区', tip: '有人真的住这儿；角色在此按「住所内」着居家服/睡衣' },
  { value: 'activity', label: '活动区', tip: '主要活动地（商店街/车站/公园）；角色在此穿常服或私服' },
  { value: 'private_transit', label: '洗浴/更衣', tip: '必然不穿衣服的场所；只在这儿用「全身」那套' },
]

/** 新增地点（弹窗式，取代原生 prompt） */
const addPlaceOpen = ref(false)
const addPlace = reactive({ parent: null, name: '', nameEn: '', kind: '', summary: '' })

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
      // 只有**显式展开过**的节点才递归下去（默认全折叠）
      if (expanded.value.has(n.id) && n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(map.value?.tree || [], 0)
  return out
})

/** 全部展开（忽略折叠状态）—— 编辑弹窗的「上级地点」候选要用全量 */
const fullFlat = computed(() => {
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth })
      if (n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(map.value?.tree || [], 0)
  return out
})

/** 有下级的节点 id（用于「展开全部 / 收起全部」） */
const containerIds = computed(() => fullFlat.value.filter(n => n.children?.length).map(n => n.id))
const allExpanded = computed(() => {
  const ids = containerIds.value
  return ids.length > 0 && ids.every(id => expanded.value.has(id))
})
function toggleAllExpanded() {
  expanded.value = allExpanded.value ? new Set() : new Set(containerIds.value)
  saveExpanded()
}

/** 当前选中项的 children / pois —— **永远返回数组**（后端扁平行没有 children，详见 ensureNodeShape） */
const selChildren = computed(() => selected.value?.children || [])
const selPois = computed(() => selected.value?.pois || [])

/** 还有多少地点没有下级 —— 空态与占位里的"下一步"提示用 */
const pendingDistricts = computed(() => {
  if (!map.value) return 0
  return (map.value.places || []).filter(p => !(p.children?.length) && !p.pois?.length).length
})

function poiClass(type) {
  return { 零售: 'retail', 餐饮: 'food', 服务: 'service', 配套: 'misc' }[type] || 'misc'
}

/**
 * 保证节点有 `children` / `pois` 两个数组。
 *
 * ★★ 这是「新增地点后整页空白」的根因所在：
 *   后端 `GET /maps/:id` 返回两套数据 —— `tree`（嵌套，节点带 `children`）与
 *   `places`（**扁平行，没有 `children` 键**）。模板里凡是要点开一个地点都会读
 *   `selected.children.length`，一旦 `selected` 是扁平行就抛 TypeError，
 *   整个页面渲染失败 → **用户看到一片空白**（而且刷新回来就好了，所以特别难复现）。
 *   所以凡是把"可能来自 places 的节点"塞进 `selected` 的地方，都先过这一道。
 */
function ensureNodeShape(n) {
  if (!n) return null
  if (!Array.isArray(n.children)) n.children = []
  if (!Array.isArray(n.pois)) n.pois = []
  return n
}

/** 选中项要跟着最新数据走（刷新后对象会被替换，直接存旧引用会拿到陈旧节点） */
function refreshSelected() {
  const id = selected.value?.id
  if (!id || !map.value) { selected.value = null; return }
  // 选中项需要 children 才能渲染下级列表 —— 从**树**里取带 children 的那个
  // （places 扁平行只有自身字段，拿它当 selected 会缺 children）
  const findInTree = nodes => {
    for (const n of nodes) {
      if (n.id === id) return n
      const hit = findInTree(n.children || [])
      if (hit) return hit
    }
    return null
  }
  const node = findInTree(map.value.tree) || (map.value.places || []).find(p => p.id === id) || null
  selected.value = ensureNodeShape(node)
}

// ── 数据加载 ──
async function loadMaps() {
  try { maps.value = (await api.listWorldMaps()).maps || [] } catch { maps.value = [] }
}
async function loadMap(id) {
  try {
    const r = await api.getWorldMap(id)
    map.value = r.map
    // 换图 → 读回这张图自己的展开状态（默认全折叠）
    expanded.value = loadExpanded(id)
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
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  expanded.value = s
  saveExpanded()   // 每次展开/折叠都落盘 —— "记忆上一次操作"
}
/**
 * 点树节点：选中它。若已有子级，**同时切换展开** —— 这样一次点击既能看到内容、
 * 又能收起来，不用去点那个很小的三角（触屏尤其需要）。
 */
function onNodeClick(n) {
  selectPlace(n)
  if (n.children?.length) toggleCollapse(n.id)
}
function selectPlace(p) {
  selected.value = ensureNodeShape(p)
  poisDirty.value = false
}

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
    // 展开到该节点，让用户看到改动落到了哪（语义是 expanded，所以是 add 不是 delete）
    const sc = new Set(expanded.value); sc.add(s.id); expanded.value = sc; saveExpanded()
    poisDirty.value = false
    await loadMaps()
    toastFn?.('生活地点已保存', 'success')
  } catch (err) {
    toastFn?.('保存失败：' + (err?.message || ''), 'error')
  } finally { busy.value = false }
}

// ── 地点信息编辑 ──
// ★ 2026-10-06 用户口径：编辑**不再用弹窗**，直接在右侧面板内联展开 ——
//   面板本来就有大片空白，弹窗还会遮住下面的「下级地点/生活地点」，边看边改做不到。
const editingInline = ref(false)

function openEdit(p) {
  editPlace.id = p.id
  editPlace.name = p.name
  editPlace.nameEn = p.name_en || ''
  editPlace.kind = p.kind || ''
  editPlace.summary = p.summary || ''
  editPlace.parentId = p.parent_id ? String(p.parent_id) : ''
  // 准入 / 分区（后端返回的是空串表示未标注）
  editPlace.access = p.access || ''
  editPlace.zone = p.zone || ''
  editPlace.openAt = p.open_at || ''
  editPlace.closeAt = p.close_at || ''
  editingInline.value = true
}

/** 放弃编辑：只关掉内联态，不落库（表单值下次 openEdit 会重新灌） */
function cancelEdit() {
  editingInline.value = false
}

/** 该节点的全部子孙 id（用于把「上级」候选里的自己与子孙剔掉，防止成环） */
function descendantIds(id) {
  const out = new Set()
  const walk = ns => {
    for (const n of ns) {
      if (n.id === id) { collect(n); return true }
      if (walk(n.children || [])) return true
    }
    return false
  }
  const collect = n => { for (const c of (n.children || [])) { out.add(c.id); collect(c) } }
  walk(map.value?.tree || [])
  return out
}

/** 「上级地点」下拉：顶层 + 全量节点（去掉自己与自己的子孙） */
const parentOptions = computed(() => {
  const self = editPlace.id
  const banned = self ? new Set([self, ...descendantIds(self)]) : new Set()
  const out = [{ label: '（顶层 · 大地区）', value: '' }]
  for (const n of fullFlat.value) {
    if (banned.has(n.id)) continue
    out.push({ label: `${'　'.repeat(n._depth)}${n.name}（→ 第 ${n.level + 1} 层）`, value: String(n.id) })
  }
  return out
})

async function onSaveEdit() {
  if (!editPlace.id || busy.value) return
  busy.value = true
  try {
    await api.updateWorldMapPlace(editPlace.id, {
      name: editPlace.name.trim(),
      name_en: editPlace.nameEn.trim(),
      kind: editPlace.kind.trim(),
      summary: editPlace.summary.trim(),
      // ★ 准入 / 分区：空串 = 未标注（按"可去"处理）
      access: editPlace.access || '',
      zone: editPlace.zone || '',
      open_at: editPlace.access === 'time_window' ? (editPlace.openAt || '') : '',
      close_at: editPlace.access === 'time_window' ? (editPlace.closeAt || '') : '',
      // ★ 传 parentId = **移动**（后端支持改 parent_id 并整棵子树重算层级）；
      //   传空串 = 提到顶层。不传这个键才是"不移动"。
      parentId: editPlace.parentId === '' ? null : Number(editPlace.parentId),
    })
    editPlaceOpen.value = false
    editingInline.value = false
    // 移动后选中项要留在原节点上
    const keepId = editPlace.id
    selected.value = { id: keepId }
    await loadMap(map.value.id)
    refreshSelected()
    await loadMaps()
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
    // 新图默认全折叠（并清掉它自己的历史记录，免得 id 撞上旧图）
    expanded.value = new Set()
    saveExpanded()
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

/**
 * 打开「新增地点」弹窗。
 *
 * ★ 早先用的是原生 `prompt()` —— 丑、只在能输入一个名字、还会被浏览器拦；
 *   用户口径要**弹窗式**（与「编辑地点」同一套 LinsheModal），
 *   这样一次就能把英文名 / 类型 / 简介都填了，不用建完再回头补。
 *   上级由**入口决定**（「+ 添加下级」= 当前选中项，「+ 添加顶层」= 无父级）。
 */
function onAddChild(parent) {
  if (!map.value) return
  addPlace.parent = parent || null
  addPlace.name = ''
  addPlace.nameEn = ''
  addPlace.kind = ''
  addPlace.summary = ''
  addPlaceOpen.value = true
}
async function onSaveAdd() {
  const parent = addPlace.parent
  const name = addPlace.name.trim()
  if (!name) { toastFn?.('请填名称', 'error'); return }
  if (busy.value) return
  busy.value = true
  try {
    const r = await api.addWorldMapPlace(map.value.id, {
      parentId: parent?.id ?? null,
      name,
      nameEn: addPlace.nameEn.trim(),
      kind: addPlace.kind.trim(),
      summary: addPlace.summary.trim(),
    })
    addPlaceOpen.value = false
    await loadMap(map.value.id)
    // 新建后自动展开父级并选中它，省得用户再找一遍
    if (parent) {
      const s = new Set(expanded.value); s.add(parent.id)
      expanded.value = s; saveExpanded()
    }
    if (r?.place?.id) {
      // ★ 用 refreshSelected 而不是直接拿扁平行：places 行没有 children，
      //   塞进 selected 会让模板取 `.length` 抛错 → **整页空白**（实测踩过）
      selected.value = { id: r.place.id }
      refreshSelected()
    }
    await loadMaps()
    toastFn?.('已创建', 'success')
  } catch (err) { toastFn?.('添加失败：' + (err?.message || ''), 'error') }
  finally { busy.value = false }
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
.wmap-count { margin-left: 6px; padding: 0 6px; border-radius: var(--radius-full); background: var(--accent-solid); color: #fff; font-size: 10px; }

/* ── 弹窗（新增 / 编辑地点）── */
.wm-where {
  margin: 0; padding: 8px 10px; border-radius: var(--radius-md);
  background: var(--bg-sunken); border: 1px solid var(--border);
  font-size: var(--fs-xs); color: var(--text-secondary);
}
.wm-where b { color: var(--accent); }
.wm-modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }

/* 视图切换（树形 / 点位图） */
.wmap-viewswitch {
  display: inline-flex; padding: 2px; gap: 2px;
  border: var(--border-strong); border-radius: var(--radius-full);
  background: var(--glass-bg);
}
.wvs-btn {
  padding: 4px 12px; border: 0; background: transparent; cursor: pointer;
  border-radius: var(--radius-full); font-size: var(--fs-xs); color: var(--text-secondary);
  transition: all var(--dur-fast) var(--ease-out);
}
.wvs-btn:hover { color: var(--text-primary); }
.wvs-btn.active { background: var(--accent-solid); color: #fff; font-weight: 600; }

/* 点位图占左侧（原先树形那一条的位置），右侧详情栏两者共用。
   点位图需要更宽（地图要铺开），所以给它 flex:2 —— 与详情栏约 2:1，而不是 1:1 */
.wmap-body > .mpt { flex: 2; min-width: 0; }

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
/* ⚠ 原 `accent-light 底 + accent 图标色`：暗夜下同为亮橙 → 图标差点看不见。 */
.we-icon { width: 52px; height: 52px; border-radius: var(--radius-md); background: rgba(var(--accent-rgb), 0.16); color: var(--accent); display: flex; align-items: center; justify-content: center; }
.we-card h3 { margin: 0; font-size: var(--fs-lg); }
.we-lead { margin: 0; font-size: var(--fs-sm); line-height: 1.85; color: var(--text-secondary); }
.we-lead strong { color: var(--accent); font-weight: 600; }
.we-field { display: flex; flex-direction: column; gap: 6px; }

/* ── 面板内联编辑（替代原「编辑地点」弹窗）──
   用户口径 2026-10-06：面板有大片空白，就地改即可，不必弹窗遮住下文。 */
.wd-head--edit { align-items: center; }
.we-inline-title { font-size: var(--fs-lg); font-weight: 600; color: var(--text-bright); }
.we-inline {
  margin: 10px 0 14px;
  padding: 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color, var(--border));
  background: var(--bg-secondary);
}
.we-inline .we-field label { font-size: var(--fs-sm); color: var(--text-secondary); }
.we-field label { font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); }
.we-opt { font-weight: 400; color: var(--text-tertiary, var(--text-secondary)); }
/* ── 准入 / 分区 开关（勾选式，点一下切换）── */
.we-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.we-chip {
  padding: 3px 11px;
  border-radius: var(--radius-full);
  border: var(--border);
  background: var(--glass-bg);
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
}
.we-chip:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
.we-chip.on {
  background: color-mix(in srgb, var(--accent-3) 16%, transparent);
  border-color: color-mix(in srgb, var(--accent-3) 55%, transparent);
  color: var(--text-primary);
  font-weight: 600;
}
.we-hint { margin: 0; font-size: var(--fs-xs); color: var(--text-tertiary, var(--text-secondary)); }
.we-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
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
.wt-name { font-weight: 700; font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 展开/收起全部（默认全折叠时，深层节点靠一路点开太累） */
.wt-bulk {
  margin-left: auto; flex-shrink: 0;
  border: 0; background: transparent; padding: 0 4px; cursor: pointer;
  font-size: 10px; color: var(--accent); text-decoration: underline;
}
.wt-bulk:hover { color: var(--accent-hover); }
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
/* ⚠ 原为 `background: var(--accent-light); color: var(--accent)` —— 亮橙底 + 亮橙字，
   暗夜下对比度约 1.0，选中项文字**完全看不见**（用户实报，附截图）。
   改用「半透明 accent 底 + 亮色文字 + 左侧强调条」，选中态依然醒目且可读。 */
.wt-node:hover { background: rgba(var(--accent-rgb), 0.10); }
.wt-node.active {
  background: rgba(var(--accent-rgb), 0.18);
  color: var(--text-bright);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--accent);
}
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
/* ⚠ 原来写 `--fun-purple-light`（这个变量根本不存在）→ 回落到 --accent-light 亮橙底，
   再配 --text-secondary 灰字 → 暗夜下对比度 1.41，几乎看不清（用户实报）。
   改为**半透明 accent 底 + 亮色文字**，两个主题下都清晰。 */
.wt-kind {
  font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: var(--radius-full);
  background: rgba(var(--accent-rgb), 0.16); color: var(--text-secondary); flex-shrink: 0;
}
/* ⚠ 原为 accent 实底 + #fff 白字：暗夜下白字在亮橙上仅 2.55（10px 小字需 4.5，看不清）。
   改为「随主题翻转的 accent 半透明底 + --text-bright 文字」：
   暖色主题 = 浅底配深字、暗夜 = 深底配亮字，两个主题都达标。 */
.wt-badge {
  font-size: 10px; padding: 1px 6px; border-radius: var(--radius-full);
  background: rgba(var(--accent-rgb), 0.22); color: var(--text-bright);
  border: 1px solid rgba(var(--accent-rgb), 0.34);
  flex-shrink: 0; font-variant-numeric: tabular-nums; font-weight: 600;
}
.wt-badge.is-poi { background: var(--glass-border); color: var(--text-secondary); border-color: transparent; }

.wt-add {
  width: 100%; margin: 3px 0 0; padding: 5px 8px 5px 22px;
  border: none; background: none; text-align: left;
  font: inherit; font-size: var(--fs-xs); color: var(--text-secondary);
  cursor: pointer; border-radius: var(--radius-sm);
}
.wt-add:hover { color: var(--accent); background: rgba(var(--accent-rgb), 0.12); }
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
/* ⚠ 原 `accent-light 底 + accent 字`（亮橙叠亮橙）。改为半透明底 + 亮字 + 强调描边。 */
.wm-item.active { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.16); color: var(--text-bright); font-weight: 600; }
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
