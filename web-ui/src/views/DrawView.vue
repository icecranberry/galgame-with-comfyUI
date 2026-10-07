<template>
  <div class="draw-view">
    <!-- 顶栏 —— 与相册/地图等页保持同一「页标题 + 右侧操作」口径 -->
    <div class="draw-header">
      <span class="draw-title">绘图</span>
      <div class="header-right">
        <span class="draw-hint">标签自由组合 → 描述 → 出图</span>
      </div>
    </div>

    <div class="draw-body">
      <!-- ── 左：创作面板 ── -->
      <aside class="draw-panel">
        <!-- ① 画面描述（喂给 LLM 完善成生图提示词的正源） -->
        <section class="dp-sec">
          <div class="dp-sec-head">
            <span class="dp-sec-t">画面描述</span>
            <span class="dp-sec-sub">中文即可，会自动完善成英文提示词</span>
          </div>
          <linshe-auto-textarea
            v-model="sceneDesc"
            class="dp-desc"
            :rows="5"
            placeholder="例：焰躺在沙发上打游戏，窗外下着雨，室内暖光"
          />
        </section>

        <!-- ② 标签：点选后追加到描述里（标签库＝创意工坊的自由组合件） -->
        <section class="dp-sec">
          <div class="dp-sec-head">
            <span class="dp-sec-t">标签</span>
            <linshe-button variant="ghost" class="dp-mini" @click="pickerOpen = true">
              打开标签库
            </linshe-button>
          </div>
          <p class="dp-note">
            动作、表情、瞬时状态都在这里（角色页只留常驻身体特征）。
          </p>
          <div v-if="pickedTags.length" class="dp-picked">
            <span v-for="(t, i) in pickedTags" :key="`${t}-${i}`" class="dp-chip">
              {{ t }}
              <button type="button" class="dp-chip-x" :title="`移除 ${t}`" @click="removeTag(i)">×</button>
            </span>
            <linshe-button variant="ghost" class="dp-mini" @click="pickedTags = []">清空</linshe-button>
          </div>
          <p v-else class="dp-empty">还没选标签 — 点「打开标签库」按分组挑，或用搜索直接找。</p>
        </section>

        <!-- ③ 出图参数 -->
        <section class="dp-sec">
          <div class="dp-sec-head"><span class="dp-sec-t">出图参数</span></div>
          <div class="dp-grid">
            <label class="dp-field">
              <span class="dp-label">宽</span>
              <linshe-input v-model.number="width" type="number" size="sm" />
            </label>
            <label class="dp-field">
              <span class="dp-label">高</span>
              <linshe-input v-model.number="height" type="number" size="sm" />
            </label>
          </div>
          <!-- 画幅快捷：1:2 竖幅 / 3:4 / 1:1 / 4:3 / 16:9 -->
          <div class="dp-ratios">
            <linshe-button
              v-for="r in RATIOS" :key="r.label"
              variant="chip" class="dp-mini" :active="isRatio(r)"
              :title="`${r.w}×${r.h}`" @click="applyRatio(r)"
            >{{ r.label }}</linshe-button>
          </div>
          <div class="dp-field dp-field-wide">
            <span class="dp-label">画师串</span>
            <linshe-input v-model="artist" size="sm" placeholder="留空＝用设置里的默认画师串" />
          </div>
          <div v-if="artistFavorites.length" class="dp-favs">
            <linshe-button
              v-for="fav in artistFavorites" :key="fav.id"
              variant="chip" class="dp-mini" :active="fav.artist === artist"
              :title="fav.artist" @click="artist = fav.artist"
            >{{ fav.label }}</linshe-button>
          </div>
        </section>

        <!-- ④ 提交 -->
        <section class="dp-sec dp-actions">
          <linshe-button variant="primary" class="dp-submit" :disabled="!canSubmit" @click="generate">
            {{ loading ? '生成中…' : '生成' }}
          </linshe-button>
          <p v-if="!canSubmit" class="dp-note">填「画面描述」或选标签后才能生成。</p>
        </section>
      </aside>

      <!-- ── 右：结果与提示词 ── -->
      <main class="draw-stage">
        <div v-if="loading" class="ds-state">
          <div class="ds-spinner" aria-hidden="true"></div>
          <p class="ds-state-t">正在生成，请稍候…</p>
          <p class="ds-state-s">本地出图通常需要十几秒到几分钟</p>
        </div>

        <div v-else-if="error" class="ds-state ds-error">
          <p class="ds-state-t">生成失败</p>
          <p class="ds-state-s">{{ error }}</p>
        </div>

        <template v-else-if="images.length">
          <div class="ds-imgs">
            <img
              v-for="(u, i) in images" :key="`${u}-${i}`"
              class="ds-img" :src="u" alt="生成结果"
              @click="preview = u"
            />
          </div>
          <div v-if="generatedPrompt" class="ds-prompt">
            <div class="ds-prompt-head">
              <span>生图提示词</span>
              <linshe-button variant="ghost" class="dp-mini" @click="copyPrompt">
                {{ copied ? '已复制' : '复制' }}
              </linshe-button>
              <linshe-button variant="ghost" class="dp-mini" @click="reuseAndRerun">
                以此重跑
              </linshe-button>
            </div>
            <pre class="ds-prompt-body">{{ generatedPrompt }}</pre>
          </div>
          <p v-if="elapsed" class="ds-meta">耗时 {{ (elapsed / 1000).toFixed(1) }}s</p>
        </template>

        <div v-else class="ds-state">
          <p class="ds-state-t">还没有作品</p>
          <p class="ds-state-s">左边写点描述或挑几个标签，点「生成」开始。</p>
        </div>
      </main>
    </div>

    <!-- 标签库弹窗：全量词库（mode=draw），与角色页那套共用同一实现与唯一真源 -->
    <AppearanceTraitPicker
      v-model="pickerOpen"
      mode="draw"
      display-name="绘图"
      :selected="pickedTags"
      @confirm="onPickerConfirm"
    />

    <!-- 大图预览 -->
    <linshe-modal :visible="!!preview" title="预览" wide @close="preview = ''">
      <img v-if="preview" class="dp-preview-img" :src="preview" alt="预览" />
    </linshe-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import * as api from '../api/index.js'
