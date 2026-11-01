<template>
  <main class="god-page">
    <svg class="god-torn-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="god-torn-paper" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves="4" seed="9" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="9" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
    <Transition name="god-history">
      <aside v-if="!isMobile || historyOpen" class="god-history" aria-label="按日期查看对话">
        <div class="history-heading"><span>神说 · 对话</span><GodSacredButton v-if="isMobile" variant="icon" size="sm" tone="muted" aria-label="收起对话列表" @click="historyOpen = false"><svg class="gsb-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m10 4-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg></GodSacredButton></div>
        <nav class="history-days" aria-label="对话日期">
          <div v-for="session in sessions" :key="session.id" class="history-day" :class="{ selected: session.id === god.state?.session.id }">
            <div role="button" tabindex="0" class="history-choice" :aria-current="session.id === god.state?.session.id ? 'page' : undefined" @click="selectSession(session)" @keydown.enter.prevent="selectSession(session)" @keydown.space.prevent="selectSession(session)">
              <span class="history-date">{{ session.day === god.state?.today ? '今天' : session.day }}</span><span v-if="session.day === god.state?.today" class="history-day-label">{{ session.day }}</span>
              <span class="history-preview">{{ session.preview || session.summary || '这一日的对话' }}</span>
            </div>
            <GodSacredButton v-if="session.summary_status === 'failed'" variant="link" tone="muted" size="sm" @click="retrySummary(session.id)">重新整理记忆</GodSacredButton>
          </div>
          <p v-if="sessionsLoading" class="history-note" role="status">正在翻阅…</p>
          <GodSacredButton v-if="hasMoreSessions" variant="link" tone="muted" size="sm" :loading="sessionsLoading" @click="moreSessions">更早的对话</GodSacredButton>
          <p v-if="sessionsError" class="history-note" role="alert">{{ sessionsError }} <GodSacredButton variant="link" tone="muted" size="sm" @click="moreSessions">重试</GodSacredButton></p>
        </nav>
        <div class="history-footer"><GodSacredButton variant="link" tone="muted" size="sm" @click="openMemory">天使记忆</GodSacredButton></div>
      </aside>
    </Transition>
    <div class="god-main">
    <header class="god-header">
      <GodSacredButton v-if="isMobile" variant="icon" tone="muted" aria-label="返回角色列表" @click="toggleSidebar"><svg class="gsb-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m10 4-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg></GodSacredButton>
      <GodSacredButton v-if="isMobile" variant="icon" tone="muted" :aria-expanded="historyOpen" aria-label="切换对话列表" @click="historyOpen = !historyOpen"><svg class="gsb-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5h10M3 8h10M3 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg></GodSacredButton>
      <div class="header-emblem" role="button" tabindex="0" aria-label="查看天使角色详情" @click="openAngel" @keydown.enter.prevent="openAngel" @keydown.space.prevent="openAngel"><span class="header-emblem-halo" aria-hidden="true" /><AngelEmblem emblem /></div>
      <div class="header-title"><h1>神说</h1><span :title="subtitle">{{ subtitle }}</span></div>
      <div class="header-actions">
        <GodSacredButton variant="ghost" tone="muted" size="sm" @click="openSchedule">今日日程</GodSacredButton>
        <GodSacredButton class="god-detail-btn" variant="ghost" tone="muted" size="sm" @click="openAngel">角色详情</GodSacredButton>
      </div>
    </header>

    <div v-if="god.error" class="god-error" role="alert">
      <span>{{ god.error }}</span><GodSacredButton variant="link" tone="muted" size="sm" @click="god.load(god.archiveId)">重新连接</GodSacredButton>
    </div>
    <div v-if="god.archiveId" class="archive-strip">
      <span>{{ god.state?.session.day }} · {{ god.state?.session.status === 'closing' ? '正在归档' : '往日对话' }}</span>
      <GodSacredButton variant="link" tone="muted" size="sm" @click="god.load()">回到今天</GodSacredButton>
    </div>

    <div ref="scrollArea" class="god-scroll" @scroll="trackScroll">
      <div class="god-reading">
        <div v-if="god.loading && !god.state" class="god-loading" aria-label="正在翻开今日对话"><div v-for="n in 3" :key="n" class="skeleton" /></div>
        <Transition name="god-content" mode="out-in">
          <section v-if="!god.loading && !god.turns.length" key="welcome" class="god-welcome">
            <div class="sacred-sky" aria-hidden="true">
              <svg class="sky-beam" viewBox="0 0 800 460" preserveAspectRatio="xMidYMax meet">
                <defs>
                  <linearGradient id="godBeam" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--fun-gold)" stop-opacity="0" />
                    <stop offset="42%" stop-color="var(--fun-gold)" stop-opacity="0.13" />
                    <stop offset="100%" stop-color="var(--fun-gold)" stop-opacity="0" />
                  </linearGradient>
                  <radialGradient id="godGlow" cx="50%" cy="42%" r="50%">
                    <stop offset="0%" stop-color="var(--fun-gold)" stop-opacity="0.18" />
                    <stop offset="55%" stop-color="var(--fun-gold)" stop-opacity="0.06" />
                    <stop offset="100%" stop-color="var(--fun-gold)" stop-opacity="0" />
                  </radialGradient>
                </defs>
                <ellipse class="sky-glow" cx="400" cy="186" rx="310" ry="208" fill="url(#godGlow)" />
                <path class="sky-beam-core" d="M400 -70 L330 460 L470 460 Z" fill="url(#godBeam)" />
                <g class="sky-rays">
                  <path d="M400 78 L400 372" />
                  <path d="M336 118 L318 356" />
                  <path d="M464 118 L482 356" />
                  <path d="M278 178 L246 348" />
                  <path d="M522 178 L554 348" />
                </g>
              </svg>
              <svg class="sky-arch" viewBox="0 0 800 460" preserveAspectRatio="xMidYMax meet">
                <path class="arch-outer" d="M150 460 V300 a250 130 0 0 1 500 0 V460" />
                <path class="arch-inner" d="M184 460 V306 a216 108 0 0 1 432 0 V460" />
                <g class="arch-stars">
                  <circle cx="400" cy="138" r="2" />
                  <circle cx="268" cy="196" r="1.7" />
                  <circle cx="532" cy="196" r="1.7" />
                  <circle cx="205" cy="292" r="1.4" />
                  <circle cx="595" cy="292" r="1.4" />
                  <path class="arch-diamond" d="M400 158 403.6 168 400 178 396.4 168 Z" />
                </g>
              </svg>
            </div>
            <div class="welcome-angel"><AngelEmblem /></div>
            <span class="welcome-kicker"><span class="kicker-rule" aria-hidden="true" />云 庭 来 信<span class="kicker-rule" aria-hidden="true" /></span>
            <h2>{{ god.archiveId ? '这一日的静谧，已珍藏。' : '吾神，今天想说些什么？' }}</h2>
            <p>{{ god.archiveId ? god.state?.session.summary || '这一天没有留下对话。' : '我在这里听您说。关于人间，也关于我们。' }}</p>
            <div v-if="!god.archiveId" class="welcome-prompts">
              <GodSacredButton v-for="prompt in suggestions" :key="prompt" variant="pill" size="sm" @click="fillPrompt(prompt)">
                <svg class="gsb-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 6.9 4.1 10 5 6.9 5.9 6 9 5.1 5.9 2 5 5.1 4.1Z" fill="currentColor" /></svg>
                {{ prompt }}
              </GodSacredButton>
            </div>
          </section>
          <div v-else :key="`conversation-${god.state?.session.id}`" class="god-conversation">
            <div class="god-date"><span>✦</span>{{ god.state?.session.day }}<span>✦</span></div>
            <TransitionGroup name="god-turn" tag="div">
            <section v-for="turn in god.turns" :key="turn.id" class="god-turn">
              <div class="god-user">
                <div class="god-user-bubble">
                  <div v-if="turn.images?.length" class="god-user-images">
                    <GodMessageImages :images="turn.images.map(url => ({ url }))" @loaded="imageLoaded" />
                  </div>
                  <div class="god-user-text-line">
                    <div v-if="turn.input" class="god-user-text" :style="userBubbleFontStyle">{{ turn.input }}</div>
                    <div class="god-user-avatar" aria-hidden="true">
                      <img v-if="showUserAvatar" :src="userAvatar" alt="" @error="userAvatarFailed = true" />
                      <span v-else>我</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="god-angel-reply">
                <div class="speaker-heading"><div class="speaker-emblem" role="button" tabindex="0" aria-label="查看天使角色详情" @click="openAngel" @keydown.enter.prevent="openAngel" @keydown.space.prevent="openAngel"><img v-if="god.state?.angel.avatar_path" :src="god.state.angel.avatar_path" alt="天使头像" /><AngelEmblem v-else emblem /></div><span>{{ god.state?.angel.display_name || '天使' }}</span></div>
                <template v-for="message in turn.messages.filter(m => m.role === 'assistant')" :key="message.id">
                  <div v-if="message.reasoning || message.status === 'streaming'" class="god-thinking">
                    <GodSacredButton variant="link" tone="muted" size="sm" :aria-expanded="thinkingVisible(message)" @click="toggleThinking(message)">
                      <svg class="thinking-chevron" :class="{ expanded: thinkingVisible(message) }" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
                      {{ message.status === 'streaming' && !message.content ? '正在思考' : message.reasoning ? '思考过程' : '思考已开启' }}
                      <span v-if="message.status === 'streaming'" class="thinking-pulse">· · ·</span>
                    </GodSacredButton>
                    <CollapseTransition :show="thinkingVisible(message)"><div class="thinking-text">{{ message.reasoning || '思考思考…' }}</div></CollapseTransition>
                  </div>
                  <div v-if="message.content" class="god-reply-text" v-html="renderText(message.content)"></div>
                  <div v-if="message.tool_calls?.length" class="god-tool-list">
                    <div v-for="call in message.tool_calls" :key="call.id" class="god-tool-row" :data-status="callState(turn, call).status || 'pending'">
                      <span class="tool-mark" :data-status="callState(turn, call).status || 'pending'" role="img" :aria-label="toolStateText[callState(turn, call).status] || (turn.status === 'running' ? '准备中' : '未执行')">
                        <span class="mark-spinner" aria-hidden="true"></span>
                        <svg class="mark-glyph mark-check" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.6 8.4 6.6 11.4 12.4 4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
                        <svg class="mark-glyph mark-bang" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 4.2v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /><circle cx="8" cy="11.7" r=".95" fill="currentColor" /></svg>
                        <span class="mark-dot" aria-hidden="true"></span>
                      </span>
                      <span class="tool-label">{{ toolLabels[call.function.name] || '处理神谕' }}</span>
                    </div>
                  </div>
                  <GodMessageImages v-if="message.tool_calls?.some(call => call.function?.name === 'generate_image')" :images="godMessageImages(turn, message)" @loaded="imageLoaded" />
                  <span v-if="['interrupted', 'cancelled'].includes(message.status)" class="partial-note">{{ message.status === 'cancelled' ? '已停止' : '此段回应未完整结束' }}</span>
                </template>
                <div v-if="turn.status === 'running' && !turn.messages.some(m => m.role === 'assistant')" class="preparing-reply"><span class="thinking-pulse">✦</span>天使正在整理今日见闻…</div>
                <GodWorkCard v-for="event in turn.events" :key="event.id" :event="event" @updated="god.updateWorld" />
                <div v-if="turn.calls.length" class="execution-record">
                  <GodSacredButton class="execution-toggle" variant="line" tone="gold" size="sm" :touch-target="isMobile" :aria-expanded="!!expandedRuns[turn.id]" @click="expandedRuns[turn.id] = !expandedRuns[turn.id]">
                    <svg class="gsb-icon exec-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
                    <span>{{ expandedRuns[turn.id] ? '收起执行详情' : '查看执行详情' }}</span>
                    <span class="exec-count" :aria-label="`${turn.calls.length} 项`">{{ turn.calls.length }}</span>
                    <svg class="exec-chevron" :class="{ 'is-open': !!expandedRuns[turn.id] }" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  </GodSacredButton>
                  <CollapseTransition :show="!!expandedRuns[turn.id]">
                    <div class="execution-body">
                      <div v-for="call in turn.calls" :key="call.id" class="execution-item">
                        <strong>{{ toolLabels[call.name] || call.name }}</strong>
                        <p>{{ resultDescription(call) }}</p>
                        <router-link v-if="call.result?.value?.href" :to="call.result.value.href">前往查看 ↗</router-link>
                      </div>
                    </div>
                  </CollapseTransition>
                </div>
                <p v-if="turn.status === 'interrupted'" class="turn-notice">上次回应因服务重启中断，已完成的工作仍然保留。</p>
                <p v-if="turn.status === 'cancelled'" class="turn-notice">已停止继续处理。已经完成的工作仍然保留。</p>
              </div>
              <div class="turn-actions">
                <GodSacredButton variant="icon" tone="muted" size="sm" :touch-target="isMobile" aria-label="删除这一轮" title="删除这一轮" :disabled="god.busy || god.deleting || god.loading" @click="removeTurn(turn)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" /></svg>
                </GodSacredButton>
              </div>
            </section>
            </TransitionGroup>
          </div>
        </Transition>
      </div>
    </div>

    <footer v-if="!god.archiveId" class="god-composer-area">
      <Transition name="god-content">
        <GodSacredButton v-if="!atBottom && god.turns.length" class="god-latest" variant="line" size="sm" @click="goBottom">回到最新 ↓</GodSacredButton>
      </Transition>
      <div v-if="god.reconnecting" class="connection-note" role="status">正在重新连接，天使仍在处理；恢复连接后会接续显示。</div>
      <div class="god-composer" @paste="onComposerPaste">
        <div v-if="draftImages.length" class="composer-images">
          <figure v-for="(image, index) in draftImages" :key="image.id" class="composer-image">
            <img v-if="image.url" :src="image.url" alt="" />
            <div v-else class="composer-image-pending" role="status" aria-label="图片处理中"></div>
            <button type="button" class="composer-image-remove" aria-label="移除这张图片" @click="removeImage(index)">
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3.2 3.2l5.6 5.6M8.8 3.2l-5.6 5.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
            </button>
          </figure>
        </div>
        <linshe-auto-textarea ref="composer" embedded :model-value="god.draft" :min-height="56" :maxlength="20000" placeholder="「准备降下神谕让天使做什么？答什么？吃什么...？」" @update:model-value="god.setDraft" @enter="sendOnEnter" />
        <div class="composer-tools">
          <div class="composer-left">
            <GodSacredButton variant="icon" tone="muted" size="md" :touch-target="isMobile" :disabled="draftImages.length >= maxImages" :aria-label="draftImages.length >= maxImages ? '最多添加四张图片' : '添加图片'" :title="draftImages.length >= maxImages ? '最多添加四张图片' : '添加图片'" @click="pickImages">
              <svg class="composer-action-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4.6v10.8M4.6 10h10.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
            </GodSacredButton>
            <span v-if="draftImages.length" class="composer-count" aria-live="polite">{{ draftImages.length }}/{{ maxImages }}</span>
          </div>
          <Transition name="composer-action" mode="out-in">
            <GodSacredButton v-if="god.activeRun" key="stop" variant="primary" size="lg" :loading="god.stopping" :aria-label="god.stopping ? '正在停止' : '停止回应'" title="停止回应" @click="god.stop"><svg v-if="!god.stopping" class="composer-action-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="2" /></svg></GodSacredButton>
            <GodSacredButton v-else key="send" variant="primary" size="lg" :loading="god.submitting" :disabled="(!god.draft.trim() && !draftImages.length) || god.loading || god.deleting" aria-label="发送消息" title="发送消息" @click="send"><svg v-if="!god.submitting" class="composer-action-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 15V5m-4 4 4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg></GodSacredButton>
          </Transition>
        </div>
        <input ref="fileInput" class="composer-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple @change="onFileChange" />
      </div>
    </footer>
    </div>

    <CharacterDetailModal :visible="angelOpen" :character="angelCharacter" @close="angelOpen = false" @saved="angelSaved" />
    <GodAngelScheduleModal :visible="scheduleOpen" :loading="scheduleLoading" :character="angelCharacter" @close="scheduleOpen = false" @saved="angelSaved" />
    <linshe-modal v-model="memoryOpen" title="天使记忆" :transition-ms="300">
      <div class="god-modal-content">
        <p class="modal-note">这些是与你说过的话，和我们一起留下的约定。</p>
        <p v-if="panelLoading" class="modal-note">正在找回记忆…</p>
        <p v-else-if="!memories.length" class="memory-empty">今日的对话会在新的一天到来后归档，值得记住的事会留在这里。</p>
        <section v-for="day in memories" :key="day.id" class="memory-entry">
          <h4>{{ day.day }}</h4>
          <ul v-if="day.memories.length"><li v-for="(memory, i) in day.memories" :key="i"><span>{{ memoryLabels[memory.kind] }}</span>{{ memory.text }}</li></ul>
          <p v-else>{{ day.summary }}</p>
        </section>
        <p v-if="panelError" class="modal-error" role="alert">{{ panelError }}</p>
      </div>
    </linshe-modal>
  </main>
