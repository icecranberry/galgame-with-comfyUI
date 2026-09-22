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

// 连续抠白：按住左键拖动时，对采样路径上的每个点逐个洪泛，实现「按住不放持续抠白」
const floodAt = state => editorFunction('floodErase', { ERASE_TOLERANCE: 42, ...state })
const sampledPath = state => editorFunction('eraseSamplePoints', { ERASE_BRUSH_STEP: 6, ERASE_BRUSH_MAX_SAMPLES: 32, ...state })

test('floodErase cuts the connected same-color block and skips transparent or out-of-range seeds', () => {
  const flood = floodAt()
  // 三个像素：纯白、接近白、纯红；红色超出容差，必须留下
  const data = new Uint8ClampedArray([250, 250, 250, 255, 240, 238, 236, 255, 200, 40, 40, 255])
  assert.equal(flood(data, 3, 1, 0, 0), true)
  assert.deepEqual([...data], [250, 250, 250, 0, 240, 238, 236, 0, 200, 40, 40, 255])
  // 种子已透明：不重复擦除
  assert.equal(flood(data, 3, 1, 0, 0), false)
  // 越界种子不产生任何副作用
  assert.equal(flood(data, 3, 1, 3, 0), false)
  assert.equal(flood(data, 3, 1, 0, -1), false)
  assert.deepEqual([...data], [250, 250, 250, 0, 240, 238, 236, 0, 200, 40, 40, 255])
})

test('eraseSamplePoints walks the drag path at fixed spacing and caps samples per frame', () => {
  const sample = sampledPath()
  assert.deepEqual(sample({ lastX: 0, lastY: 0 }, 12, 0), [[6, 0], [12, 0]])
  // 原地按下：至少采样当前点，保证按下的那一刻就生效
  assert.deepEqual(sample({ lastX: 5, lastY: 5 }, 5, 5), [[5, 5]])
  // 快速划动：限流后仍覆盖全程，终点必须保留
  const far = sample({ lastX: 0, lastY: 0 }, 600, 0)
  assert.ok(far.length <= 33, `samples = ${far.length}`)
  assert.deepEqual(far[far.length - 1], [600, 0])
  assert.ok(far.every(([x]) => x > 0 && x <= 600))
})

test('one drag history snapshot covers the whole stroke', () => {
  const state = {
    eraseBrush: { recorded: false },
    eraseHistory: [],
    dirty: { value: false },
    canUndo: { value: false },
    compositeFull: () => ({ id: 'before-drag' }),
  }
  const remember = editorFunction('rememberBrushEdit', state)
  remember()
  remember()
  assert.equal(state.eraseHistory.length, 1, '拖动过程中只压一次快照')
  assert.equal(state.eraseBrush.recorded, true)
  assert.equal(state.canUndo.value, true)
  assert.equal(state.eraseHistory[0].image.id, 'before-drag')
  // 没有会话时（例如自动抠白流程）不应写入历史
  state.eraseBrush = null
  remember()
  assert.equal(state.eraseHistory.length, 1)
})

test('drag sessions reuse one visit-mark buffer instead of allocating per sample', () => {
  const flood = floodAt()
  const scratch = { seen: null, stamp: 0 }
  const data = new Uint8ClampedArray([250, 250, 250, 255, 250, 250, 250, 255, 200, 40, 40, 255])
  assert.equal(flood(data, 3, 1, 0, 0, scratch), true)
  const marks = scratch.seen
  assert.equal(marks.length, 3)
  assert.equal(scratch.stamp, 1)
  // 换个种子继续擦：戳记递增，但访问标记缓冲原地复用
  assert.equal(flood(data, 3, 1, 2, 0, scratch), true)
  assert.equal(scratch.seen, marks)
  assert.equal(scratch.stamp, 2)
  // 种子已透明时直接返回，不消耗戳记
  assert.equal(flood(data, 3, 1, 0, 0, scratch), false)
  assert.equal(scratch.stamp, 2)
  // 图像尺寸变化时自动换一块，不会串用上一张图的标记
  const wide = new Uint8ClampedArray([250, 250, 250, 255, 250, 250, 250, 255, 250, 250, 250, 255, 250, 250, 250, 255])
  assert.equal(flood(wide, 4, 1, 0, 0, scratch), true)
  assert.equal(scratch.seen.length, 4)
  assert.notEqual(scratch.seen, marks)
  assert.equal(scratch.stamp, 3)
})

test('holding the pointer keeps erasing along the drag with a single undo step', () => {
  const source = new Uint8ClampedArray([250, 250, 250, 255, 250, 250, 250, 255, 200, 40, 40, 255])
  const makeWorkCanvas = () => {
    const buffer = new Uint8ClampedArray(source.length)
    return {
      width: 3, height: 1, pixels: buffer,
      getContext: () => ({
        drawImage: src => { buffer.set(src.pixels) },
        getImageData: () => ({ data: buffer.slice(), width: 3, height: 1 }),
        putImageData: imageData => { buffer.set(imageData.data) },
      }),
    }
  }
  const frames = []
  const state = {
    ERASE_TOLERANCE: 42, ERASE_BRUSH_STEP: 6, ERASE_BRUSH_MAX_SAMPLES: 32,
    img: { width: 3, height: 1, pixels: source },
    eraseBrush: null, eraseHistory: [], imageVersion: 0,
    editLocked: { value: false }, dirty: { value: false }, canUndo: { value: false }, savedTip: { value: '' },
    document: { createElement: () => makeWorkCanvas() },
    requestAnimationFrame: cb => frames.push(cb), cancelAnimationFrame: () => {}, setTimeout: () => {},
    compositeFull: () => ({ id: 'before-drag' }), clearGaps: () => {}, draw: () => {},
  }
  for (const name of ['beginEraseBrush', 'queueErasePoint', 'finishEraseBrush', 'runEraseAt', 'eraseSamplePoints', 'floodErase', 'rememberBrushEdit']) {
    state[name] = editorFunction(name, state)
  }
  // 按下：立刻抠掉种子所在的白色块
  state.beginEraseBrush(1, 0, 0)
  assert.deepEqual([...state.img.pixels.slice(0, 8)], [250, 250, 250, 0, 250, 250, 250, 0])
  // 按住不放划过红色像素：帧回调里被采样并抠掉
  state.queueErasePoint(2, 0)
  assert.equal(frames.length, 1, '同一帧内只排一次回调')
  frames.shift()()
  assert.deepEqual([...state.img.pixels], [250, 250, 250, 0, 250, 250, 250, 0, 200, 40, 40, 0])
  // 继续移动：已经透明的区域不会重复抠，也不会再排多余的帧回调
  state.queueErasePoint(1, 0)
  state.queueErasePoint(2, 0)
  assert.equal(frames.length, 1)
  frames.shift()()
  state.finishEraseBrush()
  assert.equal(state.eraseBrush, null)
  assert.equal(state.eraseHistory.length, 1, '整段拖动只留一步撤销')
  assert.equal(state.canUndo.value, true)
  // 只统计真正改了像素的两帧：最后一次划过已透明区域不算一次修改
  assert.equal(state.imageVersion, 2)
  assert.equal(state.savedTip.value, '', '抠到东西就不提示')
  // 按在已经透明的区域：整段都没抠掉像素，松手时提示一次
  state.beginEraseBrush(1, 0, 0)
  state.finishEraseBrush()
  assert.match(state.savedTip.value, /透明/)
  assert.equal(state.eraseHistory.length, 1, '没抠到东西就不该多压一步撤销')
})
