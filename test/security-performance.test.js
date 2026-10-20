import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../js/services/http.js';
import { createViewRefresh } from '../js/services/view-refresh.js';
import { createSyncCoordinator } from '../js/services/sync-coordinator.js';
import { escapeCSVField } from '../js/utils.js';
import * as sync from '../sync.js';

const store = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
};
globalThis.localStorage = store();
globalThis.sessionStorage = store();

await test('credentials are remembered by default; session-only remains available and disconnect clears both stores', () => {
  const key = 'flashcard_sync_credentials', gistId = '1234567890abcdef1234567890abcdef';
  sync.saveSyncCredentials('remembered-token', gistId);
  assert.ok(localStorage.getItem(key));
  assert.equal(sessionStorage.getItem(key), null);
  assert.equal(sync.credentialsAreRemembered(), true);
  // Opening a fresh tab still reads the remembered token from localStorage.
  globalThis.sessionStorage = store();
  assert.equal(sync.getSyncCredentials().pat, 'remembered-token');
  sync.saveSyncCredentials('session-only', gistId, { remember: false });
  assert.equal(localStorage.getItem(key), null);
  assert.equal(sync.getSyncCredentials().pat, 'session-only');
  assert.equal(sync.credentialsAreRemembered(), false);
  sync.clearSyncCredentials();
  assert.deepEqual(sync.getSyncCredentials(), { pat: '', gistId: '' });
  localStorage.setItem(key, JSON.stringify({ pat: 'legacy', gistId }));
  assert.equal(sync.getSyncCredentials().pat, 'legacy');
  sync.clearSyncCredentials();
});

await test('malformed Gist targets and formula-bearing CSV cells are handled safely', () => {
  for (const target of ['../user', 'https://evil.example/1234567890abcdef1234567890abcdef', '1234567890abcdef1234567890abcdef/../../user', 'prefix1234567890abcdef1234567890abcdef']) assert.equal(sync.sanitizeGistId(target), '');
  for (const value of ['=HYPERLINK("https://evil.example")', '  +1+1', '@SUM(A1)', '\t=1', '-1+2']) assert.ok(escapeCSVField(value).startsWith('"\''));
  assert.equal(escapeCSVField('ordinary, "text"'), '"ordinary, ""text"""');
  assert.equal(escapeCSVField(0), '"0"');
});

await test('transport rejects oversized streamed bodies, covers stalled bodies with its deadline and refuses redirects', async () => {
  const original = globalThis.fetch;
  let canceled = false;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(12)); }, cancel() { canceled = true; } }));
    };
    await assert.rejects(fetchWithTimeout('https://api.github.com/user', {}, 100, 10), /download limit/);
    assert.equal(canceled, true);
    canceled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { canceled = true; } }));
    await assert.rejects(fetchWithTimeout('https://api.github.com/user', {}, 20), /timed out/);
    assert.equal(canceled, true);
    globalThis.fetch = async () => new Response('hello');
    assert.equal(await (await fetchWithTimeout('https://api.github.com/user')).text(), 'hello');
  } finally { globalThis.fetch = original; }
});

await test('disconnect during a sync fetch prevents a PATCH or remote application', async () => {
  const original = globalThis.fetch;
  sync.saveSyncCredentials('token', '1234567890abcdef1234567890abcdef');
  let count = 0;
  globalThis.fetch = async () => {
    count++; sync.clearSyncCredentials();
    return new Response(JSON.stringify({ files: { 'flashcards.json': { content: '[]' } } }));
  };
  try {
    await assert.rejects(sync.syncCards([], { deviceId: '11111111-1111-4111-8111-111111111111' }), /settings changed/);
    assert.equal(count, 1);
  } finally { globalThis.fetch = original; }
});

await test('a configuration change during the recovery backup prevents applying remote data', async () => {
  let current = true, applied = false, acknowledged = false;
  const coordinator = createSyncCoordinator({
    getCards: async () => [], syncCards: async () => ({ status: 'pulled_from_remote', changed: true, cards: [] }),
    backup: async () => { current = false; }, isCurrent: async () => current,
    applyCards: async () => { applied = true; }, acknowledge: async () => { acknowledged = true; }, refresh: async () => {}
  });
  await assert.rejects(coordinator.run(), /settings changed/);
  assert.equal(applied, false); assert.equal(acknowledged, false);
});

await test('unchanged synchronization avoids a full database/UI refresh', async () => {
  let refreshes = 0;
  const coordinator = createSyncCoordinator({ getCards: async () => [], syncCards: async () => ({ status: 'no_change', changed: false }),
    acknowledge: async () => {}, refresh: async () => { refreshes++; } });
  await coordinator.run(); assert.equal(refreshes, 0);
});

