import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWhiteGapStrengthMap, applyWhiteGapStrength, normalizeWhiteGapStrength, whiteGapRegionThreshold } from '../src/town/whiteGapDetection.js'

function fixture(width = 120, height = 180) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  const rect = (x, y, w, h, color) => {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) pixels.set(color, (row * width + col) * 4)
  }
  return { pixels, width, height, rect, at: (x, y) => y * width + x,
    scan: () => buildWhiteGapStrengthMap(pixels, width, height) }
}

function portraitFixture() {
  const f = fixture()
  f.rect(10, 10, 100, 160, [70, 55, 80, 255])
  // Colours and gap proportions sampled from asset 433 (the reported wolf portrait).
  f.rect(80, 24, 14, 29, [255, 255, 254, 255])
  f.rect(85, 65, 16, 35, [254, 254, 255, 255])
  f.rect(85, 115, 20, 28, [254, 254, 254, 255])
  f.rect(35, 40, 16, 20, [254, 245, 233, 255])
  f.rect(35, 75, 11, 17, [255, 253, 237, 255])
  f.rect(35, 110, 15, 25, [225, 168, 156, 255])
  return f
}

test('strength selects white regions by size: big blocks go first, specks only at the top', () => {
  const f = fixture(120, 180)
  f.rect(10, 10, 100, 160, [70, 55, 80, 255])
  f.rect(20, 20, 40, 40, [255, 255, 255, 255]) // 1600 px pocket.
  f.rect(80, 30, 10, 10, [254, 254, 253, 255]) // 100 px fragment.
  f.rect(40, 100, 3, 3, [253, 254, 255, 255]) // 9 px speck.
  f.rect(90, 150, 1, 1, [255, 255, 252, 255]) // Lone pixel.
  const map = f.scan()
  const pocket = map.thresholds[f.at(30, 30)], fragment = map.thresholds[f.at(85, 35)]
  const speck = map.thresholds[f.at(41, 101)], lone = map.thresholds[f.at(90, 150)]
  assert.ok(pocket < fragment && fragment < speck && speck < lone, `${pocket} ${fragment} ${speck} ${lone}`)
  const mid = applyWhiteGapStrength(f.pixels, map.thresholds, fragment)
  assert.equal(mid[f.at(30, 30) * 4 + 3], 0, 'the pocket is already gone at the fragment threshold')
  assert.equal(mid[f.at(41, 101) * 4 + 3], 255, 'the speck survives intermediate strengths')
  // A region is atomic: every pixel of the fragment leaves together.
  for (let y = 30; y < 40; y++) for (let x = 80; x < 90; x++) assert.equal(mid[f.at(x, y) * 4 + 3], 0)
  const fine = applyWhiteGapStrength(f.pixels, map.thresholds, speck)
  for (let y = 100; y < 103; y++) for (let x = 40; x < 43; x++) assert.equal(fine[f.at(x, y) * 4 + 3], 0)
  assert.equal(applyWhiteGapStrength(f.pixels, map.thresholds, lone)[f.at(90, 150) * 4 + 3], 0)
  assert.equal(applyWhiteGapStrength(f.pixels, map.thresholds, lone - 1)[f.at(90, 150) * 4 + 3], 255)
})

test('whiteGapRegionThreshold is log-scaled: whole-canvas blocks at 1, lone pixels at 100', () => {
  assert.equal(whiteGapRegionThreshold(1, 100), 100)
  assert.equal(whiteGapRegionThreshold(100, 100), 1)
  assert.equal(whiteGapRegionThreshold(10, 100), 50) // ln10 / ln100 = 1/2.
  let previous = 101
  for (let area = 1; area <= 100; area++) {
    const value = whiteGapRegionThreshold(area, 100)
    assert.ok(value >= 1 && value <= 100)
    assert.ok(value <= previous, `area ${area} must not need more strength`)
    previous = value
  }
})

test('the colour test is fixed: darkest channel within 5 of white qualifies, darker tints never do', () => {
  const f = fixture(8, 1)
  for (let i = 0; i < 8; i++) f.rect(i, 0, 1, 1, [255 - i, 255 - i, 255 - i, 255])
  const map = f.scan()
  for (let i = 0; i < 6; i++) assert.ok(map.thresholds[f.at(i, 0)] > 0)
  assert.equal(map.thresholds[f.at(6, 0)], 0) // RGB 249 stays protected at any strength.
  assert.equal(map.thresholds[f.at(7, 0)], 0)
  assert.equal(map.pixelCounts[100], 6)
})

test('reported portrait: near-white hair gaps go whole, cream highlights and skin never enter the mask', () => {
  const f = portraitFixture()
  const map = f.scan()
  for (const [x, y] of [[85, 30], [90, 70], [90, 120]]) assert.ok(map.thresholds[f.at(x, y)] > 0)
  for (const [x, y] of [[40, 45], [40, 80], [40, 120], [40, 121]]) assert.equal(map.thresholds[f.at(x, y)], 0)
  const max = applyWhiteGapStrength(f.pixels, map.thresholds, 100)
  for (const [x, y] of [[40, 45], [40, 80], [40, 120], [40, 121]]) {
    assert.deepEqual(max.slice(f.at(x, y) * 4, f.at(x, y) * 4 + 4), f.pixels.slice(f.at(x, y) * 4, f.at(x, y) * 4 + 4))
  }
})

