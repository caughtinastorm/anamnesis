/** Repeatable transformations; migration bookkeeping is committed by db.js. */
export function migrateLegacyCard(card) {
  const next = structuredClone(card);
  if (next.sm2_stats !== undefined) {
    if (!next.fsrs_stats || next.fsrs_stats.stability === undefined) {
      const stats = next.sm2_stats || {};
      const reps = stats.repetitions || 0;
      next.fsrs_stats = {
        stability: stats.interval || 0, difficulty: 5, repetitions: reps, lapses: 0,
        state: reps === 0 ? 0 : 2, last_review: stats.last_reviewed || 0,
        next_review: stats.next_review || 0, interval: stats.interval || 0
      };
    }
    delete next.sm2_stats;
  }
  if ((next.folder || '').trim().toLowerCase() === 'social' &&
      (next.deck || '').trim() === 'I.' && next.sub?.trim()) {
    next.deck = next.sub.trim();
    next.sub = '';
  }
  return next;
}
