import { calculateSM2 } from './sm2.js';
import * as db from './db.js';
import * as sync from './sync.js';

// ==========================================================================
// Application State
// ==========================================================================
let allCards = [];
let dueCards = [];
let newCards = [];
let studySessionCards = [];
let currentCardIndex = 0;
let isFlipped = false;
let isSwipeActive = false;

// Credentials cached in memory
let syncCredentials = sync.getSyncCredentials();

// Modal callback
let modalConfirmCallback = null;

// Touch gesture variables
let touchStartX = 0;
let touchStartY = 0;
let touchMoveX = 0;
let touchMoveY = 0;

// ==========================================================================
// DOM Elements
// ==========================================================================
const views = {
  review: document.getElementById('view-review'),
  import: document.getElementById('view-import'),
  settings: document.getElementById('view-settings')
};

const subviews = {
  dashboard: document.getElementById('subview-dashboard'),
  study: document.getElementById('subview-study')
};

const navItems = document.querySelectorAll('.nav-item');
const navDueBadge = document.getElementById('nav-due-badge');

// Dashboard elements
const deckSelect = document.getElementById('deck-select');
const statDueCount = document.getElementById('stat-due-count');
const statNewCount = document.getElementById('stat-new-count');
const statTotalCount = document.getElementById('stat-total-count');
const btnStartReview = document.getElementById('btn-start-review');
const dashboardEmptyState = document.getElementById('dashboard-empty-state');

// Study elements
const btnCancelStudy = document.getElementById('btn-cancel-study');
const studyProgressText = document.getElementById('study-progress-text');
const studyProgressBar = document.getElementById('study-progress-bar');
const flashcard = document.getElementById('flashcard');
const cardFrontSub = document.getElementById('card-front-sub');
const cardFrontContent = document.getElementById('card-front-content');
const cardBackSub = document.getElementById('card-back-sub');
const cardBackContent = document.getElementById('card-back-content');
const cardBackDivider = document.getElementById('card-back-divider');
const cardBackDescription = document.getElementById('card-back-description');
const studyHintBar = document.getElementById('study-hint-bar');
const studyGradingBar = document.getElementById('study-grading-bar');
const gradeButtons = document.querySelectorAll('.btn-grade');

// Quick Add elements
const quickFront = document.getElementById('quick-front');
const quickSub = document.getElementById('quick-sub');
const quickBack = document.getElementById('quick-back');
const quickDescription = document.getElementById('quick-description');
const quickDeck = document.getElementById('quick-deck');
const btnQuickAdd = document.getElementById('btn-quick-add');

// Import elements
const importFile = document.getElementById('import-file');
const importFileName = document.getElementById('import-file-name');
const importText = document.getElementById('import-text');
const btnParseCsv = document.getElementById('btn-parse-csv');
const importPreviewSection = document.getElementById('import-preview-section');
const previewCount = document.getElementById('preview-count');
const previewTableBody = document.getElementById('preview-table-body');
const btnCancelImport = document.getElementById('btn-cancel-import');
const btnConfirmImport = document.getElementById('btn-confirm-import');

// Settings elements
const settingsPat = document.getElementById('settings-pat');
const settingsGistId = document.getElementById('settings-gist-id');
const btnValidateToken = document.getElementById('btn-validate-token');
const btnCreateGist = document.getElementById('btn-create-gist');
const btnSaveCredentials = document.getElementById('btn-save-credentials');
const syncConsoleLog = document.getElementById('sync-console-log');
const manualSyncContainer = document.getElementById('manual-sync-container');
const btnForceSync = document.getElementById('btn-force-sync');
const syncLastTimeLabel = document.getElementById('sync-last-time-label');
const headerSyncStatus = document.getElementById('header-sync-status');
const syncLabelText = document.getElementById('sync-label-text');
const btnExportCsv = document.getElementById('btn-export-csv');
const btnClearDb = document.getElementById('btn-clear-db');
const themeButtons = document.querySelectorAll('.btn-theme');

// Modal & Toast elements
const modalContainer = document.getElementById('modal-container');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalBtnCancel = document.getElementById('modal-btn-cancel');
const modalBtnConfirm = document.getElementById('modal-btn-confirm');
const toastContainer = document.getElementById('toast-container');

