import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as db from '../db.js';
import { gradeReview, undoReview } from '../js/services/reviews.js';
import { canonicalJSON, parseSyncPayload, validateCards, cardsFingerprint } from '../js/domain/data.js';
import { migrateLegacyCard } from '../js/domain/migrations.js';
import { createSyncCoordinator } from '../js/services/sync-coordinator.js';
import * as sync from '../sync.js';

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key)
};
const sessionValues = new Map();
globalThis.sessionStorage = { getItem: key => sessionValues.get(key) ?? null, setItem: (key, value) => sessionValues.set(key, String(value)), removeItem: key => sessionValues.delete(key) };
const card = (id = 'c1', extra = {}) => ({ id, front: 'Question', back: 'Answer', last_modified: 100, ...extra });
beforeEach(async () => { await db.clearDatabase(); values.clear(); sessionValues.clear(); });

await test('grading commits scheduling and its log, undo removes the log with a fresh revision', async () => {
  const original = card();
  await db.saveCard(original);
  const receipt = await gradeReview(original, 3, { now: 1000, logId: 'review-1' });
  assert.equal((await db.getCards())[0].fsrs_stats.repetitions, 1);
  assert.equal((await db.getAllReviewLogs()).length, 1);
  const restored = await undoReview(receipt, 900);
  assert.equal(restored.last_modified, receipt.updated.last_modified + 1);
  assert.equal(restored.fsrs_stats, undefined);
  assert.deepEqual(await db.getCards(), [restored]);
  assert.deepEqual(await db.getAllReviewLogs(), []);
});

await test('duplicate review log aborts both writes, preserving the original schedule', async () => {
  const original = card(); await db.saveCard(original);
  await db.saveReviewLog({ id: 'duplicate', card_id: original.id });
  await assert.rejects(gradeReview(original, 3, { now: 2000, logId: 'duplicate' }));
  assert.deepEqual(await db.getCards(), [original]);
  assert.equal((await db.getAllReviewLogs()).length, 1);
});

await test('stale grading and undo cannot overwrite a newer edit', async () => {
  const original = card(); await db.saveCard(original);
  const receipt = await gradeReview(original, 3, { logId: 'r1' });
  const newer = { ...receipt.updated, front: 'Edited in another tab' };
  await db.saveCard(newer);
  await assert.rejects(undoReview(receipt), /changed after/);
  await assert.rejects(gradeReview(original, 3), /changed in another/);
  assert.equal((await db.getCards())[0].front, newer.front);
  assert.ok((await db.getCards())[0].last_modified > receipt.updated.last_modified);
  assert.equal((await db.getAllReviewLogs()).length, 1);
});

await test('practice-only attempts and their undo never write scheduling', async () => {
  const original = card(); await db.saveCard(original);
  const receipt = await gradeReview(original, 1, { recordFSRS: false });
  assert.deepEqual(await db.getCards(), [original]);
  assert.equal((await db.getAllReviewLogs())[0].mode, 'practice_buffer');
  await undoReview(receipt);
  assert.deepEqual(await db.getCards(), [original]);
  assert.deepEqual(await db.getAllReviewLogs(), []);
});

await test('invalid ratings cannot create records', async () => {
  const original = card(); await db.saveCard(original);
  await assert.rejects(gradeReview(original, 9), /Invalid review rating/);
  assert.deepEqual(await db.getAllReviewLogs(), []);
});

await test('sync preserves in-flight edits, additions and hard deletions despite clock skew', async () => {
  const initial = [card('edit'), card('delete'), card('unchanged')];
  await db.saveCards(initial);
  const edited = card('edit', { front: 'In-flight edit', last_modified: 1 });
  await db.saveCards([edited, card('added')]);
  await db.deleteCard('delete');
  await db.applySyncCards(initial, initial.map(c => ({ ...c, back: 'Remote edit', last_modified: 300 })));
  const result = await db.getCards();
  assert.equal(result.find(c => c.id === 'edit').front, 'In-flight edit');
  assert.ok(result.some(c => c.id === 'added'));
  assert.ok(!result.some(c => c.id === 'delete'));
  assert.equal(result.find(c => c.id === 'unchanged').back, 'Remote edit');
});

