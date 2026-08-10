import { state } from "./state.js";
import { dom, showToast, switchView } from "./ui.js";
import { getCardFolder, getCardDeck, getCardFullHierarchy, escapeHTML, generateUUID } from "./utils.js";
import * as db from "../db.js";
import { populateBrowserDeckFilter, renderCardBrowser } from "./browser.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

export async function loadCardsFromDB() {
  try {
    state.allCards = await db.getCards();
    populateDeckDropdown();
    calculateStats();
    updateUIStats();
    renderFoldersTree();
    renderHeatmap();
    populateBrowserDeckFilter();
    renderCardBrowser();
  } catch (e) {
    console.error("Error loading cards from DB:", e);
    showToast("Failed to load local database", "error");
  }
}

export function populateDeckDropdown() {
  if (!dom.deckSelect) return;
  const prev = dom.deckSelect.value || "all";
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

  const exists = Array.from(dom.deckSelect.options).some(o => o.value === prev);
  dom.deckSelect.value = exists ? prev : "all";
}

export function filterCards(customSelected = null) {
  const selected = customSelected || (dom.deckSelect ? (dom.deckSelect.value || "all") : "all");
  return state.allCards.filter(card => {
    if (card.deleted) return false;
    if (selected === "all") return true;
    if (selected.startsWith("folder:")) {
      return getCardFolder(card).toLowerCase() === selected.substring(7).toLowerCase();
    }
    if (selected.startsWith("deck:")) {
      return getCardFullHierarchy(card).toLowerCase() === selected.substring(5).toLowerCase();
    }
    const s = selected.toLowerCase();
    return getCardFullHierarchy(card).toLowerCase() === s ||
           getCardFolder(card).toLowerCase() === s ||
           getCardDeck(card).toLowerCase() === s;
  });
}

export function calculateStats() {
  const now = Date.now();
  const filtered = filterCards();
  state.dueCards = filtered.filter(c => (c.sm2_stats?.next_review || 0) <= now);
  state.newCards = filtered.filter(c => !c.sm2_stats || c.sm2_stats.repetitions === 0);
}

export function updateUIStats() {
  const now = Date.now();
  const filteredTotal = filterCards().length;
  const due = state.dueCards.length;
  const newCount = state.newCards.length;

  if (dom.statDueCount) dom.statDueCount.textContent = due;
  if (dom.statNewCount) dom.statNewCount.textContent = newCount;
  if (dom.statTotalCount) dom.statTotalCount.textContent = filteredTotal;

  const overallDue = state.allCards.filter(c => !c.deleted && (c.sm2_stats?.next_review || 0) <= now).length;
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
      dom.dashboardEmptyState.querySelector("h3").textContent = "No Cards Yet";
      dom.dashboardEmptyState.querySelector("p").textContent = "Add cards in the Import tab to get started.";
    } else {
      dom.dashboardEmptyState.classList.add("hidden");
    }
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
    const isDue = (card.sm2_stats?.next_review || 0) <= now;
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
    dom.foldersTreeContainer.innerHTML = "<p class='help-text'>No collections created yet.</p>";
    return;
  }

  Array.from(folderMap.keys()).sort().forEach(folder => {
    const dm = folderMap.get(folder);
    let totalCards = 0, totalDue = 0;
    dm.forEach(s => { totalCards += s.total; totalDue += s.due; });

    const node = document.createElement("div"); node.className = "folder-node";
    const header = document.createElement("div"); header.className = "folder-header-row";
    const titleWrap = document.createElement("div"); titleWrap.className = "folder-title-wrap";
    titleWrap.innerHTML = `<svg class="folder-icon-svg" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span>${escapeHTML(folder)}</span><span class="folder-count-badge">${totalCards} cards${totalDue > 0 ? ` • ${totalDue} due` : ""}</span>`;
    const actWrap = document.createElement("div"); actWrap.className = "folder-actions-wrap";
    
    const btnStudy = document.createElement("button");
    btnStudy.className = "btn-folder-action";
    btnStudy.textContent = totalDue > 0 ? `Study (${totalDue})` : "Review All";
    btnStudy.addEventListener("click", async e => {
      e.stopPropagation();
      dom.deckSelect.value = `folder:${folder}`;
      calculateStats();
      updateUIStats();
      switchView("view-review");
      const { startStudySession } = await import("./study.js");
      startStudySession(totalDue === 0);
    });

    actWrap.appendChild(btnStudy);
    header.appendChild(titleWrap); header.appendChild(actWrap); node.appendChild(header);

    const dl = document.createElement("div"); dl.className = "folder-decks-list";
    Array.from(dm.keys()).sort().forEach(deck => {
      const s = dm.get(deck);
      const row = document.createElement("div"); row.className = "deck-tree-item";
      
      const leftWrap = document.createElement("div");
      leftWrap.className = "deck-tree-left";
      
      const name = document.createElement("span");
      name.className = "deck-tree-name";
      name.innerHTML = `↳ ${escapeHTML(deck)}`;
      name.addEventListener("click", () => {
        dom.deckSelect.value = `deck:${folder} / ${deck}`;
        calculateStats(); updateUIStats(); switchView("view-review");
      });

      const count = document.createElement("span");
      count.className = "deck-count-pill";
      count.textContent = `${s.total} cards${s.due > 0 ? ` (${s.due} due)` : ""}`;

      leftWrap.appendChild(name);
      leftWrap.appendChild(count);

      const btnDeckReview = document.createElement("button");
      btnDeckReview.className = "btn-deck-action";
      btnDeckReview.innerHTML = s.due > 0 ? `Study (${s.due})` : "Review";
      btnDeckReview.title = `Review cards in ${deck}`;
      btnDeckReview.addEventListener("click", async (e) => {
        e.stopPropagation();
        dom.deckSelect.value = `deck:${folder} / ${deck}`;
        calculateStats();
        updateUIStats();
        switchView("view-review");
        const { startStudySession } = await import("./study.js");
        startStudySession(s.due === 0);
      });

      row.appendChild(leftWrap);
      row.appendChild(btnDeckReview);
      dl.appendChild(row);
    });
    node.appendChild(dl);
    dom.foldersTreeContainer.appendChild(node);
  });

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
      name.addEventListener("click", () => {
        dom.deckSelect.value = `deck:${deck}`;
        calculateStats(); updateUIStats(); switchView("view-review");
      });

      const count = document.createElement("span");
      count.className = "deck-count-pill";
      count.textContent = `${s.total} cards${s.due > 0 ? ` (${s.due} due)` : ""}`;

      leftWrap.appendChild(name);
      leftWrap.appendChild(count);

      const btnDeckReview = document.createElement("button");
      btnDeckReview.className = "btn-deck-action";
      btnDeckReview.innerHTML = s.due > 0 ? `Study (${s.due})` : "Review";
      btnDeckReview.title = `Review cards in ${deck}`;
      btnDeckReview.addEventListener("click", async (e) => {
        e.stopPropagation();
        dom.deckSelect.value = `deck:${deck}`;
        calculateStats();
        updateUIStats();
        switchView("view-review");
        const { startStudySession } = await import("./study.js");
        startStudySession(s.due === 0);
      });

      row.appendChild(leftWrap);
      row.appendChild(btnDeckReview);
      dl.appendChild(row);
    });
    node.appendChild(dl);
    dom.foldersTreeContainer.appendChild(node);
  }
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
