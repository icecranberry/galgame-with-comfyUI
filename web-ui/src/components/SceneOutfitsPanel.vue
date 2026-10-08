<template>
  <!-- ── 场景服装：工装 / 外出 / 居家 / 睡眠 ──
       与上方「专属形态」不同：形态是互斥单套（道具变身用），场景服装是**四套并存**，
       由日程决定此刻穿哪套（睡眠时段强制用「睡眠」那套）。由日程的 outfit 标注驱动。 -->
  <div class="scene-outfits">
    <div class="so-head">
      <div>
        <div class="so-title">场景服装</div>
        <div class="so-sub">随日程自动切换：上班穿工装、回家换居家服、睡觉强制睡衣（这四套只在被日程标到时才注入生图）</div>
      </div>
      <linshe-button
        variant="secondary" size="sm"
        :disabled="generating || saving"
        :loading="generating"
        @click="generate"
      >{{ outfits.some(o => o.name) ? '重新生成' : '✨ AI 生成四套' }}</linshe-button>
    </div>

    <div v-if="!outfits.length" class="so-empty">加载中…</div>

    <div v-else class="so-list">
      <div v-for="(o, i) in outfits" :key="o.scene" class="so-item" :class="{ 'is-sleep': o.scene === 'sleep' }">
        <div class="so-scene">
          <span class="so-scene-label">{{ o.sceneLabel }}</span>
          <span v-if="o.scene === 'sleep'" class="so-scene-note">睡觉时强制使用</span>
        </div>
        <linshe-input
          v-model="outfits[i].name"
          class="fi so-name"
          size="sm"
          maxlength="20"
          placeholder="服装名称（≤10 字），如「星核猎手作战服」"
        />
        <linshe-input
          v-model="outfits[i].description"
          type="textarea"
          class="fi"
          rows="2"
          placeholder="外观描述，中英混合，如 black tactical combat suit with cyan accents"
        />
      </div>
    </div>

    <div class="so-actions">
      <span class="so-hint">{{ hint }}</span>
      <div style="flex:1"></div>
      <linshe-button
        variant="primary" size="sm"
        :disabled="saving || generating || !outfits.length"
        :loading="saving"
        @click="save"
      >{{ saving ? '保存中…' : '保存场景服装' }}</linshe-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'

const props = defineProps({
  character: { type: Object, default: null },
})
const toastFn = inject('toast', null)
const toast = (m, t) => { if (toastFn) toastFn(m, t) }

const outfits = ref([])       // [{ scene, sceneLabel, name, description }]
const loading = ref(false)
const generating = ref(false)
const saving = ref(false)

const hint = computed(() => {
  const filled = outfits.value.filter(o => o.name && o.description).length
  if (!filled) return '还没有配置。点「AI 生成四套」让邻舍按人设设计，或手动填写。'
  if (filled < 4) return `已填 ${filled}/4 套 —— 缺的场景会回落到原本的「你的外观」。`
  return '仅当日程把角色安排到某个场景时，才会注入对应那套（睡眠时段强制用睡衣）。'
})

async function load() {
  const id = props.character?.id
  if (!id) return
  loading.value = true
  try {
    const d = await api.listSceneOutfits(id)
    const scenes = d.scenes || []
    const exist = d.outfits || []
    // 以场景定义为骨架，把已有的填进去 —— 保证四行始终齐全、顺序固定
    outfits.value = scenes.map(s => {
      const hit = exist.find(o => o.scene === s.key)
      return {
        scene: s.key,
        sceneLabel: s.label,
        name: hit?.name || '',
        description: hit?.description || '',
      }
    })
  } catch (err) {
    toast('读取场景服装失败: ' + (err?.message || ''), 'error')
    outfits.value = []
  } finally {
    loading.value = false
  }
}

async function generate() {
  const id = props.character?.id
  if (!id) return
  generating.value = true
  try {
    // 只生成不落库，让用户先看结果、可改；确认后点保存
    const d = await api.generateSceneOutfits(id, false)
    const byScene = new Map((d.outfits || []).map(o => [o.scene, o]))
    outfits.value = outfits.value.map(o => {
      const hit = byScene.get(o.scene)
      return hit ? { ...o, name: hit.name, description: hit.description } : o
    })
    toast('已生成四套，可修改后保存', 'success')
  } catch (err) {
    toast('生成失败: ' + (err?.message || ''), 'error')
  } finally {
    generating.value = false
  }
}

async function save() {
  const id = props.character?.id
  if (!id) return
  const payload = outfits.value.filter(o => o.name.trim() && o.description.trim())
  if (!payload.length) { toast('至少填写一套完整的服装', 'warning'); return }
  saving.value = true
  try {
    await api.saveSceneOutfits(id, payload.map(o => ({ scene: o.scene, name: o.name.trim(), description: o.description.trim() })))
    toast('场景服装已保存', 'success')
  } catch (err) {
    toast('保存失败: ' + (err?.message || ''), 'error')
  } finally {
    saving.value = false
  }
}

watch(() => props.character?.id, load, { immediate: true })
</script>

<style scoped>
.scene-outfits {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--glass-border);
}
.so-head {
  display: flex; align-items: flex-start; gap: 10px;
  margin-bottom: 10px;
}
.so-title { font-size: 13px; font-weight: 600; color: var(--text-bright); }
.so-sub { font-size: 11px; color: var(--text-secondary); line-height: 1.5; margin-top: 2px; max-width: 420px; }
.so-empty { font-size: 12px; color: var(--text-secondary); padding: 8px 0; }

.so-list { display: flex; flex-direction: column; gap: 10px; }
.so-item {
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--glass-border);
  display: flex; flex-direction: column; gap: 6px;
}
/* 睡眠那套标一下 —— 它是唯一"强制"生效的 */
.so-item.is-sleep { border-color: rgba(var(--accent-rgb), 0.35); }
.so-scene { display: flex; align-items: baseline; gap: 8px; }
.so-scene-label { font-size: 12px; font-weight: 600; color: var(--accent); }
.so-scene-note { font-size: 10px; color: var(--text-secondary); }
.so-name { max-width: 260px; }

.so-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.so-hint { font-size: 11px; color: var(--text-secondary); line-height: 1.5; max-width: 420px; }
</style>
