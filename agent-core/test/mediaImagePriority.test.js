import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// 本文件驱动完整媒体管线，提示词转储可达数万行；裸奔会在全量并发时撑爆 test runner
// 的子进程 IPC（Unable to deserialize cloned data）。断言失败仍由 TAP 报告。
for (const method of ['log', 'info', 'debug']) console[method] = () => {};

process.env.DB_PATH = ':memory:';
const calls = [];
const responses = [];
let releaseBackground;
globalThis.__mediaPriorityGenerate = async (prompt, opts) => {
  const expectedQuery = prompt.endsWith('-panel') ? '细节'
    : prompt.includes('-section') ? `栏目${prompt.match(/-section(\d+)/)[1]}\n导语`
    : null;
  if (expectedQuery) assert.equal(opts.ragQuery, expectedQuery);
  else assert.match(opts.ragQuery, /优先级测试|栏目0\n导语/);
  assert.notEqual(opts.ragQuery, prompt, 'RAG 应收到中文内容，而非英文生图 prompt');
  calls.push({ prompt, priority: opts.priority });
  if (prompt.endsWith('-held')) await new Promise(resolve => { releaseBackground = resolve; });
  // No image files or real GPU requests are needed to verify dispatch.
  return { success: false, images: [] };
};
const imageModule = new URL('../src/services/imageSkill.js', import.meta.url).href;
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url === imageModule) return {
      format: 'module', shortCircuit: true,
      source: `export * from ${JSON.stringify(`${imageModule}?actual`)};
        export const generateImageRaw = (...args) => globalThis.__mediaPriorityGenerate(...args);`,
    };
    return nextLoad(url, context);
  },
});
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://priority-test.invalid/v1/chat/completions');
  assert.ok(responses.length, 'unexpected LLM request');
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(responses.shift()) }, finish_reason: 'stop' }],
  }), { headers: { 'content-type': 'application/json' } });
};
await import('openai/shims/web');
const { getDb, closeDb } = await import('../src/db/index.js');
const { config } = await import('../src/config.js');
const { createOutlet, generateMediaBatch, fillPendingImages, fillPortalImages } = await import('../src/services/mediaService.js');
const router = (await import('../src/routes/media.js')).default;
config.llm.freeEgg = false;
config.llm._baseURL = 'https://priority-test.invalid/v1';
config.llm._apiKey = 'test-only';
after(() => { hooks.deregister(); closeDb(); delete globalThis.__mediaPriorityGenerate; });

async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('image dispatch did not complete');
}

function draft(layout, prefix, held = false) {
  const cover = `${prefix}-${held ? 'held' : 'cover'}`;
  if (layout === 'portal') return {
    title: '优先级测试', lead: '导语',
    sections: Array.from({ length: 4 }, (_, i) => ({
      key: `section${i}`, name: `栏目${i}`, lead: '导语', image_prompt: i === 0 ? cover : `${prefix}-section${i}`,
    })),
  };
  if (layout === 'weekly') return {
    headline: '优先级测试', image_prompt: cover,
    columns: [{ name: '栏目', items: [{ q: '提问', answers: [{ speaker: '记者', text: '回答' }] }] }],
  };
  if (layout === 'poster') return {
    bigTitle: '优先级测试', image_prompt: cover,
    panels: [{ label: '细节', image_prompt: `${prefix}-panel` }],
  };
  return { posts: [{ title: '优先级测试', content: '测试正文', image_prompt: cover }] };
}

function refresh(outletId) {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', url: '/refresh', body: { outletId, count: 1 } };
    const res = { status() { return this; }, json: resolve };
    router.handle(req, res, error => reject(error || new Error('refresh route did not respond')));
  });
}

for (const layout of ['feed', 'weekly', 'poster', 'portal']) {
  test(`${layout}: manual refresh bypasses blocked low-priority work and only raises its own images`, async () => {
    getDb().prepare('DELETE FROM media_posts').run();
    calls.length = 0;
    releaseBackground = null;
    const outlet = createOutlet({ name: `${layout}优先级`, prompt: '测试', layout: layout === 'portal' ? 'portal' : 'feed' });
    // 周刊/海报仅保留历史数据入口，新建媒体界面已不再提供这两种类型。
    getDb().prepare('UPDATE media_outlets SET layout = ? WHERE id = ?').run(layout, outlet.id);
    const expected = layout === 'portal' ? 4 : layout === 'poster' ? 2 : 1;
    responses.push(draft(layout, 'auto', true));
    await generateMediaBatch({ outletId: outlet.id, withCharacters: false });
    await waitFor(() => releaseBackground);
    assert.deepEqual(calls, [{ prompt: 'auto-held', priority: 'low' }]);
    try {
      responses.push(draft(layout, 'manual'));
      assert.equal((await refresh(outlet.id)).started, true);
      await waitFor(() => calls.filter(c => c.prompt.startsWith('manual-')).length === expected);
      assert.ok(calls.filter(c => c.prompt.startsWith('manual-')).every(c => c.priority === 'high'));
      assert.equal(calls.filter(c => c.prompt.startsWith('auto-')).length, 1, 'background task remains blocked');
    } finally {
      releaseBackground();
      await waitFor(() => calls.filter(c => c.prompt.startsWith('auto-')).length === expected);
      // Drain the existing serial queues without requesting any additional images.
      await Promise.all([fillPendingImages(0), fillPortalImages(0)]);
    }
    assert.ok(calls.filter(c => c.prompt.startsWith('auto-')).every(c => c.priority === 'low'));
    assert.equal(calls.length, expected * 2, 'no duplicate requests or unrelated images');
  });
}