import AppearanceTraitPicker from '../components/AppearanceTraitPicker.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheAutoTextarea from '../components/ui/LinsheAutoTextarea.vue'

/**
 * 「绘图」页 —— 把生图 TAG 词库做成独立的创意工坊。
 *
 * 用户口径（2026-10-06）：
 *  ① 标签库要能**弹窗**用（原内嵌面板视觉上很难用）；
 *  ② 生图 TAG 自由组合应当**独立成一个功能页**，从左侧栏进；
 *  ③ 角色页只保留**人物身体设计**类标签，动作/状态类都搬到本页。
 *
 * 架构说明：
 *  · 生图链路**复用**已有的 `POST /api/images/test-style`（自由画面描述 → 分层 LLM 补全
 *    成英文生图提示词 → 生图，且会自动把描述里提到的角色外观与 LoRA 一并带上）。
 *    所以本页**不新增后端路由** —— 它只是把那套能力从「设置里的测试按钮」提到一级入口。
 *  · 标签库内容来自 `GET /characters/appearance-trait-catalog?mode=draw`，
 *    分家判定在服务端唯一真源 `appearanceTagPartition.js`，前端不另抄名单。
 */

const sceneDesc = ref('')
const pickedTags = ref([])
const artist = ref('')
const artistFavorites = ref([])
const width = ref(1024)
const height = ref(1536)

const pickerOpen = ref(false)
const loading = ref(false)
const error = ref('')
const images = ref([])
const generatedPrompt = ref('')
const elapsed = ref(0)
const preview = ref('')
const copied = ref(false)

