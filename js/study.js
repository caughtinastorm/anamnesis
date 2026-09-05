import { state } from "./state.js";
import { dom, showToast, showModal, showPracticeModeModal, switchView } from "./ui.js";
import { sanitizeHTML, shuffle, formatDeckSelectionLabel, limitText } from "./utils.js";
import { calculateFSRS5, Rating, calculateProjectedIntervals, getTargetRetention } from "../fsrs.js";
import * as db from "../db.js";
import { loadCardsFromDB } from "./cards.js";
import { recordDailyReview, filterCards, invalidateStatsCache } from "./dashboard.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

let currentSessionPool = [];
let currentSessionIsForce = false;
let isGradingInProgress = false;
let studyUndoStack = [];

export const PRACTICE_CONFIG = {
  BATCH_SIZE: 4,
  TARGET_STREAK: 3
};

let practiceSession = null;
export const getPracticeSession = () => practiceSession;

export function createPracticeSession(cards, config = PRACTICE_CONFIG) {
  const batchSize = config?.BATCH_SIZE || 4;
  const targetStreak = config?.TARGET_STREAK || 3;
  const workingSet = cards.slice(0, batchSize);
  const pendingQueue = cards.slice(batchSize);
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
  if (!session || !session.workingSet || session.workingSet.length === 0) {
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

    if (session.pendingQueue.length > 0) {
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
    }
  }

  return {
    cardId,
    oldStreak,
    newStreak,
    graduated,
    remainingWorking: session.workingSet.length,
    remainingPending: session.pendingQueue.length,
    totalGraduated: session.graduatedCards.length
  };
}

export function updatePracticeMasteryBadges(streak = 0, target = 3) {
  const pills = [
    document.getElementById("practice-mastery-pill-front") || dom.practiceMasteryPillFront,
    document.getElementById("practice-mastery-pill-back") || dom.practiceMasteryPillBack
  ].filter(Boolean);

  if (pills.length === 0) return;

  if (!currentSessionIsForce || !practiceSession) {
    pills.forEach(p => p.classList.add("hidden"));
    return;
  }

  const cappedStreak = Math.min(target, Math.max(0, streak));

  pills.forEach(p => {
    p.classList.remove("hidden");
    p.classList.remove("streak-0", "streak-1", "streak-2", "streak-3");
    p.classList.add(`streak-${cappedStreak}`);

    let dots = "";
    for (let i = 0; i < target; i++) {
      dots += (i < cappedStreak ? "● " : "○ ");
    }
    const dotsEl = p.querySelector(".mastery-dots");
    const labelEl = p.querySelector(".mastery-label");
    if (dotsEl) dotsEl.textContent = dots.trim();
    if (labelEl) {
      labelEl.textContent = cappedStreak >= target
        ? `${cappedStreak}/${target} Mastered`
        : `${cappedStreak}/${target} Streak`;
    }
  });
}

function updateUndoButtonState() {
  const undoBtn = document.getElementById("btn-undo-study") || dom.btnUndoStudy;
  if (undoBtn) {
    undoBtn.disabled = (studyUndoStack.length === 0);
  }
}

