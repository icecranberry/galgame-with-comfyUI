(() => {
  const el = (id) => document.getElementById(id);
  const audio = window.TavernAudio;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, motion.matches ? 1 : ms));
  let scene,
    bundle,
    generation = 0,
    closing,
    trigger,
    rendererReady,
    resolveRenderer,
    locked = false;
  let mode = '',
    step = 0;
  const titles = ['基酒与冰', '魔药', '点睛风味', '滑杯递出'];
  const stepIcons = ['bottle', 'vial', 'leaf', 'cocktail'];
  function rendererState(state) {
    el('workshop').dataset.renderer = state;
    el('scene-canvas').setAttribute('aria-busy', String(state === 'loading'));
    if (state !== 'loading') {
      resolveRenderer?.();
      resolveRenderer = null;
    }
  }
  function activeScene() {
    return el('workshop').dataset.renderer === 'webgl' ? scene : null;
  }
  function loadScene() {
    if (!bundle)
      bundle = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = './vendor/bar-scene.js';
        script.onload = () => resolve(window.TavernBar3D || null);
        script.onerror = () => {
          script.remove();
          bundle = null;
          resolve(null);
        };
        document.head.append(script);
      });
    return bundle;
  }
  function dispose() {
    generation++;
    scene?.dispose();
    scene = null;
    el('glass').classList.remove('sliding', 'shaking');
    rendererState('idle');
  }
  function reset() {
    step = 0;
    el('mix-steps').classList.remove('has-moved');
    el('workshop').style.removeProperty('--step-direction');
  }
  function open(getRecipe, render) {
    if (closing || mode) return;
    trigger = document.activeElement;
    mode = 'mix';
    const dialog = el('station');
    dialog.dataset.mode = mode;
    rendererReady = new Promise(resolve => { resolveRenderer = resolve; });
    rendererState('loading');
    dialog.showModal();
    audio?.play('workshopOpen');
    render();
    dialog.querySelector('[data-action="station-close"]').focus();
    const epoch = ++generation;
    const active = () => epoch === generation && !closing && mode === 'mix';
    const fallback = () => {
      if (!active()) return;
      scene?.dispose();
      scene = null;
      rendererState('fallback');
      render();
    };
    void (async () => {
      try {
        const api = await loadScene();
        if (!active()) return;
        if (!api) {
          fallback();
          return;
        }
        const plate = await api.prepare();
        if (!active()) return;
        scene = api.create(el('scene-canvas'), fallback, plate, () => {
          if (!active()) return;
          rendererState('webgl');
          render();
        }, sound => { if (active()) void audio?.play(sound); });
        if (!scene) {
          fallback();
          return;
        }
        scene.restore(getRecipe());
      } catch {
        fallback();
      }
    })();
  }
  async function close() {
    if (!mode) return;
    if (closing) return closing;
    const dialog = el('station');
    audio?.play('close');
    dialog.classList.add('closing');
    dialog.inert = true;
    closing = wait(300).then(() => {
      dispose();
      dialog.close();
      dialog.classList.remove('closing');
      dialog.inert = false;
      mode = '';
      closing = null;
      locked = false;
      trigger?.focus({ preventScroll: true });
    });
    return closing;
  }
  function draw(recipe, guest, canServe, message, view, setContent) {
    const nav = el('mix-steps');
    const loading = el('workshop').dataset.renderer === 'loading';
    nav.style.setProperty('--step', step);
    el('step-title').textContent = ['挑选基酒', '滴入魔药', '装点杯口', '把酒递给谁'][step];
    setContent(
      nav,
      titles
        .map((title, i) =>
          view.button('step', view.icon(stepIcons[i]) + '<span>' + title + '</span>', {
            id: i,
            disabled: i > 0 && !recipe.baseLiquor,
            attrs: i === step ? 'aria-current="step"' : '',
          }),
        )
        .join(''),
    );
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = Number(panel.dataset.panel) !== step;
    });
    const potionToolbar = el('potion-toolbar');
    potionToolbar.hidden = step !== 1;
    potionToolbar.querySelector('.clear-potions').disabled = locked || loading || recipe.potions.length === 0;
    const next = el('station').querySelector('[data-action="step-next"]');
    for (const choice of el('station').querySelectorAll('[data-action="ice"]')) {
      choice.disabled = locked || loading || !recipe.baseLiquor;
      choice.setAttribute('aria-pressed', String(recipe.iceCount === Number(choice.dataset.id)));
    }
    const stirButton = el('station').querySelector('[data-action="stir"]');
    stirButton.hidden = !recipe.baseLiquor;
    stirButton.disabled = locked;
    next.hidden = step === 3;
    next.disabled = !recipe.baseLiquor;
    setContent(next, ['选魔药', '选风味', '选接酒人', ''][step] + view.icon('forward'));
    const serve = el('station').querySelector('[data-action="pour"]');
    serve.hidden = step !== 3;
    serve.disabled = locked || loading || !canServe;
    serve.textContent = guest ? '递给 ' + guest.name : '请选择接酒人';
    el('mix-status').textContent = message || (loading ? '准备杯具…' :
      step === 0
        ? window.TavernMix.base(recipe)?.name || '先选一种基酒'
        : step === 1
          ? ''
          : step === 2
            ? '点睛风味可选'
            : '选择接酒的角色');
    el('station').querySelector('.step-content').inert = locked;
  }
  function restore(recipe) {
    el('glass').classList.remove('sliding');
    activeScene()?.restore(recipe);
  }
  function settleGlint() {
    if (motion.matches) return;
    el('glass-model').querySelector('.liquid-glint')?.animate([
      { opacity: 0.95, transform: 'translateY(-2px)' },
      { opacity: 0.55, transform: 'translateY(1.3px)', offset: 0.28 },
      { opacity: 0.82, transform: 'translateY(-0.7px)', offset: 0.58 },
      { opacity: 0.58, transform: 'translateY(0)' },
    ], { duration: 1100, easing: 'ease-out' });
  }
  async function act(work, render) {
    if (locked || mode !== 'mix' || closing) return;
    const epoch = generation;
    locked = true;
    render();
    try {
      if (el('workshop').dataset.renderer === 'loading') await rendererReady;
      if (!closing && epoch === generation) await work();
    } finally {
      if (epoch === generation) {
        locked = false;
        render();
      }
    }
  }
  async function fillSvg() {
    const contents = el('glass-model').querySelector('.cup-contents');
    if (!contents) return;
    const distance = Number(contents.dataset.rise);
    const epoch = generation;
    const duration = motion.matches ? 320 : 900;
    let elapsed = 0, previous;
    contents.setAttribute('transform', `translate(0 ${distance})`);
    while (elapsed < duration && epoch === generation && !closing && contents.isConnected) {
      const now = await new Promise(requestAnimationFrame);
      elapsed += Math.min(80, now - (previous ?? now));
      previous = now;
      const p = Math.min(1, elapsed / duration);
      contents.setAttribute('transform', `translate(0 ${distance * (1 - p * p * (3 - 2 * p))})`);
    }
    contents.removeAttribute('transform');
  }
  async function ingredient(action, recipe) {
    const renderer = activeScene();
    if (action === 'base' || action === 'potion') {
      if (renderer) await renderer.pour(recipe, action);
      if (!closing && el('workshop').dataset.renderer === 'fallback') {
        if (!renderer) void audio?.play(action === 'base' ? 'pour' : 'drop');
        if (action === 'base') await fillSvg();
        settleGlint();
      }
    } else if (action === 'garnish') {
      renderer?.setGarnish(recipe);
      if (action === 'garnish' && recipe.garnish) void audio?.play('garnish');
    } else restore(recipe);
  }
  function next(render) {
    if (step < 3) {
      setStep(step + 1);
      render();
    }
  }
  function setStep(index) {
    if (!Number.isInteger(index) || index < 0 || index > 3 || index === step || closing) return;
    el('mix-steps').classList.add('has-moved');
    el('workshop').style.setProperty('--step-direction', index > step ? '10px' : '-10px');
    step = index;
    audio?.play('page');
  }
  async function stir(recipe, render) {
    if (!recipe.baseLiquor) return;
    await act(async () => {
      el('glass').classList.add('shaking');
      const renderer = activeScene();
      if (renderer) await renderer.stir();
      else {
        void audio?.play('stir');
        await wait(520);
        settleGlint();
      }
      el('glass').classList.remove('shaking');
      recipe.mixedDrops = recipe.potions.length;
    }, render);
  }
  async function serve() {
    void audio?.play('serve');
    const renderer = activeScene();
    if (renderer) await renderer.serve();
    else {
      el('glass').classList.add('sliding');
      await wait(520);
    }
  }
  window.TavernStation = {
    open,
    close,
    reset,
    draw,
    act,
    ingredient,
    next,
    stir,
    restore,
    serve,
    dispose,
    get mode() {
      return mode;
    },
    get locked() {
      return locked;
    },
    setStep,
    setIce(recipe, count) {
      if (!recipe.baseLiquor || ![0, 2, 5].includes(count) || recipe.iceCount === count) return;
      const renderer = activeScene();
      if (!renderer && count > recipe.iceCount) void audio?.play('ice');
      recipe.iceCount = count;
      renderer?.setIce(count);
    },
  };
  const warm = () => void loadScene().then((api) => api?.prepare()).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2500 });
  else window.addEventListener('load', warm, { once: true });
  window.addEventListener('pagehide', dispose);
})();
