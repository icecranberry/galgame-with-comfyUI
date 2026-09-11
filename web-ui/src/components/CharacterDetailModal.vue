<template>
  <Teleport to="body">
    <!-- ── 角色详情弹窗 ── -->
    <Transition name="modal-fade">
      <div v-if="visible && !showLoraModal && !showOutfitModal && !showRefineModal" class="modal-overlay" @mousedown="onOverlayMouseDown" @click.self="onOverlayClick">
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
                      <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
                      <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
                    </svg>
                    角色关系网
                  </span>
                  <div class="detail-rel-btns">
                    <linshe-button
                      v-if="detail.relationships.length > 0"
                      variant="secondary"
                      class="detail-rel-btn"
                      @click="$emit('open-deduction', character)"
                    >推演关系</linshe-button>
                    <linshe-button
                      v-if="detail.relationships.length > 0"
                      variant="secondary"
                      class="detail-rel-btn"
                      @click="$emit('open-relation-graph', character)"
                    >管理关系图 &rarr;</linshe-button>
                  </div>
                </div>
                <div v-if="detail.relationships.length > 0" class="detail-rel-list">
                  <div v-for="rel in detail.relationships.slice(0, 5)" :key="rel.id" class="detail-rel-item">
                    <span class="rel-from">{{ character?.display_name }}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
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
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                        </svg>
                        推演关系
                      </linshe-button>
                      <linshe-button variant="primary" class="detail-rel-btn" @click="$emit('open-relation-graph', character)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
                          <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
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

            <!-- 移动端「更多设置」：桌面端是右侧悬浮面板，手机端收进正文末尾，保持内容优先 -->
            <div class="mobile-detail-toolbar" v-if="isMobile">
              <div class="toolbar-title">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
                </svg>
                更多设置
              </div>
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

            <!-- 角色立绘（手机端）：桌面端是左侧悬浮窗，手机端收在正文末尾 -->
            <CharacterStandingPanel v-if="isMobile" inline :character="character" :ctl="standingPanel" />
          </div>

          <!-- 操作栏 sticky footer -->
          <div class="modal-footer">
            <div class="detail-actions">
              <linshe-button variant="danger" @click="deleteChar">&#x1F5D1; 删除角色</linshe-button>
              <linshe-button variant="secondary" @click="openRefineModal">修正外观</linshe-button>
              <div class="recruit-appearance-hint">
                外观描述补充tag查阅
                <a :href="`https://animadex.net/?mode=characters&q=${encodeURIComponent(character?.name).replaceAll('_', '+')}`" target="_blank">animadex：{{character?.name}}</a>
              </div>
              <linshe-button variant="primary" :disabled="!detail.dirty" @click="saveCharDetail">保存</linshe-button>
            </div>
          </div>
        </div>

        <!-- 悬浮侧边栏（桌面端）：功能整合为一张卡片 -->
        <div class="detail-float" v-if="!isMobile">
          <div class="float-panel">
            <div class="float-panel-header">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
              </svg>
              更多设置
            </div>
            <div class="float-panel-body">
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

        <!-- 角色立绘（桌面端）：主面板左侧的悬浮窗；手机端改为正文末尾的内联卡（见 modal-body-detail 末尾） -->
        <CharacterStandingPanel v-if="!isMobile" :character="character" :ctl="standingPanel" />

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
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                添加 LoRA
              </div>

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
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
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
              <a :href="civitaiSearchUrl" target="_blank" rel="noopener noreferrer" class="lora-civitai-link">
                CivitAI 搜索：{{ civitaiDisplayName }}
              </a>
              <span class="lora-civitai-label">或</span>
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
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
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

    <!-- ── 修正外观弹窗：上传 / 粘贴 / 拖拽参考图，邻舍分析后重写「## 你的外观」── -->
    <linshe-modal v-model="showRefineModal" :title="`修正外观 — ${character?.display_name || ''}`" wide>
      <div class="refine-body" :class="{ 'is-dragging': refineDragging }" @dragover.prevent="refineDragging = true" @dragleave="onRefineDragLeave" @drop.prevent="onRefineDrop">
        <p class="outfit-intro">
          提供一张该角色的参考图，邻舍会观察图片并重写人格卡里的「## 你的外观」，
          生成「名字 + 五官 + 衣着」的生图描述。支持点击上传、Ctrl+V 粘贴、拖拽到窗口，
          或从最近图片中挑选并截取。
        </p>

        <!-- 上传 / 预览 -->
        <div
          v-if="!refineImage"
          class="refine-dropzone"
          role="button" tabindex="0"
          @click="openRefineFilePicker"
          @keydown.enter.prevent="openRefineFilePicker"
          @keydown.space.prevent="openRefineFilePicker"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
          <span class="refine-dropzone-title">点击上传或拖拽图片到这里</span>
          <span class="refine-dropzone-sub">PNG / JPG / WEBP，不超过 6MB，也可以直接 Ctrl+V 粘贴</span>
        </div>
        <linshe-button v-if="!refineImage" variant="secondary" block class="refine-recent-btn" :disabled="refineAnalyzing" @click="openRecentPicker">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
          从最近图片中挑选并截取
        </linshe-button>
        <div v-else class="refine-preview">
          <img :src="refineImage" class="refine-preview-img" alt="参考图预览" />
          <div class="refine-preview-actions">
            <linshe-button variant="ghost" size="sm" :disabled="refineAnalyzing" @click="clearRefineImage">移除图片</linshe-button>
          </div>
        </div>

        <!-- 分析中 -->
        <div v-if="refineAnalyzing" class="refine-analyzing">
          <span class="rel-empty-spinner"></span> 邻舍正在观察图片…
        </div>

        <!-- 结果预览（只读；应用后可在人格卡文本框里继续微调） -->
        <div v-if="refineResult" class="refine-result">
          <label class="fl">重写后的外观（可直接修改）</label>
          <linshe-input v-model="refineResult" type="textarea" :rows="7" class="refine-result-input" />
        </div>

        <div v-if="refineError" class="refine-error">{{ refineError }}</div>

        <input ref="refineFileInput" type="file" accept="image/png,image/jpeg,image/webp" class="refine-file-input" @change="onRefineFileChange" />
      </div>

      <template #footer>
        <span class="outfit-save-hint">应用到人格卡后会自动保存</span>
        <div style="flex:1"></div>
        <linshe-button variant="secondary" :disabled="!refineImage || refineAnalyzing" :loading="refineAnalyzing" @click="startRefineAnalysis">
          {{ refineResult ? '重新分析' : '开始分析' }}
        </linshe-button>
        <linshe-button variant="primary" :disabled="!refineResult || refineAnalyzing" @click="applyRefineResult">
          应用并保存
        </linshe-button>
      </template>
    </linshe-modal>

    <!-- ── 从最近图片挑选并截取（完整展示全图，拖拽画选区）── Teleport 到 body 避免被弹窗 transform 困住 fixed 定位 -->
    <Teleport to="body">
      <RecentImageCropper
        v-if="showRefinePicker"
        :character-id="character?.id ?? null"
        @close="showRefinePicker = false"
        @save="onRefineRecentPicked"
      />
    </Teleport>
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
import RecentImageCropper from './RecentImageCropper.vue'
import { bustUrlIfOverwritten, overwriteBustTick } from '../utils/imageUrlRefresh.js'

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
  dirty: false,
  momentsToggling: false,
  proactiveToggling: false,
  eventsToggling: false,
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

