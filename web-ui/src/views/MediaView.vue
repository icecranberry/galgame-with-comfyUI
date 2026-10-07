<template>
  <div class="media-view">
    <!-- 顶栏 -->
    <div class="media-header">
      <!-- 移动端：侧栏入口。
           原先靠「传媒」标题点击唤出，标题去掉后改成一个图标按钮，
           否则手机上这一页就没有回导航的路了。 -->
      <linshe-button
        v-if="isMobile"
        variant="icon"
        class="btn-mobile-back"
        title="导航"
        @click="toggleMobileSidebar?.()"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </linshe-button>

      <!-- 分类分页：占原来「传媒」标题的位置。
           报刊类不混进「社交平台」（社交平台 = 瀑布流帖子流）——
           《邻舍日报》是整版报纸、周刊/海报是按期出刊，三者形态完全不同，
           混在一个流里既乱又难找。 -->
      <div class="cat-bar" role="tablist" aria-label="内容分类">
        <button
          v-for="c in CATEGORIES"
          :key="c.key"
          type="button"
          role="tab"
          :aria-selected="activeCategory === c.key"
          class="cat-tab"
          :class="{ active: activeCategory === c.key }"
          :title="c.hint"
          @click="onCategoryChange(c.key)"
        >
          <span class="cat-icon">{{ c.icon }}</span>{{ c.label }}
          <span class="cat-num">{{ categoryCount(c.key) }}</span>
        </button>
      </div>

      <div class="header-right">
        <span class="media-count" v-if="total > 0">共 {{ total }} 帖</span>
        <!-- ⚠ 这里原本有个「自动 · xx」chip（点开就地调自动抓帖频率）。
             2026-10-05 已搬到「设置 → 功能开关」：它是常驻配置（决定后台夜里要不要自己抓内容），
             不是内容页的操作按钮；模型也改成「每晚几批 + 夜间窗口内错峰随机」，
             正好和设置页的「朋友圈发帖频率」并排，两个频率一起看更直观。 -->
        <linshe-button class="btn-op" variant="secondary" @click="showSettings = true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
          </svg>媒体设置
        </linshe-button>

        <!-- 批量操作：原先单独占一行（在分类/板块栏下面），和「媒体设置」挤成两处、
             顶部显得很乱。现在并进右上角按钮区，紧挨「媒体设置」——
             未进入批量模式时只是一个同尺寸的按钮，不再多占一行。
             用 linshe-button 而不是裸 button，保证与旁边的「媒体设置」尺寸皮肤完全一致。 -->
        <linshe-button
          v-if="!batchMode"
          variant="secondary"
          :disabled="!posts.length"
          :title="posts.length ? '勾选多条内容后批量重新生图或删除' : '当前没有可操作的内容'"
          @click="enterBatchMode"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px">
            <rect x="3" y="4" width="4" height="4" rx="1"/><path d="M11 6h10"/>
            <rect x="3" y="14" width="4" height="4" rx="1"/><path d="M11 16h10"/>
          </svg>
          批量操作
        </linshe-button>
        <!-- 刷新：分裂按钮。
             主按钮 = 刷新**当前范围**（选中某个媒体就只刷它，选「全部」则随机抽一个）；
             右侧箭头 = 展开面板，**直接指定要刷新的那个媒体**。
             两种形态的产物格式差别很大，所以面板里逐个媒体列出，避免刷错源头。 -->
        <!-- 数字报刊形态：顶栏换成「出刊」——
             对期刊型媒体来说"刷新一批帖子"没有意义，真正要做的是「出一刊」。
             当天已出过不会重复出（后端直接返回那一期），会提示并允许再加刊。 -->
        <linshe-button
          v-if="activeIsPeriodical"
          class="btn-refresh" variant="primary" :loading="publishing"
          :title="`出一刊：《${outletNameOf(activeOutlet)}》`"
          @click="onPublish"
        >
          <svg v-if="!publishing" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px">
            <path d="M4 19V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14"/><path d="M4 19h16"/><path d="M8 7h6M8 11h6"/>
          </svg>{{ publishing ? '出刊中…' : '出刊' }}
        </linshe-button>

        <div v-if="!activeIsPeriodical" class="refresh-group">
          <linshe-button
            class="btn-refresh" variant="primary" :loading="refreshing"
            :disabled="noOutletInScope"
            :title="refreshScopeHint"
            @click="onRefresh"
          >
            <svg v-if="!refreshing" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px">
              <polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>{{ refreshing ? '刷新中…' : '刷新' }}
          </linshe-button>
          <button
            type="button"
            class="refresh-caret"
            :class="{ active: refreshOpen }"
            title="指定要刷新的媒体"
            aria-label="指定要刷新的媒体"
            @click="refreshOpen = !refreshOpen"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6,9 12,15 18,9"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 刷新目标面板：就地展开在顶栏下方（与频率面板同一模式，不引弹层定位问题） -->
    <Transition name="freq">
      <div v-if="refreshOpen" class="freq-panel refresh-panel">
        <p class="rp-title">刷新哪个媒体？</p>
        <div class="rp-list">
          <button type="button" class="rp-item" :disabled="refreshing" @click="onRefreshOutlet(null)">
            <span class="rp-icon">🎲</span>
            <span class="rp-main">
              <span class="rp-name">当前分类随机</span>
              <span class="rp-hint">在「{{ activeCategoryLabel }}」里抽一个抓一批</span>
            </span>
          </button>
          <button
            v-for="o in filteredOutlets" :key="o.id"
            type="button" class="rp-item"
            :class="{ current: activeOutlet === o.id }"
            :disabled="refreshing"
            @click="onRefreshOutlet(o.id)"
          >
            <span class="rp-icon">{{ o.icon || '📄' }}</span>
            <span class="rp-main">
              <span class="rp-name">{{ o.name }}</span>
              <span class="rp-hint">{{ outletLayoutLabel(o) }}</span>
            </span>
            <span v-if="activeOutlet === o.id" class="rp-tag">当前</span>
          </button>
        </div>
        <p v-if="!filteredOutlets.length" class="rp-empty">当前分类下没有可刷新的媒体</p>
      </div>
    </Transition>

    <!-- 媒体标签 + 批量操作条：**同一行**显示。
         标签靠左（可横向滚动），批量操作整条**靠右**，与「全部 / 网络热门」等标签平齐 ——
         此前它单独占一行且左对齐，夹在板块栏下面显得很突兀。 -->
    <div class="outlet-row">
    <div class="outlet-bar">
      <!-- 「官方传媒」分类**额外多**一张《邻舍日报》入口卡：
           日报不存 media_outlets（有自己独立的整版排版：报头/三栏/期号切换），
           所以只能做成入口按钮，点开就是原来的报纸界面。
           ★ 注意这里是"额外多一张"，不是"只显示这一张" —— 该分类下还可能有海报类媒体，
             它们要照常出现在下面的媒体标签里。 -->
      <button
        v-if="isPrintCategory"
        type="button"
        class="outlet-tab is-newspaper"
        title="《邻舍日报》· 每天零点印发"
        @click="showNewspaper = true"
      >
        <span class="outlet-icon">📰</span>邻舍日报
        <span v-if="newspaperUnread" class="outlet-dot" aria-label="今天的报纸还没读"></span>
      </button>

      <button
        type="button"
        class="outlet-tab"
        :class="{ active: activeOutlet === null }"
        @click="onOutletChange(null)"
      >全部<span class="outlet-num">{{ categoryTotal }}</span></button>
      <button
        v-for="o in filteredOutlets"
        :key="o.id"
        type="button"
        class="outlet-tab"
        :class="{ active: activeOutlet === o.id }"
        :title="o.tagline || o.name"
        @click="onOutletChange(o.id)"
      >
        <span v-if="o.icon" class="outlet-icon">{{ o.icon }}</span>{{ o.name }}
        <!-- 形态标记：按期出刊的形态标出来（门户=刊 / 海报=报），一眼区分产物 -->
        <span
          v-if="isDigitalOutlet(o) || isPrintOutlet(o)"
          class="outlet-kind"
          :class="isPrintOutlet(o) ? 'is-poster' : 'is-weekly'"
        >{{ isPrintOutlet(o) ? '报' : '刊' }}</span>
        <span class="outlet-num">{{ o.post_count }}</span>
      </button>
    </div>

      <!-- 批量模式的操作条：与媒体标签**同一行、整条靠右**。
           入口按钮在右上角「媒体设置」旁；未进入批量模式时这块完全不渲染。
           （不用 spacer 做两端分布 —— 用户要的是整条贴右，与上方标签行右端对齐。） -->
      <div v-if="batchMode" class="list-toolbar">
        <span class="batch-count">已选 <b>{{ selectedPostIds.size }}</b> 项</span>
        <button type="button" class="batch-btn" :disabled="batchBusy" @click="selectAllVisible">
          {{ allVisibleSelected ? '取消全选' : '全选本页' }}
        </button>
        <button type="button" class="batch-btn" :disabled="batchBusy" @click="exitBatchMode">退出</button>
        <button
          v-if="categoryHasImages"
          type="button" class="batch-btn"
          :disabled="batchBusy || !regenerableSelectedIds.length"
          :title="regenerableSelectedIds.length
            ? '把这些内容的旧配图清掉并重新排队生成'
            : '选中的内容都没有配图（纯文字版面），无需重新生图'"
          @click="batchRegenerate"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
          </svg>
          重新生图
        </button>
        <button
          type="button" class="batch-btn is-danger"
          :disabled="batchBusy || !selectedPostIds.size"
          @click="batchDelete"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          删除{{ selectedPostIds.size ? ` ${selectedPostIds.size}` : '' }}
        </button>
      </div>
    </div>

    <!-- 期号导航（数字报刊 / 海报 / 旧周刊共用）—— 与《邻舍日报》的期号切换同口径：
         最新在前，点某期只看那一期；括号里是「已写块数/总块数」，一眼看出哪期是完整的。
         ★ 位置固定在**媒体标签行正下方、《邻舍日报》入口卡之前**，与「数字报刊」分类的口径完全一致。
           「官方传媒」里曾经它排在日报卡之下，那会带来两个问题：
             ① 比另一档松散（数字报刊那边期号导航紧跟标签行）；
             ② 日报卡横在中间，容易被读成"这是日报的期号" —— 它其实标的是**当前选中的刊物**
                （如《狸狸八卦》），与日报无关。
           （日报卡的形态说明已并进它的副标题行，见下方 np-entry 注释，不再占独立一行。） -->
    <div v-if="activeIsPeriodical && issues.length" class="issue-bar">
      <linshe-button variant="chip" :active="!activeIssueId" @click="activeIssueId = null">
        最新<span class="board-count">{{ issues.length }} 期</span>
      </linshe-button>
      <linshe-button
        v-for="it in issues"
        :key="it.post_id"
        variant="chip"
        :active="activeIssueId === it.post_id"
        :title="it.title"
        @click="activeIssueId = activeIssueId === it.post_id ? null : it.post_id"
      >{{ issueChipLabel(it) }}</linshe-button>
    </div>

    <!-- 传统报纸：只有一个《邻舍日报》，内容是整版报纸不在帖子流里 —— 给张入口卡.
         ★ 形态说明（"整版报纸…不按帖子流展示"）与副标题**同排**，紧贴在它右侧、基线平齐。
           它原先独占卡片下方一整行，把版式撑得比「数字报刊」松散 —— 收进副标题行后，
           整个「官方传媒」区块的纵向节奏与数字报刊对齐。 -->
    <div v-if="isPrintCategory" class="np-entry-wrap">
      <button type="button" class="np-entry" @click="showNewspaper = true">
        <span class="np-entry-icon">📰</span>
        <span class="np-entry-main">
          <span class="np-entry-title">
            邻舍日报
            <span v-if="newspaperUnread" class="outlet-dot" aria-label="今天的报纸还没读"></span>
          </span>
          <span class="np-entry-subline">
            <span class="np-entry-sub">二相乐园唯一持牌报纸 · 每天零点由镇口公告站印发</span>
            <span class="np-entry-hint">《邻舍日报》是整版报纸（报头 / 三栏排版 / 人物特稿 / 期号切换），不按帖子流展示。</span>
          </span>
        </span>
        <span class="np-entry-go">阅读本期 ›</span>
      </button>
    </div>

    <!-- 板块筛选（选中某个媒体后才出现）。
         论坛/图库两档各自在版式内带了分区导航，这里不再重复出一条。 -->
    <div v-if="boards.length && !activeIsPeriodical && !isForumCategory && !isGalleryCategory && !isPhotosCategory" class="board-bar">
      <linshe-button
        v-for="b in boardChips"
        :key="b.id ?? 'all'"
        variant="chip"
        :active="activeBoard === b.id"
        @click="onBoardChange(b.id)"
      >
        <span class="board-label">{{ b.name }}</span>
        <span class="board-count">{{ b.post_count }}</span>
      </linshe-button>
    </div>

    <!-- ── 周刊 / 海报：全宽版式，不参与瀑布流列布局 ──
         （选中这类媒体时 feedPosts 为空，页面上就只有下面这一块） -->
    <div v-if="specialPosts.length" class="special-list">
      <div
        v-for="p in specialPosts" :key="p.id"
        class="special-wrap"
        :class="[`is-${postKind(p)}`, { 'is-selecting': batchMode, 'is-picked': selectedPostIds.has(p.id) }]"
      >
        <!-- 批量模式：整幅版式外左侧一个勾选行（版式本身不适合在图上贴勾选框） -->
        <button
          v-if="batchMode"
          type="button"
          class="special-pick"
          :class="{ on: selectedPostIds.has(p.id) }"
          @click="togglePick(p.id)"
        >
          <span class="pick-box" :class="{ on: selectedPostIds.has(p.id) }" aria-hidden="true">
            <svg v-if="selectedPostIds.has(p.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </span>
          <span class="special-pick-title">{{ p.title || kindLabel(p) }}</span>
        </button>
        <component
          :is="componentFor(p)"
          :post="p"
          @zoom="zoomSrc = $event"
          @section-loaded="onSectionLoaded"
          @section-error="onSectionError"
        />
        <!-- 周刊/海报是整幅版式，不适合在图上贴按钮 → 操作放在版式下方 -->
        <div class="special-ops">
          <linshe-button
            v-if="canRegenerate(p)"
            size="sm" variant="secondary"
            :loading="regeneratingId === p.id"
            :disabled="busyPostId !== null"
            @click="regenerateImage(p)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
            </svg>重新生图
          </linshe-button>
          <span class="special-open" role="button" tabindex="0" @click="openPost(p)" @keydown.enter.prevent="openPost(p)">查看详情 ›</span>
          <span style="flex:1"></span>
          <linshe-button
            size="sm" variant="ghost" tone="danger"
            :disabled="busyPostId !== null"
            title="删除这一期"
            @click="removePost(p)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>删除
          </linshe-button>
        </div>
      </div>
    </div>

    <!-- ── 论坛：版聊列表（独立版式，不参与瀑布流列布局）── -->
    <MediaForumList
      v-if="isForumCategory && forumPosts.length"
      :posts="forumPosts"
      :outlets="filteredOutlets"
      :active-outlet="activeOutlet"
      :active-board-id="activeBoard"
      :boards="boards"
      :batch-mode="batchMode"
      :selected-ids="selectedPostIds"
      @open="openPost"
      @board="onBoardChange"
      @pick="togglePick"
    />

    <!-- ── 规则34：图片站（左标签栏 + 等宽 4 列瀑布流）── -->
    <MediaGallery
      v-if="isGalleryCategory && galleryPosts.length"
      :posts="galleryPosts"
      :outlets="filteredOutlets"
      :active-outlet="activeOutlet"
      :active-board-id="activeBoard"
      :batch-mode="batchMode"
      :selected-ids="selectedPostIds"
      @open="openPost"
      @board="onBoardChange"
      @pick="togglePick"
    />

    <!-- ── 哈托比亚：SFW 图片站（与规则34 同一套图片站版式，只是内容全年龄）── -->
    <MediaGallery
      v-if="isPhotosCategory && photosPosts.length"
      :posts="photosPosts"
      :outlets="filteredOutlets"
      :active-outlet="activeOutlet"
      :active-board-id="activeBoard"
      :batch-mode="batchMode"
      :selected-ids="selectedPostIds"
      @open="openPost"
      @board="onBoardChange"
      @pick="togglePick"
    />

    <!-- ── 帖子流：瀑布流 ── -->
    <div v-if="feedPosts.length" class="masonry">
      <article
        v-for="p in feedPosts"
        :key="p.id"
        class="post-card"
        :class="{ 'is-char': p.author_type === 'character', 'is-selecting': batchMode, 'is-picked': selectedPostIds.has(p.id) }"
        @click="onCardClick(p)"
      >
        <!-- 批量模式：卡片左上角勾选框。整卡可点（拿不到鼠标的触屏也好用），
             所以这里只做视觉，不单独绑事件。 -->
        <span v-if="batchMode" class="pick-box" :class="{ on: selectedPostIds.has(p.id) }" aria-hidden="true">
          <svg v-if="selectedPostIds.has(p.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
        <!-- 封面：有图用图，没图用渐变占位（配图由后台补印） -->
        <div class="post-cover">
          <img v-if="p.image" :src="bustUrlIfOverwritten(p.image)" loading="lazy" decoding="async" alt="" />
          <div v-else class="cover-ph">
            <span v-if="p.outlet_name" class="cover-ph-outlet">{{ p.outlet_name }}</span>
            <span class="cover-ph-title">{{ p.title }}</span>
          </div>
          <span class="cover-likes">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 21s-7.5-4.7-9.6-9A5.6 5.6 0 0 1 12 6.1 5.6 5.6 0 0 1 21.6 12c-2.1 4.3-9.6 9-9.6 9Z"/>
            </svg>{{ formatNum(p.likes) }}
          </span>
          <span v-if="p.board_name" class="cover-board">{{ p.board_name }}</span>
          <!-- 悬浮操作：重新生图 / 删除（@click.stop 防止连带打开详情）
               ⚠ 重新生图只在**这条内容真有配图**时才出（论坛纯文字，点了只会报错） -->
          <div class="cover-ops">
            <button
              v-if="canRegenerate(p)"
              type="button" class="cover-op" title="重新生图"
              :disabled="busyPostId !== null"
              @click.stop="regenerateImage(p)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
              </svg>
            </button>
            <button
              type="button" class="cover-op is-danger" title="删除"
              :disabled="busyPostId !== null"
              @click.stop="removePost(p)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="post-body">
          <div class="post-author">
            <span class="author-avatar" :class="{ 'is-char': p.author_type === 'character' }">
              <img v-if="p.author_avatar" :src="p.author_avatar" alt="" />
              <span v-else>{{ (p.author_name || '?').charAt(0) }}</span>
            </span>
            <span class="author-name" :class="{ 'is-char': p.author_type === 'character' }">{{ p.author_name }}</span>
            <span v-if="p.author_type === 'character'" class="author-badge">角色</span>
          </div>
          <h3 class="post-title">{{ p.title }}</h3>
          <p class="post-excerpt">{{ p.content }}</p>
          <div v-if="p.tags.length" class="post-tags">
            <span v-for="t in p.tags" :key="t" class="tag">#{{ t }}</span>
          </div>
          <div class="post-foot">
            <span class="foot-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>
              </svg>{{ formatNum(p.views) }}
            </span>
            <span class="foot-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>{{ p.comments.length }}
            </span>
          </div>
        </div>
      </article>
    </div>

    <!-- 空状态：注意要基于 posts（而非 feedPosts）——
         选中的是周刊/海报时 feedPosts 本就为空，不能因此误报"没有内容"；
         传统报纸分类也不适用（内容在整版报纸里） -->
    <div v-if="!posts.length && !loading" class="media-empty">
      <!-- ★ 加载失败必须与"真的没有内容"区分开。
           踩过的坑：后端 listPosts 的 COUNT 查询缺 JOIN → 接口报错 → catch 里静默置空 posts
           → 页面显示「还没有任何帖子」，看起来像"内容被清空了"，实际是请求挂了。 -->
      <template v-if="loadError">
        <p class="empty-title">内容加载失败</p>
        <p class="empty-hint">{{ loadError }}</p>
        <linshe-button variant="secondary" size="sm" class="empty-retry" @click="reloadAll()">重试</linshe-button>
      </template>
      <template v-else>
        <p class="empty-title">{{ emptyTitle }}</p>
        <p class="empty-hint">{{ emptyHint }}</p>
      </template>
    </div>

    <div v-if="loading" class="media-loading"><span class="spinner"></span> 加载中…</div>
    <div v-if="!loading && hasMore && posts.length" class="load-more" @click="loadMore">
      {{ loadingMore ? '加载中…' : '加载更多' }}
    </div>
    <div v-else-if="!loading && posts.length" class="load-more is-end">— 共 {{ total }} 帖 —</div>

    <!-- 帖子详情 -->
    <linshe-modal
      :visible="!!detailPost"
      :title="detailPost?.title || ''"
      wide
      panel-class="mp-detail-panel"
      @close="detailPost = null"
    >
      <div v-if="detailPost" class="post-detail">
        <!-- 顶部操作条：重新生图 / 删除。
             ⚠ 「重新生图」只对**会有配图的形态**显示 —— 论坛是纯文字版面（后端强制
             image_prompt 为空），对它点重新生图只会得到一句报错（用户 2026-10-06 实报）。 -->
        <div class="detail-ops">
          <linshe-button
            v-if="canRegenerate(detailPost)"
            size="sm" variant="secondary"
            :loading="regeneratingId === detailPost.id"
            :disabled="busyPostId !== null"
            title="为这条内容重新生成配图"
            @click="regenerateImage(detailPost)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
            </svg>重新生图
          </linshe-button>
          <span style="flex:1"></span>
          <linshe-button
            size="sm" variant="ghost" tone="danger"
            :disabled="busyPostId !== null"
            title="删除这条内容"
            @click="removePost(detailPost)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>删除
          </linshe-button>
        </div>

        <!-- ★ 版式本体渲染（门户 / 周刊 / 海报），而不是把结构化内容摊成纯文本。
             按 payload 形态分派 —— 迁移后 layout 对老帖不再可靠（见 postKind 注释）。
             图片可点击放大。 -->
        <component
          v-if="isLayoutPostWithComponent(detailPost)"
          :is="componentFor(detailPost)"
          :post="detailPost"
          @zoom="zoomSrc = $event"
          @section-loaded="onSectionLoaded"
          @section-error="onSectionError"
        />

        <!-- 论坛主题帖：主楼 + 楼层（版聊，不用 feed 那套单条排版） -->
        <MediaForumThread
          v-else-if="postKind(detailPost) === 'forum'"
          :post="detailPost"
          @zoom="zoomSrc = $event"
        />

        <template v-else>
          <div class="detail-meta">
            <span class="detail-author">
              <span class="author-avatar" :class="{ 'is-char': detailPost.author_type === 'character' }">
                <img v-if="detailPost.author_avatar" :src="detailPost.author_avatar" alt="" />
                <span v-else>{{ (detailPost.author_name || '?').charAt(0) }}</span>
              </span>{{ detailPost.author_name }}
              <span v-if="detailPost.author_type === 'character'" class="author-badge">角色</span>
            </span>
            <span class="detail-stats">{{ detailPost.outlet_name }}<template v-if="detailPost.board_name"> · {{ detailPost.board_name }}</template></span>
          </div>
          <img
            v-if="detailPost.image"
            :src="bustUrlIfOverwritten(detailPost.image)"
            class="detail-img"
            :class="{ 'is-gallery': postKind(detailPost) === 'gallery' }"
            alt=""
            @click="zoomSrc = bustUrlIfOverwritten(detailPost.image)"
          />
          <p v-if="detailPost.content" class="detail-content">{{ detailPost.content }}</p>
        </template>

        <!-- 标签 / 数据 / 评论：所有形态共用 -->
        <div v-if="detailPost.tags.length" class="post-tags">
          <span v-for="t in detailPost.tags" :key="t" class="tag">#{{ t }}</span>
        </div>
        <!-- 图库（规则34）：把本条随机到的生成参数摊开 —— 体位 / 画幅比例 / 画师串
             （这三样都是服务端逐条随机分配的，展示出来才看得出"随机"是真的） -->
        <div v-if="postKind(detailPost) === 'gallery' && detailPost.payload?.gallery" class="gallery-params">
          <span class="gp-item"><b>体位</b>{{ detailPost.payload.gallery.pose || '—' }}
            <template v-if="detailPost.payload.gallery.poseNo">（{{ detailPost.payload.gallery.poseNo }}）</template>
          </span>
          <span class="gp-item"><b>画幅</b>{{ detailPost.payload.gallery.aspect || '—' }}
            <template v-if="detailPost.payload.gallery.width">（{{ detailPost.payload.gallery.width }}×{{ detailPost.payload.gallery.height }}）</template>
          </span>
          <span class="gp-item gp-artist" :title="detailPost.payload.gallery.artist || ''">
            <b>画师串</b>{{ shortArtist(detailPost.payload.gallery.artist) }}
          </span>
        </div>
        <!-- 哈托比亚（SFW 图片站）：同口径摊开「题材 / 取景地点 / 画幅 / 画师串」 -->
        <div v-if="postKind(detailPost) === 'photos' && detailPost.payload?.photos" class="gallery-params">
          <span class="gp-item"><b>题材</b>{{ detailPost.payload.photos.categoryLabel || '—' }}</span>
          <span v-if="detailPost.payload.photos.placeName" class="gp-item"><b>取景</b>{{ detailPost.payload.photos.placeName }}</span>
          <span class="gp-item"><b>画幅</b>{{ detailPost.payload.photos.aspect || '—' }}
            <template v-if="detailPost.payload.photos.width">（{{ detailPost.payload.photos.width }}×{{ detailPost.payload.photos.height }}）</template>
          </span>
          <span class="gp-item gp-artist" :title="detailPost.payload.photos.artist || ''">
            <b>画师串</b>{{ shortArtist(detailPost.payload.photos.artist) }}
          </span>
        </div>
        <!-- 环境层：本条随机到的场景/光影/视角/焦点/摄影效果/表情/状态/道具。
             与上面「体位 / 画幅 / 画师串」同一口径 —— 这几样都是服务端逐条随机分配的，
             摊开才看得出"随机"是真的（标签与画面同源，见后端 galleryEnvelope.js）。 -->
        <div v-if="postKind(detailPost) === 'gallery' && envRows(detailPost).length" class="gallery-params gallery-env">
          <span v-for="e in envRows(detailPost)" :key="e.dim" class="gp-item" :title="e.en">
            <b>{{ e.label }}</b>{{ e.en }}
          </span>
        </div>
        <div class="detail-stats-row">
          <span>♥ {{ formatNum(detailPost.likes) }}</span>
          <span>👁 {{ formatNum(detailPost.views) }}</span>
          <span v-if="postKind(detailPost) === 'forum'">💬 {{ (detailPost.payload?.forum?.replies || []).length }}</span>
          <span v-else>💬 {{ detailPost.comments.length }}</span>
        </div>
        <!-- 论坛的「评论」就是楼层，已在上面按楼层渲染过，这里不再重复列 -->
        <div v-if="postKind(detailPost) !== 'forum'" class="comment-list">
          <div v-for="(c, i) in detailPost.comments" :key="i" class="comment-item">
            <span class="comment-author">{{ c.author }}</span>
            <span class="comment-text">{{ c.content }}</span>
          </div>
          <div v-if="!detailPost.comments.length" class="comment-empty">还没有评论</div>
        </div>
      </div>
    </linshe-modal>

    <!-- 图片放大（与《邻舍日报》详情同口径：点图放大） -->
    <ImageLightbox :visible="!!zoomSrc" :imgs="zoomSrc ? [zoomSrc] : []" @hide="zoomSrc = ''" />

    <!-- 媒体设置 -->
    <MediaSettingsModal v-model="showSettings" :outlets="outlets" @changed="reloadOutlets" />

    <!-- 《邻舍日报》：沿用原有整版报纸界面（报头 / 三栏 / 期号切换 / 新闻详情） -->
    <NewspaperModal v-model="showNewspaper" @read="onNewspaperRead" />
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, onUnmounted } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import MediaSettingsModal from '../components/MediaSettingsModal.vue'
import NewspaperModal from '../components/NewspaperModal.vue'
import MediaWeekly from '../components/media/MediaWeekly.vue'
import MediaPoster from '../components/media/MediaPoster.vue'
import MediaPortal from '../components/media/MediaPortal.vue'
import MediaForumList from '../components/media/MediaForumList.vue'
import MediaForumThread from '../components/media/MediaForumThread.vue'
import MediaGallery from '../components/media/MediaGallery.vue'
import ImageLightbox from '../components/ImageLightbox.vue'
import { bustUrlIfOverwritten } from '../utils/imageUrlRefresh.js'
import { ENV_DIM_ORDER, envDimLabel } from '../utils/galleryEnvelopeLabels.js'
import { onEvent } from '../stores/unifiedStream.js'
import { useNewspaperStore } from '../stores/newspaper.js'

