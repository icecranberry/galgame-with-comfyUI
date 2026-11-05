import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

function fixture(t, overrides = {}) {
  const source = readFileSync(new URL('../src/components/AvatarCropper.vue', import.meta.url), 'utf8')
  const script = compileScript(parse(source).descriptor, { id: 'avatar-cropper-test' })
  const code = script.content.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
    .replace(/^import .* from .*$/gm, '').replace('export default', 'return')
  const component = new Function('Vue', 'generateAvatar', 'LinsheButton', 'LinsheModal', 'LinsheTabs', code)(Vue, () => { throw new Error('Unexpected resident API') }, {}, {}, {})
  const previous = Object.fromEntries(['window', 'document', 'Image', 'FileReader'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const images = [], readers = [], draws = [], events = []
  class Image {
    constructor() { this.naturalWidth = 2000; this.naturalHeight = 1000; images.push(this) }
  }
  class FileReader {
    constructor() { readers.push(this) }
    readAsDataURL() {}
  }
  function canvas() {
    const ctx = new Proxy({ drawImage: (...args) => draws.push(args) }, { get: (target, key) => target[key] || (() => {}) })
    return { getContext: () => ctx, toDataURL: () => 'data:image/png;base64,cropped' }
  }
  const globals = { Image, FileReader, window: { devicePixelRatio: 1 }, document: { addEventListener() {}, removeEventListener() {}, createElement: canvas } }
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const props = Vue.reactive({ characterId: 'god:angel', saveHandler: null, generateHandler: null, ...overrides })
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) })
    return () => null
  } })
  app.mount({})
  let mounted = true
  const unmount = () => { if (mounted) { mounted = false; app.unmount() } }
  t.after(() => {
    unmount()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { state, images, readers, draws, canvas, events, unmount }
}

test('recent image draws when crop canvases mount after the picker exit transition', async t => {
  const h = fixture(t)
  h.state.selectRecentImage('/images/standing/angel.png')
  const image = h.images[0]
  image.onload()
  await Vue.nextTick()
  assert.equal(h.draws.length, 0)
  h.state.cropCanvas.value = h.canvas()
  h.state.previewCanvas.value = h.canvas()
  await Vue.nextTick()
  assert.equal(h.draws.length, 2)
  assert.equal(h.draws[0][0], image, 'native image is passed directly to canvas')
  assert.equal(h.state.cropCanvas.value.width, 520)
  assert.equal(h.state.previewCanvas.value.width, 104)
})

test('late results from a previous image cannot replace the most recent selection', t => {
  const h = fixture(t)
  h.state.selectRecentImage('/first.png')
  const firstLoad = h.images[0].onload
  h.state.selectRecentImage('/second.png')
  h.images[1].onload()
  firstLoad()
  assert.equal(h.state.cropImage.value, h.images[1])
})

test('closing or unmounting cancels pending image callbacks', t => {
  const h = fixture(t)
  h.state.selectRecentImage('/first.png')
  const firstLoad = h.images[0].onload
  h.state.tryClose()
  firstLoad()
  assert.equal(h.state.cropImage.value, null)
  assert.equal(h.state.modalVisible.value, false)
  assert.deepEqual(h.events, [], 'close event waits for modal exit animation')
  h.state.modalVisible.value = true
  h.state.selectRecentImage('/second.png')
  const secondLoad = h.images[1].onload
  h.unmount()
  secondLoad()
  assert.equal(h.images[1].onload, null)
  assert.equal(h.state.cropImage.value, null)
})

test('unreadable or zero-sized images keep the picker usable and report an error', t => {
  const h = fixture(t)
  h.state.selectRecentImage('/broken.png')
  h.images[0].onerror()
  assert.match(h.state.selectionError.value, /图片加载失败/)
  h.state.selectRecentImage('/invalid.png')
  h.images[1].naturalWidth = 0
  h.images[1].onload()
  assert.equal(h.state.cropImage.value, null)
  assert.match(h.state.selectionError.value, /图片尺寸无效/)
  assert.equal(Number.isFinite(h.state.cropVars.imgScale), true)
  h.state.selectRecentImage('/valid.png')
  h.images[2].onload()
  assert.equal(h.state.selectionError.value, '')
  assert.equal(h.state.cropImage.value, h.images[2])
})

test('late uploaded-file reads cannot replace a newer recent-image choice', t => {
  const h = fixture(t)
  h.state.loadImageFromFile({})
  h.state.selectRecentImage('/recent.png')
  h.images[0].onload()
  h.readers[0].result = 'data:image/png;base64,old'
  h.readers[0].onload()
  assert.equal(h.images.length, 1)
  assert.equal(h.state.cropImage.value, h.images[0])
})

test('unavailable canvas returns to a usable picker instead of throwing out of the modal', async t => {
  const h = fixture(t)
  h.state.selectRecentImage('/angel.png')
  h.images[0].onload()
  h.state.cropCanvas.value = { getContext: () => null }
  await Vue.nextTick()
  assert.equal(h.state.cropImage.value, null)
  assert.match(h.state.selectionError.value, /无法打开图片画布/)
})

test('selected angel image saves a centered 512px crop through the supplied handler', async t => {
  const saved = []
  const h = fixture(t, { saveHandler: async base64 => saved.push(base64) })
  h.state.selectRecentImage('/angel.png')
  h.images[0].onload()
  await h.state.saveCrop()
  assert.deepEqual(h.draws[0], [h.images[0], 500, 0, 1000, 1000, 0, 0, 512, 512])
  assert.deepEqual(saved, ['data:image/png;base64,cropped'])
  assert.equal(h.state.cropSaving.value, false)
  assert.equal(h.state.modalVisible.value, false)
  assert.deepEqual(h.events, [], 'successful save waits for exit animation before emitting close')
})

test('generated angel avatar uses the same crop loader without calling the resident API', async t => {
  const h = fixture(t, { generateHandler: async () => ({ success: true, images: [{ url: '/generated.png' }] }) })
  await h.state.startGenerate()
  assert.equal(h.images[0].src, '/generated.png')
  h.images[0].onload()
  assert.equal(h.state.genStatus.value, 'idle')
  assert.equal(h.state.cropImage.value, h.images[0])
})
