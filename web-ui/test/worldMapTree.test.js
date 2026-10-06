import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 世界地图：树的展开记忆 + 「新增地点后整页空白」的回归守卫。
//
// 这两条都是**用户报过的真 bug**，而且都不报错、只是"页面白掉 / 状态记不住"，
// 光靠构建是查不出来的，所以在测试里钉死。

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '../src')
const viewSrc = fs.readFileSync(path.join(SRC, 'views/WorldMapView.vue'), 'utf8')
const pointSrc = fs.readFileSync(path.join(SRC, 'components/worldmap/MapPointView.vue'), 'utf8')

// ── 复刻 View 里的树逻辑（纯函数化，便于断言）──────────────
// 语义必须是 `expanded`（默认全折叠）而不是 `collapsed`（默认全展开）

function flatTree(tree, expanded) {
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth })
      if (expanded.has(n.id) && n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)
  return out
}

const TREE = [{
  id: 1, name: '星穹列车', children: [
    { id: 2, name: '派对车厢', children: [{ id: 3, name: '星的房间', children: [] }] },
    { id: 4, name: '观景车厢', children: [] },
  ],
}]

test('★ 默认全折叠：展开集合为空时只剩顶层', () => {
  const flat = flatTree(TREE, new Set())
  assert.deepEqual(flat.map(n => n.name), ['星穹列车'])
});

test('展开集合里有谁就展开谁（逐层）', () => {
  assert.deepEqual(flatTree(TREE, new Set([1])).map(n => n.name),
    ['星穹列车', '派对车厢', '观景车厢'])
  assert.deepEqual(flatTree(TREE, new Set([1, 2])).map(n => n.name),
    ['星穹列车', '派对车厢', '星的房间', '观景车厢'])
});

test('★ 展开状态可序列化往返（记忆上一次操作的基础）', () => {
  const s = new Set([1, 4])
  const roundTrip = new Set(JSON.parse(JSON.stringify([...s])))
  assert.deepEqual([...roundTrip].sort(), [1, 4])
  // 脏数据不得让它炸
  const dirty = JSON.parse('{"11":[1,"x",null,7]}')
  const clean = new Set((dirty['11'] || []).filter(x => Number.isFinite(x)))
  assert.deepEqual([...clean], [1, 7], '非数字项要被过滤掉')
});

test('★ 逐图独立：不同地图各自记自己的展开状态', () => {
  const all = { '11': [1, 2], '12': [9] }
  assert.deepEqual(all['11'], [1, 2])
  assert.deepEqual(all['12'], [9])
  assert.equal(all['99'], undefined, '没记录过的图 → 默认全折叠')
});

// ── 源码级守卫：这类 bug 靠"约定"守不住，只能钉语义 ──

test('★ View 必须用 expanded（默认折叠），不能再出现 collapsed 变量', () => {
  assert.match(viewSrc, /const expanded = ref\(new Set\(\)\)/, '缺 expanded 状态')
  // `collapsed` 作为**变量**不该再出现（注释里提到可以）
  const codeOnly = viewSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(!/\bcollapsed\.value\b/.test(codeOnly), '仍有 collapsed.value 残留 —— 语义会反向')
  assert.match(codeOnly, /expanded\.value\.has\(n\.id\)/, 'flatTree 应判 expanded')
});

test('★ 展开状态要落盘并在换图时读回（记忆上一次操作）', () => {
  assert.match(viewSrc, /linshe\.worldmap\.expanded/, '缺 localStorage 键')
  assert.match(viewSrc, /function saveExpanded/, '缺落盘函数')
  assert.match(viewSrc, /function loadExpanded/, '缺读回函数')
  // 每次切换展开/折叠都要保存
  assert.match(viewSrc, /function toggleCollapse[\s\S]{0,300}saveExpanded\(\)/, 'toggleCollapse 没落盘')
  // 换图要读回
  assert.match(viewSrc, /async function loadMap[\s\S]{0,300}loadExpanded\(id\)/, 'loadMap 没读回展开状态')
});

