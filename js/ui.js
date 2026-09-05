import { state } from "./state.js";

const $ = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);
const $$ = (sel) => (typeof document !== "undefined" ? document.querySelectorAll(sel) : []);

export const dom = {
  deckSelect: $("deck-select"),
  statDueCount: $("stat-due-count"),
  statNewCount: $("stat-new-count"),
  statTotalCount: $("stat-total-count"),
  btnStartReview: $("btn-start-review"),
  btnForceReview: $("btn-force-review"),
  dashboardEmptyState: $("dashboard-empty-state"),
  navDueBadge: $("nav-due-badge"),
  btnCancelStudy: $("btn-cancel-study"),
  studyProgressText: $("study-progress-text"),
  studyProgressBar: $("study-progress-bar"),
  flashcard: $("flashcard"),
  cardFrontSub: $("card-front-sub"),
  cardFrontContent: $("card-front-content"),
  cardBackSub: $("card-back-sub"),
  cardBackContent: $("card-back-content"),
  cardBackDivider: $("card-back-divider"),
  cardBackDescription: $("card-back-description"),
  studyHintBar: $("study-hint-bar"),
  studyGradingBar: $("study-grading-bar"),
  gradeButtons: $$(".btn-grade"),
  quickFront: $("quick-front"),
  quickSub: $("quick-sub"),
  quickBack: $("quick-back"),
  quickDescription: $("quick-description"),
  quickFolder: $("quick-folder"),
  quickDeck: $("quick-deck"),
  folderSuggestions: $("folder-suggestions"),
  deckSuggestions: $("deck-suggestions"),
  btnQuickAdd: $("btn-quick-add"),
  foldersTreeContainer: $("folders-tree-container"),
  importFile: $("import-file"),
  importFileName: $("import-file-name"),
  importText: $("import-text"),
  btnParseCsv: $("btn-parse-csv"),
  importPreviewSection: $("import-preview-section"),
  previewCount: $("preview-count"),
  previewTableBody: $("preview-table-body"),
  btnCancelImport: $("btn-cancel-import"),
  btnConfirmImport: $("btn-confirm-import"),
  settingsPat: $("settings-pat"),
  settingsGistId: $("settings-gist-id"),
  btnValidateToken: $("btn-validate-token"),
  btnCreateGist: $("btn-create-gist"),
  btnSaveCredentials: $("btn-save-credentials"),
  syncConsoleLog: $("sync-console-log"),
  manualSyncContainer: $("manual-sync-container"),
  btnForceSync: $("btn-force-sync"),
  syncLastTimeLabel: $("sync-last-time-label"),
  headerSyncStatus: $("header-sync-status"),
  syncLabelText: $("sync-label-text"),
  btnExportCsv: $("btn-export-csv"),
  btnClearDb: $("btn-clear-db"),
  themeButtons: $$(".btn-theme"),
  settingsVoiceLang: $("settings-voice-lang"),
  settingsReviewCap: $("settings-review-cap"),
  settingsTargetRetention: $("settings-target-retention"),
  targetRetentionBadge: $("target-retention-badge"),
  btnCreateBackupNow: $("btn-create-backup-now"),
  backupsListContainer: $("backups-list-container"),
  btnTtsSpeak: $("btn-tts-speak"),
  btnRestartStudy: $("btn-restart-study"),
  btnUndoStudy: $("btn-undo-study"),
  browserBulkToolbar: $("browser-bulk-toolbar"),
  bulkSelectedCount: $("bulk-selected-count"),
  btnBulkMove: $("btn-bulk-move"),
  btnBulkReset: $("btn-bulk-reset"),
  btnBulkDelete: $("btn-bulk-delete"),
  btnBulkDeselect: $("btn-bulk-deselect"),
  browserSelectAll: $("browser-select-all"),
  quickLang: $("quick-lang"),
  dashboardHeatmapGrid: $("dashboard-heatmap-grid"),
  modalContainer: $("modal-container"),
  modalTitle: $("modal-title"),
  modalBody: $("modal-body"),
  modalBtnCancel: $("modal-btn-cancel"),
  modalBtnConfirm: $("modal-btn-confirm"),
  promptModalContainer: $("prompt-modal-container"),
  promptModalTitle: $("prompt-modal-title"),
  promptModalMessage: $("prompt-modal-message"),
  promptModalInput: $("prompt-modal-input"),
  promptModalBtnCancel: $("prompt-modal-btn-cancel"),
  promptModalBtnConfirm: $("prompt-modal-btn-confirm"),
  toastContainer: $("toast-container"),
  subviewDashboard: $("subview-dashboard"),
  subviewStudy: $("subview-study"),
  studyDeckBadge: $("study-deck-badge"),
  btnDashboardResetDeck: $("btn-dashboard-reset-deck"),
  btnDashboardAllDecks: $("btn-dashboard-all-decks"),
};


export function switchView(viewId) {
  if (!viewId) return;
  document.querySelectorAll(".app-view").forEach(v =>
    v.classList.toggle("active", v.id === viewId)
  );
  document.querySelectorAll(".nav-item").forEach(item =>
    item.classList.toggle("active", item.getAttribute("data-view") === viewId)
  );
}

if (typeof window !== "undefined") window.switchView = switchView;

export function scrollToElement(el) {
  if (!el) return;
  setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
}

