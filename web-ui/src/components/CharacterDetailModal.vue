<template>
  <Teleport to="body">
    <!-- ── 角色详情弹窗 ── -->
    <Transition name="modal-fade">
      <!-- ⚠ 2026-10-08 合并 v3.7.0：上游新增 inlineLayout 类（内联布局）、本地新增 showPersonaRefineModal
           互斥条件（人设润色弹窗打开时收起遮罩）—— 两者叠加，**都保留**。 -->
      <div v-if="visible && !showLoraModal && !showOutfitModal && !showRefineModal && !showPersonaRefineModal" class="modal-overlay" :class="{ 'detail-inline': inlineLayout }" @mousedown="onOverlayMouseDown" @click.self="onOverlayClick">
        <div class="modal-panel modal-wide detail-panel">
          <div class="modal-header">
            <h3>{{ character?.display_name }}</h3>
            <linshe-button variant="icon" class="modal-close" aria-label="关闭" @click="$emit('close')">✕</linshe-button>
          </div>

          <div class="modal-body modal-body-detail">
            <!-- 头像 -->
            <div class="detail-avatar-row">
              <div class="detail-avatar clickable" @click="$emit('open-avatar-editor', character)">
                <img v-if="character?.avatar_path" :src="character.avatar_path" class="detail-avatar-img" alt="" />
                <span v-else>{{ character?.display_name?.charAt(0) }}</span>
              </div>
              <div>
                <linshe-button size="sm" class="sp-btn-small" @click="$emit('open-avatar-editor', character)">更换头像</linshe-button>
                <linshe-button v-if="character?.avatar_path" variant="ghost" size="sm" class="sp-btn-small" @click="$emit('remove-avatar', character)">移除</linshe-button>
              </div>
              <div v-if="character?.is_oath" class="detail-avatar-oath">
                <span class="oath-badge" @click="removeOath">
                  <span class="oath-badge-default">💍 已誓约</span>
                  <span class="oath-badge-hover">解除誓约</span>
                </span>
              </div>
            </div>

            <div class="preview-card">
              <!-- 角色关系 -->
              <div class="detail-rel-section">
                <div class="detail-rel-header">
                  <span class="detail-rel-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="17" r="3" />
                      <line x1="9" y1="6" x2="11" y2="14" /><line x1="15" y1="6" x2="13" y2="14" />
                    </svg>
                    角色关系网
                  </span>
                  <div class="detail-rel-btns">
                    <linshe-button
                      v-if="detail.relationships.length > 0"
                      variant="secondary"
                      class="detail-rel-btn"
                      @click="$emit('open-deduction', character)"
                    >
推演关系
</linshe-button>
                    <linshe-button
                      v-if="detail.relationships.length > 0"
                      variant="secondary"
                      class="detail-rel-btn"
                      @click="$emit('open-relation-graph', character)"
                    >
