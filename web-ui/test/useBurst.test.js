import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useBurst } from '../src/composables/useBurst.js'

// 置顶按钮的点击特效契约：挂类必须同步完成。
// 置顶会带动一次列表重排，Vue 在每次更新时都会摘掉正在播放的位移过渡，
// 特效若「先复位、等一帧再挂」（为了连续点击重播），就会额外补一次渲染，
// 把整段卡片位移过渡当场打断。这里守住同步置位这一点。

test('burst 同步置位，不在下一帧才挂特效', () => {
  const { burstKey, bursting, burst } = useBurst(30)

  assert.equal(burstKey.value, null)
  assert.equal(bursting.value, false)

  burst('c1')
  assert.equal(burstKey.value, 'c1')
  assert.equal(bursting.value, true)

  burst('c2')
  assert.equal(burstKey.value, 'c2')
})

test('单元素场景用 true 作 key，且到时长后自动复位', async () => {
  const { burstKey, bursting, burst } = useBurst(20)

  burst()
  assert.equal(burstKey.value, true)

  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(burstKey.value, null)
  assert.equal(bursting.value, false)
})
