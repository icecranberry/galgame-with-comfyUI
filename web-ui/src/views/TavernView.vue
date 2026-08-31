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
         用户关系图入口卡片
         ═══════════════════════════════════════════ -->
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

    <!-- ═══════════════════════════════════════════
         角色卡片网格
         ═══════════════════════════════════════════ -->
    <div class="section-title">角色 ({{ sortedCharacters.length }})</div>
    
    <!-- ═══════════════════════════════════════════
         世界观设置入口卡片
         ═══════════════════════════════════════════ -->
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
    <div class="char-grid">
        <!-- 表情包管理入口：永远在招募前 -->
        <div class="char-card emoji-manage-card" @click="showEmojiManager = true">
          <div class="emoji-manage-icon">
            <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
              <path d="M334.711467 160.290133a413.013333 413.013333 0 0 1 239.547733-48.674133 37.614933 37.614933 0 0 1-7.509333 74.683733A338.056533 338.056533 0 0 0 197.973333 567.022933a337.92 337.92 0 0 0 672.9728-42.5984v-37.546666a37.546667 37.546667 0 1 1 75.093334 0v37.751466a413.013333 413.013333 0 1 1-611.328-364.3392z"/>
              <path d="M653.312 576.853333a37.546667 37.546667 0 0 1 59.938133 45.192534l-0.2048 0.273066-0.273066 0.341334-0.8192 1.024a141.585067 141.585067 0 0 1-11.946667 13.5168 261.12 261.12 0 0 1-34.679467 30.242133c-29.9008 21.777067-75.093333 44.714667-132.3008 44.714667-57.344 0-102.4-22.9376-132.437333-44.714667a261.256533 261.256533 0 0 1-43.895467-40.5504l-2.730666-3.208533-0.682667-1.024a19.0464 19.0464 0 0 0-0.341333-0.341334v-0.136533l-0.2048-0.136533a37.546667 37.546667 0 0 1 60.074666-45.056h0.068267l1.297067 1.6384a186.1632 186.1632 0 0 0 30.72 28.0576c21.572267 15.7696 51.541333 30.446933 88.064 30.446933 36.6592 0 66.628267-14.677333 88.2688-30.446933a186.026667 186.026667 0 0 0 30.583466-27.989334l1.297067-1.6384 0.2048-0.2048zM420.727467 374.237867a37.546667 37.546667 0 0 1 0 75.093333h-0.341334a37.546667 37.546667 0 0 1 0-75.093333h0.341334z m225.28 0a37.546667 37.546667 0 0 1 0 75.093333h-0.4096a37.546667 37.546667 0 0 1 0-75.093333h0.4096z m112.298666 0v-75.093334h-75.093333a37.546667 37.546667 0 0 1 0-75.093333h75.093333v-75.093333a37.546667 37.546667 0 0 1 75.093334 0v75.093333h75.093333a37.546667 37.546667 0 0 1 0 75.093333h-75.093333v75.093334a37.546667 37.546667 0 1 1-75.093334 0z"/>
            </svg>
          </div>
          <span>表情包管理</span>
        </div>

      <!-- 招募卡片：永远在第一格 -->
      <div class="char-card recruit-card" @click="openRecruit">
        <div class="recruit-plus">+</div>
        <span>招募</span>
      </div>

      <!-- 角色卡片 -->
      <div
        v-for="c in sortedCharacters"
        :key="c.id"
        class="char-card"
        @click="openCharDetail(c)"
      >
        <div v-if="c.moments_disabled || c.proactive_disabled || c.events_disabled" class="char-card-badges">
          <span v-if="c.moments_disabled" class="char-status-dot dot-moments" title="不看ta的朋友圈"></span>
          <span v-if="c.proactive_disabled" class="char-status-dot dot-proactive" title="不主动聊天"></span>
          <span v-if="c.events_disabled" class="char-status-dot dot-events" title="不发生奇遇"></span>
        </div>
        <div
          class="char-card-avatar"
          :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
        >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
        <div class="char-card-name">{{ c.display_name }}</div>
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
                  {{ recruit.loading ? '正在酒馆招募...' : '✨ 招募角色' }}
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
                  <input
                    v-model="recruit.result.display_name"
                    class="preview-name-input"
                    placeholder="角色名"
                  />
                  <input
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
                ↑检查外观描述，可以写的少但是更需要准确，必要情况下传立绘给识图AI精确反推描述或者查阅
                <a :href="`https://animadex.net/?mode=characters&q=${encodeURIComponent(recruit.result.name).replaceAll('_', '+')}`" target="_blank">animadex</a>直接补充tag
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

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

      <EmojiManagerModal v-if="showEmojiManager" :characters="sortedCharacters" @close="showEmojiManager = false" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch, inject, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
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
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import { useMailboxStore } from '../stores/mailbox.js'
import { useBackpackStore } from '../stores/backpack.js'

