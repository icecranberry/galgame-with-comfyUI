// PCM storage and Web Audio cookbook biquads. No model, GPU or synthesis here.
export function decodeReferenceWav(data) {
  const b = Buffer.from(data);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('参考音频不是 WAV');
  let rate, pcm;
  for (let at = 12; at + 8 <= b.length;) {
    const size = b.readUInt32LE(at + 4), end = at + 8 + size;
    if (end > b.length) throw new Error('参考音频不完整');
    const type = b.toString('ascii', at, at + 4);
    if (type === 'fmt ') {
      if (size < 16 || b.readUInt16LE(at + 8) !== 1 || b.readUInt16LE(at + 10) !== 1 || b.readUInt16LE(at + 22) !== 16) throw new Error('参考音频必须为单声道 PCM16');
      rate = b.readUInt32LE(at + 12);
    }
    if (type === 'data') pcm = b.subarray(at + 8, end);
    at = end + size % 2;
  }
  if (!rate || !pcm?.length || pcm.length % 2 || pcm.length / 2 / rate > 30) throw new Error('参考音频长度无效');
  return { rate, samples: Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768) };
}
export function encodeReferenceWav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => {
    if (!Number.isFinite(value)) throw new Error('参考声音处理失败');
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2);
  });
  return b;
}
function biquad(samples, rate, type, frequency, gain, q = 1) {
  if (!gain) return;
  const a = 10 ** (gain / 40), w = 2 * Math.PI * frequency / rate, c = Math.cos(w), s = Math.sin(w);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peak') {
    const alpha = s / (2 * q);
    [b0, b1, b2, a0, a1, a2] = [1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a];
  } else {
    const k = Math.sqrt(2 * a) * s;
    if (type === 'low') [b0, b1, b2, a0, a1, a2] = [a * ((a + 1) - (a - 1) * c + k), 2 * a * ((a - 1) - (a + 1) * c), a * ((a + 1) - (a - 1) * c - k), (a + 1) + (a - 1) * c + k, -2 * ((a - 1) + (a + 1) * c), (a + 1) + (a - 1) * c - k];
    else [b0, b1, b2, a0, a1, a2] = [a * ((a + 1) + (a - 1) * c + k), -2 * a * ((a - 1) + (a + 1) * c), a * ((a + 1) + (a - 1) * c - k), (a + 1) - (a - 1) * c + k, 2 * ((a - 1) - (a + 1) * c), (a + 1) - (a - 1) * c - k];
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y; samples[i] = y;
  }
}
export function equalizeReference(samples, rate, { brightness = 0, thickness = 0, clarity = 0, air = 0 }) {
  const headroom = Math.abs(brightness) + Math.max(0, thickness) + Math.max(0, clarity) + Math.max(0, air);
  const gain = 10 ** (-headroom / 20);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  biquad(samples, rate, 'low', 250, -brightness / 2);
  biquad(samples, rate, 'high', 3000, brightness);
  biquad(samples, rate, 'low', 180, thickness);
  biquad(samples, rate, 'peak', 2800, clarity, .9);
  biquad(samples, rate, 'high', 8000, air);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-.95, Math.min(.95, samples[i]));
  return samples;
}
