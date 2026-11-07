import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('scheduleOutfits test forbids network'); };
const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
const { getDb, closeDb } = await import('../src/db/index.js');
const { buildOutfitAnnotateLayer, buildOutfitAnnotation, buildScheduleOutfitCandidates,
  getSceneOutfitForNow, asPersonaOutfits, listSceneOutfits } = await import('../src/services/outfitScene.js');
const { buildCharacterPersona } = await import('../src/services/characterPersona.js');
const { generateSchedule } = await import('../src/services/scheduleGenerator.js');
const { selectAngelOutfit } = await import('../src/services/godSays/angelWardrobe.js');
const { getLocalDateKey } = await import('../src/utils/localDate.js');
const db = getDb();
after(() => closeDb());

const appearance = 'Silver hair, green eyes, wearing the signature white dress.';
const basePrompt = `你是小满，喜欢阅读。\n\n## 你的外观\n${appearance}`;
const casual = { scene: 'casual', name: '休闲裙', description: 'Blue casual dress.' };
const home = { scene: 'home', name: '居家套装', description: 'Soft home clothes.' };
const sleep = { scene: 'sleep', name: '睡衣', description: 'Cotton nightdress, barefoot.' };
const at = (hour, minute = 0) => new Date(2026, 10, 8, hour, minute);
const activity = (startTime, endTime, outfit = null, replyDelay = 0) => ({
  startTime, endTime, outfit, replyDelay, activity: replyDelay === -1 ? '睡眠' : '阅读',
  location: '住处', tags: ['日常'], description: '坐到窗边打开书本，翻阅昨晚留下的章节，顺手整理桌面的纸页与笔记，安静享受午后时光。',
});
const day = [activity('00:00', '07:00', '睡衣', -1), activity('07:00', '18:00'),
  activity('18:00', '22:00'), activity('22:00', '00:00', '睡衣', -1)];
let serial = 0;
function character(outfits = [], activities = null) {
  const id = Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt) VALUES (?,?,?)')
    .run(`schedule-outfit-${++serial}`, '小满', basePrompt).lastInsertRowid);
  for (const outfit of outfits) db.prepare('INSERT INTO character_outfits(character_id,scene,name,description) VALUES (?,?,?,?)')
    .run(id, outfit.scene, outfit.name, outfit.description);
  if (activities) db.prepare('INSERT INTO daily_schedules(character_id,schedule_date,schedule_json) VALUES (?,?,?)')
    .run(id, getLocalDateKey(at(12)), JSON.stringify(activities));
  return { id, display_name: '小满', base_prompt: basePrompt };
}

test('只有一套额外服装也会补齐人物卡默认候选，读取不写入衣柜', () => {
  const char = character([sleep]);
  const before = listSceneOutfits(char.id);
  const prompt = buildOutfitAnnotateLayer(char.id);
  assert.match(prompt, /日常装/);
  assert.match(prompt, /Silver hair, green eyes/);
  assert.match(prompt, /睡衣/);
  assert.deepEqual(listSceneOutfits(char.id), before);
  assert.equal(buildOutfitAnnotateLayer(character().id), null, '仅默认服饰时不增加提示层');
  assert.equal(buildOutfitAnnotation([{ ...home, description: '  ' }]), null, '空槽位不作为可选换装');
});

test('旧默认名称和 ID 仍能匹配，外观来自最新人物卡且不重复注入', () => {
  const char = character([{ scene: 'work', name: '旧常服', description: 'Stale black uniform.' }, casual, sleep]);
  const stored = listSceneOutfits(char.id);
  const candidates = buildScheduleOutfitCandidates(stored, char);
  assert.equal(candidates[0].id, stored[0].id);
  assert.equal(candidates[0].name, '旧常服');
  assert.match(candidates[0].description, /signature white dress/);
  assert.doesNotMatch(candidates[0].description, /Stale/);
  for (const label of ['旧常服', String(stored[0].id)]) {
    db.prepare('INSERT OR REPLACE INTO daily_schedules(character_id,schedule_date,schedule_json) VALUES (?,?,?)')
      .run(char.id, getLocalDateKey(at(12)), JSON.stringify([activity('00:00', '00:00', label)]));
    const selected = getSceneOutfitForNow(char.id, at(12));
    assert.equal(selected.scene, 'work');
    assert.equal(selected.source, 'schedule');
    assert.equal(asPersonaOutfits(selected), null);
  }
  assert.equal(buildCharacterPersona(char), buildCharacterPersona(char, { outfits: null }));
});

test('无日程或全部无效标注时回到默认，不因仅有私服或睡衣而采用它们', () => {
  for (const outfits of [[casual], [sleep], [casual, home, sleep], []]) {
    const char = character(outfits);
    for (const hour of [2, 12, 23]) assert.equal(getSceneOutfitForNow(char.id, at(hour)).scene, 'work');
    db.prepare('INSERT INTO daily_schedules(character_id,schedule_date,schedule_json) VALUES (?,?,?)')
      .run(char.id, getLocalDateKey(at(12)), JSON.stringify([activity('00:00', '00:00', '模型编造的服装')]));
    assert.equal(getSceneOutfitForNow(char.id, at(12)).scene, 'work');
  }
  assert.equal(getSceneOutfitForNow(null), null);
  assert.equal(getSceneOutfitForNow(-123), null);
});

