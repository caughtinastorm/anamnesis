/**
 * Universal Windows-Style GUI Collection Picker Dialog
 *
 * Provides a scalable, high-performance visual directory picker for:
 * - Choosing Import Destination Folder & Collection
 * - Selecting Active Study Collection in Dashboard
 * - Filtering Collections in Card Browser
 * - Quick Add Collection Target
 *
 * Supports thousands of collections with instant search, expandable tree hierarchy,
 * breadcrumb navigation, and on-the-fly folder/deck creation.
 */

import { state } from "./state.js";
import { getCardFolder, getCardDeck, getCardFullHierarchy, escapeHTML } from "./utils.js";
import { isCardDue } from "../fsrs.js";
import { showToast } from "./ui.js";

export const pickerState = {
  isOpen: false,
  title: "Select Collection or Destination",
  currentPath: [],
  selectedFolder: undefined,
  selectedDeck: "Default",
  allowRoot: true,
  onSelectCallback: null,
  searchQuery: "",
  viewMode: "grid", // 'grid' | 'details'
  expandedFolders: new Set(),
  history: [[]],
  historyIndex: 0
};

// DOM references
let modalEl;
let titleEl;
let breadcrumbsEl;
let searchInputEl;
let btnBack;
let btnForward;
let btnUp;
let btnNewFolder;
let btnNewDeck;
let treeContainerEl;
let canvasEl;
let selectedLabelEl;
let btnCancel;
let btnConfirm;
let btnCloseModal;

export function initCollectionPicker() {
  modalEl = document.getElementById("collection-picker-modal");
  if (!modalEl) return;

  titleEl = document.getElementById("picker-modal-title");
  breadcrumbsEl = document.getElementById("picker-breadcrumbs");
  searchInputEl = document.getElementById("picker-search-input");
  btnBack = document.getElementById("btn-picker-back");
  btnForward = document.getElementById("btn-picker-forward");
  btnUp = document.getElementById("btn-picker-up");
  btnNewFolder = document.getElementById("btn-picker-new-folder");
  btnNewDeck = document.getElementById("btn-picker-new-deck");
  treeContainerEl = document.getElementById("picker-tree-container");
  canvasEl = document.getElementById("picker-canvas");
  selectedLabelEl = document.getElementById("picker-selected-label");
  btnCancel = document.getElementById("btn-picker-cancel");
  btnConfirm = document.getElementById("btn-picker-confirm");
  btnCloseModal = document.getElementById("btn-close-picker-modal");

  if (btnBack) btnBack.addEventListener("click", goBack);
  if (btnForward) btnForward.addEventListener("click", goForward);
  if (btnUp) btnUp.addEventListener("click", goUp);
  if (btnCancel) btnCancel.addEventListener("click", closeCollectionPicker);
  if (btnCloseModal) btnCloseModal.addEventListener("click", closeCollectionPicker);
  if (btnConfirm) btnConfirm.addEventListener("click", confirmSelection);

  if (btnNewFolder) btnNewFolder.addEventListener("click", promptCreateFolderInPicker);
  if (btnNewDeck) btnNewDeck.addEventListener("click", promptCreateDeckInPicker);

  if (searchInputEl) {
    searchInputEl.addEventListener("input", (e) => {
      pickerState.searchQuery = (e.target.value || "").trim().toLowerCase();
      renderPickerCanvas();
    });
  }

  // Close on outside overlay click
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) closeCollectionPicker();
  });
}

/**
 * Open the visual Collection Picker Dialog
 */
export function openCollectionPicker({
  title = "Select Collection",
  initialFolder = undefined,
  initialDeck = "Default",
  allowRoot = true,
  onSelect = null
} = {}) {
  if (!modalEl) modalEl = document.getElementById("collection-picker-modal");
  if (!modalEl) return;

  pickerState.isOpen = true;
  pickerState.title = title;
  pickerState.selectedFolder = initialFolder;
  pickerState.selectedDeck = initialDeck || (allowRoot ? "all" : "Default");
  pickerState.allowRoot = allowRoot;
  pickerState.onSelectCallback = onSelect;
  pickerState.searchQuery = "";

  if (searchInputEl) searchInputEl.value = "";

  // Set starting path based on initial selection
  if (initialFolder) {
    pickerState.currentPath = [initialFolder];
    pickerState.expandedFolders.add(initialFolder);
  } else {
    pickerState.currentPath = [];
  }

  pickerState.history = [[...pickerState.currentPath]];
  pickerState.historyIndex = 0;

  if (titleEl) titleEl.textContent = title;
  if (btnConfirm) {
    btnConfirm.textContent = allowRoot ? "Select This Collection" : "Select Destination";
  }

  updateSelectionLabel();
  renderPicker();

  modalEl.classList.remove("hidden");
}

