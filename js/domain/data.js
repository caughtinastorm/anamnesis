/** Canonical data contracts shared by persistence, import and synchronization. */
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(k => value[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateCards(cards) {
  if (!Array.isArray(cards)) throw new Error('Expected a card array.');
  const ids = new Set();
  for (const card of cards) {
    if (!card || typeof card !== 'object' || Array.isArray(card) ||
        typeof card.id !== 'string' || !card.id.trim()) throw new Error('Every card must have a non-empty string ID.');
    if (ids.has(card.id)) throw new Error(`Duplicate card ID: ${card.id}`);
    ids.add(card.id);
    if (card.deleted !== undefined && typeof card.deleted !== 'boolean') throw new Error('Invalid deletion flag.');
    for (const field of ['front', 'back', 'folder', 'deck', 'sub', 'description', 'lang']) {
      if (card[field] !== undefined && card[field] !== null && typeof card[field] !== 'string') {
        throw new Error(`Invalid ${field} on card ${card.id}.`);
      }
    }
    if (!card.deleted && (typeof card.front !== 'string' || typeof card.back !== 'string')) {
      throw new Error(`Card ${card.id} must have front and back text.`);
    }
    for (const field of ['last_modified', 'updated_at', 'created_at']) {
      if (card[field] !== undefined && (!Number.isFinite(Number(card[field])) || Number(card[field]) < 0)) {
        throw new Error(`Invalid timestamp on card ${card.id}.`);
      }
    }
    if (card.fsrs_stats !== undefined && card.fsrs_stats !== null) {
      if (typeof card.fsrs_stats !== 'object' || Array.isArray(card.fsrs_stats)) throw new Error('Invalid scheduling data.');
      for (const field of ['stability', 'difficulty', 'repetitions', 'lapses', 'state', 'last_review', 'next_review', 'interval']) {
        const value = card.fsrs_stats[field];
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
          throw new Error(`Invalid scheduling field ${field} on card ${card.id}.`);
        }
        if (value !== undefined && ['repetitions', 'lapses', 'state'].includes(field) && !Number.isInteger(value)) throw new Error(`Invalid integer scheduling field ${field}.`);
        if (field === 'difficulty' && value > 10) throw new Error('Scheduling difficulty exceeds 10.');
        if (field === 'state' && value > 3) throw new Error('Invalid scheduling state.');
      }
    }
  }
  return cards;
}

export function parseSyncPayload(data) {
  if (Array.isArray(data)) return validateCards(data);
  if (data && typeof data === 'object' && Array.isArray(data.cards)) {
    if (data.schemaVersion !== undefined && data.schemaVersion !== 1) throw new Error('Unsupported sync schema version.');
    return validateCards(data.cards);
  }
  throw new Error('Remote file is not a supported flashcard dataset.');
}

export async function cardsFingerprint(cards) {
  const content = canonicalJSON([...cards].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
