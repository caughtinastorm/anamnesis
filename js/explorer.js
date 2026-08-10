/**
 * Windows-Style File Explorer Deck Manager Module
 *
 * Provides a desktop file explorer navigation system for folders and collections:
 * - Address bar with interactive breadcrumb path navigation
 * - Back, Forward, Up, and Refresh toolbar controls
 * - Hierarchical folder tree sidebar
 * - Grid (Tiles) & Details (Table) view modes
 * - Create, Rename, Delete, Export CSV, and Study actions for Decks & Folders
 * - Deep integration with the UI-driven Card Importer
 */

import { state } from "./state.js";
import { dom, showToast, showModal, switchView, scrollToElement } from "./ui.js";
import { getCardFolder, getCardDeck, getCardFullHierarchy, escapeHTML, generateUUID, escapeCSVField } from "./utils.js";
import * as db from "../db.js";
import { loadCardsFromDB, calculateStats, updateUIStats } from "./dashboard.js";
import { setImportDestination } from "./import.js";
import { openEditCardModal, deleteCard } from "./browser.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

export const explorerState = {
  // Path is an array of segments: [] = Root ("Decks"), ["Japanese"] = Folder, ["Japanese", "Core 100"] = Deck inside Folder, ["Default"] = Standalone Deck
  currentPath: [],
  history: [[]],
  historyIndex: 0,
  viewMode: localStorage.getItem("explorer-view-mode") || "grid", // 'grid' | 'details'
  searchQuery: "",
  expandedFolders: new Set()
};

// DOM references
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
  explorerContainer = document.getElementById("win-explorer");
  breadcrumbsEl = document.getElementById("explorer-breadcrumbs");
  btnBack = document.getElementById("btn-explorer-back");
  btnForward = document.getElementById("btn-explorer-forward");
  btnUp = document.getElementById("btn-explorer-up");
  btnRefresh = document.getElementById("btn-explorer-refresh");
  searchInput = document.getElementById("explorer-search-input");
  btnViewGrid = document.getElementById("btn-view-grid");
  btnViewDetails = document.getElementById("btn-view-details");
  btnNewDeck = document.getElementById("btn-explorer-new-deck");
  btnNewFolder = document.getElementById("btn-explorer-new-folder");
  btnImportHere = document.getElementById("btn-explorer-import");
  btnAddCardHere = document.getElementById("btn-explorer-add-card");
  btnStudyCurrent = document.getElementById("btn-explorer-study");
  btnPracticeCurrent = document.getElementById("btn-explorer-practice");
  treeRootEl = document.getElementById("explorer-tree-root");
  canvasEl = document.getElementById("explorer-canvas");
  explorerStatusText = document.getElementById("explorer-status-text");

  // Navigation events
  if (btnBack) btnBack.addEventListener("click", goBack);
  if (btnForward) btnForward.addEventListener("click", goForward);
  if (btnUp) btnUp.addEventListener("click", goUp);
  if (btnRefresh) btnRefresh.addEventListener("click", () => {
    loadCardsFromDB();
    showToast("Refreshed collections", "info");
  });

  // Search filter inside explorer
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      explorerState.searchQuery = (e.target.value || "").trim().toLowerCase();
      renderExplorerCanvas();
    });
  }

  // View mode switcher
  if (btnViewGrid) {
    btnViewGrid.addEventListener("click", () => setViewMode("grid"));
  }
  if (btnViewDetails) {
    btnViewDetails.addEventListener("click", () => setViewMode("details"));
  }

  // Command toolbar actions
  if (btnNewDeck) btnNewDeck.addEventListener("click", promptCreateDeck);
  if (btnNewFolder) btnNewFolder.addEventListener("click", promptCreateFolder);
  if (btnImportHere) btnImportHere.addEventListener("click", handleImportHere);
  if (btnAddCardHere) btnAddCardHere.addEventListener("click", handleAddCardHere);
  if (btnStudyCurrent) btnStudyCurrent.addEventListener("click", () => handleStudyCurrent(false));
  if (btnPracticeCurrent) btnPracticeCurrent.addEventListener("click", () => handleStudyCurrent(true));

  // Update initial buttons
  updateViewModeButtons();
}

