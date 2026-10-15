import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import 'fake-indexeddb/auto';
const window = new Window({ url: 'http://localhost:8081', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
for (const key of ['window','document','navigator','localStorage','MutationObserver','getComputedStyle','HTMLElement','CustomEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: typeof window[key] === 'function' && key === 'getComputedStyle' ? window[key].bind(window) : key === 'window' ? window : window[key] });
}
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
localStorage.setItem('anamnesis_intro_seen', 'true');
document.write(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
const db = await import('../db.js');
const { state } = await import('../js/state.js');
const cards = await import('../js/cards.js');
const study = await import('../js/study.js');
const ui = await import('../js/ui.js');
const { initAccessibility } = await import('../js/accessibility.js');
const minimal = await import("../js/minimal-ui.js");
const { initCardBrowser } = await import("../js/browser.js");
const dashboard = await import('../js/dashboard.js');
const { initExplorer } = await import('../js/explorer.js');
ui.initModalListeners(); initAccessibility(); minimal.initMinimalUI(); initCardBrowser(); study.initStudyEventListeners(); study.initKeyboardShortcuts(); initExplorer();
cards.onCardsRefreshed(dashboard.refreshDashboard);
cards.onCardsRefreshed(minimal.renderSimpleDecks);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const original = id => ({ id, front: 'Question ' + id, back: 'Answer', deck: 'Tests', last_modified: 100 });
async function seed(count = 2) {
  study.exitStudySession();
  document.querySelectorAll('.modal-overlay').forEach(el => el.classList.add('hidden'));
  await db.clearDatabase();
  await db.saveCards(Array.from({ length: count }, (_, index) => original(String(index))));
  await cards.loadCardsFromDB();
}

await test('actual grading and undo handlers keep session, schedule and history consistent', async () => {
  await seed();
  study.startStudySession(false, state.allCards);
  const id = state.studySessionCards[0].id;
  await study.submitCardGrade(3); await sleep(220);
  assert.equal(state.currentCardIndex, 1);
  assert.equal((await db.getAllReviewLogs()).length, 1);
  await study.undoLastStudyCard();
  assert.equal(state.currentCardIndex, 0);
  assert.equal(state.studySessionCards[0].id, id);
  assert.deepEqual(await db.getAllReviewLogs(), []);
  assert.equal((await db.getCards()).find(card => card.id === id).fsrs_stats, undefined);
});

await test('Again repeats the updated schedule and supports consecutive undo', async () => {
  await seed(1);
  study.startStudySession(false, state.allCards);
  await study.submitCardGrade(1); await sleep(220);
  assert.equal(state.studySessionCards[1].fsrs_stats.lapses, 1);
  await study.submitCardGrade(1); await sleep(220);
  assert.equal((await db.getCards())[0].fsrs_stats.lapses, 2);
  await study.undoLastStudyCard();
  await study.undoLastStudyCard();
  assert.equal(state.currentCardIndex, 0);
  assert.equal((await db.getCards())[0].fsrs_stats, undefined);
  assert.deepEqual(await db.getAllReviewLogs(), []);
});

await test('failed save does not advance the session or push a false undo action', async () => {
  await seed();
  study.startStudySession(false, state.allCards);
  const current = state.studySessionCards[0];
  await db.saveCard({ ...current, front: 'Concurrent edit' });
  await study.submitCardGrade(3);
  assert.equal(state.currentCardIndex, 0);
  assert.equal(study.isStudyBusy(), false);
  assert.deepEqual(await db.getAllReviewLogs(), []);
  assert.equal(document.getElementById('btn-undo-study').disabled, true);
  assert.ok(document.getElementById('toast-container').textContent.includes('changed in another'));
});

await test('practice-only completion can exit without leaving the grading lock stuck', async () => {
  await seed(1);
  study.startStudySession(true, state.allCards, 'Practice', false);
  await study.submitCardGrade(4); await sleep(220);
  assert.equal(study.isStudyBusy(), false);
  assert.equal(study.exitStudySession(), true);
  assert.equal((await db.getCards())[0].fsrs_stats, undefined);
  assert.equal((await db.getAllReviewLogs()).length, 1);
});

await test('modal traps keyboard focus, restores it and blocks grading shortcuts', async () => {
  await seed(); study.startStudySession(false, state.allCards);
  const trigger = document.getElementById('btn-cancel-study'); trigger.focus();
  ui.showModal('Confirm action', 'Body', () => {});
  await sleep(10);
  const dialog = document.querySelector('#modal-container .modal-content');
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const last = document.getElementById('modal-btn-confirm'); last.focus();
  last.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.ok(dialog.contains(document.activeElement));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '3', bubbles: true }));
  assert.equal(state.currentCardIndex, 0);
  document.getElementById('modal-btn-cancel').click(); await sleep(10);
  assert.equal(document.activeElement, trigger);
});

await test('real segmented tab listener changes visibility and accessible selection', async () => {
  const tab = document.querySelector('[data-deck-tab="tab-browser"]'); tab.click();
  assert.ok(tab.classList.contains('active'));
  assert.ok(!document.getElementById('tab-browser').classList.contains('hidden'));
  assert.ok(document.getElementById('tab-collections').classList.contains('hidden'));
});

await test('minimal navigation has exactly three destinations and Today has no administration controls', async () => {
  await seed();
  assert.deepEqual([...document.querySelectorAll('.app-nav .nav-label')].map(el => el.textContent), ['Today', 'Cards', 'Settings']);
  assert.ok(!document.querySelector('#subview-dashboard .stats-grid'));
  assert.ok(!document.querySelector('#subview-dashboard [id*="export"]'));
  assert.ok(!document.querySelector('#subview-dashboard [id*="fsrs"]'));
  assert.equal(document.querySelector('.organize-tools').open, false);
  assert.equal(document.querySelector('.card-extra-fields').open, false);
  assert.equal(document.querySelectorAll('.simple-add-fields input').length, 3);
  const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
  assert.equal(new Set(ids).size, ids.length, 'Every control has a unique ID');
});

await test('native deck selection updates the daily session without opening a modal', async () => {
  await seed();
  await db.saveCard({ ...original('other'), deck: 'Other deck' });
  await cards.loadCardsFromDB();
  const select = document.getElementById('today-deck-select');
  select.value = 'deck:Other deck';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(30);
  assert.equal(state.selectedDeck, 'deck:Other deck');
  assert.equal(state.dueCards.length, 1);
  assert.ok(document.getElementById('collection-picker-modal').classList.contains('hidden'));
  dashboard.setActiveDeckSelection('all');
});

await test('core loop defaults to ten cards, reveals with one button and completes without a stuck lock', async () => {
  await seed(12);
  localStorage.removeItem('app-review-cap');
  document.getElementById('btn-start-review').click();
  assert.equal(state.studySessionCards.length, 10);
  document.getElementById('btn-reveal-answer').click();
  await sleep(15);
  assert.equal(state.isFlipped, true);
  assert.equal(document.querySelector('.card-back').getAttribute('aria-hidden'), 'false');
  assert.equal(document.querySelector('.simple-grade-actions').querySelectorAll('button').length, 2);
  assert.equal(document.querySelector('.simple-grade-actions [data-grade="3"] .grade-label').textContent, 'Got it');
  for (let i = 0; i < 10; i++) { await study.submitCardGrade(3); await sleep(200); }
  assert.equal(study.isStudyBusy(), false);
  assert.equal(document.getElementById('modal-title').textContent, 'Nicely done.');
  document.getElementById('modal-btn-confirm').click();
  await sleep(20);
  assert.ok(document.getElementById('subview-dashboard').classList.contains('active'));
});

await test('deck rows open review directly, and practice is one click after catching up', async () => {
  await seed();
  document.querySelector('.deck-study').click();
  await sleep(20);
  assert.ok(document.getElementById('subview-study').classList.contains('active'));
  study.exitStudySession();
  await db.saveCards((await db.getCards()).map(card => ({ ...card, fsrs_stats: { state: 2, repetitions: 2, stability: 2, next_review: Date.now() + 86400000 } })));
  await cards.loadCardsFromDB();
  assert.equal(document.getElementById('btn-force-review').parentElement.id, 'today-primary-actions');
  document.getElementById('btn-force-review').click();
  assert.ok(document.getElementById('practice-modal-container').classList.contains('hidden'));
  assert.equal(state.studySessionInfo.recordFSRS, false);
});

await window.happyDOM.abort();
