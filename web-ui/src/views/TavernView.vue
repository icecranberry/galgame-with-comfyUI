<template>
  <div class="tavern-view" @scroll="onScroll">
    <div class="page-header" :class="{ 'header-hidden': isMobile && !headerVisible }">
      <h2 @click="isMobile && toggleMobileSidebar?.()" :class="{ 'is-clickable': isMobile }">酒馆</h2>
    </div>

    <!-- ═══════════════════════════════════════════
         用户信息卡片
         ═══════════════════════════════════════════ -->
    <div class="user-row-wrapper">
      <div class="user-row card">
        <div
          class="user-avatar clickable"
          :style="userAvatarStyle"
          @click="showUserAvatarPicker = true"
        >{{ userAvatar ? '' : '我' }}</div>
        <div class="user-info">
        <!-- 姓名 -->
        <div class="user-field-row">
          <span class="field-label">称呼</span>
          <div class="field-value-wrap">
            <input
              v-if="editingNickname"
              ref="nicknameInput"
              v-model="userNicknameInput"
              class="inline-input nickname-input"
              @blur="saveNickname"
              @keydown.enter="saveNickname"
              placeholder="给自己起个名字"
            />
            <span v-else class="field-value" @click="startEditNickname">{{ userNickname || '给自己起个名字' }}</span>
            <div v-if="!editingNickname" class="edit-pen" role="button" tabindex="0" @click="startEditNickname" @keydown.enter.prevent="startEditNickname" @keydown.space.prevent="startEditNickname" title="编辑称呼">✎</div>
          </div>
        </div>
        <!-- 性别 -->
        <div class="user-field-row">
          <span class="field-label">性别</span>
          <div class="field-value-wrap">
            <input
              v-if="editingGender"
              ref="genderInput"
              v-model="userGenderInput"
              class="inline-input field-input"
              @blur="saveGender"
              @keydown.enter="saveGender"
              placeholder="男 / 女 / ..."
            />
            <span v-else class="field-value" @click="startEditGender">{{ userGender || '点击设置性别...' }}</span>
            <div v-if="!editingGender" class="edit-pen" role="button" tabindex="0" @click="startEditGender" @keydown.enter.prevent="startEditGender" @keydown.space.prevent="startEditGender" title="编辑性别">✎</div>
          </div>
        </div>
        <!-- 外观特征 -->
        <div class="user-field-row">
          <span class="field-label">外观描述</span>
          <div class="field-value-wrap">
            <textarea
              v-if="editingAppearance"
              ref="appearanceInput"
              v-model="userAppearanceInput"
              class="inline-input field-textarea"
              rows="2"
              @blur="saveAppearance"
              @keydown.enter.exact="saveAppearance"
              @keydown.escape="cancelEditAppearance"
              placeholder="外观描述越紧密越不容易和其他角色串，示例：小明（←改成你的名字）来自原创角色，小明（←改成你的名字）是长着金色头发的贫乳大小姐，穿着白色蕾丝洛丽塔"
            ></textarea>
            <span v-else class="field-value" @click="startEditAppearance">{{ userAppearance || '点击描述你的外貌特征...' }}</span>
            <div v-if="!editingAppearance" class="edit-pen" role="button" tabindex="0" @click="startEditAppearance" @keydown.enter.prevent="startEditAppearance" @keydown.space.prevent="startEditAppearance" title="编辑外观">✎</div>
          </div>
        </div>
        <!-- 其他说明 -->
        <div class="user-field-row">
          <span class="field-label">其他</span>
          <div class="field-value-wrap">
            <textarea
              v-if="editingPersona"
              ref="personaInput"
              v-model="userPersonaInput"
              class="inline-input field-textarea"
              rows="2"
              @blur="savePersona"
              @keydown.enter.exact="savePersona"
              @keydown.escape="cancelEditPersona"
              placeholder="性格、身份、经历等补充信息"
            ></textarea>
            <span v-else class="field-value" @click="startEditPersona">{{ userPersona || '点击补充其他信息...' }}</span>
            <div v-if="!editingPersona" class="edit-pen" role="button" tabindex="0" @click="startEditPersona" @keydown.enter.prevent="startEditPersona" @keydown.space.prevent="startEditPersona" title="编辑其他说明">✎</div>
          </div>
        </div>
      </div>
      </div>
      <div v-if="!isMobile" class="mailbox-card card" @click="showMailbox = true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <path d="M2 4L12 13L22 4"/>
        </svg>
        <span class="mailbox-label">信箱</span>
        <span v-if="mailboxUnread > 0" class="mailbox-badge">{{ mailboxUnread > 99 ? '99+' : mailboxUnread }}</span>
      </div>
      <div v-if="!isMobile" class="backpack-card card" @click="showBackpack = true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 9a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1H4V9z"/>
          <path d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z"/>
          <path d="M10 13h4"/>
        </svg>
        <span class="mailbox-label">背包</span>
        <span v-if="backpackChestReady" class="mailbox-badge backpack-dot" title="宝箱已就绪"></span>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════
         入口卡片行：我的关系图 / 世界观设置（各占一半）
         《邻舍日报》已并入「传媒」页（见 NavBar 的传媒标签）
         ═══════════════════════════════════════════ -->
    <div class="relation-entry-row">
      <div class="relation-entry card" @click="showUserRelationGraph = true">
        <div class="relation-entry-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
            <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
          </svg>
        </div>
        <div class="relation-entry-text">
          <span class="relation-entry-title">我的关系图</span>
          <span class="relation-entry-hint">查看和管理你与所有角色的关系</span>
        </div>
        <span class="relation-entry-arrow">›</span>
      </div>

      <div class="relation-entry card" @click="openWorldSetting">
        <div class="relation-entry-icon world-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <ellipse cx="12" cy="12" rx="4" ry="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <line x1="12" y1="2" x2="12" y2="22"/>
          </svg>
        </div>
        <div class="relation-entry-text">
          <span class="relation-entry-title">世界观设置</span>
          <span class="relation-entry-hint">{{ activeWorldName || '定义所有角色共处的世界背景' }}</span>
        </div>
        <span class="relation-entry-arrow">›</span>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════
         角色卡片网格
         ═══════════════════════════════════════════ -->
    <div class="char-toolbar">
      <div class="section-title">角色 ({{ charCountLabel }})</div>
      <div class="char-toolbar-right">
        <div
          class="char-archive-all"
          :title="archivedCount > 0
            ? `已归档 ${archivedCount} 个角色：它们不参与任何主动活动，你找它们聊天仍会回复`
            : '一键让所有角色不参与任何主动活动（主动聊天、朋友圈、奇遇、日程生成、拉群）'"
        >
          <span class="char-archive-all-label">全部不参与活动</span>
          <span v-if="archivedCount > 0" class="char-archive-all-count">{{ archivedCount }}/{{ chat.characters.length }}</span>
          <linshe-switch
            :model-value="allArchived"
            :disabled="archiveAllToggling"
            size="sm"
            @change="toggleAllArchived"
            aria-label="全部不参与活动"
          />
          <!-- 部分归档时开关键得点两下才能全恢复，给个直达入口 -->
          <linshe-button
            v-if="archivedCount > 0 && !allArchived"
            variant="link"
            size="sm"
            :disabled="archiveAllToggling"
            @click="toggleAllArchived(false)"
          >全部恢复</linshe-button>
        </div>
        <div class="char-search">
          <linshe-input
            v-model="charSearch"
            size="sm"
            class="char-search-input"
            placeholder="搜索角色名..."
          />
          <div
            v-if="charSearch"
            class="char-search-clear"
            role="button"
            tabindex="0"
            title="清空搜索"
            @click="charSearch = ''"
            @keydown.enter.prevent="charSearch = ''"
            @keydown.space.prevent="charSearch = ''"
          >✕</div>
        </div>
      </div>
    </div>
    
    <!-- ═══════════════════════════════════════════
         文件夹筛选栏（单层分类：全部 / 未分类 / 各文件夹）
         ═══════════════════════════════════════════ -->
    <div v-if="folderFeatureReady" class="folder-bar">
      <div
        class="chip folder-chip"
        :class="{ active: folderFilter === 'all' }"
        role="button"
        tabindex="0"
        @click="folderFilter = 'all'"
        @keydown.enter.prevent="folderFilter = 'all'"
        @keydown.space.prevent="folderFilter = 'all'"
      >
        全部<span class="folder-chip-count">{{ activeCharacters.length }}</span>
      </div>
      <div
        class="chip folder-chip"
        :class="{ active: folderFilter === 'uncategorized' }"
        role="button"
        tabindex="0"
        @click="folderFilter = 'uncategorized'"
        @keydown.enter.prevent="folderFilter = 'uncategorized'"
        @keydown.space.prevent="folderFilter = 'uncategorized'"
      >
        未分类<span class="folder-chip-count">{{ uncategorizedCount }}</span>
      </div>
      <!-- 归档管理：归档角色只在「全部 / 未分类 / 各文件夹」之外的这一处集中出现，
           免得几十个压暗的卡片混在活跃角色里（见 folderScopedCharacters） -->
      <div
        v-if="archivedCharacters.length > 0"
        class="chip folder-chip folder-chip-archived"
        :class="{ active: folderFilter === 'archived' }"
        role="button"
        tabindex="0"
        title="集中管理已归档角色：它们不参与任何主动活动，你找它们聊天仍会回复"
        @click="folderFilter = 'archived'"
        @keydown.enter.prevent="folderFilter = 'archived'"
        @keydown.space.prevent="folderFilter = 'archived'"
      >
        <svg class="folder-chip-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="4" rx="1"/>
          <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/>
          <path d="M10 12h4"/>
        </svg>
        归档管理<span class="folder-chip-count">{{ archivedCharacters.length }}</span>
      </div>
      <div
        v-for="f in folders"
        :key="f.id"
        class="chip folder-chip"
        :class="{
          active: folderFilter === f.id,
          'is-dragging': dragFolderId === f.id,
          'is-drop-target': dragOverFolderId === f.id,
        }"
        draggable="true"
        role="button"
        tabindex="0"
        title="点击筛选，按住拖动可调整顺序"
        @click="folderFilter = f.id"
        @keydown.enter.prevent="folderFilter = f.id"
        @keydown.space.prevent="folderFilter = f.id"
        @dragstart="onFolderDragStart($event, f)"
        @dragover="onFolderDragOver($event, f)"
        @dragleave="onFolderDragLeave(f)"
        @drop.prevent="onFolderDrop($event, f)"
        @dragend="onFolderDragEnd"
      >
        <span class="folder-chip-name">{{ f.name }}</span>
        <span class="folder-chip-count">{{ folderCountOf(f.id) }}</span>
        <template v-if="folderFilter === f.id">
          <span
            class="chip-x folder-chip-op"
            role="button"
            tabindex="0"
            title="重命名文件夹"
            @click.stop="openRenameFolder(f)"
            @keydown.enter.stop.prevent="openRenameFolder(f)"
            @keydown.space.stop.prevent="openRenameFolder(f)"
          >✎</span>
          <span
            class="chip-x folder-chip-op"
            role="button"
            tabindex="0"
            title="删除文件夹（角色回到未分类）"
            @click.stop="askDeleteFolder(f)"
            @keydown.enter.stop.prevent="askDeleteFolder(f)"
            @keydown.space.stop.prevent="askDeleteFolder(f)"
          >✕</span>
        </template>
      </div>
      <div
        class="chip folder-chip folder-chip-new"
        role="button"
        tabindex="0"
        @click="openNewFolder"
        @keydown.enter.prevent="openNewFolder"
        @keydown.space.prevent="openNewFolder"
      >＋ 新建文件夹</div>
    </div>

    <TransitionGroup name="char-pin" tag="div" class="char-grid" :class="{ stagger: gridStagger }">
        <!-- 表情包管理入口：永远在招募前 -->
        <div key="emoji-manage" class="char-card emoji-manage-card" @click="showEmojiManager = true">
          <div class="emoji-manage-icon">
            <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
              <path d="M334.711467 160.290133a413.013333 413.013333 0 0 1 239.547733-48.674133 37.614933 37.614933 0 0 1-7.509333 74.683733A338.056533 338.056533 0 0 0 197.973333 567.022933a337.92 337.92 0 0 0 672.9728-42.5984v-37.546666a37.546667 37.546667 0 1 1 75.093334 0v37.751466a413.013333 413.013333 0 1 1-611.328-364.3392z"/>
              <path d="M653.312 576.853333a37.546667 37.546667 0 0 1 59.938133 45.192534l-0.2048 0.273066-0.273066 0.341334-0.8192 1.024a141.585067 141.585067 0 0 1-11.946667 13.5168 261.12 261.12 0 0 1-34.679467 30.242133c-29.9008 21.777067-75.093333 44.714667-132.3008 44.714667-57.344 0-102.4-22.9376-132.437333-44.714667a261.256533 261.256533 0 0 1-43.895467-40.5504l-2.730666-3.208533-0.682667-1.024a19.0464 19.0464 0 0 0-0.341333-0.341334v-0.136533l-0.2048-0.136533a37.546667 37.546667 0 0 1 60.074666-45.056h0.068267l1.297067 1.6384a186.1632 186.1632 0 0 0 30.72 28.0576c21.572267 15.7696 51.541333 30.446933 88.064 30.446933 36.6592 0 66.628267-14.677333 88.2688-30.446933a186.026667 186.026667 0 0 0 30.583466-27.989334l1.297067-1.6384 0.2048-0.2048zM420.727467 374.237867a37.546667 37.546667 0 0 1 0 75.093333h-0.341334a37.546667 37.546667 0 0 1 0-75.093333h0.341334z m225.28 0a37.546667 37.546667 0 0 1 0 75.093333h-0.4096a37.546667 37.546667 0 0 1 0-75.093333h0.4096z m112.298666 0v-75.093334h-75.093333a37.546667 37.546667 0 0 1 0-75.093333h75.093333v-75.093333a37.546667 37.546667 0 0 1 75.093334 0v75.093333h75.093333a37.546667 37.546667 0 0 1 0 75.093333h-75.093333v75.093334a37.546667 37.546667 0 1 1-75.093334 0z"/>
            </svg>
          </div>
          <span>表情包管理</span>
        </div>

      <div key="standing-manage" class="char-card emoji-manage-card standing-manage-card" role="button" tabindex="0" @click="showStandingManager = true" @keydown.enter.prevent="showStandingManager = true" @keydown.space.prevent="showStandingManager = true">
        <div class="emoji-manage-icon">
          <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="10" r="6" />
            <circle cx="10" cy="9" r=".9" fill="currentColor" stroke="none" />
            <path d="m14 8.5 1.5 1M10 12.5q2 2 4 0" stroke-width="1.7" />
            <path d="M4 25v-2a7 7 0 0 1 7-7h2c4 0 5 4 8 4s5-3 5-6M8 24v4h10v-5M24 5h6M27 2v6" />
          </svg>
        </div>
        <span>立绘管理</span>
      </div>

      <!-- 招募卡片：管理入口之后 -->
      <div key="recruit" class="char-card recruit-card" @click="openRecruit">
        <div class="recruit-plus">+</div>
        <span>招募</span>
      </div>

      <!-- 角色卡片 -->
      <div
        v-for="c in visibleCharacters"
        :key="c.id"
        class="char-card"
        :class="{ archived: c.archived }"
        @click="openCharDetail(c)"
      >
        <!-- 左上角置顶按钮 -->
        <div
          class="char-pin-btn"
          :class="{ pinned: c.pinned, 'like-burst': burstKey === c.id }"
          role="button"
          tabindex="0"
          :title="c.pinned ? '取消置顶' : '置顶'"
          @click.stop="onPinClick(c)"
          @keydown.enter.prevent="onPinClick(c)"
          @keydown.space.prevent="onPinClick(c)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" :fill="c.pinned ? 'currentColor' : 'none'" :stroke="c.pinned ? 'none' : 'currentColor'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </div>
        <!-- 文件夹入口（左上侧栏，与置顶按钮同列） -->
        <div
          v-if="folderFeatureReady"
          class="char-folder-btn"
          :class="{ 'has-folder': c.folder_id }"
          role="button"
          tabindex="0"
          :title="c.folder_id ? `已归入「${folderName(c.folder_id)}」 · 点击移动` : '移入文件夹'"
          @click.stop="openMoveFolder(c)"
          @keydown.enter.stop.prevent="openMoveFolder(c)"
          @keydown.space.stop.prevent="openMoveFolder(c)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
          </svg>
        </div>
        <div v-if="c.moments_disabled || c.proactive_disabled || c.events_disabled" class="char-card-badges">
          <span v-if="c.moments_disabled" class="char-status-dot dot-moments" title="不看ta的朋友圈"></span>
          <span v-if="c.proactive_disabled" class="char-status-dot dot-proactive" title="不主动聊天"></span>
          <span v-if="c.events_disabled" class="char-status-dot dot-events" title="不发生奇遇"></span>
        </div>
        <div
          class="char-card-avatar"
          :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: 'var(--accent)' }"
        >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
        <div class="char-card-name">{{ c.display_name }}</div>
        <div v-if="c.archived" class="char-card-archived" title="已归档：不参与任何主动活动">已归档</div>
        <!-- 归档管理视图里直接给「取消归档」，免得逐个点进详情卡去关开关 -->
        <div
          v-if="folderFilter === 'archived'"
          class="char-unarchive-btn"
          role="button"
          tabindex="0"
          :class="{ 'is-busy': unarchiveBusyId === c.id }"
          :title="`让「${c.display_name}」重新参与活动`"
          @click.stop="onUnarchive(c)"
          @keydown.enter.stop.prevent="onUnarchive(c)"
          @keydown.space.stop.prevent="onUnarchive(c)"
        >{{ unarchiveBusyId === c.id ? '恢复中…' : '取消归档' }}</div>
        <div class="char-card-foot">
          <span class="char-card-status" :class="c.message_count > 0 ? 'active' : 'idle'">
            {{ c.message_count > 0 ? `${c.message_count} 条消息` : '待唤醒' }}
          </span>
          <span v-if="c.relationship_count > 0" class="char-rel-badge" title="已设置角色关系">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
              <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
            </svg>
            {{ c.relationship_count }}
          </span>
        </div>
        <div v-if="!(c.relationship_count > 0)" class="char-card-edit-row">
          <span class="char-card-edit" title="设置角色关系网">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
              <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
            </svg>
            设置角色关系网
          </span>
        </div>
      </div>
    </TransitionGroup>

    <!-- 空状态：文件夹内无角色 / 搜索无匹配 -->
    <div v-if="!visibleCharacters.length" class="char-empty empty">
      <div class="empty-title">{{ emptyTitle }}</div>
      <div class="empty-hint">{{ emptyDesc }}</div>
      <linshe-button
        v-if="canSearchEverywhere"
        variant="secondary"
        size="sm"
        @click="folderFilter = 'all'"
      >在全部角色中搜索</linshe-button>
    </div>

    <!-- ═══════════════════════════════════════════
         招募弹窗
         ═══════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="recruit.show" class="modal-overlay">
          <div class="modal-panel modal-wide">
            <div class="modal-header">
              <h3>招募新角色</h3>
              <linshe-button class="modal-close" variant="icon" @click="closeRecruit">✕</linshe-button>
            </div>

            <!-- 步骤 0：输入描述 -->
            <div v-if="recruit.step === 'input'" class="modal-body" style="position:relative;background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:14px;padding:18px;margin:0 20px 20px">
              <p class="modal-hint">描述你想招募的角色——可以是知名 IP 角色（尽可能输入全名+IP），也可以是原创设定。</p>
              <linshe-input
                type="textarea"
                v-model="recruit.desc"
                class="recruit-textarea"
                rows="4"
                placeholder="例：安比·德玛拉（绝区零）/ 流萤，星穹铁道/ 御坂美琴《某科学的超电磁炮》/ 傲娇的猫娘女仆 / 金发双马尾大小姐，品学兼优，爱好摇滚，穿着涩谷辣妹风"
                :disabled="recruit.loading"
                @keydown.enter.exact="doGenerate"
              />
              <div class="modal-actions">
                <label class="import-card-btn" :class="{ disabled: recruit.loading }" title="导入酒馆ai角色卡">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <span>导入酒馆ai角色卡</span>
                  <input ref="cardInputRef" type="file" accept=".png,.json,image/png,application/json" :disabled="recruit.loading" @change="onCardSelected" hidden />
                </label>
                <linshe-button variant="secondary" @click="closeRecruit">取消</linshe-button>
                <linshe-button
                  variant="primary"
                  :disabled="!recruit.desc.trim() || recruit.loading"
                  @click="doGenerate"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.1 6.4L20.5 12l-6.4 2.6L12 21l-2.1-6.4L3.5 12l6.4-2.6z" /></svg>
                  {{ recruit.loading ? '正在酒馆招募...' : '招募角色' }}
                </linshe-button>
              </div>