const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const toastFn = inject('toast')
/** 删除确认用（全站统一的确认弹窗） */
const confirmFn = inject('confirm', null)

// ── 《邻舍日报》入口 ──
// 报纸有独立的整版排版，不在帖子流里展示；这里只做入口 + 未读点。
const newspaperStore = useNewspaperStore()
const showNewspaper = ref(false)
const newspaperUnread = computed(() => newspaperStore.unread)
function onNewspaperRead(paper) {
  try { newspaperStore.markRead(paper) } catch { /* 失败不阻塞，轮询会兜底 */ }
}

const PAGE_SIZE = 24

const outlets = ref([])
const boards = ref([])
const posts = ref([])
const total = ref(0)
const loading = ref(true)
/** 帖子列表加载失败的原因（空串=正常）。用于把"请求失败"与"真的没有内容"区分开 */
const loadError = ref('')
const loadingMore = ref(false)
const refreshing = ref(false)
const showSettings = ref(false)
const detailPost = ref(null)
/** 图片放大（点版式里的图 → 与《邻舍日报》详情同口径） */
const zoomSrc = ref('')
/** 正在重新生图的帖子 id（按钮转圈用） */
const regeneratingId = ref(null)
/** 有操作在进行中（防止并发点） */
const busyPostId = ref(null)

