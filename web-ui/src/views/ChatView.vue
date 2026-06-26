<template>
  <div class="chat-view">
    <div v-if="!chat.activeCharId" class="empty-state">
    </div>

    <template v-else>
      <div class="chat-header">
        <button v-if="isMobile" class="btn-mobile-back" @click="toggleMobileSidebar" title="角色列表">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div class="chat-header-center">
          <span class="chat-title">{{ chat.activeChar?.display_name }}</span>
          <span v-if="realtimeAffinityEnabled && chat.realtimeAffinity" class="header-affinity">
            <svg class="affinity-heart-icon" viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor"><path d="M512.042667 193.237333a255.914667 255.914667 0 0 1 351.658666 9.728 256 256 0 0 1 10.069334 351.402667l-361.813334 362.325333-361.728-362.325333a256 256 0 0 1 361.813334-361.130667z"/></svg>{{ Math.round(chat.realtimeAffinity.affinity) }}
            <span class="affinity-delta-wrap">
              <Transition name="roll">
                <span :key="chat.affinityKey" class="header-affinity-delta" :class="chat.realtimeAffinity.affinityDelta >= 0 ? 'delta-up' : 'delta-down'">
                  {{ chat.realtimeAffinity.affinityDelta >= 0 ? '+' : '' }}{{ Number(chat.realtimeAffinity.affinityDelta).toFixed(1) }}
                </span>
              </Transition>
            </span>
          </span>
        </div>
        <div class="chat-header-right">
          <span class="affinity-reason-wrap">
            <Transition name="roll">
              <span v-if="realtimeAffinityEnabled && chat.realtimeAffinity?.lastReason" :key="chat.affinityKey" class="header-reason">
                💬"{{ chat.realtimeAffinity.lastReason }}"
              </span>
            </Transition>
          </span>
          <div class="btn-header-settings" title="角色设置" @click="openSettings">
          <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor">
            <path d="M416.4 958h191.2V849.7c0-12.7 6.4-25.5 19.1-31.9 31.9-12.7 63.7-31.9 89.2-51 12.7-6.4 25.5-6.4 38.2 0l95.6 57.3 95.6-165.7-95.6-57.3C837 588.5 830.6 575.7 837 563c0-19.1 6.4-31.9 6.4-51s0-31.9-6.4-51c0-12.7 6.4-25.5 12.7-31.9l95.6-57.3-95.6-165.7-95.6 57.3c-12.7 6.4-25.5 6.4-38.2 0-25.5-19.1-57.3-38.2-89.2-51-12.7-12.7-19.1-25.5-19.1-38.2V66H416.4v108.3c0 12.7-6.4 25.5-19.1 31.9-31.9 12.7-63.7 31.9-89.2 51-12.7 6.4-25.5 6.4-38.2 0l-95.6-51-95.6 165.6 95.6 57.3c12.7 6.4 19.1 19.1 12.7 31.9 0 19.1-6.4 31.9-6.4 51s0 31.9 6.4 51c6.4 12.7 0 25.5-12.7 31.9l-95.6 57.3 95.6 165.7 95.6-57.3c12.7-6.4 25.5-6.4 38.2 0 25.5 19.1 57.3 38.2 89.2 51 12.7 6.4 19.1 19.1 19.1 31.9V958z m223 63.7H384.6c-19.1 0-31.9-12.7-31.9-31.9v-121c-25.5-12.7-51-25.5-70.1-38.2l-101.9 63.7c-12.7 6.4-31.9 6.4-44.6-12.7L8.6 658.6c-12.7-19.1-6.4-38.2 12.7-44.6l101.9-63.7v-76.5L21.4 410.1c-19.1-6.4-25.5-25.5-12.7-44.6l127.4-223c6.4-12.7 25.5-19.1 44.6-6.4l101.9 63.7c19.1-12.7 44.6-31.9 70.1-38.2V34.1c0-19.1 12.7-31.9 31.9-31.9h254.9c19.1 0 31.9 12.7 31.9 31.9v121.1c25.5 12.7 51 25.5 70.1 38.2l101.9-63.7c12.7-6.4 31.9-6.4 44.6 12.7l127.4 223c12.7 19.1 6.4 38.2-12.7 44.6l-101.9 63.7v76.5l101.9 63.7c12.7 6.4 19.1 25.5 12.7 44.6L888 881.5c-6.4 12.7-25.5 19.1-44.6 12.7l-101.9-63.7c-19.1 12.7-44.6 31.9-70.1 38.2v121.1c-0.1 19.2-12.8 31.9-32 31.9zM512 703.2c-108.3 0-191.2-82.8-191.2-191.2S403.7 320.8 512 320.8 703.2 403.7 703.2 512 620.3 703.2 512 703.2z m0-318.6c-70.1 0-127.4 57.3-127.4 127.4S441.9 639.4 512 639.4 639.4 582.1 639.4 512 582.1 384.6 512 384.6z"/>
          </svg>
        </div>
        </div>
      </div>

      <!--
        正常 column 布局：最旧消息在顶部，最新消息在底部
        新消息到达时 JS 平滑滚底，与列表高度变化同步
      -->
      <div ref="msgList" class="message-list" @scroll="onScroll">
        <!-- 加载指示器置于列表顶部 → 用户上滚到顶部时自动展开更早消息 -->
        <div v-if="chat.hasMoreOlder" class="load-older load-older-hint">↑ 向上滚动加载更多</div>

        <div ref="msgListInner" class="msg-list-inner">
          <template v-for="item in flatItems" :key="item.id">
            <!-- 时间分隔符 -->
            <div v-if="item.type === 'divider'" class="time-divider">{{ item.label }}</div>

            <!-- Text bubble (user or assistant) -->
            <div v-else-if="item.msg.type !== 'image_gen'" class="message" :class="[item.msg.role, { 'msg-same-role': item.sameRole }]">
              <div class="msg-avatar" :class="{ 'clickable': item.msg.role === 'assistant' }" :style="item.msg.role === 'user' ? userAvatarStyle : agentAvatarStyle" :title="item.msg.role === 'assistant' ? '角色设置' : ''" @click="item.msg.role === 'assistant' && openSettings()">
                <span v-if="item.msg.role === 'user' ? !userAvatar : !(chat.activeChar?.avatar_path)" class="avatar-fallback">{{ item.msg.role === 'user' ? '我' : chat.activeChar?.display_name?.charAt(0) }}</span>
              </div>
              <!-- 等待态：Agent消息内容为空时显示打字动画，不套气泡 -->
              <svg v-if="item.msg.role === 'assistant' && !item.msg.content && chat.streaming && chat.showTypingDots"
                class="typing-dots" viewBox="0 0 72 10" width="72" height="10"
                style="align-self:center"
              >
                <circle cx="4" cy="5" r="3" class="dot dot-0" />
                <circle cx="16" cy="5" r="3" class="dot dot-1" />
                <circle cx="28" cy="5" r="3" class="dot dot-2" />
                <circle cx="40" cy="5" r="3" class="dot dot-3" />
                <circle cx="52" cy="5" r="3" class="dot dot-4" />
                <circle cx="64" cy="5" r="3" class="dot dot-5" />
              </svg>
              <div v-else-if="item.msg.content" class="msg-bubble">
                <div class="msg-text" v-html="renderContent(item.msg.content)"></div>
              </div>
            </div>

            <!-- Image generation bubble -->
            <div v-else class="message assistant" :class="{ 'msg-same-role': item.sameRole }">
              <div class="msg-avatar clickable" :style="agentAvatarStyle" title="角色设置" @click="openSettings()">
                <span v-if="!chat.activeChar?.avatar_path" class="avatar-fallback">{{ chat.activeChar?.display_name?.charAt(0) }}</span>
              </div>
              <ImageGenBubble
                :msg="item.msg"
                @preview="previewImage = $event"
                @loaded="scrollToBottom(true)"
              />
            </div>
          </template>
        </div>
      </div>

      <!-- 回复候选词：v-if 控制 DOM 存在 + 仅 opacity 动画，避免移动端与滚动竞争 compositor -->
      <Transition name="guesses-fade">
        <div v-if="chat.guesses" class="guesses-row">
          <span class="guess-prefix">🔮</span>
          <button
            v-for="(text, key) in (chat.guesses || {})"
            :key="key"
            class="guess-pill"
            @click="pickGuess(text)"
          >{{ text }}</button>
        </div>
      </Transition>

      <div class="input-area">
        <div class="force-img-wrap">
          <label class="force-img-toggle" :class="{ active: forceImageGen }">
            <input type="checkbox" :checked="forceImageGen" @change="onForceImageGenChange" />
            <span class="force-img-icon">🎨</span>
          </label>
          <span v-if="forceTipVisible" class="force-img-tip" :class="{ 'is-mobile': isMobile }">{{ forceImageGen ? '强制配图：开' : '灵性配图：开' }}</span>
        </div>
        <textarea ref="inputEl" v-model="inputText" class="chat-input"
          placeholder="输入消息..." rows="1"
          @keydown.enter.exact.prevent="send"
          @keydown.enter.shift.exact="inputText += '\n'"
          @focus="inputFocused = true"
          @blur="inputFocused = false"
        ></textarea>
        <button v-show="!(isMobile && inputFocused)" class="gift-btn" @click="showGiftPanel = true" title="送礼物">
          <svg class="gift-btn-icon" viewBox="0 0 1138 1024" width="20" height="18" fill="#fff"><path d="M57.242236 626.030169l397.969831 0 0 397.969831-397.969831 0 0-397.969831zM683.272405 626.030169l397.969831 0 0 397.969831-397.969831 0 0-397.969831zM0 284.393966l455.212067 0 0 284.393966-455.212067 0 0-284.393966zM1137.575865 284.393966l0 284.393966-454.303461 0 0-284.393966 454.303461 0zM512.454303 284.393966l113.575865 0 0 739.606034-113.575865 0 0-739.606034zM683.272405 228.060337l-228.060337 0 0-170.818101 228.060337 0 0 170.818101zM1024 228.060337l-284.393966 0 111.758651-228.060337 172.635315 0 0 228.060337zM398.878438 228.060337l-284.393966 0 0-228.060337 169.909494 0z"/></svg>
        </button>
        <!-- 撤回气泡：长按发送按钮浮现 -->
        <Transition name="undo-bubble">
          <button v-if="showUndoBubble" class="undo-bubble-btn" @click.stop="undoLastRound">
            ↩ 撤回上一轮对话
          </button>
        </Transition>
        <button class="send-btn" :class="{ 'send-disabled': sendDisabled }"
          @click="onSendClick"
          :title="chat.streaming ? '发送中...' : (showUndoBubble ? '' : '发送（长按可撤回）')"
          @mousedown="onSendPressStart"
          @mouseup="onSendPressEnd"
          @mouseleave="onSendPressEnd"
          @touchstart="onSendPressStart"
          @touchend="onSendPressEnd"
          @touchcancel="onSendPressEnd"
        >
          <svg v-if="!chat.streaming" class="send-icon" viewBox="0 0 1024 1024" fill="#fff">
            <path d="M659.655431 521.588015q23.970037-6.71161 46.022472-13.423221 19.17603-5.752809 39.310861-11.505618t33.558052-10.546816l-13.423221 50.816479q-5.752809 21.093633-10.546816 31.640449-9.588015 25.88764-22.531835 47.940075t-24.449438 38.35206q-13.423221 19.17603-27.805243 35.475655l-117.932584 35.475655 96.838951 17.258427q-19.17603 16.299625-41.228464 33.558052-19.17603 14.382022-43.625468 30.202247t-51.29588 29.243446-59.925094 13.902622-62.801498-4.314607q-34.516854-4.794007-69.033708-16.299625 10.546816-16.299625 23.011236-36.434457 10.546816-17.258427 25.40824-40.749064t31.161049-52.254682q46.022472-77.662921 89.168539-152.449438t77.662921-135.191011q39.310861-69.992509 75.745318-132.314607-45.06367 51.775281-94.921348 116.014981-43.146067 54.651685-95.88015 129.917603t-107.385768 164.434457q-11.505618 18.217228-25.88764 42.187266t-30.202247 50.816479-32.599251 55.131086-33.078652 55.131086q-38.35206 62.322097-78.621723 130.397004 0.958801-20.134831 7.670412-51.775281 5.752809-26.846442 19.17603-67.116105t38.35206-94.921348q16.299625-34.516854 24.928839-53.692884t13.423221-29.722846q4.794007-11.505618 7.670412-15.340824-4.794007-5.752809-1.917603-23.011236 1.917603-15.340824 11.026217-44.58427t31.161049-81.977528q22.052434-53.692884 58.007491-115.535581t81.018727-122.726592 97.797753-117.932584 107.865169-101.153558 110.262172-72.389513 106.906367-32.11985q0.958801 33.558052-6.71161 88.689139t-19.17603 117.932584-25.88764 127.520599-27.805243 117.453184z"/>
          </svg>
          <svg v-else class="send-icon sending" viewBox="0 0 20 20" fill="none">
            <circle cx="6" cy="10" r="1.5" fill="#fff" opacity="0.4"/><circle cx="10" cy="10" r="1.5" fill="#fff" opacity="0.65"/><circle cx="14" cy="10" r="1.5" fill="#fff" opacity="0.9"/>
          </svg>
        </button>
      </div>
      <GiftPanel
        v-if="showGiftPanel"
        :character-id="chat.activeCharId"
        :character-name="chat.activeChar?.display_name || ''"
        @close="showGiftPanel = false"
        @sent="onGiftSent"
      />
    </template>

    <VueEasyLightbox
      :visible="!!previewImage"
      :imgs="previewImage"
      :max-zoom="6"
      :min-zoom="0.3"
      :zoom-scale="0.35"
      @hide="previewImage = null"
    />

    <!-- 角色设置面板（点击 ⚙️ 弹出） -->
    <Transition name="panel-slide">
      <div v-if="showSettings" class="settings-overlay" @click.self="closeSettings">
        <div class="settings-panel">
        <div class="sph">
          <span>角色设置</span>
        </div>

        <!-- 头像设置 -->
        <div class="sp-section">
          <label class="sp-label">头像</label>
          <div class="avatar-row">
            <div
              class="avatar-preview clickable"
              :style="avatarPreviewStyle"
              @click="openAvatarPicker"
            >{{ chat.activeChar?.avatar_path ? '' : chat.activeChar?.display_name?.charAt(0) }}</div>
            <div>
              <button class="sp-btn-small" @click="openAvatarPicker">更换头像</button>
              <button v-if="chat.activeChar?.avatar_path" class="sp-btn-small sp-btn-subtle" @click="removeAvatar">移除</button>
            </div>
          </div>
        </div>

        <div class="sp-divider"></div>

        <!-- 编辑人格 → 二级弹窗 -->
        <button class="sp-btn" @click="openCharEditor">
          <svg class="sp-btn-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M892.691692 30.72l77.981539 77.981538a73.491692 73.491692 0 0 1 0 103.975385l-584.861539 584.861539-228.036923 46.08 46.08-228.036924L788.716308 30.72a73.491692 73.491692 0 0 1 103.975384 0z m25.993846 129.969231l-77.981538-77.981539-569.186462 569.186462-19.692307 97.673846 97.673846-19.692308 569.186461-569.186461z" fill="currentColor"/><path d="M652.366769 167.699692l180.854154 182.035693 55.689846-55.689847-180.854154-182.114461zM73.491692 953.344h888.595693v-78.769231H73.570462z" fill="currentColor"/></svg>
          编辑角色人格
        </button>

        <!-- 查看角色对用户的印象 -->
        <button class="sp-btn" @click="openImpression">
          <svg class="sp-btn-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M607.839811 895.957102H214.69447A86.82497 86.82497 0 0 1 127.880338 809.070721V214.784781A86.839419 86.839419 0 0 1 214.69447 127.880338h594.28594a86.33729 86.33729 0 0 1 61.436749 25.456857c16.400473 16.400473 25.362934 38.208767 25.373771 61.411462L894.439878 607.821749v0.10476a32.031496 32.031496 0 0 0 64.059379 0.101149L959.825022 214.889542v-0.104761A150.775976 150.775976 0 0 0 808.98041 63.940169H214.69447A150.638703 150.638703 0 0 0 63.940169 214.784781v594.28594a150.638703 150.638703 0 0 0 150.757914 150.82655h393.141728a31.970084 31.970084 0 0 0 0-63.940169z" fill="currentColor"/><path d="M950.544667 905.331381l-122.071536-122.071536a192.217875 192.217875 0 1 0-45.213286 45.213286l122.071536 122.071536a31.970084 31.970084 0 0 0 45.213286-45.213286z m-278.547941-105.302594a128.028448 128.028448 0 1 1 90.531332-37.497116 127.193975 127.193975 0 0 1-90.527719 37.497116zM768.004516 352.212795c17.653989 0 31.966472-14.402794 31.970084-32.056783s-14.308871-32.074845-31.966472-32.078457L256.002709 287.911382a32.020659 32.020659 0 0 0-31.970084 32.024271c0 17.657601 14.308871 32.092907 31.966472 32.092908L768.004516 352.212795zM448.000226 544.033302a31.96286 31.96286 0 1 0 0-63.940169h-192.001129a31.937573 31.937573 0 1 0 0 63.878758l192.001129 0.061411zM256.017159 671.91364a31.959247 31.959247 0 1 0 0 63.922107l127.999549 0.018062a31.941185 31.941185 0 1 0 0-63.878757z" fill="currentColor"/></svg>
          查看对你的印象
        </button>

        <div class="sp-divider sp-divider-strong"></div>

        <!-- 清空聊天记录 -->
        <button class="sp-btn sp-btn-danger" @click="clearChatHistory" :disabled="clearing">
          <svg class="sp-btn-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M687.6 96.4H336.4v91.2h351.1V96.4zM636.7 398v405.5h-73.9V398h73.9z m-175.5 0v405.5h-73.9V398h73.9z m332.1-119.2H230.7l27.9 648.8h506.7l28-648.8zM696.8 5.1c40.4 0 73.3 35.6 73.9 79.8v102.7h147.8c20.2 0 36.6 17.8 37 39.9v41.2c0 5.5-4 10-9 10.1h-70.1L848 941.6c-1.8 42.9-33.7 76.6-72.6 77.3H249.8c-39 0-71.3-33.4-73.7-76l-0.1-1.3-28.5-662.7H77.7c-5 0-9.1-4.4-9.2-9.8v-40.9c0-22.2 16.2-40.2 36.3-40.5h148.4V86.2c0-44.3 32.5-80.4 72.7-81.1h370.9z" fill="currentColor"/></svg>
          {{ clearing ? '清空中...' : '清空记忆' }}
        </button>

        <div class="sp-divider"></div>

        <!-- 删除角色 -->
        <button class="sp-btn sp-btn-danger" @click="deleteChar" :disabled="deleting || chat.activeChar?.name === 'default'"
          :title="chat.activeChar?.name === 'default' ? '不能删除默认Agent' : ''">
          <svg class="sp-btn-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M512 179.2l390.4 627.2H128l384-627.2m0-64c-19.2 0-44.8 12.8-51.2 32l-390.4 627.2c-25.6 44.8 6.4 96 51.2 96H896c51.2 0 83.2-57.6 51.2-96l-384-627.2c-6.4-19.2-32-32-51.2-32z" fill="#d81e06"/><path d="M512 640c-19.2 0-32-12.8-32-32v-192c0-19.2 12.8-32 32-32s32 12.8 32 32v192c0 19.2-12.8 32-32 32z" fill="#d81e06"/><path d="M512 723.2m-32 0a32 32 0 1 0 64 0 32 32 0 1 0-64 0Z" fill="#d81e06"/></svg>
          {{ deleting ? '删除中...' : '删除角色' }}
        </button>
      </div>
    </div>
    </Transition>

    <!-- 角色人格编辑弹窗（二级菜单） -->
    <Transition name="editor-fade">
      <div v-if="showEditor" class="editor-overlay">
      <div class="editor-panel">
        <div class="editor-header">
          <span>编辑角色人格 — {{ chat.activeChar?.display_name }}</span>
          <button class="editor-close" @click="closeCharEditor">&times;</button>
        </div>
        <div class="editor-field">
          <label>显示名称</label>
          <input v-model="editForm.display_name" class="editor-input" />
        </div>
        <div class="editor-field editor-field-grow">
          <label>人格提示词（base_prompt）</label>
          <textarea v-model="editForm.base_prompt" class="editor-textarea"></textarea>
        </div>
        <div class="editor-actions">
          <div class="editor-actions-right">
            <button class="btn-cancel" @click="closeCharEditor">取消</button>
            <button class="btn-primary" @click="saveCharEditor" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
          </div>
        </div>
      </div>
    </div>
    </Transition>

    <!-- 角色对用户的印象弹窗 -->
    <Transition name="editor-fade">
      <div v-if="showImpression" class="editor-overlay" @click.self="showImpression = false">
      <div class="editor-panel impression-panel">
        <div class="editor-header">
          <span>{{ chat.activeChar?.display_name }} 对你的印象</span>
          <button class="editor-close" @click="showImpression = false">&times;</button>
        </div>
        <div class="impression-body">
          <!-- 加载中 -->
          <div v-if="impressionLoading" class="impression-status">
            <div class="impression-loading-spinner"></div>
            <span>正在读取对你的印象...</span>
          </div>
          <!-- 错误 -->
          <div v-else-if="impressionError" class="impression-status impression-error-state">
            <span class="impression-error-icon">⚠️</span>
            <span>加载失败: {{ impressionError }}</span>
          </div>
          <!-- 画像列表 + 情绪状态（双栏） -->
          <div v-else class="impression-content">
            <div class="impression-left">
            <div v-for="key in groupKeys" :key="key">
              <div class="impression-group">
                <div class="impression-group-header">
                  <span class="impression-group-badge" :style="{ background: typeColor[key] }">
                    {{ typeIcon[key] }}
                  </span>
                  <span class="impression-group-title">{{ typeLabel[key] }}</span>
                  <span class="impression-group-count">{{ impressionGrouped[key]?.length || 0 }}</span>
                  <button class="impression-add-btn" :style="{ color: typeColor[key] }" title="添加" @click="startAdd(key)">+</button>
                </div>

                <!-- 添加模式（该组为空或用户点击 + 后） -->
                <div v-if="addingKey === key" class="impression-card-list">
                  <div class="impression-card impression-card-editing" :style="{ '--tint': typeColor[key] }">
                    <textarea
                      v-model="addingContent"
                      class="impression-edit-textarea"
                      :style="{ borderColor: typeColor[key] }"
                      rows="2"
                      placeholder="输入新的特征描述..."
                      @keydown.esc="cancelAdd"
                      @keydown.enter.ctrl="saveAdd(key)"
                    ></textarea>
                    <div class="impression-edit-actions">
                      <button class="impression-btn impression-btn-cancel" @click="cancelAdd" :disabled="savingAdd">取消</button>
                      <button class="impression-btn impression-btn-save" :style="{ background: typeColor[key] }" @click="saveAdd(key)" :disabled="savingAdd || addingContent.trim().length < 2">
                        {{ savingAdd ? '添加中...' : '添加' }}
                      </button>
                    </div>
                  </div>
                </div>

                <!-- 已有特征列表 -->
                <div v-if="impressionGrouped[key]?.length" class="impression-card-list">
                  <div
                    v-for="trait in impressionGrouped[key]"
                    :key="trait.id"
                    class="impression-card"
                    :class="{ 'impression-card-editing': editingId === trait.id }"
                    :style="{ '--tint': typeColor[key] }"
                  >
                    <!-- 编辑模式 -->
                    <template v-if="editingId === trait.id">
                      <textarea
                        v-model="editingContent"
                        class="impression-edit-textarea"
                        :style="{ borderColor: typeColor[key] }"
                        rows="2"
                        @keydown.esc="cancelEdit"
                        @keydown.enter.ctrl="saveEdit(trait)"
                      ></textarea>
                      <div class="impression-edit-actions">
                        <button class="impression-btn impression-btn-cancel" @click="cancelEdit" :disabled="savingEdit">取消</button>
                        <button class="impression-btn impression-btn-save" :style="{ background: typeColor[key] }" @click="saveEdit(trait)" :disabled="savingEdit || editingContent.trim().length < 2">
                          {{ savingEdit ? '保存中...' : '保存' }}
                        </button>
                      </div>
                    </template>
                    <!-- 查看模式 -->
                    <template v-else>
                      <div class="impression-card-main">
                        <span class="impression-card-text">{{ trait.content }}</span>
                        <div class="impression-card-meta">
                          <span class="impression-card-confidence" :title="'置信度: ' + Math.round((trait.confidence || 0.5) * 100) + '%'">
                            <span class="dot" :class="'dot-' + confidenceLevel(trait.confidence)"></span>
                            <span class="dot" :class="'dot-' + confidenceLevel(trait.confidence, 1)"></span>
                            <span class="dot" :class="'dot-' + confidenceLevel(trait.confidence, 2)"></span>
                          </span>
                          <span class="impression-card-time">{{ formatTime(trait.created_at) }}</span>
                        </div>
                      </div>
                      <div class="impression-card-actions">
                        <button class="impression-action-btn" title="编辑" @click="startEdit(trait)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="impression-action-btn impression-action-btn-danger" title="删除" @click="removeTrait(trait)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </template>
                  </div>
                </div>

                <!-- 空组占位 -->
                <div v-else-if="addingKey !== key" class="impression-empty-row">
                  <span class="impression-empty-row-text">暂无记录</span>
                  <button class="impression-add-link" :style="{ color: typeColor[key] }" @click="startAdd(key)">+ 添加特征</button>
                </div>
              </div>
            </div>
            </div>  <!-- impression-left -->

            <!-- 右栏：VAD 情绪 + 好感度 -->
            <div class="impression-right">
              <div class="vad-section">
                <div class="vad-section-title">情绪与好感度</div>

                <!-- 无数据 -->
                <div v-if="!impressionVad" class="vad-empty">
                  <span>暂无情绪数据</span>
                  <span class="vad-empty-hint">开始对话后自动生成</span>
                </div>

                <template v-else>
                  <!-- VAD 三维 -->
                  <div v-for="(conf, key) in VAD_LABELS" :key="key" class="vad-bar-group">
                    <div class="vad-bar-label">{{ conf.name }}</div>
                    <div class="vad-bar-row">
                      <span class="vad-bar-end vad-bar-end-left">{{ conf.left }}</span>
                      <div class="vad-bar-track">
                        <div
                          class="vad-bar-fill"
                          :style="{ width: vadPercent(key, impressionVad.instant[key]) + '%' }"
                        ></div>
                        <div
                          class="vad-bar-dot"
                          :style="{ left: vadPercent(key, impressionVad.instant[key]) + '%' }"
                        ></div>
                      </div>
                      <span class="vad-bar-end vad-bar-end-right">{{ conf.right }}</span>
                    </div>
                  </div>

                  <!-- 情绪特征（VAD → 最近四字词） -->
                  <div class="vad-dominant">
                    <span class="vad-dominant-label">情绪特征</span>
                    <span class="vad-emotion-tag">{{ topEmotions(impressionVad.instant, 1)[0]?.label || '—' }}</span>
                  </div>

                  <!-- 好感度 -->
                  <div class="affinity-section">
                    <div class="affinity-header">
                      <span class="affinity-label">好感度</span>
                      <span class="affinity-value">{{ Math.round(impressionAffinity) }}</span>
                      <span class="affinity-tag">{{ affinityLabel(impressionAffinity) }}</span>
                    </div>
                    <div class="affinity-hearts">
                      <div
                        v-for="i in 5"
                        :key="i"
                        class="affinity-heart"
                        :class="{ filled: impressionAffinity >= i * 20, half: impressionAffinity > (i - 1) * 20 && impressionAffinity < i * 20 }"
                      >
                        <svg viewBox="0 0 24 22" class="heart-svg">
                          <defs>
                            <clipPath :id="'heart-clip-' + i">
                              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                            </clipPath>
                          </defs>
                          <!-- 底色（空心） -->
                          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                            class="heart-bg"/>
                          <!-- 填充（clip 到对应百分比） -->
                          <rect
                            v-if="impressionAffinity > (i - 1) * 20"
                            x="0" y="0" width="24" height="22"
                            class="heart-fg"
                            :clip-path="'url(#heart-clip-' + i + ')'"
                            :style="{ width: Math.min(100, Math.max(0, (impressionAffinity - (i - 1) * 20) / 20 * 100)) + '%' }"
                          />
                        </svg>
                      </div>
                    </div>

                    <!-- 最近一次好感度变化 -->
                    <div v-if="impressionLastDelta != null" class="affinity-change">
                      <div class="affinity-change-row">
                        <span class="affinity-change-label">最近变化</span>
                        <span class="affinity-change-delta" :class="impressionLastDelta >= 0 ? 'delta-up' : 'delta-down'">
                          {{ impressionLastDelta >= 0 ? '+' : '' }}{{ impressionLastDelta.toFixed(1) }}
                        </span>
                      </div>
                      <div v-if="impressionLastReason" class="affinity-change-reason">
                        💬 {{ impressionLastReason }}
                      </div>
                    </div>
                    <!-- 实时显示开关 -->
                    <div class="affinity-realtime-toggle">
                      <span class="affinity-realtime-label">实时显示</span>
                      <label class="switch">
                        <input type="checkbox" v-model="realtimeAffinityEnabled" />
                        <span class="slider"></span>
                      </label>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>  <!-- impression-content -->
        </div>
      </div>
    </div>
    </Transition>

    <!-- 角色头像选择器 -->
    <AvatarCropper
      v-if="showAvatarPicker"
      title="选择角色头像"
      :show-recent-tab="true"
      :show-generate-tab="true"
      :character-id="chat.activeChar?.id"
      :character-base-prompt="chat.activeChar?.base_prompt || ''"
      :recent-images="recentImages"
      :recent-loading="recentLoading"
      @close="closeAvatarPicker"
      @save="onAgentAvatarSave"
      @switch-to-recent="switchToRecent"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import ImageGenBubble from '../components/ImageGenBubble.vue'