export function closeCollectionPicker() {
  if (!modalEl) modalEl = document.getElementById("collection-picker-modal");
  if (modalEl) modalEl.classList.add("hidden");
  pickerState.isOpen = false;
  pickerState.onSelectCallback = null;
}

function confirmSelection() {
  const folder = pickerState.selectedFolder;
  const deck = pickerState.selectedDeck || (pickerState.allowRoot ? "all" : "Default");

  if (pickerState.onSelectCallback) {
    pickerState.onSelectCallback(folder, deck);
  }

  closeCollectionPicker();
}

export function navigatePickerTo(pathSegments, addToHistory = true) {
  pickerState.currentPath = [...pathSegments];

  if (addToHistory) {
    pickerState.history = pickerState.history.slice(0, pickerState.historyIndex + 1);
    pickerState.history.push([...pathSegments]);
    pickerState.historyIndex = pickerState.history.length - 1;
  }

  updateNavButtons();
  renderPicker();
}

function goBack() {
  if (pickerState.historyIndex > 0) {
    pickerState.historyIndex--;
    const prev = pickerState.history[pickerState.historyIndex];
    navigatePickerTo(prev, false);
  }
}

function goForward() {
  if (pickerState.historyIndex < pickerState.history.length - 1) {
    pickerState.historyIndex++;
    const next = pickerState.history[pickerState.historyIndex];
    navigatePickerTo(next, false);
  }
}

function goUp() {
  if (pickerState.currentPath.length > 0) {
    const parent = pickerState.currentPath.slice(0, -1);
    navigatePickerTo(parent, true);
  }
}

function updateNavButtons() {
  if (btnBack) btnBack.disabled = pickerState.historyIndex <= 0;
  if (btnForward) btnForward.disabled = pickerState.historyIndex >= pickerState.history.length - 1;
  if (btnUp) btnUp.disabled = pickerState.currentPath.length === 0;
}

function updateSelectionLabel() {
  if (!selectedLabelEl) selectedLabelEl = document.getElementById("picker-selected-label");
  if (!selectedLabelEl) return;

  const folder = pickerState.selectedFolder;
  const deck = pickerState.selectedDeck;

  if (!folder && (deck === "all" || !deck)) {
    selectedLabelEl.innerHTML = `<span class="picker-pill-highlight">📁 <strong>All Collections</strong> (Entire Library)</span>`;
  } else if (folder && (deck === "all" || !deck)) {
    selectedLabelEl.innerHTML = `<span class="picker-pill-highlight">📁 <strong>${escapeHTML(folder)}</strong> (All Decks in Folder)</span>`;
  } else if (folder) {
    selectedLabelEl.innerHTML = `<span class="picker-pill-highlight">📁 <strong>${escapeHTML(folder)}</strong> / 🗂️ <strong>${escapeHTML(deck || "Default")}</strong></span>`;
  } else {
    selectedLabelEl.innerHTML = `<span class="picker-pill-highlight">🗂️ <strong>${escapeHTML(deck || "Default")}</strong> <span style="opacity:0.6">(Standalone)</span></span>`;
  }
}

function selectDeck(folder, deck) {
  pickerState.selectedFolder = folder;
  pickerState.selectedDeck = deck || (pickerState.allowRoot ? "all" : "Default");
  updateSelectionLabel();
  renderPickerCanvas();
}

function selectFolderAsTarget(folder) {
  pickerState.selectedFolder = folder;
  // If in study mode, selecting folder defaults to all decks in that folder
  pickerState.selectedDeck = pickerState.allowRoot ? "all" : "Default";
  updateSelectionLabel();
}


/**
 * Get hierarchy data for picker
 */
