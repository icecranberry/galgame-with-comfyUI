<template>
  <div class="item-card" :class="{ editing: item._editing }">
    <!-- 编辑态 -->
    <!-- 编辑态 / 展示态 -->
    <CardHeightTransition :editing="item._editing">
      <div v-if="item._editing" class="edit-form">
        <label class="edit-field">
          <span class="edit-label">名称</span>
          <input v-model.trim="item.name" class="edit-input" placeholder="名称" />
        </label>
        <label v-if="isEvents" class="edit-field">
          <span class="edit-label">标签（逗号分隔）</span>
          <input v-model="funFromText" class="edit-input" placeholder="如 小确幸, 日常感" />
        </label>
        <label class="edit-field">
          <span class="edit-label">描述</span>
          <textarea v-model.trim="item.desc" class="edit-input edit-textarea" rows="6"></textarea>
        </label>
      </div>

      <div v-else class="card-main">
        <div class="card-title-row">
          <span class="card-name">{{ item.name }}</span>
        </div>
        <div class="card-desc">{{ item.desc }}</div>
        <div v-if="isEvents && item.funFrom && item.funFrom.length" class="card-tags">
          <span v-for="(t, ti) in item.funFrom" :key="ti" class="tag">{{ t }}</span>
        </div>
      </div>
    </CardHeightTransition>

    <div class="card-actions">
      <button class="mini-btn" @click="onToggleEdit">{{ item._editing ? '取消' : '编辑' }}</button>
      <button v-if="item._editing" class="mini-btn primary" @click="emit('save', item)">保存</button>
      <button v-else class="mini-btn danger" @click="emit('remove', item)">删除</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import CardHeightTransition from './CardHeightTransition.vue'

const props = defineProps({
  item: { type: Object, required: true },
  isEvents: { type: Boolean, default: false },
})
const emit = defineEmits(['edit', 'cancel', 'save', 'remove'])

// 标签以逗号分隔字符串编辑，实时同步回数组
const funFromText = ref('')
watch(
  () => props.item._editing,
  (v) => {
    if (v) funFromText.value = (props.item.funFrom || []).join(', ')
  }
)
watch(funFromText, (v) => {
  props.item.funFrom = v.split(/[,，]/).map(s => s.trim()).filter(Boolean)
})

function onToggleEdit() {
  if (props.item._editing) emit('cancel', props.item)
  else emit('edit', props.item)
}
</script>

<style scoped>
.item-card {
  display: flex; flex-direction: column; justify-content: space-between;
  border: 1px solid var(--glass-border, rgba(0,0,0,0.1));
  border-radius: 12px; padding: 12px;
  background: rgba(255,255,255,0.6);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.item-card:hover { border-color: rgba(224,123,108,0.35); box-shadow: 0 3px 16px rgba(224,123,108,0.06); }
.item-card.editing { border-color: var(--accent, #e07b6c); box-shadow: 0 0 0 2px rgba(224,123,108,0.15); }
.card-main { min-width: 0; }
.card-title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.card-name { font-size: 14px; font-weight: 700; color: var(--text-bright, #2b2b2b); }
.card-desc {
  font-size: 12px; color: var(--text-primary, #555);
  line-height: 1.6; margin-top: 6px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tag {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: rgba(224,123,108,0.1); color: #c06a5a;
}
.card-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 10px; }
.mini-btn {
  padding: 4px 12px; border-radius: 8px; border: 1px solid var(--glass-border, rgba(0,0,0,0.12));
  background: #fff; color: var(--text-primary, #555); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.mini-btn:hover { border-color: var(--accent, #e07b6c); color: #c06a5a; }
.mini-btn.primary { border: none; background: linear-gradient(120deg, #f8edea 0%, #f2eaf4 35%, #eaf0f8 65%, #f8edea 100%); color: #c06a5a; font-weight: 600; }
.mini-btn.danger:hover { border-color: var(--danger, #e05050); color: var(--danger, #e05050); }
.edit-form { display: flex; flex-direction: column; gap: 8px; }
.edit-field { display: flex; flex-direction: column; gap: 4px; }
.edit-label { font-size: 11px; color: var(--text-secondary, #888); }
.edit-input {
  border: 1px solid var(--glass-border, rgba(0,0,0,0.12));
  border-radius: 8px; padding: 6px 8px;
  font-size: 12px; font-family: inherit; color: var(--text-primary, #333);
  background: rgba(0,0,0,0.02); outline: none; box-sizing: border-box;
}
.edit-input:focus { border-color: var(--accent, #e07b6c); }
.edit-textarea { resize: vertical; }
</style>
