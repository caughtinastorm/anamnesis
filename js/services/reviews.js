import { getTargetRetention } from "./preferences.js";
import { calculateFSRS5, Rating } from '../../fsrs.js';
import { commitReview, revertReview } from '../../db.js';

/** Persist first. Callers may update their session only after this resolves. */
export async function gradeReview(card, grade, {
  now = Date.now(), durationMs = 0, mode = 'scheduled', recordFSRS = true,
  retention = getTargetRetention(), logId = crypto.randomUUID()
} = {}) {
  if (!Object.values(Rating).includes(grade)) throw new Error('Invalid review rating.');
  const before = structuredClone(card);
  const updated = recordFSRS ? calculateFSRS5(before, grade, now, retention) : before;
  if (recordFSRS) {
    updated.last_modified = Math.max(now, Number(before.last_modified || 0) + 1);
    updated.updated_at = updated.last_modified;
  }
  const log = {
    id: logId, card_id: card.id, timestamp: now, grade,
    elapsed_days: before.fsrs_stats?.last_review > 0 ? Math.max(0, (now - before.fsrs_stats.last_review) / 86400000) : 0,
    stability_before: before.fsrs_stats?.stability || 0,
    stability_after: updated.fsrs_stats?.stability || 0,
    difficulty_before: before.fsrs_stats?.difficulty || 0,
    difficulty_after: updated.fsrs_stats?.difficulty || 0,
    interval: updated.fsrs_stats?.interval || 0,
    state_before: before.fsrs_stats?.state ?? 0,
    state_after: updated.fsrs_stats?.state ?? 0,
    duration_ms: Math.max(0, Math.min(300000, durationMs)),
    deck: card.deck || 'Default', folder: card.folder || '',
    mode: recordFSRS ? mode : 'practice_buffer'
  };
  await commitReview(before, recordFSRS ? updated : null, log);
  return { before, updated, log, recordFSRS };
}

export async function undoReview(receipt, now = Date.now()) {
  if (!receipt) return null;
  const restored = structuredClone(receipt.before);
  if (receipt.recordFSRS) {
    restored.last_modified = Math.max(now, Number(receipt.updated.last_modified || 0) + 1);
    restored.updated_at = restored.last_modified;
  }
  await revertReview(receipt.updated, receipt.recordFSRS ? restored : null, receipt.log.id);
  return restored;
}
