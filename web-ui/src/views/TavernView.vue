<template>
  <div class="tavern-view" @scroll="onScroll">
    <div class="page-header" :class="{ 'header-hidden': isMobile && !headerVisible }">
      <h2 @click="isMobile && toggleMobileSidebar?.()" :class="{ 'is-clickable': isMobile }">酒馆</h2>
    </div>

    <!-- ═══════════════════════════════════════════
         用户信息卡片
         ═══════════════════════════════════════════ -->
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
            <button v-if="!editingNickname" class="edit-pen" @click="startEditNickname" title="编辑称呼">✎</button>
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
            <button v-if="!editingGender" class="edit-pen" @click="startEditGender" title="编辑性别">✎</button>
          </div>
        </div>
        <!-- 外观特征 -->
        <div class="user-field-row">
          <span class="field-label">外观</span>
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
              placeholder="外观描述越紧密越不容易和其他角色串，示例：长着金色头发的贫乳大小姐，穿着白色蕾丝洛丽塔"
            ></textarea>
            <span v-else class="field-value" @click="startEditAppearance">{{ userAppearance || '点击描述你的外貌特征...' }}</span>
            <button v-if="!editingAppearance" class="edit-pen" @click="startEditAppearance" title="编辑外观">✎</button>
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
            <button v-if="!editingPersona" class="edit-pen" @click="startEditPersona" title="编辑其他说明">✎</button>
          </div>
        </div>
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
    <div class="section-title">角色</div>
    
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
        <span class="relation-entry-hint">定义所有角色共处的世界背景</span>
      </div>
      <span class="relation-entry-arrow">›</span>
    </div>
    <div class="char-grid">
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
        <div
          class="char-card-avatar"
          :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
        >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
        <div class="char-card-name">{{ c.display_name }}</div>
        <div class="char-card-foot">
          <span class="char-card-status" :class="c.message_count > 0 ? 'active' : 'idle'">
            {{ c.message_count > 0 ? `${c.message_count} 条消息` : '待唤醒' }}
          </span>
          <span v-if="charRelCounts[c.id]" class="char-rel-badge" title="已设置角色关系">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
              <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
            </svg>
            {{ charRelCounts[c.id] }}
          </span>
        </div>
        <div v-if="!charRelCounts[c.id]" class="char-card-edit-row">
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
              <button class="modal-close" @click="closeRecruit">✕</button>
            </div>

            <!-- 步骤 0：输入描述 -->
            <div v-if="recruit.step === 'input'" class="modal-body" style="position:relative;background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:14px;padding:18px;margin:0 20px 20px">
              <p class="modal-hint">描述你想招募的角色——可以是知名 IP 角色（尽可能输入全名+IP），也可以是原创设定。</p>
              <textarea
                v-model="recruit.desc"
                class="fi recruit-textarea"
                rows="4"
                placeholder="例：安比·德玛拉（绝区零）/ 流萤，崩坏：星穹铁道/ 御坂美琴《某科学的超电磁炮》/ 傲娇的猫娘女仆 / 金发双马尾大小姐，品学兼优，爱好摇滚，穿着涩谷辣妹风"
                :disabled="recruit.loading"
                @keydown.enter.exact="doGenerate"
              ></textarea>
              <div class="modal-actions">
                <button class="btn-ghost" @click="closeRecruit">取消</button>
                <button
                  class="btn-primary"
                  :disabled="!recruit.desc.trim() || recruit.loading"
                  @click="doGenerate"
                >
                  {{ recruit.loading ? '正在酒馆招募...' : '✨ 招募角色' }}
                </button>
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
                <input
                  v-model="recruit.result.display_name"
                  class="preview-name-input"
                  placeholder="角色名称"
                />
                <div class="preview-prompt-label">人格提示词（——关于外观描述：若不准确自行纠正或传图给其他AI反推提示词）</div>
                <textarea v-model="recruit.result.base_prompt" class="fi prompt-textarea" rows="12"></textarea>

                <!-- 朋友圈开关 -->
              </div>
              <div class="modal-actions modal-actions-between">
                <button
                  class="btn-ghost"
                  :disabled="recruit.loading"
                  @click="doGenerate"
                >重新招募</button>
                <div class="modal-actions-right">
                  <button class="btn-ghost" @click="recruit.step = 'input'; recruit.error = ''">返回修改</button>
                  <button class="btn-primary" :disabled="recruit.saving" @click="confirmRecruit">
                    {{ recruit.saving ? '招募中...' : '确认招募' }}
                  </button>
                </div>
              </div>
              <div v-if="recruit.error" class="gen-error">{{ recruit.error }}</div>
              <!-- 扫描动画覆盖层 -->
              <div v-if="recruit.loading" class="scan-overlay">
                <div class="scan-line"></div>
                <div class="scan-text">{{ loadingTip }}</div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 搜索提示 Toast -->
    <Teleport to="body">
      <Transition name="toast-slide">
        <div v-if="toast.show" class="search-toast" :class="toast.type">
          <span class="toast-icon">{{ toast.type === 'success' ? '📚' : '🔍' }}</span>
          <span class="toast-msg">{{ toast.message }}</span>
          <button class="toast-close" @click="toast.show = false">✕</button>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══════════════════════════════════════════
         世界观编辑弹窗
         ═══════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showWorldModal" class="modal-overlay" @click.self="closeWorldSetting">
          <div class="modal-panel">
            <div class="modal-header">
              <h3>世界观设置</h3>
              <button class="modal-close" @click="closeWorldSetting">✕</button>
            </div>
            <div class="modal-body">
              <p class="modal-hint">定义角色们所处的共同世界背景，留空则不追加。</p>
              <textarea
                v-model="worldSetting"
                class="fi world-textarea"
                rows="10"
                placeholder="例如：这是一个低魔世界，魔法师必须养一只不会魔法的宠物当充电宝。/每天凌晨三点，全人类会共享同一个梦，醒后都能记住。"
                @input="worldDirty = true"
              ></textarea>
              <div class="modal-actions">
                <button class="btn-ghost" @click="closeWorldSetting">取消</button>
                <button
                  class="btn-primary"
                  :disabled="!worldDirty || worldSaving"
                  @click="saveWorldSetting"
                >
                  {{ worldSaving ? '保存中...' : '保存' }}
                </button>
              </div>
              <div v-if="worldSaved" class="world-saved-hint">✓ 已保存</div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══════════════════════════════════════════
         角色详情弹窗
         ═══════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="detail.show" class="modal-overlay">
          <div class="modal-panel modal-wide" style="height:95vh;max-height:95vh">
            <div class="modal-header">
              <h3>{{ detail.char?.display_name }}</h3>
              <button class="modal-close" @click="closeCharDetail">✕</button>
            </div>
            <!-- 移动端工具栏 -->
            <div class="mobile-detail-toolbar" v-if="isMobile">
              <div class="toolbar-item toolbar-item-toggle">
                <span>不看ta的朋友圈</span>
                <label class="toggle-switch toolbar-switch">
                  <input type="checkbox" v-model="detail.momentsDisabled" @change="toggleMomentsDisabled" :disabled="detail.momentsToggling" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="toolbar-item toolbar-item-toggle">
                <span>不主动聊天</span>
                <label class="toggle-switch toolbar-switch">
                  <input type="checkbox" v-model="detail.proactiveDisabled" @change="toggleProactiveDisabled" :disabled="detail.proactiveToggling" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="toolbar-item toolbar-item-toggle">
                <span>不发生奇遇</span>
                <label class="toggle-switch toolbar-switch">
                  <input type="checkbox" v-model="detail.eventsDisabled" @change="toggleEventsDisabled" :disabled="detail.eventsToggling" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="toolbar-item toolbar-item-btn" @click="openLoraModal">
                <span>设置 Lora</span>
                <span v-if="hasLoraSetup" class="toolbar-badge active">已配置</span>
                <span v-else class="toolbar-badge">未配置</span>
              </div>
            </div>
            <div class="modal-body modal-body-detail">
              <!-- 头像 -->
              <div class="detail-avatar-row">
                <div
                  class="detail-avatar clickable"
                  :style="detail.char?.avatar_path ? { backgroundImage: `url(${detail.char.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
                  @click="openCharAvatarEditor"
                >{{ detail.char?.avatar_path ? '' : detail.char?.display_name?.charAt(0) }}</div>
                <div>
                  <button class="sp-btn-small" @click="openCharAvatarEditor">更换头像</button>
                  <button v-if="detail.char?.avatar_path" class="sp-btn-small sp-btn-subtle" @click="removeCharAvatar">移除</button>
                </div>
              </div>
              <!-- 角色关系 -->
              <div class="detail-rel-section">
                <div class="detail-rel-header">
                  <span class="detail-rel-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
                      <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
                    </svg>
                    角色关系网
                  </span>
                  <button
                    v-if="detail.relationships.length > 0"
                    class="detail-rel-btn subtle"
                    @click="showRelationGraph = true"
                  >管理关系图 &rarr;</button>
                </div>
                <div v-if="detail.relationships.length > 0" class="detail-rel-list">
                  <div v-for="rel in detail.relationships.slice(0, 5)" :key="rel.id" class="detail-rel-item">
                    <span class="rel-from">{{ detail.char?.display_name }}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    <span class="rel-to">{{ rel.to_display_name }}</span>
                    <span class="rel-text">{{ rel.relationship_text }}</span>
                  </div>
                  <div v-if="detail.relationships.length > 5" class="detail-rel-more" @click="showRelationGraph = true">
                    共 {{ detail.relationships.length }} 条关系，查看全部 &rarr;
                  </div>
                </div>
                <div v-else class="detail-rel-empty">
                  <template v-if="detail.relationshipsLoading">
                    <span class="rel-empty-spinner"></span> 加载中…
                  </template>
                  <template v-else>
                    <p class="rel-empty-desc">定义角色之间的关联，所有动作中都会自动感知这些关系</p>
                    <button class="detail-rel-btn cta" @click="showRelationGraph = true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
                        <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
                      </svg>
                      设置角色关系
                    </button>
                  </template>
                </div>
              </div>
              <div class="preview-card">
                <label class="fl">展示名</label>
                <input v-model="detail.editName" class="fi" @input="detail.dirty = true" />
                <label class="fl" style="margin-top:12px">人格提示词</label>
                <textarea v-model="detail.editPrompt" class="fi prompt-textarea" @input="detail.dirty = true"></textarea>
              </div>
            </div>
            <!-- 操作栏 sticky footer -->
            <div class="modal-footer">
              <div class="detail-actions">
                <button class="btn-ghost danger" @click="deleteChar">🗑 删除角色</button>
                <div class="detail-actions-right">
                  <button class="btn-primary" :disabled="!detail.dirty" @click="saveCharDetail">保存</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 悬浮侧边栏 -->
          <div class="detail-float" v-if="!isMobile">
            <div class="float-card float-card-toggle">
              <span class="float-label">不看ta的朋友圈</span>
              <label class="toggle-switch float-switch">
                <input type="checkbox" v-model="detail.momentsDisabled" @change="toggleMomentsDisabled" :disabled="detail.momentsToggling" />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="float-card float-card-toggle">
              <span class="float-label">不主动聊天</span>
              <label class="toggle-switch float-switch">
                <input type="checkbox" v-model="detail.proactiveDisabled" @change="toggleProactiveDisabled" :disabled="detail.proactiveToggling" />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="float-card float-card-toggle">
              <span class="float-label">不发生奇遇</span>
              <label class="toggle-switch float-switch">
                <input type="checkbox" v-model="detail.eventsDisabled" @change="toggleEventsDisabled" :disabled="detail.eventsToggling" />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="float-card float-card-btn" @click="openLoraModal">
              <span class="float-label">设置 Lora</span>
              <span v-if="hasLoraSetup" class="float-badge active">已配置</span>
              <span v-else class="float-badge">未配置</span>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══════════════════════════════════════════
         Lora 设置弹窗
         ═══════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showLoraModal" class="modal-overlay" @click.self="closeLoraModal">
          <div class="modal-panel modal-wide">
            <div class="modal-header">
              <h3>Lora 设置 — {{ detail.char?.display_name }}</h3>
              <button class="modal-close" @click="closeLoraModal">✕</button>
            </div>
            <div class="modal-body">
              <div class="lora-body-card">
                <!-- ── Lora 列表 ── -->
                <TransitionGroup name="lora-card" tag="div" class="lora-list">
                  <div v-for="(item, idx) in loraItems" :key="idx" class="lora-item-card">
                    <button class="lora-remove-btn" @click="removeLoraGroup(idx)" title="移除">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                    </button>
                    <div class="lora-item-row">
                      <div class="form-group lora-path-group">
                        <label class="fl lora-inline-label">文件路径</label>
                        <input
                          v-model="item.path"
                          class="fi"
                          placeholder="models\loras下，例如Turbo-ANIMA.safetensors或者folder\remielle_anima.safetensors"
                        />
                      </div>
                      <div class="form-group lora-weight-group">
                        <label class="fl lora-inline-label">权重</label>
                        <input
                          v-model.number="item.weight"
                          type="number"
                          step="0.05"
                          min="0"
                          max="5"
                          class="fi lora-weight-input"
                        />
                      </div>
                    </div>
                    <div class="lora-trigger-row">
                      <label class="fl lora-inline-label">触发词</label>
                      <input
                        v-model="item.triggerWord"
                        class="fi"
                        placeholder="可选，用于增强 lora 效果的提示词"
                      />
                    </div>
                  </div>
                </TransitionGroup>

                <!-- ── 空状态 ── -->
                <div v-if="loraItems.length === 0" class="lora-empty-hint">
                  尚未配置任何 LoRA，点击下方按钮添加
                </div>

                <!-- ── 添加 Lora 按钮 ── -->
                <button class="lora-add-btn" @click="addLoraGroup">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  添加 LoRA
                </button>

                <div class="lora-separator"></div>

                <!-- ── 自定义工作流 ── -->
                <div class="form-group">
                <label class="lora-check-label" @click.stop>
                  <span class="lora-checkbox-wrap">
                    <input type="checkbox" v-model="customWorkflowEnabled" class="lora-checkbox" />
                    <span class="lora-checkmark">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </span>
                  </span>
                  <span class="lora-check-text">启用单人自定义工作流</span>
                </label>
                  <Transition name="lora-expand">
                    <div v-if="customWorkflowEnabled">
                      <select v-model="detail.customWorkflow" class="fi lora-select" style="margin-top:8px">
                        <option value="">请选择自定义工作流</option>
                        <option v-for="wf in filteredWorkflows" :key="wf.filename" :value="wf.filename">{{ wf.label }}</option>
                      </select>
                      <p class="form-hint">单人图片启用自定工作流，可以给某个角色单独设置流程，同样会默认注入长、宽、画师串、画面描述、lora，不需要的字段可以不用。</p>
                    </div>
                  </Transition>
                </div>
              </div>

              <div class="modal-actions" style="margin-top:16px">
                <div style="flex:1"></div>
                <button class="btn-primary" @click="saveLora" :disabled="loraLoading">
                  {{ loraLoading ? '保存中…' : '保存' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 角色头像裁剪器 -->
    <Teleport to="body">
      <AvatarCropper
        v-if="showCharAvatarPicker"
        :title="`设置 ${detail.char?.display_name || ''} 头像`"
        :show-recent-tab="true"
        :show-generate-tab="true"
        :character-id="detail.char?.id"
        :character-base-prompt="detail.char?.base_prompt || ''"
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
      v-if="detail.char"
      :visible="showRelationGraph"
      :center-character="detail.char"
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
    />
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

const router = useRouter()
const chat = useChatStore()

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

const charRelCounts = ref({})

async function loadCharRelCounts() {
  const chars = chat.characters || []
  const results = await Promise.allSettled(
    chars.map(c => api.getRelationships(c.id))
  )
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      charRelCounts.value[chars[i].id] = (r.value.relationships || []).length
    }
  })
}

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

