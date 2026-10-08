import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`mediaLayouts test forbids network: ${url}`); };

const {
  MEDIA_CATEGORIES, CATEGORY_LAYOUTS, OUTLET_LAYOUTS, ALL_LAYOUT_KEYS,
  isPeriodicalLayout, normalizeForumDraft, normalizeGalleryDraft, listArtistPool,
  GALLERY_ASPECTS, pickRandomPoses, resolvePoseVariants, buildPoseImagePrompt, buildSubjectRef,
  preferPetitePool, girlsNeeded, buildGalleryFormatPrompt,
} = await import('../src/services/mediaService.js');
const { SEX_POSITIONS } = await import('../src/data/sexPositions.js');
const { stripCharacterNames } = await import('../src/utils/characterNameGuard.js');

// 覆盖范围：
// 1) 论坛/图库两个新形态：各恰好归一个分类，且不误归（分类漏判会让整档「点了没反应」）
// 2) 论坛规整器：楼层号必须重编号、越界引用必须清掉（否则前端「引用 #9」指向不存在的楼）
// 3) 图库规整器：缺 image_prompt 必须丢弃（图站没图就没意义）；画师串由服务端注入
// 4) 论坛/图库都不得被算成「按期出刊」（否则顶栏会出现「出刊」按钮）

test('新形态各有归属：forum / gallery 各恰好属于一个分类', () => {
  const owners = (layout) => MEDIA_CATEGORIES.filter(c => CATEGORY_LAYOUTS[c].some(l => (l || 'feed') === layout));
  for (const k of ALL_LAYOUT_KEYS) {
    assert.equal(owners(k).length, 1, `形态 ${k} 应恰好属于一个分类，实际：${owners(k).join('、') || '（无）'}`);
  }
  assert.deepEqual(CATEGORY_LAYOUTS.forum, ['forum']);
  assert.deepEqual(CATEGORY_LAYOUTS.gallery, ['gallery']);
  // 回归：feed 仍只归 social，别被新档抢走
  assert.deepEqual(CATEGORY_LAYOUTS.social, [null]);
});

test('新建选项含两个新形态；weekly 仍不在新建列表里', () => {
  const keys = OUTLET_LAYOUTS.map(l => l.key);
  assert.ok(keys.includes('forum'));
  assert.ok(keys.includes('gallery'));
  assert.ok(!keys.includes('weekly'));
  for (const l of OUTLET_LAYOUTS) assert.ok(l.label && l.hint, `${l.key} 缺 label/hint`);
});

test('论坛/图库都不是「按期出刊」形态（不应出现出刊按钮与期号导航）', () => {
  for (const k of ['forum', 'gallery']) assert.equal(isPeriodicalLayout(k), false, k);
});

// ── 论坛规整 ──

const BOARDS = [{ id: 11, name: '综合版' }, { id: 12, name: '求助版' }];

test('论坛规整：楼层号按数组顺序重编（不信模型给的号）', () => {
  const out = normalizeForumDraft({
    posts: [{
      board: '综合版', title: '标题', content: '正文',
      replies: [
        { floor: 7, author: '甲', content: 'A' },
        { floor: 3, author: '乙', content: 'B' },
        { floor: 99, author: '丙', content: 'C' },
      ],
    }],
  }, BOARDS);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].payload.forum.replies.map(r => r.floor), [1, 2, 3]);
});

test('论坛规整：引用号越界必须清空（否则前端显示「引用 #9」而根本没有 9 楼）', () => {
  const out = normalizeForumDraft({
    posts: [{
      board: '综合版', title: '标题', content: '正文',
      replies: [
        { author: '甲', content: 'A', quote: 99 },
        { author: '乙', content: 'B', quote: 1 },
      ],
    }],
  }, BOARDS);
  const rs = out[0].payload.forum.replies;
  assert.equal(rs[0].quote, null, '越界引用应清空');
  assert.equal(rs[1].quote, 1, '合法引用应保留');
});

test('论坛规整：板块名对不上时 board_id 为 null（不猜）；缺标题/正文的条目丢弃', () => {
  const out = normalizeForumDraft({
    posts: [
      { board: '不存在的版', title: 'T', content: 'C', replies: [] },
      { board: '综合版', title: '', content: 'C' },
      { board: '求助版', title: 'T2', content: '', replies: [] },
    ],
  }, BOARDS);
  assert.equal(out.length, 1);
  assert.equal(out[0].board_id, null);
});

