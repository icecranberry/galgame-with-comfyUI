import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 《邻舍日报》头版正文的压裁口径（源码级回归）：
// 配图优先口径下图块浮动环绕、正文 min-height 保底一行（纯 CSS），压裁器负责把
// 「装不下的那半行」截断补省略号（全文进详情页）。
// 这一层是「模板标记 ↔ composable」的契约，改动任何一边都要同步，否则省略号会整版消失。
const MODAL = fileURLToPath(new URL('../src/components/NewspaperModal.vue', import.meta.url))
const CLIP = fileURLToPath(new URL('../src/composables/useArticleClip.js', import.meta.url))

const modal = readFileSync(MODAL, 'utf8')
const clip = readFileSync(CLIP, 'utf8')

test('压裁器挂到版面上，并随显隐 / 换期 / 补图重量', () => {
  assert.match(modal, /ref="paperEl"[^>]*class="np-paper"/, '版面根节点要能被 composable 扫到')
  assert.match(modal, /useArticleClip\(\{/, '版面要接上压裁器')
  assert.match(modal, /root: paperEl/, 'root 指向版面根节点')
  assert.match(modal, /active: visible/, '窗口关着时不量（量不到尺寸）')
  assert.match(modal, /sources:\s*\[[^\]]*paper[^\]]*\]/, '换期 / 补图等数据变化要触发重量')
})