export function startStudySession(force = false, customCards = null, sessionTitle = null, recordFSRS = null) {
  // If starting an unscheduled practice session and user hasn't chosen FSRS mode yet, ask them first!
  if (force && recordFSRS === null) {
    showPracticeModeModal(
      () => startStudySession(true, customCards, sessionTitle, false), // Practice Only
      () => startStudySession(true, customCards, sessionTitle, true),  // Count towards FSRS
      () => {} // Cancel
    );
    return;
  }

  let pool = [];
  currentSessionIsForce = force;
  studyUndoStack = [];
  updateUndoButtonState();

  if (customCards && Array.isArray(customCards)) {
    pool = customCards.filter(c => !c.deleted);
    currentSessionPool = [...pool];
  } else if (force) {
    pool = filterCards();
    currentSessionPool = [...pool];
  } else {
    const due = state.dueCards || [];
    if (due.length > 0) {
      pool = [...due];
      currentSessionPool = [...filterCards()]; // Fallback for restart
    } else {
      // If no cards are due, ask user before launching practice mode
      const allInDeck = filterCards();
      if (allInDeck.length > 0) {
        if (recordFSRS === null) {
          showPracticeModeModal(
            () => startStudySession(true, customCards, sessionTitle, false),
            () => startStudySession(true, customCards, sessionTitle, true),
            () => {}
          );
          return;
        }
        pool = [...allInDeck];
        currentSessionPool = [...pool];
        currentSessionIsForce = true;
      }
    }
  }

  if (!pool || pool.length === 0) {
    showToast("No flashcards found in this collection to study", "info");
    return;
  }

  const cap = parseInt(localStorage.getItem("app-review-cap") || "0", 10);
  if (cap > 0 && pool.length > cap && !currentSessionIsForce) {
    const originalCount = pool.length;
    pool = pool.slice(0, cap);
    showToast(`Vacation Mode: Loaded ${cap} of ${originalCount} due cards`, "info");
  }

  const isFSRSEnabled = (recordFSRS !== null) ? recordFSRS : true;
  const rawTitle = sessionTitle || formatDeckSelectionLabel(state.selectedDeck);
  const displayTitle = limitText(rawTitle, 24);
  state.studySessionInfo = {
    name: displayTitle,
    fullName: rawTitle,
    isForce: currentSessionIsForce,
    recordFSRS: isFSRSEnabled,
    count: pool.length
  };

  if (dom.studyDeckBadge) {
    dom.studyDeckBadge.textContent = currentSessionIsForce ? `${displayTitle} (Practice)` : displayTitle;
    dom.studyDeckBadge.title = currentSessionIsForce
      ? (isFSRSEnabled
          ? `${rawTitle} — Practice Mode (FSRS recorded)`
          : `${rawTitle} — Practice Mode (FSRS untouched)`)
      : rawTitle;
  }

  if (currentSessionIsForce) {
    const shuffledPool = shuffle([...pool]);
    practiceSession = createPracticeSession(shuffledPool, PRACTICE_CONFIG);
    const firstCard = pickNextPracticeCard(practiceSession);
    practiceSession.currentCard = firstCard;
    state.studySessionCards = firstCard ? [firstCard] : [];
    state.currentCardIndex = 0;
  } else {
    practiceSession = null;
    state.studySessionCards = shuffle([...pool]);
    state.currentCardIndex = 0;
  }

  state.isFlipped = false;
  state.isSwipeActive = false;
  state.touchMoveX = 0;
  state.touchMoveY = 0;
  isGradingInProgress = false;

  if (dom.subviewDashboard) dom.subviewDashboard.classList.remove("active");
  if (dom.subviewStudy) dom.subviewStudy.classList.add("active");
  renderCurrentStudyCard();
}

export function restartStudySession() {
  const pool = currentSessionPool.length > 0 ? currentSessionPool : filterCards();
  if (!pool || pool.length === 0) {
    showToast("No cards available to review", "info");
    exitStudySession();
    return;
  }
  studyUndoStack = [];
  updateUndoButtonState();

  const isPracticeOnly = state.studySessionInfo && state.studySessionInfo.recordFSRS === false;

  if (currentSessionIsForce) {
    const shuffledPool = shuffle([...pool]);
    practiceSession = createPracticeSession(shuffledPool, PRACTICE_CONFIG);
    const firstCard = pickNextPracticeCard(practiceSession);
    practiceSession.currentCard = firstCard;
    state.studySessionCards = firstCard ? [firstCard] : [];
    state.currentCardIndex = 0;
  } else {
    practiceSession = null;
    state.studySessionCards = shuffle([...pool]);
    state.currentCardIndex = 0;
  }

  state.isFlipped = false;
  state.isSwipeActive = false;
  state.touchMoveX = 0;
  state.touchMoveY = 0;
  isGradingInProgress = false;

  if (dom.studyDeckBadge && state.studySessionInfo?.name) {
    dom.studyDeckBadge.textContent = currentSessionIsForce
      ? `${state.studySessionInfo.name} (Practice)`
      : state.studySessionInfo.name;
    dom.studyDeckBadge.title = currentSessionIsForce
      ? (isPracticeOnly
          ? `${state.studySessionInfo.fullName || state.studySessionInfo.name} — Practice Mode (FSRS untouched)`
          : `${state.studySessionInfo.fullName || state.studySessionInfo.name} — Practice Mode (FSRS recorded)`)
      : (state.studySessionInfo.fullName || state.studySessionInfo.name);
  }

  renderCurrentStudyCard();
  showToast(`Restarted session (${pool.length} cards)`, "info");
}

