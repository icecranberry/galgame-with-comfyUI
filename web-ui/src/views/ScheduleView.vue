<template>
  <div class="schedule-view">
    <div class="sched-layout">
      <!-- ═══ 左：主体内容区 ═══ -->
      <div class="sched-main">
        <!-- 已加载且有角色 -->
        <template v-if="!store.loading && enrichedChars.length > 0">
          <div class="main-topbar" :class="{ 'header-hidden': isMobile && !headerVisible }">
            <div class="topbar-row">
              <h2 @click="isMobile && toggleMobileSidebar?.()" :class="{ 'is-clickable': isMobile }">日程</h2>
              <div class="topbar-actions">
                <linshe-input
                  v-model="searchQuery"
                  class="search-input"
                  placeholder="搜索..."
                  aria-label="搜索角色日程"
                  @keydown.esc="searchQuery = ''"
                />
                <div
                  class="lib-gear"
                  role="button"
                  tabindex="0"
                  title="日程台账（长期观测）"
                  aria-label="日程台账"
                  @click="openLedger"
                  @keydown.enter.prevent="openLedger"
                  @keydown.space.prevent="openLedger"
                ><ledger-icon :size="18" /></div>
                <div
                  class="lib-gear"
                  role="button"
                  tabindex="0"
                  title="日程设置"
                  aria-label="日程设置"
                  @click="openSettings"
                  @keydown.enter.prevent="openSettings"
                  @keydown.space.prevent="openSettings"
                ><gear-icon :size="18" /></div>
                <div
                  class="btn-reset"
                  :class="{ 'is-resetting': store.resetTask?.processing, 'is-disabled': store.resetTask?.processing && !store.resetTask?.backgrounded }"
                  role="button"
                  tabindex="0"
                  :aria-disabled="store.resetTask?.processing && !store.resetTask?.backgrounded"
                  @click.stop="handleResetClick"
                  @keydown.enter.prevent="handleResetClick"
                  @keydown.space.prevent="handleResetClick"
                >
                  <svg v-if="!store.resetTask?.processing" class="btn-reset-icon" viewBox="0 0 1024 1024" width="16" height="16"><path d="M1017.6 595.2c19.2-134.4-6.4-256-89.6-364.8C832 89.6 588.8-19.2 480 25.6c6.4 25.6 6.4 44.8 12.8 70.4 262.4 0 428.8 185.6 448 371.2 19.2 179.2-89.6 371.2-249.6 428.8v-179.2c0-25.6-12.8-38.4-32-38.4-38.4 0-51.2 12.8-38.4 57.6 12.8 70.4 6.4 140.8 0 211.2 0 38.4 19.2 32 64 32h160c83.2 0 96 12.8 96-32 0-25.6-6.4-38.4-38.4-38.4H832c96-76.8 166.4-179.2 185.6-313.6zM76.8 512c0-153.6 115.2-345.6 224-364.8v153.6c0 32 6.4 38.4 38.4 38.4s38.4-6.4 38.4-38.4V64c0-32-6.4-38.4-38.4-38.4H102.4C70.4 25.6 64 32 64 64s0 38.4 38.4 38.4h102.4c-230.4 185.6-243.2 467.2-128 659.2 108.8 185.6 326.4 256 460.8 236.8-6.4-25.6-6.4-44.8-12.8-70.4-275.2 6.4-448-217.6-448-416z"/></svg>
                  <svg v-else class="btn-reset-icon spinning" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  <span>{{ store.resetTask?.processing ? (store.resetTask?.backgrounded ? `重置中 ${store.resetTask.current}/${store.resetTask.total}` : '重置中...') : '全部重置' }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="card-grid stagger" @scroll.passive="onScroll" ref="cardGridEl">
            <CharacterStatusCard
              v-for="c in activeChars"
              :key="c.id"
              :char="c"
              @select="onSelectChar(c.id)"
              @peek="onCardPeek(c.id)"
              @diary="onOpenDiary(c)"
              @wake="onCardWake(c.id)"
              @pin="toggleCharPin(c)"
            />

            <!-- 归档角色分类栏：默认折叠，不占屏；搜索时自动展开 -->
            <div v-if="archivedChars.length" class="archive-bar" :class="{ collapsed: !archiveGroupOpen }">
              <span class="archive-bar-line" aria-hidden="true"></span>
              <div
                class="archive-bar-label"
                role="button"
                tabindex="0"
                :aria-expanded="archiveGroupOpen"
                :title="archiveGroupOpen ? '收起归档角色' : '展开归档角色'"
                @click="toggleArchiveGroup"
                @keydown.enter.prevent="toggleArchiveGroup"
                @keydown.space.prevent="toggleArchiveGroup"
              >
                <svg class="archive-bar-arrow" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="6,9 12,15 18,9" />
                </svg>
                <span>归档角色</span>
                <span class="archive-bar-count">{{ archivedChars.length }}</span>
              </div>
              <span class="archive-bar-line" aria-hidden="true"></span>
            </div>

            <template v-if="archiveGroupOpen">
              <CharacterStatusCard
                v-for="c in archivedChars"
                :key="c.id"
                :char="c"
                @select="onSelectChar(c.id)"
                @peek="onCardPeek(c.id)"
                @wake="onCardWake(c.id)"
                @pin="toggleCharPin(c)"
              />
            </template>
          </div>
        </template>

        <!-- 空态（加载中不渲染，避免误报「还没有日程」） -->
        <div v-else-if="!store.loading" class="sched-placeholder">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <p>今天还没有角色日程</p>
          <span class="ph-hint">生成日程后，这里会显示每位角色的今日动向。</span>
          <linshe-button class="btn-glass" variant="secondary" @click="regenerateAll">为所有角色生成日程</linshe-button>
        </div>
      </div>

      <!-- ═══ 扫描特效遮罩（仅生成时显示）═══ -->
      <aside v-if="sidebarScanActive" class="sched-sidebar is-scanning">
        <div class="sidebar-scan-overlay">
          <div class="sidebar-scan-line"></div>
          <div class="sidebar-scan-glow"></div>
          <div class="sidebar-scan-content">
            <div class="sidebar-scan-icon">
              <svg viewBox="0 0 80 80" class="sidebar-scan-ring">
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(var(--accent-rgb),0.12)" stroke-width="2.5"/>
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent)"
                  stroke-width="2.5" stroke-linecap="round"
                  stroke-dasharray="214"
                  :stroke-dashoffset="214 * (1 - sidebarScanProgress / 100)"
                  class="sidebar-scan-ring-fill"
                />
              </svg>
              <div class="sidebar-scan-pct">{{ sidebarScanProgress }}%</div>
            </div>
            <div class="sidebar-scan-label">日程生成中</div>
            <div class="sidebar-scan-phrase">
              <Transition name="phrase" mode="out-in">
                <p :key="currentSidebarTipIndex">{{ sidebarTips[currentSidebarTipIndex] }}</p>
              </Transition>
            </div>
            <div class="sidebar-scan-sub">
              <template v-if="sidebarScanContext === 'reset' && store.resetTask">
                正在为 <b>{{ store.resetTask.currentName || '...' }}</b> 编排日程
                <span class="sidebar-scan-count">({{ store.resetTask.current }}/{{ store.resetTask.total }})</span>
              </template>
              <template v-else>
                正在为 <b>{{ detailChar?.display_name || '...' }}</b> 重新编排日程
              </template>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- ═══ 角色详情抽屉 ═══ -->
    <CharacterDetailDrawer
      :open="drawerOpen"
      :char="detailChar"
      :activities="detailActs"
      :loading="detailLoading"
      :peek-busy="peekBusy"
      :regenerating="detailRegenerating"
      @close="drawerOpen = false"
      @peek="onPeek"
      @peek-at="onPeekAt"
      @regenerate="onRegenerate"
      @chat="onChat"
      @wakePhone="onWakePhone"
      @wakeDoor="onWakeDoor"
      @clear-schedule="onClearFromDrawer"
      @updated="detailActs = $event"
      @diary="onOpenDiary(detailChar)"
    />

    <!-- ═══ 日程设置弹窗 ═══ -->
    <linshe-modal v-model="settingsOpen" title="日程设置">
      <div class="sched-settings-body">
        <div class="sched-settings-toggle-row">
          <div class="sched-settings-toggle-text">
            <span class="sched-settings-toggle-label">停止所有角色生成日程</span>
            <span class="sched-settings-hint">开启后不再调用模型编排日程，已生成的日程照常使用、内容保持不变；想单独控制某个角色，去它的详情卡「更多设置」里关。</span>
          </div>
          <linshe-switch
            :model-value="allSchedulesDisabled"
            :disabled="scheduleAllToggling"
            @change="toggleAllSchedules"
            aria-label="停止所有角色生成日程"
          />
        </div>
        <div class="sched-settings-divider"></div>
        <div class="sched-settings-slider-heading">
          <label for="schedule-refresh-days">日程刷新周期</label>
          <span class="sched-settings-value">每 {{ refreshDays }} 天刷新一次</span>
        </div>
        <linshe-slider
          id="schedule-refresh-days"
          v-model="refreshDays"
          :min="1" :max="3" :step="1"
          aria-label="日程刷新周期"
        />
        <p class="sched-settings-hint">每隔 {{ refreshDays }} 天自动为所有角色重新编排日程，更改在下次刷新时生效。</p>
      </div>
      <template #footer>
        <linshe-button variant="primary" :disabled="savingRefreshDays" :loading="savingRefreshDays" @click="onConfirmSettings">确定</linshe-button>
      </template>
    </linshe-modal>

    <!-- ═══ 日程台账（长期观测：八股/稳定性/风险） ═══ -->
    <linshe-modal v-model="ledgerOpen" title="日程台账">
      <div class="ledger-body">
        <p class="ledger-hint">
          本台账把每个角色**已生成的全部日程**做量化对比，用来持续观察编排的合理性、稳定性与八股程度。
          <b>复读率</b>＝不同日期日程间的 4 字片段重合度；<b>地点集中</b>＝Top5 地点占全部地点的比例；<b>道具</b>＝每篇高频道具名词数。
        </p>

        <div v-if="ledgerLoading" class="ledger-loading">正在统计…</div>
        <div v-else-if="ledgerError" class="ledger-error">{{ ledgerError }}</div>
        <template v-else>
          <div class="ledger-summary">
            <span>纳入角色 <b>{{ ledgerData.summary.withSchedules }}</b></span>
            <span>风险项 <b>{{ ledgerData.summary.totalIssues }}</b></span>
            <span>平均复读 <b>{{ ledgerData.summary.avgRepeat4gram }}%</b></span>
            <span>平均道具词/篇 <b>{{ ledgerData.summary.avgPropPerRecord }}</b></span>
          </div>

          <div class="ledger-risk-wrap">
            <span class="ledger-risk-label">风险分布：</span>
            <span v-for="r in ledgerRisk" :key="r.code" class="ledger-risk-chip" :title="riskTitle(r.code)">
              {{ riskLabel(r.code) }} ×{{ r.count }}
            </span>
          </div>

          <div class="ledger-filters">
            <linshe-switch
              v-model="ledgerShowArchived" size="sm"
              :on-text="`显示归档角色（${ledgerArchivedCount}）`"
              off-text="归档角色已折叠"
            />
          </div>

          <div class="ledger-list">
            <div
              v-for="c in ledgerRows"
              :key="c.character.id"
              class="ledger-row"
              :class="{ 'is-open': ledgerExpanded === c.character.id, 'is-archived': c.character.archived }"
              @click="ledgerExpanded = ledgerExpanded === c.character.id ? 0 : c.character.id"
            >
              <div class="ledger-row-head">
                <span class="ledger-name">{{ c.character.name }}</span>
                <span v-if="c.character.archived" class="ledger-archived-tag">归档</span>
                <span v-if="c.cliche.measurable === false" class="ledger-metric is-na" title="只有一份日程快照，无可比对象（需积累多天才可量化）">复读 不可测</span>
                <span v-else class="ledger-metric" :class="repeatClass(c.cliche.repeat4gram)">复读 {{ c.cliche.repeat4gram }}%</span>
                <span class="ledger-metric">地点集中 {{ c.cliche.topPlaceShare }}%</span>
                <span class="ledger-metric">道具 {{ c.cliche.propPerRecord }}/篇</span>
                <span class="ledger-records">{{ c.records }} 份{{ c.hasTemplate ? '（含模板）' : '' }}</span>
              </div>
              <div v-if="ledgerExpanded === c.character.id" class="ledger-row-detail">
                <div v-if="c.cliche.sampleTop?.length" class="ledger-detail-line">
                  <b>高频地点：</b>{{ c.cliche.sampleTop.slice(0, 8).map(x => `${x.place}×${x.count}`).join('、') }}
                </div>
                <div v-if="c.stability" class="ledger-detail-line">
                  <b>与模板相似度：</b>{{ c.stability.avgPlaceSimilarity }}%（样本 {{ c.stability.samples }} 份，越高＝越照抄模板）
                </div>
                <div v-if="c.riskByCode?.length" class="ledger-detail-line">
                  <b>风险：</b>{{ c.riskByCode.map(r => `${riskLabel(r.code)}×${r.count}`).join('、') }}
                  <span class="ledger-dim">（已按「同类问题+同一对象」去重）</span>
                </div>
                <div v-if="c.latest?.issues?.length" class="ledger-detail-line ledger-issues">
                  <b>最近一次问题：</b>
                  <div v-for="(it, i) in c.latest.issues" :key="i" class="ledger-issue">
                    {{ issueText(it) }}<span v-if="it.occurrences > 1" class="ledger-dim">（×{{ it.occurrences }}）</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
      <template #footer>
        <linshe-button variant="ghost" :loading="ledgerLoading" @click="loadLedger">刷新</linshe-button>
        <linshe-button variant="primary" @click="ledgerOpen = false">关闭</linshe-button>
      </template>
    </linshe-modal>
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="peekOpen" class="peek-overlay" @click="onPeekClose">
          <div class="peek-film" :class="{ 'pk-shutter-fire': shutterFire }" :style="peekFilmStyle" @click.stop>
            <!-- 胶卷上黑边 + 白色矩形齿孔 -->
            <div class="pk-film-edge pk-film-edge-top" aria-hidden="true"></div>

            <!-- 图片区域（尺寸以奇遇参数为基准） -->
            <div class="pk-body" :style="peekBodyStyle">
              <template v-if="peekLoading">
                <div class="pk-wait">
                  <div class="pk-ring-container">
                    <svg viewBox="0 0 80 80" class="pk-ring">
                      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--pk-ring-track)" stroke-width="3" />
                      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent)"
                        stroke-width="3" stroke-linecap="round"
                        :stroke-dasharray="2 * Math.PI * 34"
                        :stroke-dashoffset="2 * Math.PI * 34 * (1 - peekProgress / 100)"
                        class="pk-ring-progress"
                      />
                    </svg>
                    <div class="pk-ring-pct">{{ peekProgress }}%</div>
                  </div>
                  <div class="pk-wait-phrase">
                    <Transition name="phrase" mode="out-in">
                      <p :key="currentPhraseIndex">{{ phrases[currentPhraseIndex] }}</p>
                    </Transition>
                  </div>
                </div>
              </template>
              <template v-else-if="peekError">
                <div class="pk-err"><p>生成失败</p><span>{{ peekError }}</span><linshe-button class="btn-glass" variant="secondary" @click="retryPeek">重试</linshe-button></div>
              </template>
              <div v-else-if="peekImage" class="pk-shutter-stage">
                <div class="pk-shutter-flash"></div>
                <div class="pk-shutter-curtain pk-curtain-top"></div>
                <div class="pk-shutter-curtain pk-curtain-bottom"></div>
                <img
                  :src="peekImage"
                  class="pk-img"
                  @click="lightboxVisible = true"
                />
              </div>
            </div>

            <!-- 胶卷下黑边 + 白色矩形齿孔 -->
            <div class="pk-film-edge pk-film-edge-bottom" aria-hidden="true"></div>

            <!-- 底部信息栏（原 pk-top + footer 合并） -->
            <div class="pk-bar">
              <div class="pk-char">
                <div class="pk-char-avatar">
                  <img v-if="peekChar?.avatar_path" :src="peekChar.avatar_path" class="pk-char-avatar-img" alt="" />
                  <span v-else class="pk-char-avatar-text">{{ peekChar?.display_name?.charAt(0) || '' }}</span>
                </div>
                <div><b>{{ peekAct?.activity || '瞄一眼' }}</b><span v-if="peekAct?.location">{{ peekAct.location }}</span></div>
              </div>
              <div class="pk-actions">
                <linshe-button v-if="peekImage && !peekLoading" class="pk-retake-btn" variant="secondary" size="sm" :disabled="peekBusy" @click="retakePeek">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23,4 23,10 17,10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span class="pk-retake-label">{{ peekBusy ? '拍摄中...' : '再拍一张' }}</span>
                </linshe-button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 图片放大预览 -->
    <Teleport to="body">
      <ImageLightbox
        :visible="lightboxVisible"
        :imgs="peekImage ? [peekImage] : []"
        :z-index="1200"
        @hide="lightboxVisible = false"
      />
    </Teleport>

    <!-- 瞄一眼图片悬浮 description 提示框 -->
    <Teleport to="body">
      <Transition name="lbtip">
        <div
          v-if="peekOpen && peekTooltipVisible && lightboxDescription"
          class="lightbox-tooltip"
          :class="{ flip: peekTooltipFlip }"
          :style="peekTooltipStyle"
        >
          {{ lightboxDescription }}
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ 改变日程方向输入弹窗（含地图联动 / NSFW 强度 / 睡眠类型）═══ -->
    <Teleport to="body">
      <Transition name="modal">
        <!-- ★ 2026-10-07 用户实报「编排日程的弹窗总是自己弹掉」。
             实测复现：点遮罩（overlay 空白处）即关 —— 这个弹窗**很高**（5 个 section，
             内容区还要滚动），滚轮/滑动时手指很容易落到遮罩上，于是"填了一半就没了"。
             ★ 现在改为**必须显式关闭**（右上角关闭按钮 / Esc），点遮罩不再关闭。
             理由：本弹窗里全是用户手填的选项，误关的代价远大于"少一个快捷关闭方式"；
             而且进去极易误触。Esc 仍保留（主动按键不会误触）。 -->
        <div v-if="showRegenerateModal" class="reset-overlay">
          <div class="reset-dialog regen-dialog" @click.stop>
            <div class="reset-dialog-header">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1,4 1,10 7,10" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
              <span>为 {{ detailChar?.display_name || '...' }} 编排日程</span>
              <!-- ★ 2026-10-07 用户口径：右上角要有**关闭按钮**。
                   此前这里是个垃圾桶（清空日程）—— 用户认为那个功能放在这个位置没有意义，
                   而且弹窗**没有任何显式关闭入口**（只能点遮罩，极易误触 → "自己弹掉"）。
                   现在：关闭按钮守右上角；「清空日程」移到侧边栏角色日程右上角（见下）。 -->
              <linshe-button class="reset-header-close" variant="icon" size="sm" title="关闭（不生成，已填内容保留到下次打开）" @click="closeRegenModal">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </linshe-button>
            </div>

            <div class="regen-body">
              <div class="reset-dialog-desc">
                <p>定向规划{{ detailChar?.display_name || '...' }}今天的行程。留空则正常随机规划。</p>
                <linshe-input
                  type="textarea"
                  v-model="regenerateDirection"
                  class="regenerate-textarea"
                  placeholder="例如：今天做一场深夜直播、去市中心摆摊接客、宅在宿舍打一天游戏、去地下赌场押注..."
                  rows="3"
                  ref="regenerateTextareaRef"
                  @keydown.enter.exact="confirmRegenerateWithDirection"
                />
              </div>

              <!-- ── 主要活动区域（与地图联动）── -->
              <section class="regen-sec">
                <div class="regen-sec-head">
                  <span class="regen-sec-title">主要活动区域</span>
                  <span class="regen-sec-note">{{ regenAreaHint }}</span>
                  <button
                    v-if="regenAreas.length" type="button" class="regen-link"
                    @click="regenAreas = []"
                  >清空</button>
                </div>

                <p v-if="regenOptionsLoading" class="regen-sec-empty">正在读取世界地图…</p>
                <p v-else-if="!regenAreaGroups.length" class="regen-sec-empty">世界地图里还没有可用区域</p>
                <div v-else class="regen-area-groups">
                  <div v-for="g in regenAreaGroups" :key="g.region" class="regen-area-group">
                    <span class="regen-area-region">{{ g.region }}</span>
                    <div class="regen-chips">
                      <button
                        v-for="a in g.areas" :key="a.name" type="button"
                        class="regen-chip" :class="{ on: regenAreas.includes(a.name) }"
                        :title="a.places?.length ? `选中后可展开，逐个划掉不想去的地点（共 ${a.places.length} 个）` : '该区域暂时没有场景'"
                        @click="toggleArea(a.name)"
                      >{{ a.name }}</button>
                      <!-- 展开按钮：只对已选中的区域显示（未选中的区域展示地点没有意义） -->
                      <button
                        v-for="a in g.areas.filter((x: any) => regenAreas.includes(x.name) && x.places?.length)"
                        :key="`ex-${a.name}`" type="button"
                        class="regen-chip regen-chip-sub"
                        :class="{ on: regenExpandedArea === a.name }"
                        :title="`展开「${a.name}」的地点清单，逐个划掉不想去的`"
                        @click="toggleAreaExpand(a.name)"
                      >{{ regenExpandedArea === a.name ? '收起' : '地点' }} <span class="regen-chip-n">{{ a.places.length }}</span></button>
                    </div>
                  </div>
                </div>

                <!-- ── 地点级：展开后默认全勾，取消勾选 = 排除 ── -->
                <div v-if="regenExpandedAreaObj" class="regen-places">
                  <p class="regen-places-hint">
                    <b>{{ regenExpandedAreaObj.name }}</b> 的地点（默认可去；<b>点一下划掉</b>不想让角色去的地方）
                  </p>
                  <div class="regen-place-list">
                    <label
                      v-for="p in (regenExpandedAreaObj.places || [])"
                      :key="p.name" class="regen-place"
                      :class="{ off: !placeChecked(regenExpandedAreaObj, p) }"
                    >
                      <input
                        type="checkbox"
                        :checked="placeChecked(regenExpandedAreaObj, p)"
                        @change="togglePlace(regenExpandedAreaObj, p)"
                      >
                      <span class="regen-place-name">{{ p.name }}</span>
                      <span v-if="p.category" class="regen-place-tag">{{ p.category }}</span>
                      <!-- 受限地点：灰显 + 写明原因（不是"莫名其妙不见了"） -->
                      <span v-if="p.reason" class="regen-place-reason">{{ p.reason }}</span>
                      <span v-else-if="p.zone === 'residence'" class="regen-place-tag is-zone">居住</span>
                    </label>
                  </div>
                </div>

                <label v-if="regenAreas.length" class="regen-strict">
                  <linshe-switch v-model="regenAreaStrict" size="sm" />
                  <span>硬约束 —— 每个时段的地点都不得跑出所选区域</span>
                </label>
              </section>

              <!-- ── NSFW 强度 ── -->
              <section class="regen-sec">
                <div class="regen-sec-head">
                  <span class="regen-sec-title">NSFW 强度</span>
                  <span class="regen-sec-note">{{ regenNsfwBand.label }} · 性时段 {{ regenNsfwCount }}</span>
                  <button
                    v-if="regenNsfw !== regenDefaults.nsfwRatio" type="button" class="regen-link"
                    @click="regenNsfw = regenDefaults.nsfwRatio"
                  >复位</button>
                </div>
                <linshe-slider v-model="regenNsfw" :min="0" :max="100" :step="25" />
                <div class="regen-scale">
                  <span
                    v-for="b in regenNsfwBands" :key="b.at"
                    :class="{ on: regenNsfw === b.at }"
                    @click="regenNsfw = b.at"
                  >{{ b.label }}</span>
                </div>
                <!-- ★ 实质行为数量：这是用户口径里的核心指标（0 / 0~1 / 0~2 / 1~3 / 2~5），
                     此前只显示了"性时段"数，用户看不到自己调的到底是哪一档，以为没生效。 -->
                <p class="regen-sec-note regen-nsfw-detail">
                  实质行为 <b>{{ regenExplicitText }}</b>
                  <span class="regen-nsfw-sub">（房事／口交／自慰到出／多人——角色亲自参与的那种）</span>
                </p>
                <p class="regen-sec-note">{{ regenNsfwBand.hint }}</p>
              </section>

              <!-- ── 睡眠类型 ── -->
              <section class="regen-sec">
                <div class="regen-sec-head">
                  <span class="regen-sec-title">睡眠类型</span>
                  <span class="regen-sec-note">不选「自动」即固定作息</span>
                </div>
                <linshe-select v-model="regenSleepType" :options="regenSleepOptions" size="sm" />
              </section>

              <!-- ── 移动方式（超能力移动豁免）──
                   有角色在设定上会瞬移/飞行，通勤表对ta不构成限制。默认「普通」=
                   受通勤约束，与改动前行为一致；选其他档位即豁免换场校验与台账告警。
                   档位列表来自后端 regenerate-options（单一真源），前端不另抄。 -->
              <section class="regen-sec">
                <div class="regen-sec-head">
                  <span class="regen-sec-title">移动方式</span>
                  <span class="regen-sec-note">超能力移动可豁免通勤约束</span>
                </div>
                <linshe-select v-model="regenTransitMode" :options="regenTransitOptions" size="sm" />
                <p class="regen-sec-note regen-cadence-hint" v-if="regenTransitExempt">
                  该角色将**不受通勤表限制**：跨区换场可压缩甚至瞬时完成，但生成时仍会要求交代"怎么到的"，
                  不会写成凭空出现。该选择会保存到角色资料，之后自动生成也沿用。
                </p>
              </section>

              <!-- ── 固定居家 / 睡眠地点（人类侧指定）── -->
              <section class="regen-sec">
                <div class="regen-sec-head">
                  <span class="regen-sec-title">固定住处</span>
                  <span class="regen-sec-note">钉死"回家/睡觉"的落点，避免模型每次换地方</span>
                </div>
                <div class="regen-cadence">
                  <!-- ★ 2026-10-07 用户口径：原来的单层搜索下拉"难以查找地点"（115 条平铺、
                       只有名字没有归属），改为**多级级联**、层级按地图自动匹配。
                       层级不写死：选项自带 region/area，组件只做分组收敛。 -->
                  <div class="regen-cadence-col">
                    <span class="regen-cadence-label is-block">居家地点</span>
                    <PlaceCascadeSelect
                      v-model="regenHomePlace"
                      :options="regenCadenceOptions"
                    />
                  </div>
                  <div class="regen-cadence-col">
                    <span class="regen-cadence-label is-block">睡眠地点<span class="regen-sec-note">（不选则睡在居家地点）</span></span>
                    <PlaceCascadeSelect
                      v-model="regenSleepPlace"
                      :options="regenCadenceOptions"
                    />
                  </div>
                  <p v-if="regenHomePlace" class="regen-sec-note regen-cadence-hint">
                    已指定：日程里的起床 / 回家 / 换装 / 就寝等锚点时段将固定落在
                    <b>{{ regenHomeArea ? regenHomeArea + ' · ' : '' }}{{ regenHomePlace }}</b>。
                    该选择会一并保存到角色资料，之后自动生成也沿用。
                  </p>
                </div>
              </section>
            </div>

            <div class="reset-dialog-actions">
              <linshe-button class="reset-btn-bg" variant="secondary" style="flex: 1" @click="confirmRegenerateRandom">完全随机</linshe-button>
              <linshe-button
                class="reset-btn-confirm" variant="primary"
                @click="confirmRegenerateWithDirection"
                :disabled="!regenHasAnySetting"
                :title="regenHasAnySetting ? '' : '请至少填写方向、选择区域、调整强度或指定睡眠类型'"
              >按以上设定生成</linshe-button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ 重置世界线确认弹窗 ═══ -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showResetConfirm" class="reset-overlay" @click.self="showResetConfirm = false">
          <div class="reset-dialog" @click.stop>
            <div class="reset-dialog-header">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1,4 1,10 7,10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              <span>全部重置</span>
            </div>
            <div class="reset-dialog-desc">
              <p>将重新生成全部 <b>{{ store.characters.length }}</b> 个角色的日程表。可输入方向来影响生成结果，留空则随机生成。</p>
              <linshe-input
                type="textarea"
                v-model="resetDirection"
                class="regenerate-textarea"
                placeholder="例如：今天全员的日程围绕夏日祭展开、让所有人过一天悠闲的周末..."
                rows="3"
                ref="resetDirectionTextareaRef"
                @keydown.enter.exact="confirmResetAll"
              />
            </div>
            <div class="reset-dialog-actions">
              <linshe-button class="reset-btn-bg" variant="secondary" style="flex: 1" @click="confirmResetRandom">随机日程规划</linshe-button>
              <linshe-button class="reset-btn-confirm" variant="primary" @click="confirmResetAll" :disabled="!resetDirection.trim()">按此方向生成</linshe-button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ 重置世界线进度弹窗 ═══ -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="store.resetTask && !store.resetTask.backgrounded" class="reset-overlay">
          <div class="reset-dialog reset-progress-dialog" @click.stop>
            <div class="reset-dialog-header">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" :stroke="store.resetTask.phase === 'complete' ? '#52c41a' : 'var(--accent)'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1,4 1,10 7,10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              <span>{{ store.resetTask.phase === 'complete' ? '重置完成' : store.resetTask.phase === 'cancelled' ? '已取消' : '重置世界线中...' }}</span>
            </div>

            <!-- 进度条 -->
            <div class="reset-progress-bar-wrap">
              <div class="reset-progress-bar">
                <div
                  class="reset-progress-fill"
                  :style="{ width: resetProgressPct + '%' }"
                  :class="{ done: store.resetTask.phase === 'complete', cancelled: store.resetTask.phase === 'cancelled' }"
                ></div>
              </div>
              <span class="reset-progress-text">{{ store.resetTask.current }} / {{ store.resetTask.total }}</span>
            </div>

            <!-- 当前任务 -->
            <div class="reset-current-task" v-if="store.resetTask.phase === 'running'">
              <div class="loader-ring-sm"></div>
              <span>正在生成 <b>{{ store.resetTask.currentName }}</b> 的日程...</span>
            </div>
            <div class="reset-current-task done" v-else-if="store.resetTask.phase === 'complete'">
              <span>✅ 全部 {{ store.resetTask.total }} 个角色日程已更新</span>
            </div>
            <div class="reset-current-task cancelled" v-else-if="store.resetTask.phase === 'cancelled'">
              <span>⚠️ 已取消，完成了 {{ store.resetTask.current }} / {{ store.resetTask.total }} 个角色</span>
            </div>

            <!-- 错误列表 -->
            <div v-if="store.resetTask.errors.length > 0" class="reset-errors">
              <div v-for="(e, i) in store.resetTask.errors" :key="i" class="reset-error-item">
                <span class="reset-error-name">{{ e.name }}</span>
                <span class="reset-error-msg">{{ e.error }}</span>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="reset-dialog-actions">
              <template v-if="store.resetTask.phase === 'running'">
                <linshe-button class="reset-btn-cancel" variant="secondary" @click="cancelReset" :disabled="resetCancelling">{{ resetCancelling ? '取消中...' : '取消重置' }}</linshe-button>
                <linshe-button class="reset-btn-bg" variant="secondary" @click="dismissResetProgress" :disabled="resetCancelling">后台静默生成</linshe-button>
              </template>
              <template v-else>
                <linshe-button class="reset-btn-confirm" variant="primary" @click="finishReset">完成</linshe-button>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, inject, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduleStore } from '../stores/schedule.js'
