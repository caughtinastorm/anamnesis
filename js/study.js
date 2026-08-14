import { state } from "./state.js";
import { dom, showToast, showModal, switchView } from "./ui.js";
import { sanitizeHTML, shuffle, formatDeckSelectionLabel } from "./utils.js";
import { calculateFSRS5, Rating, calculateProjectedIntervals } from "../fsrs.js";
import * as db from "../db.js";
import { loadCardsFromDB } from "./cards.js";
import { recordDailyReview, filterCards } from "./dashboard.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

let currentSessionPool = [];
let currentSessionIsForce = false;
let isGradingInProgress = false;

export function startStudySession(force = false, customCards = null, sessionTitle = null) {
  let pool = [];
  currentSessionIsForce = force;

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
  state.studySessionCards = shuffle([...pool]);
  state.currentCardIndex = 0;
  state.isFlipped = false;
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

  if (dom.flashcard) dom.flashcard.className = "flashcard";
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

  const updated = calculateFSRS5(card, fsrsRating);

  // Update in-memory allCards immediately
  const allIdx = state.allCards.findIndex(c => c.id === card.id);
  if (allIdx !== -1) {
    state.allCards[allIdx] = { ...state.allCards[allIdx], ...updated };
  }

  try {
    await db.saveCard(updated);
    recordDailyReview();
    if (fsrsRating === Rating.Again) {
      state.studySessionCards.push(updated);
    }
    onSyncRequest(2500);

    const anim = fsrsRating >= Rating.Good ? "slide-out-right-anim" : "slide-out-left-anim";
    if (dom.flashcard) dom.flashcard.classList.add(anim);

    setTimeout(() => {
      if (dom.flashcard) dom.flashcard.classList.remove(anim);
      state.currentCardIndex++;
      isGradingInProgress = false;
      renderCurrentStudyCard();
    }, 220);
  } catch (e) {
    console.error("Error saving graded card:", e);
    showToast("Error saving progress locally", "error");
    isGradingInProgress = false;
  }
}

export function exitStudySession() {
  if (dom.subviewStudy) dom.subviewStudy.classList.remove("active");
  if (dom.subviewDashboard) dom.subviewDashboard.classList.add("active");
  isGradingInProgress = false;
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

function renderCardContent(text, isBack = false) {
  if (!text) return "";
  const hasBrackets = /\[([^\]]+)\]/.test(text);
  const hasCloze = /\{\{c\d+::([^}]+)\}\}/.test(text);
  if (hasBrackets || hasCloze) {
    const html = sanitizeHTML(text);
    if (isBack) {
      return html.replace(/\{\{c\d+::([^}]+)\}\}/g, `<span class="cloze-answer">$1</span>`)
                 .replace(/\[([^\]]+)\]/g, `<span class="cloze-answer">$1</span>`);
    } else {
      return html.replace(/\{\{c\d+::([^}]+)\}\}/g, `<span class="cloze-blank">[ ... ]</span>`)
                 .replace(/\[([^\]]+)\]/g, `<span class="cloze-blank">[ ... ]</span>`);
    }
  }
  return sanitizeHTML(text);
}

export function speakCardText(text) {
  if (!("speechSynthesis" in window)) { showToast("Speech not supported", "info"); return; }
  window.speechSynthesis.cancel();
  const clean = text.replace(/<[^>]+>/g, "").replace(/\[([^\]]+)\]/g, "$1").replace(/\{\{c\d+::([^}]+)\}\}/g, "$1").trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  const lang = localStorage.getItem("app-speech-lang") || "auto";
  if (lang !== "auto") { u.lang = lang; }
  else {
    if (/[áéíóúüñ¿¡]/i.test(clean)) u.lang = "es-ES";
    else if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(clean)) u.lang = "ja-JP";
    else if (/[а-яА-ЯёЁ]/.test(clean)) u.lang = "ru-RU";
    else if (/[äöüß]/i.test(clean)) u.lang = "de-DE";
    else if (/[éàèùâêîôûëïç]/i.test(clean)) u.lang = "fr-FR";
  }
  window.speechSynthesis.speak(u);
}

export function initTouchGestures() {
  if (!dom.flashcard) return;
  dom.flashcard.addEventListener("touchstart", e => {
    if (e.touches.length !== 1 || !state.isFlipped || isGradingInProgress) return;
    const t = e.touches[0];
    state.touchStartX = t.clientX; state.touchStartY = t.clientY;
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

  dom.flashcard.addEventListener("touchend", () => {
    if (!state.isSwipeActive) return;
    state.isSwipeActive = false;
    dom.flashcard.style.transition = ""; dom.flashcard.style.borderColor = "";
    const threshold = 120;
    if (state.touchMoveX > threshold) { dom.flashcard.style.transform = ""; submitCardGrade(4); }
    else if (state.touchMoveX < -threshold) { dom.flashcard.style.transform = ""; submitCardGrade(1); }
    else dom.flashcard.style.transform = "rotateY(180deg)";
    state.touchMoveX = 0; state.touchMoveY = 0;
  });
}

export function initKeyboardShortcuts() {
  document.addEventListener("keydown", e => {
    if (!dom.subviewStudy?.classList.contains("active")) return;
    if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;

    if (e.code === "Space" || e.code === "Enter") {
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
      if (card) speakCardText(state.isFlipped ? card.back : card.front);
    } else if (e.code === "Escape") {
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
  if (dom.btnCancelStudy) dom.btnCancelStudy.addEventListener("click", () => exitStudySession());
  if (dom.flashcard) {
    dom.flashcard.addEventListener("click", e => {
      if (e.target.closest(".btn-grade") || state.isSwipeActive) return;
      flipCard();
    });
  }
  
  // Grade button clicks: delegate on grading bar or per button
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
      if (card) speakCardText(state.isFlipped ? card.back : card.front);
    });
  }
}


