<template>
  <Teleport to="body">
    <Transition name="admin-slide">
    <div v-if="open" v-show="!deliveriesOpen" class="admin-mask" @click.self="$emit('close')">
      <div class="admin-panel" role="dialog" aria-label="小镇管理">
        <div class="ap-head">
          <linshe-button v-if="detail" variant="ghost" size="sm" @click="detail = null">← 返回</linshe-button>
          <span class="ap-title">{{ detail ? (detail.type === 'npc' ? detailName : detailName) : '小镇管理' }}</span>
          <linshe-button v-if="!detail" variant="icon" size="sm" aria-label="关闭" @click="$emit('close')">✕</linshe-button>
          <linshe-button v-else variant="icon" size="sm" aria-label="关闭" @click="$emit('close')">✕</linshe-button>
        </div>

        <div v-if="!detail" class="ap-tabs">
          <linshe-button variant="chip" size="sm" :active="tab === 'npcs'" @click="tab = 'npcs'">居民</linshe-button>
          <linshe-button variant="chip" size="sm" :active="tab === 'chars'" @click="tab = 'chars'">角色素材</linshe-button>
          <linshe-button variant="chip" size="sm" :active="tab === 'settings'" @click="tab = 'settings'">设置</linshe-button>
        </div>

        <!-- ── 居民列表 ── -->
        <div v-if="!detail && tab === 'npcs'" class="ap-body">
          <div class="ap-row" role="button" tabindex="0" @click="detail = { type: 'player' }" @keydown.enter="detail = { type: 'player' }">
            <div class="ap-row-thumb is-portrait">
              <img v-if="playerKit.portrait?.status === 'ready'" :src="playerKit.portrait.image_path + '?v=' + (playerKit.portrait.meta?.updatedAt ?? 0)" alt="">
              <img v-else-if="playerKit.sprites?.down?.status === 'ready'" :src="playerKit.sprites.down.image_path" alt="">
              <span v-else class="ap-thumb-missing">·</span>
            </div>
            <div class="ap-npc-info">
              <div class="ap-npc-name">我（玩家）</div>
              <div class="ap-npc-meta">确认我的立绘与像素小人形象</div>
            </div>
            <span class="ap-row-arrow">›</span>
          </div>
          <div class="ap-actions">
            <linshe-button variant="secondary" size="sm" :loading="batchSprites" @click="generateAllMissingNpcSprites">
              一键补齐缺失精灵
            </linshe-button>
          </div>
          <div v-if="npcs.length === 0" class="ap-empty">镇上还没有居民，先完成世界初始化吧。</div>
          <div
            v-for="npc in npcs" :key="npc.id"
            class="ap-row" role="button" tabindex="0"
            @click="detail = { type: 'npc', id: npc.id }"
            @keydown.enter="detail = { type: 'npc', id: npc.id }"
          >
            <div class="ap-row-thumb is-portrait">
              <img v-if="npc.portrait?.status === 'ready'" :src="npc.portrait.image_path + '?v=' + (npc.portrait.meta?.updatedAt ?? 0)" alt="">
              <img v-else-if="npc.sprites?.down?.status === 'ready'" :src="npc.sprites.down.image_path" alt="">
              <span v-else class="ap-thumb-missing">·</span>
            </div>
            <div class="ap-npc-info">
              <div class="ap-npc-name">
                {{ npc.displayName }}
                <span v-if="npc.job" class="ap-npc-job">{{ npc.job }}</span>
              </div>
              <div class="ap-npc-meta">
                {{ npc.townEnabled ? (npc.sleepingHint || '在镇上活动') : '已暂停' }} · 精灵 {{ spriteCount(npc) }}/2
                <template v-if="npc.characterId"> · 已入邻舍</template>
                <template v-else> · 未邀请</template>
              </div>
              <p v-if="npc.portrait?.status === 'ready' || npc.sprites?.down?.status === 'ready'" class="ap-asset-appearance">{{ appearanceText(npc.portrait?.status === 'ready' ? npc.portrait.appearanceStatus : npc.sprites.down.appearanceStatus) }}</p>
            </div>
            <span class="ap-row-arrow">›</span>
          </div>

          <div class="ap-add">
            <div class="ap-add-title">新增居民</div>
            <div class="ap-add-grid">
              <linshe-input v-model="newNpc.name" size="sm" placeholder="名字" />
              <linshe-input v-model="newNpc.job" size="sm" placeholder="职业（如 面包师）" />
            </div>
            <linshe-input v-model="newNpc.persona" type="textarea" :rows="2" size="sm" placeholder="一句话人设（可选，AI 也会帮你补）" />
            <linshe-button variant="secondary" size="sm" :disabled="!newNpc.name.trim()" :loading="adding" @click="addNpc">
              加入小镇
            </linshe-button>
          </div>
        </div>

        <!-- ── NPC 详情页 ── -->
        <div v-if="detail && detail.type === 'npc'" class="ap-body">
          <div v-if="detailNpc" class="ap-detail">
            <div class="ap-detail-media">
              <div class="ap-portrait-box">
                <TownAssetThumb
                  v-if="detailNpc.portrait?.status === 'ready'"
                  class="ap-portrait-thumb"
                  :asset="detailNpc.portrait"
                  :show-name="false"
                  @edit="openAssetManager(detailNpc.portrait, `${detailNpc.displayName} 立绘`)"
                />
                <span v-else class="ap-thumb-missing is-big">还没有立绘</span>
              </div>
              <p v-if="detailNpc.portrait?.status === 'ready'" class="ap-asset-appearance" aria-label="立绘外观状态">{{ appearanceText(detailNpc.portrait.appearanceStatus) }}</p>
              <div v-if="!detailNpc.portrait?.id" class="ap-btn-row">
                <linshe-button variant="secondary" size="sm" :loading="busyFlags[`portrait${detailNpc.id}`]" @click="makePortrait(detailNpc)">
                  生成 900×1600 立绘
                </linshe-button>
              </div>
            </div>

            <div class="ap-detail-name">
              {{ detailNpc.displayName }}
              <span v-if="detailNpc.job" class="ap-npc-job">{{ detailNpc.job }}</span>
              <linshe-switch
                class="ap-detail-switch"
                v-model="detailNpc.townEnabled"
                size="sm"
                :aria-label="`${detailNpc.displayName} 启停`"
                @change="v => toggleNpc(detailNpc, v)"
              />
            </div>

            <div class="ap-section">
              <div class="ap-section-title">像素小人（正面 / 背面）· 点小图可管理图片</div>
              <div class="ap-sprite-row ap-appearance-row">
                <div v-for="dir in ['down', 'up']" :key="dir" class="ap-sprite-wrap">
                  <TownAssetThumb
                    v-if="detailNpc.sprites?.[dir]?.status === 'ready'"
                    class="ap-sprite"
                    :asset="detailNpc.sprites[dir]"
                    :show-name="false"
                    @edit="openAssetManager(detailNpc.sprites[dir], `${detailNpc.displayName} ${dir === 'down' ? '正面' : '背面'}小人`)"
                  />
                  <div v-else class="ap-sprite"><span class="ap-sprite-missing">·</span></div>
                  <p v-if="detailNpc.sprites?.[dir]?.status === 'ready'" class="ap-asset-appearance" :aria-label="`${dir === 'down' ? '正面' : '背面'}小人外观状态`">{{ appearanceText(detailNpc.sprites[dir].appearanceStatus) }}</p>
                </div>
                <div v-if="!detailNpc.sprites?.down?.id || !detailNpc.sprites?.up?.id" class="ap-btn-row">
                  <linshe-button variant="secondary" size="sm" :loading="busyFlags[`sprites${detailNpc.id}`]" @click="regenSprites(detailNpc)">
                    生成缺失小人
                  </linshe-button>
                </div>
              </div>
              <div v-if="npcSpritesStale(detailNpc)" class="ap-actions is-column">
                <linshe-button variant="secondary" size="sm" :loading="busyFlags[`sprites${detailNpc.id}`]" @click="regenSprites(detailNpc, true)">按当前外观更新小人</linshe-button>
                <p class="ap-asset-appearance">会重绘未记录版本或外观过时的小人</p>
              </div>
              <div v-if="spriteErrors[`npc:${detailNpc.id}`]" class="ap-actions is-column">
                <p class="ap-sprite-error" role="alert">{{ spriteErrors[`npc:${detailNpc.id}`] }}</p>
                <linshe-button variant="link" size="sm" @click="loadNpcs">重新读取素材状态</linshe-button>
              </div>
            </div>

            <div class="ap-section">
              <div class="ap-section-title">人设</div>
              <p class="ap-persona">{{ detailNpc.persona || '（还没有人设）' }}</p>
            </div>

            <div class="ap-section">
              <div class="ap-section-title">作息（本地自动执行）</div>
              <div v-if="(detailNpc.routine || []).length === 0" class="ap-empty is-small">还没有作息，重掷一次人设即可生成。</div>
              <div v-for="(slot, i) in detailNpc.routine" :key="i" class="ap-routine-row">
                <span class="ap-routine-time">{{ slot.start }}~{{ slot.end }}</span>
                <span class="ap-routine-act">{{ slot.activity }}</span>
              </div>
            </div>

            <div class="ap-actions is-column">
              <linshe-button
                v-if="!detailNpc.characterId"
                variant="primary" size="sm" :loading="busyFlags[`invite${detailNpc.id}`]"
                @click="invite(detailNpc)"
              >邀请入邻舍（成为聊天角色）</linshe-button>
              <div v-else class="ap-invited">已邀请入邻舍（角色 #{{ detailNpc.characterId }}，在聊天侧边栏可见）</div>
              <linshe-button variant="secondary" size="sm" :loading="busyFlags[`reroll${detailNpc.id}`]" @click="rerollNpc(detailNpc)">
                重掷人设与作息
              </linshe-button>
              <linshe-button variant="danger" size="sm" @click="removeNpc(detailNpc)">删除居民</linshe-button>
            </div>
          </div>
        </div>

        <!-- ── 「我」详情页：立绘 + 像素小人确认与编辑 ── -->
        <div v-if="detail && detail.type === 'player'" class="ap-body">
          <div class="ap-detail">
            <div class="ap-detail-name">我（玩家）的形象</div>
            <p v-if="playerError" class="ap-player-error" role="alert">{{ playerError }}</p>
            <div class="ap-section">
              <div class="ap-section-title">立绘（900×1600，可抠除底色）</div>
              <TownAssetThumb
                v-if="playerKit.portrait?.status === 'ready'"
                class="ap-portrait-thumb"
                :asset="playerKit.portrait"
                :show-name="false"
                @edit="openAssetManager(playerKit.portrait, '我 · 立绘 · 图片管理')"
              />
              <div v-else class="ap-empty is-small">还没有立绘，点下方生成。</div>
              <div v-if="!playerKit.portrait?.id" class="ap-actions">
                <linshe-button size="sm" :loading="playerOperation === 'portrait'" :disabled="playerKitBusy" @click="regenPlayerKit('portrait')">生成我的立绘</linshe-button>
              </div>
            </div>
            <div class="ap-section">
              <div class="ap-section-title">像素小人（正面 / 背面）</div>
              <div class="ap-sprite-row">
                <div v-for="direction in ['down', 'up']" :key="direction" class="ap-player-sprite">
                  <div class="ap-section-title">{{ direction === 'down' ? '正面' : '背面' }}</div>
                  <TownAssetThumb
                    v-if="playerKit.sprites?.[direction]?.status === 'ready'"
                    class="ap-sprite"
                    :asset="playerKit.sprites[direction]"
                    :show-name="false"
                    @edit="openAssetManager(playerKit.sprites[direction], `我 · ${direction === 'down' ? '正面' : '背面'}小人 · 图片管理`)"
                  />
                  <div v-else class="ap-empty is-small">还没有{{ direction === 'down' ? '正面' : '背面' }}小人</div>
                  <div v-if="!playerKit.sprites?.[direction]?.id" class="ap-actions is-column">
                    <linshe-button size="sm" :loading="playerOperation === direction" :disabled="playerKitBusy" @click="regenPlayerKit(direction)">生成{{ direction === 'down' ? '正面' : '背面' }}小人</linshe-button>
                  </div>
                </div>
              </div>
            </div>
            <div class="ap-actions is-column">
              <linshe-button v-if="!playerKit.portrait?.id || !playerKit.sprites?.down?.id || !playerKit.sprites?.up?.id" variant="primary" size="sm" :loading="playerOperation === 'kit'" :disabled="playerKitBusy" @click="regenPlayerKit('kit')">
                生成缺失形象（按我的用户配置）
              </linshe-button>
            </div>
          </div>
        </div>

        <!-- ── 角色列表 ── -->
        <div v-if="!detail && tab === 'chars'" class="ap-body">
          <div class="ap-actions">
            <linshe-button variant="primary" size="sm" :loading="batchChars" @click="generateAllMissingCharSprites">
              一键生成所有缺失素材
            </linshe-button>
          </div>
          <div
            v-for="c in chars" :key="c.id"
            class="ap-row" role="button" tabindex="0"
            @click="detail = { type: 'char', id: c.id }"
            @keydown.enter="detail = { type: 'char', id: c.id }"
          >
            <div class="ap-row-thumb is-portrait">
              <img v-if="c.portraitUrl || c.standingUrl" :src="c.portraitUrl || c.standingUrl" alt="">
              <img v-else-if="c.sprites?.down" :src="c.sprites.down" alt="">
              <span v-else class="ap-thumb-missing">·</span>
            </div>
            <div class="ap-npc-info">
              <div class="ap-npc-name">{{ c.displayName }}</div>
              <div class="ap-npc-meta">精灵 {{ c.spriteCount }}/2 · {{ c.townEnabled ? '已入住' : '未入住' }}</div>
              <p v-if="c.portraitUrl || c.standingUrl || c.sprites?.down" class="ap-asset-appearance">{{ appearanceText(c.portraitUrl ? c.appearanceStatus?.portrait : c.standingUrl ? 'unknown' : c.appearanceStatus?.sprites?.down) }}</p>
            </div>
            <span class="ap-row-arrow">›</span>
          </div>
        </div>

        <!-- ── 角色详情页 ── -->
        <div v-if="detail && detail.type === 'char'" class="ap-body">
          <div v-if="detailChar" class="ap-detail">
            <div class="ap-detail-media">
              <div class="ap-portrait-box">
                <TownAssetThumb
                  v-if="charPortraitAsset(detailChar)"
                  class="ap-portrait-thumb"
                  :asset="charPortraitAsset(detailChar)"
                  :show-name="false"
                  @edit="openAssetManager(charPortraitAsset(detailChar), `${detailChar.displayName} 立绘`)"
                />
                <span v-else class="ap-thumb-missing is-big">还没有立绘</span>
              </div>
              <p v-if="charPortraitAsset(detailChar)" class="ap-asset-appearance" aria-label="立绘外观状态">{{ appearanceText(detailChar.portraitUrl ? detailChar.appearanceStatus?.portrait : 'unknown') }}</p>
              <div v-if="!detailChar.portraitId" class="ap-btn-row">
                <linshe-button variant="secondary" size="sm" :loading="busyFlags[`charportrait${detailChar.id}`]" @click="makeCharPortrait(detailChar)">
                  生成 900×1600 立绘
                </linshe-button>
              </div>
            </div>

            <div class="ap-detail-name">
              {{ detailChar.displayName }}
              <linshe-switch
                class="ap-detail-switch"
                v-model="detailChar.townEnabled"
                size="sm"
                :aria-label="`${detailChar.displayName} 入住`"
                @change="v => toggleChar(detailChar, v)"
              />
            </div>

            <div class="ap-section">
              <div class="ap-section-title">像素小人（正面 / 背面）· 点小图可管理图片</div>
              <div class="ap-sprite-row ap-appearance-row">
                <div v-for="dir in ['down', 'up']" :key="dir" class="ap-sprite-wrap">
                  <TownAssetThumb
                    v-if="charSpriteAsset(detailChar, dir)"
                    class="ap-sprite"
                    :asset="charSpriteAsset(detailChar, dir)"
                    :show-name="false"
                    @edit="openAssetManager(charSpriteAsset(detailChar, dir), `${detailChar.displayName} ${dir === 'down' ? '正面' : '背面'}小人`)"
                  />
                  <div v-else class="ap-sprite"><span class="ap-sprite-missing">·</span></div>
                  <p v-if="charSpriteAsset(detailChar, dir)" class="ap-asset-appearance" :aria-label="`${dir === 'down' ? '正面' : '背面'}小人外观状态`">{{ appearanceText(detailChar.appearanceStatus?.sprites?.[dir]) }}</p>
                </div>
                <div v-if="!charSpriteAsset(detailChar, 'down') || !charSpriteAsset(detailChar, 'up')" class="ap-btn-row">
                  <linshe-button variant="secondary" size="sm" :loading="busyFlags[`charsprites${detailChar.id}`]" @click="regenCharSprites(detailChar)">
                    生成缺失小人
                  </linshe-button>
                </div>
              </div>
              <div v-if="charSpritesStale(detailChar)" class="ap-actions is-column">
                <linshe-button variant="secondary" size="sm" :loading="busyFlags[`charsprites${detailChar.id}`]" @click="regenCharSprites(detailChar, true)">按当前外观更新小人</linshe-button>
                <p class="ap-asset-appearance">会重绘未记录版本或外观过时的小人</p>
              </div>
              <div v-if="spriteErrors[`char:${detailChar.id}`]" class="ap-actions is-column">
                <p class="ap-sprite-error" role="alert">{{ spriteErrors[`char:${detailChar.id}`] }}</p>
                <linshe-button variant="link" size="sm" @click="loadChars">重新读取素材状态</linshe-button>
              </div>
            </div>

            <div class="ap-actions is-column">
              <linshe-button variant="primary" size="sm" @click="$emit('close')">去小镇看看</linshe-button>
            </div>
          </div>
        </div>

        <!-- ── 小镇设置 ── -->
        <div v-if="!detail && tab === 'settings'" class="ap-body ap-settings">
          <div class="ap-setting">
            <span class="ap-setting-label">居民生活方式</span>
            <linshe-select v-model="settings.simulation" size="sm" :disabled="settingsLocked"
              :options="[{ label: '兼容作息', value: 'legacy' }, { label: '本地行为 · 可恢复', value: 'rules' }]" />
          </div>
          <p class="ap-layout-desc">本地行为会记录行动原因，并在到达地点后开始工作或休息。开启配送时，岗位居民仍会记录可恢复的工作进度。</p>
          <div class="ap-setting">
            <span class="ap-setting-label">配送与工坊接单</span>
            <linshe-switch v-model="settings.economyEnabled" size="sm" :disabled="settingsLocked" aria-label="配送与工坊接单" />
          </div>
          <p class="ap-layout-desc">在生活面板配置居民与路线。关闭后暂停新委托和服务，已经接下的仍可完成或取消。</p>
          <div class="ap-setting">
            <span class="ap-setting-label">公共基金有限保障</span>
            <linshe-switch v-model="settings.liquidityEnabled" size="sm" :disabled="settingsLocked" aria-label="公共基金有限保障" />
          </div>
          <p class="ap-layout-desc">默认关闭。仅在发布有原料的配送委托时按需向公共基金发行补助。重建不重置额度，不补充原料；不会直接给玩家发钱。</p>
          <div v-if="liquidity" aria-label="公共基金保障状态">
            <p class="ap-layout-desc">{{ liquidity.availableFund == null ? '基金尚未配置' : `基金可用 ${liquidity.availableFund} 邻币` }}。{{ liquidity.activationAllowed ? '已满足开启准备金条件，保存时会再次核验。' : '尚未满足开启条件，保存时由服务器核验。' }}</p>
            <p v-if="liquidity.limits" class="ap-layout-desc">开启至少需要 {{ liquidity.limits.reserve }} 邻币可用准备金；每24小时最多 {{ liquidity.limits.rolling24h }}，滚动7天最多 {{ liquidity.limits.rolling7d }}，本镇累计最多 {{ liquidity.limits.grossWorld }}，流通总量上限 {{ liquidity.limits.circulation }}。</p>
            <p class="ap-layout-desc">累计补助 {{ liquidity.grossIssued }}，剩余额度 {{ liquidity.remainingWorldBudget }}；过去24小时发行 {{ liquidity.issued24h }}，过去7天发行 {{ liquidity.issued7d }}。</p>
          </div>
          <p v-if="liquidityError" class="ap-layout-desc" role="status">{{ liquidityError }}</p>
          <linshe-button variant="link" size="sm" :disabled="loadingSettings || savingSettings" @click="loadSettings">重新读取设置与基金状态</linshe-button>
          <div v-for="f in SETTING_FIELDS" :key="f.key" class="ap-setting">
            <span class="ap-setting-label">{{ f.label }}</span>
            <linshe-input v-model.number="settings[f.key]" size="sm" type="number" :disabled="settingsLocked" :min="f.min" :max="f.max" :step="f.step" />
          </div>
          <linshe-button variant="primary" size="sm" :disabled="settingsLocked" :loading="savingSettings" @click="saveSettings">保存设置</linshe-button>
          <p v-if="settingsError" class="ap-player-error" role="alert">{{ settingsError }}</p>
          <p v-else-if="settingsSaved" class="ap-layout-desc" role="status">设置已保存。</p>
          <linshe-button ref="deliveriesTrigger" variant="link" size="sm" @click="deliveriesOpen = true">查看记录投递状态</linshe-button>

          <div class="ap-layout-zone">
            <div class="ap-section-title">重新布局</div>
            <p class="ap-layout-desc">AI 会用当前素材重建地图、道路和地点；居民与入住角色会保留，手动地图修改会被覆盖。道具密度始终高于建筑密度。</p>
            <div v-if="relayoutError" class="ap-layout-error" role="alert">{{ relayoutError }}</div>
            <div v-else-if="relayoutDone" class="ap-layout-done">布局已重建，地图正在刷新。</div>
            <div v-if="!layoutConfirm" class="ap-actions">
              <linshe-button variant="secondary" size="sm" @click="layoutConfirm = true">重新布局</linshe-button>
            </div>
            <div v-else class="ap-confirm">
              <span>确定重建当前地图布局吗？</span>
              <linshe-button variant="primary" size="sm" :loading="relayoutBusy" @click="doRelayout">开始重建</linshe-button>
              <linshe-button variant="ghost" size="sm" :disabled="relayoutBusy" @click="layoutConfirm = false">取消</linshe-button>
            </div>
          </div>

          <div class="ap-danger-zone">
            <div class="ap-danger-title">危险区</div>
            <p class="ap-danger-desc">重新初始化会清除当前地图、地点、居民与相遇记录，清理未完成委托并退回服务托管款。已有角色、邻币、背包道具和交易履历会保留。</p>
            <linshe-button variant="danger" size="sm" :loading="resetting" @click="resetting = true">
              重新初始化世界
            </linshe-button>
            <div v-if="resetting" class="ap-confirm">
              <span>确定要推倒重来吗？</span>
              <linshe-button variant="danger" size="sm" @click="doReset">确认清除</linshe-button>
              <linshe-button variant="ghost" size="sm" @click="resetting = false">手滑了</linshe-button>
            </div>
          </div>
        </div>
      </div>

      <TownAssetManager
        :open="manager.open"
        :asset="manager.asset"
        :title="manager.title"
        @close="manager.open = false"
        @updated="onPromptRegenerated"
      />
    </div>
    </Transition>
    <TownDeliveryDiagnostics :open="open && deliveriesOpen" @close="closeDeliveries" />
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, onBeforeUnmount, watch, nextTick } from 'vue'
import * as api from '../../api/index.js'
import { useTownStore } from '../../stores/town.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheSwitch from '../ui/LinsheSwitch.vue'
import LinsheSelect from '../ui/LinsheSelect.vue'
import TownAssetThumb from './TownAssetThumb.vue'
import TownAssetManager from './TownAssetManager.vue'
import TownDeliveryDiagnostics from './TownDeliveryDiagnostics.vue'

