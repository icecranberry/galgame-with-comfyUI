<template>
  <div
    class="gsb"
    :class="[`gsb--${variant}`, `gsb--${size}`, `tone-${tone}`, { 'is-disabled': disabled, 'is-loading': loading, 'is-touch': touchTarget, 'is-active': active }]"
    role="button"
    :tabindex="disabled ? -1 : 0"
    :aria-disabled="disabled || loading ? 'true' : undefined"
    :aria-busy="loading ? 'true' : undefined"
    @click="onClick"
    @keydown.enter.prevent="onClick"
    @keydown.space.prevent="onClick"
  >
    <span v-if="variant === 'ritual'" class="gsb-light-border" aria-hidden="true"><span /></span>
    <template v-if="variant === 'sigil'">
      <svg class="gsb-star-map" viewBox="0 0 120 54" preserveAspectRatio="none" fill="none" aria-hidden="true">
        <path class="gsb-star-frame" d="M10 2H110A8 8 0 0 0 118 10V44A8 8 0 0 0 110 52H10A8 8 0 0 0 2 44V10A8 8 0 0 0 10 2Z" />
        <g class="gsb-constellation">
          <path d="M12 25 22 14 38 8M80 47 96 40 108 29" />
          <circle cx="12" cy="25" r="1.8" /><circle cx="22" cy="14" r="1.6" /><circle cx="38" cy="8" r="1.8" />
          <circle cx="80" cy="47" r="1.8" /><circle cx="96" cy="40" r="1.6" /><circle cx="108" cy="29" r="1.8" />
        </g>
      </svg>
      <svg class="gsb-star-seal" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <circle class="gsb-star-seal-face" cx="14" cy="14" r="12" /><circle cx="14" cy="14" r="9.5" />
        <path d="m14 4 1.6 7.3L23 9l-6.1 5 6.1 5-7.4-2.3L14 24l-1.6-7.3L5 19l6.1-5L5 9l7.4 2.3Z" />
      </svg>
    </template>
    <span v-if="loading" class="gsb-spin" aria-hidden="true" />
    <slot v-else />
  </div>
</template>

<script setup>
const props = defineProps({
  variant: { type: String, default: 'line' }, // line | ghost | link | icon | toolbar | pill | primary | ritual | sigil
  size: { type: String, default: 'md' },      // xs（紧凑图标） | sm | md | lg
  tone: { type: String, default: 'gold' },    // gold | muted
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  touchTarget: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['click'])

function onClick(event) {
  if (props.disabled || props.loading) {
    event.preventDefault?.()
    return
  }
  emit('click', event)
}
</script>

<style scoped>
/* ═══ 圣所按钮：神说页的页面级按钮语言 ═══
   细金描线 + 柔光内衬 + 刻字字距，替代软糖质感的通用 LinsheButton。
   色值全部从 --fun-gold / 既有主题 token 派生，不引入硬编码主题色。 */
.gsb {
  position: relative;
  isolation: isolate;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  height: 32px;
  padding: 0 15px;
  margin: 0;
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.12em;
  white-space: nowrap;
  color: color-mix(in srgb, var(--fun-gold) 38%, var(--text-primary));
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--fun-gold) 32%, var(--border));
  border-radius: var(--radius-full);
  cursor: pointer;
  user-select: none;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  transition:
    color var(--dur-interaction) var(--ease-standard),
    border-color var(--dur-interaction) var(--ease-standard),
    background var(--dur-interaction) var(--ease-standard),
    box-shadow var(--dur-interaction) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard);
}

/* 悬停流光：一道很淡的一字光斜扫过金线，只在 hover / focus 时掠过 */
.gsb::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: -60% -80%;
  background: linear-gradient(
    105deg,
    transparent 38%,
    color-mix(in srgb, var(--fun-gold) 20%, transparent) 50%,
    transparent 62%
  );
  transform: translateX(-70%);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.7s var(--ease-out), opacity 0.3s var(--ease-standard);
}

.gsb:hover {
  color: color-mix(in srgb, var(--fun-gold) 58%, var(--text-bright));
  border-color: color-mix(in srgb, var(--fun-gold) 62%, var(--border));
  background: color-mix(in srgb, var(--fun-gold) 7%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--fun-gold) 20%, transparent), 0 3px 12px color-mix(in srgb, var(--fun-gold) 16%, transparent);
}

.gsb:hover::before { transform: translateX(70%); opacity: 1; }

.gsb:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--fun-gold) 72%, var(--border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--fun-gold) 55%, transparent), 0 0 0 4px color-mix(in srgb, var(--fun-gold) 15%, transparent);
}

