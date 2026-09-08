import { state } from "./state.js";
import { dom, showToast, showModal, switchView } from "./ui.js";
import { getCardFolder, getCardDeck, getCardFullHierarchy, matchesDeckSelection, formatDeckSelectionLabel, limitText, escapeHTML, generateUUID, getLocalDateString } from "./utils.js";
import { isCardDue, isCardNew, createDefaultFSRSStats } from "../fsrs.js";
import * as db from "../db.js";
import { loadCardsFromDB } from "./cards.js";
import { openCollectionPicker } from "./picker.js";
import { loadN5KanjiDeck } from "./presets.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

/**
 * Called by cards.js subscriber after every loadCardsFromDB().
 * Registered in app.js via onCardsRefreshed(refreshDashboard).
 */
export function refreshDashboard() {
  invalidateStatsCache();
  populateDeckDropdown();
  calculateStats();
  updateUIStats();
  renderFoldersTree();
  renderHeatmap();
}

/**
 * Review Collections Explorer State
 */
export const reviewExplorerState = {
  currentFolder: null, // null = root (all folders + standalone decks); string = active folder name
  searchQuery: "",
  viewMode: "grid" // "grid" | "list"
};

/**
 * Set the active deck/collection filter across the application.
 * @param {string} selection e.g. "all", "folder:Spanish", "deck:Spanish / Verbs", "deck:Verbs"
 */
export function setActiveDeckSelection(selection = "all") {
  state.selectedDeck = selection || "all";

  // If selection is inside a folder, auto-open that folder in review explorer
  if (selection.startsWith("folder:")) {
    reviewExplorerState.currentFolder = selection.slice(7);
  } else if (selection.startsWith("deck:")) {
    const raw = selection.slice(5);
    const parts = raw.split(" / ");
    if (parts.length > 1) {
      reviewExplorerState.currentFolder = parts[0];
    }
  }

  // Sync hidden deckSelect dropdown for backwards compatibility
  if (dom.deckSelect && dom.deckSelect.options) {
    let exists = Array.from(dom.deckSelect.options).some(o => o.value === state.selectedDeck);
    if (!exists && state.selectedDeck !== "all") {
      const o = document.createElement("option");
      o.value = state.selectedDeck;
      o.textContent = formatDeckSelectionLabel(state.selectedDeck);
      dom.deckSelect.appendChild(o);
    }
    dom.deckSelect.value = state.selectedDeck;
  }

  calculateStats();
  updateUIStats();
  renderFoldersTree();
  if (selection && selection !== "all") {
    showToast(`Active Collection: ${formatDeckSelectionLabel(selection)}`, "info");
  }
}

export function populateDeckDropdown() {
  if (!dom.deckSelect) return;
  const currentSel = state.selectedDeck || "all";
  const folderMap = new Map();
  const standaloneDecks = new Set();
  const allFolderNames = new Set();
  const allDeckNames = new Set();

  state.allCards.forEach(card => {
    if (card.deleted) return;
    const folder = getCardFolder(card);
    const deck = getCardDeck(card);
    if (folder) {
      allFolderNames.add(folder);
      if (!folderMap.has(folder)) folderMap.set(folder, new Set());
      folderMap.get(folder).add(deck);
    } else {
      standaloneDecks.add(deck || "Default");
    }
    if (deck) allDeckNames.add(deck);
  });

  if (dom.folderSuggestions) {
    dom.folderSuggestions.innerHTML = "";
    allFolderNames.forEach(f => {
      const o = document.createElement("option"); o.value = f;
      dom.folderSuggestions.appendChild(o);
    });
  }
  if (dom.deckSuggestions) {
    dom.deckSuggestions.innerHTML = "";
    allDeckNames.forEach(d => {
      const o = document.createElement("option"); o.value = d;
      dom.deckSuggestions.appendChild(o);
    });
  }

  dom.deckSelect.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "all"; optAll.textContent = "📁 All Collections";
  dom.deckSelect.appendChild(optAll);

  Array.from(folderMap.keys()).sort().forEach(folder => {
    const grp = document.createElement("optgroup");
    grp.label = `📁 ${folder}`;
    const oAll = document.createElement("option");
    oAll.value = `folder:${folder}`; oAll.textContent = `📁 ${folder} (All Collections)`;
    grp.appendChild(oAll);
    Array.from(folderMap.get(folder)).sort().forEach(deck => {
      const o = document.createElement("option");
      o.value = `deck:${folder} / ${deck}`; o.textContent = `  ↳ ${deck}`;
      grp.appendChild(o);
    });
    dom.deckSelect.appendChild(grp);
  });

  if (standaloneDecks.size > 0) {
    const grp = document.createElement("optgroup");
    grp.label = "Collections";
    Array.from(standaloneDecks).sort().forEach(deck => {
      const o = document.createElement("option");
      o.value = `deck:${deck}`; o.textContent = deck;
      grp.appendChild(o);
    });
    dom.deckSelect.appendChild(grp);
  }

  const exists = Array.from(dom.deckSelect.options).some(o => o.value === currentSel);
  if (exists) {
    dom.deckSelect.value = currentSel;
  } else {
    state.selectedDeck = "all";
    dom.deckSelect.value = "all";
  }
}

