import test from 'node:test';
import assert from 'node:assert/strict';

// 灵魂引擎测试：算法部分不依赖 DB；落库部分走内存库。
// 先钉住内存库路径，确保绝不打开真实 data/agent.db（docs/testing.md：不碰用户真实数据）。
process.env.DB_PATH = ':memory:';

const { config } = await import('../src/config.js');
config.dbPath = ':memory:';

const {
  SoulState, DIMENSIONS, DEFAULT_MIDS, generateResonateCode, isSoulEnabled,
  getSoulState, loadSoulState, saveSoulState, clearSoulCache,
  getSoulSnapshot, reflectSoul, resonateSoul,
  soulRecallTopK, soulCurationLimit, soulReplyLengthHint, renderSoulStateBlock,
} = await import('../src/services/soulEngine.js');
const { getDb } = await import('../src/db/index.js');

// ── 算法：弹性变动 ──

test('弹性 delta：离 mid 越远越难推动，回归力总是指向 mid', () => {
  const soul = new SoulState();
  const atMid = soul.calculateElasticDelta(7, 1, 7, 1.0);      // elasticity = e^0 = 1
  const farOff = soul.calculateElasticDelta(17, 1, 7, 1.0);    // elasticity = e^-1
  assert.ok(Math.abs(atMid - 1.0) < 1e-9, `在 mid 处应完整施加方向力，实际 ${atMid}`);
  assert.ok(farOff < atMid, '离 mid 越远，同样的方向力产生的位移越小');

  // 只留回归力（direction=0）：当前值低于 mid → 正向回归
  const below = soul.calculateElasticDelta(0, 0, 7, 0);
  assert.ok(below > 0, '低于 mid 时回归力应向上');
  const above = soul.calculateElasticDelta(14, 0, 7, 0);
  assert.ok(above < 0, '高于 mid 时回归力应向下');
});

// ── 算法：Tanh 映射 ──

test('Tanh 映射：中庸态落在 mid，前两维取整、后两维两位小数，上下界不越界', () => {
  const soul = new SoulState();
  assert.equal(soul.getValue('RecallDepth'), DEFAULT_MIDS.RecallDepth);
  assert.equal(soul.getValue('ImpressionDepth'), DEFAULT_MIDS.ImpressionDepth);
  assert.equal(soul.getValue('ExpressionDesire'), DEFAULT_MIDS.ExpressionDesire);
  assert.equal(soul.getValue('Creativity'), DEFAULT_MIDS.Creativity);
  assert.ok(Number.isInteger(soul.getValue('RecallDepth')));

  soul.energy.RecallDepth = 1000;
  assert.equal(soul.getValue('RecallDepth'), 20, '拉满不超过 max');
  soul.energy.RecallDepth = -1000;
  assert.equal(soul.getValue('RecallDepth'), 1, '拉到底不低于 min');

  soul.energy.Creativity = 3;
  const creative = soul.getValue('Creativity');
  assert.equal(creative, Math.round(creative * 100) / 100);
  assert.ok(creative > DEFAULT_MIDS.Creativity && creative <= 1);
});

// ── 算法：4 位码调整 ──

test('adjust：合法码生效、reflect 强于 resonate、非法码抛错', () => {
  const reflect = new SoulState();
  const before = reflect.getSnapshot();
  reflect.adjust('1111', 'reflect');
  for (const dim of DIMENSIONS) assert.ok(reflect.energy[dim] > before[dim], `${dim} 应被推高`);

  const resonate = new SoulState();
  resonate.adjust('1111', 'resonate');
  assert.ok(
    reflect.energy.RecallDepth > resonate.energy.RecallDepth,
    'reflect(1.0) 的推动幅度应大于 resonate(0.3)',
  );

  assert.throws(() => reflect.adjust('1234'), /Invalid soul state code/);
  assert.throws(() => reflect.adjust('101'), /Invalid soul state code/);
  assert.throws(() => reflect.adjust(undefined), /Invalid soul state code/);
});

// ── 算法：共鸣码生成 ──

test('共鸣码：快照平均与当前值比较的方向正确，空快照返回 null', () => {
  const up = generateResonateCode([{ RecallDepth: 5 }, { RecallDepth: 5 }], { RecallDepth: 0 });
  assert.equal(up[0], '1', '快照平均高于当前值 → 1');
  const down = generateResonateCode([{ RecallDepth: -5 }], { RecallDepth: 0 });
  assert.equal(down[0], '0', '快照平均不高于当前值 → 0');
  assert.equal(generateResonateCode([], {}), null);
  assert.equal(generateResonateCode(null, {}), null);

  const soul = new SoulState();
  assert.equal(soul.resonate([]), null, '无快照不调整');
  assert.equal(soul.resonate([{ RecallDepth: 8, ImpressionDepth: 4, ExpressionDesire: 0.9, Creativity: 0.9 }]), '1111');
  assert.ok(soul.energy.RecallDepth > 0);
});