.gsb:active { transform: translateY(1px); }

/* ── 尺寸 ── */
.gsb--sm { height: 27px; padding: 0 12px; font-size: var(--fs-xs); letter-spacing: 0.1em; }
.gsb--lg { height: 40px; padding: 0 22px; font-size: var(--fs-md); }
.gsb--sm :slotted(.gsb-icon) { width: 13px; height: 13px; }
.gsb--md :slotted(.gsb-icon) { width: 15px; height: 15px; }
.gsb--lg :slotted(.gsb-icon) { width: 18px; height: 18px; }
.gsb :slotted(svg) { display: block; flex-shrink: 0; }

/* ── 变体：幽灵（表头次级操作）── */
.gsb--ghost {
  border-color: transparent;
  color: color-mix(in srgb, var(--text-secondary) 88%, var(--fun-gold) 12%);
  background: transparent;
}
.gsb--ghost:hover {
  color: color-mix(in srgb, var(--fun-gold) 52%, var(--text-primary));
  border-color: color-mix(in srgb, var(--fun-gold) 30%, var(--border));
  background: color-mix(in srgb, var(--fun-gold) 6%, transparent);
  box-shadow: none;
}
.gsb--ghost::before { display: none; }

/* ── 变体：文字链接 ── */
.gsb--link {
  height: auto;
  padding: 1px 2px;
  border-color: transparent;
  border-radius: 4px;
  font-size: var(--fs-sm);
  letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--fun-gold) 30%, var(--text-secondary));
  background: transparent;
}
.gsb--link:hover {
  color: color-mix(in srgb, var(--fun-gold) 62%, var(--text-primary));
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: color-mix(in srgb, var(--fun-gold) 55%, transparent);
}
.gsb--link::before { display: none; }
.gsb--link:active { transform: none; }

/* ── 变体：圆形图标钮 ── */
.gsb--icon { width: 32px; padding: 0; border-radius: var(--radius-full); }
.gsb--icon.gsb--sm { width: 27px; }
.gsb--icon.gsb--lg { width: 40px; }
.gsb--icon::after {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at 50% 32%, color-mix(in srgb, var(--fun-gold) 13%, transparent), transparent 68%);
  opacity: 0.9;
}

/* ── 变体：建议词胶囊（两枚小星缀在字与边之间）── */
.gsb--pill { letter-spacing: 0.08em; }

/* ── 选中态（胶囊多选 / 页签）：金色浅底 + 实金描边 ── */
.gsb.is-active {
  color: color-mix(in srgb, var(--fun-gold) 38%, var(--text-bright));
  border-color: color-mix(in srgb, var(--fun-gold) 68%, var(--border));
  background: color-mix(in srgb, var(--fun-gold) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fun-gold) 28%, transparent);
}
.gsb.is-active::before { display: none; }

/* ── 变体：主操作（发送 / 停止，墨色实心圆）── */
.gsb--primary {
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--text-primary);
  color: var(--bg-secondary);
  box-shadow: 0 1px 2px color-mix(in srgb, #000 14%, transparent);
}
.gsb--primary:hover:not(.is-disabled) { background: var(--text-bright); }
.gsb--primary::before { display: none; }
.gsb--primary:active { transform: translateY(1px) scale(0.97); }

/* ── 中性色（辅助入口）：金意收敛为墨色，悬停才透金 ── */
.tone-muted { color: color-mix(in srgb, var(--text-secondary) 94%, var(--fun-gold) 6%); border-color: var(--border); }
.tone-muted:hover {
  color: color-mix(in srgb, var(--fun-gold) 40%, var(--text-primary));
  border-color: color-mix(in srgb, var(--fun-gold) 38%, var(--border));
  background: color-mix(in srgb, var(--fun-gold) 5%, transparent);
}
.tone-muted.gsb--link { color: var(--text-secondary); border-color: transparent; }
.tone-muted.gsb--link:hover { color: color-mix(in srgb, var(--fun-gold) 50%, var(--text-primary)); }

/* 紧凑页头：点击范围不缩小，只留下清晰、等大的线性图标。 */
.gsb--toolbar {
  width:44px;
  height:44px;
  flex-shrink:0;
  padding:0;
  border-color:transparent;
  border-radius:var(--radius-md);
  background:transparent;
  box-shadow:none;
  transition:color .3s var(--ease-standard), background .3s var(--ease-standard), transform .3s var(--ease-standard);
}
.gsb--toolbar::before,.gsb--toolbar::after { display:none; }
.gsb--toolbar :slotted(.gsb-icon) { width:20px; height:20px; }
.gsb--toolbar:hover,.gsb--toolbar.is-active {
  color:var(--text-primary);
  border-color:transparent;
  background:color-mix(in srgb,var(--fun-gold) 9%,transparent);
  box-shadow:none;
}
.gsb--toolbar:focus-visible { outline:2px solid var(--accent); outline-offset:-3px; box-shadow:none; }
.tone-muted.gsb--ghost { color: var(--text-secondary); border-color: transparent; }

