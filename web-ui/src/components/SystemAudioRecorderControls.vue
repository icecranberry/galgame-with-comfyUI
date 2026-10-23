<template>
  <div class="system-recorder-controls">
    <p>播放想录制的对白，选择共享来源并勾选共享音频。这里只保存声音，不保存画面，也不会开启麦克风。</p>
    <p class="recorder-timer" role="status"><span v-if="state.phase === 'recording'" class="recording-dot" />{{ labels[state.phase] || '准备录音' }} · {{ Math.floor(state.seconds || 0) }} 秒</p>
    <p v-if="!supported" role="alert">当前浏览器不支持系统声音录制。请在本机 Chrome / Edge 打开邻舍，或直接上传音频文件。</p>
    <p v-if="state.error" role="alert">{{ state.error }}</p>
    <VoiceAudioPlayer v-if="audioUrl" :src="audioUrl" label="录制原音试听" @play="$emit('play', $event.target)" />
    <div class="recorder-actions">
      <linshe-button v-if="!active" variant="primary" :disabled="!supported" @click="$emit('start')">{{ audioUrl ? '重新录制' : '开始录制' }}</linshe-button>
      <linshe-button v-else variant="danger" :disabled="state.phase === 'stopping'" @click="$emit('stop')">{{ state.phase === 'requesting' ? '取消等待' : '停止录制' }}</linshe-button>
      <linshe-button v-if="audioUrl && !active" @click="$emit('use')">使用这段录音</linshe-button>
    </div>
    <p class="recorder-hint">最长录制 119 秒后自动停止。关闭录音窗即停止采集；录好后可继续裁剪，建议保留 6～12 秒单人对白，无需填写参考台词。</p>
  </div>
</template>
<script setup>
import { computed } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import VoiceAudioPlayer from './VoiceAudioPlayer.vue'
const props = defineProps({ state: Object, audioUrl: String, supported: Boolean })
defineEmits(['start', 'stop', 'use', 'play'])
const active = computed(() => ['requesting', 'recording', 'stopping'].includes(props.state.phase))
const labels = { idle: '准备录音', requesting: '等待选择共享来源', recording: '正在录制系统声音', stopping: '正在整理录音', ready: '录音已就绪', error: '录音未完成' }
</script>
<style scoped>
.system-recorder-controls { display:flex; flex-direction:column; gap:14px; color:var(--text-primary); }
.system-recorder-controls p { margin:0; font-size:var(--fs-sm); line-height:1.7; }
.recorder-actions { display:flex; flex-wrap:wrap; gap:10px; }
.recorder-timer { font-variant-numeric:tabular-nums; font-weight:600; }
.recording-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--danger); margin-right:8px; }
.system-recorder-controls .recorder-hint { font-size:var(--fs-xs); color:var(--text-secondary); }
</style>