function updateGradeButtonIntervals(card) {
  if (!card) return;
  const isPracticeOnly = state.studySessionInfo && state.studySessionInfo.recordFSRS === false;
  const int1 = document.getElementById("grade-interval-1");
  const int2 = document.getElementById("grade-interval-2");
  const int3 = document.getElementById("grade-interval-3");
  const int4 = document.getElementById("grade-interval-4");

  if (currentSessionIsForce && practiceSession) {
    const cardId = card.id || card._id;
    const st = practiceSession.cardStates.get(cardId) || { streak: 0 };
    const s = st.streak || 0;
    const target = practiceSession.targetStreak || 3;

    if (int1) int1.textContent = "Reset 0/3";
    if (int2) int2.textContent = `${s}/${target} Repeat`;
    if (int3) {
      const nextS = s + 1;
      int3.textContent = nextS >= target ? "Master 🎉" : `+1 (${nextS}/${target})`;
    }
    if (int4) {
      const nextS = s + 2;
      int4.textContent = nextS >= target ? "Master 🎉" : `+2 (${Math.min(target, nextS)}/${target})`;
    }
    return;
  }

  if (isPracticeOnly) {
    if (int1) int1.textContent = "< 10m";
    if (int2) int2.textContent = "Pass";
    if (int3) int3.textContent = "Pass";
    if (int4) int4.textContent = "Pass";
    return;
  }

  const proj = calculateProjectedIntervals(card);
  if (int1) int1.textContent = proj.again;
  if (int2) int2.textContent = proj.hard;
  if (int3) int3.textContent = proj.good;
  if (int4) int4.textContent = proj.easy;
}