// Memoized stats cache
let statsCache = new Map();
let cardsRevision = 0;

export function invalidateStatsCache() {
  cardsRevision++;
  statsCache.clear();
}

export function filterCards(customSelected = null) {
  const selected = customSelected !== null ? customSelected : (state.selectedDeck || "all");
  const cacheKey = `${selected}_rev${cardsRevision}_n${state.allCards.length}`;
  if (statsCache.has(cacheKey)) {
    return statsCache.get(cacheKey);
  }
  const result = state.allCards.filter(card => matchesDeckSelection(card, selected));
  statsCache.set(cacheKey, result);
  return result;
}

export function calculateStats() {
  const now = Date.now();
  const filtered = filterCards();
  state.dueCards = filtered.filter(c => isCardDue(c, now));
  state.newCards = filtered.filter(c => isCardNew(c));
}

export function updateUIStats() {
  const now = Date.now();
  const filteredTotal = filterCards().length;
  const due = state.dueCards.length;
  const newCount = state.newCards.length;

  if (dom.statDueCount) dom.statDueCount.textContent = due;
  if (dom.statNewCount) dom.statNewCount.textContent = newCount;
  if (dom.statTotalCount) dom.statTotalCount.textContent = filteredTotal;

  const overallDue = state.allCards.filter(c => isCardDue(c, now)).length;
  if (dom.navDueBadge) {
    dom.navDueBadge.textContent = overallDue;
    dom.navDueBadge.classList.toggle("hidden", overallDue === 0);
  }

  // Primary Start Due Button
  if (dom.btnStartReview) {
    dom.btnStartReview.classList.toggle("hidden", due === 0);
    dom.btnStartReview.innerHTML = `<svg class="btn-icon-svg" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Due Review (${due})`;
  }

  // Unlimited Practice Review Button
  if (dom.btnForceReview) {
    dom.btnForceReview.classList.toggle("hidden", filteredTotal === 0);
    if (due === 0 && filteredTotal > 0) {
      dom.btnForceReview.innerHTML = `<svg class="btn-icon-svg" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Practice All Cards (${filteredTotal} Cards)`;
    } else {
      dom.btnForceReview.innerHTML = `<svg class="btn-icon-svg" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Practice All (${filteredTotal} Cards)`;
    }
  }

  // Empty State Display
  if (dom.dashboardEmptyState) {
    if (filteredTotal === 0) {
      dom.dashboardEmptyState.classList.remove("hidden");
      const isLibraryEmpty = state.allCards.filter(c => !c.deleted).length === 0;
      if (isLibraryEmpty) {
        dom.dashboardEmptyState.querySelector("h3").textContent = "There are no cards available";
        dom.dashboardEmptyState.querySelector("p").textContent = "Your collection is empty. Use Quick Add or the Import tab to create flashcards.";
      } else {
        dom.dashboardEmptyState.querySelector("h3").textContent = "There are no cards available in this collection";
        dom.dashboardEmptyState.querySelector("p").textContent = "Pick another collection with the browser above or add cards to this deck.";
      }
    } else {
      dom.dashboardEmptyState.classList.add("hidden");
    }
  }

  updateDashboardPickerDisplay();
}