// Temp memory for parsed cards awaiting import approval
let tempParsedCards = [];

// ==========================================================================
// Initialization & Database Loader
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initRouting();
  initTheme();
  initSettingsForm();
  initTouchGestures();
  initKeyboardShortcuts();
  
  // Register Service Worker for PWA
  registerServiceWorker();

  // Load cards from IndexedDB
  await loadCardsFromDB();
  
  // Attempt remote background sync on boot if configured
  performBackgroundSync();
});

/**
 * Load all cards from IndexedDB and update statistics
 */
async function loadCardsFromDB() {
  try {
    allCards = await db.getCards();
    populateDeckDropdown();
    calculateStats();
    updateUIStats();
  } catch (e) {
    console.error('Error loading cards from DB:', e);
    showToast('Failed to load local database', 'error');
  }
}

/**
 * Dynamically populates the deck selector dropdown based on unique cards data
 */
function populateDeckDropdown() {
  if (!deckSelect) return;
  const selectedDeck = deckSelect.value || 'all';

  // Find all unique custom decks
  const decks = new Set();
  allCards.forEach(card => {
    if (card.deck && card.deck !== 'Default') {
      decks.add(card.deck);
    }
  });

  // Re-build dropdown options
  deckSelect.innerHTML = '';

  const optAll = document.createElement('option');
  optAll.value = 'all';
  optAll.textContent = 'All Collections';
  deckSelect.appendChild(optAll);

  const optDefault = document.createElement('option');
  optDefault.value = 'Default';
  optDefault.textContent = 'Default';
  deckSelect.appendChild(optDefault);

  decks.forEach(deck => {
    const opt = document.createElement('option');
    opt.value = deck;
    opt.textContent = deck;
    deckSelect.appendChild(opt);
  });

  // Restore selection if still valid, otherwise default to "all"
  if (decks.has(selectedDeck) || selectedDeck === 'Default' || selectedDeck === 'all') {
    deckSelect.value = selectedDeck;
  } else {
    deckSelect.value = 'all';
  }
}

/**
 * Calculate card categories (due, new, total) based on current deck selection
 */
function calculateStats() {
  const now = Date.now();
  const selectedDeck = deckSelect ? deckSelect.value : 'all';
  
  // Filter cards by collection
  const filteredCards = allCards.filter(card => {
    if (selectedDeck === 'all') return true;
    const cardDeck = card.deck || 'Default';
    return cardDeck.toLowerCase() === selectedDeck.toLowerCase();
  });

  dueCards = filteredCards.filter(card => {
    const nextReview = card.sm2_stats?.next_review || 0;
    return nextReview <= now;
  });

  newCards = filteredCards.filter(card => {
    return !card.sm2_stats || card.sm2_stats.repetitions === 0;
  });
}

/**
 * Update UI counter fields and badge values
 */
function updateUIStats() {
  const selectedDeck = deckSelect ? deckSelect.value : 'all';
  const now = Date.now();

  // Filter cards by collection for total counter
  const filteredTotal = allCards.filter(card => {
    if (selectedDeck === 'all') return true;
    const cardDeck = card.deck || 'Default';
    return cardDeck.toLowerCase() === selectedDeck.toLowerCase();
  }).length;

  const due = dueCards.length;
  const newCount = newCards.length;

  statDueCount.textContent = due;
  statNewCount.textContent = newCount;
  statTotalCount.textContent = filteredTotal;

  // Calculate OVERALL due count across ALL decks for the bottom nav badge
  const overallDueCount = allCards.filter(card => {
    const nextReview = card.sm2_stats?.next_review || 0;
    return nextReview <= now;
  }).length;

  // Update bottom navigation badge
  if (overallDueCount > 0) {
    navDueBadge.textContent = overallDueCount;
    navDueBadge.classList.remove('hidden');
  } else {
    navDueBadge.classList.add('hidden');
  }

  // Update start button and empty states
  if (due > 0) {
    btnStartReview.classList.remove('hidden');
    dashboardEmptyState.classList.add('hidden');
  } else {
    btnStartReview.classList.add('hidden');
    dashboardEmptyState.classList.remove('hidden');
    
    if (filteredTotal > 0) {
      dashboardEmptyState.querySelector('h3').textContent = 'All Caught Up';
      dashboardEmptyState.querySelector('p').textContent = 'No cards due for review in this collection.';
    } else {
      dashboardEmptyState.querySelector('h3').textContent = 'No Cards Yet';
      dashboardEmptyState.querySelector('p').textContent = 'Add cards in the Import tab to get started.';
    }
  }
}