export function renderCurrentStudyCard() {
  updateUndoButtonState();

  let card = null;
  if (currentSessionIsForce && practiceSession) {
    if (!practiceSession.workingSet || practiceSession.workingSet.length === 0) {
      finishStudySession();
      return;
    }
    card = practiceSession.currentCard;
    if (!card) {
      card = pickNextPracticeCard(practiceSession);
      practiceSession.currentCard = card;
    }
    if (!card) {
      finishStudySession();
      return;
    }
    state.studySessionCards = [card];
    state.currentCardIndex = 0;
  } else {
    if (state.currentCardIndex >= state.studySessionCards.length) {
      finishStudySession();
      return;
    }
    card = state.studySessionCards[state.currentCardIndex];
    if (!card) {
      finishStudySession();
      return;
    }
  }

  state.isFlipped = false;
  state.isSwipeActive = false;
  state.touchMoveX = 0;
  state.touchMoveY = 0;
  isGradingInProgress = false;

  if (currentSessionIsForce && practiceSession) {
    const total = practiceSession.totalCards;
    const graduated = practiceSession.graduatedCards.length;
    const active = practiceSession.workingSet.length;
    const target = practiceSession.targetStreak || 3;

    if (dom.studyProgressText) {
      dom.studyProgressText.textContent = `${graduated} of ${total} Mastered (${active} active in set)`;
    }

    if (dom.studyProgressBar) {
      const totalPoints = total * target;
      let earnedPoints = graduated * target;
      for (const c of practiceSession.workingSet) {
        const cs = practiceSession.cardStates.get(c.id || c._id);
        if (cs) earnedPoints += Math.min(target, cs.streak);
      }
      const pct = Math.min(100, Math.round((earnedPoints / Math.max(1, totalPoints)) * 100));
      dom.studyProgressBar.style.width = `${pct}%`;
    }

    const st = practiceSession.cardStates.get(card.id || card._id);
    updatePracticeMasteryBadges(st ? st.streak : 0, target);
  } else {
    if (dom.studyProgressText) {
      dom.studyProgressText.textContent = `Card ${state.currentCardIndex + 1} of ${state.studySessionCards.length}`;
    }

    if (dom.studyProgressBar) {
      const pct = ((state.currentCardIndex) / state.studySessionCards.length) * 100;
      dom.studyProgressBar.style.width = `${pct}%`;
    }

    updatePracticeMasteryBadges(0);
  }

  if (dom.cardFrontContent) dom.cardFrontContent.innerHTML = renderCardContent(card.front, false);
  if (dom.cardBackContent) dom.cardBackContent.innerHTML = renderCardContent(card.back, true);

  if (dom.cardFrontSub && dom.cardBackSub) {
    if (card.sub) {
      dom.cardFrontSub.textContent = card.sub;
      dom.cardFrontSub.classList.remove("hidden");
      dom.cardBackSub.textContent = card.sub;
      dom.cardBackSub.classList.remove("hidden");
    } else {
      dom.cardFrontSub.textContent = "";
      dom.cardFrontSub.classList.add("hidden");
      dom.cardBackSub.textContent = "";
      dom.cardBackSub.classList.add("hidden");
    }
  }

  if (dom.cardBackDescription && dom.cardBackDivider) {
    if (card.description) {
      dom.cardBackDescription.innerHTML = sanitizeHTML(card.description);
      dom.cardBackDescription.classList.remove("hidden");
      dom.cardBackDivider.classList.remove("hidden");
    } else {
      dom.cardBackDescription.innerHTML = "";
      dom.cardBackDescription.classList.add("hidden");
      dom.cardBackDivider.classList.add("hidden");
    }
  }

  updateGradeButtonIntervals(card);

  if (dom.flashcard) {
    // Suppress CSS transition while resetting so the new card appears directly on the front face
    // without visibly spinning/unfolding in reverse
    dom.flashcard.style.transition = "none";
    dom.flashcard.className = "flashcard";
    dom.flashcard.style.transform = "";
    dom.flashcard.style.borderColor = "";
    void dom.flashcard.offsetHeight;
    dom.flashcard.style.transition = "";
  }
  if (dom.studyHintBar) dom.studyHintBar.classList.remove("hidden");
  if (dom.studyGradingBar) dom.studyGradingBar.classList.add("hidden");

  if (dom.cardFrontContent?.parentElement) dom.cardFrontContent.parentElement.scrollTop = 0;
  if (dom.cardBackContent?.parentElement) dom.cardBackContent.parentElement.scrollTop = 0;
}

export function flipCard() {
  if (isGradingInProgress) return;
  state.isFlipped = !state.isFlipped;
  if (dom.flashcard) {
    dom.flashcard.style.transform = "";
    dom.flashcard.classList.toggle("flipped", state.isFlipped);
  }
  if (dom.studyHintBar) dom.studyHintBar.classList.toggle("hidden", state.isFlipped);
  if (dom.studyGradingBar) dom.studyGradingBar.classList.toggle("hidden", !state.isFlipped);
}