const activeOutlet = ref(null)
const activeBoard = ref(null)

// ── 顶栏分类分页 ──
// 报刊类不混进「社交平台」（社交平台 = 瀑布流帖子流）：《邻舍日报》是整版报纸、
// 周刊/海报是按期出刊，三者形态完全不同，混在一个流里既乱又难找。
// 分类由 layout 推导（weekly/poster → 数字报刊；feed → 社交平台），加新媒体时自动归类。
const CATEGORIES = [
  /**
   * 三档按**产物形态**归类（与后端 listPosts 的 category 一一对应）：
   *   print  → 「官方传媒」：官方/印刷形态的物料 —— 海报（poster）、旧周刊（weekly）。
   *            注意 `portal`（门户网）**不在**这里，它属于下面的「数字报刊」。
   *            （key 仍是 `print` —— 后端过滤与前端共用它，改 key 要前后端一起动，不划算。）
   *   digital→ 「数字报刊」：可点开板块的数字刊物（门户）。
   *   social → 「社交平台」：帖子流。
   *
   * 早先这一档叫「传统报纸」并且**只放《邻舍日报》一张硬编码卡**，
   * 其它 UI 全部 `v-if="!== 'traditional'"` 排除掉 —— 于是这一档既列不出别的物料、
   * 也没法添加新媒体。现在它就是一个**普通分类**，只是额外多一张日报入口卡
   * （日报不存 media_outlets，是独立整版排版）。
   */
  { key: 'print', label: '官方传媒', icon: '📰', hint: '报纸 / 海报 —— 官方印刷物料，按期出刊' },
  { key: 'digital', label: '数字报刊', icon: '📸', hint: '数字刊物 —— 门户网，可点开各板块看正文' },
  { key: 'social', label: '社交平台', icon: '💬', hint: '瀑布流社交平台 —— 帖子流，一屏看多条' },
  { key: 'forum', label: '网络论坛', icon: '🧵', hint: '版聊论坛 —— 主题帖 + 楼层回复，文字为主、少量图片' },
  { key: 'photos', label: '哈托比亚', icon: '📷', hint: '图片分享站（全年龄）—— 城市风光 / 美少女自拍 / 美食打卡 / 宣传海报' },
  { key: 'gallery', label: '规则34', icon: '🔞', hint: '成人图片站 —— 一排 4 张；每条随机体位 + 随机画师串 + 随机比例' },
]
const activeCategory = ref('social')   // 默认落在内容最多的社交平台

/** 是不是「传统报纸」那一档（只有它要额外渲染《邻舍日报》入口卡） */
const isPrintCategory = computed(() => activeCategory.value === 'print')

/** 当前分类的中文名（刷新面板里说清「在哪个档里随机抽」） */
const activeCategoryLabel = computed(
  () => CATEGORIES.find(c => c.key === activeCategory.value)?.label || '当前分类')

