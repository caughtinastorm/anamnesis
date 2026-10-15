/**
 * Promise-based IndexedDB repositories (v3 schema)
 * 
 * Manages local storage of card objects, historical review logs, and database backups
 * with secondary indexes, singleton connection pooling, and atomic batch transactions.
 */

import { validateCards, canonicalJSON } from './js/domain/data.js';
import { migrateLegacyCard } from './js/domain/migrations.js';

const DB_NAME = 'FlashcardAppDB';
const DB_VERSION = 3;
const STORE_CARDS = 'cards';
const STORE_REVIEW_LOGS = 'review_logs';
const STORE_BACKUPS = 'backups';

const STORE_METADATA = 'metadata';
let dbInstance = null;
let openingDB = null;
const changesChannel = typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function'
  ? new window.BroadcastChannel('anamnesis-database-changes') : null;
export function onDatabaseChanged(callback) {
  if (!changesChannel) return () => {};
  changesChannel.addEventListener('message', callback);
  return () => changesChannel.removeEventListener('message', callback);
}

/**
 * Open/Initialize the IndexedDB database (Singleton connection with v3 schema)
 */
export function openDB() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  if (openingDB) return openingDB;
  openingDB = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;

    request.onerror = () => {
      console.error('IndexedDB open error:', request.error);
      openingDB = null;
      reject(request.error);
    };
    request.onblocked = () => {
      blocked = true;
      openingDB = null;
      reject(new Error('Database upgrade blocked. Close other tabs and retry.'));
    };

    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      openingDB = null;
      dbInstance = request.result;
      dbInstance.onversionchange = () => { dbInstance.close(); dbInstance = null; };
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_METADATA)) db.createObjectStore(STORE_METADATA, { keyPath: 'id' });

      // 1. Cards Object Store
      let cardStore;
      if (!db.objectStoreNames.contains(STORE_CARDS)) {
        cardStore = db.createObjectStore(STORE_CARDS, { keyPath: 'id' });
      } else {
        cardStore = request.transaction.objectStore(STORE_CARDS);
      }

      // Secondary Indexes on Cards
      if (!cardStore.indexNames.contains('folder')) {
        cardStore.createIndex('folder', 'folder', { unique: false });
      }
      if (!cardStore.indexNames.contains('deck')) {
        cardStore.createIndex('deck', 'deck', { unique: false });
      }
      if (!cardStore.indexNames.contains('deleted')) {
        cardStore.createIndex('deleted', 'deleted', { unique: false });
      }
      if (!cardStore.indexNames.contains('next_review')) {
        cardStore.createIndex('next_review', 'fsrs_stats.next_review', { unique: false });
      }

      // 2. Historical Review Logs Store
      if (!db.objectStoreNames.contains(STORE_REVIEW_LOGS)) {
        const logStore = db.createObjectStore(STORE_REVIEW_LOGS, { keyPath: 'id' });
        logStore.createIndex('card_id', 'card_id', { unique: false });
        logStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // 3. Rolling Database Backups Store
      if (!db.objectStoreNames.contains(STORE_BACKUPS)) {
        const backupStore = db.createObjectStore(STORE_BACKUPS, { keyPath: 'id' });
        backupStore.createIndex('created_at', 'created_at', { unique: false });
      }
    };
  });
  return openingDB;
}

/**
 * Retrieve all cards from the database
 * @returns {Promise<Array>} List of card objects
 */
export async function getCards() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_CARDS, 'readonly');
    const store = transaction.objectStore(STORE_CARDS);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save multiple cards to the database (upsert)
 * @param {Array} cards Array of card objects
 * @returns {Promise<void>}
 */
export async function saveCards(cards) {
  validateCards(cards);
  if (!cards.length) return;
  return writeTransaction([STORE_CARDS], (tx, done) => {
    const store = tx.objectStore(STORE_CARDS);
    const saved = [];
    for (const card of cards) {
      const request = store.get(card.id);
      request.onsuccess = () => {
        const next = structuredClone(card);
        if (request.result && canonicalJSON(request.result) !== canonicalJSON(next)) {
          next.last_modified = Math.max(Date.now(), Number(request.result.last_modified || 0) + 1, Number(next.last_modified || 0));
          next.updated_at = next.last_modified;
        }
        store.put(next);
        saved.push(next);
        done(saved);
      };
    }
  });
}