// ==========================================================================
// View Routing & Theme Manager
// ==========================================================================
function initRouting() {
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetView = item.getAttribute('data-view');
      
      // If user is currently studying, ask before leaving
      if (subviews.study.classList.contains('active') && targetView !== 'view-review') {
        showModal('Exit Study Session?', 'Your current session progress will be saved, but the remaining cards will be postponed.', () => {
          exitStudySession();
          switchView(targetView);
        });
      } else {
        switchView(targetView);
      }
    });
  });

  // Logo click returns to dashboard
  const handleLogoClick = () => {
    if (subviews.study.classList.contains('active')) {
      showModal('Exit Study Session?', 'Exit study session and return to dashboard?', () => {
        exitStudySession();
        switchView('view-review');
      });
    } else {
      switchView('view-review');
    }
  };

  document.getElementById('header-logo-home').addEventListener('click', handleLogoClick);
  const sidebarLogo = document.getElementById('sidebar-logo-home');
  if (sidebarLogo) {
    sidebarLogo.addEventListener('click', handleLogoClick);
  }

  // Sync button in header triggers settings redirect
  headerSyncStatus.addEventListener('click', () => {
    switchView('view-settings');
    scrollToElement(manualSyncContainer);
  });

  // Deck selector change updates statistics
  if (deckSelect) {
    deckSelect.addEventListener('change', () => {
      calculateStats();
      updateUIStats();
    });
  }

  // Quick Add form button click binding
  if (btnQuickAdd) {
    btnQuickAdd.addEventListener('click', handleQuickAddCard);
  }
}

function switchView(viewId) {
  // Update view classes
  Object.keys(views).forEach(key => {
    const view = views[key];
    if (view.id === viewId) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });

  // Update nav-item classes
  navItems.forEach(item => {
    if (item.getAttribute('data-view') === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function scrollToElement(element) {
  setTimeout(() => {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function initTheme() {
  const savedTheme = localStorage.getItem('app-theme') || 'system';
  applyTheme(savedTheme);

  themeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme-value');
      applyTheme(theme);
    });
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem('app-theme') === 'system') {
      applyTheme('system');
    }
  });
}

function applyTheme(theme) {
  localStorage.setItem('app-theme', theme);
  
  // Highlight correct button using data-theme-value attribute
  themeButtons.forEach(btn => {
    if (btn.getAttribute('data-theme-value') === theme) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  let effectiveTheme = theme;
  if (theme === 'system') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', effectiveTheme);
  
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', effectiveTheme === 'dark' ? '#121214' : '#ffffff');
  }
}

// ==========================================================================
// Spaced Repetition Study Session Loop
// ==========================================================================
btnStartReview.addEventListener('click', startStudySession);
btnCancelStudy.addEventListener('click', () => {
  showModal('Exit Study Session?', 'Exit study session and return to dashboard?', exitStudySession);
});

function startStudySession() {
  if (dueCards.length === 0) {
    showToast('No cards due for review!', 'info');
    return;
  }

  // Shuffle due cards to keep it fresh
  studySessionCards = shuffle([...dueCards]);
  currentCardIndex = 0;
  isFlipped = false;

  subviews.dashboard.classList.remove('active');
  subviews.study.classList.add('active');
  
  renderCurrentStudyCard();
}

function renderCurrentStudyCard() {
  if (currentCardIndex >= studySessionCards.length) {
    finishStudySession();
    return;
  }

  const card = studySessionCards[currentCardIndex];
  isFlipped = false;

  // Update progress indicator
  studyProgressText.textContent = `Card ${currentCardIndex + 1} of ${studySessionCards.length}`;
  const pct = (currentCardIndex / studySessionCards.length) * 100;
  studyProgressBar.style.width = `${pct}%`;

  // Render front and back content (allowing basic HTML styles)
  cardFrontContent.innerHTML = sanitizeHTML(card.front);
  cardBackContent.innerHTML = sanitizeHTML(card.back);

  // Render subtext (furigana / pronunciation) if populated
  if (card.sub) {
    cardFrontSub.textContent = card.sub;
    cardFrontSub.classList.remove('hidden');
    cardBackSub.textContent = card.sub;
    cardBackSub.classList.remove('hidden');
  } else {
    cardFrontSub.textContent = '';
    cardFrontSub.classList.add('hidden');
    cardBackSub.textContent = '';
    cardBackSub.classList.add('hidden');
  }

  // Render description (detailed notes) on back face if populated
  if (card.description) {
    cardBackDescription.innerHTML = sanitizeHTML(card.description);
    cardBackDescription.classList.remove('hidden');
    cardBackDivider.classList.remove('hidden');
  } else {
    cardBackDescription.innerHTML = '';
    cardBackDescription.classList.add('hidden');
    cardBackDivider.classList.add('hidden');
  }

  // Reset card layout classes
  flashcard.className = 'flashcard';
  studyHintBar.classList.remove('hidden');
  studyGradingBar.classList.add('hidden');
  
  // Scroll texts to top in case they were scrolled
  cardFrontContent.parentElement.scrollTop = 0;
  cardBackContent.parentElement.scrollTop = 0;
}

// Tap card to flip
flashcard.addEventListener('click', (e) => {
  if (e.target.closest('.btn-grade') || isSwipeActive) return;
  flipCard();
});

function flipCard() {
  isFlipped = !isFlipped;
  flashcard.classList.toggle('flipped', isFlipped);

  if (isFlipped) {
    studyHintBar.classList.add('hidden');
    studyGradingBar.classList.remove('hidden');
  } else {
    studyHintBar.classList.remove('hidden');
    studyGradingBar.classList.add('hidden');
  }
}

// Bind grade buttons
gradeButtons.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const grade = parseInt(btn.getAttribute('data-grade'), 10);
    submitCardGrade(grade);
  });
});