export function updateDashboardPickerDisplay() {
  const currentVal = state.selectedDeck || "all";
  const titleEl = document.getElementById("dashboard-deck-name");
  const subEl = document.getElementById("dashboard-deck-stats");
  const duePillEl = document.getElementById("dashboard-deck-due-pill");
  const resetBtn = document.getElementById("btn-dashboard-reset-deck");
  const resetFsrsBtn = document.getElementById("btn-dashboard-reset-fsrs");

  const filtered = filterCards();
  const due = state.dueCards.length;
  const total = filtered.length;

  const fullLabel = formatDeckSelectionLabel(currentVal);
  if (titleEl) {
    titleEl.textContent = limitText(fullLabel, 32);
    titleEl.title = fullLabel;
  }

  if (subEl) {
    subEl.textContent = currentVal === "all"
      ? `Entire Library • ${total} cards`
      : `${total} cards in this collection`;
  }

  if (duePillEl) {
    duePillEl.textContent = `${due} due`;
    duePillEl.classList.toggle("has-due", due > 0);
  }

  if (resetBtn) {
    resetBtn.classList.toggle("hidden", currentVal === "all");
    resetBtn.style.display = currentVal === "all" ? "none" : "inline-flex";
  }

  if (resetFsrsBtn) {
    resetFsrsBtn.classList.toggle("hidden", currentVal === "all");
    resetFsrsBtn.style.display = currentVal === "all" ? "none" : "inline-flex";
  }
}

export function initDashboardPickerButton() {
  const btn = document.getElementById("btn-dashboard-deck-picker");
  if (btn) {
    btn.addEventListener("click", () => {
      const currentVal = state.selectedDeck || "all";
      let initFolder, initDeck;
      if (currentVal.startsWith("folder:")) {
        initFolder = currentVal.substring(7);
        initDeck = "all";
      } else if (currentVal.startsWith("deck:")) {
        const full = currentVal.substring(5);
        const parts = full.split(" / ");
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
        title: "Select Collection to Study / Practice",
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
          setActiveDeckSelection(sel);
        }
      });
    });
  }

  const resetBtn = document.getElementById("btn-dashboard-reset-deck");
  if (resetBtn) {
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      setActiveDeckSelection("all");
      showToast("Reset to All Collections", "info");
    });
  }

  const resetFsrsBtn = document.getElementById("btn-dashboard-reset-fsrs");
  if (resetFsrsBtn) {
    resetFsrsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      promptResetCurrentSelectionFSRS();
    });
  }

  const exportBtn = document.getElementById("btn-dashboard-export-deck");
  if (exportBtn) {
    exportBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const currentVal = state.selectedDeck || "all";
      let folder, deck;
      if (currentVal.startsWith("folder:")) {
        folder = currentVal.slice(7);
      } else if (currentVal.startsWith("deck:")) {
        const full = currentVal.slice(5);
        const parts = full.split(" / ");
        if (parts.length > 1) {
          folder = parts[0];
          deck = parts.slice(1).join(" / ");
        } else {
          deck = parts[0];
        }
      }
      const { openExportModal } = await import("./explorer-actions.js");
      openExportModal(folder, deck);
    });
  }

  if (dom.btnDashboardAllDecks) {
    dom.btnDashboardAllDecks.addEventListener("click", () => {
      switchView("view-decks");
    });
  }

  // Review Explorer Toolbar Controls
  const btnReviewUp = document.getElementById("btn-review-explorer-up");
  if (btnReviewUp) {
    btnReviewUp.addEventListener("click", () => {
      if (reviewExplorerState.searchQuery) {
        reviewExplorerState.searchQuery = "";
        const searchInput = document.getElementById("review-explorer-search-input");
        if (searchInput) searchInput.value = "";
      } else if (reviewExplorerState.currentFolder !== null) {
        reviewExplorerState.currentFolder = null;
      }
      renderFoldersTree();
    });
  }

  const reviewSearchInput = document.getElementById("review-explorer-search-input");
  if (reviewSearchInput) {
    reviewSearchInput.addEventListener("input", (e) => {
      reviewExplorerState.searchQuery = (e.target.value || "").trim().toLowerCase();
      renderFoldersTree();
    });
  }

  const btnReviewGrid = document.getElementById("btn-review-view-grid");
  const btnReviewList = document.getElementById("btn-review-view-list");
  if (btnReviewGrid) {
    btnReviewGrid.addEventListener("click", () => {
      reviewExplorerState.viewMode = "grid";
      btnReviewGrid.classList.add("active");
      if (btnReviewList) btnReviewList.classList.remove("active");
      renderFoldersTree();
    });
  }
  if (btnReviewList) {
    btnReviewList.addEventListener("click", () => {
      reviewExplorerState.viewMode = "list";
      btnReviewList.classList.add("active");
      if (btnReviewGrid) btnReviewGrid.classList.remove("active");
      renderFoldersTree();
    });
  }

  const btnEmptyLoadN5 = document.getElementById("btn-empty-load-n5-kanji");
  if (btnEmptyLoadN5) {
    btnEmptyLoadN5.addEventListener("click", async () => {
      btnEmptyLoadN5.disabled = true;
      try {
        await loadN5KanjiDeck({ notify: true });
      } catch (err) {
        console.error("Failed to load preset deck:", err);
      } finally {
        btnEmptyLoadN5.disabled = false;
      }
    });
  }
}