test('论坛规整：无回复时 replies 为空数组（不是 undefined）', () => {
  const out = normalizeForumDraft({ posts: [{ board: '综合版', title: 'T', content: 'C' }] }, BOARDS);
  assert.deepEqual(out[0].payload.forum.replies, []);
});

test('论坛规整：缺 image_prompt 时存 null（论坛允许无图，这是常态）', () => {
  const out = normalizeForumDraft({ posts: [{ board: '综合版', title: 'T', content: 'C', replies: [] }] }, BOARDS);
  assert.equal(out[0].image_prompt, null);
});

// ── 图库规整（画面由服务端 plan 决定，模型只给文字）──

const GAL_BOARD = [{ id: 21, name: '原创' }];
const mkPlan = (n = 2) => Array.from({ length: n }, (_, i) => ({
  pose: { no: String(i + 1).padStart(3, '0'), name: `体位${i + 1}`, frozen: '定格描述', core: ['doggystyle', 'sex'], boys: 1, girls: 1, solo: false },
  artist: `@artist-${i + 1}`,
  aspect: { key: '3:4', w: 1200, h: 1600 },
  imagePrompt: `the girl is doing thing ${i + 1}`,
  negative: 'solo, extra limbs',
  frame: 'cowboy shot',
  girls: 1,
  girlNames: [`角色${i + 1}`],
}));

test('图库规整：plan 里没有 image_prompt 的条目丢弃（图站没图就没意义）', () => {
  const plan = mkPlan(2);
  plan[0].imagePrompt = '';
  const out = normalizeGalleryDraft({ posts: [{ title: 'A' }, { title: 'B' }] }, GAL_BOARD, plan);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'B');
});

test('图库规整：画师串 / 画幅 / 负向都从 plan 注入 payload.gallery', () => {
  const out = normalizeGalleryDraft({ posts: [{ title: 'A' }, { title: 'B' }] }, GAL_BOARD, mkPlan(2));
  assert.equal(out[0].payload.gallery.artist, '@artist-1');
  assert.equal(out[1].payload.gallery.artist, '@artist-2');
  assert.equal(out[0].payload.gallery.aspect, '3:4');
  assert.equal(out[0].payload.gallery.width, 1200);
  assert.equal(out[0].payload.gallery.height, 1600);
  assert.equal(out[0].payload.gallery.negative, 'solo, extra limbs');
});

test('图库规整：tags 以 NSFW 体位为主（体位名打头，且带核心英文标签）', () => {
  const out = normalizeGalleryDraft({ posts: [{ title: 'A' }, { title: 'B' }] }, GAL_BOARD, mkPlan(2));
  assert.equal(out[0].tags[0], '体位1', '体位名必须是第一标签');
  assert.ok(out[0].tags.includes('doggystyle'), '核心英文 NSFW 标签要进去');
  assert.ok(out[0].tags.length <= 12);
});

// ── 环境层（7 维）接线 ──
// 环境层由 `pickGalleryEnvelope` 抽好，随 plan 传进来；这里只验证**接线**：
// 标签有没有进去、payload 有没有存维度信息（前端左栏分组与详情页都要用）。

test('图库规整：环境层标签进 tags，且 payload.gallery.env 保留维度信息', () => {
  const plan = mkPlan(1);
  plan[0].env = [
    { dim: 'scene', en: 'open-air onsen', cn: '露天温泉' },
    { dim: 'lighting', en: 'moonlight', cn: '月光' },
    { dim: 'prop', en: 'collar and leash', cn: '项圈与牵引绳' },
  ];
  const out = normalizeGalleryDraft({ posts: [{ title: 'T' }] }, GAL_BOARD, plan);
  for (const t of ['open-air onsen', 'moonlight', 'collar and leash']) {
    assert.ok(out[0].tags.includes(t), `环境标签「${t}」没进 tags`);
  }
  // 体位名仍在第一位（检索主键不能被环境层顶掉）
  assert.equal(out[0].tags[0], '体位1');
  // 维度信息必须留着 —— 否则前端无法分组（只能按次数排序，会被体位名占满）
  assert.deepEqual(out[0].payload.gallery.env, plan[0].env);
});

test('图库规整：环境层标签去重（与体位 core 词重复时不重复出现）', () => {
  const plan = mkPlan(1);
  plan[0].pose = { ...plan[0].pose, core: ['sex', 'doggystyle'] };
  plan[0].env = [{ dim: 'prop', en: 'sex', cn: '性爱' }];
  const out = normalizeGalleryDraft({ posts: [{ title: 'T' }] }, GAL_BOARD, plan);
  assert.equal(out[0].tags.filter(t => t === 'sex').length, 1);
});