// ⚠ 2026-10-08 合并 v3.7.0：上游新增 diary store（日记本入口）、本地补丁新增 chat store（归档角色判定），
//    两者用途不同且都在本文件被调用（diaryStore.openBook / chatStore），故**一并保留**。
import { useDiaryStore } from '../stores/diary.js'
import { useChatStore } from '../stores/chat.js'
import { useSettingsStore } from '../stores/settings.js'
import { onEvent } from '../stores/unifiedStream.js'
import * as api from '../api/index.js'
import CharacterStatusCard from '../components/CharacterStatusCard.vue'
import CharacterDetailDrawer from '../components/CharacterDetailDrawer.vue'
import ImageLightbox from '../components/ImageLightbox.vue'
import GearIcon from '../components/GearIcon.vue'
import LedgerIcon from '../components/LedgerIcon.vue'
import LinsheButton from '../components/ui/LinsheButton.vue'
import { emitCharacterPinEnabled } from '../utils/characterReactionProducers.js'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import LinsheSlider from '../components/ui/LinsheSlider.vue'
import LinsheSelect from '../components/ui/LinsheSelect.vue'
import LinsheSwitch from '../components/ui/LinsheSwitch.vue'
// 固定住处的多级级联选择（大地区 → 子地区 → 地点）。层级按地图自动匹配，本文件不写死。
import PlaceCascadeSelect from '../components/ui/PlaceCascadeSelect.vue'

