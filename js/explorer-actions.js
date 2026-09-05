/**
 * Explorer Actions Module
 *
 * All mutating / CRUD / dialog operations split out of explorer.js.
 * Receives navigator and loader callbacks via initExplorerActions()
 * so it never needs to import from explorer.js (avoids circular imports).
 *
 * Imports:
 *   explorer-state.js  — read/write explorerState
 *   state.js           — state.allCards
 *   ui.js              — dom, showToast, showModal, switchView, scrollToElement
 *   utils.js           — getCardFolder, getCardDeck, escapeHTML, escapeCSVField
 *   db.js              — saveCards
 *   dashboard.js       — calculateStats, updateUIStats
 *   import.js          — setImportDestination
 */

import { explorerState } from "./explorer-state.js";
import { state } from "./state.js";
import { dom, showToast, showModal, showPromptModal, switchView, scrollToElement } from "./ui.js";
import { getCardFolder, getCardDeck, escapeHTML, escapeCSVField } from "./utils.js";
import { createDefaultFSRSStats } from "../fsrs.js";
import * as db from "../db.js";
import { calculateStats, updateUIStats, setActiveDeckSelection } from "./dashboard.js";
import { setImportDestination } from "./import.js";

// Injected by explorer.js during initExplorer()
let _navigateTo = null;
let _loadCardsFromDB = null;
let _onSyncRequest = null;
let _getExplorerData = null;

/**
 * Called once by explorer.js during initExplorer() to inject navigation helpers.
 * @param {{ navigateTo: Function, loadCardsFromDB: Function, onSyncRequest: Function, getExplorerData: Function }} deps
 */
export function initExplorerActions({ navigateTo, loadCardsFromDB, onSyncRequest, getExplorerData }) {
  _navigateTo = navigateTo;
  _loadCardsFromDB = loadCardsFromDB;
  _onSyncRequest = onSyncRequest;
  _getExplorerData = getExplorerData;
  initExportModal();
}

// -------------------------------------------------------------
// Toolbar Action Handlers (wired in explorer.js initExplorer)
// -------------------------------------------------------------

export function handleImportHere() {
  const path = explorerState.currentPath;
  let targetFolder = "";
  let targetDeck = "Default";

  if (path.length === 2) {
    targetFolder = path[0];
    targetDeck = path[1];
  } else if (path.length === 1) {
    const { folderMap } = _getExplorerData();
    if (folderMap.has(path[0])) {
      targetFolder = path[0];
      targetDeck = "Default";
    } else {
      targetDeck = path[0];
    }
  }

  setImportDestination(targetFolder, targetDeck);
}

export function handleExplorerExport() {
  const path = explorerState.currentPath;
  if (path.length === 2) {
    openExportModal(path[0], path[1]);
  } else if (path.length === 1) {
    const { folderMap } = _getExplorerData ? _getExplorerData() : { folderMap: new Map() };
    if (folderMap && folderMap.has(path[0])) {
      openExportModal(path[0], undefined);
    } else {
      openExportModal(undefined, path[0]);
    }
  } else {
    openExportModal(undefined, undefined);
  }
}

