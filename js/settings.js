import { state } from "./state.js";
import { dom, showToast, showModal } from "./ui.js";
import { getCardFolder, getCardDeck, escapeCSVField, escapeHTML } from "./utils.js";
import { getTargetRetention, setTargetRetention } from "../fsrs.js";
import * as sync from "../sync.js";
import * as db from "../db.js";
import { loadCardsFromDB } from "./cards.js";
import { calculateStats, updateUIStats } from "./dashboard.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

export function initSettingsEventListeners() {
  if (dom.btnValidateToken) dom.btnValidateToken.addEventListener("click", validateGitHubToken);
  if (dom.btnCreateGist) dom.btnCreateGist.addEventListener("click", createSyncGist);
  if (dom.btnSaveCredentials) dom.btnSaveCredentials.addEventListener("click", saveSyncConfig);
  if (dom.btnForceSync) dom.btnForceSync.addEventListener("click", triggerManualSync);
  if (dom.btnExportCsv) dom.btnExportCsv.addEventListener("click", exportDatabaseToCSV);
  if (dom.btnClearDb) dom.btnClearDb.addEventListener("click", resetLocalDatabase);

  if (dom.btnCreateBackupNow) {
    dom.btnCreateBackupNow.addEventListener("click", async () => {
      try {
        await db.createLocalBackup(`Manual Snapshot (${state.allCards.filter(c => !c.deleted).length} cards)`, state.allCards);
        showToast("Created local database backup snapshot!", "success");
        renderBackupsList();
      } catch (e) {
        console.error("Backup creation failed:", e);
        showToast("Failed to create local backup", "error");
      }
    });
  }
}

export function initSettingsForm() {
  dom.settingsPat.value = state.syncCredentials.pat || "";
  dom.settingsGistId.value = state.syncCredentials.gistId || "";

  if (dom.settingsVoiceLang) {
    dom.settingsVoiceLang.value = localStorage.getItem("app-speech-lang") || "auto";
    dom.settingsVoiceLang.addEventListener("change", () => {
      localStorage.setItem("app-speech-lang", dom.settingsVoiceLang.value);
      showToast("Speech language preference saved", "success");
    });
  }

  // FSRS-5 Target Retention Slider
  if (dom.settingsTargetRetention) {
    const currentRate = Math.round(getTargetRetention() * 100);
    dom.settingsTargetRetention.value = currentRate;
    if (dom.targetRetentionBadge) dom.targetRetentionBadge.textContent = `${currentRate}%`;

    dom.settingsTargetRetention.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      if (dom.targetRetentionBadge) dom.targetRetentionBadge.textContent = `${val}%`;
      setTargetRetention(val / 100);
    });

    dom.settingsTargetRetention.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      setTargetRetention(val / 100);
      showToast(`Target retention set to ${val}%`, "success");
    });
  }

  if (dom.settingsReviewCap) {
    dom.settingsReviewCap.value = localStorage.getItem("app-review-cap") || "0";
    dom.settingsReviewCap.addEventListener("change", () => {
      localStorage.setItem("app-review-cap", dom.settingsReviewCap.value);
      showToast("Daily review cap updated", "success");
      calculateStats();
      updateUIStats();
    });
  }

  updateSyncUIState();
  renderBackupsList();
}

/**
 * Render Local Database Backups List
 */
