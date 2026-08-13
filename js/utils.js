export function getCardFolder(card) {
  if (card.folder && card.folder.trim()) return card.folder.trim();
  const raw = card.deck || "Default";
  if (raw.includes(" / ")) return raw.split(" / ")[0].trim();
  if (raw.includes("::")) return raw.split("::")[0].trim();
  return "";
}

export function getCardDeck(card) {
  if (card.folder && card.folder.trim()) return (card.deck || "Default").trim();
  const raw = card.deck || "Default";
  if (raw.includes(" / ")) {
    const parts = raw.split(" / ");
    return parts.slice(1).join(" / ").trim() || "Default";
  }
  if (raw.includes("::")) {
    const parts = raw.split("::");
    return parts.slice(1).join(" / ").trim() || "Default";
  }
  return raw.trim() || "Default";
}

export function getCardFullHierarchy(card) {
  const folder = getCardFolder(card);
  const deck = getCardDeck(card);
  return folder ? `${folder} / ${deck}` : deck;
}

/**
 * Checks if a card matches the given deck selection filter.
 * @param {Object} card
 * @param {string} selection e.g. "all", "folder:Spanish", "deck:Spanish / Verbs", "deck:Verbs"
 * @returns {boolean}
 */
export function matchesDeckSelection(card, selection = "all") {
  if (!card || card.deleted) return false;
  if (!selection || selection === "all") return true;

  const sel = String(selection).trim();
  const cardFolder = getCardFolder(card).toLowerCase();
  const cardDeck = getCardDeck(card).toLowerCase();
  const cardHierarchy = getCardFullHierarchy(card).toLowerCase();

  if (sel.startsWith("folder:")) {
    const targetFolder = sel.substring(7).trim().toLowerCase();
    return cardFolder === targetFolder;
  }

  if (sel.startsWith("deck:")) {
    const targetDeck = sel.substring(5).trim().toLowerCase();
    return cardHierarchy === targetDeck ||
           (!cardFolder && cardDeck === targetDeck) ||
           cardHierarchy.endsWith(` / ${targetDeck}`);
  }

  const s = sel.toLowerCase();
  return cardHierarchy === s || cardFolder === s || cardDeck === s;
}

/**
 * Format a human-readable display label for a deck selection.
 * @param {string} selection
 * @returns {string}
 */
export function formatDeckSelectionLabel(selection = "all") {
  if (!selection || selection === "all") return "📁 All Collections";
  if (selection.startsWith("folder:")) return `📁 ${selection.substring(7)} (All)`;
  if (selection.startsWith("deck:")) return `🗂️ ${selection.substring(5)}`;
  return selection;
}


export function escapeHTML(str) {
  return String(str || "").replace(/[&<>"'"]/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

export function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function generateUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function sanitizeHTML(str) {
  if (str === null || str === undefined) return "";
  const temp = document.createElement("div");
  temp.textContent = String(str);
  let html = temp.innerHTML;
  const allowed = ["b", "strong", "i", "em", "code", "br"];
  allowed.forEach(tag => {
    if (tag === "br") {
      html = html.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
    } else {
      html = html.replace(new RegExp(`&lt;${tag}&gt;`, "gi"), `<${tag}>`);
      html = html.replace(new RegExp(`&lt;\\/${tag}&gt;`, "gi"), `</${tag}>`);
    }
  });
  return html;
}

export function escapeCSVField(field) {
  return `"${String(field || "").replace(/"/g, '""')}"`;
}
