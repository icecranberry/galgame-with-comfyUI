<template>
  <main class="game-theme game-theme--pixel game-world" @dragover.prevent @drop.prevent="dropZip">
    <header class="arcade-topbar">
      <router-link class="arcade-brand" to="/games" aria-label="游戏中心首页"><span class="arcade-brand__symbol"><GamePixelIcon name="controller" /></span><strong>GAME<span class="arcade-brand__dot">.</span></strong></router-link>
      <div class="arcade-topbar__actions">
        <GameAction variant="quiet" compact aria-label="连接设置" :disabled="!!busy" @click="openSettings"><GamePixelIcon name="settings" /><span>连接设置</span></GameAction>
      </div>
    </header>

    <div class="arcade-floor">
    <div class="arcade-backdrop" aria-hidden="true"><img class="arcade-backdrop__art arcade-backdrop__art--left" :src="playgroundArtwork" alt=""><img class="arcade-backdrop__art arcade-backdrop__art--right" :src="playgroundArtwork" alt=""></div>
    <div class="arcade-room">
    <div class="arcade-toolbar">
      <nav role="tablist" aria-label="游戏收藏" @keydown="moveTabFocus">
        <GameAction v-for="item in tabs" :id="`game-tab-${item.value}`" :key="item.value" role="tab" variant="tab" :active="tab === item.value" :aria-selected="tab === item.value" aria-controls="game-shelf" :tabindex="tab === item.value ? 0 : -1" @click="tab = item.value"><GamePixelIcon :name="item.value === 'installed' ? 'cartridge' : 'globe'" />{{ item.label }}<span v-if="item.value === 'installed'" class="arcade-tab-count">{{ installed.length }}</span></GameAction>
      </nav>
      <div v-if="tab === 'community'" class="arcade-toolbar__actions">
        <label class="arcade-check arcade-nsfw-filter">
          <input v-model="showNsfw" type="checkbox" aria-controls="game-shelf">
          <span class="arcade-check__box" aria-hidden="true"></span>
          <span>显示 NSFW</span>
        </label>
        <GameAction v-if="community.length" compact variant="quiet" aria-haspopup="dialog" @click="showGuide = true">开发游戏</GameAction>
        <GameAction compact variant="quiet" :busy="loading" :disabled="!!busy" @click="discover(true)">刷新工坊 ↻</GameAction>
      </div>
    </div>
    <div v-if="error" class="arcade-notice" role="alert"><span>{{ error }}</span><GameAction variant="quiet" compact :disabled="!!busy || loading" @click="retryCatalog">重试</GameAction></div>

    <Transition name="arcade-content" mode="out-in">
      <section id="game-shelf" :key="tab" class="arcade-shelf" role="tabpanel" :aria-labelledby="`game-tab-${tab}`" :aria-busy="loading">
        <div v-if="loading && !visibleGames.length" class="arcade-loading" role="status"><span class="arcade-loading__light" aria-hidden="true"></span>正在打开{{ tab === 'community' ? '社区工坊' : '游戏馆' }}</div>
        <article v-for="item in visibleGames" :key="item.repoUrl || item.id" class="arcade-cartridge" :class="{ 'arcade-cartridge--revealed': tab === 'community' && item.nsfw === true }">
          <div class="cartridge-windowbar">
            <span><span class="cartridge-windowbar__light" aria-hidden="true"></span>{{ isOfficialTrpg(item) ? '01 / 官方首发' : item.source === 'official' ? '官方游戏' : '社区游戏' }}</span>
            <GameCardMenu v-if="tab === 'installed' && item.source !== 'official'" class="cartridge-windowbar__menu" :game="item" :disabled="!!busy" @uninstall="openRemove(item)" />
            <span v-else-if="item.stars !== undefined" class="cartridge-stars">☆ {{ item.stars }}</span>
            <span v-else class="cartridge-windowbar__pixels" aria-hidden="true"><i></i><i></i><i></i></span>
          </div>
          <div class="cartridge-copy">
            <span v-if="isOfficialTrpg(item)" class="cartridge-number"><GamePixelIcon name="star" />TRPG / 和邻舍一起冒险</span>
            <GameNsfwRibbon v-if="item.nsfw === true" class="cartridge-copy__ribbon" />
            <h2 class="cartridge-title">
              <span v-if="isOfficialTrpg(item)">深夜</span>
              <strong>{{ isOfficialTrpg(item) ? '跑团局' : item.name }}<span class="cartridge-title__dot">.</span></strong>
            </h2>
            <p v-if="isOfficialTrpg(item)"><span>关掉小镇的灯，和熟悉的人围坐一桌。</span><span>今晚你是守秘人，还是入局的调查员？</span></p>
            <p v-else-if="item.description">{{ item.description }}</p>
            <div class="cartridge-copy__bottom">
              <GameAction v-if="tab === 'installed'" variant="primary" :disabled="!item.enabled || !item.compatible || !!busy" @click="openGame(item)">
                {{ !item.compatible ? '需要更新邻舍' : item.enabled ? '开始游戏' : '已停用' }}<GamePixelIcon name="arrow" />
              </GameAction>
              <template v-else>
                <GameAction variant="primary" :disabled="!!busy || item.installStatus !== 'available'" :busy="busy === item.repoUrl" @click="install(item.repoUrl)">
                  {{ item.installStatus === 'conflict' ? 'ID 冲突' : item.installStatus === 'installed' ? '已安装' : '安装游戏' }}<GamePixelIcon v-if="item.installStatus === 'available'" name="arrow" />
                </GameAction>
                <a :href="item.repoUrl" target="_blank" rel="noopener noreferrer">查看仓库 ↗</a>
              </template>
              <span>{{ item.author || (item.source === 'official' ? '官方作品' : '社区创作者') }} <i>／</i> v{{ item.version }}</span>
            </div>
          </div>
          <div class="cartridge-art">
            <img v-if="isOfficialTrpg(item)" class="cartridge-art__pixel" :src="diceArtwork" alt="">
            <img v-else-if="coverFor(item)" :src="coverFor(item)" alt="">
            <span v-else class="cartridge-art__initial" aria-hidden="true">{{ item.name.slice(0, 1) }}</span>
            <span v-if="isOfficialTrpg(item)" class="cartridge-art__stamp" aria-hidden="true">LET THE DICE DECIDE.</span>
            <span class="cartridge-art__corner" aria-hidden="true"></span>
          </div>
        </article>
        <div v-if="!loading && !visibleGames.length" class="arcade-empty">
          <GamePixelIcon name="cartridge" class="arcade-empty__icon" />
          <h2 v-if="tab === 'community' && community.length">已隐藏 NSFW 游戏</h2>
          <template v-else>
            <h2>{{ tab === 'community' ? '下一款游戏，还在下一款。' : '第一盒游戏，就从这里开始。' }}</h2>
            <p>{{ tab === 'community' ? '暂未发现社区作品，也可以通过仓库链接或 ZIP 安装。' : '通过 GitHub 仓库或 ZIP 游戏包，把新的玩法装进来。' }}</p>
            <div class="arcade-empty__actions">
              <GameAction :disabled="!!busy" @click="openImport">安装游戏<GamePixelIcon name="plus" /></GameAction>
              <GameAction v-if="tab === 'community'" aria-haspopup="dialog" @click="showGuide = true">开发游戏</GameAction>
            </div>
          </template>
        </div>
      </section>
    </Transition>
    <div class="arcade-import-strip"><span class="arcade-import-strip__icon" aria-hidden="true"><GamePixelIcon name="cartridge" /></span><span class="arcade-import-strip__copy">带了新卡带？<span></span></span><GameAction :disabled="!!busy" @click="openImport">导入游戏<GamePixelIcon name="plus" /></GameAction></div>
    <footer class="arcade-footer"><span><GamePixelIcon name="heart" />开一把？</span><span class="arcade-footer__pixels" aria-hidden="true"><GamePixelIcon name="star" /><span>HAVE A GOOD GAME</span><GamePixelIcon name="star" /></span></footer>
    </div>
    </div>

    <GameOverlay v-model="showImport" theme="pixel" title="装进一盒新游戏" :close-disabled="!!busy" @after-leave="resetZipPassword">
      <form class="arcade-form" @submit.prevent="install(repoUrl)"><label for="game-repo">GitHub 仓库</label><input id="game-repo" v-model.trim="repoUrl" class="arcade-input" placeholder="owner/repo 或 GitHub 仓库链接" :disabled="!!busy" autocomplete="off"><GameAction type="submit" variant="primary" :busy="!!busy && busy !== 'settings'" :disabled="!repoUrl || !!busy">从仓库安装 ↗</GameAction></form>
      <div class="arcade-zip-zone" @dragover.prevent @drop.stop.prevent="dropZip">
        <GameAction :disabled="!!busy" @click="fileInput?.click()">选择 ZIP 文件</GameAction>
        <span>或拖入此处 · 最大 50MB</span>
        <input ref="fileInput" class="arcade-file" type="file" accept=".zip,application/zip" aria-label="选择游戏包" @change="chooseZip">
        <form v-if="zipForPassword" class="arcade-form arcade-zip-password" @submit.prevent="uploadZip(zipForPassword, zipPassword)">
          <label for="game-zip-password">ZIP 密码 · {{ zipForPassword.name }}</label>
          <input id="game-zip-password" ref="zipPasswordInput" v-model="zipPassword" class="arcade-input" type="password" autocomplete="off" :disabled="!!busy" :aria-describedby="importError ? 'game-import-error' : undefined" required>
          <GameAction type="submit" variant="primary" :busy="busy === 'zip'" :disabled="!zipPassword || !!busy">解锁并导入</GameAction>
        </form>
      </div>
      <p class="arcade-dialog-description arcade-dialog-description--muted">含后端扩展的游戏会执行本机代码，请选择信任的作者。</p><p v-if="importError" id="game-import-error" class="arcade-dialog-error" role="alert">{{ importError }}</p>
    </GameOverlay>
    <GameOverlay v-model="showGuide" theme="pixel" title="开发游戏">
      <p class="arcade-dialog-description">按指南创建本地游戏目录，试玩完成后可用 ZIP 或 GitHub 分发。</p>
      <a class="arcade-guide-link" href="/docs/linshe_community_game_guide.md" target="_blank" rel="noopener noreferrer">查看社区游戏开发指南 <span aria-hidden="true">↗</span></a>
    </GameOverlay>
    <GameOverlay v-model="showSettings" theme="pixel" title="工坊连接设置" :close-disabled="!!busy" @after-leave="token = ''">
      <form id="game-settings-form" class="arcade-form" @submit.prevent="saveSettings()">
        <label for="game-proxy">HTTP 代理地址（留空保存后直连）</label>
        <input id="game-proxy" v-model.trim="proxyUrl" class="arcade-input" :disabled="settingsBusy" inputmode="url" autocomplete="off" placeholder="http://127.0.0.1:7890">
        <p v-if="proxyMode === 'auto' && proxyUrl === savedProxyUrl" class="arcade-proxy-status" role="status">{{ proxyUrl ? '已记住自动发现的代理' : '暂未找到本地 HTTP 代理' }}</p>
        <label for="game-token">GitHub Token（可选）</label>
        <input id="game-token" v-model="token" class="arcade-input" type="password" autocomplete="new-password" :disabled="settingsBusy" :placeholder="hasToken ? '已保存，留空保留' : '可留空'">
        <label for="game-mirror">Raw 镜像前缀（可选）</label>
        <input id="game-mirror" v-model.trim="mirrorPrefix" class="arcade-input" :disabled="settingsBusy" placeholder="https://镜像域名">
        <p v-if="settingsError" class="arcade-dialog-error" role="alert">{{ settingsError }}</p>
      </form>
      <template #footer>
        <GameAction v-if="hasToken" variant="quiet" :disabled="settingsBusy" @click="saveSettings({ clearToken: true })">清除 Token</GameAction>
        <GameAction :disabled="settingsBusy" :busy="busy === 'proxy'" @click="saveSettings({ detectProxy: true })">自动探测代理</GameAction>
        <GameAction type="submit" form="game-settings-form" variant="primary" :busy="busy === 'settings'" :disabled="settingsBusy">保存设置</GameAction>
      </template>
    </GameOverlay>
    <GameOverlay v-model="removeOpen" theme="pixel" title="取下这盒游戏？" :close-disabled="!!busy" @after-leave="toRemove = null">
      <p class="arcade-dialog-description">卸载《{{ toRemove?.name }}》？之后可以重新安装。</p><label class="arcade-check"><input v-model="clearData" type="checkbox" :disabled="!!busy"><span class="arcade-check__box" aria-hidden="true"></span><span>同时删除存档和游戏图片</span></label><p v-if="removeError" class="arcade-dialog-error" role="alert">{{ removeError }}</p>
      <template #footer><GameAction :disabled="!!busy" @click="removeOpen = false">留下</GameAction><GameAction variant="danger" :busy="!!busy" @click="uninstall">卸载游戏</GameAction></template>
    </GameOverlay>
  </main>
