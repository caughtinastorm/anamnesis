/**
 * Windows-Style File Explorer Deck Manager Module
 *
 * Provides a desktop file explorer navigation system for folders and collections:
 * - Address bar with interactive breadcrumb path navigation
 * - Back, Forward, Up, and Refresh toolbar controls
 * - Hierarchical folder tree sidebar
 * - Grid (Tiles) & Details (Table) view modes
 * - Delegates all CRUD, rename, delete, export, and context-menu actions
 *   to explorer-actions.js (zero circular imports)
 */

import { state } from "./state.js";
import { dom, showToast, switchView } from "./ui.js";
import { getCardFolder, getCardDeck, escapeHTML } from "./utils.js";
import { isCardDue, isCardNew, getCardNextReview } from "../fsrs.js";
import { loadCardsFromDB } from "./cards.js";
import { calculateStats, updateUIStats, setActiveDeckSelection } from "./dashboard.js";
import { setImportDestination } from "./import.js";

import { openEditCardModal, deleteCard } from "./browser.js";
import { explorerState } from "./explorer-state.js";
import {
  initExplorerActions,
  showItemContextMenu,
  promptCreateDeck,
  promptCreateFolder,
  exportDeckCSV,
  promptRenameDeck,
  promptDeleteDeck,
  handleImportHere,
  handleAddCardHere,
  handleStudyCurrent
} from "./explorer-actions.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

// DOM references — populated once in initExplorer()
let explorerContainer;
let breadcrumbsEl;
let btnBack;
let btnForward;
let btnUp;
let btnRefresh;
let searchInput;
let btnViewGrid;
let btnViewDetails;
let btnNewDeck;
let btnNewFolder;
let btnImportHere;
let btnAddCardHere;
let btnStudyCurrent;
let btnPracticeCurrent;
let treeRootEl;
let canvasEl;
let explorerStatusText;

export function initExplorer() {
  explorerContainer   = document.getElementById("win-explorer");
  breadcrumbsEl       = document.getElementById("explorer-breadcrumbs");
  btnBack             = document.getElementById("btn-explorer-back");
  btnForward          = document.getElementById("btn-explorer-forward");
  btnUp               = document.getElementById("btn-explorer-up");
  btnRefresh          = document.getElementById("btn-explorer-refresh");
  searchInput         = document.getElementById("explorer-search-input");
  btnViewGrid         = document.getElementById("btn-view-grid");
  btnViewDetails      = document.getElementById("btn-view-details");
  btnNewDeck          = document.getElementById("btn-explorer-new-deck");
  btnNewFolder        = document.getElementById("btn-explorer-new-folder");
  btnImportHere       = document.getElementById("btn-explorer-import");
  btnAddCardHere      = document.getElementById("btn-explorer-add-card");
  btnStudyCurrent     = document.getElementById("btn-explorer-study");
  btnPracticeCurrent  = document.getElementById("btn-explorer-practice");
  treeRootEl          = document.getElementById("explorer-tree-root");
  canvasEl            = document.getElementById("explorer-canvas");
  explorerStatusText  = document.getElementById("explorer-status-text");

  // Inject dependencies into explorer-actions.js
  initExplorerActions({
    navigateTo,
    loadCardsFromDB,
    onSyncRequest: () => onSyncRequest(),
    getExplorerData
  });

  // Navigation
  if (btnBack)    btnBack.addEventListener("click", goBack);
  if (btnForward) btnForward.addEventListener("click", goForward);
  if (btnUp)      btnUp.addEventListener("click", goUp);
  if (btnRefresh) btnRefresh.addEventListener("click", () => {
    loadCardsFromDB();
    showToast("Refreshed collections", "info");
  });

  // Search filter
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      explorerState.searchQuery = (e.target.value || "").trim().toLowerCase();
      renderExplorerCanvas();
    });
  }

  // View mode
  if (btnViewGrid)    btnViewGrid.addEventListener("click", () => setViewMode("grid"));
  if (btnViewDetails) btnViewDetails.addEventListener("click", () => setViewMode("details"));

  // Toolbar actions — all delegates now live in explorer-actions.js
  if (btnNewDeck)       btnNewDeck.addEventListener("click", promptCreateDeck);
  if (btnNewFolder)     btnNewFolder.addEventListener("click", promptCreateFolder);
  if (btnImportHere)    btnImportHere.addEventListener("click", handleImportHere);
  if (btnAddCardHere)   btnAddCardHere.addEventListener("click", handleAddCardHere);
  if (btnStudyCurrent)  btnStudyCurrent.addEventListener("click", () => handleStudyCurrent(false));
  if (btnPracticeCurrent) btnPracticeCurrent.addEventListener("click", () => handleStudyCurrent(true));

  updateViewModeButtons();
}

