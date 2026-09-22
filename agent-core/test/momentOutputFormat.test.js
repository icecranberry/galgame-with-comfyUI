import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMomentOutputFormat } from '../src/services/momentForms.js';
import { parseMomentResponse } from '../src/services/momentResponseParser.js';

test('moment output examples are valid JSON and use only the fields consumed by the parser', () => {
  for (const imageCount of [1, 2, 3]) {
    const format = buildMomentOutputFormat({ imageCount });
    const example = JSON.parse(format.split('\n')[1]);
    const fields = ['text', 'imagePrompt', 'imagePrompt2', 'imagePrompt3'].slice(0, imageCount + 1);
    assert.deepEqual(Object.keys(example), fields);
    assert.ok(Object.values(example).every(value => typeof value === 'string' && value.length > 0));

    const parsed = parseMomentResponse(JSON.stringify(example));
    for (const field of fields) assert.equal(parsed[field], example[field]);
    for (const field of ['imagePrompt2', 'imagePrompt3'].slice(imageCount - 1)) {
      assert.equal(parsed[field], '');
    }
  }
});

test('quotes, multiline requirements and backslashes cannot break the JSON example', () => {
  const textRequirement = '和昵称为 "阿林" 的人赴约\n停顿后说一句，保留颜文字 (・_・;) 和反斜杠 \\';
  const format = buildMomentOutputFormat({ textRequirement });
  const example = JSON.parse(format.split('\n')[1]);
  assert.ok(example.text.includes(textRequirement));
  assert.deepEqual(Object.keys(example), ['text', 'imagePrompt']);
  assert.equal(parseMomentResponse(JSON.stringify(example)).text, example.text);
});

test('the output contract rejects unsupported image counts instead of teaching an incomplete shape', () => {
  for (const imageCount of [0, 4, 1.5, NaN]) {
    assert.throws(() => buildMomentOutputFormat({ imageCount }), RangeError);
  }
});
