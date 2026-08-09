/**
 * Promise-based IndexedDB Wrapper
 * 
 * Manages local storage of card objects.
 */

const DB_NAME = 'FlashcardAppDB';
const DB_VERSION = 1;
const STORE_NAME = 'cards';

/**
 * Open/Initialize the IndexedDB database
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB open error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
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
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

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
 * Delete a single card by its ID
 * @param {string} cardId Card UUID
 * @returns {Promise<void>}
 */
export async function deleteCard(cardId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
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
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