/** 论坛 / 图库档 —— 这两档的帖子不参与瀑布流（各自有专属版式） */
const isForumCategory = computed(() => activeCategory.value === 'forum')
const isGalleryCategory = computed(() => activeCategory.value === 'gallery')
/** 哈托比亚（SFW 图片站）档 —— 与规则34 共用图片站版式 */
const isPhotosCategory = computed(() => activeCategory.value === 'photos')

/**
 * ★ 这条内容**能不能重新生图** —— 只读后端下发的 `can_regenerate`。
 *
 * 用户 2026-10-06 实报：论坛是**纯文字版面**却还挂着「重新生图」按钮。
 * 后端对此是明确的：生成论坛时强制把 `image_prompt` 置空（原文「论坛是纯文字版面，一律不配图」），
 * 且 `/regenerate-image` 端点会直接拒绝 —— 点下去只弹一句报错。**按钮本就不该出现**。
 *
 * ⚠ 判据**不在前端重写**：`image_prompt` 是 `mapPostRow` 不下发的字段，前端根本拿不到；
 *   若在此镜像一份 `canRegenerateImage` 逻辑，等于把同一条口径复制成两份（红线 8）。
 *   后端已用**重新生图端点同一个函数**算好 `can_regenerate` 下发，这里只读。
 */
function canRegenerate(post) {
  return !!post?.can_regenerate
}

/**
 * 当前分类下**是否有可生图的内容** —— 只用于「批量重新生图」这个**没有单条对象**的入口。
 * 逐条判定走 `canRegenerate()`（读后端下发的 can_regenerate）；此处只是决定批量按钮显不显示。
 * 判据与后端 `CATEGORY_LAYOUTS` 对齐：目前只有论坛是纯文字档（其余都会配图）。
 */
const categoryHasImages = computed(() => activeCategory.value !== 'forum')

/**
 * 已选中项里**真正能重新生图**的 id（论坛这类纯文字内容会被自动排除）。
 * 用于：① 批量按钮的计数与禁用态；② 提交时只送这些 id（免得后端逐条报"没有生图提示词"）。
 */
const regenerableSelectedIds = computed(() => {
  const byId = new Map((posts.value || []).map(p => [p.id, p]))
  return [...selectedPostIds.value].filter(id => canRegenerate(byId.get(id)))
})

/** 当前分类下的媒体（普通用户自建媒体） */
/**
 * 媒体是否属于「数字报刊」。
 *
 * ★ 必须与后端 `CATEGORY_LAYOUTS`（`services/mediaService.js`）**逐字对齐**：
 *     print   → poster / weekly
 *     digital → portal
 *     social  → feed（老库 layout 为 NULL 的也算）
 *
 * ⚠️ 这三处曾经各自硬编码，踩过两次：
 *    ① portal 迁移时只改了后端 → 两个刊在后端属「数字报刊」、在前端却被判成"非数字"而掉进社交平台；
 *    ② `digital` 漏摘 poster/weekly → 同一张海报同时在「数字报刊」和「官方传媒」两档出现。
 *    新增 layout 形态时，**后端 CATEGORY_LAYOUTS 与这里必须一起改**
 *    （回归测试会检查每个形态都被前端归了类）。
 */
/**
 * 「数字报刊」= 门户形态（可点开板块的数字刊物）。
 * 海报/周刊**不在**这里 —— 它们有自己的分类（官方传媒），必须拆开，
 * 否则同一刊会同时出现在两档里。
 */
function isDigitalOutlet(o) {
  return (o.layout || 'feed') === 'portal'
}

/** 「官方传媒」= 官方/印刷形态：海报（poster）与旧周刊（weekly） */
function isPrintOutlet(o) {
  const layout = o.layout || 'feed'
  return layout === 'poster' || layout === 'weekly'
}

/** 「网络论坛」= 版聊形态（主题帖 + 楼层） */
function isForumOutlet(o) {
  return (o.layout || 'feed') === 'forum'
}

/** 「规则34」= 图库形态（一排 4 张） */
function isGalleryOutlet(o) {
  return (o.layout || 'feed') === 'gallery'
}

/** 「哈托比亚」= SFW 图片站形态（与规则34 版式同构，故共用 MediaGallery 渲染） */
function isPhotosOutlet(o) {
  return (o.layout || 'feed') === 'photos'
}

/**
 * 分类 → 「这个 outlet 属不属于这一档」的判定（**唯一一份**）。
 * 与后端 `CATEGORY_LAYOUTS` 一一对应；新增档位时只改这里与 CATEGORIES，
 * 不再在各处写 `a ? ... : b ? ... : 其余全归最后一档` 的链式三元 ——
 * 那种写法在档位变多后会把新档的媒体偷偷并进最后一档（漏判不会报错）。
 */
const CATEGORY_PICKERS = {
  social: o => (o.layout || 'feed') === 'feed',
  forum: isForumOutlet,
  photos: isPhotosOutlet,
  gallery: isGalleryOutlet,
  print: isPrintOutlet,
  digital: isDigitalOutlet,
}
function pickerFor(key) {
  return CATEGORY_PICKERS[key] || (() => false)
}

/** 当前分类下的媒体（按形态归类，加新媒体时自动归位，不用手动维护） */
const filteredOutlets = computed(() => outlets.value.filter(pickerFor(activeCategory.value)))

/** 「全部」标签上的数字：当前分类下所有媒体的帖子数之和 */
const categoryTotal = computed(() => filteredOutlets.value.reduce((s, o) => s + (o.post_count || 0), 0))

/**
 * 分类分页上的数字。
 * 「官方传媒」要把**日报的未读**也算进来（日报不存 media_outlets，
 * 否则这一档的数字只统计海报、会漏掉天天出的日报）。
 */
function categoryCount(key) {
  const pick = pickerFor(key)
  const n = outlets.value.filter(pick).reduce((s, o) => s + (o.post_count || 0), 0)
  return key === 'print' ? n + (newspaperStore.unread ? 1 : 0) : n
}

async function onCategoryChange(key) {
  if (activeCategory.value === key) return
  // 换分类 = 整批内容都换了 → 退出批量模式
  if (batchMode.value) exitBatchMode()
  activeCategory.value = key
  activeOutlet.value = null
  activeBoard.value = null
  boards.value = []
  // 换分类 → 期号筛选与简目一并清掉（否则会带着上一刊的期号去筛）
  issues.value = []
  activeIssueId.value = null
  loadError.value = ''
  // 注意：以前这里有 `if (key === 'traditional') { 清空并 return }` ——
  // 那时该档只有一张硬编码的日报卡、没有帖子流。现在「官方传媒」是普通分类（有物料列表），
  // 必须照常加载，否则点进去永远是空的。
  await loadPage(0)
}

async function reloadAll() {
  await Promise.all([reloadOutlets(), loadPage(0)])
  await reloadIssues()
}

const totalAllOutlets = computed(() => outlets.value.reduce((s, o) => s + (o.post_count || 0), 0))

// 板块 chip：首位「全部」，其余为当前媒体的板块
const boardChips = computed(() => {
  const sum = boards.value.reduce((s, b) => s + (b.post_count || 0), 0)
  return [{ id: null, name: '全部', post_count: sum }, ...boards.value]
})

const hasMore = computed(() => posts.value.length < total.value)

/**
 * 帖子版式类型 —— **按 payload 形态判定，不看 outlet.layout**。
 *
 * ★ 为什么必须这样：`layout` 来自 outlet（listPosts 里 `o.layout AS layout`）。
 *   狸狸通讯社/八卦从 weekly/poster 迁成 portal 之后，**它们已有的老帖也会被标成 portal**，
 *   按 layout 分派就会把老周刊丢给门户组件渲染 → `payload.sections` 不存在 → 一片**空白**。
 *   按 payload 形态判定天然兼容：有 sections 才是门户。
 *
 * ⚠️ 同时要求 payload 存在：早期版本（layout 还没引入时）生成的狸狸八卦帖子只有
 *   title/content、没有 payload_json。若只看 outlet.layout，版式组件会因 `v-if="data"`
 *   不通过而渲染成空白；这里退回 feed 卡片，正常显示标题与正文。
 */
/**
 * 帖子版式类型 —— **按 payload 形态判定，不看 outlet.layout**。
 *
 * 为什么按 payload 而不是媒体形态：媒体可以中途改形态，旧帖仍按原形态渲染
 * （db 里 payload 就是当时那期的真实结构），所以只有 payload 是权威。
 *
 * 五个形态（与 pkind 对应的渲染组件）：
 *   feed    独立帖子（瀑布流卡片）
 *   forum   论坛主题帖（版聊楼层）
 *   gallery 图片站条目（等宽多列瀑布流）
 *   portal  门户/数字报刊
 *   weekly  旧周刊
 *   poster  海报
 */
function postKind(p) {
  const pl = p?.payload
  if (!pl) return 'feed'
  // ★ 先判两个新形态：它们的 payload 结构最独特，且都要从瀑布流里摘出去
  if (pl.gallery) return 'gallery'
  if (pl.photos) return 'photos'
  if (pl.forum && Array.isArray(pl.forum.replies)) return 'forum'
  if (pl.portal && Array.isArray(pl.sections)) return 'portal'
  if (Array.isArray(pl.columns)) return 'weekly'
  if (Array.isArray(pl.panels)) return 'poster'
  return 'feed'
}
/**
 * 是否「整幅版式」——需要从瀑布流里摘出去、单独渲染的那种。
 * ★ 用 `postKind(p) !== 'feed'` 的等价写法，但显式列出来是为了让
 *   "哪些形态走独立版式"这件事一眼可见（板块/瀑布流/网格各一种）。
 * ⚠ **这是"列表要排除哪些"的判据，不是"弹窗用哪个组件"的判据** ——
 *   两者一度混用，导致论坛帖在详情弹窗里被渲染成**周刊**（`componentFor` 兜底到 MediaWeekly）。
 *   弹窗请用下面的 `isLayoutPostWithComponent()`。
 */
function isLayoutPost(p) {
  const k = postKind(p)
  return k === 'forum' || k === 'gallery' || k === 'photos' || k === 'portal' || k === 'weekly' || k === 'poster'
}
/**
 * 弹窗里走「动态组件」渲染的形态 —— **只列真正在 `KIND_COMPONENT` 里注册过组件的**。
 *
 * ★ 为什么必须与 `isLayoutPost()` 分开（2026-10-06 用户实报）：
 *   论坛/图库有**各自专用的版式组件**（`MediaForumThread` / `MediaGallery`），
 *   它们不在 `KIND_COMPONENT` 里。而详情弹窗的模板顺序是
 *   `v-if="isLayoutPost" → v-else-if="postKind==='forum'" → v-else-if="'gallery'"`：
 *   若 `isLayoutPost` 对论坛返回 true，就会**先命中第一个分支**，
 *   而 `componentFor()` 查不到 forum 的组件 → **兜底返回 `MediaWeekly`** →
 *   论坛帖被周刊版式渲染（用户看到"弹窗里没有楼层"）。
 */
