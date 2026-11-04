import { createRequire } from 'node:module'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

/** Reusable isolated server for interaction tests and visual review. Production APIs are read-only avatar sources. */
export async function createCohabitationUiFixture({ review = false } = {}) {
  process.env.DB_PATH = ':memory:'
  const requireCore = createRequire(new URL('../../../agent-core/package.json', import.meta.url))
  const express = requireCore('express')
  const { getDb, closeDb } = await import('../../../agent-core/src/db/index.js')
  const oldLog = console.log; console.log = () => {}
  let db
  try { db = getDb() } finally { console.log = oldLog }
  const names = ['林舟', '苏晴', '周宁', '许棠', '江闻', '宋青', '沈星河', '顾言', '夏川', '白榆', '林见鹿', '陈禾', '苏晚', '孟遥', '陆知微', '乔安', '许清和', '云岚', '叶知秋', '季川']
  const colors = ['#bfd5cc', '#ead0c4', '#cdd5e8', '#ded1e3']
  let source = []
  if (review) {
    try { source = (await (await fetch('http://127.0.0.1:3099/api/cohabitation')).json()).characters.filter(c => c.avatar_path).slice(0, 20) } catch { /* Offline review still works with local fixture avatars. */ }
  }
  const characters = names.slice(0, review ? 20 : 4).map((name, i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="${colors[i % 4]}"/><circle cx="48" cy="36" r="18" fill="#fff9ef"/><path d="M18 90q0-38 30-38t30 38" fill="#fff9ef"/></svg>`
    const avatar = source[i]?.avatar_path || 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    const displayName = source[i]?.display_name || name
    const id = Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt,avatar_path) VALUES(?,?,?,?)').run(name, displayName, '界面验收角色', avatar).lastInsertRowid)
    return { id, name, display_name: displayName, avatar_path: avatar, schedule_enabled: 1 }
  })
  if (review) {
    for (const [name, members] of [['晨光居室', characters.slice(0, 3)], ['晚风居室', characters.slice(3, 5)], ['窗边小屋', []]]) {
      const id = db.prepare('INSERT INTO cohabitation_rooms(name) VALUES(?)').run(name).lastInsertRowid
      for (const c of members) db.prepare('INSERT INTO cohabitation_members VALUES(?,?)').run(c.id, id)
    }
  }
  const app = express(); app.use(express.json())
  app.use('/api/cohabitation', (await import('../../../agent-core/src/routes/cohabitation.js')).default)
  app.get('/avatars/*', async (req, res) => {
    try {
      const response = await fetch('http://127.0.0.1:3099' + req.path)
      res.status(response.status).type(response.headers.get('content-type') || 'image/png').send(Buffer.from(await response.arrayBuffer()))
    } catch { res.sendStatus(404) }
  })
  app.get('/api/*', (_req, res) => res.json({ characters, folders: [], list: [], items: [], pendingItems: [], chest: {}, activeEffects: [], newspaper: null }))
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const vite = await createServer({ root, configFile: false, plugins: [vue()], server: { middlewareMode: true, hmr: { server, clientPort: server.address().port } }, appType: 'custom' })
  const html = `<!doctype html><html data-theme="warm"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module">
    import { createApp, h, ref, nextTick } from 'vue';
    import { createPinia } from 'pinia';
    import { createRouter, createMemoryHistory } from 'vue-router';
    import TavernView from '/src/views/TavernView.vue';
    import { useChatStore } from '/src/stores/chat.js';
    import '/src/assets/fonts/fonts.css'; import '/src/styles/tokens.css'; import '/src/styles/base.css'; import '/src/styles/components.css'; import '/src/styles/animations.css';
    const state = new URLSearchParams(location.search).get('state') || 'warm';
    document.documentElement.dataset.theme = state === 'dark' ? 'dark' : 'warm';
    const app = createApp({render: () => h(TavernView)}).use(createPinia());
    app.use(createRouter({ history: createMemoryHistory(), routes: [{ path:'/',component:TavernView }] }));
    useChatStore().characters = ${JSON.stringify(characters)};
    const mobile = ref(innerWidth < 768); addEventListener('resize',()=>mobile.value=innerWidth<768);
    window.notices=[]; app.provide('isMobile',mobile).provide('toggleMobileSidebar',()=>{}).provide('confirm',async()=>true).provide('toast',(...args)=>window.notices.push(args));
    app.mount('#app'); await nextTick();
    if (${review}) [...document.querySelectorAll('.relation-entry')].find(el => el.textContent.includes('宿舍安排')).click();
  </script></body></html>`
  app.get('/__test', async (_req, res, next) => { try { res.type('html').send(await vite.transformIndexHtml('/__test', html)) } catch (error) { next(error) } })
  app.use(vite.middlewares)
  return { db, characters, url: `http://127.0.0.1:${server.address().port}/__test`,
    async close() { await vite.close(); await new Promise(resolve => server.close(resolve)); closeDb() } }
}