test('跨午夜睡眠强制睡衣，起床后的 null 不继承睡衣或睡前换装', () => {
  const char = character([casual, sleep], [activity('07:00', '18:00'),
    activity('18:00', '22:00', casual.name), activity('22:00', '07:00', casual.name, -1)]);
  for (const hour of [23, 2, 6]) assert.equal(getSceneOutfitForNow(char.id, at(hour)).scene, 'sleep');
  assert.equal(getSceneOutfitForNow(char.id, at(7)).scene, 'work');
  assert.equal(getSceneOutfitForNow(char.id, at(12)).scene, 'work');
  assert.equal(getSceneOutfitForNow(char.id, at(20)).scene, 'casual');
  const splitSleep = character([casual, sleep], day);
  assert.equal(getSceneOutfitForNow(splitSleep.id, at(12)).scene, 'work');
});

test('保留明确换装、名称/ID匹配和 null 沿用，允许显式换回默认', () => {
  const char = character([casual, sleep]);
  const casualId = listSceneOutfits(char.id).find(o => o.scene === 'casual').id;
  const activities = [activity('00:00', '07:00', sleep.name, -1), activity('07:00', '10:00', String(casualId)),
    activity('10:00', '12:00'), activity('12:00', '15:00', '无效名称'), activity('15:00', '22:00', '日常装'),
    activity('22:00', '00:00', sleep.name, -1)];
  db.prepare('INSERT INTO daily_schedules(character_id,schedule_date,schedule_json) VALUES (?,?,?)')
    .run(char.id, getLocalDateKey(at(12)), JSON.stringify(activities));
  for (const hour of [8, 11, 13]) assert.equal(getSceneOutfitForNow(char.id, at(hour)).scene, 'casual');
  assert.equal(getSceneOutfitForNow(char.id, at(16)).scene, 'work');
  assert.deepEqual(asPersonaOutfits(getSceneOutfitForNow(char.id, at(8))), {
    limited: [{ name: casual.name, description: casual.description }], exclusive: null,
  });
});

test('清醒时误标睡衣回到默认，未配置睡衣时不编造睡衣', () => {
  const char = character([sleep], [activity('00:00', '00:00', sleep.name)]);
  assert.equal(getSceneOutfitForNow(char.id, at(12)).scene, 'work');
  const noSleep = character([casual], day);
  assert.equal(getSceneOutfitForNow(noSleep.id, at(2)).scene, 'work');
});

test('道具换装仍优先于默认兜底，默认不会变成特殊服饰注入', () => {
  const char = character([sleep]);
  assert.equal(buildCharacterPersona(char), buildCharacterPersona(char, { outfits: null }));
  db.prepare('INSERT INTO global_outfits(name,description,enabled,character_id) VALUES (?,?,1,?)')
    .run('限时服饰', 'Temporary golden gown.', char.id);
  assert.match(buildCharacterPersona(char), /Temporary golden gown/);
});

test('提示明确默认常穿和换装理由，无次数/比例配额；完整 JSON 示例可解析', () => {
  const custom = { scene: 'work', name: '常服"蓝"', description: appearance };
  for (const outfits of [[custom, casual, sleep], [custom, home]]) {
    const prompt = buildOutfitAnnotation(outfits);
    assert.match(prompt, /默认服饰是角色清醒时的常态形象/);
    assert.match(prompt, /在该活动的 description 中自然交代换装理由/);
    assert.doesNotMatch(prompt, /2~4|最多 4 次|在家不要穿工装|\d+%/);
    const example = JSON.parse(prompt.split('\n').find(line => line.startsWith('{"activities":')));
    assert.deepEqual(example.activities.map(a => a.outfit), [custom.name, null, null, outfits.includes(sleep) ? sleep.name : null]);
    for (const act of example.activities) assert.ok(act.description.length >= 26 && act.description.length <= 52);
  }
});

test('日程生成与解析保留 outfit，独立衣柜变化只改变稳定边界之后的消息', async () => {
  const char = character();
  const requests = [];
  const result = { activities: day.map(a => ({ ...a, outfit: a.replyDelay === -1 ? sleep.name : '日常装' })) };
  for (const outfits of [[sleep], [casual, sleep]]) {
    const generated = await generateSchedule(char, '', { persist: false, outfits, chat: async (messages, options) => {
      requests.push({ messages, options });
      return JSON.stringify(result);
    } });
    assert.deepEqual(JSON.parse(generated.schedule_json).map(a => a.outfit), result.activities.map(a => a.outfit));
  }
  const [first, second] = requests;
  const boundary = first.options.lorebook.cacheBoundary;
  assert.deepEqual(first.messages.slice(0, boundary.index + 1), second.messages.slice(0, boundary.index + 1));
  assert.equal(first.messages[boundary.index].content.length, boundary.offset);
  assert.match(first.messages[boundary.index + 1].content, /日常装/);
  assert.match(second.messages[boundary.index + 1].content, /休闲裙/);
  assert.equal(first.messages.filter(m => m.role === 'user').length, 1);
  assert.equal(first.messages.at(-1).role, 'user');
});

test('独立天使衣柜同样在睡醒后回默认，保留睡眠与明确私服选择', () => {
  const angel = { persona: basePrompt, scene_outfits_json: JSON.stringify([casual, sleep]), schedule: day };
  assert.equal(selectAngelOutfit(angel, { activity: day[0], activity_index: 0 }).scene, 'sleep');
  assert.equal(selectAngelOutfit(angel, { activity: day[1], activity_index: 1 }).scene, 'work');
  assert.equal(selectAngelOutfit(angel, { activity: { ...day[1], outfit: casual.name }, activity_index: 1 }).scene, 'casual');
});
