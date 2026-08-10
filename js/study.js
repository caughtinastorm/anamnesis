import { state } from "./state.js";
import { dom, showToast, showModal } from "./ui.js";
import { sanitizeHTML, shuffle } from "./utils.js";
import { calculateFSRS5, Rating } from "../fsrs.js";
import * as db from "../db.js";
import { recordDailyReview, loadCardsFromDB, filterCards } from "./dashboard.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

let currentSessionPool = [];
let currentSessionIsForce = false;

export function startStudySession(force = false, customCards = null) {
  let pool = [];
  currentSessionIsForce = force;

  if (customCards && Array.isArray(customCards)) {
    pool = customCards.filter(c => !c.deleted);
    currentSessionPool = [...pool];
  } else if (force) {
    pool = filterCards();
    currentSessionPool = [...pool];
  } else {
    pool = state.dueCards;
    currentSessionPool = [...filterCards()]; // Fallback to all cards in deck for restart
  }

  if (!pool || pool.length === 0) {
    showToast(force ? "No cards found in this collection!" : "No cards due for review! Use 'Practice All Cards' to review anytime.", "info");
    return;
  }

  const cap = parseInt(localStorage.getItem("app-review-cap") || "0", 10);
  if (cap > 0 && pool.length > cap && !force) {
    const originalCount = pool.length;
    pool = pool.slice(0, cap);
    showToast(`Vacation Mode: Loaded ${cap} of ${originalCount} due cards`, "info");
  } else if (force) {
    showToast(`Reviewing all ${pool.length} cards (unlimited mode)`, "info");
  }

  state.studySessionCards = shuffle([...pool]);
  state.currentCardIndex = 0;
  state.isFlipped = false;
  dom.subviewDashboard.classList.remove("active");
  dom.subviewStudy.classList.add("active");
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
  renderCurrentStudyCard();
  showToast(`Restarted review (${state.studySessionCards.length} cards)`, "info");
}

export function renderCurrentStudyCard() {
  if (state.currentCardIndex >= state.studySessionCards.length) {
    finishStudySession(); return;
  }
  const card = state.studySessionCards[state.currentCardIndex];
  state.isFlipped = false;

  dom.studyProgressText.textContent = `Card ${state.currentCardIndex + 1} of ${state.studySessionCards.length}`;
  const pct = (state.currentCardIndex / state.studySessionCards.length) * 100;
  dom.studyProgressBar.style.width = `${pct}%`;

  dom.cardFrontContent.innerHTML = renderCardContent(card.front, false);
  dom.cardBackContent.innerHTML = renderCardContent(card.back, true);

  if (card.sub) {
    dom.cardFrontSub.textContent = card.sub; dom.cardFrontSub.classList.remove("hidden");
    dom.cardBackSub.textContent = card.sub; dom.cardBackSub.classList.remove("hidden");
  } else {
    dom.cardFrontSub.textContent = ""; dom.cardFrontSub.classList.add("hidden");
    dom.cardBackSub.textContent = ""; dom.cardBackSub.classList.add("hidden");
  }

  if (card.description) {
    dom.cardBackDescription.innerHTML = sanitizeHTML(card.description);
    dom.cardBackDescription.classList.remove("hidden");
    dom.cardBackDivider.classList.remove("hidden");
  } else {
    dom.cardBackDescription.innerHTML = "";
    dom.cardBackDescription.classList.add("hidden");
    dom.cardBackDivider.classList.add("hidden");
  }

  dom.flashcard.className = "flashcard";
  dom.studyHintBar.classList.remove("hidden");
  dom.studyGradingBar.classList.add("hidden");
  dom.cardFrontContent.parentElement.scrollTop = 0;
  dom.cardBackContent.parentElement.scrollTop = 0;
}

export function flipCard() {
  state.isFlipped = !state.isFlipped;
  dom.flashcard.classList.toggle("flipped", state.isFlipped);
  dom.studyHintBar.classList.toggle("hidden", state.isFlipped);
  dom.studyGradingBar.classList.toggle("hidden", !state.isFlipped);
}