defineEmits(['close'])

const props = defineProps({ open: Boolean })
const deliveriesOpen = ref(false), deliveriesTrigger = ref(null)
async function closeDeliveries() { deliveriesOpen.value = false; await nextTick(); deliveriesTrigger.value?.$el?.focus() }

const town = useTownStore()
const tab = ref('npcs')
const npcs = ref([])
const chars = ref([])
const settings = ref({ liquidityEnabled: false })
const liquidity = ref(null), liquidityError = ref(''), loadingSettings = ref(false), settingsReady = ref(false)
let settingsScope = 0
let assetScope = 0, alive = true
const assetReads = { npcs: 0, chars: 0, player: 0 }
function beginAssetRead(kind) {
  if (!alive || !props.open) return null
  const scope = assetScope, sequence = ++assetReads[kind]
  return () => alive && props.open && scope === assetScope && sequence === assetReads[kind]
}
const detail = ref(null) // { type: 'npc' | 'char', id }
const busyFlags = reactive({})
const savingSettings = ref(false)
const settingsLocked = computed(() => loadingSettings.value || savingSettings.value || !settingsReady.value)
const settingsError = ref('')
const settingsSaved = ref(false)
const adding = ref(false)
const batchSprites = ref(false)
const batchChars = ref(false)
const resetting = ref(false)
const layoutConfirm = ref(false)
const relayoutBusy = ref(false)
const relayoutError = ref('')
const relayoutDone = ref(false)
const newNpc = reactive({ name: '', job: '', persona: '' })
const playerKit = reactive({ sprites: {}, portrait: null })
const playerOperation = ref(null)
const playerKitBusy = computed(() => playerOperation.value !== null)
const playerError = ref('')
const manager = reactive({ open: false, asset: null, title: '' })

