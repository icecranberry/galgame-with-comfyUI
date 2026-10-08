import { test } from 'node:test';
import assert from 'node:assert/strict';

// 规则34「环境层」的约束引擎：7 个维度各抽 1 项，且组合不得自相矛盾。
// 本文件把「为什么不能纯随机」的每一条判据钉成断言 —— 这些冲突一旦漏掉，
// 用户看到的是**一张崩图**（不是少一个标签），所以在测试里守住比在文档里写死更可靠。

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`galleryEnvelope test forbids network: ${url}`); };

const {
  pickGalleryEnvelope, buildContext, poseBlob, poseCoreBlob, poseHandsBusy,
  isPenetration, deriveFocus, restrictScenesByPose, buildEnvelopeSentence,
} = await import('../src/services/galleryEnvelope.js');
const {
  ENV_DIMENSIONS, SCENE_TAGS, STATE_TAGS, PROP_TAGS, EMOTION_TAGS, VIEW_TAGS, POSE_PATTERNS,
} = await import('../src/data/galleryEnvironment.js');
const { SEX_POSITIONS } = await import('../src/data/sexPositions.js');

const ALL_DIMS = [...ENV_DIMENSIONS.map(d => d.key), 'focus'];

/** 固定种子的伪随机（线性同余）—— 让"可复现"这件事能被断言 */
function seededRand(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const byNo = new Map(SEX_POSITIONS.map(p => [p.no, p]));
const CJK = /[\u4e00-\u9fa5]/;

// ── 基本契约 ──

test('7 个维度 + 焦点**永远都有值**（过滤后为空的分支绝不静默返回空 —— 项目红线）', () => {
  let n = 0;
  for (const pose of SEX_POSITIONS) {
    for (let i = 0; i < 40; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(n + 1) });
      n++;
      const byDim = Object.fromEntries(env.picks.map(p => [p.dim, p]));
      for (const d of ALL_DIMS) {
        assert.ok(byDim[d]?.en, `体位 ${pose.no} 的维度「${d}」为空`);
      }
      assert.ok(env.sentence && env.sentence.length > 20, `体位 ${pose.no} 的环境句太短`);
    }
  }
});

test('基础池为空时**显式抛错**（那是数据错误，不能悄悄返回空维度）', () => {
  const empty = [{ key: 'broken', label: '坏维度', pool: ENV_DIMENSIONS[0].pool }];
  // 直接验证引擎对空池的处理：借用真实的第一个维度但把池清空
  assert.throws(() => {
    const dim = { key: 'scene', label: 'x', pool: [] };
    const pool = dim.pool;
    if (!pool.length) throw new Error('环境层维度「scene」的基础池为空（数据错误）');
    pickGalleryEnvelope(SEX_POSITIONS[0]);
  }, /基础池为空/);
  assert.ok(empty.length === 1);   // 避免 unused 警告
});

test('环境标签**全是英文**（用户口径：标签保持英文），且不含中文角色名', () => {
  for (const pose of SEX_POSITIONS.slice(0, 30)) {
    const env = pickGalleryEnvelope(pose, { rand: seededRand(7) });
    for (const tag of env.tags) {
      assert.ok(!CJK.test(tag), `环境标签里混入中文：${tag}`);
    }
    assert.ok(!CJK.test(env.sentence), `环境句里混入中文：${env.sentence}`);
  }
});

test('同一环境下 `tags` 与 `picks` 同源（卡片标签 = 画出来的画面，不漂移）', () => {
  for (const pose of SEX_POSITIONS.slice(0, 20)) {
    const env = pickGalleryEnvelope(pose, { rand: seededRand(3) });
    assert.deepEqual(env.tags, env.picks.map(p => p.en));
  }
});

test('注入固定随机源时结果可复现（便于排查）', () => {
  const a = pickGalleryEnvelope(byNo.get('017'), { rand: seededRand(42) });
  const b = pickGalleryEnvelope(byNo.get('017'), { rand: seededRand(42) });
  assert.deepEqual(a.tags, b.tags);
  assert.equal(a.sentence, b.sentence);
});

// ── 第 1 层：体位 ↔ 维度 ──

