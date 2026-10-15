import { cardState, selectionState, studyState, gestureState } from "./state.js";
import { dom, showToast, showModal, showPracticeModeModal, switchView } from "./ui.js";
import { sanitizeHTML, shuffle, formatDeckSelectionLabel, limitText } from "./utils.js";
import { Rating, calculateProjectedIntervals, getTargetRetention } from "../fsrs.js";
import { PRACTICE_CONFIG, createPracticeSession, pickNextPracticeCard, processPracticeGrade, skipPracticeCard } from "./domain/practice.js";
export { PRACTICE_CONFIG, createPracticeSession, pickNextPracticeCard, processPracticeGrade, skipPracticeCard } from "./domain/practice.js";
import { gradeReview, undoReview } from "./services/reviews.js";
import { loadCardsFromDB } from "./cards.js";
import { recordDailyReview, filterCards, invalidateStatsCache } from "./dashboard.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

let currentSessionPool = [];
let currentSessionIsForce = false;
let isGradingInProgress = false;
let studyUndoStack = [];
let currentCardStartTime = 0;

let practiceSession = null;
export const isStudyBusy = () => isGradingInProgress;
export const getPracticeSession = () => practiceSession;

export function updatePracticeMasteryBadges(streak = 0, target = 3) {
  const pills = [
    document.getElementById("practice-mastery-pill-front") || dom.practiceMasteryPillFront,
    document.getElementById("practice-mastery-pill-back") || dom.practiceMasteryPillBack
  ].filter(Boolean);

  if (pills.length === 0) return;

  if (!currentSessionIsForce || !practiceSession || target <= 1) {
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
  if (isGradingInProgress) return;
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
    const due = cardState.dueCards || [];
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

  const cap = parseInt(localStorage.getItem("app-review-cap") ?? "10", 10);
  if (cap > 0 && pool.length > cap) {
    const originalCount = pool.length;
    pool = pool.slice(0, cap);
    showToast(`A ${cap}-card session. You can always do more later.`, "info");
  }

  const isFSRSEnabled = (recordFSRS !== null) ? recordFSRS : true;
  const rawTitle = sessionTitle || formatDeckSelectionLabel(selectionState.selectedDeck);
  const displayTitle = limitText(rawTitle, 24);
  studyState.studySessionInfo = {
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
    practiceSession = createPracticeSession(shuffledPool, { ...PRACTICE_CONFIG, TARGET_STREAK: 1 });
    const firstCard = pickNextPracticeCard(practiceSession);
    practiceSession.currentCard = firstCard;
    studyState.studySessionCards = firstCard ? [firstCard] : [];
    studyState.currentCardIndex = 0;
  } else {
    practiceSession = null;
    studyState.studySessionCards = shuffle([...pool]);
    studyState.currentCardIndex = 0;
  }

  studyState.isFlipped = false;
  document.querySelector('.card-front')?.setAttribute('aria-hidden', 'false');
  document.querySelector('.card-back')?.setAttribute('aria-hidden', 'true');
  dom.flashcard?.setAttribute('aria-label', 'Show answer');
  gestureState.isSwipeActive = false;
  gestureState.touchMoveX = 0;
  gestureState.touchMoveY = 0;
  isGradingInProgress = false;

  if (dom.subviewDashboard) dom.subviewDashboard.classList.remove("active");
  if (dom.subviewStudy) dom.subviewStudy.classList.add("active");
  renderCurrentStudyCard();
}

export function restartStudySession() {
  if (isGradingInProgress) return;
  let pool = (currentSessionPool.length > 0 ? currentSessionPool : filterCards())
    .map(card => cardState.allCards.find(current => current.id === card.id) || card).filter(card => !card.deleted);
  const cap = Number.parseInt(localStorage.getItem("app-review-cap") ?? "10", 10);
  if (cap > 0) pool = pool.slice(0, cap);
  if (!pool || pool.length === 0) {
    showToast("No cards available to review", "info");
    exitStudySession();
    return;
  }
  studyUndoStack = [];
  updateUndoButtonState();

  const isPracticeOnly = studyState.studySessionInfo && studyState.studySessionInfo.recordFSRS === false;

  if (currentSessionIsForce) {
    const shuffledPool = shuffle([...pool]);
    practiceSession = createPracticeSession(shuffledPool, { ...PRACTICE_CONFIG, TARGET_STREAK: 1 });
    const firstCard = pickNextPracticeCard(practiceSession);
    practiceSession.currentCard = firstCard;
    studyState.studySessionCards = firstCard ? [firstCard] : [];
    studyState.currentCardIndex = 0;
  } else {
    practiceSession = null;
    studyState.studySessionCards = shuffle([...pool]);
    studyState.currentCardIndex = 0;
  }

  studyState.isFlipped = false;
  document.querySelector('.card-front')?.setAttribute('aria-hidden', 'false');
  document.querySelector('.card-back')?.setAttribute('aria-hidden', 'true');
  dom.flashcard?.setAttribute('aria-label', 'Show answer');
  gestureState.isSwipeActive = false;
  gestureState.touchMoveX = 0;
  gestureState.touchMoveY = 0;
  isGradingInProgress = false;

  if (dom.studyDeckBadge && studyState.studySessionInfo?.name) {
    dom.studyDeckBadge.textContent = currentSessionIsForce
      ? `${studyState.studySessionInfo.name} (Practice)`
      : studyState.studySessionInfo.name;
    dom.studyDeckBadge.title = currentSessionIsForce
      ? (isPracticeOnly
          ? `${studyState.studySessionInfo.fullName || studyState.studySessionInfo.name} — Practice Mode (FSRS untouched)`
          : `${studyState.studySessionInfo.fullName || studyState.studySessionInfo.name} — Practice Mode (FSRS recorded)`)
      : (studyState.studySessionInfo.fullName || studyState.studySessionInfo.name);
  }

  renderCurrentStudyCard();
  showToast(`Restarted session (${pool.length} cards)`, "info");
}

function updateGradeButtonIntervals(card) {
  if (!card) return;
  const isPracticeOnly = studyState.studySessionInfo && studyState.studySessionInfo.recordFSRS === false;
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

  const proj = calculateProjectedIntervals(card, Date.now(), getTargetRetention());
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
    studyState.studySessionCards = [card];
    studyState.currentCardIndex = 0;
  } else {
    if (studyState.currentCardIndex >= studyState.studySessionCards.length) {
      finishStudySession();
      return;
    }
    card = studyState.studySessionCards[studyState.currentCardIndex];
    if (!card) {
      finishStudySession();
      return;
    }
  }

  studyState.isFlipped = false;
  document.querySelector('.card-front')?.setAttribute('aria-hidden', 'false');
  document.querySelector('.card-back')?.setAttribute('aria-hidden', 'true');
  dom.flashcard?.setAttribute('aria-label', 'Show answer');
  gestureState.isSwipeActive = false;
  gestureState.touchMoveX = 0;
  gestureState.touchMoveY = 0;
  isGradingInProgress = false;
  currentCardStartTime = Date.now();
  const extraRatings = document.querySelector(".extra-ratings");
  if (extraRatings) extraRatings.open = false;

  if (currentSessionIsForce && practiceSession) {
    const total = practiceSession.totalCards;
    const graduated = practiceSession.graduatedCards.length;
    const active = practiceSession.workingSet.length;
    const target = practiceSession.targetStreak || 3;
    const deferredCount = practiceSession.deferredQueue ? practiceSession.deferredQueue.length : 0;

    if (dom.studyProgressText) {
      const parkedText = deferredCount > 0 ? `, ${deferredCount} parked` : "";
      dom.studyProgressText.textContent = `${graduated} of ${total} remembered`;
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
      dom.studyProgressText.textContent = `Card ${studyState.currentCardIndex + 1} of ${studyState.studySessionCards.length}`;
    }

    if (dom.studyProgressBar) {
      const pct = ((studyState.currentCardIndex) / studyState.studySessionCards.length) * 100;
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
  studyState.isFlipped = !studyState.isFlipped;
  document.querySelector('.card-front')?.setAttribute('aria-hidden', String(studyState.isFlipped));
  document.querySelector('.card-back')?.setAttribute('aria-hidden', String(!studyState.isFlipped));
  dom.flashcard?.setAttribute('aria-label', studyState.isFlipped ? 'Show question' : 'Show answer');
  if (dom.flashcard) {
    dom.flashcard.style.transform = "";
    dom.flashcard.classList.toggle("flipped", studyState.isFlipped);
  }
  if (dom.studyHintBar) dom.studyHintBar.classList.toggle("hidden", studyState.isFlipped);
  if (dom.studyGradingBar) dom.studyGradingBar.classList.toggle("hidden", !studyState.isFlipped);
}

export async function submitCardGrade(grade) {
  if (isGradingInProgress || (currentSessionIsForce && practiceSession?.workingSet.length === 0)) return;

  const card = (currentSessionIsForce && practiceSession)
    ? practiceSession.currentCard
    : studyState.studySessionCards[studyState.currentCardIndex];

  if (!card) return;

  isGradingInProgress = true;

  let fsrsRating = Rating.Good;
  if (grade === 1) fsrsRating = Rating.Again;
  else if (grade === 2) fsrsRating = Rating.Hard;
  else if (grade === 3) fsrsRating = Rating.Good;
  else if (grade === 4) fsrsRating = Rating.Easy;

  const now = Date.now();
  const durationMs = currentCardStartTime > 0 ? Math.max(100, Math.min(300000, now - currentCardStartTime)) : 0;
  const cardBefore = JSON.parse(JSON.stringify(card));
  const isPracticeOnly = studyState.studySessionInfo?.recordFSRS === false;
  let receipt;
  try {
    receipt = await gradeReview(card, fsrsRating, {
      now, durationMs, mode: currentSessionIsForce ? "practice" : "scheduled",
      recordFSRS: !isPracticeOnly
    });
  } catch (error) {
    isGradingInProgress = false;
    showToast(error.message || "Unable to save review. Please retry.", "error");
    return;
  }

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
        deferredQueue: [...(practiceSession.deferredQueue || [])],
        graduatedCards: [...practiceSession.graduatedCards],
        cardStates: cardStatesCopy
      },
      receipt
    });
  } else {
    studyUndoStack.push({
      isPractice: false,
      cardBefore,
      cardIndex: studyState.currentCardIndex,
      wasPushedAgain: (fsrsRating === Rating.Again),
      receipt
    });
  }
  updateUndoButtonState();

  const updated = receipt.updated;
  if (!isPracticeOnly) {
    const allIdx = cardState.allCards.findIndex(c => c.id === card.id);
    if (allIdx !== -1) cardState.allCards[allIdx] = updated;
    invalidateStatsCache();
    if (practiceSession) {
      const wsIdx = practiceSession.workingSet.findIndex(c => c.id === card.id);
      if (wsIdx !== -1) practiceSession.workingSet[wsIdx] = updated;
    }
    await recordDailyReview();
    onSyncRequest();
  }

  // Visual card exit animation
  animateCardExit(fsrsRating);

  if (currentSessionIsForce && practiceSession) {
    processPracticeGrade(practiceSession, card, fsrsRating);

    if (practiceSession.workingSet.length === 0) {
      setTimeout(() => {
        isGradingInProgress = false;
        finishStudySession();
      }, 180);
      return;
    }

    const nextCard = pickNextPracticeCard(practiceSession);
    practiceSession.currentCard = nextCard;
    studyState.studySessionCards = nextCard ? [nextCard] : [];
    studyState.currentCardIndex = 0;

    setTimeout(() => {
      renderCurrentStudyCard();
    }, 180);
  } else {
    // Standard daily review
    if (fsrsRating === Rating.Again) {
      studyState.studySessionCards.push({ ...updated });
    }

    studyState.currentCardIndex++;
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

  const last = studyUndoStack[studyUndoStack.length - 1];
  isGradingInProgress = true;
  let restored;
  try {
    restored = last.receipt ? await undoReview(last.receipt) : last.cardBefore;
  } catch (error) {
    isGradingInProgress = false;
    showToast(error.message || "Unable to undo. Please retry.", "error");
    return;
  }
  studyUndoStack.pop();
  const previous = studyUndoStack[studyUndoStack.length - 1];
  if (last.receipt?.recordFSRS && previous?.receipt?.updated.id === restored.id) {
    previous.receipt.updated = structuredClone(restored);
  }
  updateUndoButtonState();

  if (!last || !last.cardBefore) { isGradingInProgress = false; return; }

  if (last.isPractice && practiceSession) {
    practiceSession.currentTurn = last.practiceSnapshot.currentTurn;
    practiceSession.lastCardId = last.practiceSnapshot.lastCardId;
    practiceSession.currentCard = last.practiceSnapshot.currentCard;
    practiceSession.workingSet = [...last.practiceSnapshot.workingSet];
    practiceSession.pendingQueue = [...last.practiceSnapshot.pendingQueue];
    practiceSession.deferredQueue = [...(last.practiceSnapshot.deferredQueue || [])];
    practiceSession.graduatedCards = [...last.practiceSnapshot.graduatedCards];
    practiceSession.cardStates = last.practiceSnapshot.cardStates;
    if (last.receipt?.recordFSRS) {
      practiceSession.workingSet = practiceSession.workingSet.map(c => c.id === restored.id ? restored : c);
      if (practiceSession.currentCard?.id === restored.id) practiceSession.currentCard = restored;
    }

    studyState.studySessionCards = practiceSession.currentCard ? [practiceSession.currentCard] : [];
    studyState.currentCardIndex = 0;
  } else {
    if (last.wasSkipped) {
      studyState.studySessionCards.pop();
      studyState.studySessionCards.splice(last.cardIndex, 0, last.cardBefore);
      studyState.currentCardIndex = last.cardIndex;
    } else {
      // If card was re-appended for 'Again', remove the appended instance from pool
      if (last.wasPushedAgain && studyState.studySessionCards.length > last.cardIndex + 1) {
        const lastItem = studyState.studySessionCards[studyState.studySessionCards.length - 1];
        if (lastItem && (lastItem.id || lastItem._id) === (last.cardBefore.id || last.cardBefore._id)) {
          studyState.studySessionCards.pop();
        }
      }
      studyState.studySessionCards[last.cardIndex] = restored;
      studyState.currentCardIndex = last.cardIndex;
    }
  }

  // Restore session card and in-memory allCards if FSRS was tracked
  const allIdx = cardState.allCards.findIndex(c => (c.id || c._id) === (last.cardBefore.id || last.cardBefore._id));
  if (allIdx !== -1 && last.receipt?.recordFSRS) {
    cardState.allCards[allIdx] = { ...restored };
  }
  invalidateStatsCache();

  await recordDailyReview();
  if (last.receipt?.recordFSRS) onSyncRequest();

  studyState.isFlipped = false;
  isGradingInProgress = false;
  renderCurrentStudyCard();
  showToast("Reverted last action", "info");
}