function openAssetManager(asset, title = '') {
  if (!asset?.id) return
  manager.asset = asset
  manager.title = title || `${asset.name || '图片'} · 图片管理`
  manager.open = true
}

function charPortraitAsset(char) {
  const path = char?.portraitUrl || char?.standingUrl
  if (!char?.portraitId || !path) return null
  return { id: char.portraitId, name: `${char.displayName} 立绘`, status: 'ready', image_path: path, meta: {} }
}

function charSpriteAsset(char, direction) {
  const path = char?.sprites?.[direction]
  const id = char?.spriteIds?.[direction]
  if (!id || !path) return null
  return { id, name: `${char.displayName} ${direction === 'down' ? '正面' : '背面'}小人`, status: 'ready', image_path: path, meta: {} }
}


function onPromptRegenerated() {
  loadNpcs()
  loadChars()
  loadPlayerKit()
}

async function loadPlayerKit() {
  const current = beginAssetRead('player')
  if (!current) return
  try {
    const kit = await api.fetchTownPlayerKit()
    if (!current()) return
    playerKit.sprites = kit.sprites || {}
    playerKit.portrait = kit.portrait || null
  } catch (err) {
    console.warn('[town-admin] player kit load failed:', err?.message)
  }
}

async function regenPlayerKit(part = 'kit') {
  if (playerKitBusy.value) return
  playerError.value = ''
  playerOperation.value = part
  try {
    const data = await (part === 'portrait' ? api.regenerateTownPlayerPortrait() : part === 'kit' ? api.regenerateTownPlayerKit() : api.regenerateTownPlayerSprite(part))
    playerKit.sprites = data.kit?.sprites || {}
    playerKit.portrait = data.kit?.portrait || null
  } catch (err) {
    playerError.value = err?.message || '生成失败，请重试'
    console.warn('[town-admin] player kit regen failed:', err?.message)
  } finally {
    playerOperation.value = null
  }
}

