/**
 * Card Browser & Multi-Card Management Module
 * 
 * Features:
 * 1. Virtualized / Infinite Chunked Scroll Rendering (smooth 10,000+ card browsing).
 * 2. Multi-Select Checkboxes & Glassmorphic Bulk Action Toolbar (Batch Move, Delete, Reset FSRS).
 * 3. Advanced Search Syntax (is:due, is:new, deck:..., folder:..., lapses:>N, reps:>N).
 * 4. Inline Edit Modal with Per-Card Audio Speech Language Configuration.
 */

import { state } from "./state.js";
import { showToast, showModal, scrollToElement } from "./ui.js";
import { getCardFolder, getCardDeck, getCardFullHierarchy, matchesDeckSelection, formatDeckSelectionLabel, limitText, escapeHTML, sanitizeHTML } from "./utils.js";
import { isCardDue, isCardNew, getCardNextReview, createDefaultFSRSStats } from "../fsrs.js";
import * as db from "../db.js";
import { loadCardsFromDB } from "./cards.js";
import { openCollectionPicker } from "./picker.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

let browserSearchInput;
let browserDeckFilter;
let browserCardsTbody;
let browserTotalCount;
let browserTableScrollContainer;
let browserSelectAll;
let browserBulkToolbar;
let bulkSelectedCount;
let btnBulkMove;
let btnBulkReset;
let btnBulkDelete;
let btnBulkDeselect;

let editModalContainer;
let editCardId;
let editCardFolder;
let editCardDeck;
let editCardFront;
let editCardSub;
let editCardBack;
let editCardDesc;
let editCardLang;
let editModalCancel;
let editModalSave;
let btnCloseEditModal;
let btnBrowserPicker;
let browserPickerLabel;

// Virtual / Infinite scroll state
let currentFilteredCards = [];
let currentRenderedCount = 0;
const CHUNK_SIZE = 50;

// Multi-select state
const selectedCardIds = new Set();

export function initCardBrowser() {
  browserSearchInput = document.getElementById("browser-search-input");
  browserDeckFilter = document.getElementById("browser-deck-filter");
  btnBrowserPicker = document.getElementById("btn-browser-deck-picker");
  browserPickerLabel = document.getElementById("browser-deck-filter-label");
  browserCardsTbody = document.getElementById("browser-cards-tbody");
  browserTotalCount = document.getElementById("browser-total-count");
  browserTableScrollContainer = document.getElementById("browser-table-scroll-container");

  browserSelectAll = document.getElementById("browser-select-all");
  browserBulkToolbar = document.getElementById("browser-bulk-toolbar");
  bulkSelectedCount = document.getElementById("bulk-selected-count");
  btnBulkMove = document.getElementById("btn-bulk-move");
  btnBulkReset = document.getElementById("btn-bulk-reset");
  btnBulkDelete = document.getElementById("btn-bulk-delete");
  btnBulkDeselect = document.getElementById("btn-bulk-deselect");

  editModalContainer = document.getElementById("edit-modal-container");
  editCardId = document.getElementById("edit-card-id");
  editCardFolder = document.getElementById("edit-card-folder");
  editCardDeck = document.getElementById("edit-card-deck");
  editCardFront = document.getElementById("edit-card-front");
  editCardSub = document.getElementById("edit-card-sub");
  editCardBack = document.getElementById("edit-card-back");
  editCardDesc = document.getElementById("edit-card-description");
  editCardLang = document.getElementById("edit-card-lang");
  editModalCancel = document.getElementById("edit-modal-cancel");
  editModalSave = document.getElementById("edit-modal-save");
  btnCloseEditModal = document.getElementById("btn-close-edit-modal");

  let searchDebounceTimer = null;
  if (browserSearchInput) {
    browserSearchInput.addEventListener("input", () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        renderCardBrowser();
      }, 120);
    });
  }

  if (browserDeckFilter) {
    browserDeckFilter.addEventListener("change", () => {
      setBrowserDeckSelection(browserDeckFilter.value);
    });
  }

  // Infinite Scroll Listener
  if (browserTableScrollContainer) {
    browserTableScrollContainer.addEventListener("scroll", handleBrowserScroll, { passive: true });
  }

  // Multi-Select Listeners
  if (browserSelectAll) {
    browserSelectAll.addEventListener("change", handleSelectAllToggle);
  }

  if (btnBulkDeselect) {
    btnBulkDeselect.addEventListener("click", clearSelection);
  }

  if (btnBulkDelete) {
    btnBulkDelete.addEventListener("click", handleBulkDelete);
  }

  if (btnBulkReset) {
    btnBulkReset.addEventListener("click", handleBulkResetFSRS);
  }

  if (btnBulkMove) {
    btnBulkMove.addEventListener("click", handleBulkMove);
  }

  if (btnBrowserPicker) {
    btnBrowserPicker.addEventListener("click", () => {
      const currentVal = browserDeckFilter ? (browserDeckFilter.value || "all") : "all";
      let initFolder, initDeck;
      if (currentVal.startsWith("folder:")) {
        initFolder = currentVal.substring(7);
        initDeck = "all";
      } else if (currentVal.startsWith("deck:")) {
        const parts = currentVal.substring(5).split(" / ");
        if (parts.length > 1) {
          initFolder = parts[0];
          initDeck = parts.slice(1).join(" / ");
        } else {
          initDeck = parts[0];
        }
      } else {
        initDeck = "all";
      }

      openCollectionPicker({
        title: "Filter Cards by Collection",
        initialFolder: initFolder,
        initialDeck: initDeck,
        allowRoot: true,
        onSelect: (folder, deck) => {
          let sel = "all";
          if (deck === "all" && folder) {
            sel = `folder:${folder}`;
          } else if (deck === "all" || (!folder && !deck)) {
            sel = "all";
          } else if (folder) {
            sel = `deck:${folder} / ${deck}`;
          } else {
            sel = `deck:${deck}`;
          }
          setBrowserDeckSelection(sel);
        }
      });
    });
  }

  if (editModalCancel) {
    editModalCancel.addEventListener("click", closeEditModal);
  }

  if (btnCloseEditModal) {
    btnCloseEditModal.addEventListener("click", closeEditModal);
  }

  if (editModalSave) {
    editModalSave.addEventListener("click", saveCardEdits);
  }
}

