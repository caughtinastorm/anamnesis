import { Rating } from "../../fsrs.js";

export const PRACTICE_CONFIG = {
  BATCH_SIZE: 4,
  TARGET_STREAK: 3
};

export function createPracticeSession(cards, config = PRACTICE_CONFIG) {
  const batchSize = config?.BATCH_SIZE || 4;
  const targetStreak = config?.TARGET_STREAK || 3;
  const workingSet = cards.slice(0, batchSize);
  const pendingQueue = cards.slice(batchSize);
  const deferredQueue = [];
  const graduatedCards = [];
  const cardStates = new Map();

  for (const card of cards) {
    const cid = card.id || card._id;
    cardStates.set(cid, {
      streak: 0,
      totalReviews: 0,
      nextDueTurn: 0,
      lastReviewedTurn: -1,
      history: []
    });
  }

  return {
    workingSet,
    pendingQueue,
    deferredQueue,
    graduatedCards,
    cardStates,
    totalCards: cards.length,
    currentTurn: 0,
    lastCardId: null,
    currentCard: null,
    targetStreak,
    batchSize
  };
}

export function pickNextPracticeCard(session) {
  if (!session) return null;

  // If working set is depleted, restore from deferredQueue if any cards were parked
  if ((!session.workingSet || session.workingSet.length === 0) && session.deferredQueue && session.deferredQueue.length > 0) {
    while (session.deferredQueue.length > 0 && session.workingSet.length < session.batchSize) {
      session.workingSet.push(session.deferredQueue.shift());
    }
  }

  if (!session.workingSet || session.workingSet.length === 0) {
    return null;
  }

  const { workingSet, cardStates, currentTurn, lastCardId } = session;

  if (workingSet.length === 1) {
    return workingSet[0];
  }

  // Filter out the last reviewed card to prevent back-to-back repetitions if possible
  let candidates = workingSet.filter(c => (c.id || c._id) !== lastCardId);
  if (candidates.length === 0) {
    candidates = [...workingSet];
  }

  // Check if any candidate is due (nextDueTurn <= currentTurn)
  const dueCandidates = candidates.filter(c => {
    const s = cardStates.get(c.id || c._id);
    return !s || s.nextDueTurn <= currentTurn;
  });

  const pool = dueCandidates.length > 0 ? dueCandidates : candidates;

  // Priority:
  // 1. Lowest streak first (unlearned/troublesome cards seen most frequently)
  // 2. Earliest nextDueTurn
  // 3. Least recently reviewed turn
  pool.sort((a, b) => {
    const sa = cardStates.get(a.id || a._id) || { streak: 0, nextDueTurn: 0, lastReviewedTurn: -1 };
    const sb = cardStates.get(b.id || b._id) || { streak: 0, nextDueTurn: 0, lastReviewedTurn: -1 };

    if (sa.streak !== sb.streak) {
      return sa.streak - sb.streak;
    }
    if (sa.nextDueTurn !== sb.nextDueTurn) {
      return sa.nextDueTurn - sb.nextDueTurn;
    }
    return sa.lastReviewedTurn - sb.lastReviewedTurn;
  });

  return pool[0];
}