/**
 * Defers/parks the currently presented card until the end of the study/practice session.
 * Prevents leech cards from jamming the 4-card practice buffer.
 */
export function skipCurrentCard() {
  if (isGradingInProgress) return;

  const card = (currentSessionIsForce && practiceSession)
    ? practiceSession.currentCard
    : studyState.studySessionCards[studyState.currentCardIndex];

  if (!card) return;

  if (currentSessionIsForce && practiceSession) {
    const totalRemaining = practiceSession.workingSet.length + 
      (practiceSession.pendingQueue ? practiceSession.pendingQueue.length : 0) + 
      (practiceSession.deferredQueue ? practiceSession.deferredQueue.length : 0);
      
    if (totalRemaining <= 1) {
      showToast("Only 1 card left in session", "info");
      return;
    }

    // Save undo state
    const cardStatesCopy = new Map();
    for (const [k, v] of practiceSession.cardStates.entries()) {
      cardStatesCopy.set(k, { ...v, history: [...(v.history || [])] });
    }
    studyUndoStack.push({
      isPractice: true,
      wasSkipped: true,
      cardBefore: JSON.parse(JSON.stringify(card)),
      practiceSnapshot: {
        currentTurn: practiceSession.currentTurn,
        lastCardId: practiceSession.lastCardId,
        currentCard: practiceSession.currentCard,
        workingSet: [...practiceSession.workingSet],
        pendingQueue: [...(practiceSession.pendingQueue || [])],
        deferredQueue: [...(practiceSession.deferredQueue || [])],
        graduatedCards: [...practiceSession.graduatedCards],
        cardStates: cardStatesCopy
      },
      logId: null
    });
    updateUndoButtonState();

    skipPracticeCard(practiceSession, card);

    if (practiceSession.workingSet.length === 0) {
      if (practiceSession.deferredQueue && practiceSession.deferredQueue.length > 0) {
        while (practiceSession.deferredQueue.length > 0 && practiceSession.workingSet.length < practiceSession.batchSize) {
          practiceSession.workingSet.push(practiceSession.deferredQueue.shift());
        }
      } else {
        finishStudySession();
        return;
      }
    }

    const nextCard = pickNextPracticeCard(practiceSession);
    practiceSession.currentCard = nextCard;
    studyState.studySessionCards = nextCard ? [nextCard] : [];
    studyState.currentCardIndex = 0;

    animateCardExit(Rating.Easy);
    setTimeout(() => {
      renderCurrentStudyCard();
      showToast("Card parked until end of session", "info");
    }, 180);
  } else {
    // Normal review: move current card to the end of the session cards
    if (studyState.studySessionCards.length <= 1) {
      showToast("Only 1 card left in session", "info");
      return;
    }

    studyUndoStack.push({
      isPractice: false,
      wasSkipped: true,
      cardBefore: JSON.parse(JSON.stringify(card)),
      cardIndex: studyState.currentCardIndex,
      wasPushedAgain: false,
      logId: null
    });
    updateUndoButtonState();

    const removed = studyState.studySessionCards.splice(studyState.currentCardIndex, 1)[0];
    studyState.studySessionCards.push(removed);

    animateCardExit(Rating.Easy);
    setTimeout(() => {
      renderCurrentStudyCard();
      showToast("Card moved to end of session", "info");
    }, 180);
  }
}

