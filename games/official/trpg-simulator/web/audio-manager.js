(() => {
  const settingsKey = 'linshe.trpg.audio';
  const assetRoot = new URL('./assets/audio/', document.currentScript.src);
  const files = {
    explore: 'bgm/explore.mp3', tense: 'bgm/tense.mp3', rain: 'ambience/rain.ogg',
    bubble_kp: 'sfx/bubble_kp.ogg', bubble_pl: 'sfx/bubble_pl.ogg', clue_get: 'sfx/clue_get.ogg',
    item_get: 'sfx/item_get.ogg', scene_switch: 'sfx/scene_switch.ogg',
    dice_hit_1: 'sfx/dice_hit_1.ogg', dice_hit_2: 'sfx/dice_hit_2.ogg',
    crit_success: 'sfx/crit_success.ogg', fumble_san: 'sfx/fumble_san.ogg',
  };
  const defaults = { music: 0.22, effects: 0.75, muted: false };
  const clamp = value => Math.min(1, Math.max(0, value));
  const musicFade = 1.5;

  class AudioManager {
    constructor(bridge) {
      this.bridge = bridge;
      this.settings = { ...defaults };
      this.assets = new Map();
      this.buffers = new Map();
      this.tracks = new Map();
      this.fades = new WeakMap();
      this.lastCue = new Map();
      this.music = 'explore';
      this.ambience = '';
    }

    async restore() {
      try {
        // The game iframe has an opaque origin. Its host owns the localStorage entry.
        const saved = this.bridge ? await this.bridge.preferences() : JSON.parse(localStorage.getItem(settingsKey));
        for (const key of ['music', 'effects']) {
          if (Number.isFinite(saved?.[key])) this.settings[key] = clamp(saved[key]);
        }
        this.settings.muted = saved?.muted === true;
        this.mix();
      } catch { /* Keep the in-memory settings if storage is unavailable. */ }
    }

    save(patch) {
      Object.assign(this.settings, patch);
      this.mix();
      try {
        if (this.bridge) void this.bridge.preferences(this.settings).catch(() => {});
        else localStorage.setItem(settingsKey, JSON.stringify(this.settings));
      } catch { /* The current mix remains usable. */ }
    }

    previewVolume(key, level) {
      this.settings[key] = level;
      this.mix();
    }

    get backgroundVolume() {
      return this.settings.muted ? 0 : this.settings.music;
    }

    unlock() {
      try {
        if (!this.context) {
          const Context = window.AudioContext || window.webkitAudioContext;
          if (!Context) return;
          const context = this.context = new Context();
          this.musicBus = this.gain(context.destination, this.backgroundVolume);
          this.ambienceBus = this.gain(context.destination, this.backgroundVolume);
          this.effectsBus = this.gain(context.destination, this.settings.effects);
        }
        if (this.resuming || this.started && this.context.state === 'running') return;
        this.resuming = this.context.resume().then(() => {
          if (this.started) return;
          this.started = true;
          void this.updateMusic();
          void this.updateAmbience();
          void this.load('tense');
          for (const name of Object.keys(files)) if (files[name].startsWith('sfx/')) void this.load(name);
        }).catch(() => {}).finally(() => { this.resuming = null; });
      } catch { /* Leave the game playable when audio is unavailable. */ }
    }

    gain(target, level = 0) {
      const node = this.context.createGain();
      node.gain.value = level;
      node.connect(target);
      return node;
    }

    fade(param, to, seconds) {
      const now = this.context.currentTime;
      const previous = this.fades.get(param);
      const from = previous ? previous.from + (previous.to - previous.from) * clamp((now - previous.start) / previous.seconds) : param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(from, now);
      param.linearRampToValueAtTime(to, now + seconds);
      this.fades.set(param, { from, to, start: now, seconds });
    }

    mix() {
      if (!this.effectsBus) return;
      this.fade(this.musicBus.gain, this.backgroundVolume, 0.04);
      this.fade(this.ambienceBus.gain, this.backgroundVolume, 0.04);
      this.fade(this.effectsBus.gain, this.settings.effects, 0.04);
    }

    load(name) {
      if (!this.assets.has(name)) {
        const request = async () => {
          let bytes;
          if (this.bridge) bytes = await this.bridge.load(files[name]);
          else {
            const response = await fetch(new URL(files[name], assetRoot));
            if (!response.ok) return null;
            bytes = await response.arrayBuffer();
          }
          const buffer = await this.context.decodeAudioData(bytes);
          this.buffers.set(name, buffer);
          return buffer;
        };
        this.assets.set(name, request().catch(() => null));
      }
      return this.assets.get(name);
    }

    source(buffer, target, loop = false) {
      const node = this.context.createBufferSource();
      node.buffer = buffer;
      node.loop = loop;
      node.connect(target);
      node.start();
      return node;
    }

    setScene(scene, tense) {
      const music = tense ? 'tense' : 'explore';
      const ambience = !scene ? '' : /雨|\brain\b/i.test(`${scene.name} ${scene.publicDesc}`) ? 'rain' : 'wind';
      if (this.music !== music) {
        this.music = music;
        if (this.started) void this.updateMusic();
      }
      if (this.ambience !== ambience) {
        this.ambience = ambience;
        if (this.started) void this.updateAmbience();
      }
    }

    async updateMusic() {
      try {
        const name = this.music;
        const buffer = await this.load(name);
        if (!buffer || this.music !== name || this.playing === name) return;
        if (!this.tracks.has(name)) {
          const gain = this.gain(this.musicBus);
          this.source(buffer, gain, true);
          this.tracks.set(name, gain);
        }
        for (const [track, gain] of this.tracks) this.fade(gain.gain, track === name ? 1 : 0, musicFade);
        this.playing = name;
      } catch { /* Keep the current track if the next one is unavailable. */ }
    }

    startWind() {
      const context = this.context;
      const length = context.sampleRate * 3;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;
      this.wind = this.gain(this.ambienceBus);
      const sway = this.gain(this.wind, 0.72);
      this.windFilter = context.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.Q.value = 0.4;
      this.windFilter.connect(sway);
      this.source(buffer, this.windFilter, true);
      const lfo = context.createOscillator();
      lfo.frequency.value = 0.17;
      lfo.connect(this.gain(sway.gain, 0.21));
      lfo.start();
    }

    async updateAmbience() {
      try {
        const mode = this.ambience;
        if (mode && !this.wind) this.startWind();
        if (this.wind) {
          this.fade(this.windFilter.frequency, mode === 'rain' ? 1550 : 440, 0.6);
          this.fade(this.wind.gain, !mode || mode === 'rain' && this.rain ? 0 : 0.2, 0.6);
        }
        if (this.rain) this.fade(this.rain.gain, mode === 'rain' ? 0.48 : 0, 0.6);
        if (mode !== 'rain' || this.rain) return;
        const buffer = await this.load('rain');
        if (!buffer || this.ambience !== 'rain' || this.rain) return;
        this.rain = this.gain(this.ambienceBus);
        this.source(buffer, this.rain, true);
        this.fade(this.wind.gain, 0, 0.6);
        this.fade(this.rain.gain, 0.48, 0.6);
      } catch { /* Ambient audio is optional. */ }
    }

    bubble(keeper) {
      this.play(keeper ? 'bubble_kp' : 'bubble_pl', 0.25, 'bubble', 120);
    }

    impact(speed) {
      if (!Number.isFinite(speed) || speed < 0.04) return;
      const volume = 0.1 + 0.5 * clamp((speed - 0.04) / 1.45);
      this.play(Math.random() < 0.5 ? 'dice_hit_1' : 'dice_hit_2', volume, 'impact', 60);
    }

    play(name, volume = 0.55, group = name, cooldown = 160) {
      if (!this.started || this.context.state !== 'running' || !this.settings.effects) return;
      const now = performance.now();
      if (now - (this.lastCue.get(group) ?? -Infinity) < cooldown) return;
      this.lastCue.set(group, now);
      try {
        const output = this.gain(this.effectsBus, volume);
        const buffer = this.buffers.get(name);
        if (buffer) this.source(buffer, output).onended = () => output.disconnect();
        else this.synthesize(name, output);
      } catch { /* A failed cue cannot interrupt game play. */ }
    }

    synthesize(name, output) {
      const context = this.context;
      const tone = (frequency, endFrequency, duration, level, delay = 0) => {
        const oscillator = context.createOscillator();
        const envelope = this.gain(output);
        const start = context.currentTime + delay;
        oscillator.frequency.setValueAtTime(frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(level, start + 0.008);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(envelope);
        oscillator.start(start);
        oscillator.stop(start + duration);
        oscillator.onended = () => envelope.disconnect();
      };
      if (name === 'crit_success') {
        for (const [frequency, duration, level] of [[110, 1.5, 0.33], [164.8, 1.2, 0.2], [220, 1, 0.14], [463, 0.62, 0.1], [718, 0.28, 0.05]]) {
          tone(frequency, frequency, duration, level);
        }
      } else if (name === 'fumble_san') {
        tone(91, 42, 0.25, 0.52);
        tone(74, 38, 0.32, 0.33, 0.18);
        tone(1860, 1650, 0.88, 0.035, 0.08);
      } else if (name.startsWith('dice_hit_')) {
        const pitch = name === 'dice_hit_1' ? 1 : 1.12;
        tone(210 * pitch, 138 * pitch, 0.095, 0.5);
        tone(380 * pitch, 252 * pitch, 0.047, 0.22);
      } else {
        const [pitch, end, duration] = {
          bubble_kp: [360, 200, 0.09], bubble_pl: [630, 385, 0.06],
          clue_get: [790, 1020, 0.16], item_get: [480, 710, 0.15], scene_switch: [310, 105, 0.34],
        }[name];
        tone(pitch, end, duration, 0.34);
        if (name === 'clue_get' || name === 'item_get') tone(end * 1.25, end * 1.25, 0.21, 0.15, 0.06);
      }
      setTimeout(() => output.disconnect(), 1600);
    }
  }

  window.TrpgAudioManager = AudioManager;
})();
