import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMomentResponse, sanitizeMomentContent } from './momentResponseParser.js';

test('parses the single-image shape (70%)', () => {
  const parsed = parseMomentResponse('{"text":"今天风好大","imagePrompt":"a windy rooftop"}');
  assert.deepEqual(parsed, {
    text: '今天风好大',
    imagePrompt: 'a windy rooftop',
    imagePrompt2: '',
    imagePrompt3: '',
  });
});

test('parses the dual-image shape (20%)', () => {
  const parsed = parseMomentResponse(
    '```json\n{"text":"两张都是今天","imagePrompt":"close up of a cat","imagePrompt2":"wide shot of the rooftop"}\n```',
  );
  assert.deepEqual(parsed, {
    text: '两张都是今天',
    imagePrompt: 'close up of a cat',
    imagePrompt2: 'wide shot of the rooftop',
    imagePrompt3: '',
  });
});

test('parses the triple-image shape (10%)', () => {
  const parsed = parseMomentResponse(
    '```json\n{"text":"三张都是今天","imagePrompt":"close up of a cat","imagePrompt2":"wide shot of the rooftop","imagePrompt3":"two of us by the door"}\n```',
  );
  assert.deepEqual(parsed, {
    text: '三张都是今天',
    imagePrompt: 'close up of a cat',
    imagePrompt2: 'wide shot of the rooftop',
    imagePrompt3: 'two of us by the door',
  });
});

test('keeps every prompt when only the closing brace is missing', () => {
  const parsed = parseMomentResponse('{"text":"差个括号","imagePrompt":"a cat","imagePrompt2":"a dog","imagePrompt3":"a bird"');
  assert.equal(parsed.text, '差个括号');
  assert.equal(parsed.imagePrompt, 'a cat');
  assert.equal(parsed.imagePrompt2, 'a dog');
  assert.equal(parsed.imagePrompt3, 'a bird');
});

test('drops only the truncated third prompt', () => {
  const parsed = parseMomentResponse('{"text":"第三张被截断","imagePrompt":"a cat on a roof","imagePrompt2":"a dog in a yard","imagePrompt3":"a bird in the');
  assert.equal(parsed.text, '第三张被截断');
  assert.equal(parsed.imagePrompt, 'a cat on a roof');
  assert.equal(parsed.imagePrompt2, 'a dog in a yard');
  assert.equal(parsed.imagePrompt3, '');
});

test('drops only the truncated second prompt', () => {
  const parsed = parseMomentResponse('{"text":"第二张被截断","imagePrompt":"a cat on a roof","imagePrompt2":"a dog in the');
  assert.equal(parsed.text, '第二张被截断');
  assert.equal(parsed.imagePrompt, 'a cat on a roof');
  assert.equal(parsed.imagePrompt2, '');
  assert.equal(parsed.imagePrompt3, '');
});

test('drops the truncated single prompt', () => {
  const parsed = parseMomentResponse('{"text":"只截断了图","imagePrompt":"a cat on the');
  assert.equal(parsed.text, '只截断了图');
  assert.equal(parsed.imagePrompt, '');
  assert.equal(parsed.imagePrompt2, '');
  assert.equal(parsed.imagePrompt3, '');
});

test('salvages the text field when the JSON is beyond repair', () => {
  const parsed = parseMomentResponse('{"text":"还能救回来", "imagePrompt": [broken');
  assert.equal(parsed.text, '还能救回来');
  assert.equal(parsed.imagePrompt, '');
  assert.equal(parsed.imagePrompt2, '');
  assert.equal(parsed.imagePrompt3, '');
});

test('never leaks JSON syntax into stored content', () => {
  assert.equal(sanitizeMomentContent('{"text":"正文","imagePrompt":"a cat"}'), '正文');
  assert.equal(sanitizeMomentContent('普通正文'), '普通正文');
});