<script setup>
import { computed } from 'vue'
const props = defineProps({ focus: Boolean, emblem: Boolean })
const viewBox = computed(() => {
  if (props.emblem) return '154 48 252 252'
  if (props.focus) return '118 34 324 324'
  return '0 0 560 560'
})
</script>

<template>
  <svg class="angel-emblem" :viewBox="viewBox" aria-hidden="true">
    <defs>
      <radialGradient id="angelGlow" cx="280" cy="170" r="210" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#FFF3CF" stop-opacity="0.85" />
        <stop offset="0.55" stop-color="#FBE7B8" stop-opacity="0.25" />
        <stop offset="1" stop-color="#FBE7B8" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="angelHair" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FBF1D6" />
        <stop offset="0.55" stop-color="#EBD7A6" />
        <stop offset="1" stop-color="#D5B97C" />
      </linearGradient>
      <linearGradient id="angelHairFront" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFF7E0" />
        <stop offset="1" stop-color="#EFDDB0" />
      </linearGradient>
      <linearGradient id="angelSkin" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFF6EA" />
        <stop offset="1" stop-color="#FBE6D3" />
      </linearGradient>
      <linearGradient id="angelNeck" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#EBCDB5" />
        <stop offset="0.45" stop-color="#F8E6D3" />
        <stop offset="1" stop-color="#FCEEDF" />
      </linearGradient>
      <radialGradient id="angelBlush" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#F6A9A3" stop-opacity="0.55" />
        <stop offset="1" stop-color="#F6A9A3" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="angelRobe" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFFFFF" />
        <stop offset="1" stop-color="#EFE6D3" />
      </linearGradient>
      <linearGradient id="angelWingR3" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#E6D9BE" />
        <stop offset="1" stop-color="#FBF6EA" />
      </linearGradient>
      <linearGradient id="angelWingR2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#EFE5CE" />
        <stop offset="1" stop-color="#FFFDF6" />
      </linearGradient>
      <filter id="angelRowSh" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="3" stdDeviation="2.2" flood-color="#9A7B4B" flood-opacity="0.26" />
      </filter>
      <linearGradient id="angelFadeGrad" x1="0" y1="476" x2="0" y2="552" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fff" />
        <stop offset="1" stop-color="#000" />
      </linearGradient>
      <mask id="angelFade" maskUnits="userSpaceOnUse" x="0" y="0" width="560" height="560">
        <rect width="560" height="560" fill="url(#angelFadeGrad)" />
      </mask>
      <path id="angelFacePath" d="M224 172C224 132 248 112 280 112c32 0 56 20 56 60 0 34-12 56-32 72q-24 20-48 0c-20-16-32-38-32-72Z" />
      <clipPath id="angelFaceClip"><use href="#angelFacePath" /></clipPath>
      <g id="angelFeather">
        <path d="M0 0C-40-24-120-30-176-8-122-2-52 10 0 0Z" vector-effect="non-scaling-stroke" />
        <path d="M-10-1C-60-10-110-12-160-8" fill="none" stroke="#D3BC8E" stroke-width="1.3" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      </g>
      <g id="angelWing" stroke="#C4A972" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">
        <g filter="url(#angelRowSh)">
          <g transform="translate(100 358) rotate(14)"><path d="M-20 0C-20 62.5-9 122.1-8.5 142 10 122.1 20 62.5 20 0Z" fill="url(#angelWingR3)" /><path d="M0 22.7Q-2.6 78.1-7.8 127.8" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
          <g transform="translate(121.2 336.8) rotate(11.4)"><path d="M-20 0C-20 65.6-9 128.3-9 149.2 10 128.3 20 65.6 20 0Z" fill="url(#angelWingR3)" /><path d="M0 23.9Q-2.7 82.1-8.2 134.3" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
          <g transform="translate(142.4 327.9) rotate(8.8)"><path d="M-20 0C-20 63.4-9 123.9-8.6 144.1 10 123.9 20 63.4 20 0Z" fill="url(#angelWingR3)" /><path d="M0 23Q-2.6 79.2-8 129.6" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
          <g transform="translate(163.6 325.8) rotate(6.2)"><path d="M-20 0C-20 58.2-9 113.7-7.9 132.2 10 113.7 20 58.2 20 0Z" fill="url(#angelWingR3)" /><path d="M0 21.2Q-2.4 72.7-7.3 119" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
          <g transform="translate(184.8 330.8) rotate(3.6)"><path d="M-20 0C-20 49.8-9 97.4-6.8 113.2 10 97.4 20 49.8 20 0Z" fill="url(#angelWingR3)" /><path d="M0 18.1Q-2 62.3-6.3 101.9" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
          <g transform="translate(206 346.2) rotate(1)"><path d="M-20 0C-20 36.9-9 72.1-5 83.8 10 72.1 20 36.9 20 0Z" fill="url(#angelWingR3)" /><path d="M0 13.4Q-1.5 46.1-4.6 75.4" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
        </g>
        <g filter="url(#angelRowSh)">
          <g transform="translate(110 332) rotate(11)"><path d="M-17 0C-17 54.3-9.4 101.5-7.1 118 10.2 103.8 17 54.3 17 0Z" fill="url(#angelWingR2)" /><path d="M0 18.9Q-2.1 64.9-6.5 106.2" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
          <g transform="translate(131.5 315.1) rotate(8.5)"><path d="M-17 0C-17 55.6-9.4 104-7.3 120.9 10.2 106.4 17 55.6 17 0Z" fill="url(#angelWingR2)" /><path d="M0 19.3Q-2.2 66.5-6.7 108.8" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
          <g transform="translate(153 308.9) rotate(6)"><path d="M-17 0C-17 52-9.4 97.3-6.8 113.1 10.2 99.6 17 52 17 0Z" fill="url(#angelWingR2)" /><path d="M0 18.1Q-2 62.2-6.2 101.8" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
          <g transform="translate(174.5 312.3) rotate(3.5)"><path d="M-17 0C-17 44-9.4 82.3-5.7 95.7 10.2 84.2 17 44 17 0Z" fill="url(#angelWingR2)" /><path d="M0 15.3Q-1.7 52.6-5.3 86.1" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
          <g transform="translate(196 322) rotate(1)"><path d="M-17 0C-17 33.1-9.4 61.9-4.3 72 10.2 63.3 17 33.1 17 0Z" fill="url(#angelWingR2)" /><path d="M0 11.5Q-1.3 39.6-4 64.8" fill="none" stroke="#D8C69C" stroke-width="1.1" /></g>
        </g>
        <g filter="url(#angelRowSh)">
          <g transform="translate(101.2 320.8) rotate(8)"><path d="M-13.5 0-13.5 25C-13.5 58.3 13.5 58.3 13.5 25L13.5 0Z" fill="#FFFEFB" /></g>
          <g transform="translate(119 303) rotate(6.8)"><path d="M-13.5 0-13.5 25C-13.5 58.3 13.5 58.3 13.5 25L13.5 0Z" fill="#FFFEFB" /></g>
          <g transform="translate(136.8 293.6) rotate(5.7)"><path d="M-13.5 0-13.5 25C-13.5 58.3 13.5 58.3 13.5 25L13.5 0Z" fill="#FFFEFB" /></g>
          <g transform="translate(154.6 288.4) rotate(4.5)"><path d="M-13.5 0-13.5 25C-13.5 58.3 13.5 58.3 13.5 25L13.5 0Z" fill="#FFFEFB" /></g>
          <g transform="translate(172.4 291.8) rotate(3.3)"><path d="M-13.5 0-13.5 25C-13.5 58.3 13.5 58.3 13.5 25L13.5 0Z" fill="#FFFEFB" /></g>
          <g transform="translate(190.2 297.3) rotate(2.2)"><path d="M-13.5 0-13.5 25C-13.5 58.3 13.5 58.3 13.5 25L13.5 0Z" fill="#FFFEFB" /></g>
          <g transform="translate(208 311.8) rotate(1)"><path d="M-13.5 0-13.5 25C-13.5 58.3 13.5 58.3 13.5 25L13.5 0Z" fill="#FFFEFB" /></g>
        </g>
        <path d="M218 300C200 248 130 238 88 322c-2 8 6 12 12 6 28-44 82-46 118-2Z" fill="#FFFBF2" stroke="#C4A972" stroke-width="1.8" />
        <path d="M206 286C176 252 130 258 104 306" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity="0.9" />
        <path d="M200 312C176 292 140 292 114 322" fill="none" stroke="#E7DBC0" stroke-width="1.3" stroke-linecap="round" />
      </g>
      <g id="angelEye">
        <path d="M236 187Q251 180 268 188" fill="none" stroke="#9A7656" stroke-width="1.6" stroke-linecap="round" opacity="0.7" />
        <path d="M230 194Q251 216 272 195 251 207 230 194Z" fill="#4A3524" stroke="#4A3524" stroke-width="1.5" stroke-linejoin="round" />
        <path d="M231 194L225 189" fill="none" stroke="#4A3524" stroke-width="3" stroke-linecap="round" />
        <path d="M238 205L235 210M246 209L245 214" fill="none" stroke="#4A3524" stroke-width="1.8" stroke-linecap="round" />
      </g>
      <path id="angelSpark" d="M0-12Q1.5-1.5 12 0 1.5 1.5 0 12-1.5 1.5-12 0-1.5-1.5 0-12Z" />
    </defs>

    <g mask="url(#angelFade)">
      <circle v-if="!emblem" cx="280" cy="170" r="210" fill="url(#angelGlow)" />

      <g v-if="!emblem" fill="#FFFDF6" stroke="#CDB382" stroke-width="1.3" stroke-linejoin="round">
        <use href="#angelFeather" transform="translate(96 118) rotate(28) scale(0.17)" />
        <use href="#angelFeather" transform="translate(478 150) rotate(160) scale(0.15)" />
        <use href="#angelFeather" transform="translate(500 262) rotate(70) scale(0.12)" />
        <use href="#angelFeather" transform="translate(70 236) rotate(-20) scale(0.11)" />
      </g>
      <g v-if="!emblem" fill="#D8B878">
        <use href="#angelSpark" transform="translate(150 64)" />
        <use href="#angelSpark" transform="translate(424 84) scale(0.8)" />
        <use href="#angelSpark" transform="translate(52 170) scale(0.55)" />
        <use href="#angelSpark" transform="translate(516 214) scale(0.5)" />
      </g>

      <use href="#angelWing" />
      <use href="#angelWing" transform="translate(560 0) scale(-1 1)" />

      <path d="M214 180C204 104 244 84 280 84s72 20 66 96c-2 60 20 120 6 174-12 10-24-8-24-36-2-16-22-20-48-20s-46 4-48 20c0 28-12 46-24 36-14-54 8-114 6-174Z" fill="url(#angelHair)" stroke="#BFA165" stroke-width="2.2" stroke-linejoin="round" />
      <g fill="none" stroke="#C9AE74" stroke-width="1.5" stroke-linecap="round" opacity="0.85">
        <path d="M222 220C220 270 226 310 214 346" />
        <path d="M236 250C236 290 238 320 232 346" />
        <path d="M338 220C340 270 334 310 346 346" />
        <path d="M324 250C324 290 322 320 328 346" />
      </g>

      <path d="M172 560C170 440 176 362 212 328c16-14 28-22 38-27q30 17 60 0c10 5 22 13 38 27 36 34 42 112 40 232Z" fill="url(#angelRobe)" stroke="#BFA16B" stroke-width="2.2" stroke-linejoin="round" />
      <path d="M250 301C226 322 212 360 208 560h34c-2-140 2-216 8-259Z" fill="#E9DEC8" opacity="0.8" />
      <path d="M310 301C334 322 348 360 352 560h-34c2-140-2-216-8-259Z" fill="#E9DEC8" opacity="0.55" />
      <g fill="none" stroke="#D2BD93" stroke-width="1.6" stroke-linecap="round">
        <path d="M206 352C200 420 198 500 196 560" />
        <path d="M354 352C360 420 362 500 364 560" />
      </g>

      <path d="M266 238 264 298 246 304 280 346 314 304 296 298 294 238Z" fill="url(#angelNeck)" />
      <path d="M240 304 280 350 320 304" fill="none" stroke="#D3B070" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M280 352 288 362 280 372 272 362Z" fill="#BFDDE3" stroke="#D3B070" stroke-width="2" stroke-linejoin="round" />

      <ellipse cx="280" cy="260" rx="22" ry="7" fill="#DDBBA2" opacity="0.4" />

      <use href="#angelFacePath" fill="url(#angelSkin)" stroke="#C49C80" stroke-width="2" stroke-linejoin="round" />

      <g clip-path="url(#angelFaceClip)">
        <path d="M200 100h160v102l-24 44-10-46q-8-14-16-26-6 14-14 16-4-8-12-16-8 10-16 14-4-6-12-14-8 12-16 16l-6 10-10 46-24-44Z" fill="#EDD0B8" opacity="0.6" />
      </g>

      <ellipse cx="246" cy="222" rx="16" ry="8" fill="url(#angelBlush)" />
      <ellipse cx="314" cy="222" rx="16" ry="8" fill="url(#angelBlush)" />

      <use href="#angelEye" transform="translate(0 4)" />
      <use href="#angelEye" transform="translate(560 4) scale(-1 1)" />

      <path d="M278 219Q281 223 284 220" fill="none" stroke="#D2A890" stroke-width="1.8" stroke-linecap="round" />
      <path d="M271 233Q280 239 289 233" fill="none" stroke="#C07B6E" stroke-width="2.6" stroke-linecap="round" />

      <path id="angelLockL" d="M226 196C218 236 228 280 216 332c-4 18-16 20-16 4 2-46 6-92 26-140Z" fill="url(#angelHairFront)" stroke="#BFA165" stroke-width="2" stroke-linejoin="round" />
      <use href="#angelLockL" transform="translate(560 0) scale(-1 1)" />

      <path d="M220 194C210 118 244 92 280 92s70 26 60 102l-4 44-10-48q-8-14-16-24-6 12-14 16-4-8-12-16-8 10-16 14-4-6-12-14-8 12-16 16l-6 8-10 48Z" fill="url(#angelHairFront)" stroke="#BFA165" stroke-width="2.2" stroke-linejoin="round" />
      <g fill="none" stroke="#CDB27A" stroke-width="1.5" stroke-linecap="round" opacity="0.9">
        <path d="M280 98C278 124 280 150 280 172" />
        <path d="M262 102C256 128 256 150 258 172" />
        <path d="M298 102C304 128 304 150 302 172" />
        <path d="M242 112C236 136 234 160 232 186" />
        <path d="M318 112C324 136 326 160 328 186" />
      </g>
      <path d="M238 132Q280 108 324 132" fill="none" stroke="#FFFDF2" stroke-width="9" stroke-linecap="round" opacity="0.8" />

      <g transform="translate(322 128) rotate(24)">
        <path d="M0 0C6-12 20-14 30-8 22-1 10 5 0 0Z" fill="#E7C985" stroke="#B99346" stroke-width="1.6" stroke-linejoin="round" />
        <path d="M2 0 24-7" stroke="#B99346" stroke-width="1.3" stroke-linecap="round" />
      </g>

      <ellipse cx="280" cy="64" rx="56" ry="12" fill="none" stroke="#FFF1C0" stroke-width="9" opacity="0.55" />
      <ellipse cx="280" cy="64" rx="56" ry="12" fill="none" stroke="#D8B467" stroke-width="4" />
      <path d="M232 60Q280 50 328 60" fill="none" stroke="#FFF8DB" stroke-width="1.6" stroke-linecap="round" opacity="0.9" />
    </g>
  </svg>
</template>

<style scoped>
.angel-emblem { display:block; width:100%; height:100%; overflow:hidden; }
</style>
