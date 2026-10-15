import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFSRS5, calculateInterval } from '../fsrs.js';
await test('scheduler inputs are explicit and do not depend on browser preferences', () => {
  globalThis.localStorage = { getItem: () => '0.70' };
  const card = { id: 'test', front: 'Question', back: 'Answer' };
  assert.deepEqual(calculateFSRS5(card, 3, 1000), calculateFSRS5(card, 3, 1000, 0.90));
  assert.ok(calculateInterval(10, 0.70) > calculateInterval(10, 0.90));
});
await test('invalid scheduler ratings, timestamps and retention fail before producing corrupt schedules', () => {
  assert.throws(() => calculateFSRS5({}, 9));
  assert.throws(() => calculateFSRS5({}, 3, NaN));
  assert.throws(() => calculateInterval(10, 0));
  assert.throws(() => calculateInterval(Infinity, 0.90));
});