export async function submitCardGrade(grade) {
  if (isGradingInProgress) return;

  const card = (currentSessionIsForce && practiceSession)
    ? practiceSession.currentCard
    : state.studySessionCards[state.currentCardIndex];

  if (!card) return;

  isGradingInProgress = true;

  let fsrsRating = Rating.Good;
  if (grade === 1) fsrsRating = Rating.Again;
  else if (grade === 2) fsrsRating = Rating.Hard;
  else if (grade === 3) fsrsRating = Rating.Good;
  else if (grade === 4) fsrsRating = Rating.Easy;

  const now = Date.now();
  const cardBefore = JSON.parse(JSON.stringify(card));
  const logId = 'log_' + now + '_' + Math.random().toString(36).slice(2, 6);
  const isPracticeOnly = state.studySessionInfo && state.studySessionInfo.recordFSRS === false;

  // Push to Undo Stack
  if (currentSessionIsForce && practiceSession) {
    const cardStatesCopy = new Map();
    for (const [k, v] of practiceSession.cardStates.entries()) {
      cardStatesCopy.set(k, { ...v, history: [...(v.history || [])] });
    }
    studyUndoStack.push({
      isPractice: true,
      cardBefore,
      practiceSnapshot: {
        currentTurn: practiceSession.currentTurn,
        lastCardId: practiceSession.lastCardId,
        currentCard: practiceSession.currentCard,
        workingSet: [...practiceSession.workingSet],
        pendingQueue: [...practiceSession.pendingQueue],
        graduatedCards: [...practiceSession.graduatedCards],
        cardStates: cardStatesCopy
      },
      logId: isPracticeOnly ? null : logId
    });
  } else {
    studyUndoStack.push({
      isPractice: false,
      cardBefore,
      cardIndex: state.currentCardIndex,
      wasPushedAgain: (fsrsRating === Rating.Again),
      logId: isPracticeOnly ? null : logId
    });
  }
  updateUndoButtonState();

  if (!isPracticeOnly) {
    let updated = card;
    try {
      updated = calculateFSRS5(card, fsrsRating, now);
    } catch (err) {
      console.error("FSRS calculation error:", err);
    }

    // Record historical review log
    try {
      const daysElapsed = (cardBefore.fsrs_stats?.last_review > 0)
        ? Math.max(0, (now - cardBefore.fsrs_stats.last_review) / (1000 * 60 * 60 * 24))
        : 0;
      db.saveReviewLog({
        id: logId,
        card_id: card.id,
        timestamp: now,
        grade: fsrsRating,
        elapsed_days: Math.round(daysElapsed * 100) / 100,
        stability_before: cardBefore.fsrs_stats?.stability || 0,
        stability_after: updated.fsrs_stats?.stability || 0,
        difficulty_before: cardBefore.fsrs_stats?.difficulty || 0,
        difficulty_after: updated.fsrs_stats?.difficulty || 0,
        interval: updated.fsrs_stats?.interval || 0,
        state_before: cardBefore.fsrs_stats?.state ?? 0,
        state_after: updated.fsrs_stats?.state ?? 0
      });
    } catch (e) {
      console.warn("Failed to log review history:", e);
    }

    // Update in-memory allCards immediately
    const allIdx = state.allCards.findIndex(c => (c.id || c._id) === (card.id || card._id));
    if (allIdx !== -1) {
      state.allCards[allIdx] = { ...state.allCards[allIdx], ...updated };
    }
    invalidateStatsCache();

    // If in practiceSession, update the card object in workingSet
    if (currentSessionIsForce && practiceSession) {
      const wsIdx = practiceSession.workingSet.findIndex(c => (c.id || c._id) === (card.id || card._id));
      if (wsIdx !== -1) {
        practiceSession.workingSet[wsIdx] = { ...practiceSession.workingSet[wsIdx], ...updated };
      }
    }

    try {
      await db.saveCard(updated);
    } catch (e) {
      console.error("Error saving graded card:", e);
    }

    recordDailyReview(card.id, now);
  }

  // Visual card exit animation
  animateCardExit(fsrsRating);

  if (currentSessionIsForce && practiceSession) {
    processPracticeGrade(practiceSession, card, fsrsRating);

    if (practiceSession.workingSet.length === 0) {
      setTimeout(() => {
        finishStudySession();
      }, 180);
      return;
    }

    const nextCard = pickNextPracticeCard(practiceSession);
    practiceSession.currentCard = nextCard;
    state.studySessionCards = nextCard ? [nextCard] : [];
    state.currentCardIndex = 0;

    setTimeout(() => {
      renderCurrentStudyCard();
    }, 180);
  } else {
    // Standard daily review
    if (fsrsRating === Rating.Again) {
      state.studySessionCards.push({ ...cardBefore });
    }

    state.currentCardIndex++;
    setTimeout(() => {
      renderCurrentStudyCard();
    }, 180);
  }
}

function animateCardExit(rating) {
  if (!dom.flashcard) return;
  const anim = rating === Rating.Again ? "card-exit-left" : "card-exit-right";
  if (dom.flashcard) {
    dom.flashcard.style.transform = "";
    dom.flashcard.classList.add(anim);
  }
  setTimeout(() => {
    if (dom.flashcard) dom.flashcard.classList.remove(anim);
  }, 160);
}

/**
 * Reverts the immediately preceding card review in the active study session.
 * Fully restores both session index, in-memory state, and IndexedDB data.
 */