function isLayoutPostWithComponent(p) {
  return !!KIND_COMPONENT[postKind(p)]
}
/** 版式组件：按 payload 形态挑（⚠ 只含"动态组件渲染"的形态；论坛/图库各有专用分支） */
const KIND_COMPONENT = { portal: MediaPortal, weekly: MediaWeekly, poster: MediaPoster }
function componentFor(p) {
  return KIND_COMPONENT[postKind(p)] || MediaWeekly
}
/** 整幅版式（不是瀑布流卡片）：论坛 / 图库 / 门户 / 周刊 / 海报 */
function isSpecialPost(p) {
  return postKind(p) !== 'feed'
}
/** 瀑布流卡片：只有 feed 走这里；论坛与图库各有自己的版式组件 */
const feedPosts = computed(() => posts.value.filter(p => postKind(p) === 'feed'))
/** 论坛主题帖（版聊列表） */
const forumPosts = computed(() => posts.value.filter(p => postKind(p) === 'forum'))
/** 规则34 图库条目（等宽多列瀑布流） */
const galleryPosts = computed(() => posts.value.filter(p => postKind(p) === 'gallery'))
/** 哈托比亚（SFW 图片站）条目 —— 与规则34 共用图片站版式 */
const photosPosts = computed(() => posts.value.filter(p => postKind(p) === 'photos'))
/** 整幅版式：门户 / 周刊 / 海报 */
const specialPosts = computed(() => {
  const list = posts.value.filter(p => {
    const k = postKind(p)
    return k === 'portal' || k === 'weekly' || k === 'poster'
  })
  // 期号导航：选了某一期就只看那一期（其余仍在列表里，取消筛选即可回来）
  if (!activeIssueId.value) return list
  return list.filter(p => p.id === activeIssueId.value)
})

/* ── 数字报刊：出刊 + 期号导航 ── */

/** 当前选中的是不是「数字报刊」形态（决定顶栏显示「刷新」还是「出刊」） */
const activeIsPeriodical = computed(() => {
  const o = outlets.value.find(x => x.id === activeOutlet.value)
  return o ? (isDigitalOutlet(o) || isPrintOutlet(o)) : false
})

/** 该刊的期简目（最新在前）—— 往期导航用 */
const issues = ref([])
/** 期号导航当前选中的期（null = 全部/最新） */
const activeIssueId = ref(null)

async function reloadIssues() {
  // ★ 这里必须是 activeIsPeriodical（门户+海报+旧周刊），不能写错名字。
  //   踩过的坑：改名时漏改了这一处，留下一个**不存在的标识符**（activeIsPortal）——
  //   它不是「条件恒假」，而是抛 ReferenceError；而抛出点又在 try 之外，
  //   于是 reloadIssues() 每次都以 rejected 结束：期简目恒为空 →「期号导航」永不出现，
  //   且 onMounted 里 `await reloadIssues()` 后面的 loading=false / 补图 / SSE 订阅**全部被跳过**。
  if (!activeOutlet.value || !activeIsPeriodical.value) { issues.value = []; activeIssueId.value = null; return }
  try {
    const d = await api.listMediaIssues(activeOutlet.value)
    issues.value = d.issues || []
    // 选中那一期若已不在列表（换刊/删帖）→ 回到「最新」
    if (activeIssueId.value && !issues.value.some(i => i.post_id === activeIssueId.value)) activeIssueId.value = null
  } catch (err) {
    // 期简目取不到不该拖垮整页（出刊按钮仍然可用），但要留下痕迹便于排查
    console.warn('[media] 读取期简目失败:', err?.message || err)
    issues.value = []
  }
}

/**
 * 出一刊。
 *
 * 当天已出过时**不重复出**（后端直接返回那一期）——这里据此提示读者，
 * 并允许再点一次以「加刊」（force）。两次点击的语义清晰，不会误烧 token。
 */
const publishing = ref(false)
async function onPublish() {
  if (publishing.value || !activeOutlet.value) return
  publishing.value = true
  try {
    const first = await api.publishMediaIssue(activeOutlet.value, false)
    if (first.existed) {
      const ok = window.confirm(
        `《${outletNameOf(activeOutlet.value)}》今天已经出过第 ${first.issue} 期了。\n\n要再出一期吗？（加刊）`
      )
      if (!ok) { toastFn?.(`今天已出第 ${first.issue} 期`, 'info'); return }
      publishing.value = true
      const again = await api.publishMediaIssue(activeOutlet.value, true)
      toastFn?.(`已加刊：第 ${again.issue} 期`, 'success')
    } else {
      toastFn?.(`已出刊：第 ${first.issue} 期`, 'success')
    }
    // 出刊是同步返回的（正文与配图后台补），立刻重取列表与期简目
    await reloadAll()
    await reloadIssues()
  } catch (err) {
    console.error('[media] 出刊失败:', err)
    toastFn?.('出刊失败：' + (err?.message || ''), 'error')
  } finally {
    publishing.value = false
  }
}

function outletNameOf(id) {
  return outlets.value.find(o => o.id === id)?.name || '本刊'
}

/** 期号 chip 的文案：期号 + 已写块数（看得出哪期是完整的） */
function issueChipLabel(it) {
  const done = it.written >= it.section_count && it.section_count > 0
  return `第 ${it.issue} 期${done ? '' : `（${it.written}/${it.section_count}）`}`
}

/** 批量勾选行上的类型标签 */
function kindLabel(p) {
  return { portal: '报刊', weekly: '周刊', poster: '海报' }[postKind(p)] || '内容'
}

// ── 门户：板块正文取回后同步回本地列表 ──
// 门户组件内部已经用本地缓存显示，这里再把结果写回 posts 数组，
// 这样**关掉详情/刷新列表前**都不会丢；下次进来也少一次请求（payload 已落库）。
function onSectionLoaded({ postId, section }) {
  const target = posts.value.find(p => p.id === postId)
  if (!target?.payload?.sections) return
  const hit = target.payload.sections.find(s => s.key === section.key)
  if (hit) hit.body = section.body
}

function onSectionError({ sectionKey, error }) {
  toastFn?.(`「${sectionKey}」正文生成失败：${error}`, 'error')
}

function formatNum(n) {
  const v = Number(n) || 0
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  return String(v)
}

/**
 * 画师串的短显示：只取前几个「@名字」，过长就省略。
 *
 * 画师串是一条很长的 prompt 片段（形如 `@chigusa_minori, @xxx, ...`），
 * 详情里整条铺开会把参数行撑爆，所以截到 32 字 + 省略号，完整内容挂在 `title` 上（hover 可见）。
 * 与规则34 缩略图上的「画师串」徽标同一口径。
 */
function shortArtist(s) {
  const v = String(s || '').trim()
  if (!v) return '—'
  return v.length > 32 ? v.slice(0, 32).trim() + '…' : v
}

/**
 * 详情页的「环境层」行：把 `payload.gallery.env` 按维度顺序摊成
 * `{ dim, label, en }`，供模板一行列出（场景/光影/视角/焦点/摄影效果/表情/状态/道具）。
 * 维度显示名来自 `utils/galleryEnvelopeLabels.js`（唯一真源）。
 */
function envRows(post) {
  const env = post?.payload?.gallery?.env
  if (!Array.isArray(env) || !env.length) return []
  const order = new Map(ENV_DIM_ORDER.map((k, i) => [k, i]))
  return env
    .filter(e => e?.en && e?.dim)
    .slice()
    .sort((a, b) => (order.get(a.dim) ?? 99) - (order.get(b.dim) ?? 99))
    .map(e => ({ dim: e.dim, label: envDimLabel(e.dim), en: e.en }))
}

function openPost(p) {
  detailPost.value = p
}

// ── 批量操作 ──
// selectedPostIds 存帖子 id。注意：**每次修改都替换成新的 Set** ——
// ref 包 Set 时直接 .add() 不会触发视图更新（与相册的 selected 同一处理）。
const batchMode = ref(false)
const batchBusy = ref(false)
const selectedPostIds = ref(new Set())

/** 当前页（含周刊/海报）可见的全部帖子 —— 「全选本页」的作用域 */
const visiblePosts = computed(() => posts.value)

const allVisibleSelected = computed(() =>
  visiblePosts.value.length > 0 && visiblePosts.value.every(p => selectedPostIds.value.has(p.id)))

function enterBatchMode() {
  if (!posts.value.length) return
  batchMode.value = true
  selectedPostIds.value = new Set()
}

function exitBatchMode() {
  batchMode.value = false
  selectedPostIds.value = new Set()
}