管理关系图 &rarr;
</linshe-button>
                  </div>
                </div>
                <div v-if="detail.relationships.length > 0" class="detail-rel-list">
                  <div v-for="rel in detail.relationships.slice(0, 5)" :key="rel.id" class="detail-rel-item">
                    <span class="rel-from">{{ character?.display_name }}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                    <span class="rel-to">{{ rel.to_display_name }}</span>
                    <span class="rel-text">{{ rel.relationship_text }}</span>
                  </div>
                  <div v-if="detail.relationships.length > 5" class="detail-rel-more" @click="$emit('open-relation-graph', character)">
                    共 {{ detail.relationships.length }} 条关系，查看全部 &rarr;
                  </div>
                </div>
                <div v-else class="detail-rel-empty">
                  <template v-if="detail.relationshipsLoading">
                    <span class="rel-empty-spinner"></span> 加载中…
                  </template>
                  <template v-else>
                    <p class="rel-empty-desc">定义角色之间的关联，所有动作中都会自动感知这些关系</p>
                    <div class="detail-rel-ctas">
                      <linshe-button variant="primary" class="detail-rel-btn" @click="$emit('open-deduction', character)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                        推演关系
                      </linshe-button>
                      <linshe-button variant="primary" class="detail-rel-btn" @click="$emit('open-relation-graph', character)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="17" r="3" />
                          <line x1="9" y1="6" x2="11" y2="14" /><line x1="15" y1="6" x2="13" y2="14" />
                        </svg>
                        手动设置关系
                      </linshe-button>
                    </div>
                  </template>
                </div>
              </div>

              <div class="detail-name-row">
                <div class="detail-name-col">
                  <label class="fl">角色名</label>
                  <linshe-input v-model="detail.editName" class="fi" @input="detail.dirty = true" />
                </div>
                <div class="detail-name-col">
                  <label class="fl">英文名</label>
                  <linshe-input v-model="detail.editCharName" class="fi" @input="detail.dirty = true" placeholder="英文/拼音，唯一标识" />
                </div>
              </div>
              <label class="fl" style="margin-top:12px">人格提示词</label>
              <linshe-input v-model="detail.editPrompt" type="textarea" class="fi prompt-textarea" @input="detail.dirty = true" />
            </div>

            <!-- 「更多设置」内联卡：手机端 + 平板等放不下右侧悬浮窗的宽度（见 inlineLayout） -->
            <div class="mobile-detail-toolbar" v-if="inlineLayout">
              <div class="toolbar-title">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
                </svg>
                更多设置
              </div>
              <div class="toolbar-item toolbar-item-toggle" title="归档该角色：不再主动找你、不发朋友圈、不触发奇遇、不生成日程、不自己拉群；你主动找它聊天时仍会回复">
                <span>不参与活动</span>
                <linshe-switch v-model="detail.archived" size="sm" :disabled="detail.archivedToggling" @change="toggleArchived" aria-label="不参与活动" />
              </div>
              <div class="toolbar-divider"></div>
              <div class="toolbar-item toolbar-item-toggle">
                <span>不看ta的朋友圈</span>
                <linshe-switch v-model="detail.momentsDisabled" size="sm" :disabled="detail.momentsToggling" @change="toggleMomentsDisabled" aria-label="不看ta的朋友圈" />
              </div>
              <div class="toolbar-item toolbar-item-toggle">
                <span>不主动聊天</span>
                <linshe-switch v-model="detail.proactiveDisabled" size="sm" :disabled="detail.proactiveToggling" @change="toggleProactiveDisabled" aria-label="不主动聊天" />
              </div>
              <div class="toolbar-item toolbar-item-toggle">
                <span>不发生奇遇</span>
                <linshe-switch v-model="detail.eventsDisabled" size="sm" :disabled="detail.eventsToggling" @change="toggleEventsDisabled" aria-label="不发生奇遇" />
              </div>
              <div class="toolbar-item toolbar-item-toggle" title="关闭后台日程刷新，可省下每日 token；已生成的日程保留，角色仍按既有日程活动">
                <span>不生成日程</span>
                <linshe-switch v-model="detail.scheduleDisabled" size="sm" :disabled="detail.scheduleToggling" @change="toggleScheduleDisabled" aria-label="不生成日程" />
              </div>
              <div class="toolbar-item toolbar-item-btn" @click="openLoraModal">
                <span>设置 Lora</span>
                <span v-if="hasLoraSetup" class="toolbar-badge active">已配置</span>
                <span v-else class="toolbar-badge">未配置</span>
              </div>
              <!-- 外观 / 形态入口暂时隐藏：角色外观系统数据层与注入已就绪，待开放时取消注释即可 -->
              <!-- <div class="toolbar-item toolbar-item-btn" @click="openOutfitModal">
                <span>外观 / 形态</span>
                <span v-if="activeOutfitName" class="toolbar-badge active">{{ activeOutfitName }}</span>
                <span v-else class="toolbar-badge">未启用</span>
              </div> -->
            </div>

            <!-- 角色立绘：窄视口收在正文末尾，宽视口是主面板左侧悬浮窗 -->
            <CharacterStandingPanel v-if="inlineLayout" inline :character="character" :ctl="standingPanel" />
          </div>

          <!-- 操作栏 sticky footer -->
          <div class="modal-footer">
            <div class="detail-actions">
              <linshe-button variant="danger" @click="deleteChar">&#x1F5D1; 删除角色</linshe-button>
              <linshe-button variant="secondary" @click="openRefineModal">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 16 11-11a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /><path d="m13 7 3 3M19 13v6m-3-3h6M6 2v6M3 5h6" /></svg>
                修正外观
              </linshe-button>
              <linshe-button variant="secondary" @click="openPersonaRefineModal">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="m18.4 2.6 2.9 2.9-8.5 8.5-3.6.7.7-3.6 8.5-8.5Z" /></svg>
                人设润色
              </linshe-button>
              <div class="recruit-appearance-hint">
                外观描述补充tag查阅
                <a :href="`https://animadex.net/?mode=characters&q=${encodeURIComponent(character?.name).replaceAll('_', '+')}`" target="_blank">animadex：{{ character?.name }}</a>
              </div>
              <linshe-button variant="primary" :disabled="!detail.dirty" @click="saveCharDetail">保存</linshe-button>
            </div>
          </div>
        </div>

        <!-- 悬浮侧边栏（宽视口）：功能整合为一张卡片 -->
        <div class="detail-float" v-if="!inlineLayout">
          <div class="float-panel">
            <div class="float-panel-header">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              更多设置
            </div>
            <div class="float-panel-body">
              <div class="float-row" title="归档该角色：不再主动找你、不发朋友圈、不触发奇遇、不生成日程、不自己拉群；你主动找它聊天时仍会回复">
                <span class="float-label">不参与活动</span>
                <linshe-switch v-model="detail.archived" :disabled="detail.archivedToggling" @change="toggleArchived" aria-label="不参与活动" />
              </div>
              <div class="float-divider"></div>
              <div class="float-row">
                <span class="float-label">不看ta的朋友圈</span>
                <linshe-switch v-model="detail.momentsDisabled" :disabled="detail.momentsToggling" @change="toggleMomentsDisabled" aria-label="不看ta的朋友圈" />
              </div>
              <div class="float-row">
                <span class="float-label">不主动聊天</span>
                <linshe-switch v-model="detail.proactiveDisabled" :disabled="detail.proactiveToggling" @change="toggleProactiveDisabled" aria-label="不主动聊天" />
              </div>
              <div class="float-row">
                <span class="float-label">不发生奇遇</span>
                <linshe-switch v-model="detail.eventsDisabled" :disabled="detail.eventsToggling" @change="toggleEventsDisabled" aria-label="不发生奇遇" />
              </div>
              <div class="float-row" title="关闭后台日程刷新，可省下每日 token；已生成的日程保留，角色仍按既有日程活动">
                <span class="float-label">不生成日程</span>
                <linshe-switch v-model="detail.scheduleDisabled" :disabled="detail.scheduleToggling" @change="toggleScheduleDisabled" aria-label="不生成日程" />
              </div>
              <div class="float-row float-row-action" @click="openLoraModal">
                <span class="float-label">设置 Lora</span>
                <span v-if="hasLoraSetup" class="float-badge active">已配置</span>
                <span v-else class="float-badge">未配置</span>
              </div>
              <!-- 外观 / 形态入口暂时隐藏：角色外观系统数据层与注入已就绪，待开放时取消注释即可 -->
              <!-- <div class="float-row float-row-action" @click="openOutfitModal">
                <span class="float-label">外观 / 形态</span>
                <span v-if="activeOutfitName" class="float-badge active float-badge-name">{{ activeOutfitName }}</span>
                <span v-else class="float-badge">未启用</span>
              </div> -->
            </div>
          </div>
        </div>

        <!-- 角色立绘（宽视口）：主面板左侧的悬浮窗；窄视口改为正文末尾的内联卡（见 modal-body-detail 末尾） -->
        <CharacterStandingPanel v-if="!inlineLayout" :character="character" :ctl="standingPanel" />

        <!-- ── 立绘大图查看（重新生成 / HiresFix 放大 / 下载；不放删除，面板里有）── 放在 overlay 内以复用其 10000 层级，盖过主面板 ── -->
        <ImageLightbox
          :visible="standingLightboxVisible"
          :imgs="standingDisplayUrl"
          :show-delete="false"
          @hide="standingLightboxVisible = false"
        />
      </div>
    </Transition>

    <!-- ── Lora 设置弹窗 ── -->
    <Transition name="modal-fade">
      <div v-if="showLoraModal" class="modal-overlay" @click.self="closeLoraModal">
        <div class="modal-panel modal-wide">
          <div class="modal-header">
            <h3>LoRA 设置 — {{ character?.display_name }}</h3>
            <linshe-button variant="icon" class="modal-close" @click="closeLoraModal">✕</linshe-button>
          </div>
          <div class="modal-body">
            <div class="lora-body-card">
              <!-- ── Lora 列表 ── -->
              <TransitionGroup name="lora-card" tag="div" class="lora-list">
                <div v-for="(item, idx) in loraItems" :key="idx" class="lora-item-card">
                  <linshe-button variant="icon" size="sm" class="lora-remove-btn" @click="removeLoraGroup(idx)" title="移除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                  </linshe-button>
                  <div class="lora-item-row">
                    <div class="form-group lora-path-group">
                      <label class="fl lora-inline-label">文件路径</label>
                      <div class="lora-autocomplete-wrap">
                        <linshe-input
                          v-model="item.path"
                          class="fi"
                          placeholder="在ComfyUI-aki-v3(或其他名称)\ComfyUI\models\loras下搜索..."
                          @focus="onLoraInputFocus(idx)"
                          @input="onLoraInput(idx)"
                          @keydown="onLoraKeydown($event, idx)"
                          @blur="onLoraInputBlur"
                        />
                        <ul v-if="activeLoraFileIdx === idx && loraSuggestions.length > 0" class="lora-dropdown">
                          <li
                            v-for="(file, di) in loraSuggestions"
                            :key="file.path"
                            :class="['lora-dropdown-item', { active: di === loraDropdownIdx }]"
                            @mousedown.prevent="selectLoraFile(idx, file)"
                          >
                            <span>{{ loraDisplayName(file) }}</span>
                          </li>
                        </ul>
                        <div v-else-if="activeLoraFileIdx === idx && lorasFiles.length === 0 && !loraFetching" class="lora-dropdown" style="padding:16px;text-align:center;font-size:13px;color:var(--text-secondary)">
                          请先在启动器中配置 ComfyUI 路径
                        </div>
                        <div v-else-if="activeLoraFileIdx === idx && loraFetching" class="lora-dropdown" style="padding:16px;text-align:center;font-size:13px;color:var(--text-secondary)">
                          加载中...
                        </div>
                      </div>
                    </div>
                    <div class="form-group lora-weight-group">
                      <label class="fl lora-inline-label">权重</label>
                      <linshe-input
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
                    <linshe-input
                      v-model="item.triggerWord"
                      type="textarea"
                      class="fi"
                      rows="3"
                      placeholder="可选，用于增强 lora 效果的提示词"
                    />
                  </div>
                </div>
              </TransitionGroup>

              <!-- ── 空状态 ── -->
              <div v-if="loraItems.length === 0" class="lora-empty-hint">
                尚未配置任何 LoRA，点击下方按钮添加<a href="https://www.bilibili.com/video/BV1wsNu61EX6?t=204.1" target="_blank" rel="noopener noreferrer" class="lora-tutorial-link">添加LoRA教程</a>
              </div>

              <!-- ── 添加 Lora 按钮 ── -->
              <div class="lora-add-btn" role="button" tabindex="0" @click="addLoraGroup" @keydown.enter.prevent="addLoraGroup" @keydown.space.prevent="addLoraGroup">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                添加 LoRA
              </div>

              <div class="lora-separator"></div>

              <!-- ── 自定义工作流 ── -->
              <div class="form-group">
              <label class="lora-check-label" @click.stop>
                <span class="lora-checkbox-wrap">
                  <input type="checkbox" v-model="customWorkflowEnabled" class="lora-checkbox" />
                  <span class="lora-checkmark">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                </span>
                <span class="lora-check-text">启用自定义工作流</span>
              </label>
                <Transition name="lora-expand">
                  <div v-if="customWorkflowEnabled" class="lora-workflow-select">
                    <linshe-select v-model="editingCustomWorkflow" :options="customWorkflowOptions" placeholder="请选择自定义工作流（放在workflows文件夹下）" />
                    <p class="form-hint">单人图片才会启用自定工作流，可以给某个角色单独设置完全自由的工作流，同样会默认注入长、宽、画师串、画面描述、lora（如果设置了），不需要的节点可以去掉。</p>
                  </div>
                </Transition>
              </div>

              <!-- ── 单独画师串 ── -->
              <div class="form-group">
                <label class="lora-check-label" @click.stop>
                  <span class="lora-checkbox-wrap">
                    <input type="checkbox" v-model="artistOverrideEnabled" class="lora-checkbox" />
                    <span class="lora-checkmark">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    </span>
                  </span>
                  <span class="lora-check-text">单独设置画师串</span>
                </label>
                <Transition name="lora-expand">
                  <div v-if="artistOverrideEnabled" class="lora-workflow-select">
                    <linshe-input v-model="artistOverride" class="fi" placeholder="该角色专属画师串，留空则不注入画师串" />
                    <p class="form-hint">勾选后，遇到该角色生成图片时会无条件覆盖系统设置里注入的画师串；留空则用空画师串覆盖，不注入任何画师串。</p>
                  </div>
                </Transition>
              </div>
            </div>

            <div class="modal-actions" style="margin-top:16px">
              <span class="lora-civitai-label">LoRA 获取：</span>
              <a :href="civitaiRedSearchUrl" target="_blank" rel="noopener noreferrer" class="lora-civitai-link">
                CivitAI.red 搜索：{{ civitaiDisplayName }}
              </a>
              <div style="flex:1"></div>
              <linshe-button variant="primary" @click="saveLora" :disabled="loraLoading">
                {{ loraLoading ? '保存中…' : '保存' }}
              </linshe-button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── 外观 / 形态设置弹窗 ── -->
    <Transition name="modal-fade">
      <div v-if="showOutfitModal" class="modal-overlay" @click.self="closeOutfitModal">
        <div class="modal-panel modal-wide">
          <div class="modal-header">
            <h3>外观 / 形态 — {{ character?.display_name }}</h3>
            <linshe-button variant="icon" class="modal-close" @click="closeOutfitModal">✕</linshe-button>
          </div>
          <div class="modal-body">
            <div class="lora-body-card">
              <p class="outfit-intro">
                配置该角色专属的额外形态、装甲或服装。启用后，角色生图时会优先穿着这里的外观，
                人物卡里的原有外观用于填补未提及的部位；同一时间只启用一套。
              </p>
              <TransitionGroup name="lora-card" tag="div" class="lora-list">
                <div v-for="(item, idx) in outfitItems" :key="item.id ?? `new-${idx}`" class="lora-item-card" :class="{ 'outfit-deleted': item._deleted }">
                  <linshe-button variant="icon" size="sm" class="lora-remove-btn" @click="removeOutfit(idx)" title="移除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                  </linshe-button>
                  <div class="lora-item-row">
                    <div class="form-group lora-path-group">
                      <label class="fl lora-inline-label">名称</label>
                      <linshe-input v-model="item.name" class="fi" placeholder="如：机甲形态 / 女仆装 / 常服" />
                    </div>
                    <label class="outfit-enabled-label">
                      <input type="checkbox" v-model="item.enabled" @change="onOutfitEnabledChange(idx)" />
                      <span>启用中</span>
                    </label>
                  </div>
                  <div class="lora-trigger-row">
                    <label class="fl lora-inline-label">外观描述</label>
                    <linshe-input
                      v-model="item.description"
                      type="textarea"
                      class="fi"
                      rows="3"
                      placeholder="可用逗号分隔的 tag 组合（如 maid headdress, black maid dress, white apron），也可以用自然语言描述形态变化"
                    />
                  </div>
                </div>
              </TransitionGroup>

              <div v-if="activeOutfitCount === 0" class="lora-empty-hint">
                尚未配置专属外观，点击下方按钮添加
              </div>

              <linshe-button variant="secondary" size="sm" class="lora-add-btn" @click="addOutfit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                添加形态
              </linshe-button>
            </div>

            <div class="modal-actions" style="margin-top:16px">
              <span class="outfit-save-hint">启用中的形态会注入到所有生图链路，优先级高于人物卡原有外观</span>
              <div style="flex:1"></div>
              <linshe-button variant="primary" @click="saveOutfits" :disabled="outfitLoading">
                {{ outfitLoading ? '保存中…' : '保存' }}
              </linshe-button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── 修正外观弹窗（共享组件）：上传 / 粘贴 / 拖拽参考图，邻舍分析后重写「## 你的外观」── -->
    <AppearanceRefineModal
      v-model="showRefineModal"
      :character-id="character?.id ?? null"
      :display-name="character?.display_name || ''"
      :base-prompt="detail.editPrompt"
      @applied="onAppearanceRefined"
    />

    <!-- ── 人设润色弹窗：纯文本改写人设（外观段原样保留）── -->
    <PersonaRefineModal
      v-model="showPersonaRefineModal"
      :display-name="character?.display_name || ''"
      :base-prompt="detail.editPrompt"
      @applied="onPersonaRefined"
    />
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch, inject, onMounted, onUnmounted } from 'vue'
import { useChatStore } from '../stores/chat.js'
import * as api from '../api/index.js'
import LinsheSelect from './ui/LinsheSelect.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheSwitch from './ui/LinsheSwitch.vue'
import LinsheModal from './ui/LinsheModal.vue'
import ImageLightbox from './ImageLightbox.vue'
import CharacterStandingPanel from './CharacterStandingPanel.vue'
import AppearanceRefineModal from './AppearanceRefineModal.vue'
import PersonaRefineModal from './PersonaRefineModal.vue'
import { bustUrlIfOverwritten, overwriteBustTick } from '../utils/imageUrlRefresh.js'
import { useImageEditTasksStore } from '../stores/imageEditTasks.js'
import { emitCharacterDisplayNameChanged } from '../utils/characterReactionProducers.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  character: { type: Object, default: null },
})