export function setViewMode(mode) {
  explorerState.viewMode = mode;
  localStorage.setItem("explorer-view-mode", mode);
  updateViewModeButtons();
  renderExplorerCanvas();
}

function updateViewModeButtons() {
  if (btnViewGrid) btnViewGrid.classList.toggle("active", explorerState.viewMode === "grid");
  if (btnViewDetails) btnViewDetails.classList.toggle("active", explorerState.viewMode === "details");
}

export function navigateTo(pathSegments, addToHistory = true) {
  explorerState.currentPath = [...pathSegments];
  
  if (addToHistory) {
    // Truncate forward history if navigating to a new branch
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
    const prevPath = explorerState.history[explorerState.historyIndex];
    navigateTo(prevPath, false);
  }
}

export function goForward() {
  if (explorerState.historyIndex < explorerState.history.length - 1) {
    explorerState.historyIndex++;
    const nextPath = explorerState.history[explorerState.historyIndex];
    navigateTo(nextPath, false);
  }
}

export function goUp() {
  if (explorerState.currentPath.length > 0) {
    const parentPath = explorerState.currentPath.slice(0, -1);
    navigateTo(parentPath, true);
  }
}

function updateNavButtonStates() {
  if (btnBack) btnBack.disabled = explorerState.historyIndex <= 0;
  if (btnForward) btnForward.disabled = explorerState.historyIndex >= explorerState.history.length - 1;
  if (btnUp) btnUp.disabled = explorerState.currentPath.length === 0;
}

/**
 * Main render function for the Explorer
 */
export function renderExplorer() {
  updateNavButtonStates();
  renderBreadcrumbs();
  renderSidebarTree();
  renderExplorerCanvas();
}

/**
 * Render interactive Breadcrumbs in the Address Bar
 */
