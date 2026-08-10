import { state } from "./state.js";
import { dom, showToast, showModal } from "./ui.js";
import { getCardFolder, getCardDeck, escapeCSVField } from "./utils.js";
import * as sync from "../sync.js";
import * as db from "../db.js";
import { loadCardsFromDB, calculateStats, updateUIStats } from "./dashboard.js";

let onSyncRequest = () => {};
export function onSyncNeeded(cb) { onSyncRequest = cb; }

export function initSettingsEventListeners() {
  if (dom.btnValidateToken) dom.btnValidateToken.addEventListener("click", validateGitHubToken);
  if (dom.btnCreateGist) dom.btnCreateGist.addEventListener("click", createSyncGist);
  if (dom.btnSaveCredentials) dom.btnSaveCredentials.addEventListener("click", saveSyncConfig);
  if (dom.btnForceSync) dom.btnForceSync.addEventListener("click", triggerManualSync);
  if (dom.btnExportCsv) dom.btnExportCsv.addEventListener("click", exportDatabaseToCSV);
  if (dom.btnClearDb) dom.btnClearDb.addEventListener("click", resetLocalDatabase);
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

export async function triggerManualSync() {
  if (!state.syncCredentials.pat || !state.syncCredentials.gistId) {
    showToast("Sync not configured", "error");
    return;
  }
  setSyncStateIndicator("syncing");
  logToConsole("Starting database synchronization...");
  if (dom.btnForceSync) dom.btnForceSync.disabled = true;
  try {
    const localCards = await db.getCards();
    const result = await sync.syncCards(localCards);
    if (result.status === "merged_with_remote") {
      await db.replaceCards(result.cards);
      logToConsole("Downloaded updates from Gist and merged conflicts.");
    }
    await loadCardsFromDB();
    logToConsole(`Sync complete. Cards: ${state.allCards.filter(c => !c.deleted).length}`);
    showToast("Synchronization complete!", "success");
    setSyncStateIndicator("synced");
  } catch (err) {
    logToConsole(`Sync failed: ${err.message}`, true);
    showToast("Sync failed", "error");
    setSyncStateIndicator("failed");
  } finally {
    if (dom.btnForceSync) dom.btnForceSync.disabled = false;
    updateSyncUIState();
  }
}

export async function performBackgroundSync() {
  if (!state.syncCredentials.pat || !state.syncCredentials.gistId) {
    setSyncStateIndicator("unconfigured");
    return;
  }
  setSyncStateIndicator("syncing");
  try {
    const localCards = await db.getCards();
    const result = await sync.syncCards(localCards);
    if (result.status === "merged_with_remote") {
      await db.replaceCards(result.cards);
      await loadCardsFromDB();
      showToast("Synced card updates from cloud", "success");
    }
    setSyncStateIndicator("synced");
  } catch (err) {
    console.error("Background sync failed:", err);
    setSyncStateIndicator("failed");
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
  let csv = "Folder,Deck,Front,Back,Sub-text,Description,EaseFactor,Interval,Reps,NextReview\n";
  active.forEach(c => {
    csv += [
      escapeCSVField(getCardFolder(c)), escapeCSVField(getCardDeck(c)),
      escapeCSVField(c.front), escapeCSVField(c.back),
      escapeCSVField(c.sub || ""), escapeCSVField(c.description || ""),
      c.sm2_stats?.ease_factor || 2.5, c.sm2_stats?.interval || 0,
      c.sm2_stats?.repetitions || 0, c.sm2_stats?.next_review || 0
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

