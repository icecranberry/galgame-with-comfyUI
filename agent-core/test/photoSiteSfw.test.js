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
// ─────────────────────────────────────────────────────────
// ④ ★ 禁止出现任何角色名（用户 2026-10-06 口径）
// ─────────────────────────────────────────────────────────
//
// 事实基线：本站早先**刻意不清洗**（当时取舍是"自拍鼓励出现角色名"），提示词里还主动
// 写了「出镜：某某」。模型于是把它当挡箭牌 —— 实测产出作品名「蓝调时刻·爻光」
// 与上传者「爻光本人」（帖子 #585，author_type=anonymous 却带角色名）。
// 用户口径变更：**图片站禁止出现任何角色名**（与规则34 同口径）。
//
// 本组测试钉两面：① 提示词层不再把名字交给模型（治本）
//                 ② 出口层兜底清洗（模型仍可能自己编名字）

const { normalizePhotoDraft, buildPhotoFormatPrompt } = await import(pathToFileURL(path.join(SRC_DIR, 'services/mediaService.js')).href);
const { stripCharacterNames } = await import(pathToFileURL(path.join(SRC_DIR, 'utils/characterNameGuard.js')).href);

const NAMES = ['爻光', '姬子', '真珠', '朽叶'];
const BOARDS = [{ id: 1, name: '美少女自拍' }, { id: 2, name: '城市风光' }];
const mkPlan = () => ([
  { category: 'selfie', placeName: '', aspect: { key: '1:1', w: 1, h: 1 }, prompt: 'P1', tags: ['窗边'], castId: 9, castName: '爻光' },
  { category: 'cityscape', placeName: '真珠办公室', aspect: { key: '16:9', w: 16, h: 9 }, prompt: 'P2', tags: ['倒影'], castId: null, castName: '' },
]);

test('★★ 提示词：自拍条不得把角色名交给模型（否则模型必然照抄进作品名）', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'services/mediaService.js'), 'utf8');
  const fn = s.slice(s.indexOf('export function buildPhotoFormatPrompt'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(!/出镜：\$\{it\.castName\}/.test(body), '提示词仍在用 `出镜：${it.castName}` —— 角色名会泄漏');
  assert.match(body, /一名少女/, '自拍条应改为无名的"一名少女"');
  // 作者名与备注同样要禁止
  assert.match(fn.slice(0, fn.indexOf('return `')), /it\.castName|出镜/, '自拍条仍应说明"有一个人"（但不给名字）');
});

test('★★ 提示词：明确写「绝对禁止出现任何人名/角色名」', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'services/mediaService.js'), 'utf8');
  const fn = s.slice(s.indexOf('export function buildPhotoFormatPrompt'));
  const body = fn.slice(0, fn.indexOf('`;\n}'));
  assert.match(body, /绝对禁止出现任何人名/, '缺少禁止人名的显式规则');
  // 并点明"地点可以照抄"的例外情形（否则模型会连地名一起不敢写）；
  // ⚠ 断言只认概念不认措辞 —— 措辞会为"提示词里不出现具体人名"而反复微调
  assert.match(body, /照抄\*\*地点\*\*不算违规/, '缺少"地名例外"的说明');
});

test('★★ 提示词正文里不得出现任何具体角色名（连反例也不行）', () => {
  // 踩过的坑：反例写成「写「蓝调时刻·爻光」这类…是错的」—— 名字仍出现在提示词里，
  // 模型照样可能被这个"名字样本"带偏。正确做法是反例也用无名占位。
  const boards = [{ id: 1, name: '美少女自拍' }];
  const plan = [{
    category: 'selfie', placeName: '', tags: ['窗边'], castId: 9, castName: '爻光',
    aspect: { key: '1:1', w: 1, h: 1 }, prompt: 'p',
  }];
  const prompt = buildPhotoFormatPrompt({ name: '哈托比亚', tagline: '' }, boards, plan);
  for (const n of NAMES) {
    assert.ok(!prompt.includes(n), `提示词正文里泄漏了角色名「${n}」`);
  }
  // 清单里自拍条必须用无名称呼
  assert.match(prompt, /出镜：一名少女/, '自拍条应用无名占位');
});

test('★★ 出口兜底：normalizePhotoDraft 必须接 forbiddenNames 并清洗可见字段', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'services/mediaService.js'), 'utf8');
  const fn = s.slice(s.indexOf('export function normalizePhotoDraft'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(fn.slice(0, 400), /opts = \{\}/, 'normalizePhotoDraft 应接受 opts');
  assert.match(body, /forbiddenNames/, '必须读取 forbiddenNames');
  assert.match(body, /stripCharacterNames/, '必须调 stripCharacterNames 清洗');
});

test('★★ 行为：可见字段（title/content/tags/author）零角色名', () => {
  const raw = { posts: [
    { board: '美少女自拍', title: '蓝调时刻·爻光', content: '今天心情不错，随手拍了一张。', author: '爻光本人', likes: 100, views: 900 },
    { board: '城市风光', title: '真珠办公室 窗外', content: '下班路上拍的，天气很好。', author: '老陈拍城', likes: 50, views: 600 },
  ] };
  const out = normalizePhotoDraft(raw, BOARDS, mkPlan(), { forbiddenNames: NAMES });
  assert.equal(out.length, 2);
  for (const d of out) {
    for (const [f, v] of [['title', d.title], ['content', d.content], ['author', d.author_name], ['tags', JSON.stringify(d.tags)]]) {
      for (const n of NAMES) {
        assert.ok(!String(v).includes(n), `${f} 仍含角色名「${n}」：${v}`);
      }
    }
  }
  // 具体断言：还原真实案例
  assert.equal(out[0].title, '蓝调时刻', '「蓝调时刻·爻光」应洗成「蓝调时刻」');
  assert.equal(out[0].author_name, '本人', '「爻光本人」应洗成「本人」');
  // 地名含角色名时，"的"等虚词要一并收掉，不留残句
  assert.equal(out[1].title, '办公室 窗外', '地名清洗后不应留下以虚词开头的残句');
});

