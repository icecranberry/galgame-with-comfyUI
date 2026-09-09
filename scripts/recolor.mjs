// 一次性主题收编脚本：把 web-ui 内硬编码的旧珊瑚色系替换为主题变量。
// 用法：node scripts/recolor.mjs
// 依赖 App.vue :root / [data-theme] 中的 --accent(-rgb) / --accent-2(-rgb) / --border 等 token。
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'web-ui')

// [规则名, 正则, 替换]
// 说明：SVG fill/stroke 属性不支持 var()，单独先处理成字面色值。
const rules = [
  ['svg-fill-stroke-accent', /(fill|stroke)(=")#[eE]07[bB]6[cC](")/g, '$1=$2#6c5ce7$3'],
  ['coral-rgba', /rgba\(\s*224\s*,\s*123\s*,\s*108\s*,/g, 'rgba(var(--accent-rgb),'],
  ['coral-rgba-nospace', /rgba\(224,123,108,/g, 'rgba(var(--accent-rgb),'],
  ['peach-rgb-modern', /rgb\(\s*226\s+166\s+122\s*\/\s*([\d.]+%)\s*\)/g, 'rgb(var(--accent-rgb) / $1)'],
  ['peach-rgb-legacy', /rgb\(\s*226\s*,\s*166\s*,\s*122\s*\)/g, 'var(--accent-light)'],
  ['clay-rgba', /rgba\(\s*176\s*,\s*94\s*,\s*71\s*,/g, 'rgba(var(--accent-rgb),'],
  ['grad-soft-pattern', /linear-gradient\(\s*120deg\s*,\s*#f8edea\s+0%\s*,\s*#f2eaf4\s+35%\s*,\s*#eaf0f8\s+65%\s*,\s*#f8edea\s+100%\s*\)/gi, 'var(--grad-soft)'],
  ['hex-e07b6c', /#[eE]07[bB]6[cC]\b/g, 'var(--accent)'],
  ['hex-cc6a5c', /#[cC][cC]6[aA]5[cC]\b/g, 'var(--accent-hover)'],
  ['hex-c06a5a', /#[cC]06[aA]5[aA]\b/g, 'var(--accent-hover)'],
  ['hex-a9573d', /#[aA]9573[dD]\b/g, 'var(--accent-hover)'],
  ['hex-d4695a', /#[dD]4695[aA]\b/g, 'var(--accent-hover)'],
  ['hex-d06e5e', /#[dD]06[eE]5[eE]\b/g, 'var(--accent-hover)'],
  ['hex-b8664d', /#[bB]8664[dD]\b/g, 'var(--accent-hover)'],
  ['hex-f0a89a', /#[fF]0[aA]89[aA]\b/g, 'var(--accent-light)'],
  ['hex-f0a58f', /#[fF]0[aA]58[fF]\b/g, 'var(--accent-light)'],
  ['hex-e8c4a0', /#[eE]8[cC]4[aA]0\b/g, 'var(--accent-2-light)'],
  ['hex-d4a08c', /#[dD]4[aA]08[cC]\b/g, 'var(--accent-light)'],
  ['hex-c48a78', /#[cC]48[aA]78\b/g, 'var(--accent-2-light)'],
  ['hex-a25740', /#[aA]25740\b/g, 'var(--accent)'],
  ['hex-8b817c', /#[8B]b817[cC]\b/g, 'var(--text-secondary)'],
  ['hex-f8edea-leftover', /#[fF]8[eE][dD][eE][aA]\b/g, '#efeafc'],
  ['hex-f2eaf4-leftover', /#[fF]2[eE][aA][fF]4\b/g, '#ffece5'],
  ['hex-eaf0f8-leftover', /#[eE][aA][fF]0[fF]8\b/g, '#e9ecfb'],
  ['hex-fff7f5', /#[fF][fF][fF]7[fF]5\b/g, 'var(--bg-tertiary)'],
  ['hex-fff8f6', /#[fF][fF][fF]8[fF]6\b/g, 'var(--bg-tertiary)'],
  ['hex-d5d0ca', /#[dD]5[dD]0[cC][aA]\b/g, 'var(--border)'],
  ['hex-e8e2df', /#[eE]8[eE]2[dD][fF]\b/g, 'var(--border)'],
  ['hex-eee9e7', /#[eE][eE][eE]9[eE]7\b/g, 'var(--border)'],
]

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (/\.(vue|js|html)$/.test(entry.name)) yield p
  }
}

const targets = [...walk(path.join(root, 'src')), path.join(root, 'index.html')]

const perRule = new Map()
const perFile = []
for (const file of targets) {
  const src = fs.readFileSync(file, 'utf8')
  let out = src
  let fileTotal = 0
  const fileHits = []
  for (const [name, re, repl] of rules) {
    const matches = out.match(re)
    if (!matches) continue
    out = out.replace(re, repl)
    perRule.set(name, (perRule.get(name) || 0) + matches.length)
    fileTotal += matches.length
    fileHits.push(`${name}×${matches.length}`)
  }
  if (fileTotal > 0) {
    fs.writeFileSync(file, out)
    perFile.push([path.relative(root, file), fileTotal, fileHits.join(', ')])
  }
}

console.log('── 按规则统计 ──')
for (const [k, v] of [...perRule.entries()].sort((a, b) => b[1] - a[1])) console.log(`${k}: ${v}`)
console.log(`\n── 按文件统计（共 ${perFile.length} 个文件）──`)
for (const [f, n, hits] of perFile.sort((a, b) => b[1] - a[1])) console.log(`${f}: ${n}  (${hits})`)

// 残留检查：珊瑚家族是否仍有漏网
const leftovers = []
for (const file of targets) {
  const src = fs.readFileSync(file, 'utf8')
  const found = src.match(/#?(e07b6c|cc6a5c|c06a5a|d4695a|d06e5e|f0a89a|a25740|a9573d|b8664d|f8edea|f2eaf4|eaf0f8|224\s*,\s*123\s*,\s*108|226\s+166\s+122)/gi)
  if (found) leftovers.push(`${path.relative(root, file)}: ${found.join(' ')}`)
}
console.log(`\n── 残留检查 ──`)
console.log(leftovers.length ? leftovers.join('\n') : '无残留 ✓')