await test('malformed imports fail before replacing any local data', async () => {
  await db.saveCard(card());
  for (const invalid of [[card(), card()], [{ id: 'bad', front: [] }], [card('bad', { fsrs_stats: { stability: NaN } })]]) {
    await assert.rejects(db.replaceCards(invalid));
    assert.deepEqual(await db.getCards(), [card()]);
  }
  assert.throws(() => parseSyncPayload({ schemaVersion: 99, cards: [] }), /schema version/);
  assert.throws(() => validateCards([card('bad', { last_modified: Infinity })]), /timestamp/);
});

await test('legacy migration is repeatable and preserves already migrated schedules', async () => {
  const original = card('legacy', { folder: 'Social', deck: 'I.', sub: 'Actual', sm2_stats: { interval: 7, repetitions: 2 } });
  assert.deepEqual(migrateLegacyCard(migrateLegacyCard(original)), migrateLegacyCard(original));
  await db.saveCard(original);
  await db.runMigrations();
  const first = await db.getCards();
  await db.runMigrations();
  assert.deepEqual(await db.getCards(), first);
  assert.equal(first[0].deck, 'Actual');
  assert.equal(first[0].fsrs_stats.stability, 7);
});

await test('review history follows committed logs and undo, excluding practice-only', async () => {
  const original = card(); await db.saveCard(original);
  await db.getReviewHistory({ '2020-01-01': 12 });
  const receipt = await gradeReview(original, 3, { now: new Date(2026, 9, 14, 12).getTime() });
  assert.equal((await db.getReviewHistory())['2026-10-14'], 1);
  await undoReview(receipt);
  assert.equal((await db.getReviewHistory())['2026-10-14'] || 0, 0);
  assert.equal((await db.getReviewHistory())['2020-01-01'], 12);
});

await test('merge is deterministic for equal timestamps and preserves old deletion markers', () => {
  const left = card('same', { front: 'A' }), right = card('same', { front: 'B' });
  assert.deepEqual(sync.mergeCards([left], [right]), sync.mergeCards([right], [left]));
  const deletion = card('same', { deleted: true, last_modified: 200 });
  assert.equal(sync.mergeCards([deletion], [left])[0].deleted, true);
  assert.equal(sync.cardsDiffer([left], [{ ...left, customField: 1 }]), true);
  assert.equal(canonicalJSON({ b: 1, a: 2 }), canonicalJSON({ a: 2, b: 1 }));
});

await test('sync coordinator does not acknowledge failed local commits and queues requests', async () => {
  const calls = [];
  const coordinator = createSyncCoordinator({
    getCards: async () => [card()], syncCards: async () => ({ changed: true, cards: [card()], status: 'pulled_from_remote' }),
    applyCards: async () => { calls.push('apply'); throw new Error('Disk full'); },
    acknowledge: async () => calls.push('ack'), refresh: async () => calls.push('refresh'),
    onState: state => calls.push(state)
  });
  await assert.rejects(coordinator.run(), /Disk full/);
  assert.deepEqual(calls, ['syncing', 'apply', 'failed']);
});

await test('malformed remote JSON never triggers PATCH or advances checkpoints', async () => {
  sync.saveSyncCredentials('test-token', '1234567890abcdef1234567890abcdef');
  const originalFetch = globalThis.fetch;
  const methods = [];
  globalThis.fetch = async (_url, options) => {
    methods.push(options.method || 'GET');
    return new Response(JSON.stringify({ files: { 'flashcards.json': { content: '{bad-json' } } }), { status: 200 });
  };
  try {
    await assert.rejects(sync.syncCards([card()]), /Invalid remote data/);
    assert.deepEqual(methods, ['GET']);
    assert.equal(sync.getLastSyncTime(), 0);
  } finally { globalThis.fetch = originalFetch; }
});

