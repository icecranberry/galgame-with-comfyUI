import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { getGodAngel, getGodAngelImageJobs, getGodAngelImageJob, generateGodAngelImage, saveGodAngelAvatar, saveGodAngelStanding, removeGodAngelStanding } from '../api/index.js'

// 资料卡和独立日程入口共用天使媒体任务，始终使用神说接口。
export function useGodAngelMedia(props, publish, { dirty = ref(false), confirm = async () => false } = {}) {
  const error = ref('')
  const avatarOpen = ref(false), avatarBusy = ref(false), recentImages = ref([]), mediaLoading = ref(false), jobs = ref([])
  const starting = ref({})
  const standingSceneIndex = ref(0)
  const standingScenes = computed(() => props.character?.standings || [{ scene: 'work', sceneLabel: '默认', image_url: props.character?.standing_url }])
  const selectedStanding = computed(() => standingScenes.value[standingSceneIndex.value] || standingScenes.value[0])
  const outfitsRunning = computed(() => starting.value.outfits || jobs.value.find(job => job.kind === 'outfits' && job.status === 'running'))
  const standingOpen = ref(false), standingRequirement = ref(''), standingUploading = ref(false)
  const peekOpen = ref(false), peekId = ref(null), peekIndex = ref(null), lightboxVisible = ref(false), lightboxImage = ref('')
  const observed = new Set()
  let disposed = false, mediaRequest = 0, avatarToken = 0
  const standingRunning = computed(() => outfitsRunning.value || starting.value.standing || jobs.value.find(j => j.kind === 'standing' && j.status === 'running'))
  const peekRunning = computed(() => starting.value.peek || jobs.value.find(j => j.kind === 'peek' && j.status === 'running'))
  const peekJob = computed(() => jobs.value.find(j => j.id === peekId.value))
  const standingCtl = computed(() => ({ funcOpen: standingOpen.value,
    get requirement() { return standingRequirement.value }, set requirement(value) { standingRequirement.value = value }, hasPrompt: !!selectedStanding.value?.prompt_text,
    busy: !!standingRunning.value || standingUploading.value, busyForChar: !!standingRunning.value,
    generating: !!standingRunning.value, uploading: standingUploading.value, displayUrl: selectedStanding.value?.image_url,
    scenes: standingScenes.value, sceneIndex: standingSceneIndex.value, hasScenes: standingScenes.value.length > 1,
    sceneLabel: selectedStanding.value?.scene === 'work' ? '默认' : selectedStanding.value?.sceneLabel,
    autoplayEnabled: props.visible && !avatarOpen.value && !lightboxVisible.value && !standingRunning.value,
    loadingText: outfitsRunning.value?.result?.progress || (outfitsRunning.value ? '正在设计服装与形象…' : '正在描绘天使的形象…'), tip: '羽翼、光环与服装都会参考已保存的人设。',
    toggleFunc: () => { standingOpen.value = !standingOpen.value }, onStageClick: () => { if (!standingOpen.value) standingOpen.value = true; else if (selectedStanding.value?.image_url) showImage(selectedStanding.value.image_url) },
    generate: () => generateStanding(), regenerate: () => generateStanding(true), uploadFile: uploadStanding, remove: removeStanding,
    prevScene: () => shiftScene(-1), nextScene: () => shiftScene(1), nextExistingScene: () => shiftScene(1, true),
  }))
  async function refreshMedia() {
    const request = ++mediaRequest
    mediaLoading.value = true
    try {
      const data = await getGodAngelImageJobs()
      if (disposed || request !== mediaRequest || !props.visible) return
      jobs.value = data.jobs; recentImages.value = data.images
      const standing = data.jobs.find(job => ['standing', 'outfits'].includes(job.kind))
      const changed = standing && standing.status !== 'running' && !observed.has(standing.id)
      for (const job of data.jobs) if (job.status !== 'running') observed.add(job.id)
      if (changed && (standing.status === 'done' || standing.kind === 'outfits')) {
        const angel = await getGodAngel()
        if (disposed || request !== mediaRequest || !props.visible) return
        publish(angel); if (standing.status === 'failed') error.value = standing.error; else if (standing.result?.note) error.value = standing.result.note
      } else if (changed && standing.status === 'failed') error.value = standing.error
    } catch (err) { if (!disposed && request === mediaRequest) error.value = err.message }
    finally { if (request === mediaRequest) mediaLoading.value = false }
  }
  watch(() => props.visible, visible => { if (visible) { error.value = ''; standingSceneIndex.value = 0; void refreshMedia() } else { ++mediaRequest; avatarOpen.value = false; peekOpen.value = false; lightboxVisible.value = false } }, { immediate: true })
  watch(() => props.visible && jobs.value.some(j => j.status === 'running'), (running, _, onCleanup) => { if (!running) return; const timer = setInterval(refreshMedia, 1500); onCleanup(() => clearInterval(timer)) })
  // 嵌套图片层先消费 Esc，避免独立 Modal 和灯箱各自响应同一次按键。
  function nestedEscape(event) {
    if (event.key !== 'Escape' || !props.visible || (!lightboxVisible.value && !avatarOpen.value && !peekOpen.value)) return
    event.preventDefault(); event.stopImmediatePropagation()
    if (lightboxVisible.value) lightboxVisible.value = false
    else if (avatarOpen.value) cancelAvatar()
    else peekOpen.value = false
  }
  onMounted(() => window.addEventListener('keydown', nestedEscape, true))
  onBeforeUnmount(() => { disposed = true; ++mediaRequest; ++avatarToken; window.removeEventListener('keydown', nestedEscape, true) })
  async function startImage(body) {
    starting.value[body.kind] = true
    try { const job = await generateGodAngelImage(body); jobs.value = [job, ...jobs.value.filter(j => j.id !== job.id)]; if (job.status !== 'running') void refreshMedia(); return job }
    finally { starting.value[body.kind] = false }
  }
  // 取消头像编辑：作废进行中的轮询，避免生成中被弹窗「锁死」无法关闭。
  function cancelAvatar() { ++avatarToken; avatarBusy.value = false; avatarOpen.value = false }
  async function generateAvatar() {
    if (dirty.value) throw new Error('请先保存人设与外观，再生成头像。')
    const token = ++avatarToken
    avatarBusy.value = true
    try {
      let job = await startImage({ kind: 'avatar' })
      const deadline = Date.now() + 180000
      while (job.status === 'running') {
        if (token !== avatarToken) return
        if (disposed) throw new Error('已离开角色详情，稍后可在最近图片中查看结果。')
        if (Date.now() > deadline) throw new Error('头像生成耗时过长，已停止等待，稍后可在最近图片中查看结果。')
        await new Promise(resolve => setTimeout(resolve, 1500))
        job = await getGodAngelImageJob(job.id)
      }
      if (job.status !== 'done') throw new Error(job.error || '头像生成失败')
      void refreshMedia(); return job.result
    } finally { if (token === avatarToken) avatarBusy.value = false }
  }
  async function saveAvatar(base64) {
    avatarBusy.value = true
    try { publish(await saveGodAngelAvatar(base64)) }
    finally { avatarBusy.value = false }
  }
  function shiftScene(step, existingOnly = false) {
    if (standingRunning.value || standingUploading.value) return
    const scenes = standingScenes.value
    let index = standingSceneIndex.value
    for (let i = 0; i < scenes.length; i++) {
      index = (index + step + scenes.length) % scenes.length
      if (!existingOnly || scenes[index]?.image_url) break
    }
    standingSceneIndex.value = index; lightboxVisible.value = false
  }
  async function generateOutfits(baseAppearance, scenes) {
    if (standingRunning.value) return
    error.value = ''
    return startImage({ kind: 'outfits', baseAppearance, scenes })
  }
  async function generateStanding(reuse = false) {
    if (standingRunning.value || standingUploading.value) return
    if (dirty.value) { error.value = '请先保存人设与外观，再生成形象。'; return }
    try { error.value = ''; await startImage({ kind: 'standing', scene: selectedStanding.value.scene, reuse_prompt: reuse, requirement: standingRequirement.value }) }
    catch (err) { error.value = err.message }
  }
  async function uploadStanding(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 6 * 1024 * 1024) { error.value = '请选择6MB以内的 PNG、JPEG 或 WebP 图片。'; return }
    const scene = selectedStanding.value.scene
    standingUploading.value = true; error.value = ''
    try { const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file) }); publish(await saveGodAngelStanding(base64, scene)) }
    catch (err) { error.value = err.message }
    finally { standingUploading.value = false }
  }
  async function removeStanding() {
    const scene = selectedStanding.value.scene
    if (!await confirm({ title: '移除天使形象？', message: '这会移除当前展示的形象，人设与外观描述会保留。', okText: '移除形象' })) return
    try { publish(await removeGodAngelStanding(scene)) } catch (err) { error.value = err.message }
  }
  async function peek(index) {
    if (peekRunning.value || dirty.value) return
    peekOpen.value = true; peekIndex.value = index; peekId.value = null
    try { const job = await startImage({ kind: 'peek', activity_index: index }); peekId.value = job.id; peekIndex.value = job.request.activity_index }
    catch (err) { peekOpen.value = false; error.value = err.message }
  }
  function showImage(url) { lightboxImage.value = url; lightboxVisible.value = true }
  function closePeek() { if (!lightboxVisible.value) peekOpen.value = false }

  return { error, avatarOpen, avatarBusy, recentImages, mediaLoading, refreshMedia, standingCtl,
    generateAvatar, saveAvatar, cancelAvatar, generateOutfits, outfitsRunning, peekRunning, peekJob, peekOpen, peekIndex, peek, closePeek,
    lightboxVisible, lightboxImage }
}