/**
 * Processes grading, updates DB, animates card swipe and moves to next card
 */
async function submitCardGrade(grade) {
  const card = studySessionCards[currentCardIndex];
  
  // Calculate SM-2 adjustments
  const updatedCard = calculateSM2(card, grade);
  
  try {
    // Save to IndexedDB
    await db.saveCard(updatedCard);
    
    // Learning queue extension: If card is forgotten/wrong (grade < 3), re-queue it at the end of the session list
    if (grade < 3) {
      studySessionCards.push(card);
    }
    
    // Animate Card out of viewport (swipe simulation)
    const isPassing = grade >= 3;
    const animationClass = isPassing ? 'slide-out-right-anim' : 'slide-out-left-anim';
    
    flashcard.classList.add(animationClass);
    
    // Wait for animation to finish before proceeding
    setTimeout(() => {
      flashcard.classList.remove(animationClass);
      currentCardIndex++;
      renderCurrentStudyCard();
    }, 250);

  } catch (e) {
    console.error('Error saving graded card:', e);
    showToast('Error saving progress locally', 'error');
  }
}

function finishStudySession() {
  showToast('Study session completed!', 'success');
  exitStudySession();
  performBackgroundSync();
}

function exitStudySession() {
  subviews.study.classList.remove('active');
  subviews.dashboard.classList.add('active');
  loadCardsFromDB();
}