<div v-if="recruit.error" class="gen-error">{{ recruit.error }}</div>
              <!-- 招募加载遮罩 -->
              <div v-if="recruit.loading" class="scan-overlay">
                <div class="scan-line"></div>
                <div class="scan-text">{{ loadingTip }}</div>
              </div>
            </div>

            <!-- 步骤 1：预览确认 -->
            <div v-if="recruit.step === 'preview'" class="modal-body" style="position:relative">
              <div class="preview-card">
                <div class="preview-name-row">
                  <linshe-input
                    v-model="recruit.result.display_name"
                    class="preview-name-input"
                    placeholder="角色名"
                  />
                  <linshe-input
                    v-model="recruit.result.name"
                    class="preview-name-input"
                    placeholder="英文名（英文/拼音，唯一）"
                  />
                </div>
                <div class="preview-prompt-label">-</div>
                <linshe-input type="textarea" v-model="recruit.result.base_prompt" class="prompt-textarea" rows="12" />

                <!-- 朋友圈开关 -->
              </div>
              <div class="modal-actions modal-actions-between">
                <div class="modal-actions-left">
                  <linshe-button
                    variant="secondary"
                    :disabled="recruit.loading"
                    @click="doGenerate"
                  >{{ recruit.loading && recruit.task === 'search' ? '正在重新搜索...' : '重新搜索' }}</linshe-button>
                  <linshe-button
                    variant="secondary"
                    title="不重新联网，使用上次搜索资料重新归纳角色卡"
                    :disabled="!recruit.searchContext || recruit.loading"
                    @click="regenerateFromSearchResult"
                  >{{ recruit.loading && recruit.task === 'regenerate' ? '正在重新归纳...' : '再次生成' }}</linshe-button>
                  <linshe-button
                    variant="secondary"
                    title="提供参考图，邻舍分析后重写角色卡里的「## 你的外观」"
                    :disabled="recruit.loading"
                    @click="showRecruitRefine = true"
                  >修正外观</linshe-button>
                </div>
                <div class="modal-actions-right">
                  <linshe-button variant="secondary" @click="recruit.step = 'input'; recruit.error = ''">返回修改</linshe-button>
                  <linshe-button variant="primary" :disabled="recruit.saving" @click="confirmRecruit">
                    {{ recruit.saving ? '招募中...' : '确认招募' }}
                  </linshe-button>
                </div>
              </div>
              <div v-if="recruit.error" class="gen-error">{{ recruit.error }}</div>
              <!-- 扫描动画覆盖层 -->
              <div v-if="recruit.loading" class="scan-overlay">
                <div class="scan-line"></div>
                <div class="scan-text">{{ loadingTip }}</div>
              </div>
              <div v-if="recruit.result" class="recruit-appearance-hint">
                检查外观描述，可以写的少但是更需要准确，可通过「修正外观」按钮用参考图修复，
                <a :href="`https://animadex.net/?mode=characters&q=${encodeURIComponent(recruit.result.name).replaceAll('_', '+')}`" target="_blank">animadex</a>直接补充tag
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 招募预览的修正外观：结果回填到待确认的角色卡草稿（尚未创建角色，无最近图片入口） -->
    <AppearanceRefineModal
      v-model="showRecruitRefine"
      :display-name="recruit.result?.display_name || ''"
      :base-prompt="recruit.result?.base_prompt || ''"
      apply-text="应用到角色卡"
      apply-hint="应用后会回填到上方的待确认角色卡"
      @applied="onRecruitAppearanceRefined"
    />

    <!-- ═══════════════════════════════════════════
         世界观设置弹窗
         ═══════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showWorldModal" class="modal-overlay" @mousedown.self="closeWorldSetting">
          <div class="modal-panel world-modal-panel">
            <div class="modal-header world-modal-header">
              <div class="world-modal-title">
                <h3>世界观设置</h3>
                <span class="world-modal-subtitle">定义所有角色共处的世界背景</span>
              </div>
              <div class="world-header-right">
                <span v-if="activeWorldName" class="world-active-badge" :title="`当前激活：${activeWorldName}`">● {{ activeWorldName }}</span>
                <linshe-button class="modal-close" variant="icon" @click="closeWorldSetting">✕</linshe-button>
              </div>
            </div>
            <div class="modal-body">
              <!-- 新建名称输入 -->
              <div v-if="showNewInput" class="world-new-row">
                <linshe-input
                  ref="newNameInput"
                  v-model="worldNewName"
                  class="world-name-input"
                  placeholder="输入新世界观名称"
                  @keyup.enter="confirmNew"
                />
                <linshe-button variant="primary" size="sm" :disabled="!worldNewName.trim()" @click="confirmNew">创建</linshe-button>
                <linshe-button variant="secondary" size="sm" @click="showNewInput = false">取消</linshe-button>
              </div>

              <!-- 标签行 -->
              <div class="world-tags">
                <span
                  v-for="item in worldItems"
                  :key="item.id"
                  class="world-tag"
                  :class="{ 'world-tag-selected': selectedWorldId === item.id }"
                  @click="selectWorld(item)"
                >
                  <input
                    v-if="editingNameId === item.id"
                    ref="editNameInput"
                    v-model="editNameValue"
                    class="world-tag-rename-input"
                    @click.stop
                    @keyup.enter="renameWorld(item)"
                    @keyup.escape="editingNameId = null"
                    @blur="renameWorld(item)"
                  />
                  <span v-else>{{ item.name }}</span>
                  <div
                    class="world-tag-act world-tag-edit"
                    title="重命名"
                    @click.stop="startRename(item)"
                  >✎</div>
                  <div
                    class="world-tag-act world-tag-del"
                    title="删除"
                    @click.stop="handleDelete(item)"
                  >×</div>
                </span>
                <div class="world-tag world-tag-add" @click="startNew">+</div>
              </div>

              <!-- 内容编辑区 -->
              <div class="world-editor">
                <div class="world-editor-bar">
                  <span class="world-editor-label">世界观内容</span>
                  <div class="world-editor-tools">
                    <linshe-button
                      class="btn-polish"
                      variant="secondary"
                      :disabled="polishLoading || !worldContent.trim()"
                      title="AI 按酒馆世界书风格润色扩写当前世界观"
                      @click="openPolish"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.3z"/>
                        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>
                      </svg>
                      一键润色
                    </linshe-button>
                  </div>
                </div>
                <div class="world-editor-body">
                  <linshe-input
                    ref="worldTextareaRef"
                    v-model="worldContent"
                    type="textarea"
                    class="world-textarea"
                    rows="10"
                    placeholder="例如：这是一个低魔世界，魔法师必须养一只不会魔法的宠物当充电宝。/每天凌晨三点，全人类会共享同一个梦，醒后都能记住。"
                    @input="worldDirty = true"
                  />
                </div>
                <div class="world-editor-meta">
                  <span class="world-char-count"></span>
                  <span v-if="worldSaved" class="world-saved-hint">✓ 已保存</span>
                </div>
              </div>

              <div class="modal-actions">
                <linshe-button variant="secondary" @click="closeWorldSetting">取消</linshe-button>
                <linshe-button
                  variant="primary"
                  :disabled="!worldDirty || worldSaving"
                  @click="saveWorld"
                >
                  {{ worldSaving ? '保存中...' : '保存' }}
                </linshe-button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══════════════════════════════════════════
         AI 润色扩写弹窗（世界观）
         ═══════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showPolishModal" class="modal-overlay" @mousedown.self="closePolishModal">
          <div class="modal-panel polish-modal-panel">
            <div class="modal-header">
              <h3>撰写世界观</h3>
              <linshe-button class="modal-close" variant="icon" @click="closePolishModal">✕</linshe-button>
            </div>
            <div class="modal-body">
              <p v-if="!polishLoading && !polishContent && !polishError" class="polish-tip">
                将按酒馆世界书风格润色扩写当前世界观，重点补充「这个世界里的人们会怎么做」。
              </p>

              <!-- 加载中 -->
              <div v-if="polishLoading" class="polish-loading">
                <div class="polish-spinner"></div>
                <p>正在为这个世界起草招募帖…</p>
              </div>

              <!-- 失败重试 -->
              <div v-else-if="polishError" class="polish-error">
                <p class="polish-error-text">{{ polishError }}</p>
                <div class="modal-actions polish-error-actions">
                  <linshe-button variant="primary" size="sm" @click="runPolish">重新生成</linshe-button>
                  <linshe-button variant="secondary" size="sm" @click="closePolishModal">关闭</linshe-button>
                </div>
              </div>

              <!-- 结果预览 -->
              <template v-else-if="polishContent">
                <div class="polish-preview-head">
                  <span class="polish-preview-label">润色结果预览</span>
                </div>
                <div class="polish-preview">
                  <pre v-html="polishHighlightHtml"></pre>
                </div>
                <div class="modal-actions">
                  <linshe-button variant="secondary" @click="runPolish">↻ 再次生成</linshe-button>
                  <div class="modal-actions-right">
                    <linshe-button variant="secondary" @click="closePolishModal">取消</linshe-button>
                    <linshe-button variant="primary" @click="confirmPolish">确认并覆写</linshe-button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══════════════════════════════════════════
          角色详情弹窗
          ═══════════════════════════════════════════ -->
    <CharacterDetailModal
      ref="detailModalRef"
      :visible="detailVisible"
      :character="detailChar"
      @close="closeCharDetail"
      @saved="onCharSaved"
      @deleted="onCharDeleted"
      @open-avatar-editor="openCharAvatarEditor"
      @remove-avatar="removeCharAvatar"
      @open-relation-graph="openRelationGraph"
      @open-deduction="openDeduction"
      @lora-saved="onCharSaved"
    />

    <!-- 角色头像裁剪器 -->
    <Teleport to="body">
      <AvatarCropper
        v-if="showCharAvatarPicker"
        :title="`设置 ${detailChar?.display_name || ''} 头像`"
        :show-recent-tab="true"
        :show-generate-tab="true"
        :character-id="detailChar?.id"
        :character-base-prompt="detailChar?.base_prompt || ''"
        :recent-images="recentImages"
        :recent-loading="recentLoading"
        @close="showCharAvatarPicker = false"
        @save="onCharAvatarSave"
        @switch-to-recent="switchToRecent"
      />
    </Teleport>

    <!-- 用户头像裁剪器 -->
    <Teleport to="body">
      <AvatarCropper
        v-if="showUserAvatarPicker"
        title="设置我的头像"
        :show-recent-tab="false"
        :show-generate-tab="false"
        @close="showUserAvatarPicker = false"
        @save="onUserAvatarSave"
      />
    </Teleport>

    <!-- ═══════════════════════════════════════════
          角色关系图（独立全屏弹窗）
          ═══════════════════════════════════════════ -->
    <RelationshipGraph
      v-if="detailChar"
      :visible="showRelationGraph"
      :center-character="detailChar"
      :all-characters="chat.characters"
      @close="showRelationGraph = false"
    />

    <!-- ═══════════════════════════════════════════
         用户关系图（独立全屏弹窗）
         ═══════════════════════════════════════════ -->
    <UserRelationshipGraph
      :visible="showUserRelationGraph"
      :all-characters="chat.characters"
      @close="showUserRelationGraph = false"
      @auto-deduce="onGraphAutoDeduce"
    />

    <!-- ═══════════════════════════════════════════
          推演角色关系（AI 自动推理）
          ═══════════════════════════════════════════ -->
    <RelationshipDeductionModal
      :visible="showDeductionModal"
      :character="detailChar"
      :mode="deductionMode"
      :user-name="deductionUserName"
      @close="showDeductionModal = false; deductionMode = 'character'"
      @saved="onDeductionSaved"
    />

    <!-- ═══════════════════════════════════════════
         信箱弹窗
         ═══════════════════════════════════════════ -->
    <MailboxModal :visible="showMailbox" :characters="sortedCharacters" @close="showMailbox = false" />

    <!-- ═══════════════════════════════════════════
         背包弹窗
         ═══════════════════════════════════════════ -->
    <BackpackModal :visible="showBackpack" :characters="sortedCharacters" @close="showBackpack = false" />

    <!-- 《邻舍日报》的阅读窗已随入口一起迁到「传媒」页（MediaView 里挂载） -->

      <EmojiManagerModal v-if="showEmojiManager" :characters="sortedCharacters" @close="showEmojiManager = false" />
      <StandingManagerModal :open="showStandingManager" :characters="sortedCharacters" @close="showStandingManager = false" />

    <!-- ═══════════════════════════════════════════
         角色文件夹：新建 / 重命名
         ═══════════════════════════════════════════ -->
    <LinsheModal
      v-model="showFolderEditor"
      :title="editingFolder ? '重命名文件夹' : '新建文件夹'"
      panel-class="folder-editor-modal"
    >
      <div class="folder-editor-body">
        <linshe-input
          v-model="folderNameInput"
          :maxlength="20"
          placeholder="例：原创角色 / 绝区零 / 高冷系"
          @keyup.enter="submitFolderEditor"
        />
        <p class="folder-editor-hint">按角色来源或类型分组，之后可在文件夹栏里快速筛选。</p>
      </div>
      <template #footer>
        <linshe-button variant="secondary" @click="showFolderEditor = false">取消</linshe-button>
        <linshe-button variant="primary" :disabled="!folderNameInput.trim()" @click="submitFolderEditor">
          {{ editingFolder ? '保存' : '创建' }}
        </linshe-button>
      </template>
    </LinsheModal>

    <!-- ═══════════════════════════════════════════
         角色文件夹：把角色移入某个文件夹
         ═══════════════════════════════════════════ -->
    <LinsheModal
      v-model="showMoveFolder"
      :title="movingChar ? `移动「${movingChar.display_name}」` : '移动到文件夹'"
      panel-class="move-folder-modal"
    >
      <div class="folder-pick-list">
        <div
          class="folder-pick-item"
          :class="{ active: !movingChar || !movingChar.folder_id }"
          role="button"
          tabindex="0"
          @click="doMoveToFolder(null)"
          @keydown.enter.prevent="doMoveToFolder(null)"
          @keydown.space.prevent="doMoveToFolder(null)"
        >
          <span class="folder-pick-name">未分类</span>
          <span class="folder-pick-count">{{ uncategorizedCount }}</span>
        </div>
        <div
          v-for="f in folders"
          :key="f.id"
          class="folder-pick-item"
          :class="{ active: !!movingChar && movingChar.folder_id === f.id }"
          role="button"
          tabindex="0"
          @click="doMoveToFolder(f.id)"
          @keydown.enter.prevent="doMoveToFolder(f.id)"
          @keydown.space.prevent="doMoveToFolder(f.id)"
        >
          <span class="folder-pick-name">{{ f.name }}</span>
          <span class="folder-pick-count">{{ f.count }}</span>
        </div>
        <p v-if="!folders.length" class="folder-pick-hint">还没有文件夹，点下面「新建文件夹」建一个。</p>
      </div>
      <template #footer>
        <linshe-button variant="ghost" @click="openNewFolderFromMove">＋ 新建文件夹</linshe-button>
        <linshe-button variant="secondary" @click="showMoveFolder = false">完成</linshe-button>
      </template>
    </LinsheModal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, inject, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import { useCharacterFoldersStore } from '../stores/characterFolders.js'
