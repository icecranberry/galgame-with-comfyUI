import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

test('中断恢复提示与日记失败页在桌面/窄屏和双主题均可见可重试', {skip:!process.env.PLAYWRIGHT_MODULE,timeout:90000},async t=>{
  const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
  const {createServer}=await import('vite')
  const {default:vue}=await import('@vitejs/plugin-vue')
  const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[vue()],server:{host:'127.0.0.1',port:0}})
  await server.listen();t.after(()=>server.close())
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})})
  t.after(()=>browser.close())
  const page=await browser.newPage();const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  const base=`http://127.0.0.1:${server.httpServer.address().port}/test/fixtures/chatDiaryRecovery.html`
  const screenshotDir=process.env.RECOVERY_SCREENSHOTS
  if(screenshotDir) await mkdir(screenshotDir,{recursive:true})
  for(const theme of ['warm','dark']) for(const width of [1280,375]) {
    await page.setViewportSize({width,height:850})
    await page.goto(`${base}?theme=${theme}`)
    await page.getByText('回应中断，已保留收到的内容',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'重试回应'}).isVisible(),true)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    if(screenshotDir) await page.screenshot({path:path.join(screenshotDir,`chat-${theme}-${width}.png`)})
    await page.goto(`${base}?theme=${theme}&panel=diary`)
    await page.getByText('这一页没能写完',{exact:true}).waitFor()
    await page.waitForTimeout(1100)
    assert.equal(await page.getByText('服务重启导致日记生成中断，请重试',{exact:true}).isVisible(),true)
    assert.equal(await page.locator('.page-empty-btn').isVisible(),true)
    if(theme==='dark') assert.equal(await page.locator('.diary-bar').evaluate(el=>getComputedStyle(el).color), await page.locator('main').evaluate(el=>getComputedStyle(el).color), '暗夜工具栏应使用主题文字色')
    if(screenshotDir) await page.screenshot({path:path.join(screenshotDir,`diary-${theme}-${width}.png`)})
    await page.locator('.page-empty-btn').click()
    await page.getByText('正在回想今天…',{exact:true}).waitFor()
    assert.equal(await page.locator('.db-btn[aria-busy="true"]').isDisabled(),true)
  }
  assert.deepEqual(errors,[])
})
