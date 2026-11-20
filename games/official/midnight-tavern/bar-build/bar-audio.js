import ice from './audio/ice.mp3';
import stir from './audio/stir.mp3';
import pour from './audio/pour.mp3';
import drop from './audio/drop.mp3';
import garnish from './audio/garnish.mp3';

const clips = { ice, stir, pour, drop, garnish };
const levels = { ice: 0.32, stir: 0.46, pour: 0.57, drop: 0.42, garnish: 0.23 };
let context;
const buffers = new Map();
const voices = new Map();
let lastIce = -Infinity;

// Decode bundled recordings locally. The game iframe disallows network fetches.
export function open() {
  try {
    if (!context) {
      context = new AudioContext();
      for (const [name, bytes] of Object.entries(clips))
        buffers.set(name, context.decodeAudioData(bytes.slice().buffer).catch(() => null));
    }
    if (context.state === 'suspended') void context.resume().catch(() => {});
  } catch {
    close();
  }
}

export async function play(name) {
  const current = context;
  if (!current || document.hidden) return;
  const buffer = await buffers.get(name);
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
  const previous = context;
  context = null;
  buffers.clear();
  voices.clear();
  lastIce = -Infinity;
  if (previous) void previous.close().catch(() => {});
}
