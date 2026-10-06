/**
 * 「哈托比亚」—— SFW 图片站（`photos` 形态）的回归测试。
 *
 * 这个站与「规则34」（`gallery`）**共用同一套架构**：画面由服务端确定性生成、
 * 模型只写目录文字。差别只有题材池。所以本测试守的是三类风险：
 *
 *  ① **SFW 纯净性** —— 题材池里不得混入 NSFW 词。这是用户建站的**根本诉求**
 *     （"不使用 NSFW 内容"），也是最容易被日后维护破坏的地方
 *     （比如有人图省事从 `galleryEnvironment.js` 复制粘贴）。
 *  ② **形态归类与隔离** —— photos 必须自成一体：独立分类、不落到瀑布流、
 *     不与 gallery 混排（否则全年龄内容会和成人内容出现在同一档）。
 *  ③ **画面确定性** —— 城市风光必须真的吃地图 `scene_prompt`，
 *     而不是退化成泛泛街景（那是本站在系统里的独特价值）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../src');
const ROOT = path.resolve(__dirname, '../..');
const WEB_SRC = path.join(ROOT, 'web-ui/src');

// 动态 import 绝对路径在 Windows 下必须转 file://（否则 ERR_UNSUPPORTED_ESM_URL_SCHEME: 'e:'）
const { pathToFileURL } = await import('node:url');
const photoMod = await import(pathToFileURL(path.join(SRC_DIR, 'data/photoScenes.js')).href);

const {
  PHOTO_CATEGORIES, CITYSCAPE_FRAMES, PHOTO_ATMOSPHERE, SELFIE_VIEWS,
  FOOD_ITEMS, POSTER_TOPICS, PHOTO_ASPECTS, NSFW_LEAK_WORDS,
} = photoMod;

/** 把题材池里所有英文/中文文本拍平成一个串（用于扫黑名单） */
function flattenPool() {
  const rows = [
    ...CITYSCAPE_FRAMES, ...PHOTO_ATMOSPHERE, ...SELFIE_VIEWS,
    ...FOOD_ITEMS, ...POSTER_TOPICS,
  ];
  return rows.map(r => `${r.en || ''} ${r.cn || ''}`).join(' ').toLowerCase();
}

// ─────────────────────────────────────────────────────────
// ① 站点定位与纯净性
// ─────────────────────────────────────────────────────────

test('哈托比亚：四个题材齐备且分类元数据完整（用户指定：城市风光/美少女自拍/美食打卡/宣传海报）', () => {
  const keys = PHOTO_CATEGORIES.map(c => c.key).sort();
  assert.deepEqual(keys, ['cityscape', 'food', 'poster', 'selfie']);
  for (const c of PHOTO_CATEGORIES) {
    assert.ok(c.label && c.icon, `${c.key} 应有 label 与 icon`);
    assert.equal(typeof c.needsCharacter, 'boolean', `${c.key}.needsCharacter 必须是布尔`);
  }
  // 自拍需要角色出镜；城市风光需要地图场景
  assert.equal(PHOTO_CATEGORIES.find(c => c.key === 'selfie').needsCharacter, true, '自拍必须标注需要角色');
  assert.equal(PHOTO_CATEGORIES.find(c => c.key === 'cityscape').needsMapScene, true, '城市风光必须标注依赖地图场景');
});

test('★★ SFW 纯净性：题材池里不得出现任何 NSFW 词（用户建站的根本诉求）', () => {
  const all = flattenPool();
  const hits = NSFW_LEAK_WORDS.filter(w => {
    const lw = w.toLowerCase();
    // 纯英文词用词边界匹配（避免 `bra` 命中 `brand` 这类误报）；
    // 中文词直接 includes（中文没有词边界概念）。
    if (/^[a-z]+$/.test(lw)) return new RegExp(`\\b${lw}\\b`).test(all);
    return all.includes(lw);
  });
  assert.deepEqual(hits, [], `题材池混入了 NSFW 词：${hits.join('、')}。SFW 站绝不允许出现这些词。`);
});