test('equal areas activate together regardless of shape, position or contact with transparency', () => {
  const f = fixture()
  f.rect(10, 10, 100, 160, [60, 50, 40, 255])
  const white = [254, 252, 251, 255]
  f.rect(30, 40, 50, 40, white) // 2000 px broad enclosed block.
  f.rect(14, 100, 2, 40, white) // 80 px thin enclosed strip.
  f.rect(100, 30, 8, 10, white) // 80 px compact block.
  f.rect(104, 140, 8, 10, white) // 80 px open gap touching transparency.
  f.rect(35, 110, 10, 2, white) // 20 px horizontal sliver.
  f.rect(0, 5, 2, 5, white) // 10 px at the canvas edge.
  const map = f.scan()
  const broad = map.thresholds[f.at(35, 45)]
  const thin = map.thresholds[f.at(14, 110)], compact = map.thresholds[f.at(103, 34)]
  const open = map.thresholds[f.at(106, 145)]
  assert.equal(thin, compact)
  assert.equal(compact, open, 'transparency next to a region changes nothing')
  const sliver = map.thresholds[f.at(39, 110)], edge = map.thresholds[f.at(0, 6)]
  assert.ok(broad < sliver && sliver < edge, `${broad} ${sliver} ${edge}`)
  assert.ok(edge > 0 && edge < 100)
})

test('gray antialiasing never joins or blocks removal of the white core it touches', () => {
  const f = fixture()
  f.rect(10, 10, 100, 160, [60, 50, 40, 255])
  f.rect(90, 40, 20, 70, [215, 215, 215, 255]) // Connects to outside transparency.
  f.rect(95, 45, 6, 55, [255, 255, 254, 255])
  const map = f.scan()
  const threshold = map.thresholds[f.at(97, 60)]
  const cut = applyWhiteGapStrength(f.pixels, map.thresholds, threshold)
  assert.equal(cut[f.at(97, 60) * 4 + 3], 0)
  assert.equal(cut[f.at(91, 60) * 4 + 3], 255, 'gray stays at the region threshold')
  const strongest = applyWhiteGapStrength(f.pixels, map.thresholds, 100)
  assert.equal(strongest[f.at(91, 60) * 4 + 3], 255)
  assert.equal(strongest[f.at(89, 60) * 4 + 3], 255)
})

test('opaque outer backgrounds activate at the bottom of the slider; already-transparent RGB never affects removal', () => {
  const f = fixture(20, 20)
  f.rect(0, 0, 20, 20, [255, 255, 255, 255])
  f.rect(8, 8, 4, 4, [50, 50, 50, 255])
  f.rect(1, 1, 3, 3, [0, 0, 0, 0])
  const map = f.scan()
  f.rect(1, 1, 3, 3, [255, 255, 255, 0])
  assert.deepEqual(f.scan().thresholds, map.thresholds)
  assert.equal(map.thresholds[f.at(0, 0)], 1, 'a near-full-canvas white block needs almost no strength')
  assert.equal(map.pixelCounts[1], 375)
  const result = applyWhiteGapStrength(f.pixels, map.thresholds, 1)
  assert.equal(result[f.at(0, 0) * 4 + 3], 0)
  assert.equal(result[f.at(8, 8) * 4 + 3], 255)
})

test('colourful skin, coloured highlights and dark outlines remain untouched even at maximum strength', () => {
  const f = fixture(4, 1)
  const colours = [[225, 168, 156, 255], [255, 219, 191, 255], [208, 248, 248, 255], [70, 55, 80, 255]]
  colours.forEach((color, i) => f.rect(i, 0, 1, 1, color))
  const map = f.scan()
  assert.equal(map.pixelCounts[100], 0)
  assert.deepEqual(applyWhiteGapStrength(f.pixels, map.thresholds, 100), f.pixels)
})

test('all strength steps are monotone, counts match removal, and every marker anchors to a selected pixel', () => {
  const f = portraitFixture()
  const before = f.pixels.slice(), map = f.scan()
  let previous = f.pixels
  for (let strength = 0; strength <= 100; strength++) {
    const current = applyWhiteGapStrength(f.pixels, map.thresholds, strength)
    let removed = 0
    for (let i = 0; i < map.thresholds.length; i++) {
      assert.ok(current[i * 4 + 3] <= previous[i * 4 + 3])
      if (current[i * 4 + 3] < f.pixels[i * 4 + 3]) removed++
    }
    assert.equal(map.pixelCounts[strength], removed)
    const visible = map.regions.filter(r => r.firstStrength <= strength)
    assert.equal(map.regionCounts[strength], visible.length)
    for (const region of visible) {
      const pixel = f.at(Math.floor(region.anchor.x), Math.floor(region.anchor.y))
      assert.ok(current[pixel * 4 + 3] < f.pixels[pixel * 4 + 3])
      assert.ok(f.pixels[pixel * 4 + 3])
    }
    previous = current
  }
  assert.deepEqual(f.pixels, before)
})