/**
 * Save a single card to the database (upsert)
 * @param {Object} card Card object
 * @returns {Promise<void>}
 */
export async function saveCard(card) {
  return saveCards([card]);
}

/**
 * Atomically replace all cards in the database in a single transaction.
 * @param {Array} cards Array of card objects
 * @returns {Promise<void>}
 */
export async function replaceCards(cards) {
  validateCards(cards);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_CARDS, 'readwrite');
    const store = transaction.objectStore(STORE_CARDS);

    store.clear();
    if (cards && cards.length > 0) {
      cards.forEach(card => {
        store.put(card);
      });
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Database transaction aborted.'));
  });
}

/**
 * Delete a single card by its ID (hard delete)
 * @param {string} cardId Card UUID
 * @returns {Promise<void>}
 */
export async function deleteCard(cardId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_CARDS, 'readwrite');
    const store = transaction.objectStore(STORE_CARDS);
    const request = store.delete(cardId);

    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Database transaction aborted."));
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all cards from the database
 * @returns {Promise<void>}
 */
export async function clearDatabase() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_CARDS, STORE_REVIEW_LOGS, STORE_BACKUPS, STORE_METADATA], 'readwrite');
    transaction.objectStore(STORE_CARDS).clear();
    transaction.objectStore(STORE_REVIEW_LOGS).clear();
    transaction.objectStore(STORE_BACKUPS).clear();
    transaction.objectStore(STORE_METADATA).delete('review-history-baseline-v1');

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Database transaction aborted.'));
  });
}

// ==========================================================================
// Historical Review Logs API
// ==========================================================================

/**
 * Persist a single review event log
 * @param {Object} logEntry Review log details
 */
export async function saveReviewLog(logEntry) {
  if (!logEntry || !logEntry.id) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_REVIEW_LOGS, 'readwrite');
    const store = transaction.objectStore(STORE_REVIEW_LOGS);
    store.put(logEntry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Database transaction aborted.'));
  });
}

/**
 * Retrieve review logs, optionally filtered by cardId
 * @param {string|null} cardId Filter by card UUID
 * @param {number} limit Max records to retrieve (default 200)
 */
export async function getReviewLogs(cardId = null, limit = 200) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_REVIEW_LOGS, 'readonly');
    const store = transaction.objectStore(STORE_REVIEW_LOGS);
    let request;

    if (cardId) {
      const index = store.index('card_id');
      request = index.getAll(cardId);
    } else {
      request = store.getAll();
    }

    request.onsuccess = () => {
      const results = request.result || [];
      // Sort newest first
      results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      if (limit !== null && limit !== undefined && limit > 0) {
        resolve(results.slice(0, limit));
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve all review logs without limit
 * @returns {Promise<Array>} List of all historical review logs
 */
export async function getAllReviewLogs() {
  return getReviewLogs(null, null);
}

/**
 * Delete a specific review log by ID (used for undo)
 * @param {string} logId
 */
export async function deleteReviewLog(logId) {
  if (!logId) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_REVIEW_LOGS, 'readwrite');
    const store = transaction.objectStore(STORE_REVIEW_LOGS);
    const request = store.delete(logId);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Database transaction aborted."));
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete all review logs associated with a list of card IDs.
 * @param {Array<string>} cardIds
 */
export async function deleteReviewLogsForCards(cardIds) {
  if (!cardIds || cardIds.length === 0) return;
  const db = await openDB();
  const idSet = new Set(cardIds);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_REVIEW_LOGS, 'readwrite');
    const store = transaction.objectStore(STORE_REVIEW_LOGS);
    const request = store.openCursor();

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (idSet.has(cursor.value.card_id)) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Database transaction aborted."));
    request.onerror = () => reject(request.error);
  });
}

// ==========================================================================
// Local Automated Backups API
// ==========================================================================

/**
 * Create a snapshot backup of the current database
 * @param {string} label User or system tag (e.g., "Pre-Sync", "Manual Snapshot", "Pre-Import")
 * @param {Array} cards List of card objects to snapshot
 */
