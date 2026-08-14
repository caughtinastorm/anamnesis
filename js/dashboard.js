import { state } from "./state.js";
import { dom, showToast, showModal, switchView } from "./ui.js";
import { getCardFolder, getCardDeck, getCardFullHierarchy, matchesDeckSelection, formatDeckSelectionLabel, escapeHTML, generateUUID } from "./utils.js";
import { isCardDue, isCardNew, createDefaultFSRSStats } from "../fsrs.js";
import * as db from "../db.js";
import { loadCardsFromDB } from "./cards.js";
import { openCollectionPicker } from "./picker.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

/**
 * Called by cards.js subscriber after every loadCardsFromDB().
 * Registered in app.js via onCardsRefreshed(refreshDashboard).
 */
export function refreshDashboard() {
  populateDeckDropdown();
  calculateStats();
  updateUIStats();
  renderFoldersTree();
  renderHeatmap();
}

/**
 * Set the active deck/collection filter across the application.
 * @param {string} selection e.g. "all", "folder:Spanish", "deck:Spanish / Verbs", "deck:Verbs"
 */
export function setActiveDeckSelection(selection = "all") {
  state.selectedDeck = selection || "all";

  // Sync hidden deckSelect dropdown for backwards compatibility
  if (dom.deckSelect) {
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

export function filterCards(customSelected = null) {
  const selected = customSelected !== null ? customSelected : (state.selectedDeck || "all");
  return state.allCards.filter(card => matchesDeckSelection(card, selected));
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

  const filtered = filterCards();
  const due = state.dueCards.length;
  const total = filtered.length;

  if (titleEl) {
    titleEl.textContent = formatDeckSelectionLabel(currentVal);
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

  if (dom.btnDashboardAllDecks) {
    dom.btnDashboardAllDecks.addEventListener("click", () => {
      switchView("view-decks");
    });
  }
}

export function renderFoldersTree() {
  if (!dom.foldersTreeContainer) return;
  dom.foldersTreeContainer.innerHTML = "";
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
      const s = dm.get(deck); s.total++; if (isDue) s.due++;
    } else {
      const d = deck || "Default";
      if (!standaloneMap.has(d)) standaloneMap.set(d, { total: 0, due: 0 });
      const s = standaloneMap.get(d); s.total++; if (isDue) s.due++;
    }
  });

  if (folderMap.size === 0 && standaloneMap.size === 0) {
    dom.foldersTreeContainer.innerHTML = "<p class='help-text' style='padding: 10px 0;'>No collections created yet. Add cards or import decks to begin.</p>";
    return;
  }

  // Folders with sub-decks
  Array.from(folderMap.keys()).sort().forEach(folder => {
    const dm = folderMap.get(folder);
    let totalCards = 0, totalDue = 0;
    dm.forEach(s => { totalCards += s.total; totalDue += s.due; });

    const node = document.createElement("div"); node.className = "folder-node";
    const header = document.createElement("div"); header.className = "folder-header-row";
    const titleWrap = document.createElement("div"); titleWrap.className = "folder-title-wrap";
    titleWrap.innerHTML = `<svg class="folder-icon-svg" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span>${escapeHTML(folder)}</span><span class="folder-count-badge">${totalCards} cards${totalDue > 0 ? ` • ${totalDue} due` : ""}</span>`;
    
    titleWrap.addEventListener("click", () => {
      setActiveDeckSelection(`folder:${folder}`);
      showToast(`Selected folder "${folder}"`, "info");
    });

    const actWrap = document.createElement("div"); actWrap.className = "folder-actions-wrap";
    
    if (totalDue > 0) {
      const btnStudy = document.createElement("button");
      btnStudy.className = "btn-folder-action";
      btnStudy.textContent = `Study (${totalDue})`;
      btnStudy.title = `Study due cards in folder ${folder}`;
      btnStudy.addEventListener("click", async e => {
        e.stopPropagation();
        setActiveDeckSelection(`folder:${folder}`);
        switchView("view-review");
        const { startStudySession } = await import("./study.js");
        startStudySession(false);
      });
      actWrap.appendChild(btnStudy);
    }

    const btnPracticeFolder = document.createElement("button");
    btnPracticeFolder.className = "btn-folder-action";
    btnPracticeFolder.textContent = "Practice All";
    btnPracticeFolder.title = `Practice all ${totalCards} cards in ${folder}`;
    btnPracticeFolder.addEventListener("click", async e => {
      e.stopPropagation();
      setActiveDeckSelection(`folder:${folder}`);
      switchView("view-review");
      const { startStudySession } = await import("./study.js");
      startStudySession(true);
    });
    actWrap.appendChild(btnPracticeFolder);

    const btnDeleteFolder = document.createElement("button");
    btnDeleteFolder.className = "btn-folder-action btn-folder-delete";
    btnDeleteFolder.title = `Delete folder "${folder}" and all its collections`;
    btnDeleteFolder.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    btnDeleteFolder.addEventListener("click", e => {
      e.stopPropagation();
      deleteFolder(folder, totalCards);
    });
    actWrap.appendChild(btnDeleteFolder);

    header.appendChild(titleWrap);
    header.appendChild(actWrap);
    node.appendChild(header);

    const dl = document.createElement("div"); dl.className = "folder-decks-list";
    Array.from(dm.keys()).sort().forEach(deck => {
      const s = dm.get(deck);
      const row = document.createElement("div"); row.className = "deck-tree-item";
      
      const leftWrap = document.createElement("div");
      leftWrap.className = "deck-tree-left";
      
      const name = document.createElement("span");
      name.className = "deck-tree-name";
      name.innerHTML = `↳ ${escapeHTML(deck)}`;
      name.title = `Select collection ${deck}`;
      name.addEventListener("click", () => {
        setActiveDeckSelection(`deck:${folder} / ${deck}`);
        showToast(`Selected collection "${deck}"`, "info");
      });

      const count = document.createElement("span");
      count.className = "deck-count-pill";
      count.textContent = `${s.total} cards${s.due > 0 ? ` (${s.due} due)` : ""}`;

      leftWrap.appendChild(name);
      leftWrap.appendChild(count);

      const actGroup = document.createElement("div");
      actGroup.className = "deck-tree-actions";

      if (s.due > 0) {
        const btnDeckStudy = document.createElement("button");
        btnDeckStudy.className = "btn-deck-action";
        btnDeckStudy.innerHTML = `Study (${s.due})`;
        btnDeckStudy.title = `Study due cards in ${deck}`;
        btnDeckStudy.addEventListener("click", async (e) => {
          e.stopPropagation();
          setActiveDeckSelection(`deck:${folder} / ${deck}`);
          switchView("view-review");
          const { startStudySession } = await import("./study.js");
          startStudySession(false);
        });
        actGroup.appendChild(btnDeckStudy);
      }

      const btnDeckPractice = document.createElement("button");
      btnDeckPractice.className = "btn-deck-action practice-all";
      btnDeckPractice.innerHTML = "Practice";
      btnDeckPractice.title = `Practice all ${s.total} cards in ${deck}`;
      btnDeckPractice.addEventListener("click", async (e) => {
        e.stopPropagation();
        setActiveDeckSelection(`deck:${folder} / ${deck}`);
        switchView("view-review");
        const { startStudySession } = await import("./study.js");
        startStudySession(true);
      });
      actGroup.appendChild(btnDeckPractice);

      const btnDeckDelete = document.createElement("button");
      btnDeckDelete.className = "btn-deck-action btn-deck-delete";
      btnDeckDelete.title = `Delete collection "${deck}"`;
      btnDeckDelete.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
      btnDeckDelete.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteDeck(folder, deck, s.total);
      });
      actGroup.appendChild(btnDeckDelete);

      row.appendChild(leftWrap);
      row.appendChild(actGroup);
      dl.appendChild(row);
    });
    node.appendChild(dl);
    dom.foldersTreeContainer.appendChild(node);
  });

  // Standalone Decks
  if (standaloneMap.size > 0) {
    const node = document.createElement("div"); node.className = "folder-node";
    const header = document.createElement("div"); header.className = "folder-header-row";
    const titleWrap = document.createElement("div"); titleWrap.className = "folder-title-wrap";
    titleWrap.innerHTML = `<svg class="folder-icon-svg" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg><span>Standalone Collections</span>`;
    header.appendChild(titleWrap); node.appendChild(header);
    const dl = document.createElement("div"); dl.className = "folder-decks-list";
    Array.from(standaloneMap.keys()).sort().forEach(deck => {
      const s = standaloneMap.get(deck);
      const row = document.createElement("div"); row.className = "deck-tree-item";
      
      const leftWrap = document.createElement("div");
      leftWrap.className = "deck-tree-left";

      const name = document.createElement("span");
      name.className = "deck-tree-name";
      name.textContent = deck;
      name.title = `Select collection ${deck}`;
      name.addEventListener("click", () => {
        setActiveDeckSelection(`deck:${deck}`);
        showToast(`Selected collection "${deck}"`, "info");
      });

      const count = document.createElement("span");
      count.className = "deck-count-pill";
      count.textContent = `${s.total} cards${s.due > 0 ? ` (${s.due} due)` : ""}`;

      leftWrap.appendChild(name);
      leftWrap.appendChild(count);

      const actGroup = document.createElement("div");
      actGroup.className = "deck-tree-actions";

      if (s.due > 0) {
        const btnDeckStudy = document.createElement("button");
        btnDeckStudy.className = "btn-deck-action";
        btnDeckStudy.innerHTML = `Study (${s.due})`;
        btnDeckStudy.title = `Study due cards in ${deck}`;
        btnDeckStudy.addEventListener("click", async (e) => {
          e.stopPropagation();
          setActiveDeckSelection(`deck:${deck}`);
          switchView("view-review");
          const { startStudySession } = await import("./study.js");
          startStudySession(false);
        });
        actGroup.appendChild(btnDeckStudy);
      }

      const btnDeckPractice = document.createElement("button");
      btnDeckPractice.className = "btn-deck-action practice-all";
      btnDeckPractice.innerHTML = "Practice";
      btnDeckPractice.title = `Practice all ${s.total} cards in ${deck}`;
      btnDeckPractice.addEventListener("click", async (e) => {
        e.stopPropagation();
        setActiveDeckSelection(`deck:${deck}`);
        switchView("view-review");
        const { startStudySession } = await import("./study.js");
        startStudySession(true);
      });
      actGroup.appendChild(btnDeckPractice);

      const btnDeckDelete = document.createElement("button");
      btnDeckDelete.className = "btn-deck-action btn-deck-delete";
      btnDeckDelete.title = `Delete collection "${deck}"`;
      btnDeckDelete.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
      btnDeckDelete.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteDeck(null, deck, s.total);
      });
      actGroup.appendChild(btnDeckDelete);

      row.appendChild(leftWrap);
      row.appendChild(actGroup);
      dl.appendChild(row);
    });
    node.appendChild(dl);
    dom.foldersTreeContainer.appendChild(node);
  }
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