function togglePick(id) {
  const next = new Set(selectedPostIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedPostIds.value = next
}

function selectAllVisible() {
  selectedPostIds.value = allVisibleSelected.value
    ? new Set()
    : new Set(visiblePosts.value.map(p => p.id))
}

/** 批量模式下点卡片 = 切换勾选；否则照旧打开详情 */
function onCardClick(p) {
  if (batchMode.value) togglePick(p.id)
  else openPost(p)
}

async function batchDelete() {
  const ids = [...selectedPostIds.value]
  if (!ids.length || batchBusy.value) return
  const ok = window.confirm(
    `确定删除选中的 ${ids.length} 条内容吗？\n其中的文章与配图会一并删除，且不可恢复。`
  )
  if (!ok) return
  batchBusy.value = true
  try {
    const r = await api.deleteMediaPosts(ids)
    if (r?.failed) {
      toastFn?.(`已删除 ${r.deleted} 条，${r.failed} 条失败`, 'warning')
    } else {
      toastFn?.(`已删除 ${r?.deleted ?? ids.length} 条`, 'success')
    }
    exitBatchMode()
    // 必须重载：本地移除会让 loadMore 的 offset 基准失真（与相册同因）
    await reloadAll()
  } catch (err) {
    toastFn?.('批量删除失败' + '：' + (err?.message || ''), 'error')
  } finally {
    batchBusy.value = false
  }
}

async function batchRegenerate() {
  // 只提交**真能生图**的选中项：论坛这类纯文字内容混在里面会被后端逐条拒绝
  const ids = regenerableSelectedIds.value
  if (!ids.length || batchBusy.value) return
  const skipped = selectedPostIds.value.size - ids.length
  batchBusy.value = true
  try {
    const r = await api.regenerateMediaPostImages(ids)
    const skipNote = skipped > 0 ? `（${skipped} 条无配图，已跳过）` : ''
    if (r?.failed) {
      toastFn?.(`已排队 ${r.queued} 条，${r.failed} 条失败${skipNote}`, 'warning')
    } else {
      toastFn?.(`已排队重新生图 ${r?.queued ?? ids.length} 条${skipNote}，稍候…`, skipped ? 'warning' : 'success')
    }
    exitBatchMode()
    await loadPage(0)
  } catch (err) {
    toastFn?.('批量重新生图失败' + '：' + (err?.message || ''), 'error')
  } finally {
    batchBusy.value = false
  }
}

/**
 * 重新生图：清掉这条内容已有的图、重新排队生成。
 * 周刊/海报会连同小图一起重出（后端按 payload 结构一并清空）。
 */
async function regenerateImage(p) {
  if (busyPostId.value !== null) return
  busyPostId.value = p.id
  regeneratingId.value = p.id
  try {
    await api.regenerateMediaPostImage(p.id)
    toastFn?.('已重新排队生图，稍候…', 'success')
  } catch (err) {
    toastFn?.('重新生图失败' + '：' + (err?.message || ''), 'error')
  } finally {
    regeneratingId.value = null
    busyPostId.value = null
  }
}

/** 删除这条内容（含其图片文件）。破坏性操作 → 二次确认 */
async function removePost(p) {
  if (busyPostId.value !== null) return
  // 用 postKind 而不是裸 layout：迁移后两个刊的 layout 都是 portal，
  // 拿 layout 判断会把所有刊都说成「周刊」（海报也不例外）。
  const kind = postKind(p)
  const label = kind === 'feed' ? '这条内容'
    : kind === 'poster' ? '这一期海报'
    : kind === 'portal' ? '这一期刊物'
    : '这一期周刊'
  const msg = `确定删除${label}吗？\n\n「${p.title}」\n\n配图文件会一并删除，且不可恢复。`
  const ok = confirmFn
    ? await confirmFn({ title: '删除', message: msg, okText: '删除', danger: true })
    : window.confirm(msg)
  if (!ok) return

  busyPostId.value = p.id
  try {
    await api.deleteMediaPost(p.id)
    // 本地移除，不必整页重载
    posts.value = posts.value.filter(x => x.id !== p.id)
    total.value = Math.max(0, total.value - 1)
    if (detailPost.value?.id === p.id) detailPost.value = null
    await reloadOutlets()   // 标签上的计数要跟着变
    toastFn?.('已删除', 'success')
  } catch (err) {
    toastFn?.('删除失败' + '：' + (err?.message || ''), 'error')
  } finally {
    busyPostId.value = null
  }
}

// ── 数据加载 ──

let loadSeq = 0

async function reloadOutlets() {
  try {
    const d = await api.listMediaOutlets()
    outlets.value = d.outlets || []
    // 当前选中的媒体被删了就回到「全部」
    if (activeOutlet.value && !outlets.value.some(o => o.id === activeOutlet.value)) {
      activeOutlet.value = null
      await reloadBoards()
    }
  } catch (err) {
    console.error('[media] 读取媒体失败:', err)
  }
}

async function reloadBoards() {
  if (!activeOutlet.value) { boards.value = []; return }
  try {
    const d = await api.listMediaBoards(activeOutlet.value)
    boards.value = d.boards || []
  } catch (err) {
    console.error('[media] 读取板块失败:', err)
    boards.value = []
  }
}

async function loadPage(offset = 0) {
  const seq = ++loadSeq
  try {
    // 没选具体媒体时按分类过滤 —— 否则「全部」会把报刊也混进来
    const d = await api.listMediaPosts({
      outlet: activeOutlet.value,
      board: activeBoard.value,
      // 选中具体媒体 → 不需要分类过滤；否则按当前分类过滤。
      // （原先这里还有一层 `=== 'traditional' ? null` —— 那个分类已改名 print，是死分支，清掉。）
      category: activeOutlet.value ? null : activeCategory.value,
      limit: PAGE_SIZE,
      offset,
    })
    if (seq !== loadSeq) return
    loadError.value = ''
    if (offset === 0) posts.value = d.posts || []
    else posts.value.push(...(d.posts || []))
    total.value = d.total || 0
  } catch (err) {
    console.error('[media] 读取帖子失败:', err)
    if (seq !== loadSeq) return
    // 不能只是清空 posts —— 那会让"请求失败"看起来像"这里真的没有内容"。
    // 记下错误，交给空状态渲染成「加载失败 + 重试」。
    loadError.value = err?.message || '请求失败'
    if (offset === 0) { posts.value = []; total.value = 0 }
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  await loadPage(posts.value.length)
  loadingMore.value = false
}

async function onOutletChange(id) {
  if (activeOutlet.value === id) return
  // 换了媒体，之前勾选的内容已经不在列表里 → 退出批量模式，避免残留 id 指向不存在的内容
  if (batchMode.value) exitBatchMode()
  activeOutlet.value = id
  activeBoard.value = null
  // 换刊 → 期号筛选必须清掉（否则会带着上一刊的期号去筛，列表直接空）
  await reloadBoards()
  await loadPage(0)
  await reloadIssues()
}

async function onBoardChange(id) {
  if (activeBoard.value === id) return
  if (batchMode.value) exitBatchMode()
  activeBoard.value = id
  await loadPage(0)
}

// ── 刷新：抓一批新帖（异步，靠 SSE 事件得知完成）──
let refreshTimer = null
/** 刷新目标面板是否展开 */
const refreshOpen = ref(false)

/** 「全部」+ 当前分类下没有任何媒体 —— 刷新会空转（见 refreshScopeHint） */
const noOutletInScope = computed(() => activeOutlet.value === null && !filteredOutlets.value.length)

/** 主按钮到底会刷什么 —— 写进 title，避免"点了才发现刷错源" */
const refreshScopeHint = computed(() => {
  // 「全部」+ 这个分类下没有任何媒体：后端会**随机抽一个媒体**（可能是别的分类的），
  // 生成出来的内容还不会出现在当前分类里 —— 纯烧 token 且看不到结果，直接禁掉并说清原因。
  if (noOutletInScope.value) return '这个分类下还没有媒体，先去右上角「媒体设置」新建一个'
  const o = outlets.value.find(x => x.id === activeOutlet.value)
  return o ? `刷新「${o.name}」` : '刷新全部媒体（随机抽一个）'
})

/**
 * 空状态文案：必须区分三种"空"，否则用户会以为是同一件事。
 *   ① 这一档根本没有媒体（如「官方传媒」一个海报媒体都没有）→ 该去加媒体，不是去刷新；
 *   ② 有媒体但还没内容 → 该点刷新；
 *   ③ 选中某个媒体但它没内容 → 同上。
 */
const emptyTitle = computed(() => {
  if (noOutletInScope.value) {
    return isPrintCategory.value ? '还没有官方传媒物料' : '这个分类下还没有媒体'
  }
  return activeOutlet.value === null ? '还没有任何帖子' : '这个媒体还没有内容'
})
const emptyHint = computed(() => {
  if (noOutletInScope.value) {
    return isPrintCategory.value
      ? '《邻舍日报》是独立整版报纸，在下面的入口里阅读；要给这一档加海报类物料，点右上角「媒体设置」新建一个、形态选「海报」。'
      : '点右上角「媒体设置」新建一个媒体，选好形态后就会有对应的内容版式。'
  }
  return '点右上角「刷新」抓一批新帖；内容由该媒体的提示词 + 世界观生成，活跃角色会随机出现在帖子里。'
})

/** 媒体形态的中文名（面板里每个媒体标一下，两种形态产物差别很大） */
function outletLayoutLabel(o) {
  if (o?.layout === 'portal') return '数字报刊 · 按「期」出刊'
  if (o?.layout === 'poster') return '海报 · 一张只讲一个瓜'
  if (o?.layout === 'weekly') return '周刊（旧形态）'
  if (o?.layout === 'forum') return '网络论坛 · 版聊主题帖'
  if (o?.layout === 'photos') return '图片站 · 全年龄（城市风光/自拍/美食/海报）'
  if (o?.layout === 'gallery') return '图片站 · 规则34（成人）'
  return '社交平台 · 一批帖子'
}

/**
 * 刷新指定媒体；传 null = 全部（后端随机抽一个）。
 *
 * 与 onRefresh 的区别只在**要不要先切中那个媒体**：面板里直接点某个媒体就刷它，
 * 不用先去标签行选中、再点刷新。
 */
async function onRefreshOutlet(outletId) {
  if (refreshing.value) return
  refreshOpen.value = false
  refreshing.value = true
  try {
    await api.refreshMediaPosts({
      outletId,
      // 传 null = 「当前分类随机」，必须带上分类；否则会抽到别的分类的媒体
      category: outletId ? null : activeCategory.value,
      count: 6,
    })
    const o = outlets.value.find(x => x.id === outletId)
    toastFn?.(o ? `正在刷新「${o.name}」，稍候…` : '正在抓取新帖，稍候…', 'success')
    // 兜底轮询：即使 SSE 没连上，也能在 60s 内看到结果
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { refreshing.value = false; reloadAll() }, 60_000)
  } catch (err) {
    console.error('[media] 刷新失败:', err)
    toastFn?.('刷新失败：' + (err?.message || ''), 'error')
    refreshing.value = false
  }
}

async function onRefresh() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    // 「全部」档必须把当前分类带上 —— 否则后端会全库随机抽一个媒体，
    // 生成出的内容不出现在当前分类里（看着像"没反应"，token 却已经烧了）
    await api.refreshMediaPosts({
      outletId: activeOutlet.value,
      category: activeOutlet.value ? null : activeCategory.value,
      count: 6,
    })
    toastFn?.('正在抓取新帖，稍候…', 'success')
    // 兜底轮询：即使 SSE 没连上，也能在 60s 内看到结果
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { refreshing.value = false; reloadAll() }, 60_000)
  } catch (err) {
    console.error('[media] 刷新失败:', err)
    toastFn?.('刷新失败：' + (err?.message || ''), 'error')
    refreshing.value = false
  }
}


// ── SSE ──
let unsubNew = null
let unsubImg = null

onMounted(async () => {
  newspaperStore.startPolling()
  await reloadOutlets()
  await loadPage(0)
  // ★ loading 必须在**加载数据的最后一步之后、任何"附加步骤"之前**收尾。
  //   踩过的坑：原先它排在 `await reloadIssues()` 后面，而 reloadIssues 里有个未定义标识符
  //   → 抛 ReferenceError → 这一行永远执行不到 → 页面永远显示「加载中…」、
  //   且后面的补图与 SSE 订阅也全部没挂上。附加步骤再出问题，也不该影响首屏可用。
  loading.value = false
  await reloadIssues()

  // 兜底补图：把上次没出图的帖子补上（生成失败 / 当时 ComfyUI 没开）。
  // **只在打开页面时补一次**，不做后台定时扫描 —— 否则会持续占用 ComfyUI。
  api.fillMediaImages(6).catch(() => { /* 后端未重启时 404，忽略 */ })

  // ⚠ 这里原本还有个「每秒重算自动抓帖倒计时」的定时器 + 读 `loadAuto()`。
  //   自动抓帖的开关已移到**设置 → 功能开关**（不在这个内容页），倒计时也随之搬走
  //   （设置页只在打开时读一次状态，不需要每秒 tick）。
  unsubNew = onEvent('media_new_posts', async () => {
    refreshing.value = false
    clearTimeout(refreshTimer)
    await reloadAll()
    toastFn?.('新帖已到', 'success')
  })
  // 配图就绪：只替换那一张，不整页重载
  unsubImg = onEvent('media_image_ready', ({ postId, image }) => {
    const p = posts.value.find(x => x.id === postId)
    if (p) p.image = image
    if (detailPost.value?.id === postId) detailPost.value.image = image
  })
})

onUnmounted(() => {
  clearTimeout(refreshTimer)
  newspaperStore.stopPolling()
  if (unsubNew) unsubNew()
  if (unsubImg) unsubImg()
})
</script>

<style scoped>
.media-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  padding: 0 0 24px;
}

/* ── 顶栏 ── */
.media-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 20px;
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 6;
}
/* 移动端侧栏入口（原来靠「传媒」标题点击，标题去掉后换成图标按钮） */
.btn-mobile-back {
  width: 40px; height: 40px; flex-shrink: 0;
  background: transparent;
}
.header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.media-count { font-size: 13px; color: var(--text-secondary); }
.btn-op, .btn-refresh { padding: 8px 18px; }