function getPickerData() {
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
      const dMap = folderMap.get(folder);
      if (!dMap.has(deck)) dMap.set(deck, { total: 0, due: 0 });
      const stats = dMap.get(deck);
      stats.total++;
      if (isDue) stats.due++;
    } else {
      const d = deck || "Default";
      if (!standaloneMap.has(d)) standaloneMap.set(d, { total: 0, due: 0 });
      const stats = standaloneMap.get(d);
      stats.total++;
      if (isDue) stats.due++;
    }
  });

  return { folderMap, standaloneMap };
}

/**
 * Render the whole picker dialog
 */
export function renderPicker() {
  updateNavButtons();
  renderBreadcrumbs();
  renderPickerTree();
  renderPickerCanvas();
}

function renderBreadcrumbs() {
  if (!breadcrumbsEl) breadcrumbsEl = document.getElementById("picker-breadcrumbs");
  if (!breadcrumbsEl) return;

  breadcrumbsEl.innerHTML = "";

  const rootChip = document.createElement("button");
  rootChip.className = "breadcrumb-chip root-chip";
  rootChip.innerHTML = `<svg class="chip-icon-svg" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Collections Root</span>`;
  rootChip.addEventListener("click", () => navigatePickerTo([]));
  breadcrumbsEl.appendChild(rootChip);

  let accumulated = [];
  pickerState.currentPath.forEach((seg, idx) => {
    accumulated.push(seg);
    const thisPath = [...accumulated];

    const sep = document.createElement("span");
    sep.className = "breadcrumb-sep";
    sep.textContent = "›";
    breadcrumbsEl.appendChild(sep);

    const chip = document.createElement("button");
    const isLast = idx === pickerState.currentPath.length - 1;
    chip.className = `breadcrumb-chip ${isLast ? "active" : ""}`;
    chip.innerHTML = `<svg class="chip-icon-svg" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>${escapeHTML(seg)}</span>`;
    chip.addEventListener("click", () => navigatePickerTo(thisPath));
    breadcrumbsEl.appendChild(chip);
  });
}