test('每条正文都带 data-np-clip，且不套 -webkit-box 压裁', () => {
  const bodies = [...modal.matchAll(/<p[^>]*class="np-text[^"]*"[^>]*>/g)].map(match => match[0])
  const articleBodies = bodies.filter(tag => !tag.includes('np-detail-text'))
  assert.ok(articleBodies.length >= 4, `头版正文标签数异常：${articleBodies.length}`)
  for (const tag of articleBodies) {
    assert.match(tag, /data-np-clip/, `头版正文缺 data-np-clip：${tag}`)
    assert.doesNotMatch(tag, /np-clamp-\d/, `头版正文不能用 line-clamp（会丢掉 float 环绕）：${tag}`)
  }
  assert.equal(articleBodies.some(tag => /np-clamp-\d/.test(tag)), false)
})

test('标题保留 CSS 行数压裁，正文不再依赖 np-clamp 系列', () => {
  assert.match(modal, /np-article-title np-clamp-2/, '标题仍是两行压裁')
  // np-clamp 家族只保留标题用的 2 行版，正文的 3/4/5/6 行版已随压裁器删除
  for (const n of [3, 4, 5, 6]) {
    assert.doesNotMatch(modal, new RegExp(`\\.np-clamp-${n}\\b`), `残留未使用的 .np-clamp-${n}`)
  }
  assert.match(modal, /\.np-clamp-2\s*\{[^}]*-webkit-line-clamp:\s*2/)
})

test('压裁器判定用文字排版高度，而不是被 overflow 锁住的 height', () => {
  assert.match(clip, /selectNodeContents\(el\)/, '要量正文文字范围')
  assert.match(clip, /const fits = \(\) =>/, '要有「装得下吗」的判定')
  assert.doesNotMatch(clip, /fits = \(\) => el\.getBoundingClientRect\(\)\.height/,
    '正文自身 overflow:hidden，height 永远等于边界，不能用它判定溢出')
})

// 配图优先口径：图按原始比例完整展示（contain，永不裁切）；侧栏 / 异闻图块浮动，
// 文字绕图排成报纸的「半包围」拼版。图块按版面高度取一份、装不下跟版面一起缩，
// 省下的版面留给标题与正文（正文保底一行）；压裁器只负责正文省略号。
test('配图浮动环绕（文字半包围），并以 contain 等比收缩', () => {
  assert.match(modal, /\.np-figure img\s*\{[^}]*object-fit:\s*contain/, '配图 contain 等比，不许 cover 裁切')
  assert.doesNotMatch(modal, /\.np-figure[^{]*\{[^}]*object-fit:\s*cover/, '残留满幅裁切口径（头像圆框的 cover 不算）')
  assert.match(modal, /\.np-figure-wrap\s*\{[^}]*float:\s*left/, '侧栏 / 异闻图块浮动，文字绕图半包围')
  assert.match(modal, /\.np-article:nth-of-type\(even\)\s+\.np-figure-wrap\s*\{[^}]*float:\s*right/,
    '图块按条目左右交错拼版')
  assert.match(modal, /\.np-article \.np-figure-wrap\s*\{[^}]*height:\s*calc\(100%\s*-\s*[\d.]+em\)/,
    '图块按版面高度取一份，装不下跟版面一起缩')
  assert.match(modal, /\.np-article\s*\{[^}]*overflow:\s*hidden/, '图块被版面收住（BFC）')
  assert.doesNotMatch(modal, /\.np-figure-wrap\s*\{[^}]*align-self/, '浮动图块不再靠 flex 对齐')
})

// 出现方式：衬底淡入渐出，纸面（含报头关闭钮）从底部往上浮
test('报纸从底部往上浮现', () => {
  const rise = modal.match(/\.np-window-enter-from \.np-paper[\s\S]*?\n\}/)
  assert.ok(rise, '要有纸面浮现的起始态')
  assert.match(rise[0], /translateY\(var\(--np-rise/, '纸面从底部往上浮')
  assert.match(modal, /\.np-window-enter-active \.np-paper[\s\S]{0,400}transition:\s*transform/, '浮现走 transform 过渡')
  assert.match(modal, /--np-rise:\s*clamp\(/, '浮现位移要有变量兜底')
})

// 四周报边质感：纸壳四边做旧（内圈高光 + 纤维暗角）
test('纸面四边带报纸做旧质感', () => {
  assert.match(modal, /inset 0 0 0 1px rgba\(255, 253, 246, 0\.45\)/, '纸壳内圈要有高光衬边')
  assert.match(modal, /inset 0 0 28px rgba\(120, 96, 64, 0\.12\)/, '纸壳四边要有纤维暗角')
  assert.ok(modal.includes('报边做旧'), '报边做旧口径要有注释兜底')
})

// 报纸是直角纸边；窗口淡入淡出 / 纸面上浮都走 --ease-out（先快后慢的贝塞尔曲线）
test('报纸直角边角，淡入淡出先快后慢', () => {
  const shell = modal.match(/\.np-paper,\s*\n\.np-gate\s*\{[\s\S]*?\n\}/)
  assert.ok(shell, '要能读到纸壳规则')
  assert.doesNotMatch(shell[0], /border-radius/, '报纸边角不要圆角')
  const fade = modal.match(/\.np-window-enter-active,\s*\n\.np-window-leave-active\s*\{[^}]*\}/)
  assert.ok(fade, '要能读到窗口淡入淡出规则')
  assert.match(fade[0], /transition:\s*opacity[^;]*var\(--ease-out\)/, '淡入淡出要走先快后慢的贝塞尔曲线')
  assert.match(modal, /\.np-window-enter-active \.np-paper[\s\S]{0,400}transition:\s*transform[^;]*var\(--ease-out\)/,
    '纸面上浮与淡入淡出同口径')
})

test('正文保底一行，且压裁器负责省略号', () => {
  assert.match(modal, /\.np-lead-title\s*\{[^}]*flex:\s*0 0 auto/, '头条标题不收缩，始终留在版面上（标题不隐藏）')
  assert.match(modal, /\.np-lead-text\s*\{[^}]*min-height:\s*1\.85em/, '头条正文保底一行')
  assert.match(modal, /\.np-text-sm\s*\{[^}]*min-height:\s*1\.8em/, '侧栏正文保底一行')
  assert.match(modal, /\.np-world \.np-text\s*\{[^}]*min-height:\s*1\.8em/, '异闻正文保底一行')
  assert.match(clip, /trimArticleText\(el\)/, '装不下的正文由压裁器收省略号')
  assert.match(clip, /observe\(\)/, '版面就绪后补挂 ResizeObserver（窗口缩放要重量）')
})
