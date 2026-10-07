import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitDiaryParagraphs, buildDiaryFlow } from '../src/utils/diaryFlow.js'

const order = (flow) => flow.map(b => (b.type === 'text' ? `P${b.text}` : `I${b.slot}`))

test('splitDiaryParagraphs 按空行切段并丢掉空段', () => {
  assert.deepEqual(splitDiaryParagraphs('第一段\n\n第二段\n\n第三段'), ['第一段', '第二段', '第三段'])
  assert.deepEqual(splitDiaryParagraphs('单段'), ['单段'])
  assert.deepEqual(splitDiaryParagraphs('  \n\n  '), [])
  assert.deepEqual(splitDiaryParagraphs(null), [])
  // 段内单个换行不切段
  assert.deepEqual(splitDiaryParagraphs('上句\n下句'), ['上句\n下句'])
})

test('buildDiaryFlow 把三张配图均匀交错进正文（不是文字一段图片一堆）', () => {
  // 4 段 + 3 图：图片应落在段 2/3/4 之后，正文均匀被图片隔开
  assert.deepEqual(
    order(buildDiaryFlow('一\n\n二\n\n三\n\n四', ['a', 'b', 'c'])),
    ['P一', 'P二', 'I0', 'P三', 'I1', 'P四', 'I2'],
  )

  // 3 段 + 3 图：一对一交错
  assert.deepEqual(
    order(buildDiaryFlow('一\n\n二\n\n三', ['a', 'b', 'c'])),
    ['P一', 'I0', 'P二', 'I1', 'P三', 'I2'],
  )

  // 5 段 + 3 图：仍然均衡（段 2、4、5 之后各一张）
  assert.deepEqual(
    order(buildDiaryFlow('一\n\n二\n\n三\n\n四\n\n五', ['a', 'b', 'c'])),
    ['P一', 'P二', 'I0', 'P三', 'P四', 'I1', 'P五', 'I2'],
  )
})

test('buildDiaryFlow 保留真实图片顺序与槽位号，缺图时按空 URL 出占位块', () => {
  const flow = buildDiaryFlow('一\n\n二', ['a', '', 'c'])
  const photos = flow.filter(b => b.type === 'photo')
  assert.deepEqual(photos.map(p => p.slot), [0, 1, 2])
  assert.deepEqual(photos.map(p => p.url), ['a', '', 'c'])

  // 没有正文时图片单独成块（仍按顺序）
  assert.deepEqual(order(buildDiaryFlow('', ['a', 'b'])), ['I0', 'I1'])
  // 没有图片时只有正文
  assert.deepEqual(order(buildDiaryFlow('一\n\n二', [])), ['P一', 'P二'])
})
