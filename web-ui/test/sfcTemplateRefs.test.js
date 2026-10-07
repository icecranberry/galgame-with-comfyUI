import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

/**
 * ★ 大文件「被整段误删」的守卫。
 *
 * ── 为什么要有这条测试 ────────────────────────────────────────
 * 2026-10-05 我用一次「按起止字符串批量删除」的编辑，把 `MediaView.vue` 里
 * **从「自动抓帖频率」到 `reloadAll()` 之间的整段脚本删掉了** ——
 * 里面包含 postKind / feedPosts / activeIsPeriodical / issues / 批量操作全家 …
 * 又顺手把模板里一处注释从中间切开，**把「媒体设置」按钮吞进了注释**。
 *
 * 后果正是项目红线描述的那种：引用不存在的标识符抛 `ReferenceError`，
 * 而**构建是成功的**（Vue 把模板引用编译成 `_ctx.X`，编译期不校验），
 * 只有真正打开页面才会炸 —— 极难在提交前发现。
 *
 * 已有的 `local-patch-regression` 只检查 `activeIs*` 一个前缀，拦不住这种面状损坏。
 * 这条用 **Vue 官方编译器**做全量比对：
 *   ① `compileScript` 拿到 setup 的全部顶层绑定（const / function / import / props…）
 *   ② 编译模板，收集所有 `_ctx.xxx` 引用
 *   ③ 差集必须为空 —— 空 = 模板里用到的每个名字都有定义
 *
 * 同时检查「模板标签是否闭合」，因为"注释被切开吞掉后面的标签"这类损坏会最先表现为标签失衡。
 *
 * 这是**静态检查**（不需要跑浏览器），任何视图文件都能加进来。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEBUI = path.resolve(HERE, '..')
const require = createRequire(import.meta.url)
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')

/** 会被 Vue 注入到模板作用域的全局/内置名，不算"未定义" */
const TEMPLATE_GLOBALS = new Set([
  '$event', '$slots', '$attrs', '$props', '$refs', '$emit', '$el', '$options', '$forceUpdate',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Date', 'Set', 'Map',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'console', 'window', 'document',
])

/**
 * 取出模板里所有 `_ctx.xxx` 引用（编译产物里的"来自脚本作用域的名字"）。
 * 用编译器而不是自己写正则：v-for / 插槽作用域 / 可选链这些坑正则处理不了。
 */
function collectTemplateRefs(compiled) {
  const code = compiled.code || ''
  const refs = new Set()
  for (const m of code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)) refs.add(m[1])
  // with 块的 `_ctx.a && _ctx.b` 之外，还有直接解构出来的名字（如 v-for 别名）
  for (const m of code.matchAll(/_unref\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) refs.add(m[1])
  return refs
}

/**
 * 校验一个 .vue 文件的「模板引用 ↔ 脚本绑定」一致性。
 * @param {string} file 绝对路径
 * @returns {{missing: string[], errors: string[]}}
 */
function checkSfc(file) {
  const src = fs.readFileSync(file, 'utf8')
  const { descriptor, errors } = parse(src, { filename: file })
  if (errors?.length) return { missing: [], errors: errors.map(e => e.message || String(e)) }
  if (!descriptor.scriptSetup) return { missing: [], errors: [] }

  const script = compileScript(descriptor, { id: 'check' })
  const bindings = new Set(Object.keys(script.bindings || {}))

  const tpl = compileTemplate({
    source: descriptor.template?.content || '',
    filename: file,
    id: 'check',
    compilerOptions: { bindingMetadata: script.bindings },
  })
  if (tpl.errors?.length) return { missing: [], errors: tpl.errors.map(e => e.message || String(e)) }

  const refs = collectTemplateRefs(tpl)
  const missing = [...refs].filter(n => !bindings.has(n) && !TEMPLATE_GLOBALS.has(n)).sort()
  return { missing, errors: [] }
}

/** 本项目里"体量大、改动频繁"的视图 —— 正是最容易被批量编辑误伤的那批 */
const WATCHED = [
  'src/views/MediaView.vue',
  'src/views/SettingsView.vue',
  'src/views/ScheduleView.vue',
  'src/views/WorldMapView.vue',
  'src/views/TavernView.vue',
  // 「故事」页三页签 + 多个弹窗，体量与改动频率都够高（2026-10-07 补）
  'src/views/StoryView.vue',
]

test('★ 模板引用必须全都有定义（拦住"整段误删 → ReferenceError → 页面炸"）', async (t) => {
  let checked = 0
  for (const rel of WATCHED) {
    const file = path.join(WEBUI, rel)
    if (!fs.existsSync(file)) continue
    const { missing, errors } = checkSfc(file)
    checked++
    assert.deepEqual(errors, [], `${rel} 编译失败：${errors.join('；')}`)
    assert.deepEqual(missing, [],
      `${rel} 模板里用到但脚本里没定义：${missing.join('、')}（页面会抛 ReferenceError，且构建不会报错）`)
  }
  assert.ok(checked >= 3, `至少应检查 3 个视图（实际 ${checked}）—— 否则这条守卫没在起作用`)
  t.diagnostic(`已检查 ${checked} 个视图`)
})

test('守卫本身有效：故意构造一个"模板引用了不存在的东西"必须被查出来', () => {
  // 用一个临时 SFC 验证检查逻辑真的有牙齿（否则这条守卫可能一直在空转）
  const dir = fs.mkdtempSync(path.join(WEBUI, '.tmp-sfc-'))
  const bad = path.join(dir, 'Bad.vue')
  try {
    fs.writeFileSync(bad, `<template>\n  <div>{{ somethingMissing }}</div>\n</template>\n<script setup>\nconst ok = 1\n</script>\n`)
    const r1 = checkSfc(bad)
    assert.deepEqual(r1.missing, ['somethingMissing'], '应当查出一个未定义引用')

    fs.writeFileSync(bad, `<template>\n  <div>{{ ok }}</div>\n</template>\n<script setup>\nconst ok = 1\n</script>\n`)
    const r2 = checkSfc(bad)
    assert.deepEqual(r2.missing, [], '合法 SFC 不应报错')

    // v-for 的作用域别名不算"来自脚本"，不能被误报
    fs.writeFileSync(bad, `<template>\n  <ul><li v-for="item in list" :key="item.id">{{ item.name }}</li></ul>\n</template>\n<script setup>\nconst list = []\n</script>\n`)
    const r3 = checkSfc(bad)
    assert.deepEqual(r3.missing, [], `v-for 别名不应被误报（实得 ${r3.missing.join('、')}）`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('SFC 标签必须闭合（"注释被从中间切开吞掉后面的标签"会先在这里暴露）', () => {
  for (const rel of WATCHED) {
    const file = path.join(WEBUI, rel)
    if (!fs.existsSync(file)) continue
    const src = fs.readFileSync(file, 'utf8')
    const { errors } = parse(src, { filename: file })
    assert.deepEqual((errors || []).map(e => e.message || String(e)), [], `${rel} SFC 结构有错`)
  }
})