const SETTING_FIELDS = [
  { key: 'tickSeconds', label: '模拟步长（秒）', min: 20, max: 300, step: 5 },
  { key: 'npcSpeed', label: '居民速度（格/秒）', min: 0.1, max: 4, step: 0.1 },
  { key: 'playerSpeed', label: '玩家速度（格/秒）', min: 0.2, max: 6, step: 0.1 },
  { key: 'maxActiveEncounters', label: '同时相遇上限', min: 0, max: 6, step: 1 },
  { key: 'encounterMinStartGapMin', label: '相遇最小间隔（分）', min: 1, max: 120, step: 1 },
  { key: 'encounterCooldownHours', label: '同对相遇冷却（时）', min: 0.5, max: 24, step: 0.5 },
  { key: 'encounterRelatedProb', label: '熟人相遇概率', min: 0, max: 1, step: 0.01 },
  { key: 'encounterStrangerProb', label: '陌生人相遇概率', min: 0, max: 1, step: 0.01 },
  { key: 'statusBubbleIntervalMin', label: '状态气泡间隔（分）', min: 5, max: 240, step: 5 },
  { key: 'buildingDensity', label: '建筑密度（个/千格）', min: 0.5, max: 20, step: 0.1 },
  { key: 'propDensity', label: '道具密度（个/千格）', min: 0.5, max: 40, step: 0.1 },
]