const emit = defineEmits([
  'close',
  'saved',
  'deleted',
  'open-avatar-editor',
  'remove-avatar',
  'open-relation-graph',
  'open-deduction',
  'lora-saved',
])

const chat = useChatStore()
const confirmFn = inject('confirm')
const toastFn = inject('toast')
const isMobile = inject('isMobile')
const imageEditTasks = useImageEditTasksStore()

// ── 布局口径：主面板 880px + 左立绘(300) + 右浮窗(228) 三栏并排至少要 1532px 视口 ──
// 手机、触屏平板及放不下侧栏的视口统一收进正文流，
// 否则左右两块悬浮窗会被截掉一截（平板上「两边看不全」的根因）。
const SIDE_LAYOUT_MIN = 1532
const sideRoomQuery = typeof window === 'undefined' ? null : window.matchMedia(`(min-width: ${SIDE_LAYOUT_MIN}px) and (hover: hover) and (pointer: fine)`)
const hasSideRoom = ref(sideRoomQuery?.matches ?? false)
function syncSideRoom() { hasSideRoom.value = sideRoomQuery?.matches ?? false }
onMounted(() => { syncSideRoom(); sideRoomQuery?.addEventListener('change', syncSideRoom) })
onUnmounted(() => sideRoomQuery?.removeEventListener('change', syncSideRoom))
const inlineLayout = computed(() => isMobile.value || !hasSideRoom.value)

// ── 详情编辑状态 ──
const detail = reactive({
  editCharName: '',
  editName: '',
  editPrompt: '',
  relationships: [],
  relationshipsLoading: false,
  momentsDisabled: false,
  proactiveDisabled: false,
  eventsDisabled: false,
  scheduleDisabled: false,
  archived: false,
  dirty: false,
  momentsToggling: false,
  proactiveToggling: false,
  eventsToggling: false,
  scheduleToggling: false,
  archivedToggling: false,
})

// ── Lora 设置状态 ──
const showLoraModal = ref(false)
const customWorkflows = ref([])
const customWorkflowEnabled = ref(false)
const editingCustomWorkflow = ref('')
const artistOverrideEnabled = ref(false)
const artistOverride = ref('')
const loraLoading = ref(false)
const loraItems = ref([])
const lorasFiles = ref([])
const activeLoraFileIdx = ref(null)
const loraDropdownIdx = ref(-1)
const loraSuggestions = ref([])
const loraFetching = ref(false)

// ── 外观/形态设置状态 ──
const showOutfitModal = ref(false)
const outfitLoading = ref(false)
const outfitItems = ref([]) // 本地编辑副本：{ id, name, description, enabled, _deleted }

const clickShouldClose = ref(false)