export function handleAddCardHere() {
  const path = explorerState.currentPath;
  let targetFolder = "";
  let targetDeck = "Default";

  if (path.length === 2) {
    targetFolder = path[0];
    targetDeck = path[1];
  } else if (path.length === 1) {
    const { folderMap } = _getExplorerData();
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

export async function handleStudyCurrent(force = false) {
  const path = explorerState.currentPath;
  let sel = "all";
  if (path.length === 2) {
    sel = `deck:${path[0]} / ${path[1]}`;
  } else if (path.length === 1) {
    const { folderMap } = _getExplorerData();
    if (folderMap.has(path[0])) {
      sel = `folder:${path[0]}`;
    } else {
      sel = `deck:${path[0]}`;
    }
  }

  setActiveDeckSelection(sel);
  switchView("view-review");
  const { startStudySession } = await import("./study.js");
  startStudySession(force);
}

// -------------------------------------------------------------
// Context Menu
// -------------------------------------------------------------

export function showItemContextMenu(e, item) {
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
    <button class="menu-item menu-reset-fsrs warning">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      Reset FSRS Data
    </button>
    <button class="menu-item menu-delete danger">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      Delete
    </button>
  `;

  // Position menu near the triggering element safely within screen bounds
  const triggerEl = e.target.closest("button") || e.target;
  const rect = triggerEl.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${Math.max(10, Math.min(window.innerHeight - 240, rect.bottom + 4))}px`;
  menu.style.left = `${Math.max(10, Math.min(window.innerWidth - 190, rect.left))}px`;
  menu.style.zIndex = "2500";

  const closeMenu = () => {
    menu.remove();
    document.removeEventListener("pointerdown", closeListener);
  };

  menu.querySelector(".menu-open")?.addEventListener("click", () => {
    closeMenu();
    if (isFolder) {
      explorerState.expandedFolders.add(item.name);
      _navigateTo([item.name]);
    } else {
      _navigateTo(item.folder ? [item.folder, item.name] : [item.name]);
    }
  });

  menu.querySelector(".menu-study")?.addEventListener("click", async () => {
    closeMenu();
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

  menu.querySelector(".menu-import")?.addEventListener("click", () => {
    closeMenu();
    setImportDestination(isFolder ? item.name : (item.folder || ""), isFolder ? "Default" : item.name);
  });

  menu.querySelector(".menu-export")?.addEventListener("click", () => {
    closeMenu();
    if (isFolder) {
      openExportModal(item.name, undefined);
    } else {
      openExportModal(item.folder, item.name);
    }
  });

  menu.querySelector(".menu-rename")?.addEventListener("click", () => {
    closeMenu();
    if (isFolder) {
      promptRenameFolder(item.name);
    } else {
      promptRenameDeck(item.folder, item.name);
    }
  });

  menu.querySelector(".menu-reset-fsrs")?.addEventListener("click", () => {
    closeMenu();
    if (isFolder) {
      promptResetFolderFSRS(item.name, item.total);
    } else {
      promptResetDeckFSRS(item.folder, item.name, item.total);
    }
  });

  menu.querySelector(".menu-delete")?.addEventListener("click", () => {
    closeMenu();
    if (isFolder) {
      promptDeleteFolder(item.name, item.total);
    } else {
      promptDeleteDeck(item.folder, item.name, item.total);
    }
  });

  document.body.appendChild(menu);

  const closeListener = (evt) => {
    if (!menu.contains(evt.target)) {
      closeMenu();
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", closeListener), 10);
}

// -------------------------------------------------------------
// Create Dialogs
// -------------------------------------------------------------

export function promptCreateFolder() {
  showPromptModal(
    "New Folder",
    "Enter new folder name (e.g. Japanese, Medical, Science):",
    "",
    (folderName) => {
      if (!folderName) return;
      const cleanName = folderName.trim();
      explorerState.expandedFolders.add(cleanName);
      _navigateTo([cleanName]);
      showToast(`Folder "${cleanName}" created!`, "success");
    }
  );
}

export function promptCreateDeck() {
  const currentPath = explorerState.currentPath;
  let defaultFolder = "";
  if (currentPath.length >= 1) {
    const { folderMap } = _getExplorerData();
    if (folderMap.has(currentPath[0])) {
      defaultFolder = currentPath[0];
    }
  }

  showPromptModal(
    "New Collection",
    `Enter new collection/deck name${defaultFolder ? ` inside folder "${defaultFolder}"` : ""}:`,
    "",
    (deckName) => {
      if (!deckName) return;
      const cleanDeck = deckName.trim();
      const nextPath = defaultFolder ? [defaultFolder, cleanDeck] : [cleanDeck];
      _navigateTo(nextPath);
      showToast(`Collection "${cleanDeck}" created! Ready to import or add cards.`, "success");
    }
  );
}

// -------------------------------------------------------------
// Rename Dialogs
// -------------------------------------------------------------

export function promptRenameFolder(oldFolder) {
  showPromptModal(
    "Rename Folder",
    `Rename folder "${oldFolder}" to:`,
    oldFolder,
    (newName) => {
      if (!newName || !newName.trim() || newName.trim() === oldFolder) return;
      const cleanNew = newName.trim();
      showModal(
        `Rename Folder "${oldFolder}"?`,
        `This will update the parent folder name on all flashcards in "${oldFolder}" to "${cleanNew}".`,
        async () => {
          const now = Date.now();
          const toUpdate = state.allCards
            .filter(c => !c.deleted && getCardFolder(c).toLowerCase() === oldFolder.toLowerCase())
            .map(c => ({ ...c, folder: cleanNew, last_modified: now }));

          if (toUpdate.length > 0) {
            try {
              await db.saveCards(toUpdate);
              showToast(`Renamed folder to "${cleanNew}" (${toUpdate.length} cards updated)`, "success");
              if (explorerState.currentPath[0] === oldFolder) {
                explorerState.currentPath[0] = cleanNew;
              }
              await _loadCardsFromDB();
              _onSyncRequest();
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
  );
}

export function promptRenameDeck(folder, oldDeck) {
  const label = folder ? `${folder} / ${oldDeck}` : oldDeck;
  showPromptModal(
    "Rename Collection",
    `Rename collection "${oldDeck}" to:`,
    oldDeck,
    (newName) => {
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
            .map(c => ({ ...c, deck: cleanNew, last_modified: now }));

          if (toUpdate.length > 0) {
            try {
              await db.saveCards(toUpdate);
              showToast(`Renamed collection to "${cleanNew}" (${toUpdate.length} cards updated)`, "success");
              if (explorerState.currentPath.length === 2 && explorerState.currentPath[1] === oldDeck) {
                explorerState.currentPath[1] = cleanNew;
              } else if (explorerState.currentPath.length === 1 && explorerState.currentPath[0] === oldDeck) {
                explorerState.currentPath[0] = cleanNew;
              }
              await _loadCardsFromDB();
              _onSyncRequest();
            } catch (err) {
              console.error("Rename deck error:", err);
              showToast("Failed to rename collection", "error");
            }
          }
        }
      );
    }
  );
}

// -------------------------------------------------------------
// Delete Dialogs
// -------------------------------------------------------------

export function promptDeleteFolder(folderName, totalCards) {
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
          _navigateTo([]);
          await _loadCardsFromDB();
          _onSyncRequest();
        } catch (err) {
          console.error("Delete folder error:", err);
          showToast("Failed to delete folder", "error");
        }
      }
    }
  );
}

export function promptDeleteDeck(folderName, deckName, count) {
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
          _navigateTo(folderName ? [folderName] : []);
          await _loadCardsFromDB();
          _onSyncRequest();
        } catch (err) {
          console.error("Delete deck error:", err);
          showToast("Failed to delete collection", "error");
        }
      }
    }
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
    async () => {
      if (targetCards.length === 0) return;
      const now = Date.now();
      const updatedCards = targetCards.map(c => {
        const copy = { ...c, fsrs_stats: createDefaultFSRSStats(), last_modified: now };
        delete copy.sm2_stats;
        return copy;
      });

      try {
        await db.saveCards(updatedCards);
        await db.deleteReviewLogsForCards(updatedCards.map(c => c.id));
        showToast(`Reset FSRS data for ${updatedCards.length} cards in "${label}"`, "success");
        await _loadCardsFromDB();
        _onSyncRequest();
      } catch (err) {
        console.error("Reset FSRS deck error:", err);
        showToast("Failed to reset FSRS data", "error");
      }
    }
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
    async () => {
      if (targetCards.length === 0) return;
      const now = Date.now();
      const updatedCards = targetCards.map(c => {
        const copy = { ...c, fsrs_stats: createDefaultFSRSStats(), last_modified: now };
        delete copy.sm2_stats;
        return copy;
      });

      try {
        await db.saveCards(updatedCards);
        await db.deleteReviewLogsForCards(updatedCards.map(c => c.id));
        showToast(`Reset FSRS data for ${updatedCards.length} cards in folder "${folderName}"`, "success");
        await _loadCardsFromDB();
        _onSyncRequest();
      } catch (err) {
        console.error("Reset FSRS folder error:", err);
        showToast("Failed to reset FSRS data", "error");
      }
    }
  );
}

// -------------------------------------------------------------
// Collection Export System (CSV Standard, CSV FSRS Backup, JSON)
// -------------------------------------------------------------

let exportModalEl = null;
let exportScopeSelect = null;
let exportCountPill = null;
let exportScopeIndicator = null;
let btnCloseExportModal = null;
let btnExportModalCancel = null;
let btnExportModalDownload = null;

export function initExportModal() {
  if (typeof document === "undefined") return;

  exportModalEl = document.getElementById("export-collection-modal");
  if (!exportModalEl) return;

  exportScopeSelect = document.getElementById("export-scope-select");
  exportCountPill = document.getElementById("export-count-pill");
  exportScopeIndicator = document.getElementById("export-scope-indicator");
  btnCloseExportModal = document.getElementById("btn-close-export-modal");
  btnExportModalCancel = document.getElementById("btn-export-modal-cancel");
  btnExportModalDownload = document.getElementById("btn-export-modal-download");

  if (btnCloseExportModal) btnCloseExportModal.addEventListener("click", closeExportModal);
  if (btnExportModalCancel) btnExportModalCancel.addEventListener("click", closeExportModal);
  if (btnExportModalDownload) btnExportModalDownload.addEventListener("click", executeExport);

  if (exportScopeSelect) {
    exportScopeSelect.addEventListener("change", () => {
      updateExportModalPreview();
    });
  }

  // Close when clicking outside modal card
  exportModalEl.addEventListener("click", (e) => {
    if (e.target === exportModalEl) closeExportModal();
  });
}

export function openExportModal(initialFolder = undefined, initialDeck = undefined) {
  if (!exportModalEl) exportModalEl = document.getElementById("export-collection-modal");
  if (!exportModalEl) return;

  if (!exportScopeSelect) initExportModal();

  populateExportScopeOptions(initialFolder, initialDeck);
  updateExportModalPreview();

  exportModalEl.classList.remove("hidden");
}

export function closeExportModal() {
  if (exportModalEl) exportModalEl.classList.add("hidden");
}

function populateExportScopeOptions(initialFolder, initialDeck) {
  if (!exportScopeSelect) exportScopeSelect = document.getElementById("export-scope-select");
  if (!exportScopeSelect) return;

  exportScopeSelect.innerHTML = "";

  const { folderMap, standaloneMap } = _getExplorerData ? _getExplorerData() : { folderMap: new Map(), standaloneMap: new Map() };

  // 1. All collections option
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "🌐 All Collections (Entire Library)";
  exportScopeSelect.appendChild(allOpt);

  let targetValue = "all";
  if (initialFolder && initialDeck) {
    targetValue = `deck:${initialFolder} / ${initialDeck}`;
  } else if (initialFolder) {
    targetValue = `folder:${initialFolder}`;
  } else if (initialDeck) {
    targetValue = `deck:${initialDeck}`;
  }

  // 2. Folders
  if (folderMap && folderMap.size > 0) {
    const folderGroup = document.createElement("optgroup");
    folderGroup.label = "📁 Folders (All Decks in Folder)";

    Array.from(folderMap.keys()).sort().forEach(folderName => {
      const opt = document.createElement("option");
      opt.value = `folder:${folderName}`;
      opt.textContent = `📁 Folder: ${folderName}`;
      folderGroup.appendChild(opt);
    });
    exportScopeSelect.appendChild(folderGroup);
  }

  // 3. Decks / Collections
  const deckGroup = document.createElement("optgroup");
  deckGroup.label = "🗂️ Individual Collections / Decks";

  // Standalone decks
  if (standaloneMap) {
    Array.from(standaloneMap.keys()).sort().forEach(deckName => {
      const opt = document.createElement("option");
      opt.value = `deck:${deckName}`;
      opt.textContent = `🗂️ ${deckName}`;
      deckGroup.appendChild(opt);
    });
  }

  // Folder subdecks
  if (folderMap) {
    Array.from(folderMap.keys()).sort().forEach(folderName => {
      const dMap = folderMap.get(folderName);
      if (dMap) {
        Array.from(dMap.keys()).sort().forEach(deckName => {
          const opt = document.createElement("option");
          opt.value = `deck:${folderName} / ${deckName}`;
          opt.textContent = `🗂️ ${folderName} / ${deckName}`;
          deckGroup.appendChild(opt);
        });
      }
    });
  }

  if (deckGroup.children.length > 0) {
    exportScopeSelect.appendChild(deckGroup);
  }

  // Set initial selected value
  if (targetValue) {
    exportScopeSelect.value = targetValue;
    if (exportScopeSelect.value !== targetValue) {
      exportScopeSelect.value = "all";
    }
  }
}

function updateExportModalPreview() {
  if (!exportScopeSelect) exportScopeSelect = document.getElementById("export-scope-select");
  if (!exportScopeSelect) return;

  const scope = exportScopeSelect.value;
  const cards = getCardsForScope(scope);

  if (!exportCountPill) exportCountPill = document.getElementById("export-count-pill");
  if (!exportScopeIndicator) exportScopeIndicator = document.getElementById("export-scope-indicator");

  if (exportCountPill) {
    exportCountPill.textContent = `${cards.length} card${cards.length === 1 ? "" : "s"} selected`;
  }

  if (exportScopeIndicator) {
    if (scope === "all") {
      exportScopeIndicator.textContent = "Entire Library";
    } else if (scope.startsWith("folder:")) {
      exportScopeIndicator.textContent = `Folder: ${scope.slice(7)}`;
    } else if (scope.startsWith("deck:")) {
      exportScopeIndicator.textContent = `Collection: ${scope.slice(5)}`;
    }
  }
}

function getCardsForScope(scope) {
  const active = state.allCards.filter(c => !c.deleted);
  if (!scope || scope === "all") {
    return active;
  }
  if (scope.startsWith("folder:")) {
    const targetFolder = scope.slice(7).toLowerCase();
    return active.filter(c => getCardFolder(c).toLowerCase() === targetFolder);
  }
  if (scope.startsWith("deck:")) {
    const targetDeckKey = scope.slice(5);
    if (targetDeckKey.includes(" / ")) {
      const [f, d] = targetDeckKey.split(" / ");
      return active.filter(c =>
        getCardFolder(c).toLowerCase() === f.toLowerCase() &&
        getCardDeck(c).toLowerCase() === d.toLowerCase()
      );
    } else {
      return active.filter(c =>
        !getCardFolder(c) &&
        getCardDeck(c).toLowerCase() === targetDeckKey.toLowerCase()
      );
    }
  }
  return active;
}

function generateExportFilename(scope, format) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const ext = format === "json" ? "json" : "csv";
  let baseName = "anamnesis_all_collections";
  if (scope && scope.startsWith("folder:")) {
    const f = scope.slice(7).replace(/[^a-zA-Z0-9_-]/g, "_");
    baseName = `anamnesis_folder_${f}`;
  } else if (scope && scope.startsWith("deck:")) {
    const d = scope.slice(5).replace(/ \/ /g, "_").replace(/[^a-zA-Z0-9_-]/g, "_");
    baseName = `anamnesis_${d}`;
  }
  if (format === "csv-fsrs") {
    baseName += "_fsrs_backup";
  }
  return `${baseName}_${dateStr}.${ext}`;
}

