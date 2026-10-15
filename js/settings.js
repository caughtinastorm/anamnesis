import { validateCards } from "./domain/data.js";
import { createSyncCoordinator } from "./services/sync-coordinator.js";
import { cardState, settingsState } from "./state.js";
import { dom, showToast, showModal } from "./ui.js";
import { getCardFolder, getCardDeck, escapeCSVField, escapeHTML } from "./utils.js";
import { sortCardsLogically } from "./explorer-actions.js";
import { getTargetRetention, setTargetRetention } from "../fsrs.js";
import * as sync from "../sync.js";
import * as db from "../db.js";
import { loadCardsFromDB } from "./cards.js";
import { calculateStats, updateUIStats } from "./dashboard.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

export function initSettingsEventListeners() {
  const backupInput = document.getElementById("restore-backup-file");
  document.getElementById("btn-restore-backup-file")?.addEventListener("click", () => backupInput?.click());
  backupInput?.addEventListener("change", async () => {
    const file = backupInput.files[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("Backup exceeds the 20 MB limit.");
      const data = JSON.parse(await file.text());
      const backup = Array.isArray(data) ? { cards: data, label: file.name } : data;
      validateCards(backup.cards);
      showModal("Restore JSON Backup?", `Replace current cards with ${backup.cards.length} cards from this file? A snapshot of your current data will be saved first.`, async () => {
        try {
          await db.restoreBackupData(backup);
          await loadCardsFromDB();
          await renderBackupsList();
          onSyncRequest();
          showToast("Backup restored", "success");
        } catch (error) { showToast(error.message, "error"); }
      });
    } catch (error) { showToast("Invalid backup: " + error.message, "error"); }
    finally { backupInput.value = ""; }
  });

  if (dom.btnValidateToken) dom.btnValidateToken.addEventListener("click", validateGitHubToken);
  if (dom.btnCreateGist) dom.btnCreateGist.addEventListener("click", createSyncGist);
  if (dom.btnSaveCredentials) dom.btnSaveCredentials.addEventListener("click", saveSyncConfig);
  if (dom.btnForceSync) dom.btnForceSync.addEventListener("click", triggerManualSync);
  if (dom.btnExportCsv) dom.btnExportCsv.addEventListener("click", exportDatabaseToCSV);
  if (dom.btnClearDb) dom.btnClearDb.addEventListener("click", resetLocalDatabase);

  if (dom.btnCreateBackupNow) {
    dom.btnCreateBackupNow.addEventListener("click", async () => {
      try {
        await db.createLocalBackup(`Manual Snapshot (${cardState.allCards.filter(c => !c.deleted).length} cards)`, cardState.allCards);
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
  dom.settingsPat.value = settingsState.syncCredentials.pat || "";
  dom.settingsGistId.value = settingsState.syncCredentials.gistId || "";

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
    dom.settingsReviewCap.value = localStorage.getItem("app-review-cap") ?? "10";
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
      btnRestore.title = "Restore cards and review history from this snapshot";
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
          const json = JSON.stringify(backup, null, 2);
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
  let gistId = sync.sanitizeGistId(dom.settingsGistId.value);
  if (!pat) {
    sync.clearSyncCredentials();
    settingsState.syncCredentials = { pat: "", gistId: "" };
    updateSyncUIState();
    showToast("Sync credentials removed.", "info");
    return;
  }
  if (!gistId) {
    try {
      logToConsole("Auto-discovering or creating Gist...");
      gistId = await sync.createFlashcardGist(pat);
      gistId = sync.sanitizeGistId(gistId);
      dom.settingsGistId.value = gistId;
      logToConsole(`Gist linked: ${gistId}`);
    } catch (e) {
      showToast("Could not auto-create Gist: " + e.message, "error");
      return;
    }
  } else {
    dom.settingsGistId.value = gistId;
  }
  sync.saveSyncCredentials(pat, gistId);
  settingsState.syncCredentials = { pat, gistId };
  updateSyncUIState();
  showToast("Credentials saved & synchronized!", "success");
  triggerManualSync();
}

const syncCoordinator = createSyncCoordinator({
  getCards: db.getCards,
  syncCards: sync.syncCards,
  applyCards: db.applySyncCards,
  acknowledge: sync.acknowledgeSync,
  backup: () => db.createLocalBackup("Before synchronization"),
  refresh: loadCardsFromDB,
  onState: (status, error) => {
    setSyncStateIndicator(status);
    if (dom.btnForceSync) dom.btnForceSync.disabled = status === "syncing";
    if (error) { console.warn("Synchronization failed:", error); logToConsole(error.message, true); }
  }
});

export function requestDebouncedSync(delayMs = 1200) { syncCoordinator.request(delayMs); }

export async function triggerManualSync() {
  if (!settingsState.syncCredentials.pat || !settingsState.syncCredentials.gistId) {
    showToast("Sync not configured", "error");
    return;
  }
  try {
    await syncCoordinator.run();
    showToast("Synchronization complete!", "success");
  } catch (error) {
    showToast("Sync failed: " + error.message, "error");
  } finally { updateSyncUIState(); }
}

export async function performBackgroundSync(silent = true) {
  try { return await syncCoordinator.run(); }
  catch (error) { if (!silent) showToast("Sync failed: " + error.message, "error"); }
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
    dom.syncLabelText.textContent = labels[state_] || "On this device";
  }
}

function updateSyncUIState() {
  const { pat, gistId } = settingsState.syncCredentials;
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
  const active = cardState.allCards.filter(c => !c.deleted);
  if (!active.length) { showToast("No cards to export", "error"); return; }
  const sorted = sortCardsLogically(active);
  let csv = "Folder,Deck,Front,Back,Sub-text,Description,Stability,Difficulty,State,Lapses,Interval,Reps,NextReview\n";
  sorted.forEach(c => {
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
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anamnesis_all_collections_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast(`Exported ${sorted.length} cards in logical order!`, "success");
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