const detailNpc = computed(() => {
  if (detail.value?.type !== 'npc') return null
  return npcs.value.find(n => n.id === detail.value.id) || null
})

const detailChar = computed(() => {
  if (detail.value?.type !== 'char') return null
  return chars.value.find(c => c.id === detail.value.id) || null
})

const detailName = computed(() => detail.value?.type === 'player' ? '我的形象管理' : detailNpc.value?.displayName || detailChar.value?.displayName || '详情')

function spriteCount(npc) {
  return ['down', 'up'].filter(d => npc.sprites?.[d]?.status === 'ready').length
}

async function loadNpcs() {
  const current = beginAssetRead('npcs')
  if (!current) return
  try {
    const data = await api.fetchTownNpcs()
    if (!current()) return
    npcs.value = data.npcs || []
  } catch (err) {
    console.warn('[town-admin] npcs load failed:', err?.message)
  }
}

async function loadChars() {
  const current = beginAssetRead('chars')
  if (!current) return
  try {
    const data = await api.fetchTownCharacters()
    if (!current()) return
    chars.value = data.characters || []
  } catch (err) {
    console.warn('[town-admin] chars load failed:', err?.message)
  }
}

async function loadSettings() {
  if (savingSettings.value) return
  const token = ++settingsScope
  loadingSettings.value = true; settingsReady.value = false; settingsError.value = ''; settingsSaved.value = false
  const [config, economy] = await Promise.allSettled([api.fetchTownSettings(), api.getTownLiquidity()])
  if (token !== settingsScope) return
  if (config.status === 'fulfilled') { settings.value = { liquidityEnabled: false, ...config.value }; settingsReady.value = true }
  else settingsError.value = '设置读取失败，请重新读取后再保存。'
  liquidity.value = economy.status === 'fulfilled' ? economy.value.liquidity ?? null : null
  liquidityError.value = economy.status === 'rejected' ? '基金状态暂时无法读取，请重新读取。' : ''
  loadingSettings.value = false
}

