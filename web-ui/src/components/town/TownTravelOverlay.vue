<template>
  <Teleport to="body">
    <div
      v-if="phase"
      class="travel-overlay"
      :class="[`is-${phase}`, { 'is-reduced': reduced }]"
      role="status" aria-live="polite"
    >
      <div class="travel-curtain is-left" aria-hidden="true"></div>
      <div class="travel-curtain is-right" aria-hidden="true"></div>

      <!-- 出行牌：只在启程/合帘时在场，拉开帘子时已经换成抵达环 -->
      <div v-if="phase !== 'reveal'" class="travel-card cel-jelly" aria-hidden="true">
        <span class="travel-kicker">出行</span>
        <strong class="travel-name">{{ destination || '下一座小镇' }}</strong>
        <p v-if="flavor" class="travel-flavor">{{ flavor }}</p>
        <span v-if="weatherText" class="travel-weather">{{ weatherText }}</span>
      </div>
      <div v-else class="travel-arrive" aria-hidden="true">
        <span class="travel-arrive-ring"></span>
        <strong class="travel-arrive-name">{{ arrival || `已抵达${destination || '目的地'}` }}</strong>
      </div>

      <p class="travel-sr">{{ announcement }}</p>
    </div>
  </Teleport>
</template>

<script setup>
/**
 * 出行过场：暖纸双帘 + 出行牌 + 抵达环。
 *
 * 纯粹的展示层——时序由调用方（TownView.startTravel）驱动：
 *   depart 启程（牌子弹入，帘子还开着）→ cover 合帘（盖满后**停一帧**，
 *   那一刻调用方在遮罩下原子换场）→ reveal 拉帘（抵达环 + 新图淡入）；
 *   failed 是失败回滚：帘子反向拉开，原图状态一点没动。
 * 质感沿用小镇游戏化口径（纸面 + 墨色描边 + 硬阴影）与主题 token，不引入新的视觉体系。
 */
defineProps({
  phase: { type: String, default: '' },        // '' | depart | cover | reveal | failed
  destination: { type: String, default: '' },  // 目的地镇名
  flavor: { type: String, default: '' },       // 一句风物描述
  weatherText: { type: String, default: '' },  // 天候 chip
  arrival: { type: String, default: '' },      // 抵达播报文案
  announcement: { type: String, default: '' }, // 读屏播报（role=status）
  reduced: Boolean,                            // prefers-reduced-motion：只做淡入淡出
})
</script>

<style scoped>
.travel-overlay { position: fixed; inset: 0; z-index: 11000; pointer-events: none; overflow: hidden; }

/* ── 纸帘：主题纸面 + 波点纹理 + 手撕墨边（暖色是暖纸，暗夜是夜色深纸，都走 token） ── */
.travel-curtain { position: absolute; top: 0; bottom: 0; width: 50.5%; background: var(--grad-card-ending); box-shadow: var(--shadow-lg); will-change: transform; }
.travel-curtain::before { content: ''; position: absolute; inset: 0; background-image: radial-gradient(var(--dot-color) 1.2px, transparent 1.4px); background-size: 16px 16px; }
.travel-curtain::after { content: ''; position: absolute; top: 0; bottom: 0; width: 16px; background-image: radial-gradient(circle at 50% 50%, transparent 0 6px, var(--cel-outline) 6px 7.4px, transparent 7.4px); background-size: 16px 24px; opacity: .5; }
.travel-curtain.is-left { left: 0; transform: translateX(-101%); }
.travel-curtain.is-left::after { right: 0; }
.travel-curtain.is-right { right: 0; transform: translateX(101%); }
.travel-curtain.is-right::after { left: 0; }
.travel-overlay.is-depart .travel-curtain, .travel-overlay.is-failed .travel-curtain { transition: transform 380ms var(--ease-emph); }
.travel-overlay.is-cover .travel-curtain { transition: transform 380ms var(--ease-emph); transform: translateX(0); }
.travel-overlay.is-reveal .travel-curtain { transition: transform 460ms var(--ease-emph); transform: translateX(-101%); }
.travel-overlay.is-reveal .travel-curtain.is-right { transform: translateX(101%); }

/* ── 出行牌 ── */
.travel-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 232px; max-width: min(380px, 78vw); padding: 22px 26px 20px; text-align: center; color: var(--text-primary); background: var(--grad-card-ending); border: 2px solid var(--cel-outline); border-radius: 18px 20px 16px 22px; box-shadow: var(--shadow-hard), var(--shadow-lg); animation-delay: 40ms; }
.travel-kicker { display: block; font-size: 12px; letter-spacing: .22em; color: var(--text-secondary); }
.travel-name { display: block; margin-top: 6px; font-size: 24px; line-height: 1.3; }
.travel-flavor { margin: 10px 0 0; font-size: 13px; line-height: 1.7; color: var(--text-secondary); }
.travel-weather { display: inline-block; margin-top: 12px; padding: 3px 12px; font-size: 12px; border: 1px solid var(--border-strong); border-radius: 999px; }

/* ── 抵达环 ── */
.travel-arrive { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 14px; color: var(--text-primary); }
.travel-arrive-ring { width: 132px; height: 132px; border-radius: 50%; border: 3px solid var(--accent); animation: ring-out 0.55s var(--ease-out) forwards; }
.travel-arrive-name { padding: 6px 16px; font-size: 15px; background: var(--grad-card-ending); border: 2px solid var(--cel-outline); border-radius: 999px; box-shadow: var(--shadow-hard-sm); }

.travel-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* 减少动态：整段退化成一次淡入，不做位移与缩放 */
.travel-overlay.is-reduced .travel-curtain { display: none; }
.travel-overlay.is-reduced { background: rgba(0,0,0,.35); animation: travel-fade 180ms var(--ease-out) both; }
@keyframes travel-fade { from { opacity: 0; } to { opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .travel-curtain { transition: none !important; }
}
@media (max-width: 520px) {
  .travel-card { min-width: 0; width: min(320px, 84vw); padding: 18px 20px 16px; }
  .travel-name { font-size: 21px; }
}
</style>