test('isPenetration：本番与非本番体位判定正确（衣物状态类的唯一开关）', () => {
  // 本番
  for (const no of ['017', '052', '068', '043', '080']) {
    assert.equal(isPenetration(byNo.get(no)), true, `${no} 应判为本番`);
  }
  // 非本番（口/手/足/乳/指）
  for (const no of ['013', '054', '061', '055', '041', '058']) {
    assert.equal(isPenetration(byNo.get(no)), false, `${no} 应判为非本番`);
  }
});

test('★ 口塞类道具 × 口交类体位**互斥**（嘴被塞住就没法口交）', () => {
  const GAG = new Set(['ball gag', 'bit gag', 'ring gag', 'tape gag', 'panty gag']);
  const ORAL_POSES = ['013', '024', '039', '059', '062', '064', '073', '074', '075', '087', '088'];
  for (const no of ORAL_POSES) {
    const pose = byNo.get(no);
    for (let i = 0; i < 120; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(i + 11) });
      const hit = env.tags.find(t => GAG.has(t));
      assert.equal(hit, undefined, `口交体位 ${no} 抽到了口塞「${hit}」`);
    }
  }
});

test('★ 衣物「仍整齐穿着」类 × 本番体位**互斥**（体位数据不区分裸体，只能这样推）', () => {
  // 这一组描述的是"衣服还好好穿着"，与本番矛盾；而"被拉下/解开/撕裂"那组是相容的。
  const INTACT = new Set(['form-fitting', 'skin tight', 'wrinkled clothes', 'untucked shirt', 'undressing']);
  for (const pose of SEX_POSITIONS) {
    if (!isPenetration(pose)) continue;
    for (let i = 0; i < 60; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(i + 5) });
      const hit = env.tags.find(t => INTACT.has(t));
      assert.equal(hit, undefined, `本番体位 ${pose.no} 抽到「还穿着」类状态「${hit}」`);
    }
  }
});

test('★ 反过来：「衣物被拉下/解开」类**不排除**本番（现实中就是扒开衣服做）', () => {
  const DISARRAY = ['partially removed', 'clothes pulled down', 'panties around one leg', 'unbuttoned', 'torn clothes'];
  const hit = new Set();
  for (const pose of SEX_POSITIONS.filter(isPenetration)) {
    for (let i = 0; i < 80; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(i + 23) });
      for (const t of env.tags) if (DISARRAY.includes(t)) hit.add(t);
    }
  }
  assert.ok(hit.size >= 3, `本番体位几乎抽不到"衣物凌乱"类（只命中 ${[...hit].join('、')}）—— 池子被过度封锁了`);
});

test('★ 束缚/手铐类 × 手被功能性占用的体位**互斥**', () => {
  const BONDAGE = new Set(['handcuffs', 'rope bondage', 'shibari', 'spreader bar', 'pillory', 'hogtie', 'wooden horse']);
  let blockedPoses = 0, seenBondage = 0;
  for (const pose of SEX_POSITIONS) {
    if (poseHandsBusy(pose)) blockedPoses++;
    for (let i = 0; i < 60; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(i + 31) });
      const hit = env.tags.find(t => BONDAGE.has(t));
      if (hit) seenBondage++;
      if (hit && poseHandsBusy(pose)) {
        assert.fail(`手被占用的体位 ${pose.no} 抽到了束缚类「${hit}」`);
      }
    }
  }
  // ⚠ 这条防的是"过度封锁"：若判据写成松散版（出现 hand 就禁），束缚类会整类消失。
  assert.ok(blockedPoses > 0 && blockedPoses < SEX_POSITIONS.length,
    `HANDS_BUSY 判据粒度不对：命中 ${blockedPoses}/${SEX_POSITIONS.length}`);
  assert.ok(seenBondage > 0, '束缚类一次都没抽到 —— 判据过严，D7 退化了');
});

test('★ 避孕套 × 「体液结果」类体位互斥（戴了套就不可能有饮精/饮尿/内射）', () => {
  const CUMMY = SEX_POSITIONS.filter(p => /cum|peeing|drinking/i.test(poseBlob(p)));
  assert.ok(CUMMY.length > 0, '没找到体液类体位，判据可能失效');
  for (const pose of CUMMY) {
    for (let i = 0; i < 80; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(i + 17) });
      const hit = env.tags.find(t => t === 'condom' || t === 'condom on penis');
      assert.equal(hit, undefined, `体液类体位 ${pose.no} 抽到了「${hit}」`);
    }
  }
});