export function setViewMode(mode) {
  explorerState.viewMode = mode;
  localStorage.setItem("explorer-view-mode", mode);
  updateViewModeButtons();
  renderExplorerCanvas();
}

function updateViewModeButtons() {
  if (btnViewGrid)    btnViewGrid.classList.toggle("active", explorerState.viewMode === "grid");
  if (btnViewDetails) btnViewDetails.classList.toggle("active", explorerState.viewMode === "details");
}

export function navigateTo(pathSegments, addToHistory = true) {
  explorerState.currentPath = [...pathSegments];

  if (addToHistory) {
    explorerState.history = explorerState.history.slice(0, explorerState.historyIndex + 1);
    explorerState.history.push([...pathSegments]);
    explorerState.historyIndex = explorerState.history.length - 1;
  }

  updateNavButtonStates();
  renderExplorer();
}

export function goBack() {
  if (explorerState.historyIndex > 0) {
    explorerState.historyIndex--;
    navigateTo(explorerState.history[explorerState.historyIndex], false);
  }
}

export function goForward() {
  if (explorerState.historyIndex < explorerState.history.length - 1) {
    explorerState.historyIndex++;
    navigateTo(explorerState.history[explorerState.historyIndex], false);
  }
}

export function goUp() {
  if (explorerState.currentPath.length > 0) {
    navigateTo(explorerState.currentPath.slice(0, -1), true);
  }
}

function updateNavButtonStates() {
  if (btnBack)    btnBack.disabled    = explorerState.historyIndex <= 0;
  if (btnForward) btnForward.disabled = explorerState.historyIndex >= explorerState.history.length - 1;
  if (btnUp)      btnUp.disabled      = explorerState.currentPath.length === 0;
}

// -----------------------------------------------------------------------
// Data Aggregation
// -----------------------------------------------------------------------

/**
 * Build folder/deck stats from state.allCards.
 * @returns {{ folderMap: Map, standaloneMap: Map }}
 */
export function getExplorerData() {
  const now = Date.now();
  const folderMap    = new Map(); // folderName → Map(deckName → { total, due, newCount, cards[] })
  const standaloneMap = new Map(); // deckName → { total, due, newCount, cards[] }

  state.allCards.forEach(card => {
    if (card.deleted) return;
    const folder = getCardFolder(card);
    const deck   = getCardDeck(card);
    const isDue  = isCardDue(card, now);
    const isNew  = isCardNew(card);

    if (folder) {
      if (!folderMap.has(folder)) folderMap.set(folder, new Map());
      const dMap = folderMap.get(folder);
      if (!dMap.has(deck)) dMap.set(deck, { total: 0, due: 0, newCount: 0, cards: [] });
      const s = dMap.get(deck);
      s.total++;
      if (isDue) s.due++;
      if (isNew) s.newCount++;
      s.cards.push(card);
    } else {
      const d = deck || "Default";
      if (!standaloneMap.has(d)) standaloneMap.set(d, { total: 0, due: 0, newCount: 0, cards: [] });
      const s = standaloneMap.get(d);
      s.total++;
      if (isDue) s.due++;
      if (isNew) s.newCount++;
      s.cards.push(card);
    }
  });

  return { folderMap, standaloneMap };
}

// -----------------------------------------------------------------------
// Render — Top Level
// -----------------------------------------------------------------------

export function renderExplorer() {
  updateNavButtonStates();
  renderBreadcrumbs();
  renderSidebarTree();
  renderExplorerCanvas();
}

// -----------------------------------------------------------------------
// Render — Breadcrumbs
// -----------------------------------------------------------------------