export async function createLocalBackup(label = 'Manual Snapshot') {
  const backup = { id: crypto.randomUUID(), label, created_at: Date.now(), schemaVersion: 1 };
  const saved = await writeTransaction([STORE_BACKUPS, STORE_CARDS, STORE_REVIEW_LOGS, STORE_METADATA], (tx, done) => {
    const previous = tx.objectStore(STORE_BACKUPS).getAll();
    const cards = tx.objectStore(STORE_CARDS).getAll();
    const logs = tx.objectStore(STORE_REVIEW_LOGS).getAll();
    const history = tx.objectStore(STORE_METADATA).get('review-history-baseline-v1');
    history.onsuccess = () => {
      backup.created_at = Math.max(Date.now(), ...previous.result.map(item => item.created_at + 1));
      backup.cards = cards.result;
      backup.review_logs = logs.result;
      backup.history_baseline = history.result?.counts || {};
      backup.card_count = cards.result.length;
      tx.objectStore(STORE_BACKUPS).put(backup);
      done(backup);
    };
  });
  await pruneOldBackups(10);
  return saved;
}

/**
 * Get all available local database backups
 */
export async function getLocalBackups() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_BACKUPS, 'readonly');
    const store = transaction.objectStore(STORE_BACKUPS);
    const request = store.getAll();

    request.onsuccess = () => {
      const list = request.result || [];
      list.sort((a, b) => b.created_at - a.created_at);
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Restore a local backup by ID into the active cards store
 * @param {string} backupId
 */
export async function restoreLocalBackup(backupId) {
  const db = await openDB();
  const backup = await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_BACKUPS, 'readonly');
    const store = transaction.objectStore(STORE_BACKUPS);
    const request = store.get(backupId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (!backup || !backup.cards) {
    throw new Error('Backup not found or corrupted.');
  }

  return restoreBackupData(backup);
}

/**
 * Delete a local backup by ID
 * @param {string} backupId
 */
export async function deleteLocalBackup(backupId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_BACKUPS, 'readwrite');
    const store = transaction.objectStore(STORE_BACKUPS);
    const request = store.delete(backupId);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Database transaction aborted."));
    request.onerror = () => reject(request.error);
  });
}

/**
 * Internal helper to keep backup store tidy
 */
async function pruneOldBackups(keepLimit = 10) {
  const all = await getLocalBackups();
  if (all.length <= keepLimit) return;
  return writeTransaction([STORE_BACKUPS], tx => {
    const store = tx.objectStore(STORE_BACKUPS);
    for (const backup of all.slice(keepLimit)) store.delete(backup.id);
  });
}

/**
 * Permanently purges cards that have been soft-deleted for more than maxAgeDays.
 * Prevents tombstone accumulation from indefinitely bloating local and cloud storage.
 * @param {number} maxAgeDays Default 30 days
 * @returns {Promise<number>} Number of deleted cards purged
 */
export async function purgeOldDeletedCards(maxAgeDays = 30) {
  const db = await openDB();
  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_CARDS, 'readwrite');
    const store = transaction.objectStore(STORE_CARDS);
    const request = store.getAll();

    request.onsuccess = () => {
      const allCards = request.result || [];
      let purgedCount = 0;
      allCards.forEach(c => {
        if (c.deleted && (c.last_modified || 0) < cutoff) {
          store.delete(c.id);
          purgedCount++;
        }
      });
      transaction.oncomplete = () => resolve(purgedCount);
    };
    request.onerror = () => reject(request.error);
  });
}



/** Schedule all requests synchronously; resolve only after the transaction commits. */
async function writeTransaction(stores, enqueue) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    let result;
    let failure;
    const fail = error => { failure = error; tx.abort(); };
    tx.oncomplete = () => {
      if (stores.includes(STORE_CARDS)) changesChannel?.postMessage({ type: "cards-changed" });
      resolve(result);
    };
    tx.onabort = () => reject(failure || tx.error || new Error('Database transaction aborted.'));
    tx.onerror = () => { failure ||= tx.error; };
    try { enqueue(tx, value => { result = value; }, fail); }
    catch (error) { fail(error); }
  });
}

