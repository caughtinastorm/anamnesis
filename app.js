import { createViewRefresh } from './js/services/view-refresh.js';
import { initMinimalUI, renderSimpleDecks } from "./js/minimal-ui.js";
import { initAccessibility } from "./js/accessibility.js";
import { runMigrations, onDatabaseChanged } from "./db.js";
/**
 * anamnesis — Main Application Orchestrator
 *
 * This file wires all modules together and boots the app.
 * Business logic lives in js/ modules.
 */

import { dom, switchView, initTheme, initModalListeners, showModal, showToast, scrollToElement } from "./js/ui.js";
import { loadCardsFromDB, onCardsRefreshed } from "./js/cards.js";
import { calculateStats, updateUIStats, setActiveDeckSelection, handleQuickAddCard, initDashboardPickerButton, onSyncNeeded as dashOnSync, refreshDashboard } from "./js/dashboard.js";

import { isStudyBusy, initStudyEventListeners, initTouchGestures, initKeyboardShortcuts, exitStudySession, onSyncNeeded as studyOnSync } from "./js/study.js";
import { initImportEventListeners, onSyncNeeded as importOnSync, refreshImport } from "./js/import.js";
import { initSettingsForm, initSettingsEventListeners, performBackgroundSync, requestDebouncedSync, invalidateSyncCache, onSyncNeeded as settingsOnSync } from "./js/settings.js";
import { initCardBrowser, onSyncNeeded as browserOnSync, refreshBrowser } from "./js/browser.js";
import { initExplorer, onSyncNeeded as explorerOnSync, renderExplorer } from "./js/explorer.js";
import { initCollectionPicker } from "./js/picker.js";
import { initIntroTour } from "./js/intro.js";
import { checkAndSeedStarterDecks } from "./js/presets.js";
import { initAnalyticsUI, renderAnalyticsView } from "./js/analytics-ui.js";

// Wire up sync callbacks so all modules trigger debounced background sync
const requestSync = (delayMs = 1200) => requestDebouncedSync(delayMs);
dashOnSync(requestSync);
studyOnSync(requestSync);
importOnSync(requestSync);
settingsOnSync(requestSync);
browserOnSync(requestSync);
explorerOnSync(requestSync);

// Cheap daily counters stay current; collection tools render when opened.
onCardsRefreshed(refreshDashboard);
const visibleView = id => document.getElementById(id)?.classList.contains('active');
const visibleDeckTab = id => visibleView('view-decks') && document.getElementById(id)?.classList.contains('active');
const refreshers = [
  [() => visibleDeckTab('tab-collections'), renderSimpleDecks],
  [() => visibleView('view-import'), refreshImport],
  [() => visibleDeckTab('tab-organize'), renderExplorer],
  [() => visibleDeckTab('tab-browser'), refreshBrowser],
  [() => visibleView('view-analytics'), renderAnalyticsView]
].map(([isVisible, render]) => createViewRefresh({ isVisible, render }));
for (const refresher of refreshers) onCardsRefreshed(refresher.invalidate);
const flushVisible = () => {
  // Due status also changes with wall-clock time, even without a card edit.
  calculateStats(); updateUIStats();
  for (const refresher of refreshers) refresher.invalidate();
};
document.addEventListener('app:view-changed', flushVisible);
document.addEventListener('app:deck-tab-changed', flushVisible);

// ==========================================================================
// Routing
// ==========================================================================
function initRouting() {
  const navigate = targetView => {
    if (isStudyBusy()) { showToast("Finishing your review save. Please try again in a moment.", "info"); return false; }
    const studyActive = dom.subviewStudy?.classList.contains("active");
    if (studyActive && (targetView !== "view-review" || !document.getElementById('view-review')?.classList.contains('active')) && exitStudySession() === false) return false;
    switchView(targetView); return true;
  };
  document.addEventListener("click", e => {
    const navBtn = e.target.closest(".nav-item") || e.target.closest("[data-view]");
    if (!navBtn) return;
    const targetView = navBtn.getAttribute("data-view");
    if (!targetView) return;
    e.preventDefault();

    navigate(targetView);
  });

  const handleLogoClick = () => {
    if (isStudyBusy()) { showToast("Finishing your review save. Please try again in a moment.", "info"); return; }
    if (dom.subviewStudy?.classList.contains("active") && exitStudySession() === false) return;
    switchView("view-review");
  };

  document.getElementById("header-logo-home")?.addEventListener("click", handleLogoClick);
  document.getElementById("sidebar-logo-home")?.addEventListener("click", handleLogoClick);

  dom.headerSyncStatus?.addEventListener("click", () => {
    if (!navigate("view-settings")) return;
    document.dispatchEvent(new CustomEvent('app:settings-tab', { detail: { id: 'settings-sync' } }));
    if (dom.manualSyncContainer) scrollToElement(dom.manualSyncContainer);
  });

  dom.deckSelect?.addEventListener("change", (e) => {
    setActiveDeckSelection(e.target.value);
  });


  dom.btnQuickAdd?.addEventListener("click", handleQuickAddCard);
}

// ==========================================================================
// Service Worker
// ==========================================================================
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(new URL("./sw.js", document.baseURI))
        .then(reg => {
          const notifyUpdate = () => showToast("Update ready. Close all app tabs and reopen to install it.", "info");
          if (reg.waiting) notifyUpdate();
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller) notifyUpdate();
            });
          });
        })
        .catch(err => console.warn("SW registration failed:", err));
    });
  }
}

// ==========================================================================
// Boot
// ==========================================================================
async function initApp() {
  try {
    initModalListeners();
    initMinimalUI();
    initAccessibility();
    initTheme();
    initRouting();
    switchView("view-review");
    initStudyEventListeners();
    initTouchGestures();
    initKeyboardShortcuts();
    initImportEventListeners();
    initSettingsForm();
    initSettingsEventListeners();
    initCardBrowser();
    initExplorer();
    initCollectionPicker();
    initDashboardPickerButton();
    initIntroTour();
    initAnalyticsUI();

    registerServiceWorker();

    onDatabaseChanged(() => {
      invalidateSyncCache();
      loadCardsFromDB().catch(error => console.warn("Cross-tab refresh failed:", error));
    });
    await runMigrations();
    await loadCardsFromDB();
    await checkAndSeedStarterDecks();
    performBackgroundSync();
    // Guidance is available on demand in Settings; never interrupt first launch.
  } catch (err) {
    console.error("initApp fatal error:", err);
    showToast("Unable to start. Your local data is preserved. Close other tabs and reload to retry.", "error");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

// Re-sync when tab becomes visible
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { flushVisible(); performBackgroundSync(); }
});
window.addEventListener('online', () => performBackgroundSync());
window.addEventListener('offline', () => performBackgroundSync());
