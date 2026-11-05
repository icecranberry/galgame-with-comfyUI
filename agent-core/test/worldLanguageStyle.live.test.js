import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import Database from 'better-sqlite3';

// 显式启用：只读真实库并 backup 到临时目录，执行真实业务组装，在模型调用前截获。
test('真实库快照：检查语言风格在私聊、群聊、朋友圈与回评的实际注入位置', {
  skip: process.env.LANGUAGE_STYLE_LIVE_AUDIT !== '1', timeout: 90000,
}, async t => {
  const { config } = await import('../src/config.js');
  const sourcePath = config.dbPath;
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const worldsBefore = source.prepare('SELECT id,name,is_active,content,language_style FROM world_settings ORDER BY id').all();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'linshe-style-audit-'));
  await source.backup(path.join(temp, 'audit.db'));
  source.close();
  config.dbPath = path.join(temp, 'audit.db');
  process.env.DB_PATH = config.dbPath;
  const { getDb, closeDb } = await import('../src/db/index.js');
  const db = getDb();
  t.after(() => {
    closeDb();
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  assert.equal(db.name, path.join(temp, 'audit.db'));
  const network = [];
  const denyNetwork = url => { network.push(String(url).slice(0, 160)); throw new Error('AUDIT_NETWORK_DISABLED'); };
  t.mock.method(globalThis, 'fetch', denyNetwork);
  for (const transport of [http, https]) for (const method of ['request', 'get']) t.mock.method(transport, method, denyNetwork);
  syncBuiltinESMExports();
  // 使用真实原始消息和真实预设/世界书适配，仅在准备完请求后中断。
  const captures = [];
  const stop = new Error('LANGUAGE_STYLE_AUDIT_CAPTURED');
  let scenario = '';
  globalThis.__languageStyleAudit = { capture(original, options, prepared) {
    captures.push({ scenario, original, options, messages: prepared.messages, lorebookReport: prepared.report || null, presetReport: prepared.presetReport || null });
    throw stop;
  } };
  const hooks = registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/src/services/presets/narrative.js')) return result;
    const text = String(result.source);
    const target = 'export const { prepareNarrativePrompt, chatWithPreset } = createNarrativeRuntime();';
    assert.ok(text.includes(target));
    return { ...result, source: text.replace(target, `
      const auditRuntime = createNarrativeRuntime();
      export async function prepareNarrativePrompt(messages, options = {}, presetOptions = {}) {
        const prepared = await auditRuntime.prepareNarrativePrompt(messages, options, presetOptions);
        return globalThis.__languageStyleAudit.capture(messages, options, prepared);
      }
      export async function chatWithPreset(messages, opts = {}) {
        return prepareNarrativePrompt(messages, opts.lorebook ?? {}, opts);
      }
    `) };
  } });
  t.after(() => { hooks.deregister(); delete globalThis.__languageStyleAudit; });
  // 当前日程可能排队；本验收只关闭日程拦截以进入正文组装，其余数据保留。
  const scheduleEnabled = config.features.schedule;
  config.features.schedule = false;
  const active = db.prepare('SELECT * FROM world_settings WHERE is_active=1').get();
  assert.ok(active);
  const character = db.prepare("SELECT c.* FROM characters c WHERE c.id>1 AND EXISTS (SELECT 1 FROM raw_messages r WHERE r.conversation_id='char_' || c.id) ORDER BY c.id LIMIT 1").get();
  assert.ok(character, '需要真实私聊角色');
  const group = db.prepare('SELECT g.id,g.name FROM group_chats g WHERE EXISTS (SELECT 1 FROM group_members m WHERE m.group_id=g.id) ORDER BY g.id LIMIT 1').get();
  assert.ok(group, '需要真实群聊');
  const post = db.prepare("SELECT * FROM moment_posts WHERE character_id=? AND status='done' ORDER BY id DESC LIMIT 1").get(character.id);
  assert.ok(post, '需要真实朋友圈');
  const historyComments = db.prepare('SELECT * FROM moment_comments WHERE post_id=? ORDER BY id').all(post.id);
  const router = (await import('../src/routes/chat.js')).default;
  const privateHandler = router.stack.find(layer => layer.route?.path === '/characters/:id/chat' && layer.route.methods.post).route.stack.at(-1).handle;
  const { runGroupRound } = await import('../src/services/groupChatEngine.js');
  const { generateMomentPost } = await import('../src/routes/moments.js');
  const { generateCharacterCommentReply } = await import('../src/services/momentCommentService.js');
  const run = async (name, fn) => {
    scenario = name;
    const before = captures.length;
    try { await fn(); } catch (error) { if (error !== stop && error.message !== stop.message) throw error; }
    assert.equal(captures.length, before + 1, `未截获 ${name} 的实际请求`);
  };
  const privateChat = async () => {
    const req = new EventEmitter();
    Object.assign(req, { params: { id: String(character.id) }, body: { message: '今天过得怎么样？', image_mode: 'off', client_msg_id: 'language-style-audit-fixed' }, socket: { setTimeout() {} } });
    const res = new EventEmitter();
    Object.assign(res, { setTimeout() {}, writeHead() {}, write() {}, end() { this.writableEnded = true; this.emit('close'); }, status() { return this; }, json(data) { throw new Error(JSON.stringify(data)); } });
    await privateHandler(req, res);
  };
  const probe = '【语言风格注入验收】语气温和，接话简洁。\n对方：今天过得怎么样？\n回复：还不错，刚好等到你。';
  for (const [phase, style] of [['saved', active.language_style], ['probe', probe]]) {
    db.prepare('UPDATE world_settings SET language_style=? WHERE id=?').run(style || '', active.id);
    await run(`${phase}:private`, privateChat);
    await run(`${phase}:group`, () => runGroupRound(group.id, { trigger: 'user', userMessage: '今天过得怎么样？' }));
    await run(`${phase}:moment`, () => generateMomentPost(character, { manual: true, forcedTopic: { name: '日常近况', desc: '分享今天的一件小事' } }));
    await run(`${phase}:comment`, () => generateCharacterCommentReply(character, post, historyComments));
  }
  const locate = messages => messages.flatMap((message, index) => {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    const offset = content.indexOf('<additional_writing_style>');
    if (offset < 0) return [];
    return [{ index, messageNumber: index + 1, role: message.role, offset,
      occurrences: content.split('<additional_writing_style>').length - 1,
      before: content.slice(Math.max(0, offset - 180), offset),
      block: content.slice(offset, content.indexOf('</additional_writing_style>', offset) + '</additional_writing_style>'.length),
      after: content.slice(content.indexOf('</additional_writing_style>', offset) + '</additional_writing_style>'.length).slice(0, 180),
      precedingMessage: index ? messages[index - 1].content?.slice?.(0, 90) : null,
      followingMessage: messages[index + 1]?.content?.slice?.(0, 90) || null,
    }];
  });
  const summary = captures.map(capture => ({ scenario: capture.scenario, messageCount: capture.messages.length,
    original: locate(capture.original), final: locate(capture.messages), cacheBoundary: capture.options.cacheBoundary || null,
    preset: capture.presetReport ? { name: capture.presetReport.name, active: capture.presetReport.presetActive } : null,
    lorebook: capture.lorebookReport ? { name: capture.lorebookReport.name, placements: capture.lorebookReport.placements, warnings: capture.lorebookReport.warnings } : null,
  }));
  for (const entry of summary) {
    assert.equal(entry.final.length, entry.scenario.startsWith('probe:') || active.language_style?.trim() ? 1 : 0);
    if (entry.final.length) {
      assert.equal(entry.final[0].occurrences, 1);
      assert.equal(entry.final[0].role, 'system');
      const placement = entry.final[0];
      if (entry.scenario.endsWith(':private')) assert.match(placement.before, /<\/dialogue_rules>\s*$/);
      if (entry.scenario.endsWith(':group')) {
        assert.match(placement.before, /禁止重复别人刚说过的意思\s*$/);
        assert.match(placement.after, /^\n- 爱发图：/);
      }
      if (entry.scenario.endsWith(':moment')) assert.match(placement.after, /图文互补/);
      if (entry.scenario.endsWith(':comment')) assert.match(placement.before, /只输出评论\/回复的文本本身/);
    }
  }
  const verify = new Database(sourcePath, { readonly: true, fileMustExist: true });
  assert.deepEqual(verify.prepare('SELECT id,name,is_active,content,language_style FROM world_settings ORDER BY id').all(), worldsBefore);
  verify.close();
  const report = { sourcePath, sourceWorldsUnchanged: true, sourceOpenedReadOnly: true,
    world: { id: active.id, name: active.name, savedStyleLength: active.language_style?.length || 0 },
    character: { id: character.id, name: character.display_name }, group, postId: post.id,
    scheduleEnabledBeforeAudit: scheduleEnabled, scheduleBypassedInSnapshot: true,
    externalRequestsBlocked: network.length, summary, captures };
  if (process.env.LANGUAGE_STYLE_AUDIT_REPORT) fs.writeFileSync(process.env.LANGUAGE_STYLE_AUDIT_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ world: report.world, character: report.character, group,
    sourceWorldsUnchanged: true, externalRequestsBlocked: network.length,
    placements: summary.map(row => ({ scenario: row.scenario, messageCount: row.messageCount,
      locations: row.final.map(({ index, messageNumber, role, offset, occurrences }) => ({ index, messageNumber, role, offset, occurrences })), cacheBoundary: row.cacheBoundary })),
  }, null, 2));
});