import { userAvatar, loadUserAvatar, uploadUserAvatar, userNickname, userGender, userAppearance, userPersona, loadUserConfig, saveUserConfig } from '../userConfig.js'
import * as api from '../api/index.js'
import AvatarCropper from '../components/AvatarCropper.vue'
import RelationshipGraph from '../components/RelationshipGraph.vue'
import UserRelationshipGraph from '../components/UserRelationshipGraph.vue'
import RelationshipDeductionModal from '../components/RelationshipDeductionModal.vue'
import CharacterDetailModal from '../components/CharacterDetailModal.vue'
import MailboxModal from '../components/MailboxModal.vue'
import BackpackModal from '../components/BackpackModal.vue'
import EmojiManagerModal from '../components/EmojiManagerModal.vue'
import StandingManagerModal from '../components/StandingManagerModal.vue'
import AppearanceRefineModal from '../components/AppearanceRefineModal.vue'
import LinsheButton from '../components/ui/LinsheButton.vue'
import { emitCharacterAvatarChanged, emitCharacterPinEnabled } from '../utils/characterReactionProducers.js'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import LinsheSwitch from '../components/ui/LinsheSwitch.vue'
import { useBurst } from '../composables/useBurst.js'
import { useMailboxStore } from '../stores/mailbox.js'
import { useBackpackStore } from '../stores/backpack.js'
import { useNewspaperStore } from '../stores/newspaper.js'

const router = useRouter()
const chat = useChatStore()
const mailboxStore = useMailboxStore()
const backpackStore = useBackpackStore()
const newspaperStore = useNewspaperStore()

const showMailbox = ref(false)
const showBackpack = ref(false)
const showEmojiManager = ref(false)
const showStandingManager = ref(false)
const mailboxUnread = computed(() => mailboxStore.unreadCount)
const backpackChestReady = computed(() => backpackStore.chestReady)

// 《邻舍日报》入口已迁到「传媒」页（MediaView）。
// 这里只剩「让当天报纸先拉一次」—— NavBar 的酒馆项红点与它同源，
// 而 NavBar 本身也会轮询，所以这个调用只是让首屏更快拿到状态。
function loadTodayPaper() {
  newspaperStore.fetchToday()
}

// 置顶优先，组内按 display_name 首字母排序（中文按拼音）
const sortedCharacters = computed(() =>
  [...chat.characters].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return (a.display_name || '').localeCompare(b.display_name || '', 'zh-CN')
  })
)
// ═══════════════════════════════════════
// 角色文件夹（单层分类）+ 名称搜索
// 文件夹数据由共享 store 持有，左侧会话栏的分组用的是同一份 —— 两边同屏，必须同步
// ═══════════════════════════════════════
const folderStore = useCharacterFoldersStore()
const folders = computed(() => folderStore.folders)

/**
 * 活跃角色 / 归档角色。
 *
 * 归档角色只在「归档管理」里出现；其余视图（全部 / 未分类 / 各文件夹）一律排除 ——
 * 否则几十个压暗的卡片会和活跃角色平铺在一起，很难找（本机 67 个角色里 56 个是归档的）。
 * 声明放在这里（而非靠近 folderScopedCharacters）是因为下面的 uncategorizedCount 与
 * folderCountOf 都要用 —— computed 虽是惰性求值，但不该依赖求值时机。
 */
const archivedCharacters = computed(() => chat.characters.filter(c => c.archived))
const activeCharacters = computed(() => chat.characters.filter(c => !c.archived))

