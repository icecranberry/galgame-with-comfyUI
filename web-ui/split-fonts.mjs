// 一次性字体子集化脚本：把全量 HarmonyOS Sans woff2 按 unicode-range 切片。
// 产物输出到 public/fonts/（Vite 原样拷贝），fonts.css 改为引用切片后的 CSS。
// 用法：node split-fonts.mjs
import { fontSplit } from 'cn-font-split'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = dirname(fileURLToPath(import.meta.url))
const fonts = [
  { input: 'src/assets/fonts/HarmonyOS_Sans_SC_Regular.woff2', weight: 400, out: 'regular' },
  { input: 'src/assets/fonts/HarmonyOS_Sans_SC_Bold.woff2', weight: 700, out: 'bold' },
]

mkdirSync(resolve(root, 'public/fonts'), { recursive: true })

let css = ''
for (const { input, weight, out } of fonts) {
  const outDir = resolve(root, 'public/fonts', out)
  console.log(`[split-fonts] ${input} (weight ${weight}) → public/fonts/${out}/`)
  // 不传 css 选项：字重由字体元数据自动识别；font-family 生成后统一改写
  await fontSplit({
    input: resolve(root, input),
    outDir,
  })

  // cn-font-split 生成 result.css；改写 font-family 与相对 url 后拼接
  const cssFile = readdirSync(outDir).find(f => f.endsWith('.css'))
  if (!cssFile) throw new Error(`no css output in ${outDir}`)
  let content = readFileSync(resolve(outDir, cssFile), 'utf8')
  content = content.replace(/font-family:\s*[^;]+;/g, "font-family: 'HarmonyOS Sans SC';")
  content = content.replaceAll('url(./', `url(./${out}/`)
  css += `/* weight ${weight} */\n` + content + '\n'
}

writeFileSync(resolve(root, 'public/fonts/fonts-split.css'), css)
console.log('[split-fonts] done → public/fonts/fonts-split.css')
