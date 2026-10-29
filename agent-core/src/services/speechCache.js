import fs from 'node:fs';
import path from 'node:path';

const audioFile = /^[a-f0-9-]+\.(?:wav|mp3)$/i;
const generatedName = value => /^generated[/\\]([a-f0-9-]+\.(?:wav|mp3))$/i.exec(value || '')?.[1];

/** Synchronous snapshot: inference callbacks cannot commit midway through cleanup. */
export function clearGeneratedSpeech(db, audioRoot, activeIds = new Set(), io = fs) {
  const directory = path.resolve(audioRoot, 'generated');
  let files = [];
  try {
    const stat = io.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('语音缓存目录异常，未执行清理');
    files = io.readdirSync(directory).filter(name => audioFile.test(name));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const jobs = db.prepare('SELECT id,status,output_path FROM speech_jobs').all();
  const protectedIds = new Set(activeIds), protectedFiles = new Set();
  for (const job of jobs) {
    if (['queued', 'generating'].includes(job.status)) protectedIds.add(job.id);
    if (protectedIds.has(job.id) && generatedName(job.output_path)) protectedFiles.add(generatedName(job.output_path).toLowerCase());
  }
  const failed = new Set();
  let removedFiles = 0, bytes = 0;
  for (const name of files) {
    if (protectedIds.has(name.replace(/\.(wav|mp3)$/i, '')) || protectedFiles.has(name.toLowerCase())) continue;
    const target = path.join(directory, name);
    try {
      const stat = io.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) { failed.add(name.toLowerCase()); continue; }
      io.unlinkSync(target);
      removedFiles++; bytes += stat.size;
    } catch (error) { if (error.code !== 'ENOENT') failed.add(name.toLowerCase()); }
  }
  const ids = jobs.filter(job => !protectedIds.has(job.id)
    && ['completed', 'failed', 'cancelled'].includes(job.status)
    && !failed.has(generatedName(job.output_path)?.toLowerCase())
    && !failed.has(`${job.id}.wav`.toLowerCase()) && !failed.has(`${job.id}.mp3`.toLowerCase())).map(job => job.id);
  db.transaction(() => {
    const links = db.prepare('DELETE FROM message_speech WHERE job_id=?');
    const jobs = db.prepare('DELETE FROM speech_jobs WHERE id=?');
    for (const id of ids) { links.run(id); jobs.run(id); }
  })();
  return { ids, files: removedFiles, bytes, failed: failed.size };
}