/* ── 触摸热区 ── */
.gsb--ritual {
  min-width: 240px;
  height: 58px;
  gap: 14px;
  padding: 0 32px;
  font-size: var(--fs-lg);
  letter-spacing: .2em;
  color: var(--bg-secondary);
  background: var(--text-primary);
  border: 1px solid color-mix(in srgb, var(--fun-gold) 68%, var(--text-primary));
  border-radius: var(--radius-full);
  box-shadow: inset 0 0 0 4px var(--text-primary), inset 0 0 0 5px color-mix(in srgb, var(--fun-gold) 48%, transparent), 0 6px 24px color-mix(in srgb, var(--fun-gold) 14%, transparent);
}
.gsb--ritual:hover:not(.is-disabled), .gsb--ritual:focus-visible:not(.is-disabled) {
  color: var(--bg-secondary);
  background: var(--text-bright);
  transform: translateY(-2px);
  box-shadow: inset 0 0 0 4px var(--text-bright), inset 0 0 0 5px var(--fun-gold), 0 0 32px color-mix(in srgb, var(--fun-gold) 45%, transparent);
}
.gsb--ritual :slotted(svg) { width:24px; height:24px; }
.gsb--ritual:active:not(.is-disabled) { transform: translateY(1px); }

/* 仪式圣光：边缘光带循环游走，斜向光束连续掠过，离开后 300ms 淡出。 */
.gsb--ritual::before {
  inset: -70% -30%;
  background: linear-gradient(110deg, transparent 34%, color-mix(in srgb, var(--fun-gold) 12%, transparent) 43%, color-mix(in srgb, var(--fun-gold) 60%, transparent) 49%, color-mix(in srgb, var(--bg-secondary) 48%, transparent) 50%, color-mix(in srgb, var(--fun-gold) 26%, transparent) 54%, transparent 65%);
  animation: gsb-sacred-flow 1.9s linear infinite paused;
  transition: opacity .3s var(--ease-standard);
}
.gsb-light-border {
  position: absolute;
  z-index: -1;
  inset: 0;
  padding: 2px;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  transition: opacity .3s var(--ease-standard);
}
.gsb-light-border > span {
  position: absolute;
  inset: -240px;
  background: conic-gradient(from 0deg, transparent 0deg 65deg, var(--fun-gold) 100deg, var(--bg-secondary) 112deg, transparent 140deg 245deg, var(--fun-gold) 280deg, var(--bg-secondary) 292deg, transparent 320deg);
  animation: gsb-light-orbit 2.8s linear infinite paused;
}
.gsb--ritual:is(:hover, :focus-visible):not(.is-disabled):not(.is-loading)::before,
.gsb--ritual:is(:hover, :focus-visible):not(.is-disabled):not(.is-loading) .gsb-light-border > span { animation-play-state: running; }
.gsb--ritual:is(:hover, :focus-visible):not(.is-disabled):not(.is-loading)::before,
.gsb--ritual:is(:hover, :focus-visible):not(.is-disabled):not(.is-loading) .gsb-light-border { opacity: 1; }