import AvatarCropper from '../components/AvatarCropper.vue'
import GiftPanel from '../components/GiftPanel.vue'
import VueEasyLightbox from 'vue-easy-lightbox'
import 'vue-easy-lightbox/dist/external-css/vue-easy-lightbox.css'
import { userAvatar, loadUserAvatar } from '../userConfig.js'
import { getCharacterPortrait, addPortrait, updatePortrait, deletePortrait } from '../api/index.js'
import { useSettingsStore } from '../stores/settings.js'

const route = useRoute()
const router = useRouter()
const chat = useChatStore()
const confirmFn = inject('confirm')
const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const inputText = ref('')
const showGiftPanel = ref(false)
const inputFocused = ref(false)
const settings = useSettingsStore()
const forceImageGen = computed(() => settings.forceImageGen)
const realtimeAffinityEnabled = computed({
  get: () => settings.realtimeAffinityDisplay,
  set: (v) => settings.setRealtimeAffinityDisplay(v),
})

function onForceImageGenChange(e) {
  settings.setForceImageGen(e.target.checked)
  showForceTip()
}

function onGiftSent(result) {
  showGiftPanel.value = false

  // 刷新顶部好感度显示
  chat.realtimeAffinity = {
    affinity: result.affinity,
    affinityDelta: result.affinityDelta,
    lastReason: '哇，收到礼物了',
  }
  chat.affinityKey++

  // 1. 文字气泡
  chat.messages.push({
    id: result.msgId,
    role: 'assistant',
    content: result.reaction,
    created_at: new Date().toISOString(),
  })

  // 2. 生图气泡（pending → 遮罩 + 进度条，和普通生图完全一致）
  const genId = `gift_${result.msgId}`
  const genMsg = {
    id: Date.now(),
    role: 'assistant',
    type: 'image_gen',
    genId,
    genStatus: 'pending',
    genStartTime: Date.now(),
    created_at: new Date().toISOString(),
  }
  chat.messages.push(genMsg)
  nextTick(() => scrollToBottom(true))

  // 3. 轮询图片就绪，更新 image_gen 气泡
  let polls = 0
  const timer = setInterval(async () => {
    polls++
    try {
      const res = await fetch(`/api/messages/${result.msgId}`)
      if (!res.ok) { clearInterval(timer); return }
      const data = await res.json()
      if (data.images) {
        try {
          const urls = JSON.parse(data.images)
          if (Array.isArray(urls) && urls.length > 0) {
            const idx = chat.messages.findIndex(m => m.genId === genId)
            if (idx >= 0) {
              chat.messages[idx].images = urls.map(url => ({ url, base64: null }))
              chat.messages[idx].genStatus = 'done'
            }
          }
        } catch {}
        clearInterval(timer)
      }
    } catch { /* ignore */ }
    if (polls >= 20) {
      const idx = chat.messages.findIndex(m => m.genId === genId)
      if (idx >= 0) chat.messages[idx].genStatus = 'error'
      clearInterval(timer)
    }
  }, 4000)
}
const forceTipVisible = ref(false)
let forceTipTimer = null
function showForceTip() {
  forceTipVisible.value = true
  clearTimeout(forceTipTimer)
  forceTipTimer = setTimeout(() => { forceTipVisible.value = false }, 2000)
}
// ── 实时好感度：拉取当前角色最新值 ──
async function fetchRealtimeAffinity() {
  if (!realtimeAffinityEnabled.value || !chat.activeCharId) return
  try {
    const data = await getCharacterPortrait(chat.activeCharId)
    chat.realtimeAffinity = {
      affinity: data.affinity ?? 50,
      affinityDelta: data.lastAffinityDelta ?? 0,
      lastReason: data.lastReason || ''
    }
  } catch {}
}

