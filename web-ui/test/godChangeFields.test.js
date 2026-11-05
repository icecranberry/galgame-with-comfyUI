import test from 'node:test'
import assert from 'node:assert/strict'
import { godChangeFields } from '../src/utils/godChangeFields.js'

test('creating an outfit never presents the parent character name as the old outfit name', () => {
  const fields = godChangeFields({ name: 'create_outfit', before: { name: 'firefly', display_name: '流萤' }, args: { character_id: 1076, name: '萤火私服', description: '橙色针织衫' } })
  assert.deepEqual(fields, [
    { key: 'name', label: '新增外观名称', before: undefined, after: '萤火私服' },
    { key: 'description', label: '外观描述', before: undefined, after: '橙色针织衫' },
  ])
})

test('new child records do not inherit comparison fields from their parent snapshot', () => {
  for (const name of ['create_emoji_set', 'create_media_board']) {
    assert.equal(godChangeFields({ name, before: { name: 'parent' }, args: { name: 'child' } })[0].before, undefined)
  }
})

test('replacement previews preserve exact original and replacement text, including empty originals', () => {
  const preview = [{ label: '你的外观', before: '银发', after: '红发' }, { label: '补充', before: '', after: '新内容' }]
  assert.deepEqual(godChangeFields({ name: 'apply_character_appearance', preview }), preview.map((field, i) => ({ ...field, key: `replacement-${i}` })))
})

test('updates compare the edited entity, including the nested group snapshot', () => {
  assert.equal(godChangeFields({ name: 'update_world_setting', before: { name: '旧世界' }, args: { name: '新世界' } })[0].before, '旧世界')
  assert.equal(godChangeFields({ name: 'update_group', before: { group: { name: '旧群名' } }, args: { name: '新群名' } })[0].before, '旧群名')
})

test('image replacement previews retain their kind and exact before/after addresses', () => {
  const field = { label: '开心', kind: 'image', before: '/images/emoji/old.png', after: '/images/emoji/draft.png' }
  assert.deepEqual(godChangeFields({ name: 'generate_emoji_image', preview: [field] }), [{ ...field, key: 'replacement-0' }])
})
