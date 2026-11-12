import test from 'node:test'
import assert from 'node:assert/strict'
import { canSelectMultipleImages, isImageFile, normalizeImage } from '../src/utils/imageUpload.js'

function browser(t, { failRead = false, failDecode = false } = {}) {
  const reads = [], draws = [], encodes = []
  const canvas = { getContext: () => ({ drawImage: (...args) => draws.push(args) }), toDataURL: (...args) => { encodes.push(args); return 'data:image/jpeg;base64,c21hbGw=' } }
  const globals = {
    FileReader: class {
      readAsDataURL(file) {
        reads.push(file)
        if (failRead) return this.onerror()
        this.result = `data:${file.type || 'application/octet-stream'};base64,dGVzdA==`
        this.onload()
      }
    },
    Image: class {
      naturalWidth = 4032
      naturalHeight = 3024
      set src(_) { if (failDecode) this.onerror(); else this.onload() }
    },
    document: { createElement: tag => { assert.equal(tag, 'canvas'); return canvas } },
  }
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name] })
  }
  return { reads, draws, encodes, canvas }
}

test('mobile and Android pickers stay single-select; missing and generic MIME use image extensions', async t => {
  const { encodes } = browser(t)
  assert.equal(canSelectMultipleImages(true), false)
  assert.equal(canSelectMultipleImages(false, {}), false)
  assert.equal(canSelectMultipleImages(false, null), true)
  for (const type of ['', 'application/octet-stream']) {
    const file = { name: 'IMG_1234.JPG', type, size: 1024 }
    assert.equal(isImageFile(file), true)
    assert.equal(await normalizeImage(file), 'data:image/jpeg;base64,dGVzdA==')
  }
  assert.equal(encodes.length, 0, 'small supported images keep their original bytes')
  assert.equal(await normalizeImage({ name: 'photo.gif', type: 'image/gif', size: 1024 }), 'data:image/gif;base64,dGVzdA==')
})

test('large phone photos compress before upload, including originals over the studio 6MB limit', async t => {
  const { canvas, draws, encodes } = browser(t)
  const result = await normalizeImage({ name: 'camera.jpg', type: '', size: 9 * 1024 * 1024 })
  assert.equal(result, 'data:image/jpeg;base64,c21hbGw=')
  assert.equal(canvas.width, 1600)
  assert.equal(canvas.height, 1200)
  assert.equal(draws.length, 1)
  assert.deepEqual(encodes, [['image/jpeg', 0.88]])
})

test('browser-decodable BMP/HEIC images convert to a server-supported JPEG', async t => {
  const { encodes } = browser(t)
  for (const name of ['scan.bmp', 'IMG_1.HEIC']) {
    assert.equal(await normalizeImage({ name, type: '', size: 1024 }), 'data:image/jpeg;base64,c21hbGw=')
  }
  assert.equal(encodes.length, 2)
})

test('non-images and file reading errors fail explicitly', async t => {
  const { reads } = browser(t, { failRead: true })
  await assert.rejects(normalizeImage({ name: 'notes.txt', type: 'text/plain', size: 10 }), /请选择图片/)
  assert.equal(reads.length, 0)
  await assert.rejects(normalizeImage({ name: 'photo.png', type: '', size: 10 }), /图片读取失败/)
})

test('unsupported browser decoding explains how to retry instead of sending an invalid upload', async t => {
  browser(t, { failDecode: true })
  await assert.rejects(normalizeImage({ name: 'photo.heic', type: 'image/heic', size: 1024 }), /转换为 JPG 或 PNG/)
})
