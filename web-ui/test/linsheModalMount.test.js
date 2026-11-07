import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

// Compile the real modal. BaseTransition keeps this renderer independent of CSS/DOM APIs.
const descriptor = parse(readFileSync(new URL('../src/components/ui/LinsheModal.vue', import.meta.url), 'utf8')).descriptor
const code = compileScript(descriptor, { id: 'modal-mount-test', inlineTemplate: true }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names.replace(/\bas\b/g, ':')} } = Vue`)
  .replace(/^import .*from.*$/gm, '')
  .replace('export default', 'return')
const Modal = new Function('Vue', 'LinsheCloseButton', 'registerModal', 'nextModalLayer', code)(
  { ...Vue, Transition: Vue.BaseTransition },
  () => Vue.h('span'),
  () => () => {},
  () => 10000,
)

function fixture(t, { anchor = '.page-modal-host', existingHost = false, initiallyOpen = false } = {}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
  })
  const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null })
  const body = node('body')
  const remove = child => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  }
  const insert = (child, parent, before = null) => {
    assert.ok(!before || before.parent === parent, 'insertBefore anchor must still belong to its parent')
    remove(child)
    const index = before ? parent.children.indexOf(before) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
  }
  const find = (root, predicate) => predicate(root) ? root : root.children.map(child => find(child, predicate)).find(Boolean)
  const hasClass = (element, name) => (element.props.class || '').split(' ').includes(name)
  let earlyTargetLookups = 0
  const renderer = Vue.createRenderer({
    createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text),
    insert, remove, setText: (element, text) => { element.text = text },
    setElementText: (element, text) => { element.text = text; element.children = [] },
    parentNode: element => element.parent,
    nextSibling: element => element.parent?.children[element.parent.children.indexOf(element) + 1] || null,
    patchProp: (element, key, oldValue, value) => { element.props[key] = value },
    querySelector: selector => {
      const target = selector === 'body' ? body : find(body, element => hasClass(element, selector.slice(1)))
      if (!target) earlyTargetLookups++
      return target || null
    },
  })
  const container = node('main')
  insert(container, body)
  if (existingHost) insert(Object.assign(node('div'), { props: { class: 'page-modal-host' } }), body)
  const open = Vue.ref(initiallyOpen), title = Vue.ref('居民动态')
  const zIndex = Vue.ref(11000)
  const FloatingTool = { setup() {
    const layer = Vue.inject('linsheModalLayer')
    return () => Vue.h(Vue.Teleport, { to: 'body' }, Vue.h('aside', {
      class: 'floating-tool', style: { zIndex: layer.value + 1 },
    }))
  } }
  const route = Vue.ref('town')
  const TownPage = { setup: () => () => Vue.h('section', { class: 'town-shell' }, [
    Vue.h(Modal, { anchor, modelValue: open.value, title: title.value, zIndex: zIndex.value }, { default: () => [Vue.h('p', '行动记录'), Vue.h(FloatingTool)] }),
    Vue.h(Modal, { anchor, modelValue: false, title: '全镇动态' }),
  ]) }
  const OtherPage = { setup: () => () => Vue.h('section', { class: 'settings-view' }, '设置') }
  const app = renderer.createApp({
    setup: () => () => Vue.h('div', { class: 'page-host' }, [
      Vue.h(route.value === 'town' ? TownPage : OtherPage, { key: route.value }),
      ...(existingHost ? [] : [Vue.h('div', { class: 'page-modal-host' })]),
    ]),
  })
  const errors = [], warnings = []
  app.config.errorHandler = error => errors.push(error)
  app.config.warnHandler = warning => warnings.push(warning)
  app.mount(container)
  t.after(() => app.unmount())
  return { open, title, route, zIndex, errors, warnings, earlyTargetLookups: () => earlyTargetLookups,
    tool: () => find(body, element => hasClass(element, 'floating-tool')),
    overlay: () => find(body, element => hasClass(element, 'modal-overlay')),
    target: () => anchor ? find(body, element => hasClass(element, anchor.slice(1))) : body,
  }
}

test('direct page mount resolves an initially closed anchored modal after its host is inserted', async t => {
  const state = fixture(t)
  assert.equal(state.earlyTargetLookups(), 0)
  assert.deepEqual(state.warnings, [])
  assert.equal(state.overlay(), undefined)
  // TownView updates resident names and activity as soon as world data arrives or a resident is clicked.
  state.title.value = '织尾 · 动态'
  await Vue.nextTick()
  state.open.value = true
  await Vue.nextTick()
  assert.deepEqual(state.errors, [])
  assert.equal(state.overlay()?.parent, state.target())
  state.open.value = false
  await Vue.nextTick()
  assert.equal(state.overlay(), undefined)
  state.open.value = true
  await Vue.nextTick()
  assert.equal(state.overlay()?.parent, state.target())
  assert.deepEqual(state.errors, [])
  assert.deepEqual(state.warnings, [])
})

test('teleported tool inherits its modal layer reactively and unmounts with the modal', async t => {
  const state = fixture(t, { initiallyOpen: true })
  await Vue.nextTick()
  assert.equal(state.tool().props.style.zIndex, 11001)
  state.zIndex.value = 13000
  await Vue.nextTick()
  assert.equal(state.tool().props.style.zIndex, 13001)
  state.open.value = false
  await Vue.nextTick()
  assert.equal(state.tool(), undefined)
  state.open.value = true
  await Vue.nextTick()
  assert.equal(state.tool().props.style.zIndex, 13001)
  assert.deepEqual(state.errors, [])
})

test('leaving and reopening a page with multiple anchored modals never removes the route insertion anchor', async t => {
  const state = fixture(t)
  state.open.value = true
  await Vue.nextTick()
  assert.equal(state.overlay()?.parent, state.target())
  state.route.value = 'settings'
  await Vue.nextTick()
  assert.equal(state.overlay(), undefined)
  state.route.value = 'town'
  await Vue.nextTick()
  assert.equal(state.overlay()?.parent, state.target())
  assert.deepEqual(state.errors, [])
  assert.deepEqual(state.warnings, [])
})

test('town modals use the permanent page layer declared outside the routed page', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(app, /<\/router-view>\s*<!--[\s\S]*?-->\s*<div class="page-modal-host"><\/div>/)
  for (const path of ['../src/views/TownView.vue', '../src/components/town/TownResidentActivityModal.vue']) {
    const template = parse(readFileSync(new URL(path, import.meta.url), 'utf8')).descriptor.template.content
    assert.match(template, /anchor="\.page-modal-host"/)
    assert.doesNotMatch(template, /anchor="\.page-host"/)
  }
})

test('an anchored modal can also start open when its host mounts in the same render', async t => {
  const state = fixture(t, { initiallyOpen: true })
  await Vue.nextTick()
  assert.equal(state.overlay()?.parent, state.target())
  assert.equal(state.earlyTargetLookups(), 0)
  assert.deepEqual(state.errors, [])
  assert.deepEqual(state.warnings, [])
})

test('navigation into an existing host and default body modals keep their targets', async t => {
  for (const options of [{ existingHost: true }, { anchor: '' }]) {
    await t.test(JSON.stringify(options), async child => {
      const state = fixture(child, { ...options, initiallyOpen: true })
      await Vue.nextTick()
      assert.equal(state.overlay()?.parent, state.target())
      assert.deepEqual(state.errors, [])
      assert.deepEqual(state.warnings, [])
    })
  }
})