test('图库规整：没有环境层时行为不变（向后兼容旧 plan）', () => {
  const out = normalizeGalleryDraft({ posts: [{ title: 'A' }] }, GAL_BOARD, mkPlan(1));
  assert.deepEqual(out[0].payload.gallery.env, []);
  assert.ok(out[0].tags.length <= 12);
});

test('★ 环境层标签同样要过角色名清洗（出口兜底对新维度也生效）', () => {
  const plan = mkPlan(1);
  plan[0].env = [{ dim: 'scene', en: '爻光的房间', cn: 'x' }];
  const out = normalizeGalleryDraft({ posts: [{ title: 'T' }] }, GAL_BOARD, plan, { forbiddenNames: ['爻光'] });
  assert.ok(!out[0].tags.some(t => t.includes('爻光')), '环境标签漏过了清洗');
});

test('图库规整：模型没给标题时用**体位名**兜底（不是「角色·体位」），不丢条目', () => {
  const out = normalizeGalleryDraft({ posts: [{ title: '' }, {}] }, GAL_BOARD, mkPlan(2));
  assert.equal(out.length, 2);
  assert.equal(out[0].title, '体位1');
  // ★ 兜底也必须**不含角色名**（早先兜底是 `${角色名}·${体位名}`，是角色名的另一个泄漏口）
  for (const d of out) assert.ok(!d.title.includes('角色'), `兜底标题里仍有角色名：${d.title}`);
});

// ── ★ 规则34 不许出现角色名（用户口径）──
// 背景：`buildGalleryFormatPrompt` 曾把角色名（出镜名单）交给模型，模型照抄进作品名，
// 产出「爻光·毒龙 01」「姬子 压墙式」「姬子×朽叶 双重骑乘」。两道防线一起守：
//   ① 提示词层：**不再把角色名告诉模型**（治本）
//   ② 出口层：`stripCharacterNames` 兜底清洗（模型仍可能自己编名字）

test('★ 图库提示词：不得把角色名交给模型（否则模型必然照抄进作品名）', () => {
  const plan = mkPlan(1);
  plan[0].girlNames = ['爻光', '朽叶'];
  const prompt = buildGalleryFormatPrompt({ name: '规则34', tagline: '' }, GAL_BOARD, plan);
  assert.ok(!prompt.includes('爻光'), '提示词里泄漏了角色名「爻光」');
  assert.ok(!prompt.includes('朽叶'), '提示词里泄漏了角色名「朽叶」');
  // 但"画面构成"要照给：体位名仍在，人数仍按画面算
  assert.ok(prompt.includes('体位1'), '体位名丢了吗？');
  // 作品名规则里必须明确禁名（光不给名单不够 —— 模型可能从别处编）
  assert.match(prompt, /禁止出现任何人名/);
});

test('★ stripCharacterNames：名字连同紧随的分隔符一起吃掉，不留残句', () => {
  const names = ['爻光', '朽叶', '姬子', '三月七'];
  // 真实产物里出现过的四种形态
  assert.equal(stripCharacterNames('爻光·毒龙 01', names), '毒龙 01');
  assert.equal(stripCharacterNames('姬子 压墙式', names), '压墙式');
  assert.equal(stripCharacterNames('朽叶 亚马逊式上位', names), '亚马逊式上位');
  assert.equal(stripCharacterNames('姬子×朽叶 双重骑乘', names), '双重骑乘');
  assert.equal(stripCharacterNames('爻光·后入卧位（附差分）', names), '后入卧位（附差分）');
  // 不含名字时逐字不变
  assert.equal(stripCharacterNames('颜面骑乘 02', names), '颜面骑乘 02');
  // ★ 名字在**句中**：中文不用空格分词，应直接删除且**保留正文逗号**
  //   （真实备注：「本来只想画姬子，结果下面那位太抢戏」）
  assert.equal(
    stripCharacterNames('本来只想画姬子，结果下面那位太抢戏', ['姬子']),
    '本来只想画，结果下面那位太抢戏',
    '不能留下「画 结果」这种断口，也不能把正文逗号吃掉',
  );
  // 名字夹在中文词之间（前后都是汉字）→ 删掉后不得粘连出多余空格
  assert.equal(stripCharacterNames('都是姬子画的', ['姬子']), '都是画的');
  // 单字名不参与（噪声太大）—— 传个单字名不该把正文切烂
  assert.equal(stripCharacterNames('火花 与 花', ['花']), '火花 与 花');
  // 绝不抛错（迁移里在循环内调用）
  assert.equal(stripCharacterNames(null, names), '');
  assert.equal(stripCharacterNames('正常文本', null), '正常文本');
});