function onOverlayMouseDown(e) {
  if (e.target === e.currentTarget) {
    const textareaWasFocused = document.activeElement?.closest?.('.prompt-textarea') ?? false
    clickShouldClose.value = !textareaWasFocused
  } else {
    clickShouldClose.value = false
  }
}
function onOverlayClick() {
  if (clickShouldClose.value) {
    clickShouldClose.value = false
    emit('close')
  }
  clickShouldClose.value = false
}

const FILTERED_CUSTOM_WORKFLOW_NAMES = ['制图工作流.json', '制图工作流-加入lora.json', '制图工作流-加入lora2.json', '制图工作流-加入lora3.json']
const filteredWorkflows = computed(() =>
  (customWorkflows.value || []).filter(w => !FILTERED_CUSTOM_WORKFLOW_NAMES.includes(w.filename))
)
const customWorkflowOptions = computed(() =>
  filteredWorkflows.value.map(w => ({ value: w.filename, label: w.label }))
)

const civitaiRedSearchUrl = computed(() => {
  const name = (props.character?.name || props.character?.display_name || '').replaceAll('_', ' ')
  return `https://civitai.red/search/models?baseModel=Anima&sortBy=models_v9&query=${encodeURIComponent(name)}`
})
const civitaiDisplayName = computed(() => {
  return (props.character?.name || props.character?.display_name || '').replaceAll('_', ' ')
})

const hasLoraSetup = computed(() => {
  const c = props.character
  if (!c) return false
  return (_parseCharLoras(c.loras).length > 0) || !!c.custom_workflow || c.artist_override != null
})

const activeOutfit = computed(() =>
  outfitItems.value.find(o => o.enabled && !o._deleted && (o.name || '').trim())
)
const activeOutfitName = computed(() => activeOutfit.value?.name || '')
const activeOutfitCount = computed(() => outfitItems.value.filter(o => !o._deleted).length)

// ── Lora 辅助 ──
function _parseCharLoras(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return []
}

// ═══════════════════════════════════════
// 详情弹窗
// ═══════════════════════════════════════

watch(() => [props.visible, props.character], ([v, c]) => {
  if (v && c) {
    init(c)
  }
})

function refreshRelationships() {
  if (!props.character) return
  detail.relationshipsLoading = true
  api.getRelationships(props.character.id).then(res => {
    detail.relationships = res.relationships || []
  }).catch(() => {
    detail.relationships = []
  }).finally(() => {
    detail.relationshipsLoading = false
  })
}

defineExpose({ refreshRelationships })

function init(c) {
  detail.editCharName = c.name || ''
  detail.editName = c.display_name || ''
  detail.editPrompt = c.base_prompt || ''
  detail.momentsDisabled = !!c.moments_disabled
  detail.proactiveDisabled = !!c.proactive_disabled
  detail.eventsDisabled = !!c.events_disabled
  // 日程开关是「不生成」，库里存的是 schedule_enabled（NULL/1 = 开启，0 = 关闭）
  detail.scheduleDisabled = c.schedule_enabled === 0
  detail.archived = !!c.archived
  detail.dirty = false
  detail.relationships = []
  detail.relationshipsLoading = true
  standingFuncOpen.value = false
  standingRequirement.value = ''
  standingPrompt.value = ''
  fetchOutfits()
  api.getRelationships(c.id).then(res => {
    detail.relationships = res.relationships || []
  }).catch(() => {
    detail.relationships = []
  }).finally(() => {
    detail.relationshipsLoading = false
  })
}

async function removeOath() {
  const c = props.character
  if (!c || !c.is_oath) return
  const ok = await confirmFn({
    title: '解除誓约',
    message: `确定要解除与「${c.display_name}」的誓约吗？\n解除后，双方的特殊关系状态将会结束。`,
    okText: '解除誓约',
  })
  if (!ok) return
  try {
    await api.removeOath(c.id)
    c.is_oath = 0
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.is_oath = 0
    toastFn('誓约已解除', 'success')
  } catch (e) {
    toastFn('解除誓约失败', 'error')
    console.error('removeOath failed:', e)
  }
}

async function saveCharDetail() {
  const c = props.character
  if (!c || !detail.dirty) return
  const previousName = c.display_name || ''
  await api.updateCharacter(c.id, {
    name: detail.editCharName,
    display_name: detail.editName,
    base_prompt: detail.editPrompt,
    moments_disabled: detail.momentsDisabled,
    proactive_disabled: detail.proactiveDisabled,
    events_disabled: detail.eventsDisabled,
  })
  c.name = detail.editCharName
  c.display_name = detail.editName
  detail.dirty = false
  emit('saved', c)
  // P1：保存成功后新旧显示名确实不同才反馈；不声称已有独立昵称系统
  emitCharacterDisplayNameChanged({ characterId: c.id, previousName, nextName: c.display_name, ok: true })
}

async function deleteChar() {
  const c = props.character
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
  emit('deleted', c)
}

// ── 开关 — 即时持久化 ──

async function toggleMomentsDisabled() {
  const c = props.character
  if (!c) return
  detail.momentsToggling = true
  try {
    await api.updateCharacter(c.id, { moments_disabled: detail.momentsDisabled })
    c.moments_disabled = detail.momentsDisabled
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.moments_disabled = detail.momentsDisabled
  } catch (e) {
    detail.momentsDisabled = !detail.momentsDisabled
    console.error('toggleMomentsDisabled failed:', e)
  } finally {
    detail.momentsToggling = false
  }
}

