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
    try {
      await db.purgeOldDeletedCards(30);
    } catch (purgeErr) {}

    let cards = await db.getCards();
    const modifiedCards = [];
    const now = Date.now();

    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      let changed = false;

      // 1. Purge legacy SuperMemo cache / sm2_stats
      if (c.sm2_stats !== undefined) {
        if (!c.fsrs_stats || c.fsrs_stats.stability === undefined) {
          const ivl = c.sm2_stats.interval || 0;
          const reps = c.sm2_stats.repetitions || 0;
          c.fsrs_stats = {
            stability: ivl > 0 ? ivl : 0,
            difficulty: 5.0,
            repetitions: reps,
            lapses: 0,
            state: reps === 0 ? 0 : 2,
            last_review: c.sm2_stats.last_reviewed || 0,
            next_review: c.sm2_stats.next_review || 0,
            interval: ivl
          };
        }
        delete c.sm2_stats;
        changed = true;
      }

      // 2. Repair corrupted "Social" collection cards where deck is "I." and sub holds the actual collection name
      if (
        (c.folder || "").trim().toLowerCase() === "social" &&
        (c.deck || "").trim() === "I." &&
        c.sub && c.sub.trim()
      ) {
        c.deck = c.sub.trim();
        c.sub = "";
        changed = true;
      }

      if (changed) {
        c.last_modified = now;
        modifiedCards.push(c);
      }
    }

    if (modifiedCards.length > 0) {
      try {
        await db.saveCards(modifiedCards);
        console.log(`Auto-cleaned and repaired ${modifiedCards.length} cards (removed legacy SM2 stats & fixed deck hierarchy)`);
      } catch (saveErr) {
        console.error("Failed to persist card repairs:", saveErr);
      }
    }

    state.allCards = cards;
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
