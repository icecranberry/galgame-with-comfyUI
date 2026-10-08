/**
 * 「地图 · AI 追加生活地点」+「地图 · 修正地点」——回归测试。
 *
 * 用户口径（2026-10-07，两条）：
 *  ① 地图要有一个「让 AI 添加生活地点」的按钮，因为**很多时候不需要添加新的下一级**；
 *  ② 「编辑地点」要加**修正**功能，明确要求**参考「角色 → 修正外观」来做**（含样式参考）。
 *
 * 本测试守的核心是**两条正交契约**：
 *  · 追加 POI 绝不能碰下级地点（旧 `/expand` 会 DELETE 掉全部子节点 —— 正是用户想避开的）；
 *  · 修正只出草稿不落库（与角色侧同构：AI 产出先给人看）。
 * 并钉住两个"静默失败"陷阱：出口去重后可能全空、以及字面路由被参数路由吞掉。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const WEB_SRC = path.resolve(__dirname, '../../web-ui/src');

const svc = fs.readFileSync(path.join(SRC, 'services/worldMapService.js'), 'utf8');
const route = fs.readFileSync(path.join(SRC, 'routes/worldMap.js'), 'utf8');
const apiSrc = fs.readFileSync(path.join(WEB_SRC, 'api/index.js'), 'utf8');
const view = fs.readFileSync(path.join(WEB_SRC, 'views/WorldMapView.vue'), 'utf8');
const modal = fs.readFileSync(path.join(WEB_SRC, 'components/worldmap/PlaceRefineModal.vue'), 'utf8');
// 参照物：角色侧的「修正外观」。要求"照那套做" → 两边必须同构，改一边要记得另一边。
const refModal = fs.readFileSync(path.join(WEB_SRC, 'components/AppearanceRefineModal.vue'), 'utf8');

/** 取某个函数的源码段（边界=下一个顶层函数/常量声明） */
function fnBody(src, name) {
  const re = new RegExp(`(?:export )?(?:async )?function ${name}\\(`);
  const hit = re.exec(src);
  if (!hit) return '';
  const i = hit.index;
  const rest = src.slice(i + 10);
  const m = rest.search(/\n(?:export )?(?:async )?function |\n\/\*\* |\n\/\/ ═/);
  return src.slice(i, m > -1 ? i + 10 + m : i + 4000);
}

// ─────────────────────────────────────────────────────────
// ① 后端：追加 POI 与 expandPlace 的语义必须分开
// ─────────────────────────────────────────────────────────

test('★★ 追加 POI 不得删除任何子节点（这正是用户要避开的行为）', () => {
  const fn = fnBody(svc, 'expandPois');
  assert.ok(fn.length > 200, '应能截出 expandPois 函数体');
  assert.ok(!/DELETE\s+FROM/.test(fn), 'expandPois 里不得出现任何 DELETE —— 否则会清掉用户手写的下级地点');
  // 而 expandPlace 确实会 DELETE（幂等"换一批"），两者语义由此区分开
  const exp = fnBody(svc, 'expandPlace');
  assert.match(exp, /DELETE FROM world_map_places WHERE parent_id/, 'expandPlace 仍应是"整体替换"语义');
});

test('★★ 追加 POI 不落库（只返回草稿，由前端确认后随 PUT 保存）', () => {
  const fn = fnBody(svc, 'expandPois');
  assert.ok(!/INSERT INTO world_map_places/.test(fn), 'expandPois 不得自己 INSERT 进库');
  assert.ok(!/UPDATE world_map_places/.test(fn), 'expandPois 不得自己 UPDATE 库');
  assert.match(fn, /return \{ ok: true, pois: out \}/, '应返回"要追加的那几条"给前端');
});