export async function undoLastStudyCard() {
  if (isGradingInProgress || studyUndoStack.length === 0) return;

  const last = studyUndoStack.pop();
  updateUndoButtonState();

  if (!last || !last.cardBefore) return;

  if (last.isPractice && practiceSession) {
    practiceSession.currentTurn = last.practiceSnapshot.currentTurn;
    practiceSession.lastCardId = last.practiceSnapshot.lastCardId;
    practiceSession.currentCard = last.practiceSnapshot.currentCard;
    practiceSession.workingSet = [...last.practiceSnapshot.workingSet];
    practiceSession.pendingQueue = [...last.practiceSnapshot.pendingQueue];
    practiceSession.graduatedCards = [...last.practiceSnapshot.graduatedCards];
    practiceSession.cardStates = last.practiceSnapshot.cardStates;

    state.studySessionCards = last.practiceSnapshot.currentCard ? [last.practiceSnapshot.currentCard] : [];
    state.currentCardIndex = 0;
  } else {
    // If card was re-appended for 'Again', remove the appended instance from pool
    if (last.wasPushedAgain && state.studySessionCards.length > last.cardIndex + 1) {
      const lastItem = state.studySessionCards[state.studySessionCards.length - 1];
      if (lastItem && (lastItem.id || lastItem._id) === (last.cardBefore.id || last.cardBefore._id)) {
        state.studySessionCards.pop();
      }
    }
    state.studySessionCards[last.cardIndex] = last.cardBefore;
    state.currentCardIndex = last.cardIndex;
  }

  // Restore session card and in-memory allCards if FSRS was tracked
  const allIdx = state.allCards.findIndex(c => (c.id || c._id) === (last.cardBefore.id || last.cardBefore._id));
  if (allIdx !== -1) {
    state.allCards[allIdx] = { ...last.cardBefore };
  }
  invalidateStatsCache();

  // Revert in IndexedDB and prune review log if one was saved
  try {
    await db.saveCard(last.cardBefore);
    if (last.logId) {
      await db.deleteReviewLog(last.logId);
    }
  } catch (e) {
    console.error("Error saving reverted card during undo:", e);
  }

  state.isFlipped = false;
  isGradingInProgress = false;
  renderCurrentStudyCard();
  showToast("Reverted last review", "info");
}

export function exitStudySession() {
  const subStudy = document.getElementById("subview-study") || dom.subviewStudy;
  const subDash = document.getElementById("subview-dashboard") || dom.subviewDashboard;
  if (subStudy) subStudy.classList.remove("active");
  if (subDash) subDash.classList.add("active");
  isGradingInProgress = false;
  state.isSwipeActive = false;
  state.isFlipped = false;
  state.touchMoveX = 0;
  state.touchMoveY = 0;
  studyUndoStack = [];
  updateUndoButtonState();
  practiceSession = null;
  updatePracticeMasteryBadges(0);

  if (dom.flashcard) {
    dom.flashcard.style.transition = "none";
    dom.flashcard.className = "flashcard";
    dom.flashcard.style.transform = "";
    dom.flashcard.style.borderColor = "";
    void dom.flashcard.offsetHeight;
    dom.flashcard.style.transition = "";
  }
  loadCardsFromDB();
  onSyncRequest(500);
}

function finishStudySession() {
  if (dom.studyProgressBar) dom.studyProgressBar.style.width = "100%";
  onSyncRequest();

  const deckName = state.studySessionInfo?.fullName || state.studySessionInfo?.name || "this collection";
  const count = (currentSessionIsForce && practiceSession)
    ? practiceSession.totalCards
    : state.studySessionCards.length;
  const isPracticeOnly = state.studySessionInfo && state.studySessionInfo.recordFSRS === false;

  let modalTitle = "🎉 Deck Completed!";
  let modalMsg = `Great job! You finished all ${count} cards in ${deckName}. Would you like to review this deck again or return to dashboard?`;

  if (currentSessionIsForce) {
    modalTitle = "🎯 Practice Completed!";
    modalMsg = isPracticeOnly
      ? `Phenomenal work! You mastered all ${count} cards in ${deckName} with local retention streaks. Your long-term FSRS spaced repetition data remained safe and untouched.`
      : `Phenomenal work! You mastered all ${count} cards in ${deckName} with local retention streaks, and review logs were recorded for FSRS.`;
  }

  showModal(
    modalTitle,
    modalMsg,
    () => {
      restartStudySession();
    },
    () => {
      exitStudySession();
    }
  );
}

