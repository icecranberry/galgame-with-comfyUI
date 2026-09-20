import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupMomentComments } from '../src/utils/momentComments.js'

test('groupMomentComments 把同一原始楼层的回复聚在一起', () => {
  const groups = groupMomentComments([
    { id: 10, content: '琪亚娜的原评论', thread_root_id: 10 },
    { id: 20, content: '其他原评论', thread_root_id: 20 },
    { id: 11, content: '我回复琪亚娜', reply_to_comment_id: 10, thread_root_id: 10 },
    { id: 12, content: '琪亚娜回评我', reply_to_comment_id: 11, thread_root_id: 10 },
  ])

  assert.equal(groups.length, 2)
  assert.equal(groups[0].comment.id, 10)
  assert.deepEqual(groups[0].replies.map(c => c.id), [11, 12])
  assert.equal(groups[1].comment.id, 20)
  assert.deepEqual(groups[1].replies, [])
})

test('groupMomentComments 兼容缺少线程根的旧回复数据', () => {
  const groups = groupMomentComments([
    { id: 1, content: '顶层评论' },
    { id: 2, content: '回复顶层', reply_to_comment_id: 1 },
    { id: 3, content: '回复楼中楼', reply_to_comment_id: 2 },
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0].comment.id, 1)
  assert.deepEqual(groups[0].replies.map(c => c.id), [2, 3])
})
