<template>
  <div
    class="gsb"
    :class="[`gsb--${variant}`, `gsb--${size}`, `tone-${tone}`, { 'is-disabled': disabled, 'is-loading': loading, 'is-touch': touchTarget }]"
    role="button"
    :tabindex="disabled ? -1 : 0"
    :aria-disabled="disabled || loading ? 'true' : undefined"
    :aria-busy="loading ? 'true' : undefined"
    @click="onClick"
    @keydown.enter.prevent="onClick"
    @keydown.space.prevent="onClick"
  >
    <span v-if="loading" class="gsb-spin" aria-hidden="true" />
    <slot v-else />
  </div>
</template>

<script setup>
const props = defineProps({
  variant: { type: String, default: 'line' }, // line | ghost | link | icon | pill | primary
  size: { type: String, default: 'md' },      // sm | md | lg
  tone: { type: String, default: 'gold' },    // gold | muted
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  touchTarget: { type: Boolean, default: false },
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
.tone-muted.gsb--ghost { color: var(--text-secondary); border-color: transparent; }

/* ── 触摸热区 ── */
.gsb.is-touch { min-width: 44px; min-height: 44px; }

/* ── 禁用 / 加载 ── */
.gsb.is-disabled {
  opacity: 0.42;
  cursor: not-allowed;
  pointer-events: auto;
  box-shadow: none;
}
.gsb.is-disabled::before, .gsb.is-disabled::after { display: none; }
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