export function setBrowserDeckSelection(selection = "all") {
  if (!browserDeckFilter) browserDeckFilter = document.getElementById("browser-deck-filter");
  if (!browserPickerLabel) browserPickerLabel = document.getElementById("browser-deck-filter-label");

  const sel = selection || "all";
  if (browserDeckFilter) {
    let exists = Array.from(browserDeckFilter.options).some(o => o.value === sel);
    if (!exists && sel !== "all") {
      const o = document.createElement("option");
      o.value = sel;
      o.textContent = formatDeckSelectionLabel(sel);
      browserDeckFilter.appendChild(o);
    }
    browserDeckFilter.value = sel;
  }

  if (browserPickerLabel) {
    const rawLabel = formatDeckSelectionLabel(sel);
    browserPickerLabel.textContent = limitText(rawLabel, 26);
    browserPickerLabel.title = rawLabel;
  }

  renderCardBrowser();
}

export function populateBrowserDeckFilter() {
  if (!browserDeckFilter) return;

  const prev = browserDeckFilter.value || "all";
  const folderMap = new Map();
  const standaloneDecks = new Set();

  state.allCards.forEach(card => {
    if (card.deleted) return;
    const folder = getCardFolder(card);
    const deck = getCardDeck(card);
    if (folder) {
      if (!folderMap.has(folder)) folderMap.set(folder, new Set());
      folderMap.get(folder).add(deck);
    } else {
      standaloneDecks.add(deck || "Default");
    }
  });

  browserDeckFilter.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "📁 All Collections";
  browserDeckFilter.appendChild(optAll);

  Array.from(folderMap.keys()).sort().forEach(folder => {
    const grp = document.createElement("optgroup");
    grp.label = `📁 ${folder}`;
    const oAll = document.createElement("option");
    oAll.value = `folder:${folder}`;
    oAll.textContent = `📁 ${folder} (All Collections)`;
    grp.appendChild(oAll);

    Array.from(folderMap.get(folder)).sort().forEach(deck => {
      const o = document.createElement("option");
      o.value = `deck:${folder} / ${deck}`;
      o.textContent = `  ↳ ${deck}`;
      grp.appendChild(o);
    });
    browserDeckFilter.appendChild(grp);
  });

  if (standaloneDecks.size > 0) {
    const grp = document.createElement("optgroup");
    grp.label = "Collections";
    Array.from(standaloneDecks).sort().forEach(deck => {
      const o = document.createElement("option");
      o.value = `deck:${deck}`;
      o.textContent = deck;
      grp.appendChild(o);
    });
    browserDeckFilter.appendChild(grp);
  }

  setBrowserDeckSelection(prev);
}

