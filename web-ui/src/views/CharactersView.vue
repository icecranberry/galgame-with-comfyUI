<template>
  <div class="characters-view">
    <div class="page-header">
      <h2>👤 角色管理</h2>
      <button class="btn-primary" @click="showCreate = true">+ 新建角色</button>
    </div>

    <div class="char-grid">
      <div v-for="c in chars.characters" :key="c.id" class="char-card">
        <div class="char-card-header">
          <h3>{{ c.display_name }}</h3>
          <span class="char-name-tag">{{ c.name }}</span>
        </div>
        <div class="char-prompt-preview">
          {{ c.base_prompt.slice(0, 200) }}{{ c.base_prompt.length > 200 ? '...' : '' }}
        </div>
        <div class="char-meta">
          <span>基线: V={{ parseEmotion(c.emotion_baseline).valence }}</span>
          <button
            class="btn-ghost"
            @click="handleResetEmotion(c.id)"
            title="重置情绪"
          >🔄 重置情绪</button>
        </div>
      </div>
    </div>

    <!-- Create modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <h3>新建角色</h3>
        <label>内部名 (英文)</label>
        <input v-model="form.name" placeholder="my-character" />
        <label>显示名</label>
        <input v-model="form.display_name" placeholder="我的角色" />
        <label>角色 Prompt</label>
        <textarea v-model="form.base_prompt" rows="10" placeholder="你是一个..."></textarea>
        <label>情绪基线 (JSON)</label>
        <input v-model="form.emotion_baseline" placeholder='{"valence":0.5,"arousal":0.5,"dominance":0.5}' />
        <div class="modal-actions">
          <button class="btn-ghost" @click="showCreate = false">取消</button>
          <button class="btn-primary" @click="handleCreate" :disabled="!form.name || !form.base_prompt">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useCharacterStore } from '../stores/character.js'
import { resetCharacterEmotion } from '../api/index.js'

const chars = useCharacterStore()
const showCreate = ref(false)
const form = ref({
  name: '',
  display_name: '',
  base_prompt: '',
  emotion_baseline: '{"valence":0.5,"arousal":0.5,"dominance":0.5}',
})

async function handleCreate() {
  try {
    await chars.create(form.value)
    showCreate.value = false
    form.value = { name: '', display_name: '', base_prompt: '', emotion_baseline: '{"valence":0.5,"arousal":0.5,"dominance":0.5}' }
  } catch (e) {
    alert('创建失败: ' + e.message)
  }
}

async function handleResetEmotion(id) {
  await resetCharacterEmotion(id)
  alert('情绪已重置到基线')
}

function parseEmotion(raw) {
  try { return JSON.parse(raw) } catch { return { valence: 0.5, arousal: 0.5, dominance: 0.5 } }
}
</script>

<style scoped>
.characters-view {
  padding: 24px;
  overflow-y: auto;
  height: 100vh;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.page-header h2 {
  font-size: 20px;
  color: var(--text-bright);
}

.char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.char-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  transition: border-color 0.15s;
}
.char-card:hover { border-color: var(--accent); }

.char-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.char-card-header h3 {
  font-size: 16px;
  color: var(--text-bright);
}
.char-name-tag {
  font-size: 11px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: monospace;
}

.char-prompt-preview {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
}

.char-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
  width: 90%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modal h3 {
  font-size: 18px;
  color: var(--text-bright);
  margin-bottom: 8px;
}
.modal label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
  margin-top: 4px;
}

.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