/**
 * Render the Review Collections Explorer widget
 */
export function renderFoldersTree() {
  const container = dom.foldersTreeContainer || document.getElementById("folders-tree-container");
  if (!container) return;

  const breadcrumbsEl = document.getElementById("review-explorer-breadcrumbs");
  const btnUp = document.getElementById("btn-review-explorer-up");
  const isAtRoot = reviewExplorerState.currentFolder === null && !reviewExplorerState.searchQuery;

  if (btnUp) {
    btnUp.disabled = isAtRoot;
  }

  // Update Breadcrumbs
  if (breadcrumbsEl) {
    breadcrumbsEl.innerHTML = "";

    // Root chip: All Collections
    const rootChip = document.createElement("button");
    rootChip.type = "button";
    rootChip.className = `breadcrumb-chip ${isAtRoot ? "active" : ""}`;
    rootChip.innerHTML = `<svg class="chip-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>All Collections</span>`;
    rootChip.title = "View all collections";
    rootChip.addEventListener("click", () => {
      reviewExplorerState.currentFolder = null;
      reviewExplorerState.searchQuery = "";
      const searchInput = document.getElementById("review-explorer-search-input");
      if (searchInput) searchInput.value = "";
      renderFoldersTree();
    });
    breadcrumbsEl.appendChild(rootChip);

    // Active Folder Chip
    if (reviewExplorerState.currentFolder) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "›";
      breadcrumbsEl.appendChild(sep);

      const folderChip = document.createElement("button");
      folderChip.type = "button";
      folderChip.className = `breadcrumb-chip ${!reviewExplorerState.searchQuery ? "active" : ""}`;
      folderChip.innerHTML = `<svg class="chip-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>${escapeHTML(reviewExplorerState.currentFolder)}</span>`;
      folderChip.title = `Folder: ${reviewExplorerState.currentFolder}`;
      folderChip.addEventListener("click", () => {
        reviewExplorerState.searchQuery = "";
        const searchInput = document.getElementById("review-explorer-search-input");
        if (searchInput) searchInput.value = "";
        renderFoldersTree();
      });
      breadcrumbsEl.appendChild(folderChip);
    }

    // Active Search Query Chip
    if (reviewExplorerState.searchQuery) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "›";
      breadcrumbsEl.appendChild(sep);

      const searchChip = document.createElement("button");
      searchChip.type = "button";
      searchChip.className = "breadcrumb-chip active";
      searchChip.innerHTML = `<svg class="chip-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>"${escapeHTML(reviewExplorerState.searchQuery)}"</span>`;
      searchChip.title = "Click to clear search";
      searchChip.addEventListener("click", () => {
        reviewExplorerState.searchQuery = "";
        const searchInput = document.getElementById("review-explorer-search-input");
        if (searchInput) searchInput.value = "";
        renderFoldersTree();
      });
      breadcrumbsEl.appendChild(searchChip);
    }
  }

  container.className = `folders-tree-container review-explorer-viewport ${
    reviewExplorerState.viewMode === "list" ? "review-explorer-list" : "review-explorer-grid"
  }`;
  container.innerHTML = "";

  const now = Date.now();
  const folderMap = new Map();
  const standaloneMap = new Map();

  state.allCards.forEach(card => {
    if (card.deleted) return;
    const folder = getCardFolder(card);
    const deck = getCardDeck(card);
    const isDue = isCardDue(card, now);
    if (folder) {
      if (!folderMap.has(folder)) folderMap.set(folder, new Map());
      const dm = folderMap.get(folder);
      if (!dm.has(deck)) dm.set(deck, { total: 0, due: 0 });
      const s = dm.get(deck);
      s.total++;
      if (isDue) s.due++;
    } else {
      const d = deck || "Default";
      if (!standaloneMap.has(d)) standaloneMap.set(d, { total: 0, due: 0 });
      const s = standaloneMap.get(d);
      s.total++;
      if (isDue) s.due++;
    }
  });

  if (folderMap.size === 0 && standaloneMap.size === 0) {
    container.innerHTML = "<p class='help-text' style='padding: 14px 10px; width: 100%;'>No collections created yet. Add cards or import decks to begin.</p>";
    return;
  }

  const query = reviewExplorerState.searchQuery.toLowerCase();

  // Mode 1: Search Filter Active across all collections
  if (query) {
    let matchedCount = 0;

    // Matching Folders
    Array.from(folderMap.keys()).sort().forEach(folder => {
      const dm = folderMap.get(folder);
      let totalCards = 0, totalDue = 0;
      dm.forEach(s => { totalCards += s.total; totalDue += s.due; });

      if (folder.toLowerCase().includes(query)) {
        matchedCount++;
        container.appendChild(createFolderTile(folder, totalCards, totalDue, dm.size));
      }
    });

    // Matching Sub-decks inside folders
    Array.from(folderMap.keys()).sort().forEach(folder => {
      const dm = folderMap.get(folder);
      Array.from(dm.keys()).sort().forEach(deck => {
        if (deck.toLowerCase().includes(query)) {
          matchedCount++;
          const s = dm.get(deck);
          container.appendChild(createDeckTile(folder, deck, s.total, s.due));
        }
      });
    });

    // Matching Standalone Decks
    Array.from(standaloneMap.keys()).sort().forEach(deck => {
      if (deck.toLowerCase().includes(query)) {
        matchedCount++;
        const s = standaloneMap.get(deck);
        container.appendChild(createDeckTile(null, deck, s.total, s.due));
      }
    });

    if (matchedCount === 0) {
      container.innerHTML = `<p class='help-text' style='padding: 14px 10px; width: 100%;'>No collections match "<strong>${escapeHTML(query)}</strong>".</p>`;
    }
    return;
  }

  // Mode 2: Drilled down into a folder
  if (reviewExplorerState.currentFolder !== null) {
    const folder = reviewExplorerState.currentFolder;
    if (!folderMap.has(folder)) {
      reviewExplorerState.currentFolder = null;
      renderFoldersTree();
      return;
    }

    const dm = folderMap.get(folder);
    Array.from(dm.keys()).sort().forEach(deck => {
      const s = dm.get(deck);
      container.appendChild(createDeckTile(folder, deck, s.total, s.due));
    });
    return;
  }

  // Mode 3: Root Level (Folders + Standalone Decks)
  // 1. Folders
  Array.from(folderMap.keys()).sort().forEach(folder => {
    const dm = folderMap.get(folder);
    let totalCards = 0, totalDue = 0;
    dm.forEach(s => { totalCards += s.total; totalDue += s.due; });
    container.appendChild(createFolderTile(folder, totalCards, totalDue, dm.size));
  });

  // 2. Standalone Collections
  Array.from(standaloneMap.keys()).sort().forEach(deck => {
    const s = standaloneMap.get(deck);
    container.appendChild(createDeckTile(null, deck, s.total, s.due));
  });
}

