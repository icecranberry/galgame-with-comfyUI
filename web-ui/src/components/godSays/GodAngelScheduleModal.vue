<template>
  <AngelScheduleDrawer
    :open="visible"
    :char="character"
    :activities="activities"
    :loading="loading"
    :peek-busy="!!peekRunning"
    @close="close"
    @peek="peekCurrent"
    @peek-at="peekAt"
  />
  <AngelPeekFilm
    :visible="visible && peekOpen"
    :character="character"
    :activity="peekActivity"
    :loading="peekLoading"
    :error="peekError"
    :image="peekImage"
    :busy="!!peekRunning"
    @close="closePeek"
    @retake="retake"
    @open-image="showImage(peekImage)"
  />
  <Teleport to="body"><div style="--vel-z-index: 14000"><ImageLightbox :visible="lightboxVisible" :imgs="lightboxImage" :show-regenerate="false" :show-upscale="false" :show-delete="false" @hide="lightboxVisible = false" /></div></Teleport>
</template>

<script setup>
import { computed } from 'vue'
import ImageLightbox from '../ImageLightbox.vue'
import AngelScheduleDrawer from './AngelScheduleDrawer.vue'
import AngelPeekFilm from './AngelPeekFilm.vue'
import { useGodAngelMedia } from '../../composables/useGodAngelMedia.js'

const props = defineProps({ visible: Boolean, loading: Boolean, character: { type: Object, default: null } })
const emit = defineEmits(['close', 'saved'])
const { peekRunning, peekJob, peekOpen, peekIndex, peek, closePeek, lightboxVisible, lightboxImage } = useGodAngelMedia(props, angel => emit('saved', { ...angel, system_role: 'angel' }))

const activities = computed(() => Array.isArray(props.character?.schedule) ? props.character.schedule : [])
const peekActivity = computed(() => peekJob.value?.request?.activity || null)
const peekLoading = computed(() => !peekJob.value || peekJob.value.status === 'running')
const peekError = computed(() => peekJob.value?.status === 'failed' ? (peekJob.value.error || '生成失败') : '')
const peekImage = computed(() => peekJob.value?.result?.images?.[0]?.url || '')

function peekCurrent() {
  const list = activities.value
  if (!list.length) return
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const parse = text => { const m = /^(\d{1,2}):(\d{2})/.exec(text || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
  const index = list.findIndex(item => {
    const start = parse(item.startTime), end = parse(item.endTime)
    return start !== null && end !== null && nowMinutes >= start && nowMinutes < end
  })
  peek(index >= 0 ? index : 0)
}
function peekAt(act) {
  const list = activities.value
  const index = list.findIndex(item => item.startTime === act.startTime && item.activity === act.activity)
  peek(index >= 0 ? index : 0)
}
function retake() { peek(peekIndex.value ?? 0) }
function showImage(url) { if (!url) return; lightboxImage.value = url; lightboxVisible.value = true }
function close() { if (!peekOpen.value && !lightboxVisible.value) emit('close') }
</script>