export function showModal(title, body, onConfirm, onCancel = null) {
  if (!dom.modalContainer) return;
  dom.modalTitle.textContent = title;
  dom.modalBody.textContent = body;
  state.modalConfirmCallback = onConfirm;
  state.modalCancelCallback = onCancel;
  dom.modalContainer.classList.remove("hidden");
}

export function showPromptModal(title, message, defaultValue = "", onConfirm, onCancel = null) {
  const container = dom.promptModalContainer || document.getElementById("prompt-modal-container");
  if (!container) return;
  const titleEl = dom.promptModalTitle || document.getElementById("prompt-modal-title");
  const msgEl = dom.promptModalMessage || document.getElementById("prompt-modal-message");
  const inputEl = dom.promptModalInput || document.getElementById("prompt-modal-input");

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (inputEl) inputEl.value = defaultValue;

  state.promptModalConfirmCallback = onConfirm;
  state.promptModalCancelCallback = onCancel;
  container.classList.remove("hidden");

  setTimeout(() => {
    if (inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  }, 50);
}

export function showPracticeModeModal(onPracticeOnly, onTrackFSRS, onCancel = null) {
  const modal = document.getElementById("practice-modal-container");
  if (!modal) {
    if (confirm("Count practice session towards FSRS spaced repetition data?")) {
      if (onTrackFSRS) onTrackFSRS();
    } else {
      if (onPracticeOnly) onPracticeOnly();
    }
    return;
  }

  const btnOnly = document.getElementById("btn-practice-only");
  const btnFsrs = document.getElementById("btn-practice-fsrs");
  const btnCancel = document.getElementById("btn-practice-cancel");

  const close = () => {
    modal.classList.add("hidden");
    if (btnOnly) btnOnly.onclick = null;
    if (btnFsrs) btnFsrs.onclick = null;
    if (btnCancel) btnCancel.onclick = null;
    window.removeEventListener("keydown", handleKey);
  };

  const handleKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      if (onCancel) onCancel();
    }
  };

  if (btnOnly) {
    btnOnly.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
      if (onPracticeOnly) onPracticeOnly();
    };
  }

  if (btnFsrs) {
    btnFsrs.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
      if (onTrackFSRS) onTrackFSRS();
    };
  }

  if (btnCancel) {
    btnCancel.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
      if (onCancel) onCancel();
    };
  }

  window.addEventListener("keydown", handleKey);
  modal.classList.remove("hidden");
}

export function initModalListeners() {
  if (dom.modalBtnCancel) {
    dom.modalBtnCancel.addEventListener("click", () => {
      dom.modalContainer.classList.add("hidden");
      const cancelCb = state.modalCancelCallback;
      state.modalConfirmCallback = null;
      state.modalCancelCallback = null;
      if (cancelCb) cancelCb();
    });
  }
  if (dom.modalBtnConfirm) {
    dom.modalBtnConfirm.addEventListener("click", () => {
      dom.modalContainer.classList.add("hidden");
      const confirmCb = state.modalConfirmCallback;
      state.modalConfirmCallback = null;
      state.modalCancelCallback = null;
      if (confirmCb) confirmCb();
    });
  }

  const promptInput = dom.promptModalInput || document.getElementById("prompt-modal-input");
  const promptConfirm = dom.promptModalBtnConfirm || document.getElementById("prompt-modal-btn-confirm");
  const promptCancel = dom.promptModalBtnCancel || document.getElementById("prompt-modal-btn-cancel");
  const promptModal = dom.promptModalContainer || document.getElementById("prompt-modal-container");

  const closePrompt = (confirmed) => {
    if (!promptModal) return;
    promptModal.classList.add("hidden");
    const val = promptInput ? promptInput.value.trim() : "";
    if (confirmed) {
      const cb = state.promptModalConfirmCallback;
      state.promptModalConfirmCallback = null;
      state.promptModalCancelCallback = null;
      if (cb) cb(val);
    } else {
      const cb = state.promptModalCancelCallback;
      state.promptModalConfirmCallback = null;
      state.promptModalCancelCallback = null;
      if (cb) cb();
    }
  };

  if (promptConfirm) promptConfirm.addEventListener("click", () => closePrompt(true));
  if (promptCancel) promptCancel.addEventListener("click", () => closePrompt(false));
  if (promptInput) {
    promptInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        closePrompt(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePrompt(false);
      }
    });
  }
}

export function showToast(message, type = "info") {
  if (!dom.toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icons = {
    success: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" style="display:block"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" style="display:block"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    info: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" style="display:block"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  const iconSpan = document.createElement("span");
  iconSpan.className = "toast-icon";
  iconSpan.innerHTML = icons[type] || icons.info;

  const textSpan = document.createElement("span");
  textSpan.textContent = message;

  toast.appendChild(iconSpan);
  toast.appendChild(textSpan);
  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("fade-out");
    toast.addEventListener("animationend", () => toast.remove());
  }, 3000);
}

export function initTheme() {
  const saved = localStorage.getItem("app-theme") || "system";
  applyTheme(saved);

  dom.themeButtons.forEach(btn => {
    btn.addEventListener("click", () => applyTheme(btn.getAttribute("data-theme-value")));
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (localStorage.getItem("app-theme") === "system") applyTheme("system");
  });
}

function applyTheme(theme) {
  localStorage.setItem("app-theme", theme);
  dom.themeButtons.forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-theme-value") === theme);
  });
  const effective = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.setAttribute("data-theme", effective);
  const meta = document.querySelector("meta[name='theme-color']");
  if (meta) meta.setAttribute("content", effective === "dark" ? "#121214" : "#ffffff");
}


