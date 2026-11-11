<template>
  <svg class="studio-developing-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M9 8V3h14v5M8 22H5a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h22a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3" />
    <circle class="printing-light" cx="25" cy="12" r="1" fill="currentColor" stroke="none" />
    <path d="M6 16h20" />
    <svg x="8" y="16" width="16" height="15" viewBox="0 0 16 15" overflow="hidden">
      <g class="printing-photo">
        <path d="M1 0h14v13H1z" />
        <g class="printing-image">
          <circle cx="11" cy="4" r="1" fill="currentColor" stroke="none" />
          <path d="m3 9 3-4 3 3 2-1 2 2v1H3z" fill="currentColor" stroke="none" />
        </g>
      </g>
    </svg>
  </svg>
</template>

<style scoped>
.studio-developing-icon { width:28px; height:28px; flex-shrink:0; }
.printing-photo { animation:studio-photo-output 2.8s ease-in-out infinite; }
.printing-image { animation:studio-photo-ink 2.8s ease-in-out infinite; }
.printing-light { animation:studio-printer-light 1.4s ease-in-out infinite; }
@keyframes studio-photo-output {
  0%,10% { transform:translateY(-14px); opacity:1; }
  70%,88% { transform:translateY(0); opacity:1; }
  97%,100% { transform:translateY(0); opacity:0; }
}
@keyframes studio-photo-ink {
  0%,20% { opacity:.2; }
  65%,100% { opacity:1; }
}
@keyframes studio-printer-light {
  0%,100% { opacity:.3; }
  50% { opacity:1; }
}
@media(prefers-reduced-motion:reduce) {
  .printing-photo,.printing-image,.printing-light { animation:none; }
}
</style>
