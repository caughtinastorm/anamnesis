import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import 'fake-indexeddb/auto';
const window = new Window({ url: 'http://localhost:8081', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
for (const key of ['window','document','navigator','localStorage','MutationObserver','HTMLElement','CustomEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
localStorage.setItem('anamnesis_intro_seen', 'true');
document.write(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
const errors = [];
const originalError = console.error;
console.error = (...args) => errors.push(args.map(String).join(' '));
try {
  await test('complete app boots, seeds cards and initializes its views without runtime errors', async () => {
    await import('../app.js');
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const { state } = await import('../js/state.js');
    for (let i = 0; i < 100 && state.allCards.length < 104; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(state.allCards.length >= 104, 'Starter cards should load');
    assert.deepEqual(errors, []);
    assert.ok(document.getElementById('view-review').classList.contains('active'));
    assert.ok(document.getElementById('stat-total-count').textContent !== '0');
  });
  await test('boot defers hidden deck lists and navigation renders the current collection on demand', async () => {
    assert.equal(document.querySelectorAll('.simple-deck-row').length, 0);
    document.querySelector('.app-nav [data-view="view-decks"]').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(document.querySelectorAll('.simple-deck-row').length > 0);
    assert.deepEqual(errors, []);
    document.getElementById('header-sync-status').click();
    assert.equal(document.getElementById('settings-sync').hidden, false);
    assert.equal(document.getElementById('settings-general').hidden, true);
  });
  await test('a burst of refresh requests performs at most two reads and subscriber passes', async () => {
    const { loadCardsFromDB, onCardsRefreshed } = await import('../js/cards.js');
    let passes = 0;
    const unsubscribe = onCardsRefreshed(() => { passes++; });
    await Promise.all(Array.from({ length: 30 }, () => loadCardsFromDB()));
    unsubscribe();
    assert.ok(passes > 0 && passes <= 2, `Expected at most two passes, got ${passes}`);
  });
  await test('due counts and visible deck status update after time passes without a data edit', async () => {
    const now = Date.now;
    const timestamp = now();
    const db = await import('../db.js');
    const { loadCardsFromDB } = await import('../js/cards.js');
    await db.clearDatabase();
    await db.saveCard({ id: 'future-card', front: 'Question', back: 'Answer', deck: 'Clock test', last_modified: timestamp, fsrs_stats: { state: 2, repetitions: 1, next_review: timestamp + 1000 } });
    await loadCardsFromDB();
    assert.equal(document.getElementById('stat-due-count').textContent, '0');
    try {
      Date.now = () => timestamp + 2000;
      document.querySelector('.app-nav [data-view="view-decks"]').click();
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(document.querySelector('.deck-due').textContent.includes('1 ready'));
      document.querySelector('.app-nav [data-view="view-review"]').click();
      assert.equal(document.getElementById('stat-due-count').textContent, '1');
    } finally { Date.now = now; }
  });
} finally { console.error = originalError; await window.happyDOM.abort(); }