// Toast 冒泡提示
const toast = reactive({
  show: false,
  message: '',
  type: 'info', // 'info' | 'success'
  timer: null,
})

function showToast(message, type = 'info') {
  if (toast.timer) clearTimeout(toast.timer)
  toast.message = message
  toast.type = type
  toast.show = true
  toast.timer = setTimeout(() => {
    toast.show = false
  }, 5000)
}

function openRecruit() {
  recruit.show = true
  recruit.step = 'input'
  recruit.desc = ''
  recruit.error = ''
  recruit.result = null
  recruit.loading = false
  recruit.saving = false
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
  startLoadingTips()

  try {
    const result = await api.generateCharacterPreview(desc)
    if (result.error) {
      recruit.error = result.error
      return
    }
    recruit.result = { ...result }
    recruit.step = 'preview'
    // 冒泡提示搜索结果
    if (result.search_found) {
      showToast('已在网络上找到详细角色资料', 'success')
    } else {
      showToast('未找到相关资料，请检查IP角色名字输入是否正确，如果是原创设定则无视本条提示', 'info')
    }
  } catch (err) {
    recruit.error = '生成失败: ' + (err.message || '网络错误')
  } finally {
    recruit.loading = false
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

// ═══════════════════════════════════════
// 角色详情弹窗
// ═══════════════════════════════════════
const detail = reactive({
  show: false,
  char: null,
  editName: '',
  editPrompt: '',
  relationships: [],
  relationshipsLoading: false,
  momentsDisabled: false,
  proactiveDisabled: false,
  eventsDisabled: false,
  customWorkflow: '',
  loras: [],
  dirty: false,
  momentsToggling: false,
  proactiveToggling: false,
  eventsToggling: false,
})

const showRelationGraph = ref(false)
const showUserRelationGraph = ref(false)

// ── Lora 设置弹窗 ──
const showLoraModal = ref(false)
const customWorkflows = ref([])
const customWorkflowEnabled = ref(false)
const loraLoading = ref(false)
const loraItems = ref([])  // [{path, weight, triggerWord}]

const FILTERED_CUSTOM_WORKFLOW_NAMES = ['制图工作流.json', '制图工作流-加入lora.json', '制图工作流-加入lora2.json', '制图工作流-加入lora3.json']
const filteredWorkflows = computed(() =>
  (customWorkflows.value || []).filter(w => !FILTERED_CUSTOM_WORKFLOW_NAMES.includes(w.filename))
)

// badge 显示：有 loras 或有自定义工作流
const hasLoraSetup = computed(() => {
  return (detail.loras && detail.loras.length > 0) || !!detail.customWorkflow
})

async function fetchWorkflows() {
  try {
    const data = await api.getWorkflows()
    customWorkflows.value = data.workflows || []
  } catch { customWorkflows.value = [] }
}

function addLoraGroup() {
  loraItems.value.push({ path: '', weight: 1, triggerWord: '' })
}

function removeLoraGroup(idx) {
  loraItems.value.splice(idx, 1)
}

function openLoraModal() {
  if (!detail.char) return
  customWorkflowEnabled.value = !!detail.customWorkflow
  // 从 detail.loras 初始化编辑数组
  loraItems.value = (detail.loras || []).length > 0
    ? JSON.parse(JSON.stringify(detail.loras))
    : []
  showLoraModal.value = true
  if (customWorkflows.value.length === 0) fetchWorkflows()
}

function closeLoraModal() {
  showLoraModal.value = false
}

async function saveLora() {
  if (!detail.char) return
  if (!customWorkflowEnabled.value) detail.customWorkflow = ''
  // 过滤空 path 的 lora
  const validLoras = loraItems.value.filter(l => l.path && l.path.trim())
  loraLoading.value = true
  try {
    await api.updateCharacter(detail.char.id, {
      custom_workflow: detail.customWorkflow || null,
      loras: validLoras,
    })
    detail.loras = validLoras
    detail.dirty = false
    await chat.loadCharacters()
    const updated = chat.characters.find(x => x.id === detail.char.id)
    if (updated) detail.char = updated
    showLoraModal.value = false
  } catch (e) {
    console.error('saveLora failed:', e)
  } finally {
    loraLoading.value = false
  }
}

// 关闭关系图后刷新关系数据
watch(showRelationGraph, async (val) => {
  if (!val && detail.char) {
    await loadCharRelCounts()
    try {
      const res = await api.getRelationships(detail.char.id)
      detail.relationships = res.relationships || []
    } catch {
      detail.relationships = []
    }
  }
})

// ═══════════════════════════════════════
// 世界观设置
// ═══════════════════════════════════════
const WORLD_TAG_RE = /^<world_setting>\s*([\s\S]*?)\s*<\/world_setting>$/;
const showWorldModal = ref(false)
const worldSetting = ref('')
const worldDirty = ref(false)
const worldSaving = ref(false)
const worldSaved = ref(false)

const worldSettingSummary = computed(() => {
  const v = worldSetting.value.trim()
  if (!v) return '定义所有角色共处的世界背景'
  const firstLine = v.split('\n')[0].slice(0, 40)
  return firstLine + (firstLine.length >= 40 || v.includes('\n') ? '…' : '')
})

function unwrapWorldSetting(raw) {
  const m = raw?.match(WORLD_TAG_RE)
  return m ? m[1] : (raw || '')
}

async function loadWorldSetting() {
  try {
    const data = await api.getGlobalRules()
    const world = (data.rules || []).find(r => r.rule_key === 'world_setting')
    worldSetting.value = unwrapWorldSetting(world?.rule_content)
  } catch {}
}

function openWorldSetting() {
  worldDirty.value = false
  worldSaved.value = false
  showWorldModal.value = true
}

function closeWorldSetting() {
  showWorldModal.value = false
}

async function saveWorldSetting() {
  if (worldSaving.value) return
  worldSaving.value = true
  try {
    const raw = worldSetting.value.trim()
    const content = raw ? `<world_setting>\n${raw}\n</world_setting>` : ''
    const result = await api.updateGlobalRule('world_setting', { rule_content: content })
    if (result.ok) {
      worldDirty.value = false
      worldSaved.value = true
      setTimeout(() => worldSaved.value = false, 2000)
    }
  } catch (err) {
    console.error('[world_setting] save failed:', err)
  } finally {
    worldSaving.value = false
  }
}

async function openCharDetail(c) {
  detail.char = c
  detail.editName = c.display_name || ''
  detail.editPrompt = c.base_prompt || ''
  detail.momentsDisabled = !!c.moments_disabled
  detail.proactiveDisabled = !!c.proactive_disabled
  detail.eventsDisabled = !!c.events_disabled
  detail.customWorkflow = c.custom_workflow || ''
  // 解析 loras JSON（DB 存 JSON 字符串，SQLite better-sqlite3 直接返回字符串）
  detail.loras = _parseCharLoras(c.loras)
  detail.dirty = false
  detail.show = true
  detail.relationships = []
  detail.relationshipsLoading = true
  try {
    const res = await api.getRelationships(c.id)
    detail.relationships = res.relationships || []
  } catch {
    detail.relationships = []
  } finally {
    detail.relationshipsLoading = false
  }
}

function closeCharDetail() {
  detail.show = false
  detail.char = null
}

async function saveCharDetail() {
  if (!detail.char || !detail.dirty) return
  const c = detail.char
  await api.updateCharacter(c.id, {
    display_name: detail.editName,
    base_prompt: detail.editPrompt,
    moments_disabled: detail.momentsDisabled,
    proactive_disabled: detail.proactiveDisabled,
    events_disabled: detail.eventsDisabled,
    custom_workflow: detail.customWorkflow || null,
    loras: detail.loras,
  })
  detail.dirty = false
  await chat.loadCharacters()
  // 更新本地引用
  const updated = chat.characters.find(x => x.id === c.id)
  if (updated) detail.char = updated
}

// 不看朋友圈 toggle — 即时持久化，无需等"保存"按钮
async function toggleMomentsDisabled() {
  const c = detail.char
  if (!c) return
  detail.momentsToggling = true
  try {
    await api.updateCharacter(c.id, { moments_disabled: detail.momentsDisabled })
    // 同步更新本地角色列表中的值，避免 reload 全部角色
    c.moments_disabled = detail.momentsDisabled
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.moments_disabled = detail.momentsDisabled
  } catch (e) {
    // 失败时回弹 toggle
    detail.momentsDisabled = !detail.momentsDisabled
    console.error('toggleMomentsDisabled failed:', e)
  } finally {
    detail.momentsToggling = false
  }
}

// 不主动聊天 toggle — 即时持久化，无需等"保存"按钮
async function toggleProactiveDisabled() {
  const c = detail.char
  if (!c) return
  detail.proactiveToggling = true
  try {
    await api.updateCharacter(c.id, { proactive_disabled: detail.proactiveDisabled })
    c.proactive_disabled = detail.proactiveDisabled
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.proactive_disabled = detail.proactiveDisabled
  } catch (e) {
    detail.proactiveDisabled = !detail.proactiveDisabled
    console.error('toggleProactiveDisabled failed:', e)
  } finally {
    detail.proactiveToggling = false
  }
}

// 不发生奇遇 toggle — 即时持久化
async function toggleEventsDisabled() {
  const c = detail.char
  if (!c) return
  detail.eventsToggling = true
  try {
    await api.updateCharacter(c.id, { events_disabled: detail.eventsDisabled })
    c.events_disabled = detail.eventsDisabled
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.events_disabled = detail.eventsDisabled
  } catch (e) {
    detail.eventsDisabled = !detail.eventsDisabled
    console.error('toggleEventsDisabled failed:', e)
  } finally {
    detail.eventsToggling = false
  }
}

async function deleteChar() {
  const c = detail.char
  if (!c) return
  if (c.name === 'default') {
    toastFn('默认角色不能删除', 'warning')
    return
  }
  const ok = await confirmFn({
    title: '删除角色',
    message: `确定要删除「${c.display_name}」吗？\n聊天记录和朋友圈内容也将一并删除。`,
    okText: '删除', danger: true,
  })
  if (!ok) return
  await api.deleteCharacter(c.id)
  detail.show = false
  detail.char = null
  await chat.loadCharacters()
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
  if (!detail.char?.id) return
  recentLoading.value = true
  try {
    const d = await api.getRecentImages(detail.char.id)
    recentImages.value = d.images || []
  } catch {} finally { recentLoading.value = false }
}

async function onCharAvatarSave(base64) {
  if (!detail.char) return
  await api.uploadAvatar(detail.char.id, base64 || '')
  await chat.loadCharacters()
  const updated = chat.characters.find(x => x.id === detail.char.id)
  if (updated) detail.char = updated
  showCharAvatarPicker.value = false
}

async function removeCharAvatar() {
  if (!detail.char) return
  const ok = await confirmFn({
    title: '移除头像',
    message: `确定要移除「${detail.char.display_name}」的头像吗？`,
    okText: '移除',
    danger: true,
  })
  if (!ok) return
  await api.uploadAvatar(detail.char.id, '')
  await chat.loadCharacters()
  const updated = chat.characters.find(x => x.id === detail.char.id)
  if (updated) detail.char = updated
}

// ── 解析角色 loras JSON 字段（兼容字符串和已解析数组）──
function _parseCharLoras(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return []
}

// ── 初始化 ──
onMounted(async () => {
  await loadUserAvatar()
  await loadUserConfig()
  loadWorldSetting()
  userNicknameInput.value = userNickname.value
  userGenderInput.value = userGender.value
  userAppearanceInput.value = userAppearance.value
  userPersonaInput.value = userPersona.value
  if (chat.characters.length === 0) await chat.loadCharacters()
  loadCharRelCounts()
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
.user-row {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  margin-bottom: 28px;
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
  background: rgba(120, 140, 200, 0.1);
  color: #788cc8;
}

/* ── 世界观编辑弹窗 ── */
.world-textarea {
  min-height: 200px;
  resize: vertical;
  font-family: inherit;
}

.world-saved-hint {
  margin-top: 8px;
  font-size: 13px;
  color: #4caf84;
  font-weight: 500;
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
.modal-wide { width: min(760px, 97vw); }

.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid var(--glass-border);
}
.modal-header h3 { font-size: 17px; font-weight: 600; color: var(--text-bright); }

.modal-close {
  width: 30px; height: 30px; border-radius: 50%;
  border: none; background: var(--glass-bg-strong);
  color: var(--text-secondary); font-size: 15px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.modal-close:hover { background: var(--bg-hover); color: var(--text-bright); }

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
.modal-actions-right {
  display: flex;
  gap: 10px;
}

.recruit-textarea { width: 100%; resize: vertical; min-height: 80px; font-family: inherit; }
.fi { width: 100%; padding: 9px 12px; font-size: 13px; border-radius: 8px; background: rgba(255,255,255,0.9); border: 1px solid #d5d0ca; color: var(--text-bright); outline: none; }
.fi:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12); }

.gen-error { margin-top: 10px; padding: 8px 12px; border-radius: 8px; background: rgba(255,77,79,0.06); color: var(--danger); font-size: 13px; }

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
.preview-name-input {
  font-size: 20px; font-weight: 700; color: var(--text-bright);
  background: #f0ece8;
  border: 1px dashed rgba(224, 123, 108, 0.25);
  border-radius: 8px; padding: 4px 10px;
  width: 100%; outline: none; font-family: inherit;
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

/* ── Toggle Switch ── */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toggle-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
}
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}
.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: #c5c0ba;
  border-radius: 22px;
  transition: background 0.25s;
}
.toggle-slider::before {
  content: '';
  position: absolute;
  height: 18px;
  width: 18px;
  left: 2px;
  bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.25s;
}
.toggle-switch input:checked + .toggle-slider {
  background: var(--accent);
}
.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(18px);
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
  left: calc(50% + min(380px, 48.5vw) + 16px);
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
.float-switch {
  flex-shrink: 0;
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

.sp-btn-small { padding: 6px 14px; font-size: 12px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-bg-strong); color: var(--text-primary); cursor: pointer; margin-right: 6px; transition: all 0.15s; }
.sp-btn-small:hover { border-color: var(--accent); }
.sp-btn-subtle { color: var(--text-secondary); border-color: transparent; background: transparent; }
.sp-btn-subtle:hover { color: var(--danger); border-color: transparent; }

.prompt-textarea { min-height: 500px; resize: vertical; font-family: inherit; }

/* 角色详情 input/textarea — 与招募预览卡片统一 */
.modal-wide .fi {
  background: var(--bg-primary);
  border: 1px solid var(--glass-border);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.modal-wide .fi:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.1);
}
.modal-wide .prompt-textarea {
  padding: 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-primary);
}

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
.btn-ghost.danger { color: var(--danger); }
.btn-ghost.danger:hover { background: rgba(255, 77, 79, 0.08); }

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
  .modal-actions-right {
    flex-wrap: wrap; gap: 8px; justify-content: flex-end;
  }

  /* 招募预览卡片 */
  .preview-card {
    padding: 14px;
  }
  .preview-name-input {
    font-size: 18px;
    padding: 4px 8px; margin: -4px -8px;
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
  .toolbar-switch {
    width: 34px;
    height: 18px;
    flex-shrink: 0;
  }
  .toolbar-switch .toggle-slider::before {
    height: 14px;
    width: 14px;
  }
  .toolbar-switch input:checked + .toggle-slider::before {
    transform: translateX(16px);
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
  .modal-wide .fi {
    font-size: 16px;
  }
}

/* ═══════════════════════════════════════
   Toast 冒泡提示
   ═══════════════════════════════════════ */
.search-toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10001;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 14px;
  max-width: 520px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(12px);
  border: 1px solid;
}
.search-toast.info {
  background: rgba(30, 40, 60, 0.92);
  border-color: rgba(120, 140, 200, 0.3);
  color: #c8d6f8;
}
.search-toast.success {
  background: rgba(20, 50, 30, 0.92);
  border-color: rgba(80, 180, 100, 0.35);
  color: #b8e8c8;
}
.toast-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.toast-msg {
  flex: 1;
  line-height: 1.5;
}
.toast-close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.5;
  cursor: pointer;
  font-size: 16px;
  padding: 2px 6px;
  border-radius: 4px;
  transition: opacity 0.2s;
}
.toast-close:hover {
  opacity: 1;
}

