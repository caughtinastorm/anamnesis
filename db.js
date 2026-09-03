/**
 * Promise-based IndexedDB Wrapper (v2 Schema)
 * 
 * Manages local storage of card objects, historical review logs, and database backups
 * with secondary indexes, singleton connection pooling, and atomic batch transactions.
 */

const DB_NAME = 'FlashcardAppDB';
const DB_VERSION = 2;
const STORE_CARDS = 'cards';
const STORE_REVIEW_LOGS = 'review_logs';
const STORE_BACKUPS = 'backups';

let dbInstance = null;

/**
 * Open/Initialize the IndexedDB database (Singleton connection with v2 schema)
 */
export function openDB() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB open error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;

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
  if (!cards || cards.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_CARDS, 'readwrite');
    const store = transaction.objectStore(STORE_CARDS);

    cards.forEach(card => {
      store.put(card);
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
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

    request.onsuccess = () => resolve();
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
    const transaction = db.transaction([STORE_CARDS, STORE_REVIEW_LOGS, STORE_BACKUPS], 'readwrite');
    transaction.objectStore(STORE_CARDS).clear();
    transaction.objectStore(STORE_REVIEW_LOGS).clear();
    transaction.objectStore(STORE_BACKUPS).clear();

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
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
      resolve(results.slice(0, limit));
    };
    request.onerror = () => reject(request.error);
  });
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
    request.onsuccess = () => resolve();
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
export async function createLocalBackup(label = 'Manual Snapshot', cards = []) {
  const db = await openDB();
  const backup = {
    id: 'backup_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    label,
    created_at: Date.now(),
    card_count: cards.length,
    cards: typeof structuredClone === "function" ? structuredClone(cards) : JSON.parse(JSON.stringify(cards))
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_BACKUPS, 'readwrite');
    const store = transaction.objectStore(STORE_BACKUPS);
    store.put(backup);

    transaction.oncomplete = async () => {
      // Auto-prune older backups: keep max 10 latest
      try {
        await pruneOldBackups(10);
      } catch (e) {}
      resolve(backup);
    };
    transaction.onerror = () => reject(transaction.error);
  });
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

  await replaceCards(backup.cards);
  return backup;
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
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Internal helper to keep backup store tidy
 */
async function pruneOldBackups(keepLimit = 10) {
  const db = await openDB();
  const all = await getLocalBackups();
  if (all.length > keepLimit) {
    const toDelete = all.slice(keepLimit);
    const transaction = db.transaction(STORE_BACKUPS, 'readwrite');
    const store = transaction.objectStore(STORE_BACKUPS);
    toDelete.forEach(b => store.delete(b.id));
  }
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