await test('fingerprint detects local edits older than last sync and credentials reset checkpoints', async () => {
  sync.saveSyncCredentials('test-token', '1234567890abcdef1234567890abcdef');
  const old = card();
  await sync.acknowledgeSync({ checkpoint: { gistId: sync.getSyncCredentials().gistId, fingerprint: await cardsFingerprint([old]), etag: 'old-etag', filename: 'flashcards.json', time: Date.now() } });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(options);
    return new Response(JSON.stringify({ files: { 'flashcards.json': { content: JSON.stringify([old]) } } }), { status: 200 });
  };
  try {
    await sync.syncCards([card('c1', { front: 'Changed', last_modified: 101 })]);
    assert.equal(requests[0].headers['If-None-Match'], undefined);
    assert.ok(requests.some(r => r.method === 'PATCH'));
    sync.saveSyncCredentials('different-token', 'abcdef1234567890abcdef1234567890');
    assert.equal(sync.getLastSyncEtag(), '');
    assert.equal(sync.getLastSyncTime(), 0);
  } finally { globalThis.fetch = originalFetch; }
});

await test('independent device files preserve records when two clients PATCH stale snapshots', async () => {
  sync.saveSyncCredentials('test-token', '1234567890abcdef1234567890abcdef');
  const originalFetch = globalThis.fetch;
  const files = { 'flashcards.json': { content: '[]' } };
  let waiting = [];
  let barrier = true;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PATCH') {
      Object.assign(files, JSON.parse(options.body).files);
      return new Response(JSON.stringify({ files }), { status: 200 });
    }
    const snapshot = structuredClone(files);
    if (barrier) {
      await new Promise(resolve => {
        waiting.push(resolve);
        if (waiting.length === 2) { barrier = false; waiting.forEach(fn => fn()); }
      });
    }
    return new Response(JSON.stringify({ files: snapshot }), { status: 200 });
  };
  try {
    await Promise.all([
      sync.syncCards([card('client-a')], { deviceId: '11111111-1111-4111-8111-111111111111' }),
      sync.syncCards([card('client-b')], { deviceId: '22222222-2222-4222-8222-222222222222' })
    ]);
    const merged = await sync.syncCards([]);
    assert.deepEqual(merged.cards.map(card => card.id).sort(), ['client-a', 'client-b']);
  } finally { globalThis.fetch = originalFetch; }
});

await test('backup restore recovers reviews atomically and gives removals fresh tombstones', async () => {
  const original = card(); await db.saveCard(original);
  await gradeReview(original, 3, { now: 1000 });
  const backup = await db.createLocalBackup('Test');
  assert.equal(backup.review_logs.length, 1);
  await db.saveCard(card('added-after-backup'));
  await db.deleteReviewLogsForCards(['c1']);
  await db.restoreLocalBackup(backup.id);
  const restored = await db.getCards();
  assert.equal(restored.find(card => card.id === 'added-after-backup').deleted, true);
  assert.equal((await db.getAllReviewLogs()).length, 1);
  assert.ok(restored.find(card => card.id === 'c1').last_modified > backup.cards[0].last_modified);
});

await test('two simultaneous first-run seeds create one dataset, and clearing does not reseed it', async () => {
  const counts = await Promise.all([db.seedStarterOnce([card('preset')]), db.seedStarterOnce([card('preset')])]);
  assert.equal(counts[0] + counts[1], 1);
  assert.equal((await db.getCards()).length, 1);
  await db.clearDatabase();
  assert.equal(await db.seedStarterOnce([card('preset')]), 0);
});

await test('sync checks configuration again inside the write transaction before changing any cards', async () => {
  const original = card();
  await db.saveCard(original);
  await assert.rejects(db.applySyncCards([original], [{ ...original, front: 'remote', last_modified: 200 }], { canApply: () => false }), /settings changed/);
  assert.deepEqual(await db.getCards(), [original]);
});