/* Toast transition */
.toast-slide-enter-active {
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toast-slide-leave-active {
  transition: all 0.25s ease-in;
}
.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-12px);
}

/* ── Lora 设置弹窗 ── */
.lora-body-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  padding: 18px;
}
.lora-expand-enter-active {
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.lora-expand-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.lora-expand-enter-from {
  opacity: 0;
  max-height: 0;
  transform: translateY(-6px);
}
.lora-expand-enter-to {
  opacity: 1;
  max-height: 180px;
  transform: translateY(0);
}
.lora-expand-leave-from {
  opacity: 1;
  max-height: 180px;
  transform: translateY(0);
}
.lora-expand-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-6px);
}
.form-group {
  margin-bottom: 16px;
}
.form-group .fl {
  display: block;
  margin-bottom: 6px;
}
.form-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.lora-select {
  width: 100%;
}
.lora-separator {
  border-top: 1px solid var(--border);
  margin: 24px 0 20px;
}
.lora-check-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.lora-checkbox {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.lora-checkbox-wrap {
  position: relative;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.lora-checkmark {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1.5px solid var(--glass-border);
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  cursor: pointer;
}
.lora-checkmark svg {
  opacity: 0;
  transform: scale(0.5);
  transition: all 0.15s;
}
.lora-checkbox:checked + .lora-checkmark {
  background: var(--accent);
  border-color: var(--accent);
}
.lora-checkbox:checked + .lora-checkmark svg {
  opacity: 1;
  transform: scale(1);
}
.lora-check-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

/* ── Lora 条目卡片 ── */
.lora-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lora-item-card {
  position: relative;
  background: var(--bg-primary);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 10px 32px 10px 12px;
}
.lora-remove-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px; height: 22px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 77, 79, 0.08);
  color: var(--danger);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
  z-index: 1;
  padding: 0;
}
.lora-remove-btn:hover {
  background: rgba(255, 77, 79, 0.2);
}
.lora-item-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.lora-item-row .form-group,
.lora-trigger-row .form-group {
  margin-bottom: 0;
}
.lora-path-group {
  flex: 2;
  min-width: 0;
}
.lora-weight-group {
  flex: 0 0 72px;
}
.lora-inline-label {
  font-size: 11px;
  margin-bottom: 3px;
}
.lora-item-card .fi {
  background: var(--glass-bg);
}
.lora-weight-input {
  text-align: center;
  padding: 9px 4px;
}
.lora-trigger-row {
  margin-top: 8px;
}

/* ── Lora 卡片增删动画 ── */
.lora-card-enter-active,
.lora-card-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.lora-card-enter-from,
.lora-card-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin-bottom: 0;
  border-width: 0;
}
.lora-card-enter-to,
.lora-card-leave-from {
  opacity: 1;
  max-height: 120px;
}

.lora-empty-hint {
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 20px 0;
  margin-bottom: 8px;
}

.lora-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px 0;
  border: 1.5px dashed var(--glass-border);
  border-radius: 10px;
  background: transparent;
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  margin: 5px 0;
}
.lora-add-btn:hover {
  border-color: var(--accent);
  background: rgba(224, 123, 108, 0.05);
}

@media (max-width: 767px) {
  .form-group .fl {
    font-size: 12px;
  }
  .form-hint {
    font-size: 10px;
  }
}
</style>