function renderBreadcrumbs() {
  if (!breadcrumbsEl) return;
  breadcrumbsEl.innerHTML = "";

  const rootChip = document.createElement("button");
  rootChip.className = "breadcrumb-chip root-chip";
  rootChip.innerHTML = `<svg class="chip-icon-svg" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Decks</span>`;
  rootChip.addEventListener("click", () => navigateTo([]));
  breadcrumbsEl.appendChild(rootChip);

  let accumulatedPath = [];
  explorerState.currentPath.forEach((segment, index) => {
    accumulatedPath.push(segment);
    const thisPath = [...accumulatedPath];

    const separator = document.createElement("span");
    separator.className = "breadcrumb-sep";
    separator.textContent = "›";
    breadcrumbsEl.appendChild(separator);

    const isLast     = index === explorerState.currentPath.length - 1;
    const isFolder   = index === 0 && explorerState.currentPath.length > 1;

    const chip = document.createElement("button");
    chip.className = `breadcrumb-chip ${isLast ? "active" : ""}`;

    const iconSvg = isFolder
      ? `<svg class="chip-icon-svg" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
      : `<svg class="chip-icon-svg" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;

    chip.innerHTML = `${iconSvg}<span>${escapeHTML(segment)}</span>`;
    chip.addEventListener("click", () => navigateTo(thisPath));
    breadcrumbsEl.appendChild(chip);
  });
}

// -----------------------------------------------------------------------
// Render — Sidebar Tree
// -----------------------------------------------------------------------

function renderSidebarTree() {
  if (!treeRootEl) return;

  const { folderMap, standaloneMap } = getExplorerData();
  treeRootEl.innerHTML = "";

  // Root / All Collections
  const rootItem = document.createElement("div");
  const isRootActive = explorerState.currentPath.length === 0;
  rootItem.className = `tree-item root-tree-item ${isRootActive ? "active" : ""}`;

  let totalAllCards = 0, totalAllDue = 0;
  folderMap.forEach(dMap => dMap.forEach(s => { totalAllCards += s.total; totalAllDue += s.due; }));
  standaloneMap.forEach(s => { totalAllCards += s.total; totalAllDue += s.due; });

  rootItem.innerHTML = `
    <div class="tree-item-content">
      <svg class="tree-icon-svg" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      <span class="tree-item-label">All Collections</span>
      <span class="tree-badge ${totalAllDue > 0 ? "has-due" : ""}">${totalAllCards}${totalAllDue > 0 ? ` • ${totalAllDue} due` : ""}</span>
    </div>
  `;
  rootItem.addEventListener("click", () => navigateTo([]));
  treeRootEl.appendChild(rootItem);

  // Folders
  Array.from(folderMap.keys()).sort().forEach(folderName => {
    const dMap = folderMap.get(folderName);
    let folderTotal = 0, folderDue = 0;
    dMap.forEach(s => { folderTotal += s.total; folderDue += s.due; });

    const isFolderActive = explorerState.currentPath.length === 1 && explorerState.currentPath[0] === folderName;
    const isExpanded     = explorerState.expandedFolders.has(folderName) || explorerState.currentPath[0] === folderName;

    const folderNode = document.createElement("div");
    folderNode.className = "tree-folder-node";

    const folderRow = document.createElement("div");
    folderRow.className = `tree-item folder-tree-item ${isFolderActive ? "active" : ""}`;

    folderRow.innerHTML = `
      <button class="tree-chevron ${isExpanded ? "expanded" : ""}" title="Toggle folder">
        <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <div class="tree-item-content">
        <svg class="tree-icon-svg folder-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="tree-item-label">${escapeHTML(folderName)}</span>
        <span class="tree-badge ${folderDue > 0 ? "has-due" : ""}">${folderTotal}${folderDue > 0 ? ` (${folderDue})` : ""}</span>
      </div>
    `;

    folderRow.querySelector(".tree-chevron").addEventListener("click", (e) => {
      e.stopPropagation();
      if (explorerState.expandedFolders.has(folderName)) {
        explorerState.expandedFolders.delete(folderName);
      } else {
        explorerState.expandedFolders.add(folderName);
      }
      renderSidebarTree();
    });

    folderRow.querySelector(".tree-item-content").addEventListener("click", () => {
      explorerState.expandedFolders.add(folderName);
      navigateTo([folderName]);
    });

    folderNode.appendChild(folderRow);

    if (isExpanded) {
      const sublist = document.createElement("div");
      sublist.className = "tree-sublist";

      Array.from(dMap.keys()).sort().forEach(deckName => {
        const stats      = dMap.get(deckName);
        const isDeckActive = explorerState.currentPath.length === 2 &&
                             explorerState.currentPath[0] === folderName &&
                             explorerState.currentPath[1] === deckName;

        const deckRow = document.createElement("div");
        deckRow.className = `tree-item deck-tree-item ${isDeckActive ? "active" : ""}`;
        deckRow.innerHTML = `
          <div class="tree-item-content">
            <svg class="tree-icon-svg deck-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            <span class="tree-item-label">${escapeHTML(deckName)}</span>
            <span class="tree-badge ${stats.due > 0 ? "has-due" : ""}">${stats.total}${stats.due > 0 ? ` (${stats.due})` : ""}</span>
          </div>
        `;
        deckRow.addEventListener("click", () => navigateTo([folderName, deckName]));
        sublist.appendChild(deckRow);
      });

      folderNode.appendChild(sublist);
    }

    treeRootEl.appendChild(folderNode);
  });

  // Standalone Decks
  if (standaloneMap.size > 0) {
    const hdr = document.createElement("div");
    hdr.className = "tree-section-header";
    hdr.textContent = "Standalone Decks";
    treeRootEl.appendChild(hdr);

    Array.from(standaloneMap.keys()).sort().forEach(deckName => {
      const stats      = standaloneMap.get(deckName);
      const isDeckActive = explorerState.currentPath.length === 1 &&
                           explorerState.currentPath[0] === deckName &&
                           !folderMap.has(deckName);

      const deckRow = document.createElement("div");
      deckRow.className = `tree-item deck-tree-item ${isDeckActive ? "active" : ""}`;
      deckRow.innerHTML = `
        <div class="tree-item-content">
          <svg class="tree-icon-svg deck-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span class="tree-item-label">${escapeHTML(deckName)}</span>
          <span class="tree-badge ${stats.due > 0 ? "has-due" : ""}">${stats.total}${stats.due > 0 ? ` (${stats.due})` : ""}</span>
        </div>
      `;
      deckRow.addEventListener("click", () => navigateTo([deckName]));
      treeRootEl.appendChild(deckRow);
    });
  }
}

