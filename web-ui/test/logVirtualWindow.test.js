import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLogOffsets, findLogWindow, logTextPreview } from '../src/utils/logVirtualWindow.js'

test('长日志列表只选择视口附近条目，前后占位保留整个滚动范围', () => {
  const entries = Array.from({ length: 1000 }, (_, seq) => ({ seq }))
  const offsets = buildLogOffsets(entries, new Map())
  for (const top of [0, 15000, 200000, offsets.at(-1) - 800]) {
    const range = findLogWindow(offsets, top, 800)
    assert.ok(range.end - range.start <= 6)
    assert.ok(offsets[range.start] <= top)
    assert.ok(offsets[range.end] >= Math.min(top + 800, offsets.at(-1)))
    assert.equal(range.before + offsets[range.end] - offsets[range.start] + range.after, offsets.at(-1))
  }
})

test('展开超长条目后，位于中段的视口仍包含该条目，底部可到达最后一条', () => {
  const entries = [{ seq: 1 }, { seq: 2 }, { seq: 3 }]
  const offsets = buildLogOffsets(entries, new Map([[1, 100], [2, 50000], [3, 200]]))
  assert.deepEqual(findLogWindow(offsets, 20000, 800), { start: 1, end: 2, before: 108, after: 208 })
  assert.equal(findLogWindow(offsets, offsets.at(-1) - 100, 800).end, 3)
  assert.deepEqual(findLogWindow([0], 0, 800), { start: 0, end: 0, before: 0, after: 0 })
})

test('高度按日志 id 保留，前插新日志不会套用旧条目的高度', () => {
  const heights = new Map([[1, 100], [2, 300]])
  assert.deepEqual(buildLogOffsets([{ seq: 2 }, { seq: 1 }], heights), [0, 308, 416])
  assert.deepEqual(buildLogOffsets([{ seq: 3 }, { seq: 2 }, { seq: 1 }], heights), [0, 608, 916, 1024])
})

test('四行预览保留短文本与原换行，避免把超长全文交给隐藏 DOM 排版', () => {
  assert.equal(logTextPreview('短消息'), '短消息')
  assert.equal(logTextPreview('一\n二\n三\n四\n五'), '一\n二\n三\n四')
  assert.equal(logTextPreview('一\r\n二\r\n三'), '一\r\n二\r\n三')
  const huge = '很长的未展开日志'.repeat(100000)
  const preview = logTextPreview(huge)
  assert.ok(preview.length <= 4096)
  assert.ok(huge.startsWith(preview))
})
