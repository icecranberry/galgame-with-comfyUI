import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeTownInitDraft, readTownInitDraft, townInitDraftKey } from '../src/utils/townInitDraft.js'

const draft = () => ({
  localStep: 'buildings', addingTown: false,
  form: { worldSettingId: 7, npcCount: 10, mapSize: 60 },
  bpForm: { groundAssets: [], roadAssets: [], buildings: [{ key: 'cafe', desc: '手动编辑', busy: true }], props: [], npcs: [{ displayName: '居民', genBusy: true }] },
  stepParams: { buildings: { artist: 'custom' } }, listBaselines: { buildings: 'baseline' },
})

test('恢复步骤、配置和未提交的清单，同时清除请求加载标记', () => {
  const saved = encodeTownInitDraft(draft())
  const restored = readTownInitDraft({ getItem: () => saved }, 'draft')
  assert.equal(restored.localStep, 'buildings')
  assert.equal(restored.form.worldSettingId, 7)
  assert.equal(restored.bpForm.buildings[0].desc, '手动编辑')
  assert.equal(restored.bpForm.buildings[0].busy, false)
  assert.equal(restored.bpForm.npcs[0].genBusy, false)
  assert.equal(restored.stepParams.buildings.artist, 'custom')
  assert.equal(restored.listBaselines.buildings, 'baseline')
})

test('损坏、旧版本、完成态以及不可用的存储不会阻止向导打开', () => {
  for (const raw of ['{', null, '{}', JSON.stringify({ ...draft(), version: 0 }), encodeTownInitDraft({ ...draft(), localStep: 'done' })]) {
    assert.equal(readTownInitDraft({ getItem: () => raw }, 'draft'), null)
  }
  assert.equal(readTownInitDraft({ getItem() { throw new Error('denied') } }, 'draft'), null)
})

test('世界与重建版本之间隔离暂存', () => {
  const key = townInitDraftKey({ worldId: 'a', worldEpoch: 1 })
  assert.notEqual(key, townInitDraftKey({ worldId: 'b', worldEpoch: 1 }))
  assert.notEqual(key, townInitDraftKey({ worldId: 'a', worldEpoch: 2 }))
})