const router = useRouter()
const chat = useChatStore()
const mailboxStore = useMailboxStore()
const backpackStore = useBackpackStore()

const showMailbox = ref(false)
const showBackpack = ref(false)
const showEmojiManager = ref(false)
const mailboxUnread = computed(() => mailboxStore.unreadCount)
const backpackChestReady = computed(() => backpackStore.chestReady)

// 按 display_name 首字母排序（中文按拼音）
const sortedCharacters = computed(() =>
  [...chat.characters].sort((a, b) =>
    (a.display_name || '').localeCompare(b.display_name || '', 'zh-CN')
  )
)
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
  return { background: '#e07b6c' }
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
  stopLoadingTips()
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
      if (/^\s*[-•·*]\s+/.test(safe) || /^\s*\d+[\.、．]/.test(safe)) {
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
  if (worldSaving.value || !selectedWorldId.value) return
  worldSaving.value = true
  try {
    const result = await api.updateWorldSetting(selectedWorldId.value, { content: worldContent.value.trim() })
    if (!result?.ok) throw new Error(result?.error || '保存失败')
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
  await api.uploadAvatar(detailChar.value.id, base64 || '')
  await chat.loadCharacters()
  const updated = chat.characters.find(x => x.id === detailChar.value.id)
  if (updated) detailChar.value = updated
  showCharAvatarPicker.value = false
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
  // 拉一次宝箱状态，驱动入口卡上的「可开启」小圆点
  backpackStore.fetchItems()
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

/* ── 卡片共用 ── */
.card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 20px 24px;
  box-shadow: var(--glass-shadow);
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
  border-color: rgba(224, 123, 108, 0.2);
  box-shadow: 0 2px 16px rgba(224, 123, 108, 0.08);
}

.relation-entry-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  background: rgba(224, 123, 108, 0.1);
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
  background: rgba(224, 123, 108, 0.08);
  color: #c06a52;
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
  color: #a9573d;
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
  background: rgba(224, 123, 108, 0.12);
  color: #b8664d;
}

.world-tag-del:hover {
  color: #dc3c3c !important;
  background: rgba(220, 60, 60, 0.16);
}

.world-tag-rename-input {
  width: 90px;
  padding: 3px 6px;
  font-size: 13px;
  color: var(--text-bright);
  background: #fffdf8;
  border: 1px solid rgba(224, 123, 108, 0.4);
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
  background: rgba(224, 123, 108, 0.1);
  color: #b8664d;
}

/* ── 新建名称行 ── */
.world-new-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: rgba(224, 123, 108, 0.05);
  border: 1px solid rgba(224, 123, 108, 0.12);
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
  background: radial-gradient(120% 100% at 22% 0%, rgba(224, 123, 108, 0.11) 0%, rgba(224, 123, 108, 0.04) 55%, transparent 100%);
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
  background: rgba(224, 123, 108, 0.08);
  border: 1px solid rgba(224, 123, 108, 0.18);
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
  background: rgba(224, 123, 108, 0.2);
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
  background: rgba(224, 123, 108, 0.05);
  border: 1px dashed rgba(224, 123, 108, 0.28);
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
  border: 3px solid rgba(224, 123, 108, 0.18);
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
  border-left: 3px solid rgba(224, 123, 108, 0.4);
  padding: 1px 0 1px 9px;
}
.polish-preview :deep(.world-sec-title:first-child) {
  margin-top: 0;
}
.polish-preview :deep(.world-sec-tag) {
  font-weight: 700;
  color: #a05740;
  background: rgba(224, 123, 108, 0.1);
  border-radius: 4px;
  padding: 1px 5px;
}
.polish-preview :deep(.world-sec-item) {
  display: block;
  margin: 4px 0;
  color: #4a4038;
}

