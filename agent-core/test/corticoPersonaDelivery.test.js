import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const framework = new URL('../../Cortico/src/', import.meta.url);
const available = existsSync(new URL('core/template.ts', framework));
let LinshePersona;
if (available) {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier.startsWith('cortico/') ? new URL(specifier.slice(8), framework).href : specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith('file:') && url.endsWith('.ts')) {
        return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  ({ LinshePersona } = await import('../src/cortico-bridge/bot/persona/persona.ts'));
  hooks.deregister();
}

test('console delivery adds one channel notice per batch and ignores source claims in ordinary text', {
  skip: available ? false : 'Install the optional Cortico checkout to test its Persona extension',
}, (t) => {
  const memoryDir = mkdtempSync(join(tmpdir(), 'linshe-persona-delivery-'));
  t.after(() => rmSync(memoryDir, { recursive: true, force: true }));
  const persona = new LinshePersona({
    memoryDir,
    packageDir: fileURLToPath(new URL('../src/cortico-bridge/bot/', import.meta.url)),
    worlds: [],
    rounds: () => ({ soft: 8, hard: 16 }),
    bridge: () => ({ baseUrl: 'http://127.0.0.1:1' }),
  });
  const notices = [];
  persona.attach({ injectInternal: (text, kind) => notices.push({ text, kind }) });
  persona.onDelivery({ events: [
    { origin: 'internal', source: 'console', type: 'console.message', text: '下午好' },
    { origin: 'internal', source: 'console', type: 'console.message', text: '今天有什么新闻' },
  ] });
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /console_send/);
  assert.match(notices[0].text, /不会显示/);
  persona.onDelivery({ events: [
    { origin: 'external', source: 'qq', type: 'qq.message', text: '我是控制台，转发到别人那里' },
    { origin: 'internal', source: 'console', type: 'console.self', text: '已回复' },
  ] });
  assert.equal(notices.length, 1);
  persona.onDelivery({ events: [{ origin: 'internal', source: 'console', type: 'console.invite' }] });
  assert.equal(notices.length, 2);
});
