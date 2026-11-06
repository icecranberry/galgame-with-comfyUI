/**
 * 小范围真实LLM验收（默认跳过，不启动应用或任何后台调度）。
 * PowerShell: $env:LINSHE_COHABITATION_LIVE='1'; node --test test/cohabitationLive.test.js
 * 可选 LINSHE_SOURCE_DB / LINSHE_COHABITATION_REPORT。源库始终只读，测试库只存在于内存。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

test('四角色、两居室的隔离数据库真实LLM验收', { skip: process.env.LINSHE_COHABITATION_LIVE !== '1', timeout: 600_000 }, async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const sourcePath = path.resolve(process.env.LINSHE_SOURCE_DB || path.join(root, 'agent-core/data/agent.db'));
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const targetPath = ':memory:';
  process.env.DB_PATH = targetPath;
  const reportPath = path.resolve(process.env.LINSHE_COHABITATION_REPORT || path.join(root, 'output/cohabitation-validation/live.json'));
  let closeDb;
  const started = Date.now();
  const calls = [], usage = [];
  const originalLog = console.log;
  console.log = (...args) => {
    const line = args.map(String).join(' ');
    const cache = line.match(/^\[cache\].*: 命中 (\d+)\/(\d+) prompt tokens.*输出 (\d+)/);
    const plain = line.match(/^\[usage\].*: prompt (\d+) \| 输出 (\d+)/);
    if (cache) usage.push({ prompt: +cache[2], completion: +cache[3], cached: +cache[1] });
    else if (plain) usage.push({ prompt: +plain[1], completion: +plain[2], cached: 0 });
    if (/^\[(?:cache|usage|live)\]/.test(line)) originalLog(...args);
  };
  try {
    const { config, activateLlmProfile } = await import('../src/config.js'); config.dbPath = targetPath;
    const database = await import('../src/db/index.js'); closeDb = database.closeDb;
    const db = database.getDb();
    assert.equal(config.dbPath, ':memory:');
    // 只复制LLM连接配置；不用源库的角色数量、任务状态或后台调度设置。
    const settings = source.prepare("SELECT setting_key,setting_value FROM system_settings WHERE setting_key LIKE 'llm_%' OR setting_key='active_llm_profile_id'").all();
    for (const s of settings) db.prepare('INSERT OR REPLACE INTO system_settings(setting_key,setting_value) VALUES(?,?)').run(s.setting_key, s.setting_value);
    const activeId = settings.find(s => s.setting_key === 'active_llm_profile_id')?.setting_value;
    if (activeId) assert.equal(activateLlmProfile(activeId).ok, true);
    config.features.serializeBackgroundLLM = false;
    config.features.town = false; config.features.schedule = true;
    config.llm.thinkingMode = 'disabled'; config.llm.maxTokens = 4096;
    // 测试角色和世界观完全独立：只复用现有连接配置，不复制真实人格、聊天或日程。
    const fixtures = [
      ['林夏', '成年图书管理员，做事仔细，喜欢晨间散步和烹饪，通常22点睡6点醒。', '棕色短发、绿色眼睛，穿米色针织衫。'],
      ['乔宁', '成年自由插画师，善于观察，喜欢晚间创作，通常凌晨0点睡8点醒。', '黑色齐肩发、棕色眼睛，穿蓝色衬衫。'],
      ['陈悠', '成年咖啡店店主，性格爽朗，喜欢研究咖啡和甜点，通常23点睡7点醒。', '深棕长发、黑色眼睛，穿灰色围裙。'],
      ['陆遥', '成年园艺师，安静认真，喜欢照顾植物和修理家具，通常22点睡6点醒。', '黑色短发、棕色眼睛，穿绿色工作服。'],
    ];
    if (process.env.LINSHE_COHABITATION_STRESS === '1') {
      fixtures[0][1] = '成年夜班图书管理员，凌晨整理资料，喜欢做饭，通常凌晨5点睡到下午13点，不能按普通早起作息安排。';
      fixtures[1][1] = '成年自由插画师，凌晨创作，通常凌晨3点睡到上午11点，午后处理委托，喜欢散步和咖啡。';
    }
    const selected = fixtures.map(([name, short, appearance], index) => ({ id: 100 + index, name, display_name: name,
      short_prompt: short, base_prompt: `## 你的性格\n${short}\n## 你的外观\n你是${appearance}`, avatar_path: null,
      loras: JSON.stringify([{ name: `test-${index}.safetensors`, strength: 0.7 }]), custom_workflow: null, artist_override: null }));
    const ids = selected.map(c => c.id);
    const sourceSnapshot = () => source.prepare('SELECT COUNT(*) AS count,SUM(version) AS versions,MAX(generated_at) AS latest FROM schedule_templates').get();
    const beforeSource = sourceSnapshot();
    for (const c of selected) db.prepare(`INSERT INTO characters(id,name,display_name,base_prompt,short_prompt,avatar_path,loras,custom_workflow,artist_override)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(c.id, c.name, c.display_name, c.base_prompt, c.short_prompt, c.avatar_path, c.loras, c.custom_workflow, c.artist_override);
    for (const [from, to, relationship] of [[100,101,'相处熟悉的室友'],[102,103,'一起经营庭院的朋友'],[100,102,'经常相约讨论书籍与咖啡的朋友'],[101,103,'有过项目争执的竞争对手']]) {
      db.prepare('INSERT INTO character_relationships(from_character_id,to_character_id,relationship_text) VALUES(?,?,?)').run(from,to,relationship);
    }
    db.prepare('UPDATE world_settings SET name=?,content=? WHERE is_active=1').run('共同生活实测小镇','现代生活小镇，所有角色都是成年人，保持各自职业，居民在图书馆、咖啡馆、庭院与居室间生活。');
    for (const [i, name] of ['晨光居室', '晚风居室'].entries()) {
      const roomId = Number(db.prepare('INSERT INTO cohabitation_rooms(name) VALUES(?)').run(name).lastInsertRowid);
      for (const id of ids.slice(i * 2, i * 2 + 2)) db.prepare('INSERT INTO cohabitation_members VALUES(?,?)').run(id, roomId);
    }
    const { chatSync } = await import('../src/services/lorebook/runtime.js');
    const { planResidence } = await import('../src/services/cohabitationPlanner.js');
    const { generateSchedule } = await import('../src/services/scheduleGenerator.js');
    const { startScheduleBatch } = await import('../src/services/scheduleBatch.js');
    const { readCohabitationPlan, readTemplate } = await import('../src/db/cohabitationRepository.js');
    const { scheduleImageContext, scheduleMomentCompanions } = await import('../src/services/scheduleParticipants.js');
    const { assertCompleteDay, overlaps, intervals, timeOf, minuteOf, applySharedActivities } = await import('../src/services/cohabitationSchedule.js');
    const { reserveEventTime } = await import('../src/services/eventSchedule.js');
    const { getLocalDateKey } = await import('../src/utils/localDate.js');
    const { refresh } = await import('../src/services/characterSearch.js'); refresh();
    const chat = async (messages, opts) => {
      if (calls.length >= 9) throw new Error('达到本次实测9次LLM调用上限');
      const record = { label: opts.label, inputChars: messages.reduce((n, m) => n + m.content.length, 0) };
      calls.push(record); const start = Date.now();
      const result = await chatSync(messages, opts); record.elapsedMs = Date.now() - start;
      return result;
    };
    const direction = `本次小范围验证：请让${selected[0].display_name}与${selected[2].display_name}在14:00～15:00于公共会客厅会面，互动内容结合现有关系。这个要求仅适用于这两人；若此前居室已经安排此事则直接沿用，不重复新增。其他活动自由安排。`;
    const seenOccupancy = [];
    const realDrafts = {};
    const result = await startScheduleBatch({ db, direction, random: () => 0.99,
      planner: input => { seenOccupancy.push({ room: input.room.name, earlierEvents: input.events.map(e => ({ id: e.sharedEventId, participantIds: e.participantIds, startTime: e.startTime, endTime: e.endTime })) }); return planResidence(input, { chat }); },
      generator: async (c, d, o) => {
        const generated = await generateSchedule(c, d, { ...o, chat });
        realDrafts[c.id] = JSON.parse(generated.schedule_json);
        return generated;
      },
      onProgress: p => originalLog(`[live] ${p.phase} ${p.character_name || ''} ${p.current}/${p.total}`),
    }).promise;
    const schedules = Object.fromEntries(ids.map(id => [id, readTemplate(db, id)]));
    for (const s of Object.values(schedules)) assertCompleteDay(s);
    const cross = result.events.find(e => e.participantIds.includes(ids[0]) && e.participantIds.includes(ids[2]));
    assert.ok(cross, '应生成指定的跨居室活动');
    assert.ok(seenOccupancy[1].earlierEvents.some(e => e.id === cross.sharedEventId), '第二居室收到第一居室约定');
    const scene = scheduleImageContext(selected[0], cross);
    const companions = scheduleMomentCompanions(ids[0], cross);
    assert.ok(scene.participantIds.includes(ids[2])); assert.ok(companions.some(c => c.otherId === ids[2]));
    assert.ok(scene.crossReference.includes(selected[2].display_name));
    assert.equal(scene.imageOptions.loras.length, 2);
    // 在真实返回的草稿上故障注入，再经完整批次/数据库发布；不把注入称为模型自然失败。
    const participants = [ids[0], ids[2]];
    const sleeps = participants.flatMap(id => realDrafts[id].filter(a => a.replyDelay === -1));
    const commonStart = sleeps.map(a => minuteOf(a.endTime)).find(start => start >= 60 && start < 1320
      && !sleeps.some(a => overlaps(a, { startTime: timeOf(start), endTime: timeOf(start + 90) })));
    assert.ok(commonStart != null, '实测草稿需有睡眠结束后的共同清醒窗口');
    const repairs = [];
    const sleepMinutes = acts => acts.filter(a => a.replyDelay === -1).flatMap(intervals).reduce((sum, [s,e]) => sum + e - s, 0);
    for (const lead of [15, 30, 60]) {
      for (const id of ids) db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE character_id=? AND schedule_date=?')
        .run(JSON.stringify(realDrafts[id]), id, getLocalDateKey());
      const fixed = { startTime: timeOf(commonStart), endTime: timeOf(commonStart + 30), activity: '用户明确约定',
        location: '会客室', description: '按用户要求处理已约定事务。', replyDelay: 0, edited: true };
      if (lead === 30) db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE character_id=? AND schedule_date=?')
        .run(JSON.stringify(reserveEventTime(realDrafts[ids[0]], fixed, commonStart, commonStart + 30)), ids[0], getLocalDateKey());
      const expectedStart = commonStart + (lead === 30 ? 30 : 0);
      const injected = { startTime: timeOf(commonStart - lead), endTime: timeOf(commonStart - lead + 60),
        activity: '故障注入共同散步', description: '林夏和陈悠沿着小镇街道散步，交流当天的工作安排与生活见闻。',
        location: '街区', participantIds: participants, replyDelay: 0 };
      const victim = participants.find(id => realDrafts[id].some(a => a.replyDelay === -1 && overlaps(a, injected)));
      assert.ok(victim);
      assert.throws(() => applySharedActivities(realDrafts[victim], [injected], victim), /睡眠冲突/, '旧插入策略可确定复现截图错误');
      let planned = false;
      const replay = await startScheduleBatch({ db, random: () => .99,
        planner: async input => {
          if (planned) return []; planned = true;
          return [{ ...injected, sharedEventId: `${input.batchId}:injected`, cohabitationBatchId: input.batchId }];
        },
        generator: async c => ({ schedule_json: JSON.stringify(realDrafts[c.id]) }),
      }).promise;
      assert.equal(replay.events.length, 1);
      assert.equal(replay.events[0].startTime, timeOf(expectedStart));
      for (const id of ids) {
        const published = readTemplate(db, id); assertCompleteDay(published);
        assert.equal(sleepMinutes(published), sleepMinutes(realDrafts[id]));
        if (participants.includes(id)) assert.equal(published.find(a => a.sharedEventId)?.startTime, timeOf(expectedStart));
      }
      if (lead === 30) {
        const daily = JSON.parse(db.prepare('SELECT schedule_json FROM daily_schedules WHERE character_id=? AND schedule_date=?').get(ids[0], getLocalDateKey()).schedule_json);
        assertCompleteDay(daily);
        assert.ok(daily.some(a => a.activity === fixed.activity && a.startTime === fixed.startTime && a.endTime === fixed.endTime));
      }
      repairs.push({ injected: [injected.startTime, injected.endTime], repaired: [replay.events[0].startTime, replay.events[0].endTime],
        protectedAppointment: lead === 30, oldStrategyRejected: true });
    }
    assert.deepEqual(sourceSnapshot(), beforeSource, '源库中所选角色的日程未被本次实测改动');
    const report = { ok: true, scenario: process.env.LINSHE_COHABITATION_STRESS === '1' ? 'night-shift' : 'regular', model: config.llm.model, elapsedMs: Date.now() - started, calls,
      usage: { prompt: usage.reduce((n, u) => n + u.prompt, 0), completion: usage.reduce((n, u) => n + u.completion, 0), cached: usage.reduce((n, u) => n + u.cached, 0) },
      isolation: { sourceReadOnly: true, sourceSchedulesUnchanged: true, testDatabase: ':memory:' },
      characters: selected.map(c => ({ id: c.id, display_name: c.display_name, avatar_path: c.avatar_path })),
      rooms: readCohabitationPlan(db).rooms, events: result.events, seenOccupancy, schedules, realDrafts, injectedConflictReplays: repairs,
      downstream: { peekParticipantIds: scene.participantIds, loraCount: scene.imageOptions.loras?.length || 0, momentCompanionIds: companions.map(c => c.otherId), generatedImages: false },
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    originalLog(`[live] PASS ${calls.length} calls; report=${reportPath}`);
  } finally {
    console.log = originalLog; closeDb?.(); source.close();
  }
});
