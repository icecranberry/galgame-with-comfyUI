import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'
import { applyWhiteGapStrength, normalizeWhiteGapStrength } from '../src/town/whiteGapDetection.js'

const script = parseSfc(readFileSync(new URL('../src/components/town/TownImageEditor.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const nodes = parseJs(script, { sourceType: 'module' }).program.body
function editorFunction(name, state) {
  const node = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === name)
  return new Function('state', `with (state) { return (${script.slice(node.start, node.end)}) }`)(state)
}
const crop = state => editorFunction('confirmCrop', state)

function markingFixture() {
  const strokes = []
  const makeContext = () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(data) { this.pixels = data.data.slice() },
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  })
  const state = {
    gapSession: { value: {
      width: 3, height: 1, thresholds: new Uint8Array([17, 17, 40]),
      regions: [
        { bounds: { x: 0, y: 0, w: 2, h: 1 }, firstStrength: 17, anchor: { x: 0.5, y: 0.5 } },
        { bounds: { x: 2, y: 0, w: 1, h: 1 }, firstStrength: 40, anchor: { x: 2.5, y: 0.5 } },
      ],
    } },
    gapStrength: { value: 18 }, gapPixelCount: { value: 2 }, frameEl: { value: {} },
    gapOverlay: null, gapPreviewMask: null, gapBoundary: null,
    document: { createElement: () => { const context = makeContext(); return { getContext: () => context } } },
    Path2D: class { moveTo() {} lineTo() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#ff5599' }),
    displayScale: () => ({ x: 1 }), view: { scale: 1 }, draw() {},
    normalizeWhiteGapStrength,
    ctx: {
      save() {}, restore() {}, drawImage() {}, beginPath() {}, arc() {},
      stroke(path) { strokes.push({ kind: path ? 'contour' : 'circle', opacity: this.globalAlpha }) },
    },
  }
  return { state, strokes, paint: () => {
    strokes.length = 0
    editorFunction('rebuildGapOverlay', state)()
    editorFunction('drawGapMarkers', state)()
  } }
}

test('default pink preview, contours, and small-gap circles reflect whole-region selection', () => {
  const f = markingFixture()
  f.state.gapStrength.value = 18
  f.state.gapPixelCount.value = 2
  f.paint()
  const mask = f.state.gapPreviewMask.getContext('2d').pixels
  const marked = f.state.gapOverlay.getContext('2d').pixels
  assert.equal(mask[3], 255, 'selected regions preview as a binary cutout')
  assert.equal(marked[3], 255)
  assert.equal(marked[7], 255)
  assert.equal(marked[11], 0, 'regions above the slider stay unmarked')
  assert.deepEqual(f.strokes.map(s => s.kind), ['contour', 'contour', 'contour', 'circle', 'circle', 'circle'])
  assert.ok(f.strokes.every(s => s.opacity === 1))
  // Raising strength past the second region's threshold marks it too, with its own circle.
  f.state.gapStrength.value = 40
  f.state.gapPixelCount.value = 3
  f.paint()
  assert.equal(f.state.gapPreviewMask.getContext('2d').pixels[11], 255)
  assert.deepEqual(f.strokes.map(s => s.kind),
    ['contour', 'contour', 'contour', 'circle', 'circle', 'circle', 'circle', 'circle', 'circle'])
  f.state.gapStrength.value = 0
  f.state.gapPixelCount.value = 0
  f.paint()
  assert.ok(f.state.gapOverlay.getContext('2d').pixels.every(value => value === 0))
  assert.deepEqual(f.strokes, [])
})

test('wheel zoom keeps the point under the cursor fixed', () => {
  const state = {
    img: { width: 900, height: 1600 }, view: { scale: 1, x: 0, y: 0 },
    canvasEl: { value: { offsetWidth: 960, offsetHeight: 400, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 400 }) } },
    frameEl: { value: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
  }
  const wheel = editorFunction('onWheel', state)
  // contain: baseW 225×baseH 400，水平居中偏移 367.5；锚点 (450,100) 在位图内
  wheel({ clientX: 450, clientY: 100, deltaY: -1 })
  assert.equal(state.view.scale, 1.1)
  assert.ok(Math.abs(state.view.x + 45) < 1e-9, `view.x = ${state.view.x}`)
  assert.ok(Math.abs(state.view.y + 10) < 1e-9, `view.y = ${state.view.y}`)
  // 缩回 1：同一锚点必须精确回到原位（旧实现每格漂移 letterbox 偏移 × Δscale）
  wheel({ clientX: 450, clientY: 100, deltaY: 1 })
  assert.equal(state.view.scale, 1)
  assert.ok(Math.abs(state.view.x) < 1e-9, `view.x = ${state.view.x}`)
  assert.ok(Math.abs(state.view.y) < 1e-9, `view.y = ${state.view.y}`)
  // 已在最小时继续缩小：不动
  wheel({ clientX: 450, clientY: 100, deltaY: 1 })
  assert.equal(state.view.scale, 1)
})

