/**
 * Card Browser & Single Card Editor Module
 * 
 * Provides live search, filtering, inline editing, and deletion for individual cards.
 */

import { state } from "./state.js";
import { showToast, showModal, scrollToElement } from "./ui.js";
import { getCardFolder, getCardDeck, getCardFullHierarchy, escapeHTML, sanitizeHTML } from "./utils.js";
import * as db from "../db.js";
import { loadCardsFromDB, populateDeckDropdown } from "./dashboard.js";
import { openCollectionPicker } from "./picker.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

let browserSearchInput;
let browserDeckFilter;
let browserCardsTbody;
let browserTotalCount;
let editModalContainer;
let editCardId;
let editCardFolder;
let editCardDeck;
let editCardFront;
let editCardSub;
let editCardBack;
let editCardDesc;
let editModalCancel;
let editModalSave;
let btnCloseEditModal;
let btnBrowserPicker;
let browserPickerLabel;

export function initCardBrowser() {
  browserSearchInput = document.getElementById("browser-search-input");
  browserDeckFilter = document.getElementById("browser-deck-filter");
  browserCardsTbody = document.getElementById("browser-cards-tbody");
  browserTotalCount = document.getElementById("browser-total-count");
  btnBrowserPicker = document.getElementById("btn-browser-deck-picker");
  browserPickerLabel = document.getElementById("browser-deck-filter-label");

  editModalContainer = document.getElementById("edit-modal-container");
  editCardId = document.getElementById("edit-card-id");
  editCardFolder = document.getElementById("edit-card-folder");
  editCardDeck = document.getElementById("edit-card-deck");
  editCardFront = document.getElementById("edit-card-front");
  editCardSub = document.getElementById("edit-card-sub");
  editCardBack = document.getElementById("edit-card-back");
  editCardDesc = document.getElementById("edit-card-description");
  editModalCancel = document.getElementById("edit-modal-cancel");
  editModalSave = document.getElementById("edit-modal-save");
  btnCloseEditModal = document.getElementById("btn-close-edit-modal");

  if (browserSearchInput) {
    browserSearchInput.addEventListener("input", () => renderCardBrowser());
  }

  if (browserDeckFilter) {
    browserDeckFilter.addEventListener("change", () => renderCardBrowser());
  }

  if (btnBrowserPicker) {
    btnBrowserPicker.addEventListener("click", () => {
      const currentVal = browserDeckFilter ? (browserDeckFilter.value || "all") : "all";
      let initFolder, initDeck;
      if (currentVal.startsWith("folder:")) {
        initFolder = currentVal.substring(7);
        initDeck = "Default";
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
          if (deck === "all") {
            browserDeckFilter.value = "all";
            if (browserPickerLabel) browserPickerLabel.textContent = "📁 All Collections";
          } else if (folder) {
            browserDeckFilter.value = `deck:${folder} / ${deck}`;
            if (browserPickerLabel) browserPickerLabel.textContent = `📁 ${folder} / ${deck}`;
          } else {
            browserDeckFilter.value = `deck:${deck}`;
            if (browserPickerLabel) browserPickerLabel.textContent = `🗂️ ${deck}`;
          }
          renderCardBrowser();
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

export function populateBrowserDeckFilter() {
  if (!browserDeckFilter) browserDeckFilter = document.getElementById("browser-deck-filter");
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

  const exists = Array.from(browserDeckFilter.options).some(o => o.value === prev);
  browserDeckFilter.value = exists ? prev : "all";
}

export function renderCardBrowser() {
  if (!browserCardsTbody) browserCardsTbody = document.getElementById("browser-cards-tbody");
  if (!browserCardsTbody) return;

  const query = (browserSearchInput ? browserSearchInput.value : "").trim().toLowerCase();
  const selectedDeck = browserDeckFilter ? (browserDeckFilter.value || "all") : "all";

  const now = Date.now();
  const activeCards = state.allCards.filter(card => !card.deleted);

  // Filter cards by collection & query
  const filtered = activeCards.filter(card => {
    // 1. Deck Filter
    if (selectedDeck !== "all") {
      if (selectedDeck.startsWith("folder:")) {
        const target = selectedDeck.substring(7).toLowerCase();
        if (getCardFolder(card).toLowerCase() !== target) return false;
      } else if (selectedDeck.startsWith("deck:")) {
        const target = selectedDeck.substring(5).toLowerCase();
        if (getCardFullHierarchy(card).toLowerCase() !== target) return false;
      }
    }

    // 2. Search Query
    if (query) {
      const matchFront = (card.front || "").toLowerCase().includes(query);
      const matchBack = (card.back || "").toLowerCase().includes(query);
      const matchSub = (card.sub || "").toLowerCase().includes(query);
      const matchDesc = (card.description || "").toLowerCase().includes(query);
      const matchFolder = (card.folder || "").toLowerCase().includes(query);
      const matchDeck = (card.deck || "").toLowerCase().includes(query);

      return matchFront || matchBack || matchSub || matchDesc || matchFolder || matchDeck;
    }

    return true;
  });

  if (browserTotalCount) {
    browserTotalCount.textContent = `Showing ${filtered.length} of ${activeCards.length} flashcards`;
  }

  browserCardsTbody.innerHTML = "";

  if (filtered.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyTd = document.createElement("td");
    emptyTd.colSpan = 5;
    emptyTd.style.textAlign = "center";
    emptyTd.style.padding = "28px 14px";
    emptyTd.style.color = "var(--text-secondary)";
    emptyTd.textContent = activeCards.length === 0 ? "No flashcards in your database yet." : "No cards match your search.";
    emptyRow.appendChild(emptyTd);
    browserCardsTbody.appendChild(emptyRow);
    return;
  }

  // Render max 120 cards for instant scroll performance
  const displaySlice = filtered.slice(0, 120);

  displaySlice.forEach(card => {
    const row = document.createElement("tr");
    row.className = "browser-card-row";

    // 1. Collection
    const tdColl = document.createElement("td");
    tdColl.innerHTML = `<span class="browser-deck-pill">${escapeHTML(getCardFullHierarchy(card))}</span>`;
    row.appendChild(tdColl);

    // 2. Front (with subtext if present)
    const tdFront = document.createElement("td");
    tdFront.className = "browser-cell-front";
    let frontHtml = `<strong>${escapeHTML(card.front)}</strong>`;
    if (card.sub) {
      frontHtml += `<div class="browser-cell-sub">${escapeHTML(card.sub)}</div>`;
    }
    tdFront.innerHTML = frontHtml;
    row.appendChild(tdFront);

    // 3. Back (with description if present)
    const tdBack = document.createElement("td");
    tdBack.className = "browser-cell-back";
    let backHtml = `<span>${escapeHTML(card.back)}</span>`;
    if (card.description) {
      backHtml += `<div class="browser-cell-desc">${escapeHTML(card.description)}</div>`;
    }
    tdBack.innerHTML = backHtml;
    row.appendChild(tdBack);

    // 4. Status Pill
    const tdStatus = document.createElement("td");
    const reps = card.sm2_stats?.repetitions || 0;
    const nextRev = card.sm2_stats?.next_review || 0;
    const isDue = nextRev <= now;

    let statusClass = "status-new";
    let statusText = "New";

    if (reps === 0) {
      statusClass = "status-new";
      statusText = "New";
    } else if (isDue) {
      statusClass = "status-due";
      statusText = "Due";
    } else {
      statusClass = "status-review";
      const daysLeft = Math.ceil((nextRev - now) / (1000 * 60 * 60 * 24));
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

    browserCardsTbody.appendChild(row);
  });

  if (filtered.length > 120) {
    const moreRow = document.createElement("tr");
    const moreTd = document.createElement("td");
    moreTd.colSpan = 5;
    moreTd.style.textAlign = "center";
    moreTd.style.fontStyle = "italic";
    moreTd.style.color = "var(--text-secondary)";
    moreTd.textContent = `... and ${filtered.length - 120} more matching cards (use search filter to refine).`;
    moreRow.appendChild(moreTd);
    browserCardsTbody.appendChild(moreRow);
  }
}

export function openEditCardModal(cardId) {
  const card = state.allCards.find(c => c.id === cardId);
  if (!card) {
    showToast("Card not found", "error");
    return;
  }

  if (!editModalContainer) editModalContainer = document.getElementById("edit-modal-container");
  if (!editCardId) editCardId = document.getElementById("edit-card-id");
  if (!editCardFolder) editCardFolder = document.getElementById("edit-card-folder");
  if (!editCardDeck) editCardDeck = document.getElementById("edit-card-deck");
  if (!editCardFront) editCardFront = document.getElementById("edit-card-front");
  if (!editCardSub) editCardSub = document.getElementById("edit-card-sub");
  if (!editCardBack) editCardBack = document.getElementById("edit-card-back");
  if (!editCardDesc) editCardDesc = document.getElementById("edit-card-description");

  editCardId.value = card.id;
  editCardFolder.value = getCardFolder(card);
  editCardDeck.value = getCardDeck(card);
  editCardFront.value = card.front || "";
  editCardSub.value = card.sub || "";
  editCardBack.value = card.back || "";
  editCardDesc.value = card.description || "";

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

  const updatedCard = {
    ...card,
    front,
    back,
    sub: sub || undefined,
    description: desc || undefined,
    folder: folder || undefined,
    deck,
    last_modified: Date.now()
  };

  try {
    await db.saveCard(updatedCard);
    showToast("Card updated successfully!", "success");
    closeEditModal();
    await loadCardsFromDB();
    populateBrowserDeckFilter();
    renderCardBrowser();
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
        showToast("Card deleted", "success");
        await loadCardsFromDB();
        populateBrowserDeckFilter();
        renderCardBrowser();
        onSyncRequest();
      } catch (err) {
        console.error("Failed to delete card:", err);
        showToast("Failed to delete card locally", "error");
      }
    }
  );
}