test('lowering strength restores the original alpha and never accumulates previous removal', () => {
  const f = fixture(6, 1)
  const colours = [[255, 255, 255, 1], [254, 254, 254, 120], [253, 253, 253, 190], [250, 250, 250, 255], [255, 255, 255, 0], [249, 249, 249, 255]]
  colours.forEach((color, i) => f.rect(i, 0, 1, 1, color))
  const before = f.pixels.slice(), map = f.scan()
  assert.equal(map.pixelCounts[100], 4) // One connected region; alpha 0 and RGB 249 stay outside it.
  const high = applyWhiteGapStrength(f.pixels, map.thresholds, 100)
  for (const o of [0, 4, 8, 12]) {
    assert.equal(high[o + 3], 0)
    assert.deepEqual(high.slice(o, o + 3), before.slice(o, o + 3), 'RGB must survive')
  }
  assert.equal(high[23], 255)
  assert.deepEqual(applyWhiteGapStrength(f.pixels, map.thresholds, 0), before)
  assert.deepEqual(f.pixels, before)
})

test('selected regions cut every source alpha to 0 while RGB and unselected pixels stay intact', () => {
  const f = fixture(12, 3)
  f.rect(0, 0, 12, 3, [40, 40, 40, 255])
  for (let x = 0; x < 6; x++) for (const [row, alpha] of [[0, 1], [1, 128], [2, 255]]) f.rect(x, row, 1, 1, [255, 255, 255, alpha])
  const map = f.scan()
  const threshold = map.thresholds[f.at(0, 0)]
  const cut = applyWhiteGapStrength(f.pixels, map.thresholds, threshold)
  for (let x = 0; x < 6; x++) for (const row of [0, 1, 2]) {
    const o = f.at(x, row) * 4
    assert.equal(cut[o + 3], 0)
    assert.deepEqual(cut.slice(o, o + 3), f.pixels.slice(o, o + 3))
  }
  for (let x = 6; x < 12; x++) for (const row of [0, 1, 2]) assert.equal(cut[f.at(x, row) * 4 + 3], 255)
  assert.deepEqual(applyWhiteGapStrength(f.pixels, map.thresholds, threshold - 1), f.pixels)
})

test('limiting display markers never hides white pixels from the mask, including tiny scattered gaps', () => {
  const f = fixture(70, 70)
  f.rect(0, 0, 70, 70, [40, 40, 40, 255])
  for (let y = 1; y < 70; y += 2) for (let x = 1; x < 70; x += 2) f.rect(x, y, 1, 1, [255, 255, 255, 255])
  const map = f.scan()
  assert.equal(map.regions.length, 500)
  assert.equal(map.omitted, 725)
  assert.equal(map.pixelCounts[100], 1225)
  assert.equal(map.regionCounts[100], 1225)
  assert.equal(map.thresholds[f.at(69, 69)], 100, 'lone specks wait for the very top of the slider')

  // Display capping is a hint budget only: counts still cover every region.
  for (let y = 1; y < 70; y += 2) for (let x = 1; x < 70; x += 2) f.rect(x, y, 1, 1, [251, 251, 251, 255])
  f.rect(69, 69, 1, 1, [255, 255, 255, 255])
  const capped = f.scan()
  assert.equal(capped.regions.length + capped.omitted, 1225)
  assert.equal(capped.pixelCounts[100], 1225)
})

test('transparent/white-only inputs and invalid dimensions are handled explicitly', () => {
  const f = fixture(20, 20)
  assert.equal(f.scan().pixelCounts[100], 0)
  f.rect(0, 0, 20, 20, [255, 255, 255, 255])
  assert.equal(f.scan().pixelCounts[1], 400)
  for (const [w, h] of [[0, 0], [1.5, 2], [400, 400], [20_000, 20_000]]) {
    assert.throws(() => buildWhiteGapStrengthMap(f.pixels, w, h), /尺寸/)
  }
  assert.throws(() => applyWhiteGapStrength(f.pixels, new Uint8Array(2), 50), /尺寸/)
})

test('strength values are bounded and invalid values preserve the image', () => {
  assert.equal(normalizeWhiteGapStrength('35'), 35)
  assert.equal(normalizeWhiteGapStrength(35.7), 36)
  assert.equal(normalizeWhiteGapStrength(-20), 0)
  assert.equal(normalizeWhiteGapStrength(120), 100)
  const f = portraitFixture(), map = f.scan()
  for (const value of [NaN, Infinity, undefined, 'invalid']) {
    assert.deepEqual(applyWhiteGapStrength(f.pixels, map.thresholds, value), f.pixels)
  }
})
