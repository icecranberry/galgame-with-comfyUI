import test from 'node:test'
import assert from 'node:assert/strict'
import { PHOTO_ASPECT_RATIOS, DEFAULT_PHOTO_STUDIO_DIMENSIONS, initialPhotoStudioFrame, clampPhotoDimension, inferPhotoAspectRatio, photoDimensionControls, resizePhoto } from '../src/utils/photoStudioDimensions.js'

test('new photo-studio sessions use the requested portrait default and every supported ratio', () => {
  assert.deepEqual(DEFAULT_PHOTO_STUDIO_DIMENSIONS, { width: 1152, height: 2048 })
  assert.deepEqual(initialPhotoStudioFrame(), { width: 1152, height: 2048, aspectRatio: '9:16' })
  assert.deepEqual(initialPhotoStudioFrame({ width: 1200, height: 1600, aspectRatio: '3:4' }), initialPhotoStudioFrame())
  assert.deepEqual(initialPhotoStudioFrame({ width: 1200, height: 1600, aspectRatio: '3:4', frameVersion: 2 }), { width: 1200, height: 1600, aspectRatio: '3:4' })
  assert.deepEqual(initialPhotoStudioFrame({ width: 1288, height: 1736, aspectRatio: 'custom' }), { width: 1288, height: 1736, aspectRatio: 'custom' })
  assert.deepEqual({ width: 1200, height: 1600 }, resizePhoto({ width: 1200, height: 1600, ratio: '3:4' }))
  assert.equal(inferPhotoAspectRatio(1200, 1600), '3:4')
  assert.equal(inferPhotoAspectRatio(1200, 1700), 'custom')
  assert.ok(PHOTO_ASPECT_RATIOS.includes('1:1'))
  assert.deepEqual(initialPhotoStudioFrame({ width: 512, height: 512, aspectRatio: '1:1', frameVersion: 2 }), { width: 512, height: 512, aspectRatio: '1:1' })

  for (const ratio of PHOTO_ASPECT_RATIOS) {
    const dimensions = resizePhoto({ width: 1280, height: 1600, ratio })
    const [widthRatio, heightRatio] = ratio.split(':').map(Number)
    assert.ok(Math.abs(dimensions.height - dimensions.width * heightRatio / widthRatio) <= 4, `${ratio} rounds the linked axis to the nearest 8px`)
    assert.ok(dimensions.width >= 512 && dimensions.width <= 2048)
    assert.ok(dimensions.height >= 512 && dimensions.height <= 2048)
    assert.equal(dimensions.width % 8, 0)
    assert.equal(dimensions.height % 8, 0)

    const controls = photoDimensionControls(ratio)
    assert.ok(controls.width.min <= dimensions.width && controls.width.max >= dimensions.width)
    assert.ok(controls.height.min <= dimensions.height && controls.height.max >= dimensions.height)
  }
})

test('resizing from either slider preserves the ratio and custom dimensions remain independent', () => {
  const widthResize = resizePhoto({ width: 1440, height: 1600, ratio: '3:4', anchor: 'width' })
  assert.deepEqual(widthResize, { width: 1440, height: 1920 })
  const heightResize = resizePhoto({ width: 1440, height: 2000, ratio: '16:9', anchor: 'height' })
  assert.deepEqual(heightResize, { width: 2048, height: 1152 })

  assert.deepEqual(resizePhoto({ width: 519, height: 2047, ratio: 'custom' }), { width: 520, height: 2048 })
  assert.equal(clampPhotoDimension(Number.NaN), 512)
})

test('every ratio reaches a 512px short edge from either slider without exceeding workflow limits', () => {
  for (const ratio of [...PHOTO_ASPECT_RATIOS, 'custom']) {
    assert.deepEqual(photoDimensionControls(ratio), {
      width: { min: 512, max: 2048, step: 8 },
      height: { min: 512, max: 2048, step: 8 },
    })
    for (const anchor of ['width', 'height']) {
      const smallest = resizePhoto({ width: 512, height: 512, ratio, anchor })
      assert.equal(Math.min(smallest.width, smallest.height), 512, `${ratio}, ${anchor}`)
      assert.deepEqual(initialPhotoStudioFrame({ ...smallest, aspectRatio: ratio, frameVersion: 2 }), { ...smallest, aspectRatio: ratio })
      if (ratio !== 'custom') assert.equal(inferPhotoAspectRatio(smallest.width, smallest.height), ratio)
      for (let value = 512; value <= 2048; value += 8) {
        const resized = resizePhoto({ width: value, height: value, ratio, anchor })
        assert.deepEqual(initialPhotoStudioFrame({ ...resized, aspectRatio: ratio, frameVersion: 2 }), { ...resized, aspectRatio: ratio }, `${ratio}, ${anchor}, ${value} survives remounting`)
        for (const dimension of Object.values(resized)) {
          assert.ok(dimension >= 512 && dimension <= 2048, `${ratio}, ${anchor}, ${value}`)
          assert.equal(dimension % 8, 0)
        }
      }
    }
  }
  assert.deepEqual(resizePhoto({ width: 512, height: 2048, ratio: '9:16' }), { width: 512, height: 912 })
  assert.deepEqual(resizePhoto({ width: 2048, height: 512, ratio: '16:9', anchor: 'height' }), { width: 912, height: 512 })
})