test('SFW 纯净性：黑名单本身有效（能真的抓出 NSFW 词，不是形同虚设）', () => {
  // 自检：把黑名单里的词拼进一段文本，必须至少命中一个 —— 否则说明黑名单写错了
  const probe = 'a naked girl in a bedroom, penetration, condom, 后入';
  const hits = NSFW_LEAK_WORDS.filter(w => {
    const lw = w.toLowerCase();
    if (/^[a-z]+$/.test(lw)) return new RegExp(`\\b${lw}\\b`).test(probe);
    return probe.includes(lw);
  });
  assert.ok(hits.length >= 4, `黑名单自检失败：探针文本应命中多个词，实际只命中 ${hits.length} 个`);
});

test('城市风光：取景包裹必须且只含 {SCENE} 占位符（画面主体来自地图，不能写死）', () => {
  for (const f of CITYSCAPE_FRAMES) {
    assert.match(f.en, /\{SCENE\}/, `${f.key} 必须用 {SCENE} 占位 —— 城市风光的画面主体只能来自地图场景`);
  }
  // 自拍同理：用 {subject} 占位，运行时替换为角色外观指代
  for (const v of SELFIE_VIEWS) {
    assert.match(v.en, /\{subject\}/, `${v.key} 必须用 {subject} 占位`);
  }
});

// ─────────────────────────────────────────────────────────
// ② 形态归类与隔离
// ─────────────────────────────────────────────────────────

test('形态归类：photos 自成独立分类，且不与 gallery 混排', async () => {
  const svc = await import(pathToFileURL(path.join(SRC_DIR, 'services/mediaService.js')).href);
  assert.ok(svc.MEDIA_CATEGORIES.includes('photos'), 'photos 必须是合法分类');
  assert.deepEqual(svc.CATEGORY_LAYOUTS.photos, ['photos'], 'photos 必须独占一档');
  assert.deepEqual(svc.CATEGORY_LAYOUTS.gallery, ['gallery'], 'gallery 仍独占一档');
  // 两档不能有交集：SFW 与 NSFW 绝不能出现在同一档
  const s = new Set(svc.CATEGORY_LAYOUTS.photos);
  for (const l of svc.CATEGORY_LAYOUTS.gallery) {
    assert.ok(!s.has(l), `photos 与 gallery 不应共享形态 ${l}`);
  }
  // 每个形态仍恰好归属一个分类（新增形态忘了归类时这条会失败）
  for (const k of svc.ALL_LAYOUT_KEYS) {
    const owners = svc.MEDIA_CATEGORIES.filter(c => svc.CATEGORY_LAYOUTS[c].some(l => (l || 'feed') === k));
    assert.equal(owners.length, 1, `形态 ${k} 应恰好属于一个分类，实际：${owners.join('、') || '（无）'}`);
  }
});

test('前端：photos 分类已接线（picker + 渲染分支 + postKind 判定），且不落进瀑布流', () => {
  const s = fs.readFileSync(path.join(WEB_SRC, 'views/MediaView.vue'), 'utf8');
  assert.match(s, /isPhotosOutlet/, '前端必须有 photos 的 picker（否则这一档列不出媒体）');
  assert.match(s, /photos:\s*isPhotosOutlet/, 'CATEGORY_PICKERS 必须登记 photos');
  assert.match(s, /isPhotosCategory/, '必须有 isPhotosCategory 计算属性');
  assert.match(s, /if \(pl\.photos\) return 'photos'/, 'postKind 必须识别 photos 形态（否则图会掉进瀑布流）');
  assert.match(s, /photosPosts/, '必须有 photosPosts 计算属性');
  // 图片站版式复用 MediaGallery —— 若改成别的组件，这条提醒同步改断言
  assert.match(s, /isPhotosCategory && photosPosts\.length/, 'photos 必须有独立渲染分支');
});

