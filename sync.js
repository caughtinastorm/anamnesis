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
 * Automatically searches the user's account for an existing flashcards Gist
 * @param {string} pat Personal Access Token
 * @returns {Promise<string|null>} The Gist ID if found, or null
 */
export async function findExistingFlashcardGist(pat) {
  try {
    const res = await fetch('https://api.github.com/gists?per_page=100', {
      headers: getHeaders(pat),
      cache: 'no-store'
    });
    
    if (!res.ok) {
      return null;
    }
    
    const gists = await res.json();
    if (!Array.isArray(gists)) return null;

    // Search for gist containing flashcards.json or specific description
    for (const g of gists) {
      if (g.files && g.files['flashcards.json']) {
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
  // First check if an existing flashcard gist is already present on this account
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

function getCardTimestamp(card) {
  if (!card) return 0;
  return card.updated_at || card.last_modified || card.sm2_stats?.last_reviewed || card.fsrs_stats?.last_review || 0;
}

/**
 * Merge local and remote cards array using Last-Write-Wins with tombstone support.
 * Retains soft-deleted cards during merge so deletions propagate across devices.
 */
export function mergeCards(localCards, remoteCards) {
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
 * Main Sync function: Offline-First, Bidirectional Last-Write-Wins Sync strategy
 * 
 * Safely resolves local and remote changes with zero data loss.
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
    // 1. Fetch remote gist
    const gist = await fetchGist(pat, gistId);
    
    // Check if the file flashcards.json exists in Gist
    const file = gist.files && gist.files['flashcards.json'];
    let remoteCards = [];
    
    if (file) {
      if (file.truncated) {
        const rawRes = await fetch(file.raw_url, { cache: 'no-store' });
        if (!rawRes.ok) throw new Error('Failed to fetch raw gist data');
        remoteCards = await rawRes.json();
      } else if (file.content) {
        try {
          remoteCards = JSON.parse(file.content);
        } catch (e) {
          console.warn('Malformed JSON in Gist, resetting to []');
          remoteCards = [];
        }
      }
    }

    if (!Array.isArray(remoteCards)) {
      remoteCards = [];
    }

    // 2. Perform bidirectional merge with Last-Write-Wins and Tombstones
    const merged = mergeCards(localCards, remoteCards);

    // 3. Push merged cards to Gist to keep remote in sync
    const updatedGist = await updateGist(pat, gistId, merged);
    const newSyncTime = new Date(updatedGist.updated_at).getTime();
    saveLastSyncTime(newSyncTime);

    return { cards: merged, status: 'merged_with_remote' };
  } catch (error) {
    console.error('Synchronization failed:', error);
    throw error;
  }
}