// -----------------------------------------------------------------------
// Render — Main Canvas
// -----------------------------------------------------------------------

function renderExplorerCanvas() {
  if (!canvasEl) return;

  const { folderMap, standaloneMap } = getExplorerData();
  const path = explorerState.currentPath;
  const q    = explorerState.searchQuery;

  // Deck Detail View
  if (path.length === 2 || (path.length === 1 && standaloneMap.has(path[0]))) {
    const folder = path.length === 2 ? path[0] : null;
    const deck   = path.length === 2 ? path[1] : path[0];
    const stats  = folder ? folderMap.get(folder)?.get(deck) : standaloneMap.get(deck);
    renderDeckDetailCanvas(folder, deck, stats);
    return;
  }

  // Folder Contents View
  if (path.length === 1 && folderMap.has(path[0])) {
    const folderName = path[0];
    const dMap       = folderMap.get(folderName) || new Map();
    let items = Array.from(dMap.keys()).map(deckName => {
      const s = dMap.get(deckName);
      return { type: "deck", folder: folderName, name: deckName, total: s.total, due: s.due, newCount: s.newCount };
    });
    if (q) items = items.filter(it => it.name.toLowerCase().includes(q));
    renderItemsCanvas(items, `Folder: ${folderName}`);
    return;
  }

  // Root View
  let items = [];
  Array.from(folderMap.keys()).sort().forEach(folderName => {
    const dMap = folderMap.get(folderName);
    let total = 0, due = 0, newCount = 0;
    dMap.forEach(s => { total += s.total; due += s.due; newCount += s.newCount; });
    items.push({ type: "folder", name: folderName, subDecksCount: dMap.size, total, due, newCount });
  });
  Array.from(standaloneMap.keys()).sort().forEach(deckName => {
    const s = standaloneMap.get(deckName);
    items.push({ type: "deck", folder: null, name: deckName, total: s.total, due: s.due, newCount: s.newCount });
  });
  if (q) items = items.filter(it => it.name.toLowerCase().includes(q));

  renderItemsCanvas(items, "Root Directory");
}