function renderPickerTree() {
  if (!treeContainerEl) treeContainerEl = document.getElementById("picker-tree-container");
  if (!treeContainerEl) return;

  const { folderMap, standaloneMap } = getPickerData();
  treeContainerEl.innerHTML = "";

  // 1. All Collections (if allowed)
  if (pickerState.allowRoot) {
    const allItem = document.createElement("div");
    const isAllSelected = pickerState.selectedDeck === "all";
    allItem.className = `tree-item root-tree-item ${isAllSelected ? "active" : ""}`;
    allItem.innerHTML = `
      <div class="tree-item-content">
        <svg class="tree-icon-svg" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <span class="tree-item-label">📁 All Collections (All)</span>
      </div>
    `;
    allItem.addEventListener("click", () => {
      navigatePickerTo([]);
      selectDeck(undefined, "all");
    });
    treeContainerEl.appendChild(allItem);
  }

  // 2. Folders & subdecks
  Array.from(folderMap.keys()).sort().forEach(folderName => {
    const dMap = folderMap.get(folderName);
    let folderTotal = 0;
    dMap.forEach(s => { folderTotal += s.total; });

    const isFolderActive = pickerState.currentPath[0] === folderName;
    const isExpanded = pickerState.expandedFolders.has(folderName) || isFolderActive;

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
        <span class="tree-badge">${folderTotal}</span>
      </div>
    `;

    folderRow.querySelector(".tree-chevron").addEventListener("click", (e) => {
      e.stopPropagation();
      if (pickerState.expandedFolders.has(folderName)) {
        pickerState.expandedFolders.delete(folderName);
      } else {
        pickerState.expandedFolders.add(folderName);
      }
      renderPickerTree();
    });

    folderRow.querySelector(".tree-item-content").addEventListener("click", () => {
      pickerState.expandedFolders.add(folderName);
      selectFolderAsTarget(folderName);
      navigatePickerTo([folderName]);
    });

    folderNode.appendChild(folderRow);

    if (isExpanded) {
      const sublist = document.createElement("div");
      sublist.className = "tree-sublist";

      Array.from(dMap.keys()).sort().forEach(deckName => {
        const stats = dMap.get(deckName);
        const isDeckSelected = pickerState.selectedFolder === folderName && pickerState.selectedDeck === deckName;

        const deckRow = document.createElement("div");
        deckRow.className = `tree-item deck-tree-item ${isDeckSelected ? "active" : ""}`;
        deckRow.innerHTML = `
          <div class="tree-item-content">
            <svg class="tree-icon-svg deck-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            <span class="tree-item-label">${escapeHTML(deckName)}</span>
            <span class="tree-badge">${stats.total}</span>
          </div>
        `;
        deckRow.addEventListener("click", () => {
          selectDeck(folderName, deckName);
          navigatePickerTo([folderName]);
        });
        sublist.appendChild(deckRow);
      });

      folderNode.appendChild(sublist);
    }

    treeContainerEl.appendChild(folderNode);
  });

  // 3. Standalone decks
  if (standaloneMap.size > 0) {
    const header = document.createElement("div");
    header.className = "tree-section-header";
    header.textContent = "Standalone Decks";
    treeContainerEl.appendChild(header);

    Array.from(standaloneMap.keys()).sort().forEach(deckName => {
      const stats = standaloneMap.get(deckName);
      const isSelected = !pickerState.selectedFolder && pickerState.selectedDeck === deckName;

      const deckRow = document.createElement("div");
      deckRow.className = `tree-item deck-tree-item ${isSelected ? "active" : ""}`;
      deckRow.innerHTML = `
        <div class="tree-item-content">
          <svg class="tree-icon-svg deck-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span class="tree-item-label">${escapeHTML(deckName)}</span>
          <span class="tree-badge">${stats.total}</span>
        </div>
      `;
      deckRow.addEventListener("click", () => {
        selectDeck(undefined, deckName);
        navigatePickerTo([]);
      });
      treeContainerEl.appendChild(deckRow);
    });
  }
}

function renderPickerCanvas() {
  if (!canvasEl) canvasEl = document.getElementById("picker-canvas");
  if (!canvasEl) return;

  const { folderMap, standaloneMap } = getPickerData();
  const q = pickerState.searchQuery;
  const path = pickerState.currentPath;

  canvasEl.innerHTML = "";

  // 1. Search Mode: Flattened search results across all collections
  if (q) {
    const results = [];

    // Search Folders
    Array.from(folderMap.keys()).forEach(folderName => {
      const dMap = folderMap.get(folderName);
      let total = 0;
      dMap.forEach(s => total += s.total);

      if (folderName.toLowerCase().includes(q)) {
        results.push({ type: "folder", name: folderName, count: `${dMap.size} collections • ${total} cards` });
      }

      // Search decks inside folder
      Array.from(dMap.keys()).forEach(deckName => {
        const s = dMap.get(deckName);
        if (deckName.toLowerCase().includes(q) || folderName.toLowerCase().includes(q)) {
          results.push({
            type: "deck",
            folder: folderName,
            name: deckName,
            count: `${s.total} cards`,
            hierarchy: `${folderName} / ${deckName}`
          });
        }
      });
    });

    // Search standalone decks
    Array.from(standaloneMap.keys()).forEach(deckName => {
      const s = standaloneMap.get(deckName);
      if (deckName.toLowerCase().includes(q)) {
        results.push({
          type: "deck",
          folder: undefined,
          name: deckName,
          count: `${s.total} cards`,
          hierarchy: deckName
        });
      }
    });

    if (results.length === 0) {
      canvasEl.innerHTML = `
        <div class="picker-empty-state">
          <p>No collections match "<strong>${escapeHTML(q)}</strong>".</p>
          <button class="btn btn-secondary btn-sm" id="btn-search-create-deck">Create deck "${escapeHTML(q)}"</button>
        </div>
      `;
      canvasEl.querySelector("#btn-search-create-deck")?.addEventListener("click", () => {
        selectDeck(path[0] || undefined, q);
        confirmSelection();
      });
      return;
    }

    const grid = document.createElement("div");
    grid.className = "picker-grid-container";

    results.forEach(it => {
      const tile = document.createElement("div");
      const isSelected = it.type === "deck" &&
        it.folder === pickerState.selectedFolder &&
        it.name === pickerState.selectedDeck;

      tile.className = `picker-card-tile ${isSelected ? "selected" : ""}`;
      const icon = it.type === "folder"
        ? `<svg class="tile-icon-svg folder-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
        : `<svg class="tile-icon-svg deck-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;

      tile.innerHTML = `
        <div class="tile-icon-wrap">${icon}</div>
        <div class="tile-main-info">
          <div class="tile-title">${escapeHTML(it.hierarchy || it.name)}</div>
          <div class="tile-subtitle">${it.count}</div>
        </div>
      `;

      tile.addEventListener("click", () => {
        if (it.type === "folder") {
          pickerState.expandedFolders.add(it.name);
          navigatePickerTo([it.name]);
          selectFolderAsTarget(it.name);
        } else {
          selectDeck(it.folder, it.name);
        }
      });

      tile.addEventListener("dblclick", () => {
        if (it.type === "deck") {
          selectDeck(it.folder, it.name);
          confirmSelection();
        }
      });

      grid.appendChild(tile);
    });

    canvasEl.appendChild(grid);
    return;
  }

  // 2. Folder Navigation Mode: Show items inside current path
  let items = [];

  if (path.length === 1 && folderMap.has(path[0])) {
    // Inside folder path[0] -> show collections inside this folder
    const folderName = path[0];
    const dMap = folderMap.get(folderName) || new Map();

    Array.from(dMap.keys()).sort().forEach(deckName => {
      const s = dMap.get(deckName);
      items.push({
        type: "deck",
        folder: folderName,
        name: deckName,
        count: `${s.total} cards`
      });
    });
  } else {
    // Root level -> show all folders + standalone decks
    Array.from(folderMap.keys()).sort().forEach(folderName => {
      const dMap = folderMap.get(folderName);
      let total = 0;
      dMap.forEach(s => total += s.total);
      items.push({
        type: "folder",
        name: folderName,
        count: `${dMap.size} collections • ${total} cards`
      });
    });

    Array.from(standaloneMap.keys()).sort().forEach(deckName => {
      const s = standaloneMap.get(deckName);
      items.push({
        type: "deck",
        folder: undefined,
        name: deckName,
        count: `${s.total} cards`
      });
    });
  }

  if (items.length === 0) {
    canvasEl.innerHTML = `
      <div class="picker-empty-state">
        <p>Folder is empty.</p>
        <button class="btn btn-primary btn-sm" id="btn-create-first-deck">➕ Create New Deck Here</button>
      </div>
    `;
    canvasEl.querySelector("#btn-create-first-deck")?.addEventListener("click", promptCreateDeckInPicker);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "picker-grid-container";

  items.forEach(it => {
    const tile = document.createElement("div");
    const isSelected = it.type === "deck" &&
      it.folder === pickerState.selectedFolder &&
      it.name === pickerState.selectedDeck;

    tile.className = `picker-card-tile ${isSelected ? "selected" : ""}`;
    const icon = it.type === "folder"
      ? `<svg class="tile-icon-svg folder-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
      : `<svg class="tile-icon-svg deck-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;

    tile.innerHTML = `
      <div class="tile-icon-wrap">${icon}</div>
      <div class="tile-main-info">
        <div class="tile-title">${escapeHTML(it.name)}</div>
        <div class="tile-subtitle">${it.count}</div>
      </div>
    `;

    tile.addEventListener("click", () => {
      if (it.type === "folder") {
        pickerState.expandedFolders.add(it.name);
        selectFolderAsTarget(it.name);
        navigatePickerTo([it.name]);
      } else {
        selectDeck(it.folder, it.name);
      }
    });

    tile.addEventListener("dblclick", () => {
      if (it.type === "deck") {
        selectDeck(it.folder, it.name);
        confirmSelection();
      }
    });

    grid.appendChild(tile);
  });

  canvasEl.appendChild(grid);
}

function promptCreateFolderInPicker() {
  const name = prompt("Enter new folder name (e.g. Japanese, Medical, Spanish):");
  if (!name || !name.trim()) return;

  const clean = name.trim();
  pickerState.expandedFolders.add(clean);
  selectFolderAsTarget(clean);
  navigatePickerTo([clean]);
  showToast(`Folder "${clean}" selected`, "success");
}

function promptCreateDeckInPicker() {
  const currentFolder = pickerState.currentPath[0] || pickerState.selectedFolder;
  const name = prompt(`Enter new collection name${currentFolder ? ` inside "${currentFolder}"` : ""}:`);
  if (!name || !name.trim()) return;

  const clean = name.trim();
  selectDeck(currentFolder, clean);
  showToast(`Selected "${clean}"! Click "Select This Destination" to confirm.`, "success");
}
