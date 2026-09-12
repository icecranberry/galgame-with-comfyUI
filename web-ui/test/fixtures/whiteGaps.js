import { createApp, h, ref } from 'vue'
import TownImageEditor from '../../src/components/town/TownImageEditor.vue'
import LinsheButton from '../../src/components/ui/LinsheButton.vue'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import '../../src/styles/components.css'

// Synthetic topology/colour fixture; every request is intercepted and no real asset is saved.
const canvas = document.createElement('canvas')
canvas.width = 450; canvas.height = 800
const ctx = canvas.getContext('2d')
ctx.fillStyle = '#544961'; ctx.fillRect(80, 50, 290, 700)
ctx.fillStyle = '#f7f1eb'; ctx.fillRect(88, 110, 7, 120)
ctx.fillStyle = '#fefefe'; ctx.fillRect(352, 470, 8, 175)
ctx.fillRect(140, 450, 120, 160)
ctx.fillStyle = '#fafafa'; ctx.fillRect(350, 280, 6, 110)
ctx.fillStyle = '#fcfaf7'; ctx.fillRect(140, 250, 170, 160)
ctx.fillStyle = '#ffdbbf'; ctx.fillRect(140, 80, 160, 135)
const original = canvas.toDataURL()
const query = new URLSearchParams(location.search)
const checks = query.has('checks') ? JSON.parse(query.get('checks')) : [
  ['暖白', 90, 120], ['浅灰', 354, 300], ['灰白', 354, 500], ['白衣', 200, 300], ['描边', 100, 120],
]
const imageSrc = ref(query.get('sample') || original)
const saveStatus = ref('尚未保存')
const previewStatus = ref('尚未读取预览')
function readPreview() {
  const rendered = document.querySelector('.ie-canvas')
  const pixels = rendered.getContext('2d').getImageData(170, 480, 20, 20).data
  const average = [0, 0, 0, 0]
  for (let i = 0; i < pixels.length; i++) average[i % 4] += pixels[i] / 400
  previewStatus.value = `画布实际 RGBA 均值：${average.map(value => value.toFixed(2)).join(',')}`
}
const mobile = ref(false)
const failSave = ref(false)
window.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/town/assets/987654/image') && options.method === 'POST') {
    if (failSave.value) return { ok: false, status: 500, json: async () => ({ error: '样例：模拟保存失败' }) }
    const { dataUrl } = JSON.parse(options.body)
    const image = new Image()
    await new Promise(resolve => { image.onload = resolve; image.src = dataUrl })
    const saved = document.createElement('canvas'); saved.width = image.width; saved.height = image.height
    const savedCtx = saved.getContext('2d'); savedCtx.drawImage(image, 0, 0)
    const sample = (x, y) => [...savedCtx.getImageData(x, y, 1, 1).data].join(',')
    saveStatus.value = `保存像素：${checks.map(([label, x, y]) => `${label}=${sample(x, y)}`).join('；')}`
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  return { ok: true, status: 200, json: async () => ({ files: [] }) }
}

createApp({ setup() {
  return () => h('main', { style: 'padding:12px;color:var(--text-primary);background:var(--bg-primary);min-height:100vh' }, [
    h('nav', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px' }, [
      h(LinsheButton, { size: 'sm', onClick: () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'warm' : 'dark' } }, () => '切换主题'),
      h(LinsheButton, { size: 'sm', onClick: () => { mobile.value = !mobile.value } }, () => '切换窄屏'),
      h(LinsheButton, { size: 'sm', onClick: () => { imageSrc.value = imageSrc.value === original ? `${original}#reset` : original; saveStatus.value = '尚未保存' } }, () => '重置图片'),
      h(LinsheButton, { size: 'sm', active: failSave.value, onClick: () => { failSave.value = !failSave.value } }, () => '模拟保存失败'),
      h(LinsheButton, { size: 'sm', onClick: readPreview }, () => '读取预览像素'),
    ]),
    h('output', { style: 'display:block;font-size:12px;margin-bottom:8px', 'aria-label': '保存校验' }, saveStatus.value),
    h('output', { style: 'display:block;font-size:12px;margin-bottom:8px', 'aria-label': '标记预览校验' }, previewStatus.value),
    h('section', { class: 'tam-panel', style: `width:${mobile.value ? '366px' : '960px'};max-width:100%;margin:0 auto` }, [
      h(TownImageEditor, { src: imageSrc.value, assetId: 987654, isPortrait: true, cropMode: true, generationStep: 'npcs', generationParams: { prefix: '', artist: '', loras: [] } }),
    ]),
  ])
} }).mount('#app')
