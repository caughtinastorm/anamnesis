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
 * Limit text to a maximum character length, appending an ellipsis if truncated.
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
export function limitText(str, maxLength = 26) {
  if (!str) return "";
  const s = String(str).trim();
  if (!maxLength || s.length <= maxLength) return s;
  return s.slice(0, maxLength - 1).trim() + "…";
}

/**
 * Format a human-readable display label for a deck selection.
 * @param {string} selection
 * @param {number|null} [maxLength=null]
 * @returns {string}
 */
export function formatDeckSelectionLabel(selection = "all", maxLength = null) {
  if (!selection || selection === "all") return "📁 All Collections";
  let label = selection;
  if (selection.startsWith("folder:")) label = `📁 ${selection.substring(7)} (All)`;
  else if (selection.startsWith("deck:")) label = `🗂️ ${selection.substring(5)}`;
  if (maxLength && label.length > maxLength) {
    return limitText(label, maxLength);
  }
  return label;
}


export function escapeHTML(str) {
  return String(str || "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

/**
 * Format date in local calendar timezone as YYYY-MM-DD.
 * Prevents UTC timezone drift.
 */
export function getLocalDateString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

/**
 * Escapes unsafe HTML characters while preserving safe formatting tags (b, strong, i, em, code, br).
 * Environment-agnostic (works in browser and Node.js).
 */
export function sanitizeHTML(str) {
  if (str === null || str === undefined) return "";
  let html = escapeHTML(String(str));
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

/**
 * Strips HTML tags and collapses whitespace for clean plain-text previews.
 */
export function plainText(str) {
  if (!str) return "";
  return String(str)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeCSVField(field) {
  return `"${String(field || "").replace(/"/g, '""')}"`;
}
