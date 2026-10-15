/**
 * anamnesis — Interactive Introduction & Onboarding Tour Module
 *
 * Provides a guided step-by-step walkthrough for new devices:
 * - Available on demand from Settings; never blocks first launch
 * - Can be skipped immediately from the very first step
 * - Switches background view to match each topic (Dashboard, Explorer, Browser, Settings)
 * - Accessible on-demand anytime from Header Help button or Settings
 */

import { switchView } from "./ui.js";

const STORAGE_KEY = "anamnesis_intro_seen";

export const INTRO_STEPS = [
  { id: "welcome", tag: "Today", view: "view-review", title: "A little, every day.",
    subtitle: "A short session is a good session.", iconHtml: "", bodyHtml: "<p>Choose a deck and tap <strong>Start reviewing</strong>. Your session starts with 10 cards. You can skip this guide anytime.</p>", nextText: "How reviewing works →" },
  { id: "study-practice", tag: "Review", view: "view-review", title: "Question. Answer. Remember.",
    subtitle: "Two simple choices.", iconHtml: "", bodyHtml: "<p>Think of the answer, then tap <strong>Show answer</strong>. Choose <strong>Again</strong> to revisit it, or <strong>Got it</strong> to move on. Your progress saves after every card.</p>", nextText: "Where everything lives →" },
  { id: "cards-settings", tag: "Your space", view: "view-settings", title: "Three places. Nothing to learn.",
    subtitle: "Everything has a home.", iconHtml: "", bodyHtml: "<p><strong>Today</strong> is for reviewing. <strong>Cards</strong> is for adding and browsing your decks. <strong>Settings</strong> holds progress, imports, backups, and study preferences.</p>", nextText: "Ready to start" }
];

let currentStepIndex = 0;
let modalEl = null;
let tagEl = null;
let counterEl = null;
let heroEl = null;
let titleEl = null;
let bodyEl = null;
let dotsEl = null;
let btnPrev = null;
let btnNext = null;
let btnSkip = null;
let btnSkipTop = null;

/**
 * Initialize DOM references and event listeners for the introduction tour.
 */
export function initIntroTour() {
  modalEl = document.getElementById("intro-tour-modal");
  if (!modalEl) return;

  tagEl = document.getElementById("intro-step-tag");
  counterEl = document.getElementById("intro-step-counter");
  heroEl = document.getElementById("intro-hero-wrap");
  titleEl = document.getElementById("intro-tour-title");
  bodyEl = document.getElementById("intro-tour-body");
  dotsEl = document.getElementById("intro-dots");
  btnPrev = document.getElementById("btn-intro-prev");
  btnNext = document.getElementById("btn-intro-next");
  btnSkip = document.getElementById("btn-intro-skip");
  btnSkipTop = document.getElementById("btn-intro-skip-top");

  if (btnNext) {
    btnNext.addEventListener("click", () => {
      if (currentStepIndex < INTRO_STEPS.length - 1) {
        goToStep(currentStepIndex + 1);
      } else {
        closeIntroTour();
      }
    });
  }

  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      if (currentStepIndex > 0) {
        goToStep(currentStepIndex - 1);
      }
    });
  }

  if (btnSkip) btnSkip.addEventListener("click", closeIntroTour);
  if (btnSkipTop) btnSkipTop.addEventListener("click", closeIntroTour);

  // Close on backdrop click
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) closeIntroTour();
  });

  // Keyboard navigation
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", (e) => {
      if (!modalEl || modalEl.classList.contains("hidden")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeIntroTour();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (currentStepIndex < INTRO_STEPS.length - 1) goToStep(currentStepIndex + 1);
        else closeIntroTour();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentStepIndex > 0) goToStep(currentStepIndex - 1);
      }
    });
  }

  // Connect manual trigger buttons
  const btnHeaderHelp = document.getElementById("btn-header-help");
  if (btnHeaderHelp) {
    btnHeaderHelp.addEventListener("click", () => startIntroTour(true));
  }

  const btnStartTourSettings = document.getElementById("btn-start-tour");
  if (btnStartTourSettings) {
    btnStartTourSettings.addEventListener("click", () => startIntroTour(true));
  }
}

/**
 * Check if the introduction tour should be triggered on app startup.
 * If device has not seen the tour yet, launch it.
 */
export function checkAutoStartIntro() {
  try {
    const hasSeen = localStorage.getItem(STORAGE_KEY);
    if (!hasSeen) {
      // Delay slightly so the background dashboard loads smoothly first
      setTimeout(() => {
        startIntroTour(false);
      }, 450);
    }
  } catch (err) {
    console.warn("Could not check introduction tour status:", err);
  }
}

/**
 * Open the introduction tour modal.
 * @param {boolean} force If true, ignores previously seen status
 */
export function startIntroTour(force = false) {
  if (!modalEl) initIntroTour();
  if (!modalEl) return;

  if (!force) {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") return;
    } catch (e) {}
  }

  goToStep(0);
  modalEl.classList.remove("hidden");
}

/**
 * Dismiss and close the introduction tour, saving the seen state.
 */
export function closeIntroTour() {
  if (modalEl) modalEl.classList.add("hidden");
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch (e) {}

  // Switch cleanly back to review dashboard
  switchView("view-review");
}

/**
 * Jump to a specific step index.
 * @param {number} index
 */
export function goToStep(index) {
  if (index < 0 || index >= INTRO_STEPS.length) return;
  currentStepIndex = index;
  const step = INTRO_STEPS[index];

  // Switch background view to match the topic
  if (step.view) {
    try {
      switchView(step.view);
    } catch (e) {}
  }

  if (tagEl) tagEl.textContent = step.tag;
  if (counterEl) counterEl.textContent = `${index + 1} of ${INTRO_STEPS.length}`;
  if (heroEl) heroEl.innerHTML = step.iconHtml || "";
  if (titleEl) titleEl.textContent = step.title;
  if (bodyEl) bodyEl.innerHTML = step.bodyHtml;

  if (btnPrev) {
    btnPrev.classList.toggle("hidden", index === 0);
  }

  if (btnNext) {
    btnNext.textContent = step.nextText || (index === INTRO_STEPS.length - 1 ? "Finish" : "Next ›");
  }

  renderDots();
}

/**
 * Render interactive stepper dots.
 */
function renderDots() {
  if (!dotsEl) return;
  dotsEl.innerHTML = "";

  INTRO_STEPS.forEach((step, idx) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `intro-dot ${idx === currentStepIndex ? "active" : ""}`;
    dot.title = `Step ${idx + 1}: ${step.tag}`;
    dot.addEventListener("click", () => goToStep(idx));
    dotsEl.appendChild(dot);
  });
}