const civitaiSearchUrl = computed(() => {
  const name = (props.character?.name || props.character?.display_name || '').replaceAll('_', ' ')
  return `https://civitai.com/search/models?baseModel=Anima&sortBy=models_v9&query=${encodeURIComponent(name)}`
})
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
// 只回填到人格卡文本框（dirty 待保存），不直接落库；替换逻辑在后端统一收口。
// ═══════════════════════════════════════

const showRefineModal = ref(false)
const refineImage = ref('')          // 参考图 dataURL
const refineDragging = ref(false)
const refineAnalyzing = ref(false)
const refineResult = ref('')         // 重写后的外观段正文（可直接编辑）
const refinePromptBefore = ref(null) // 外观段之前的整卡前文（服务端切好，应用时拼接）；null = 旧版后端，退回整卡回填
const refinePromptAfter = ref(null)  // 外观段之后的整卡后文
const refineLegacyBasePrompt = ref('') // 旧版后端兼容：服务端重组好的整卡 base_prompt
const refineError = ref('')
const refineFileInput = ref(null)
// 最近图片挑选（RecentImageCropper 内部负责取图与拖拽截取）
const showRefinePicker = ref(false)

function openRefineModal() {
  if (!props.character) return
  refineImage.value = ''
  refineDragging.value = false
  refineAnalyzing.value = false
  refineResult.value = ''
  refinePromptBefore.value = null
  refinePromptAfter.value = null
  refineLegacyBasePrompt.value = ''
  refineError.value = ''
  showRefinePicker.value = false
  showRefineModal.value = true
}

