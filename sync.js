/**
 * GitHub Gist Sync Manager
 * 
 * Implements "Offline-First, Last-Write-Wins" sync strategy.
 */

const CREDENTIALS_KEY = 'flashcard_sync_credentials';
const LAST_SYNC_KEY = 'flashcard_last_sync_time';

export function getSyncCredentials() {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    return raw ? JSON.parse(raw) : { pat: '', gistId: '' };
  } catch (e) {
    console.error('Error reading sync credentials:', e);
    return { pat: '', gistId: '' };
  }
}

export function saveSyncCredentials(pat, gistId) {
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ pat, gistId }));
}

export function clearSyncCredentials() {
  localStorage.removeItem(CREDENTIALS_KEY);
  localStorage.removeItem(LAST_SYNC_KEY);
}

export function getLastSyncTime() {
  const t = localStorage.getItem(LAST_SYNC_KEY);
  return t ? parseInt(t, 10) : 0;
}

export function saveLastSyncTime(timestamp) {
  localStorage.setItem(LAST_SYNC_KEY, timestamp.toString());
}

/**
 * Common Headers for GitHub API request
 */
function getHeaders(pat) {
  return {
    'Authorization': `token ${pat}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

/**
 * Test a Personal Access Token (PAT) by fetching user profile
 */
export async function testToken(pat) {
  const res = await fetch('https://api.github.com/user', {
    headers: getHeaders(pat)
  });
  if (!res.ok) {
    throw new Error(`GitHub Token validation failed: ${res.statusText}`);
  }
  return await res.json();
}

/**
 * Create a new private gist containing flashcards.json
 */
export async function createFlashcardGist(pat) {
  const body = {
    description: 'Flashcard PWA HEADLESS JSON Data Store',
    public: false,
    files: {
      'flashcards.json': {
        content: '[]'
      }
    }
  };

  const res = await fetch('https://api.github.com/gists', {
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
 * Fetch a specific gist
 */
async function fetchGist(pat, gistId) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: getHeaders(pat),
    // Disable caching to get the latest updated_at
    cache: 'no-store'
  });

  if (res.status === 404) {
    throw new Error('Gist not found. Check your Gist ID.');
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch gist: ${res.statusText}`);
  }

  return await res.json();
}

/**
 * Update the gist file with new content
 */
async function updateGist(pat, gistId, cards) {
  const body = {
    files: {
      'flashcards.json': {
        content: JSON.stringify(cards, null, 2)
      }
    }
  };

  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: getHeaders(pat),
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Failed to update Gist: ${res.statusText}`);
  }

  const data = await res.json();
  return data;
}

/**
 * Merge local and remote cards array using Last-Write-Wins with tombstone support.
 * Retains soft-deleted cards during merge so deletions propagate across devices.
 */
export function mergeCards(localCards, remoteCards) {
  const cardMap = new Map();

  // Populate with remote cards first
  remoteCards.forEach(card => {
    if (card && card.id) {
      cardMap.set(card.id, card);
    }
  });

  // Merge local cards
  localCards.forEach(localCard => {
    if (!localCard || !localCard.id) return;

    if (cardMap.has(localCard.id)) {
      const remoteCard = cardMap.get(localCard.id);
      const localMod = localCard.last_modified || 0;
      const remoteMod = remoteCard.last_modified || 0;

      if (localMod >= remoteMod) {
        cardMap.set(localCard.id, localCard);
      }
    } else {
      // Card only exists locally
      cardMap.set(localCard.id, localCard);
    }
  });

  return Array.from(cardMap.values());
}

/**
 * Main Sync function: Offline-First, Last-Write-Wins Sync strategy
 * 
 * Resolves local changes against remote Gist.
 * 
 * @param {Array} localCards Array of card objects currently in local DB
 * @returns {Promise<{cards: Array, status: string}>} Merged cards and sync status
 */
export async function syncCards(localCards) {
  const { pat, gistId } = getSyncCredentials();
  
  if (!pat || !gistId) {
    return { cards: localCards, status: 'unconfigured' };
  }

  try {
    // 1. Fetch remote gist metadata
    const gist = await fetchGist(pat, gistId);
    
    // Remote update time in ms
    const remoteUpdatedAt = new Date(gist.updated_at).getTime();
    const lastSyncTime = getLastSyncTime();
    
    // Check if the file flashcards.json exists in Gist
    const file = gist.files['flashcards.json'];
    if (!file) {
      // If file doesn't exist, create it by updating the gist
      console.warn('flashcards.json not found in gist, creating it');
      const updatedGist = await updateGist(pat, gistId, localCards);
      const newSyncTime = new Date(updatedGist.updated_at).getTime();
      saveLastSyncTime(newSyncTime);
      return { cards: localCards, status: 'uploaded_local' };
    }

    // 2. Conflict check
    if (remoteUpdatedAt > lastSyncTime) {
      // Remote is newer, download remote content
      let remoteCards = [];
      
      // If truncated, we need to fetch the raw URL
      if (file.truncated) {
        const rawRes = await fetch(file.raw_url);
        if (!rawRes.ok) throw new Error('Failed to fetch truncated raw file');
        remoteCards = await rawRes.json();
      } else {
        remoteCards = JSON.parse(file.content || '[]');
      }

      // Merge local and remote
      const merged = mergeCards(localCards, remoteCards);

      // check if the merged array actually differs from local or remote
      // To simplify, if there's any merge, let's write to both Gist and Local IndexedDB
      const updatedGist = await updateGist(pat, gistId, merged);
      const newSyncTime = new Date(updatedGist.updated_at).getTime();
      saveLastSyncTime(newSyncTime);

      return { cards: merged, status: 'merged_with_remote' };
    } else {
      // Local changes are newer, or equal (we have already synced this remote revision)
      // Push local data
      const updatedGist = await updateGist(pat, gistId, localCards);
      const newSyncTime = new Date(updatedGist.updated_at).getTime();
      saveLastSyncTime(newSyncTime);

      return { cards: localCards, status: 'uploaded_local' };
    }
  } catch (error) {
    console.error('Synchronization failed:', error);
    throw error;
  }
}