export async function commitReview(before, updated, log) {
  validateCards([before]);
  if (updated) validateCards([updated]);
  if (!log?.id || log.card_id !== before.id) throw new Error('Invalid review log.');
  return writeTransaction([STORE_CARDS, STORE_REVIEW_LOGS], (tx, done, fail) => {
    const cards = tx.objectStore(STORE_CARDS);
    const request = cards.get(before.id);
    request.onsuccess = () => {
      if (!request.result || canonicalJSON(request.result) !== canonicalJSON(before)) {
        fail(new Error('This card changed in another tab or during sync. Reload the session and retry.'));
        return;
      }
      if (updated) cards.put(updated);
      tx.objectStore(STORE_REVIEW_LOGS).add(log);
      done(updated || before);
    };
  });
}

export async function revertReview(expected, restored, logId) {
  if (restored) validateCards([restored]);
  return writeTransaction([STORE_CARDS, STORE_REVIEW_LOGS], (tx, done, fail) => {
    const cards = tx.objectStore(STORE_CARDS);
    const request = cards.get(expected.id);
    request.onsuccess = () => {
      if (restored && canonicalJSON(request.result) !== canonicalJSON(expected)) {
        fail(new Error('This card changed after the review. Undo would overwrite newer changes.'));
        return;
      }
      if (restored) cards.put(restored);
      tx.objectStore(STORE_REVIEW_LOGS).delete(logId);
      done(restored);
    };
  });
}

/** Preserve every edit made after the sync snapshot, regardless of clock skew. */
export async function applySyncCards(snapshot, merged) {
  validateCards(merged);
  const baseline = new Map(snapshot.map(card => [card.id, canonicalJSON(card)]));
  return writeTransaction([STORE_CARDS], (tx, done) => {
    const store = tx.objectStore(STORE_CARDS);
    const request = store.getAll();
    request.onsuccess = () => {
      const current = new Map(request.result.map(card => [card.id, card]));
      for (const card of merged) {
        const local = current.get(card.id);
        if (local && canonicalJSON(local) !== baseline.get(card.id)) continue;
        // A record hard-deleted while syncing must not be recreated from the old snapshot.
        if (!local && baseline.has(card.id)) continue;
        store.put(card);
        current.set(card.id, card);
      }
      done([...current.values()]);
    };
  });
}

export async function runMigrations() {
  return writeTransaction([STORE_CARDS, STORE_METADATA], tx => {
    const metadata = tx.objectStore(STORE_METADATA);
    const marker = metadata.get('legacy-card-normalization-v1');
    marker.onsuccess = () => {
      if (marker.result) return;
      const store = tx.objectStore(STORE_CARDS);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          metadata.put({ id: 'legacy-card-normalization-v1', completed_at: Date.now() });
          return;
        }
        const migrated = migrateLegacyCard(cursor.value);
        if (canonicalJSON(migrated) !== canonicalJSON(cursor.value)) {
          migrated.last_modified = Math.max(Date.now(), Number(cursor.value.last_modified || 0) + 1);
          migrated.updated_at = migrated.last_modified;
          cursor.update(migrated);
        }
        cursor.continue();
      };
    };
  });
}

export async function getReviewHistory(legacyHistory = {}) {
  const localDay = timestamp => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  return writeTransaction([STORE_REVIEW_LOGS, STORE_METADATA], (tx, done) => {
    const metadata = tx.objectStore(STORE_METADATA);
    const marker = metadata.get('review-history-baseline-v1');
    marker.onsuccess = () => {
      const request = tx.objectStore(STORE_REVIEW_LOGS).getAll();
      request.onsuccess = () => {
        const counts = {};
        for (const log of request.result) {
          if (log.mode === 'practice_buffer') continue;
          const day = localDay(log.timestamp);
          counts[day] = (counts[day] || 0) + 1;
        }
        let baseline = marker.result?.counts;
        if (!baseline) {
          baseline = {};
          for (const [day, count] of Object.entries(legacyHistory || {})) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(count)) baseline[day] = Math.max(0, count - (counts[day] || 0));
          }
          metadata.put({ id: 'review-history-baseline-v1', counts: baseline });
        }
        const history = { ...baseline };
        for (const [day, count] of Object.entries(counts)) history[day] = (history[day] || 0) + count;
        done(history);
      };
    };
  });
}