// -----------------------------------------------------------------------
// Render — Items List (shared by root & folder views)
// -----------------------------------------------------------------------

function renderItemsCanvas(items, locationTitle) {
  canvasEl.innerHTML = "";

  if (explorerStatusText) {
    const totalCards = items.reduce((acc, it) => acc + (it.total || 0), 0);
    const totalDue   = items.reduce((acc, it) => acc + (it.due   || 0), 0);
    explorerStatusText.textContent =
      `${items.length} items • ${totalCards} total cards${totalDue > 0 ? ` • ${totalDue} due` : ""}`;
  }

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty-state";
    empty.innerHTML = `
      <div class="empty-icon-circle">
        <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </div>
      <h3>This directory is empty</h3>
      <p>Create a new collection or import flashcard files directly into this location.</p>
      <div class="empty-actions-row">
        <button class="btn btn-secondary btn-sm" id="btn-empty-new-deck">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Deck
        </button>
        <button class="btn btn-primary btn-sm" id="btn-empty-import">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Import Here
        </button>
      </div>
    `;
    empty.querySelector("#btn-empty-new-deck")?.addEventListener("click", promptCreateDeck);
    empty.querySelector("#btn-empty-import")?.addEventListener("click", handleImportHere);
    canvasEl.appendChild(empty);
    return;
  }

  if (explorerState.viewMode === "grid") {
    renderGridCanvas(items);
  } else {
    renderDetailsCanvas(items);
  }
}

// -----------------------------------------------------------------------
// Render — Grid Tiles
// -----------------------------------------------------------------------