const store = useScheduleStore()
const diaryStore = useDiaryStore()
const settingsStore = useSettingsStore()
const router = useRouter()

const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const toastFn = inject('toast')
const confirm = inject('confirm')

// ── 时钟 ──
// ── 筛选 ──
const activeFilter = ref('all')
const searchQuery = ref('')

// ── 移动端滚动隐藏顶栏 ──
const headerVisible = ref(true)
let lastScrollTop = 0
const cardGridEl = ref<HTMLElement | null>(null)

// ── 日程设置（刷新周期） ──
const settingsOpen = ref(false)
const refreshDays = ref(1)
const savingRefreshDays = ref(false)

// ── 批量停止日程生成（全量省 token） ──
const chatStore = useChatStore()
const scheduleAllToggling = ref(false)
// 所有角色都关着才算「已停止」；部分关时开关显示为关（点一下 = 全部停掉）
const allSchedulesDisabled = computed(() =>
  chatStore.characters.length > 0 && chatStore.characters.every(c => c.schedule_enabled === 0)
)

async function toggleAllSchedules(next) {
  if (scheduleAllToggling.value) return
  scheduleAllToggling.value = true
  try {
    const r = await api.setAllCharactersScheduleEnabled(next)
    await chatStore.loadCharacters()
    toastFn(
      next
        ? `已停止 ${r?.changed ?? 0} 个角色的日程生成，之后不再消耗日程额度`
        : `已恢复 ${r?.changed ?? 0} 个角色的日程生成`,
      'success'
    )
  } catch (err) {
    toastFn('设置失败: ' + (err?.message || '未知错误'), 'error')
  } finally {
    scheduleAllToggling.value = false
  }
}

async function openSettings() {
  try {
    const cfg = await api.getConfig()
    refreshDays.value = Math.max(1, Math.min(3, cfg?.features?.scheduleRefreshDays ?? 1))
  } catch {
    // 读取失败时沿用本地值打开弹窗
  }
  settingsOpen.value = true
}

// ═══ 日程台账（长期观测：八股/稳定性/风险）═══
const ledgerOpen = ref(false)
const ledgerLoading = ref(false)
const ledgerError = ref('')
const ledgerData: any = ref({ characters: [], summary: {} })
const ledgerExpanded = ref(0)
/** 归档角色默认折叠（与左侧栏同一口径）：归档＝不参与主动行为，其日程只是历史留痕，不该占满台账 */
const ledgerShowArchived = ref(false)

const ledgerRows = computed(() => {
  let list = Array.isArray(ledgerData.value?.characters) ? [...ledgerData.value.characters] : []
  if (!ledgerShowArchived.value) list = list.filter(c => !c.character?.archived)
  return list.sort((a, b) => (b.cliche?.repeat4gram || 0) - (a.cliche?.repeat4gram || 0))
})
/** 台账里被折叠的归档角色数量（用于按钮文案，避免"点了没反应"的困惑） */
const ledgerArchivedCount = computed(() =>
  (ledgerData.value?.characters || []).filter(c => c.character?.archived).length
)

const ledgerRisk = computed(() => {
  const m = new Map<string, number>()
  for (const c of ledgerData.value?.characters || []) {
    for (const r of c.riskByCode || []) m.set(r.code, (m.get(r.code) || 0) + (r.count || 0))
  }
  return [...m.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count)
})

const RISK_LABELS: Record<string, string> = {
  'unreachable-place': '地点不可直达',
  'forbidden-place': '进入受限地点',
  'no-location': '缺少地点',
  'thin-desc': '描述过薄',
  'sleep-short': '睡眠不足',
  'sleep-long': '睡眠过长',
  'bad-time': '时间格式异常',
  'gap': '时间轴空档',
  'overlap': '时间轴重叠',
  'gap-start': '首段未接续零点',
  'teleport': '跨区无换场时间',
}
function riskLabel(code: string) { return RISK_LABELS[code] || code }
function riskTitle(code: string) {
  return ({
    'unreachable-place': '日程里出现「孤立地点」却未交代如何抵达（注：通勤表只是干线网，本项判定从严，通常不报）',
    'forbidden-place': '进入 restricted/private 的地点（角色回到自己的固定住处已豁免）',
    'no-location': '该条活动没有填写 location',
    'thin-desc': '活动描述字数过少，信息量不足',
    'sleep-short': '睡眠时长低于合理下限（<5h）',
    'sleep-long': '睡眠时长偏长（>11h）',
    'bad-time': '时间点不可解析',
    'gap': '相邻活动之间有空档',
    'overlap': '相邻活动时间重叠',
    'gap-start': '当天首段活动不是从 00:00 开始',
    'teleport': '跨区切换却没有预留通勤时间',
  } as Record<string, string>)[code] || code
}
function issueText(it: any) {
  const time = it?.startTime ? `[${it.startTime}] ` : ''
  const act = it?.activity ? `（${it.activity}）` : ''
  return `· ${time}${it?.detail || riskLabel(it?.code || '')}${act}`
}
function repeatClass(v: number) {
  if (v >= 45) return 'is-high'
  if (v >= 25) return 'is-mid'
  return 'is-low'
}

async function loadLedger() {
  ledgerLoading.value = true
  ledgerError.value = ''
  try {
    const r = await api.getScheduleLedger()
    ledgerData.value = r || { characters: [], summary: {} }
  } catch (err: any) {
    ledgerError.value = '读取失败：' + (err?.message || '未知错误')
  } finally {
    ledgerLoading.value = false
  }
}

function openLedger() {
  ledgerOpen.value = true
  ledgerExpanded.value = 0
  loadLedger()
}

async function onConfirmSettings() {
  if (savingRefreshDays.value) return
  savingRefreshDays.value = true
  try {
    await api.updateScheduleRefreshDays(refreshDays.value)
    toastFn(`日程刷新周期已设为每 ${refreshDays.value} 天一次`, 'success')
    settingsOpen.value = false
  } catch (err: any) {
    toastFn('保存失败: ' + (err.message || '未知错误'), 'error')
  } finally {
    savingRefreshDays.value = false
  }
}

function onScroll() {
  const el = cardGridEl.value
  if (!el) return

  if (isMobile) {
    const delta = el.scrollTop - lastScrollTop
    if (el.scrollTop > 60 && delta > 8) {
      headerVisible.value = false
    } else if (delta < -4) {
      headerVisible.value = true
    }
    lastScrollTop = el.scrollTop
  }
}

const filterPills = [
  { key: 'all',     label: '全部' },
  { key: 'awake',   label: '醒着' },
  { key: 'sleeping',label: '梦乡中' },
]

// ── 数据增强：解析 current_activity → _location + _behavior ──
const enrichedChars = computed(() => {
  return [...store.characters]
    // 置顶优先，组内按 display_name 首字母（中文按拼音）
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return (a.display_name || '').localeCompare(b.display_name || '', 'zh-CN')
    })
    .map(c => {
    const raw = c.current_activity || ''
    const sep = raw.indexOf(' · ')
    const location = sep > -1 ? raw.slice(0, sep) : raw
    const behavior = sep > -1 ? raw.slice(sep + 3) : raw
    const noSchedule = raw === '未设置日程'
    return {
      ...c,
      _location: noSchedule ? '未知地点' : (location || '未知地点'),
      _behavior: noSchedule ? '自由行动' : (behavior || '暂无信息'),
      _description: c._desc || (!noSchedule ? behavior : '') || (!noSchedule ? raw : '') || (noSchedule ? '没有日程，自由行动中...' : ''),
      _hasEvent: false,
      _nextActivity: null,
    }
  })
})

const filteredChars = computed(() => {
  let list = enrichedChars.value
  const q = searchQuery.value.trim().toLowerCase()
  if (q) list = list.filter(c => c.display_name?.toLowerCase().includes(q))
  if (activeFilter.value === 'awake') return list.filter(c => !c.is_sleeping || c.is_temp_woken)
  if (activeFilter.value === 'sleeping') return list.filter(c => c.is_sleeping && !c.is_temp_woken)
  return list
})

// ── 归档角色分组：默认折叠，免得几十个不参与活动的角色占满整屏 ──
const ARCHIVE_EXPANDED_KEY = 'linshe.schedule.archivedExpanded'
const archiveExpanded = ref((() => {
  try { return localStorage.getItem(ARCHIVE_EXPANDED_KEY) === '1' } catch { return false }
})())
function toggleArchiveGroup() {
  archiveExpanded.value = !archiveExpanded.value
  try { localStorage.setItem(ARCHIVE_EXPANDED_KEY, archiveExpanded.value ? '1' : '0') } catch {}
}
// 搜索时强制展开：否则搜到归档角色也看不见
const archiveGroupOpen = computed(() => archiveExpanded.value || searchQuery.value.trim() !== '')

const activeChars = computed(() => filteredChars.value.filter(c => !c.archived))
const archivedChars = computed(() => filteredChars.value.filter(c => c.archived))

