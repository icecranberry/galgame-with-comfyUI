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

  for (const ratio of PHOTO_ASPECT_RATIOS) {
    const dimensions = resizePhoto({ width: 1280, height: 1600, ratio })
    const [widthRatio, heightRatio] = ratio.split(':').map(Number)
    assert.equal(dimensions.width * heightRatio, dimensions.height * widthRatio, `${ratio} must stay exact`)
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
  assert.equal(heightResize.width * 9, heightResize.height * 16)

  assert.deepEqual(resizePhoto({ width: 519, height: 2047, ratio: 'custom' }), { width: 520, height: 2048 })
  assert.equal(clampPhotoDimension(Number.NaN), 512)
})
