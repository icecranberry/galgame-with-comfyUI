<template>
  <!-- ── 编辑大纲节点的 Scene（2026-10-07 用户口径）──
       ★ 原先这里走 `window.prompt`（浏览器原生单行框）—— 用户实报「不合适」。
         Scene 是一段**多行叙述**，原生 prompt 只能看到一行、也没有换行，
         人类侧根本没法好好改。改为正式弹窗（多行文本域 + 节点上下文 + 快捷键）。
       ★ 不落库时机与别处一致：**本弹窗只负责收集文本**，真正写库由父级调用
         `/outline/beats/:index`（保持 StoryView 独占状态，弹窗不碰 API）。 -->
  <linshe-modal v-model="open" title="编辑节点 Scene" wide>
    <div class="so-body">
      <p class="so-intro">
        这一节点在这段时间里<b>实际发生了什么</b>——场景、经过、谁做了什么。
        它会随大纲一起注入，帮后续生成贴住你定的走向。
      </p>

      <div v-if="beat" class="so-node">
        <span class="so-node-idx">第 {{ beat.index + 1 }} 个节点</span>
        <span v-if="beat.time" class="so-node-time">{{ beat.time }}</span>
        <span v-if="beat.title" class="so-node-title">{{ beat.title }}</span>
      </div>

      <linshe-input
        ref="inputRef"
        v-model="text"
        type="textarea"
        :rows="8"
        placeholder="例：她在截稿前一晚发现两份稿子撞了档期，连夜给编辑打电话，最后咬牙推掉了私活"
        :disabled="busy"
        @keydown.ctrl.enter.prevent="submit"
        @keydown.meta.enter.prevent="submit"
      />
      <div class="so-foot-hint">
        <span>Ctrl + Enter 保存</span>
        <span class="so-count">{{ text.length }} 字</span>
      </div>

      <p v-if="emptyWarn" class="so-warn">
        留空会删掉这一节点的 Scene —— 节点要素不全后将<b>不再被识别为有效节点</b>（但不影响已写内容）。
      </p>
      <p v-if="error" class="so-error">{{ error }}</p>
    </div>

    <template #footer>
      <linshe-button variant="ghost" :disabled="busy" @click="open = false">取消</linshe-button>
      <linshe-button variant="primary" :loading="busy" @click="submit">保存</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheModal from '../ui/LinsheModal.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 正在编辑的节点：{ index, title, time, scene }（index 为 0 基，落库要它） */
  beat: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'save'])

const open = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const inputRef = ref(null)
const text = ref('')

const emptyWarn = computed(() => !!props.beat && !text.value.trim())

// 打开时把当前值灌进来并聚焦 —— 直接改，不用先清空。
watch(() => props.modelValue, async v => {
  if (!v) return
  text.value = String(props.beat?.scene || '')
  await nextTick()
  // ⚠ `LinsheInput` 的根元素**就是** textarea/input 本身（不是包一层 div），
  //   所以取 `$el` 即可，别再 `querySelector('textarea')`（那样拿到 null）。
  const el = inputRef.value?.$el
  if (el && typeof el.focus === 'function') {
    el.focus()
    try { el.setSelectionRange(el.value.length, el.value.length) } catch { /* 某些类型不支持选区 */ }
  }
})

function submit() {
  if (props.busy) return
  emit('save', text.value)
}
</script>

<style scoped>
.so-body { display: flex; flex-direction: column; gap: 12px; }
.so-intro { margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
.so-node {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 7px 10px; border-radius: 8px;
  background: rgba(var(--accent-rgb), 0.06);
  font-size: 12px;
}
.so-node-idx { color: var(--text-secondary); }
.so-node-time { color: var(--text-secondary); }
.so-node-title { color: var(--text-bright); font-weight: 600; }
.so-foot-hint {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font-size: 11px; color: var(--text-secondary);
}
.so-count { opacity: 0.75; font-variant-numeric: tabular-nums; }
.so-warn { margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
.so-error { margin: 0; font-size: 12px; color: var(--danger); line-height: 1.5; }
</style>