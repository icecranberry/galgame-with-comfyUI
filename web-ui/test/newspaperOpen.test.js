import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/NewspaperModal.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'newspaper-open-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .*from.*$/gm, '')
  .replace('export default', 'return')

class LocalDate extends Date {
  constructor(...args) { super(...(args.length ? args : [2026, 9, 16, 0, 30])) }
}

for (const outcome of ['confirmed', 'cancelled', 'failed']) {
  test(`删除今日日报：${outcome}，仅成功时关闭并通知列表刷新`, async t => {
    const today = { publish_date: '2026-10-16', edition: 2, items: [] }
    const requests = [], events = [], toasts = []
    let finishDelete
    const api = {
      deleteNewspaperEdition: async date => {
        requests.push(date)
        await new Promise(resolve => { finishDelete = resolve })
        if (outcome === 'failed') throw new Error('删除失败')
        return { ok: true }
      },
    }
    const component = new Function('Vue', 'api', 'LinsheButton', 'ImageLightbox',
      'useArticleClip', 'playNewspaperFlipSound', 'window', 'Date', code)(
      Vue, api, {}, {}, () => {}, () => {},
      { addEventListener() {}, removeEventListener() {} }, LocalDate,
    )
    let state
    const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    const app = renderer.createApp({ setup() {
      state = component.setup({ modelValue: true, initialDate: '' }, { expose() {}, emit: (...args) => events.push(args) })
      return () => null
    } })
    app.provide('confirm', async () => outcome !== 'cancelled')
    app.provide('toast', (...args) => toasts.push(args))
    app.mount({})
    t.after(() => app.unmount())
    state.todayPaper.value = today

    // 历史期没有今日删除行为。
    state.viewDate.value = '2026-10-15'
    await state.deleteTodayPaper()
    assert.deepEqual(requests, [])
    state.viewDate.value = ''
    const pending = state.deleteTodayPaper()
    await Promise.resolve()
    if (outcome !== 'cancelled') {
      assert.equal(state.deleting.value, true)
      await state.deleteTodayPaper()
      assert.deepEqual(requests, [today.publish_date])
      finishDelete()
    }
    await pending

    assert.equal(state.deleting.value, false)
    assert.equal(events.some(([name]) => name === 'close'), outcome === 'confirmed')
    assert.deepEqual(events.filter(([name]) => name === 'deleted'),
      outcome === 'confirmed' ? [['deleted', today.publish_date]] : [])
    assert.deepEqual(requests, outcome === 'cancelled' ? [] : [today.publish_date])
    assert.equal(toasts[0]?.[1], outcome === 'cancelled' ? undefined : outcome === 'failed' ? 'error' : 'success')
    // 成功也保留纸面供淡出动画使用；失败/取消则继续阅读。
    assert.equal(state.paper.value.publish_date, today.publish_date)
  })
}

for (const initialDate of ['', '2026-10-16', '2026-10-15']) {
  test(`打开日报：${initialDate || '默认今天'}，加载正确期次且无 watcher 异常`, async t => {
    const today = { publish_date: '2026-10-16', edition: 2, items: [] }
    const past = { publish_date: '2026-10-15', edition: 1, items: [] }
    const requests = [], events = [], errors = []
    const api = {
      getTodayNewspaper: async () => ({ newspaper: today }),
      listNewspaperEditions: async () => ({ editions: [today, past] }),
      getNewspaperByDate: async date => { requests.push(date); return { newspaper: past } },
    }
    const component = new Function('Vue', 'api', 'LinsheButton', 'ImageLightbox',
      'useArticleClip', 'playNewspaperFlipSound', 'window', 'Date', code)(
      Vue, api, {}, {}, () => {}, () => {},
      { addEventListener() {}, removeEventListener() {} }, LocalDate,
    )
    const props = Vue.reactive({ modelValue: false, initialDate })
    let state
    const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    const app = renderer.createApp({ setup() {
      state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) })
      return () => null
    } })
    app.config.errorHandler = error => errors.push(error)
    app.mount({})
    t.after(() => app.unmount())

    props.modelValue = true
    await Vue.nextTick()
    await new Promise(resolve => setImmediate(resolve))

    assert.deepEqual(errors, [])
    assert.equal(state.loading.value, false)
    const isPast = initialDate === past.publish_date
    assert.equal(state.paper.value.publish_date, isPast ? past.publish_date : today.publish_date)
    assert.equal(state.isToday.value, !isPast)
    assert.deepEqual(requests, isPast ? [past.publish_date] : [])
    assert.equal(events.some(([name]) => name === 'read'), !isPast)
  })
}