/**
 * Advanced Search Syntax Evaluator
 */
function evaluateCardSearch(card, query, now) {
  if (!query) return true;
  const rawTerms = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [query];

  for (let term of rawTerms) {
    term = term.replace(/^"|"$/g, "").trim().toLowerCase();
    if (!term) continue;

    if (term === "is:due") {
      if (!isCardDue(card, now)) return false;
    } else if (term === "is:new") {
      if (!isCardNew(card)) return false;
    } else if (term === "is:review") {
      if (isCardNew(card) || isCardDue(card, now)) return false;
    } else if (term === "is:learning" || term === "is:relearning") {
      const st = card.fsrs_stats?.state;
      if (st !== 1 && st !== 3) return false;
    } else if (term.startsWith("deck:")) {
      const targetDeck = term.substring(5);
      if (!(card.deck || "").toLowerCase().includes(targetDeck)) return false;
    } else if (term.startsWith("folder:")) {
      const targetFolder = term.substring(7);
      if (!(card.folder || "").toLowerCase().includes(targetFolder)) return false;
    } else if (term.startsWith("lapses:>")) {
      const minLapses = parseInt(term.substring(8), 10);
      if (isNaN(minLapses) || (card.fsrs_stats?.lapses || 0) <= minLapses) return false;
    } else if (term.startsWith("lapses:")) {
      const exactLapses = parseInt(term.substring(7), 10);
      if (isNaN(exactLapses) || (card.fsrs_stats?.lapses || 0) !== exactLapses) return false;
    } else if (term.startsWith("reps:>")) {
      const minReps = parseInt(term.substring(6), 10);
      if (isNaN(minReps) || (card.fsrs_stats?.repetitions || 0) <= minReps) return false;
    } else {
      // General full-text matching across front, back, sub, desc, folder, deck
      const matchFront = (card.front || "").toLowerCase().includes(term);
      const matchBack = (card.back || "").toLowerCase().includes(term);
      const matchSub = (card.sub || "").toLowerCase().includes(term);
      const matchDesc = (card.description || "").toLowerCase().includes(term);
      const matchFolder = (card.folder || "").toLowerCase().includes(term);
      const matchDeck = (card.deck || "").toLowerCase().includes(term);
      if (!matchFront && !matchBack && !matchSub && !matchDesc && !matchFolder && !matchDeck) {
        return false;
      }
    }
  }

  return true;
}

export function renderCardBrowser() {
  if (!browserCardsTbody) return;

  const query = (browserSearchInput ? browserSearchInput.value : "").trim();
  const selectedDeck = browserDeckFilter ? (browserDeckFilter.value || "all") : "all";
  const now = Date.now();

  const activeCards = state.allCards.filter(card => !card.deleted);

  // Filter cards by collection & query
  currentFilteredCards = activeCards.filter(card => {
    if (!matchesDeckSelection(card, selectedDeck)) return false;
    return evaluateCardSearch(card, query, now);
  });

  if (browserTotalCount) {
    browserTotalCount.textContent = `Showing ${currentFilteredCards.length} of ${activeCards.length} flashcards`;
  }

  browserCardsTbody.innerHTML = "";
  currentRenderedCount = 0;

  if (currentFilteredCards.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyTd = document.createElement("td");
    emptyTd.colSpan = 6;
    emptyTd.style.textAlign = "center";
    emptyTd.style.padding = "28px 14px";
    emptyTd.style.color = "var(--text-secondary)";
    emptyTd.textContent = activeCards.length === 0 ? "No flashcards in your database yet." : "No cards match your search.";
    emptyRow.appendChild(emptyTd);
    browserCardsTbody.appendChild(emptyRow);
    updateBulkToolbar();
    return;
  }

  renderNextBrowserChunk();
  updateBulkToolbar();
}