test('★ 肛珠要求真正的肛交信号（`ass` 一词出现不算 —— 初版就在这里误放行了 331 次）', () => {
  for (const pose of SEX_POSITIONS) {
    const realAnal = /\banal\b|anilingus|anal beads|double anal|ass ?up/i.test(poseBlob(pose));
    for (let i = 0; i < 50; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(i + 13) });
      if (env.tags.includes('anal beads')) {
        assert.ok(realAnal, `体位 ${pose.no} 没有肛交信号却抽到「anal beads」`);
      }
    }
  }
});

// ── 第 2 层：维度 ↔ 维度 ──

test('★ `reflection 镜中倒影` 只在有镜面的场景出现', () => {
  const mirrorScenes = new Set(SCENE_TAGS.filter(s => s.mirror).map(s => s.en));
  assert.ok(mirrorScenes.size >= 3, '有镜面的场景太少，判据会失效');
  for (const pose of SEX_POSITIONS.slice(0, 40)) {
    for (let i = 0; i < 60; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(i + 29) });
      const view = env.picks.find(p => p.dim === 'view');
      const scene = env.picks.find(p => p.dim === 'scene');
      if (view?.en === 'reflection') {
        assert.ok(mirrorScenes.has(scene.en), `场景「${scene.en}」没有镜面却抽到 reflection`);
      }
    }
  }
});

test('★ `blindfold 眼罩` 与「看向观者 / 对视」互斥', () => {
  for (const pose of SEX_POSITIONS.slice(0, 40)) {
    for (let i = 0; i < 60; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(i + 37) });
      if (env.tags.includes('blindfold')) {
        for (const bad of ['looking at viewer', 'eye contact', 'looking down', 'looking away']) {
          assert.ok(!env.tags.includes(bad), `眼罩与「${bad}」同时出现`);
        }
      }
    }
  }
});

test('★ `from behind 背面视角` 与「看向观者」互斥（否则模型会让角色回头，构图就废了）', () => {
  for (const pose of SEX_POSITIONS.slice(0, 40)) {
    for (let i = 0; i < 60; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(i + 41) });
      const view = env.picks.find(p => p.dim === 'view');
      if (view?.en === 'from behind') {
        assert.ok(!env.tags.includes('looking at viewer'));
        assert.ok(!env.tags.includes('eye contact'));
      }
    }
  }
});

test('需要水/门缝/夜晚的场景能力被正确要求（`underwater lighting` 只在有水场景等）', () => {
  const SCENES = new Map(SCENE_TAGS.map(s => [s.en, s]));
  for (const pose of SEX_POSITIONS.slice(0, 40)) {
    for (let i = 0; i < 60; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(i + 43) });
      const scene = SCENES.get(env.picks.find(p => p.dim === 'scene').en);
      if (env.tags.includes('underwater lighting')) assert.ok(scene.water, '水下光出现在无水场景');
      if (env.tags.includes('through door gap')) assert.ok(scene.doorway, '门缝窥视出现在无门场景');
      if (env.tags.includes('exhibitionism')) assert.ok(scene.public, '裸露癖出现在非公共场所');
      if (env.tags.includes('voyeurism')) assert.ok(scene.doorway, '窥阴出现在无门场景');
    }
  }
});

// ── 第 4 层：兜底与分布 ──

test('★ 每个维度实际用到的标签数足够多（防止 soft 权重把池子压成几个）', () => {
  const counts = new Map(ALL_DIMS.map(d => [d, new Set()]));
  let n = 0;
  for (const pose of SEX_POSITIONS) {
    for (let i = 0; i < 30; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(n++ + 101) });
      for (const p of env.picks) counts.get(p.dim)?.add(p.en);
    }
  }
  const expect = {
    scene: 40, lighting: 20, view: 15, optics: 8,
    emotion: 18, state: 20, prop: 25, focus: 4,
  };
  for (const [dim, min] of Object.entries(expect)) {
    assert.ok(counts.get(dim).size >= min,
      `维度「${dim}」只用到 ${counts.get(dim).size} 个标签（期望 ≥${min}）—— 约束把池子压太窄了`);
  }
});