/** 常见画幅（竖幅优先 —— 立绘/人像场景占多数） */
const RATIOS = [
  { label: '1:2 竖', w: 768, h: 1536 },
  { label: '3:4 竖', w: 1152, h: 1536 },
  { label: '1:1 方', w: 1280, h: 1280 },
  { label: '4:3 横', w: 1536, h: 1152 },
  { label: '16:9 宽', w: 1536, h: 864 },
]

function isRatio(r) { return Number(width.value) === r.w && Number(height.value) === r.h }
function applyRatio(r) { width.value = r.w; height.value = r.h }

/** 提交条件：有描述或有标签（两者合一后仍需非空，否则 LLM 没有输入） */
const canSubmit = computed(() => !loading.value && (sceneDesc.value.trim() || pickedTags.value.length))

function removeTag(i) { pickedTags.value.splice(i, 1) }

function onPickerConfirm(next) {
  pickedTags.value = [...next]
  // 点选即写入描述（把人挑的标签拼成一句中文，交给 LLM 去翻译润色）——
  // 不直接塞英文 tag，避免与描述里的中文风格打架。
  syncTagsIntoDesc()
}

/**
 * 把已选标签同步进描述。
 * ⚠ 只**追加尚未出现**的标签，且不动用户手写的内容（用户可能已删掉某个标签的对应文字，
 *   那就随他 —— 我们不反复加回来，只保证"新点的标签"能进描述）。
 */
function syncTagsIntoDesc() {
  const missing = pickedTags.value.filter(t => !sceneDesc.value.includes(t))
  if (!missing.length) return
  const add = missing.join('、')
  sceneDesc.value = sceneDesc.value.trim()
    ? `${sceneDesc.value.trim()}，${add}`
    : add
}

/**
 * 从 test-style 的返回里取出可显示的图片地址。
 *
 * ⚠ 该接口返回的是 `{ base64: 'data:image/png;base64,...', filename }`，
 *   **没有** `url` 字段（实测 2026-10-07）。这里两种形态都兼容 ——
 *   只认 url 会拿到空数组，表现为"生成成功但画面空白"。
 */
function toImageSrc(i) {
  if (!i) return ''
  if (typeof i === 'string') return i
  return i.base64 || i.url || i.dataUrl || ''
}

async function generate() {
  if (!canSubmit.value) return
  syncTagsIntoDesc()
  loading.value = true
  error.value = ''
  images.value = []
  generatedPrompt.value = ''
  elapsed.value = 0
  try {
    const res = await api.testStyle({
      sceneDesc: sceneDesc.value.trim(),
      artist: artist.value.trim() || undefined,
      width: Number(width.value) || undefined,
      height: Number(height.value) || undefined,
      mode: 'chat',   // 走通用尺寸/画师口径；宽高与画师串上面已显式传
    })
    if (!res?.success) {
      error.value = res?.error || '生成失败'
      return
    }
    images.value = (res.images || []).map(toImageSrc).filter(Boolean)
    generatedPrompt.value = res.generatedPrompt || ''
    elapsed.value = res.elapsed || 0
    if (!images.value.length) error.value = '模型未返回图片'
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(generatedPrompt.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch { /* 剪贴板不可用时静默（http 非安全上下文会拒） */ }
}

/** 用当前生成的提示词作为原始 prompt 再跑一次（不再走 LLM 改写，等价于图生图前的微调） */
async function reuseAndRerun() {
  if (!generatedPrompt.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await api.testStyle({
      prompt: generatedPrompt.value,
      alreadyPrepared: true,
      artist: artist.value.trim() || undefined,
      width: Number(width.value) || undefined,
      height: Number(height.value) || undefined,
      mode: 'chat',
    })
    if (!res?.success) { error.value = res?.error || '生成失败'; return }
    images.value = (res.images || []).map(toImageSrc).filter(Boolean)
    elapsed.value = res.elapsed || 0
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const r = await api.getArtistFavorites()
    artistFavorites.value = Array.isArray(r?.favorites) ? r.favorites : (Array.isArray(r) ? r : [])
  } catch { /* 收藏读不到不影响出图 */ }
})
</script>

<style scoped>
.draw-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.draw-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 18px 10px; border-bottom: 1px solid var(--border);
}
.draw-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }
.draw-hint { font-size: 12px; color: var(--text-tertiary); }