function renderBreadcrumbs() {
  if (!breadcrumbsEl) breadcrumbsEl = document.getElementById("explorer-breadcrumbs");
  if (!breadcrumbsEl) return;

  breadcrumbsEl.innerHTML = "";

  // Root chip
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

    const isLast = index === explorerState.currentPath.length - 1;
    const isFolder = index === 0 && explorerState.currentPath.length > 1;

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

/**
 * Get folder and deck hierarchy summary from cards in state
 */
export function getExplorerData() {
  const now = Date.now();
  const folderMap = new Map(); // folderName -> Map(deckName -> { total, due, newCount, cards: [] })
  const standaloneMap = new Map(); // deckName -> { total, due, newCount, cards: [] }

  state.allCards.forEach(card => {
    if (card.deleted) return;
    const folder = getCardFolder(card);
    const deck = getCardDeck(card);
    const isDue = (card.sm2_stats?.next_review || 0) <= now;
    const isNew = !card.sm2_stats || card.sm2_stats.repetitions === 0;

    if (folder) {
      if (!folderMap.has(folder)) folderMap.set(folder, new Map());
      const dMap = folderMap.get(folder);
      if (!dMap.has(deck)) dMap.set(deck, { total: 0, due: 0, newCount: 0, cards: [] });
      const stats = dMap.get(deck);
      stats.total++;
      if (isDue) stats.due++;
      if (isNew) stats.newCount++;
      stats.cards.push(card);
    } else {
      const d = deck || "Default";
      if (!standaloneMap.has(d)) standaloneMap.set(d, { total: 0, due: 0, newCount: 0, cards: [] });
      const stats = standaloneMap.get(d);
      stats.total++;
      if (isDue) stats.due++;
      if (isNew) stats.newCount++;
      stats.cards.push(card);
    }
  });

  return { folderMap, standaloneMap };
}

/**
 * Render Left Sidebar Tree View
 */
function renderSidebarTree() {
  if (!treeRootEl) treeRootEl = document.getElementById("explorer-tree-root");
  if (!treeRootEl) return;

  const { folderMap, standaloneMap } = getExplorerData();
  treeRootEl.innerHTML = "";

  // 1. Root / All Collections item
  const rootItem = document.createElement("div");
  const isRootActive = explorerState.currentPath.length === 0;
  rootItem.className = `tree-item root-tree-item ${isRootActive ? "active" : ""}`;
  
  let totalAllCards = 0;
  let totalAllDue = 0;
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

  // 2. Folders and their subdecks
  Array.from(folderMap.keys()).sort().forEach(folderName => {
    const dMap = folderMap.get(folderName);
    let folderTotal = 0;
    let folderDue = 0;
    dMap.forEach(s => { folderTotal += s.total; folderDue += s.due; });

    const isFolderActive = explorerState.currentPath.length === 1 && explorerState.currentPath[0] === folderName;
    const isExpanded = explorerState.expandedFolders.has(folderName) || (explorerState.currentPath[0] === folderName);

    const folderNode = document.createElement("div");
    folderNode.className = "tree-folder-node";

    const folderRow = document.createElement("div");
    folderRow.className = `tree-item folder-tree-item ${isFolderActive ? "active" : ""}`;

    const chevronSvg = `<button class="tree-chevron ${isExpanded ? "expanded" : ""}" title="Toggle folder">
      <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;

    folderRow.innerHTML = `
      ${chevronSvg}
      <div class="tree-item-content">
        <svg class="tree-icon-svg folder-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="tree-item-label">${escapeHTML(folderName)}</span>
        <span class="tree-badge ${folderDue > 0 ? "has-due" : ""}">${folderTotal}${folderDue > 0 ? ` (${folderDue})` : ""}</span>
      </div>
    `;

    const chevronBtn = folderRow.querySelector(".tree-chevron");
    chevronBtn.addEventListener("click", (e) => {
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

    // Render Subdecks if expanded
    if (isExpanded) {
      const sublist = document.createElement("div");
      sublist.className = "tree-sublist";

      Array.from(dMap.keys()).sort().forEach(deckName => {
        const stats = dMap.get(deckName);
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

  // 3. Standalone decks
  if (standaloneMap.size > 0) {
    const standaloneHeader = document.createElement("div");
    standaloneHeader.className = "tree-section-header";
    standaloneHeader.textContent = "Standalone Decks";
    treeRootEl.appendChild(standaloneHeader);

    Array.from(standaloneMap.keys()).sort().forEach(deckName => {
      const stats = standaloneMap.get(deckName);
      const isDeckActive = explorerState.currentPath.length === 1 && explorerState.currentPath[0] === deckName && !folderMap.has(deckName);

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

/**
 * Render the Main Explorer Canvas based on currentPath and viewMode
 */
function renderExplorerCanvas() {
  if (!canvasEl) canvasEl = document.getElementById("explorer-canvas");
  if (!canvasEl) return;

  const { folderMap, standaloneMap } = getExplorerData();
  const path = explorerState.currentPath;
  const q = explorerState.searchQuery;

  // Case 1: Deck Detail View (path is a specific deck: [folder, deck] or [standaloneDeck])
  if (path.length === 2 || (path.length === 1 && standaloneMap.has(path[0]))) {
    const folder = path.length === 2 ? path[0] : null;
    const deck = path.length === 2 ? path[1] : path[0];
    const stats = folder ? folderMap.get(folder)?.get(deck) : standaloneMap.get(deck);

    renderDeckDetailCanvas(folder, deck, stats);
    return;
  }

  // Case 2: Folder Contents View (path is a folder: [folder])
  if (path.length === 1 && folderMap.has(path[0])) {
    const folderName = path[0];
    const dMap = folderMap.get(folderName) || new Map();
    
    let items = Array.from(dMap.keys()).map(deckName => {
      const s = dMap.get(deckName);
      return {
        type: "deck",
        folder: folderName,
        name: deckName,
        total: s.total,
        due: s.due,
        newCount: s.newCount
      };
    });

    if (q) {
      items = items.filter(it => it.name.toLowerCase().includes(q));
    }

    renderItemsCanvas(items, `Folder: ${folderName}`);
    return;
  }

  // Case 3: Root View (path is [])
  let items = [];

  // Add all Folders
  Array.from(folderMap.keys()).sort().forEach(folderName => {
    const dMap = folderMap.get(folderName);
    let total = 0, due = 0, newCount = 0;
    dMap.forEach(s => { total += s.total; due += s.due; newCount += s.newCount; });

    items.push({
      type: "folder",
      name: folderName,
      subDecksCount: dMap.size,
      total,
      due,
      newCount
    });
  });

  // Add standalone decks
  Array.from(standaloneMap.keys()).sort().forEach(deckName => {
    const s = standaloneMap.get(deckName);
    items.push({
      type: "deck",
      folder: null,
      name: deckName,
      total: s.total,
      due: s.due,
      newCount: s.newCount
    });
  });

  if (q) {
    items = items.filter(it => it.name.toLowerCase().includes(q));
  }

  renderItemsCanvas(items, "Root Directory");
}

/**
 * Render folder/deck list in Grid or Details view
 */
function renderItemsCanvas(items, locationTitle) {
  canvasEl.innerHTML = "";

  if (explorerStatusText) {
    const totalCards = items.reduce((acc, it) => acc + (it.total || 0), 0);
    const totalDue = items.reduce((acc, it) => acc + (it.due || 0), 0);
    explorerStatusText.textContent = `${items.length} items • ${totalCards} total cards${totalDue > 0 ? ` • ${totalDue} due` : ""}`;
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

/**
 * Grid View Renderer (Large Modern Windows Tiles)
 */
function renderGridCanvas(items) {
  const grid = document.createElement("div");
  grid.className = "explorer-grid-container";

  items.forEach(item => {
    const card = document.createElement("div");
    card.className = `explorer-card-tile ${item.type === "folder" ? "tile-folder" : "tile-deck"}`;

    const isFolder = item.type === "folder";
    const title = item.name;
    const dueCount = item.due || 0;
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
        <h4 class="tile-title" title="${escapeHTML(title)}">${escapeHTML(title)}</h4>
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

    // Click on card tile navigates into folder/deck
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return; // Don't trigger if clicked on an action button
      if (isFolder) {
        explorerState.expandedFolders.add(item.name);
        navigateTo([item.name]);
      } else {
        const nextPath = item.folder ? [item.folder, item.name] : [item.name];
        navigateTo(nextPath);
      }
    });

    // Study button
    card.querySelector(".btn-study-item")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (isFolder) {
        dom.deckSelect.value = `folder:${item.name}`;
      } else {
        dom.deckSelect.value = item.folder ? `deck:${item.folder} / ${item.name}` : `deck:${item.name}`;
      }
      calculateStats();
      updateUIStats();
      switchView("view-review");
      const { startStudySession } = await import("./study.js");
      startStudySession(item.due === 0);
    });

    // Import button
    card.querySelector(".btn-import-item")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setImportDestination(isFolder ? item.name : (item.folder || ""), isFolder ? "Default" : item.name);
    });

    // Menu button
    card.querySelector(".btn-menu-item")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showItemContextMenu(e, item);
    });

    grid.appendChild(card);
  });

  canvasEl.appendChild(grid);
}

/**
 * Details Table View Renderer (Windows Explorer Table)
 */
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
        const nextPath = item.folder ? [item.folder, item.name] : [item.name];
        navigateTo(nextPath);
      }
    });

    row.querySelector(".btn-study-action")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (isFolder) {
        dom.deckSelect.value = `folder:${item.name}`;
      } else {
        dom.deckSelect.value = item.folder ? `deck:${item.folder} / ${item.name}` : `deck:${item.name}`;
      }
      calculateStats();
      updateUIStats();
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

/**
 * Deck Detail Canvas View (inside a specific deck)
 */
function renderDeckDetailCanvas(folder, deck, stats) {
  const cards = stats?.cards || [];
  const due = stats?.due || 0;
  const total = stats?.total || 0;
  const newCount = stats?.newCount || 0;

  if (explorerStatusText) {
    explorerStatusText.textContent = `Collection: ${folder ? `${folder} / ` : ""}${deck} (${total} cards • ${due} due)`;
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

    <!-- Cards List Table inside Deck -->
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
          <tbody id="deck-cards-tbody">
            <!-- Dynamically populated -->
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Attach hero actions
  detailView.querySelector("#btn-hero-study")?.addEventListener("click", async () => {
    dom.deckSelect.value = folder ? `deck:${folder} / ${deck}` : `deck:${deck}`;
    calculateStats();
    updateUIStats();
    switchView("view-review");
    const { startStudySession } = await import("./study.js");
    startStudySession(due === 0);
  });

  detailView.querySelector("#btn-hero-import")?.addEventListener("click", () => {
    setImportDestination(folder || "", deck);
  });

  detailView.querySelector("#btn-hero-add-card")?.addEventListener("click", () => {
    if (dom.quickFolder) dom.quickFolder.value = folder || "";
    if (dom.quickDeck) dom.quickDeck.value = deck;
    scrollToElement(document.getElementById("btn-quick-add")?.closest(".card-panel"));
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

  // Render cards table inside deck
  const tbody = detailView.querySelector("#deck-cards-tbody");
  const searchInput = detailView.querySelector("#deck-cards-search");

  function renderDeckCards(query = "") {
    tbody.innerHTML = "";
    const filtered = query
      ? cards.filter(c => (c.front || "").toLowerCase().includes(query) || (c.back || "").toLowerCase().includes(query) || (c.sub || "").toLowerCase().includes(query))
      : cards;

    if (filtered.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = `<td colspan="4" style="text-align: center; color: var(--text-secondary); padding: 20px;">No cards found. Click "Import into this Deck" to add flashcards.</td>`;
      tbody.appendChild(row);
      return;
    }

    const now = Date.now();
    filtered.slice(0, 100).forEach(c => {
      const row = document.createElement("tr");
      const isDue = (c.sm2_stats?.next_review || 0) <= now;
      const reps = c.sm2_stats?.repetitions || 0;

      let statusBadge = `<span class="status-badge status-new">New</span>`;
      if (reps > 0) {
        statusBadge = isDue
          ? `<span class="status-badge status-due">Due</span>`
          : `<span class="status-badge status-review">${Math.ceil(((c.sm2_stats?.next_review || 0) - now) / (1000 * 60 * 60 * 24))}d</span>`;
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

      row.querySelector(".btn-edit")?.addEventListener("click", () => openEditCardModal(c.id));
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

/**
 * Context Menu / Dropdown for folder or deck items
 */
function showItemContextMenu(e, item) {
  // Remove existing dropdown if any
  document.querySelectorAll(".explorer-context-menu").forEach(m => m.remove());

  const menu = document.createElement("div");
  menu.className = "explorer-context-menu";

  const isFolder = item.type === "folder";
  const folder = item.folder || (isFolder ? item.name : null);
  const deck = isFolder ? null : item.name;

  menu.innerHTML = `
    <button class="menu-item menu-open">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      Open ${isFolder ? "Folder" : "Collection"}
    </button>
    <button class="menu-item menu-study">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Study (${item.due || 0} Due)
    </button>
    <button class="menu-item menu-import">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Import Cards Here
    </button>
    <hr class="menu-divider">
    <button class="menu-item menu-export">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Export to CSV
    </button>
    <button class="menu-item menu-rename">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Rename
    </button>
    <button class="menu-item menu-delete danger">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      Delete
    </button>
  `;

  // Position menu
  const rect = e.target.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${Math.min(window.innerHeight - 220, rect.bottom + 4)}px`;
  menu.style.left = `${Math.min(window.innerWidth - 180, rect.left)}px`;
  menu.style.zIndex = "1000";

  // Menu action handlers
  menu.querySelector(".menu-open")?.addEventListener("click", () => {
    menu.remove();
    if (isFolder) {
      explorerState.expandedFolders.add(item.name);
      navigateTo([item.name]);
    } else {
      navigateTo(item.folder ? [item.folder, item.name] : [item.name]);
    }
  });

  menu.querySelector(".menu-study")?.addEventListener("click", async () => {
    menu.remove();
    if (isFolder) {
      dom.deckSelect.value = `folder:${item.name}`;
    } else {
      dom.deckSelect.value = item.folder ? `deck:${item.folder} / ${item.name}` : `deck:${item.name}`;
    }
    calculateStats();
    updateUIStats();
    switchView("view-review");
    const { startStudySession } = await import("./study.js");
    startStudySession(item.due === 0);
  });

  menu.querySelector(".menu-import")?.addEventListener("click", () => {
    menu.remove();
    setImportDestination(isFolder ? item.name : (item.folder || ""), isFolder ? "Default" : item.name);
  });

  menu.querySelector(".menu-export")?.addEventListener("click", () => {
    menu.remove();
    if (isFolder) {
      exportFolderCSV(item.name);
    } else {
      exportDeckCSV(item.folder, item.name);
    }
  });

  menu.querySelector(".menu-rename")?.addEventListener("click", () => {
    menu.remove();
    if (isFolder) {
      promptRenameFolder(item.name);
    } else {
      promptRenameDeck(item.folder, item.name);
    }
  });

  menu.querySelector(".menu-delete")?.addEventListener("click", () => {
    menu.remove();
    if (isFolder) {
      promptDeleteFolder(item.name, item.total);
    } else {
      promptDeleteDeck(item.folder, item.name, item.total);
    }
  });

  document.body.appendChild(menu);

  // Close on outside click
  const closeListener = (evt) => {
    if (!menu.contains(evt.target)) {
      menu.remove();
      document.removeEventListener("pointerdown", closeListener);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", closeListener), 10);
}

// -------------------------------------------------------------
// Toolbar Actions Handlers
// -------------------------------------------------------------

function handleImportHere() {
  const path = explorerState.currentPath;
  let targetFolder = "";
  let targetDeck = "Default";

  if (path.length === 2) {
    targetFolder = path[0];
    targetDeck = path[1];
  } else if (path.length === 1) {
    const { folderMap } = getExplorerData();
    if (folderMap.has(path[0])) {
      targetFolder = path[0];
      targetDeck = "Default";
    } else {
      targetDeck = path[0];
    }
  }

  setImportDestination(targetFolder, targetDeck);
}

function handleAddCardHere() {
  const path = explorerState.currentPath;
  let targetFolder = "";
  let targetDeck = "Default";

  if (path.length === 2) {
    targetFolder = path[0];
    targetDeck = path[1];
  } else if (path.length === 1) {
    const { folderMap } = getExplorerData();
    if (folderMap.has(path[0])) {
      targetFolder = path[0];
    } else {
      targetDeck = path[0];
    }
  }

  if (dom.quickFolder) dom.quickFolder.value = targetFolder;
  if (dom.quickDeck) dom.quickDeck.value = targetDeck;
  scrollToElement(document.getElementById("btn-quick-add")?.closest(".card-panel"));
  showToast(`Ready to add card into ${targetFolder ? `${targetFolder} / ` : ""}${targetDeck}`, "info");
}

async function handleStudyCurrent(force = false) {
  const path = explorerState.currentPath;
  if (path.length === 2) {
    dom.deckSelect.value = `deck:${path[0]} / ${path[1]}`;
  } else if (path.length === 1) {
    const { folderMap } = getExplorerData();
    if (folderMap.has(path[0])) {
      dom.deckSelect.value = `folder:${path[0]}`;
    } else {
      dom.deckSelect.value = `deck:${path[0]}`;
    }
  } else {
    dom.deckSelect.value = "all";
  }

  calculateStats();
  updateUIStats();
  switchView("view-review");
  const { startStudySession } = await import("./study.js");
  startStudySession(force);
}

// -------------------------------------------------------------
// Dialogs: Create, Rename, Delete, Export
// -------------------------------------------------------------

function promptCreateFolder() {
  const folderName = prompt("Enter new folder name (e.g. Japanese, Medical, Science):");
  if (!folderName || !folderName.trim()) return;

  const cleanName = folderName.trim();
  // Create a placeholder card or navigate to folder
  explorerState.expandedFolders.add(cleanName);
  navigateTo([cleanName]);
  showToast(`Folder "${cleanName}" created!`, "success");
}

function promptCreateDeck() {
  const currentPath = explorerState.currentPath;
  let defaultFolder = "";
  if (currentPath.length >= 1) {
    const { folderMap } = getExplorerData();
    if (folderMap.has(currentPath[0])) {
      defaultFolder = currentPath[0];
    }
  }

  const deckName = prompt(`Enter new collection/deck name${defaultFolder ? ` inside folder "${defaultFolder}"` : ""}:`);
  if (!deckName || !deckName.trim()) return;

  const cleanDeck = deckName.trim();
  const nextPath = defaultFolder ? [defaultFolder, cleanDeck] : [cleanDeck];
  navigateTo(nextPath);
  showToast(`Collection "${cleanDeck}" created! Ready to import or add cards.`, "success");
}

function promptRenameFolder(oldFolder) {
  const newName = prompt(`Rename folder "${oldFolder}" to:`, oldFolder);
  if (!newName || !newName.trim() || newName.trim() === oldFolder) return;

  const cleanNew = newName.trim();
  showModal(
    `Rename Folder "${oldFolder}"?`,
    `This will update the parent folder name on all flashcards in "${oldFolder}" to "${cleanNew}".`,
    async () => {
      const now = Date.now();
      const toUpdate = state.allCards
        .filter(c => !c.deleted && getCardFolder(c).toLowerCase() === oldFolder.toLowerCase())
        .map(c => ({
          ...c,
          folder: cleanNew,
          last_modified: now
        }));

      if (toUpdate.length > 0) {
        try {
          await db.saveCards(toUpdate);
          showToast(`Renamed folder to "${cleanNew}" (${toUpdate.length} cards updated)`, "success");
          if (explorerState.currentPath[0] === oldFolder) {
            explorerState.currentPath[0] = cleanNew;
          }
          await loadCardsFromDB();
          onSyncRequest();
        } catch (err) {
          console.error("Rename folder error:", err);
          showToast("Failed to rename folder", "error");
        }
      } else {
        showToast("No cards were found to rename", "info");
      }
    }
  );
}

function promptRenameDeck(folder, oldDeck) {
  const label = folder ? `${folder} / ${oldDeck}` : oldDeck;
  const newName = prompt(`Rename collection "${oldDeck}" to:`, oldDeck);
  if (!newName || !newName.trim() || newName.trim() === oldDeck) return;

  const cleanNew = newName.trim();
  showModal(
    `Rename Collection "${label}"?`,
    `This will update the collection name to "${cleanNew}".`,
    async () => {
      const now = Date.now();
      const toUpdate = state.allCards
        .filter(c => {
          if (c.deleted) return false;
          if (folder) {
            return getCardFolder(c).toLowerCase() === folder.toLowerCase() &&
                   getCardDeck(c).toLowerCase() === oldDeck.toLowerCase();
          } else {
            return !getCardFolder(c) && getCardDeck(c).toLowerCase() === oldDeck.toLowerCase();
          }
        })
        .map(c => ({
          ...c,
          deck: cleanNew,
          last_modified: now
        }));

      if (toUpdate.length > 0) {
        try {
          await db.saveCards(toUpdate);
          showToast(`Renamed collection to "${cleanNew}" (${toUpdate.length} cards updated)`, "success");
          if (explorerState.currentPath.length === 2 && explorerState.currentPath[1] === oldDeck) {
            explorerState.currentPath[1] = cleanNew;
          } else if (explorerState.currentPath.length === 1 && explorerState.currentPath[0] === oldDeck) {
            explorerState.currentPath[0] = cleanNew;
          }
          await loadCardsFromDB();
          onSyncRequest();
        } catch (err) {
          console.error("Rename deck error:", err);
          showToast("Failed to rename collection", "error");
        }
      }
    }
  );
}

function promptDeleteFolder(folderName, totalCards) {
  showModal(
    `Delete Folder "${folderName}"?`,
    `Are you sure you want to permanently delete folder "${folderName}" and ALL of its collections (${totalCards} total cards)?`,
    async () => {
      const now = Date.now();
      const toDelete = state.allCards
        .filter(c => !c.deleted && getCardFolder(c).toLowerCase() === folderName.toLowerCase())
        .map(c => ({ ...c, deleted: true, last_modified: now }));

      if (toDelete.length > 0) {
        try {
          await db.saveCards(toDelete);
          showToast(`Deleted folder "${folderName}" (${toDelete.length} cards)`, "success");
          navigateTo([]);
          await loadCardsFromDB();
          onSyncRequest();
        } catch (err) {
          console.error("Delete folder error:", err);
          showToast("Failed to delete folder", "error");
        }
      }
    }
  );
}

function promptDeleteDeck(folderName, deckName, count) {
  const label = folderName ? `${folderName} / ${deckName}` : deckName;
  showModal(
    `Delete Collection "${label}"?`,
    `Are you sure you want to delete this collection (${count} cards)?`,
    async () => {
      const now = Date.now();
      const toDelete = state.allCards
        .filter(c => {
          if (c.deleted) return false;
          if (folderName) {
            return getCardFolder(c).toLowerCase() === folderName.toLowerCase() &&
                   getCardDeck(c).toLowerCase() === deckName.toLowerCase();
          } else {
            return !getCardFolder(c) && getCardDeck(c).toLowerCase() === deckName.toLowerCase();
          }
        })
        .map(c => ({ ...c, deleted: true, last_modified: now }));

      if (toDelete.length > 0) {
        try {
          await db.saveCards(toDelete);
          showToast(`Deleted collection "${label}" (${toDelete.length} cards)`, "success");
          if (folderName) {
            navigateTo([folderName]);
          } else {
            navigateTo([]);
          }
          await loadCardsFromDB();
          onSyncRequest();
        } catch (err) {
          console.error("Delete deck error:", err);
          showToast("Failed to delete collection", "error");
        }
      }
    }
  );
}

export function exportDeckCSV(folder, deck) {
  const cards = state.allCards.filter(c => {
    if (c.deleted) return false;
    if (folder) {
      return getCardFolder(c).toLowerCase() === folder.toLowerCase() &&
             getCardDeck(c).toLowerCase() === deck.toLowerCase();
    } else {
      return !getCardFolder(c) && getCardDeck(c).toLowerCase() === deck.toLowerCase();
    }
  });

  if (cards.length === 0) {
    showToast("No cards to export in this collection", "error");
    return;
  }

  // Pure card CSV format (no redundant folder/deck columns needed!)
  let csv = "Front,Back,Sub-text,Description\n";
  cards.forEach(c => {
    csv += [
      escapeCSVField(c.front),
      escapeCSVField(c.back),
      escapeCSVField(c.sub || ""),
      escapeCSVField(c.description || "")
    ].join(",") + "\n";
  });

  downloadCSV(csv, `${folder ? `${folder}_` : ""}${deck}_cards.csv`);
  showToast(`Exported ${cards.length} cards from ${deck}!`, "success");
}

export function exportFolderCSV(folder) {
  const cards = state.allCards.filter(c => !c.deleted && getCardFolder(c).toLowerCase() === folder.toLowerCase());
  if (cards.length === 0) {
    showToast("No cards to export in this folder", "error");
    return;
  }

  let csv = "Deck,Front,Back,Sub-text,Description\n";
  cards.forEach(c => {
    csv += [
      escapeCSVField(getCardDeck(c)),
      escapeCSVField(c.front),
      escapeCSVField(c.back),
      escapeCSVField(c.sub || ""),
      escapeCSVField(c.description || "")
    ].join(",") + "\n";
  });

  downloadCSV(csv, `${folder}_all_collections.csv`);
  showToast(`Exported ${cards.length} cards from folder "${folder}"!`, "success");
}

function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
