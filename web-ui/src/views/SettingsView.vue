<template>
  <div class="settings-view">
    <div class="page-header">
      <h2>ComfyUI 生图参数</h2>
      <span class="hint">修改即时生效，无需重启</span>
    </div>

    <!-- ComfyUI params -->
    <div class="card">
      <label class="fl">画师串（节点 96）</label>
      <p class="fd">拼接在 prompt 质量词之前，参考来源：https://anima.mooshieblob.com/</p>
      <input v-model="form.artist" class="fi" @input="markDirty" />

      <div class="fr">
        <div class="fh"><label class="fl">宽度</label><input v-model.number="form.width" type="number" class="fi" min="256" max="4096" @input="markDirty" /></div>
        <div class="fh"><label class="fl">高度</label><input v-model.number="form.height" type="number" class="fi" min="256" max="4096" @input="markDirty" /></div>
      </div>

      <div class="fpresets">
        <span class="pl">预设：</span>
        <button v-for="p in presets" :key="p.label" class="pbtn" @click="applyPreset(p)">{{ p.label }}</button>
      </div>

      <div class="sa">
        <button class="btn-primary" :disabled="!dirty" @click="saveComfy">保存</button>
        <span v-if="saved" class="smsg">已保存</span>
      </div>
    </div>

    <!-- 角色工坊：AI 生成角色人格 -->
    <div class="card">
      <h3>角色工坊</h3>
      <p class="fd">输入简短的描述，AI 自动扩写成完整角色人格并写入数据库</p>
      <div class="cg-row">
        <input v-model="charDesc" class="fi" placeholder="例：芙宁娜（原神） / 傲娇的猫娘女仆 / 沉稳的退伍军人"
          @keydown.enter="generateNewChar" :disabled="generating" />
        <button class="btn-primary cg-btn" @click="generateNewChar" :disabled="generating || !charDesc.trim()">
          {{ generating ? '生成中...' : '✨ 生成角色' }}
        </button>
      </div>
      <div v-if="genError" class="gen-error">{{ genError }}</div>
      <div v-if="genResult" class="gen-result">
        <div class="gen-result-header">
          <span class="gen-check">✅</span>
          <span>角色 <strong>{{ genResult.display_name }}</strong> 已写入数据库</span>
        </div>
        <details class="gen-details">
          <summary>查看生成的人格提示词</summary>
          <pre class="gen-preview">{{ genResult.base_prompt }}</pre>
        </details>
      </div>
    </div>

    <!-- Feature toggles -->
    <div class="card">
      <h3>功能开关</h3>
      <p class="fd">开发期关闭以节省 DeepSeek API 调用</p>

      <div class="toggle-row">
        <div>
          <div class="tl">情绪刺激评估</div>
          <div class="td">每轮对话后评估 AI 情绪变化，影响回复语气</div>
        </div>
        <label class="switch">
          <input type="checkbox" v-model="features.emotion" @change="saveFeature('emotion', features.emotion)" />
          <span class="slider"></span>
        </label>
      </div>

      <div class="toggle-row">
        <div>
          <div class="tl">记忆碎片提取</div>
          <div class="td">从对话中提取事实/偏好/情绪碎片存入向量数据库</div>
        </div>
        <label class="switch">
          <input type="checkbox" v-model="features.memoryExtract" @change="saveFeature('memoryExtract', features.memoryExtract)" />
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <!-- ComfyUI status -->
    <div class="card">
      <h3>ComfyUI 连接</h3>
      <div class="sr">
        <span :class="['sd', health?.connected ? 'on' : 'off']"></span>
        <span>{{ health?.connected ? '已连接' : '未连接' }}</span>
      </div>
      <button class="btn-ghost" @click="checkHealth">刷新</button>
    </div>

    <router-link to="/chat" class="back-btn-bottom">← 返回聊天</router-link>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getConfig, updateComfyConfig, updateFeatureFlag, comfyuiHealth } from '../api/index.js'
import { useChatStore } from '../stores/chat.js'

const chat = useChatStore()

const form = ref({ artist: '', width: 1600, height: 1200 })
const features = reactive({ emotion: false, memory: false, memoryExtract: false })
const dirty = ref(false)
const saved = ref(false)
const health = ref(null)