function openRefineFilePicker() {
  refineFileInput.value?.click()
}

function onRefineFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  handleRefineFile(file)
}

function handleRefineFile(file) {
  if (!file || refineAnalyzing.value) return
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    toastFn('请选择 PNG / JPG / WEBP 图片', 'error')
    return
  }
  if (file.size > 6 * 1024 * 1024) {
    toastFn('图片不能超过 6MB', 'error')
    return
  }
  readFileAsDataURL(file).then(dataUrl => {
    refineImage.value = dataUrl
    refineResult.value = ''
    refinePromptBefore.value = null
  refinePromptAfter.value = null
  refineLegacyBasePrompt.value = ''
    refineError.value = ''
    // 图片就位后直接开始分析
    startRefineAnalysis()
  }).catch(err => {
    toastFn('读取图片失败: ' + (err?.message || err), 'error')
  })
}

function clearRefineImage() {
  refineImage.value = ''
  refineResult.value = ''
  refinePromptBefore.value = null
  refinePromptAfter.value = null
  refineLegacyBasePrompt.value = ''
  refineError.value = ''
}

// ── 从最近图片挑选并截取 ──
function openRecentPicker() {
  if (!props.character || refineAnalyzing.value) return
  showRefinePicker.value = true
}

// 截取结果（dataURL）直接作为参考图，走与上传相同的链路；图片就位后直接开始分析
function onRefineRecentPicked(base64) {
  showRefinePicker.value = false
  refineImage.value = base64
  refineResult.value = ''
  refinePromptBefore.value = null
  refinePromptAfter.value = null
  refineLegacyBasePrompt.value = ''
  refineError.value = ''
  startRefineAnalysis()
}

function onRefineDragLeave(e) {
  if (!e.currentTarget?.contains?.(e.relatedTarget)) refineDragging.value = false
}

function onRefineDrop(e) {
  refineDragging.value = false
  const file = Array.from(e.dataTransfer?.files || []).find(f => f.type?.startsWith('image/'))
  if (file) handleRefineFile(file)
  else toastFn('请拖入图片文件', 'warning')
}

// 弹窗打开期间监听粘贴：剪贴板里有图片就直接作为参考图
function onRefinePaste(e) {
  if (refineAnalyzing.value) return
  const imgItem = Array.from(e.clipboardData?.items || []).find(it => it.type?.startsWith('image/'))
  if (imgItem) {
    e.preventDefault()
    handleRefineFile(imgItem.getAsFile())
  }
}

watch(showRefineModal, (open) => {
  if (open) document.addEventListener('paste', onRefinePaste)
  else document.removeEventListener('paste', onRefinePaste)
})
onUnmounted(() => document.removeEventListener('paste', onRefinePaste))