function handleBrowserScroll() {
  if (!browserTableScrollContainer) return;
  const { scrollTop, clientHeight, scrollHeight } = browserTableScrollContainer;
  if (scrollTop + clientHeight >= scrollHeight - 150) {
    renderNextBrowserChunk();
  }
}

function renderNextBrowserChunk() {
  if (currentRenderedCount >= currentFilteredCards.length) return;

  const now = Date.now();
  const nextSlice = currentFilteredCards.slice(currentRenderedCount, currentRenderedCount + CHUNK_SIZE);
  const fragment = document.createDocumentFragment();

  nextSlice.forEach(card => {
    const row = document.createElement("tr");
    row.className = "browser-card-row";
    row.setAttribute("data-card-id", card.id);
    if (selectedCardIds.has(card.id)) {
      row.classList.add("selected");
    }

    // 0. Selection Checkbox
    const tdCheck = document.createElement("td");
    tdCheck.style.textAlign = "center";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "table-checkbox row-select-checkbox";
    checkbox.checked = selectedCardIds.has(card.id);
    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        selectedCardIds.add(card.id);
        row.classList.add("selected");
      } else {
        selectedCardIds.delete(card.id);
        row.classList.remove("selected");
      }
      updateBulkToolbar();
    });
    tdCheck.appendChild(checkbox);
    row.appendChild(tdCheck);

    // 1. Collection
    const tdColl = document.createElement("td");
    tdColl.innerHTML = `<span class="browser-deck-pill">${escapeHTML(getCardFullHierarchy(card))}</span>`;
    row.appendChild(tdColl);

    // 2. Front
    const tdFront = document.createElement("td");
    tdFront.className = "browser-cell-front";
    let frontHtml = `<strong>${sanitizeHTML(card.front)}</strong>`;
    if (card.sub) {
      frontHtml += `<div class="browser-cell-sub">${escapeHTML(card.sub)}</div>`;
    }
    tdFront.innerHTML = frontHtml;
    row.appendChild(tdFront);

    // 3. Back
    const tdBack = document.createElement("td");
    tdBack.className = "browser-cell-back";
    let backHtml = `<span>${sanitizeHTML(card.back)}</span>`;
    if (card.description) {
      backHtml += `<div class="browser-cell-desc">${escapeHTML(card.description)}</div>`;
    }
    tdBack.innerHTML = backHtml;
    row.appendChild(tdBack);

    // 4. Status Pill
    const tdStatus = document.createElement("td");
    const cardIsNew = isCardNew(card);
    const cardIsDue = isCardDue(card, now);
    const nextRev = getCardNextReview(card);

    let statusClass = "status-new";
    let statusText = "New";

    if (cardIsNew) {
      statusClass = "status-new";
      statusText = "New";
    } else if (cardIsDue) {
      statusClass = "status-due";
      statusText = "Due";
    } else {
      statusClass = "status-review";
      const daysLeft = Math.max(1, Math.ceil((nextRev - now) / (1000 * 60 * 60 * 24)));
      statusText = `${daysLeft}d`;
    }

    tdStatus.innerHTML = `<span class="status-badge ${statusClass}">${statusText}</span>`;
    row.appendChild(tdStatus);

    // 5. Actions (Edit & Delete)
    const tdActions = document.createElement("td");
    tdActions.style.textAlign = "right";
    tdActions.className = "browser-actions-cell";

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn-table-action btn-edit";
    btnEdit.title = "Edit Card";
    btnEdit.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    btnEdit.addEventListener("click", () => openEditCardModal(card.id));

    const btnDelete = document.createElement("button");
    btnDelete.className = "btn-table-action btn-delete";
    btnDelete.title = "Delete Card";
    btnDelete.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    btnDelete.addEventListener("click", () => deleteCard(card.id));

    tdActions.appendChild(btnEdit);
    tdActions.appendChild(btnDelete);
    row.appendChild(tdActions);

    fragment.appendChild(row);
  });

  browserCardsTbody.appendChild(fragment);
  currentRenderedCount += nextSlice.length;
}