/* 星图契印（提案 K）：凹角细框、两角星图与选中星印。 */
.gsb--sigil {
  --sigil-line: color-mix(in srgb, var(--fun-gold) 36%, var(--text-secondary));
  --sigil-surface: color-mix(in srgb, var(--fun-gold) 3%, var(--bg-secondary));
  width: 104px;
  height: 50px;
  padding: 0 22px;
  gap: 0;
  flex-shrink: 0;
  font-family: 'STSong', 'SimSun', serif;
  font-size: var(--fs-md);
  font-weight: 600;
  letter-spacing: .1em;
  border: 0;
  border-radius: 0;
  overflow: visible;
  color: var(--text-primary);
  background: transparent;
  box-shadow: none;
  transition-duration: .3s;
}
.gsb--sigil::before, .gsb--sigil::after { display:none; }
.gsb-star-map { position:absolute; inset:0; width:100%; height:100%; z-index:-1; overflow:visible; pointer-events:none; }
.gsb-star-frame { fill:var(--sigil-surface); stroke:var(--sigil-line); stroke-width:1; vector-effect:non-scaling-stroke; transition:fill .3s,stroke .3s,filter .3s; }
.gsb-constellation { stroke:var(--sigil-line); stroke-width:.75; transition:stroke .3s,filter .3s; }
.gsb-constellation circle { fill:var(--sigil-surface); stroke-width:1; transition:fill .3s; }
.gsb-star-seal { position:absolute; top:-7px; right:-5px; width:25px; height:25px; color:var(--fun-gold); stroke:currentColor; stroke-width:.9; opacity:0; transform:scale(.65) rotate(-25deg); transition:opacity .3s,transform .3s var(--ease-standard); pointer-events:none; }
.gsb-star-seal-face { fill:var(--bg-secondary); stroke-width:1.2; }
.gsb--sigil:is(:hover, :focus-visible):not(.is-disabled):not(.is-loading) {
  --sigil-line: var(--fun-gold);
  --sigil-surface: color-mix(in srgb, var(--fun-gold) 9%, var(--bg-secondary));
  color:var(--text-primary);
  background:transparent;
  box-shadow:none;
  transform:translateY(-2px);
}
.gsb--sigil:is(:hover, :focus-visible):not(.is-disabled):not(.is-loading) .gsb-star-frame { filter:drop-shadow(0 0 3px color-mix(in srgb,var(--fun-gold) 45%,transparent)); }
.gsb--sigil:is(:hover, :focus-visible):not(.is-disabled):not(.is-loading) .gsb-constellation circle { fill:var(--fun-gold); }
.gsb--sigil.is-active,
.gsb--sigil.is-active:is(:hover, :focus-visible):not(.is-disabled):not(.is-loading) {
  --sigil-line: var(--fun-gold);
  --sigil-surface: color-mix(in srgb, var(--fun-gold) 15%, var(--bg-secondary));
  color:var(--text-primary);
  background:transparent;
  box-shadow:none;
}
.gsb--sigil.is-active .gsb-star-frame { stroke-width:1.4; filter:drop-shadow(0 0 4px color-mix(in srgb,var(--fun-gold) 38%,transparent)); }
.gsb--sigil.is-active .gsb-constellation { filter:drop-shadow(0 0 2px color-mix(in srgb,var(--fun-gold) 50%,transparent)); }
.gsb--sigil.is-active .gsb-constellation circle { fill:var(--fun-gold); }
.gsb--sigil.is-active .gsb-star-seal { opacity:1; transform:scale(1) rotate(0deg); }
.gsb--sigil:focus-visible { outline:2px solid var(--fun-gold); outline-offset:3px; }
.gsb--sigil:active:not(.is-disabled) { transform:translateY(1px) scale(.98); }
.gsb--sigil.is-disabled .gsb-star-frame, .gsb--sigil.is-disabled .gsb-constellation { filter:none; }
@media(max-width:600px) {
  .gsb--sigil { width:92px; height:48px; padding:0 18px; }
  .gsb-star-seal { width:23px; height:23px; top:-6px; right:-3px; }
}
@keyframes gsb-sacred-flow { from { transform: translateX(-85%); } to { transform: translateX(85%); } }
@keyframes gsb-light-orbit { to { transform: rotate(360deg); } }
.gsb.is-touch { min-width: 44px; min-height: 44px; }
.gsb--sigil.is-touch { min-width:92px; }
/* 紧凑图标保留 44px 透明点击热区，视觉直径为原触屏按钮的一半。 */
.gsb--icon.gsb--xs { width:22px; height:22px; min-width:22px; min-height:22px; overflow:visible; }
.gsb--icon.gsb--xs :slotted(svg) { width:8px; height:8px; }
.gsb--icon.gsb--xs::before { display:none; }
.gsb--icon.gsb--xs.is-touch::after { inset:-11px; background:none; }


/* ── 禁用 / 加载 ── */
.gsb.is-disabled {
  opacity: 0.42;
  cursor: not-allowed;
  pointer-events: auto;
  box-shadow: none;
}
.gsb.is-disabled::before, .gsb.is-disabled::after { display: none; }
.gsb.is-disabled .gsb-light-border, .gsb.is-loading .gsb-light-border { display: none; }
.gsb.is-loading { cursor: progress; opacity: 0.75; }

.gsb-spin {
  width: 15px;
  height: 15px;
  border-radius: var(--radius-full);
  border: 1.6px solid color-mix(in srgb, currentColor 28%, transparent);
  border-top-color: currentColor;
  animation: gsb-turn 0.9s linear infinite;
}
@keyframes gsb-turn { to { transform: rotate(360deg); } }
</style>
