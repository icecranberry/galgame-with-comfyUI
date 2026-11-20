(() => {
  const el = (id) => document.getElementById(id);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, motion.matches ? 1 : ms));
  let scene,
    bundle,
    generation = 0,
    closing,
    trigger,
    locked = false;
  let mode = '',
    step = 0;
  const titles = ['基酒与冰', '魔药', '点睛风味', '滑杯递出'];
  function rendererState(state) {
    const workshop = el('workshop');
    workshop.dataset.renderer = state;
    workshop.querySelector('.mix-tray').inert = state === 'loading';
    el('scene-canvas').setAttribute('aria-busy', String(state === 'loading'));
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
    window.TavernAudio?.close();
    scene?.dispose();
    scene = null;
    rendererState('idle');
  }
  function reset() {
    step = 0;
  }
  function open(kind, getRecipe, render) {
    if (mode || closing) return;
    mode = kind;
    trigger = document.activeElement;
    const dialog = el('station');
    dialog.dataset.mode = kind;
    el('station-title').textContent = kind === 'mix' ? '调酒工坊' : '传闻委托板';
    el('commission-board').hidden = kind !== 'board';
    el('workshop').hidden = kind !== 'mix';
    if (kind === 'mix') rendererState('loading');
    dialog.showModal();
    render();
    dialog.querySelector('[data-action="station-close"]').focus();
    if (kind !== 'mix') return;
    window.TavernAudio?.open();
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
          if (active()) rendererState('webgl');
        }, sound => { if (active()) void window.TavernAudio?.play(sound); });
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
    window.TavernAudio?.close();
    dialog.classList.add('closing');
    closing = wait(300).then(() => {
      dispose();
      dialog.close();
      dialog.classList.remove('closing');
      mode = '';
      closing = null;
      locked = false;
      trigger?.focus({ preventScroll: true });
    });
    return closing;
  }
  function draw(recipe, guest, canServe, view, setContent) {
    const nav = el('mix-steps');
    el('step-title').textContent = ['挑选基酒', '滴入魔药', '装点杯口', '把酒递给谁'][step];
    setContent(
      nav,
      titles
        .map((title, i) =>
          view.button('step', '<small>0' + (i + 1) + '</small> ' + title, {
            id: i,
            disabled: locked || (i > 0 && !recipe.baseLiquor),
            attrs: i === step ? 'aria-current="step"' : '',
          }),
        )
        .join(''),
    );
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = Number(panel.dataset.panel) !== step;
    });
    const next = el('station').querySelector('[data-action="step-next"]');
    for (const choice of el('station').querySelectorAll('[data-action="ice"]')) {
      choice.disabled = locked || !recipe.baseLiquor;
      choice.setAttribute('aria-pressed', String(recipe.iceCount === Number(choice.dataset.id)));
    }
    const stirButton = el('station').querySelector('[data-action="stir"]');
    stirButton.hidden = !recipe.baseLiquor;
    stirButton.disabled = locked;
    next.hidden = step === 3;
    next.disabled = locked || !recipe.baseLiquor;
    next.textContent = ['选魔药 →', '选风味 →', '选接酒人 →', ''][step];
    const serve = el('station').querySelector('[data-action="pour"]');
    serve.hidden = step !== 3;
    serve.disabled = locked || !canServe;
    serve.textContent = guest ? '递给 ' + guest.name : '请选择接酒人';
    el('mix-status').textContent =
      step === 0
        ? window.TavernMix.base(recipe)?.name || '先选一种基酒'
        : step === 1
          ? '魔药 ' + recipe.potions.length + ' / 3 滴'
          : step === 2
            ? '点睛风味可选'
            : '选择接酒邻居';
    el('station').querySelector('.step-content').inert = locked;
  }
  function restore(recipe) {
    scene?.restore(recipe);
  }
  async function act(work, render) {
    if (locked || mode !== 'mix' || closing) return;
    locked = true;
    render();
    try {
      await work();
    } finally {
      locked = false;
      render();
    }
  }
  async function ingredient(action, recipe) {
    if (action === 'base' || action === 'potion') {
      if (scene) await scene.pour(recipe, action);
      else {
        void window.TavernAudio?.play(action === 'base' ? 'pour' : 'drop');
        if (action === 'base') await wait(160);
      }
    } else if (action === 'garnish' || action === 'custom') {
      scene?.setGarnish(recipe);
      if (action === 'garnish' && recipe.garnish) void window.TavernAudio?.play('garnish');
    } else restore(recipe);
  }
  function next(render) {
    if (step < 3) {
      step++;
      render();
    }
  }
  async function stir(recipe, render) {
    if (!recipe.baseLiquor) return;
    await act(async () => {
      el('glass').classList.add('shaking');
      if (scene) await scene.stir();
      else {
        void window.TavernAudio?.play('stir');
        await wait(520);
      }
      el('glass').classList.remove('shaking');
      recipe.mixedDrops = recipe.potions.length;
    }, render);
  }
  async function serve() {
    if (scene) await scene.serve();
    else {
      el('glass').classList.add('sliding');
      await wait(700);
      el('glass').classList.remove('sliding');
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
    setStep(i) {
      if (i >= 0 && i < 4 && !locked) step = i;
    },
    setIce(recipe, count) {
      if (!recipe.baseLiquor || ![0, 2, 5].includes(count) || recipe.iceCount === count) return;
      if (!scene && count > recipe.iceCount) void window.TavernAudio?.play('ice');
      recipe.iceCount = count;
      scene?.setIce(count);
    },
  };
  const warm = () => void loadScene().then((api) => api?.prepare());
  el('station').addEventListener('click', () => {
    if (mode === 'mix' && !closing) window.TavernAudio?.open();
  }, true);
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2500 });
  else window.addEventListener('load', warm, { once: true });
  window.addEventListener('pagehide', dispose);
})();
