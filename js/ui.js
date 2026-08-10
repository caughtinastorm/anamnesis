import { state } from "./state.js";

export const dom = {
  deckSelect: document.getElementById("deck-select"),
  statDueCount: document.getElementById("stat-due-count"),
  statNewCount: document.getElementById("stat-new-count"),
  statTotalCount: document.getElementById("stat-total-count"),
  btnStartReview: document.getElementById("btn-start-review"),
  btnForceReview: document.getElementById("btn-force-review"),
  dashboardEmptyState: document.getElementById("dashboard-empty-state"),
  navDueBadge: document.getElementById("nav-due-badge"),
  btnCancelStudy: document.getElementById("btn-cancel-study"),
  studyProgressText: document.getElementById("study-progress-text"),
  studyProgressBar: document.getElementById("study-progress-bar"),
  flashcard: document.getElementById("flashcard"),
  cardFrontSub: document.getElementById("card-front-sub"),
  cardFrontContent: document.getElementById("card-front-content"),
  cardBackSub: document.getElementById("card-back-sub"),
  cardBackContent: document.getElementById("card-back-content"),
  cardBackDivider: document.getElementById("card-back-divider"),
  cardBackDescription: document.getElementById("card-back-description"),
  studyHintBar: document.getElementById("study-hint-bar"),
  studyGradingBar: document.getElementById("study-grading-bar"),
  gradeButtons: document.querySelectorAll(".btn-grade"),
  quickFront: document.getElementById("quick-front"),
  quickSub: document.getElementById("quick-sub"),
  quickBack: document.getElementById("quick-back"),
  quickDescription: document.getElementById("quick-description"),
  quickFolder: document.getElementById("quick-folder"),
  quickDeck: document.getElementById("quick-deck"),
  folderSuggestions: document.getElementById("folder-suggestions"),
  deckSuggestions: document.getElementById("deck-suggestions"),
  btnQuickAdd: document.getElementById("btn-quick-add"),
  foldersTreeContainer: document.getElementById("folders-tree-container"),
  importFile: document.getElementById("import-file"),
  importFileName: document.getElementById("import-file-name"),
  importText: document.getElementById("import-text"),
  btnParseCsv: document.getElementById("btn-parse-csv"),
  importPreviewSection: document.getElementById("import-preview-section"),
  previewCount: document.getElementById("preview-count"),
  previewTableBody: document.getElementById("preview-table-body"),
  btnCancelImport: document.getElementById("btn-cancel-import"),
  btnConfirmImport: document.getElementById("btn-confirm-import"),
  settingsPat: document.getElementById("settings-pat"),
  settingsGistId: document.getElementById("settings-gist-id"),
  btnValidateToken: document.getElementById("btn-validate-token"),
  btnCreateGist: document.getElementById("btn-create-gist"),
  btnSaveCredentials: document.getElementById("btn-save-credentials"),
  syncConsoleLog: document.getElementById("sync-console-log"),
  manualSyncContainer: document.getElementById("manual-sync-container"),
  btnForceSync: document.getElementById("btn-force-sync"),
  syncLastTimeLabel: document.getElementById("sync-last-time-label"),
  headerSyncStatus: document.getElementById("header-sync-status"),
  syncLabelText: document.getElementById("sync-label-text"),
  btnExportCsv: document.getElementById("btn-export-csv"),
  btnClearDb: document.getElementById("btn-clear-db"),
  themeButtons: document.querySelectorAll(".btn-theme"),
  settingsVoiceLang: document.getElementById("settings-voice-lang"),
  settingsReviewCap: document.getElementById("settings-review-cap"),
  btnTtsSpeak: document.getElementById("btn-tts-speak"),
  btnRestartStudy: document.getElementById("btn-restart-study"),
  dashboardHeatmapGrid: document.getElementById("dashboard-heatmap-grid"),
  modalContainer: document.getElementById("modal-container"),
  modalTitle: document.getElementById("modal-title"),
  modalBody: document.getElementById("modal-body"),
  modalBtnCancel: document.getElementById("modal-btn-cancel"),
  modalBtnConfirm: document.getElementById("modal-btn-confirm"),
  toastContainer: document.getElementById("toast-container"),
  subviewDashboard: document.getElementById("subview-dashboard"),
  subviewStudy: document.getElementById("subview-study"),
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

export function showModal(title, body, onConfirm) {
  if (!dom.modalContainer) return;
  dom.modalTitle.textContent = title;
  dom.modalBody.textContent = body;
  state.modalConfirmCallback = onConfirm;
  dom.modalContainer.classList.remove("hidden");
}

export function initModalListeners() {
  if (dom.modalBtnCancel) {
    dom.modalBtnCancel.addEventListener("click", () => {
      dom.modalContainer.classList.add("hidden");
      state.modalConfirmCallback = null;
    });
  }
  if (dom.modalBtnConfirm) {
    dom.modalBtnConfirm.addEventListener("click", () => {
      dom.modalContainer.classList.add("hidden");
      if (state.modalConfirmCallback) state.modalConfirmCallback();
      state.modalConfirmCallback = null;
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


