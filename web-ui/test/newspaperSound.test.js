import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { playNewspaperFlipSound } from '../src/utils/newspaperSound.js'
import { playPageFlipSound } from '../src/utils/pageFlipSound.js'

const modal = readFileSync(new URL('../src/components/NewspaperModal.vue', import.meta.url), 'utf8')

test('无浏览器环境静默，日报与日记共用播放器入口', () => {
  assert.equal(playNewspaperFlipSound, playPageFlipSound)
  assert.doesNotThrow(() => playNewspaperFlipSound())
})

test('本地 MP3 播放：后台静音、限流、复用播放器、播放拒绝不影响阅读', async (t) => {
  let now = 1000
  let created = 0
  let plays = 0
  let instance
  t.mock.method(Date, 'now', () => now)
  for (const key of ['window', 'document', 'Audio']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    })
  }
  globalThis.window = {}
  globalThis.document = { hidden: true }
  globalThis.Audio = class {
    constructor(url) {
      created++
      instance = this
      this.readyState = 0
      this.position = 0
      assert.ok(existsSync(new URL(url)), '音频随应用打包，无外部请求依赖')
      assert.match(url, /page-flip\.wav$/)
    }
    set currentTime(value) {
      if (!this.readyState) throw new Error('媒体元数据尚未加载，不能 seek')
      this.position = value
    }
    get currentTime() { return this.position }
    play() { plays++; return Promise.reject(new Error('播放被浏览器阻止')) }
  }
  playPageFlipSound()
  assert.equal(created, 0)
  document.hidden = false
  playPageFlipSound()
  assert.equal(plays, 1)
  assert.equal(instance.volume, 0.45)
  playPageFlipSound()
  assert.equal(plays, 1, '快速重复操作不叠音')
  now += 200
  instance.readyState = 4
  instance.currentTime = 0.3
  playPageFlipSound({ volume: 5 })
  assert.equal(created, 1)
  assert.equal(plays, 2)
  assert.equal(instance.currentTime, 0)
  assert.equal(instance.volume, 1)
  await new Promise(resolve => setImmediate(resolve))
})

test('打开日报触发翻页声，点击详情不播放', () => {
  assert.match(modal, /watch\(visible, async \(open\) => \{[\s\S]{0,200}playNewspaperFlipSound\(\)/)
  assert.doesNotMatch(modal, /function openDetail\(d\) \{[^}]*playNewspaperFlipSound\(\)/)
})