// Helper: Shuffle array
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ==========================================================================
// Swipe & Drag Gestures (iOS Native Fluidity)
// ==========================================================================
function initTouchGestures() {
  flashcard.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !isFlipped) return;
    
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    isSwipeActive = true;
    
    flashcard.style.transition = 'none';
  }, { passive: true });

  flashcard.addEventListener('touchmove', (e) => {
    if (!isSwipeActive) return;
    
    const touch = e.touches[0];
    touchMoveX = touch.clientX - touchStartX;
    touchMoveY = touch.clientY - touchStartY;
    
    if (Math.abs(touchMoveX) > Math.abs(touchMoveY)) {
      if (e.cancelable) e.preventDefault();
    }
    
    const rotate = touchMoveX * 0.05;
    flashcard.style.transform = `rotateY(180deg) translate3d(${touchMoveX}px, ${touchMoveY}px, 0) rotate(${rotate}deg)`;
    
    if (touchMoveX > 40) {
      flashcard.style.borderColor = 'var(--accent-color)';
    } else if (touchMoveX < -40) {
      flashcard.style.borderColor = 'var(--danger-color)';
    } else {
      flashcard.style.borderColor = 'var(--panel-border)';
    }
  }, { passive: false });

  flashcard.addEventListener('touchend', () => {
    if (!isSwipeActive) return;
    isSwipeActive = false;
    
    flashcard.style.transition = '';
    flashcard.style.borderColor = '';
    
    const threshold = 120;
    if (touchMoveX > threshold) {
      flashcard.style.transform = '';
      submitCardGrade(5);
    } else if (touchMoveX < -threshold) {
      flashcard.style.transform = '';
      submitCardGrade(1);
    } else {
      flashcard.style.transform = 'rotateY(180deg)';
    }
    
    touchMoveX = 0;
    touchMoveY = 0;
  });
}

// ==========================================================================
// Keyboard Navigation Support
// ==========================================================================
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!subviews.study.classList.contains('active')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      flipCard();
    } else if (isFlipped && e.key >= '0' && e.key <= '5') {
      const grade = parseInt(e.key, 10);
      submitCardGrade(grade);
    } else if (e.code === 'Escape') {
      showModal('Exit Study Session?', 'Exit study session?', exitStudySession);
    }
  });
}

// ==========================================================================
// Native Quick Add Card Form
// ==========================================================================
async function handleQuickAddCard() {
  const front = quickFront.value.trim();
  const sub = quickSub.value.trim();
  const back = quickBack.value.trim();
  const desc = quickDescription.value.trim();
  const deck = quickDeck.value.trim() || 'Default';

  if (!front || !back) {
    showToast('Please enter both Front and Back content', 'error');
    return;
  }

  const now = Date.now();
  const newCard = {
    id: generateUUID(),
    front,
    sub: sub || undefined,
    back,
    description: desc || undefined,
    deck,
    sm2_stats: {
      ease_factor: 2.5,
      interval: 0,
      repetitions: 0,
      next_review: 0
    },
    last_modified: now
  };

  try {
    await db.saveCard(newCard);
    showToast('Card added successfully!', 'success');
    
    // Clear inputs
    quickFront.value = '';
    quickSub.value = '';
    quickBack.value = '';
    quickDescription.value = '';
    quickDeck.value = 'Default';
    
    // Reload cards and update stats
    await loadCardsFromDB();
    
    // Perform background sync
    performBackgroundSync();
  } catch (err) {
    console.error('Quick add write failure:', err);
    showToast('Failed to save card locally', 'error');
  }
}

// ==========================================================================
// CSV Importer Utility (Support Decks & Sub-texts)
// ==========================================================================
importFile.addEventListener('change', handleFileSelect);
btnParseCsv.addEventListener('click', handleCSVParseClick);
btnCancelImport.addEventListener('click', clearCSVPreview);
btnConfirmImport.addEventListener('click', commitImportedCards);

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) {
    importFileName.textContent = 'No file chosen';
    return;
  }
  
  importFileName.textContent = file.name;
  
  const reader = new FileReader();
  reader.onload = function(evt) {
    importText.value = evt.target.result;
    showToast('CSV file loaded. Click Preview to view.', 'info');
  };
  reader.onerror = function() {
    showToast('Failed to read CSV file', 'error');
  };
  reader.readAsText(file);
}

function handleCSVParseClick() {
  const text = importText.value.trim();
  if (!text) {
    showToast('Please paste CSV text or select a file.', 'error');
    return;
  }

  try {
    tempParsedCards = parseCSV(text);
    if (tempParsedCards.length === 0) {
      showToast('No valid rows found to import', 'error');
      return;
    }
    
    renderImportPreview(tempParsedCards);
  } catch (err) {
    console.error(err);
    showToast('Error parsing CSV content', 'error');
  }
}

/**
 * Split a CSV line respecting quoted parameters
 */