export function recordDailyReview() {
  const today = new Date().toISOString().slice(0, 10);
  let h = {};
  try { h = JSON.parse(localStorage.getItem("app-review-history") || "{}"); } catch(e) {}
  h[today] = (h[today] || 0) + 1;
  localStorage.setItem("app-review-history", JSON.stringify(h));
  renderHeatmap();
}

export function calculateStreak(h) {
  let streak = 0;
  let d = new Date();
  const todayKey = d.toISOString().slice(0, 10);
  if (h[todayKey] > 0) { streak++; d.setDate(d.getDate() - 1); }
  else {
    d.setDate(d.getDate() - 1);
    const yest = d.toISOString().slice(0, 10);
    if (!h[yest] || h[yest] <= 0) return 0;
    streak++; d.setDate(d.getDate() - 1);
  }
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (h[key] > 0) { streak++; d.setDate(d.getDate() - 1); } else break;
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
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const count = h[key] || 0; total += count;
    const cell = document.createElement("div"); cell.className = "heatmap-cell";
    cell.title = `${key}: ${count} reviews`;
    cell.classList.add(count === 0 ? "level-0" : count <= 5 ? "level-1" : count <= 15 ? "level-2" : count <= 30 ? "level-3" : "level-4");
    dom.dashboardHeatmapGrid.appendChild(cell);
  }
  const sub = document.getElementById("heatmap-reviews-count");
  if (sub) sub.textContent = `${total} reviews in last 60 days`;
  const streak = document.getElementById("stat-streak-days");
  if (streak) streak.textContent = calculateStreak(h);
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
    fsrs_stats: createDefaultFSRSStats(),
    sm2_stats: { ease_factor: 2.5, interval: 0, repetitions: 0, next_review: 0 },
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