export async function submitCardGrade(grade) {
  const card = state.studySessionCards[state.currentCardIndex];
  let fsrsRating = Rating.Good;
  if (grade <= 1) fsrsRating = Rating.Again;
  else if (grade <= 3) fsrsRating = Rating.Hard;
  else if (grade === 4) fsrsRating = Rating.Good;
  else if (grade === 5) fsrsRating = Rating.Easy;

  const updated = calculateFSRS5(card, fsrsRating);

  try {
    await db.saveCard(updated);
    recordDailyReview();
    if (grade < 3) state.studySessionCards.push(updated);

    const anim = grade >= 3 ? "slide-out-right-anim" : "slide-out-left-anim";
    dom.flashcard.classList.add(anim);
    setTimeout(() => {
      dom.flashcard.classList.remove(anim);
      state.currentCardIndex++;
      renderCurrentStudyCard();
    }, 250);
  } catch (e) {
    console.error("Error saving graded card:", e);
    showToast("Error saving progress locally", "error");
  }
}

export function exitStudySession() {
  dom.subviewStudy.classList.remove("active");
  dom.subviewDashboard.classList.add("active");
  loadCardsFromDB();
}

function finishStudySession() {
  onSyncRequest();
  showModal(
    "🎉 Deck Completed!",
    `You finished all ${state.studySessionCards.length} cards in this session. Would you like to review this deck again or return to the dashboard?`,
    () => {
      restartStudySession();
    }
  );
  // Auto-switch back to dashboard if user cancels modal
  const cancelBtn = dom.modalBtnCancel;
  const originalCancel = cancelBtn ? cancelBtn.onclick : null;
  if (cancelBtn) {
    const handleCancel = () => {
      exitStudySession();
      cancelBtn.removeEventListener("click", handleCancel);
    };
    cancelBtn.addEventListener("click", handleCancel, { once: true });
  }
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
    if (e.touches.length !== 1 || !state.isFlipped) return;
    const t = e.touches[0];
    state.touchStartX = t.clientX; state.touchStartY = t.clientY;
    state.isSwipeActive = true;
    dom.flashcard.style.transition = "none";
  }, { passive: true });

  dom.flashcard.addEventListener("touchmove", e => {
    if (!state.isSwipeActive) return;
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
    if (state.touchMoveX > threshold) { dom.flashcard.style.transform = ""; submitCardGrade(5); }
    else if (state.touchMoveX < -threshold) { dom.flashcard.style.transform = ""; submitCardGrade(1); }
    else dom.flashcard.style.transform = "rotateY(180deg)";
    state.touchMoveX = 0; state.touchMoveY = 0;
  });
}

export function initKeyboardShortcuts() {
  document.addEventListener("keydown", e => {
    if (!dom.subviewStudy?.classList.contains("active")) return;
    if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
    if (e.code === "Space") { e.preventDefault(); flipCard(); }
    else if (state.isFlipped && e.key >= "0" && e.key <= "5") submitCardGrade(parseInt(e.key, 10));
    else if (e.key === "r" || e.key === "R") {
      const card = state.studySessionCards[state.currentCardIndex];
      if (card) speakCardText(state.isFlipped ? card.back : card.front);
    } else if (e.code === "Escape") {
      showModal("Exit Study Session?", "Exit study session?", exitStudySession);
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
  if (dom.btnCancelStudy) dom.btnCancelStudy.addEventListener("click", () =>
    showModal("Exit Study Session?", "Exit study session and return to dashboard?", exitStudySession)
  );
  if (dom.flashcard) {
    dom.flashcard.addEventListener("click", e => {
      if (e.target.closest(".btn-grade") || state.isSwipeActive) return;
      flipCard();
    });
  }
  dom.gradeButtons.forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      submitCardGrade(parseInt(btn.getAttribute("data-grade"), 10));
    });
  });
  if (dom.btnTtsSpeak) {
    dom.btnTtsSpeak.addEventListener("click", e => {
      e.stopPropagation();
      const card = state.studySessionCards[state.currentCardIndex];
      if (card) speakCardText(state.isFlipped ? card.back : card.front);
    });
  }
}