/**
 * Sorts cards in logical hierarchical order:
 * 1. Folder (root / standalone decks first, then alphabetical folders)
 * 2. Collection / Deck (natural alphanumeric)
 * 3. Sub-text / Topic
 * 4. Front question text
 * 5. Creation timestamp
 */
export function sortCardsLogically(cards) {
  return [...cards].sort((a, b) => {
    const folderA = (getCardFolder(a) || "").toLowerCase();
    const folderB = (getCardFolder(b) || "").toLowerCase();
    if (folderA !== folderB) {
      if (!folderA) return -1;
      if (!folderB) return 1;
      return folderA.localeCompare(folderB, undefined, { numeric: true, sensitivity: "base" });
    }

    const deckA = (getCardDeck(a) || "").toLowerCase();
    const deckB = (getCardDeck(b) || "").toLowerCase();
    if (deckA !== deckB) {
      return deckA.localeCompare(deckB, undefined, { numeric: true, sensitivity: "base" });
    }

    const subA = (a.sub || "").toLowerCase();
    const subB = (b.sub || "").toLowerCase();
    if (subA !== subB) {
      return subA.localeCompare(subB, undefined, { numeric: true, sensitivity: "base" });
    }

    const frontA = (a.front || "").toLowerCase();
    const frontB = (b.front || "").toLowerCase();
    if (frontA !== frontB) {
      return frontA.localeCompare(frontB, undefined, { numeric: true, sensitivity: "base" });
    }

    return (a.created_at || 0) - (b.created_at || 0);
  });
}