</template>

<script setup>
import { ref, reactive, computed, inject, onMounted, onActivated, onBeforeUnmount, watch, nextTick } from 'vue'
import { useGodSaysStore } from '../stores/godSays.js'
import { useGodThinking } from '../composables/useGodThinking.js'
import { onEvent } from '../stores/unifiedStream.js'
import { getGodSaysSessions, getGodSaysMemories, retryGodSummary, getGodAngel } from '../api/index.js'
import CharacterDetailModal from '../components/CharacterDetailModal.vue'
import LinsheAutoTextarea from '../components/ui/LinsheAutoTextarea.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import CollapseTransition from '../components/CollapseTransition.vue'
import AngelEmblem from '../components/godSays/AngelEmblem.vue'
import GodSacredButton from '../components/godSays/GodSacredButton.vue'
import GodAngelScheduleModal from '../components/godSays/GodAngelScheduleModal.vue'
import GodWorkCard from '../components/godSays/GodWorkCard.vue'
import GodMessageImages from '../components/godSays/GodMessageImages.vue'
import { godMessageImages } from '../utils/godSaysImages.js'
import { userAvatar, loadUserAvatar } from '../userConfig.js'
import { loadFont, getFontFamily } from '../composables/useHandwritingFont.js'

const USER_BUBBLE_FONT_ID = 'moon_stars_kai'
const userBubbleFontStyle = { fontFamily: getFontFamily(USER_BUBBLE_FONT_ID) }