async function toggleNpc(npc, enabled) {
  try {
    await api.updateTownNpc(npc.id, { townEnabled: enabled })
  } catch (err) {
    npc.townEnabled = !enabled
    console.warn('[town-admin] toggle npc failed:', err?.message)
  }
}

async function toggleChar(c, enabled) {
  try {
    await api.setTownCharacterEnabled(c.id, enabled)
  } catch (err) {
    c.townEnabled = !enabled
    console.warn('[town-admin] toggle char failed:', err?.message)
  }
}

async function regenSprites(npc, refreshAppearance = false) {
  const scope = assetScope
  const current = () => alive && props.open && scope === assetScope
  spriteErrors[`npc:${npc.id}`] = ''
  busyFlags[`sprites${npc.id}`] = true
  try {
    await api.generateTownNpcSprites(npc.id, refreshAppearance ? { refreshAppearance: true } : {})
    // A reopened panel may have read before this generation committed. Read the
    // current list again, but never apply the old request's response as a snapshot.
    if (!alive || !props.open) return
    await loadNpcs()
  } catch (err) {
    if (!current()) return
    spriteErrors[`npc:${npc.id}`] = '小人未更新成功，请重新读取素材状态后再试'
    console.warn('[town-admin] sprites failed:', err?.message)
  } finally {
    busyFlags[`sprites${npc.id}`] = false
  }
}

async function makePortrait(npc) {
  busyFlags[`portrait${npc.id}`] = true
  try {
    await api.generateTownNpcPortrait(npc.id)
    await loadNpcs()
  } catch (err) {
    console.warn('[town-admin] portrait failed:', err?.message)
  } finally {
    busyFlags[`portrait${npc.id}`] = false
  }
}

async function makeCharPortrait(c) {
  if (c.standingUrl) return // 已有立绘直接复用
  busyFlags[`charportrait${c.id}`] = true
  try {
    await api.generateTownCharacterPortrait(c.id)
    await loadChars()
  } catch (err) {
    console.warn('[town-admin] char portrait failed:', err?.message)
  } finally {
    busyFlags[`charportrait${c.id}`] = false
  }
}

async function invite(npc) {
  busyFlags[`invite${npc.id}`] = true
  try {
    await api.inviteTownNpc(npc.id)
    await loadNpcs()
    await loadChars()
  } catch (err) {
    console.warn('[town-admin] invite failed:', err?.message)
  } finally {
    busyFlags[`invite${npc.id}`] = false
  }
}

async function rerollNpc(npc) {
  busyFlags[`reroll${npc.id}`] = true
  try {
    await api.rerollTownNpc(npc.id)
    await loadNpcs()
  } catch (err) {
    console.warn('[town-admin] reroll failed:', err?.message)
  } finally {
    busyFlags[`reroll${npc.id}`] = false
  }
}

async function removeNpc(npc) {
  try {
    await api.deleteTownNpc(npc.id)
    detail.value = null
    await loadNpcs()
  } catch (err) {
    console.warn('[town-admin] delete failed:', err?.message)
  }
}