</template>
<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import GameAction from '../games/components/GameAction.vue'
import GameCardMenu from '../games/components/GameCardMenu.vue'
import GameNsfwRibbon from '../games/components/GameNsfwRibbon.vue'
import GamePixelIcon from '../games/components/GamePixelIcon.vue'
import GameOverlay from '../games/components/GameOverlay.vue'
import playgroundArtwork from '../games/assets/arcade-playground.svg'
import diceArtwork from '../games/assets/pixel-dice.svg'
import '../games/styles/game-ui.css'
import { gameRequest } from '../api/games.js'

const router = useRouter(), tab = ref('installed'), installed = ref([]), community = ref([]), loading = ref(false), busy = ref(''), error = ref('')
const showImport = ref(false), showSettings = ref(false), repoUrl = ref(''), fileInput = ref(null), toRemove = ref(null), removeOpen = ref(false), clearData = ref(true)
const zipForPassword = ref(null), zipPassword = ref(''), zipPasswordInput = ref(null)
const showGuide = ref(false)
const showNsfw = ref(false)
const token = ref(''), hasToken = ref(false), mirrorPrefix = ref(''), settingsError = ref(''), importError = ref(''), removeError = ref('')
const proxyUrl = ref(''), savedProxyUrl = ref(''), proxyMode = ref(''), settingsLoading = ref(false)
const settingsBusy = computed(() => !!busy.value || settingsLoading.value)
let discoveryRequest = 0
const tabs = [{ label: '我的游戏', value: 'installed' }, { label: '社区工坊', value: 'community' }]
const visibleGames = computed(() => {
  if (tab.value === 'installed') return installed.value
  return showNsfw.value ? community.value : community.value.filter(game => game.nsfw !== true)
})
const installedById = computed(() => new Map(installed.value.map(game => [game.id, game])))
const coverFor = item => item.coverUrl || (item.installStatus === 'installed' ? installedById.value.get(item.id)?.coverUrl : null)
const isOfficialTrpg = game => game.source === 'official' && game.id === 'trpg-simulator'
const reload = async () => { installed.value = await gameRequest() }
const openGame = game => router.push(`/games/${game.id}`)
const openImport = () => { if (!busy.value) { importError.value = ''; showImport.value = true } }
const openRemove = item => { if (busy.value || item.source === 'official') return; toRemove.value = item; removeError.value = ''; removeOpen.value = true }
async function moveTabFocus(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = tabs.findIndex(item => item.value === tab.value)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tab.value = tabs[next].value
  await nextTick(); document.getElementById(`game-tab-${tab.value}`)?.focus()
}
async function discover(refresh = false) {
  const request = ++discoveryRequest
  loading.value = true; error.value = ''
  try {
    const result = await gameRequest(`/community/discover${refresh ? '?refresh=1' : ''}`)
    if (request === discoveryRequest) { community.value = result.items; error.value = result.warning || '' }
  } catch (e) {
    if (request === discoveryRequest) error.value = e.message
  } finally {
    if (request === discoveryRequest) loading.value = false
  }
}
watch(tab, value => { if (value === 'community') discover() })
async function retryCatalog() { if (tab.value === 'community') return discover(true); loading.value = true; error.value = ''; try { await reload() } catch (e) { error.value = e.message } finally { loading.value = false } }
async function mutate(key, action, target = error) {
  if (busy.value) return
  busy.value = key; target.value = ''
  try {
    await action()
    await reload()
    if (tab.value === 'community') await discover()
  } catch (e) { target.value = e.message } finally { busy.value = '' }
}
function finishInstall(game) {
  const index = installed.value.findIndex(item => item.id === game.id)
  if (index < 0) installed.value.push(game)
  else installed.value[index] = game
  showImport.value = false
}
const install = (url, replace = false) => mutate(url, async () => {
  finishInstall(await gameRequest('/import/github', { method: 'POST', body: { url, replace } }))
}, showImport.value ? importError : error)
function resetZipPassword() {
  zipForPassword.value = null
  zipPassword.value = ''
}
async function uploadZip(file, password = '') {
  if (!file || busy.value) return
  if (!password) resetZipPassword()
  if (!file.name.toLowerCase().endsWith('.zip') || file.size > 50 * 1024 * 1024) { importError.value = '请选择不超过 50MB 的 ZIP 文件'; return }
  await mutate('zip', async () => {
    try {
      const headers = password ? { 'X-Game-Zip-Password': encodeURIComponent(password) } : undefined
      finishInstall(await gameRequest('/import/zip', { method: 'POST', body: file, raw: true, headers }))
    } catch (error) {
      zipForPassword.value = error.code === 'ZIP_PASSWORD' ? file : null
      throw error
    }
  }, importError)
  zipPassword.value = ''
  if (showImport.value && zipForPassword.value) {
    await nextTick()
    zipPasswordInput.value?.focus()
  }
}
function chooseZip(event) { const file = event.target.files?.[0]; event.target.value = ''; void uploadZip(file) }
function dropZip(event) { if (busy.value || !event.dataTransfer.files?.length) return; showImport.value = true; importError.value = ''; void uploadZip(event.dataTransfer.files[0]) }
const uninstall = () => { if (!toRemove.value || toRemove.value.source === 'official') return; return mutate(toRemove.value.id, async () => { await gameRequest(`/${toRemove.value.id}?clearData=${clearData.value ? '1' : '0'}`, { method: 'DELETE' }); removeOpen.value = false }, removeError) }
function readProxySetting(settings) {
  proxyUrl.value = savedProxyUrl.value = settings.proxyUrl || ''
  proxyMode.value = settings.proxyMode || ''
}
async function openSettings() {
  showSettings.value = true
  settingsLoading.value = true
  settingsError.value = ''
  try {
    const settings = await gameRequest('/settings')
    hasToken.value = settings.hasToken
    mirrorPrefix.value = settings.mirrorPrefix || ''
    readProxySetting(settings)
  } catch (e) { settingsError.value = e.message }
  finally { settingsLoading.value = false }
}
async function saveSettings({ clearToken = false, detectProxy = false } = {}) {
  if (settingsBusy.value) return
  busy.value = detectProxy ? 'proxy' : 'settings'
  settingsError.value = ''
  try {
    const body = detectProxy ? { proxyUrl: null } : { mirrorPrefix: mirrorPrefix.value }
    if (!detectProxy) {
      if (clearToken || token.value) body.token = clearToken ? '' : token.value
      if (!clearToken && (!proxyUrl.value || proxyUrl.value !== savedProxyUrl.value)) body.proxyUrl = proxyUrl.value
    }
    const result = await gameRequest('/settings', { method: 'PUT', body })
    readProxySetting(result)
    if (!detectProxy) {
      hasToken.value = result.hasToken
      token.value = ''
      showSettings.value = false
    }
  }
  catch (e) { settingsError.value = e.message } finally { busy.value = '' }
}
onMounted(async () => { loading.value = true; try { await reload() } catch (e) { error.value = e.message } finally { loading.value = false } })
</script>
<style scoped>
.game-world { flex:1;min-width:0;min-height:0;height:100%;overflow:auto;display:flex;flex-direction:column;isolation:isolate;background:var(--game-bg);background-image:radial-gradient(#c4b7d34d 1px,transparent 1px);background-size:18px 18px;scrollbar-color:#b8acc8 transparent; }
.arcade-topbar { display:flex;align-items:center;justify-content:space-between;padding:18px max(32px,calc((100% - 1180px)/2));border-bottom:2px solid var(--game-line);gap:20px;background:var(--game-surface); }
.arcade-brand { color:inherit;text-decoration:none;display:flex;align-items:center;gap:13px;white-space:nowrap; }
.arcade-brand strong { font:900 27px/1 ui-monospace,'Courier New',monospace;letter-spacing:-1.5px; }
.arcade-brand__dot { color:#9580bf; }
.arcade-brand__symbol { display:grid;place-items:center;background:var(--game-lilac);border:2px solid var(--game-line);width:43px;height:39px;box-shadow:3px 3px 0 var(--game-line);font-size:25px; }
.arcade-topbar__actions { display:flex;align-items:center;gap:16px; }
.arcade-file { display:none; }
.arcade-floor { position:relative;flex:1;display:flex;flex-direction:column;isolation:isolate; }
.arcade-backdrop { position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;user-select:none; }
.arcade-backdrop__art { position:absolute;width:clamp(300px,28vw,480px);height:auto;opacity:.18;image-rendering:pixelated; }
.arcade-backdrop__art--left { left:clamp(-160px,calc((100% - 1680px)/2),60px);top:100px;transform:rotate(-16deg); }
.arcade-backdrop__art--right { right:clamp(-160px,calc((100% - 1680px)/2),60px);top:310px;transform:rotate(16deg) scaleX(-1); }
.arcade-room { position:relative;z-index:1;width:min(1180px,calc(100% - 80px));margin:0 auto;flex:1;display:flex;flex-direction:column;padding-top:22px;padding-bottom:22px; }
.arcade-toolbar { display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 22px; }
.arcade-toolbar nav { display:flex;gap:14px; }
.arcade-toolbar__actions { display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-inline-start:auto; }
.arcade-tab-count { display:grid;place-items:center;min-width:21px;height:21px;padding:0 4px;background:var(--game-lilac);color:var(--game-cream);font:700 12px/1 ui-monospace,monospace; }
.arcade-shelf { display:flex;flex-direction:column;gap:24px; }
.arcade-cartridge { position:relative;display:grid;grid-template-columns:minmax(0,1.22fr) minmax(0,1fr);border:2px solid var(--game-line);background:var(--game-surface);box-shadow:5px 5px 0 #d3c8de; }
.cartridge-windowbar { grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:2px solid var(--game-line);padding:11px 20px;background:#f4f0e6;font:700 11px/1.5 ui-monospace,'Microsoft YaHei',monospace;letter-spacing:1px; }
.cartridge-windowbar>span:first-child { display:flex;align-items:center;gap:9px; }
.cartridge-windowbar__light { width:8px;height:8px;background:#8ab599;box-shadow:2px 2px 0 #547862; }
.cartridge-windowbar__pixels { display:flex;gap:6px; }
.cartridge-windowbar__pixels i { width:7px;height:7px;border:1px solid #91869f; }
.cartridge-windowbar__pixels i:last-child { background:#a794c5; }
.cartridge-windowbar__menu { margin:-11px -6px -11px 0; }
.cartridge-copy { min-width:0;position:relative;z-index:1;padding:30px 34px 32px;display:flex;flex-direction:column;align-items:flex-start; }
.cartridge-number { display:flex;align-items:center;gap:7px;font:700 11px/1.6 ui-monospace,'Microsoft YaHei',monospace;color:var(--game-dim);letter-spacing:1px; }
.cartridge-number svg { color:#8d77b3;width:13px;height:13px; }
.cartridge-title { margin:18px 0 0;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;line-height:1.2; }
.cartridge-title>span { font-size:25px;font-weight:800;letter-spacing:2px; }
.cartridge-title strong { font-size:clamp(38px,4vw,58px);font-weight:900;letter-spacing:-2px;line-height:1.2;overflow-wrap:anywhere; }
.cartridge-title__dot { color:#9478ba; }
.cartridge-copy p { max-width:450px;font-size:14px;line-height:1.9;color:var(--game-dim);margin:18px 0 25px;white-space:pre-wrap;overflow-wrap:anywhere; }
.cartridge-copy p>span { display:block;text-wrap:pretty; }
.cartridge-copy__bottom { margin-top:auto;display:flex;align-items:center;gap:20px;flex-wrap:wrap; }
.cartridge-copy__bottom>span { min-width:0;font-size:11px;color:var(--game-dim);overflow-wrap:anywhere; }
.cartridge-copy__bottom i { font-style:normal;color:#aaa0b5;margin:0 3px; }
.cartridge-copy__bottom a { color:var(--game-cream);font-size:12px;text-underline-offset:5px; }
.cartridge-art { min-width:0;min-height:295px;position:relative;border-left:2px solid var(--game-line);background:#ece5f6;display:flex;align-items:center;justify-content:center;overflow:hidden; }
.cartridge-art img { position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain; }
.cartridge-art__pixel { image-rendering:pixelated; }
.cartridge-art__initial { color:var(--game-line);font-size:clamp(58px,8vw,104px);font-weight:900;text-shadow:4px 4px 0 #d1c3e2; }
.cartridge-art__stamp { position:absolute;bottom:19px;left:0;right:0;text-align:center;font:700 10px/1.6 ui-monospace,'Courier New',monospace;color:#6f5d8f;letter-spacing:2px; }
.cartridge-art__corner { position:absolute;top:13px;right:13px;width:8px;height:8px;background:#fff9e9;box-shadow:-12px 0 0 #fff9e9,0 12px 0 #fff9e9; }
.cartridge-copy__ribbon + .cartridge-title { max-width:calc(100% - 80px); }
@media(max-width:600px) {
  .cartridge-copy__ribbon + .cartridge-title { max-width:calc(100% - 64px); }
}
.cartridge-stars { font:700 12px ui-monospace,monospace;color:#8c6725;white-space:nowrap; }
.arcade-import-strip { margin-top:26px;display:flex;align-items:center;gap:18px;padding:20px 26px;background:#edf1e7;border:2px dashed #b4bea5; }
.arcade-import-strip__icon { color:#69816b;font-size:30px; }
.arcade-import-strip__copy { display:flex;align-items:baseline;flex-wrap:wrap;gap:8px 16px;flex:1;font-size:15px;font-weight:800;line-height:1.6; }
.arcade-import-strip__copy>span { font-size:12px;font-weight:400;color:#637060; }
.arcade-footer { margin-top:auto;padding:25px 0 0;display:flex;align-items:center;justify-content:space-between;gap:15px;font-size:11px;line-height:1.8;color:var(--game-dim); }
.arcade-footer>span { display:flex;align-items:center;gap:8px; }
.arcade-footer>span>svg { width:12px;height:12px;color:#bf869d; }
.arcade-footer__pixels { font:700 10px/1.8 ui-monospace,'Courier New',monospace;letter-spacing:1px; }
.arcade-footer .arcade-footer__pixels>svg { color:#b49acb;width:9px;height:9px; }
.arcade-notice { margin-bottom:22px;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:20px;background:#fbece4;border:2px solid #c29a82;color:#804d38;line-height:1.7;font-size:14px;overflow-wrap:anywhere; }
.arcade-loading { min-height:260px;display:flex;align-items:center;justify-content:center;gap:16px;flex-direction:column;padding:30px;line-height:1.7;text-align:center;color:var(--game-dim);font-size:14px; }
.arcade-loading__light { width:14px;height:14px;background:#b5a0d4;box-shadow:20px 0 0 #e5c571,-20px 0 0 #9fc3a5;animation:arcade-pulse 1.2s steps(2,end) infinite; }
.arcade-empty { padding:40px 20px 48px;display:grid;justify-items:center;gap:18px;text-align:center;border:2px dashed #d3c7df;background:#fffef9b3; }
.arcade-empty__icon { width:54px;height:54px;color:#a28bbf; }
.arcade-empty h2 { font-size:23px;line-height:1.5;margin:0; }
.arcade-empty p { font-size:14px;line-height:1.8;color:var(--game-dim);margin:0; }
.arcade-empty__actions { display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px; }
.arcade-form { display:grid;gap:14px; }
.arcade-form label { font-size:13px;line-height:1.5;color:var(--game-dim);font-weight:700; }
.arcade-proxy-status { margin:-6px 0 0;font-size:12px;line-height:1.6;color:var(--game-dim); }
.arcade-input { appearance:none;width:100%;min-width:0;background:#f7f3fa;border:2px solid #b6a9c8;border-radius:0;padding:13px 14px;color:var(--game-cream);font:14px/1.5 'HarmonyOS Sans SC',sans-serif;box-shadow:inset 3px 3px 0 #e9e2f1;transition:border-color .3s; }
.arcade-input::placeholder { color:#82778e;opacity:1; }
.arcade-input:focus { outline:0;border-color:var(--game-line); }
.arcade-input:focus-visible { outline:2px solid var(--game-focus);outline-offset:3px; }
.arcade-input:disabled { opacity:.5; }
.arcade-zip-zone { margin:24px 0;display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:20px 0;border-top:1px dashed #c5b8d4;border-bottom:1px dashed #c5b8d4; }
.arcade-zip-zone>span { font-size:12px;color:var(--game-dim); }
.arcade-zip-password { width:100%;min-width:0; }
.arcade-zip-password label { overflow-wrap:anywhere; }
.arcade-dialog-description { font-size:15px;line-height:1.8;margin:0 0 18px;white-space:pre-wrap;overflow-wrap:anywhere; }
.arcade-dialog-description--muted { font-size:12px;color:var(--game-dim);margin:0; }
.arcade-guide-link { color:var(--game-cream);font-size:14px;font-weight:700;text-decoration:underline;text-underline-offset:4px; }
.arcade-guide-link:focus-visible { outline:2px solid var(--game-focus);outline-offset:4px; }
.arcade-dialog-error { font-size:14px;line-height:1.7;color:var(--game-error);margin:16px 0 0; }
.arcade-check { position:relative;display:flex;align-items:center;gap:12px;min-height:44px;font-size:14px;line-height:1.7;cursor:pointer; }
.arcade-check input { position:absolute;left:0;width:24px;height:24px;opacity:0;margin:0;padding:0; }
.arcade-check__box { width:24px;height:24px;flex-shrink:0;border:2px solid #a393b7;display:grid;place-items:center;background:#f7f3fa;transition:background .3s,border-color .3s; }
.arcade-check input:checked+.arcade-check__box { background:var(--game-acid);border-color:var(--game-line); }
.arcade-check input:checked+.arcade-check__box:after { content:'✓';font-size:18px;color:var(--game-cream);font-weight:800; }
.arcade-check input:focus-visible+.arcade-check__box { outline:2px solid var(--game-focus);outline-offset:4px; }
.arcade-check:has(input:disabled) { opacity:.5;cursor:not-allowed; }
.arcade-nsfw-filter { gap:8px;padding-inline:6px;font-size:13px;white-space:nowrap; }
.arcade-nsfw-filter .arcade-check__box { width:20px;height:20px; }
.arcade-nsfw-filter input:checked+.arcade-check__box::after { font-size:15px;line-height:1; }
.arcade-cartridge--revealed { animation:arcade-reveal .3s ease-out; }
.arcade-content-enter-active,.arcade-content-leave-active { transition:opacity .3s,transform .3s; }
.arcade-content-enter-from,.arcade-content-leave-to { opacity:0;transform:translateY(8px); }
@keyframes arcade-reveal { from { opacity:0;transform:translateY(8px); } }
@keyframes arcade-pulse { 50% { opacity:.35; } }
@media(max-width:600px) {
  .arcade-toolbar__actions { gap:4px; }
  .arcade-toolbar__actions .game-action--quiet { padding-inline:8px; }
}
@media(min-width:1600px) { .arcade-room { width:min(1280px,calc(100% - 120px)); }.arcade-topbar { padding-inline:max(40px,calc((100% - 1280px)/2)); }.cartridge-copy { padding:38px 42px; }.cartridge-art { min-height:330px; } }
@media(max-width:900px) { .arcade-room { width:calc(100% - 48px); }.arcade-topbar { padding:16px 24px; }.arcade-topbar__actions { gap:6px; }.cartridge-copy { padding:26px; }.cartridge-title strong { font-size:44px; }.cartridge-copy__bottom { gap:14px; }.cartridge-art { min-height:300px; }.arcade-import-strip__copy { flex-direction:column;gap:2px; } }
@media(max-width:600px) { .arcade-backdrop__art { width:240px;opacity:.1; }.arcade-backdrop__art--left { left:-170px;top:90px; }.arcade-backdrop__art--right { right:-170px;top:400px; }.arcade-topbar { padding:12px 16px;gap:10px;flex-wrap:wrap; }.arcade-brand { gap:10px; }.arcade-brand strong { font-size:24px; }.arcade-brand__symbol { width:36px;height:33px;font-size:21px; }.arcade-topbar__actions { margin-left:auto;gap:6px; }.arcade-topbar__actions .game-action--quiet { width:44px;padding-inline:0; }.arcade-topbar__actions .game-action--quiet span { display:none; }.arcade-room { width:calc(100% - 36px);padding-bottom:18px; }.arcade-toolbar { margin:16px 0 20px;gap:8px;flex-wrap:wrap; }.arcade-toolbar nav { gap:10px; }.arcade-tab-count { min-width:18px;height:18px;font-size:11px; }.arcade-cartridge { grid-template-columns:minmax(0,1fr); }.cartridge-windowbar { padding:10px 15px;font-size:10px; }.cartridge-copy { padding:23px 23px 25px; }.cartridge-number { font-size:10px;letter-spacing:0; }.cartridge-title { margin-top:12px; }.cartridge-title>span { font-size:23px; }.cartridge-title strong { font-size:45px; }.cartridge-copy p { font-size:13px;line-height:1.85;margin:13px 0 22px; }.cartridge-copy__bottom { gap:16px; }.cartridge-copy__bottom>span { font-size:10px; }.cartridge-art { min-height:0;height:170px;border-left:0;border-top:2px solid var(--game-line); }.cartridge-art img { object-fit:contain; }.cartridge-art__stamp { bottom:7px;font-size:8px;letter-spacing:1.5px; }.arcade-import-strip { margin-top:22px;padding:16px;gap:12px; }.arcade-import-strip__icon { font-size:25px; }.arcade-import-strip__copy { font-size:14px; }.arcade-import-strip__copy>span { display:none; }.arcade-footer { padding-top:22px;font-size:10px;justify-content:center; }.arcade-footer__pixels { display:none !important; }.arcade-notice { font-size:13px;padding:12px;gap:12px; }.arcade-empty { padding:28px 15px; }.arcade-empty h2 { font-size:20px; }.arcade-input { font-size:16px; } }
@media(max-width:360px) { .arcade-topbar { padding-inline:12px; }.arcade-brand { gap:7px; }.arcade-brand strong { font-size:21px; }.arcade-brand__symbol { width:30px;height:30px;font-size:18px; }.arcade-topbar__actions { gap:4px; }.arcade-room { width:calc(100% - 28px); }.cartridge-copy { padding:20px; }.cartridge-title strong { font-size:40px; }.arcade-import-strip { padding:13px;gap:10px; }.arcade-import-strip__icon { display:none; } }
@media(prefers-reduced-motion:reduce) { .arcade-loading__light,.arcade-cartridge--revealed { animation:none; }.arcade-content-enter-active,.arcade-content-leave-active,.arcade-input,.arcade-check__box { transition:none; } }
</style>