/* ── 自动抓帖频率 chip ──
   已移除：开关搬到「设置 → 功能开关」（常驻配置不该塞在内容页顶栏）。
   保留 .freq-panel —— 刷新目标面板（.refresh-panel）仍在用它的展开样式。 */

/* ── 频率面板 ── */
.freq-panel {
  flex-shrink: 0;
  padding: 12px 20px 14px;
  background: rgba(var(--accent-rgb), 0.05);
  border-bottom: 1px solid var(--border);
}

/* ── 刷新分裂按钮：主按钮 + 右侧小箭头（可指定要刷新的媒体）── */
.refresh-group { display: inline-flex; align-items: stretch; }
.refresh-group .btn-refresh { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.refresh-caret {
  /* ★ 显式 padding —— 全局 button 有 padding:7px 14px，会把这枚窄按钮撑变形 */
  padding: 0 8px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--glass-border);
  border-left: none;                    /* 与主按钮共边，视觉上连成一体 */
  border-radius: 0 9px 9px 0;
  background: var(--glass-bg);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color var(--dur-fast), background var(--dur-fast);
  -webkit-tap-highlight-color: transparent;
}
.refresh-caret:hover, .refresh-caret.active { color: var(--accent); background: rgba(var(--accent-rgb), 0.14); }

/* ── 刷新目标面板 ── */
.refresh-panel { padding-top: 10px; }
.rp-title { margin: 0 0 8px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-secondary); }
.rp-list { display: flex; flex-wrap: wrap; gap: 8px; }
.rp-item {
  /* ★ 同上：必须显式 padding，否则被全局 button 的 7px 14px 撑开 */
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  background: none;
  font: inherit; text-align: left;
  cursor: pointer;
  transition: border-color var(--dur-fast), background var(--dur-fast);
  -webkit-tap-highlight-color: transparent;
}
.rp-item:hover:not(:disabled) { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.12); }
.rp-item.current { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.14); color: var(--text-bright); }
.rp-item:disabled { opacity: 0.5; cursor: default; }
.rp-icon { font-size: 14px; line-height: 1; }
.rp-main { display: flex; flex-direction: column; gap: 1px; }
.rp-name { font-size: var(--fs-sm); font-weight: 600; color: var(--text-primary); }
.rp-hint { font-size: 10.5px; color: var(--text-secondary); }
.rp-tag {
  font-size: 10px; padding: 1px 6px; border-radius: var(--radius-full);
  background: var(--accent-solid); color: #fff;
}
.rp-empty { margin: 6px 0 0; font-size: var(--fs-xs); color: var(--text-secondary); }

/* ⚠ 以下 freq-* 里的 freq-row / freq-label / freq-range / freq-val / freq-ticks /
   freq-tick / freq-hint 都只服务已被移除的「自动抓帖频率」面板，2026-10-05 一并清掉。
   只有 .freq-panel 与下面两个 Transition 类保留 —— 刷新目标面板（.refresh-panel）仍在用它们。 */

.freq-enter-active { transition: all 0.25s cubic-bezier(0.3, 1.2, 0.5, 1); overflow: hidden; }
.freq-leave-active { transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.freq-enter-from, .freq-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
.freq-enter-to, .freq-leave-from { opacity: 1; max-height: 200px; }

/* ── 分类分页：占据原「传媒」标题的位置（在顶栏左侧） ──
   窄屏时三档放不下 → 横向滚动，不换行、不挤压右侧按钮 */
.cat-bar {
  display: flex;
  gap: 2px;
  flex: 0 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.cat-bar::-webkit-scrollbar { display: none; }
.cat-tab {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  border: none;
  border-radius: 10px;
  background: none;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 13px; font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.cat-tab:hover:not(.active) { color: var(--text-primary); background: var(--bg-tertiary); }
/* ⚠ active 态原为 `color: var(--accent)` + 半透明 accent 底：
   暗夜下橙字压暗红底只有 4.19（11px 小字需 4.5）。暗夜改用亮字。 */
.cat-tab.active { color: var(--accent); background: rgba(var(--accent-rgb), 0.12); }
[data-theme="dark"] .cat-tab.active { color: var(--text-bright); }
.cat-icon { font-size: 14px; }
.cat-num {
  font-size: 11px; font-weight: 500; opacity: 0.65;
  padding: 1px 6px; border-radius: 999px;
  background: var(--bg-tertiary);
}
.cat-tab.active .cat-num { background: rgba(var(--accent-rgb), 0.16); opacity: 1; }

/* ── 传统报纸：日报入口卡 ── */
.np-entry-wrap { padding: 16px 20px; }
.np-entry {
  display: flex; align-items: center; gap: 16px;
  width: 100%;
  padding: 20px 22px;
  border-radius: 14px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  backdrop-filter: blur(8px);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.np-entry:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: var(--accent); }
.np-entry-icon { font-size: 34px; flex-shrink: 0; }
.np-entry-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.np-entry-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 17px; font-weight: 700; color: var(--text-bright);
}
/* 副标题 + 形态说明同一排：说明在副标题右侧，两段文字**基线平齐**（align-items:baseline）。
   窄屏放不下时整块折到第二行，仍然左对齐起排。 */
.np-entry-subline {
  display: flex; align-items: baseline; flex-wrap: wrap;
  gap: 2px 12px;
  min-width: 0;
}
.np-entry-sub { font-size: 12px; color: var(--text-secondary); }
.np-entry-go { flex-shrink: 0; font-size: 13px; font-weight: 600; color: var(--accent); }
/* 说明文字：比副标题更轻一档，区分主次（原来它是卡片外的独立 <p>，
   移进按钮内必须是行内元素 —— button 里不能放 <p>） */
.np-entry-hint { font-size: 11.5px; line-height: 1.7; color: var(--text-secondary); opacity: 0.8; }

/* ── 媒体标签页 ── */
/* 媒体标签行 + 批量操作条：同一行。
   标签侧 flex:1 + min-width:0（必须）—— 否则它的 overflow-x:auto 不会收缩，
   会把右侧的批量操作条挤出可视区。 */
.outlet-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-right: 20px;
  flex-shrink: 0;
}
.outlet-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 12px 0 10px 20px;
  scrollbar-width: none;
  flex: 1;
  min-width: 0;
}
.outlet-bar::-webkit-scrollbar { display: none; }
.outlet-tab {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 13px; font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.outlet-tab:hover:not(.active) { color: var(--text-primary); }
.outlet-tab.active {
  background: rgba(var(--accent-rgb), 0.12);
  border-color: var(--accent);
  color: var(--accent);
}
.outlet-icon { font-size: 14px; }
.outlet-num { font-size: 11px; opacity: 0.65; font-weight: 500; }
/* 形态标记：周刊 / 海报不是帖子流，按「期」出刊 */
.outlet-kind {
  font-size: 9px; font-weight: 800; line-height: 1;
  padding: 2px 4px; border-radius: 4px;
}
.outlet-kind.is-weekly { background: rgba(176, 58, 46, 0.14); color: #b03a2e; }
.outlet-kind.is-poster { background: rgba(47, 75, 216, 0.14); color: #2f4bd8; }
/* 日报入口：外观同其他媒体标签，但它打开的是整版报纸
   —— 用左侧竖线把它与用户自建媒体区隔开，暗示「官方印刷品」 */
.outlet-tab.is-newspaper {
  position: relative;
  border-color: rgba(var(--accent-rgb), 0.32);
  color: var(--text-primary);
}
.outlet-tab.is-newspaper::after {
  content: '';
  position: absolute;
  right: -5px; top: 18%;
  width: 1px; height: 64%;
  background: var(--glass-border);
}
.outlet-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--danger);
  flex-shrink: 0;
}

/* ── 板块 chip ── */
.board-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 20px 12px;
  flex-shrink: 0;
}
/* 期号导航：与板块栏同一位置与节奏（数字报刊用它替代板块栏） */
.issue-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 20px 12px;
  flex-shrink: 0;
}
.board-label { font-weight: 500; }
.board-count { font-size: 11px; opacity: 0.7; margin-left: 5px; }

/* ── 周刊 / 海报：全宽版式列表 ──
   限宽居中 —— 这两类版式是"印刷品"排版，铺满 1920px 会极难读 */
.special-list {
  display: flex; flex-direction: column; gap: 18px;
  padding: 0 20px;
  /* ★ 容器放开到整宽。原来这里是 max-width:880px 居中，门户的横版卡片网格被卡在
     880px 里只能排 2 列，1920 屏两侧各空 520px —— 正是这次改造要解决的问题。
     旧版式（周刊/海报）的窄栏改由 .special-wrap.is-weekly/.is-poster 自己守。 */
  width: 100%;
  box-sizing: border-box;
}

/* ── 瀑布流（CSS 多列，卡片高度自然错落）── */
.masonry {
  column-count: 4;
  column-gap: 14px;
  padding: 0 20px;
}
@media (max-width: 1500px) { .masonry { column-count: 3; } }
@media (max-width: 1050px) { .masonry { column-count: 2; } }
@media (max-width: 700px)  { .masonry { column-count: 1; } }

.post-card {
  break-inside: avoid;
  margin-bottom: 14px;
  border-radius: 14px;
  overflow: hidden;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.post-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-md); }
/* 角色本人的帖子描一圈主题色，一眼区分 */
.post-card.is-char { border-color: rgba(var(--accent-rgb), 0.4); }

/* 封面统一 3:2。
   原来用原图比例（height:auto），生图是 4:3 → 封面 272px 比列宽（约 247px）还高，
   整页被拉得极长；而没图的帖子只有 132px，两者差 140px，多列布局下参差不齐。
   统一比例后：①卡片高度一致 ②一屏能看到更多 ③横版更像信息流。
   3:2 而非 16:9 —— 只裁掉约 11%，AI 插画的主体基本不会丢。 */
.post-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 2;
  overflow: hidden;
  background: var(--bg-tertiary);
}
.post-cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
/* 无图占位：与图片封面同尺寸，内容垂直居中（否则字挤在顶部、下面一大片空） */
.cover-ph {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; justify-content: center; gap: 8px;
  padding: 20px 16px;
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.16), rgba(var(--accent-rgb), 0.04));
}
.cover-ph-outlet { font-size: 11px; color: var(--accent); font-weight: 600; }
.cover-ph-title {
  font-size: 15px; font-weight: 700; color: var(--text-bright); line-height: 1.55;
  display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;
}
.cover-likes {
  position: absolute;
  top: 8px; left: 8px;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px; font-weight: 700;
  backdrop-filter: blur(4px);
}
.cover-board {
  position: absolute;
  right: 8px; bottom: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 10px; font-weight: 600;
  backdrop-filter: blur(4px);
}

