import { cardState, selectionState } from './state.js';
import { getCardDeck, getCardFolder, escapeHTML, matchesDeckSelection } from './utils.js';
import { isCardDue } from '../fsrs.js';
import { switchView } from './ui.js';

export function updateMinimalHome() {
  const root = document.getElementById('subview-dashboard');
  if (!root) return;
  const total = cardState.allCards.filter(card => matchesDeckSelection(card, selectionState.selectedDeck)).length;
  root.classList.toggle('has-no-cards', total === 0);
  const due = cardState.dueCards.length;
  document.getElementById("hero-due-large-num")?.classList.toggle("is-complete", due === 0);
  const label = document.getElementById('hero-due-status-title');
  if (label) label.textContent = due === 1 ? 'card ready to review' : due ? 'cards ready to review' : 'You’re all caught up.';
  const hint = document.getElementById('simple-session-hint');
  const configured = Number.parseInt(localStorage.getItem('app-review-cap') ?? '10', 10);
  const count = configured > 0 ? Math.min(due, configured) : due;
  if (hint) hint.textContent = due ? `${count}-card session. One small step at a time.` : 'Come back when your next cards are ready, or practice a little now.';
  const practice = document.getElementById('btn-force-review');
  if (practice) {
    const slot = document.getElementById(due ? 'practice-secondary-slot' : 'today-primary-actions');
    if (slot && practice.parentElement !== slot) slot.append(practice);
    practice.classList.toggle('btn-primary', due === 0);
    practice.classList.toggle('btn-secondary', due > 0);
    practice.textContent = due ? 'Practice anytime' : 'Practice a little';
  }
  const select = document.getElementById('today-deck-select');
  if (select) {
    const current = selectionState.selectedDeck || 'all';
    const decks = new Map();
    for (const card of cardState.allCards) {
      if (card.deleted) continue;
      const folder = getCardFolder(card), deck = getCardDeck(card);
      const name = folder ? `${folder} / ${deck}` : deck;
      decks.set(`deck:${name}`, name);
    }
    select.replaceChildren();
    const choices = [['all', 'All decks'], ...[...decks].sort((a,b) => a[1].localeCompare(b[1]))];
    if (!choices.some(([value]) => value === current)) choices.push([current, current.replace(/^(deck|folder):/, '')]);
    for (const [value, name] of choices) {
      const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option);
    }
    select.value = current;
  }
}

export function renderSimpleDecks() {
  const list = document.getElementById('simple-deck-list');
  if (!list) return;
  const grouped = new Map();
  for (const card of cardState.allCards) {
    if (card.deleted) continue;
    const folder = getCardFolder(card), deck = getCardDeck(card);
    const key = JSON.stringify([folder, deck]);
    if (!grouped.has(key)) grouped.set(key, { folder, deck, cards: [] });
    grouped.get(key).cards.push(card);
  }
  list.replaceChildren();
  const decks = [...grouped.values()].sort((a, b) => a.deck.localeCompare(b.deck));
  const count = document.getElementById('simple-deck-count');
  if (count) count.textContent = `${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}`;
  for (const group of decks) {
    const due = group.cards.filter(card => isCardDue(card));
    const row = document.createElement('article');
    row.className = 'simple-deck-row';
    row.innerHTML = `<span class="deck-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="6" width="14" height="15" rx="3"/><path d="M8 3h8"/></svg></span><button type="button" class="deck-open"><strong>${escapeHTML(group.deck)}</strong><span>${group.folder ? escapeHTML(group.folder) + ' · ' : ''}${group.cards.length} ${group.cards.length === 1 ? 'card' : 'cards'}</span></button><span class="deck-due ${due.length ? '' : 'deck-done'}">${due.length ? due.length + ' ready' : 'Up to date'}</span><button type="button" class="btn btn-secondary deck-study">${due.length ? 'Review' : 'Practice'}<span class="sr-only"> ${escapeHTML(group.deck)}</span></button>`;
    row.querySelector('.deck-open').addEventListener('click', async () => {
      const { setBrowserDeckSelection } = await import('./browser.js');
      const { switchDecksTab } = await import('./explorer.js');
      setBrowserDeckSelection(`deck:${group.folder ? group.folder + ' / ' : ''}${group.deck}`);
      switchDecksTab('tab-browser');
    });
    row.querySelector('.deck-study').addEventListener('click', async () => {
      const { startStudySession } = await import('./study.js');
      switchView('view-review');
      startStudySession(!due.length, due.length ? due : group.cards, group.deck, due.length ? true : false);
    });
    list.append(row);
  }
  if (!decks.length) {
    list.innerHTML = '<div class="simple-list-empty"><h3>A home for your ideas.</h3><p>Add your first card to start a deck.</p><button type="button" class="btn btn-primary" data-open-add>Add a card</button></div>';
  }
}

export function initMinimalUI() {
  document.getElementById('today-deck-select')?.addEventListener('change', async event => {
    const value = event.target.value;
    const { setActiveDeckSelection } = await import('./dashboard.js');
    setActiveDeckSelection(value);
  });
  document.addEventListener('click', async event => {
    const add = event.target.closest('[data-open-add]');
    if (!add) return;
    const { isStudyBusy, exitStudySession } = await import('./study.js');
    if (isStudyBusy()) return;
    exitStudySession();
    const { switchDecksTab } = await import('./explorer.js');
    switchView('view-decks');
    switchDecksTab('tab-add');
    document.getElementById('quick-front')?.focus();
  });
}
