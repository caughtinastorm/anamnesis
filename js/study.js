import { state } from "./state.js";
import { dom, showToast, showModal, switchView } from "./ui.js";
import { sanitizeHTML, shuffle, formatDeckSelectionLabel } from "./utils.js";
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

function updateUndoButtonState() {
  const undoBtn = document.getElementById("btn-undo-study") || dom.btnUndoStudy;
  if (undoBtn) {
    undoBtn.disabled = (studyUndoStack.length === 0);
  }
}

export function startStudySession(force = false, customCards = null, sessionTitle = null) {
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
      // If no cards are due, fall back to practicing all cards in the selection
      const allInDeck = filterCards();
      if (allInDeck.length > 0) {
        pool = [...allInDeck];
        currentSessionPool = [...pool];
        currentSessionIsForce = true;
        showToast("No cards due today — loaded all cards in practice mode", "info");
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

  const displayTitle = sessionTitle || formatDeckSelectionLabel(state.selectedDeck);
  state.studySessionInfo = {
    name: displayTitle,
    isForce: currentSessionIsForce,
    count: pool.length
  };

  if (dom.studyDeckBadge) {
    dom.studyDeckBadge.textContent = displayTitle;
    dom.studyDeckBadge.title = displayTitle;
  }

  state.studySessionCards = shuffle([...pool]);
  state.currentCardIndex = 0;
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

  state.studySessionCards = shuffle([...pool]);
  state.currentCardIndex = 0;
  state.isFlipped = false;
  state.isSwipeActive = false;
  state.touchMoveX = 0;
  state.touchMoveY = 0;
  isGradingInProgress = false;

  if (dom.studyDeckBadge && state.studySessionInfo?.name) {
    dom.studyDeckBadge.textContent = state.studySessionInfo.name;
  }

  renderCurrentStudyCard();
  showToast(`Restarted session (${state.studySessionCards.length} cards)`, "info");
}

function updateGradeButtonIntervals(card) {
  if (!card) return;
  const proj = calculateProjectedIntervals(card);
  const int1 = document.getElementById("grade-interval-1");
  const int2 = document.getElementById("grade-interval-2");
  const int3 = document.getElementById("grade-interval-3");
  const int4 = document.getElementById("grade-interval-4");
  if (int1) int1.textContent = proj.again;
  if (int2) int2.textContent = proj.hard;
  if (int3) int3.textContent = proj.good;
  if (int4) int4.textContent = proj.easy;
}

export function renderCurrentStudyCard() {
  updateUndoButtonState();

  if (state.currentCardIndex >= state.studySessionCards.length) {
    finishStudySession();
    return;
  }
  const card = state.studySessionCards[state.currentCardIndex];
  if (!card) {
    finishStudySession();
    return;
  }

  state.isFlipped = false;
  state.isSwipeActive = false;
  state.touchMoveX = 0;
  state.touchMoveY = 0;
  isGradingInProgress = false;

  if (dom.studyProgressText) {
    dom.studyProgressText.textContent = `Card ${state.currentCardIndex + 1} of ${state.studySessionCards.length}`;
  }

  if (dom.studyProgressBar) {
    const pct = ((state.currentCardIndex) / state.studySessionCards.length) * 100;
    dom.studyProgressBar.style.width = `${pct}%`;
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
    dom.flashcard.style.transform = "none";
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
  if (dom.flashcard) dom.flashcard.classList.toggle("flipped", state.isFlipped);
  if (dom.studyHintBar) dom.studyHintBar.classList.toggle("hidden", state.isFlipped);
  if (dom.studyGradingBar) dom.studyGradingBar.classList.toggle("hidden", !state.isFlipped);
}

export async function submitCardGrade(grade) {
  if (isGradingInProgress) return;
  if (state.currentCardIndex >= state.studySessionCards.length) return;

  const card = state.studySessionCards[state.currentCardIndex];
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

  let updated = card;
  try {
    updated = calculateFSRS5(card, fsrsRating, now);
  } catch (err) {
    console.error("FSRS calculation error:", err);
  }

  // Push to Undo Stack
  studyUndoStack.push({
    cardBefore,
    cardIndex: state.currentCardIndex,
    wasPushedAgain: (fsrsRating === Rating.Again),
    logId
  });
  updateUndoButtonState();

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
  const allIdx = state.allCards.findIndex(c => c.id === card.id);
  if (allIdx !== -1) {
    state.allCards[allIdx] = { ...state.allCards[allIdx], ...updated };
  }
  invalidateStatsCache();

  try {
    await db.saveCard(updated);
  } catch (e) {
    console.error("Error saving graded card:", e);
  }

  try {
    recordDailyReview();
  } catch (e) {}

  if (fsrsRating === Rating.Again) {
    state.studySessionCards.push(updated);
  }
  onSyncRequest(2500);

  const anim = fsrsRating >= Rating.Good ? "slide-out-right-anim" : "slide-out-left-anim";
  if (dom.flashcard) {
    dom.flashcard.style.transform = "";
    dom.flashcard.classList.add(anim);
  }

  setTimeout(() => {
    if (dom.flashcard) dom.flashcard.classList.remove(anim);
    state.currentCardIndex++;
    isGradingInProgress = false;
    renderCurrentStudyCard();
  }, 220);
}

/**
 * Undo last review action (Ctrl+Z or Return button)
 */
export async function undoLastStudyCard() {
  if (isGradingInProgress || studyUndoStack.length === 0) return;

  const last = studyUndoStack.pop();
  updateUndoButtonState();

  if (!last || !last.cardBefore) return;

  // If card was re-appended for 'Again', remove the appended instance from pool
  if (last.wasPushedAgain && state.studySessionCards.length > last.cardIndex + 1) {
    const lastItem = state.studySessionCards[state.studySessionCards.length - 1];
    if (lastItem && lastItem.id === last.cardBefore.id) {
      state.studySessionCards.pop();
    }
  }

  // Restore session card and in-memory allCards
  state.studySessionCards[last.cardIndex] = last.cardBefore;
  const allIdx = state.allCards.findIndex(c => c.id === last.cardBefore.id);
  if (allIdx !== -1) {
    state.allCards[allIdx] = { ...last.cardBefore };
  }
  invalidateStatsCache();

  // Revert in IndexedDB and prune review log
  try {
    await db.saveCard(last.cardBefore);
    if (last.logId) {
      await db.deleteReviewLog(last.logId);
    }
  } catch (e) {
    console.error("Error saving reverted card during undo:", e);
  }

  state.currentCardIndex = last.cardIndex;
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

  if (dom.flashcard) {
    dom.flashcard.style.transition = "none";
    dom.flashcard.className = "flashcard";
    dom.flashcard.style.transform = "none";
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

  const deckName = state.studySessionInfo?.name || "this collection";
  const count = state.studySessionCards.length;

  showModal(
    "🎉 Deck Completed!",
    `Great job! You finished all ${count} cards in ${deckName}. Would you like to review this deck again or return to dashboard?`,
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
    state.isSwipeActive = true;
    dom.flashcard.style.transition = "none";
  }, { passive: true });

  dom.flashcard.addEventListener("touchmove", e => {
    if (!state.isSwipeActive || isGradingInProgress) return;
    const t = e.touches[0];
    state.touchMoveX = t.clientX - state.touchStartX;
    state.touchMoveY = t.clientY - state.touchStartY;
    if (Math.abs(state.touchMoveX) > Math.abs(state.touchMoveY) && e.cancelable) e.preventDefault();
    const rot = state.touchMoveX * 0.05;
    dom.flashcard.style.transform = `rotateY(180deg) translate3d(${state.touchMoveX}px, ${state.touchMoveY}px, 0) rotate(${rot}deg)`;
    dom.flashcard.style.borderColor = state.touchMoveX > 40 ? "var(--accent-color)" : state.touchMoveX < -40 ? "var(--danger-color)" : "var(--panel-border)";
  }, { passive: false });

  const endSwipe = () => {
    if (!state.isSwipeActive) return;
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