// ── 选中角色 / 抽屉 ──
const drawerOpen = ref(false)
const selectedCharId = ref<number | null>(null)
const detailChar = computed(() => {
  if (!selectedCharId.value) return null
  return enrichedChars.value.find(x => x.id === selectedCharId.value) || null
})
const detailActs = ref<any[]>([])
const detailLoading = ref(false)
const detailRegenerating = ref(false)

// ── 快照 ──
const peekOpen = ref(false)
const peekBusy = ref(false)
const peekLoading = ref(false)
const peekImage = ref<string | null>(null)
const peekError = ref<string | null>(null)
const peekPrompt = ref<string | null>(null)
const peekChar = ref<any>(null)
const peekAct = ref<any>(null)
const shutterFire = ref(false) // 相机快门动画触发器
const lightboxVisible = ref(false)
const peekTooltipVisible = ref(false)
const peekTooltipX = ref(0)
const peekTooltipY = ref(0)
const peekTooltipFlip = ref(false)

const peekTooltipStyle = computed(() => {
  if (!peekTooltipVisible.value) return { display: 'none' }
  const base = { top: peekTooltipY.value + 'px' }
  if (peekTooltipFlip.value) {
    return { ...base, left: 'auto', right: (window.innerWidth - peekTooltipX.value) + 'px' }
  }
  return { ...base, left: peekTooltipX.value + 'px', right: 'auto' }
})

const lightboxDescription = computed(() => {
  return peekAct.value?.description || ''
})

// ── 重置世界线 ──
const showResetConfirm = ref(false)
const resetDirection = ref('')
const resetDirectionTextareaRef = ref<any>(null)
const resetCancelling = ref(false)

// ── 日程方向输入弹窗（含地图联动 / NSFW 强度 / 睡眠类型）──
const showRegenerateModal = ref(false)
const regenerateDirection = ref('')
const regenerateTextareaRef = ref<any>(null)

/** 弹窗选项全部来自后端 GET /schedule/regenerate-options（档位只在后端定义一份，前端不抄） */
const regenOptionsLoading = ref(false)
const regenOptionsLoaded = ref(false)
const regenAreaGroups = ref<Array<{ region: string; areas: any[] }>>([])
const regenNsfwBands = ref<any[]>([])
const regenSleepOptions = ref<any[]>([])
const regenDefaults = ref<{ nsfwRatio: number; sleepType: string }>({ nsfwRatio: 50, sleepType: 'auto' })

const regenAreas = ref<string[]>([])
const regenAreaStrict = ref(false)
const regenNsfw = ref(50)
const regenSleepType = ref('auto')
// ── 固定居家/睡眠地点（人类侧指定）──
// 让日程的"回家/睡觉"有稳定锚点，而不是每次由模型自由发挥（今天宿舍、明天酒店）。
// 候选来自 regenerate-options 的 cadenceOptions；值随生成请求带给后端，并落库到角色。
const regenCadenceOptions = ref<any[]>([])
const regenHomePlace = ref('')
const regenSleepPlace = ref('')

// ── 移动方式（超能力移动豁免）──
// 档位列表**只来自后端** regenerate-options（单一真源，前端不另抄一份）。
// 默认 'normal' = 受通勤表约束，与改动前行为一致。
const regenTransitModes = ref<any[]>([])
const regenTransitMode = ref('normal')
const regenTransitOptions = computed(() =>
  regenTransitModes.value.map((m: any) => ({ label: m.label, value: m.key }))
)
/** 是否属于豁免档位（非 normal）—— 用于显示说明文案 */
const regenTransitExempt = computed(() => regenTransitMode.value !== 'normal')

/** 选中的居家地点所属子区（随请求带给后端，注入时交代"在哪个区"） */
const regenHomeArea = computed(() =>
  regenCadenceOptions.value.find(p => p.name === regenHomePlace.value)?.area || ''
)
// ⚠ 原先这里还有 regenCadenceSelectOptions / regenSleepSelectOptions 两个"平铺下拉"的候选构造。
//   2026-10-07 用户要求改成多级级联后，分组与排序由 PlaceCascadeSelect 负责（层级按地图自动匹配），
//   这两个 computed 已无消费者 —— 已删除，避免同一件事有两份实现（项目红线 8）。

// ── 地点级排除（问题 1「排除通道」）──────────────────────
//
// 用户口径是「别 ROLL 到不合适的场景」，意图是**排除**而不是"指定要去哪"：
// 从 70 个里划掉 3 个（一次点击）远比"从 70 个里挑 5 个"工作量小，
// 而且不会把一天流水退化成打卡清单。
//
// 数据结构：{ [区域名]: [被取消勾选的地点名] }。默认全勾（含受限地点），
// 受限地点的**默认勾选态由后端给定**（`defaultChecked`）—— 后端说不可达的，前端就默认不勾，
// 用户想放行再手动勾回来（= 显式指令，后端在 forcedPlaces 里标注原因）。
const regenExcludedByArea = ref<Record<string, string[]>>({})
/** 展开到「地点级」的区域（只展开用户正在看的那个，不做全量 70 节点树） */
const regenExpandedArea = ref('')
const regenAccessLabel = ref<Record<string, string>>({})
const regenZoneLabel = ref<Record<string, string>>({})

const regenAreaHint = computed(() => {
  if (!regenAreas.value.length) return '不限 —— 按角色原设自由活动'
  const picked = regenAreaGroups.value.flatMap(g => g.areas).filter(a => regenAreas.value.includes(a.name))
  const total = picked.reduce((s, a) => s + (a.places?.length || 0), 0)
  const dropped = picked.reduce((s, a) => s + (regenExcludedByArea.value[a.name]?.length || 0), 0)
  const restricted = picked.reduce((s, a) => s + (a.places || []).filter(p => !p.defaultChecked).length, 0)
  const bits = [`已选 ${regenAreas.value.length} 个区域`]
  if (total) bits.push(`候选 ${total - dropped} 个地点`)
  if (restricted) bits.push(`其中 ${restricted} 个受限默认排除`)
  if (dropped) bits.push(`已手动排除 ${dropped} 个`)
  return bits.join(' · ')
})

const regenNsfwBand = computed(() => {
  const bands = regenNsfwBands.value
  if (!bands.length) return { label: '标准', sexCount: '3~5', hint: '' }
  let best = bands[0]
  let bestD = Infinity
  for (const b of bands) {
    const d = Math.abs(b.at - regenNsfw.value)
    if (d < bestD) { bestD = d; best = b }
  }
  return best
})
const regenNsfwCount = computed(() => {
  const n = regenNsfwBand.value?.sexCount
  return n === 0 ? '0 个' : `${n} 个`
})
/**
 * 实质行为数量文案 —— **必须与后端 `scheduleGenerator.explicitTextOf` 同口径**：
 * 有 `explicitFloor` 的档（50 标准档）只写下限「≥ 2」，其余写区间。
 * ⚠ 不能一律写成区间：50 档若显示「0~2」，用户会以为下限是 0 而调低密度，
 *   与 scheduleInst 里写死的「≥2 实质」冲突（后端也有同样的测试钉着）。
 */
const regenExplicitText = computed(() => {
  const b = regenNsfwBand.value
  if (!b) return '—'
  if (Number.isFinite(b.explicitFloor)) return `≥ ${b.explicitFloor} 个`
  const lo = Number(b.explicitMin) || 0
  const hi = Number(b.explicitMax) || 0
  return lo === hi ? `${lo} 个` : `${lo}~${hi} 个`
})
/** 有任何一项与默认不同，或填了方向 → 允许提交；全默认时禁用，避免「点了没反应」 */
const regenHasAnySetting = computed(() =>
  !!regenerateDirection.value.trim()
  || regenAreas.value.length > 0
  || regenNsfw.value !== regenDefaults.value.nsfwRatio
  || regenSleepType.value !== regenDefaults.value.sleepType
  || !!regenHomePlace.value
  || regenTransitExempt.value
  || !!regenSleepPlace.value
)

/** 展开中的区域对象（模板里直接用，别在模板里内联 flatMap 长表达式） */
const regenExpandedAreaObj = computed(() =>
  regenAreaGroups.value.flatMap(g => g.areas).find(a => a.name === regenExpandedArea.value) || null
)

function toggleArea(name: string) {
  const i = regenAreas.value.indexOf(name)
  if (i >= 0) {
    regenAreas.value = regenAreas.value.filter(x => x !== name)
    if (regenExpandedArea.value === name) regenExpandedArea.value = ''
  } else {
    regenAreas.value = [...regenAreas.value, name]
  }
}

/** 展开/收起某个区域的地点清单（下钻到地点级；一次只展开一个，避免 70 节点树） */
function toggleAreaExpand(name: string) {
  regenExpandedArea.value = regenExpandedArea.value === name ? '' : name
}

/** 某地点当前是否「会被注入」（默认勾选态由后端给，受限地点默认不勾） */
function placeChecked(area: any, p: any) {
  const ex = regenExcludedByArea.value[area.name] || []
  if (ex.includes(p.name)) return false
  return !!p.defaultChecked
}

/**
 * 勾选/取消一个地点。
 * - 默认勾选的（public）地点：取消 = **加入排除**（用户口径的"划掉不合适的那几个"）
 * - 默认不勾的（受限）地点：勾上 = **显式放行**（后端会标注原因，见 readScheduleOptions）
 */
function togglePlace(area: any, p: any) {
  const cur = placeChecked(area, p)
  const ex = [...(regenExcludedByArea.value[area.name] || [])]
  const want = !cur
  // 「排除名单」的语义是"相对默认态取反"：默认勾的进名单=排除；
  // 默认不勾的点回来时要**从名单里移除**（表示恢复默认的排除），
  // 同时记入 pickedPlaces 让后端知道"是我显式放行的"。
  if (p.defaultChecked) {
    if (!want && !ex.includes(p.name)) ex.push(p.name)
    else if (want) { const i = ex.indexOf(p.name); if (i >= 0) ex.splice(i, 1) }
  } else {
    // 受限地点：名单里的含义反过来 —— 出现 = 显式放行
    if (want && !ex.includes(p.name)) ex.push(p.name)
    else if (!want) { const i = ex.indexOf(p.name); if (i >= 0) ex.splice(i, 1) }
  }
  regenExcludedByArea.value = { ...regenExcludedByArea.value, [area.name]: ex }
}

/** 提交给后端的「排除名单」：只含**默认勾选但被取消**的地点（真正的排除） */
function buildExcludedPayload() {
  const out: Record<string, string[]> = {}
  for (const g of regenAreaGroups.value) {
    for (const a of g.areas) {
      const ex = regenExcludedByArea.value[a.name] || []
      const names = ex.filter(n => (a.places || []).some((p: any) => p.name === n && p.defaultChecked))
      if (names.length) out[a.name] = names
    }
  }
  return out
}

/** 提交给后端的「显式放行」清单：默认不勾但被用户勾上的受限地点 */
function buildPickedPayload() {
  const out: string[] = []
  for (const g of regenAreaGroups.value) {
    for (const a of g.areas) {
      if (!regenAreas.value.includes(a.name)) continue
      const ex = regenExcludedByArea.value[a.name] || []
      for (const p of (a.places || [])) {
        if (!p.defaultChecked && ex.includes(p.name)) out.push(p.name)
      }
    }
  }
  return out
}

/**
 * 记住上次选择（按角色区分），下次打开弹窗自动恢复。
 *
 * ⚠ `saveRegenPrefs` 是**整体覆盖**这个角色的记录（不是 merge）。
 *   所以任何"额外想记住的字段"必须走 `extra` 参数，**不能**在调用它前后单独写 localStorage
 *   —— 那样会被这次覆盖冲掉（2026-10-07 实测踩到：先写 direction、再调本函数，direction 直接丢）。
 */
const REGEN_LS = 'linshe.schedule.regeneratePrefs'
function loadRegenPrefs(charId: number) {
  try {
    const all = JSON.parse(localStorage.getItem(REGEN_LS) || '{}')
    return all[String(charId)] || null
  } catch { return null }
}
function saveRegenPrefs(charId: number, extra: Record<string, unknown> = {}) {
  if (!charId) return
  try {
    const all = JSON.parse(localStorage.getItem(REGEN_LS) || '{}')
    all[String(charId)] = {
      areas: regenAreas.value,
      areaStrict: regenAreaStrict.value,
      nsfwRatio: regenNsfw.value,
      sleepType: regenSleepType.value,
      transitMode: regenTransitMode.value,
      homePlace: regenHomePlace.value,
      sleepPlace: regenSleepPlace.value,
      // 额外字段（如 direction）与上面一起写入，保证不会被覆盖掉
      ...extra,
    }
    localStorage.setItem(REGEN_LS, JSON.stringify(all))
  } catch { /* 隐私模式等，忽略 */ }
}

async function ensureRegenOptions() {
  if (regenOptionsLoaded.value || regenOptionsLoading.value) return
  regenOptionsLoading.value = true
  try {
    const d = await api.getRegenerateOptions()
    regenDefaults.value = d.defaults || { nsfwRatio: 50, sleepType: 'auto' }
    regenNsfwBands.value = Array.isArray(d.nsfwBands) ? d.nsfwBands : []
    regenSleepOptions.value = Array.isArray(d.sleepTypes) ? d.sleepTypes.map((s: any) => ({ label: s.label, value: s.value })) : []
    regenCadenceOptions.value = Array.isArray(d.cadenceOptions) ? d.cadenceOptions : []
    regenTransitModes.value = Array.isArray(d.transitModes) ? d.transitModes : []
    regenAccessLabel.value = d.accessLabel || {}
    regenZoneLabel.value = d.zoneLabel || {}
    const groups: Array<{ region: string; areas: any[] }> = []
    for (const a of d.areas || []) {
      let g = groups.find(x => x.region === a.region)
      if (!g) { g = { region: a.region, areas: [] }; groups.push(g) }
      g.areas.push(a)
    }
    regenAreaGroups.value = groups
    regenOptionsLoaded.value = true
  } catch (err) {
    console.error('[schedule] 读取日程选项失败:', err)
  } finally {
    regenOptionsLoading.value = false
  }
}