test('★★★ 出口必须与已有条目去重，且全重复时抛错而非返回空数组（红线 0）', () => {
  const fn = fnBody(svc, 'expandPois');
  // 去重键：与库里的 pois_json **以及**前端传来的 excludeNames 合并比对
  assert.match(fn, /excludeNames/, '必须接受前端传来的"表单里已有的名字"');
  assert.match(fn, /safeParse\(place\.pois_json/, '必须读库里的已有 POI');
  assert.match(fn, /blocked\.has\(k\)/, '必须用集合做去重判定');
  // ★ 关键：一条都不剩时必须抛错。静默 return [] 会让用户看到"点了没反应"
  assert.match(fn, /if \(!out\.length\)[\s\S]{0,400}throw /, '全重复时必须抛错，不能静默返回空');
  assert.match(fn, /statusCode: 502|statusCode: 400/, '抛错应带可区分的状态码');
});

test('★ 追加 POI 的负样本只列「名字」——列多了模型会照抄回来', () => {
  const fn = fnBody(svc, 'POI_APPEND_FORMAT');
  assert.match(fn, /existing/, '应接受已有名字');
  // 参数名带显式说明；且格式里用的是 join('、') 这种"纯名字串"
  assert.match(fn, /existing\.join\('、'\)/, '已有名字应以名字列表形式给出');
  assert.match(fn, /严禁重复/, '必须明确告诉模型不要重复');
});

// ─────────────────────────────────────────────────────────
// ② 后端：修正地点（图/文双模）
// ─────────────────────────────────────────────────────────

test('★★ 修正地点两条入口都在，且与角色侧同名同构', () => {
  assert.match(svc, /export async function refinePlaceFromImage/, '应有图片模式');
  assert.match(svc, /export async function refinePlaceFromText/, '应有文字模式');
  // 输出契约必须是三个字段（与弹窗的"可编辑结果框"一一对应）
  const absorb = fnBody(svc, 'absorbPlaceRefine');
  assert.match(absorb, /kind/, '应产出 kind');
  assert.match(absorb, /summary/, '应产出 summary');
  assert.match(absorb, /scenePrompt|scene_prompt/, '应产出画面描述');
});

test('★★ 图片模式要传 image_url 内容块，并给出"不支持视觉模型"的可执行提示', () => {
  const fn = fnBody(svc, 'refinePlaceFromImage');
  assert.match(fn, /image_url/, '应以 image_url 形式送图（与角色修正外观一致）');
  assert.match(fn, /data:image/, '应校验 dataURL 前缀');
  // 中转站报错措辞五花八门，必须按状态码兜底并提示换模型
  assert.match(svc, /不支持图片输入/, '应把"不支持视觉"翻译成人话');
});

test('★★★ 画面描述出口必须清洗 CJK（实测模型会漏中文，直接污染生图提示词）', () => {
  const absorb = fnBody(svc, 'absorbPlaceRefine');
  assert.match(absorb, /\\u4e00-\\u9fff/, '应剔除残留中文字符');
  assert.match(absorb, /replace\(/, '应有清洗动作');
});

test('★★ 修正结果三字段全空时必须抛错，不能静默把表单清空', () => {
  const absorb = fnBody(svc, 'absorbPlaceRefine');
  assert.match(absorb, /if \(!kind && !summary && !scenePrompt\)[\s\S]{0,300}throw /,
    '模型没产出内容时应抛错（否则用户会以为"生成了空内容"）');
});

test('★ 修正地点的提示词必须包含「不要写人」与「全英文」两条生图硬约束', () => {
  const m = svc.match(/const REFINE_PLACE_SYSTEM_PROMPT = `([\s\S]*?)`;/);
  assert.ok(m, '应有 REFINE_PLACE_SYSTEM_PROMPT');
  assert.match(m[1], /全英文/, '必须要求全英文');
  assert.match(m[1], /不要写人|绝对不要写人/, '必须要求不写人');
});

// ─────────────────────────────────────────────────────────
// ③ 路由：字面路径必须早于参数路由（本项目既有约定，踩过）
// ─────────────────────────────────────────────────────────

test('★★ 新增两条路由，且必须注册在 /places/:placeId 之前', () => {
  const i = route.indexOf("'/places/:placeId/poi-draft'");
  const j = route.indexOf("'/places/:placeId/refine-draft'");
  const k = route.indexOf("router.put('/places/:placeId'");
  assert.ok(i > -1, '应有 poi-draft 路由');
  assert.ok(j > -1, '应有 refine-draft 路由');
  assert.ok(k > -1, '应存在 PUT /places/:placeId');
  assert.ok(i < k, 'poi-draft 必须早于参数路由注册');
  assert.ok(j < k, 'refine-draft 必须早于参数路由注册');
});

test('★ 路由按 mode 分发到两个服务函数，且把 placeId 透传', () => {
  assert.match(route, /refinePlaceFromText\(\{ placeId, brief, hints \}\)/, '文字模式接线');
  assert.match(route, /refinePlaceFromImage\(\{ placeId, image, hints \}\)/, '图片模式接线');
  assert.match(route, /mode === 'text'/, '应按 mode 分发');
});

// ─────────────────────────────────────────────────────────
// ④ 前端：两个入口的接线
// ─────────────────────────────────────────────────────────

test('★★ API 层两个新函数与端点', () => {
  assert.match(apiSrc, /export function expandWorldMapPois/, '应导出 expandWorldMapPois');
  assert.match(apiSrc, /\/worldmap\/places\/\$\{placeId\}\/poi-draft/, '端点应为 poi-draft');
  assert.match(apiSrc, /export function refineWorldMapPlaceDraft/, '应导出 refineWorldMapPlaceDraft');
  assert.match(apiSrc, /\/worldmap\/places\/\$\{placeId\}\/refine-draft/, '端点应为 refine-draft');
});

test('★★ 生活地点区有「AI 添加生活地点」按钮，且不与「展开下一级」混淆', () => {
  assert.match(view, /AI 添加生活地点/, '应有该按钮');
  // 提示语要写清"不影响下级地点"，否则用户不敢点
  assert.match(view, /不影响下级地点/, '按钮说明须写明不会动到下級地点');
  assert.match(view, /async function onAiAddPois/, '应有处理函数');
  const fn = fnBody(view, 'onAiAddPois');
  assert.match(fn, /excludeNames/, '必须把表单里已有的名字传上去（含未保存的手改条目）');
  assert.match(fn, /expandWorldMapPois/, '应调用追加接口');
  assert.ok(!/expandWorldMapPlace\(/.test(fn), '不得误调"展开下一级"（那会 DELETE 子节点）');
});

test('★★ 头部操作区有「修正」按钮，并打开修正弹窗', () => {
  // ⚠ 2026-10-07 一站式编辑后，操作按钮只有**一处**（不再有编辑态/非编辑态两份），
  //   所以断言从 `openRefine(selected)` 改为 `openRefine(editPlace)`。
  assert.match(view, /@click="openRefine\(editPlace\)"[^>]*>修正</, '应有「修正」按钮入口');
  assert.match(view, /PlaceRefineModal/, '应挂载修正弹窗组件');
  assert.match(view, /function openRefine/, '应有打开函数');
  assert.match(view, /function onPlaceRefined/, '应有结果回填函数');
});

test('★★★ 「修正」入口应当**只有一个且位置固定**（一站式编辑的核心诉求）', () => {
  // 上一轮它需要"编辑态与非编辑态各放一个"（因为有两套按钮）；
  // 2026-10-07 用户明确要求"功能位置不发生变化" → 现在只应存在一处。
  const calls = view.match(/@click="openRefine\(/g) || [];
  assert.equal(calls.length, 1, `「修正」入口应只有一处（实际 ${calls.length} 处）—— 多份入口正是用户抱怨的"位置变化"`);
  assert.match(view, /openRefine\(editPlace\)/, '应传 editPlace（表单常驻，它就是要改的那个）');
});

test('★★★ 修正结果回填必须先定位/补齐选中节点（否则"修正完页面白掉"）', () => {
  const fn = fnBody(view, 'onPlaceRefined');
  assert.match(fn, /fullFlat\.value\.find|map\.value\?\.places/, '应先从最新数据取节点');
  // 扁平行没有 children 键 → 直接写进 selected 会让模板抛错
  assert.match(fn, /selectPlace\(|ensureNodeShape/, '必须先确保选中节点形状（带 children）');
});

// ─────────────────────────────────────────────────────────
// ⑤ 前端：弹窗与「修正外观」同构（用户明确要求照那套做）
// ─────────────────────────────────────────────────────────

test('★★ 弹窗必须有「用参考图 / 用文字描述」两条入口（与外观修正同构）', () => {
  assert.match(modal, /MODE_OPTIONS/, '应有模式选项');
  assert.match(modal, /value: 'image', label: '用参考图'/, '图片模式');
  assert.match(modal, /value: 'text', label: '用文字描述'/, '文字模式');
  // 参照物侧也必须有同名两条 —— 任何一侧改了名字，这个测试会一起提醒
  assert.match(refModal, /value: 'image', label: '用参考图'/, '参照物（角色侧）口径应保持一致');
});

test('★★ 弹窗支持上传 / 拖拽 / 粘贴（与外观修正同一套交互）', () => {
  assert.match(modal, /@drop\.prevent="onDrop"/, '应支持拖拽');
  assert.match(modal, /addEventListener\('paste', onPaste\)/, '应支持粘贴');
  assert.match(modal, /type="file"/, '应有文件选择');
  assert.match(modal, /6 \* 1024 \* 1024/, '应有 6MB 上限（与角色侧一致）');
  // 文字模式下不劫持粘贴（用户那时是想粘文字）
  const fn = fnBody(modal, 'onPaste');
  assert.match(fn, /mode\.value !== 'image'/, '文字模式不得劫持粘贴');
});

test('★★ 弹窗的结果框可编辑，且"应用"只回传不落库', () => {
  assert.match(modal, /可直接修改/, '结果应可编辑（与外观修正一致）');
  const fn = fnBody(modal, 'apply');
  assert.ok(fn.length > 80, '应能截出 apply');
  assert.match(fn, /emit\('applied'/, '应回传父级');
  assert.ok(!/api\./.test(fn.replace(/api\.refineWorldMapPlaceDraft/g, '')),
    'apply 里不得直接调落库接口 —— 落库由父级决定');
});

test('★★ 弹窗必须 import 本项目的 Linshe 组件（漏 import 会渲染成裸标签）', () => {
  for (const c of ['LinsheModal', 'LinsheButton', 'LinsheInput', 'LinsheTabs']) {
    assert.match(modal, new RegExp(`import ${c} from`), `应 import ${c}`);
  }
});

test('★ 弹窗在文字模式给「找灵感」示例，点了只填输入框', () => {
  assert.match(modal, /BRIEF_SAMPLES/, '应有示例');
  assert.match(modal, /brief = s\.text/, '示例应只填输入框，不直接提交');
});

// ─────────────────────────────────────────────────────────
// ⑥ 行为验证：真跑服务端出口闸门（去重 / 空结果抛错）
//    用 :memory: 库 + 补齐最小表结构，不依赖网络（LLM 调用用假 fetch 拦掉不可行，
//    故这里只测**纯函数**部分：normalizePois 与去重键的等价逻辑）
// ─────────────────────────────────────────────────────────

process.env.DB_PATH = ':memory:';
const { POI_TYPES } = await import('../src/services/worldMapService.js');

test('★★ 行为：POI 类型白名单未变（前端下拉是它的映射，改了要同步）', () => {
  assert.deepEqual(POI_TYPES, ['零售', '餐饮', '服务', '配套']);
});

test('★★ 行为：去重键必须忽略大小写与空白（否则「Coffee」与「coffee」会同时exist）', () => {
  const fn = fnBody(svc, 'expandPois');
  // 归一化写法：trim + toLowerCase + 去空白。任一项少了，去重就会被绕过。
  assert.match(fn, /toLowerCase\(\)/, '去重键应大小写不敏感');
  assert.match(fn, /replace\(\/\\s\+\/g, ''\)/, '去重键应去掉空白');
  assert.match(fn, /\.trim\(\)/, '去重键应去首尾空白');
});