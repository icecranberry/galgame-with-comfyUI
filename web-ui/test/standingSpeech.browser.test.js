import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile } from 'node:fs/promises'

// Opt-in real Chromium checks. APIs use isolated fixtures; native audio.play is
// observed, never mocked. Set PLAYWRIGHT_MODULE and optionally BROWSER_EXECUTABLE.
test('standing speech: real desktop/touch playback, detail actions and responsive themes', {
  skip: !process.env.PLAYWRIGHT_MODULE, timeout: 180000,
}, async t => {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
  const { createServer } = await import('vite')
  const { default: vue } = await import('@vitejs/plugin-vue')
  const parts = ['head', 'face', 'shoulder', 'hand', 'chest', 'belly', 'butt', 'thigh', 'calf', 'foot']
  const dialogue = Object.fromEntries(parts.map(part => [part, ['你好，今天也很开心。']]))
  const waveform = Buffer.alloc(44 + 16000 * 2 * 4)
  waveform.write('RIFF'); waveform.writeUInt32LE(waveform.length - 8, 4); waveform.write('WAVEfmt ', 8)
  waveform.writeUInt32LE(16, 16); waveform.writeUInt16LE(1, 20); waveform.writeUInt16LE(1, 22)
  waveform.writeUInt32LE(16000, 24); waveform.writeUInt32LE(32000, 28); waveform.writeUInt16LE(2, 32)
  waveform.writeUInt16LE(16, 34); waveform.write('data', 36); waveform.writeUInt32LE(waveform.length - 44, 40)
  for (let i = 0; i < 64000; i++) waveform.writeInt16LE(Math.round(Math.sin(i * Math.PI * 440 / 16000) * 1600), 44 + i * 2)
  const audioBuffer = process.env.BROWSER_AUDIO_FILE ? await readFile(process.env.BROWSER_AUDIO_FILE) : waveform
  let generation = 0, requests = [], streams = new Set()
  const state = id => ({ status: 'ready', version: 'test-v1', lines: dialogue, speech: {
    enabled: true, configured: id !== 2, reason: id === 2 ? '角色尚未设置声音' : '',
    lines: Object.fromEntries(parts.map(part => [part, [{ text: dialogue[part][0], status: id === 2 ? 'empty' : 'completed',
      audio_url: id === 2 ? null : `/api/tts/audio/test.wav?v=${generation}&part=${part}`, error: null, job_id: `job-${part}-${generation}` }]])),
  } })
  const harness = `
    import {createApp,h,ref} from 'vue';
    import Manager from '/src/components/standing/StandingTouchLinesManager.vue';
    import Bulk from '/src/components/StandingManagerModal.vue';
    import Controls from '/src/components/standing/StandingInteractionControls.vue';
    import Layer from '/src/components/standing/StandingInteractionLayer.vue';
    import {startUnifiedStream} from '/src/stores/unifiedStream.js';
    import '/src/styles/tokens.css';import '/src/styles/base.css';import '/src/styles/components.css';import '/src/styles/animations.css';
    const mode=new URL(location.href).searchParams.get('mode');
    createApp({setup(){const open=ref(true),id=ref(1),controls=ref(),status=ref({disabled:true});
      const bounds={x:0,y:0,width:280,height:560,imageWidth:280,imageHeight:560};
      window.fixture={close:()=>open.value=false,character:value=>id.value=value};
      return ()=> mode==='bulk'?h(Bulk,{open:open.value,characters:[{id:1,display_name:'测试角色'},{id:2,display_name:'无声音角色'}],onClose:()=>open.value=false}):
        mode==='manager'?h(Manager,{open:open.value,characterId:id.value,name:'测试角色',onClose:()=>open.value=false}):
        h('div',{style:'position:relative;width:280px;height:560px;margin:40px auto;background:var(--bg-secondary)'},[
          h(Controls,{ref:controls,base:{characterId:id.value,imageUrl:'/fixture.svg',bounds},onState:s=>status.value=s}),
          h(Layer,{bounds,disabled:status.value.disabled,generation:status.value.generation,onAction:(...args)=>controls.value.act(...args)})]);
    }}).mount('#app');startUnifiedStream();`
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)),
    plugins: [vue(), { name: 'standing-speech-test', configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url.startsWith('/__standing-test')) {
        res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, `<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="app"></div><script type="module">${harness}</script></body></html>`)); return
      }
      if (req.url === '/api/stream') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('event: connected\ndata: {}\n\n'); streams.add(res); req.on('close', () => streams.delete(res)); return }
      if (req.url.startsWith('/api/tts/audio/')) { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audioBuffer.length }); res.end(audioBuffer); return }
      if (!req.url.startsWith('/api/')) return next()
      let body = ''; for await (const chunk of req) body += chunk
      const input = body ? JSON.parse(body) : {}; requests.push({ url: req.url, method: req.method, body: input })
      const id = Number(req.url.match(/characters\/(\d+)/)?.[1] || 1)
      let output = state(id)
      if (req.method === 'POST' && req.url.endsWith('/speech')) { generation++; output = state(id) }
      if (req.url.endsWith('/speech/fill')) output = { started: 1, skipped: 1, failed: 0 }
      if (req.url.endsWith('/standing-interaction')) output = { isSleeping: false, touchLines: state(id) }
      if (req.url.includes('overview')) output = { characters: [1, 2].map(id => ({id,count:1,total:1,hasTouchLines:true,touchStatus:'ready',touchSpeech:{enabled:true,configured:id===1,total:10,ready:0,pending:0,failed:0}})) }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(output))
    }) } }], server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    args: ['--autoplay-policy=user-gesture-required'] })
  t.after(async () => { await browser.close(); for (const stream of streams) stream.end(); await server.close() })
  const origin = server.resolvedUrls.local[0]
  for (const mobile of [false, true]) for (const theme of ['warm', 'dark']) await t.test(`${mobile ? 'touch' : 'desktop'} / ${theme}`, async () => {
    const context = await browser.newContext({ viewport: mobile ? {width:390,height:844} : {width:1440,height:1000}, isMobile:mobile, hasTouch:mobile })
    t.after(() => context.close())
    const page = await context.newPage(), errors = []
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(theme => {
      document.addEventListener('DOMContentLoaded', () => document.documentElement.dataset.theme = theme)
      window.mediaPlays=[]; const play=HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play=function(...args){window.mediaPlays.push(this);return play.apply(this,args)}
    }, theme)
    const click = locator => mobile ? locator.tap() : locator.click()
    await page.goto(`${origin}__standing-test?mode=touch`)
    const head = page.getByRole('button', {name:'轻触头顶'})
    await page.waitForFunction(() => document.querySelector('[data-standing-region="head"]')?.getAttribute('aria-disabled') === 'false')
    await click(head)
    await page.waitForFunction(() => window.mediaPlays.some(audio => !audio.paused && audio.currentTime > .05))
    assert.match(await page.locator('.interaction-note').innerText(), /你好/)
    await click(page.getByRole('button', {name:'轻触脸',exact:true}))
    await click(page.getByRole('button', {name:'轻触肩颈',exact:true}))
    await page.waitForFunction(() => window.mediaPlays.length === 3 && window.mediaPlays.at(-1).src.includes('part=shoulder') && !window.mediaPlays.at(-1).paused)
    await page.evaluate(() => window.fixture.character(2))
    await page.waitForFunction(() => window.mediaPlays.every(audio => audio.paused))
    await page.waitForFunction(() => document.querySelector('[data-standing-region="head"]')?.getAttribute('aria-disabled') === 'false')
    const plays = await page.evaluate(() => window.mediaPlays.length)
    await click(head)
    assert.equal(await page.evaluate(() => window.mediaPlays.length), plays, 'unconfigured character does not play')
    await page.goto(`${origin}__standing-test?mode=manager`)
    const preview = page.locator('.voice-audio').first()
    await preview.waitFor()
    await click(preview.getByRole('button', {name:/播放/}).first())
    await page.waitForFunction(() => window.mediaPlays.some(audio => !audio.paused && audio.currentTime > .05))
    const regenerate = page.getByRole('button', {name:'重新生成语音',exact:true}).first()
    const previousUrl = await preview.locator('audio').getAttribute('src')
    await click(regenerate)
    await page.waitForFunction(previousUrl => document.querySelector('.voice-audio audio')?.getAttribute('src') !== previousUrl, previousUrl)
    assert.ok(requests.some(request => request.method === 'POST' && request.body.force === true && request.body.part === 'head' && request.body.index === 0))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    if(mobile) assert.equal(await page.locator('.lines-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1)
    if (process.env.BROWSER_ARTIFACT_DIR) {
      await mkdir(process.env.BROWSER_ARTIFACT_DIR,{recursive:true})
      await page.screenshot({path:`${process.env.BROWSER_ARTIFACT_DIR}/${mobile?'touch':'desktop'}-${theme}.png`})
    }
    const input=page.getByRole('textbox',{name:'头顶台词 1'})
    await input.fill('修改后的对白')
    assert.equal(await page.locator('.lines-speech-actions').first().getByRole('button').isDisabled(), true, 'unsaved draft cannot generate stale speech')
    await page.evaluate(() => window.fixture.close())
    await page.waitForFunction(() => window.mediaPlays.every(audio => audio.paused))
    await page.goto(`${origin}__standing-test?mode=bulk`)
    await click(page.getByRole('button',{name:'一键生成反馈语音',exact:true}))
    await page.waitForFunction(() => document.body.innerText.includes('跳过 1'))
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })
})