// 开关从关→开时拉取
watch(realtimeAffinityEnabled, async (on) => { if (on) fetchRealtimeAffinity() })

// 切换角色时拉取
watch(() => chat.activeCharId, async (newId) => { if (newId) fetchRealtimeAffinity() })

const inputEl = ref(null)
const msgList = ref(null)
const msgListInner = ref(null)
const previewImage = ref(null)

// ── 角色设置面板 ──
const showSettings = ref(false)
const showEditor = ref(false)
const saving = ref(false)
const clearing = ref(false)
const deleting = ref(false)
const editForm = ref({ display_name: '', base_prompt: '' })

// ── 印象弹窗 ──
const showImpression = ref(false)
const impressionLoading = ref(false)
const impressionError = ref('')
const impressionGrouped = ref({ appearance: [], personality: [], preference: [] })
const impressionVad = ref(null)      // { instant, mood, dominantEmotion }
const impressionAffinity = ref(50)
const impressionLastDelta = ref(null)
const impressionLastReason = ref('')

const VAD_LABELS = {
  valence: { name: '愉悦度', left: '低落', right: '愉悦', range: [-1, 1] },
  arousal: { name: '唤醒度', left: '平静', right: '激动', range: [0, 1] },
  dominance: { name: '支配度', left: '顺从', right: '自主', range: [0, 1] },
}
const EMOTION_VAD_MAP = [
  // ═══ 高愉悦 · 高自主 (V > 0.4, D > 0.60) — 意气风发的快乐 ═══
  // V≈0.82-0.88, A≈0.75-0.85
  { label: '欣喜若狂', v: 0.87, a: 0.82, d: 0.72 },
  { label: '踌躇满志', v: 0.82, a: 0.75, d: 0.78 },
  // V≈0.70-0.82, A≈0.55-0.75
  { label: '得意洋洋', v: 0.78, a: 0.68, d: 0.76 },
  { label: '扬眉吐气', v: 0.80, a: 0.55, d: 0.78 },
  // V≈0.60-0.78, A≈0.45-0.65
  { label: '昂首阔步', v: 0.70, a: 0.60, d: 0.72 },
  { label: '意气风发', v: 0.68, a: 0.65, d: 0.68 },
  { label: '春风得意', v: 0.75, a: 0.50, d: 0.70 },
  // V≈0.48-0.68, A≈0.30-0.60
  { label: '泰然自若', v: 0.62, a: 0.38, d: 0.78 },
  { label: '意气扬扬', v: 0.55, a: 0.60, d: 0.72 },
  { label: '从容不迫', v: 0.52, a: 0.48, d: 0.65 },
  { label: '谈笑自若', v: 0.48, a: 0.55, d: 0.62 },
  { label: '傲睨得志', v: 0.58, a: 0.35, d: 0.82 },
  { label: '睥睨天下', v: 0.65, a: 0.45, d: 0.88 },

  // ═══ 高愉悦 · 温和自主 (V > 0.4, D: 0.35~0.60) — 自然流露的快乐 ═══
  // V≈0.85, A≈0.80
  { label: '欢天喜地', v: 0.85, a: 0.80, d: 0.52 },
  { label: '乐不可支', v: 0.86, a: 0.76, d: 0.46 },
  // V≈0.75-0.82, A≈0.68-0.78
  { label: '喜不自胜', v: 0.78, a: 0.72, d: 0.50 },
  { label: '欣喜万分', v: 0.72, a: 0.68, d: 0.52 },
  { label: '心花怒放', v: 0.80, a: 0.70, d: 0.55 },
  { label: '喜出望外', v: 0.75, a: 0.65, d: 0.45 },
  { label: '兴高采烈', v: 0.70, a: 0.75, d: 0.55 },
  // V≈0.55-0.70, A≈0.55-0.75
  { label: '眉飞色舞', v: 0.60, a: 0.70, d: 0.60 },
  { label: '轻松愉快', v: 0.70, a: 0.55, d: 0.55 },
  { label: '喜上眉梢', v: 0.62, a: 0.52, d: 0.52 },
  { label: '兴致盎然', v: 0.58, a: 0.58, d: 0.52 },
  { label: '津津有味', v: 0.52, a: 0.58, d: 0.50 },
  { label: '兴致勃勃', v: 0.55, a: 0.65, d: 0.55 },
  // V≈0.50-0.70, A≈0.25-0.50
  { label: '称心如意', v: 0.62, a: 0.48, d: 0.50 },
  { label: '心满意足', v: 0.65, a: 0.35, d: 0.55 },
  { label: '怡然自乐', v: 0.60, a: 0.30, d: 0.45 },
  { label: '悠然自得', v: 0.55, a: 0.25, d: 0.55 },
  // V≈0.40-0.55, A≈0.30-0.55
  { label: '含笑盈盈', v: 0.48, a: 0.52, d: 0.48 },
  { label: '乐在其中', v: 0.50, a: 0.45, d: 0.50 },
  { label: '心平气和', v: 0.45, a: 0.38, d: 0.48 },
  { label: '闲适自在', v: 0.42, a: 0.35, d: 0.45 },
  { label: '安心自在', v: 0.50, a: 0.30, d: 0.50 },
  { label: '舒舒服服', v: 0.40, a: 0.25, d: 0.40 },

  // ═══ 高愉悦 · 柔软依恋 (V > 0.4, D < 0.35) — 被动接收的快乐 ═══
  // V≈0.84-0.90, A≈0.78-0.86
  { label: '喜极而泣', v: 0.88, a: 0.84, d: 0.22 },
  { label: '雀跃不已', v: 0.84, a: 0.80, d: 0.28 },
  // V≈0.70-0.80, A≈0.70-0.80
  { label: '心潮澎湃', v: 0.76, a: 0.75, d: 0.25 },
  { label: '欢呼雀跃', v: 0.72, a: 0.78, d: 0.30 },
  // V≈0.60-0.75, A≈0.40-0.65
  { label: '甜甜蜜蜜', v: 0.65, a: 0.50, d: 0.28 },
  { label: '心驰神往', v: 0.68, a: 0.60, d: 0.25 },
  // V≈0.50-0.65, A≈0.18-0.45
  { label: '身心融化', v: 0.70, a: 0.22, d: 0.18 },
  { label: '柔情蜜意', v: 0.60, a: 0.42, d: 0.25 },
  { label: '小鸟依人', v: 0.58, a: 0.38, d: 0.20 },
  { label: '依偎安眠', v: 0.62, a: 0.22, d: 0.18 },
  { label: '柔情似水', v: 0.52, a: 0.25, d: 0.25 },
  // V≈0.40-0.58, A≈0.30-0.58
  { label: '含情脉脉', v: 0.52, a: 0.42, d: 0.22 },
  { label: '娇羞可人', v: 0.48, a: 0.48, d: 0.18 },
  { label: '温温柔柔', v: 0.50, a: 0.35, d: 0.30 },
  { label: '仰慕崇拜', v: 0.45, a: 0.48, d: 0.22 },
  { label: '又惊又喜', v: 0.50, a: 0.70, d: 0.32 },
  { label: '感激涕零', v: 0.55, a: 0.55, d: 0.18 },
  { label: '撒娇弄痴', v: 0.48, a: 0.52, d: 0.15 },
  { label: '受宠若惊', v: 0.40, a: 0.65, d: 0.22 },

  // ═══ 中低愉悦 / 中性 (V: -0.2 ~ 0.4) ═══
  // ── 高自主 (>0.55) ──
  { label: '跃跃欲试', v: 0.28, a: 0.55, d: 0.68 },
  { label: '自信满满', v: 0.40, a: 0.50, d: 0.75 },
  { label: '掌控全局', v: 0.30, a: 0.50, d: 0.85 },
  { label: '稳如泰山', v: 0.10, a: 0.32, d: 0.72 },
  { label: '不动声色', v: 0.00, a: 0.28, d: 0.65 },
  // ── 温和自主 (0.35~0.55) ──
  { label: '意兴盎然', v: 0.32, a: 0.50, d: 0.52 },
  { label: '若有所思', v: 0.28, a: 0.42, d: 0.50 },
  { label: '饶有兴趣', v: 0.25, a: 0.48, d: 0.48 },
  { label: '充满好奇', v: 0.20, a: 0.55, d: 0.45 },
  { label: '侧耳倾听', v: 0.22, a: 0.48, d: 0.45 },
  { label: '洗耳恭听', v: 0.15, a: 0.45, d: 0.42 },
  { label: '心如止水', v: 0.20, a: 0.35, d: 0.50 },
  { label: '不知不觉', v: 0.10, a: 0.35, d: 0.45 },
  { label: '意兴阑珊', v: -0.18, a: 0.25, d: 0.45 },
  { label: '兴致索然', v: -0.15, a: 0.20, d: 0.45 },
  // ── 低自主 (<0.35) ──
  { label: '将信将疑', v: 0.20, a: 0.42, d: 0.28 },
  { label: '忐忑犹豫', v: 0.12, a: 0.45, d: 0.25 },
  { label: '小心翼翼', v: 0.05, a: 0.40, d: 0.25 },
  { label: '惴惴小心', v: 0.02, a: 0.32, d: 0.22 },
  { label: '犹豫不决', v: 0.10, a: 0.28, d: 0.28 },
  { label: '胆怯羞涩', v: 0.15, a: 0.48, d: 0.20 },
  { label: '唯唯诺诺', v: -0.05, a: 0.20, d: 0.15 },

  // ═══ 负面 · 低唤醒 · 低支配 (V < 0, A < 0.4, D < 0.4) ═══
  { label: '昏昏欲睡', v: -0.10, a: 0.20, d: 0.40 },
  { label: '无精打采', v: -0.20, a: 0.22, d: 0.30 },
  { label: '萎靡不振', v: -0.25, a: 0.15, d: 0.25 },
  { label: '百无聊赖', v: -0.25, a: 0.18, d: 0.40 },
  { label: '闷闷不乐', v: -0.40, a: 0.28, d: 0.30 },
  { label: '郁郁寡欢', v: -0.50, a: 0.30, d: 0.35 },
  { label: '垂头丧气', v: -0.55, a: 0.22, d: 0.25 },
  { label: '心灰意冷', v: -0.55, a: 0.20, d: 0.30 },
  { label: '茫然若失', v: -0.30, a: 0.30, d: 0.20 },
  { label: '黯然神伤', v: -0.60, a: 0.25, d: 0.20 },
  { label: '悲从中来', v: -0.70, a: 0.30, d: 0.15 },
  { label: '万念俱灰', v: -0.78, a: 0.15, d: 0.10 },
  { label: '孤立无援', v: -0.35, a: 0.25, d: 0.15 },

  // ═══ 负面 · 高唤醒 · 低自主 (V < 0, A > 0.4, D < 0.35) — 恐惧/焦虑 ═══
  { label: '心神不宁', v: -0.18, a: 0.48, d: 0.32 },
  { label: '惴惴不安', v: -0.25, a: 0.50, d: 0.30 },
  { label: '忐忑不安', v: -0.30, a: 0.55, d: 0.25 },
  { label: '如坐针毡', v: -0.35, a: 0.70, d: 0.20 },
  { label: '忧心忡忡', v: -0.40, a: 0.65, d: 0.30 },
  { label: '心惊胆战', v: -0.45, a: 0.75, d: 0.20 },
  { label: '魂飞魄散', v: -0.60, a: 0.80, d: 0.15 },

  // ═══ 负面 · 高唤醒 · 中高自主 (V < 0, A > 0.4, D ≥ 0.35) — 愤怒/焦躁 ═══
  { label: '怏怏不乐', v: -0.22, a: 0.48, d: 0.42 },
  { label: '焦躁不安', v: -0.32, a: 0.62, d: 0.40 },
  { label: '心烦意乱', v: -0.30, a: 0.60, d: 0.55 },
  { label: '心头火起', v: -0.35, a: 0.55, d: 0.55 },
  { label: '愤懑不平', v: -0.38, a: 0.52, d: 0.48 },
  { label: '气急败坏', v: -0.50, a: 0.65, d: 0.55 },
  { label: '愤愤不平', v: -0.45, a: 0.55, d: 0.60 },
  { label: '恼羞成怒', v: -0.55, a: 0.70, d: 0.50 },
  { label: '怒不可遏', v: -0.65, a: 0.75, d: 0.70 },
  { label: '咬牙切齿', v: -0.70, a: 0.70, d: 0.75 },
  { label: '暴跳如雷', v: -0.72, a: 0.85, d: 0.82 },

  // ═══ 负面 · 低唤醒 · 高自主 (V < 0, A < 0.4, D > 0.55) — 冷漠/疏离 ═══
  { label: '不屑一顾', v: -0.20, a: 0.35, d: 0.70 },
  { label: '若即若离', v: -0.15, a: 0.30, d: 0.55 },
  { label: '冷若冰霜', v: -0.25, a: 0.28, d: 0.65 },
  { label: '漠不关心', v: -0.30, a: 0.25, d: 0.55 },
  { label: '鄙夷不屑', v: -0.38, a: 0.32, d: 0.62 },
  { label: '嗤之以鼻', v: -0.42, a: 0.30, d: 0.68 },
  { label: '大失所望', v: -0.40, a: 0.40, d: 0.35 },
]

