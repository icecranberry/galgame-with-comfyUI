<template>
  <svg class="god-entry-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
    <ellipse class="god-entry-mark__halo" cx="24" cy="9" rx="9" ry="3.5" />
    <g class="god-entry-mark__wings" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 36c-3 3-8 2-10-1-4 0-7-3-6-6-3-1-4-5-2-7-2-3-1-7 0-9 3 6 9 7 13 10 5 3 7 8 5 13Z" />
      <path d="M27 36c3 3 8 2 10-1 4 0 7-3 6-6 3-1 4-5 2-7 2-3 1-7 0-9-3 6-9 7-13 10-5 3-7 8-5 13Z" />
      <path class="god-entry-mark__feathers" d="M3 22c2 3 6 5 10 5M5 29c3 3 6 4 10 3M45 22c-2 3-6 5-10 5M43 29c-3 3-6 4-10 3" />
    </g>
  </svg>
</template>

<style scoped>
.god-entry-mark {
  display: block;
  width: 100%;
  height: 100%;
  color: color-mix(in srgb, var(--fun-gold) 45%, var(--text-primary));
}
.god-entry-mark__halo {
  stroke: currentColor;
  stroke-width: 2.5;
}
.god-entry-mark__wings {
  fill: color-mix(in srgb, var(--fun-gold) 12%, var(--bg-secondary));
  stroke: currentColor;
  stroke-width: 2;
}
.god-entry-mark__feathers { fill: none; }
</style>
