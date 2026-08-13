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
import { dom, showToast, showModal, switchView, scrollToElement } from "./ui.js";
import { getCardFolder, getCardDeck, escapeHTML, escapeCSVField } from "./utils.js";
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
    <button class="menu-item menu-delete danger">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      Delete
    </button>
  `;

  // Position menu near the triggering element
  const rect = e.target.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${Math.min(window.innerHeight - 220, rect.bottom + 4)}px`;
  menu.style.left = `${Math.min(window.innerWidth - 180, rect.left)}px`;
  menu.style.zIndex = "1000";

  menu.querySelector(".menu-open")?.addEventListener("click", () => {
    menu.remove();
    if (isFolder) {
      explorerState.expandedFolders.add(item.name);
      _navigateTo([item.name]);
    } else {
      _navigateTo(item.folder ? [item.folder, item.name] : [item.name]);
    }
  });

  menu.querySelector(".menu-study")?.addEventListener("click", async () => {
    menu.remove();
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

  const closeListener = (evt) => {
    if (!menu.contains(evt.target)) {
      menu.remove();
      document.removeEventListener("pointerdown", closeListener);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", closeListener), 10);
}

// -------------------------------------------------------------
// Create Dialogs
// -------------------------------------------------------------

export function promptCreateFolder() {
  const folderName = prompt("Enter new folder name (e.g. Japanese, Medical, Science):");
  if (!folderName || !folderName.trim()) return;

  const cleanName = folderName.trim();
  explorerState.expandedFolders.add(cleanName);
  _navigateTo([cleanName]);
  showToast(`Folder "${cleanName}" created!`, "success");
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

  const deckName = prompt(`Enter new collection/deck name${defaultFolder ? ` inside folder "${defaultFolder}"` : ""}:`);
  if (!deckName || !deckName.trim()) return;

  const cleanDeck = deckName.trim();
  const nextPath = defaultFolder ? [defaultFolder, cleanDeck] : [cleanDeck];
  _navigateTo(nextPath);
  showToast(`Collection "${cleanDeck}" created! Ready to import or add cards.`, "success");
}

// -------------------------------------------------------------
// Rename Dialogs
// -------------------------------------------------------------

export function promptRenameFolder(oldFolder) {
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

export function promptRenameDeck(folder, oldDeck) {
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

// -------------------------------------------------------------
// CSV Export
// -------------------------------------------------------------

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