watch(showRegenerateModal, (v) => {
  if (!v) return
  const charId = detailChar.value?.id
  // 每次打开先按记忆/默认复位，避免上次的角色设置串到这次
  const prefs = charId ? loadRegenPrefs(charId) : null
  regenAreas.value = prefs?.areas || []
  regenAreaStrict.value = !!prefs?.areaStrict
  regenNsfw.value = typeof prefs?.nsfwRatio === 'number' ? prefs.nsfwRatio : regenDefaults.value.nsfwRatio
  regenSleepType.value = prefs?.sleepType || regenDefaults.value.sleepType
  // 固定住处：优先用**角色资料里已存的值**（这是持久设定），其次上一次的记忆
  const dc: any = detailChar.value || {}
  regenHomePlace.value = dc.home_place || prefs?.homePlace || ''
  regenSleepPlace.value = dc.sleep_place || prefs?.sleepPlace || ''
  // 移动方式：同样以**角色资料里已存的值**为准（持久设定），其次上一次的记忆
  regenTransitMode.value = dc.transit_mode || prefs?.transitMode || 'normal'
  // ★ 2026-10-07 用户口径「重新打开没有任何已操作部分的记忆留痕」——
  //   方向输入框此前**从不恢复**（每次打开都被 onRegenerate 清空）。
  //   它是用户花时间写的正文，必须记住；只在用户**成功生成过**或**主动关闭过**时才有值，
  //   所以不会出现"上次的方向赖着不走"的困扰（点「完全随机」仍不带走它）。
  regenerateDirection.value = String(prefs?.direction || '')
  ensureRegenOptions()
  nextTick(() => regenerateTextareaRef.value?.focus())
})

/**
 * 关闭编排弹窗 —— **显式入口**（右上角关闭按钮 / Esc）。
 *
 * ★ 2026-10-07 用户口径：需要右上角关闭按钮，且抱怨"弹窗总是自己弹掉"、
 *   "重新打开没有任何已操作部分的记忆留痕"。
 *   两件事一并处理：
 *   ① 点遮罩不再关闭（见模板注释），关闭必须显式触发，避免滚轮误触；
 *   ② **关掉时把当前填写全部存进 prefs** —— 用户要的"留痕"就是这个。
 *      此前只在「按以上设定生成」路径里 saveRegenPrefs，中途关掉等于白填。
 */
function closeRegenModal() {
  const charId = detailChar.value?.id
  if (charId) {
    // ⚠ 方向必须走 extra 一起写：saveRegenPrefs 是整体覆盖，
    //   先单独写 localStorage 再调它 = 被冲掉（实测踩过）
    saveRegenPrefs(charId, { direction: regenerateDirection.value })
  }
  showRegenerateModal.value = false
}

/** 弹窗打开期间的 Esc 监听（挂在 document 上：v-if 的元素未必有焦点，@keydown.esc 不可靠） */
function onRegenEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !showRegenerateModal.value) return
  // ⚠ 下拉面板自己也用 Esc 关闭 —— 让给它，别把整个弹窗一起关掉
  if (document.querySelector('.ls-select-dropdown')) return
  closeRegenModal()
}
onMounted(() => document.addEventListener('keydown', onRegenEsc))
onUnmounted(() => document.removeEventListener('keydown', onRegenEsc))
const resetProgressPct = computed(() => {
  const rt = store.resetTask
  if (!rt || rt.total === 0) return 0
  return Math.round((rt.current / rt.total) * 100)
})

// ── 侧边栏：扫描态控制（仅真正的生成/再生时显示）──
// 首次进入页面的数据加载不再弹这块「日程生成中」面板：那只是一次读取，不是生成。
// 全部重置有自己的进度弹窗，同样不弹这里。
const sidebarScanActive = computed(() => detailRegenerating.value)
const sidebarScanContext = computed(() =>
  store.resetTask?.phase === 'running' ? 'reset' : 'single'
)

// 脉冲进度（加载/单角色再生用 interval 驱动）
const _pulseProgress = ref(0)
let _pulseTimer: ReturnType<typeof setInterval> | null = null
const sidebarScanProgress = computed(() => {
  if (store.resetTask?.phase === 'running') return resetProgressPct.value
  return _pulseProgress.value
})

watch(sidebarScanActive, (active) => {
  if (active && store.resetTask?.phase !== 'running') {
    _pulseProgress.value = 0
    _pulseTimer = setInterval(() => {
      _pulseProgress.value = (_pulseProgress.value + 1) % 96
    }, 180)
  } else {
    if (_pulseTimer) { clearInterval(_pulseTimer); _pulseTimer = null }
    _pulseProgress.value = 0
  }
})

// ── 侧边栏过渡文字轮播 ──
const sidebarTips = [
  '正在翻阅日程档案……',
  '正在校准时间轴偏差……',
  '正在推算角色行动轨迹……',
  '正在调取天气与季节数据……',
  '正在匹配角色性格与行为……',
  '正在绘制今日活动热力图……',
  '正在协调角色间互动冲突……',
  '正在查询世界观事件簿……',
  '正在排列优先级队列……',
  '正在注入随机扰动因子……',
  '正在校对昼夜节律周期……',
  '正在解析角色当日心情……',
  '正在交叉验证时间线一致性……',
  '正在向命运女神投币……',
  '正在整理待办事项清单……',
]
const currentSidebarTipIndex = ref(0)
let _sidebarTipTimer: ReturnType<typeof setInterval> | null = null

function startSidebarTips() {
  currentSidebarTipIndex.value = 0
  let idx = 0
  _sidebarTipTimer = setInterval(() => {
    idx = (idx + 1) % sidebarTips.length
    currentSidebarTipIndex.value = idx
  }, 2200)
}

function stopSidebarTips() {
  if (_sidebarTipTimer) { clearInterval(_sidebarTipTimer); _sidebarTipTimer = null }
}

watch(sidebarScanActive, (active) => {
  if (active) startSidebarTips()
  else stopSidebarTips()
}, { immediate: true })

// ── 加载文案轮播（瞄一眼弹窗用）──
const phrases = [
  '正在寻找拍摄角度……',
  '正在抓取表情……',
  '正在选择机位……',
  '正在寻找人在哪……',
  '正在翻找相机镜头……',
  '正在调整光圈参数……',
  '正在构图对焦……',
  '正在等待最佳光线……',
]
const currentPhraseIndex = ref(0)
let _phraseTimer: ReturnType<typeof setInterval> | null = null

watch(peekLoading, (loading) => {
  if (loading) {
    currentPhraseIndex.value = 0
    _phraseTimer = setInterval(() => {
      currentPhraseIndex.value = (currentPhraseIndex.value + 1) % phrases.length
    }, 3000)
  } else {
    if (_phraseTimer) { clearInterval(_phraseTimer); _phraseTimer = null }
  }
})

// ── 相机快门动画：图片到达时触发 ──
watch(peekImage, (newVal) => {
  if (newVal) {
    // 先复位再触发，确保每次图片到达都播放动画
    shutterFire.value = false
    nextTick(() => {
      requestAnimationFrame(() => {
        shutterFire.value = true
      })
    })
  } else {
    shutterFire.value = false
  }
})

// ── 进度条：模拟虚拟→ComfyUI真实接管（参照 ImageGenBubble 逻辑）──
const realPct = ref(0)       // ComfyUI 真实进度 0~100
const simulatedPct = ref(0)  // 虚拟进度 0~100
const peekProgress = computed(() => {
  if (peekImage.value) return 100 // 已有图片 = 100%
  return Math.max(Math.floor(simulatedPct.value), realPct.value)
})
let _progressTimer: ReturnType<typeof setTimeout> | null = null
let _maxedOut = false

function scheduleTick() {
  _progressTimer = setTimeout(() => {
    if (peekImage.value) { simulatedPct.value = 100; return } // 已有结果
    if (peekError.value) return
    // 真实进度已超过模拟 → 模拟暂停，等真实追上
    if (realPct.value > simulatedPct.value) { scheduleTick(); return }
    if (_maxedOut) { scheduleTick(); return }
    const inc = 1 + Math.random() * 3
    simulatedPct.value = Math.min(95, simulatedPct.value + inc)
    if (simulatedPct.value >= 95) _maxedOut = true
    scheduleTick()
  }, 400 + Math.random() * 1200)
}

function startFakeProgress() {
  stopFakeProgress()
  simulatedPct.value = 0
  realPct.value = 0
  _maxedOut = false
  scheduleTick()
}

function stopFakeProgress() {
  if (_progressTimer) { clearTimeout(_progressTimer); _progressTimer = null }
}

// ── 瞄一眼弹窗尺寸：以奇遇参数 aspect-ratio 为准，比例始终贴合，不超视口 ──
const peekBodyStyle = computed(() => {
  const ew = settingsStore.eventWidth || 1600
  const eh = settingsStore.eventHeight || 1200
  const ratio = ew / eh
  // 胶卷边 (20×2) + 底部栏 (~44) + overlay padding (20×2) ≈ 124
  const chromeH = 124
  const chromeW = 40 + 8 // overlay padding + film margin
  const vw = window.innerWidth
  const vh = window.innerHeight
  const mobile = vw < 768
  // 手机端宽度占满，桌面端留 8-12% 呼吸空间
  const availW = mobile ? vw - chromeW : vw * 0.88 - chromeW
  const availH = mobile ? vh * 0.92 - chromeH : vh * 0.88 - chromeH
  // 选更紧的约束，保证弹窗完整可见且比例不变
  let bodyW, bodyH
  if (availW / ratio <= availH) {
    bodyW = availW
    bodyH = bodyW / ratio
  } else {
    bodyH = availH
    bodyW = bodyH * ratio
  }
  return { width: `${Math.round(bodyW)}px`, height: `${Math.round(bodyH)}px` }
})

// ── 胶卷外壳与 pk-body 同宽，防止 pk-bar 文字撑开容器 ──
const peekFilmStyle = computed(() => {
  return { width: peekBodyStyle.value.width }
})

// ── 生命周期 ──
let disposed = false
const peekUnsubscribers: Array<() => void> = []
let _overviewRefreshTimer: ReturnType<typeof setInterval> | null = null

function refreshOverviewWhenVisible() {
  if (document.visibilityState !== 'visible') return
  store.fetchOverview(true)
}

onMounted(async () => {
  store.fetchOverview()
  settingsStore.loadComfyConfig()
  _overviewRefreshTimer = setInterval(refreshOverviewWhenVisible, 60_000)
  document.addEventListener('visibilitychange', refreshOverviewWhenVisible)
  window.addEventListener('focus', refreshOverviewWhenVisible)

  // 页面刷新恢复：查询后端是否有正在进行的重置任务
  try {
    const status = await api.getResetStatus()
    if (disposed) return
    if (status.active) {
      store.startResetTask(status.total)
      // 用后端返回的当前进度更新
      if (store.resetTask) {
        store.resetTask.current = status.current
        store.resetTask.total = status.total
        store.resetTask.currentName = status.currentName || ''
        // 刷新恢复后默认显示进度弹窗（非后台）
        store.resetTask.backgrounded = false
      }
    }
  } catch { /* 查询失败不阻塞 */ }

  if (disposed) return
  try {
    peekUnsubscribers.push(onEvent('schedule_peek_ready', (d: any) => {
      if (d.prompt) peekPrompt.value = d.prompt
      if (d.images?.length) { peekImage.value = d.images[0]; peekError.value = null }
      else if (d.error) { peekError.value = d.error }
      peekLoading.value = false; peekBusy.value = false
      simulatedPct.value = 100
      stopFakeProgress()
    }))
    peekUnsubscribers.push(onEvent('schedule_peek_progress', (d: any) => {
      if (d.progress != null) {
        realPct.value = d.progress
      }
    }))
  } catch { /* */ }
})
onUnmounted(() => {
  disposed = true
  for (const unsubscribe of peekUnsubscribers.splice(0)) unsubscribe()
  ++detailRequestSequence
  if (_overviewRefreshTimer) { clearInterval(_overviewRefreshTimer); _overviewRefreshTimer = null }
  document.removeEventListener('visibilitychange', refreshOverviewWhenVisible)
  window.removeEventListener('focus', refreshOverviewWhenVisible)
  if (_phraseTimer) { clearInterval(_phraseTimer); _phraseTimer = null }
  stopSidebarTips()
  if (_pulseTimer) { clearInterval(_pulseTimer); _pulseTimer = null }
})

// ── 方法 ──
function onFilter(key: string) { activeFilter.value = key }

let detailRequestSequence = 0
async function onSelectChar(id: number) {
  const sequence = ++detailRequestSequence
  const current = () => sequence === detailRequestSequence && selectedCharId.value === id && drawerOpen.value
  selectedCharId.value = id
  drawerOpen.value = true
  detailLoading.value = true
  detailActs.value = []
  try {
    const d = await store.fetchCharacterSchedule(id)
    if (current()) detailActs.value = d.activities || []
  } catch { if (current()) detailActs.value = [] }
  finally { if (current()) detailLoading.value = false }
}

function onPeek() {
  if (!detailChar.value) return
  const act = detailActs.value.find((a: any) => a.isCurrent) || detailActs.value[0]
  peekChar.value = detailChar.value
  peekAct.value = act || null
  peekImage.value = null; peekError.value = null; peekPrompt.value = null
  peekOpen.value = true; peekBusy.value = true; peekLoading.value = true
  startFakeProgress()
  store.peekSnapshot(detailChar.value.id)
}

function onPeekAt(act: any) {
  if (!detailChar.value || !act) return
  peekChar.value = detailChar.value
  peekAct.value = act
  peekImage.value = null; peekError.value = null; peekPrompt.value = null
  peekOpen.value = true; peekBusy.value = true; peekLoading.value = true
  startFakeProgress()
  store.peekSnapshot(detailChar.value.id, {
    activity: act.activity,
    location: act.location,
    replyDelay: act.replyDelay,
    snapshotPrompt: act.snapshotPrompt,
    description: act.description,
    startTime: act.startTime,
    endTime: act.endTime,
    tags: act.tags,
  })
}

