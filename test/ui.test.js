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

await test('minimal navigation has four task destinations and Today has no administration controls', async () => {
  await seed();
  assert.deepEqual([...document.querySelectorAll('.app-nav .nav-label')].map(el => el.textContent), ['Today', 'Cards', 'Progress', 'Settings']);
  assert.ok(!document.querySelector('#subview-dashboard .stats-grid'));
  assert.ok(!document.querySelector('#subview-dashboard [id*="export"]'));
  assert.ok(!document.querySelector('#subview-dashboard [id*="fsrs"]'));
  assert.equal(document.querySelector('#tab-collections #win-explorer'), null);
  assert.ok(document.querySelector('#tab-organize #win-explorer'));
  assert.equal(document.querySelector('.card-extra-fields').open, false);
  assert.equal(document.querySelectorAll('.simple-add-fields textarea').length, 2);
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


await test('Settings tabs hide deeper options and support arrow-key navigation with one tab stop', async () => {
  ui.switchView('view-settings');
  const tabs = [...document.querySelectorAll('#settings-tabs [role="tab"]')];
  assert.deepEqual(tabs.map(tab => tab.textContent), ['Preferences', 'Data', 'Sync']);
  tabs[0].focus();
  tabs[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, tabs[1]);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  tabs[1].click();
  assert.equal(document.getElementById('settings-general').hidden, true);
  assert.equal(document.getElementById('settings-data').hidden, false);
  assert.equal(tabs.filter(tab => tab.tabIndex === 0).length, 1);
  assert.equal(document.querySelector('.app-nav [data-view="view-settings"]').getAttribute('aria-current'), 'page');
  assert.equal(document.getElementById('view-review').inert, true);
});

await test('deck search and pagination bound DOM size for a large collection', async () => {
  study.exitStudySession();
  ui.switchView('view-decks');
  await sleep(30);
  await db.clearDatabase();
  await db.saveCards(Array.from({ length: 2000 }, (_, index) => ({ ...original(`large-${index}`), deck: `Deck ${String(index).padStart(4, '0')}`, folder: 'Languages' })));
  await cards.loadCardsFromDB();
  minimal.renderSimpleDecks();
  assert.equal(document.querySelectorAll('.simple-deck-row').length, 40);
  document.getElementById('simple-deck-more').click();
  assert.equal(document.querySelectorAll('.simple-deck-row').length, 80);
  const search = document.getElementById('simple-deck-search'); search.value = 'Deck 1999';
  search.dispatchEvent(new window.Event('input')); await sleep(160);
  assert.equal(document.querySelectorAll('.simple-deck-row').length, 1);
  assert.ok(document.getElementById('simple-deck-list').textContent.includes('Deck 1999'));
  search.value = '<img src=x onerror=alert(1)>';
  search.dispatchEvent(new window.Event('input')); await sleep(160);
  assert.equal(document.querySelectorAll('#simple-deck-list img').length, 0);
  assert.ok(document.getElementById('simple-deck-list').textContent.includes('No matching decks'));
});


await test('organization has its own tab and leaves the default deck screen focused', async () => {
  ui.switchView('view-decks');
  document.querySelector('[data-deck-tab="tab-organize"]').click();
  assert.ok(document.getElementById('tab-organize').classList.contains('active'));
  assert.ok(document.getElementById('tab-collections').classList.contains('hidden'));
  assert.equal(document.querySelector('#tab-collections #win-explorer'), null);
  document.querySelector('[data-deck-tab="tab-collections"]').click();
});

await test('Add card opens a focused form with a clear way back to decks', async () => {
  ui.switchView('view-decks');
  document.querySelector('#view-decks .view-header [data-open-add]').click();
  await sleep(30);
  assert.ok(document.getElementById('tab-add').classList.contains('active'));
  assert.equal(document.activeElement.id, 'quick-front');
  assert.equal(document.getElementById('quick-front').tagName, 'TEXTAREA');
  document.querySelector('[data-return-decks]').click(); await sleep(30);
  assert.ok(document.getElementById('tab-collections').classList.contains('active'));
  assert.equal(document.activeElement.id, 'deck-tab-collections');
});

await test('Progress defaults to an overview and builds specialist charts only when requested', async () => {
  const analytics = await import('../js/analytics-ui.js');
  analytics.initAnalyticsUI();
  state.allCards = [original('overview')];
  ui.switchView('view-analytics');
  await analytics.renderAnalyticsView();
  assert.equal(document.getElementById('progress-overview').hidden, false);
  assert.equal(document.getElementById('progress-model').hidden, true);
  assert.equal(document.getElementById('analytics-calibration-chart-wrap').children.length, 0);
  document.querySelector('#progress-tabs [aria-controls="progress-model"]').click();
  assert.equal(document.getElementById('progress-overview').hidden, true);
  assert.equal(document.getElementById('progress-model').hidden, false);
  assert.ok(document.getElementById('analytics-calibration-chart-wrap').children.length > 0);
  assert.equal(document.querySelector('.app-nav .active').getAttribute('data-view'), 'view-analytics');
});

await test('Import exposes one method at a time and paste has an explicit preview action', async () => {
  const importer = await import('../js/import.js'); importer.initImportEventListeners();
  ui.switchView('view-import');
  assert.equal(document.getElementById('import-file-panel').hidden, false);
  assert.equal(document.getElementById('import-text-panel').hidden, true);
  document.querySelector('#import-tabs [aria-controls="import-text-panel"]').click();
  document.getElementById('import-text').value = 'Front,Back\nHello,Hola\nGoodbye,Adiós';
  document.getElementById('btn-parse-csv').click();
  assert.equal(String(document.getElementById('preview-count').textContent), '2');
  assert.equal(document.getElementById('import-preview-section').classList.contains('hidden'), false);
  document.querySelector('#import-tabs [aria-controls="import-starter-panel"]').click();
  assert.equal(document.querySelector('#view-import .import-container').hidden, true);
  assert.equal(document.getElementById('import-starter-panel').hidden, false);
  assert.ok(document.getElementById('import-preview-section').closest('.import-container'));
  assert.equal(document.querySelector('.app-nav .active').getAttribute('data-view'), 'view-decks');
});

await window.happyDOM.abort();