// ── 落库：往返一致 + 中庸态初始化 + 按角色隔离 ──

test('落库往返：无行写中庸态，写盘后读回一致，两个角色互不影响', () => {
  const db = getDb();
  config.features.soul = true;
  clearSoulCache();

  const first = getSoulState('9001');
  const seeded = db.prepare('SELECT * FROM soul_states WHERE character_id = ?').get('9001');
  assert.ok(seeded, '首次加载应写入中庸态行');
  assert.equal(seeded.recall_depth, 0);

  first.adjust('1111', 'reflect');
  saveSoulState('9001');
  const persisted = db.prepare('SELECT * FROM soul_states WHERE character_id = ?').get('9001');
  assert.ok(persisted.recall_depth > 0, 'reflect 后应落库');

  clearSoulCache();
  const reloaded = getSoulState('9001');
  assert.deepEqual(reloaded.getSnapshot(), first.getSnapshot(), '重启（清缓存）后读回一致');

  const other = getSoulState('9002');
  assert.deepEqual(other.getSnapshot(), { RecallDepth: 0, ImpressionDepth: 0, ExpressionDesire: 0, Creativity: 0 });
  assert.notDeepEqual(other.getSnapshot(), reloaded.getSnapshot(), '两个角色的灵魂互不影响');

  config.features.soul = false;
});

// ── 开关关闭：所有行为入口不产生副作用 ──

test('开关关闭：不注入、不落快照、不改行为参数、不写库', () => {
  const db = getDb();
  clearSoulCache();
  config.features.soul = false;

  assert.equal(isSoulEnabled(), false);
  assert.equal(getSoulSnapshot('9100'), null);
  assert.equal(soulReplyLengthHint('9100'), null);
  assert.equal(soulRecallTopK('9100'), null);
  assert.equal(soulCurationLimit('9100'), null);
  assert.equal(renderSoulStateBlock('9100'), '');
  assert.equal(reflectSoul('9100', '1111'), null);
  assert.equal(resonateSoul('9100', [{ RecallDepth: 5 }]), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM soul_states WHERE character_id = ?').get('9100').c, 0, '关闭时不应落库');
});

// ── 开关打开：四维驱动行为参数 + 提示词块 ──

test('开关打开：ExpressionDesire 决定长度档位，RecallDepth/ImpressionDepth 驱动行为，提示词块含四行倾向', () => {
  config.features.soul = true;
  clearSoulCache();
  const soul = getSoulState('9200');

  soul.energy.ExpressionDesire = -20; // 极端简洁
  assert.equal(soulReplyLengthHint('9200'), '10~25个汉字');
  soul.energy.ExpressionDesire = 20;  // 极端详尽（上限 60，不脱缰）
  assert.equal(soulReplyLengthHint('9200'), '10~60个汉字');

  soul.energy.RecallDepth = 20;
  assert.ok(soulRecallTopK('9200') > DEFAULT_MIDS.RecallDepth);
  assert.ok(soulRecallTopK('9200') <= 20);
  soul.energy.ImpressionDepth = 20;
  assert.ok(soulCurationLimit('9200') > DEFAULT_MIDS.ImpressionDepth);

  const block = renderSoulStateBlock('9200');
  for (const label of ['社交倾向', '认知倾向', '表达倾向', '情绪倾向']) {
    assert.ok(block.includes(label), `提示词块缺少 ${label}`);
  }
  assert.ok(block.startsWith('<soul_state>') && block.trimEnd().endsWith('</soul_state>'));

  config.features.soul = false;
});

// ── 迁移：soul_states 表 + memory_fragments.soul_snapshot 列，幂等 ──

test('迁移：建 soul_states 表与 soul_snapshot 列，重复执行幂等', async () => {
  const db = getDb();
  const columns = new Set(db.prepare('PRAGMA table_info(memory_fragments)').all().map(c => c.name));
  assert.ok(columns.has('soul_snapshot'), 'memory_fragments 应新增 soul_snapshot 列');
  const table = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='soul_states'`).get();
  assert.ok(table, 'soul_states 表应存在');

  const { migrateSoulSchema } = await import('../src/db/index.js');
  migrateSoulSchema(db); // 幂等：重复执行不报错
  assert.equal(db.prepare('PRAGMA table_info(memory_fragments)').all().filter(c => c.name === 'soul_snapshot').length, 1);
});