export async function renderBackupsList() {
  if (!dom.backupsListContainer) return;
  dom.backupsListContainer.innerHTML = "";

  try {
    const backups = await db.getLocalBackups();
    if (backups.length === 0) {
      dom.backupsListContainer.innerHTML = `
        <div style="padding: 14px; text-align: center; color: var(--text-secondary); font-size: 0.82rem;">
          No local backups saved yet. Click "Create Snapshot" or import new cards to auto-create backups.
        </div>`;
      return;
    }

    backups.forEach(backup => {
      const card = document.createElement("div");
      card.className = "backup-item-card";

      const info = document.createElement("div");
      info.className = "backup-item-info";
      const dt = new Date(backup.created_at).toLocaleString();
      info.innerHTML = `
        <div class="backup-item-label">${escapeHTML(backup.label || "Snapshot")}</div>
        <div class="backup-item-meta">${backup.card_count || (backup.cards ? backup.cards.length : 0)} flashcards • ${dt}</div>
      `;

      const actions = document.createElement("div");
      actions.className = "backup-item-actions";

      // Restore Button
      const btnRestore = document.createElement("button");
      btnRestore.className = "btn btn-secondary btn-sm";
      btnRestore.textContent = "Restore";
      btnRestore.title = "Restore flashcards from this snapshot";
      btnRestore.addEventListener("click", () => {
        showModal(
          "Restore Local Backup?",
          `Restoring "${backup.label}" will replace your current flashcard database with ${backup.card_count} cards from ${dt}. Proceed?`,
          async () => {
            try {
              await db.restoreLocalBackup(backup.id);
              showToast("Database restored successfully!", "success");
              await loadCardsFromDB();
              renderBackupsList();
              onSyncRequest();
            } catch (err) {
              console.error("Restore failed:", err);
              showToast("Failed to restore backup", "error");
            }
          }
        );
      });

      // Export JSON Button
      const btnExport = document.createElement("button");
      btnExport.className = "btn btn-secondary btn-sm";
      btnExport.textContent = "Export";
      btnExport.title = "Download snapshot as JSON";
      btnExport.addEventListener("click", () => {
        try {
          const json = JSON.stringify(backup.cards || [], null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `anamnesis_backup_${backup.created_at}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) {
          showToast("Failed to export backup", "error");
        }
      });

      // Delete Button
      const btnDelete = document.createElement("button");
      btnDelete.className = "btn btn-danger btn-sm";
      btnDelete.textContent = "✕";
      btnDelete.title = "Delete this backup snapshot";
      btnDelete.addEventListener("click", async () => {
        try {
          await db.deleteLocalBackup(backup.id);
          showToast("Backup deleted", "info");
          renderBackupsList();
        } catch (e) {
          showToast("Failed to delete backup", "error");
        }
      });

      actions.appendChild(btnRestore);
      actions.appendChild(btnExport);
      actions.appendChild(btnDelete);

      card.appendChild(info);
      card.appendChild(actions);
      dom.backupsListContainer.appendChild(card);
    });
  } catch (err) {
    console.error("Failed to load backups:", err);
  }
}

function logToConsole(text, isError = false) {
  if (!dom.syncConsoleLog) return;
  dom.syncConsoleLog.classList.remove("hidden");
  const line = document.createElement("div");
  line.style.color = isError ? "var(--danger-color)" : "";
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  dom.syncConsoleLog.appendChild(line);
  dom.syncConsoleLog.scrollTop = dom.syncConsoleLog.scrollHeight;
}

async function validateGitHubToken() {
  const pat = dom.settingsPat.value.trim();
  if (!pat) { showToast("Please enter a GitHub Token first", "error"); return; }
  logToConsole("Validating Personal Access Token with GitHub...");
  dom.btnValidateToken.disabled = true;
  try {
    const user = await sync.testToken(pat);
    logToConsole(`Success! Connected as GitHub user: @${user.login}`);
    showToast(`Token valid! Account: @${user.login}`, "success");
    if (!dom.settingsGistId.value.trim()) {
      logToConsole("Searching for existing flashcard storage...");
      const existingId = await sync.findExistingFlashcardGist(pat);
      if (existingId) {
        dom.settingsGistId.value = existingId;
        logToConsole(`Found existing Gist: ${existingId}`);
        showToast("Auto-linked to your existing Gist!", "success");
      } else {
        logToConsole("No existing Gist found. Click 'Create Gist' to set one up.");
      }
    }
  } catch (err) {
    logToConsole(err.message, true);
    showToast("Token validation failed", "error");
  } finally {
    dom.btnValidateToken.disabled = false;
  }
}

async function createSyncGist() {
  const pat = dom.settingsPat.value.trim();
  if (!pat) { showToast("Token required to create a Gist", "error"); return; }
  logToConsole("Setting up GitHub Gist for data synchronization...");
  dom.btnCreateGist.disabled = true;
  try {
    const gistId = await sync.createFlashcardGist(pat);
    dom.settingsGistId.value = gistId;
    logToConsole(`Success! Connected to Gist: ${gistId}`);
    logToConsole("Click 'Save Config' below to persist these credentials.");
    showToast("Gist connected successfully!", "success");
  } catch (err) {
    logToConsole(err.message, true);
    showToast("Failed to connect Gist", "error");
  } finally {
    dom.btnCreateGist.disabled = false;
  }
}

async function saveSyncConfig() {
  const pat = dom.settingsPat.value.trim();
  let gistId = dom.settingsGistId.value.trim();
  if (!pat) {
    sync.clearSyncCredentials();
    state.syncCredentials = { pat: "", gistId: "" };
    updateSyncUIState();
    showToast("Sync credentials removed.", "info");
    return;
  }
  if (!gistId) {
    try {
      logToConsole("Auto-discovering or creating Gist...");
      gistId = await sync.createFlashcardGist(pat);
      dom.settingsGistId.value = gistId;
      logToConsole(`Gist linked: ${gistId}`);
    } catch (e) {
      showToast("Could not auto-create Gist: " + e.message, "error");
      return;
    }
  }
  sync.saveSyncCredentials(pat, gistId);
  state.syncCredentials = { pat, gistId };
  updateSyncUIState();
  showToast("Credentials saved & synchronized!", "success");
  triggerManualSync();
}

let isSyncInProgress = false;
let syncQueued = false;
let syncDebounceTimer = null;

/**
 * Debounces rapid sync requests (e.g. grading multiple cards in succession)
 */
export function requestDebouncedSync(delayMs = 1200) {
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    performBackgroundSync();
  }, delayMs);
}

export async function triggerManualSync() {
  if (!state.syncCredentials.pat || !state.syncCredentials.gistId) {
    showToast("Sync not configured", "error");
    return;
  }

  if (isSyncInProgress) {
    showToast("Sync already in progress...", "info");
    return;
  }

  isSyncInProgress = true;
  setSyncStateIndicator("syncing");
  logToConsole("Starting database synchronization...");
  if (dom.btnForceSync) dom.btnForceSync.disabled = true;

  try {
    const localCards = await db.getCards();
    const result = await sync.syncCards(localCards);

    if (result.changed || result.status === "pulled_from_remote" || result.status === "merged_with_remote") {
      await db.replaceCards(result.cards);
      await loadCardsFromDB();
      logToConsole("Downloaded updates from cloud and merged successfully.");
    } else if (result.status === "pushed_to_remote") {
      logToConsole("Pushed local database updates to cloud.");
    } else if (result.status === "no_change") {
      logToConsole("Database is already up to date with cloud.");
    }

    logToConsole(`Sync complete. Active cards: ${state.allCards.filter(c => !c.deleted).length}`);
    showToast("Synchronization complete!", "success");
    setSyncStateIndicator("synced");
  } catch (err) {
    logToConsole(`Sync failed: ${err.message}`, true);
    showToast("Sync failed: " + err.message, "error");
    setSyncStateIndicator("failed");
  } finally {
    isSyncInProgress = false;
    if (dom.btnForceSync) dom.btnForceSync.disabled = false;
    updateSyncUIState();
  }
}

export async function performBackgroundSync(silent = true) {
  if (!state.syncCredentials.pat || !state.syncCredentials.gistId) {
    setSyncStateIndicator("unconfigured");
    return;
  }

  if (isSyncInProgress) {
    syncQueued = true;
    return;
  }

  isSyncInProgress = true;
  setSyncStateIndicator("syncing");

  try {
    const localCards = await db.getCards();
    const result = await sync.syncCards(localCards);

    if (result.changed || result.status === "pulled_from_remote" || result.status === "merged_with_remote") {
      await db.replaceCards(result.cards);
      await loadCardsFromDB();
      if (!silent) showToast("Synced card updates from cloud", "success");
    }

    setSyncStateIndicator("synced");
  } catch (err) {
    console.warn("Background sync warning:", err);
    setSyncStateIndicator("failed");
  } finally {
    isSyncInProgress = false;
    updateSyncUIState();

    if (syncQueued) {
      syncQueued = false;
      setTimeout(() => performBackgroundSync(silent), 500);
    }
  }
}

export function setSyncStateIndicator(state_) {
  if (dom.headerSyncStatus) {
    dom.headerSyncStatus.className = "header-sync";
    if (state_ === "synced") dom.headerSyncStatus.classList.add("synced");
    else if (state_ === "syncing") dom.headerSyncStatus.classList.add("syncing");
    else if (state_ === "failed") dom.headerSyncStatus.classList.add("failed");
  }
  if (dom.syncLabelText) {
    const labels = { synced: "Synced", syncing: "Syncing...", failed: "Sync Failed" };
    dom.syncLabelText.textContent = labels[state_] || "Offline";
  }
}

function updateSyncUIState() {
  const { pat, gistId } = state.syncCredentials;
  if (pat && gistId) {
    dom.manualSyncContainer?.classList.remove("hidden");
    const lastSync = sync.getLastSyncTime();
    if (lastSync > 0) {
      if (dom.syncLastTimeLabel) dom.syncLastTimeLabel.textContent = `Last synced: ${new Date(lastSync).toLocaleString()}`;
      setSyncStateIndicator("synced");
    } else {
      if (dom.syncLastTimeLabel) dom.syncLastTimeLabel.textContent = "Last synced: Never";
      setSyncStateIndicator("unconfigured");
    }
  } else {
    dom.manualSyncContainer?.classList.add("hidden");
    setSyncStateIndicator("unconfigured");
  }
}

async function exportDatabaseToCSV() {
  const active = state.allCards.filter(c => !c.deleted);
  if (!active.length) { showToast("No cards to export", "error"); return; }
  let csv = "Folder,Deck,Front,Back,Sub-text,Description,Stability,Difficulty,State,Lapses,Interval,Reps,NextReview\n";
  active.forEach(c => {
    const f = c.fsrs_stats || {};
    csv += [
      escapeCSVField(getCardFolder(c)), escapeCSVField(getCardDeck(c)),
      escapeCSVField(c.front), escapeCSVField(c.back),
      escapeCSVField(c.sub || ""), escapeCSVField(c.description || ""),
      f.stability || 0, f.difficulty || 0,
      f.state ?? 0, f.lapses || 0,
      f.interval ?? 0,
      f.repetitions ?? 0,
      f.next_review || 0
    ].join(",") + "\n";
  });
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anamnesis_export_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast(`Exported ${active.length} cards!`, "success");
  } catch (err) {
    console.error(err); showToast("Failed to export CSV file", "error");
  }
}

function resetLocalDatabase() {
  showModal(
    "Delete All Local Data?",
    "This will permanently erase all local flashcards from this browser.",
    async () => {
      try {
        await db.clearDatabase();
        showToast("All local flashcards deleted", "success");
        await loadCardsFromDB();
      } catch (err) {
        console.error(err); showToast("Failed to clear database", "error");
      }
    }
  );
}


