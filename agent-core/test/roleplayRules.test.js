import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { config } = await import('../src/config.js');
const { SYSTEM_RULES_CONTENT, THINKING_CHAIN_ZH_CONTENT } = await import('../src/builtinRules.js');
const { getSystemRules } = await import('../src/db/worldRepository.js');
const identityMatch = SYSTEM_RULES_CONTENT.match(/<roleplay>([\s\S]*?)<\/roleplay>/);
const identityBlock = identityMatch[0];
const identity = identityMatch[1].trim();

test('启用时保留完整身份标签与正文，非扮演任务完整排除身份段', () => {
  const withoutRoleplay = getSystemRules({ roleplay: false });
  assert.equal(getSystemRules(), `${withoutRoleplay}\n\n${identityBlock}`);
  assert.equal(getSystemRules({ roleplay: true }), getSystemRules());
  for (const paragraph of identity.split('\n')) {
    assert.ok(paragraph.length > 0);
    assert.ok(!withoutRoleplay.includes(paragraph));
  }
  assert.equal(getSystemRules().match(/<roleplay>/g).length, 1);
  assert.equal(getSystemRules().match(/<\/roleplay>/g).length, 1);
  assert.doesNotMatch(withoutRoleplay, /<\/?roleplay>/);
  assert.doesNotMatch(getSystemRules(), /\{\{THINKING_CHAIN_ZH\}\}/);
});

test('思考开关不截断身份段，roleplay 开关不改变思考语言块', t => {
  const thinkingMode = config.llm.thinkingMode;
  t.after(() => { config.llm.thinkingMode = thinkingMode; });
  for (const mode of ['enabled', 'disabled', 'omit']) {
    config.llm.thinkingMode = mode;
    const enabled = getSystemRules();
    const disabled = getSystemRules({ roleplay: false });
    assert.equal(enabled.endsWith(identityBlock), true);
    assert.equal(enabled.includes(THINKING_CHAIN_ZH_CONTENT), mode === 'enabled');
    assert.equal(disabled.includes(THINKING_CHAIN_ZH_CONTENT), mode === 'enabled');
    assert.equal(enabled, `${disabled}\n\n${identityBlock}`);
    assert.doesNotMatch(enabled, /\{\{THINKING_CHAIN_ZH\}\}/);
  }
});

test('身份段与世界观保持原边界，空世界观及非扮演路径不新增消息内容', async t => {
  const { getDb, closeDb, getSystemRulesWithWorld } = await import('../src/db/index.js');
  const db = getDb();
  t.after(closeDb);
  const world = '所有居民都是成年人。\n这里是海滨小镇。';
  db.prepare('UPDATE world_settings SET content = ? WHERE is_active = 1').run(world);
  for (const roleplay of [true, false]) {
    assert.equal(getSystemRulesWithWorld({ roleplay }),
      `${getSystemRules({ roleplay })}\n\n<world_setting>\n${world}\n</world_setting>`);
  }
  db.prepare("UPDATE world_settings SET content = '' WHERE is_active = 1").run();
  assert.equal(getSystemRulesWithWorld(), getSystemRules());
  assert.equal(getSystemRulesWithWorld({ roleplay: false }), getSystemRules({ roleplay: false }));
});
