<template>
  <div class="voice-sample-preview">
    <VoiceAudioPlayer :src="src" :transport="transport" label="实时样音" @play="speechPlayer.adopt($event.target)" />
    <p class="voice-sample-hint">{{ src ? '点击播放后循环试听，拖动滑条即时生效。保存后将使用调节后的样音作为参考音频。' : '请选择内置声音，再播放实时样音。' }}</p>
  </div>
</template>

<script setup>
import { markRaw, shallowRef, watch, onBeforeUnmount } from 'vue'
import VoiceAudioPlayer from './VoiceAudioPlayer.vue'
import { speechPlayer } from '../stores/speech.js'
import { createVoiceSamplePlayback } from '../audio/voiceSamplePlayback.js'
const props = defineProps({ src: { type: String, default: '' }, start: { type: Number, default: 0 }, end: { type: Number, default: undefined }, parameters: { type: Object, required: true } })
const transport = shallowRef(null)
watch(() => [props.src, props.start, props.end], () => {
  transport.value?.dispose()
  transport.value = props.src ? markRaw(createVoiceSamplePlayback({ src: props.src, start: props.start, end: props.end, parameters: props.parameters })) : null
}, { immediate: true })
watch(() => props.parameters, value => transport.value?.setParameters(value), { deep: true })
onBeforeUnmount(() => transport.value?.dispose())
</script>

<style scoped>
.voice-sample-preview { display:grid; gap:8px; min-width:0; }
.voice-sample-hint { margin:0; font-size:var(--fs-xs); line-height:1.6; color:var(--text-secondary); }
</style>
