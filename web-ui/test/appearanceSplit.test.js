/**
 * 「修正外观」产出文本 → 身体/服装 拆分 —— 回归测试。
 *
 * ★★ 为什么单独测（2026-10-07 用户实报）：
 *   用户用参考图反推「星（开拓者）」后，*身体* 只剩
 *   `short silver-gray hair with a layered messy bob and side-swept bangs, bright golden-yellow eyes`，
 *   而反推原文里的 `Stelle (Honkai: Star Rail)` 身份前缀 + 全套服装**被吞掉** ——
 *   最终生图的角色长相与原设定不一致。
 *   根因：旧实现 `^[^,]{0,70}?\bhas\s+` 把开头整段**直接删除**。
 *
 * ⚠ 拆分的失败是**静默**的：不报错，只是"身体变少了/身份没了"，很难当场发现。必须钉死。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { splitBodyGarment, extractIdentityPrefix } from '../src/utils/appearanceSplit.js'

// 用户实报那条原文（逐字）
const STELLE = 'Stelle (Honkai: Star Rail) has short choppy silver-grey hair with uneven bangs framing her face, bright golden-yellow eyes, a slim build, wearing a white shirt under a dark grey cropped jacket with gold trim and yellow inner lining, a dark grey asymmetrical skirt with a yellow inner layer and a small cyan accent at the hem, a brown belt with a red-handled knife and pouches at the hip, dark fingerless gloves with yellow cuffs, and dark grey ankle boots with yellow accents.'

test('★★★ 身份前缀必须保留进 body（本次 bug 的核心）', () => {
  const r = splitBodyGarment(STELLE)
  assert.equal(r.identity, 'Stelle (Honkai: Star Rail)')
  assert.match(r.body, /Stelle \(Honkai: Star Rail\)/,
    'body 必须保留「角色名 (作品名)」—— 否则生图丢掉角色识别信息')
  assert.match(r.body, /short choppy silver-grey hair/, '身体特征也要在')
  assert.match(r.body, /golden-yellow eyes/, '瞳色要在')
  assert.match(r.body, /slim build/, '体型要在')
})

test('★★ body 不得残留 has/is 这类动词（该列是逗号分隔短语，不是句子）', () => {
  const r = splitBodyGarment(STELLE)
  assert.ok(!/\bhas\b/i.test(r.body), `body 里不该有 has：${r.body}`)
  assert.ok(!/\bhas\b/i.test(r.garment), `garment 里不该有 has：${r.garment}`)
})

test('★★ 服装要完整拆到 garment，且不含任何身体特征', () => {
  const r = splitBodyGarment(STELLE)
  assert.match(r.garment, /white shirt/, '衬衫要在服装里')
  assert.match(r.garment, /cropped jacket/, '外套要在')
  assert.match(r.garment, /asymmetrical skirt/, '裙子要在')
  assert.match(r.garment, /fingerless gloves/, '手套要在')
  assert.match(r.garment, /ankle boots/, '靴子要在')
  // 身体特征不该混进服装（否则每套衣服都会重复描述长相）
  assert.ok(!/hair/i.test(r.garment), `garment 不该含 hair：${r.garment}`)
  assert.ok(!/eyes/i.test(r.garment), `garment 不该含 eyes：${r.garment}`)
})

test('★ body 首段若带身份前缀，不得把「角色名」和「has」写在一起（会产出病句）', () => {
  // 后端 buildSubjectRef 取首段拼 "the girl with ..."，`X has hair` 会拼成
  // "the girl with X has hair"（病句）。所以前缀与特征必须是逗号分隔的两段。
  const r = splitBodyGarment(STELLE)
  const first = r.body.split(',')[0].trim()
  assert.equal(first, 'Stelle (Honkai: Star Rail)')
  assert.ok(!/\bhas\b/i.test(first), '首段不该带 has')
})

test('★ 无身份前缀（原创角色直接写特征）也要正常拆', () => {
  const r = splitBodyGarment('Cyrene has soft pastel pink hair in a fluffy shoulder-length bob, bright blue eyes, wearing a white corset-style bodice.')
  assert.equal(r.identity, 'Cyrene', '裸名也算身份前缀')
  assert.match(r.body, /soft pastel pink hair/)
  assert.match(r.garment, /white corset-style bodice/)
})

test('★ 逗号后没有空格（实测产出过）也要能拆', () => {
  const r = splitBodyGarment('a slim girl with long dark hair,bright red eyes,wearing a black dress')
  assert.match(r.garment, /black dress/, '紧贴逗号的 wearing 也要能识别')
  assert.ok(!/dress/i.test(r.body), '衣服不该留在身体里')
})

test('★ 「wearing no clothing」= 没有服装，整段归身体', () => {
  const r = splitBodyGarment('Cyrene (Honkai: Star Rail) has long pink hair, blue eyes, wearing no clothing')
  assert.match(r.body, /long pink hair/)
  assert.equal(r.garment, '', 'no clothing 不该被当成一件衣服')
})

test('★ 只有服装、没有身体特征时不丢身份前缀', () => {
  const r = splitBodyGarment('Stelle (Honkai: Star Rail), wearing a white shirt')
  assert.equal(r.body, 'Stelle (Honkai: Star Rail)', '身份前缀应归身体，不能随衣服一起丢')
  assert.match(r.garment, /white shirt/)
})

test('★ 纯服装（无身体、无名字）→ body 为空、不瞎猜', () => {
  const r = splitBodyGarment('wearing a red dress and black boots')
  assert.equal(r.body, '')
  assert.match(r.garment, /red dress/)
})

test('★ 空输入安全', () => {
  assert.deepEqual(splitBodyGarment(''), { body: '', garment: '', identity: '' })
  assert.deepEqual(splitBodyGarment(null), { body: '', garment: '', identity: '' })
})

test('★ extractIdentityPrefix：作品名含空格/冒号也要能取全', () => {
  assert.equal(extractIdentityPrefix('Stelle (Honkai: Star Rail) has short hair').prefix, 'Stelle (Honkai: Star Rail)')
  assert.equal(extractIdentityPrefix('Yoimiya (Genshin Impact) has blonde hair').prefix, 'Yoimiya (Genshin Impact)')
  assert.equal(extractIdentityPrefix('no prefix here, just hair').prefix, '')
})

test('★ 身份前缀不能被误当外观特征吃掉（含 hair 词的裸名场景）', () => {
  // `short hair has ...` 这种：开头那段其实是特征，不是名字 → 不该当前缀
  const r = extractIdentityPrefix('short red hair has a ribbon, blue eyes')
  assert.equal(r.prefix, '', '第一段含 hair 时不应被当成角色名')
})

// ═══════════════════════════════════════════════════════════
// ★★ 2026-10-08 用户实报：修「全身」后点「应用到身体并保存」，身体没被覆盖。
//
// 根因是**面具（mask）被当成可换服装**，于是拆点取在 `wears` 处，
// 把「脸 + 面具」整段切走当衣服 —— body 里没了最具辨识度的身体特征。
// 更恶劣的形态：拆不出 body 时回写端 `if (body)` 不成立 → **整个回写被静默跳过**
// （用户看到的就是"点了没反应"）。本组测试钉死这三条路径。
// ═══════════════════════════════════════════════════════════

// 用户实报那条原文（逐字，来自模型产出）
const GIOVANNI = 'Giovanni (Honkai: Star Rail) has pale silvery-lavender hair in a layered chin-length style with side-swept bangs, a pale complexion, and wears a striking mask covering the face, the left side of the mask in deep crimson red with a small white diamond ornament and a gold-rimmed eye opening, the right side in matte black with a curled golden filigree pattern and a dark eye opening'

test('★★★ 面具（mask）属于身体，绝不能被当成衣服切走（本次 bug 的核心）', () => {
  const r = splitBodyGarment(GIOVANNI)
  assert.match(r.body, /striking mask covering the face/,
    '面具是长在脸上的固定特征（不可脱下的"衣物"），必须留在 body —— 切走会让这个角色丢辨识度')
  assert.match(r.body, /deep crimson red/, '面具的左右分色描述也要在身体里')
  assert.match(r.body, /matte black/, '面具另一半同样')
  assert.equal(r.garment, '', '这段没有可换衣物，整段都该归身体')
})

test('★★★ body 不能为空（空 body 会导致回写被静默跳过 = 用户看到"点了没反应"）', () => {
  const r = splitBodyGarment(GIOVANNI)
  assert.ok(r.body.trim().length > 0, 'body 为空时调用方 `if (body)` 会跳过回写，必须非空')
})

test('★★ body 里不得残留句子连接成分（and wears / has）', () => {
  const r = splitBodyGarment(GIOVANNI)
  assert.ok(!/\band\s+wears?\b/i.test(r.body), `body 不该有 "and wears"：${r.body}`)
  assert.ok(!/\b(has|have)\b/i.test(r.body), `body 不该有 has/have：${r.body}`)
  assert.ok(!/\band\s*$/i.test(r.body.trim()), '结尾不该留孤立的 and')
  // 首段仍是纯身份前缀（后端 buildSubjectRef 据它/后续段拼 the girl with ...）
  assert.equal(r.body.split(',')[0].trim(), 'Giovanni (Honkai: Star Rail)')
})

test('★★★ 无 wearing 连接词、且同段既有长相又有衣物词 → 优先保身体，不得判成纯衣服', () => {
  // 旧判据 `BODY_HINT && !CLOTHING_HINT` 在这里会失败 → body 变空 → 静默不回写
  const r = splitBodyGarment('silvery-lavender hair in a layered chin-length style, a pale complexion, a striking mask covering the face')
  assert.match(r.body, /hair/, '有身体特征时必须归身体')
  assert.match(r.body, /mask/, '面具也要在身体里')
  assert.ok(r.body.trim().length > 0, 'body 不得为空')
})

test('★★ 面具这类"长在脸上的固定物"不参与服装判定（mask/veil/horns/wings/halo）', () => {
  for (const [text, keep] of [
    ['Stelle has bright eyes, a half-mask over one eye', /half-mask/],
    ['Cyrene has long pink hair, a translucent veil over her face', /veil/],
    ['X has red horns curling upward, short white hair', /horns/],
    ['Y has small wings on her back, blue eyes', /wings/],
  ]) {
    const r = splitBodyGarment(text)
    assert.match(r.body, keep, `应留在身体里：${text}`)
  }
})

test('★★ 回归：正常「身体, wearing 服装」格式仍要正确拆开', () => {
  const r = splitBodyGarment(STELLE)
  assert.match(r.garment, /white shirt/, '衬衫仍要进服装')
  assert.match(r.garment, /ankle boots/, '靴子仍要进服装')
  assert.ok(!/hair/i.test(r.garment), '身体特征不进服装')
  assert.ok(!/\bhas\b/i.test(r.body), 'body 仍不得残留 has')
})

test('★ 回归：纯服装（无任何身体特征）→ body 仍为空、不瞎塞', () => {
  const r = splitBodyGarment('wearing a red dress and black boots')
  assert.equal(r.body, '', '确实没有身体特征时，body 就该为空（此时调用方保留原值）')
  assert.match(r.garment, /red dress/)
})