// ==========================================================================
// Multi-Select & Bulk Operations
// ==========================================================================

function updateBulkToolbar() {
  const count = selectedCardIds.size;
  if (!browserBulkToolbar) browserBulkToolbar = document.getElementById("browser-bulk-toolbar");
  if (!bulkSelectedCount) bulkSelectedCount = document.getElementById("bulk-selected-count");
  if (!browserSelectAll) browserSelectAll = document.getElementById("browser-select-all");

  if (browserBulkToolbar) {
    browserBulkToolbar.classList.toggle("hidden", count === 0);
  }

  if (bulkSelectedCount) {
    bulkSelectedCount.textContent = `${count} selected`;
  }

  if (browserSelectAll && currentFilteredCards.length > 0) {
    const allFilteredSelected = currentFilteredCards.every(c => selectedCardIds.has(c.id));
    const someFilteredSelected = currentFilteredCards.some(c => selectedCardIds.has(c.id));
    browserSelectAll.checked = allFilteredSelected;
    browserSelectAll.indeterminate = (!allFilteredSelected && someFilteredSelected);
  }
}

function handleSelectAllToggle() {
  if (!browserSelectAll) return;
  if (browserSelectAll.checked) {
    currentFilteredCards.forEach(c => selectedCardIds.add(c.id));
  } else {
    currentFilteredCards.forEach(c => selectedCardIds.delete(c.id));
  }

  // Update visible rows
  const rowCheckboxes = browserCardsTbody.querySelectorAll(".row-select-checkbox");
  const rows = browserCardsTbody.querySelectorAll(".browser-card-row");
  rowCheckboxes.forEach((cb, idx) => {
    const row = rows[idx];
    const cardId = row?.getAttribute("data-card-id");
    if (cardId) {
      cb.checked = selectedCardIds.has(cardId);
      row.classList.toggle("selected", cb.checked);
    }
  });

  updateBulkToolbar();
}

function clearSelection() {
  selectedCardIds.clear();
  const rowCheckboxes = browserCardsTbody.querySelectorAll(".row-select-checkbox");
  const rows = browserCardsTbody.querySelectorAll(".browser-card-row");
  rowCheckboxes.forEach(cb => { cb.checked = false; });
  rows.forEach(r => r.classList.remove("selected"));
  if (browserSelectAll) {
    browserSelectAll.checked = false;
    browserSelectAll.indeterminate = false;
  }
  updateBulkToolbar();
}

async function handleBulkDelete() {
  const count = selectedCardIds.size;
  if (count === 0) return;

  showModal(
    `Delete ${count} Flashcards?`,
    `Are you sure you want to delete ${count} selected flashcards? This action will synchronize across your devices.`,
    async () => {
      const now = Date.now();
      const updatedCards = [];

      state.allCards.forEach(card => {
        if (selectedCardIds.has(card.id)) {
          updatedCards.push({
            ...card,
            deleted: true,
            last_modified: now
          });
        }
      });

      try {
        await db.saveCards(updatedCards);
        showToast(`Deleted ${count} flashcards`, "success");
        clearSelection();
        await loadCardsFromDB();
        onSyncRequest();
      } catch (err) {
        console.error("Bulk delete failed:", err);
        showToast("Failed to delete selected cards", "error");
      }
    }
  );
}

async function handleBulkResetFSRS() {
  const count = selectedCardIds.size;
  if (count === 0) return;

  showModal(
    `Reset Progress on ${count} Cards?`,
    `This will reset the FSRS memory stability and intervals for ${count} cards back to New state, and purge their review history.`,
    async () => {
      const now = Date.now();
      const updatedCards = [];

      state.allCards.forEach(card => {
        if (selectedCardIds.has(card.id)) {
          const copy = {
            ...card,
            fsrs_stats: createDefaultFSRSStats(),
            last_modified: now
          };
          delete copy.sm2_stats;
          updatedCards.push(copy);
        }
      });

      try {
        await db.saveCards(updatedCards);
        await db.deleteReviewLogsForCards(updatedCards.map(c => c.id));
        showToast(`Reset progress on ${count} flashcards`, "success");
        clearSelection();
        await loadCardsFromDB();
        onSyncRequest();
      } catch (err) {
        console.error("Bulk reset failed:", err);
        showToast("Failed to reset selected cards", "error");
      }
    }
  );
}