async function addNpc() {
  if (!newNpc.name.trim() || adding.value) return
  adding.value = true
  try {
    await api.createTownNpc({
      displayName: newNpc.name.trim(),
      job: newNpc.job.trim(),
      persona: newNpc.persona.trim(),
    })
    newNpc.name = ''
    newNpc.job = ''
    newNpc.persona = ''
    await loadNpcs()
  } catch (err) {
    console.warn('[town-admin] add npc failed:', err?.message)
  } finally {
    adding.value = false
  }
}

async function generateAllMissingNpcSprites() {
  batchSprites.value = true
  try {
    for (const npc of npcs.value.filter(n => spriteCount(n) < 2)) {
      try { await api.generateTownNpcSprites(npc.id) } catch (err) { console.warn('[town-admin]', err?.message) }
      await loadNpcs()
    }
  } finally {
    batchSprites.value = false
  }
}

async function regenCharSprites(c, refreshAppearance = false) {
  const scope = assetScope
  const current = () => alive && props.open && scope === assetScope
  spriteErrors[`char:${c.id}`] = ''
  busyFlags[`charsprites${c.id}`] = true
  try {
    await api.generateTownCharacterSprites(c.id, refreshAppearance ? { refreshAppearance: true } : {})
    if (!alive || !props.open) return
    await loadChars()
  } catch (err) {
    if (!current()) return
    spriteErrors[`char:${c.id}`] = '小人未更新成功，请重新读取素材状态后再试'
    console.warn('[town-admin] char sprites failed:', err?.message)
  } finally {
    busyFlags[`charsprites${c.id}`] = false
  }
}

async function generateAllMissingCharSprites() {
  batchChars.value = true
  try {
    for (const c of chars.value.filter(x => x.spriteCount < 2)) {
      try { await api.generateTownCharacterSprites(c.id) } catch (err) { console.warn('[town-admin]', err?.message) }
      await loadChars()
    }
  } finally {
    batchChars.value = false
  }
}

async function saveSettings() {
  if (settingsLocked.value) return
  const token = settingsScope
  savingSettings.value = true
  settingsError.value = ''
  settingsSaved.value = false
  try {
    const result = await api.updateTownSettings({ ...settings.value })
    if (token !== settingsScope) return
    if (result?.applied) settings.value = { ...settings.value, ...result.applied }
    settingsSaved.value = true
  } catch (err) {
    if (token !== settingsScope) return
    settingsError.value = err.message || '设置未能保存，请重试。'
    console.warn('[town-admin] save settings failed:', err?.message)
  } finally {
    if (token === settingsScope) savingSettings.value = false
  }
}

function appearanceText(status) {
  return status === 'needs_update' ? '外观已变化，图片待更新'
    : status === 'current' ? '与当前外观一致' : '未记录外观版本'
}
const spriteErrors = reactive({})
function npcSpritesStale(npc) {
  return ['down', 'up'].some(dir => npc.sprites?.[dir]?.status === 'ready' && npc.sprites[dir].appearanceStatus !== 'current')
}
function charSpritesStale(char) {
  return ['down', 'up'].some(dir => charSpriteAsset(char, dir) && char.appearanceStatus?.sprites?.[dir] !== 'current')
}

async function doRelayout() {
  if (relayoutBusy.value) return
  relayoutBusy.value = true
  relayoutError.value = ''
  relayoutDone.value = false
  try {
    await api.updateTownSettings(settings.value)
    await api.relayoutTownMap()
    await loadSettings()
    town.fetchState().catch(() => {})
    town.fetchMap().catch(() => {})
    relayoutDone.value = true
    layoutConfirm.value = false
  } catch (err) {
    relayoutError.value = err?.message || '重新布局失败，请重试'
  } finally {
    relayoutBusy.value = false
  }
}

async function doReset() {
  try {
    await api.resetTownWorld()
    resetting.value = false
    detail.value = null
    town.fetchState().catch(() => {})
  } catch (err) {
    console.warn('[town-admin] reset failed:', err?.message)
    resetting.value = false
  }
}

watch(() => [props.open, town.snapshot?.worldId, town.snapshot?.worldEpoch], ([open, worldId, epoch], previous) => {
  ++assetScope
  if (previous && (worldId !== previous[1] || epoch !== previous[2])) {
    npcs.value = []; chars.value = []
    playerKit.sprites = {}; playerKit.portrait = null
    detail.value = null; manager.open = false
  }
  for (const key of Object.keys(spriteErrors)) delete spriteErrors[key]
  if (!open) deliveriesOpen.value = false
  ++settingsScope; savingSettings.value = false; loadingSettings.value = false; settingsReady.value = false
  settingsError.value = ''; settingsSaved.value = false
  if (open) {
    loadSettings()
    loadNpcs()
    loadChars()
    loadPlayerKit()
  }
}, { immediate: true })
onBeforeUnmount(() => {
  alive = false
  ++assetScope
  ++settingsScope
})
</script>

<style scoped>
.admin-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 900;
  display: flex;
  justify-content: flex-end;
}

.admin-slide-enter-active,
.admin-slide-leave-active { transition: opacity 0.3s ease; }

.admin-slide-enter-active .admin-panel,
.admin-slide-leave-active .admin-panel { transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.24s ease; }

.admin-slide-enter-from,
.admin-slide-leave-to { opacity: 0; }

.admin-slide-enter-from .admin-panel,
.admin-slide-leave-to .admin-panel { transform: translateX(48px); }

@media (prefers-reduced-motion: reduce) {
  .admin-slide-enter-active,
  .admin-slide-leave-active,
  .admin-slide-enter-active .admin-panel,
  .admin-slide-leave-active .admin-panel { transition-duration: 0.001ms; }
}