/* ── 卡片悬浮操作（重新生图 / 删除）── */
.cover-ops {
  position: absolute;
  top: 8px; right: 8px;
  display: flex; gap: 5px;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.post-card:hover .cover-ops,
.post-card:focus-within .cover-ops { opacity: 1; transform: translateY(0); }
/* 触屏没有 hover → 常显，否则按不到 */
@media (hover: none) {
  .cover-ops { opacity: 1; transform: none; }
}
.cover-op {
  width: 30px; height: 30px;
  /* ★ 必须显式清掉全局 `button { padding: 7px 14px }`（styles/base.css）。
     配合 `* { box-sizing: border-box }`，26px 宽的按钮减去左右各 14px 内边距后
     内容宽度正好是 0 —— 图标会被压成 0 宽彻底看不见，只剩一个空白方块。 */
  padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 9px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.15s, transform 0.15s;
  -webkit-tap-highlight-color: transparent;
}
/* 图标给足尺寸并禁止收缩：flex 容器里 svg 默认 flex-shrink:1，容器一紧就被压扁 */
.cover-op svg {
  width: 17px; height: 17px;
  flex: none;
}
.cover-op:hover:not(:disabled) { background: rgba(0, 0, 0, 0.8); transform: scale(1.08); }
.cover-op.is-danger:hover:not(:disabled) { background: rgba(198, 52, 52, 0.95); }
.cover-op:disabled { opacity: 0.45; cursor: default; }

/* ── 工具条：左上角「批量操作」 ── */
/* ── 批量模式操作条 ──
   只在进入批量模式后渲染（入口按钮在右上角「媒体设置」旁），所以这里不再需要上下留白
   去撑一行空白 —— 之前它常驻时顶部会多出一条空行，和分类/板块栏叠在一起显得挤。 */
/* 批量模式操作条 —— 与媒体标签同一行，**整条靠右**（justify-content: flex-end）。
   不再用 spacer 做两端分布：用户要的是贴右、与上方标签行右端对齐。
   padding 与 .outlet-bar 的上下留白一致，靠 .outlet-row 的 align-items:center 垂直居中。 */
.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}
.batch-btn {
  /* ★ 必须显式 padding —— 全局 button 有 padding:7px 14px，小按钮会被撑变形 */
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 11px;
  border: 1px solid var(--glass-border);
  border-radius: 9px;
  background: none;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.batch-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); background: rgba(var(--accent-rgb), 0.06); }
.batch-btn:disabled { opacity: 0.4; cursor: default; }
.batch-btn.is-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
.batch-btn.is-danger:hover:not(:disabled) { color: #fff; background: var(--danger); border-color: var(--danger); }
.batch-count { font-size: 12px; color: var(--text-secondary); }
.batch-count b { color: var(--accent); font-weight: 600; }

/* ── 卡片勾选框（批量模式） ── */
.pick-box {
  width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  backdrop-filter: blur(3px);
  transition: background 0.15s, border-color 0.15s;
}
.pick-box.on { background: var(--accent); border-color: var(--accent); }
.post-card .pick-box {
  position: absolute;
  top: 8px; left: 8px;
  z-index: 3;
}
/* 批量模式下卡片右上角的单条操作藏起来，避免与批量操作混淆 */
.post-card.is-selecting .cover-ops { display: none; }
.post-card.is-selecting { cursor: pointer; }
.post-card.is-picked { outline: 2px solid var(--accent); outline-offset: -2px; }
.post-card.is-picked .post-cover { opacity: 0.82; }

/* ── 周刊/海报的勾选行（整幅版式不适合在图上贴勾选框） ── */
.special-pick {
  display: inline-flex; align-items: center; gap: 8px;
  align-self: flex-start;
  max-width: 100%;
  padding: 5px 11px;
  border: 1px solid var(--glass-border);
  border-radius: 9px;
  background: none;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.special-pick:hover { color: var(--accent); border-color: var(--accent); }
.special-pick.on { color: var(--accent); border-color: var(--accent); background: rgba(var(--accent-rgb), 0.08); }
/* 这里的勾选框在浅色卡片外，用主题描边而不是白色描边 */
.special-pick .pick-box { background: none; border-color: var(--glass-border); color: var(--accent); }
.special-pick .pick-box.on { background: var(--accent-solid); border-color: var(--accent); color: #fff; }
.special-pick-title {
  min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.special-wrap.is-picked { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 14px; }

/* ── 周刊/海报：整幅版式 + 下方操作条 ── */
.special-wrap { display: flex; flex-direction: column; gap: 8px; }
/* 周刊仍是按 880px 设计的竖排文稿版式，保持窄栏居中 —— 拉满宽屏会显得空。 */
.special-wrap.is-weekly {
  max-width: 880px;
  margin: 0 auto;
  width: 100%;
}
/* 海报（2026-10-05 改横版后）与门户一样吃满宽屏：
   海报改成"左主图 + 右信息栏"的横版头版后，再按 880px 居中会在宽屏两侧各空 ~500px
   —— 正是这次改版要解决的空白。版式自身在窄容器里会由 container query 退回竖排，
   所以放开宽度不会把内容挤坏（详情弹窗、手机仍走竖版）。 */
.special-wrap.is-poster,
.special-wrap.is-portal { max-width: none; }
.special-ops {
  display: flex; align-items: center; gap: 10px;
  padding: 0 2px;
}
.special-open {
  font-size: 12px; color: var(--text-secondary); cursor: pointer;
  padding: 4px 8px; border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}
.special-open:hover { color: var(--accent); background: rgba(var(--accent-rgb), 0.08); }

/* ── 详情弹窗顶部操作条 ── */
.detail-ops {
  display: flex; align-items: center; gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
/* 详情里的版式：去掉外投影（弹窗内已经有层次了） */
.mp-detail-panel :deep(.weekly),
.mp-detail-panel :deep(.poster) { box-shadow: none; border-radius: 10px; }

.post-body { padding: 10px 12px 12px; }
.post-author { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.author-avatar {
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; flex-shrink: 0;
  background: var(--accent-solid); color: #fff;
  font-size: 11px; font-weight: 700;
}
.author-avatar img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
.author-avatar.is-char { box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.35); }
.author-name { font-size: 12px; color: var(--text-secondary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.author-name.is-char { color: var(--accent); font-weight: 600; }
.author-badge {
  flex-shrink: 0;
  font-size: 9px; font-weight: 700;
  padding: 1px 5px; border-radius: 4px;
  background: rgba(var(--accent-rgb), 0.16); color: var(--accent);
}

.post-title { margin: 0 0 5px; font-size: 14px; font-weight: 700; color: var(--text-bright); line-height: 1.45; }
/* 摘要 3 行（原 4 行）：与固定比例封面配合，让整列卡片高度更接近，减少参差 */
.post-excerpt {
  margin: 0; font-size: 12px; line-height: 1.65; color: var(--text-secondary);
  display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.post-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.tag { font-size: 10px; color: var(--accent); background: rgba(var(--accent-rgb), 0.08); padding: 1px 6px; border-radius: 5px; }
.post-foot { display: flex; gap: 12px; margin-top: 9px; font-size: 11px; color: var(--text-secondary); opacity: 0.75; }
.foot-item { display: inline-flex; align-items: center; gap: 3px; }

/* ── 空 / 加载 ── */
.media-empty { padding: 60px 24px; text-align: center; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin: 0 0 8px; }
.empty-hint { font-size: 12px; color: var(--text-secondary); opacity: 0.75; line-height: 1.7; margin: 0 auto; max-width: 460px; }
.empty-retry { margin-top: 14px; }
.media-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 50px; font-size: 13px; color: var(--text-secondary); }
.spinner {
  width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid rgba(var(--accent-rgb), 0.2); border-top-color: var(--accent);
  animation: media-spin 0.7s linear infinite;
}
@keyframes media-spin { to { transform: rotate(360deg); } }
.load-more { text-align: center; padding: 20px; font-size: 12px; color: var(--accent); cursor: pointer; }
.load-more.is-end { color: var(--text-secondary); opacity: 0.6; cursor: default; }

/* ── 帖子详情 ── */
.post-detail { display: flex; flex-direction: column; gap: 12px; }
.detail-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.detail-author { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--text-bright); }
.detail-stats { font-size: 12px; color: var(--text-secondary); }
.detail-img { width: 100%; border-radius: 12px; display: block; }
/* 图库条目：图就是主体 —— 限高并把点击放大做实（cursor/边框） */
.detail-img.is-gallery {
  max-height: 70vh; width: auto; max-width: 100%; margin: 0 auto;
  object-fit: contain; cursor: zoom-in;
  border: 1px solid var(--border);
}
.detail-content { margin: 0; font-size: 13px; line-height: 1.85; color: var(--text-primary); white-space: pre-wrap; }
.detail-stats-row { display: flex; gap: 16px; font-size: 12px; color: var(--text-secondary); }
/* 图库（规则34）本条随机到的生成参数 */
.gallery-params {
  display: flex; flex-wrap: wrap; gap: 8px 18px;
  padding: 9px 12px; border-radius: var(--radius-md);
  background: var(--bg-sunken); border: 1px solid var(--border);
  font-size: var(--fs-xs); color: var(--text-secondary);
}
.gp-item { display: inline-flex; align-items: baseline; gap: 6px; min-width: 0; }
.gp-item b { color: var(--accent); font-weight: 600; flex-shrink: 0; }
.gp-artist { min-width: 0; }
.gp-artist { overflow-wrap: anywhere; }
/* 环境层那一行：8 个维度并排，密一点，与上面「体位/画幅/画师串」分开成块 */
.gallery-env { margin-top: 8px; gap: 6px 16px; }
.gallery-env .gp-item b { color: var(--accent-3); }
.comment-list { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border); }
.comment-item { display: flex; gap: 8px; font-size: 12px; line-height: 1.7; }
.comment-author { flex-shrink: 0; font-weight: 600; color: var(--accent); }
.comment-text { color: var(--text-secondary); }
.comment-empty { font-size: 12px; color: var(--text-secondary); opacity: 0.7; }

@media (max-width: 767px) {
  .media-header { padding: 8px 12px; gap: 8px; }
  .btn-mobile-back { width: 34px; height: 34px; }
  .btn-op, .btn-refresh { padding: 6px 12px; }
  /* 窄屏顶栏挤：帖子总数去掉（分类标签上已有数字） */
  .media-count { display: none; }
  /* 刷新面板（.freq-panel）窄屏收窄内边距（自动抓帖 chip 已搬到设置页，这里只剩它） */
  .freq-panel { padding: 10px 14px 12px; }
  /* 分类三档放不下 → 缩小 + 去掉图标，横向滚动 */
  .cat-bar { gap: 0; }
  .cat-tab { padding: 7px 9px; font-size: 12px; gap: 4px; }
  .cat-icon { display: none; }
  .cat-num { padding: 1px 5px; font-size: 10px; }
  /* 移动端：标签行左侧留白收窄；批量操作条仍与它同一行（窄屏下标签会横向滚动） */
  .outlet-row { padding-right: 14px; gap: 6px; }
  .outlet-bar { padding: 10px 0 8px 14px; }
  .list-toolbar { gap: 6px; }
  .np-entry-wrap { padding: 12px 14px; }
  .np-entry { padding: 16px; gap: 12px; }
  .np-entry-icon { font-size: 26px; }
  .np-entry-title { font-size: 15px; }
  .np-entry-go { display: none; }
  .board-bar { padding: 0 14px 10px; }
  .masonry { padding: 0 14px; }
  .special-list { padding: 0 14px; gap: 14px; }
}
</style>
