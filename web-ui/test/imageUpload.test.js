import test from 'node:test'
import assert from 'node:assert/strict'
import { canSelectMultipleImages, isImageFile } from '../src/utils/imageUpload.js'

test('phone and Android shell pickers use single selection, including wide-screen Android shells', () => {
  assert.equal(canSelectMultipleImages(true, undefined), false)
  assert.equal(canSelectMultipleImages(false, { saveImage() {} }), false)
  assert.equal(canSelectMultipleImages(true, { saveImage() {} }), false)
  assert.equal(canSelectMultipleImages(false, undefined), true)
})

test('Android photos with missing or generic MIME remain usable through their filename', () => {
  assert.equal(isImageFile({ name: 'IMG_0001.JPG', type: '' }), true)
  assert.equal(isImageFile({ name: 'photo.webp', type: 'application/octet-stream' }), true)
  assert.equal(isImageFile({ name: 'photo.heic' }), true)
  assert.equal(isImageFile({ name: 'clipboard', type: 'image/png' }), true)
})

test('empty selections and non-image files do not enter the image queue', () => {
  assert.equal(isImageFile(null), false)
  assert.equal(isImageFile({ name: 'notes.txt', type: 'text/plain' }), false)
  assert.equal(isImageFile({ name: 'photo.png.txt', type: '' }), false)
  assert.equal(isImageFile({ name: '', type: 'application/octet-stream' }), false)
})