const god = useGodSaysStore()
const isMobile = inject('isMobile', ref(false))
const toggleSidebar = inject('toggleMobileSidebar', () => {})
const composer = ref(null)
const fileInput = ref(null)
const draftImages = ref([])
const maxImages = 4
const scrollArea = ref(null)
const atBottom = ref(true)
const { thinkingVisible, toggleThinking, activateThinking, leaveThinking, acceptThinking } = useGodThinking(() => god.state)
const expandedRuns = ref({})
const historyOpen = ref(false)
const angelOpen = ref(false)
const scheduleOpen = ref(false), scheduleLoading = ref(false)
let angelRequest = 0
const angelCharacter = ref({ system_role: 'angel' })
const confirm = inject('confirm', async () => false)
const memoryOpen = ref(false)
const sessions = ref([])
const memories = ref([])
const panelLoading = ref(false)
const panelError = ref('')
const hasMoreSessions = ref(false)
const sessionsLoading = ref(false)
const sessionsError = ref('')
let sessionsLoaded = false
const SUGGESTION_POOL = [
  '今天过得怎么样？',
  '大家现在都在做什么？',
  '邻舍最近有什么新鲜事？',
  '去看看菌伞街今天的热闹',
  '谁家今晚亮着灯？',
  '邻舍有没有谁需要帮忙？',
  '替我看看主街的晚市',
  '云庭外头天气怎么样？',
  '最近谁心情不太好？',
  '让天空出现一道很大的彩虹',
  '让云庭下一场金色的雨',
  '让今夜的星子格外亮',
  '让整座云庭安静一刻',
  '让风带来远方的消息',
  '让神谕化作人间的光',
  '让菌伞街开满花',
  '让午夜响起一声钟',
  '天使，你今天过得怎么样？',
  '说说你今天都做了什么',
  '你现在在哪儿，忙什么？',
  '给我讲讲你和邻舍的交情',
  '今天有什么让你开心的事？',
  '替我把下午排得松一点',
  '明天给我留一段安静时间',
  '把傍晚的空档留出来',
  '帮我把今晚的行程改到露台',
  '我想在午后出去走走',
  '提醒我今晚早点歇息',
  '请居民分享今天的动态',
  '让大家发一条此刻的心情',
  '替我发一条朋友圈',
  '今天有人分享了什么吗？',
  '让别人也看看这场雨',
  '邀大家晒一晒今天的天空',
  '把「今晚吃什么」带进群聊',
  '让大家聊聊今天最开心的事',
  '去群里问问大家的打算',
  '让邻舍们讨论一下这场奇景',
  '替我向大家道个晚安',
  '群里现在都在聊什么？',
  '为我开启一段奇遇',
  '让我遇见一个意想不到的人',
  '今晚会不会有特别的事发生？',
  '带我去一场云庭的小冒险',
  '给今天添一个意外惊喜',
  '我想遇见一段故事',
  '让某个邻舍和我有个约定',
  '安排一次不期而遇',
  '我交代的事有回应了吗？',
  '刚才那件事进行到哪了？',
  '神谕落地了吗？',
  '帮我看看回应结果',
  '翻阅我们往日的话',
  '还记得上次那场雨吗？',
  '找出我最近的偏好',
  '把我们的约定念给我听',
  '你想对我说些什么？',
  '陪我坐一会儿',
  '今天有想告诉我什么吗？',
  '陪我看看今晚的云',
]
const suggestions = ref([])
function rollSuggestions() {
  const pool = [...new Set(SUGGESTION_POOL)]
  const picked = []
  while (picked.length < 3 && pool.length) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  suggestions.value = picked
}
const coreToolLabels = { inspect_neighbors: '看看邻舍的近况', read_character: '了解角色与日程', set_schedule: '安排日程', publish_moment: '请居民分享动态', discuss_in_group: '把话题带进群聊', create_encounter: '开启一段奇遇', create_world_event: '让神谕成为现实', inspect_work: '查看回应进展', recall_memory: '翻阅往日记忆', list_capabilities: '查看可用能力' }
const toolLabels = computed(() => ({ ...Object.fromEntries((god.state?.toolCatalog || []).map(t => [t.name, t.label])), ...coreToolLabels }))
const toolStateText = { running: '处理中', done: '已处理', failed: '暂未完成', uncertain: '需要核对' }
const userAvatarFailed = ref(false)
const showUserAvatar = computed(() => !!userAvatar.value && !userAvatarFailed.value)
const memoryLabels = { preference: '偏好', promise: '约定', event: '经历', relationship: '我们' }
const subtitle = computed(() => !god.state ? '云庭 · 等待你的声音' : `${god.state.angel.display_name} · ${!god.state.scheduleEnabled ? '日程未启用' : god.state.activity?.activity || (god.state.angel.schedule_error ? '今日日程暂未就绪' : '在云庭等候')}`)