test('★ 回归：纯英文标签绝不能被"清洗"吃掉（分隔符字符集曾写成 regex 字面量 → 变成巨大区间）', () => {
  // 曾经的 bug：`/[...|\\-—/]/` 里 `\\` 是转义反斜杠，后面的 `-` 成了范围运算符，
  // 构造出 `\`(U+005C) 到 `—`(U+2014) 的区间，把 a-z/A-Z 全吃进去 ——
  // 结果是 `doggystyle` 被整条清空（图库标签测试随之变假）。
  const names = ['爻光', '姬子'];
  for (const t of ['doggystyle', 'double penetration', 'suspended', 'sex', 'girl on top', 'x-ray']) {
    assert.equal(stripCharacterNames(t, names), t, `英文标签被误清洗：${t}`);
  }
  // 连数字结尾也不能被当成分隔符吃掉
  assert.equal(stripCharacterNames('毒龙 01', names), '毒龙 01');
  assert.equal(stripCharacterNames('颜面骑乘 02', names), '颜面骑乘 02');
});

test('★ 图库规整：标题/备注/署名里的角色名被洗净（连分隔符）', () => {
  const plan = mkPlan(2);
  plan[0].girlNames = ['爻光'];
  plan[1].girlNames = ['姬子'];
  const out = normalizeGalleryDraft({
    posts: [
      { title: '爻光·毒龙 01', content: '画了爻光好久，求续作', author: '爻光的粉' },
      { title: '姬子 压墙式', content: '又被姬子坑了', author: '姬子' },
    ],
  }, GAL_BOARD, plan, { forbiddenNames: ['爻光', '姬子', '朽叶'] });

  assert.equal(out[0].title, '毒龙 01');
  assert.equal(out[1].title, '压墙式');
  for (const d of out) {
    const blob = [d.title, d.content, d.author_name, ...d.tags].join(' ');
    for (const n of ['爻光', '姬子', '朽叶']) {
      assert.ok(!blob.includes(n), `条目里仍有角色名「${n}」：${blob}`);
    }
  }
  // 署名被洗空时要回落匿名，不能留空串
  assert.ok(out[1].author_name.trim().length > 0);
  // 出镜名单仍存进 payload（生图挂 LoRA 要用），只是**不显示、不进文本**
  assert.deepEqual(out[0].payload.gallery.castNames, ['爻光']);
});

test('图库规整：按**下标**对齐（模型顺序错乱也不张冠李戴）', () => {
  const out = normalizeGalleryDraft({ posts: [{ title: '甲' }, { title: '乙' }] }, GAL_BOARD, mkPlan(2));
  assert.equal(out[0].payload.gallery.artist, '@artist-1');
  assert.equal(out[1].payload.gallery.artist, '@artist-2');
});

test('图库规整：plan 为空时抛错（不能静默交空批）', () => {
  assert.throws(() => normalizeGalleryDraft({ posts: [] }, [], []), /没有可用的图库条目/);
});

// ── 体位池 ──

test('体位池：84 条、字段齐全、变体组可解析', () => {
  assert.ok(SEX_POSITIONS.length >= 80, `体位池太小：${SEX_POSITIONS.length}`);
  for (const p of SEX_POSITIONS) {
    assert.ok(p.no && p.name, '缺编号或名字');
    assert.ok(p.prompt && p.prompt.length > 20, `${p.no} 提示词太短`);
    assert.ok(Array.isArray(p.frames) && p.frames.length > 0, `${p.no} 缺画幅候选`);
    assert.ok(p.girls >= 1, `${p.no} 女方人数异常`);
  }
  // 名字不得重复（否则「随机 1 种」会出现同一条目两条）
  assert.equal(new Set(SEX_POSITIONS.map(p => p.name)).size, SEX_POSITIONS.length);
});