export function exitStudySession() {
  if (isGradingInProgress) { showToast("Finishing your review save. Please try again in a moment.", "info"); return false; }
  const subStudy = document.getElementById("subview-study") || dom.subviewStudy;
  const subDash = document.getElementById("subview-dashboard") || dom.subviewDashboard;
  if (subStudy) subStudy.classList.remove("active");
  if (subDash) subDash.classList.add("active");
  isGradingInProgress = false;
  gestureState.isSwipeActive = false;
  studyState.isFlipped = false;
  gestureState.touchMoveX = 0;
  gestureState.touchMoveY = 0;
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
  return true;
}

function finishStudySession() {
  isGradingInProgress = false;
  if (dom.studyProgressBar) dom.studyProgressBar.style.width = "100%";
  onSyncRequest();

  const deckName = studyState.studySessionInfo?.fullName || studyState.studySessionInfo?.name || "this collection";
  const count = (currentSessionIsForce && practiceSession)
    ? practiceSession.totalCards
    : (studyState.studySessionInfo?.count || studyState.studySessionCards.length);
  const isPracticeOnly = studyState.studySessionInfo && studyState.studySessionInfo.recordFSRS === false;

  let modalTitle = "Nicely done.";
  let modalMsg = `${count} ${count === 1 ? "card" : "cards"} reviewed. A little more remembered. Your progress is saved.`;

  if (currentSessionIsForce) {
    modalTitle = "Practice complete.";
    modalMsg = `${count} ${count === 1 ? "card" : "cards"} practiced. A small step worth taking.`;
  }

  showModal(
    modalTitle,
    modalMsg,
    () => {
      exitStudySession();
    },
    async () => {
      if (currentSessionIsForce) { restartStudySession(); return; }
      await loadCardsFromDB();
      if (cardState.dueCards.length) startStudySession(false);
      else startStudySession(true, null, null, false);
    },
    {
      confirmText: "Back to Today",
      confirmClass: "btn btn-primary",
      cancelText: "Do another session",
      cancelClass: "btn btn-secondary",
      onDismiss: () => {
        exitStudySession();
      }
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
    if (e.touches.length !== 1 || !studyState.isFlipped || isGradingInProgress) return;
    const t = e.touches[0];
    gestureState.touchStartX = t.clientX;
    gestureState.touchStartY = t.clientY;
    gestureState.touchMoveX = 0;
    gestureState.touchMoveY = 0;
    gestureState.isSwipeActive = false;
  }, { passive: true });

  dom.flashcard.addEventListener("touchmove", e => {
    if (!studyState.isFlipped || isGradingInProgress) return;
    const t = e.touches[0];
    gestureState.touchMoveX = t.clientX - gestureState.touchStartX;
    gestureState.touchMoveY = t.clientY - gestureState.touchStartY;

    if (!gestureState.isSwipeActive) {
      if (Math.abs(gestureState.touchMoveX) > 10 && Math.abs(gestureState.touchMoveX) > Math.abs(gestureState.touchMoveY)) {
        gestureState.isSwipeActive = true;
        dom.flashcard.style.transition = "none";
      } else {
        return;
      }
    }

    if (Math.abs(gestureState.touchMoveX) > Math.abs(gestureState.touchMoveY) && e.cancelable) e.preventDefault();
    const rot = gestureState.touchMoveX * 0.05;
    dom.flashcard.style.transform = `rotateY(180deg) translate3d(${gestureState.touchMoveX}px, ${gestureState.touchMoveY}px, 0) rotate(${rot}deg)`;
    dom.flashcard.style.borderColor = gestureState.touchMoveX > 40 ? "var(--accent-color)" : gestureState.touchMoveX < -40 ? "var(--danger-color)" : "var(--panel-border)";
  }, { passive: false });

  const endSwipe = () => {
    if (!gestureState.isSwipeActive) {
      gestureState.touchMoveX = 0;
      gestureState.touchMoveY = 0;
      return;
    }
    gestureState.isSwipeActive = false;
    dom.flashcard.style.transition = "";
    dom.flashcard.style.borderColor = "";
    dom.flashcard.style.transform = "";
    const threshold = 120;
    const moveX = gestureState.touchMoveX;
    gestureState.touchMoveX = 0;
    gestureState.touchMoveY = 0;
    if (moveX > threshold) {
      submitCardGrade(3);
    } else if (moveX < -threshold) {
      submitCardGrade(1);
    }
  };

  dom.flashcard.addEventListener("touchend", endSwipe);
  dom.flashcard.addEventListener("touchcancel", endSwipe);
}