async function onRegenerate() {
  if (!detailChar.value || detailRegenerating.value) return
  // ⚠ **不要**在这里清空 regenerateDirection：用户在 watch(showRegenerateModal) 里
  //   按 prefs 恢复了上次写的方向，这里清空会让"留痕"白做（2026-10-07 用户口径）。
  //   清空只发生在用户**成功发起生成**之后（见 confirmRegenerateWithDirection）。
  showRegenerateModal.value = true
}

async function doRegenerate(direction, options) {
  if (!detailChar.value || detailRegenerating.value) return
  detailRegenerating.value = true
  try {
    try { await store.regenerateSchedule(detailChar.value.id, direction, options) } catch { return }
    detailLoading.value = true
    try {
      const d = await store.fetchCharacterSchedule(detailChar.value.id)
      detailActs.value = d.activities || []
    } catch { }
    finally { detailLoading.value = false }
  } finally {
    detailRegenerating.value = false
  }
}

function regenOptionsPayload() {
  const excluded = buildExcludedPayload()
  const picked = buildPickedPayload()
  return {
    areas: regenAreas.value,
    areaStrict: regenAreaStrict.value,
    nsfwRatio: regenNsfw.value,
    sleepType: regenSleepType.value,
    // 移动方式（超能力移动豁免）：仅豁免档位才传，`normal` 不传 ——
    // 与「不设置该字段 = 上线前行为」保持一致（后端也会从角色行读，这里是本次意图）
    ...(regenTransitExempt.value ? { transitMode: regenTransitMode.value } : {}),
    // 固定居家/睡眠地点（人类侧指定）：随请求带去后端注入 + 落库到角色
    ...(regenHomePlace.value ? { homePlace: regenHomePlace.value, homeArea: regenHomeArea.value } : {}),
    ...(regenSleepPlace.value ? { sleepPlace: regenSleepPlace.value } : {}),
    // 问题 1：地点级排除（划掉不合适的那几个）
    ...(Object.keys(excluded).length ? { excludedByArea: excluded } : {}),
    // 问题 2：用户显式放行的受限地点（后端会标注原因后放行）
    ...(picked.length ? { pickedPlaces: picked } : {}),
  }
}

/**
 * 固定住处是**持久设定**（存角色资料），不是只对这一次生成有效 ——
 * 所以提交时要顺手落库，之后自动生成（调度器/新建）也沿用。
 * ⚠ 落库失败不阻断生成（和"日志写失败不阻断删除"同一取向），只提示。
 */
async function persistCadenceIfChanged() {
  const c: any = detailChar.value
  if (!c?.id) return
  const nextHome = regenHomePlace.value || ''
  const nextSleep = regenSleepPlace.value || ''
  const nextArea = regenHomeArea.value || ''
  const nextTransit = regenTransitMode.value || 'normal'
  const transitChanged = (c.transit_mode || 'normal') !== nextTransit
  if ((c.home_place || '') === nextHome && (c.sleep_place || '') === nextSleep
      && (c.home_area || '') === nextArea && !transitChanged) return
  try {
    await api.updateCharacter(c.id, {
      home_place: nextHome, sleep_place: nextSleep, home_area: nextArea,
      // 移动方式同样是**持久设定**：落库后自动生成路径也会读到（从角色行兜底）
      transit_mode: nextTransit,
    })
    // 就地更新本地对象，避免详情面板显示旧值
    c.home_place = nextHome || null
    c.sleep_place = nextSleep || null
    c.home_area = nextArea || null
    c.transit_mode = nextTransit
  } catch (err) {
    console.warn('[schedule] 保存固定住处/移动方式失败:', err)
  }
}

async function confirmRegenerateWithDirection() {
  if (!regenHasAnySetting.value) return
  const charId = detailChar.value?.id
  if (charId) saveRegenPrefs(charId)
  const direction = regenerateDirection.value.trim()
  const payload = regenOptionsPayload()
  showRegenerateModal.value = false
  // ⚠ 必须先落库再生成：生成时后端会读角色的 home_place 兜底，
  //   若"本次没传 homePlace"（典型是用户清空了选择）而库还没更到，就会注入旧值。
  await persistCadenceIfChanged()
  doRegenerate(direction || undefined, payload)
}

/** 完全随机：不加方向、不带任何约束（与功能上线前的行为一致） */
async function confirmRegenerateRandom() {
  showRegenerateModal.value = false
  doRegenerate()
}

async function onCardPeek(id: number) {
  const c = enrichedChars.value.find(x => x.id === id)
  if (!c) return
  selectedCharId.value = id
  detailActs.value = []
  try {
    const d = await store.fetchCharacterSchedule(id)
    detailActs.value = d.activities || []
  } catch { /* */ }
  const act = detailActs.value.find((a: any) => a.isCurrent) || detailActs.value[0]
  peekChar.value = detailChar.value
  peekAct.value = act || null
  peekImage.value = null; peekError.value = null; peekPrompt.value = null
  peekOpen.value = true; peekBusy.value = true; peekLoading.value = true
  startFakeProgress()
  store.peekSnapshot(id)
}

function onChat() {
  if (!detailChar.value) return
  drawerOpen.value = false
  router.push(`/chat/${detailChar.value.id}`)
}

// ── 日记：翻开 ta 的日记本（封面 / 正文 / 三张配图 / 历史翻阅都在日记本里） ──
function onOpenDiary(char: any) {
  if (!char?.id) return
  diaryStore.openBook({
    characterId: char.id,
    characterName: char.display_name || '',
    characterAvatar: char.avatar_path || '',
  })
}

// ── 卡片叫醒（镜像详情页当前按钮功能） ──
async function onCardWake(id: number) {
  const c = enrichedChars.value.find(x => x.id === id)
  if (!c) return
  const name = c.display_name || ''

  // 被上门摇醒过 → 同「怎么又睡了」
  if (c.was_door_woken) {
    toastFn(`${name}！${name}！`, 'info')
    try {
      const res = await api.wakeUpByDoor(id)
      if (res?.success) {
        await store.fetchOverview(true)
      } else {
        toastFn(res.message || '摇醒失败', 'info')
      }
    } catch (err: any) {
      toastFn('摇醒失败: ' + (err.message || '未知错误'), 'error')
    }
    return
  }

  // 三次电话未叫醒 → 同「上门摇醒」
  if ((c.wake_attempts || 0) >= 3) {
    const isFirstDoor = !c.was_door_woken
    toastFn(`${name}！${name}！`, 'info')
    if (isFirstDoor) {
      setTimeout(() => {
        toastFn(`${name}亦未寝。`, 'info')
      }, 2000)
    }
    try {
      const res = await api.wakeUpByDoor(id)
      if (res?.success) {
        await store.fetchOverview(true)
      } else {
        toastFn(res.message || '摇醒失败', 'info')
      }
    } catch (err: any) {
      toastFn('摇醒失败: ' + (err.message || '未知错误'), 'error')
    }
    return
  }

  // 默认 → 同「电话叫醒」
  try {
    const res = await api.wakeUpByPhone(id)
    if (res?.success) {
      await store.fetchOverview(true)
    } else {
      toastFn(`没叫醒${name}...`, 'info')
      if (res?.door_wake_available) {
        setTimeout(() => { toastFn(`电话打不通，试试上门找${name}吧`, 'info') }, 1200)
      }
      await store.fetchOverview(true)
    }
  } catch (err: any) {
    toastFn('叫醒失败: ' + (err.message || '未知错误'), 'error')
    await store.fetchOverview(true)
  }
}

// ── 卡片置顶 ──
async function toggleCharPin(c: any) {
  const wasPinned = !!c.pinned
  const pinned = c.pinned ? 0 : 1
  c.pinned = pinned
  // enrichedChars 是 .map() 出来的副本，必须回写 store 源对象，否则切页签后状态回退
  const src = store.characters.find((ch: any) => ch.id === c.id)
  if (src) src.pinned = pinned
  try {
    const res = await api.togglePin(c.id, pinned)
    // 只有接口确认成功、且确实从未置顶变成置顶才产生角色通知（§2.2）
    emitCharacterPinEnabled({
      characterId: c.id,
      characterName: c.display_name || c.name || '',
      wasPinned,
      pinned: !!pinned,
      ok: res?.ok === true && res?.pinned === pinned,
    })
  } catch {
    c.pinned = wasPinned ? 1 : 0
    if (src) src.pinned = wasPinned ? 1 : 0
  }
}

// ── 叫醒系统（抽屉内） ──
async function onWakePhone() {
  if (!detailChar.value) return
  const id = detailChar.value.id
  try {
    const res = await api.wakeUpByPhone(id)
    if (res.success) {
      drawerOpen.value = false
    } else {
      toastFn('没叫醒...', 'info')
    }
    await store.fetchOverview(true)
  } catch (err: any) {
    toastFn('叫醒失败: ' + (err.message || '未知错误'), 'error')
  }
}

async function onWakeDoor() {
  if (!detailChar.value) return
  const name = detailChar.value.display_name || ''
  const id = detailChar.value.id
  const isFirstDoor = !detailChar.value.was_door_woken

  toastFn(`${name}！${name}！`, 'info')
  if (isFirstDoor) {
    setTimeout(() => {
      toastFn(`${name}亦未寝。`, 'info')
    }, 2000)
  }

  try {
    const res = await api.wakeUpByDoor(id)
    if (res.success) {
      drawerOpen.value = false
      await store.fetchOverview(true)
    } else {
      toastFn(res.message || '摇醒失败', 'info')
    }
  } catch (err: any) {
    toastFn('摇醒失败: ' + (err.message || '未知错误'), 'error')
  }
}

/**
 * 清空该角色的全部日程（破坏性操作，需二次确认）。
 *
 * ★ 2026-10-07 用户口径：入口从「编排日程」弹窗头部**移到侧边栏角色日程的右上角**。
 *   原因：① 那个位置是关弹窗时最容易误点的角落，却放了个破坏性操作；
 *        ② 它是对"这个角色的整份日程"的操作，作用域属于角色面板，不属于"这次怎么生成"。
 *   ⚠ 清空后**关掉抽屉与编排弹窗**：日程已经没了，留着抽屉显示旧时间轴只会让人困惑。
 * 该函数同时服务抽屉与（保留的）旧调用点 —— 单一实现，避免两处漂移。
 */
async function onClearSchedule() {
  if (!detailChar.value) return
  const name = detailChar.value.display_name || '该角色'
  const ok = await confirm({
    title: '清空日程',
    message: `确定清空${name}的所有日程数据？\n清空后将不再自动生成日程，此操作不可撤销。`,
    danger: true,
    okText: '清空',
  })
  if (!ok) return
  showRegenerateModal.value = false
  try {
    await api.clearSchedule(detailChar.value.id)
    detailActs.value = []
    await store.fetchOverview(true)
    const idx = store.characters.findIndex(c => c.id === detailChar.value.id)
    if (idx > -1) {
      store.characters[idx].current_activity = '未设置日程'
      store.characters[idx].is_sleeping = false
    }
    drawerOpen.value = false
    toastFn?.('已清空日程')
  } catch (err: any) {
    toastFn?.('清空失败: ' + (err.message || '未知错误'))
  }
}

/** 抽屉右上角「清空日程」的入口（见 onClearSchedule 的口径说明） */
function onClearFromDrawer() {
  onClearSchedule()
}

function retryPeek() {
  if (!peekChar.value) return
  peekError.value = null; peekPrompt.value = null; peekLoading.value = true; peekBusy.value = true
  startFakeProgress()
  store.peekSnapshot(peekChar.value.id)
}

async function retakePeek() {
  if (!peekChar.value || !peekPrompt.value) return
  peekImage.value = null; peekError.value = null
  peekLoading.value = true; peekBusy.value = true
  startFakeProgress()
  try {
    await api.retakePeekSnapshot(peekChar.value.id, peekPrompt.value)
  } catch (err: any) {
    peekError.value = err.message
    peekLoading.value = false
    peekBusy.value = false
    stopFakeProgress()
  }
}

function onPeekClose() {
  peekOpen.value = false
  peekPrompt.value = null
  stopFakeProgress()
}

// ── 瞄一眼图片悬浮 description ──
function handlePeekMouseMove(e: MouseEvent) {
  const target = e.target as HTMLElement
  const overBody = target.closest('.pk-body')
  if (overBody) {
    peekTooltipY.value = e.clientY - 12
    // 靠近右边缘时翻转到光标左侧
    if (e.clientX + 18 + 340 > window.innerWidth - 20) {
      peekTooltipX.value = e.clientX - 18
      peekTooltipFlip.value = true
    } else {
      peekTooltipX.value = e.clientX + 18
      peekTooltipFlip.value = false
    }
    peekTooltipVisible.value = true
  } else {
    peekTooltipVisible.value = false
  }
}

watch(peekOpen, (v) => {
  if (v) {
    document.addEventListener('mousemove', handlePeekMouseMove)
  } else {
    document.removeEventListener('mousemove', handlePeekMouseMove)
    peekTooltipVisible.value = false
  }
})

async function regenerateAll() {
  for (const c of store.characters) {
    // regenerateSchedule 内部已静默刷新，这里不额外调 fetchOverview
    try { await store.regenerateSchedule(c.id) } catch { /* continue */ }
  }
}

function handleResetClick() {
  // 对应 is-disabled 态：重置进行中且未转后台时不可点击
  if (store.resetTask?.processing && !store.resetTask?.backgrounded) return
  // 如果后台有正在进行的重置任务，点击重新打开进度弹窗
  if (store.resetTask?.backgrounded) {
    store.showResetTask()
  } else {
    resetDirection.value = ''
    showResetConfirm.value = true
    nextTick(() => resetDirectionTextareaRef.value?.focus())
  }
}

async function confirmResetRandom() {
  resetDirection.value = ''
  await confirmResetAll()
}

async function confirmResetAll() {
  showResetConfirm.value = false
  store.startResetTask(0)

  const direction = resetDirection.value.trim() || undefined

  try {
    const result = await api.regenerateAllSchedules(direction)
    if (store.resetTask) {
      store.resetTask.total = result.total || 0
    }
  } catch (err: any) {
    if (err.message?.includes('busy') || err.message?.includes('正在进行中')) {
      toastFn('重置世界线正在进行中，请等待当前任务完成', 'warning')
    } else {
      toastFn('启动重置失败: ' + (err.message || '未知错误'), 'error')
    }
    store.finishResetTask()
  }
}