export function renderCardContent(text, isBack = false) {
  if (!text) return "";
  let html = sanitizeHTML(text);

  // 1. Handle explicit {{c1::answer}} or {{c1::answer::hint}}
  if (/\{\{c\d+::.*?\}\}/i.test(html)) {
    if (isBack) {
      html = html.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/gi, '<span class="cloze-answer">$1</span>');
    } else {
      html = html.replace(/\{\{c\d+::(?:.*?)::(.*?)\}\}/gi, '<span class="cloze-blank">[ $1 ]</span>');
      html = html.replace(/\{\{c\d+::(.*?)\}\}/gi, '<span class="cloze-blank">[ ... ]</span>');
    }
  }

  // 2. Handle expanded cloze blanks on front: [ ... ] or [ … ]
  if (!isBack) {
    html = html.replace(/\[\s*(?:\.{3}|…)\s*\]/g, '<span class="cloze-blank">[ ... ]</span>');
  }

  return html;
}

export function speakCardText(text, card = null) {
  if (!("speechSynthesis" in window)) { showToast("Speech not supported", "info"); return; }
  window.speechSynthesis.cancel();
  const clean = text.replace(/<[^>]+>/g, "").replace(/\[([^\]]+)\]/g, "$1").replace(/\{\{c\d+::([^}]+)\}\}/g, "$1").trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  const explicitLang = card?.lang || localStorage.getItem("app-speech-lang") || "auto";
  if (explicitLang && explicitLang !== "auto") {
    u.lang = explicitLang;
  } else {
    if (/[áéíóúüñ¿¡]/i.test(clean)) u.lang = "es-ES";
    else if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(clean)) u.lang = "ja-JP";
    else if (/[а-яА-ЯёЁ]/.test(clean)) u.lang = "ru-RU";
    else if (/[äöüß]/i.test(clean)) u.lang = "de-DE";
    else if (/[éàèùâêîôûëïç]/i.test(clean)) u.lang = "fr-FR";
    else if (/[\u4e00-\u9fa5]/.test(clean)) u.lang = "zh-CN";
    else if (/[\uac00-\ud7af]/.test(clean)) u.lang = "ko-KR";
    else if (/[àèìòù]/i.test(clean)) u.lang = "it-IT";
  }
  window.speechSynthesis.speak(u);
}

export function initTouchGestures() {
  if (!dom.flashcard) return;
  dom.flashcard.addEventListener("touchstart", e => {
    if (e.touches.length !== 1 || !state.isFlipped || isGradingInProgress) return;
    const t = e.touches[0];
    state.touchStartX = t.clientX;
    state.touchStartY = t.clientY;
    state.touchMoveX = 0;
    state.touchMoveY = 0;
    state.isSwipeActive = false;
  }, { passive: true });

  dom.flashcard.addEventListener("touchmove", e => {
    if (!state.isFlipped || isGradingInProgress) return;
    const t = e.touches[0];
    state.touchMoveX = t.clientX - state.touchStartX;
    state.touchMoveY = t.clientY - state.touchStartY;

    if (!state.isSwipeActive) {
      if (Math.abs(state.touchMoveX) > 10 && Math.abs(state.touchMoveX) > Math.abs(state.touchMoveY)) {
        state.isSwipeActive = true;
        dom.flashcard.style.transition = "none";
      } else {
        return;
      }
    }

    if (Math.abs(state.touchMoveX) > Math.abs(state.touchMoveY) && e.cancelable) e.preventDefault();
    const rot = state.touchMoveX * 0.05;
    dom.flashcard.style.transform = `rotateY(180deg) translate3d(${state.touchMoveX}px, ${state.touchMoveY}px, 0) rotate(${rot}deg)`;
    dom.flashcard.style.borderColor = state.touchMoveX > 40 ? "var(--accent-color)" : state.touchMoveX < -40 ? "var(--danger-color)" : "var(--panel-border)";
  }, { passive: false });

  const endSwipe = () => {
    if (!state.isSwipeActive) {
      state.touchMoveX = 0;
      state.touchMoveY = 0;
      return;
    }
    state.isSwipeActive = false;
    dom.flashcard.style.transition = "";
    dom.flashcard.style.borderColor = "";
    dom.flashcard.style.transform = "";
    const threshold = 120;
    const moveX = state.touchMoveX;
    state.touchMoveX = 0;
    state.touchMoveY = 0;
    if (moveX > threshold) {
      submitCardGrade(4);
    } else if (moveX < -threshold) {
      submitCardGrade(1);
    }
  };

  dom.flashcard.addEventListener("touchend", endSwipe);
  dom.flashcard.addEventListener("touchcancel", endSwipe);
}

