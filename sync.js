import { canonicalJSON, cardsFingerprint, parseSyncPayload, validateCards } from './js/domain/data.js';

/**
 * High-Performance GitHub Gist Sync Manager ()
 * 
 * Features:
 * 1. HTTP 304 Not Modified & ETag conditional caching (conditional requests when unchanged).
 * 2. Smart Skip-Patch optimization: avoids redundant PATCH requests if remote is already up to date.
 * 3. Offline-First, Bidirectional Last-Write-Wins merge with Tombstones.
 * 4. Deterministic timestamp and content conflict resolution.
 * 5. Automatic Gist discovery and zero-setup initialization.
 */

const CREDENTIALS_KEY = 'flashcard_sync_credentials';
const LAST_SYNC_KEY = 'flashcard_last_sync_time';
const LAST_ETAG_KEY = 'flashcard_sync_etag';
const DEVICE_ID_KEY = 'anamnesis_sync_device_id';
const LAST_FINGERPRINT_KEY = 'flashcard_sync_fingerprint';
const LAST_FILENAME_KEY = 'flashcard_sync_filename';

export function sanitizeGistId(raw) {
  if (!raw) return '';
  let trimmed = String(raw).trim();
  trimmed = trimmed.split('#')[0].split('?')[0].replace(/\/+$/, '');
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/').filter(Boolean);
    trimmed = parts[parts.length - 1] || '';
  }
  const match = trimmed.match(/([a-f0-9]{20,32})/i);
  if (match) return match[1];
  return trimmed;
}

export function getSyncCredentials() {
  try {
    if (typeof localStorage === 'undefined') return { pat: '', gistId: '' };
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return { pat: '', gistId: '' };
    const parsed = JSON.parse(raw);
    return {
      pat: (parsed.pat || '').trim(),
      gistId: sanitizeGistId(parsed.gistId)
    };
  } catch (e) {
    return { pat: '', gistId: '' };
  }
}

export function saveSyncCredentials(pat, gistId) {
  if (typeof localStorage !== 'undefined') {
    const cleanPat = (pat || '').trim();
    const cleanGistId = sanitizeGistId(gistId);
    const previous = getSyncCredentials();
    if (previous.gistId !== cleanGistId || previous.pat !== cleanPat) clearSyncCredentials();
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ pat: cleanPat, gistId: cleanGistId }));
  }
}

export function clearSyncCredentials() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(CREDENTIALS_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
    localStorage.removeItem(LAST_ETAG_KEY);
    localStorage.removeItem(LAST_FILENAME_KEY);
    localStorage.removeItem(LAST_FINGERPRINT_KEY);
  }
}

export function getLastSyncTime() {
  if (typeof localStorage === 'undefined') return 0;
  const t = localStorage.getItem(LAST_SYNC_KEY);
  return t ? parseInt(t, 10) : 0;
}

export function saveLastSyncTime(timestamp) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LAST_SYNC_KEY, timestamp.toString());
  }
}

export function getLastSyncEtag() {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(LAST_ETAG_KEY) || '';
}

export function saveLastSyncEtag(etag) {
  if (typeof localStorage === 'undefined') return;
  if (etag) {
    localStorage.setItem(LAST_ETAG_KEY, etag);
  } else {
    localStorage.removeItem(LAST_ETAG_KEY);
  }
}

export function getLastSyncFilename() {
  if (typeof localStorage === 'undefined') return 'flashcards.json';
  return localStorage.getItem(LAST_FILENAME_KEY) || 'flashcards.json';
}

export function saveLastSyncFilename(filename) {
  if (typeof localStorage === 'undefined' || !filename) return;
  localStorage.setItem(LAST_FILENAME_KEY, filename);
}

/**
 * Fetch with automatic AbortController timeout to prevent hanging syncs
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Sync request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Common Headers for GitHub API request
 */
