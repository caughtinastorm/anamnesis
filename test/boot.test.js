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
} finally { console.error = originalError; await window.happyDOM.abort(); }
