import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('angel reference tests forbid network'); };
const { resolveAngelImageReference } = await import('../src/services/godSays/angelImageReference.js');

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE god_angel (id INTEGER PRIMARY KEY, display_name TEXT, persona TEXT)');
  return db;
}

test('天使参考只读唯一档案，使用特殊编号和第三人称外观，不携带私密正文', t => {
  const db = fixture(t);
  db.prepare('INSERT INTO god_angel VALUES (1,?,?)').run('小羽',
    '你与神的私密往事。\n## 你的外观\n你有白金短发、金眼、白羽。\n## 私密补充\n不能给生图');
  for (const [desc, refs] of [['天使和流萤', undefined], ['小羽和流萤', undefined], ['我与流萤', ['angel']]]) {
    const result = resolveAngelImageReference(desc, refs, db);
    assert.equal(result.id, 'god:angel');
    assert.equal(result.display_name, '小羽');
    assert.match(result.text, /小羽有白金短发、金眼、白羽/);
    assert.doesNotMatch(result.text, /私密|不能给生图|限时服饰|专属形态/);
    assert.equal(result.loras, undefined);
  }
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, 1);
});

test('外观和改名立即生效，无需同步隐藏酒馆角色或刷新缓存', t => {
  const db = fixture(t);
  db.prepare('INSERT INTO god_angel VALUES (1,?,?)').run('小羽', '## 你的外观\n银发');
  assert.match(resolveAngelImageReference('小羽', undefined, db).text, /银发/);
  db.prepare('UPDATE god_angel SET display_name=?,persona=?').run('晨星', '## 你的外观\n蓝发');
  assert.equal(resolveAngelImageReference('小羽', undefined, db), null);
  assert.match(resolveAngelImageReference('晨星', undefined, db).text, /蓝发/);
  assert.match(resolveAngelImageReference('天使', undefined, db).text, /蓝发/);
});

test('不相关描述和显式空名单不注入；未设置外观时不生成替代天使', t => {
  const db = fixture(t);
  assert.equal(resolveAngelImageReference('流萤', undefined, db), null);
  assert.equal(resolveAngelImageReference('天使写的信', [], db), null);
  assert.equal(resolveAngelImageReference(undefined, undefined, db), null);
  assert.throws(() => resolveAngelImageReference('天使', undefined, db), /尚未设置外观/);
  db.prepare('INSERT INTO god_angel VALUES (1,?,?)').run('小羽', '只有人格，没有外观');
  assert.throws(() => resolveAngelImageReference('小羽', undefined, db), /尚未设置外观/);
  assert.throws(() => resolveAngelImageReference('我', ['angel'], db), /尚未设置外观/);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, 1);
});