async function toggleProactiveDisabled() {
  const c = props.character
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

async function toggleEventsDisabled() {
  const c = props.character
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

// 日程开关是反向的：UI 上是「不生成日程」，落库是 schedule_enabled
async function toggleScheduleDisabled() {
  const c = props.character
  if (!c) return
  const enabled = !detail.scheduleDisabled
  detail.scheduleToggling = true
  try {
    await api.setCharacterScheduleEnabled(c.id, enabled)
    c.schedule_enabled = enabled ? 1 : 0
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.schedule_enabled = c.schedule_enabled
    toastFn(
      enabled ? '已恢复日程生成' : '已停止日程生成，该角色之后不再消耗日程额度',
      'success'
    )
  } catch (e) {
    detail.scheduleDisabled = !detail.scheduleDisabled
    toastFn('设置失败', 'error')
    console.error('toggleScheduleDisabled failed:', e)
  } finally {
    detail.scheduleToggling = false
  }
}

// 归档：一键停掉该角色的所有主动行为（主动聊天/朋友圈/奇遇/日程刷新/拉群/小镇奇遇）。
// 独立拦截层，不会覆盖上面四个细分开关，取消归档后原设置原样回来。
async function toggleArchived() {
  const c = props.character
  if (!c) return
  detail.archivedToggling = true
  try {
    await api.setCharacterArchived(c.id, detail.archived)
    c.archived = detail.archived ? 1 : 0
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.archived = c.archived
    toastFn(
      detail.archived ? '已归档：不再参与任何主动活动，你找它聊天仍会回复' : '已取消归档，恢复参与活动',
      'success'
    )
  } catch (e) {
    detail.archived = !detail.archived
    toastFn('设置失败', 'error')
    console.error('toggleArchived failed:', e)
  } finally {
    detail.archivedToggling = false
  }
}

// ═══════════════════════════════════════
// Lora 弹窗
// ═══════════════════════════════════════

async function fetchWorkflows() {
  try {
    const data = await api.getWorkflows()
    customWorkflows.value = data.workflows || []
  } catch { customWorkflows.value = [] }
}

function addLoraGroup() {
  loraItems.value.push({ path: '', weight: 0.6, triggerWord: '' })
}

function removeLoraGroup(idx) {
  loraItems.value.splice(idx, 1)
}

async function fetchLorasFiles() {
  loraFetching.value = true
  try {
    const data = await api.fetchLorasFiles()
    lorasFiles.value = data.files || []
  } catch { lorasFiles.value = [] }
  loraFetching.value = false
}

function loraDisplayName(file) {
  return file.source ? `[${file.source}] ${file.name}` : file.name
}

function filterLoras(query) {
  if (!query) return lorasFiles.value
  const q = query.toLowerCase().replace(/\\/g, '/')
  return lorasFiles.value.filter(f => {
    const display = loraDisplayName(f).toLowerCase()
    return display.includes(q) || f.name.toLowerCase().includes(q)
  })
}

function onLoraInputFocus(idx) {
  activeLoraFileIdx.value = idx
  loraDropdownIdx.value = -1
  loraSuggestions.value = filterLoras(loraItems.value[idx]?.path || '')
}

function onLoraInput(idx) {
  activeLoraFileIdx.value = idx
  loraDropdownIdx.value = -1
  loraSuggestions.value = filterLoras(loraItems.value[idx]?.path || '')
}

function onLoraInputBlur() {
  setTimeout(() => { activeLoraFileIdx.value = null }, 150)
}

function selectLoraFile(idx, file) {
  loraItems.value[idx].path = file.name
  activeLoraFileIdx.value = null
}

function onLoraKeydown(e, idx) {
  if (activeLoraFileIdx.value !== idx) return
  const items = loraSuggestions.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    loraDropdownIdx.value = Math.min(loraDropdownIdx.value + 1, items.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    loraDropdownIdx.value = Math.max(loraDropdownIdx.value - 1, -1)
  } else if (e.key === 'Enter' && loraDropdownIdx.value >= 0) {
    e.preventDefault()
    selectLoraFile(idx, items[loraDropdownIdx.value])
  } else if (e.key === 'Escape') {
    activeLoraFileIdx.value = null
  }
}

function openLoraModal() {
  if (!props.character) return
  const c = props.character
  customWorkflowEnabled.value = !!c.custom_workflow
  editingCustomWorkflow.value = c.custom_workflow || ''
  artistOverrideEnabled.value = c.artist_override != null
  artistOverride.value = c.artist_override || ''
  const loras = _parseCharLoras(c.loras)
  loraItems.value = loras.length > 0
    ? JSON.parse(JSON.stringify(loras))
    : []
  showLoraModal.value = true
  if (customWorkflows.value.length === 0) fetchWorkflows()
  fetchLorasFiles()
}

function closeLoraModal() {
  showLoraModal.value = false
}

async function saveLora() {
  if (!props.character) return
  const c = props.character
  const customWf = (customWorkflowEnabled.value && editingCustomWorkflow.value) ? editingCustomWorkflow.value : ''
  const validLoras = loraItems.value.filter(l => l.path && l.path.trim())
  const artistVal = artistOverrideEnabled.value ? (artistOverride.value || '').trim() : null
  loraLoading.value = true
  try {
    await api.updateCharacter(c.id, {
      custom_workflow: customWf || null,
      loras: validLoras,
      artist_override: artistVal,
    })
    c.custom_workflow = customWf || null
    c.loras = validLoras.length > 0 ? JSON.stringify(validLoras) : null
    c.artist_override = artistVal
    showLoraModal.value = false
    emit('lora-saved', c)
  } catch (e) {
    console.error('saveLora failed:', e)
  } finally {
    loraLoading.value = false
  }
}

// ═══════════════════════════════════════
// 外观 / 形态弹窗
// ═══════════════════════════════════════

async function fetchOutfits() {
  if (!props.character) return
  try {
    const list = await api.listCharacterOutfits(props.character.id)
    outfitItems.value = (Array.isArray(list) ? list : []).map(o => ({ ...o, _deleted: false }))
  } catch {
    outfitItems.value = []
  }
}

function openOutfitModal() {
  if (!props.character) return
  showOutfitModal.value = true
  fetchOutfits()
}

function closeOutfitModal() {
  showOutfitModal.value = false
}

function addOutfit() {
  outfitItems.value.push({ id: null, name: '', description: '', enabled: false, _deleted: false })
}

async function removeOutfit(idx) {
  const item = outfitItems.value[idx]
  if (!item) return
  if (item.id) {
    const ok = await confirmFn({
      title: '移除外观',
      message: `确定移除「${item.name || '未命名外观'}」吗？`,
      okText: '移除',
    })
    if (!ok) return
    item._deleted = true
  } else {
    outfitItems.value.splice(idx, 1)
  }
}

// 启用互斥（同角色同时只启用一套，与服务端规则一致）；全部取消勾选 = 不启用任何形态
function onOutfitEnabledChange(idx) {
  const target = outfitItems.value[idx]
  if (target.enabled) {
    outfitItems.value.forEach((o, i) => { if (i !== idx) o.enabled = false })
  }
}

async function saveOutfits() {
  if (!props.character) return
  const c = props.character
  const invalid = outfitItems.value.find(o => !o._deleted && (!(o.name || '').trim() || !(o.description || '').trim()))
  if (invalid) {
    toastFn('外观的名称和描述不能为空', 'warning')
    return
  }
  outfitLoading.value = true
  try {
    for (const o of outfitItems.value) {
      if (o._deleted) {
        await api.deleteCharacterOutfit(c.id, o.id)
        continue
      }
      const name = o.name.trim()
      const description = o.description.trim()
      if (o.id) {
        await api.updateCharacterOutfit(c.id, o.id, { name, description, enabled: !!o.enabled })
      } else {
        const created = await api.createCharacterOutfit(c.id, { name, description })
        const wantEnabled = !!o.enabled
        Object.assign(o, created)
        o.enabled = wantEnabled
        if (wantEnabled) await api.updateCharacterOutfit(c.id, created.id, { enabled: true })
      }
    }
    outfitItems.value = outfitItems.value.filter(o => !o._deleted)
    outfitItems.value.forEach(o => { delete o._deleted })
    toastFn('外观已保存', 'success')
    showOutfitModal.value = false
  } catch (e) {
    console.error('saveOutfits failed:', e)
    toastFn('外观保存失败', 'error')
  } finally {
    outfitLoading.value = false
  }
}

// ═══════════════════════════════════════
// 修正外观弹窗：上传/粘贴/拖拽参考图 → 邻舍分析后重写「## 你的外观」。
// 弹窗本体在 AppearanceRefineModal.vue；这里只负责打开，以及把应用结果
// 回填到人格卡文本框（dirty 待保存）走既有保存链路。
// ═══════════════════════════════════════

const showRefineModal = ref(false)
const showPersonaRefineModal = ref(false)

function openRefineModal() {
  if (!props.character) return
  showRefineModal.value = true
}

async function onAppearanceRefined({ basePrompt }) {
  detail.editPrompt = basePrompt
  detail.dirty = true
  // 复用详情卡的保存链路（PUT /:id 会同步重裁 short_prompt、标记日程重生成）
  try {
    await saveCharDetail()
    toastFn('外观已修正并保存', 'success')
  } catch (err) {
    console.error('onAppearanceRefined save failed:', err)
    toastFn('外观已应用到人格卡，但自动保存失败，请手动点击「保存」', 'error')
  }
}

// 人设润色：与「修正外观」不同，这里**不自动保存** —— 改的是整张人设，
// 交回文本框让用户自己核对；确认无误再点「保存」提交。
function openPersonaRefineModal() {
  if (!props.character) return
  showPersonaRefineModal.value = true
}

function onPersonaRefined({ basePrompt }) {
  detail.editPrompt = basePrompt
  detail.dirty = true
  toastFn('润色已填入人格提示词，请核对后点「保存」生效', 'success')
}

// ═══════════════════════════════════════
// 立绘面板：状态与请求逻辑都在本组件，展示层见 CharacterStandingPanel.vue
// （桌面端是左侧悬浮窗、手机端是正文末尾的内联卡，两者共用下面的 standingPanel 接口）
// ═══════════════════════════════════════

const standingFuncOpen = ref(false)
const standingRequirement = ref('')
// 本轮弹窗会话中已生成的立绘提示词：存在时功能区拆为「重新生成提示词 / 再次生成」
const standingPrompt = ref('')
const standingHasPrompt = computed(() => standingPrompt.value.trim().length > 0)
// 生图请求以角色 id 记账：弹窗关闭再打开时，进行中的生成仍能接回画面
const standingGenCharId = ref(null)
const standingRegenCharId = ref(null)
const standingGenerating = computed(() =>
  standingGenCharId.value != null && standingGenCharId.value === props.character?.id
)
const standingReimageing = computed(() =>
  standingRegenCharId.value != null && standingRegenCharId.value === props.character?.id
)
// 后台出图任务：立绘画完前一直算忙碌（扫描线要持续到待确认 / 失败才算结束）
const standingTaskRunning = computed(() => {
  const c = props.character
  if (!c) return false
  const base = (c.standing_url || '').replace(/\?.*$/, '')
  return imageEditTasks.tasks.some(t =>
    t.action === 'standing' && t.status === 'running' &&
    (t.characterId === c.id || (t.characterId == null && !!base && (t.url || '').replace(/\?.*$/, '') === base))
  )
})
const standingBusy = computed(() =>
  standingGenCharId.value != null || standingRegenCharId.value != null || standingTaskRunning.value
)
const standingBusyForChar = computed(() => standingGenerating.value || standingReimageing.value || standingTaskRunning.value)
const standingLightboxVisible = ref(false)

// 立绘展示 URL：大图「重新生成 / 放大细化」确认覆盖后原 URL 内容已换，
// 经共享登记表补 ?_t= 防止浏览器缓存旧图（弹窗关闭期间确认覆盖也生效，重开即见新图）
const standingDisplayUrl = computed(() => {
  overwriteBustTick.value // 依赖登记表 tick：覆盖确认后即使弹窗开着也能立即换新图
  return bustUrlIfOverwritten(props.character?.standing_url || '')
})


// 立绘姿势风格（普通 / 张力！）：全局设置，system_settings 持久化
const standingMode = ref('normal')

onMounted(() => {
  api.getStandingMode()
    .then(r => { standingMode.value = r.mode === 'dynamic' ? 'dynamic' : 'normal' })
    .catch(() => {})
  window.addEventListener('standing-overwritten', onStandingOverwritten)
})

async function toggleStandingMode() {
  if (standingBusy.value) return
  const prev = standingMode.value
  const next = prev === 'dynamic' ? 'normal' : 'dynamic'
  standingMode.value = next
  try {
    await api.updateStandingMode(next)
  } catch (e) {
    standingMode.value = prev
    console.error('toggleStandingMode failed:', e)
    toastFn(e?.message || '风格切换保存失败', 'error')
  }
}

// 生成中轮播趣语（与角色招募同款风格）
const STANDING_TIPS = [
  '正在铺开画布…',
  '正在研磨颜料…',
  '正在挑选最上镜的角度…',
  '正在勾勒轮廓线…',
  '正在为立绘打光…',
  '正在邀请衣匠量体…',
  '正在查阅公会画册…',
  '正在与画师讨价还价…',
  '正在等待颜料晾干…',
  '正在擦拭相框…',
  '正在向馆长申请展厅…',
]
const standingTip = ref(STANDING_TIPS[0])
let _standingTipTimer = null

function stopStandingTips() {
  if (_standingTipTimer) {
    clearInterval(_standingTipTimer)
    _standingTipTimer = null
  }
}

watch(standingBusyForChar, (busy) => {
  stopStandingTips()
  if (busy) {
    standingTip.value = STANDING_TIPS[0]
    let idx = 0
    _standingTipTimer = setInterval(() => {
      idx = (idx + 1) % STANDING_TIPS.length
      standingTip.value = STANDING_TIPS[idx]
    }, 2200)
  }
})

// 后台任务跑到终点后收起本地记账，扫描线随之停止
watch(standingTaskRunning, (running) => {
  if (running) return
  standingGenCharId.value = null
  standingRegenCharId.value = null
})

onUnmounted(() => {
  stopStandingTips()
  window.removeEventListener('standing-overwritten', onStandingOverwritten)
})

function toggleStandingFunc() {
  standingFuncOpen.value = !standingFuncOpen.value
}

// 点击画面：第一下弹出功能区；功能区已展开且有立绘时，再点查看大图
function onStandingStageClick() {
  if (!standingFuncOpen.value) {
    standingFuncOpen.value = true
    return
  }
  if (props.character?.standing_url) {
    standingLightboxVisible.value = true
  } else {
    standingFuncOpen.value = false
  }
}

async function generateStanding() {
  const c = props.character
  if (!c || standingBusy.value) return
  standingFuncOpen.value = true
  standingGenCharId.value = c.id
  try {
    if (c.standing_url) {
      // 已有立绘：后台出图 → 前后对比确认 → 确认后才覆盖旧立绘
      const res = await imageEditTasks.start('standing', c.standing_url, {
        characterId: c.id,
        requirement: standingRequirement.value.trim(),
      })
      standingPrompt.value = res?.promptText || standingPrompt.value
      return
    }
    const res = await api.generateStanding(c.id, standingRequirement.value.trim())
    c.standing_url = res.standing_url
    standingPrompt.value = res.promptText || ''
    toastFn('立绘已生成', 'success')
  } catch (e) {
    console.error('generateStanding failed:', e)
    toastFn(e?.message || '立绘生成失败', 'error')
  } finally {
    if (!standingTaskRunning.value) standingGenCharId.value = null
  }
}

// 用当前提示词直接重出图，不重新请求 LLM
async function regenerateStanding() {
  const c = props.character
  const prompt = standingPrompt.value.trim()
  if (!c || !prompt || standingBusy.value) return
  standingFuncOpen.value = true
  standingRegenCharId.value = c.id
  try {
    if (c.standing_url) {
      // 已有立绘：后台出图 → 前后对比确认 → 确认后才覆盖旧立绘
      await imageEditTasks.start('standing', c.standing_url, { characterId: c.id, prompt })
      return
    }
    const res = await api.regenerateStandingImage(c.id, prompt)
    c.standing_url = res.standing_url
    toastFn('立绘已生成', 'success')
  } catch (e) {
    console.error('regenerateStanding failed:', e)
    toastFn(e?.message || '立绘生成失败', 'error')
  } finally {
    if (!standingTaskRunning.value) standingRegenCharId.value = null
  }
}

// 对比确认后新立绘是新文件名（不会撞浏览器缓存），直接把 URL 换到当前角色
function onStandingOverwritten(e) {
  const c = props.character
  if (!c || !e?.detail || c.id !== e.detail.characterId) return
  c.standing_url = e.detail.url
}

async function removeStanding() {
  const c = props.character
  if (!c?.standing_url || standingBusy.value) return
  const ok = await confirmFn({
    title: '删除立绘',
    message: `确定删除「${c.display_name}」的立绘吗？\n删除后可以重新生成。`,
    okText: '删除',
  })
  if (!ok) return
  try {
    await api.deleteStanding(c.id)
    c.standing_url = null
    toastFn('立绘已删除', 'success')
  } catch (e) {
    console.error('removeStanding failed:', e)
    toastFn(e?.message || '立绘删除失败', 'error')
  }
}

// 上传本地图片作为立绘：替换当前立绘（已生成立绘时也允许，AI 重绘会覆盖）。
// 文件由面板里的隐藏 input 选好再传进来 —— DOM 细节归面板，校验与请求留在弹窗里。
const standingUploading = ref(false)

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

async function uploadStandingFile(file) {
  if (!file) return
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    toastFn('请选择 PNG / JPG / WEBP 图片', 'error')
    return
  }
  if (file.size > 6 * 1024 * 1024) {
    toastFn('图片不能超过 6MB', 'error')
    return
  }
  const c = props.character
  if (!c) return
  let base64
  try {
    base64 = await readFileAsDataURL(file)
  } catch (err) {
    toastFn('读取图片失败: ' + err.message, 'error')
    return
  }
  standingUploading.value = true
  try {
    const res = await api.uploadStanding(c.id, base64)
    c.standing_url = res.standing_url
    toastFn('立绘已上传', 'success')
  } catch (err) {
    console.error('uploadStanding failed:', err)
    toastFn(err?.message || '立绘上传失败', 'error')
  } finally {
    standingUploading.value = false
  }
}

// 立绘面板接口：状态与方法都留在弹窗里（弹窗会因打开 LoRA / 外观设置整体重建，放面板里会丢），
// 面板只负责渲染。reactive 里的 ref 会自动解包，面板侧可以当普通值读写。
const standingPanel = reactive({
  funcOpen: standingFuncOpen,
  requirement: standingRequirement,
  hasPrompt: standingHasPrompt,
  generating: standingGenerating,
  reimageing: standingReimageing,
  busy: standingBusy,
  busyForChar: standingBusyForChar,
  uploading: standingUploading,
  tip: standingTip,
  displayUrl: standingDisplayUrl,
  mode: standingMode,
  toggleFunc: toggleStandingFunc,
  onStageClick: onStandingStageClick,
  toggleMode: toggleStandingMode,
  generate: generateStanding,
  regenerate: regenerateStanding,
  remove: removeStanding,
  uploadFile: uploadStandingFile,
})

</script>

<style scoped>
/* ═══ 弹窗骨架已迁移至全局 .modal-*（styles/components.css）═══
   此处仅保留本组件的布局覆写 */
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
.modal-body-detail .prompt-textarea::-webkit-scrollbar { width: 10px; }
.modal-body-detail .prompt-textarea::-webkit-scrollbar-track { background: transparent; }
.modal-body-detail .prompt-textarea::-webkit-scrollbar-thumb { background: var(--text-secondary); border-radius: 5px; }
.modal-body-detail .prompt-textarea::-webkit-scrollbar-thumb:hover { background: var(--text-primary); }

/* 面板高度：桌面端固定 95vh（原写作行内 style，移动端要按遮罩留白重算高度，故收进类里） */
.detail-panel { height: 95vh; max-height: 95vh; }

.modal-actions {
  display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;align-items: center;
}

/* ═══ 详情编辑 ═══ */
.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; margin-bottom: 4px; }