/**
 * Create an interactive folder tile for the Review Explorer
 */
function createFolderTile(folder, totalCards, totalDue, subdeckCount) {
  const isSelected = state.selectedDeck === `folder:${folder}`;
  const tile = document.createElement("div");
  tile.className = `review-explorer-tile ${isSelected ? "is-active-deck" : ""}`;
  tile.title = `Click to open folder "${folder}"`;

  const header = document.createElement("div");
  header.className = "review-tile-header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "review-tile-title-group";
  titleGroup.innerHTML = `
    <div class="review-tile-icon">📁</div>
    <div class="review-tile-text">
      <div class="review-tile-title">${escapeHTML(folder)}</div>
      <div class="review-tile-sub">${subdeckCount} collection${subdeckCount === 1 ? "" : "s"}</div>
    </div>
  `;

  const badge = document.createElement("span");
  badge.className = `review-tile-badge ${totalDue > 0 ? "due" : ""}`;
  badge.textContent = `${totalCards} cards${totalDue > 0 ? ` • ${totalDue} due` : ""}`;

  header.appendChild(titleGroup);
  header.appendChild(badge);
  tile.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "review-tile-actions";

  const btnOpen = document.createElement("button");
  btnOpen.type = "button";
  btnOpen.className = "btn-review-tile-action";
  btnOpen.textContent = "Open ↳";
  btnOpen.title = `Open folder "${folder}"`;
  btnOpen.addEventListener("click", (e) => {
    e.stopPropagation();
    reviewExplorerState.currentFolder = folder;
    reviewExplorerState.searchQuery = "";
    const searchInput = document.getElementById("review-explorer-search-input");
    if (searchInput) searchInput.value = "";
    renderFoldersTree();
  });
  actions.appendChild(btnOpen);

  if (totalDue > 0) {
    const btnStudy = document.createElement("button");
    btnStudy.type = "button";
    btnStudy.className = "btn-review-tile-action btn-study";
    btnStudy.textContent = `Study (${totalDue})`;
    btnStudy.title = `Study due cards in folder "${folder}"`;
    btnStudy.addEventListener("click", async (e) => {
      e.stopPropagation();
      setActiveDeckSelection(`folder:${folder}`);
      switchView("view-review");
      const { startStudySession } = await import("./study.js");
      startStudySession(false);
    });
    actions.appendChild(btnStudy);
  }

  const btnPractice = document.createElement("button");
  btnPractice.type = "button";
  btnPractice.className = "btn-review-tile-action";
  btnPractice.textContent = "Practice";
  btnPractice.title = `Practice all ${totalCards} cards in "${folder}"`;
  btnPractice.addEventListener("click", async (e) => {
    e.stopPropagation();
    setActiveDeckSelection(`folder:${folder}`);
    switchView("view-review");
    const { startStudySession } = await import("./study.js");
    startStudySession(true);
  });
  actions.appendChild(btnPractice);

  const btnReset = document.createElement("button");
  btnReset.type = "button";
  btnReset.className = "btn-review-tile-action btn-icon-only";
  btnReset.title = `Reset FSRS spaced repetition data for folder "${folder}"`;
  btnReset.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
  btnReset.addEventListener("click", (e) => {
    e.stopPropagation();
    promptResetFolderFSRS(folder, totalCards);
  });
  actions.appendChild(btnReset);

  const btnDelete = document.createElement("button");
  btnDelete.type = "button";
  btnDelete.className = "btn-review-tile-action btn-icon-only";
  btnDelete.title = `Delete folder "${folder}" and all its collections`;
  btnDelete.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  btnDelete.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteFolder(folder, totalCards);
  });
  actions.appendChild(btnDelete);

  tile.appendChild(actions);

  tile.addEventListener("click", () => {
    reviewExplorerState.currentFolder = folder;
    reviewExplorerState.searchQuery = "";
    const searchInput = document.getElementById("review-explorer-search-input");
    if (searchInput) searchInput.value = "";
    renderFoldersTree();
  });

  return tile;
}

