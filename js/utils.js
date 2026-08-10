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