function renderText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`\n]+)`/g, '<code>$1</code>')
}
function callState(turn, call) {
  const record = turn.calls.find(c => c.id.endsWith(`:${call.id}`))
  if (record) return record
  const result = turn.messages.find(m => m.role === 'tool' && m.tool_call_id === call.id)
  if (result) { try { return { status: JSON.parse(result.content).ok ? 'done' : 'failed' } } catch { /* 保留尚未确认的状态 */ } }
  return {}
}
function resultDescription(call) {
  if (!call.result) return call.status === 'uncertain' ? '执行结果尚不确定，请核对后再继续。' : '正在处理这项工作。'
  if (!call.result.ok) return call.result.error
  const value = call.result.value
  if (value?.note) return value.note
  if (value?.deliveries) return `已建立「${value.title}」，${value.deliveries.length} 个对象的实际回应见上方记录。`
  if (call.name === 'inspect_neighbors') return `查到 ${value.characters.length} 位角色和 ${value.groups.length} 个群聊。`
  if (call.name === 'read_character') return `已读取 ${value.name} 的资料与今日安排。`
  if (call.name === 'recall_memory') return '已读取相关的往日记忆。'
  if (call.name === 'inspect_work') return `已核对 ${value.length} 项工作。`
  return '已完成，结果已交给天使。'
}
function trackScroll() { const el = scrollArea.value; if (el) atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }
async function goBottom() { await nextTick(); if (scrollArea.value) scrollArea.value.scrollTop = scrollArea.value.scrollHeight; atBottom.value = true }
function imageLoaded() { if (atBottom.value) void goBottom() }
function fillPrompt(text) { god.setDraft(text); composer.value?.focus() }
let sending = false
const pendingImageTasks = new Set()
async function send() {
  if (sending || god.busy) return
  sending = true
  try {
    // 选中/粘贴后压缩是异步的：必须等占位图拿到 dataURI 再发，否则这条消息会静默丢图。
    if (pendingImageTasks.size) await Promise.allSettled([...pendingImageTasks])
    if (!god.draft.trim() && !draftImages.value.length) return
    atBottom.value = true
    const images = draftImages.value.map(image => image.url).filter(Boolean)
    const run = await god.send(images)
    if (run) { draftImages.value = []; acceptThinking(run.id) }
    await goBottom(); composer.value?.focus()
  } finally { sending = false }
}
function sendOnEnter(event) { if (!isMobile.value) { event.preventDefault(); void send() } }
function pickImages() {
  if (god.busy || draftImages.value.length >= maxImages) return
  fileInput.value?.click()
}
function onFileChange(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  void addImages(files)
}
function onComposerPaste(event) {
  const files = Array.from(event.clipboardData?.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter(Boolean)
  if (!files.length) return
  event.preventDefault()
  void addImages(files)
}
async function addImages(files) {
  const room = maxImages - draftImages.value.length
  if (!room) return
  const picked = files.filter(file => file && file.type.startsWith('image/')).slice(0, room)
  if (!picked.length) return
  for (const file of picked) {
    // 先占位再压缩：压缩完成前图片也必须算进草稿里，发送时才能等到它的 dataURI。
    const entry = reactive({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url: null })
    draftImages.value.push(entry)
    const task = compressImageFile(file)
      .then(url => { entry.url = url })
      .catch(() => {
        const index = draftImages.value.indexOf(entry)
        if (index >= 0) draftImages.value.splice(index, 1)
      })
      .finally(() => pendingImageTasks.delete(task))
    pendingImageTasks.add(task)
  }
}
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('解析图片失败'))
      image.onload = () => {
        const maxEdge = 1600
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.88))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
function removeImage(index) { draftImages.value.splice(index, 1) }
async function moreSessions() {
  if (sessionsLoading.value) return
  sessionsLoading.value = true; sessionsError.value = ''
  try {
    const page = await getGodSaysSessions(sessionsLoaded ? sessions.value.at(-1)?.day : undefined)
    sessions.value = [...new Map([...sessions.value, ...page].map(s => [s.id, s])).values()].sort((a, b) => b.day.localeCompare(a.day))
    sessionsLoaded = true; hasMoreSessions.value = page.length === 60
  }
  catch (err) { sessionsError.value = err.message }
  finally { sessionsLoading.value = false }
}
async function selectSession(session) { historyOpen.value = false; await god.load(session.day === god.state?.today ? null : session.id); await goBottom() }
async function openAngelPanel(schedule = false) {
  const request = ++angelRequest
  angelCharacter.value = { ...god.state?.angel, system_role: 'angel' }
  angelOpen.value = !schedule; scheduleOpen.value = schedule; scheduleLoading.value = schedule
  try {
    const angel = await getGodAngel()
    if (request === angelRequest) angelSaved({ ...angel, system_role: 'angel' })
  } catch (err) { if (request === angelRequest) god.error = err.message }
  finally { if (request === angelRequest) scheduleLoading.value = false }
}
function openAngel() { return openAngelPanel() }
function openSchedule() { return openAngelPanel(true) }