function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parses CSV raw text splitting on columns Front, Back, Sub-text, Deck
 */
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const cards = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = splitCSVLine(line).map(cleanCSVField);
    
    let front = fields[0] || '';
    let back = fields[1] || '';
    let sub = fields[2] || '';
    let deck = fields[3] || 'Default';
    let description = fields[4] || '';
    
    // Support "Front|Subtext" format in column 1
    if (front.includes('|')) {
      const parts = front.split('|');
      front = parts[0].trim();
      if (!sub) {
        sub = parts[1].trim();
      }
    }
    
    cards.push({ front, back, sub, deck, description });
  }
  
  return cards;
}

function cleanCSVField(field) {
  let cleaned = field.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }
  cleaned = cleaned.replace(/""/g, '"');
  return cleaned;
}

function renderImportPreview(cards) {
  previewTableBody.innerHTML = '';
  previewCount.textContent = cards.length;

  cards.forEach(card => {
    const row = document.createElement('tr');
    
    const tdFront = document.createElement('td');
    tdFront.textContent = card.front;
    
    const tdBack = document.createElement('td');
    tdBack.textContent = card.back;

    const tdSub = document.createElement('td');
    tdSub.textContent = card.sub || '-';

    const tdDeck = document.createElement('td');
    tdDeck.textContent = card.deck || 'Default';

    const tdDesc = document.createElement('td');
    tdDesc.textContent = card.description || '-';
    
    row.appendChild(tdFront);
    row.appendChild(tdBack);
    row.appendChild(tdSub);
    row.appendChild(tdDeck);
    row.appendChild(tdDesc);
    
    previewTableBody.appendChild(row);
  });

  importPreviewSection.classList.remove('hidden');
  scrollToElement(importPreviewSection);
}

function clearCSVPreview() {
  tempParsedCards = [];
  previewTableBody.innerHTML = '';
  importPreviewSection.classList.add('hidden');
  importText.value = '';
  importFile.value = '';
  importFileName.textContent = 'No file chosen';
}

async function commitImportedCards() {
  if (tempParsedCards.length === 0) return;

  const now = Date.now();
  const preparedCards = tempParsedCards.map(c => {
    return {
      id: generateUUID(),
      front: c.front,
      sub: c.sub || undefined,
      back: c.back,
      description: c.description || undefined,
      deck: c.deck || 'Default',
      sm2_stats: {
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
        next_review: 0
      },
      last_modified: now
    };
  });

  try {
    await db.saveCards(preparedCards);
    
    showToast(`Successfully imported ${preparedCards.length} cards!`, 'success');
    clearCSVPreview();
    
    await loadCardsFromDB();
    switchView('view-review');
    performBackgroundSync();
  } catch (e) {
    console.error('Import write failure:', e);
    showToast('Failed to write cards to local database', 'error');
  }
}

// Helper: UUID v4 generator
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Helper: Hardened HTML sanitizer — allows only specific tag names, no attributes
function sanitizeHTML(str) {
  // Step 1: Escape everything via textContent trick
  const temp = document.createElement('div');
  temp.textContent = str;
  let html = temp.innerHTML;

  // Step 2: Restore ONLY known-safe bare tags (no attributes allowed)
  const allowedTags = ['b', 'strong', 'i', 'em', 'code', 'br'];
  allowedTags.forEach(tag => {
    // Only restore self-closing <br> or bare open/close tags — no attributes
    if (tag === 'br') {
      html = html.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    } else {
      // Open tag: must be exactly <tag> with no attributes
      const openRe = new RegExp(`&lt;${tag}&gt;`, 'gi');
      const closeRe = new RegExp(`&lt;\\/${tag}&gt;`, 'gi');
      html = html.replace(openRe, `<${tag}>`);
      html = html.replace(closeRe, `</${tag}>`);
    }
  });

  return html;
}

// ==========================================================================
// GitHub Gist Synchronization Manager integration
// ==========================================================================
btnValidateToken.addEventListener('click', validateGitHubToken);
btnCreateGist.addEventListener('click', createSyncGist);
btnSaveCredentials.addEventListener('click', saveSyncConfig);
btnForceSync.addEventListener('click', triggerManualSync);

function initSettingsForm() {
  settingsPat.value = syncCredentials.pat || '';
  settingsGistId.value = syncCredentials.gistId || '';
  
  updateSyncUIState();
}

