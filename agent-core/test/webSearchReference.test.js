import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stub = source => `data:text/javascript,${encodeURIComponent(source)}`;
const fixture = stub(`export const state = { query: '天使|测试作品' }; export const chatSync = async () => state.query;`);
const { state } = await import(fixture);
const source = readFileSync(new URL('../src/services/webSearch.js', import.meta.url), 'utf8')
  .replace("'../llm/llm-client.js'", JSON.stringify(fixture));
const { searchCharacterReference, searchCharacterInfo, fetchCharacterReferenceImage } = await import(stub(source));

test('selected Moegirl article returns its infobox portrait separately from reference text', async t => {
  t.mock.method(console, 'log', () => {});
  const calls = [];
  const image = 'data:image/png;base64,cG9ydHJhaXQ=';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.includes('localhost:8765')
      ? { content: '角色正文'.repeat(200), infobox: '发色: 白色', reference_image: image }
      : { query: { pages: { 1: { title: '天使(测试作品)', extract: '测试作品的天使，角色资料和故事背景。'.repeat(50) } } } } };
  });
  state.query = '天使|测试作品';
  const result = await searchCharacterReference('天使（测试作品）');
  assert.equal(result.referenceImage, image);
  assert.match(result.text, /发色: 白色/);
  assert.ok(!result.text.includes('base64'));
  assert.equal(calls.filter(call => call.url.includes('localhost:8765')).length, 1);
  assert.match(JSON.parse(calls.at(-1).options.body).url, /^https:\/\/zh.moegirl.org.cn\//);
  assert.equal(await searchCharacterInfo('天使（测试作品）'), result.text);
});

test('no image and failed scrapes retain the original reference text', async t => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  state.query = '天使|测试作品';
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('localhost:8765')) throw new Error('scraper offline');
    return { ok: true, json: async () => ({ query: { pages: { 1: { title: '天使(测试作品)', extract: '测试作品原始资料'.repeat(100) } } } }) };
  });
  const result = await searchCharacterReference('天使');
  assert.equal(result.referenceImage, '');
  assert.equal(result.referenceImageInfo.status, 'service_error');
  assert.match(result.referenceImageInfo.page_url, /moegirl.org.cn/);
  assert.match(result.text, /测试作品原始资料/);
  state.query = '原创天使|';
  assert.deepEqual(await searchCharacterReference('原创天使'), { text: '', referenceImage: '' });
});

test('image-only retry preserves error details and never searches or calls the LLM', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ reference_image: '', reference_image_info: {
      status: 'rate_limited', message: '请求过于频繁', retry_after: 120,
    } }) };
  });
  state.query = ''; // extracting a name would leave this test unable to retry
  const result = await fetchCharacterReferenceImage('https://zh.moegirl.org.cn/御坂美琴');
  assert.equal(result.reference_image, '');
  assert.equal(result.reference_image_info.status, 'rate_limited');
  assert.equal(result.reference_image_info.retry_after, 120);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:8765/scrape-image');
  assert.deepEqual(Object.keys(calls[0].body), ['url']);
  for (const badUrl of ['https://bing.com/a', 'http://localhost:8765/a', 'https://moegirl.org.cn.evil.test/a', 'file:///a', 'https://user@zh.moegirl.org.cn/a']) {
    await assert.rejects(fetchCharacterReferenceImage(badUrl), error => error.status === 400);
  }
  assert.equal(calls.length, 1);
});

test('a successful image-only retry returns an image without any character fields', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    reference_image: 'data:image/jpeg;base64,cG9ydHJhaXQ=', reference_image_info: { status: 'ready' }, content: 'must not return text',
  }) }));
  const result = await fetchCharacterReferenceImage('https://zh.moegirl.org.cn/御坂美琴');
  assert.equal(result.reference_image_info.status, 'ready');
  assert.deepEqual(Object.keys(result).sort(), ['reference_image', 'reference_image_info']);
});
