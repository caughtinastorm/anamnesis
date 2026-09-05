/**
 * anamnesis — Interactive Introduction & Onboarding Tour Module
 *
 * Provides a guided step-by-step walkthrough for new devices:
 * - Triggers automatically on initial launch (when localStorage "anamnesis_intro_seen" is unset)
 * - Can be skipped immediately from the very first step
 * - Switches background view to match each topic (Dashboard, Explorer, Browser, Settings)
 * - Accessible on-demand anytime from Header Help button or Settings
 */

import { switchView } from "./ui.js";

const STORAGE_KEY = "anamnesis_intro_seen";

export const INTRO_STEPS = [
  {
    id: "welcome",
    tag: "⚡ Quick Start",
    view: "view-review",
    title: "Welcome to anamnesis",
    subtitle: "Pure Black. Pure Signal.",
    iconHtml: `
      <div class="intro-icon-glow">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 4h16M5 7h14M7 7v13M10 7v13M14 7v13M17 7v13M3 20h18"/>
          <path d="M5 7c-1 0-2-.5-2-1.5S4 4 5 4"/>
          <path d="M19 7c1 0 2-.5 2-1.5S20 4 19 4"/>
        </svg>
      </div>
    `,
    bodyHtml: `
      <p class="intro-lead">
        An ultra-fast, local-first spaced repetition system engineered for effortless long-term memorization.
      </p>
      <div class="intro-points">
        <div class="intro-point">
          <span class="intro-point-icon">🧠</span>
          <div>
            <strong>FSRS-5 Cognitive Engine</strong>
            <p>Calculates memory stability and retrievability scientifically to schedule reviews right before you forget.</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">⚡</span>
          <div>
            <strong>Instant &amp; Offline</strong>
            <p>All flashcards and review logs live in your local browser database. Works without an internet connection.</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">☁️</span>
          <div>
            <strong>Conflict-Free Cloud Sync</strong>
            <p>Sync across mobile and desktop via private GitHub Gists with zero vendor lock-in.</p>
          </div>
        </div>
      </div>
      <p class="intro-footer-hint">Take this 1-minute quick guide, or skip to jump straight into your library.</p>
    `,
    nextText: "Start Quick Tour ›"
  },
  {
    id: "dashboard",
    tag: "📊 Dashboard",
    view: "view-review",
    title: "Your Daily Review Hub",
    subtitle: "Active Recall at the Optimal Moment",
    iconHtml: `
      <div class="intro-icon-glow">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
    `,
    bodyHtml: `
      <div class="intro-points">
        <div class="intro-point">
          <span class="intro-point-icon">🔥</span>
          <div>
            <strong>Due Today Counter</strong>
            <p>Only reviews cards whose retrievability has dipped below your target threshold (90% by default).</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">🗂️</span>
          <div>
            <strong>Active Collection Filter</strong>
            <p>Click the top header pill anytime to focus on a specific folder or deck, or review your entire library at once.</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">🌙</span>
          <div>
            <strong>4:00 AM Logical Rollover</strong>
            <p>Late-night reviews count towards the previous day's streak, ensuring late study sessions never break your daily habit.</p>
          </div>
        </div>
      </div>
    `,
    nextText: "Next: Study vs. Practice ›"
  },
  {
    id: "study-practice",
    tag: "🎯 Study vs. Practice",
    view: "view-review",
    title: "Study vs. Practice Mode",
    subtitle: "Scheduled Retention vs. Rapid Acquisition",
    iconHtml: `
      <div class="intro-icon-glow">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="6"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
      </div>
    `,
    bodyHtml: `
      <div class="intro-points">
        <div class="intro-point">
          <span class="intro-point-icon">📈</span>
          <div>
            <strong>Study Mode (Due Cards)</strong>
            <p>Advances intervals using 4 FSRS grades: <em>1-Again</em>, <em>2-Hard</em>, <em>3-Good</em>, <em>4-Easy</em>. Tap card or press <strong>Space</strong> to flip.</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">🎯</span>
          <div>
            <strong>Practice Mode (Drill Anytime)</strong>
            <p>Cycle through cards repeatedly. anamnesis asks whether attempts should count towards FSRS or run as <em>Practice Only</em>, protecting your memory stats from distortion during rapid word drilling.</p>
          </div>
        </div>
      </div>
    `,
    nextText: "Next: Deck Explorer ›"
  },
  {
    id: "decks-explorer",
    tag: "🗂️ Deck Explorer",
    view: "view-decks",
    title: "Desktop-Class Hierarchy",
    subtitle: "Organize Cards into Nested Folders",
    iconHtml: `
      <div class="intro-icon-glow">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
    `,
    bodyHtml: `
      <div class="intro-points">
        <div class="intro-point">
          <span class="intro-point-icon">📁</span>
          <div>
            <strong>Folder &amp; Deck Hierarchy</strong>
            <p>Structure your knowledge in clean <code>Folder / Collection</code> paths with breadcrumbs and sidebar tree navigation.</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">🔲</span>
          <div>
            <strong>Tiles &amp; Table Modes</strong>
            <p>Switch between visual card tiles and compact table columns with quick study, import, and export buttons.</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">🔄</span>
          <div>
            <strong>Reset FSRS Data Control</strong>
            <p>Need a fresh start? Right-click or tap <code>···</code> on any collection to wipe its FSRS history back to New without deleting cards.</p>
          </div>
        </div>
      </div>
    `,
    nextText: "Next: Card Browser ›"
  },
  {
    id: "card-browser",
    tag: "🔍 Card Browser",
    view: "view-browser",
    title: "Instant Search & Bulk Tools",
    subtitle: "Full Visibility Over Your Library",
    iconHtml: `
      <div class="intro-icon-glow">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </div>
    `,
    bodyHtml: `
      <div class="intro-points">
        <div class="intro-point">
          <span class="intro-point-icon">⚡</span>
          <div>
            <strong>Lightning-Fast Search</strong>
            <p>Find cards instantly across front, back, subtopic, or language tags.</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">☑️</span>
          <div>
            <strong>Bulk Operations</strong>
            <p>Select multiple cards to batch move, delete, or reset FSRS memory progress in a single action.</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">✏️</span>
          <div>
            <strong>Inline Editor &amp; Cloze</strong>
            <p>Supports cloze deletions like <code>{{c1::answer}}</code>, IPA brackets, phonetic hints, and custom speech synthesis.</p>
          </div>
        </div>
      </div>
    `,
    nextText: "Next: Sync & Settings ›"
  },
  {
    id: "settings-sync",
    tag: "☁️ Sync & Settings",
    view: "view-settings",
    title: "Sync & Personalization",
    subtitle: "Multi-Device Freedom & Automated Backups",
    iconHtml: `
      <div class="intro-icon-glow">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l.56-.56"/>
        </svg>
      </div>
    `,
    bodyHtml: `
      <div class="intro-points">
        <div class="intro-point">
          <span class="intro-point-icon">🔄</span>
          <div>
            <strong>GitHub Gist Synchronization</strong>
            <p>Add a GitHub Token in Settings to keep desktop and mobile in perfect sync with automated background sync.</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">🛡️</span>
          <div>
            <strong>Automated Snapshots</strong>
            <p>Periodic rolling database snapshots in IndexedDB ensure your flashcards are always secure.</p>
          </div>
        </div>
        <div class="intro-point">
          <span class="intro-point-icon">🎯</span>
          <div>
            <strong>Target Retention Rate</strong>
            <p>Adjust your retention target (70%–97%) and vacation mode review caps to suit your study schedule.</p>
          </div>
        </div>
      </div>
    `,
    nextText: "Complete Setup 🎉"
  },
  {
    id: "ready",
    tag: "🚀 Ready to Begin",
    view: "view-review",
    title: "You're All Set!",
    subtitle: "Start Building Your Knowledge Base",
    iconHtml: `
      <div class="intro-icon-glow" style="border-color: rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.08); color: #4ade80;">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
    `,
    bodyHtml: `
      <p class="intro-lead">
        Add your first card using the <strong>Quick Add</strong> box on the dashboard, or import an existing deck via the <strong>Import</strong> tab.
      </p>
      <div class="intro-tip-card">
        <strong>💡 Pro Tip:</strong>
        You can relaunch this interactive guide anytime from <strong>Settings &rarr; App Guide &amp; Introduction</strong> or by clicking the <strong>?</strong> button in the top navigation bar.
      </div>
    `,
    nextText: "Start Learning Now 🚀"
  }
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