function getHeaders(pat, etag = '') {
  const cleanPat = (pat || '').trim();
  const tokenHeader = (cleanPat.startsWith('ghp_') || cleanPat.startsWith('github_pat_'))
    ? `Bearer ${cleanPat}`
    : (cleanPat.startsWith('Bearer ') || cleanPat.startsWith('token '))
      ? cleanPat
      : `token ${cleanPat}`;
  const headers = {
    'Authorization': tokenHeader,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
  if (etag) {
    headers['If-None-Match'] = etag;
  }
  return headers;
}

/**
 * Clean Headers for GitHub Raw Content / CDN downloads
 */
function getRawHeaders(pat) {
  const cleanPat = (pat || '').trim();
  const tokenHeader = (cleanPat.startsWith('ghp_') || cleanPat.startsWith('github_pat_'))
    ? `Bearer ${cleanPat}`
    : (cleanPat.startsWith('Bearer ') || cleanPat.startsWith('token '))
      ? cleanPat
      : `token ${cleanPat}`;
  return {
    'Authorization': tokenHeader,
    'Accept': 'application/json, text/plain, */*'
  };
}

/**
 * Test a Personal Access Token (PAT) by fetching user profile
 */
export async function testToken(pat) {
  const res = await fetchWithTimeout('https://api.github.com/user', {
    headers: getHeaders(pat)
  });
  if (!res.ok) {
    throw new Error(`GitHub Token validation failed: ${res.statusText}`);
  }
  return await res.json();
}

/**
 * Automatically searches the user's account for an existing flashcards Gist
 * @param {string} pat Personal Access Token
 * @returns {Promise<string|null>} The Gist ID if found, or null
 */
export async function findExistingFlashcardGist(pat) {
  try {
    const res = await fetchWithTimeout('https://api.github.com/gists?per_page=100', {
      headers: getHeaders(pat),
      cache: 'no-store'
    });
    
    if (!res.ok) {
      return null;
    }
    
    const gists = await res.json();
    if (!Array.isArray(gists)) return null;

    for (const g of gists) {
      if (g.files && (g.files['flashcards.json'] || g.files['cards.json'])) {
        return g.id;
      }
      if (g.description && g.description.toLowerCase().includes('flashcard')) {
        return g.id;
      }
    }
    return null;
  } catch (e) {
    console.warn('Error searching for existing gist:', e);
    return null;
  }
}

/**
 * Create a new private gist containing flashcards.json, or reuse existing if found
 */
export async function createFlashcardGist(pat) {
  const existingId = await findExistingFlashcardGist(pat);
  if (existingId) {
    return existingId;
  }

  const body = {
    description: 'Flashcard PWA HEADLESS JSON Data Store',
    public: false,
    files: {
      'flashcards.json': {
        content: '[]'
      }
    }
  };

  const res = await fetchWithTimeout('https://api.github.com/gists', {
    method: 'POST',
    headers: getHeaders(pat),
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Failed to create private gist: ${res.statusText}`);
  }

  const data = await res.json();
  return data.id;
}

/**
 * Fetch a specific gist with ETag caching support
 */
async function fetchGist(pat, gistId, etag = '') {
  const cleanGistId = sanitizeGistId(gistId);
  const res = await fetchWithTimeout(`https://api.github.com/gists/${cleanGistId}`, {
    headers: getHeaders(pat, etag),
    cache: 'no-store'
  });

  if (res.status === 304) {
    return { notModified: true };
  }

  if (res.status === 404) {
    throw new Error('Gist not found. Check your Gist ID.');
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch gist (${res.status}): ${res.statusText}`);
  }

  const data = await res.json();
  const newEtag = res.headers.get('ETag') || '';
  return { notModified: false, gist: data, etag: newEtag };
}

/**
 * Update the gist file with new content
 */
async function updateGist(pat, gistId, cards, targetFilename = 'flashcards.json', deviceFilename = '') {
  const cleanGistId = sanitizeGistId(gistId);
  const fileName = targetFilename || 'flashcards.json';
  const body = {
    files: {
      [fileName]: {
        content: JSON.stringify(cards, null, 2)
      }
    }
  };

  if (deviceFilename) body.files[deviceFilename] = { content: JSON.stringify({ schemaVersion: 1, cards }) };

  const res = await fetchWithTimeout(`https://api.github.com/gists/${cleanGistId}`, {
    method: 'PATCH',
    headers: getHeaders(pat),
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Failed to update Gist (${res.status}): ${res.statusText}`);
  }

  const data = await res.json();
  const newEtag = res.headers.get('ETag') || '';
  return { data, etag: newEtag };
}

/**
 * Extract timestamp from card for Last-Write-Wins comparison
 */
export function getCardTimestamp(card) {
  if (!card) return 0;
  const ts = Number(card.last_modified || card.updated_at || card.fsrs_stats?.last_review || card.created_at || 0);
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * Check if two cards lists have structural, content, or scheduling differences
 */
export function cardsDiffer(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return true;
  const byId = new Map(b.map(card => [card?.id, card]));
  if (byId.size !== b.length || byId.has(undefined)) return true;
  const seen = new Set();
  for (const card of a) {
    if (!card?.id || seen.has(card.id) || canonicalJSON(card) !== canonicalJSON(byId.get(card.id))) return true;
    seen.add(card.id);
  }
  return false;
}

/**
 * Merge local and remote cards array using Last-Write-Wins with tombstone support.
 * Retains soft-deleted cards during merge so deletions propagate across devices.
 */
export function mergeCards(localCards = [], remoteCards = []) {
  const cardMap = new Map();

  // Populate with remote cards first
  (remoteCards || []).forEach(card => {
    if (card && card.id) {

      cardMap.set(card.id, card);
    }
  });

  // Merge local cards
  (localCards || []).forEach(localCard => {
    if (!localCard || !localCard.id) return;


    if (cardMap.has(localCard.id)) {
      const remoteCard = cardMap.get(localCard.id);
      const localMod = getCardTimestamp(localCard);
      const remoteMod = getCardTimestamp(remoteCard);

      if (localMod > remoteMod) {
        cardMap.set(localCard.id, localCard);
      } else if (localMod === remoteMod) {
        // Equal timestamps: prefer deletion tombstone if present, else canonical content order
        if (localCard.deleted || remoteCard.deleted) {
          cardMap.set(localCard.id, localCard.deleted ? localCard : remoteCard);
        } else {
          cardMap.set(localCard.id, canonicalJSON(localCard) > canonicalJSON(remoteCard) ? localCard : remoteCard);
        }
      }
    } else {
      cardMap.set(localCard.id, localCard);
    }
  });

  return Array.from(cardMap.values());
}

/**
 * Main Sync function: High-Performance, Bidirectional Last-Write-Wins Sync strategy
 * 
 * Optimized for speed:
 * - Uses conditional HTTP 304 to avoid downloading unchanged data.
 * - Skips redundant PATCH requests when remote is already up to date.
 * 
 * @param {Array} localCards Array of card objects currently in local DB
 * @returns {Promise<{cards: Array, status: string, changed: boolean}>}
 */
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!/^[a-f0-9-]{36}$/i.test(id || '')) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function syncCards(localCards = [], { deviceId = getDeviceId() } = {}) {
  validateCards(localCards);
  const { pat, gistId } = getSyncCredentials();
  if (!pat || !gistId) return { cards: localCards, status: 'unconfigured', changed: false };
  const fingerprint = await cardsFingerprint(localCards);
  const savedFingerprint = localStorage.getItem(LAST_FINGERPRINT_KEY) || '';
  // ETag is usable only when this exact local snapshot was acknowledged.
  const effectiveEtag = localCards.length && fingerprint === savedFingerprint ? getLastSyncEtag() : '';
  let fetched = await fetchGist(pat, gistId, effectiveEtag);
  if (fetched.notModified) {
    if (effectiveEtag) return { cards: localCards, status: 'no_change', changed: false };
    fetched = await fetchGist(pat, gistId, '');
    if (fetched.notModified) throw new Error('Remote returned no data for an unconditional request.');
  }
  const files = fetched.gist?.files;
  if (!files || typeof files !== 'object') throw new Error('Invalid Gist response.');
  const filename = ['flashcards.json', 'cards.json', 'flashcards.JSON'].find(name => files[name]);
  if (!filename) throw new Error('Gist has no recognized flashcard file. Select a flashcard Gist.');
  if (!/^[a-f0-9-]{36}$/i.test(deviceId)) throw new Error('Invalid device identity.');
  const deviceFilename = `anamnesis-device-${deviceId}.json`;
  const deviceFiles = Object.keys(files).filter(name => /^anamnesis-device-[a-f0-9-]{36}\.json$/i.test(name)).sort();
  if (deviceFiles.length > 40) throw new Error('Too many device snapshots in this Gist.');
  const readDataset = async name => {
    const file = files[name];
    let payload;
    if (file.truncated) {
      const rawURL = new URL(file.raw_url);
      if (rawURL.protocol !== 'https:' || rawURL.hostname !== 'gist.githubusercontent.com') throw new Error('Untrusted remote download URL.');
      const response = await fetchWithTimeout(rawURL.href, { headers: getRawHeaders(pat), cache: 'no-store' });
      if (!response.ok) throw new Error(`Remote download failed (${response.status}).`);
      payload = await response.text();
    } else payload = file.content;
    if (typeof payload !== 'string' || payload.length > 20 * 1024 * 1024) throw new Error('Remote dataset is missing or too large.');
    try { return parseSyncPayload(JSON.parse(payload)); }
    catch (error) { throw new Error(`Invalid remote data; synchronization stopped: ${error.message}`); }
  };
  let remote = await readDataset(filename);
  let ownSnapshot;
  for (const name of deviceFiles) {
    const dataset = await readDataset(name);
    remote = mergeCards(remote, dataset);
    if (name === deviceFilename) ownSnapshot = dataset;
  }
  const merged = mergeCards(localCards, remote);
  let etag = fetched.etag;
  // Each installation writes a separate file. Simultaneous clients cannot erase
  // each other's unique records by replacing the compatibility snapshot.
  const needsPush = cardsDiffer(remote, merged) || !ownSnapshot || cardsDiffer(ownSnapshot, merged);
  if (needsPush) {
    const pushed = await updateGist(pat, gistId, merged, filename, deviceFilename);
    // A concurrent device file may be included in the PATCH ETag but absent
    // from our GET snapshot. Force a fresh GET before using conditional caching.
    etag = '';
  }
  return {
    cards: merged, changed: cardsDiffer(localCards, merged),
    status: needsPush ? 'merged_with_remote' : cardsDiffer(localCards, merged) ? 'pulled_from_remote' : 'no_change',
    checkpoint: { gistId, credential: await cardsFingerprint([{ id: gistId, pat }]), fingerprint: await cardsFingerprint(merged), etag, filename, time: Date.now() }
  };
}

export async function acknowledgeSync(result) {
  const checkpoint = result.checkpoint;
  const credentials = getSyncCredentials();
  if (!checkpoint || checkpoint.gistId !== credentials.gistId) return;
  if (checkpoint.credential && checkpoint.credential !== await cardsFingerprint([{ id: credentials.gistId, pat: credentials.pat }])) return;
  saveLastSyncEtag(checkpoint.etag);
  saveLastSyncFilename(checkpoint.filename);
  saveLastSyncTime(checkpoint.time);
  localStorage.setItem(LAST_FINGERPRINT_KEY, checkpoint.fingerprint);
}
