import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { playNewspaperFlipSound } from '../src/utils/newspaperSound.js'

// 《邻舍日报》翻报音效的源码级契约：现场合成纸声、失败静默、打开即响。
const SOUND = fileURLToPath(new URL('../src/utils/newspaperSound.js', import.meta.url))
const MODAL = fileURLToPath(new URL('../src/components/NewspaperModal.vue', import.meta.url))
const sound = readFileSync(SOUND, 'utf8')
const modal = readFileSync(MODAL, 'utf8')

test('没有 Web Audio 的环境（Node / 旧浏览器）静默，不抛错', () => {
  // Node 里既没有 window 也没有 AudioContext，函数必须自己吞掉
  assert.doesNotThrow(() => playNewspaperFlipSound())
})

test('翻报音效是现场合成的纸声，不引外链音频', () => {
  assert.match(sound, /export function playNewspaperFlipSound/, '要有翻报音效出口')
  assert.match(sound, /createBuffer\(/, '要现场合成噪声缓冲')
  assert.match(sound, /type = 'bandpass'/, '要用带通把白噪滤成纸声')
  assert.doesNotMatch(sound, /\.mp3|\.wav|new Audio/, '不引外链音频文件')
  assert.match(sound, /document\.hidden/, '页面在后台时不响')
  assert.match(sound, /try \{[\s\S]*catch/, '失败静默兜底')
})

test('翻页声要有分量：低频层撑重量，默认音量不轻', () => {
  const vol = Number((sound.match(/volume = ([\d.]+)/) || [])[1])
  assert.ok(Number.isFinite(vol) && vol >= 0.12, `默认音量 ${vol} 太轻`)
  assert.match(sound, /freq: [1-9]\d\d,/, '要有 1kHz 以下的低频层')
})

test('打开日报的瞬间触发翻报音效', () => {
  assert.match(modal, /import \{ playNewspaperFlipSound \} from '\.\.\/utils\/newspaperSound\.js'/, '要引入翻报音效')
  assert.match(modal, /watch\(visible, async \(open\) => \{[\s\S]{0,200}playNewspaperFlipSound\(\)/,
    '打开即响，跟浮现动画同拍')
})