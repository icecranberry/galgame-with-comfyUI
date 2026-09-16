/**
 * 语料白名单契约：agent-core 用的每个向量语料，vector-service 必须受理。
 *
 * memory_triples_v1 曾只加进了 chroma_store._collection_name() 的分支、没加进 server.py 请求模型上
 * 各写一份的 Field(pattern=...)，结果三元组的写入与检索全部 422 —— feature 静默失效，
 * 只在日志里留下一串 "Upsert error: [object Object]"。这里把白名单两侧钉在一起。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MEMORY_TRIPLES_CORPUS, tripleCorpusFor } from '../src/services/memory/memoryRepository.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const VECTOR_DIR = path.join(ROOT, 'vector-service');
const AGENT_SRC = path.join(ROOT, 'agent-core', 'src');

function readPythonConst(name) {
  const source = readFileSync(path.join(VECTOR_DIR, 'chroma_store.py'), 'utf8');
  const match = source.match(new RegExp(`^${name} = "([^"]+)"$`, 'm'));
  assert.ok(match, `chroma_store.py 里找不到语料常量 ${name}`);
  return match[1];
}

/** 与 chroma_store._collection_name() 同源的受理判定（指纹允许下划线：本地兜底是 local_builtin） */
function corpusSupported(corpus, { plain, prefixes }) {
  if (plain.has(corpus)) return true;
  return prefixes.some(prefix => corpus.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(corpus.slice(prefix.length)));
}

function collectJsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectJsFiles(full);
    return entry.name.endsWith('.js') && !entry.name.endsWith('.test.js') ? [full] : [];
  });
}

test('agent-core 用到的每个语料都被向量服务受理', () => {
  const plain = new Set([readPythonConst('DEFAULT_CORPUS'), readPythonConst('IMAGE_PROMPT_CORPUS'), readPythonConst('MEMORY_TRIPLES_CORPUS')]);
  const memoryPrefix = readPythonConst('CHAT_MEMORY_PREFIX');
  const triplePrefix = readPythonConst('MEMORY_TRIPLES_PREFIX');
  const prefixes = [memoryPrefix, triplePrefix];
  const literals = new Set();
  for (const file of collectJsFiles(AGENT_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:corpus\s*[:=]\s*|CORPUS\s*=\s*)'([^']+)'/g)) literals.add(match[1]);
  }
  // 正则失效时不要静默通过
  assert.ok(literals.has(MEMORY_TRIPLES_CORPUS), `扫描没找到三元组语料，检查采集正则（找到：${[...literals].join(', ')}）`);
  for (const corpus of literals) {
    assert.ok(corpusSupported(corpus, { plain, prefixes }), `向量服务会拒绝语料 ${corpus}（422），要么加进白名单要么改用法`);
  }
  // 远端嵌入 provider 的动态语料形如 memory_v2_<sha256 前 16 位>
  assert.ok(corpusSupported(`${memoryPrefix}${'0123456789abcdef'}`, { plain, prefixes }), 'memory_v2_<指纹> 形态必须被受理');
  // 三元组语料随嵌入 profile 分流：memory_triples_<指纹>，本地兜底指纹 local_builtin 带下划线
  const hex = '0123456789abcdef';
  for (const corpus of [tripleCorpusFor(hex), tripleCorpusFor('local_builtin'), tripleCorpusFor({ fingerprint: hex })]) {
    assert.ok(corpusSupported(corpus, { plain, prefixes }), `三元组分档语料 ${corpus} 必须被受理（否则回退本地那天 422）`);
  }
});

test('三元组语料随嵌入 profile 分流，存量空指纹回落到共享语料', () => {
  assert.equal(tripleCorpusFor({ fingerprint: 'abc123' }), 'memory_triples_abc123');
  assert.equal(tripleCorpusFor('abc123'), 'memory_triples_abc123');
  assert.equal(tripleCorpusFor({ fingerprint: 'local_builtin' }), 'memory_triples_local_builtin');
  // 分流前的存量行没有指纹，向量躺在共享语料里：删除按共享语料兜底，绝不能张冠李戴去别的 profile
  for (const empty of [null, undefined, {}, { fingerprint: '' }]) {
    assert.equal(tripleCorpusFor(empty), MEMORY_TRIPLES_CORPUS);
  }
});

test('chroma_store 的语料白名单由语料常量拼出', () => {
  const source = readFileSync(path.join(VECTOR_DIR, 'chroma_store.py'), 'utf8');
  const start = source.indexOf('CORPUS_PATTERN =');
  assert.ok(start > 0, 'chroma_store.py 必须定义 CORPUS_PATTERN');
  const block = source.slice(start, start + 400);
  for (const name of ['DEFAULT_CORPUS', 'IMAGE_PROMPT_CORPUS', 'MEMORY_TRIPLES_CORPUS', 'MEMORY_TRIPLES_PREFIX', 'CHAT_MEMORY_PREFIX']) {
    assert.ok(block.includes(name), `CORPUS_PATTERN 必须由 ${name} 拼出，不能另写一份字面量`);
  }
  // <前缀><指纹> 的受理判定两个分支共用，避免一处改了另一处没改
  assert.ok(source.includes('_is_profile_corpus(corpus, MEMORY_TRIPLES_PREFIX)'), '三元组分档语料要走 _is_profile_corpus');
  assert.ok(source.includes('_is_profile_corpus(corpus, CHAT_MEMORY_PREFIX)'), 'memory_v2 语料要走 _is_profile_corpus');
});

test('server.py 的请求模型共用同一份语料白名单', () => {
  const source = readFileSync(path.join(VECTOR_DIR, 'server.py'), 'utf8');
  assert.ok(source.includes('pattern=CORPUS_PATTERN'), '请求模型的语料字段必须用 chroma_store.CORPUS_PATTERN');
  assert.ok(!/pattern="\^\(memory_fragments/.test(source), 'server.py 里不能再有硬编码的语料白名单');
  const declared = source.match(/corpus: str = .+/g) || [];
  assert.ok(declared.length >= 5, `至少要扫到 5 个语料字段，实际 ${declared.length}`);
  for (const line of declared) {
    assert.ok(line.includes('corpus_field()'), `语料字段必须走白名单工厂：${line.trim()}`);
  }
});