async function startRefineAnalysis() {
  const c = props.character
  if (!c || !refineImage.value || refineAnalyzing.value) return
  refineAnalyzing.value = true
  refineError.value = ''
  refineResult.value = ''
  refinePromptBefore.value = null
  refinePromptAfter.value = null
  refineLegacyBasePrompt.value = ''
  try {
    const res = await api.refineAppearance(c.id, refineImage.value)
    refineResult.value = res.appearance || ''
    if (res.prompt_before != null || res.prompt_after != null) {
      refinePromptBefore.value = res.prompt_before || ''
      refinePromptAfter.value = res.prompt_after || ''
    } else {
      // 旧版后端没有前后文字段：退回整卡回填（此模式下结果框的编辑不会参与重组）
      refineLegacyBasePrompt.value = res.base_prompt || ''
    }
  } catch (err) {
    console.error('startRefineAnalysis failed:', err)
    refineError.value = err?.message || '修正外观失败'
  } finally {
    refineAnalyzing.value = false
  }
}

async function applyRefineResult() {
  const body = refineResult.value.trim()
  if (!body || refineAnalyzing.value) {
    if (!body) toastFn('外观内容为空，请先分析或填写', 'warning')
    return
  }
  // 用户可能编辑过结果：有前后文时用编辑后的正文重组整卡；旧版后端退回服务端重组好的整卡
  detail.editPrompt = refineLegacyBasePrompt.value
    ? refineLegacyBasePrompt.value
    : `${refinePromptBefore.value}## 你的外观\n${body}${refinePromptAfter.value}`
  detail.dirty = true
  showRefineModal.value = false
  // 复用详情卡的保存链路（PUT /:id 会同步重裁 short_prompt、标记日程重生成）
  try {
    await saveCharDetail()
    toastFn('外观已修正并保存', 'success')
  } catch (err) {
    console.error('applyRefineResult save failed:', err)
    toastFn('外观已应用到人格卡，但自动保存失败，请手动点击「保存」', 'error')
  }
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
const standingBusy = computed(() => standingGenCharId.value != null || standingRegenCharId.value != null)
const standingBusyForChar = computed(() => standingGenerating.value || standingReimageing.value)
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

onUnmounted(stopStandingTips)

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
    const res = await api.generateStanding(c.id, standingRequirement.value.trim())
    c.standing_url = res.standing_url
    standingPrompt.value = res.promptText || ''
    toastFn('立绘已生成', 'success')
  } catch (e) {
    console.error('generateStanding failed:', e)
    toastFn(e?.message || '立绘生成失败', 'error')
  } finally {
    standingGenCharId.value = null
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
    const res = await api.regenerateStandingImage(c.id, prompt)
    c.standing_url = res.standing_url
    toastFn('立绘已生成', 'success')
  } catch (e) {
    console.error('regenerateStanding failed:', e)
    toastFn(e?.message || '立绘生成失败', 'error')
  } finally {
    standingRegenCharId.value = null
  }
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