/**
 * Create an interactive deck tile for the Review Explorer
 */
function createDeckTile(folder, deck, total, due) {
  const selectionKey = folder ? `deck:${folder} / ${deck}` : `deck:${deck}`;
  const isSelected = state.selectedDeck === selectionKey;
  const tile = document.createElement("div");
  tile.className = `review-explorer-tile ${isSelected ? "is-active-deck" : ""}`;
  tile.title = `Select collection "${deck}"`;

  const header = document.createElement("div");
  header.className = "review-tile-header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "review-tile-title-group";
  titleGroup.innerHTML = `
    <div class="review-tile-icon">🗃️</div>
    <div class="review-tile-text">
      <div class="review-tile-title">${escapeHTML(deck)}</div>
      <div class="review-tile-sub">${folder ? escapeHTML(folder) : "Standalone collection"}</div>
    </div>
  `;

  const badge = document.createElement("span");
  badge.className = `review-tile-badge ${due > 0 ? "due" : ""}`;
  badge.textContent = `${total} cards${due > 0 ? ` • ${due} due` : ""}`;

  header.appendChild(titleGroup);
  header.appendChild(badge);
  tile.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "review-tile-actions";

  if (due > 0) {
    const btnStudy = document.createElement("button");
    btnStudy.type = "button";
    btnStudy.className = "btn-review-tile-action btn-study";
    btnStudy.textContent = `Study (${due})`;
    btnStudy.title = `Study due cards in "${deck}"`;
    btnStudy.addEventListener("click", async (e) => {
      e.stopPropagation();
      setActiveDeckSelection(selectionKey);
      switchView("view-review");
      const { startStudySession } = await import("./study.js");
      startStudySession(false);
    });
    actions.appendChild(btnStudy);
  }

  const btnPractice = document.createElement("button");
  btnPractice.type = "button";
  btnPractice.className = "btn-review-tile-action";
  btnPractice.textContent = "Practice";
  btnPractice.title = `Practice all ${total} cards in "${deck}"`;
  btnPractice.addEventListener("click", async (e) => {
    e.stopPropagation();
    setActiveDeckSelection(selectionKey);
    switchView("view-review");
    const { startStudySession } = await import("./study.js");
    startStudySession(true);
  });
  actions.appendChild(btnPractice);

  const btnReset = document.createElement("button");
  btnReset.type = "button";
  btnReset.className = "btn-review-tile-action btn-icon-only";
  btnReset.title = `Reset FSRS spaced repetition data for "${deck}"`;
  btnReset.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
  btnReset.addEventListener("click", (e) => {
    e.stopPropagation();
    promptResetDeckFSRS(folder, deck, total);
  });
  actions.appendChild(btnReset);

  const btnDelete = document.createElement("button");
  btnDelete.type = "button";
  btnDelete.className = "btn-review-tile-action btn-icon-only";
  btnDelete.title = `Delete collection "${deck}"`;
  btnDelete.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  btnDelete.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteDeck(folder, deck, total);
  });
  actions.appendChild(btnDelete);

  tile.appendChild(actions);

  tile.addEventListener("click", () => {
    setActiveDeckSelection(selectionKey);
  });

  return tile;
}