await test('hidden views coalesce invalidations; opening refreshes once; render errors do not spin', async () => {
  let visible = false, renders = 0, errors = 0;
  const deferred = createViewRefresh({ isVisible: () => visible, render: () => { renders++; } });
  await Promise.all(Array.from({ length: 100 }, () => deferred.invalidate()));
  assert.equal(renders, 0);
  visible = true; await deferred.flush(); await deferred.flush();
  assert.equal(renders, 1);
  const failing = createViewRefresh({ isVisible: () => true, render: () => { throw new Error('failed'); }, onError: () => { errors++; } });
  await failing.flush(); assert.equal(errors, 1);
  await failing.flush(); assert.equal(errors, 2);
});

await test('invalidations arriving during a render get a single fresh follow-up render', async () => {
  let release, count = 0;
  const deferred = createViewRefresh({ isVisible: () => true, render: async () => { if (++count === 1) await new Promise(resolve => { release = resolve; }); } });
  const initial = deferred.flush(); await Promise.resolve();
  const waiting = Array.from({ length: 40 }, () => deferred.invalidate());
  release(); await Promise.all([initial, ...waiting]);
  assert.equal(count, 2);
});

await test('background sync reuses a recent result without reading data; expiry and manual sync check immediately', async () => {
  let timestamp = 1000, reads = 0, requests = 0;
  const coordinator = createSyncCoordinator({
    now: () => timestamp,
    getCards: async () => { reads++; return []; },
    syncCards: async () => { requests++; return { status: 'no_change', changed: false }; },
    acknowledge: async () => {}, refresh: async () => {}
  });
  await coordinator.run({ background: true });
  timestamp += 5000;
  await coordinator.run({ background: true }); await coordinator.run({ background: true });
  assert.equal(reads, 1); assert.equal(requests, 1);
  await coordinator.run(); assert.equal(requests, 2);
  timestamp += 30001;
  await coordinator.run({ background: true }); assert.equal(requests, 3);
});

await test('local edits and account changes bypass the background cooldown, and failed checks are never cached', async () => {
  let scope = 'account-a', requests = 0, fail = false;
  const coordinator = createSyncCoordinator({
    now: () => 1000, getScope: () => scope,
    getCards: async () => [],
    syncCards: async () => { requests++; if (fail) throw new Error('offline'); return { status: 'no_change', changed: false }; },
    acknowledge: async () => {}, refresh: async () => {}
  });
  await coordinator.run({ background: true });
  coordinator.request(500);
  await coordinator.run({ background: true }); assert.equal(requests, 2);
  coordinator.invalidate(); // A change notification from another app tab.
  await coordinator.run({ background: true }); assert.equal(requests, 3);
  scope = 'account-b';
  await coordinator.run({ background: true }); assert.equal(requests, 4);
  fail = true;
  await assert.rejects(coordinator.run(), /offline/);
  fail = false;
  await coordinator.run({ background: true }); assert.equal(requests, 6);
});

await test('duplicate requests share in-flight work; local edits during it schedule one fresh sync', async () => {
  let release, requests = 0;
  const coordinator = createSyncCoordinator({
    getCards: async () => [],
    syncCards: async () => { if (++requests === 1) await new Promise(resolve => { release = resolve; }); return { status: 'no_change', changed: false }; },
    acknowledge: async () => {}, refresh: async () => {}
  });
  const first = coordinator.run({ background: true });
  await new Promise(resolve => setImmediate(resolve));
  const duplicates = Array.from({ length: 20 }, () => coordinator.run({ background: true }));
  coordinator.request(0);
  await new Promise(resolve => setTimeout(resolve, 10));
  release(); await Promise.all([first, ...duplicates]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requests, 2);
});

await test('persisted ETags produce a body-free 304, update the last-check time, and allow an empty cached dataset', async () => {
  const original = globalThis.fetch;
  const gistId = '1234567890abcdef1234567890abcdef';
  const deviceId = '11111111-1111-4111-8111-111111111111';
  sync.saveSyncCredentials('cached-token', gistId);
  let phase = 'initial', requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    if (phase === 'initial') return new Response(JSON.stringify({ files: {
      'flashcards.json': { content: '[]' },
      [`anamnesis-device-${deviceId}.json`]: { content: '[]' }
    } }), { headers: { ETag: 'cached-revision' } });
    assert.equal(options.headers['If-None-Match'], 'cached-revision');
    assert.equal(options.method || 'GET', 'GET');
    return new Response(null, { status: 304 });
  };
  try {
    const first = await sync.syncCards([], { deviceId });
    await sync.acknowledgeSync({ ...first, checkpoint: { ...first.checkpoint, time: 1 } });
    phase = 'conditional';
    const second = await sync.syncCards([], { deviceId });
    assert.equal(second.changed, false);
    assert.equal(second.status, 'no_change');
    await sync.acknowledgeSync(second);
    assert.ok(sync.getLastSyncTime() > 1);
    assert.equal(sync.getLastSyncEtag(), 'cached-revision');
    assert.equal(requests, 2);
  } finally { globalThis.fetch = original; sync.clearSyncCredentials(); }
});