test('体位池：人数推导正确（多女/多男不被算成 1）', () => {
  const byNo = new Map(SEX_POSITIONS.map(p => [p.no, p]));
  assert.equal(byNo.get('002').girls, 2, '002 叠罗汉后入是 2 女');
  assert.equal(byNo.get('002').boys, 1);
  assert.equal(byNo.get('046').boys, 2, '046 站立悬空双插是 2 男');
  assert.equal(byNo.get('046').girls, 1);
  // 至少要有几条多女与多男，否则"随机"退化成永远 1v1
  assert.ok(SEX_POSITIONS.filter(p => p.girls >= 2).length >= 5, '多女体位太少');
  assert.ok(SEX_POSITIONS.filter(p => p.boys >= 2).length >= 5, '多男体位太少');
});

test('resolvePoseVariants：每个 [a / b / c] 组取一项，且无残留方括号', () => {
  const src = 'she is [on her back / on her side / standing] with [his hands on her ass / on her waist]';
  for (let i = 0; i < 20; i++) {
    const out = resolvePoseVariants(src);
    assert.ok(!/[\[\]]/.test(out), `还有方括号残留：${out}`);
    assert.ok(/on her back|on her side|standing/.test(out), '第一组没被替换');
    assert.ok(/on her ass|on her waist/.test(out), '第二组没被替换');
  }
});

test('buildPoseImagePrompt：变体已解析、画幅已追加、负向原样带出', () => {
  const pose = { prompt: 'the girl is [kneeling / sitting] before the man', frames: ['close-up'], negative: 'male face' };
  const r = buildPoseImagePrompt(pose);
  assert.ok(!/\[|\]/.test(r.prompt));
  assert.match(r.prompt, /close-up\.$/);
  assert.equal(r.negative, 'male face');
  assert.ok(['kneeling', 'sitting'].some(w => r.prompt.includes(w)));
});

test('buildPoseImagePrompt：the girl / the boy 被替换，且**不得出现中文**（提示词是纯英文的）', () => {
  const pose = { prompt: 'the boy is behind the girl, and the girl 2 watches', frames: ['cowboy shot'], negative: '' };
  const r = buildPoseImagePrompt(pose, {
    subject: 'the girl with long black hair',
    girlRefs: ['the girl with long black hair', 'the girl with silver hair'],
  });
  // ★ 断言的是「**裸** the girl（后面不跟外观描述）」已被替换。
  //   合法指代形如 `the girl with long black hair` 本身就含子串 `the girl`，
  //   所以必须用负向先行排除 `with …`，不能写成 `!/\bthe girl\b/`（会误报）。
  assert.ok(!/\bthe girl\b(?!\s+with)/.test(r.prompt), `裸 the girl 未替换：${r.prompt}`);
  assert.ok(!/\bthe girl \d\b/.test(r.prompt), 'the girl 编号未替换');
  assert.ok(r.prompt.includes('the girl with long black hair'));
  assert.ok(r.prompt.includes('the girl with silver hair'), '第二个女方应用第二个英文指代');
  assert.ok(!/\bthe boy\b/.test(r.prompt), 'the boy 应换成 the man');
  // ★ 中文角色名绝不能进提示词（会与 "ALL text in English" 的生图规则打架）
  assert.ok(!/[\u4e00-\u9fa5]/.test(r.prompt), `提示词里混入了中文：${r.prompt}`);
});

test('buildPoseImagePrompt：缺第二个指代时回落到 subject，不残留编号', () => {
  const pose = { prompt: 'the girl 1 and the girl 2', frames: ['close-up'], negative: '' };
  const r = buildPoseImagePrompt(pose, { subject: 'the girl with long black hair', girlRefs: ['the girl with long black hair'] });
  assert.ok(!/the girl \d/.test(r.prompt));
  assert.equal((r.prompt.match(/the girl with long black hair/g) || []).length, 2);
});

test('★ 回归：指代替换不得级联（the girl 2 → 指代后被裸规则二次命中）', () => {
  // 曾经的 bug：先替 `the girl 2` → `the girl with silver hair`，再替裸 `the girl`，
  // 第二遍命中了刚插入的指代，串成 `the girl with long black hair with silver hair`。
  const pose = { prompt: 'the girl 1 with the girl 2', frames: ['close-up'], negative: '' };
  const r = buildPoseImagePrompt(pose, {
    subject: 'the girl with long black hair',
    girlRefs: ['the girl with long black hair', 'the girl with silver hair'],
  });
  assert.ok(!/with long black hair with silver hair/.test(r.prompt), `发生级联：${r.prompt}`);
  assert.ok(!/with silver hair with /.test(r.prompt), `发生级联：${r.prompt}`);
  // 恰好各出现一次，且按序对应
  assert.equal((r.prompt.match(/the girl with long black hair/g) || []).length, 1);
  assert.equal((r.prompt.match(/the girl with silver hair/g) || []).length, 1);
  assert.ok(r.prompt.indexOf('long black hair') < r.prompt.indexOf('silver hair'));
});