.detail-name-row { display: flex; gap: 12px; }
.detail-name-col { flex: 1; min-width: 0; }

.detail-avatar-row { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.detail-avatar {
  width: 64px; height: 64px; border-radius: 50%;
  background: var(--accent);
  display: flex; align-items: center; justify-content: center;
  color: var(--on-accent); font-size: 26px; font-weight: 700; flex-shrink: 0;
}
.detail-avatar-img {
  width: 100%; height: 100%;
  object-fit: cover;
  border-radius: inherit;
  display: block;
}
.detail-avatar.clickable { cursor: pointer; transition: opacity 0.15s; }
.detail-avatar.clickable:hover { opacity: 0.85; }

/* ═══ 角色关系区块 ═══ */
.detail-rel-section {
  margin-bottom: 16px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(var(--accent-rgb), 0.04);
  border: 1px solid rgba(var(--accent-rgb), 0.1);
}
.detail-rel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.detail-rel-title { font-size: 13px; font-weight: 700; color: var(--text-bright); display: flex; align-items: center; gap: 6px; }
.detail-rel-title svg { color: var(--accent); }
/* detail-rel-btn 家族样式已收编至全局 components.css */
.detail-rel-btns { display: flex; align-items: center; gap: 6px; }
.detail-rel-ctas { display: flex; align-items: center; gap: 8px; }
.detail-rel-list { display: flex; flex-direction: column; gap: 6px; }
.detail-rel-item { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; background: var(--bg-primary); font-size: 12px; }
.rel-from, .rel-to { font-weight: 600; color: var(--text-bright); }
.rel-text { color: var(--accent); font-weight: 500; padding: 1px 8px; border-radius: 4px; background: rgba(var(--accent-rgb), 0.1); }
.detail-rel-more { font-size: 12px; color: var(--accent); font-weight: 500; cursor: pointer; text-align: center; padding: 4px 0; transition: opacity 0.15s; }
.detail-rel-more:hover { opacity: 0.7; }
.detail-rel-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px 8px 8px; text-align: center; }
.rel-empty-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0; max-width: 360px; }
.rel-empty-spinner { width: 14px; height: 14px; border: 2px solid rgba(var(--accent-rgb), 0.2); border-top-color: var(--accent); border-radius: 50%; animation: rel-spin 0.6s linear infinite; }
@keyframes rel-spin { to { transform: rotate(360deg); } }

