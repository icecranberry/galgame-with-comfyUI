<template>
  <div class="game-nsfw-ribbon">
    <span class="game-nsfw-ribbon__silk">
      <span class="game-nsfw-ribbon__label">NSFW</span>
    </span>
  </div>
</template>

<style scoped>
.game-nsfw-ribbon {
  position: absolute;
  top: 0;
  right: 0;
  width: 156px;
  height: 120px;
  overflow: hidden;
  pointer-events: none;
}

.game-nsfw-ribbon__silk {
  position: absolute;
  top: 42px;
  right: 62px;
  display: grid;
  place-items: center;
  width: 240px;
  height: 32px;
  /* Extend both ends beyond the crop so the card edges close the ribbon. */
  transform: translate(50%, -50%) rotate(37deg);
  border-block: 1px solid var(--game-nsfw-ribbon-gold);
  background:
    repeating-linear-gradient(103deg, #ffecfb07 0 1px, transparent 1px 3px),
    linear-gradient(130deg, var(--game-nsfw-ribbon) 16%, var(--game-nsfw-ribbon-highlight) 42% 47%,
      var(--game-nsfw-ribbon) 78%);
  box-shadow:
    inset 0 3px var(--game-nsfw-ribbon-deep), inset 0 -3px var(--game-nsfw-ribbon-deep),
    inset 0 4px var(--game-nsfw-ribbon-trim), inset 0 -4px var(--game-nsfw-ribbon-trim),
    0 1px 2px #2d193b30;
}

.game-nsfw-ribbon__silk::before,
.game-nsfw-ribbon__silk::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  height: 5px;
  background:
    radial-gradient(ellipse 3.5px 4.5px at 50% 100%, transparent 37%, var(--game-nsfw-ribbon-gold) 53% 66%,
      var(--game-nsfw-ribbon-trim) 77%, transparent 100%) 0 0 / 8px 5px repeat-x;
}

.game-nsfw-ribbon__silk::before { top: -5px; }
.game-nsfw-ribbon__silk::after { bottom: -5px; transform: scaleY(-1); }

.game-nsfw-ribbon__label {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--game-nsfw-ribbon-ink);
  font: 700 12px/1 Georgia, serif;
  letter-spacing: .14em;
  text-shadow: 0 1px 2px var(--game-nsfw-ribbon-deep);
}

.game-nsfw-ribbon__label::before,
.game-nsfw-ribbon__label::after {
  content: '';
  width: 24px;
  height: 9px;
  background: linear-gradient(to right, var(--game-nsfw-ribbon-trim), var(--game-nsfw-ribbon-gold));
  clip-path: polygon(0 50%, 25% 42%, 37% 18%, 49% 42%, 67% 40%, 77% 0,
    86% 39%, 100% 50%, 86% 61%, 77% 100%, 67% 60%, 49% 58%, 37% 82%, 25% 58%);
}

.game-nsfw-ribbon__label::after { transform: scaleX(-1); }

@media (max-width: 600px) {
  .game-nsfw-ribbon { width: 112px; height: 88px; }
  .game-nsfw-ribbon__silk { top: 29px; right: 42px; height: 24px; }
  .game-nsfw-ribbon__label { gap: 4px; font-size: 10px; letter-spacing: .1em; }
  .game-nsfw-ribbon__label::before,
  .game-nsfw-ribbon__label::after { width: 14px; height: 7px; }
}
</style>