.admin-panel {
  width: 440px;
  max-width: 100vw;
  height: 100%;
  background: #f4f1eeed;
  box-shadow: -12px 0 48px rgba(54, 42, 38, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ap-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 18px 8px;
}

.ap-title { flex: 1; font-size: 16px; font-weight: 700; color: var(--text-bright); }

.ap-tabs { display: flex; gap: 6px; padding: 6px 18px 10px; }

.ap-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ap-settings > * { flex-shrink: 0; }

.ap-actions { display: flex; gap: 8px; }
.ap-actions.is-column { flex-direction: column; }

.ap-empty {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  padding: 30px 0;
}

.ap-empty.is-small { padding: 10px 0; font-size: 12px; }

/* ── 列表行（整行热区 → 详情页） ── */
.ap-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fbf8f3;
  border-radius: 14px;
  padding: 10px 12px;
  cursor: pointer;
  border: 1.5px solid transparent;
}

.ap-row:hover { border-color: rgba(224, 123, 108, 0.3); }

.ap-row-thumb {
  width: 44px;
  height: 56px;
  border-radius: 8px;
  background: #f1ebe1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.ap-row-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom;
  image-rendering: pixelated;
}

.ap-row-thumb.is-portrait img { image-rendering: auto; }

.ap-thumb-missing { color: #cfc4b4; font-size: 14px; padding-bottom: 8px; }
.ap-thumb-missing.is-big { font-size: 13px; }

.ap-row-arrow { color: #c9bda9; font-size: 18px; flex-shrink: 0; }

.ap-npc-info { flex: 1; min-width: 0; }

.ap-npc-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-bright);
  display: flex;
  align-items: center;
  gap: 6px;
}

.ap-npc-job {
  font-size: 10px;
  font-weight: 400;
  color: var(--accent-hover);
  background: rgba(224, 123, 108, 0.12);
  padding: 1px 8px;
  border-radius: 999px;
}

.ap-npc-meta { font-size: 10px; color: var(--text-secondary); margin-top: 3px; opacity: 0.85; }

/* ── 详情页 ── */
.ap-detail { display: flex; flex-direction: column; gap: 14px; }

.ap-detail-media { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }

.ap-btn-row { display: flex; gap: 6px; }
.ap-btn-row > :first-child { flex: 1; }

.ap-asset-appearance { font-size: 11px; line-height: 1.5; color: #8a7a6a; margin: 6px 0 0; overflow-wrap: anywhere; }
.ap-sprite-error { color: #a44338; font-size: 12px; line-height: 1.6; margin: 0; }
.ap-appearance-row { flex-wrap: wrap; align-items: flex-start; }
.ap-sprite-wrap .ap-asset-appearance { max-width: 110px; }
.ap-sprite-wrap { cursor: pointer; }
.ap-sprite-wrap:hover .ap-sprite { box-shadow: 0 0 0 2px rgba(224, 123, 108, 0.4); }

.ap-portrait-box {
  width: 100%;
  height: 300px;
  border-radius: 14px;
  background: #efe9de;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
}

.ap-portrait-thumb {
  width: 100%;
  height: 100%;
}
.ap-portrait-box img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom;
}

.ap-detail-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-bright);
}

.ap-detail-switch { margin-left: auto; }

.ap-section { display: flex; flex-direction: column; gap: 8px; }
.ap-section-title { font-size: 12px; font-weight: 700; color: var(--text-secondary); }

.ap-sprite-row { display: flex; align-items: center; gap: 10px; }

.ap-sprite {
  width: 44px;
  height: 58px;
  border-radius: 8px;
  background: #f1ebe1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.ap-sprite img { height: 100%; image-rendering: pixelated; }
.ap-sprite-missing { color: #cfc4b4; font-size: 12px; }
.ap-sprite-row > :last-child { margin-left: auto; }

.ap-player-sprite { flex: 1; min-width: 0; width: 130px; }

.ap-player-error { color: #b85343; font-size: 12px; }
.ap-persona, .ap-appearance {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  color: var(--text-primary);
  line-height: 1.7;
  margin: 0;
  background: #fbf8f3;
  border-radius: 10px;
  padding: 8px 10px;
}

.ap-appearance { color: var(--text-secondary); font-style: italic; }

.ap-routine-row {
  display: flex;
  gap: 10px;
  font-size: 11px;
  padding: 5px 8px;
  border-radius: 8px;
  background: #fbf8f3;
}

.ap-routine-time { color: var(--accent-hover); min-width: 84px; font-variant-numeric: tabular-nums; }
.ap-routine-act { color: var(--text-primary); }

.ap-invited {
  font-size: 12px;
  color: var(--text-secondary);
  background: rgba(124, 176, 116, 0.12);
  border-radius: 10px;
  padding: 8px 12px;
}

/* ── 新增居民 ── */
.ap-add {
  margin-top: 8px;
  padding: 12px;
  border-radius: 14px;
  border: 1px dashed rgba(200, 186, 166, 0.7);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ap-add-title { font-size: 12px; font-weight: 700; color: var(--text-secondary); }
.ap-add-grid { display: flex; gap: 8px; }
.ap-add-grid > * { flex: 1; }
.ap-add > :last-child { align-self: flex-end; }

/* ── 设置 ── */
.ap-setting { display: flex; align-items: center; gap: 12px; }
.ap-setting-label { flex: 1; font-size: 12px; color: var(--text-primary); }
.ap-setting > :last-child { width: 90px; }

.ap-layout-zone {
  margin-top: 16px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(224, 123, 108, 0.06);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ap-layout-desc {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.ap-layout-error { font-size: 12px; color: #b85343; }
.ap-layout-done { font-size: 12px; color: #4f7a4a; }

.ap-danger-zone {
  margin-top: 16px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(192, 86, 74, 0.06);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ap-danger-title { font-size: 12px; font-weight: 700; color: #c0564a; }
.ap-danger-desc { font-size: 11px; color: var(--text-secondary); margin: 0; }
.ap-danger-zone > :nth-child(3) { align-self: flex-start; }

.ap-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-primary);
}
</style>