export function processPracticeGrade(session, card, rating) {
  if (!session || !card) return null;
  const cardId = card.id || card._id;
  const st = session.cardStates.get(cardId) || {
    streak: 0,
    totalReviews: 0,
    nextDueTurn: 0,
    lastReviewedTurn: -1,
    history: []
  };

  const oldStreak = st.streak || 0;
  let newStreak = oldStreak;
  let graduated = false;

  st.totalReviews = (st.totalReviews || 0) + 1;
  st.lastReviewedTurn = session.currentTurn;
  if (!st.history) st.history = [];
  st.history.push(rating);

  if (rating === Rating.Again) { // 1
    newStreak = 0;
    st.nextDueTurn = session.currentTurn + 1; // Retry soon after 1 intervening card
  } else if (rating === Rating.Hard) { // 2
    newStreak = Math.max(0, oldStreak);
    st.nextDueTurn = session.currentTurn + 2; // Repeat soon
  } else if (rating === Rating.Good) { // 3
    newStreak = oldStreak + 1;
    if (newStreak >= session.targetStreak) {
      graduated = true;
    } else {
      st.nextDueTurn = session.currentTurn + (newStreak >= 2 ? 4 : 3);
    }
  } else if (rating === Rating.Easy) { // 4
    newStreak = oldStreak + 2;
    if (newStreak >= session.targetStreak) {
      graduated = true;
    } else {
      st.nextDueTurn = session.currentTurn + 4;
    }
  }

  st.streak = newStreak;
  session.cardStates.set(cardId, st);
  session.lastCardId = cardId;
  session.currentTurn++;

  if (graduated) {
    const wsIdx = session.workingSet.findIndex(c => (c.id || c._id) === cardId);
    if (wsIdx !== -1) {
      session.workingSet.splice(wsIdx, 1);
    }
    session.graduatedCards.push(card);

    if (session.pendingQueue && session.pendingQueue.length > 0) {
      const nextCard = session.pendingQueue.shift();
      session.workingSet.push(nextCard);
      const nextId = nextCard.id || nextCard._id;
      if (!session.cardStates.has(nextId)) {
        session.cardStates.set(nextId, {
          streak: 0,
          totalReviews: 0,
          nextDueTurn: session.currentTurn,
          lastReviewedTurn: -1,
          history: []
        });
      }
    } else if (session.deferredQueue && session.deferredQueue.length > 0) {
      // Pending queue empty: bring back deferred/parked cards
      const nextCard = session.deferredQueue.shift();
      session.workingSet.push(nextCard);
      const nextId = nextCard.id || nextCard._id;
      if (!session.cardStates.has(nextId)) {
        session.cardStates.set(nextId, {
          streak: 0,
          totalReviews: 0,
          nextDueTurn: session.currentTurn,
          lastReviewedTurn: -1,
          history: []
        });
      }
    }
  }

  return {
    cardId,
    oldStreak,
    newStreak,
    graduated,
    remainingWorking: session.workingSet.length,
    remainingPending: session.pendingQueue ? session.pendingQueue.length : 0,
    deferredCount: session.deferredQueue ? session.deferredQueue.length : 0,
    totalGraduated: session.graduatedCards.length
  };
}

export function skipPracticeCard(session, card) {
  if (!session || !card) return null;
  const cardId = card.id || card._id;

  const wsIdx = session.workingSet.findIndex(c => (c.id || c._id) === cardId);
  if (wsIdx === -1) return null;

  // Remove card from active working set
  session.workingSet.splice(wsIdx, 1);

  // Add to deferredQueue
  if (!session.deferredQueue) session.deferredQueue = [];
  session.deferredQueue.push(card);

  const st = session.cardStates.get(cardId);
  if (st) {
    st.lastReviewedTurn = session.currentTurn;
  }

  // Refill working set from pendingQueue if available
  if (session.pendingQueue && session.pendingQueue.length > 0) {
    const nextCard = session.pendingQueue.shift();
    session.workingSet.push(nextCard);
    const nextId = nextCard.id || nextCard._id;
    if (!session.cardStates.has(nextId)) {
      session.cardStates.set(nextId, {
        streak: 0,
        totalReviews: 0,
        nextDueTurn: session.currentTurn,
        lastReviewedTurn: -1,
        history: []
      });
    }
  } else if (session.workingSet.length === 0 && session.deferredQueue.length > 0) {
    // If working set is now empty and pending queue has no cards, restore from deferredQueue
    while (session.deferredQueue.length > 0 && session.workingSet.length < session.batchSize) {
      session.workingSet.push(session.deferredQueue.shift());
    }
  }

  session.currentTurn++;
  session.lastCardId = cardId;

  return {
    skippedCardId: cardId,
    remainingWorking: session.workingSet.length,
    remainingPending: session.pendingQueue ? session.pendingQueue.length : 0,
    deferredCount: session.deferredQueue.length
  };
}