function angelSaved(angel) { angelCharacter.value = angel; if (god.state) god.state.angel = angel }
async function removeTurn(turn) {
  if (!await confirm({ title: '删除这一轮对话？', message: '这轮提问、回复、思考和执行记录将被删除，相关摘要与记忆会重新整理。已经执行的发帖、群聊等操作不会撤销。', okText: '删除这一轮', danger: true })) return
  if (await god.deleteTurn(turn.id)) {
    const session = sessions.value.find(s => s.id === turn.session_id)
    if (session) { session.summary = ''; session.preview = god.turns[0]?.input || ''; session.summary_status = 'pending' }
    memories.value = memories.value.filter(m => m.id !== turn.session_id)
  }
}
async function retrySummary(id) {
  try { await retryGodSummary(id); const item = sessions.value.find(s => s.id === id); if (item) item.summary_status = 'pending' }
  catch (err) { sessionsError.value = err.message }
}
async function openMemory() {
  memoryOpen.value = true; panelLoading.value = true; panelError.value = ''
  try { memories.value = await getGodSaysMemories() }
  catch (err) { panelError.value = err.message }
  finally { panelLoading.value = false }
}
let poll
let unsubscribe
let mounted = true
onActivated(rollSuggestions)
watch(() => god.turns.length, len => { if (!len && !god.archiveId) rollSuggestions() })
onMounted(async () => {
  rollSuggestions()
  void loadUserAvatar()
  loadFont(USER_BUBBLE_FONT_ID)
  unsubscribe = onEvent('god_world_event', god.updateWorld)
  await god.load(god.archiveId)
  if (!mounted) return
  activateThinking()
  void moreSessions()
  await goBottom()
  poll = setInterval(async () => {
    if (!god.state) return
    if (!god.archiveId) void god.refreshActivity()
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: god.state.session.time_zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    if (!god.archiveId && today !== god.state.session.day && !god.loading && !god.submitting) { await god.load(); await goBottom() }
    else if (god.state.worldEvents.some(e => e.deliveries.some(d => ['pending', 'running'].includes(d.status)))) await god.refreshWorld()
  }, 5000)
})
onBeforeUnmount(() => { mounted = false; leaveThinking(); clearInterval(poll); unsubscribe?.(); god.suspend() })
watch(() => god.state?.messages.reduce((n, m) => n + m.content.length + m.reasoning.length, 0), () => { if (atBottom.value) void goBottom() }, { flush: 'post' })
watch(() => god.state?.worldEvents, () => { if (atBottom.value) void goBottom() }, { deep: true })
watch(() => god.state?.session.id, () => {
  const session = god.state?.session
  if (session && !sessions.value.some(s => s.id === session.id)) sessions.value.unshift({ ...session, preview: god.turns[0]?.input || '' })
})
watch(() => god.turns[0]?.input, input => { const session = sessions.value.find(s => s.id === god.state?.session.id); if (session) session.preview = input || '' })
</script>

