import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocationText, buildLocationMatcher } from './townLocationMatch.js';

const LOCATIONS = [
  { id: 1, key: 'cafe', name: '临街咖啡厅', aliases: ['咖啡厅', '咖啡馆', '咖啡店打工'] },
  { id: 2, key: 'apartment', name: '林荫公寓', aliases: ['家', '家里', '公寓书房', '卧室'] },
  { id: 3, key: 'park', name: '中央公园', aliases: ['公园', '散步'] },
];

test('normalizeLocationText strips whitespace and lowercases', () => {
  assert.equal(normalizeLocationText('  咖啡厅　'), '咖啡厅');
  assert.equal(normalizeLocationText('Library'), 'library');
  assert.equal(normalizeLocationText(null), '');
});

test('matches schedule free text via alias containment', () => {
  const match = buildLocationMatcher(LOCATIONS);
  assert.equal(match('咖啡厅打工')?.id, 1);
  assert.equal(match('在咖啡馆发呆')?.id, 1);
  assert.equal(match('公寓书房')?.id, 2);
  assert.equal(match('家里')?.id, 2);
  assert.equal(match('去公园散步')?.id, 3);
});

test('matches exact key and name', () => {
  const match = buildLocationMatcher(LOCATIONS);
  assert.equal(match('cafe')?.id, 1);
  assert.equal(match('临街咖啡厅')?.id, 1);
});

test('reverse containment catches short texts like 家', () => {
  const match = buildLocationMatcher(LOCATIONS);
  assert.equal(match('家')?.id, 2);
});

test('longest alias wins when multiple POIs overlap', () => {
  const match = buildLocationMatcher([
    { id: 1, key: 'plaza', name: '广场', aliases: ['广场'] },
    { id: 2, key: 'plaza_east', name: '东广场', aliases: ['东广场'] },
  ]);
  assert.equal(match('东广场长椅')?.id, 2);
});

test('returns null for empty or unmatched text', () => {
  const match = buildLocationMatcher(LOCATIONS);
  assert.equal(match(''), null);
  assert.equal(match(null), null);
  assert.equal(match('火星基地')?.id ?? match('火星基地'), null);
});