export function deleteDeck(folderName, deckName, count) {
  const label = folderName ? `${folderName} / ${deckName}` : deckName;
  showModal(
    `Delete Collection "${label}"?`,
    `Are you sure you want to delete this collection (${count} cards)? This will remove all of its cards.`,
    async () => {
      const now = Date.now();
      const toDelete = state.allCards.filter(c => {
        if (c.deleted) return false;
        if (folderName) {
          return getCardFolder(c).toLowerCase() === folderName.toLowerCase() &&
                 getCardDeck(c).toLowerCase() === deckName.toLowerCase();
        } else {
          return !getCardFolder(c) && getCardDeck(c).toLowerCase() === deckName.toLowerCase();
        }
      }).map(c => ({ ...c, deleted: true, last_modified: now }));

      if (toDelete.length > 0) {
        try {
          await db.saveCards(toDelete);
          showToast(`Deleted collection "${label}" (${toDelete.length} cards)`, "success");
          await loadCardsFromDB();
          onSyncRequest();
        } catch (err) {
          console.error("Delete deck error:", err);
          showToast("Failed to delete collection locally", "error");
        }
      }
    }
  );
}

export function deleteFolder(folderName, count) {
  showModal(
    `Delete Folder "${folderName}"?`,
    `Are you sure you want to delete the folder "${folderName}" and ALL of its collections (${count} total cards)?`,
    async () => {
      const now = Date.now();
      const toDelete = state.allCards.filter(c => {
        if (c.deleted) return false;
        return getCardFolder(c).toLowerCase() === folderName.toLowerCase();
      }).map(c => ({ ...c, deleted: true, last_modified: now }));

      if (toDelete.length > 0) {
        try {
          await db.saveCards(toDelete);
          showToast(`Deleted folder "${folderName}" (${toDelete.length} cards)`, "success");
          await loadCardsFromDB();
          onSyncRequest();
        } catch (err) {
          console.error("Delete folder error:", err);
          showToast("Failed to delete folder locally", "error");
        }
      }
    }
  );
}

export async function executeResetCardsFSRS(cardsToReset, label) {
  if (!cardsToReset || cardsToReset.length === 0) {
    showToast("No cards to reset", "info");
    return;
  }

  const now = Date.now();
  const updatedCards = cardsToReset.map(c => {
    const copy = { ...c, fsrs_stats: createDefaultFSRSStats(), last_modified: now };
    delete copy.sm2_stats;
    return copy;
  });
  const cardIds = updatedCards.map(c => c.id);

  try {
    await db.saveCards(updatedCards);
    await db.deleteReviewLogsForCards(cardIds);
    showToast(`Reset FSRS data for ${updatedCards.length} cards in "${label}"`, "success");
    await loadCardsFromDB();
    onSyncRequest();
  } catch (err) {
    console.error("Reset FSRS data error:", err);
    showToast("Failed to reset FSRS data", "error");
  }
}

export function promptResetCurrentSelectionFSRS() {
  const currentVal = state.selectedDeck || "all";
  if (currentVal === "all") {
    showToast("Select a specific collection or folder to reset FSRS data", "info");
    return;
  }

  const label = formatDeckSelectionLabel(currentVal);
  const targetCards = state.allCards.filter(c => !c.deleted && matchesDeckSelection(c, currentVal));

  if (targetCards.length === 0) {
    showToast(`No cards found in "${label}"`, "info");
    return;
  }

  showModal(
    `Reset FSRS Data for "${label}"?`,
    `Are you sure you want to completely erase FSRS spaced repetition data and review logs for all ${targetCards.length} cards in this collection? All cards will return to New state, but card content will NOT be deleted.`,
    () => executeResetCardsFSRS(targetCards, label)
  );
}