function logToConsole(text, isError = false) {
  syncConsoleLog.classList.remove('hidden');
  const line = document.createElement('div');
  line.style.color = isError ? 'var(--danger-color)' : '';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  syncConsoleLog.appendChild(line);
  syncConsoleLog.scrollTop = syncConsoleLog.scrollHeight;
}

async function validateGitHubToken() {
  const pat = settingsPat.value.trim();
  if (!pat) {
    showToast('Please enter a GitHub Token first', 'error');
    return;
  }

  logToConsole('Validating Personal Access Token with GitHub...');
  btnValidateToken.disabled = true;

  try {
    const user = await sync.testToken(pat);
    logToConsole(`Success! Connected as GitHub user: @${user.login}`);
    showToast(`Token valid! Account: @${user.login}`, 'success');
  } catch (err) {
    logToConsole(err.message, true);
    showToast('Token validation failed', 'error');
  } finally {
    btnValidateToken.disabled = false;
  }
}

async function createSyncGist() {
  const pat = settingsPat.value.trim();
  if (!pat) {
    showToast('Token required to create a Gist', 'error');
    return;
  }

  logToConsole('Creating a new private GitHub Gist for data synchronization...');
  btnCreateGist.disabled = true;

  try {
    const gistId = await sync.createFlashcardGist(pat);
    settingsGistId.value = gistId;
    logToConsole(`Success! Gist created with ID: ${gistId}`);
    logToConsole('Make sure to click "Save Config" below to persist these credentials.', false);
    showToast('Private Gist created successfully!', 'success');
  } catch (err) {
    logToConsole(err.message, true);
    showToast('Failed to create Gist', 'error');
  } finally {
    btnCreateGist.disabled = false;
  }
}

async function saveSyncConfig() {
  const pat = settingsPat.value.trim();
  const gistId = settingsGistId.value.trim();

  if (!pat) {
    sync.clearSyncCredentials();
    syncCredentials = { pat: '', gistId: '' };
    updateSyncUIState();
    showToast('Sync credentials removed.', 'info');
    return;
  }

  if (!gistId) {
    showToast('Please enter or create a Gist ID before saving.', 'error');
    return;
  }

  sync.saveSyncCredentials(pat, gistId);
  syncCredentials = { pat, gistId };
  updateSyncUIState();
  showToast('Credentials saved successfully!', 'success');

  // Trigger initial synchronization immediately
  triggerManualSync();
}

async function triggerManualSync() {
  if (!syncCredentials.pat || !syncCredentials.gistId) {
    showToast('Sync not configured', 'error');
    return;
  }

  setSyncStateIndicator('syncing');
  logToConsole('Starting database synchronization...');
  btnForceSync.disabled = true;

  try {
    const localCards = await db.getCards();
    const result = await sync.syncCards(localCards);
    
    if (result.status === 'merged_with_remote') {
      await db.clearDatabase();
      await db.saveCards(result.cards);
      logToConsole('Downloaded updates from Gist and merged conflicts successfully.');
    } else if (result.status === 'uploaded_local') {
      logToConsole('Local data uploaded and Remote Gist updated successfully.');
    }

    await loadCardsFromDB();

    logToConsole(`Sync complete. Cards count: ${allCards.length}`);
    showToast('Synchronization complete!', 'success');
    setSyncStateIndicator('synced');
  } catch (err) {
    logToConsole(`Sync failed: ${err.message}`, true);
    showToast('Sync failed', 'error');
    setSyncStateIndicator('failed');
  } finally {
    btnForceSync.disabled = false;
    updateSyncUIState();
  }
}

/**
 * Run sync silently in the background
 */
async function performBackgroundSync() {
  if (!syncCredentials.pat || !syncCredentials.gistId) {
    setSyncStateIndicator('unconfigured');
    return;
  }

  setSyncStateIndicator('syncing');
  
  try {
    const localCards = await db.getCards();
    const result = await sync.syncCards(localCards);
    
    if (result.status === 'merged_with_remote') {
      await db.clearDatabase();
      await db.saveCards(result.cards);
      await loadCardsFromDB();
      showToast('Synced card updates from cloud', 'success');
    }
    
    setSyncStateIndicator('synced');
  } catch (err) {
    console.error('Background sync failed:', err);
    setSyncStateIndicator('failed');
  }
}