function vadDistance(e, vad) {
  // D 权重 1.8×：实践中 D 偏离幅度远小于 V/A（~0.02 vs ~0.15），
  // 等权会导致 D 几乎不参与匹配，造成欢天喜地(D=0.50)包揽所有高 V 状态
  const D_WEIGHT = 1.8
  return Math.sqrt(
    Math.pow(e.v - vad.valence, 2) +
    Math.pow(e.a - vad.arousal, 2) +
    Math.pow((e.d - vad.dominance) * D_WEIGHT, 2)
  )
}

function topEmotions(vad, n = 3) {
  if (!vad) return []
  return [...EMOTION_VAD_MAP]
    .map(e => ({ ...e, dist: vadDistance(e, vad) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
}

function vadPercent(key, value) {
  const { range } = VAD_LABELS[key]
  return ((value - range[0]) / (range[1] - range[0])) * 100
}

function affinityLabel(val) {
  if (val >= 80) return '深度信任'
  if (val >= 60) return '亲切友好'
  if (val >= 40) return '中性友善'
  if (val >= 20) return '保持距离'
  return '冷淡疏离'
}

async function openImpression() {
  showSettings.value = false
  showImpression.value = true
  impressionLoading.value = true
  impressionError.value = ''
  impressionGrouped.value = { appearance: [], personality: [], preference: [] }
  impressionVad.value = null
  impressionAffinity.value = 50
  try {
    const data = await getCharacterPortrait(chat.activeChar.id)
    impressionGrouped.value = data.grouped || { appearance: [], personality: [], preference: [] }
    impressionVad.value = data.vad || null
    impressionAffinity.value = data.affinity ?? 50
    impressionLastDelta.value = data.lastAffinityDelta ?? null
    impressionLastReason.value = data.lastReason || ''
  } catch (err) {
    impressionError.value = err.message
  } finally {
    impressionLoading.value = false
  }
}

// ── 印象编辑/删除 ──
const editingId = ref(null)
const editingContent = ref('')
const savingEdit = ref(false)

function startEdit(trait) {
  editingId.value = trait.id
  editingContent.value = trait.content
}
function cancelEdit() {
  editingId.value = null
  editingContent.value = ''
}
async function saveEdit(trait) {
  const trimmed = editingContent.value.trim()
  if (trimmed.length < 2) return
  savingEdit.value = true
  try {
    await updatePortrait(trait.id, trimmed)
    // 更新本地数据
    trait.content = trimmed
    editingId.value = null
    editingContent.value = ''
  } catch (err) {
    alert('保存失败: ' + err.message)
  } finally {
    savingEdit.value = false
  }
}

async function removeTrait(trait) {
  if (!confirmFn) {
    if (!confirm(`确定删除「${trait.content}」？`)) return
  } else {
    const ok = await confirmFn(`确定删除「${trait.content}」？`)
    if (!ok) return
  }
  try {
    await deletePortrait(trait.id)
    // 从本地分组中移除
    const group = impressionGrouped.value[trait.trait_type]
    if (group) {
      const idx = group.findIndex(t => t.id === trait.id)
      if (idx !== -1) group.splice(idx, 1)
    }
  } catch (err) {
    alert('删除失败: ' + err.message)
  }
}

// ── 印象添加 ──
const addingKey = ref(null)
const addingContent = ref('')
const savingAdd = ref(false)

function startAdd(key) {
  // 如果正在编辑某条，先取消
  if (editingId.value !== null) cancelEdit()
  addingKey.value = key
  addingContent.value = ''
}
function cancelAdd() {
  addingKey.value = null
  addingContent.value = ''
}
async function saveAdd(key) {
  const trimmed = addingContent.value.trim()
  if (trimmed.length < 2) return
  savingAdd.value = true
  try {
    const row = await addPortrait(chat.activeChar.id, key, trimmed)
    // 添加到本地分组
    if (!impressionGrouped.value[key]) impressionGrouped.value[key] = []
    impressionGrouped.value[key].push(row)
    addingKey.value = null
    addingContent.value = ''
  } catch (err) {
    alert('添加失败: ' + err.message)
  } finally {
    savingAdd.value = false
  }
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay === 1) return '昨天'
  if (diffDay < 7) return `${diffDay}天前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const typeLabel = { appearance: '外貌特征', personality: '性格特征', preference: '偏好习惯' }
const typeIcon = { appearance: '🎨', personality: '🧠', preference: '❤️' }
const typeColor = { appearance: '#e07b6c', personality: '#9b7fd4', preference: '#e05a7a' }

const groupKeys = ['appearance', 'personality', 'preference']

function confidenceLevel(confidence, index = 0) {
  const val = confidence ?? 0.5
  const threshold = (index + 1) / 3
  return val >= threshold ? 'on' : 'off'
}

const avatarPreviewStyle = computed(() => {
  const p = chat.activeChar?.avatar_path
  if (p) return { backgroundImage: `url(${p})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  return { background: '#e07b6c' }
})

const agentAvatarStyle = computed(() => {
const p = chat.activeChar?.avatar_path
if (p) return { backgroundImage: `url(${p})`, backgroundSize: 'cover', backgroundPosition: 'center' }
return { background: '#e07b6c' }
})

const userAvatarStyle = computed(() => {
if (userAvatar.value) return { backgroundImage: `url(${userAvatar.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
return { background: '#e07b6c' }
})

function openSettings() { showSettings.value = true }
function closeSettings() { showSettings.value = false }

function openCharEditor() {
showSettings.value = false
const c = chat.activeChar
if (!c) return
editForm.value = { display_name: c.display_name || '', base_prompt: c.base_prompt || '' }
showEditor.value = true
}
function closeCharEditor() { showEditor.value = false }

async function saveCharEditor() {
if (saving.value) return
saving.value = true
try {
await chat.updateActiveCharacter({ display_name: editForm.value.display_name, base_prompt: editForm.value.base_prompt })
showEditor.value = false
} catch (err) {
console.error('[chat] save character failed:', err)
} finally { saving.value = false }
}

async function clearChatHistory() {
showSettings.value = false
if (clearing.value) return
const ok = await confirmFn({ title:'清空记忆', message:'确定要清空当前角色的所有记忆吗？\n此操作不可恢复。', okText:'清空' })
if (!ok) return
clearing.value = true
try { await chat.clearActiveMessages() } catch {} finally { clearing.value = false }
}

async function deleteChar() {
if (deleting.value || chat.activeChar?.name === 'default') return
showSettings.value = false
const ok = await confirmFn({
title: '删除角色',
message: `确定要删除角色「${chat.activeChar?.display_name}」吗？\n此操作不可恢复。`,
okText: '删除', danger: true,
})
if (!ok) return
deleting.value = true
try { await chat.deleteActiveCharacter() } catch {} finally { deleting.value = false }
}

async function removeAvatar() {
showSettings.value = false
const ok = await confirmFn({ title:'移除头像', message:'确定要移除当前角色的头像吗？', okText:'移除' })
if (!ok) return
await chat.uploadAvatar(null)
}

// ══════════════════════════════════════════════════
// 头像选择器（使用 AvatarCropper 组件）
// ══════════════════════════════════════════════════

const showAvatarPicker = ref(false)
const recentImages = ref([])
const recentLoading = ref(false)

function openAvatarPicker() {
showSettings.value = false
recentImages.value = []
showAvatarPicker.value = true
}

function closeAvatarPicker() {
showAvatarPicker.value = false
}

async function switchToRecent() {
if (recentImages.value.length > 0) return
recentLoading.value = true
try {
const d = await chat.getRecentChatImages()
recentImages.value = d.images || []
} catch {} finally { recentLoading.value = false }
}

async function onAgentAvatarSave(base64) {
await chat.uploadAvatar(base64)
showAvatarPicker.value = false
}

const messageGroups = computed(() => {
const groups = []
for (const msg of chat.visibleMessages) {
const lastGroup = groups[groups.length - 1]
if (lastGroup) {
const lastMsg = lastGroup.msgs[lastGroup.msgs.length - 1]
const diff = Math.abs(new Date(msg.created_at) - new Date(lastMsg.created_at))
if (diff <= 10 * 60 * 1000) {
  lastGroup.msgs.push(msg)
  continue
}
}
const t = timeLabel(msg.created_at)
groups.push({ label: t, msgs: [msg] })
}
return groups
})

// 扁平化列表（时间正序：最旧在上，最新在下）
const flatItems = computed(() => {
const items = []
for (const group of messageGroups.value) {
items.push({ type: 'divider', label: group.label, id: `d-${group.msgs[0]?.id || group.label}` })
for (let mi = 0; mi < group.msgs.length; mi++) {
const msg = group.msgs[mi]
const sameRole = mi > 0 && group.msgs[mi - 1].role === msg.role
items.push({ type: 'message', msg, id: msg.id, sameRole })
}
}
return items
})

function timeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso); const now = new Date(); const diff = now - d
  const hh = d.getHours().toString().padStart(2,'0'); const mm = d.getMinutes().toString().padStart(2,'0')
  const time = hh + ':' + mm
  if (d.toDateString() === now.toDateString()) return time
  const y = new Date(now); y.setDate(y.getDate()-1)
  if (d.toDateString() === y.toDateString()) return '昨天 ' + time
  y.setDate(y.getDate()-1)
  if (d.toDateString() === y.toDateString()) return '前天 ' + time
  if (Math.floor(diff/86400000) < 7 && d.getDay() !== now.getDay()) {
    return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()] + ' ' + time
  }
  return d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()+' '+time
}

// ══════════════════════════════════════════════════
// 滚动管理（正常 column 布局，scrollTop=0 为顶部）
// ══════════════════════════════════════════════════

let userScrolledUp = false
let scrollTimer = null

function onScroll() {
  const el = msgList.value
  if (!el) return
  const distToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  if (distToBottom > 60) {
    userScrolledUp = true
  } else if (distToBottom < 10) {
    userScrolledUp = false
  }
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    if (distToBottom < 60) userScrolledUp = false
  }, 2000)

  // 滚动到顶部 → 展开渲染窗口显示更早消息
  if (el.scrollTop < 40 && chat.hasMoreOlder) {
    const prevHeight = el.scrollHeight
    chat.expandWindow()
    nextTick(() => {
      if (msgList.value) msgList.value.scrollTop += msgList.value.scrollHeight - prevHeight
    })
  }
}

// force=true: 瞬间滚底（切角色/首次加载/发消息/图片加载完毕）
// force=false: 平滑滚动（流式分句，列表高度变化有 0.2s 缓动）
async function scrollToBottom(force = false) {
  await nextTick()
  const el = msgList.value
  if (!el) return
  if (force || !userScrolledUp) {
    if (force) {
      el.scrollTop = el.scrollHeight
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }
}

// ── 生命周期 ──

// 移动端键盘适配：键盘弹起/收起时同步滚动消息列表
// visualViewport.resize 在浏览器原生帧率触发，用 instant scrollTop 与键盘动画同步
let viewportCleanup = null

function setupMobileKeyboard() {
  if (!window.visualViewport || !isMobile) return
  let prevH = window.visualViewport.height
  const onResize = () => {
    const el = msgList.value
    if (!el) return
    const h = window.visualViewport.height
    if (Math.abs(h - prevH) < 10) return
    prevH = h
    userScrolledUp = false
    el.scrollTop = el.scrollHeight
  }
  window.visualViewport.addEventListener('resize', onResize)
  viewportCleanup = () => window.visualViewport.removeEventListener('resize', onResize)
}

function teardownMobileKeyboard() {
  viewportCleanup?.()
  viewportCleanup = null
}

// ResizeObserver：挂载后临时监听内容区高度变化（图片加载撑高），追底后自毁
// 只修复"从其他页面切回时历史图片异步加载导致滚动漂移"，不长期驻留
let resizeObserver = null
let resizeRaf = null
let lastObservedSH = 0
let resizeObserverTimer = null
const RESIZE_OBSERVER_TTL = 2000  // 挂载后最多存活 3s

function setupResizeObserver() {
  const inner = msgListInner.value
  const el = msgList.value
  if (!inner || !el) return
  lastObservedSH = el.scrollHeight
  resizeObserver = new ResizeObserver(() => {
    if (resizeRaf) return
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null
      const el2 = msgList.value
      if (!el2 || pendingCharSwitch || chat.streaming) return
      const newSH = el2.scrollHeight
      if (newSH === lastObservedSH) return
      // 用旧 scrollHeight 算 distBefore，避免 userScrolledUp 被 scroll 事件误判污染
      const distBefore = lastObservedSH - el2.scrollTop - el2.clientHeight
      lastObservedSH = newSH
      if (distBefore > 60) return
      el2.scrollTop = el2.scrollHeight
      userScrolledUp = false
      // 完成一次追底后延迟自毁：给剩余图片 500ms 缓冲，之后卸载
      clearTimeout(resizeObserverTimer)
      resizeObserverTimer = setTimeout(teardownResizeObserver, 500)
    })
  })
  resizeObserver.observe(inner)
  // 兜底：TTL 到期强制自毁，防止意外长驻
  resizeObserverTimer = setTimeout(teardownResizeObserver, RESIZE_OBSERVER_TTL)
}

function teardownResizeObserver() {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = null }
  clearTimeout(resizeObserverTimer)
  resizeObserverTimer = null
  lastObservedSH = 0
}

onMounted(async () => {
  await Promise.all([chat.loadCharacters(), loadUserAvatar(), settings.loadComfyConfig()])
  const targetId = route.params.id ? parseInt(route.params.id) : (chat.characters.length > 0 ? chat.characters[0].id : null)
  if (targetId && targetId !== chat.activeCharId) {
    await chat.selectChar(targetId)
  }
  await nextTick()
  scrollToBottom(true)  // 首次加载强制滚底
  setupResizeObserver()  // 之后由 ResizeObserver 追底（图片加载等异步布局变化）
  if (!isMobile) inputEl.value?.focus()
  setupMobileKeyboard()
  // selectChar 之后拉取实时好感度（避免被 selectChar 清空）
  fetchRealtimeAffinity()
  // 点击页面其他地方关闭撤回气泡
  window.addEventListener('click', dismissUndoBubble)
})

onUnmounted(() => {
  teardownMobileKeyboard()
  teardownResizeObserver()
  window.removeEventListener('click', dismissUndoBubble)
})

// 浏览器前进/后退 → 同步 store
watch(() => route.params.id, (newId) => {
  const id = parseInt(newId)
  if (id && id !== chat.activeCharId) {
    chat.selectChar(id)
  }
})

let pendingCharSwitch = false

// 切角色：停 Observer + 隐藏容器，等消息加载完成后滚底
watch(() => chat.activeCharId, (id, oldId) => {
  if (id && id !== oldId) {
    const routeId = parseInt(route.params.id)
    if (id !== routeId) router.replace('/chat/' + id)
    pendingCharSwitch = true
    userScrolledUp = false
    if (msgList.value) msgList.value.style.visibility = 'hidden'
  }
})

// 新消息到达 → 自动滚底（监听 messages.length，窗口展开不影响）
watch(() => chat.messages.length, (newLen) => {
  if (newLen === 0) return
  if (pendingCharSwitch) {
    // 切角色后消息加载完成：滚底 + 恢复可见
    setTimeout(() => {
      const el = msgList.value
      if (!el) return
      el.scrollTop = el.scrollHeight
      el.style.visibility = ''
      setTimeout(() => {
        const el2 = msgList.value
        if (!el2) return
        el2.scrollTop = el2.scrollHeight
        pendingCharSwitch = false
      }, 150)
    }, 50)
  } else {
    scrollToBottom()  // 流式分句：平滑滚动
  }
})

// 候选词出现时平滑滚底（此时 streaming 已结束，scrollTo 不与气泡插入竞争）
watch(() => chat.guesses, (val) => {
  if (val) { nextTick(() => scrollToBottom()) }
})

function pickGuess(text) {
  if (!text) return
  inputText.value = text
  chat.guesses = null
  inputEl.value?.focus()
}

// ── 长按发送按钮 → 撤回气泡 ──
const showUndoBubble = ref(false)
let pressTimer = null
let longPressFired = false
const sendDisabled = computed(() => !inputText.value.trim() || chat.streaming)

function onSendPressStart() {
  // 流式中不允许长按（正在发送消息），仅输入为空时可以
  if (chat.streaming) return
  if (!chat.messages.length) return
  longPressFired = false
  pressTimer = setTimeout(() => {
    longPressFired = true
    showUndoBubble.value = true
  }, 600)
}

function onSendPressEnd() {
  clearTimeout(pressTimer)
  pressTimer = null
}

function onSendClick() {
  if (longPressFired) {
    // 长按刚触发，忽略本次 click（由 mouseup/touchend 之后的浏览器 click 事件产生）
    longPressFired = false
    return
  }
  if (showUndoBubble.value) {
    // 气泡已显示，点击发送按钮 = 关闭气泡
    showUndoBubble.value = false
    return
  }
  if (sendDisabled.value) return
  send()
}

function dismissUndoBubble(e) {
  // 忽略来自发送按钮区域的点击（由 onSendClick 统一处理）
  if (e && e.target.closest('.send-btn')) return
  showUndoBubble.value = false
}

async function undoLastRound() {
  showUndoBubble.value = false
  const ok = await confirmFn({
    title: '撤回对话',
    message: '确定撤回上一轮对话吗？\n你最后一条消息和角色的回复都会被删除。',
    okText: '撤回',
  })
  if (!ok) return
  try {
    await chat.undoLastRound()
    await scrollToBottom(true)
  } catch (err) {
    console.error('[chat] undo last round failed:', err)
  }
}

async function send() {
  if (sendDisabled.value) return
  const text = inputText.value.trim()
  inputText.value = ''
  userScrolledUp = false  // 用户主动发送 → 强制跟随
  await chat.sendMessage(text, forceImageGen.value)
  await scrollToBottom(true)
}

function renderContent(text) {
  if (!text) return ''
  // <br> 必须在 HTML 转义之前剥离——转义后 < 变成 &lt;，正则无法匹配
  return text.replace(/<br\s*\/?>/gi, '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>')
}
</script>

<style scoped>
.chat-view { flex:1; display:flex; flex-direction:column; height:100vh; height:100dvh; overflow:hidden; background:transparent; }
.empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; }
.empty-icon { font-size:56px; }
.empty-state h2 { font-size:18px; color:var(--text-secondary); font-weight:400; }
.btn-empty-pick {
  margin-top: 12px; padding: 10px 28px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: var(--accent); color: #fff;
  font-size: 15px; font-weight: 500; cursor: pointer;
  transition: all 0.2s ease;
}
.btn-empty-pick:hover { background: var(--accent-hover); box-shadow: 0 4px 18px rgba(224, 123, 108, 0.3); }
.btn-empty-pick:active { transform: scale(0.96); }

/* ── 毛玻璃顶部栏 ── */
.chat-header {
  padding:14px 24px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  display:flex; align-items:center; justify-content:space-between;
}
.chat-title { font-size:16px; font-weight:600; color:var(--text-bright); }

/* ── 移动端返回按钮（← 箭头） ── */
.btn-mobile-back {
  width: 44px; height: 44px; flex-shrink: 0;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.28);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s ease;
  margin-right: 8px;
}
.btn-mobile-back:hover { color: var(--text-bright); border-color: var(--accent); }
.btn-mobile-back:active { transform: scale(0.94); }

.btn-header-settings {
  width:32px; height:32px; border-radius:10px;
  border:1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.28);
  color:var(--text-secondary); font-size:16px; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
  transition: all 0.2s ease;
}
.btn-header-settings:hover { color:var(--text-bright); border-color:var(--accent); }

.message-list {
  flex:1; overflow-y:auto; padding:16px 24px;
  background: transparent;
}

.msg-list-inner {
  display:flex; flex-direction:column; gap:4px;
}

.load-older { text-align:center; padding:8px 0; font-size:12px; color:var(--text-secondary); user-select:none; }
.load-older-hint { opacity:0.6; }

.time-divider { text-align:center; padding:16px 0 8px; font-size:12px; color:var(--text-secondary); user-select:none; }

/* ── 消息气泡保持不变 ── */
.message { display:flex; margin:3px 0; align-items:flex-end; gap:8px; }
.message.user { flex-direction:row-reverse; }
.message.assistant { flex-direction:row; }

.msg-avatar {
  width:42px; height:42px; border-radius:50%; flex-shrink:0;
  background-size:cover; background-position:center;
  display:flex; align-items:center; justify-content:center;
  transition: opacity 0.15s;
}
.msg-avatar.clickable {
  cursor: pointer;
}
.msg-avatar.clickable:hover {
  opacity: 0.85;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.4);
}
.msg-same-role .msg-avatar { opacity: 0; pointer-events: none; }
.avatar-fallback { color:#fff; font-size:14px; font-weight:700; user-select:none; }

.msg-bubble {
  max-width:75%; padding:10px 14px; border-radius:8px;
  font-size:14px; line-height:1.6; word-break:break-word;
}
.message.user .msg-bubble { background:#a25740; color:#e8e8e8; }
.message.assistant .msg-bubble { background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border); }

/* 打字指示器：6 个圆点依次变色的 wave 动画 */
.typing-dots { overflow: visible; flex-shrink: 0; }
.typing-dots .dot {
  fill: #fff; animation: dotBlink 1.2s ease-in-out infinite;
}
.typing-dots .dot-0 { animation-delay: 0.00s; }
.typing-dots .dot-1 { animation-delay: 0.10s; }
.typing-dots .dot-2 { animation-delay: 0.20s; }
.typing-dots .dot-3 { animation-delay: 0.30s; }
.typing-dots .dot-4 { animation-delay: 0.40s; }
.typing-dots .dot-5 { animation-delay: 0.50s; }

@keyframes dotBlink {
  0%, 20%, 100% { fill: #fff; }
  40%, 60% { fill: #aaa; }
}

.msg-text { font-size:14px; line-height:1.6; }
.msg-text :deep(code) { background:rgba(0,0,0,0.2); padding:2px 6px; border-radius:4px; font-size:13px; }
.msg-text :deep(strong) { font-weight:600; }

/* ── 强制生图开关 ── */
.force-img-wrap {
  position: relative;
}
.force-img-toggle {
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; flex-shrink: 0;
  border-radius: 12px; cursor: pointer;
  background: rgba(255, 255, 255, 0.7);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  transition: all 0.25s ease;
  opacity: 0.5;
}
.force-img-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.force-img-icon { font-size: 18px; line-height: 1; transition: transform 0.25s ease; }
.force-img-toggle:hover { opacity: 0.8; border-color: rgba(224, 123, 108, 0.3); }
.force-img-toggle.active {
  opacity: 1;
  background: linear-gradient(135deg, rgba(224, 123, 108, 0.15) 0%, rgba(208, 110, 94, 0.15) 100%);
  border-color: var(--accent-light);
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12), 0 0 16px rgba(224, 123, 108, 0.08);
}
.force-img-toggle.active .force-img-icon { transform: scale(1.1); }

.force-img-tip {
  position: absolute;
  bottom: calc(100% + 18px);
  left: calc(50% + 10px);
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 6px 14px;
  font-size: 12px; font-weight: 500;
  color: var(--text-bright);
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  pointer-events: none;
}
.force-img-tip.is-mobile {
  left: calc(50% + 20px);
}

/* ── 回复候选词（AI 猜想用户回复）── */
.guesses-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 24px 8px;
  flex-wrap: wrap;
}
/* 候选词进入/离开：仅 opacity 过渡，不触发布局合成层竞争 */
.guesses-fade-enter-active,
.guesses-fade-leave-active {
  transition: opacity 0.2s ease;
}
.guesses-fade-enter-from,
.guesses-fade-leave-to {
  opacity: 0;
}
.guess-prefix {
  font-size: 13px;
  flex-shrink: 0;
}
.guess-pill {
  padding: 6px 14px;
  font-size: 13px; line-height: 1.4;
  border-radius: 18px;
  border: 1.5px solid var(--glass-border);
  background: var(--glass-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: var(--text-primary);
  cursor: pointer;
  white-space: normal; word-break: break-word;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.guess-pill:hover {
  border-color: var(--accent-light);
  background: rgba(224, 123, 108, 0.08);
  transform: translateY(-1px);
  box-shadow: 0 2px 10px rgba(224, 123, 108, 0.12);
}
.guess-pill:active {
  transform: scale(0.96);
}

/* ── 毛玻璃输入区 ── */
.input-area {
  padding:8px 24px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--glass-border);
  display:flex; gap:10px; align-items:flex-end;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.chat-input {
  flex:1; min-height:40px; max-height:120px; padding:10px 14px; font-size:14px;
  background: rgba(255, 255, 255, 0.9);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: 14px; color:var(--text-bright); outline:none; resize:none;
  overflow: hidden; caret-color: var(--accent);
  transition: border-color 0.2s ease, box-shadow 0.3s ease, background 0.2s ease;
}
.chat-input::placeholder { color: var(--text-secondary); opacity: 0.5; }
.chat-input:hover { border-color: rgba(224, 123, 108, 0.35); }
.chat-input:focus {
  background: rgba(255, 255, 255, 0.9);
  border-color: var(--accent-light);
  box-shadow:
    0 0 0 4px rgba(224, 123, 108, 0.10),
    0 0 24px rgba(224, 123, 108, 0.08),
    inset 0 0 10px rgba(224, 123, 108, 0.04);
}

/* ── 送礼按钮：圆形 + 振动 + 花样式 ── */
.gift-btn {
  width: 42px; height: 42px; flex-shrink: 0;
  border-radius: 50%;
  font-size: 0;
  background: linear-gradient(135deg, #f9c270 0%, #e07b6c 100%);
  color: #fff;
  border: none; padding: 0;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(249, 194, 112, 0.25);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex; align-items: center; justify-content: center;
}
.gift-btn-icon { font-size: 20px; transition: transform 0.2s ease; }
.gift-btn:hover { transform: scale(1.08); box-shadow: 0 4px 16px rgba(249, 194, 112, 0.35); }
.gift-btn:hover .gift-btn-icon { transform: rotate(12deg) scale(1.1); }
.gift-btn:active { transform: scale(0.94); }

/* ── 发送按钮：圆形 + 渐变 + 发光 + 启停缓动 ── */
.send-btn {
  width: 42px; height: 42px; flex-shrink: 0;
  border-radius: 50%;
  font-size: 0;
  background: linear-gradient(135deg, var(--accent) 0%, #d06e5e 100%);
  color: #fff;
  border: none; padding: 0;
  opacity: 1; cursor: pointer;
  box-shadow:
    0 2px 8px rgba(224, 123, 108, 0.22),
    0 0 0 0 rgba(224, 123, 108, 0);
  transition:
    opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.35s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
/* 发送图标 */
.send-icon { width: 18px; height: 18px; display: block; transition: transform 0.2s ease; }
.send-icon.sending circle { animation: dotPulse 1s ease-in-out infinite; }
.send-icon.sending circle:nth-child(2) { animation-delay: 0.15s; }
.send-icon.sending circle:nth-child(3) { animation-delay: 0.3s; }
@keyframes dotPulse { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }

/* 脉冲波纹 */
.send-btn::after {
  content: '';
  position: absolute; inset: -4px;
  border-radius: 50%;
  border: 2px solid rgba(224, 123, 108, 0.25);
  opacity: 0;
  transition: opacity 0.3s ease, inset 0.3s ease;
}
.send-btn:not(.send-disabled):hover {
  box-shadow:
    0 4px 18px rgba(224, 123, 108, 0.35),
    0 0 32px rgba(224, 123, 108, 0.10);
  transform: scale(1.06);
}
.send-btn:not(:disabled):hover .send-icon { transform: translateX(1.5px); }
.send-btn:not(:disabled):hover::after {
  opacity: 1;
  inset: -8px;
}
.send-btn:not(:disabled):active {
  transform: scale(0.94);
  box-shadow: 0 1px 4px rgba(224, 123, 108, 0.2);
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}
/* 禁用态 — 渐变保留仅降透明度 + 收光，靠 transition 实现 0.35s 缓入缓出 */
.send-btn.send-disabled {
  opacity: 0.35;
  box-shadow: none;
}

/* ── 长按撤回气泡 ── */
.undo-bubble-btn {
  position: absolute;
  right: 5px;
  bottom: 72px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-bright);
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.10), 0 1px 4px rgba(0, 0, 0, 0.04);
  z-index: 10;
  transition: background 0.2s ease, transform 0.15s ease;
}
.undo-bubble-btn:hover {
  background: rgba(255, 255, 255, 1);
  transform: translateY(-1px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.13), 0 2px 8px rgba(0, 0, 0, 0.06);
}
.undo-bubble-btn:active {
  transform: scale(0.96);
}

.undo-bubble-enter-active { transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
.undo-bubble-leave-active { transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1); }
.undo-bubble-enter-from { opacity: 0; transform: translateY(8px) scale(0.92); }
.undo-bubble-leave-to   { opacity: 0; transform: translateY(8px) scale(0.92); }

/* ── 毛玻璃角色设置面板 ── */
.settings-overlay { position:fixed; inset:0; background:transparent; display:flex; align-items:flex-start; justify-content:flex-end; z-index:1000; padding:60px 24px 0 0; }
.settings-panel {
  width:280px;
  background: rgba(255, 255, 255, 0.95);
  border-radius:16px;
  border:1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 8px 32px rgba(0,0,0,0.14);
  overflow:hidden;
}

/* 设置面板滑入动画 */
.panel-slide-enter-active { transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.panel-slide-leave-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.panel-slide-enter-from { opacity:0; transform: translateX(16px); }
.panel-slide-leave-to   { opacity:0; transform: translateX(16px); }
.sph { padding:14px 16px; border-bottom:1px solid rgba(255, 255, 255, 0.2); display:flex; align-items:center; justify-content:space-between; }
.sph span { font-size:14px; font-weight:600; color:var(--text-bright); }
.settings-close { width:28px; height:28px; border-radius:8px; border:none; background:transparent; color:var(--text-secondary); font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all 0.15s; }
.settings-close:hover { color:var(--text-bright); background:rgba(0,0,0,0.06); }

.sp-section { padding:14px 16px; }
.sp-label { font-size:12px; color:var(--text-secondary); display:block; margin-bottom:10px; }
.avatar-row { display:flex; align-items:center; gap:14px; }
.avatar-preview { width:48px; height:48px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px; font-weight:700; flex-shrink:0; }
.color-dot { width:22px; height:22px; border-radius:50%; border:2px solid transparent; cursor:pointer; padding:0; transition: border-color 0.15s, transform 0.15s; }
.color-dot:hover { transform:scale(1.15); }
.color-dot.active { border-color:var(--accent); transform:scale(1.15); }
.color-native { width:22px; height:22px; border:none; border-radius:50%; cursor:pointer; padding:0; background:transparent; }
.color-native::-webkit-color-swatch-wrapper { padding:0; }
.color-native::-webkit-color-swatch { border-radius:50%; border:none; }

.sp-divider { height:1px; background:rgba(255, 255, 255, 0.2); margin:0 16px; }
.sp-divider-strong { height:2px; background:rgb(219 219 219 / 38%); margin:6px 16px; }
.sp-btn { display:block; width:100%; text-align:left; padding:12px 16px; border:none; border-radius:0; background:transparent; color:var(--text-primary); font-size:13px; cursor:pointer; transition:background 0.15s ease; }
.sp-btn:hover { background:rgba(255, 255, 255, 0.2); }
.sp-btn:disabled { opacity:0.4; cursor:not-allowed; }
.sp-btn-danger { color:var(--danger); }
.sp-btn-danger:hover:not(:disabled) { background:rgba(255, 77, 79, 0.06); }
.sp-btn-icon { width:16px; height:16px; vertical-align:middle; margin-right:6px; display:inline-block; }

/* ── 毛玻璃编辑弹窗 ── */
.editor-overlay { position:fixed; inset:0; background:transparent; display:flex; align-items:center; justify-content:center; z-index:1001; }
.editor-panel {
  width:768px; max-height:90vh; height:80vh;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius:16px;
  border:1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 12px 48px rgba(0,0,0,0.1);
  display:flex; flex-direction:column; overflow:hidden;
}

/* 编辑弹窗淡入缩放 */
.editor-fade-enter-active { transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.editor-fade-leave-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.editor-fade-enter-from { opacity:0; transform: scale(0.95); }
.editor-fade-leave-to   { opacity:0; transform: scale(0.95); }
.editor-header { padding:16px 20px; border-bottom:1px solid rgba(255, 255, 255, 0.22); display:flex; align-items:center; justify-content:space-between; }
.editor-header span { font-size:15px; font-weight:600; color:var(--text-bright); }
.editor-close { width:32px; height:32px; border-radius:8px; border:none; background:transparent; color:var(--text-secondary); font-size:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all 0.15s; }
.editor-close:hover { color:var(--text-bright); background:var(--bg-hover); }
.editor-field { padding:12px 20px 0; display:flex; flex-direction:column; gap:6px; }
.editor-field label { font-size:13px; color:var(--text-secondary); }
.editor-input { padding:8px 12px; font-size:14px; background:rgba(255,255,255,0.9); border:1px solid #d5d0ca; border-radius:8px; color:var(--text-bright); outline:none; transition: border-color 0.15s; }
.editor-input:focus { border-color:var(--accent); }
.editor-textarea { padding:10px 12px; font-size:13px; line-height:1.6; background:rgba(255,255,255,0.9); border:1px solid #d5d0ca; border-radius:8px; color:var(--text-bright); outline:none; resize:vertical; font-family:inherit; }
.editor-textarea:focus { border-color:var(--accent); }
.editor-field-grow { flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column; }
.editor-field-grow .editor-textarea { flex:1; min-height:120px; resize:none; overflow-y:auto; }
.editor-actions { padding:16px 20px; border-top:1px solid rgba(255, 255, 255, 0.22); display:flex; justify-content:flex-end; align-items:center; }
.editor-actions-right { display:flex; gap:10px; }
.btn-cancel { padding:8px 18px; border-radius:8px; border:1px solid rgba(255, 255, 255, 0.22); background:rgba(255, 255, 255, 0.28); color:var(--text-primary); font-size:13px; cursor:pointer; transition: all 0.15s; }
.btn-cancel:hover { background:var(--bg-hover); }
.btn-danger { padding:8px 18px; border-radius:8px; border:1px solid var(--danger); background:transparent; color:var(--danger); font-size:13px; cursor:pointer; transition: all 0.15s; }
.btn-danger:hover { background:var(--danger); color:#fff; }
.btn-danger:disabled { opacity:0.5; cursor:not-allowed; }

.avatar-preview.clickable { cursor:pointer; transition: opacity 0.15s; }
.avatar-preview.clickable:hover { opacity:0.85; }
.sp-btn-small { padding:6px 14px; font-size:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.25); background:rgba(255,255,255,0.28); color:var(--text-primary); cursor:pointer; margin-right:6px; transition: all 0.15s; }
.sp-btn-small:hover { border-color:var(--accent); }
.sp-btn-subtle { color:var(--text-secondary); border-color:transparent; background:transparent; }
.sp-btn-subtle:hover { color:var(--danger); border-color:transparent; }

/* ── 移动端空间优化 ── */
@media (max-width: 767px) {
  .chat-header { padding: 12px 16px; }
  .message-list { padding: 5px 10px; }
  .guesses-row { padding: 2px 10px 6px; gap: 4px; flex-wrap: nowrap; }
  .guess-prefix { display: none; }
  .guess-pill { padding: 4px 10px; font-size: 12px; max-width: 50%; min-width: 60px; flex: 1; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
  .input-area { padding: 8px 16px; padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }

  /* 手机端编辑弹窗全屏 */
  .editor-overlay { background: rgba(0,0,0,0.3); }
  .editor-panel {
    width:100vw; max-width:100vw;
    height:100vh; height:100dvh; max-height:100vh; max-height:100dvh;
    border-radius:0; border:none;
  }
  .editor-header { padding-top: calc(16px + env(safe-area-inset-top, 0px)); }
  .editor-actions { padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
}

/* ── 印象弹窗 ── */
.impression-panel {
  max-width: 720px;
  max-height: 68vh;
  height: auto;
  display: flex;
  flex-direction: column;
}
.impression-body {
  overflow-y: auto;
  flex: 1;
  padding: 0;
}

/* 状态 */
.impression-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  color: #888;
  font-size: 14px;
  gap: 12px;
}
.impression-loading-spinner {
  width: 28px; height: 28px;
  border: 3px solid rgba(0,0,0,0.08);
  border-top-color: var(--accent, #e07b6c);
  border-radius: 50%;
  animation: impression-spin 0.7s linear infinite;
}
@keyframes impression-spin { to { transform: rotate(360deg); } }
.impression-error-state { color: #e55; }
.impression-error-icon { font-size: 24px; }
.impression-empty-icon { font-size: 40px; opacity: 0.5; }
.impression-empty-text { font-size: 15px; color: var(--text-secondary); font-weight: 500; }
.impression-empty-hint { font-size: 13px; color: #aaa; }

/* 分组 */
.impression-group { margin-bottom: 16px; }
.impression-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 2px;
}
.impression-group-badge {
  width: 26px; height: 26px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}
.impression-group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.impression-group-count {
  font-size: 11px;
  color: #979797;
  background: rgba(0,0,0,0.04);
  border-radius: 10px;
  padding: 0 7px;
  line-height: 18px;
  margin-left: auto;
}
.impression-add-btn {
  width: 24px; height: 24px;
  padding: 0;
  border-radius: 7px;
  border: 1px dashed currentColor;
  background: transparent;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
  transition: opacity 0.15s;
  margin-left: 4px;
}
.impression-add-btn:hover { opacity: 1; }

/* 空组占位 */
.impression-empty-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  border: 1.5px dashed rgba(0,0,0,0.08);
  border-radius: 10px;
  background: rgba(255,255,255,0.3);
}
.impression-empty-row-text {
  font-size: 13px;
  color: #bbb;
}
.impression-add-link {
  font-size: 13px;
  font-weight: 500;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 5px;
  transition: background 0.15s;
  text-decoration: none;
}
.impression-add-link:hover {
  background: rgba(0,0,0,0.04);
}

/* 卡片列表 */
.impression-card-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 卡片 */
.impression-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.65);
  border-radius: 10px;
  border-left: 3px solid var(--tint, #ccc);
  transition: all 0.2s ease;
  position: relative;
}
.impression-card:hover {
  background: rgba(255,255,255,0.9);
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.impression-card-editing {
  flex-direction: column;
  background: rgba(255,255,255,0.92);
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}

.impression-card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.impression-card-text {
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  word-break: break-word;
}
.impression-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 置信度圆点 */
.impression-card-confidence {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}
.impression-card-confidence .dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  transition: background 0.2s;
}
.impression-card-confidence .dot.on {
  background: var(--tint, #ccc);
  opacity: 0.8;
}
.impression-card-confidence .dot.off {
  background: rgba(0,0,0,0.08);
}

.impression-card-time {
  font-size: 11px;
  color: #bbb;
  margin-left: auto;
}

/* 操作按钮 */
.impression-card-actions {
  display: flex;
  gap: 2px;
  opacity: 0.55;
  transition: opacity 0.18s ease;
  flex-shrink: 0;
  padding-top: 2px;
}
.impression-card:hover .impression-card-actions {
  opacity: 1;
}
@media (max-width: 767px) {
  .impression-card-actions { opacity: 1; }
}
.impression-action-btn {
  width: 28px; height: 28px;
  padding: 0;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.impression-action-btn:hover {
  background: rgba(0,0,0,0.06);
  color: var(--text-bright);
}
.impression-action-btn-danger:hover {
  background: rgba(255,77,79,0.1);
  color: var(--danger, #e55);
}

/* 编辑模式 */
.impression-edit-textarea {
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  border: 1.5px solid #d5d0ca;
  border-radius: 8px;
  background: white;
  color: var(--text-bright);
  outline: none;
  resize: vertical;
  font-family: inherit;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.impression-edit-textarea:focus {
  box-shadow: 0 0 0 3px rgba(224,123,108,0.12);
}
.impression-edit-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
.impression-btn {
  padding: 6px 14px;
  border-radius: 7px;
  border: 1px solid transparent;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.impression-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.impression-btn-cancel {
  border-color: rgba(0,0,0,0.12);
  background: transparent;
  color: var(--text-secondary);
}
.impression-btn-cancel:hover { background: rgba(0,0,0,0.04); }
.impression-btn-save {
  color: white;
  border: none;
}
.impression-btn-save:hover { filter: brightness(1.08); }

@media (max-width: 767px) {
  .impression-panel {
    width: 100vw; max-width: 100vw;
    height: 100vh; height: 100dvh;
    max-height: 100vh; max-height: 100dvh;
    border-radius: 0; border: none;
  }
  .impression-card { padding: 8px 10px; }
  .impression-content { flex-direction: column; }
  .impression-right { width: 100% !important; border-left: none; border-top: 1px solid rgba(0,0,0,0.06); padding: 14px 0 0; min-width: 0; }
}

/* ── 印象双栏布局 ── */
.impression-content {
  display: flex;
  gap: 0;
  flex: 1;
  min-height: 0;
}
.impression-left {
  flex: 1;
  min-width: 0;
  padding: 8px 20px 16px;
  overflow-y: auto;
}
.impression-right {
  width: 240px;
  min-width: 240px;
  border-left: 1px solid rgba(0,0,0,0.06);
  padding: 8px 18px 16px;
  overflow-y: auto;
  background: rgba(0,0,0,0.015);
}

/* ── VAD 条形图 ── */
.vad-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.vad-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 0;
  font-size: 13px;
  color: #aaa;
}
.vad-empty-hint {
  font-size: 11px;
  color: #ccc;
}
.vad-bar-group {
  margin-bottom: 10px;
}
.vad-bar-label {
  font-size: 11px;
  font-weight: 600;
  color: #888;
  margin-bottom: 3px;
}
.vad-bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.vad-bar-end {
  font-size: 10px;
  color: #bbb;
  white-space: nowrap;
  min-width: 28px;
  line-height: 1;
}
.vad-bar-end-left { text-align: right; }
.vad-bar-end-right { text-align: left; }
.vad-bar-track {
  flex: 1;
  height: 6px;
  background: rgba(0,0,0,0.06);
  border-radius: 3px;
  position: relative;
  overflow: visible;
}
.vad-bar-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: linear-gradient(90deg, #6366f1, #a78bfa, #e07b6c);
  border-radius: 3px;
  transition: width 0.4s ease;
}
.vad-bar-dot {
  position: absolute;
  top: 50%; transform: translate(-50%, -50%);
  width: 10px; height: 10px;
  background: white;
  border: 2px solid #6366f1;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
}

/* ── 主导情绪 ── */
.vad-dominant {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 10px;
  padding: 8px 10px;
  background: rgba(99,102,241,0.06);
  border-radius: 8px;
}
.vad-dominant-label {
  font-size: 11px;
  color: #888;
}
.vad-dominant-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.vad-emotion-tag {
  font-size: 12px;
  font-weight: 600;
  color: #6366f1;
  background: rgba(99,102,241,0.08);
  padding: 2px 10px;
  border-radius: 10px;
  white-space: nowrap;
}

/* ── 好感度 ── */
.affinity-section {
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid rgba(0,0,0,0.05);
}
.affinity-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.affinity-label {
  font-size: 12px;
  font-weight: 600;
  color: #888;
}
.affinity-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-bright);
  font-variant-numeric: tabular-nums;
}
.affinity-tag {
  font-size: 11px;
  color: #e07b6c;
  background: rgba(224,123,108,0.08);
  padding: 1px 8px;
  border-radius: 10px;
  margin-left: auto;
}
/* ── 好感度爱心 ── */
.affinity-hearts {
  display: flex;
  gap: 4px;
  justify-content: center;
}
.affinity-heart {
  width: 36px;
  height: 34px;
  position: relative;
  transition: transform 0.2s ease;
}
.affinity-heart.filled {
  transform: scale(1.06);
}
.affinity-heart .heart-svg {
  width: 100%;
  height: 100%;
}
.affinity-heart .heart-bg {
  fill: none;
  stroke: rgba(0,0,0,0.12);
  stroke-width: 1.2;
}
.affinity-heart .heart-fg {
  fill: #e05a7a;
}
.affinity-heart.filled .heart-fg {
  fill: #e0245e;
}
.affinity-heart.half .heart-fg {
  fill: #f0889e;
}

/* ── 好感度最近变化 ── */
.affinity-change {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(0,0,0,0.05);
}
.affinity-change-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.affinity-change-label {
  font-size: 11px;
  color: #999;
}
.affinity-change-delta {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.affinity-change-delta.delta-up { color: #e05a7a; }
.affinity-change-delta.delta-down { color: #6366f1; }
.affinity-change-reason {
  margin-top: 4px;
  font-size: 11px;
  color: #aaa;
  line-height: 1.5;
  font-style: italic;
}

/* ── 实时显示开关 ── */
.affinity-realtime-toggle {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 0 4px; margin-top: 4px;
  border-top: 1px solid rgba(0,0,0,0.05);
}
.affinity-realtime-label { font-size: 12px; color: #888; font-weight: 500; }

/* ── Header 实时好感度 ── */
.chat-header-center { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.header-affinity { font-size: 14px; font-weight: 600; color: #e0245e; white-space: nowrap;display: flex;align-items: center; }
.affinity-heart-icon { vertical-align: middle; margin-right: 1px; flex-shrink: 0; }
.header-affinity-delta { font-size: 11px; font-weight: 500; margin-left: 4px; }
.header-affinity-delta.delta-up { color: #e0245e; }
.header-affinity-delta.delta-down { color: #4a90d9; }
.chat-header-right { display: flex; align-items: center; gap: 10px; }
.header-reason {
  font-size: 11px; color: #999; font-style: italic;
  white-space: nowrap;
}

/* ── delta / reason roll 动画容器 ── */
.affinity-delta-wrap,
.affinity-reason-wrap { position: relative; display: inline-block; vertical-align: bottom; }

/* ── roll Transition ── */
.roll-enter-active { animation: roll-in 0.2s ease; }
.roll-leave-active  { animation: roll-out 0.2s ease; position: absolute; left: 0; top: 0; }
@keyframes roll-out { from { transform: translateY(0);    opacity: 1; } to { transform: translateY(-120%); opacity: 0; } }
@keyframes roll-in  { from { transform: translateY(120%); opacity: 0; } to { transform: translateY(0);     opacity: 1; } }
@media (max-width: 768px) {
  .header-affinity { font-size: 12px; }
  .header-affinity-delta { font-size: 10px; }
  .chat-header-right { max-width: 40vw; }
  .affinity-reason-wrap { min-width: 0; overflow: hidden; }
  .header-reason {
    display: block;
    max-width: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .btn-header-settings { flex-shrink: 0; }
}

</style>

<style>
/* ── 印象弹窗内的实时显示开关缩小版 ── */
.affinity-realtime-toggle .switch {
  width: 32px;
  height: 18px;
}
.affinity-realtime-toggle .slider {
  border-radius: 18px;
}
.affinity-realtime-toggle .slider::before {
  height: 14px;
  width: 14px;
  left: 2px;
  bottom: 2px;
}
.affinity-realtime-toggle .switch input:checked + .slider::before {
  transform: translateX(14px);
}
</style>
