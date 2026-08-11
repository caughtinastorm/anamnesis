/**
 * Cards Coordination Module
 *
 * Owns loadCardsFromDB() and a lightweight subscriber pattern that
 * notifies all UI modules after the card dataset changes.
 *
 * This breaks the circular dependency that previously existed because
 * dashboard.js called browser.js refresh functions, browser.js called
 * dashboard.js's loadCardsFromDB, and import.js / explorer.js did the same.
 *
 * After this refactor the dependency DAG is:
 *   cards.js → state.js, db.js, ui.js   (no app-level imports)
 *   dashboard.js → cards.js             (not browser/explorer/import)
 *   browser.js   → cards.js             (not dashboard)
 *   import.js    → cards.js             (not dashboard)
 *   explorer.js  → cards.js             (not dashboard for loadCards)
 *   app.js       → cards.js             (registers all subscribers)
 */

import { state } from "./state.js";
import * as db from "../db.js";
import { showToast } from "./ui.js";

/** @type {Array<Function>} */
const refreshSubscribers = [];

/**
 * Register a callback to run every time cards are reloaded from IndexedDB.
 * Subscribers are called in registration order. Async subscribers are awaited.
 * @param {Function} fn
 */
export function onCardsRefreshed(fn) {
  refreshSubscribers.push(fn);
}

/**
 * Load all cards from IndexedDB into state.allCards, then call every
 * registered refresh subscriber in order.
 */
export async function loadCardsFromDB() {
  try {
    state.allCards = await db.getCards();
    for (const fn of refreshSubscribers) {
      try {
        await fn();
      } catch (subscriberErr) {
        console.error("Card refresh subscriber error:", subscriberErr);
      }
    }
  } catch (e) {
    console.error("Error loading cards from DB:", e);
    showToast("Failed to load local database", "error");
  }
}