async function cancelReset() {
  if (resetCancelling.value) return
  resetCancelling.value = true
  try {
    await api.cancelRegenerateAll()
    // 立即反馈取消结果，不等 SSE（后端可能还有 in-flight LLM 调用）
    if (store.resetTask && store.resetTask.phase === 'running') {
      store.resetTask.phase = 'cancelled'
      store.resetTask.current = Math.max(0, store.resetTask.current - 1)
      store.resetTask.processing = false
      store.resetTask.backgrounded = false
    }
  } catch (err) {
    resetCancelling.value = false
    console.error('[ScheduleView] cancel reset failed:', err)
  }
}

watch(() => store.resetTask?.phase, (phase) => {
  if (phase && phase !== 'running') {
    resetCancelling.value = false
  }
})

function dismissResetProgress() {
  // 后台静默生成：关闭弹窗但不取消任务，保留在 store 中持续更新
  store.backgroundResetTask()
}

function finishReset() {
  store.finishResetTask()
  // 静默刷新，不触发 loading 闪烁
  store.fetchOverview(true)
}
</script>

<style scoped>
/* ═══ 日程台账（长期观测）═══ */
.ledger-body { display: flex; flex-direction: column; gap: 12px; min-width: min(680px, 84vw); max-height: 66vh; overflow-y: auto; }
.ledger-hint { margin: 0; font-size: 12px; line-height: 1.7; color: var(--text-secondary, #8a8a8a); }
.ledger-hint b { color: var(--text-primary, #333); }
.ledger-loading, .ledger-error { padding: 24px 0; text-align: center; font-size: 13px; color: var(--text-secondary, #8a8a8a); }
.ledger-error { color: #c0392b; }
.ledger-summary { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 10px 12px; border-radius: 10px; background: var(--bg-secondary, rgba(0,0,0,0.03)); font-size: 12.5px; color: var(--text-secondary, #666); }
.ledger-summary b { color: var(--text-primary, #222); font-variant-numeric: tabular-nums; }
.ledger-risk-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
.ledger-risk-label { color: var(--text-secondary, #888); }
.ledger-risk-chip { padding: 2px 8px; border-radius: 999px; background: rgba(192,57,43,0.10); color: #c0392b; font-variant-numeric: tabular-nums; cursor: help; }
.ledger-list { display: flex; flex-direction: column; gap: 6px; }
/* 归档角色默认折叠：给一个显式开关 + 行内「归档」标记，避免"有些角色怎么不见了" */
.ledger-filters { display: flex; align-items: center; gap: 10px; margin: 2px 0 4px; }
.ledger-archived-tag {
  flex: 0 0 auto; padding: 1px 7px; border-radius: 999px; font-size: 11px;
  background: rgba(127,127,127,0.14); color: var(--text-secondary, #888);
}
.ledger-row.is-archived { opacity: .62; }
.ledger-row.is-archived:hover { opacity: 1; }
.ledger-row { border-radius: 10px; border: 1px solid var(--border-color, rgba(0,0,0,0.08)); overflow: hidden; cursor: pointer; transition: background .15s; }
.ledger-row:hover { background: var(--bg-secondary, rgba(0,0,0,0.02)); }
.ledger-row.is-open { background: var(--bg-secondary, rgba(0,0,0,0.03)); }
.ledger-row-head { display: flex; align-items: center; gap: 12px; padding: 9px 12px; font-size: 12.5px; }
.ledger-name { flex: 0 0 88px; font-weight: 600; color: var(--text-primary, #222); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ledger-metric { color: var(--text-secondary, #777); font-variant-numeric: tabular-nums; }
.ledger-metric.is-high { color: #c0392b; font-weight: 600; }
.ledger-metric.is-mid { color: #d68910; }
.ledger-metric.is-low { color: #27ae60; }
.ledger-metric.is-na { color: var(--text-tertiary, #aaa); font-style: italic; cursor: help; }
.ledger-records { margin-left: auto; color: var(--text-tertiary, #aaa); font-variant-numeric: tabular-nums; }
.ledger-row-detail { padding: 4px 12px 12px 112px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-secondary, #666); line-height: 1.7; }
.ledger-detail-line b { color: var(--text-primary, #333); }
.ledger-dim { color: var(--text-tertiary, #999); font-size: 11px; }
.ledger-issues { display: flex; flex-direction: column; }
.ledger-issue { padding-left: 4px; color: var(--text-tertiary, #999); }
.schedule-view {
  flex: 1; display: flex; flex-direction: column;
  height: 100vh; height: 100dvh; overflow: hidden;
  background: transparent;
}

/* ── Layout: 左主体 + 右侧边栏 ── */
.sched-layout { flex: 1; display: flex; min-height: 0; overflow: hidden; position: relative; }

/* ── 左：主体内容区 ── */
.sched-main { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }

.main-topbar {
  padding: 14px 24px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
  background: var(--glass-bg);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}
.header-hidden { transform: translateY(-100%); }

.topbar-row {
  display: flex; align-items: center; justify-content: space-between;
}
.topbar-row h2 { margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--text-bright); flex-shrink: 0; white-space: nowrap; }
.topbar-row h2.is-clickable { cursor: pointer; }

.topbar-actions { display: flex; align-items: center; gap: 10px; }
.search-input {
  width: 140px; padding: 7px 12px;
}

/* 设置齿轮 — 与奇遇页 lib-gear 同款 */
.lib-gear {
  width: 34px; height: 34px; border-radius: 50%;
  border: 2px solid transparent;
  background: rgba(var(--accent-rgb), 0.08);
  color: var(--accent);
  font-size: 18px; line-height: 1;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex; align-items: center; justify-content: center;
  user-select: none;
}
.lib-gear:hover {
  border-color: rgba(var(--accent-rgb), 0.55);
  box-shadow: 0 3px 20px rgba(var(--accent-rgb), 0.10);
  transform: rotate(30deg);
}

/* 重置世界线按钮 — 和朋友圈 btn-post 同款 */
.btn-reset {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 22px;
  border-radius: 14px;
  border: 2px solid transparent;
  background: var(--grad-soft);
  background-size: 200% 200%;
  color: var(--accent);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  white-space: nowrap;
  user-select: none;
}
.btn-reset-icon { flex-shrink: 0; fill: currentColor; }
.btn-reset:hover:not(.is-disabled) {
  border: 2px solid rgba(var(--accent-rgb), 0.55);
  box-shadow: 0 3px 20px rgba(var(--accent-rgb), 0.10);
  color: #a85545;
  animation: waterflow 1s ease-in-out infinite;
}
@keyframes waterflow {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}
.btn-reset.is-disabled { opacity: 0.4; cursor: not-allowed; }
.btn-reset.is-resetting {
  border-color: rgba(var(--accent-rgb), 0.35);
  color: var(--accent);
}
.btn-reset .spinning { animation: spin 1.2s linear infinite; }

/* ── 日程设置弹窗 ── */
.sched-settings-body {
  display: flex; flex-direction: column; gap: 4px;
  padding: 4px 2px;
}
.sched-settings-slider-heading {
  display: flex; align-items: baseline; justify-content: space-between;
}
.sched-settings-slider-heading label { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
.sched-settings-value { font-size: 0.85rem; font-weight: 600; color: var(--accent); }
.sched-settings-hint { margin: 6px 0 0; font-size: 0.8rem; line-height: 1.5; color: var(--text-secondary); }
/* 批量开关（停止所有角色生成日程） */
.sched-settings-toggle-row {
  display: flex; align-items: flex-start; gap: 12px;
}
.sched-settings-toggle-text {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
}
.sched-settings-toggle-label {
  font-size: 0.9rem; font-weight: 600; color: var(--text-primary);
}
.sched-settings-toggle-text .sched-settings-hint { margin-top: 4px; }
.sched-settings-divider {
  height: 1px; margin: 14px 0;
  background: var(--glass-border);
}


/* ── Card Grid ── */
.card-grid {
  flex: 1; overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  /* 底部多留 24px：卡片下沿伸出的日记入口是绝对定位、不计入行高，不留白最后一行会被裁 */
  gap: 12px; padding: 16px 20px 40px;
  align-content: start;
}

/* ── 归档角色分类栏：横跨整行，可点击折叠 ── */
.archive-bar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 6px 0 2px;
}
.archive-bar-line {
  flex: 1;
  height: 1px;
  background: var(--glass-border);
}
.archive-bar-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: all var(--dur-fast) ease;
}
.archive-bar-label:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.archive-bar-arrow {
  flex-shrink: 0;
  transition: transform var(--dur-fast) var(--ease-standard);
}
.archive-bar.collapsed .archive-bar-arrow { transform: rotate(-90deg); }
.archive-bar-count {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.6;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--tint-subtle);
}

/* ── Placeholder ── */
.sched-placeholder {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px;
  color: var(--text-secondary);
}
.sched-placeholder p { margin: 0; font-size: 0.95rem; }
.ph-hint { font-size: 0.8rem; color: var(--text-secondary); }

.loader { width: 36px; height: 36px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.btn-glass {
  margin-top: 6px;
}

/* ═══════════════════════════════════════════
   扫描特效侧边栏（仅生成时显示）
   ═══════════════════════════════════════════ */
.sched-sidebar {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 260px;
  z-index: 10;
  border-left: 1px solid rgba(var(--accent-rgb),0.18);
  background: var(--glass-bg-strong);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: inset 0 0 60px rgba(var(--accent-rgb),0.04);
}

.sidebar-scan-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  overflow: hidden;
  z-index: 5;
}

/* ── 扫描线（酒馆同款）── */
.sidebar-scan-line {
  position: absolute;
  left: 12%; right: 12%;
  height: 2px;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(var(--accent-rgb),0.3) 15%,
    var(--accent) 50%,
    rgba(var(--accent-rgb),0.3) 85%,
    transparent 100%
  );
  animation: sidebar-scan-sweep 2.6s ease-in-out infinite;
  box-shadow: 0 0 28px rgba(var(--accent-rgb),0.55), 0 0 10px rgba(var(--accent-rgb),0.25);
  z-index: 2;
  pointer-events: none;
}

@keyframes sidebar-scan-sweep {
  0%   { top: 8%;  opacity: 0.15; }
  18%  { top: 92%; opacity: 1; }
  36%  { top: 92%; opacity: 0.15; }
  54%  { top: 8%;  opacity: 1; }
  72%  { top: 8%;  opacity: 0.15; }
  90%  { top: 92%; opacity: 0.7; }
  100% { top: 8%;  opacity: 0.15; }
}

/* ── 扫描光晕 ── */
.sidebar-scan-glow {
  position: absolute;
  left: 20%; right: 20%;
  height: 60px;
  background: radial-gradient(ellipse at center,
    rgba(var(--accent-rgb),0.12) 0%,
    rgba(var(--accent-rgb),0.04) 40%,
    transparent 70%
  );
  animation: sidebar-glow-follow 2.6s ease-in-out infinite;
  z-index: 1;
  pointer-events: none;
  filter: blur(8px);
}

@keyframes sidebar-glow-follow {
  0%   { top: 6%;  opacity: 0.2; }
  18%  { top: 70%; opacity: 0.9; }
  36%  { top: 70%; opacity: 0.2; }
  54%  { top: 6%;  opacity: 0.9; }
  72%  { top: 6%;  opacity: 0.2; }
  90%  { top: 70%; opacity: 0.6; }
  100% { top: 6%;  opacity: 0.2; }
}

/* ── 扫描文字内容区 ── */
.sidebar-scan-content {
  position: relative; z-index: 3;
  display: flex; flex-direction: column;
  align-items: center; gap: 10px;
  padding: 24px 20px;
  text-align: center;
}

/* ── 环形进度 ── */
.sidebar-scan-icon {
  position: relative; width: 72px; height: 72px;
  margin-bottom: 4px;
}
.sidebar-scan-ring {
  width: 72px; height: 72px;
  transform: rotate(-90deg);
}
.sidebar-scan-ring-fill {
  transition: stroke-dashoffset 0.5s ease;
}
.sidebar-scan-pct {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 17px; font-weight: 700;
  color: var(--accent);
}

/* ── 状态标签 ── */
.sidebar-scan-label {
  font-size: 13px; font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.08em;
  animation: sidebar-label-pulse 1.4s ease-in-out infinite;
}

@keyframes sidebar-label-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 1; }
}

/* ── 过渡文字轮播 ── */
.sidebar-scan-phrase {
  position: relative;
  min-height: 22px;
  display: flex; align-items: center; justify-content: center;
  width: 100%;
}
.sidebar-scan-phrase p {
  margin: 0; font-size: 0.82rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* ── 副标题/进度详情 ── */
.sidebar-scan-sub {
  font-size: 0.73rem; color: var(--text-secondary);
  line-height: 1.5;
  margin-top: 2px;
}
.sidebar-scan-sub b { color: var(--text-secondary); font-weight: 600; }
.sidebar-scan-count {
  display: block; font-size: 0.7rem;
  color: var(--text-secondary); margin-top: 2px;
}

/* ── Peek Modal ── */
.peek-overlay {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(0,0,0,0.3); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.peek-dialog { display: none; } /* 保留旧类名避免报错，新样式见 .peek-film */
.peek-film {
  width: fit-content; max-width: 90vw; max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 52px rgba(0,0,0,0.4);
}

/* ── 胶卷上下黑边 + 白色矩形齿孔 ── */
.pk-film-edge {
  height: 20px; flex-shrink: 0;
  background: #111;
  position: relative;
  overflow: hidden;
}
.pk-film-edge::before {
  content: '';
  position: absolute;
  top: 4px; bottom: 4px; left: 11px; right: 11px;
  /* 白色矩形齿孔：8px宽 间距14px */
  background: repeating-linear-gradient(
    90deg,
    rgba(255,255,255,0.88) 0px,
    rgba(255,255,255,0.88) 8px,
    transparent 8px,
    transparent 22px
  );
}
/* ── 底部信息栏（原 pk-top + footer 合并）── */
.pk-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-secondary); flex-shrink: 0;
  position: relative;
}
.pk-char { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pk-char-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--accent-solid); flex-shrink: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.pk-char-avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }
.pk-char-avatar-text { color: var(--on-accent); font-size: 13px; font-weight: 600; line-height: 1; user-select: none; }
.pk-char b { display: block; font-size: 0.85rem; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-char span { font-size: 0.72rem; color: var(--text-secondary); }
.pk-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.pk-body { flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: #111; overflow: hidden; }

/* ═══ 相机快门动画 ═══ */
.pk-shutter-stage {
  position: relative; width: 100%; height: 100%;
  overflow: hidden;
}
/* ── 白色闪光（模拟闪光灯）── */
.pk-shutter-flash {
  position: absolute; inset: 0; z-index: 10;
  background: #fff;
  opacity: 0; pointer-events: none;
}
.pk-shutter-fire .pk-shutter-flash {
  animation: shutter-flash 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes shutter-flash {
  0%   { opacity: 0.85; }
  45%  { opacity: 0.6; }
  100% { opacity: 0; }
}

/* ── 快门帘幕（双帘式焦平面快门）── */
.pk-shutter-curtain {
  position: absolute; left: 0; right: 0; z-index: 9;
  height: 51%; /* 略超 50% 防漏缝 */
  background: linear-gradient(180deg,
    #1a1a1a 0%,
    #2a2a2a 30%,
    #1a1a1a 100%
  );
  pointer-events: none;
}
.pk-curtain-top {
  top: 0;
  transform-origin: top center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
.pk-curtain-bottom {
  bottom: 0;
  transform-origin: bottom center;
  box-shadow: 0 -2px 8px rgba(0,0,0,0.5);
}

.pk-shutter-fire .pk-curtain-top {
  animation: shutter-open-top 0.38s 0.04s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}
.pk-shutter-fire .pk-curtain-bottom {
  animation: shutter-open-bottom 0.38s 0.04s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}

@keyframes shutter-open-top {
  0%   { transform: scaleY(1); }
  100% { transform: scaleY(0); }
}
@keyframes shutter-open-bottom {
  0%   { transform: scaleY(1); }
  100% { transform: scaleY(0); }
}

.pk-wait { text-align: center; padding: 32px 24px; color: var(--text-secondary); }
.pk-wait p { margin: 10px 0 0; font-size: 0.85rem; }

/* 加载文案轮播容器 */
.pk-wait-phrase {
  position: relative;
  min-height: 24px;
  display: flex; align-items: center; justify-content: center;
}
.pk-wait-phrase p {
  margin: 10px 0 0; font-size: 0.88rem;
  white-space: nowrap;
}

/* phrase 过渡动画：上浮消失 + 从下方浮入 */
.phrase-enter-active,
.phrase-leave-active {
  transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.phrase-leave-to {
  transform: translateY(-14px);
  opacity: 0;
}
.phrase-enter-from {
  transform: translateY(14px);
  opacity: 0;
}
.pk-wait span { font-size: 0.73rem; color: var(--pk-hint); }
.loader-ring { width: 36px; height: 36px; margin: 0 auto; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
/* 环形进度条（参照 ImageGenBubble） */
.pk-ring-container { position: relative; width: 80px; height: 80px; margin: 0 auto 8px; }
.pk-ring { width: 80px; height: 80px; transform: rotate(-90deg); }
.pk-ring-progress { transition: stroke-dashoffset 0.4s ease; }
.pk-ring-pct {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 16px; font-weight: 600; color: var(--accent);
}
.pk-err { text-align: center; padding: 36px; }
.pk-err p { color: var(--danger); margin: 0 0 4px; font-size: 0.9rem; }
.pk-err span { display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 12px; }
.pk-img { width: 100%; height: 100%; object-fit: contain; display: block; cursor: pointer; }
.pk-retake-btn {
  gap: 5px;
  padding: 6px 16px;
  white-space: nowrap;
}

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-active .peek-film, .modal-leave-active .peek-film { transition: transform 0.2s cubic-bezier(0.4,0,0.2,1); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .peek-film { transform: scale(0.95) translateY(10px); }
.modal-leave-to .peek-film { transform: scale(0.95) translateY(10px); }

/* ── 重置世界线弹窗 ── */
.reset-overlay {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(0,0,0,0.3); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.reset-dialog {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 16px; width: 100%; max-width: 440px;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,0,0,0.1);
}
.reset-progress-dialog { max-width: 460px; }
.reset-dialog-header {
  display: flex; align-items: center; gap: 10px;
  padding: 18px 20px 14px;
  font-size: 1rem; font-weight: 700; color: var(--text-bright);
}
.reset-dialog-desc {
  margin: 0; padding: 0 20px;
  font-size: 0.88rem; color: var(--text-secondary); line-height: 1.6;
}
.reset-dialog-desc p {
  margin: 0 0 10px;
}

/* ── 日程方向输入弹窗 ── */
.regenerate-textarea {
  width: 100%;
  padding: 10px 12px;
  box-sizing: border-box;
}

/* ── 编排日程弹窗（含地图联动 / NSFW / 睡眠类型）── */
.regen-dialog {
  max-width: 520px;
  max-height: min(86vh, 760px);
  display: flex;
  flex-direction: column;
}
/* 内容区独立滚动：开关一多时不能把「生成」按钮顶出视口 */
.regen-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 4px;
}
.regen-sec {
  padding: 14px 20px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.regen-sec + .regen-sec { border-top: 1px solid var(--glass-border); margin-top: 14px; }
.regen-sec-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.regen-sec-title {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--text-bright);
}
.regen-sec-note {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
/* 固定住处（居家/睡眠地点）—— ★ 2026-10-07 改为多级级联（大地区→子地区→地点），
   每级一行竖排；标题改为块级小标签。原来的横向 row 布局已由级联组件内部承担。 */
.regen-cadence { display: flex; flex-direction: column; gap: 12px; }
.regen-cadence-col { display: flex; flex-direction: column; gap: 6px; }
.regen-cadence-label {
  flex: 0 0 64px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.regen-cadence-label.is-block { flex: none; font-weight: 600; color: var(--text-primary); }
.regen-cadence-hint { line-height: 1.6; }
.regen-cadence-hint b { color: var(--text-primary); }
.regen-sec-empty {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.regen-link {
  margin-left: auto;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  font-size: var(--fs-xs);
  color: var(--accent);
  text-decoration: underline;
}
.regen-link:hover { color: var(--accent-hover); }

/* 区域选择 */
.regen-area-groups { display: flex; flex-direction: column; gap: 10px; }
.regen-area-group { display: flex; flex-direction: column; gap: 6px; }
.regen-area-region {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  font-weight: 600;
  letter-spacing: .04em;
}
.regen-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.regen-chip {
  padding: 3px 11px;
  border-radius: var(--radius-full);
  border: var(--border);
  background: var(--glass-bg);
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
}
.regen-chip:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
.regen-chip.on {
  background: color-mix(in srgb, var(--accent-3) 16%, transparent);
  border-color: color-mix(in srgb, var(--accent-3) 55%, transparent);
  color: var(--text-primary);
  font-weight: 600;
}
.regen-strict {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  cursor: pointer;
}

.regen-nsfw-detail { margin-top: 4px; }
.regen-nsfw-detail b { color: var(--text-primary); }
.regen-nsfw-sub { opacity: .75; }

/* ── 地点级排除（下钻）── */
.regen-chip-sub {
  opacity: .78;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.regen-chip-n {
  font-size: 10px;
  opacity: .75;
  font-variant-numeric: tabular-nums;
}
.regen-places {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: var(--border);
  background: var(--surface-2, var(--glass-bg));
}
.regen-places-hint {
  margin: 0 0 8px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  line-height: 1.5;
}
.regen-place-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  max-height: 190px;
  overflow-y: auto;
}
.regen-place {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  color: var(--text-primary);
  cursor: pointer;
  padding: 2px 8px 2px 4px;
  border-radius: var(--radius-full);
  border: var(--border);
  background: var(--glass-bg);
}
.regen-place input { cursor: pointer; margin: 0; }
/* 已划掉（= 排除）：整条压暗并划线，一眼看出"这个不会去" */
.regen-place.off {
  opacity: .48;
}
.regen-place.off .regen-place-name { text-decoration: line-through; }
.regen-place-tag {
  font-size: 10px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--accent-3) 12%, transparent);
  color: var(--text-secondary);
}
.regen-place-tag.is-zone {
  background: color-mix(in srgb, var(--accent-1, var(--accent-3)) 16%, transparent);
}
.regen-place-reason {
  font-size: 10px;
  color: var(--text-tertiary, var(--text-secondary));
  font-style: italic;
}

/* NSFW 刻度 */
.regen-scale {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.regen-scale span { cursor: pointer; padding: 2px 4px; border-radius: var(--radius-sm); }
.regen-scale span:hover { color: var(--text-primary); }
.regen-scale span.on { color: var(--accent); font-weight: 700; }

.reset-dialog-actions {
  display: flex; gap: 12px; padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}
.reset-btn-cancel {
  flex: 1;
}
.reset-btn-confirm {
  flex: 1;
}
.reset-btn-bg {
  flex: 1;
}
/* 右上角关闭（原为垃圾桶"清空日程"，2026-10-07 用户要求换成关闭） */
.reset-header-close {
  margin-left: auto;
}

/* 进度条 */
.reset-progress-bar-wrap {
  display: flex; align-items: center; gap: 12px;
  padding: 0 20px 14px;
}
.reset-progress-bar {
  flex: 1; height: 8px;
  border-radius: 4px; background: var(--bg-hover);
  overflow: hidden;
}
.reset-progress-fill {
  height: 100%; border-radius: 4px;
  background: var(--accent);
  transition: width 0.3s ease;
}
.reset-progress-fill.done { background: var(--success); }
.reset-progress-fill.cancelled { background: var(--warning); }
.reset-progress-text {
  font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);
  min-width: 60px; text-align: right;
}

/* 当前任务 */
.reset-current-task {
  display: flex; align-items: center; gap: 10px;
  padding: 0 20px 10px;
  font-size: 0.85rem; color: var(--text-secondary);
}
.reset-current-task b { color: var(--text-bright); }
.reset-current-task.done { color: var(--success); }
.reset-current-task.cancelled { color: var(--warning); }
.loader-ring-sm {
  width: 18px; height: 18px;
  border: 2px solid var(--border); border-top-color: var(--accent);
  border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0;
}

/* 错误列表 */
.reset-errors {
  margin: 0 20px 6px; padding: 10px 12px;
  background: color-mix(in srgb, var(--danger) 5%, transparent); border-radius: 10px;
  max-height: 120px; overflow-y: auto;
}
.reset-error-item {
  display: flex; gap: 8px; padding: 3px 0;
  font-size: 0.78rem;
}
.reset-error-name { color: var(--danger); flex-shrink: 0; font-weight: 600; }
.reset-error-msg { color: var(--text-secondary); word-break: break-all; }

/* ── Responsive ── */
@media (max-width: 767px) {
  .schedule-view { position: relative; }
  .main-topbar {
    padding: 12px 16px;
    position: absolute; top: 0; left: 0; right: 0; z-index: 20;
  }
  .topbar-row h2 { font-size: 1rem; }
  .topbar-row { gap: 8px; }
  .topbar-actions { flex: 1; min-width: 0; justify-content: flex-end; gap: 6px; }
  .search-input {
    width: 64px;
    min-width: 0;
    flex: 0 1 64px;
    transition: width 0.3s var(--ease-standard), flex-basis 0.3s var(--ease-standard);
  }
  .search-input:focus { width: 180px; flex-basis: 180px; }
  .topbar-actions .lib-gear { flex-shrink: 0; }
  .topbar-actions .btn-reset { flex-shrink: 0; padding: 8px 10px; }
  .card-grid {
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 8px; padding: 80px 10px 8px;
  }
  .peek-film { max-width: 94vw; border-radius: 4px; }
  .reset-dialog { max-width: 94vw; border-radius: 12px; }

  /* 移动端 retake 按钮：仅图标 + 定位 pk-bar 右端 */
  .pk-retake-label { display: none; }
  .pk-retake-btn {
    position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
    padding: 7px 7px;
  }
  .pk-bar { padding-right: 80px; }

  /* 移动端：扫描面板缩为底部横条（绝对定位，不挤压 card-grid）*/
  .sched-sidebar {
    top: auto; left: 0; right: 0; bottom: 0;
    width: 100%; max-height: 130px;
    border-left: none; border-top: 1px solid rgba(var(--accent-rgb),0.18);
  }
  .sidebar-scan-ring { width: 56px; height: 56px; }
  .sidebar-scan-icon { width: 56px; height: 56px; }
  .sidebar-scan-pct { font-size: 14px; }
  .sidebar-scan-content { flex-direction: row; flex-wrap: wrap; gap: 6px 14px; padding: 14px 16px; }
  .sidebar-scan-label { font-size: 12px; }
  .sidebar-scan-phrase p { font-size: 0.75rem; }
  .sidebar-scan-sub { font-size: 0.7rem; width: 100%; text-align: center; }
  .sidebar-scan-count { display: inline; }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .card-grid { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
  /* 平板端：sidebar 收窄 */
  .sched-sidebar { width: 220px; }
}

@media (min-width: 1024px) {
  .card-grid { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
}
</style>

<style>
/* lightbox 层级已由 ImageLightbox.vue 统一接管（--vel-z-index，默认 9998 高于 peek-overlay 1100） */

/* ── 瞄一眼图片悬浮 description 提示框（z-index 高于 peek-overlay 1100）── */
.lightbox-tooltip {
  position: fixed;
  z-index: 1150;
  max-width: 340px;
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: #f0e8e0;
  font-size: 0.85rem;
  line-height: 1.65;
  border-radius: 10px;
  pointer-events: none;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}

.lbtip-enter-active,
.lbtip-leave-active {
  transition: opacity 0.18s ease;
}
.lbtip-enter-from,
.lbtip-leave-to {
  opacity: 0;
}
</style>
