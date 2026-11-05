import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SentenceSplitter, splitText } from '../src/utils/sentenceSplitter.js';
function stream(text, size) {
  const splitter = new SentenceSplitter(); const segments = [];
  for (let i=0; i<text.length; i+=size) segments.push(...splitter.feed(text.slice(i,i+size)).segments);
  segments.push(...splitter.flushAll().segments);
  return segments;
}
test('英文按句末切分，流式 chunk 边界不影响分句', () => {
  const text = 'I seem to be encountering an error. Can I try something else for you?';
  const expected = ['I seem to be encountering an error.', 'Can I try something else for you?'];
  assert.deepEqual(splitText(text), expected);
  for (const size of [1,2,3,7,31]) assert.deepEqual(stream(text,size),expected);
});
test('缩写、小数、URL、撇号和引号保留；长英文受限且不丢单词', () => {
  const text = `Dr. Smith said "Don't worry!" It's 3.14 at https://example.com today. Are you ready? Yes!`;
  assert.deepEqual(splitText(text), [`Dr. Smith said "Don't worry!"`, "It's 3.14 at https://example.com today.", 'Are you ready?', 'Yes!']);
  const long = 'A traveler rests beside the window in soft afternoon light '.repeat(30).trim();
  const pieces = splitText(long);
  assert.ok(pieces.length < 10);
  assert.ok(pieces.every(p => p.length <= 480));
  assert.equal(pieces.join(' '),long);
  assert.deepEqual(splitText('x'.repeat(1000)).map(s=>s.length),[480,480,40]);
  assert.deepEqual(splitText('Hello there.{"prompt":"hidden"}'),['Hello there.']);
});
test('中文 golden：标点、配对、换行、混排和 prompt 闸门保持旧结果', () => {
  const samples = [
    ['你好。今天开心吗？我很好！', ['你好','今天开心吗？我很好！']],
    ['今天我想带你去河边走一走，看看晚霞 再一起回家。', ['今天我想带你去河边走一走，看看晚霞 再一起回家']],
    ['她说「今天很开心！真的！」然后笑了。', ['她说「今天很开心！真的！」然后笑了']],
    ['这是（带有标点！的说明）后面的正文。', ['这是（带有标点！的说明）后面的正文']],
    ['第一段\n第二段。', ['第一段','第二段']],
    ['太好了！！真的……嗯。', ['太好了！！真的……嗯']],
    ['你好，世界。{"prompt":"hidden"}', ['你好，世界']],
    ['我在看 Hello world，它很有趣！', ['我在看 Hello world，它很有趣！']],
  ];
  for(const [text,expected] of samples) {
    assert.deepEqual(splitText(text),expected);
    for(const size of [1,2,7]) assert.deepEqual(stream(text,size),expected);
  }
});