<style scoped>
.god-page,.god-modal-content { --god-muted:color-mix(in srgb, var(--text-primary) 28%, var(--text-secondary)); }
.god-page { --god-col:776px; position:relative; display:flex; flex-direction:row; flex:1; min-width:0; min-height:0; height:100dvh; overflow:hidden; color:var(--text-primary); background:var(--bg-sunken); }
.god-main { display:flex; flex-direction:column; min-width:0; min-height:0; flex:1; }
.god-history { display:flex; flex-direction:column; width:216px; flex-shrink:0; min-height:0; background:var(--bg-secondary); border-right:1px solid var(--border); }
.history-heading { display:flex; align-items:center; justify-content:space-between; min-height:78px; padding:0 20px; font-size:var(--fs-sm); font-weight:600; box-sizing:border-box; letter-spacing:1px; }
.history-days { flex:1; overflow-y:auto; padding:8px 10px; }.history-day { margin-bottom:5px; border-radius:var(--radius-md); transition:background .3s; }.history-day.selected { background:color-mix(in srgb,var(--accent) 11%,var(--bg-secondary)); }.history-choice { display:flex; flex-wrap:wrap; gap:6px 8px; padding:12px 10px; cursor:pointer; text-align:left; border-radius:var(--radius-md); }.history-choice:hover { background:var(--bg-sunken); }.history-choice:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }.history-date { font-size:var(--fs-sm); font-weight:600; }.history-day-label { color:var(--god-muted); font-size:var(--fs-xs); align-self:center; }.history-preview { display:block; width:100%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--god-muted); font-size:var(--fs-xs); line-height:1.7; }.history-note { padding:0 10px; color:var(--god-muted); font-size:var(--fs-sm); line-height:1.7; }.history-footer { border-top:1px solid var(--border); padding:16px 20px; }
.god-history-enter-active,.god-history-leave-active { transition:opacity .3s,transform .3s; }.god-history-enter-from,.god-history-leave-to { opacity:0; transform:translateX(-20px); }
.turn-actions { display:flex; justify-content:flex-start; padding:6px 4px 0; opacity:0; pointer-events:none; transition:opacity .3s var(--ease-standard); }
.god-turn:hover .turn-actions,.god-turn:focus-within .turn-actions { opacity:1; pointer-events:auto; }
@media(hover:none) { .turn-actions { opacity:1; pointer-events:auto; } }
.god-turn-enter-active,.god-turn-leave-active,.god-turn-move { transition:opacity .3s,transform .3s; }.god-turn-enter-from,.god-turn-leave-to { opacity:0; transform:translateY(-8px); }
.header-emblem,.speaker-emblem { cursor:pointer; }
.speaker-emblem>img { display:block; width:100%; height:100%; border-radius:inherit; object-fit:cover; }
@media(max-width:767px) { .god-history { position:absolute; left:0; top:0; bottom:0; width:min(280px,82%); z-index:6; box-shadow:var(--shadow-lg); }.history-heading { min-height:66px; } }
.god-header { position:relative; z-index:1; display:flex; align-items:center; gap:14px; flex-shrink:0; padding:16px 28px; border-bottom:1px solid var(--border); background:var(--bg-secondary); }
.header-emblem { width:52px; height:52px; box-sizing:border-box; flex-shrink:0; border-radius:var(--radius-full); overflow:hidden; transition:transform .15s ease, box-shadow .15s ease; }
.header-emblem:hover { transform:scale(1.08); box-shadow:0 0 0 3px rgba(var(--accent-rgb), 0.25); }
.header-title { min-width:0; flex:1; }
.header-title h1 { font-size:var(--fs-xl); letter-spacing:2px; margin:0 0 4px; font-weight:700; }
.header-title>span { display:block; color:var(--god-muted); font-size:var(--fs-sm); line-height:1.5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.header-actions { display:flex; gap:8px; flex-shrink:0; }
.header-actions .god-detail-btn { display:none; }
@media(min-width:1200px) { .god-page { --god-col:860px; } }
@media(min-width:1500px) { .god-page { --god-col:920px; } }
.god-scroll { min-height:0; flex:1; overflow-y:auto; overscroll-behavior:contain; }
.god-reading { width:min(100%, calc(var(--god-col) + 64px)); padding:28px 32px 36px; margin:0 auto; box-sizing:border-box; }
.god-welcome { position:relative; display:flex; align-items:center; flex-direction:column; text-align:center; padding:86px 0 64px; min-height:420px; max-width:100%; justify-content:center; }
.sacred-sky { position:absolute; inset:-28px -2% 0; pointer-events:none; overflow:hidden; -webkit-mask-image:linear-gradient(to bottom, transparent, #000 14%, #000 78%, transparent); mask-image:linear-gradient(to bottom, transparent, #000 14%, #000 78%, transparent); }
.sky-beam,.sky-arch { position:absolute; inset:0; width:100%; height:100%; }
.sky-beam { z-index:0; }
.sky-arch { z-index:1; }
[data-theme="dark"] .god-welcome :deep(.angel-emblem) { filter:drop-shadow(0 8px 22px color-mix(in srgb,var(--fun-gold) 20%,transparent)); }
[data-theme="dark"] .header-emblem :deep(.angel-emblem) { filter:drop-shadow(0 2px 6px color-mix(in srgb,var(--fun-gold) 24%,transparent)) brightness(.94); }
.sky-glow { transform-box:fill-box; transform-origin:center; animation:god-glow 9s ease-in-out infinite; filter:blur(26px); }
.sky-beam-core { transform-box:fill-box; transform-origin:center top; animation:god-beam 7s ease-in-out infinite; }
.sky-rays path { fill:none; stroke:color-mix(in srgb,var(--fun-gold) 16%,transparent); stroke-width:1; }
.arch-outer { fill:none; stroke:color-mix(in srgb,var(--fun-gold) 14%,var(--border-strong)); stroke-width:1; opacity:.62; }
.arch-inner { fill:none; stroke:color-mix(in srgb,var(--fun-gold) 9%,var(--border)); stroke-width:1; stroke-dasharray:2 7; opacity:.55; }
.arch-stars circle { fill:color-mix(in srgb,var(--fun-gold) 70%,var(--text-primary)); animation:god-twinkle 4.5s ease-in-out infinite; }
.arch-stars circle:nth-child(2) { animation-delay:1.2s; }
.arch-stars circle:nth-child(3) { animation-delay:2.1s; }
.arch-stars circle:nth-child(4) { animation-delay:.6s; }
.arch-stars circle:nth-child(5) { animation-delay:2.8s; }
.arch-diamond { fill:color-mix(in srgb,var(--fun-gold) 50%,transparent); stroke:color-mix(in srgb,var(--fun-gold) 82%,transparent); stroke-width:1; }
.welcome-angel { position:relative; width:176px; height:176px; margin:0 0 18px; z-index:2; }
.welcome-kicker { position:relative; display:inline-flex; align-items:center; gap:12px; font-size:var(--fs-xs); color:color-mix(in srgb,var(--fun-gold) 42%,var(--text-secondary)); letter-spacing:.42em; }
.kicker-rule { display:block; width:34px; height:1px; background:linear-gradient(to right,transparent,color-mix(in srgb,var(--fun-gold) 50%,transparent)); }
.kicker-rule:last-child { background:linear-gradient(to left,transparent,color-mix(in srgb,var(--fun-gold) 50%,transparent)); }
.god-welcome h2 { position:relative; margin:16px 0 12px; font-size:clamp(22px, 2.2vw, 30px); line-height:1.55; font-weight:600; letter-spacing:.06em; text-shadow:0 1px 20px color-mix(in srgb,var(--fun-gold) 14%,transparent); }
.god-welcome p { position:relative; margin:0; font-size:var(--fs-md); color:var(--god-muted); line-height:1.9; letter-spacing:.02em; }
.welcome-prompts { position:relative; display:flex; flex-wrap:wrap; gap:11px; justify-content:center; margin-top:32px; width:100%; max-width:100%; z-index:2; }
@keyframes god-halo { to { transform:rotate(360deg); } }
@keyframes god-glow { 0%,100% { opacity:.82; } 50% { opacity:1; } }
@keyframes god-beam { 0%,100% { opacity:.5; } 50% { opacity:.92; } }
@keyframes god-twinkle { 0%,100% { opacity:.22; } 50% { opacity:1; } }
.god-date { display:flex; align-items:center; justify-content:center; gap:12px; color:var(--god-muted); font-size:var(--fs-xs); margin:0 0 28px; font-variant-numeric:tabular-nums; letter-spacing:1px; }
.god-date::before,.god-date::after { content:''; width:42px; height:1px; background:var(--border-strong); }
.god-date span { color:var(--accent); font-size:8px; }
.god-turn { margin-bottom:32px; }
.god-user { display:flex; flex-direction:column; align-items:flex-end; margin:0 0 24px; }
.god-user-bubble { display:flex; flex-direction:column; align-items:flex-end; gap:8px; min-width:0; max-width:min(80%, calc(100% - 60px)); }
.god-user-text-line { display:flex; flex-direction:row; align-items:center; justify-content:flex-end; gap:12px; min-width:0; max-width:100%; }
.god-user-text { position:relative; isolation:isolate; min-width:0; margin:0; padding:18px 24px; font-size:var(--fs-md); line-height:1.9; white-space:pre-wrap; overflow-wrap:anywhere; color:color-mix(in srgb, var(--text-primary) 90%, #4a3418); }
.god-user-text::before { content:''; position:absolute; inset:0; z-index:-1; background:radial-gradient(ellipse at 50% -6%, color-mix(in srgb, #fff8e0 52%, transparent) 0%, transparent 58%), radial-gradient(circle at 18% 26%, color-mix(in srgb, #7a5230 22%, transparent) 0 2px, transparent 3px), radial-gradient(circle at 72% 68%, color-mix(in srgb, #7a5230 18%, transparent) 0 2px, transparent 3px), radial-gradient(circle at 45% 82%, color-mix(in srgb, #7a5230 14%, transparent) 0 1.5px, transparent 2.5px), linear-gradient(90deg, color-mix(in srgb, #6b4726 32%, transparent) 0%, transparent 9%, transparent 91%, color-mix(in srgb, #6b4726 32%, transparent) 100%), repeating-linear-gradient(0deg, color-mix(in srgb, #6b4726 6%, transparent) 0 1px, transparent 1px 7px), linear-gradient(158deg, color-mix(in srgb, var(--fun-gold) 40%, var(--bg-secondary)) 0%, color-mix(in srgb, var(--fun-gold) 26%, var(--bg-secondary)) 52%, color-mix(in srgb, var(--fun-gold) 36%, var(--bg-secondary)) 100%); filter:url(#god-torn-paper) drop-shadow(0 5px 8px color-mix(in srgb, #3a2614 40%, transparent)); }
.god-torn-defs { position:absolute; width:0; height:0; overflow:hidden; }
.god-user-images { max-width:100%; margin-right:calc(44px + 12px); }
.god-user-avatar { width:44px; height:44px; flex-shrink:0; display:grid; place-items:center; overflow:hidden; border:none; border-radius:var(--radius-full); background:var(--bg-tertiary); color:var(--god-muted); font-size:var(--fs-xs); line-height:1; user-select:none; }
.god-user-avatar img { width:100%; height:100%; object-fit:cover; display:block; }
.god-user-images :deep(.god-message-image) { margin:0; }
.god-user-images :deep(.image-hit img) { max-height:240px; }
.god-angel-reply { padding:20px 24px 22px; position:relative; border:1px solid var(--border); border-radius:6px var(--radius-xl) var(--radius-xl); background:var(--bg-secondary); box-shadow:var(--shadow-xs); }
.speaker-heading { display:flex; align-items:center; gap:10px; font-size:var(--fs-sm); font-weight:600; letter-spacing:1px; margin-bottom:18px; min-height:56px; }
.speaker-heading::after { content:''; height:1px; flex:1; margin-left:4px; background:var(--border); }
.speaker-emblem { width:56px; height:56px; flex-shrink:0; box-sizing:border-box; border-radius:var(--radius-full); overflow:hidden; cursor:pointer; transition:transform .15s ease, box-shadow .15s ease; }
.speaker-emblem:hover { transform:scale(1.08); box-shadow:0 0 0 3px rgba(var(--accent-rgb), 0.25); }
.speaker-emblem:focus-visible { outline:none; box-shadow:0 0 0 3px rgba(var(--accent-rgb), 0.25); }
.god-reply-text { max-width:640px; font-size:var(--fs-md); line-height:1.95; white-space:pre-wrap; overflow-wrap:anywhere; margin:18px 0 0; }
.god-reply-text :deep(strong) { font-weight:650; color:var(--text-bright); }
.god-reply-text :deep(code) { font-size:.92em; padding:2px 4px; background:var(--bg-tertiary); border-radius:var(--radius-sm); }
.god-thinking { margin:12px 0; padding:8px 10px; color:var(--god-muted); border:1px solid var(--border); border-radius:var(--radius-md); background:color-mix(in srgb, var(--bg-sunken) 72%, var(--bg-secondary)); }
.thinking-chevron { display:block; width:14px; height:14px; flex-shrink:0; transition:transform .3s var(--ease-standard); }
.thinking-chevron.expanded { transform:rotate(90deg); }
.thinking-text { margin:6px 6px 4px; padding:12px 4px 4px; border-top:1px solid var(--border); line-height:1.85; font-size:var(--fs-base); color:color-mix(in srgb, var(--text-primary) 64%, var(--text-secondary)); white-space:pre-wrap; overflow-wrap:anywhere; }
.thinking-pulse { animation:god-breathe 1.8s ease-in-out infinite; }
.god-tool-list { display:flex; flex-direction:column; gap:8px; margin:14px 0; }
.god-tool-row { display:flex; align-items:center; gap:10px; padding:8px 12px; font-size:var(--fs-sm); color:var(--text-primary); }
.tool-label { min-width:0; overflow-wrap:anywhere; line-height:1.6; }
.tool-mark { position:relative; display:grid; place-items:center; width:22px; height:22px; flex-shrink:0; color:var(--accent-hover); background:color-mix(in srgb, var(--accent) 12%, var(--bg-secondary)); border-radius:var(--radius-full); font-size:var(--fs-xs); transition:color .3s var(--ease-standard), background .3s var(--ease-standard); }
.tool-mark > * { grid-area:1 / 1; transition:opacity .3s var(--ease-standard), transform .3s var(--ease-standard); }
.tool-mark .mark-glyph { width:13px; height:13px; opacity:0; transform:scale(.55); }
.tool-mark .mark-dot { width:5px; height:5px; border-radius:50%; background:currentColor; opacity:0; transform:scale(.55); }
.tool-mark .mark-spinner { width:13px; height:13px; box-sizing:border-box; border-radius:50%; border:1.6px solid color-mix(in srgb, currentColor 24%, transparent); border-top-color:currentColor; opacity:0; }
.tool-mark:not([data-status='running']):not([data-status='done']):not([data-status='failed']):not([data-status='uncertain']) .mark-dot { opacity:.55; transform:scale(1); }
.tool-mark[data-status='running'] { color:color-mix(in srgb, var(--fun-gold) 72%, var(--text-primary)); background:color-mix(in srgb, var(--fun-gold) 12%, var(--bg-secondary)); }
.tool-mark[data-status='running'] .mark-spinner { opacity:1; animation:tool-mark-spin .9s linear infinite; }
.tool-mark[data-status='done'] .mark-check { opacity:1; transform:scale(1); }
.tool-mark[data-status='failed'] { color:var(--danger); background:color-mix(in srgb, var(--danger) 10%, var(--bg-secondary)); }
.tool-mark[data-status='uncertain'] { color:color-mix(in srgb, var(--fun-gold) 78%, var(--text-primary)); background:color-mix(in srgb, var(--fun-gold) 12%, var(--bg-secondary)); }
.tool-mark[data-status='failed'] .mark-bang,.tool-mark[data-status='uncertain'] .mark-bang { opacity:1; transform:scale(1); }
@keyframes tool-mark-spin { to { transform:rotate(360deg); } }
.preparing-reply,.partial-note,.turn-notice { font-size:var(--fs-sm); line-height:1.7; color:var(--god-muted); margin:12px 0; }
.preparing-reply span { margin-right:8px; color:var(--fun-gold); }
.execution-record { margin-top:16px; padding-top:14px; border-top:1px solid color-mix(in srgb, var(--fun-gold) 20%, var(--border)); }
.exec-icon { color:color-mix(in srgb, var(--fun-gold) 65%, currentColor); }
.exec-count { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; border-radius:999px; font-size:var(--fs-xs); font-weight:650; letter-spacing:0; line-height:1; font-variant-numeric:tabular-nums; color:color-mix(in srgb, var(--fun-gold) 78%, var(--text-primary)); background:color-mix(in srgb, var(--fun-gold) 16%, transparent); }
.exec-chevron { width:12px; height:12px; transition:transform .3s var(--ease-standard); }
.exec-chevron.is-open { transform:rotate(90deg); }
.execution-body { border-left:2px solid var(--border); margin:10px 0 0 9px; padding-left:16px; }
.execution-item { margin:0 0 14px; font-size:var(--fs-sm); line-height:1.7; }
.execution-item strong { font-weight:600; }
.execution-item p { color:var(--god-muted); margin:5px 0; overflow-wrap:anywhere; }
.execution-item a { color:var(--accent); text-decoration:none; }
.god-composer-area { position:relative; z-index:1; flex-shrink:0; padding: 0 22px 12px max(20px, env(safe-area-inset-bottom)); background:transparent; }
.god-composer-area::before { content:''; position:absolute; left:0; right:0; bottom:100%; height:56px; z-index:1; pointer-events:none; background:linear-gradient(to top, var(--bg-sunken) 0%, color-mix(in srgb, var(--bg-sunken) 55%, transparent) 55%, transparent 100%); }
.god-composer { max-width:var(--god-col); margin:auto; padding:12px 16px 10px; border:1px solid var(--border-strong); border-radius:calc(var(--radius-xl) + 4px); background:var(--bg-secondary); box-shadow:var(--shadow-sm); transition:border-color .3s var(--ease-standard); }
.god-composer:focus-within { border-color:color-mix(in srgb,var(--text-secondary) 65%,var(--border-strong)); }
.god-composer.is-readonly { background:var(--bg-tertiary); }
.composer-tools { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:38px; padding-top:8px; }
.composer-left { display:flex; align-items:center; gap:8px; min-width:0; }
.composer-count { color:var(--god-muted); font-size:var(--fs-xs); font-variant-numeric:tabular-nums; }
.composer-file { display:none; }
.composer-images { display:flex; gap:8px; padding:12px 0 2px; overflow-x:auto; scrollbar-width:thin; }
.composer-image { position:relative; flex:0 0 auto; width:56px; height:56px; margin:0; border-radius:var(--radius-md); overflow:hidden; background:var(--bg-sunken); border:1px solid var(--border); }
.composer-image img { display:block; width:100%; height:100%; object-fit:cover; }
.composer-image-pending { display:grid; place-items:center; width:100%; height:100%; }
.composer-image-pending::after { content:'···'; font-size:var(--fs-sm); letter-spacing:2px; color:var(--god-muted); animation:composer-image-breathe 1.2s ease-in-out infinite; }
@keyframes composer-image-breathe { 0%,100% { opacity:.35; } 50% { opacity:1; } }
.composer-image-remove { position:absolute; top:2px; right:2px; display:grid; place-items:center; width:16px; height:16px; padding:0; border:0; border-radius:50%; background:rgba(0,0,0,.5); color:#fff; cursor:pointer; }
.composer-image-remove svg { width:9px; height:9px; }
.composer-action-icon { display:block; width:20px; height:20px; }
.composer-action-enter-active,.composer-action-leave-active { transition:opacity .3s var(--ease-standard),transform .3s var(--ease-standard); }
.composer-action-enter-from,.composer-action-leave-to { opacity:0; transform:scale(.9); }
.god-latest { position:absolute; right:24px; bottom:calc(100% + 12px); z-index:2; }
/* ── 圣所式细节：表头金线、徽记光环、输入区金色微光 ── */
.god-header { border-bottom-color:color-mix(in srgb,var(--fun-gold) 13%,var(--border)); }
.header-emblem { position:relative; }
.header-emblem-halo { position:absolute; inset:0; border-radius:50%; background:radial-gradient(circle at 50% 42%, color-mix(in srgb,var(--fun-gold) 22%,transparent), transparent 70%); opacity:0; pointer-events:none; transition:opacity var(--dur-interaction) var(--ease-standard); }
.header-emblem:hover .header-emblem-halo { opacity:1; }
.welcome-prompts .gsb-icon { width:11px; height:11px; }
.composer-tools .gsb--primary { flex-shrink:0; }
.god-composer { transition:border-color var(--dur-interaction) var(--ease-standard), box-shadow var(--dur-interaction) var(--ease-standard); }
.god-composer:focus-within { border-color:color-mix(in srgb,var(--fun-gold) 30%,var(--border-strong)); box-shadow:var(--shadow-sm), 0 0 0 3px color-mix(in srgb,var(--fun-gold) 8%,transparent); }
.god-error,.archive-strip { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding:9px 24px; font-size:var(--fs-sm); line-height:1.6; background:var(--bg-secondary); border-bottom:1px solid var(--border); }
.god-error { color:var(--danger); }
.connection-note { max-width:var(--god-col); margin:0 auto 8px; color:var(--god-muted); font-size:var(--fs-xs); line-height:1.6; }
.god-loading .skeleton { height:56px; margin-bottom:25px; border-radius:var(--radius-md); }
.god-loading .skeleton:nth-child(2) { width:75%; }
.god-modal-content { font-size:var(--fs-md); line-height:1.8; }
.modal-note,.memory-empty { margin:0 0 18px; font-size:var(--fs-sm); line-height:1.8; color:var(--god-muted); }
.modal-error { margin:12px 0; color:var(--danger); font-size:var(--fs-sm); line-height:1.7; }
.memory-entry { margin:20px 0; }
.memory-entry h4 { font-size:var(--fs-md); margin:0 0 10px; }
.memory-entry ul { margin:0; padding:0; list-style:none; }
.memory-entry li { display:flex; gap:10px; font-size:var(--fs-sm); line-height:1.8; margin:10px 0; }
.memory-entry li span { color:var(--accent); flex-shrink:0; }
.memory-entry p { margin:8px 0; font-size:var(--fs-sm); color:var(--god-muted); line-height:1.8; }
.god-content-enter-active,.god-content-leave-active { transition:opacity .3s var(--ease-standard),transform .3s var(--ease-standard); }
.god-content-enter-from,.god-content-leave-to { opacity:0; transform:translateY(5px); }
@keyframes god-breathe { 0%,100% { opacity:.45; } 50% { opacity:1; } }
@media(max-width:767px) {
  .god-header { padding:12px; gap:8px; flex-wrap:wrap; }
  .header-emblem { display:none; }
  .header-title h1 { font-size:var(--fs-lg); }
  .header-title>span { font-size:var(--fs-xs); }
  .header-actions { gap:2px; }
  .header-actions .god-detail-btn { display:inline-flex; }
  .god-reading { padding:22px 12px; }
  .god-welcome { padding:52px 0 30px; min-height:340px; }
  .sacred-sky { inset:-10px -2% 0; }
  .welcome-angel { width:136px; height:136px; }
  .welcome-kicker { letter-spacing:.3em; }
  .kicker-rule { width:22px; }
  .god-welcome p { font-size:var(--fs-sm); }
  .welcome-prompts { gap:9px; margin-top:24px; }
  .god-angel-reply { padding:14px; }
  .speaker-heading { margin-bottom:12px; min-height:48px; }
  .speaker-emblem { width:48px; height:48px; }
  .god-thinking { padding:6px; }
  .thinking-text { margin-right:4px; margin-left:4px; padding-top:10px; }
  .god-tool-row { padding:6px 4px; gap:8px; }
  .god-composer-area { padding:16px 12px max(12px, env(safe-area-inset-bottom)); }
  .god-composer-area::before { height:36px; }
  .god-composer { padding:10px 14px 8px; }
  .god-latest { right:12px; }
  .composer-hint { display:none; }
  .god-user { margin:0 0 24px; }
}
@media(max-width:380px) { .header-actions { margin-left:auto; } .header-title { flex-basis:calc(100% - 50px); } }
</style>