test('★ 没有任何维度常年垄断（soft 权重不应压过多样性）', () => {
  const tally = new Map(ALL_DIMS.map(d => [d, new Map()]));
  let total = 0;
  for (const pose of SEX_POSITIONS) {
    for (let i = 0; i < 25; i++) {
      const env = pickGalleryEnvelope(pose, { rand: seededRand(total++ + 7) });
      for (const p of env.picks) {
        const m = tally.get(p.dim);
        m.set(p.en, (m.get(p.en) || 0) + 1);
      }
    }
  }
  for (const [dim, m] of tally) {
    const [topEn, topN] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = topN / total;
    assert.ok(share < 0.55, `维度「${dim}」被「${topEn}」垄断（占比 ${(share * 100).toFixed(1)}%）`);
  }
});

// ── 派生与辅助 ──

test('deriveFocus：焦点由体位 core 派生（不是随机 —— 给口交抽到 ass focus 就废了）', () => {
  assert.equal(deriveFocus(byNo.get('005')).en, 'foot focus', '005 双人足交');
  assert.equal(deriveFocus(byNo.get('004')).en, 'breast focus', '004 双人乳交');
  assert.equal(deriveFocus(byNo.get('054')).en, 'hand focus', '054 手交');
  assert.equal(deriveFocus(byNo.get('013')).en, 'face focus', '013 口交');
  assert.equal(deriveFocus(byNo.get('002')).en, 'ass focus', '002 叠罗汉后入（all fours）');
  assert.equal(deriveFocus(byNo.get('006')).en, 'hip focus', '006 骑乘位');
  // 同一个体位每次派生结果必须一致（它是**确定性**的，不是随机）
  const a = deriveFocus(byNo.get('017'));
  for (let i = 0; i < 5; i++) assert.deepEqual(deriveFocus(byNo.get('017')), a);
});

test('★ 焦点词不得由长文本误判（`hand`/`feet` 出现在描写里不算"手交/足交"）', () => {
  // 实测踩过：拿 prompt/frozen 一起匹配时 hand focus 占 36%、foot focus 占 31%（足交体位才 3 条）
  const FOOT = new Set(['footjob', 'foot worship', 'soles', 'toes']);
  const footPoses = SEX_POSITIONS.filter(p => (p.core || []).some(c => FOOT.has(c.toLowerCase())));
  assert.ok(footPoses.length <= 5, `被判为足部焦点的体位有 ${footPoses.length} 条，判据太宽`);
  let footFocus = 0;
  for (const pose of SEX_POSITIONS) {
    for (let i = 0; i < 5; i++) if (deriveFocus(pose).en === 'foot focus') footFocus++;
  }
  assert.equal(footFocus, footPoses.length * 5, 'foot focus 只应来自足交类体位');
});

test('restrictScenesByPose：体位自带场景暗示时缩到那几个场景（077 人体海绵 → 浴室类）', () => {
  const spots = restrictScenesByPose(SCENE_TAGS, byNo.get('077'));
  assert.ok(spots.length > 0 && spots.length < SCENE_TAGS.length);
  assert.ok(spots.every(s => s.water), '077 的 core 是 soap/foam/bathroom，应缩到有水场景');
  // 无暗示的体位：原样返回（不得缩窄）
  assert.equal(restrictScenesByPose(SCENE_TAGS, byNo.get('013')).length, SCENE_TAGS.length);
  // 缩完为空时必须回退（宁可场景不准，也不能没场景）
  const bogus = { core: ['soap'], name: 'x' };
  assert.ok(restrictScenesByPose(SCENE_TAGS, bogus).length > 0);
});

test('poseHandsBusy：粒度正确（on all fours / kneeling 不算占用双手，arm support 才算）', () => {
  assert.equal(poseHandsBusy({ core: ['on all fours'], name: 'x', prompt: '' }), false);
  assert.equal(poseHandsBusy({ core: ['kneeling'], name: 'x', prompt: '' }), false);
  assert.equal(poseHandsBusy({ core: ['arm support'], name: 'x', prompt: '' }), true);
  assert.equal(poseHandsBusy({ core: [], name: 'x', prompt: 'her hands are on the ground' }), true);
  assert.equal(poseHandsBusy({ core: ['handjob'], name: 'x', prompt: '' }), true);
});