function setSyncStateIndicator(state) {
  headerSyncStatus.className = 'header-sync';
  
  if (state === 'synced') {
    headerSyncStatus.classList.add('synced');
    syncLabelText.textContent = 'Synced';
  } else if (state === 'syncing') {
    headerSyncStatus.classList.add('syncing');
    syncLabelText.textContent = 'Syncing...';
  } else if (state === 'failed') {
    headerSyncStatus.classList.add('failed');
    syncLabelText.textContent = 'Sync Failed';
  } else {
    syncLabelText.textContent = 'Offline';
  }
}

function updateSyncUIState() {
  const { pat, gistId } = syncCredentials;
  
  if (pat && gistId) {
    manualSyncContainer.classList.remove('hidden');
    
    const lastSync = sync.getLastSyncTime();
    if (lastSync > 0) {
      syncLastTimeLabel.textContent = `Last synced: ${new Date(lastSync).toLocaleString()}`;
      setSyncStateIndicator('synced');
    } else {
      syncLastTimeLabel.textContent = 'Last synced: Never';
      setSyncStateIndicator('unconfigured');
    }
  } else {
    manualSyncContainer.classList.add('hidden');
    setSyncStateIndicator('unconfigured');
  }
}

// ==========================================================================
// Backup & Local Database Administration
// ==========================================================================
btnExportCsv.addEventListener('click', exportDatabaseToCSV);
btnClearDb.addEventListener('click', resetLocalDatabase);

async function exportDatabaseToCSV() {
  if (allCards.length === 0) {
    showToast('No cards to export', 'error');
    return;
  }

  let csvContent = '';
  allCards.forEach(card => {
    const front = escapeCSVField(card.front);
    const back = escapeCSVField(card.back);
    const sub = escapeCSVField(card.sub || '');
    const deck = escapeCSVField(card.deck || 'Default');
    const desc = escapeCSVField(card.description || '');
    csvContent += `${front},${back},${sub},${deck},${desc}\n`;
  });

  try {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `flashcards_backup_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('CSV Backup downloaded!', 'success');
  } catch (err) {
    console.error('CSV Export failure:', err);
    showToast('Failed to export CSV file', 'error');
  }
}

function escapeCSVField(field) {
  let escaped = field.replace(/"/g, '""');
  return `"${escaped}"`;
}

function resetLocalDatabase() {
  showModal(
    'Delete All Local Data?',
    'This will permanently erase all local flashcards from this browser. If cloud sync is configured, you can re-fetch them by forcing sync.',
    async () => {
      try {
        await db.clearDatabase();
        showToast('All local flashcards deleted', 'success');
        await loadCardsFromDB();
      } catch (err) {
        console.error('Reset DB failed:', err);
        showToast('Failed to clear database', 'error');
      }
    }
  );
}

// ==========================================================================
// Dialogs & Modal Controllers
// ==========================================================================
function showModal(title, body, onConfirm) {
  modalTitle.textContent = title;
  modalBody.textContent = body;
  modalConfirmCallback = onConfirm;
  
  modalContainer.classList.remove('hidden');
}

modalBtnCancel.addEventListener('click', () => {
  modalContainer.classList.add('hidden');
  modalConfirmCallback = null;
});

modalBtnConfirm.addEventListener('click', () => {
  modalContainer.classList.add('hidden');
  if (modalConfirmCallback) {
    modalConfirmCallback();
  }
  modalConfirmCallback = null;
});

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  if (type === 'success') {
    iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" style="display:block;"><polyline points="20 6 9 17 4 12"/></svg>`;
  } else if (type === 'error') {
    iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" style="display:block;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  } else {
    iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" style="display:block;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
  
  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  
  toast.appendChild(iconSpan);
  toast.appendChild(textSpan);
  toastContainer.appendChild(toast);
  
  // Fade out and remove toast after 3 seconds
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3000);
}

// ==========================================================================
// PWA Service Worker & Offline Registration
// ==========================================================================
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => {
          console.log('ServiceWorker registration successful with scope: ', reg.scope);
        })
        .catch(err => {
          console.warn('ServiceWorker registration failed: ', err);
        });
    });
  }
}