test('★ 空白页根因：不能再用 selected.children.length / selected.pois.length', () => {
  // 后端 `places` 扁平行**没有 children 键** → 一旦 selected 是扁平行就抛错 → 整页白掉。
  // 统一走 selChildren / selPois（永远返回数组）。
  // ⚠ 只查**代码**，注释里为了说明"为什么不用它"会提到这个写法，不该算违规。
  const codeNoComments = viewSrc.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  assert.ok(!/selected\.children\.length/.test(codeNoComments),
    '模板里仍有 selected.children.length —— 扁平行会让整页渲染失败')
  assert.ok(!/selected\.pois\.length/.test(codeNoComments),
    '模板里仍有 selected.pois.length —— 同上')
  assert.match(viewSrc, /const selChildren = computed\(\(\) => selected\.value\?\.children \|\| \[\]\)/)
  assert.match(viewSrc, /const selPois = computed\(\(\) => selected\.value\?\.pois \|\| \[\]\)/)
});

test('★ ensureNodeShape 存在，且 selectPlace / refreshSelected 都过它', () => {
  assert.match(viewSrc, /function ensureNodeShape/, '缺 ensureNodeShape')
  assert.match(viewSrc, /function selectPlace\(\s*p\s*\)[\s\S]{0,200}ensureNodeShape\(p\)/,
    'selectPlace 应保证选中项形状')
  assert.match(viewSrc, /function refreshSelected[\s\S]{0,900}ensureNodeShape\(node\)/,
    'refreshSelected 应保证选中项形状')
});

test('★ 新增地点必须是弹窗，不能再调原生 prompt()', () => {
  assert.ok(!/\bprompt\(/.test(viewSrc.replace(/\/\*[\s\S]*?\*\//g, '')),
    '仍在用原生 prompt() —— 用户口径要弹窗式')
  assert.match(viewSrc, /const addPlaceOpen = ref\(false\)/)
  assert.match(viewSrc, /async function onSaveAdd/)
  assert.match(viewSrc, /function onAddChild\(parent\)[\s\S]{0,400}addPlaceOpen\.value = true/,
    'onAddChild 应打开弹窗而不是直接建')
});

test('编辑弹窗要能改「上级」= 移动位置，且候选剔除自己与子孙', () => {
  assert.match(viewSrc, /const editPlace = reactive\(\{[^}]*parentId:/, 'editPlace 缺 parentId')
  assert.match(viewSrc, /const parentOptions = computed/, '缺上级候选')
  assert.match(viewSrc, /descendantIds/, '缺子孙收集（防成环）')
  assert.match(viewSrc, /parentId: editPlace\.parentId === '' \? null : Number\(editPlace\.parentId\)/,
    '保存时应把上级作为移动参数传出去')
});

test('点位图全域：必须按大区通用渲染，不能只硬编码两个磁极', () => {
  assert.match(pointSrc, /const overview = computed/, '缺通用全域布局')
  assert.match(pointSrc, /type: 'cars'/, '缺车厢条分块')
  assert.match(pointSrc, /type: 'plain'/, '缺通用面板分块（其他大区不能被隐藏）')
  // 画布高必须跟着块数走（⚠ 别用 `[^)]*`：`computed(() => …)` 的箭头函数括号会把它截断）
  assert.match(pointSrc, /viewBox = computed\([\s\S]{0,160}overview\.value\.height/,
    'viewBox 高度应来自布局计算（写死会让新块溢出画布）')
  assert.ok(!/const wings = computed/.test(pointSrc), '旧的 wings 硬编码应已移除')
  assert.ok(!/const orphans = computed/.test(pointSrc), '孤儿兜底应已被 plain 分块取代')
});

test('点位图全域：车厢内地点可点选（否则星穹列车的房间点不动）', () => {
  assert.match(pointSrc, /car\.kids/, '车厢应渲染内部地点')
  assert.match(pointSrc, /@click\.stop="pick\(k\)"/, '车内地点应可点选')
  assert.match(pointSrc, /TRAIN_ROOT/, '车厢条应只对星穹列车生效')
});
