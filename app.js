/**
 * anamnesis — Main Application Orchestrator
 *
 * This file wires all modules together and boots the app.
 * Business logic lives in js/ modules.
 */

import { dom, switchView, initTheme, initModalListeners, showToast, scrollToElement } from "./js/ui.js";
import { loadCardsFromDB, onCardsRefreshed } from "./js/cards.js";
import { calculateStats, updateUIStats, handleQuickAddCard, initDashboardPickerButton, onSyncNeeded as dashOnSync, refreshDashboard } from "./js/dashboard.js";
import { initStudyEventListeners, initTouchGestures, initKeyboardShortcuts, onSyncNeeded as studyOnSync } from "./js/study.js";
import { initImportEventListeners, onSyncNeeded as importOnSync, refreshImport } from "./js/import.js";
import { initSettingsForm, initSettingsEventListeners, performBackgroundSync, requestDebouncedSync, onSyncNeeded as settingsOnSync } from "./js/settings.js";
import { initCardBrowser, onSyncNeeded as browserOnSync, refreshBrowser } from "./js/browser.js";
import { initExplorer, onSyncNeeded as explorerOnSync, renderExplorer } from "./js/explorer.js";
import { initCollectionPicker } from "./js/picker.js";

// Wire up sync callbacks so all modules trigger debounced background sync
const requestSync = (delayMs = 1200) => requestDebouncedSync(delayMs);
dashOnSync(requestSync);
studyOnSync(requestSync);
importOnSync(requestSync);
settingsOnSync(requestSync);
browserOnSync(requestSync);
explorerOnSync(requestSync);

// Register card refresh subscribers — called in order after every loadCardsFromDB()
onCardsRefreshed(refreshDashboard);  // populateDeckDropdown, calculateStats, renderFoldersTree, renderHeatmap
onCardsRefreshed(refreshImport);     // populateImportDestinationSuggestions
onCardsRefreshed(renderExplorer);    // Explorer sidebar tree + canvas
onCardsRefreshed(refreshBrowser);    // Browser deck filter + card table

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

    const studyActive = dom.subviewStudy?.classList.contains("active");
    if (studyActive && targetView !== "view-review") {
      import("./js/ui.js").then(({ showModal }) => {
        import("./js/study.js").then(({ exitStudySession }) => {
          showModal("Exit Study Session?", "Your session progress will be saved.", () => {
            exitStudySession();
            switchView(targetView);
          });
        });
      });
    } else {
      switchView(targetView);
    }
  });

  const handleLogoClick = () => {
    const studyActive = dom.subviewStudy?.classList.contains("active");
    if (studyActive) {
      import("./js/ui.js").then(({ showModal }) => {
        import("./js/study.js").then(({ exitStudySession }) => {
          showModal("Exit Study Session?", "Return to dashboard?", () => {
            exitStudySession();
            switchView("view-review");
          });
        });
      });
    } else {
      switchView("view-review");
    }
  };

  document.getElementById("header-logo-home")?.addEventListener("click", handleLogoClick);
  document.getElementById("sidebar-logo-home")?.addEventListener("click", handleLogoClick);

  dom.headerSyncStatus?.addEventListener("click", () => {
    switchView("view-settings");
    if (dom.manualSyncContainer) scrollToElement(dom.manualSyncContainer);
  });

  dom.deckSelect?.addEventListener("change", () => {
    calculateStats();
    updateUIStats();
  });

  dom.btnQuickAdd?.addEventListener("click", handleQuickAddCard);
}

// ==========================================================================
// Service Worker
// ==========================================================================
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then(reg => console.log("SW registered:", reg.scope))
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

    registerServiceWorker();

    await loadCardsFromDB();
    performBackgroundSync();
  } catch (err) {
    console.error("initApp fatal error:", err);
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