export function initKeyboardShortcuts() {
  window.addEventListener("keydown", e => {
    const studyView = document.getElementById("subview-study");
    if (!studyView || !studyView.classList.contains("active")) return;
    if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;

    // Ctrl+Z or Cmd+Z for Undo
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z" || e.code === "KeyZ")) {
      e.preventDefault();
      undoLastStudyCard();
      return;
    }

    if (e.code === "Space" || e.code === "Enter" || e.key === " ") {
      e.preventDefault();
      flipCard();
      return;
    }

    let grade = null;
    if (e.key === "1" || e.code === "Digit1" || e.code === "Numpad1") grade = 1;
    else if (e.key === "2" || e.code === "Digit2" || e.code === "Numpad2") grade = 2;
    else if (e.key === "3" || e.code === "Digit3" || e.code === "Numpad3") grade = 3;
    else if (e.key === "4" || e.code === "Digit4" || e.code === "Numpad4") grade = 4;

    if (grade !== null) {
      e.preventDefault();
      if (!state.isFlipped) {
        flipCard();
      }
      submitCardGrade(grade);
      return;
    }

    if (e.key === "r" || e.key === "R" || e.code === "KeyR") {
      const card = state.studySessionCards[state.currentCardIndex];
      if (card) speakCardText(state.isFlipped ? card.back : card.front, card);
    } else if (e.code === "Escape" || e.key === "Escape") {
      exitStudySession();
    }
  });
}

export function initStudyEventListeners() {
  if (dom.btnStartReview) dom.btnStartReview.addEventListener("click", () => startStudySession(false));
  if (dom.btnForceReview) dom.btnForceReview.addEventListener("click", () => startStudySession(true));
  if (dom.btnRestartStudy) dom.btnRestartStudy.addEventListener("click", () => {
    showModal("Restart Review Session?", "Do you want to restart reviewing this deck from the beginning?", () => {
      restartStudySession();
    });
  });

  const undoBtn = document.getElementById("btn-undo-study") || dom.btnUndoStudy;
  if (undoBtn) {
    undoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      undoLastStudyCard();
    });
  }

  const exitBtn = document.getElementById("btn-cancel-study");
  if (exitBtn) {
    exitBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      exitStudySession();
    };
  }

  if (dom.flashcard) {
    dom.flashcard.addEventListener("click", e => {
      if (e.target.closest(".btn-grade") || state.isSwipeActive) return;
      flipCard();
    });
  }

  if (dom.studyHintBar) {
    dom.studyHintBar.addEventListener("click", () => {
      if (!state.isFlipped) flipCard();
    });
  }
  
  // Grade button clicks: delegate on grading bar
  const gradingBar = document.getElementById("study-grading-bar");
  if (gradingBar) {
    gradingBar.addEventListener("click", e => {
      const btn = e.target.closest(".btn-grade");
      if (!btn) return;
      e.stopPropagation();
      const grade = parseInt(btn.getAttribute("data-grade"), 10);
      if (!isNaN(grade)) submitCardGrade(grade);
    });
  }

  if (dom.btnTtsSpeak) {
    dom.btnTtsSpeak.addEventListener("click", e => {
      e.stopPropagation();
      const card = state.studySessionCards[state.currentCardIndex];
      if (card) speakCardText(state.isFlipped ? card.back : card.front, card);
    });
  }
}