test('failed save of white-gap edits stops cropping and keeps the edits available for retry', async () => {
  const calls = []
  const state = {
    cropRect: { value: { x: 10, y: 20, w: 30, h: 40 } }, img: { width: 100, height: 160 },
    cropping: { value: false }, dirty: { value: true }, props: { assetId: 123 },
    save: async () => { calls.push('save'); return false },
    api: { cropTownAsset: async () => { calls.push('crop') } },
    loadImage: async () => { calls.push('reload') }, freshSrc: () => 'image.png',
    resetCrop: () => {}, emit: () => { calls.push('cropped') },
  }
  await crop(state)()
  assert.deepEqual(calls, ['save'])
  assert.equal(state.dirty.value, true)
  assert.equal(state.cropping.value, false)
  calls.length = 0
  state.save = async () => { calls.push('save'); return true }
  await crop(state)()
  assert.deepEqual(calls, ['save', 'crop', 'reload', 'cropped'])
  assert.equal(state.cropping.value, false)
})

function saveFixture() {
  // Working pixels and preview decoration are deliberately distinct.
  const source = new Uint8ClampedArray([254, 254, 254, 190, 70, 55, 80, 255, 250, 250, 250, 255])
  let exported
  const state = {
    gapOpen: { value: true }, gapPixelCount: { value: 1 }, gapStrength: { value: 35 },
    gapSession: { value: { thresholds: new Uint8Array([17, 0, 40]) } }, gapPreview: { value: false },
    dirty: { value: false }, saving: { value: false }, detecting: { value: false }, loaded: { value: true },
    imageVersion: 1, img: { pixels: source }, savedTip: { value: '' }, eraseHistory: ['manual edit'], canUndo: { value: true },
    props: { assetId: 123 }, applyWhiteGapStrength,
    compositeFull: () => {
      const data = { data: source.slice() }
      return { width: 3, height: 1, getContext: () => ({ getImageData: () => data, putImageData: () => {} }),
        toDataURL: () => { exported = data.data.slice(); return 'data:image/png;base64,test' } }
    },
    clearGaps: () => { state.gapSession.value = null }, draw: () => {}, emit: () => {}, setTimeout: () => {},
    api: { saveTownAssetImage: async () => {} },
  }
  return { state, source, exported: () => exported, save: () => editorFunction('save', state)() }
}

test('apply-and-save uses slider strength directly without a separate apply or prior dirty edit', async () => {
  const f = saveFixture()
  const before = f.source.slice()
  assert.equal(await f.save(), true)
  assert.deepEqual(f.exported(), new Uint8ClampedArray([254, 254, 254, 0, 70, 55, 80, 255, 250, 250, 250, 255]))
  assert.deepEqual(f.source, before)
  assert.equal(f.state.gapOpen.value, false)
  assert.equal(f.state.gapSession.value, null)
  assert.equal(f.state.saving.value, false)
})

test('saving cuts whole regions only: strength below a region threshold leaves it intact', async () => {
  const f = saveFixture()
  f.state.gapStrength.value = 17
  assert.equal(await f.save(), true)
  assert.equal(f.exported()[3], 0)
  assert.equal(f.exported()[11], 255)
  const higher = saveFixture()
  higher.state.gapStrength.value = 40
  assert.equal(await higher.save(), true)
  assert.equal(higher.exported()[3], 0)
  assert.equal(higher.exported()[11], 0)
})

test('failed apply-and-save preserves the source, slider preview, and manual undo history for retry', async () => {
  const f = saveFixture()
  const workingImage = f.state.img
  f.state.api.saveTownAssetImage = async () => { throw new Error('network failure') }
  assert.equal(await f.save(), false)
  assert.equal(f.state.img, workingImage)
  assert.equal(f.state.imageVersion, 1)
  assert.equal(f.state.gapOpen.value, true)
  assert.equal(f.state.gapStrength.value, 35)
  assert.ok(f.state.gapSession.value)
  assert.deepEqual(f.state.eraseHistory, ['manual edit'])
  assert.equal(f.state.saving.value, false)
  assert.match(f.state.savedTip.value, /保存失败/)
  // Lower strength before retrying; old removal must not accumulate.
  f.state.gapStrength.value = 0
  f.state.gapPixelCount.value = 0
  f.state.dirty.value = true
  f.state.api.saveTownAssetImage = async () => {}
  assert.equal(await f.save(), true)
  assert.deepEqual(f.exported(), f.source)
})