function executeExport() {
  if (!exportScopeSelect) exportScopeSelect = document.getElementById("export-scope-select");
  if (!exportScopeSelect) return;

  const scope = exportScopeSelect.value;
  const cards = getCardsForScope(scope);

  if (cards.length === 0) {
    showToast("No active cards to export in selected collection", "error");
    return;
  }

  // Future-proof: Sort logically by folder, deck, sub, and content
  const sorted = sortCardsLogically(cards);

  const formatEl = document.querySelector('input[name="export-format"]:checked');
  const format = formatEl ? formatEl.value : "csv-standard";
  const filename = generateExportFilename(scope, format);

  try {
    if (format === "json") {
      // Lossless JSON stripped of any dead legacy SM2 cache properties
      const sanitized = sorted.map(c => {
        const copy = { ...c };
        delete copy.sm2_stats;
        return copy;
      });
      const jsonContent = JSON.stringify(sanitized, null, 2);
      downloadFile(jsonContent, filename, "application/json;charset=utf-8;");
    } else if (format === "csv-fsrs") {
      let csv = "Folder,Deck,Front,Back,Sub-text,Description,Stability,Difficulty,State,Lapses,Interval,Reps,NextReview\n";
      sorted.forEach(c => {
        const f = c.fsrs_stats || {};
        csv += [
          escapeCSVField(getCardFolder(c)),
          escapeCSVField(getCardDeck(c)),
          escapeCSVField(c.front || ""),
          escapeCSVField(c.back || ""),
          escapeCSVField(c.sub || ""),
          escapeCSVField(c.description || ""),
          f.stability || 0,
          f.difficulty || 0,
          f.state ?? 0,
          f.lapses || 0,
          f.interval ?? 0,
          f.repetitions ?? 0,
          f.next_review || 0
        ].join(",") + "\n";
      });
      downloadCSV(csv, filename);
    } else {
      // Standard clean CSV with folder & deck hierarchy
      let csv = "Folder,Deck,Front,Back,Sub-text,Description\n";
      sorted.forEach(c => {
        csv += [
          escapeCSVField(getCardFolder(c)),
          escapeCSVField(getCardDeck(c)),
          escapeCSVField(c.front || ""),
          escapeCSVField(c.back || ""),
          escapeCSVField(c.sub || ""),
          escapeCSVField(c.description || "")
        ].join(",") + "\n";
      });
      downloadCSV(csv, filename);
    }

    closeExportModal();
    showToast(`Exported ${sorted.length} cards successfully in logical order!`, "success");
  } catch (err) {
    console.error("Export error:", err);
    showToast("Failed to export cards", "error");
  }
}

export function exportDeckCSV(folder, deck) {
  openExportModal(folder, deck);
}

export function exportFolderCSV(folder) {
  openExportModal(folder, undefined);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadCSV(csvContent, filename) {
  // UTF-8 BOM (\uFEFF) forces Microsoft Excel on Windows to open CSV files with UTF-8 encoding
  // without garbling Japanese Kanji/Kana or accented characters
  const bom = "\uFEFF";
  const contentWithBom = csvContent.startsWith(bom) ? csvContent : bom + csvContent;
  downloadFile(contentWithBom, filename, "text/csv;charset=utf-8;");
}
