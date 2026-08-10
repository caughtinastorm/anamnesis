import { state } from "./state.js";
import { dom, showToast, scrollToElement } from "./ui.js";
import { generateUUID } from "./utils.js";
import { parseAnkiApkg, parseAnkiText, normalizeAnkiDeck } from "../anki.js";
import * as db from "../db.js";
import { loadCardsFromDB } from "./dashboard.js";
import { switchView } from "./ui.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

export function initImportEventListeners() {
  if (dom.importFile) dom.importFile.addEventListener("change", handleFileSelect);
  if (dom.btnParseCsv) dom.btnParseCsv.addEventListener("click", handleCSVParseClick);
  if (dom.btnCancelImport) dom.btnCancelImport.addEventListener("click", clearImportPreview);
  if (dom.btnConfirmImport) dom.btnConfirmImport.addEventListener("click", commitImportedCards);
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) { dom.importFileName.textContent = "No file chosen"; return; }
  dom.importFileName.textContent = file.name;
  if (file.name.toLowerCase().endsWith(".apkg")) {
    showToast("Reading Anki package...", "info");
    try {
      const buf = await file.arrayBuffer();
      state.tempParsedCards = await parseAnkiApkg(buf);
      if (!state.tempParsedCards.length) { showToast("No cards found in Anki package", "error"); return; }
      renderImportPreview(state.tempParsedCards);
      showToast(`Parsed ${state.tempParsedCards.length} cards from Anki deck!`, "success");
    } catch (err) {
      console.error(err);
      showToast(`Anki parse error: ${err.message}`, "error");
    }
  } else {
    const reader = new FileReader();
    reader.onload = evt => { dom.importText.value = evt.target.result; showToast("File loaded. Click Preview Import.", "info"); };
    reader.onerror = () => showToast("Failed to read file", "error");
    reader.readAsText(file);
  }
}

function handleCSVParseClick() {
  const text = dom.importText?.value.trim();
  if (!text) { showToast("Please paste text/CSV or select a file.", "error"); return; }
  try {
    state.tempParsedCards = (text.startsWith("#") || text.includes("\t")) ? parseAnkiText(text) : parseCSV(text);
    if (!state.tempParsedCards.length) { showToast("No valid rows found", "error"); return; }
    renderImportPreview(state.tempParsedCards);
  } catch (err) { console.error(err); showToast("Error parsing content", "error"); }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const cards = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (i === 0 && (lower.startsWith("folder,") || lower.startsWith("front,"))) continue;
    const fields = splitCSVLine(line).map(cleanCSVField);
    if (fields.length < 2) continue;
    let folder, deck = "Default", front, back, sub = "", description = "";
    if (fields.length >= 5) {
      folder = fields[0] || undefined; deck = fields[1] || "Default";
      front = fields[2] || ""; back = fields[3] || "";
      sub = fields[4] || ""; description = fields[5] || "";
    } else {
      front = fields[0] || ""; back = fields[1] || "";
      sub = fields[2] || "";
      const norm = normalizeAnkiDeck(fields[3] || "Default");
      folder = norm.folder; deck = norm.deck;
      description = fields[4] || "";
    }
    if (front.includes("|")) {
      const parts = front.split("|");
      front = parts[0].trim();
      if (!sub) sub = parts[1].trim();
    }
    if (!front && !back) continue;
    cards.push({ folder: folder || undefined, deck: deck || "Default", front, back, sub, description });
  }
  return cards;
}

function splitCSVLine(line) {
  const res = []; let cur = ""; let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) { res.push(cur); cur = ""; }
    else cur += ch;
  }
  res.push(cur);
  return res;
}

function cleanCSVField(f) {
  let c = f.trim();
  if (c.startsWith('"') && c.endsWith('"')) c = c.slice(1, -1);
  return c.replace(/""/g, '"');
}

function renderImportPreview(cards) {
  dom.previewTableBody.innerHTML = "";
  dom.previewCount.textContent = cards.length;
  cards.forEach(card => {
    const row = document.createElement("tr");
    [card.folder||"-", card.deck||"Default", card.front, card.back, card.sub||"-", card.description||"-"].forEach(text => {
      const td = document.createElement("td"); td.textContent = text; row.appendChild(td);
    });
    dom.previewTableBody.appendChild(row);
  });
  dom.importPreviewSection.classList.remove("hidden");
  scrollToElement(dom.importPreviewSection);
}

function clearImportPreview() {
  state.tempParsedCards = [];
  dom.previewTableBody.innerHTML = "";
  dom.importPreviewSection.classList.add("hidden");
  dom.importText.value = "";
  dom.importFile.value = "";
  dom.importFileName.textContent = "No file chosen";
}

async function commitImportedCards() {
  if (!state.tempParsedCards.length) return;
  const now = Date.now();
  const prepared = state.tempParsedCards.map(c => ({
    id: generateUUID(),
    front: c.front, sub: c.sub || undefined, back: c.back,
    description: c.description || undefined,
    folder: c.folder || undefined, deck: c.deck || "Default",
    sm2_stats: { ease_factor: 2.5, interval: 0, repetitions: 0, next_review: 0 },
    last_modified: now
  }));
  try {
    await db.saveCards(prepared);
    showToast(`Successfully imported ${prepared.length} cards!`, "success");
    clearImportPreview();
    await loadCardsFromDB();
    switchView("view-review");
    onSyncRequest();
  } catch (e) {
    console.error(e);
    showToast("Failed to write cards to local database", "error");
  }
}
