import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { studioOutfitOptions } from '../src/utils/studioWardrobe.js'

const descriptor = parse(readFileSync(new URL('../src/components/photoStudio/StudioOutfitPicker.vue', import.meta.url), 'utf8')).descriptor
const code = compileScript(descriptor, { id: 'studio-wardrobe-test', inlineTemplate: true }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names.replace(/\bas\b/g, ':')} } = Vue`)
  .replace(/^import .*from.*$/gm, '').replace('export default', 'return')

function fixture(t, readOutfits) {
  const previous = ['document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  globalThis.document = new EventTarget()
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844 })
  const Picker = new Function('Vue', 'listSceneOutfits', 'studioOutfitOptions', 'StudioButton', code)(
    { ...Vue, Transition: Vue.BaseTransition }, readOutfits, studioOutfitOptions,
    { setup: (_, { slots, emit }) => () => Vue.h('div', { onClick: () => emit('click') }, slots.default?.()) },
  )
  const find = (root, predicate) => predicate(root) ? root : root.children.map(child => find(child, predicate)).find(Boolean)
  const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null, offsetHeight: 240,
    getBoundingClientRect: () => ({ left: 260, top: 450, bottom: 590 }),
    contains(target) { return !!find(this, el => el === target) },
    querySelector() { return find(this, el => el.props.role === 'combobox') }, focus() {},
  })
  const body = node('body'), root = node('main')
  const remove = child => { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null }
  const renderer = Vue.createRenderer({
    createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text),
    insert(child, parent, before) { remove(child); const i = before ? parent.children.indexOf(before) : -1; parent.children.splice(i < 0 ? parent.children.length : i, 0, child); child.parent = parent },
    remove, setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
    parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] || null,
    patchProp: (el, key, _old, value) => { el.props[key] = value }, querySelector: () => body,
  })
  const selected = Vue.ref('work'), characterId = Vue.ref(1)
  const app = renderer.createApp({ setup: () => () => Vue.h(Picker, { characterId: characterId.value, modelValue: selected.value, 'onUpdate:modelValue': value => { selected.value = value } }, {
    default: slot => Vue.h('div', { role: 'combobox', onClick: slot.toggle, onKeydown: slot.keydown }),
  }) })
  app.mount(root)
  t.after(() => {
    app.unmount()
    previous.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : delete globalThis[key])
  })
  const text = el => el.text + el.children.map(text).join('')
  return { selected, characterId, trigger: () => find(root, el => el.props.role === 'combobox'),
    panel: () => find(body, el => el.props.role === 'listbox'), option: value => find(body, el => el.props.role === 'option' && text(el).includes(value)), text: () => text(body) }
}
async function settle() { await Vue.nextTick(); await Promise.resolve(); await Vue.nextTick() }
const outfit = (scene, name = scene) => ({ scene, name, description: 'full appearance' })

test('each avatar click reads the live wardrobe, shows all four outfits and submits the chosen scene', async t => {
  let calls = 0
  const f = fixture(t, async id => { assert.equal(id, 1); calls++; return { outfits: [outfit('casual', '便装'), outfit('home', '居家裙'), outfit('sleep', '睡装')] } })
  f.trigger().props.onClick(); await settle()
  assert.equal(calls, 1)
  assert.match(f.text(), /4 套/)
  assert.match(f.text(), /默认服装.*私服.*便装.*居家.*居家裙.*睡衣.*睡装/)
  assert.ok(Number.parseFloat(f.panel().props.style.left) + 224 <= 382, 'the popup stays inside a narrow viewport')
  f.option('睡衣').props.onClick(); await settle()
  assert.equal(f.selected.value, 'sleep')
  assert.equal(f.panel(), undefined)
  f.trigger().props.onClick(); await settle()
  assert.equal(calls, 2, 'reopening must not reuse stale character-list metadata')
})

test('a wardrobe read failure is explicit and closing invalidates a late response', async t => {
  let rejectRead, resolveRead
  let attempt = 0
  const f = fixture(t, () => new Promise((resolve, reject) => { attempt++; rejectRead = reject; resolveRead = resolve }))
  f.trigger().props.onClick(); await settle()
  assert.match(f.text(), /查找服装/)
  rejectRead(new Error('offline')); await settle()
  assert.match(f.text(), /服装读取失败/)
  assert.doesNotMatch(f.text(), /1 套|默认服装/)
  f.trigger().props.onClick(); await settle()
  f.trigger().props.onClick(); await settle()
  assert.equal(attempt, 2)
  f.characterId.value = 2; await settle()
  resolveRead({ outfits: [outfit('sleep')] }); await settle()
  assert.equal(f.panel(), undefined)
  assert.equal(f.selected.value, 'work')
})