test('buildSubjectRef：无英文身体描述时返回 null（由调用方回落泛称，不塞中文名）', () => {
  assert.equal(buildSubjectRef(null), null);
  // 找一个没有 character_outfits.body 的角色 → 必须为 null（而不是返回 display_name）
  const noBody = { id: -99999, display_name: '某个中文名' };
  assert.equal(buildSubjectRef(noBody), null);
});

test('pickRandomPoses：不重复优先，池子够时不出现重复', () => {  const got = pickRandomPoses(10);
  assert.equal(got.length, 10);
  assert.equal(new Set(got.map(p => p.no)).size, 10, '同批出现重复体位');
});

test('pickRandomPoses：请求数超过池子大小时仍能返回（允许重复）', () => {
  const got = pickRandomPoses(SEX_POSITIONS.length + 5);
  assert.equal(got.length, SEX_POSITIONS.length + 5);
});

test('GALLERY_ASPECTS：至少 5 种比例，像素预算相当（不出现超大画布）', () => {
  assert.ok(GALLERY_ASPECTS.length >= 5);
  for (const a of GALLERY_ASPECTS) {
    assert.ok(a.w > 0 && a.h > 0);
    const mp = (a.w * a.h) / 1e6;
    assert.ok(mp > 1.2 && mp < 2.6, `${a.key} 像素数 ${mp.toFixed(2)}MP 超出安全区间`);
  }
  // 既有横幅也有竖幅（不然「随机比例」没有意义）
  assert.ok(GALLERY_ASPECTS.some(a => a.w > a.h), '缺横幅');
  assert.ok(GALLERY_ASPECTS.some(a => a.w < a.h), '缺竖幅');
});

// ── 画师串池 ──

test('listArtistPool：元素都是非空字符串（池子来源 = 收藏夹，兜底 = 当前配置画师串）', () => {
  const pool = listArtistPool();
  assert.ok(Array.isArray(pool));
  for (const a of pool) {
    assert.equal(typeof a, 'string');
    assert.ok(a.trim().length > 0, '池子里不得有空白项');
  }
  // :memory: 库会被 seed 播入默认画师收藏，所以通常是多项；
  // 这里只保证「不抛出、不返回坏值」，不锁死长度（种子内容会随版本变）。
});

// ── 出镜条件（「（小马限定）/（小车限定）」）──
// 这两类限定描述的是**被抱起/被驮的那一方必须明显娇小**，方向随体位而变：
//   020/037 女方抱男方 → 男方娇小；048/049/080 男方抱起/倒提女方 → 女方娇小。
// 早先的写法一律输出「男方娇小」，与前半句 "the man is lifting the girl" 自相矛盾。