export function promptResetDeckFSRS(folderName, deckName, count) {
  const label = folderName ? `${folderName} / ${deckName}` : deckName;
  const targetCards = state.allCards.filter(c => {
    if (c.deleted) return false;
    if (folderName) {
      return getCardFolder(c).toLowerCase() === folderName.toLowerCase() &&
             getCardDeck(c).toLowerCase() === deckName.toLowerCase();
    } else {
      return !getCardFolder(c) && getCardDeck(c).toLowerCase() === deckName.toLowerCase();
    }
  });

  const cardCount = count !== undefined ? count : targetCards.length;
  showModal(
    `Reset FSRS Data for "${label}"?`,
    `Are you sure you want to completely erase FSRS spaced repetition data and review logs for this collection (${cardCount} cards)? All cards will return to New state, but card content will NOT be deleted.`,
    () => executeResetCardsFSRS(targetCards, label)
  );
}

export function promptResetFolderFSRS(folderName, count) {
  const targetCards = state.allCards.filter(c => {
    if (c.deleted) return false;
    return getCardFolder(c).toLowerCase() === folderName.toLowerCase();
  });

  const cardCount = count !== undefined ? count : targetCards.length;
  showModal(
    `Reset FSRS Data for Folder "${folderName}"?`,
    `Are you sure you want to completely erase FSRS spaced repetition data and review logs for ALL collections in folder "${folderName}" (${cardCount} cards)? All cards will return to New state, but card content will NOT be deleted.`,
    () => executeResetCardsFSRS(targetCards, folderName)
  );
}

export function recordDailyReview() {
  const today = getLocalDateString(new Date());
  let h = {};
  try { h = JSON.parse(localStorage.getItem("app-review-history") || "{}"); } catch(e) {}
  h[today] = (h[today] || 0) + 1;
  localStorage.setItem("app-review-history", JSON.stringify(h));
  renderHeatmap();
}

export function calculateStreak(h = {}) {
  let streak = 0;
  const d = new Date();
  const todayKey = getLocalDateString(d);
  if (h[todayKey] > 0) {
    streak++;
    d.setDate(d.getDate() - 1);
  } else {
    d.setDate(d.getDate() - 1);
    const yest = getLocalDateString(d);
    if (!h[yest] || h[yest] <= 0) return 0;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  for (let limit = 0; limit < 3650; limit++) {
    const key = getLocalDateString(d);
    if (h[key] > 0) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export function renderHeatmap() {
  if (!dom.dashboardHeatmapGrid) return;
  let h = {};
  try { h = JSON.parse(localStorage.getItem("app-review-history") || "{}"); } catch(e) {}
  dom.dashboardHeatmapGrid.innerHTML = "";
  let total = 0;
  const today = new Date();
  for (let i = 59; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = getLocalDateString(d);
    const count = h[key] || 0;
    total += count;
    const cell = document.createElement("div");
    cell.className = "heatmap-cell";
    cell.title = `${key}: ${count} reviews`;
    cell.classList.add(count === 0 ? "level-0" : count <= 5 ? "level-1" : count <= 15 ? "level-2" : count <= 30 ? "level-3" : "level-4");
    dom.dashboardHeatmapGrid.appendChild(cell);
  }
  const sub = document.getElementById("heatmap-reviews-count");
  if (sub) sub.textContent = `${total} reviews in last 60 days`;
  const streakVal = calculateStreak(h);
  const streak = document.getElementById("stat-streak-days");
  if (streak) streak.textContent = streakVal;
  const heroStreak = document.getElementById("hero-streak-days");
  if (heroStreak) heroStreak.textContent = `${streakVal}d`;
}

export async function handleQuickAddCard() {
  const front = dom.quickFront?.value.trim();
  const back = dom.quickBack?.value.trim();
  if (!front || !back) { showToast("Please enter both Front and Back content", "error"); return; }

  const now = Date.now();
  const card = {
    id: generateUUID(),
    front,
    sub: dom.quickSub?.value.trim() || undefined,
    back,
    description: dom.quickDescription?.value.trim() || undefined,
    folder: dom.quickFolder?.value.trim() || undefined,
    deck: dom.quickDeck?.value.trim() || "Default",
    lang: dom.quickLang?.value || undefined,
    fsrs_stats: createDefaultFSRSStats(),
    last_modified: now
  };

  try {
    await db.saveCard(card);
    showToast("Card added successfully!", "success");
    dom.quickFront.value = ""; dom.quickSub.value = "";
    dom.quickBack.value = ""; dom.quickDescription.value = "";
    await loadCardsFromDB();
    onSyncRequest();
  } catch (err) {
    console.error("Quick add error:", err);
    showToast("Failed to save card locally", "error");
  }
}
