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
import { initSettingsForm, initSettingsEventListeners, performBackgroundSync, requestDebouncedSync, onSyncNeeded as settingsOnSync } from "./js/settings.js";
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

// Register card refresh subscribers — called in order after every loadCardsFromDB()
onCardsRefreshed(refreshDashboard);
onCardsRefreshed(renderSimpleDecks);
onCardsRefreshed(refreshImport);     // populateImportDestinationSuggestions
onCardsRefreshed(renderExplorer);    // Explorer sidebar tree + canvas
onCardsRefreshed(refreshBrowser);    // Browser deck filter + card table
onCardsRefreshed(renderAnalyticsView); // Recompute data-science analytics

// ==========================================================================
// Routing
// ==========================================================================
function initRouting() {
  document.addEventListener("click", e => {
    const navBtn = e.target.closest(".nav-item") || e.target.closest("[data-view]");
    if (!navBtn) return;
    const targetView = navBtn.getAttribute("data-view");
    if (!targetView) return;
    e.preventDefault();

    if (isStudyBusy()) { showToast("Finishing your review save. Please try again in a moment.", "info"); return; }
    const studyActive = dom.subviewStudy?.classList.contains("active");
    if (studyActive && targetView !== "view-review" && exitStudySession() === false) return;
    switchView(targetView);
  });

  const handleLogoClick = () => {
    if (isStudyBusy()) { showToast("Finishing your review save. Please try again in a moment.", "info"); return; }
    const studyActive = dom.subviewStudy?.classList.contains("active");
    if (studyActive && exitStudySession() === false) return;
    switchView("view-review");
  };

  document.getElementById("header-logo-home")?.addEventListener("click", handleLogoClick);
  document.getElementById("sidebar-logo-home")?.addEventListener("click", handleLogoClick);

  dom.headerSyncStatus?.addEventListener("click", () => {
    switchView("view-settings");
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
  if (document.visibilityState === "visible") performBackgroundSync();
});