test('SEX_POSITIONS：前置「（xx限定）」已从 name 剥到 limit，且 name 不再带脏括号', () => {
  const dirty = SEX_POSITIONS.filter(p => /^[（(]/.test(p.name));
  assert.equal(dirty.length, 0, `仍有体位名以括号开头：${dirty.map(p => p.no).join(',')}`);
  const withLimit = SEX_POSITIONS.filter(p => p.limit);
  assert.ok(withLimit.length > 0, '限定条目消失了？解析逻辑可能失效');
  for (const p of withLimit) {
    assert.ok(p.limit.length > 0);
    assert.ok(['male', 'female'].includes(p.limitOn), `${p.no} 的 limitOn 未解析：${p.limitOn}`);
    assert.ok(Array.isArray(p.limitTags) && p.limitTags.length > 0, `${p.no} 缺 limitTags`);
  }
  // 无限制的条目必须三件套都空（否则 tags 会被塞进无关内容）
  for (const p of SEX_POSITIONS.filter(x => !x.limit)) {
    assert.equal(p.limitOn, '');
    assert.deepEqual(p.limitTags, []);
  }
  // ★ 方向必须与源文件的负向信号一致（这是权威依据，不是猜的）
  for (const p of withLimit) {
    if (/muscular male/.test(p.negative)) assert.equal(p.limitOn, 'male', `${p.no} 方向应为 male`);
    if (/muscular female/.test(p.negative)) assert.equal(p.limitOn, 'female', `${p.no} 方向应为 female`);
  }
});

test('buildPoseImagePrompt：出镜条件句的方向随 limitOn 变（不能一律写男方娇小）', () => {
  const mk = (limitOn) => ({
    name: 'x', prompt: 'the boy is lifting the girl', frames: ['close-up'], negative: '',
    limit: '限定', limitOn,
    limitTags: limitOn === 'male' ? ['petite male'] : ['petite girl'],
  });
  const male = buildPoseImagePrompt(mk('male'), { subject: 'the girl with long black hair' }).prompt;
  const female = buildPoseImagePrompt(mk('female'), { subject: 'the girl with long black hair' }).prompt;
  assert.match(male, /The male is clearly smaller than the girl/);
  assert.match(female, /The girl is clearly smaller than the male/);
  assert.ok(!/The male is clearly smaller/.test(female), 'female 档写成了男方娇小（会与前半句自相矛盾）');
  // 无限制时不得出现这句（默认行为逐字不变）
  const none = buildPoseImagePrompt({ name: 'y', prompt: 'the boy and the girl', frames: ['close-up'], negative: '' }, {}).prompt;
  assert.ok(!/clearly smaller/.test(none));
});

test('preferPetitePool：女方娇小的体位优先娇小档；池里没有时**退回全池，绝不返回空**', () => {
  const pool = [
    { display_name: 'A', base_prompt: '身高175cm' },
    { display_name: 'B', base_prompt: '身高145cm' },
    { display_name: 'C', base_prompt: '身高148cm' },
  ];
  const poseFemale = { limitOn: 'female' };
  const poseMale = { limitOn: 'male' };
  const poseNone = {};

  // 非 female 档：原样返回
  assert.equal(preferPetitePool(pool, poseMale).length, 3);
  assert.equal(preferPetitePool(pool, poseNone).length, 3);

  // female 档：只剩娇小/矮档（145 / 148）
  const tiny = preferPetitePool(pool, poseFemale);
  assert.ok(tiny.length >= 1 && tiny.length < 3, `应缩到娇小档，实际 ${tiny.length}`);
  assert.ok(tiny.every(c => c.display_name !== 'A'), '高个角色不该留在娇小档池里');

  // ★ 池里一个娇小都没有 → 必须退回全池（不是返回 []）
  const allTall = [{ display_name: 'T', base_prompt: '身高180cm' }, { display_name: 'U', base_prompt: '身高178cm' }];
  assert.equal(preferPetitePool(allTall, poseFemale).length, 2);
  // 空池就是空池（调用方另行兜底），不伪造
  assert.deepEqual(preferPetitePool([], poseFemale), []);
});

test('preferPetitePool 抽到的角色数不会因为偏好而变少（2 女体位仍需 2 人）', () => {
  const pose2 = { limitOn: 'female', girls: 2 };
  assert.equal(girlsNeeded(pose2), 2);
  const pool = [{ display_name: 'A', base_prompt: '身高145cm' }, { display_name: 'B', base_prompt: '身高147cm' }];
  assert.equal(preferPetitePool(pool, pose2).length, 2);
});

// ── ★ 标签里绝不能出现「比例尺」（用户口径）──
// 原因：标签是**检索维度**，比例只是这条生成参数、不是题材。混进来会污染标签云与筛选
//（前端左栏标签云的计数与多选筛选都吃 tags，一个 "1:1" 会变成可点标签）。
// 比例另有正路：payload.gallery.aspect/width/height → 前端贴在图片上。

test('图库标签：体位名打头 + 人数 + 英文 NSFW 词，且**不含画面参数**', () => {
  const plan = mkPlan(1);
  plan[0].pose = {
    no: '046', name: '站立悬空双插', frozen: '', boys: 2, girls: 1, solo: false,
    // core 里故意混入比例尺与人数（都是"不该进标签"的东西，用来验证拦截）
    core: ['double penetration', 'suspended', 'standing', '1:1', '4:3', '16:9', '2girls'],
  };
  const out = normalizeGalleryDraft({ posts: [{ title: 'T' }] }, GAL_BOARD, plan);
  const tags = out[0].tags;
  assert.equal(tags[0], '站立悬空双插', '体位名必须排第一（中文检索词）');
  assert.ok(tags.includes('2男'), '多人男性要标出来');
  assert.ok(tags.includes('double penetration') && tags.includes('suspended'));
  // ★ 核心断言：任何形式的比例尺都不许出现
  for (const t of tags) {
    assert.ok(!/^\d+(?:\.\d+)?\s*[:：xX×]\s*\d+(?:\.\d+)?$/.test(t), `标签里混入了比例尺：${t}`);
  }
  // 人数类也不重复进标签（已单列）
  assert.ok(!tags.some(t => /^\d*girls?$/i.test(t) || /^\d*boys?$/i.test(t)));
  // ★ 上限从 6 提到 12：环境层一上来就占 7~8 个，还按 6 截会把环境层与 core 词整段砍掉
  assert.ok(tags.length <= 12, `标签上限 12 个，实得 ${tags.length}`);
});

test('图库标签：比例不会因为「排在前面」而挤掉真正的 NSFW 词', () => {
  const plan = mkPlan(1);
  plan[0].pose = {
    no: '001', name: '后入', frozen: '', boys: 1, girls: 1, solo: false,
    core: ['9:16', '1:1', 'doggystyle', 'sex'],   // 比例在前，正常词在后
  };
  const tags = normalizeGalleryDraft({ posts: [{}] }, GAL_BOARD, plan)[0].tags;
  assert.ok(tags.includes('doggystyle') && tags.includes('sex'),
    '比例被拦掉后，后面的正常标签要能补上（不能因为 break 提前退出而丢）');
});

// ── ★ 删除墓碑：用户删掉的媒体不得被"补种"复活 ──
// 背景：db/index.js 的 LATE_SEEDED 会在**每次启动**把"默认清单里有、库里没有"的媒体补回来
//（用于给老库补上后续版本新增的媒体）。但它分不清「还没有」和「用户删掉了」——
// 实测踩过：《狸狸八卦》被用户删掉后，一次重启就以新 id 复活了。
// 修法：deleteOutlet() 记墓碑，补种时跳过墓碑里的名字。

test('删除墓碑：deleteOutlet 会记下名字，用户重建同名媒体时撤销', async () => {
  const mod = await import('../src/services/mediaService.js');
  const { getDb } = await import('../src/db/index.js');
  const db = getDb();

  // 造一个可删的媒体（名字带前缀，便于识别）
  const o = mod.createOutlet({ name: '__zz_tomb_a', prompt: '测试提示词', layout: 'feed' });
  assert.equal(mod.isOutletDeletedByUser('__zz_tomb_a'), false, '刚建的媒体不该在墓碑里');

  assert.equal(mod.deleteOutlet(o.id), true, '删除应返回 true');
  assert.equal(mod.isOutletDeletedByUser('__zz_tomb_a'), true, '删除后必须留下墓碑');

  // 删除不存在的 id：返回 false，且不该往墓碑里写垃圾
  assert.equal(mod.deleteOutlet(99999999), false);

  // 用户又亲手建回同名媒体 → 墓碑应被撤销（否则"删了又建、再删不留墓碑"语义不一致）
  const again = mod.createOutlet({ name: '__zz_tomb_a', prompt: '测试提示词', layout: 'feed' });
  assert.equal(mod.isOutletDeletedByUser('__zz_tomb_a'), false, '重建同名媒体应撤销墓碑');

  // 清理
  mod.deleteOutlet(again.id);
  const left = db.prepare(`SELECT COUNT(*) AS n FROM media_outlets WHERE name LIKE '__zz_tomb_%'`).get().n;
  assert.equal(left, 0, '测试媒体应清理干净');
});

test('删除墓碑：坏数据不炸（墓碑里是非法 JSON 时当作空名单）', async () => {
  const mod = await import('../src/services/mediaService.js');
  const { setSetting } = await import('../src/db/settings.js');
  const db = (await import('../src/db/index.js')).getDb();

  const backup = db.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = ?`)
    .pluck().get(mod.DELETED_OUTLETS_KEY);

  setSetting(mod.DELETED_OUTLETS_KEY, '{不是 JSON');
  assert.equal(mod.isOutletDeletedByUser('随便'), false, '墓碑坏了应回落"没删过"，不能抛错');

  setSetting(mod.DELETED_OUTLETS_KEY, JSON.stringify([123, 'ok', null, '']));
  assert.equal(mod.isOutletDeletedByUser('ok'), true, '合法项仍要生效');
  assert.equal(mod.isOutletDeletedByUser('123'), false, '非字符串项应被过滤掉');

  // 还原
  if (backup == null) db.prepare('DELETE FROM system_settings WHERE setting_key = ?').run(mod.DELETED_OUTLETS_KEY);
  else setSetting(mod.DELETED_OUTLETS_KEY, backup);
});