/* ═══ 誓约状态（头像行内） ═══ */
.detail-avatar-oath { display: flex; align-items: center; margin-left: auto; flex-shrink: 0; }
.oath-badge {
  position: relative; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; padding: 4px 14px; border-radius: 20px;
  background: linear-gradient(135deg, rgba(212, 168, 83, 0.18), rgba(212, 168, 83, 0.08));
  border: 1px solid rgba(212, 168, 83, 0.25);
  cursor: pointer; user-select: none; overflow: hidden;
  transition: all 0.25s ease; min-width: 80px; height: 28px;
}
.oath-badge:hover {
  border-color: rgba(var(--accent-rgb), 0.25);
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.08), rgba(var(--accent-rgb), 0.03));
}
.oath-badge-default, .oath-badge-hover {
  position: absolute; transition: all 0.25s ease;
  white-space: nowrap; letter-spacing: 0.3px;
}
.oath-badge-default { opacity: 1; transform: translateY(0); color: var(--fun-gold); }
.oath-badge-hover { opacity: 0; transform: translateY(8px); color: rgba(var(--accent-rgb), 0.6); }
.oath-badge:hover .oath-badge-default { opacity: 0; transform: translateY(-8px); }
.oath-badge:hover .oath-badge-hover { opacity: 1; transform: translateY(0); }

/* ═══ 悬浮侧边栏 ═══ */
.detail-float {
  position: absolute;
  left: calc(50% + min(450px, 48.5vw) + 16px);
  top: 2.5vh;
  width: 228px;
  height: 95vh;
  z-index: 0;
}
.float-panel {
  display: flex; flex-direction: column;
  height: 100%;
  padding: 12px;
  border-radius: 18px;
  background: var(--side-panel-bg);
  border: var(--side-panel-border);
  box-shadow: var(--side-panel-shadow);
  /* 主面板 modal-pop(0.28s) 结束后，再从面板背后向右弹出；
     初始多藏 60px，避免面板 0.92 缩放阶段露出右缘 */
  animation: float-emerge 0.5s cubic-bezier(0.3, 1.35, 0.55, 1) 0.32s both;
}
@keyframes float-emerge {
  0%   { transform: translateX(calc(-100% - 60px)); }
  100% { transform: translateX(0); }
}
.float-panel-header {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700; letter-spacing: 1px;
  color: var(--text-secondary);
  margin: 2px 2px 10px;
}
.float-panel-body {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 4px;
}
.float-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 8px 10px;
}
.float-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
/* 归档是总开关，与下面四个细分开关用一条细线分开 */
.float-divider,
.toolbar-divider {
  height: 1px;
  margin: 6px 0;
  background: var(--glass-border);
}
.float-row-action {
  margin-top: 2px; padding: 8px 10px;
  border-radius: 10px; cursor: pointer;
  transition: background 0.15s;
}
.float-row-action:hover { background: rgba(var(--accent-rgb), 0.08); }
.float-row-action:hover .float-label { color: var(--accent); }
.float-badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: var(--bg-tertiary); color: var(--text-secondary); }
.float-badge.active { background: rgba(var(--accent-rgb), 0.15); color: var(--accent); }


/* ═══ 操作栏 ═══ */
.modal-footer {
  flex-shrink: 0;
  padding: 10px 22px 18px;
  border-top: 1px solid var(--glass-border);
  background: inherit;
}
/* 撑满 footer：全局 .modal-footer 是 justify-content:flex-end 的 flex 容器，
   不撑满会把「删除角色」和「保存」挤到右下角；撑满后由 .recruit-appearance-hint 的
   margin-left:auto 把「说明 + 保存」推到右端，与左侧「删除角色」分列两端 */
.detail-actions { flex: 1; min-width: 0; display: flex; align-items: center; margin-top: 0; gap: 10px; }
.recruit-appearance-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.recruit-appearance-hint a {
  color: var(--text-secondary);
  text-decoration: underline;
}

/* ═══ 弹窗动画已迁移至全局 animations.css（modal-fade + modal-pop）═══ */

/* ═══ 通用 ═══ */
.sp-btn-small { margin-right: 6px; }

.prompt-textarea { min-height: 500px; }

.modal-wide .prompt-textarea { padding: 12px; border-radius: 10px; font-size: 12px; line-height: 1.7; color: var(--text-primary); }

.preview-card { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 14px; padding: 18px; }