// 计数按「活跃角色」算 —— 与视图里实际渲染的一致（归档角色另有「归档管理」入口）
const uncategorizedCount = computed(() => activeCharacters.value.filter(c => !c.folder_id).length)
/** 各文件夹的活跃角色数（后端返回的 f.count 含归档，会与实际看到的不符） */
function folderCountOf(id) {
  return activeCharacters.value.filter(c => c.folder_id === id).length
}
// 文件夹接口就绪后才显示分类 UI，接口不可用时保持原样（不出现半坏的筛选栏）
const folderFeatureReady = computed(() => folderStore.ready)
// 'all' | 'uncategorized' | 文件夹 id
const folderFilter = ref('all')
const charSearch = ref('')

// ── 文件夹拖拽排序 ──
// 用原生 HTML5 拖放：这一排就是个扁平的 chip 列表，没必要为此引入拖拽库。
// 「全部 / 未分类」是固定项，不参与排序，所以只有 v-for 里的文件夹 chip 是 draggable。
const dragFolderId = ref(null)
const dragOverFolderId = ref(null)

function onFolderDragStart(ev, f) {
  dragFolderId.value = f.id
  dragOverFolderId.value = null
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move'
    // Firefox 必须 setData 才会真正开始拖拽
    ev.dataTransfer.setData('text/plain', String(f.id))
  }
}

function onFolderDragOver(ev, f) {
  if (dragFolderId.value == null || dragFolderId.value === f.id) return
  ev.preventDefault()   // 不 preventDefault 就不会触发 drop
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
  dragOverFolderId.value = f.id
}

function onFolderDragLeave(f) {
  if (dragOverFolderId.value === f.id) dragOverFolderId.value = null
}

async function onFolderDrop(ev, target) {
  const fromId = dragFolderId.value
  dragFolderId.value = null
  dragOverFolderId.value = null
  if (fromId == null || fromId === target.id) return

  const list = [...folders.value]
  const fromIdx = list.findIndex(x => x.id === fromId)
  const toIdx = list.findIndex(x => x.id === target.id)
  if (fromIdx < 0 || toIdx < 0) return

  // 语义是「插到目标之前」：向后拖时目标索引会因先移除而前移一位，所以要减 1，
  // 否则会落到目标后面（拖 A 到 C 会变成 B,C,A,D 而不是 B,A,C,D）。
  const [moved] = list.splice(fromIdx, 1)
  const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx
  list.splice(insertAt, 0, moved)

  try {
    await folderStore.reorderFolders(list.map(x => x.id))
  } catch (err) {
    const msg = err?.message || '未知错误'
    // 后端还是旧代码时，'/folders/reorder' 会被 '/folders/:id' 吃掉并回 'invalid folder id'。
    // 这个报错本身看不出原因，补一句指向性提示，省得再去猜。
    const stale = /invalid folder id|请求失败 \(40[0-9]\)/.test(msg)
    toastFn?.(
      '保存文件夹顺序失败: ' + msg + (stale ? '（后端可能仍是旧代码，请在启动器里重启服务）' : ''),
      'error',
    )
  }
}

function onFolderDragEnd() {
  dragFolderId.value = null
  dragOverFolderId.value = null
}

const showFolderEditor = ref(false)
const editingFolder = ref(null)   // null = 新建；否则为被重命名的文件夹
const folderNameInput = ref('')
const showMoveFolder = ref(false)
const movingChar = ref(null)

function folderName(id) {
  return folders.value.find(f => f.id === id)?.name || ''
}

// 角色增删后各文件夹的成员数会变，跟着刷新一次（首屏由 onMounted 负责）
watch(() => chat.characters.length, () => folderStore.load())

// ═══════════════════════════════════════
// 批量归档（工具栏的「全部不参与活动」）
// ═══════════════════════════════════════
const archiveAllToggling = ref(false)
const archivedCount = computed(() => chat.characters.filter(c => c.archived).length)
// 全部归档才算「开」；部分归档时开关显示为关，点一下 = 把剩下的也归档
const allArchived = computed(() =>
  chat.characters.length > 0 && archivedCount.value === chat.characters.length
)

async function toggleAllArchived(next) {
  if (archiveAllToggling.value) return
  archiveAllToggling.value = true
  try {
    const r = await api.setAllCharactersArchived(next)
    // 本地同步：省一次整表拉取，也避免网格整体重排的抖动
    chat.characters.forEach(c => { c.archived = next ? 1 : 0 })
    showToast(
      next
        ? `已归档 ${r?.changed ?? 0} 个角色，它们不再参与任何主动活动`
        : `已恢复 ${r?.changed ?? 0} 个角色参与活动`,
      'success'
    )
  } catch (err) {
    showToast(err?.message || '操作失败', 'error')
  } finally {
    archiveAllToggling.value = false
  }
}

/** 归档管理视图里单卡「取消归档」：只这一张卡在转，其余卡片保持可点 */
const unarchiveBusyId = ref(null)
async function onUnarchive(c) {
  if (unarchiveBusyId.value !== null) return
  unarchiveBusyId.value = c.id
  try {
    await api.setCharacterArchived(c.id, false)
    // 本地同步：取消归档后该角色会离开「归档管理」进入活跃视图
    c.archived = 0
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.archived = 0
    showToast(`「${c.display_name}」已恢复参与活动`, 'success')
  } catch (err) {
    showToast(err?.message || '取消归档失败', 'error')
  } finally {
    unarchiveBusyId.value = null
  }
}

// 当前文件夹范围内的角色（未叠加搜索词）
// 归档角色只在「归档管理」里出现，此处用 activeCharacters 排除掉（见其声明处的说明）
const folderScopedCharacters = computed(() => {
  if (folderFilter.value === 'archived') return archivedCharacters.value
  const list = activeCharacters.value
  if (folderFilter.value === 'uncategorized') return list.filter(c => !c.folder_id)
  if (folderFilter.value === 'all') return list
  return list.filter(c => c.folder_id === folderFilter.value)
})

// 实际渲染：文件夹筛选 + 名称搜索，置顶优先、组内按拼音排序
const visibleCharacters = computed(() => {
  const kw = charSearch.value.trim().toLowerCase()
  const list = kw
    ? folderScopedCharacters.value.filter(c => (c.display_name || '').toLowerCase().includes(kw))
    : folderScopedCharacters.value
  return [...list].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return (a.display_name || '').localeCompare(b.display_name || '', 'zh-CN')
  })
})

// 标题计数：以**当前筛选范围**为分母（视图已排除归档，用总数当分母会一直显示「11 / 67」）
const charCountLabel = computed(() => {
  const scoped = folderScopedCharacters.value.length
  const shown = visibleCharacters.value.length
  return shown === scoped ? `${scoped}` : `${shown} / ${scoped}`
})

// 搜索词在全部角色里有命中，但当前文件夹内没有 —— 提示可以放宽到全部范围
const canSearchEverywhere = computed(() => {
  const kw = charSearch.value.trim().toLowerCase()
  if (!kw || folderFilter.value === 'all') return false
  return chat.characters.some(c => (c.display_name || '').toLowerCase().includes(kw))
})

/**
 * 当前筛选范围里被归档的角色数。
 *
 * 用于空状态：某个文件夹的成员可能**全部**是归档的（本机「少女与战车」24 个、「武装JK世界」26 个
 * 都是这种情况），此时视图是空的，但说「这个文件夹还是空的」并不准确 —— 得告诉用户去「归档管理」。
 */
const hiddenArchivedInScope = computed(() => {
  if (folderFilter.value === 'archived') return 0
  if (folderFilter.value === 'uncategorized') return archivedCharacters.value.filter(c => !c.folder_id).length
  if (folderFilter.value === 'all') return archivedCharacters.value.length
  return archivedCharacters.value.filter(c => c.folder_id === folderFilter.value).length
})

const emptyTitle = computed(() => {
  if (charSearch.value.trim()) return `没有找到「${charSearch.value.trim()}」`
  if (!chat.characters.length) return '还没有角色'
  if (folderFilter.value === 'archived') return '没有归档角色'
  if (hiddenArchivedInScope.value > 0) return `这里的角色都已归档（${hiddenArchivedInScope.value} 个）`
  if (folderFilter.value === 'uncategorized') return '「未分类」里没有角色'
  return '这个文件夹还是空的'
})
const emptyDesc = computed(() => {
  if (charSearch.value.trim()) {
    return folderFilter.value === 'all' ? '换个关键词试试。' : '换个关键词，或者切到「全部」看看。'
  }
  if (!chat.characters.length) return '点上面的「招募」认识第一位邻居。'
  if (folderFilter.value === 'archived') return '归档过的角色会集中在这里，方便统一恢复或清理。'
  // 成员全被归档时，指向「归档管理」而不是让人以为文件夹坏了
  if (hiddenArchivedInScope.value > 0) return '去「归档管理」可以把它们恢复成参与活动。'
  if (folderFilter.value === 'uncategorized') return '所有角色都已经归好类了。'
  return '用角色卡上的文件夹按钮，把角色移进来。'
})

// ── 新建 / 重命名文件夹 ──
function openNewFolder() {
  editingFolder.value = null
  folderNameInput.value = ''
  showFolderEditor.value = true
}

function openRenameFolder(f) {
  editingFolder.value = f
  folderNameInput.value = f.name
  showFolderEditor.value = true
}

async function submitFolderEditor() {
  const name = folderNameInput.value.trim()
  if (!name) return
  try {
    if (editingFolder.value) {
      await folderStore.renameFolder(editingFolder.value.id, name)
      showToast(`已重命名为「${name}」`, 'success')
    } else {
      const created = await folderStore.createFolder(name)
      showToast(`已创建文件夹「${name}」`, 'success')
      // 新建后直接切过去，省得再点一次
      if (created?.id) folderFilter.value = created.id
    }
    showFolderEditor.value = false
  } catch (err) {
    showToast(err?.message || '操作失败', 'error')
  }
}