const presets = [
  { label: '512×768', width: 512, height: 768 },
  { label: '1024×1024', width: 1024, height: 1024 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1600×1200', width: 1600, height: 1200 },
  { label: '1920×1080', width: 1920, height: 1080 },
  { label: '1080×1920', width: 1080, height: 1920 },
]

onMounted(async () => {
  try {
    const data = await getConfig()
    form.value = { artist: data.comfy.artist, width: data.comfy.width, height: data.comfy.height }
    Object.assign(features, data.features)
  } catch {}
  await checkHealth()
})

function markDirty() { dirty.value = true; saved.value = false }

async function saveComfy() {
  await updateComfyConfig(form.value)
  dirty.value = false; saved.value = true
  setTimeout(() => saved.value = false, 2000)
}

function applyPreset(p) { form.value.width = p.width; form.value.height = p.height; dirty.value = true; saved.value = false }

async function saveFeature(key, val) {
  await updateFeatureFlag(key, val)
}

async function checkHealth() { health.value = await comfyuiHealth() }

// ── 角色工坊 ──
const charDesc = ref('')
const generating = ref(false)
const genError = ref('')
const genResult = ref(null)

async function generateNewChar() {
  const desc = charDesc.value.trim()
  if (!desc || generating.value) return
  generating.value = true; genError.value = ''; genResult.value = null
  try {
    const r = await chat.generateCharacter(desc)
    if (r.error) { genError.value = r.error; return }
    genResult.value = r
    charDesc.value = ''
  } catch (err) {
    genError.value = '生成失败: ' + (err.message || '网络错误')
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
.settings-view { padding: 24px; overflow-y: auto; height: 100vh; max-width: 620px; }
.page-header { margin-bottom: 24px; }
.page-header h2 { font-size: 20px; color: var(--text-bright); }
.hint { font-size: 12px; color: var(--text-secondary); }
.hint { font-size: 12px; color: var(--text-secondary); }

.card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.card h3 { font-size: 15px; color: var(--text-bright); margin-bottom: 8px; }
.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; margin-bottom: 2px; }
.fd { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.fi { width: 100%; padding: 9px 12px; font-size: 13px; margin-bottom: 14px; }
.fr { display: flex; gap: 14px; }
.fh { flex: 1; }
.fpresets { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 4px 0 16px; }
.pl { font-size: 11px; color: var(--text-secondary); }
.pbtn { font-size: 11px; padding: 3px 8px; border-radius: 5px; border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-primary); cursor: pointer; }
.pbtn:hover { border-color: var(--accent); color: var(--accent-light); }
.sa { display: flex; align-items: center; gap: 12px; }
.smsg { color: var(--success); font-size: 13px; }

.toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); }
.toggle-row:last-child { border-bottom: none; }
.tl { font-size: 14px; font-weight: 500; color: var(--text-bright); }
.td { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

.switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: var(--bg-hover); border-radius: 24px; cursor: pointer; transition: 0.2s; }
.slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
.switch input:checked + .slider { background: var(--accent); }
.switch input:checked + .slider::before { transform: translateX(20px); }

.sr { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; }
.sd { width: 9px; height: 9px; border-radius: 50%; }
.sd.on { background: var(--success); }
.sd.off { background: var(--danger); }

.back-btn-bottom {
  display: block; text-align: center;
  padding: 12px 0; margin-top: 8px;
  border-radius: 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 14px; font-weight: 500;
  text-decoration: none; cursor: pointer;
  transition: background 0.15s;
}
.back-btn-bottom:hover { background: var(--bg-hover); }

/* 角色工坊 */
.cg-row { display:flex; gap:10px; align-items:center; }
.cg-row .fi { flex:1; margin-bottom:0; }
.cg-btn { flex-shrink:0; white-space:nowrap; }
.gen-error { margin-top:8px; padding:8px 12px; border-radius:6px; background:rgba(217,83,79,0.08); color:#d9534f; font-size:13px; }
.gen-result { margin-top:12px; padding:12px; border-radius:8px; background:rgba(76,175,80,0.06); border:1px solid rgba(76,175,80,0.2); }
.gen-result-header { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--text-bright); }
.gen-check { font-size:18px; }
.gen-details { margin-top:10px; }
.gen-details summary { font-size:12px; color:var(--text-secondary); cursor:pointer; }
.gen-details summary:hover { color:var(--accent); }
.gen-preview { margin-top:8px; padding:10px; border-radius:6px; background:var(--bg-primary); border:1px solid var(--border); font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-word; max-height:400px; overflow-y:auto; color:var(--text-primary); font-family:inherit; }
</style>