function renderGridCanvas(items) {
  const grid = document.createElement("div");
  grid.className = "explorer-grid-container";

  items.forEach(item => {
    const card      = document.createElement("div");
    const isFolder  = item.type === "folder";
    card.className  = `explorer-card-tile ${isFolder ? "tile-folder" : "tile-deck"}`;

    const dueCount   = item.due   || 0;
    const totalCount = item.total || 0;

    const iconSvg = isFolder
      ? `<svg class="tile-icon-svg folder-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
      : `<svg class="tile-icon-svg deck-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;

    const subtitle = isFolder
      ? `${item.subDecksCount || 0} collections • ${totalCount} cards`
      : `${totalCount} flashcards`;

    card.innerHTML = `
      <div class="tile-top-row">
        <div class="tile-icon-wrap">${iconSvg}</div>
        <div class="tile-badge-wrap">
          ${dueCount > 0 ? `<span class="tile-due-badge">🔥 ${dueCount} due</span>` : `<span class="tile-clean-badge">✓ Caught up</span>`}
        </div>
      </div>
      <div class="tile-main-info">
        <h4 class="tile-title" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</h4>
        <span class="tile-subtitle">${subtitle}</span>
      </div>
      <div class="tile-actions-row">
        <button class="tile-btn tile-btn-primary btn-study-item" title="Study Due Flashcards">
          ${dueCount > 0 ? `Study (${dueCount})` : "Review"}
        </button>
        <button class="tile-btn tile-btn-icon btn-import-item" title="Import Cards into this collection">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="tile-btn tile-btn-icon btn-menu-item" title="More Options">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      if (isFolder) {
        explorerState.expandedFolders.add(item.name);
        navigateTo([item.name]);
      } else {
        navigateTo(item.folder ? [item.folder, item.name] : [item.name]);
      }
    });

    card.querySelector(".btn-study-item")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      let sel = "all";
      if (isFolder) {
        sel = `folder:${item.name}`;
      } else {
        sel = item.folder ? `deck:${item.folder} / ${item.name}` : `deck:${item.name}`;
      }
      setActiveDeckSelection(sel);
      switchView("view-review");
      const { startStudySession } = await import("./study.js");
      startStudySession(item.due === 0);
    });


    card.querySelector(".btn-import-item")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setImportDestination(isFolder ? item.name : (item.folder || ""), isFolder ? "Default" : item.name);
    });

    card.querySelector(".btn-menu-item")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showItemContextMenu(e, item);
    });

    grid.appendChild(card);
  });

  canvasEl.appendChild(grid);
}

// -----------------------------------------------------------------------
// Render — Details Table
// -----------------------------------------------------------------------

function renderDetailsCanvas(items) {
  const tableWrap = document.createElement("div");
  tableWrap.className = "explorer-table-container table-container";

  const table = document.createElement("table");
  table.className = "preview-table explorer-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width: 38%;">Name</th>
        <th style="width: 14%;">Type</th>
        <th style="width: 14%;">Total Cards</th>
        <th style="width: 14%;">Due Today</th>
        <th style="width: 20%; text-align: right;">Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");

  items.forEach(item => {
    const isFolder = item.type === "folder";
    const row = document.createElement("tr");
    row.className = `explorer-table-row ${isFolder ? "row-folder" : "row-deck"}`;

    const iconSvg = isFolder
      ? `<svg class="table-icon-svg folder-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
      : `<svg class="table-icon-svg deck-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;

    row.innerHTML = `
      <td>
        <div class="table-name-cell">
          ${iconSvg}
          <span class="table-item-name">${escapeHTML(item.name)}</span>
        </div>
      </td>
      <td><span class="type-pill ${isFolder ? "type-folder" : "type-deck"}">${isFolder ? "Folder" : "Collection"}</span></td>
      <td><strong>${item.total || 0}</strong></td>
      <td>
        ${(item.due || 0) > 0 ? `<span class="status-badge status-due">🔥 ${item.due} due</span>` : `<span class="status-badge status-new">0 due</span>`}
      </td>
      <td style="text-align: right;">
        <div class="table-actions-group">
          <button class="btn-table-action btn-study-action" title="Study">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
          <button class="btn-table-action btn-import-action" title="Import Here">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="btn-table-action btn-menu-action" title="More Options">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
        </div>
      </td>
    `;

    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      if (isFolder) {
        explorerState.expandedFolders.add(item.name);
        navigateTo([item.name]);
      } else {
        navigateTo(item.folder ? [item.folder, item.name] : [item.name]);
      }
    });

    row.querySelector(".btn-study-action")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      let sel = "all";
      if (isFolder) {
        sel = `folder:${item.name}`;
      } else {
        sel = item.folder ? `deck:${item.folder} / ${item.name}` : `deck:${item.name}`;
      }
      setActiveDeckSelection(sel);
      switchView("view-review");
      const { startStudySession } = await import("./study.js");
      startStudySession(item.due === 0);
    });


    row.querySelector(".btn-import-action")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setImportDestination(isFolder ? item.name : (item.folder || ""), isFolder ? "Default" : item.name);
    });

    row.querySelector(".btn-menu-action")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showItemContextMenu(e, item);
    });

    tbody.appendChild(row);
  });

  tableWrap.appendChild(table);
  canvasEl.appendChild(tableWrap);
}

// -----------------------------------------------------------------------
// Render — Deck Detail Hero
// -----------------------------------------------------------------------

function renderDeckDetailCanvas(folder, deck, stats) {
  const cards    = stats?.cards    || [];
  const due      = stats?.due      || 0;
  const total    = stats?.total    || 0;
  const newCount = stats?.newCount || 0;

  if (explorerStatusText) {
    explorerStatusText.textContent =
      `Collection: ${folder ? `${folder} / ` : ""}${deck} (${total} cards • ${due} due)`;
  }

  const detailView = document.createElement("div");
  detailView.className = "deck-detail-view";

  detailView.innerHTML = `
    <div class="deck-detail-hero">
      <div class="deck-hero-left">
        <div class="deck-hero-badge">${folder ? `📁 ${escapeHTML(folder)}` : "Standalone Collection"}</div>
        <h2 class="deck-hero-title">${escapeHTML(deck)}</h2>
        <div class="deck-hero-stats-row">
          <span class="hero-stat-pill total"><strong>${total}</strong> Total</span>
          <span class="hero-stat-pill due"><strong>${due}</strong> Due</span>
          <span class="hero-stat-pill new"><strong>${newCount}</strong> New</span>
        </div>
      </div>
      <div class="deck-hero-actions">
        <button id="btn-hero-study" class="btn btn-primary">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          ${due > 0 ? `Study (${due} Due)` : "Review All Cards"}
        </button>
        <button id="btn-hero-import" class="btn btn-secondary">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Import into this Deck
        </button>
        <button id="btn-hero-add-card" class="btn btn-secondary">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Card
        </button>
        <button id="btn-hero-export" class="btn btn-secondary" title="Export this deck to CSV">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
        <button id="btn-hero-rename" class="btn btn-secondary" title="Rename Collection">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button id="btn-hero-delete" class="btn btn-danger" title="Delete Collection">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>

    <!-- Cards List Table -->
    <div class="deck-cards-section">
      <div class="deck-cards-header">
        <h4>Cards in this collection (${cards.length})</h4>
        <input type="text" id="deck-cards-search" class="search-mini-input" placeholder="Filter cards in this deck...">
      </div>
      <div class="deck-cards-table-wrap table-container">
        <table class="preview-table">
          <thead>
            <tr>
              <th style="width: 35%;">Front</th>
              <th style="width: 35%;">Back</th>
              <th style="width: 15%;">Status</th>
              <th style="width: 15%; text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody id="deck-cards-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  // Hero button handlers
  detailView.querySelector("#btn-hero-study")?.addEventListener("click", async () => {
    const sel = folder ? `deck:${folder} / ${deck}` : `deck:${deck}`;
    setActiveDeckSelection(sel);
    switchView("view-review");
    const { startStudySession } = await import("./study.js");
    startStudySession(due === 0);
  });


  detailView.querySelector("#btn-hero-import")?.addEventListener("click", () => {
    setImportDestination(folder || "", deck);
  });

  detailView.querySelector("#btn-hero-add-card")?.addEventListener("click", () => {
    if (dom.quickFolder) dom.quickFolder.value = folder || "";
    if (dom.quickDeck)   dom.quickDeck.value   = deck;
    const panel = document.getElementById("btn-quick-add")?.closest(".card-panel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  detailView.querySelector("#btn-hero-export")?.addEventListener("click", () => {
    exportDeckCSV(folder, deck);
  });

  detailView.querySelector("#btn-hero-rename")?.addEventListener("click", () => {
    promptRenameDeck(folder, deck);
  });

  detailView.querySelector("#btn-hero-delete")?.addEventListener("click", () => {
    promptDeleteDeck(folder, deck, total);
  });

  // Per-card table
  const tbody      = detailView.querySelector("#deck-cards-tbody");
  const searchInput = detailView.querySelector("#deck-cards-search");

  function renderDeckCards(query = "") {
    tbody.innerHTML = "";
    const filtered = query
      ? cards.filter(c =>
          (c.front || "").toLowerCase().includes(query) ||
          (c.back  || "").toLowerCase().includes(query) ||
          (c.sub   || "").toLowerCase().includes(query))
      : cards;

    if (filtered.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = `<td colspan="4" style="text-align: center; color: var(--text-secondary); padding: 20px;">No cards found. Click "Import into this Deck" to add flashcards.</td>`;
      tbody.appendChild(row);
      return;
    }

    const now = Date.now();
    filtered.slice(0, 100).forEach(c => {
      const row  = document.createElement("tr");
      const cardIsDue = isCardDue(c, now);
      const cardIsNew = isCardNew(c);
      const nextRev = getCardNextReview(c);

      let statusBadge = `<span class="status-badge status-new">New</span>`;
      if (!cardIsNew) {
        statusBadge = cardIsDue
          ? `<span class="status-badge status-due">Due</span>`
          : `<span class="status-badge status-review">${Math.max(1, Math.ceil((nextRev - now) / 86400000))}d</span>`;
      }

      row.innerHTML = `
        <td>
          <strong>${escapeHTML(c.front)}</strong>
          ${c.sub ? `<div class="browser-cell-sub">${escapeHTML(c.sub)}</div>` : ""}
        </td>
        <td>
          ${escapeHTML(c.back)}
          ${c.description ? `<div class="browser-cell-desc">${escapeHTML(c.description)}</div>` : ""}
        </td>
        <td>${statusBadge}</td>
        <td style="text-align: right;">
          <button class="btn-table-action btn-edit" title="Edit Card">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-table-action btn-delete" title="Delete Card">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </td>
      `;

      row.querySelector(".btn-edit")?.addEventListener("click",   () => openEditCardModal(c.id));
      row.querySelector(".btn-delete")?.addEventListener("click", () => deleteCard(c.id));
      tbody.appendChild(row);
    });
  }

  searchInput?.addEventListener("input", (e) => {
    renderDeckCards(e.target.value.trim().toLowerCase());
  });

  renderDeckCards();
  canvasEl.appendChild(detailView);
}