// ── 删除文件夹（成员回到未分类，不删角色） ──
async function askDeleteFolder(f) {
  const ok = await confirmFn({
    title: '删除文件夹',
    message: `确定删除「${f.name}」吗？里面的 ${f.count} 个角色会回到「未分类」，角色本身不会被删除。`,
    okText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await folderStore.removeFolder(f.id)
    if (folderFilter.value === f.id) folderFilter.value = 'all'
    showToast(`已删除文件夹「${f.name}」`, 'success')
  } catch (err) {
    showToast(err?.message || '删除失败', 'error')
  }
}

// ── 把角色移入 / 移出文件夹 ──
function openMoveFolder(c) {
  movingChar.value = c
  showMoveFolder.value = true
}

function openNewFolderFromMove() {
  showMoveFolder.value = false
  openNewFolder()
}

async function doMoveToFolder(folderId) {
  const c = movingChar.value
  if (!c) return
  const target = folderId || null
  if ((c.folder_id || null) === target) {
    showMoveFolder.value = false
    return
  }
  const prev = c.folder_id || null
  c.folder_id = target           // 乐观更新：网格与同一引用，立即重排
  showMoveFolder.value = false
  try {
    await folderStore.moveCharacter(c.id, target)
    showToast(target ? `已移入「${folderName(target)}」` : '已移出到「未分类」', 'success')
  } catch (err) {
    c.folder_id = prev
    showToast(err?.message || '移动失败', 'error')
  }
}

const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const confirmFn = inject('confirm')
const toastFn = inject('toast')

// ── 移动端滚动标题隐藏 ──
const headerVisible = ref(true)
let lastScroll = 0
function onScroll(e) {
  if (!isMobile) return
  const top = e.target.scrollTop
  if (top > 40 && top - lastScroll > 8) headerVisible.value = false
  else if (top - lastScroll < -4) headerVisible.value = true
  lastScroll = top
}

// ═══════════════════════════════════════
// 用户信息
// ═══════════════════════════════════════
const showUserAvatarPicker = ref(false)
const nicknameInput = ref(null)
const appearanceInput = ref(null)
const personaInput = ref(null)

const userAvatarStyle = computed(() => {
  if (userAvatar.value) return { backgroundImage: `url(${userAvatar.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  return { background: 'var(--accent)' }
})

async function onUserAvatarSave(base64) {
  await uploadUserAvatar(base64)
  showUserAvatarPicker.value = false
}

// ── 姓名 ──
const editingNickname = ref(false)
const userNicknameInput = ref('')

function startEditNickname() {
  userNicknameInput.value = userNickname.value
  editingNickname.value = true
  nextTick(() => nicknameInput.value?.focus())
}

async function saveNickname() {
  editingNickname.value = false
  const val = userNicknameInput.value.trim()
  if (val !== (userNickname.value || '')) {
    await saveUserConfig({ nickname: val })
  }
}

// ── 性别 ──
const editingGender = ref(false)
const userGenderInput = ref('')
const genderInput = ref(null)

function startEditGender() {
  userGenderInput.value = userGender.value
  editingGender.value = true
  nextTick(() => genderInput.value?.focus())
}

async function saveGender() {
  editingGender.value = false
  const val = userGenderInput.value.trim()
  if (val !== (userGender.value || '')) {
    await saveUserConfig({ gender: val })
  }
}

// ── 外观 ──
const editingAppearance = ref(false)
const userAppearanceInput = ref('')

function startEditAppearance() {
  userAppearanceInput.value = userAppearance.value
  editingAppearance.value = true
  nextTick(() => appearanceInput.value?.focus())
}

async function saveAppearance() {
  editingAppearance.value = false
  const val = userAppearanceInput.value.trim()
  if (val !== (userAppearance.value || '')) {
    await saveUserConfig({ appearance: val })
  }
}

function cancelEditAppearance() {
  editingAppearance.value = false
  userAppearanceInput.value = userAppearance.value
}

// ── 其他说明 ──
const editingPersona = ref(false)
const userPersonaInput = ref('')

function startEditPersona() {
  userPersonaInput.value = userPersona.value
  editingPersona.value = true
  nextTick(() => personaInput.value?.focus())
}

async function savePersona() {
  editingPersona.value = false
  const val = userPersonaInput.value.trim()
  if (val !== (userPersona.value || '')) {
    await saveUserConfig({ persona: val })
  }
}

function cancelEditPersona() {
  editingPersona.value = false
  userPersonaInput.value = userPersona.value
}

// ═══════════════════════════════════════
// 招募弹窗
// ═══════════════════════════════════════
const recruit = reactive({
  show: false,
  step: 'input',   // 'input' | 'preview'
  desc: '',
  loading: false,
  saving: false,
  error: '',
  result: null,    // 生成结果
  task: null,      // 'search' | 'regenerate'
  searchContext: '', // 首次联网搜索得到的原始资料，用于重新归纳
})

// 招募加载提示语轮播
const LOADING_TIPS = [
  '正在酒馆发布公告…',
  '正在审核冒险者资格…',
  '正在翻阅冒险者公会档案…',
  '正在筛查简历…',
  '正在办理冒险者资格证…',
  '正在调取异世界档案…',
  '正在向公会会长请示…',
  '正在检查悬赏令真伪…',
  '正在鉴定勇者血统…',
  '正在占卜命运之线…',
  '正在校验冒险者等级徽章…',
  '正在清点药水库存…',
  '正在整理任务委托板…',
  '正在给壁炉添柴…',
]
const loadingTip = ref(LOADING_TIPS[0])
let _tipTimer = null

function startLoadingTips() {
  loadingTip.value = LOADING_TIPS[0]
  let idx = 0
  _tipTimer = setInterval(() => {
    idx = (idx + 1) % LOADING_TIPS.length
    loadingTip.value = LOADING_TIPS[idx]
  }, 2200)
}

function stopLoadingTips() {
  if (_tipTimer) { clearInterval(_tipTimer); _tipTimer = null }
}

// Toast 冒泡提示 —— 统一走全局 Live Toast,长文案停留 5s
function showToast(message, type = 'info') {
  toastFn?.(message, type, 5000)
}

function openRecruit() {
  recruit.show = true
  recruit.step = 'input'
  recruit.desc = ''
  recruit.error = ''
  recruit.result = null
  recruit.loading = false
  recruit.saving = false
  recruit.task = null
  recruit.searchContext = ''
}

function closeRecruit() {
  recruit.show = false
  showRecruitRefine.value = false
  stopLoadingTips()
}

// ── 招募预览的修正外观（草稿卡模式：结果回填 recruit.result.base_prompt，确认招募时才落库）──
const showRecruitRefine = ref(false)

function onRecruitAppearanceRefined({ basePrompt }) {
  if (!recruit.result) return
  recruit.result.base_prompt = basePrompt
  showToast('外观已应用到待确认的角色卡', 'success')
}

async function doGenerate() {
  const desc = recruit.desc.trim()
  if (!desc || recruit.loading) return

  recruit.loading = true
  recruit.error = ''
  recruit.task = 'search'
  startLoadingTips()

  try {
    const result = await api.generateCharacterPreview(desc)
    if (result.error) {
      recruit.error = result.error
      return
    }
    recruit.searchContext = result.search_context || ''
    recruit.result = { ...result }
    recruit.step = 'preview'
    // 冒泡提示搜索结果
    if (result.search_found) {
      showToast('已在网络上找到详细角色资料', 'success')
    } else {
      showToast('未找到相关资料，请检查IP角色名字输入是否正确或者重新尝试，如果是原创设定则无视本条提示', 'info')
    }
  } catch (err) {
    recruit.error = '生成失败: ' + (err.message || '网络错误')
  } finally {
    recruit.loading = false
    recruit.task = null
    stopLoadingTips()
  }
}

async function regenerateFromSearchResult() {
  const desc = recruit.desc.trim()
  if (!desc || !recruit.searchContext || recruit.loading) return

  recruit.loading = true
  recruit.error = ''
  recruit.task = 'regenerate'
  startLoadingTips()

  try {
    const result = await api.generateCharacterPreview(desc, { searchContext: recruit.searchContext })
    if (result.error) {
      recruit.error = result.error
      return
    }
    if (result.search_context) recruit.searchContext = result.search_context
    recruit.result = { ...result }
    showToast('已根据原搜索资料重新整理角色卡', 'success')
  } catch (err) {
    recruit.error = '重新生成失败: ' + (err.message || '网络错误')
  } finally {
    recruit.loading = false
    recruit.task = null
    stopLoadingTips()
  }
}

async function confirmRecruit() {
  if (!recruit.result || recruit.saving) return
  recruit.saving = true
  recruit.error = ''

  try {
    const r = await api.createCharacter({
      name: recruit.result.name,
      display_name: recruit.result.display_name,
      base_prompt: recruit.result.base_prompt,
      emotion_baseline: recruit.result.emotion_baseline,
    })
    if (r.error) {
      recruit.error = r.error
      return
    }
    // 成功：关闭弹窗，刷新角色列表
    recruit.show = false
    await chat.loadCharacters()
  } catch (err) {
    recruit.error = '入库失败: ' + (err.message || '网络错误')
  } finally {
    recruit.saving = false
  }
}

const cardInputRef = ref(null)

async function onCardSelected(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  if (file.size > 7 * 1024 * 1024) {
    recruit.error = '角色卡文件过大（>7MB），请使用更小的文件'
    e.target.value = ''
    return
  }
  recruit.loading = true
  recruit.error = ''
  startLoadingTips()
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => reject(new Error('读取文件失败'))
      fr.readAsDataURL(file)
    })
    const result = await api.importCharacterCard({
      data: dataUrl,
      mimetype: file.type,
      filename: file.name,
    })
    if (result.error) {
      recruit.error = result.error
      return
    }
    recruit.result = { ...result }
    // 保留角色名作为描述，便于"重新搜索"用联网资料重写
    recruit.desc = result.display_name || ''
    recruit.step = 'preview'
    recruit.task = null
    recruit.searchContext = ''
    showToast('角色卡已整理完成，请检查后确认招募', 'success')
  } catch (err) {
    recruit.error = '导入失败: ' + (err.message || '网络错误')
  } finally {
    recruit.loading = false
    stopLoadingTips()
    if (cardInputRef.value) cardInputRef.value.value = ''
  }
}

// ═══════════════════════════════════════
// 角色详情弹窗
// ═══════════════════════════════════════
const detailVisible = ref(false)
const detailChar = ref(null)

const showRelationGraph = ref(false)
const showUserRelationGraph = ref(false)
const showDeductionModal = ref(false)
const deductionMode = ref('character')
const deductionUserName = ref('')
const detailModalRef = ref(null)

// 关闭关系图后刷新关系数据
watch(showRelationGraph, async (val) => {
  if (!val && detailChar.value) {
    await chat.loadCharacters()
    const updated = chat.characters.find(x => x.id === detailChar.value.id)
    if (updated) detailChar.value = updated
    detailModalRef.value?.refreshRelationships()
  }
})

// ═══════════════════════════════════════
// 世界观收藏（标签行 + textarea）
// ═══════════════════════════════════════
const showWorldModal = ref(false)
const worldItems = ref([])
const activeWorldName = ref('')
const selectedWorldId = ref(null)
const worldContent = ref('')
const worldDirty = ref(false)
const worldSaving = ref(false)
const worldSaved = ref(false)
const showNewInput = ref(false)
const worldNewName = ref('')
const newNameInput = ref(null)
const editingNameId = ref(null)
const editNameValue = ref('')
const editNameInput = ref(null)
const worldTextareaRef = ref(null)

// 纯文本世界观 → 带层级标记的展示 HTML（不改变原始文本内容）
function toWorldHighlightHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return String(text ?? '')
    .split('\n')
    .map((line) => {
      const safe = esc(line)
      if (/^\s*【[^】]*】\s*$/.test(safe)) {
        return `<span class="world-sec-title">${safe}</span>`
      }
      if (/^\s*[-•·*]\s+/.test(safe) || /^\s*\d+[.、．]/.test(safe)) {
        return `<span class="world-sec-item">${safe}</span>`
      }
      return safe.replace(/^(\s*)(【[^】]*】)/, (m, indent, tag) => `${indent}<span class="world-sec-tag">${tag}</span>`)
    })
    .join('\n')
}
const polishHighlightHtml = computed(() => toWorldHighlightHtml(polishContent.value))

async function loadWorldSettings() {
  try {
    const data = await api.getWorldSettings()
    worldItems.value = data.list || []
    const active = worldItems.value.find(w => w.is_active)
    activeWorldName.value = active?.name || ''
    if (active) {
      selectedWorldId.value = active.id
      worldContent.value = active.content || ''
    }
  } catch {}
}

function openWorldSetting() {
  worldSaved.value = false
  worldDirty.value = false
  showNewInput.value = false
  worldNewName.value = ''
  showWorldModal.value = true
  loadWorldSettings()
}

function closeWorldSetting() {
  showWorldModal.value = false
}

function selectWorld(item) {
  if (selectedWorldId.value === item.id) return
  selectedWorldId.value = item.id
  worldContent.value = item.content || ''
  worldDirty.value = false
  activateWorld(item.id)
}

function startNew() {
  showNewInput.value = true
  worldNewName.value = ''
  nextTick(() => newNameInput.value?.focus())
}

async function confirmNew() {
  const name = worldNewName.value.trim()
  if (!name) return
  worldSaving.value = true
  try {
    const result = await api.createWorldSetting({ name, content: '' })
    if (!result?.ok) throw new Error(result?.error || '创建失败')
    showNewInput.value = false
    worldNewName.value = ''
    await loadWorldSettings()
    selectedWorldId.value = result.item.id
    worldContent.value = ''
    worldDirty.value = false
    activateWorld(result.item.id, { silent: true })
    showToast(`已创建世界观「${name}」`, 'success')
  } catch (err) {
    console.error('[world] create failed:', err)
    showToast(`创建世界观失败: ${err?.message || '未知错误'}`, 'error')
  } finally {
    worldSaving.value = false
  }
}

async function saveWorld() {
  if (worldSaving.value) return
  worldSaving.value = true
  try {
    let targetId = selectedWorldId.value
    if (!targetId) {
      // 兜底：没有任何世界观（如旧库空表）时，把当前内容存为新的一套并激活
      const created = await api.createWorldSetting({ name: '默认世界观', content: worldContent.value.trim() })
      if (!created?.ok) throw new Error(created?.error || '创建失败')
      targetId = created.item.id
      await api.activateWorldSetting(targetId)
    } else {
      const result = await api.updateWorldSetting(targetId, { content: worldContent.value.trim() })
      if (!result?.ok) throw new Error(result?.error || '保存失败')
    }
    selectedWorldId.value = targetId
    worldDirty.value = false
    worldSaved.value = true
    setTimeout(() => worldSaved.value = false, 2000)
    await loadWorldSettings()
    showToast('世界观已保存', 'success')
  } catch (err) {
    console.error('[world] save failed:', err)
    showToast(`世界观保存失败: ${err?.message || '未知错误'}`, 'error')
  } finally {
    worldSaving.value = false
  }
}

async function activateWorld(id, { silent = false } = {}) {
  try {
    const result = await api.activateWorldSetting(id)
    if (!result?.ok) throw new Error(result?.error || '切换失败')
    await loadWorldSettings()
    if (!silent) showToast(`已激活世界观「${result.item?.name || ''}」`, 'success')
  } catch (err) {
    console.error('[world] activate failed:', err)
    showToast(`切换世界观失败: ${err?.message || '未知错误'}`, 'error')
  }
}

async function handleDelete(item) {
  if (worldItems.value.length <= 1) {
    showToast('至少保留一套世界观')
    return
  }
  const ok = await confirmFn({
    title: '删除世界观',
    message: `确定要删除「${item.name}」吗？`,
    okText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    const result = await api.deleteWorldSetting(item.id)
    if (!result?.ok) throw new Error(result?.error || '删除失败')
    if (selectedWorldId.value === item.id) {
      selectedWorldId.value = null
      worldContent.value = ''
      worldDirty.value = false
    }
    await loadWorldSettings()
    if (!selectedWorldId.value) {
      const first = worldItems.value.find(w => w.id !== item.id)
      if (first) {
        selectedWorldId.value = first.id
        worldContent.value = first.content || ''
      }
    }
    showToast(`已删除世界观「${item.name}」`, 'success')
  } catch (err) {
    console.error('[world] delete failed:', err)
    showToast(`删除世界观失败: ${err?.message || '未知错误'}`, 'error')
  }
}

function startRename(item) {
  editingNameId.value = item.id
  editNameValue.value = item.name
  nextTick(() => {
    const el = editNameInput.value
    if (el) {
      if (Array.isArray(el)) el[0]?.focus?.()
      else el.focus?.()
    }
  })
}

async function renameWorld(item) {
  if (editingNameId.value !== item.id) return
  const name = editNameValue.value.trim()
  editingNameId.value = null
  if (!name || name === item.name) return
  try {
    const result = await api.updateWorldSetting(item.id, { name })
    if (!result?.ok) throw new Error(result?.error || '重命名失败')
    await loadWorldSettings()
    showToast(`已重命名为「${name}」`, 'success')
  } catch (err) {
    console.error('[world] rename failed:', err)
    showToast(`重命名失败: ${err?.message || '未知错误'}`, 'error')
  }
}

// ═══════════════════════════════════════
// 世界观 AI 一键润色（酒馆世界书风格扩写）
// ═══════════════════════════════════════
const showPolishModal = ref(false)
const polishLoading = ref(false)
const polishError = ref('')
const polishContent = ref('')

function openPolish() {
  const source = worldContent.value.trim()
  if (!source || polishLoading.value) return
  polishError.value = ''
  polishContent.value = ''
  showPolishModal.value = true
  runPolish()
}

function closePolishModal() {
  showPolishModal.value = false
  polishLoading.value = false
  polishError.value = ''
  polishContent.value = ''
}

async function runPolish() {
  if (polishLoading.value) return
  const source = worldContent.value.trim()
  if (!source) {
    polishError.value = '当前世界观内容为空，请先填写内容再润色'
    return
  }
  polishLoading.value = true
  polishError.value = ''
  polishContent.value = ''
  try {
    const item = worldItems.value.find(w => w.id === selectedWorldId.value)
    // 请求体带上系统破限词，保证扩写创作自由
    let jailbreak = ''
    try {
      const rules = await api.getSystemRules()
      jailbreak = rules?.content || ''
    } catch {}
    const result = await api.polishWorldSetting({
      name: item?.name || '',
      content: source,
      jailbreak,
    })
    if (!result?.ok || !result.content) {
      throw new Error(result?.error || '润色失败，请稍后重试')
    }
    polishContent.value = result.content
  } catch (err) {
    polishError.value = err?.message || '润色失败，请稍后重试'
  } finally {
    polishLoading.value = false
  }
}

async function confirmPolish() {
  if (!polishContent.value) return
  worldContent.value = polishContent.value
  worldDirty.value = true
  worldSaved.value = false
  closePolishModal()
  await saveWorld()
}

async function openCharDetail(c) {
  detailChar.value = c
  detailVisible.value = true
}

// ── 角色置顶 ──
const { burstKey, burst: burstPin } = useBurst()

// 首屏错峰入场：.stagger 的动画跑完就摘掉，不能常驻。
// 常驻有两个副作用：① 位移过渡前的自检会读到时长更长的入场动画，判定成 animation
// 后整段 FLIP 被跳过，卡片直接跳位；② DOM 位移会让入场动画重播，重排的卡片先「消失」
// 再淡回来。摘掉后两个问题都没有，入场动画仍照常播一次。
const gridStagger = ref(true)
let staggerTimer = null
onMounted(() => {
  // 最长一档错峰是 440ms 延迟 + 450ms 动画
  staggerTimer = setTimeout(() => { gridStagger.value = false }, 1000)
})
onUnmounted(() => clearTimeout(staggerTimer))

// 置顶按钮：先播一次爆心特效，再切状态（重排由 TransitionGroup 的 FLIP 兜住）
function onPinClick(c) {
  burstPin(c.id)
  toggleCharPin(c)
}

async function toggleCharPin(c) {
  // sortedCharacters 是浅拷贝，元素与 store 同引用，改这里即改 store
  const wasPinned = !!c.pinned
  c.pinned = c.pinned ? 0 : 1
  try {
    const res = await api.togglePin(c.id, c.pinned)
    // 只有接口确认成功、且确实从未置顶变成置顶才产生角色通知（§2.2）
    emitCharacterPinEnabled({
      characterId: c.id,
      characterName: c.display_name || c.name || '',
      wasPinned,
      pinned: !!c.pinned,
      ok: res?.ok === true && res?.pinned === c.pinned,
    })
  } catch {
    // 失败回滚本地状态，不发事件（§2.6）
    c.pinned = wasPinned ? 1 : 0
  }
}

function closeCharDetail() {
  detailVisible.value = false
  detailChar.value = null
}

async function onCharSaved(c) {
  await chat.loadCharacters()
  const updated = chat.characters.find(x => x.id === c.id)
  if (updated) detailChar.value = updated
}

async function onCharDeleted(c) {
  detailVisible.value = false
  detailChar.value = null
  await chat.loadCharacters()
}

function openRelationGraph(c) {
  showRelationGraph.value = true
}

function openDeduction(c) {
  detailChar.value = c
  deductionMode.value = 'character'
  deductionUserName.value = ''
  showDeductionModal.value = true
}

function onGraphAutoDeduce() {
  showUserRelationGraph.value = false
  deductionMode.value = 'user'
  deductionUserName.value = userNickname.value || 'User'
  showDeductionModal.value = true
}

async function onDeductionSaved() {
  await chat.loadCharacters()
  if (detailChar.value) {
    const updated = chat.characters.find(x => x.id === detailChar.value.id)
    if (updated) detailChar.value = updated
  }
}

// ── 角色头像 ──
const showCharAvatarPicker = ref(false)
const recentImages = ref([])
const recentLoading = ref(false)

function openCharAvatarEditor() {
  recentImages.value = []
  showCharAvatarPicker.value = true
}

async function switchToRecent() {
  if (recentImages.value.length > 0) return
  if (!detailChar.value?.id) return
  recentLoading.value = true
  try {
    const d = await api.getRecentImages(detailChar.value.id)
    recentImages.value = d.images || []
  } catch {} finally { recentLoading.value = false }
}

async function onCharAvatarSave(base64) {
  if (!detailChar.value) return
  const id = detailChar.value.id
  const before = detailChar.value.avatar_path || ''
  await api.uploadAvatar(id, base64 || '')
  await chat.loadCharacters()
  const updated = chat.characters.find(x => x.id === id)
  if (updated) detailChar.value = updated
  showCharAvatarPicker.value = false
  emitCharacterAvatarChanged({ characterId: id, previousVersion: before, nextVersion: updated?.avatar_path || '', ok: true })
}

async function removeCharAvatar() {
  if (!detailChar.value) return
  const ok = await confirmFn({
    title: '移除头像',
    message: `确定要移除「${detailChar.value.display_name}」的头像吗？`,
    okText: '移除',
    danger: true,
  })
  if (!ok) return
  await api.uploadAvatar(detailChar.value.id, '')
  await chat.loadCharacters()
  const updated = chat.characters.find(x => x.id === detailChar.value.id)
  if (updated) detailChar.value = updated
}

// ── 初始化 ──
onMounted(async () => {
  await loadUserAvatar()
  await loadUserConfig()
  loadWorldSettings()
  userNicknameInput.value = userNickname.value
  userGenderInput.value = userGender.value
  userAppearanceInput.value = userAppearance.value
  userPersonaInput.value = userPersona.value
  if (chat.characters.length === 0) await chat.loadCharacters()
  // 文件夹列表（含各组成员数）与角色一起在首屏拉取
  folderStore.load()
  // 拉一次宝箱状态，驱动入口卡上的「可开启」小圆点
  backpackStore.fetchItems()
  // 拉今天的《邻舍日报》，驱动报纸入口卡的未读红点
  loadTodayPaper()
})
</script>

<style scoped>
.tavern-view {
  padding: 32px;
  overflow-y: auto;
  height: 100vh; height: 100dvh;
  flex: 1;
}

.page-header {
  margin-bottom: 24px;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform, opacity;
}
.page-header.header-hidden { transform: translateY(-100%); margin-bottom: 0; opacity: 0; pointer-events: none; }
.page-header h2 { font-size: 24px; color: var(--text-bright); font-weight: 700; }
.is-clickable { cursor: pointer; }

/* ── 卡片共用：视觉样式走全局 .card，这里只保留布局 ── */
.card {
  padding: 20px 24px;
}

/* ── 用户行 ── */
.user-row-wrapper {
  display: flex;
  gap: 20px;
  margin-bottom: 28px;
}
.user-row {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  flex: 1;
}
.mailbox-card,
.backpack-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 18px;
  cursor: pointer;
  position: relative;
  width: 150px;
  flex-shrink: 0;
}
.mailbox-label {
  font-size: 13px;
  font-weight: 600;
}
.backpack-dot {
  min-width: 10px;
  width: 10px;
  height: 10px;
  padding: 0;
  border-radius: 50%;
}
.mailbox-badge {
  position: absolute;
  top: -6px; right: -6px;
  min-width: 18px; height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  line-height: 1;
}

.user-avatar {
  width: 56px; height: 56px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 22px; font-weight: 700;
  flex-shrink: 0;
}
.user-avatar.clickable { cursor: pointer; transition: opacity 0.15s; }
.user-avatar.clickable:hover { opacity: 0.85; }

.user-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }

.user-field-row {
  display: flex; align-items: baseline; gap: 10px;
}
.field-label {
  font-size: 12px; font-weight: 600; color: var(--text-secondary);
  min-width: 32px; padding-top: 4px; flex-shrink: 0;
  user-select: none;
}
.field-value-wrap {
  flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0;
}
.field-value {
  font-size: 13px; color: var(--text-secondary);
  cursor: pointer; padding: 2px 0; line-height: 1.5;
  flex: 1; min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.user-field-row:first-child .field-value {
  font-size: 15px; font-weight: 600; color: var(--text-bright);
}
.field-value:hover { color: var(--accent); }

.edit-pen {
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; font-size: 14px; padding: 2px 4px;
  opacity: 0; transition: opacity 0.15s;
  flex-shrink: 0;
  user-select: none;
}
.user-field-row:hover .edit-pen { opacity: 1; }
.edit-pen:hover { color: var(--accent); }

/* ── 文本输入框 ── */
.field-textarea {
  width: 100%; resize: none;
  font-size: 13px; line-height: 1.5;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--glass-border);
  border-radius: 8px; padding: 6px 10px;
  color: var(--text-bright);
}
.field-textarea:focus { outline: none; border-color: var(--accent); }
.field-input {
  font-size: 13px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--glass-border);
  border-radius: 8px; padding: 4px 10px;
  color: var(--text-bright); width: 120px;
}
.field-input:focus { outline: none; border-color: var(--accent); }
.nickname-input {
  font-size: 15px; font-weight: 600;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--glass-border);
  border-radius: 8px; padding: 4px 10px;
  color: var(--text-bright); width: 160px;
}
.nickname-input:focus { outline: none; border-color: var(--accent); }

/* ── 关系图入口卡片 ── */
/* 报纸 + 关系图同行两列；列间距沿用卡片纵向 20px 节奏 */
.relation-entry-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}
.relation-entry-row .relation-entry {
  margin-bottom: 0;
}
.relation-entry {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  margin-bottom: 20px;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
}
.relation-entry:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(var(--accent-rgb), 0.2);
  box-shadow: 0 2px 16px rgba(var(--accent-rgb), 0.08);
}

.relation-entry-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  background: rgba(var(--accent-rgb), 0.1);
  display: flex; align-items: center; justify-content: center;
  color: var(--accent);
  flex-shrink: 0;
}

.relation-entry-text {
  flex: 1;
  display: flex; flex-direction: column;
  gap: 2px;
}
.relation-entry-title {
  font-size: 15px; font-weight: 600; color: var(--text-bright);
}
.relation-entry-hint {
  font-size: 12px; color: var(--text-secondary);
}

.relation-entry-arrow {
  font-size: 22px; color: var(--text-secondary);
  flex-shrink: 0;
}

/* ── 世界观入口卡片 ── */
.world-icon {
  background: rgba(var(--accent-rgb), 0.08);
  color: #c06a52;
}

/* ── 今日报纸入口卡片 ── */
.newspaper-icon {
  background: rgba(var(--accent-rgb), 0.08);
  color: #a8763e;
}
.newspaper-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 7px;
  border-radius: 50%;
  background: var(--accent);
  vertical-align: 2px;
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.15);
}

/* ── 世界观标签行（档案页签导航） ── */
.world-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  align-items: flex-end;
  padding: 2px 8px 0;
  border-bottom: 1px solid rgba(120, 90, 60, 0.14);
}

.world-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 15px 9px;
  border-radius: 11px 11px 0 0;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: rgba(90, 70, 55, 0.62);
  border: 1px solid transparent;
  border-bottom: none;
  margin-bottom: -1px;
  opacity: 0.62;
  transition: all 0.18s ease;
  user-select: none;
  white-space: nowrap;
}
.world-tag:hover:not(.world-tag-selected) {
  opacity: 1;
  background: rgba(255, 255, 255, 0.5);
  color: #5a4638;
}
.world-tag-selected {
  background: linear-gradient(180deg, #fffdf8 0%, #fdfaf3 100%);
  color: var(--accent-hover);
  font-weight: 700;
  border-color: rgba(120, 90, 60, 0.16);
  border-bottom-color: #fdfaf3;
  border-radius: 12px 12px 0 0;
  opacity: 1;
  box-shadow: 0 -3px 10px rgba(90, 60, 40, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.85);
}

.world-tag-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px; height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  flex-shrink: 0;
}
.world-tag:hover .world-tag-act {
  opacity: 0.6;
}
.world-tag-act:hover {
  opacity: 1 !important;
}

.world-tag-edit:hover {
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent-hover);
}

.world-tag-del:hover {
  color: #dc3c3c !important;
  background: rgba(220, 60, 60, 0.16);
}

.world-tag-rename-input {
  width: 90px;
  padding: 3px 6px;
  font-size: 13px;
  color: var(--town-paper-ink);
  background: #fffdf8;
  border: 1px solid rgba(var(--accent-rgb), 0.4);
  border-radius: 6px;
  outline: none;
  font-family: inherit;
}

.world-tag-add {
  padding: 0;
  width: 26px; height: 26px;
  justify-content: center;
  align-self: flex-end;
  margin: 0 3px 9px;
  opacity: 0.4;
  font-weight: 300;
  font-size: 19px;
  line-height: 1;
  color: #8a6f5c;
  background: transparent;
  border: none;
  border-radius: 50%;
  transition: all 0.18s ease;
}
.world-tag-add:hover {
  opacity: 1;
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent-hover);
}

/* ── 新建名称行 ── */
.world-new-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: rgba(var(--accent-rgb), 0.05);
  border: 1px solid rgba(var(--accent-rgb), 0.12);
  border-radius: 12px;
  animation: world-new-pop 0.2s ease;
}
@keyframes world-new-pop {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.world-name-input {
  flex: 1;
}

/* ── 世界观编辑弹窗（档案面板） ── */
.world-modal-panel {
  position: relative;
  width: min(760px, 96vw);
  background: #f5f0e8;
  border-radius: 24px;
  box-shadow: 0 24px 70px rgba(58, 42, 30, 0.22), 0 3px 12px rgba(58, 42, 30, 0.06);
}
.world-modal-panel::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 150px;
  background: radial-gradient(120% 100% at 22% 0%, rgba(var(--accent-rgb), 0.11) 0%, rgba(var(--accent-rgb), 0.04) 55%, transparent 100%);
  pointer-events: none;
}
.world-modal-panel .world-modal-header {
  padding: 26px 30px 14px;
  border-bottom: none;
}
.world-modal-panel .world-modal-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.world-modal-panel .world-modal-title h3 {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #3b2f26;
}
.world-modal-subtitle {
  font-size: 12px;
  letter-spacing: 0.5px;
  color: rgba(90, 70, 55, 0.55);
}
.world-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.world-active-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.4px;
  color: #c06a52;
  background: rgba(var(--accent-rgb), 0.08);
  border: 1px solid rgba(var(--accent-rgb), 0.18);
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.world-modal-panel .modal-body {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 30px 24px;
}
.world-modal-panel .modal-body > * {
  flex-shrink: 0;
}

/* 文档编辑面板 */
.world-editor {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  background: #fdfaf3;
  border: 1px solid rgba(120, 90, 60, 0.1);
  border-top: none;
  border-radius: 0 0 16px 16px;
  box-shadow: 0 12px 28px rgba(90, 60, 40, 0.06);
  margin-bottom: 28px;
}
.world-editor-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px 0;
  background: transparent;
}
.world-editor-label {
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 3px;
  color: rgba(120, 90, 60, 0.4);
}
.world-editor-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}
.btn-polish {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
}

.world-editor-body {
  position: relative;
}
.world-editor .world-textarea {
  position: relative;
  z-index: 1;
  min-height: 520px;
  resize: vertical;
  font-family: inherit;
  font-size: 14px;
  line-height: 2.1;
  letter-spacing: 0.2px;
  color: #4a4038;
  padding: 32px 42px 26px;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: normal;
  scrollbar-width: thin;
  scrollbar-color: rgba(176, 130, 90, 0.3) transparent;
}
.world-editor .world-textarea::-webkit-scrollbar {
  width: 6px; height: 6px;
}
.world-editor .world-textarea::-webkit-scrollbar-track {
  background: transparent;
}
.world-editor .world-textarea::-webkit-scrollbar-thumb {
  background: rgba(176, 130, 90, 0.16);
  border-radius: 999px;
  transition: background 0.2s ease;
}
.world-editor-body:hover .world-textarea::-webkit-scrollbar-thumb {
  background: rgba(176, 130, 90, 0.34);
}
.world-editor-body:hover .world-textarea::-webkit-scrollbar-thumb:hover {
  background: rgba(176, 130, 90, 0.52);
}
.world-editor .world-textarea::placeholder {
  color: rgba(90, 70, 55, 0.35);
}
.world-editor .world-textarea::selection {
  background: rgba(var(--accent-rgb), 0.2);
}
.world-editor .world-textarea:focus {
  outline: none;
  box-shadow: none;
}
.world-editor-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 42px 12px;
  background: transparent;
}
.world-char-count {
  font-size: 12px;
  color: rgba(90, 70, 55, 0.55);
}
.world-saved-hint {
  font-size: 12.5px;
  color: #4caf84;
  font-weight: 500;
}

/* Footer 操作区 */
.world-modal-panel .modal-actions {
  position: sticky;
  bottom: 0;
  margin: 10px -30px -24px;
  padding: 8px 30px 12px;
  border-top: 1px solid rgba(120, 90, 60, 0.08);
}

/* ── 世界观 AI 润色弹窗 ── */
.polish-modal-panel {
  width: min(720px, 96vw);
}
.polish-tip {
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(var(--accent-rgb), 0.05);
  border: 1px dashed rgba(var(--accent-rgb), 0.28);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.polish-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 60px 0;
  color: var(--text-secondary);
  font-size: 14px;
}
.polish-spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid rgba(var(--accent-rgb), 0.18);
  border-top-color: var(--accent);
  animation: polish-spin 0.8s linear infinite;
}
@keyframes polish-spin {
  to { transform: rotate(360deg); }
}
.polish-error {
  padding: 18px;
  border-radius: 12px;
  background: rgba(255, 77, 79, 0.07);
  border: 1px solid rgba(255, 77, 79, 0.18);
}
.polish-error-text {
  margin: 0 0 14px;
  color: var(--danger);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.polish-error-actions {
  margin-top: 0 !important;
}
.polish-preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.polish-preview-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.polish-preview {
  max-height: 48vh;
  overflow-y: auto;
  background: #fdfaf3;
  border: 1px solid rgba(120, 90, 60, 0.1);
  border-radius: 12px;
  padding: 24px 30px;
  scrollbar-width: none;
}
.polish-preview::-webkit-scrollbar { width: 6px; height: 6px; }
.polish-preview:hover { scrollbar-width: thin; }
.polish-preview::-webkit-scrollbar-track { background: transparent; }
.polish-preview::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
.polish-preview:hover::-webkit-scrollbar-thumb { background: rgba(176, 130, 90, 0.22); }
.polish-preview pre {
  margin: 0;
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.95;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}
.polish-preview :deep(.world-sec-title) {
  display: block;
  margin: 22px 0 9px;
  font-size: 14.5px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: #8f4a33;
  border-left: 3px solid rgba(var(--accent-rgb), 0.4);
  padding: 1px 0 1px 9px;
}
.polish-preview :deep(.world-sec-title:first-child) {
  margin-top: 0;
}
.polish-preview :deep(.world-sec-tag) {
  font-weight: 700;
  color: #a05740;
  background: rgba(var(--accent-rgb), 0.1);
  border-radius: 4px;
  padding: 1px 5px;
}
.polish-preview :deep(.world-sec-item) {
  display: block;
  margin: 4px 0;
  color: #4a4038;
}

.inline-input {
  background: var(--bg-secondary);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 13px;
  color: var(--text-bright);
  outline: none;
  font-family: inherit;
}
/* ── 角色网格 ── */
/* 工具行：标题 + 批量归档 + 搜索框 */
.char-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}
.char-toolbar .section-title { margin-bottom: 0; }

.char-toolbar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 14px;
}

/* 批量归档开关 */
.char-archive-all {
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
}
.char-archive-all-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}
.char-archive-all-count {
  font-size: 11px;
  line-height: 1.6;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-secondary);
}

.char-search {
  position: relative;
  width: 220px;
  max-width: 46vw;
  flex-shrink: 0;
}
.char-search-input { width: 100%; }
.char-search-clear {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: all var(--dur-fast) ease;
}
.char-search-clear:hover { background: var(--accent); color: #fff; }

/* ── 文件夹筛选栏 ── */
.folder-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.folder-chip {
  user-select: none;
  max-width: 220px;
  /* 提示可拖动；实际拖拽用 HTML5 draggable，不依赖光标样式 */
  cursor: grab;
}
.folder-chip:active { cursor: grabbing; }
/* 正在被拖走的那一枚：淡出让位 */
.folder-chip.is-dragging {
  opacity: 0.35;
  cursor: grabbing;
}
/* 拖到谁头上，谁高亮成"将插到这里" */
.folder-chip.is-drop-target {
  outline: 2px dashed var(--accent);
  outline-offset: 2px;
}
/* 「归档管理」入口：与文件夹 chip 同排，但用低调的虚线边提示它是另一种视图。
   它不参与拖拽排序，所以要覆盖掉 .folder-chip 的 grab 光标。 */
.folder-chip-archived {
  border-style: dashed;
  color: var(--text-secondary);
  cursor: pointer;
}
.folder-chip-archived:active { cursor: pointer; }
.folder-chip-archived.active {
  border-style: solid;
  color: var(--on-accent, #fff);
}
.folder-chip-icon { flex-shrink: 0; opacity: 0.8; }
.folder-chip-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder-chip-count {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-secondary);
}
.folder-chip.active .folder-chip-count {
  background: rgba(var(--accent-rgb), 0.16);
  color: var(--accent);
}
.folder-chip-op {
  font-size: 11px;
  line-height: 13px;
}
.folder-chip-new {
  border-style: dashed;
}
.folder-chip-new:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* 空状态（文件夹为空 / 搜索无结果），皮肤走全局 .empty */
.char-empty {
  margin-top: 8px;
}

/* ── 文件夹选择弹窗 / 编辑弹窗 ── */
.folder-editor-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.folder-editor-hint,
.folder-pick-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.folder-pick-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 46vh;
  overflow-y: auto;
}
.folder-pick-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  border: 1.5px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-bright);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--dur-fast) ease;
}
.folder-pick-item:hover {
  border-color: var(--accent-light);
  color: var(--accent);
}
.folder-pick-item.active {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.10);
  color: var(--accent);
  font-weight: 600;
}
.folder-pick-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder-pick-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-secondary);
}
.folder-pick-item.active .folder-pick-count { color: var(--accent); }

.section-title {
  font-size: 15px; font-weight: 600; color: var(--text-secondary);
  margin-bottom: 14px;
}

.char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
}

.char-card {
  position: relative;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 20px 12px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}

/* ── 状态标记 ── */
.char-card-badges {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 3px;
  z-index: 1;
}

.char-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-moments { background: #b0a0d0; }
.dot-proactive { background: #e8a87c; }
.dot-events { background: #c0a0a0; }

/* ── 左上角置顶按钮（常驻半透明，悬停加深） ── */
.char-pin-btn {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  box-sizing: border-box;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
  opacity: 0.5;
}

.char-pin-btn:hover {
  opacity: 1;
  background: rgba(var(--accent-rgb), 0.08);
  color: var(--accent);
}

.char-pin-btn.pinned {
  opacity: 1;
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.1);
}

/* ── 左上角文件夹入口（与置顶按钮同一列，常驻半透明） ── */
.char-folder-btn {
  position: absolute;
  top: 36px;
  left: 6px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  box-sizing: border-box;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
  opacity: 0.4;
}
.char-folder-btn:hover {
  opacity: 1;
  background: rgba(var(--accent-rgb), 0.08);
  color: var(--accent);
}
.char-folder-btn.has-folder {
  opacity: 0.8;
  color: var(--accent);
}
/* 触屏没有 hover，常驻可见 */
@media (hover: none) {
  .char-folder-btn { opacity: 0.7; }
}

.char-card:hover {
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}

/* ── 置顶 / 取消置顶后卡片重排：TransitionGroup 的 FLIP 位移过渡 ── */
.char-card.char-pin-move {
  transition: transform var(--dur-slow) var(--ease-out);
}

.char-card-avatar {
  width: 64px; height: 64px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 24px; font-weight: 700;
  flex-shrink: 0;
}

.char-card-name {
  font-size: 14px; font-weight: 600; color: var(--text-bright);
  text-align: center;
  line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* ── 已归档：整卡压暗 + 角标，但仍可点开详情 ── */
.char-card.archived { opacity: 0.55; }
.char-card.archived:hover { opacity: 0.9; }
.char-card-archived {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: rgba(0, 0, 0, 0.07);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.6;
  user-select: none;
}

/* 「取消归档」：只在归档管理视图出现，替代/补位于「已归档」角标下方 */
.char-unarchive-btn {
  margin-top: 2px;
  padding: 3px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-bright);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.char-unarchive-btn:hover { border-color: var(--accent); color: var(--accent); }
.char-unarchive-btn.is-busy { opacity: 0.6; pointer-events: none; }

.char-card-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
}

.char-card-status {
  font-size: 11px; color: var(--text-secondary);
}
.char-card-status.active { color: var(--accent); }
.char-card-status.idle { color: var(--text-secondary); }

.char-rel-badge {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
}

.char-card-edit-row {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-top: 2px;
}

.char-card-edit {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.char-card-edit:hover {
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent);
}

/* ── 招募卡片 ── */
.recruit-card {
  border-style: dashed;
  border-color: rgba(var(--accent-rgb), 0.35);
  justify-content: center;
  min-height: 160px;
}
.recruit-card:hover {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.06);
}

.recruit-plus {
  width: 48px; height: 48px;
  border-radius: 50%;
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; font-weight: 300;
}
.recruit-card span {
  font-size: 13px; color: var(--accent); font-weight: 500;
}

/* ── 表情包管理入口卡片 ── */
.emoji-manage-card {
  border-style: dashed;
  border-color: rgba(255, 184, 0, 0.35);
  justify-content: center;
  min-height: 160px;
}
.emoji-manage-card:hover {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.06);
}
.standing-manage-card { border-color: var(--border-strong); text-align: center; cursor: pointer; }
.emoji-manage-icon {
  width: 34px; height: 34px;
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
}
.emoji-manage-icon svg {
  width: 100%; height: 100%;
  display: block;
}
.emoji-manage-card span {
  font-size: 13px;
  color: var(--accent);
  font-weight: 500;
}

/* ── 弹窗骨架已迁移至全局 .modal-*（styles/components.css）── */
.modal-wide { width: min(1100px, 97vw); }


.modal-body {
  padding: 0px 22px 22px;
}

.modal-body-detail {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-body-detail .preview-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.modal-body-detail .prompt-textarea {
  flex: 1;
  min-height: 0;
  resize: none;
  overflow-y: auto;
  scrollbar-width: auto;
  scrollbar-color: var(--text-secondary) transparent;
}
.modal-body-detail .prompt-textarea::-webkit-scrollbar {
  width: 10px;
}
.modal-body-detail .prompt-textarea::-webkit-scrollbar-track {
  background: transparent;
}
.modal-body-detail .prompt-textarea::-webkit-scrollbar-thumb {
  background: var(--text-secondary);
  border-radius: 5px;
}
.modal-body-detail .prompt-textarea::-webkit-scrollbar-thumb:hover {
  background: var(--text-primary);
}

.modal-hint { font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.5; }

.modal-actions {
  display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;
}
.modal-actions-between {
  justify-content: space-between;
}
.modal-actions-left {
  display: flex;
  gap: 10px;
}
.modal-actions-right {
  display: flex;
  gap: 10px;
}

.recruit-textarea { width: 100%; min-height: 80px; }
.import-card-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
  padding: 7px 14px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s, border-color 0.2s, opacity 0.2s;
}
.import-card-btn:hover {
  background: rgba(var(--accent-rgb), 0.1);
  border-color: var(--accent);
}
.import-card-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.gen-error { margin-top: 10px; padding: 8px 12px; border-radius: 8px; background: rgba(255,77,79,0.06); color: var(--danger); font-size: 13px; white-space: pre-wrap; line-height: 1.5; }

/* ── 扫描动画覆盖层 ── */
.scan-overlay {
  position: absolute; inset: 0;
  background: transparent;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 0 0 18px 18px;
  display: flex; align-items: center; justify-content: center;
  z-index: 10; overflow: hidden;
}
.scan-line {
  position: absolute; left: 10%; right: 10%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: scan-sweep 2s ease-in-out infinite;
  box-shadow: 0 0 24px rgba(var(--accent-rgb),0.6), 0 0 8px rgba(var(--accent-rgb),0.3);
}
@keyframes scan-sweep {
  0%   { top: 10%; opacity: 0.2; }
  25%  { top: 90%; opacity: 1; }
  50%  { top: 90%; opacity: 0.2; }
  75%  { top: 10%; opacity: 1; }
  100% { top: 10%; opacity: 0.2; }
}
.scan-text {
  font-size: 14px; color: var(--accent); font-weight: 600;
  animation: scan-pulse 1.2s ease-in-out infinite;
  text-shadow: 0 0 12px rgba(var(--accent-rgb),0.3);
}
@keyframes scan-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.97); }
  50%      { opacity: 1;   transform: scale(1); }
}

/* ── 预览姓名可编辑 ── */
.preview-name-row {
  display: flex; gap: 10px;
}
.preview-name-input {
  font-size: 20px; font-weight: 700;
  flex: 1; min-width: 0;
}

/* ── 预览卡片 ── */
.preview-card {
  background: var(--glass-bg); border: 1px solid var(--glass-border);
  border-radius: 14px; padding: 18px;
}

.preview-name {
  font-size: 20px; font-weight: 700; color: var(--text-bright);
  margin-bottom: 8px;
}

.preview-prompt-label { font-size: 12px; color: var(--text-secondary); margin: 6px 0; }
.preview-prompt {
  padding: 12px; border-radius: 10px;
  background: var(--bg-primary); border: 1px solid var(--glass-border);
  font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-word;
  max-height: 500px; overflow-y: auto; color: var(--text-primary); font-family: inherit;
}

.recruit-appearance-hint {
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-muted, #999);
  line-height: 1.5;
  text-align: center;
}
.recruit-appearance-hint a {
  color: var(--text-muted, #999);
  text-decoration: underline;
}

/* ── 角色详情弹窗 ── */
.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; margin-bottom: 4px; }

.detail-avatar-row { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.detail-avatar {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 26px; font-weight: 700; flex-shrink: 0;
}
.detail-avatar.clickable { cursor: pointer; transition: opacity 0.15s; }
.detail-avatar.clickable:hover { opacity: 0.85; }

/* ── 角色关系区块（详情内嵌） ── */
.detail-rel-section {
  margin-bottom: 16px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(var(--accent-rgb), 0.04);
  border: 1px solid rgba(var(--accent-rgb), 0.1);
}
.detail-rel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.detail-rel-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-bright);
  display: flex;
  align-items: center;
  gap: 6px;
}
/* detail-rel-btn 家族样式已收编至全局 components.css */
.detail-rel-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.detail-rel-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.6);
  font-size: 12px;
}
.rel-from, .rel-to {
  font-weight: 600;
  color: var(--text-bright);
}
.rel-text {
  color: var(--accent);
  font-weight: 500;
  padding: 1px 8px;
  border-radius: 4px;
  background: rgba(var(--accent-rgb), 0.1);
}

.detail-rel-more {
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  padding: 4px 0;
  transition: opacity 0.15s;
}
.detail-rel-more:hover {
  opacity: 0.7;
}

/* 空状态——CTA 区域 */
.detail-rel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 18px 8px 8px;
  text-align: center;
}
.rel-empty-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
  max-width: 360px;
}
.rel-empty-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(var(--accent-rgb), 0.2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: rel-spin 0.6s linear infinite;
}
@keyframes rel-spin {
  to { transform: rotate(360deg); }
}

/* ── 悬浮侧边栏 ── */
.detail-float {
  position: absolute;
  left: calc(50% + min(450px, 48.5vw) + 16px);
  top: 70px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 20px;
}
.float-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(0,0,0,0.06);
  box-shadow: 0 2px 16px rgba(0,0,0,0.06);
  transition: all 0.15s;
  width: 220px;
}
.float-card-toggle {
  justify-content: space-between;
  gap: 0;
}
.float-label {
  font-size: 11px; font-weight: 600; color: var(--text-secondary);
  white-space: nowrap;
}
.float-card-btn {
  cursor: pointer;
  justify-content: space-between;
  gap: 0;
}
.float-card-btn:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 20px rgba(var(--accent-rgb), 0.12);
}
.float-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-muted, #f0f0f0);
  color: var(--text-secondary);
}
.float-badge.active {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--accent);
}

/* override old layout styles */
.detail-layout { display: block; }
.detail-sidebar { display: none; }

.prompt-textarea { min-height: 500px; }

/* 角色详情 input/textarea — 与招募预览卡片统一 */
.modal-wide .prompt-textarea {
  padding: 12px;
  font-size: 12px;
  scrollbar-width: auto;
  scrollbar-color: var(--text-secondary) transparent;
}
.modal-wide .prompt-textarea::-webkit-scrollbar { width: 10px; }
.modal-wide .prompt-textarea::-webkit-scrollbar-track { background: transparent; }
.modal-wide .prompt-textarea::-webkit-scrollbar-thumb { background: var(--text-secondary); border-radius: 5px; }
.modal-wide .prompt-textarea::-webkit-scrollbar-thumb:hover { background: var(--text-primary); }

/* ── 操作栏 sticky footer ── */
.modal-footer {
  flex-shrink: 0;
  padding: 10px 22px 18px;
  border-top: 1px solid var(--glass-border);
  background: inherit;
}

.detail-actions {
  display: flex; align-items: center; margin-top: 0; gap: 10px;
}
.detail-actions-right { margin-left: auto; display: flex; gap: 10px; }

/* 弹窗动画已迁移至全局 animations.css */

/* ── 移动端 ── */
@media (max-width: 767px) {
  .tavern-view { padding: 16px; }
  .page-header {
    position: sticky; top: 0; z-index: 20;
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    padding: 8px 0; margin-bottom: 18px;
  }
  .char-grid {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
  }
  /* 窄屏放不下两列入口：回退单行堆叠 */
  .relation-entry-row {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .relation-entry-row .relation-entry {
    margin-bottom: 12px;
  }
  .char-card { padding: 14px 8px 12px; }
  .char-card-avatar { width: 52px; height: 52px; font-size: 20px; }
  .char-card-name { font-size: 13px; }
  .char-card-edit { padding: 2px 8px; font-size: 10px; }
  .recruit-plus { width: 40px; height: 40px; font-size: 24px; }
  .recruit-card { min-height: 132px; }

  /* ── 弹窗移动端适配 ── */
  .modal-panel {
    width: 100vw;
    max-height: 100vh; max-height: 100dvh;
    border-radius: 0;
  }
  .modal-header {
    padding: 10px 16px;
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
  }
  .modal-header h3 {
    font-size: 15px;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-right: 8px;
  }
  .modal-close {
    flex-shrink: 0;
  }
  .modal-body {
    padding: 0 16px calc(16px + env(safe-area-inset-bottom, 0px));
  }
  .modal-actions {
    flex-wrap: wrap; gap: 8px;
  }
  .modal-actions-between {
    flex-direction: column; gap: 10px;
  }
  .modal-actions-left {
    flex-wrap: wrap; gap: 8px;
  }
  .modal-actions-right {
    flex-wrap: wrap; gap: 8px; justify-content: flex-end;
  }

  /* 世界观 / 润色弹窗移动端 */
  .world-modal-panel .world-modal-header { padding: 14px 16px 12px; padding-top: calc(14px + env(safe-area-inset-top, 0px)); }
  .world-modal-subtitle { display: none; }
  .world-active-badge { max-width: 110px; padding: 3px 9px; }
  .world-modal-panel .modal-body { padding: 0 14px 20px; }
  .world-tags { padding: 2px 4px 0; gap: 2px; }
  .world-editor { border-radius: 0 0 12px 12px; }
  .world-editor .world-textarea { min-height: 320px; padding: 20px 20px 16px; }
  .world-modal-panel .modal-actions { margin: 10px -14px -20px; padding: 8px 14px 12px; }
  .polish-preview { max-height: 55vh; }

  /* 招募预览卡片 */
  .preview-card {
    padding: 14px;
  }
  .preview-name-row {
    flex-direction: column; gap: 6px;
  }
  .preview-name-input {
    font-size: 18px;
    padding: 4px 8px;
  }
  .preview-prompt {
    font-size: 14px;
    max-height: 350px;
  }

  /* 角色详情 */
  .detail-avatar-row {
    gap: 10px; margin-bottom: 12px;
  }
  .detail-rel-section {
    padding: 12px;
    margin-bottom: 14px;
  }
  /* .detail-rel-btn 移动端覆写已在全局 components.css */
  .detail-layout { flex-direction: column; }

  /* 移动端详情工具栏 */
  .mobile-detail-toolbar {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--glass-border);
    background: rgba(0, 0, 0, 0.02);
    flex-shrink: 0;
  }
  .toolbar-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 12px;
    border-radius: 8px;
    background: rgba(var(--accent-rgb), 0.08);
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    justify-content: center;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  .toolbar-item:active {
    background: rgba(var(--accent-rgb), 0.16);
  }
  .toolbar-item-toggle {
    cursor: default;
    justify-content: space-between;
    background: rgba(0, 0, 0, 0.04);
    color: var(--text-secondary);
    font-weight: 500;
  }
  .toolbar-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--bg-muted, #f0f0f0);
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .toolbar-badge.active {
    background: rgba(var(--accent-rgb), 0.15);
    color: var(--accent);
  }

  .detail-avatar {
    width: 52px; height: 52px; font-size: 22px;
  }
  .detail-actions {
    flex-wrap: wrap; gap: 8px;
  }
  .detail-actions-right {
    margin-left: 0; flex-wrap: wrap; gap: 8px;
  }
  .modal-footer {
    padding: 8px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  }
  .prompt-textarea {
    min-height: 350px; font-size: 16px;
  }
  .modal-wide .prompt-textarea {
    font-size: 16px;
  }
  .modal-wide .recruit-textarea {
    font-size: 16px;
  }
}

</style>