.draw-body {
  flex: 1; min-height: 0; display: flex; gap: 14px; padding: 14px 18px 18px; overflow: hidden;
}

/* 左：创作面板 */
.draw-panel {
  width: 340px; flex: 0 0 340px; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 14px;
}
.dp-sec {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px;
}
.dp-sec-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dp-sec-t { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.dp-sec-sub { font-size: 11px; color: var(--text-tertiary); }
.dp-mini { padding: 2px 8px; font-size: 11px; }
.dp-note { margin: 6px 0 0; font-size: 11px; line-height: 1.6; color: var(--text-tertiary); }
.dp-desc { margin-top: 8px; }
.dp-empty {
  margin: 8px 0 0; padding: 12px 8px; font-size: 12px; color: var(--text-tertiary);
  border: 1px dashed var(--border); border-radius: 8px; text-align: center; line-height: 1.6;
}
.dp-picked { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
.dp-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 6px 3px 9px; border-radius: 999px; font-size: 11px;
  background: rgba(var(--accent-rgb), 0.14); color: var(--text-primary);
  border: 1px solid rgba(var(--accent-rgb), 0.32);
}
.dp-chip-x {
  border: 0; background: transparent; cursor: pointer; padding: 0 2px;
  font-size: 13px; line-height: 1; color: var(--text-secondary);
}
.dp-chip-x:hover { color: var(--text-primary); }

.dp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.dp-field { display: flex; align-items: center; gap: 6px; }
.dp-field-wide { margin-top: 8px; }
.dp-label { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.dp-ratios, .dp-favs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

.dp-actions { display: flex; flex-direction: column; gap: 8px; }
.dp-submit { width: 100%; }

/* 右：结果区 */
.draw-stage {
  flex: 1; min-width: 0; min-height: 0; overflow-y: auto;
  background: var(--bg-sunken); border: 1px solid var(--border); border-radius: 10px;
  padding: 14px; display: flex; flex-direction: column; gap: 12px;
}
.ds-state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; text-align: center; padding: 40px 16px;
}
.ds-state-t { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.ds-state-s { margin: 0; font-size: 12px; color: var(--text-tertiary); line-height: 1.6; }
.ds-error .ds-state-t { color: var(--danger, #c0392b); }
.ds-spinner {
  width: 26px; height: 26px; border-radius: 50%;
  border: 3px solid var(--border); border-top-color: var(--accent-solid);
  animation: dp-spin 0.9s linear infinite;
}
@keyframes dp-spin { to { transform: rotate(360deg); } }

.ds-imgs { display: flex; flex-wrap: wrap; gap: 10px; }
.ds-img {
  max-width: 100%; max-height: 62vh; border-radius: 8px; cursor: zoom-in;
  border: 1px solid var(--border); background: var(--bg-secondary);
}
.ds-prompt {
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary);
  padding: 10px;
}
.ds-prompt-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;
}
.ds-prompt-head > span:first-child { flex: 1; }
.ds-prompt-body {
  margin: 0; max-height: 24vh; overflow: auto; white-space: pre-wrap; word-break: break-word;
  font-size: 11px; line-height: 1.7; color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.ds-meta { margin: 0; font-size: 11px; color: var(--text-tertiary); }
.dp-preview-img { max-width: 100%; max-height: 76vh; border-radius: 8px; }

@media (max-width: 900px) {
  .draw-body { flex-direction: column; overflow-y: auto; }
  .draw-panel { width: auto; flex: 0 0 auto; }
  .draw-stage { min-height: 320px; }
}
</style>