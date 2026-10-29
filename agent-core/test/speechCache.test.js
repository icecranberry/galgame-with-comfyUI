import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { clearGeneratedSpeech } from '../src/services/speechCache.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-cache-'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE speech_jobs(id TEXT PRIMARY KEY,status TEXT,output_path TEXT);
    CREATE TABLE message_speech(message_id INTEGER PRIMARY KEY,job_id TEXT REFERENCES speech_jobs(id));
    CREATE TABLE voices(id TEXT); INSERT INTO voices VALUES ('voice');`);
  t.after(() => { db.close(); fs.rmSync(root, {recursive:true,force:true}); });
  const file = name => { const target = path.join(root,name); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,'audio'); };
  const job = (id,status,output) => {
    db.prepare('INSERT INTO speech_jobs VALUES (?,?,?)').run(id,status,output);
    db.prepare('INSERT INTO message_speech(job_id) VALUES (?)').run(id);
    if(output) file(output);
  };
  return {db,root,file,job};
}

test('clears local/API generated audio and mappings, preserving active work and reference assets', t => {
  const {db,root,file,job} = fixture(t);
  job('a1','completed','generated/a1.wav'); job('a2','completed','generated/a2.mp3');
  job('a3','generating','generated/a3.wav'); job('a4','queued',null);
  job('a5','cancelled','generated/a5.wav'); job('a6','failed',null);
  file('generated/a7.wav'); // orphan after a previous cancellation
  file('references/b1.wav'); file('previews/b1.wav'); file('originals/b1.source'); file('generated/notes.txt');
  const result = clearGeneratedSpeech(db,root,new Set(['a5']));
  assert.deepEqual(result.ids,['a1','a2','a6']);
  assert.equal(result.files,3); assert.equal(result.bytes,15); assert.equal(result.failed,0);
  assert.deepEqual(db.prepare('SELECT id FROM speech_jobs ORDER BY id').all().map(row=>row.id),['a3','a4','a5']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM message_speech').get().n,3);
  for(const name of ['generated/a3.wav','generated/a5.wav','references/b1.wav','previews/b1.wav','originals/b1.source','generated/notes.txt']) assert.ok(fs.existsSync(path.join(root,name)),name);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM voices').get().n,1);
  assert.equal(clearGeneratedSpeech(db,root,new Set(['a5'])).files,0);
  // The same message can be associated with a fresh synthesis after cleanup.
  db.prepare("INSERT INTO speech_jobs VALUES ('new','queued',NULL)").run();
  db.prepare("INSERT INTO message_speech VALUES (1,'new')").run();
});

test('missing files are forgotten, unlink failures retain retryable records, and paths cannot escape generated', t => {
  const {db,root,file,job} = fixture(t);
  job('a1','completed','generated/a1.wav'); job('a2','completed','generated/a2.mp3');
  job('a3','completed','references/a3.wav'); job('a4','completed','generated/../references/a4.wav');
  file('generated/a5.wav');
  fs.unlinkSync(path.join(root,'generated/a2.mp3'));
  const io = {...fs,unlinkSync(target) { if(target.endsWith('a1.wav')) throw Object.assign(new Error('busy'),{code:'EBUSY'}); fs.unlinkSync(target); }};
  const result = clearGeneratedSpeech(db,root,new Set(),io);
  assert.equal(result.failed,1); assert.equal(result.files,1);
  assert.deepEqual(result.ids,['a2','a3','a4']);
  assert.ok(db.prepare("SELECT id FROM speech_jobs WHERE id='a1'").get());
  assert.ok(fs.existsSync(path.join(root,'references/a3.wav')));
  assert.ok(fs.existsSync(path.join(root,'references/a4.wav')));
  assert.equal(clearGeneratedSpeech(db,root).files,1);
});

test('an absent cache directory is safe and a redirected directory is rejected', t => {
  const {db,root,job} = fixture(t);
  job('a1','failed',null);
  assert.deepEqual(clearGeneratedSpeech(db,root),{ids:['a1'],files:0,bytes:0,failed:0});
  const io = {...fs,lstatSync:()=>({isDirectory:()=>true,isSymbolicLink:()=>true})};
  assert.throws(()=>clearGeneratedSpeech(db,root,new Set(),io),/目录异常/);
});