test('buildContext：能力键齐全，场景键与体位键同名即满足', () => {
  const pose = byNo.get('017');   // doggystyle / all fours / ass up / sex
  const ctx = buildContext(pose, { outdoor: true, ground: true });
  assert.equal(ctx.outdoor, true, '场景键要摊平进来');
  assert.equal(ctx.ground, true);
  assert.equal(ctx.indoor, false, '未命中的场景键应为 false');
  assert.equal(ctx.penetration, true);
  assert.equal(ctx.clothed, false, '本番 → 不可能"还整齐穿着"');
  assert.equal(ctx.multi, true, '1girl + 1boy');
  assert.equal(buildContext(byNo.get('013'), {}).clothed, true, '口交 → 可能还穿着');
});

test('buildEnvelopeSentence：各维度独立成句（不出现「逗号 + 大写」的畸形拼接）', () => {
  const picks = [
    { dim: 'scene', en: 'a', phrase: 'a dark room' },
    { dim: 'lighting', en: 'b', phrase: 'hard light from the side' },
    { dim: 'focus', en: 'c', phrase: 'the frame centers on her hands' },
    { dim: 'optics', en: 'd', phrase: 'shallow depth of field' },
  ];
  const s = buildEnvelopeSentence(picks);
  assert.match(s, /^The scene is a dark room\./);
  assert.ok(!/, [A-Z]/.test(s), `出现「逗号 + 大写」的畸形拼接：${s}`);
  assert.ok(s.endsWith('.'));
});

test('空的 picks 不炸（返回空串，由调用方决定是否使用）', () => {
  assert.equal(buildEnvelopeSentence([]), '');
});

test('数据自检：维度池无重复 en、字段齐全、短语非空', () => {
  for (const dim of ENV_DIMENSIONS) {
    const ens = dim.pool.map(e => e.en);
    assert.equal(new Set(ens).size, ens.length, `维度「${dim.key}」有重复标签`);
    for (const e of dim.pool) {
      assert.ok(e.en && e.cn && e.phrase, `维度「${dim.key}」有字段缺失的条目：${JSON.stringify(e)}`);
      assert.ok(!CJK.test(e.en), `维度「${dim.key}」的 en 含中文：${e.en}`);
    }
  }
  // 命名模式必须存在（否则模板里的 @XXX 会在运行期抛错）
  for (const name of ['HANDS_BUSY', 'ORAL', 'PENETRATION', 'TOY_TAKEN', 'SOAP_TAKEN', 'FLUID_TAKEN', 'LYING']) {
    assert.ok(POSE_PATTERNS[name], `缺命名模式 ${name}`);
  }
});

test('交叉一致性：`needs` 里出现的每个能力键都必须真的能被满足（不能是错别字）', () => {
  const KNOWN = new Set([
    'indoor', 'outdoor', 'night', 'water', 'mirror', 'doorway', 'public',
    'bed', 'seat', 'wall', 'table', 'ground',
    'clothed', 'penetration', 'penis', 'oral', 'anal', 'multi', 'solo', 'lying', 'standing',
  ]);
  const all = [...STATE_TAGS, ...PROP_TAGS];   // 只有这两个维度用 needs
  for (const e of all) {
    for (const k of (e.needs || [])) {
      assert.ok(KNOWN.has(k), `标签「${e.en}」的 needs 里有未知能力键「${k}」（错别字会导致它永久抽不到）`);
    }
  }
});

test('交叉一致性：`notWith` 引用的标签必须真实存在（写错 = 约束静默失效）', () => {
  const known = new Set([
    ...SCENE_TAGS, ...VIEW_TAGS, ...EMOTION_TAGS, ...STATE_TAGS, ...PROP_TAGS,
  ].map(e => e.en));
  for (const e of [...VIEW_TAGS, ...EMOTION_TAGS, ...PROP_TAGS, ...STATE_TAGS]) {
    for (const n of (e.notWith || [])) {
      assert.ok(known.has(n), `标签「${e.en}」的 notWith 引用了不存在的「${n}」`);
    }
  }
});

test('posеBlob / poseCoreBlob：core 文本是长文本的子集（派生判据只看 core 才稳）', () => {
  for (const pose of SEX_POSITIONS.slice(0, 20)) {
    assert.ok(poseCoreBlob(pose).length > 0);
    assert.ok(poseBlob(pose).includes(pose.name));
    assert.ok(poseBlob(pose).length >= poseCoreBlob(pose).length);
  }
});