.inline-input {
  background: rgba(255,255,255,0.9);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 13px;
  color: var(--text-bright);
  outline: none;
  font-family: inherit;
}
/* ── 角色网格 ── */
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
.char-card:hover {
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
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
  background: rgba(224, 123, 108, 0.1);
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
  background: rgba(224, 123, 108, 0.12);
  color: var(--accent);
}

/* ── 招募卡片 ── */
.recruit-card {
  border-style: dashed;
  border-color: rgba(224, 123, 108, 0.35);
  justify-content: center;
  min-height: 160px;
}
.recruit-card:hover {
  border-color: var(--accent);
  background: rgba(224, 123, 108, 0.06);
}

.recruit-plus {
  width: 48px; height: 48px;
  border-radius: 50%;
  background: rgba(224, 123, 108, 0.12);
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
  background: rgba(224, 123, 108, 0.06);
}
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

/* ── 弹窗共用 ── */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
}

.modal-panel {
  background: #f4f1eeed; border-radius: 18px;
  width: min(880px, 96vw); max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
  overflow: hidden;backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.modal-wide { width: min(1100px, 97vw); }

.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid var(--glass-border);
}
.modal-header h3 { font-size: 17px; font-weight: 600; color: var(--text-bright); }

.modal-close {
  width: 30px; height: 30px;
}

.modal-body {
  padding: 0px 22px 22px;
  overflow-y: auto; flex: 1;
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
  background: rgba(224, 123, 108, 0.1);
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
  box-shadow: 0 0 24px rgba(224,123,108,0.6), 0 0 8px rgba(224,123,108,0.3);
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
  text-shadow: 0 0 12px rgba(224,123,108,0.3);
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
  font-size: 20px; font-weight: 700; color: var(--text-bright);
  background: #f0ece8;
  border: 1px dashed rgba(224, 123, 108, 0.25);
  border-radius: 8px; padding: 4px 10px;
  flex: 1; min-width: 0; outline: none; font-family: inherit;
  transition: border-color 0.2s, background 0.2s;
  cursor: text;
}
.preview-name-input:hover  { border-color: rgba(224, 123, 108, 0.45); background: rgba(224, 123, 108, 0.07); }
.preview-name-input:focus  { border-color: var(--accent); background: rgba(255,255,255,0.5); }

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
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--text-muted, #999);
  white-space: nowrap;
  text-align: center;
  max-width: calc(100% - 32px);
  overflow: hidden;
  text-overflow: ellipsis;
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
  background: rgba(224, 123, 108, 0.04);
  border: 1px solid rgba(224, 123, 108, 0.1);
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
.detail-rel-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.detail-rel-btn.subtle {
  background: rgba(224, 123, 108, 0.06);
  border: 1px solid rgba(224, 123, 108, 0.15);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 10px;
}
.detail-rel-btn.subtle:hover {
  background: rgba(224, 123, 108, 0.14);
  border-color: rgba(224, 123, 108, 0.3);
  color: #d06a5a;
}
/* 空状态 CTA 按钮——更醒目 */
.detail-rel-btn.cta {
  padding: 10px 22px;
  font-size: 14px;
  background: var(--accent);
  color: #fff;
  box-shadow: 0 2px 12px rgba(224, 123, 108, 0.25);
}
.detail-rel-btn.cta:hover {
  background: var(--accent-hover);
  box-shadow: 0 4px 18px rgba(224, 123, 108, 0.35);
  transform: translateY(-1px);
}

/* 已有关系的条目列表 */
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
  background: rgba(224, 123, 108, 0.1);
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
  border: 2px solid rgba(224, 123, 108, 0.2);
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
  box-shadow: 0 4px 20px rgba(224, 123, 108, 0.12);
}
.float-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-muted, #f0f0f0);
  color: var(--text-secondary);
}
.float-badge.active {
  background: rgba(224, 123, 108, 0.15);
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

/* ── 弹窗动画 ── */
.modal-fade-enter-active { transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .modal-panel { animation: modal-pop 0.28s cubic-bezier(0.17, 0.89, 0.32, 1.25); }

@keyframes modal-pop {
  0% { transform: scale(0.92); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

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
  .detail-rel-btn {
    padding: 5px 10px;
    font-size: 11px;
  }
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
    background: rgba(224, 123, 108, 0.08);
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
    background: rgba(224, 123, 108, 0.16);
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
    background: rgba(224, 123, 108, 0.15);
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
