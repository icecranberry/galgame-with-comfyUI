import ice from './audio/ice.mp3';
import stir from './audio/stir.mp3';
import pour from './audio/pour.mp3';
import drop from './audio/drop.mp3';
import garnish from './audio/garnish.mp3';
import click from './audio/ui-click.mp3';
import confirm from './audio/ui-confirm.mp3';
import page from './audio/ui-page.mp3';
import scene from './audio/ui-scene.mp3';
import shut from './audio/ui-close.mp3';
import serve from './audio/ui-serve.mp3';
import workshopOpen from './audio/ui-workshop-open.mp3';

const clips = { ice, stir, pour, drop, garnish, click, confirm, page, scene, close: shut, serve, workshopOpen };
const levels = { ice: 0.32, stir: 0.46, pour: 0.57, drop: 0.42, garnish: 0.23,
  click: 0.18, confirm: 0.23, page: 0.22, scene: 0.27, close: 0.18, serve: 0.34,
  workshopOpen: 0.28 };
const musicUrl = { room: './assets/music/room.mp3', mix: './assets/music/mix.mp3' };
let context, activation;
const buffers = new Map();
const voices = new Map();
let lastIce = -Infinity;
let theme = 'room', quiet = false, musicMuted = false, activeMusic, musicFrame;
const tracks = new Map();

function fadeMusic() {
  cancelAnimationFrame(musicFrame);
  const audible = [...tracks.values()].filter(track => !track.media.paused && (!track.starting || track === activeMusic));
  const start = performance.now();
  const gains = audible.map(track => ({ track, from: track.media.volume, to: track === activeMusic ? (quiet ? .19 : .34) : 0 }));
  const tick = now => {
    const progress = Math.max(0, Math.min(1, (now - start) / 620));
    for (const { track, from, to } of gains) {
      track.media.volume = from + (to - from) * progress;
      if (progress === 1 && !to) track.media.pause();
    }
    if (progress < 1) musicFrame = requestAnimationFrame(tick);
  };
  if (audible.length) musicFrame = requestAnimationFrame(tick);
}

function stopMusic() {
  cancelAnimationFrame(musicFrame);
  for (const { media } of tracks.values()) {
    media.pause();
    media.volume = 0;
  }
  activeMusic = null;
}

function syncMusic() {
  if (!context || musicMuted || document.hidden) return;
  let track = tracks.get(theme);
  if (!track) {
    const media = new Audio(musicUrl[theme]);
    media.loop = true;
    media.volume = 0;
    track = { media, starting: false };
    tracks.set(theme, track);
  }
  if (track === activeMusic && !track.media.paused) {
    fadeMusic();
    return;
  }
  if (track.starting) return;
  track.starting = true;
  void track.media.play().then(() => {
    if (tracks.get(theme) !== track || musicMuted || document.hidden) {
      track.media.pause();
      track.media.volume = 0;
      return;
    }
    activeMusic = track;
    fadeMusic();
  }).catch(() => {}).finally(() => { track.starting = false; });
}

export function setScene(name, ducked) {
  if (!musicUrl[name] || (theme === name && quiet === ducked)) return;
  theme = name;
  quiet = ducked;
  syncMusic();
}

export function setMusicMuted(value) {
  if (musicMuted === value) return;
  musicMuted = value;
  if (musicMuted) stopMusic();
  else if (navigator.userActivation?.isActive) open();
  else syncMusic();
}

// Decode bundled recordings locally. The game iframe disallows network fetches.
export function open() {
  if (document.hidden) return;
  try {
    if (!context) {
      context = new AudioContext();
      for (const [name, bytes] of Object.entries(clips))
        buffers.set(name, context.decodeAudioData(bytes.slice().buffer).catch(() => null));
    }
    if (context.state === 'suspended') activation = context.resume().catch(() => {});
    if (!activeMusic || activeMusic !== tracks.get(theme)) syncMusic();
  } catch {
    close();
  }
}

export async function play(name) {
  const current = context;
  if (!current || document.hidden) return;
  const [buffer] = await Promise.all([buffers.get(name), activation]);
  if (!buffer || current !== context || current.state !== 'running' || document.hidden) return;
  if (name === 'ice') {
    if (current.currentTime - lastIce < 0.065) return;
    lastIce = current.currentTime;
  } else if (voices.has(name)) {
    const previous = voices.get(name);
    if (name === 'pour') {
      const now = current.currentTime, param = previous.gain.gain;
      const volume = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(volume, now);
      param.linearRampToValueAtTime(0, now + 0.06);
      previous.source.stop(now + 0.06);
    } else previous.source.stop();
  }
  const source = current.createBufferSource(), gain = current.createGain();
  source.buffer = buffer;
  gain.gain.value = levels[name];
  const start = current.currentTime;
  if (name === 'pour') {
    const end = start + buffer.duration;
    const release = Math.min(0.38, buffer.duration * 0.5);
    gain.gain.setValueAtTime(levels.pour, end - release);
    gain.gain.exponentialRampToValueAtTime(0.001, end);
  }
  if (name === 'ice') source.playbackRate.value = 0.94 + Math.random() * 0.12;
  source.connect(gain).connect(current.destination);
  voices.set(name, { source, gain });
  source.onended = () => {
    if (voices.get(name)?.source === source) voices.delete(name);
    source.disconnect();
    gain.disconnect();
  };
  source.start(start);
}

export function close() {
  stopMusic();
  for (const { media } of tracks.values()) {
    media.removeAttribute('src');
    media.load();
  }
  tracks.clear();
  const previous = context;
  context = null;
  activation = null;
  buffers.clear();
  voices.clear();
  lastIce = -Infinity;
  if (previous) void previous.close().catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopMusic();
    for (const { source } of voices.values()) source.stop();
  } else syncMusic();
});
window.addEventListener('pagehide', close);