test('★ 兜底标题（模型没写）也必须清洗 —— 地点名是另一个泄漏口', () => {
  const plan = [{
    category: 'cityscape', placeName: '姬子的个人房间', aspect: { key: '1:1', w: 1, h: 1 },
    prompt: 'P', tags: [], castId: null, castName: '',
  }];
  const out = normalizePhotoDraft({ posts: [{}] }, BOARDS, plan, { forbiddenNames: NAMES });
  assert.equal(out[0].title, '个人房间', '兜底标题「姬子的个人房间」应洗成「个人房间」');
  for (const n of NAMES) assert.ok(!out[0].title.includes(n));
});

test('★ 全洗空时回落「随手拍」—— 标题绝不为空（红线：不静默丢内容）', () => {
  const plan = [{
    category: 'cityscape', placeName: '真珠', aspect: { key: '1:1', w: 1, h: 1 },
    prompt: 'P', tags: [], castId: null, castName: '',
  }];
  const out = normalizePhotoDraft({ posts: [{ title: '朽叶' }] }, BOARDS, plan, { forbiddenNames: NAMES });
  assert.ok(out[0].title && out[0].title.length > 0, '标题被清空了');
  assert.equal(out[0].title, '随手拍');
});

test('★★ 内部字段必须保留角色名 —— 洗了会丢出镜身份（生图挂 LoRA 要用）', () => {
  const out = normalizePhotoDraft({ posts: [{ title: '蓝调时刻·爻光', author: '爻光本人' }] }, BOARDS, mkPlan(), { forbiddenNames: NAMES });
  // castNames 是内部字段、前端不展示，必须保留原名
  assert.deepEqual(out[0].payload.photos.castNames, ['爻光'], 'castNames 不该被清洗');
  assert.equal(out[0].payload.photos.castId ?? out[0].payload.photos.castIds?.[0], 9, 'castIds 不该被清洗');
  // placeName 是地图地名，同样保留
  assert.equal(out[1].payload.photos.placeName, '真珠办公室', 'placeName 是地名，不该被清洗');
});

test('★ 不传 forbiddenNames 时行为与上线前一致（默认不改行为）', () => {
  const raw = { posts: [{ board: '美少女自拍', title: '蓝调时刻·爻光', content: '拍了一张。', author: '爻光本人', likes: 1, views: 9 }] };
  const out = normalizePhotoDraft(raw, BOARDS, [mkPlan()[0]]);
  assert.equal(out[0].title, '蓝调时刻·爻光', '不传清单时不应清洗');
  assert.equal(out[0].author_name, '爻光本人');
});

test('★ 生成路径必须真的把 forbiddenNames 传下去（否则兜底形同虚设）', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'services/mediaService.js'), 'utf8');
  const fn = s.slice(s.indexOf('async function generatePhotoBatch'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /listCharacterDisplayNames\(\)/, 'generatePhotoBatch 必须取角色名清单');
  // ⚠ 不能用 `normalizePhotoDraft\([^)]*forbiddenNames` —— 实参里有 `JSON.parse(...)`，
  //   第一个 `)` 就会截断匹配。改为直接找含 forbiddenNames 的那次调用行。
  assert.match(body, /normalizePhotoDraft\([\s\S]*?\{\s*forbiddenNames\s*\}/, '必须把 forbiddenNames 传给 normalizePhotoDraft');
});

test('★★ 历史数据清洗迁移：存在、带一次性标记、只洗可见字段、不碰 payload', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'db/index.js'), 'utf8');
  assert.match(s, /media_photos_dename_v1/, '缺少哈托比亚去名迁移的一次性标记');
  assert.match(s, /payload_json LIKE '%"photos"%'/, '迁移应只针对 photos 形态的帖子');
  const i = s.indexOf('media_photos_dename_v1');
  const seg = s.slice(Math.max(0, i - 3000), i + 2500);
  assert.match(seg, /UPDATE media_posts SET title = \?, content = \?, author_name = \?/, '只洗这三个可见字段');
  assert.ok(!/UPDATE media_posts SET[^?]*payload_json/.test(seg), 'payload_json 不该被改写（内含地名与 castNames）');
});

test('★ 与规则34 同口径：两站共用同一个清洗实现（单一真源）', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'services/mediaService.js'), 'utf8');
  // 两个规整器都必须用 stripCharacterNames
  const gal = s.slice(s.indexOf('export function normalizeGalleryDraft'));
  const pho = s.slice(s.indexOf('export function normalizePhotoDraft'));
  assert.match(gal.slice(0, 12000), /stripCharacterNames/, 'gallery 应使用统一清洗');
  assert.match(pho.slice(0, 12000), /stripCharacterNames/, 'photos 应使用统一清洗');
  // 不得自造第二套正则
  assert.ok(!/function stripCharacterNames/.test(s), 'mediaService 不应另写一份清洗实现');
});