function handleBulkMove() {
  const count = selectedCardIds.size;
  if (count === 0) return;

  openCollectionPicker({
    title: `Move ${count} Cards to Collection`,
    allowRoot: false,
    onSelect: async (targetFolder, targetDeck) => {
      const now = Date.now();
      const updatedCards = [];

      state.allCards.forEach(card => {
        if (selectedCardIds.has(card.id)) {
          updatedCards.push({
            ...card,
            folder: targetFolder || undefined,
            deck: targetDeck || "Default",
            last_modified: now
          });
        }
      });

      try {
        await db.saveCards(updatedCards);
        showToast(`Moved ${count} cards to ${targetFolder ? targetFolder + " / " : ""}${targetDeck}`, "success");
        clearSelection();
        await loadCardsFromDB();
        onSyncRequest();
      } catch (err) {
        console.error("Bulk move failed:", err);
        showToast("Failed to move selected cards", "error");
      }
    }
  });
}

// ==========================================================================
// Single Card Edit Modal
// ==========================================================================

export function openEditCardModal(cardId) {
  const card = state.allCards.find(c => c.id === cardId);
  if (!card) {
    showToast("Card not found", "error");
    return;
  }

  editCardId.value     = card.id;
  editCardFolder.value = getCardFolder(card);
  editCardDeck.value   = getCardDeck(card);
  editCardFront.value  = card.front || "";
  editCardSub.value    = card.sub   || "";
  editCardBack.value   = card.back  || "";
  editCardDesc.value   = card.description || "";
  if (editCardLang) editCardLang.value = card.lang || "";

  editModalContainer.classList.remove("hidden");
}

export function closeEditModal() {
  if (editModalContainer) editModalContainer.classList.add("hidden");
}

export async function saveCardEdits() {
  const cardId = editCardId?.value;
  const card = state.allCards.find(c => c.id === cardId);
  if (!card) return;

  const front = editCardFront?.value.trim();
  const back = editCardBack?.value.trim();
  if (!front || !back) {
    showToast("Front and Back content cannot be empty", "error");
    return;
  }

  const folder = editCardFolder?.value.trim();
  const deck = editCardDeck?.value.trim() || "Default";
  const sub = editCardSub?.value.trim();
  const desc = editCardDesc?.value.trim();
  const lang = editCardLang?.value || undefined;

  const updatedCard = {
    ...card,
    front,
    back,
    sub: sub || undefined,
    description: desc || undefined,
    folder: folder || undefined,
    deck,
    lang,
    last_modified: Date.now()
  };

  try {
    await db.saveCard(updatedCard);
    showToast("Card updated successfully!", "success");
    closeEditModal();
    await loadCardsFromDB();
    onSyncRequest();
  } catch (err) {
    console.error("Failed to save card edits:", err);
    showToast("Failed to save card edits locally", "error");
  }
}

export function deleteCard(cardId) {
  const card = state.allCards.find(c => c.id === cardId);
  if (!card) return;

  showModal(
    "Delete Flashcard?",
    `Are you sure you want to delete this card: "${card.front}"?`,
    async () => {
      try {
        const deletedCard = {
          ...card,
          deleted: true,
          last_modified: Date.now()
        };
        await db.saveCard(deletedCard);
        selectedCardIds.delete(cardId);
        updateBulkToolbar();
        showToast("Card deleted", "success");
        await loadCardsFromDB();
        onSyncRequest();
      } catch (err) {
        console.error("Failed to delete card:", err);
        showToast("Failed to delete card locally", "error");
      }
    }
  );
}

/**
 * Refresh browser UI after card data changes.
 */
export function refreshBrowser() {
  populateBrowserDeckFilter();
  renderCardBrowser();
}