test('前端：图片元信息读取器是单一真源（不得在组件里散写 payload.gallery || payload.photos）', () => {
  const masonry = fs.readFileSync(path.join(WEB_SRC, 'utils/galleryMasonry.js'), 'utf8');
  assert.match(masonry, /export function imageMetaOf/, '必须导出 imageMetaOf 作为唯一读取器');
  assert.match(masonry, /payload\?\.gallery \|\| post\?\.payload\?\.photos/, 'imageMetaOf 必须同时支持两个站');

  const comp = fs.readFileSync(path.join(WEB_SRC, 'components/media/MediaGallery.vue'), 'utf8');
  assert.match(comp, /imageMetaOf/, 'MediaGallery 必须用 imageMetaOf 取元信息');
  // 组件内不得再散写"兼容两个站"的三元；读 `payload.gallery.env`（gallery 专属字段）是允许的
  const scattered = comp.match(/payload\?\.gallery \|\|/g) || [];
  assert.equal(scattered.length, 0, '组件内不得再散写 `payload?.gallery ||` 的三元兼容（应走 imageMetaOf）');
});

// ─────────────────────────────────────────────────────────
// ③ 画面确定性与素材来源
// ─────────────────────────────────────────────────────────

test('★ 城市风光必须消费地图 scene_prompt（不是泛泛街景）—— 这是本站的独特价值', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'services/mediaService.js'), 'utf8');
  assert.match(s, /listMapScenePrompts/, '必须有取地图场景的函数');
  assert.match(s, /world_map_places/, '必须从地图表取 scene_prompt');
  assert.match(s, /level = 3/, '应取 lv3 场景（最具体、画面描述最细）');
  // 绝不能只写死一段通用街景 —— 必须有"取不到就退化"的兜底且确实写进提示词
  assert.match(s, /替换|replace\('\?'|\.replace\('\{SCENE\}'/, '城市风光必须把地图场景填进 {SCENE}');
});

test('画幅池：四类题材各有多档，且倾向合理（风光偏横、自拍偏竖、美食偏方）', () => {
  for (const k of ['cityscape', 'selfie', 'food', 'poster']) {
    assert.ok(Array.isArray(PHOTO_ASPECTS[k]) && PHOTO_ASPECTS[k].length >= 2, `${k} 应有至少 2 种画幅`);
  }
  const wide = PHOTO_ASPECTS.cityscape.filter(a => a.w > a.h).length;
  assert.ok(wide >= 2, '城市风光应偏横构图');
  const tall = PHOTO_ASPECTS.selfie.filter(a => a.h > a.w).length;
  assert.ok(tall >= 2, '自拍应偏竖构图（手机自拍的真实构图）');
  const sq = PHOTO_ASPECTS.food.filter(a => Math.abs(a.w - a.h) < 1).length;
  assert.ok(sq >= 1, '美食应有方形（俯拍）构图');
});

test('落库契约：photos 条目存 payload.photos 且含 category/aspect/width/height；标签不含画面参数', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'services/mediaService.js'), 'utf8');
  // normalizePhotoDraft 必须把元信息写进 payload.photos
  const fn = s.slice(s.indexOf('export function normalizePhotoDraft'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /photos:\s*\{/, '必须写 payload.photos');
  assert.match(body, /category:/, 'payload.photos 必须含 category');
  assert.match(body, /aspect:\s*it\.aspect\.key/, 'payload.photos 必须含 aspect');
  assert.match(body, /width:\s*it\.aspect\.w/, 'payload.photos 必须含 width');
  assert.match(body, /height:\s*it\.aspect\.h/, 'payload.photos 必须含 height');
  // 画面参数（比例）绝不能进 tags —— 与规则34 同一口径
  assert.match(body, /isAspectLike/, '必须拦截比例尺进标签');
});

test('补图链路：fillPendingImages 必须同时支持 payload.gallery 与 payload.photos（否则自拍不挂 LoRA）', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'services/mediaService.js'), 'utf8');
  assert.match(s, /payload\?\.gallery \|\| payload\?\.photos/, '补图必须兼容两个站的 payload（自拍条要挂角色 LoRA）');
});

test('生成分派：photos 形态必须走 generatePhotoBatch（不能落进 feed 分支）', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'services/mediaService.js'), 'utf8');
  assert.match(s, /outlet\.layout === 'photos'\) return await generatePhotoBatch/, '必须按形态分派到 generatePhotoBatch');
});