export async function resetCardProgress(updatedCards) {
  validateCards(updatedCards);
  const ids = new Set(updatedCards.map(card => card.id));
  return writeTransaction([STORE_CARDS, STORE_REVIEW_LOGS], tx => {
    const store = tx.objectStore(STORE_CARDS);
    for (const card of updatedCards) {
      const request = store.get(card.id);
      request.onsuccess = () => {
        if (!request.result || request.result.deleted) return;
        const next = { ...request.result, fsrs_stats: card.fsrs_stats,
          last_modified: Math.max(Date.now(), Number(request.result.last_modified || 0) + 1) };
        next.updated_at = next.last_modified;
        delete next.sm2_stats;
        store.put(next);
      };
    }
    const cursor = tx.objectStore(STORE_REVIEW_LOGS).openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      if (ids.has(cursor.result.value.card_id)) cursor.result.delete();
      cursor.result.continue();
    };
  });
}

export async function restoreBackupData(backup) {
  validateCards(backup?.cards);
  if (backup.schemaVersion !== undefined && backup.schemaVersion !== 1) throw new Error('Unsupported backup version.');
  if (backup.review_logs !== undefined && (!Array.isArray(backup.review_logs) ||
      backup.review_logs.some(log => !log || typeof log.id !== 'string' || typeof log.card_id !== 'string' || !Number.isFinite(log.timestamp)))) {
    throw new Error('Invalid backup review history.');
  }
  if (backup.history_baseline !== undefined && (!backup.history_baseline || typeof backup.history_baseline !== 'object' || Array.isArray(backup.history_baseline) ||
      Object.entries(backup.history_baseline).some(([day, count]) => !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(count) || count < 0))) throw new Error('Invalid backup history baseline.');
  if (backup.review_logs && new Set(backup.review_logs.map(log => log.id)).size !== backup.review_logs.length) throw new Error('Duplicate backup review logs.');
  await createLocalBackup('Before backup restore');
  return writeTransaction([STORE_CARDS, STORE_REVIEW_LOGS, STORE_METADATA], (tx, done) => {
    const store = tx.objectStore(STORE_CARDS);
    const request = store.getAll();
    request.onsuccess = () => {
      const existing = new Map(request.result.map(card => [card.id, card]));
      const restoredIds = new Set(backup.cards.map(card => card.id));
      for (const card of backup.cards) {
        const next = { ...card, last_modified: Math.max(Date.now(), Number(existing.get(card.id)?.last_modified || 0) + 1, Number(card.last_modified || 0) + 1) };
        next.updated_at = next.last_modified;
        store.put(next);
      }
      // Record removals as fresh tombstones so sync cannot resurrect them.
      for (const card of existing.values()) {
        if (!restoredIds.has(card.id)) store.put({ ...card, deleted: true,
          last_modified: Math.max(Date.now(), Number(card.last_modified || 0) + 1) });
      }
      if (backup.review_logs) {
        const logs = tx.objectStore(STORE_REVIEW_LOGS);
        logs.clear();
        for (const log of backup.review_logs) logs.put(log);
        tx.objectStore(STORE_METADATA).put({ id: 'review-history-baseline-v1', counts: backup.history_baseline || {} });
      }
      done(backup);
    };
  });
}

/** First-run seeding is serialized with its marker across tabs. */
export async function seedStarterOnce(cards) {
  validateCards(cards);
  return writeTransaction([STORE_CARDS, STORE_METADATA], (tx, done) => {
    const metadata = tx.objectStore(STORE_METADATA);
    const marker = metadata.get('starter-seeded-v1');
    marker.onsuccess = () => {
      if (marker.result) { done(0); return; }
      const store = tx.objectStore(STORE_CARDS);
      const existing = store.count();
      existing.onsuccess = () => {
        if (existing.result === 0) for (const card of cards) store.put(card);
        metadata.put({ id: 'starter-seeded-v1', completed_at: Date.now() });
        done(existing.result === 0 ? cards.length : 0);
      };
    };
  });
}