export function initKeyboardShortcuts() {
  window.addEventListener("keydown", e => {
    if (document.querySelector(".modal-overlay:not(.hidden)")) return;
    const studyView = document.getElementById("subview-study");
    if (!studyView || !studyView.classList.contains("active")) return;
    if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
    if (e.target.closest?.('button, summary') && (e.key === 'Enter' || e.key === ' ' || e.code === 'Space')) return;

    // Ctrl+Z or Cmd+Z for Undo
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z" || e.code === "KeyZ")) {
      e.preventDefault();
      undoLastStudyCard();
      return;
    }

    // S key: skip/park card to end of session
    if (e.key === "s" || e.key === "S" || e.code === "KeyS") {
      e.preventDefault();
      skipCurrentCard();
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
      if (!studyState.isFlipped) {
        flipCard();
      }
      submitCardGrade(grade);
      return;
    }

    if (e.key === "r" || e.key === "R" || e.code === "KeyR") {
      const card = studyState.studySessionCards[studyState.currentCardIndex];
      if (card) speakCardText(studyState.isFlipped ? card.back : card.front, card);
    } else if (e.code === "Escape" || e.key === "Escape") {
      exitStudySession();
    }
  });
}

export function initStudyEventListeners() {
  if (dom.btnStartReview) dom.btnStartReview.addEventListener("click", () => startStudySession(false));
  if (dom.btnForceReview) dom.btnForceReview.addEventListener("click", () => startStudySession(true, null, null, false));
  if (dom.btnRestartStudy) dom.btnRestartStudy.addEventListener("click", () => {
    showModal(
      "Restart Review Session?",
      "Do you want to restart reviewing this collection from the beginning?",
      () => {
        restartStudySession();
      },
      null,
      {
        confirmText: "Restart Session",
        confirmClass: "btn btn-primary",
        cancelText: "Keep Reviewing"
      }
    );
  });

  const skipBtn = document.getElementById("btn-skip-card") || dom.btnSkipCard;
  if (skipBtn) {
    skipBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      skipCurrentCard();
    });
  }

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
      if (e.target.closest(".btn-grade") || gestureState.isSwipeActive) return;
      flipCard();
    });
  }

  if (dom.studyHintBar) {
    dom.studyHintBar.addEventListener("click", () => {
      if (!studyState.isFlipped) flipCard();
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
      const card = studyState.studySessionCards[studyState.currentCardIndex];
      if (card) speakCardText(studyState.isFlipped ? card.back : card.front, card);
    });
  }
}