/* ═══ Lora 设置 ═══ */
.lora-body-card { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 14px; padding: 18px; }
.lora-expand-enter-active { transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.lora-expand-leave-active { transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.lora-expand-enter-from { opacity: 0; max-height: 0; transform: translateY(-6px); }
.lora-expand-enter-to { opacity: 1; max-height: 180px; transform: translateY(0); }
.lora-expand-leave-from { opacity: 1; max-height: 180px; transform: translateY(0); }
.lora-expand-leave-to { opacity: 0; max-height: 0; transform: translateY(-6px); }
.form-group { margin-bottom: 16px; }
.form-group .fl { display: block; margin-bottom: 6px; }
.form-hint { margin: 4px 0 0; font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
.lora-workflow-select { margin-top: 8px; }
.lora-workflow-select .fi { width: 100%; }
.lora-separator { border-top: 1px solid var(--border); margin: 24px 0 20px; }
.lora-check-label { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.lora-checkbox { position: absolute; opacity: 0; width: 0; height: 0; }
.lora-checkbox-wrap { position: relative; width: 18px; height: 18px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.lora-checkmark { width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid var(--glass-border); background: var(--bg-primary); display: flex; align-items: center; justify-content: center; transition: all 0.15s; cursor: pointer; }
.lora-checkmark svg { opacity: 0; transform: scale(0.5); transition: all 0.15s; }
.lora-checkbox:checked + .lora-checkmark { background: var(--accent); border-color: var(--accent); }
.lora-checkbox:checked + .lora-checkmark svg { opacity: 1; transform: scale(1); }
.lora-check-text { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.lora-list { display: flex; flex-direction: column; gap: 10px; }
.lora-item-card { position: relative; background: var(--bg-primary); border: 1px solid var(--glass-border); border-radius: 12px; padding: 10px 32px 10px 12px; }
.lora-remove-btn { position: absolute; top: 6px; right: 6px; z-index: 1; }
.lora-item-row { display: flex; gap: 10px; align-items: flex-end; }
.lora-item-row .form-group, .lora-trigger-row .form-group { margin-bottom: 0; }
.lora-path-group { flex: 2; min-width: 0; }
.lora-autocomplete-wrap { position: relative; }
.lora-dropdown {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px);
  max-height: 220px;
  overflow-y: auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  z-index: 10001;
  list-style: none;
  padding: 4px;
  margin: 0;
  box-shadow: var(--shadow-md);
  transform-origin: top center;
}
.lora-dropdown-item {
  display: flex; align-items: center;
  padding: 9px 10px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-bright);
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}
.lora-dropdown-item:hover {
  background: rgba(var(--accent-rgb),0.08);
  color: var(--accent);
}
.lora-dropdown-item.active {
  background: rgba(var(--accent-rgb),0.06);
  color: var(--accent);
  font-weight: 600;
}
.lora-weight-group { flex: 0 0 72px; }
.lora-inline-label { font-size: 11px; margin-bottom: 3px; }
.lora-weight-input { text-align: center; padding: 9px 4px; }
.lora-trigger-row { margin-top: 8px; }
.lora-trigger-row textarea { min-height: 60px; width: 100%; }
.lora-card-enter-active, .lora-card-leave-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.lora-card-enter-from, .lora-card-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; border-width: 0; }
.lora-card-enter-to, .lora-card-leave-from { opacity: 1; max-height: 120px; }
.lora-empty-hint { text-align: center; font-size: 13px; color: var(--text-secondary); padding: 20px 0; margin-bottom: 8px; }
.lora-add-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 10px 0; border: 1.5px dashed var(--glass-border); border-radius: 10px; background: transparent; color: var(--accent); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; margin: 5px 0; user-select: none; }
.lora-add-btn:hover { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.05); }

/* ═══ 外观 / 形态设置 ═══ */
.outfit-intro { margin: 0 0 12px; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
.outfit-enabled-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; user-select: none; flex-shrink: 0; padding-bottom: 6px; }
.outfit-enabled-label input { accent-color: var(--accent); width: 15px; height: 15px; cursor: pointer; }
.outfit-enabled-label span { font-weight: 600; }
.outfit-deleted { opacity: 0.4; }
.outfit-deleted input, .outfit-deleted textarea { text-decoration: line-through; }
.float-badge-name { max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outfit-save-hint { font-size: 11px; color: var(--text-secondary); }

/* 修正外观样式已随弹窗本体收编至 AppearanceRefineModal.vue */

.lora-civitai-label { font-size: 12px; color: var(--text-secondary); white-space: nowrap; margin: 0 2px; }
.lora-civitai-link, .lora-tutorial-link { font-size: 12px; color: var(--accent); text-decoration: none; white-space: nowrap; opacity: 0.85; transition: opacity 0.15s; }
.lora-civitai-link:hover, .lora-tutorial-link:hover { opacity: 1; text-decoration: underline; }
.lora-tutorial-link { margin-left: 6px; }

/* ═══ 内联「更多设置」卡（手机端 + 平板等放不下侧栏的宽度，由模板 inlineLayout 决定渲染）═══ */
.mobile-detail-toolbar {
  display: flex; flex-direction: column;
  margin-top: 14px; padding: 8px;
  border-radius: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}
.toolbar-title { display: flex; align-items: center; gap: 5px; margin: 2px 6px 6px; font-size: 11px; font-weight: 700; letter-spacing: 1px; color: var(--text-secondary); }
.toolbar-title svg { color: var(--accent); }
.toolbar-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 6px; border-radius: 10px; color: var(--text-secondary); font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; -webkit-tap-highlight-color: transparent; user-select: none; }
.toolbar-item + .toolbar-item { border-top: 1px solid var(--border); }
.toolbar-item:active { background: rgba(var(--accent-rgb), 0.08); }
.toolbar-item-toggle { cursor: default; }
.toolbar-item-btn { color: var(--accent); font-weight: 600; }
.toolbar-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--bg-tertiary); color: var(--text-secondary); flex-shrink: 0; }
.toolbar-badge.active { background: rgba(var(--accent-rgb), 0.15); color: var(--accent); }

/* ═══ 平板 / 中窄视口（<1532 放不下左右悬浮窗，立绘与更多设置收进正文流）═══
   主面板仍是居中的 min(880px, 96vw)，只把正文改成可滚动的纵向流 */
@media (max-width: 1531px) {
  .modal-body-detail { overflow-y: auto; }
  .modal-body-detail .preview-card { flex: none; }
  .modal-body-detail .prompt-textarea { flex: none; min-height: 340px; }
}

/* ═══ 移动端 ═══
 几何与 LinsheModal 的移动端段落同口径：遮罩只收留白（8px + 安全区），面板保留
 圆角 / 描边 / 白内衬的浮层观感 —— 不要再退回 100vw/100dvh + border-radius:0 的全屏面板。
 正文改成「内容优先」的纵向流：头像 → 内容卡 → 更多设置，底部操作区固定。 */

.detail-inline {
  padding: calc(8px + env(safe-area-inset-top, 0px))
           calc(8px + env(safe-area-inset-right, 0px))
           calc(8px + env(safe-area-inset-bottom, 0px))
           calc(8px + env(safe-area-inset-left, 0px));
}
.detail-inline .modal-panel, .detail-inline .modal-wide { width: 100%; max-width: 100%; max-height: 100%; }
.detail-inline .detail-panel { height: 100%; max-height: 100%; }

/* 安全区由上方的遮罩留白让出，头部 / 底部不再各自叠加 */
.detail-inline .modal-header { padding: 12px 16px; }
.detail-inline .modal-header h3 { font-size: 15px; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px; }
.detail-inline .modal-close { flex-shrink: 0; }
.detail-inline .modal-body { padding: 4px 14px 14px; }
.detail-inline .modal-footer { padding: 10px 14px 14px; }

.detail-inline .modal-body-detail { overflow-y: auto; }
.detail-inline .modal-body-detail .preview-card { flex: none; padding: 14px; border-radius: 12px; }
.detail-inline .modal-body-detail .prompt-textarea { flex: none; min-height: 300px; }
.detail-inline .modal-wide .fi, .detail-inline .modal-wide .prompt-textarea { font-size: 16px; }

/* 头像行：允许换行，誓约徽章不再把「更换头像 / 移除」挤出屏幕 */
.detail-inline .detail-avatar-row { flex-wrap: wrap; gap: 12px; margin-bottom: 14px; padding: 0 2px; }
.detail-inline .detail-avatar { width: 56px; height: 56px; font-size: 24px; }

/* 角色关系：标题独占一行，入口按钮并排平分（原先是标题被两个按钮挤成两行） */
.detail-inline .detail-rel-section { padding: 12px; margin-bottom: 14px; }
.detail-inline .detail-rel-header { flex-direction: column; align-items: stretch; gap: 10px; margin-bottom: 10px; }
.detail-inline .detail-rel-btns, .detail-inline .detail-rel-ctas { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.detail-inline .detail-rel-btn { width: 100%; justify-content: center; }

/* 角色名 / 英文名：窄屏改单列，别把两个输入框挤进半屏 */
.detail-inline .detail-name-row { flex-direction: column; gap: 10px; }

/* 底部操作区：说明独占一行，删除 / 保存分列两端 */
.detail-inline .detail-actions { flex-wrap: wrap; justify-content: space-between; gap: 10px; }
.detail-inline .recruit-appearance-hint { order: -1; flex: 1 1 100%; margin-left: 0; white-space: normal; }

.detail-inline .form-group .fl { font-size: 12px; }
.detail-inline .form-hint { font-size: 10px; }

</style>