/* ═══ 修正外观 ═══ */
.refine-body { display: flex; flex-direction: column; gap: 14px; }
.refine-dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 28px 16px;
  border: 1.5px dashed var(--glass-border);
  border-radius: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: center;
  user-select: none;
  transition: border-color 0.15s, background 0.15s;
}
.refine-dropzone:hover { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.04); }
.refine-dropzone svg { color: var(--accent); }
.refine-dropzone-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.refine-dropzone-sub { font-size: 11px; color: var(--text-secondary); }
/* 拖拽悬停亮显：dragover/drop 挂在整个弹窗正文上，拖到哪都能松手替换 */
.refine-body.is-dragging .refine-dropzone,
.refine-body.is-dragging .refine-preview { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.06); }
/* 最近图片入口：整行次要按钮，跟上传区并列为两大入口 */
.refine-recent-btn { margin-top: 0; }
/* 已选参考图：大图居中，图片下方一条横放的操作栏 */
.refine-preview {
  display: inline-flex; align-self: center;
  flex-direction: column;
  align-items: stretch;
  padding: 10px;
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  background: var(--bg-primary);
  transition: border-color 0.15s, background 0.15s;
}
.refine-preview-img {
  display: block;
  max-height: 260px;
  max-width: min(100%, 420px);
  border-radius: 10px;
  object-fit: contain;
}
.refine-preview-actions {
  display: flex; justify-content: center; align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.refine-analyzing { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
.refine-result .fl { margin-bottom: 6px; }
.refine-result-input { width: 100%; }
.refine-error { font-size: 12px; color: var(--danger); line-height: 1.5; }
.refine-file-input { display: none; }

.lora-civitai-label { font-size: 12px; color: var(--text-secondary); white-space: nowrap; margin: 0 2px; }
.lora-civitai-link, .lora-tutorial-link { font-size: 12px; color: var(--accent); text-decoration: none; white-space: nowrap; opacity: 0.85; transition: opacity 0.15s; }
.lora-civitai-link:hover, .lora-tutorial-link:hover { opacity: 1; text-decoration: underline; }
.lora-tutorial-link { margin-left: 6px; }

/* ═══ 移动端 ═══
   几何与 LinsheModal 的移动端段落同口径：遮罩只收留白（8px + 安全区），面板保留
   圆角 / 描边 / 白内衬的浮层观感 —— 不要再退回 100vw/100dvh + border-radius:0 的全屏面板。
   正文改成「内容优先」的纵向流：头像 → 内容卡 → 更多设置，底部操作区固定。 */
@media (max-width: 767px) {
  .modal-overlay {
    padding: calc(8px + env(safe-area-inset-top, 0px))
             calc(8px + env(safe-area-inset-right, 0px))
             calc(8px + env(safe-area-inset-bottom, 0px))
             calc(8px + env(safe-area-inset-left, 0px));
  }
  .modal-panel, .modal-wide { width: 100%; max-width: 100%; max-height: 100%; }
  .detail-panel { height: 100%; max-height: 100%; }

  /* 安全区由上方的遮罩留白让出，头部 / 底部不再各自叠加 */
  .modal-header { padding: 12px 16px; }
  .modal-header h3 { font-size: 15px; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px; }
  .modal-close { flex-shrink: 0; }
  .modal-body { padding: 4px 14px 14px; }
  .modal-footer { padding: 10px 14px 14px; }

  .modal-body-detail { overflow-y: auto; }
  .modal-body-detail .preview-card { flex: none; padding: 14px; border-radius: 12px; }
  .modal-body-detail .prompt-textarea { flex: none; min-height: 300px; }
  .modal-wide .fi, .modal-wide .prompt-textarea { font-size: 16px; }

  /* 头像行：允许换行，誓约徽章不再把「更换头像 / 移除」挤出屏幕 */
  .detail-avatar-row { flex-wrap: wrap; gap: 12px; margin-bottom: 14px; padding: 0 2px; }
  .detail-avatar { width: 56px; height: 56px; font-size: 24px; }

  /* 角色关系：标题独占一行，入口按钮并排平分（原先是标题被两个按钮挤成两行） */
  .detail-rel-section { padding: 12px; margin-bottom: 14px; }
  .detail-rel-header { flex-direction: column; align-items: stretch; gap: 10px; margin-bottom: 10px; }
  .detail-rel-btns, .detail-rel-ctas { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .detail-rel-btn { width: 100%; justify-content: center; }

  /* 角色名 / 英文名：窄屏改单列，别把两个输入框挤进半屏 */
  .detail-name-row { flex-direction: column; gap: 10px; }

  /* 底部操作区：说明独占一行，删除 / 保存分列两端 */
  .detail-actions { flex-wrap: wrap; justify-content: space-between; gap: 10px; }
  .recruit-appearance-hint { order: -1; flex: 1 1 100%; margin-left: 0; white-space: normal; }

  /* 更多设置：与桌面端右侧悬浮面板同款卡片 */
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

  .form-group .fl { font-size: 12px; }
  .form-hint { font-size: 10px; }
}
</style>
