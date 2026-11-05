<template>
  <ResidentCharacterDetailModal ref="profile" :visible="visible" :character="residentCharacter" :profile-adapter="profileAdapter" @close="close" @saved="publish" @open-avatar-editor="avatarOpen = true">
    <template #footer-leading>
      <linshe-button variant="secondary" @click="emit('resummon')">重新召唤</linshe-button>
    </template>
  </ResidentCharacterDetailModal>
  <AvatarCropper v-if="visible && avatarOpen" title="天使头像" character-id="god:angel" :show-generate-tab="true" :recent-images="recentImages" :recent-loading="mediaLoading" :generate-handler="generateAvatar" :save-handler="saveAvatar" @switch-to-recent="refreshMedia" @close="cancelAvatar" />
  <Teleport to="body"><div style="--vel-z-index: 14000"><ImageLightbox :visible="lightboxVisible" :imgs="lightboxImage" :show-regenerate="false" :show-upscale="false" :show-delete="false" @hide="lightboxVisible = false" /></div></Teleport>
</template>

<script setup>
import { ref, computed, inject, watch } from 'vue'
import ResidentCharacterDetailModal from '../ResidentCharacterDetailModal.vue'
import LinsheButton from '../ui/LinsheButton.vue'
import AvatarCropper from '../AvatarCropper.vue'
import ImageLightbox from '../ImageLightbox.vue'
import { updateGodAngel, getGodAngel, getGodAngelImageJobs, generateGodAngelClothingDraft } from '../../api/index.js'
import { useGodAngelMedia } from '../../composables/useGodAngelMedia.js'

const props = defineProps({ visible: Boolean, character: { type: Object, default: null } })
const emit = defineEmits(['close', 'saved', 'resummon'])
const confirm = inject('confirm', async () => false)
const toast = inject('toast', () => {})
const profile = ref(null)
const dirty = computed(() => !!profile.value?.isDirty)
function publish(angel) { emit('saved', { ...angel, system_role: 'angel' }) }
const { error, avatarOpen, recentImages, mediaLoading, refreshMedia, standingCtl,
  generateAvatar, saveAvatar, cancelAvatar, generateOutfits, outfitsRunning, lightboxVisible, lightboxImage } = useGodAngelMedia(props, publish, { dirty, confirm })
const residentCharacter = computed(() => ({ ...props.character, id: 'god:angel', name: 'angel', base_prompt: props.character?.persona || '' }))
const profileAdapter = computed(() => ({ standing: standingCtl.value, batchRunning: !!outfitsRunning.value, generateOutfits, clothingDraft: generateGodAngelClothingDraft, recentImages: getGodAngelImageJobs, save: async payload => {
  const result = await updateGodAngel(payload)
  return getGodAngel().catch(() => result)
} }))
watch(error, value => { if (value) toast(value, 'error') })
function close() {
  if (lightboxVisible.value) return
  // 头像编辑层可随时关闭（取消进行中的轮询），不再因为「正在生成」把弹窗锁死。
  if (avatarOpen.value) { cancelAvatar(); return }
  emit('close')
}
</script>
