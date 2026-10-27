import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';

const exec = promisify(execFile);
export const AUDIO_ROOT = path.resolve(process.env.TTS_AUDIO_DIR || fileURLToPath(new URL('../../data/audio/', import.meta.url)));
export function audioPath(relative) {
  const result = path.resolve(AUDIO_ROOT, relative);
  if (!result.startsWith(`${AUDIO_ROOT}${path.sep}`)) throw new Error('无效的音频路径');
  return result;
}
export const audioUrl = relative => `/api/tts/audio/${relative.split(path.sep).join('/')}`;
function audioTool(name, override) {
  const bundled = fileURLToPath(new URL(`../../../tts-service/runtime/tools/ffmpeg/bin/${name}.exe`, import.meta.url));
  return override || (existsSync(bundled) ? bundled : name);
}
// Resolve per call: users may extract an offline bundle while Node is running.
const ffmpeg = () => audioTool('ffmpeg', process.env.FFMPEG_PATH);
const ffprobe = () => audioTool('ffprobe', process.env.FFPROBE_PATH);
async function convert(args) {
  await exec(ffmpeg(), ['-nostdin', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe', ...args], { timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
}
export async function importAudio(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 25 * 1024 * 1024) throw new Error('请选择 25MB 以内的音频文件');
  const id = randomUUID();
  const original_path = `originals/${id}.source`;
  const preview_path = `previews/${id}.wav`;
  for (const dir of ['originals', 'previews', 'references', 'generated']) await fs.mkdir(audioPath(dir), { recursive: true });
  try {
    await fs.writeFile(audioPath(original_path), buffer, { flag: 'wx' });
    const { stdout } = await exec(ffprobe(), ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration', '-of', 'json', audioPath(original_path)], { timeout: 10000, windowsHide: true });
    const declaredDuration = Number(JSON.parse(stdout).format?.duration);
    if (Number.isFinite(declaredDuration) && (declaredDuration <= 0 || declaredDuration > 120)) throw new Error('音频长度必须在 0～120 秒以内');
    // Browser MediaRecorder WebM often has no duration header. Decode at most
    // 121 seconds, then measure the bounded PCM output instead of rejecting it.
    await convert(['-i', audioPath(original_path), '-t', '121', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', audioPath(preview_path)]);
    const decoded = await exec(ffprobe(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audioPath(preview_path)], { timeout: 10000, windowsHide: true });
    const duration = Number(JSON.parse(decoded.stdout).format?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error('音频长度必须在 0～120 秒以内');
    const peaks = await waveform(audioPath(preview_path));
    return { id, original_path, preview_path, duration, peaks, preview_url: audioUrl(preview_path) };
  } catch (e) {
    await Promise.all([original_path, preview_path].map(p => fs.rm(audioPath(p), { force: true })));
    throw new Error(`音频导入失败：${e.message}`);
  }
}
export async function waveform(file) {
  const { stdout } = await exec(ffmpeg(), ['-nostdin', '-v', 'error', '-i', file, '-t', '120', '-f', 'f32le', '-ac', '1', '-ar', '8000', 'pipe:1'], { encoding: 'buffer', timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const count = Math.floor(stdout.length / 4);
  const peaks = [];
  for (let bin = 0; bin < 240; bin++) {
    let peak = 0;
    for (let i = Math.floor(bin * count / 240); i < Math.floor((bin + 1) * count / 240); i++) peak = Math.max(peak, Math.abs(stdout.readFloatLE(i * 4)));
    peaks.push(Number(peak.toFixed(4)));
  }
  return peaks;
}
export async function cropAudio(sample, start, end, denoise = false) {
  start = Number(start); end = Number(end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > sample.duration + 0.01 || end - start < 1 || end - start > 15) throw new Error('请选择原音范围内 1～15 秒的片段，建议 6～12 秒');
  const id = randomUUID();
  const reference_path = `references/${id}.wav`;
  // Trim only the two ends. Interior pauses are left untouched.
  const trim = 'silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB,areverse';
  try {
    await convert(['-ss', String(start), '-i', audioPath(sample.preview_path), '-t', String(end - start), '-af', `${denoise ? 'afftdn=nf=-25,' : ''}${trim}`, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', audioPath(reference_path)]);
    const peaks = await waveform(audioPath(reference_path));
    const max = Math.max(...peaks);
    if (max < 0.002) throw new Error('所选片段没有有效声音，请重新选择');
    const { stdout } = await exec(ffprobe(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audioPath(reference_path)], { timeout: 10000, windowsHide: true });
    const duration = Number(JSON.parse(stdout).format?.duration);
    if (!Number.isFinite(duration) || duration < 1) throw new Error('去除首尾静音后不足 1 秒，请重新选段');
    const warnings = [];
    if (max < 0.05) warnings.push('音量偏低，建议更换清晰的素材');
    if (peaks.filter(p => p > 0.99).length > peaks.length * 0.05) warnings.push('可能存在削波，请检查试听');
    if (duration < 6) warnings.push('片段较短，建议选取 6～12 秒自然对白');
    const content_hash = createHash('sha256').update(await fs.readFile(audioPath(reference_path))).digest('hex');
    return { id, original_path: sample.original_path, preview_path: sample.preview_path, reference_path, content_hash,
      duration, start_seconds: start, end_seconds: end, warnings: JSON.stringify(warnings), reference_url: audioUrl(reference_path) };
  } catch (e) { await fs.rm(audioPath(reference_path), { force: true }); throw e; }
}
