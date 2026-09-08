/**
 * anamnesis — Data-Science Cognitive Analytics & Reflection UI
 *
 * Renders the research-grade analytics views:
 * - KPI summary cards with Wilson Score confidence intervals
 * - Interactive Deck Health & Retention Matrix with multi-column sorting
 * - Memory Traps & Leech Radar with 1-click remediation
 * - Inline SVG Circadian 24-Hour Recall Performance Chart
 * - Inline SVG FSRS-5 Reliability Calibration Diagram (Brier Score)
 * - Timeliness & Overdue Forgetting Curve Breakdown
 * - Prescriptive Reflection & Diagnostic Action Cards
 */

import { state } from "./state.js";
import { showToast, showModal, switchView } from "./ui.js";
import { getCardFolder, getCardDeck, escapeHTML, limitText, formatDeckSelectionLabel } from "./utils.js";
import { getTargetRetention } from "../fsrs.js";
import * as db from "../db.js";
import { openEditCardModal } from "./browser.js";
import { executeResetCardsFSRS } from "./dashboard.js";
import {
  analyzeDecks,
  analyzeCardFriction,
  analyzeErgonomics,
  calculateModelCalibration,
  generatePrescriptions
} from "./analytics.js";

// UI Filter State
let activeTimeHorizon = null; // null = All Time, 7, 30, 90
let activeDeckFilter = "all";
let deckSortColumn = "totalReviews";
let deckSortAsc = false;
let isRendering = false;

// Cached analyzed data for quick UI re-filtering
let lastAnalyzedDecks = null;
let lastAnalyzedFriction = null;
let lastAnalyzedErgo = null;
let lastAnalyzedCal = null;

/**
 * Initialize Analytics view event listeners and time horizon toggles
 */
export function initAnalyticsUI() {
  // Time horizon filter buttons
  document.querySelectorAll(".analytics-horizon-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".analytics-horizon-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const val = btn.getAttribute("data-days");
      activeTimeHorizon = val ? parseInt(val, 10) : null;
      renderAnalyticsView();
    });
  });

  // Collection filter dropdown
  const deckFilterEl = document.getElementById("analytics-deck-filter");
  if (deckFilterEl) {
    deckFilterEl.addEventListener("change", (e) => {
      activeDeckFilter = e.target.value || "all";
      renderAnalyticsView();
    });
  }

  // Refresh button
  const btnRefresh = document.getElementById("btn-refresh-analytics");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      renderAnalyticsView(true);
      showToast("Analytics refreshed", "info");
    });
  }

  // Hook into tab changes to auto-refresh analytics when switching to view-analytics
  document.addEventListener("click", (e) => {
    const navBtn = e.target.closest(".nav-item") || e.target.closest("[data-view]");
    if (navBtn && navBtn.getAttribute("data-view") === "view-analytics") {
      setTimeout(() => renderAnalyticsView(), 50);
    }
  });
}

/**
 * Main render function for the Analytics view
 * @param {boolean} forceRefresh If true, forces fresh DB read
 */
export async function renderAnalyticsView(forceRefresh = false) {
  if (isRendering) return;
  isRendering = true;

  try {
    const targetRetention = getTargetRetention();

    // Fetch cards and historical review logs from IndexedDB
    const cards = state.allCards ? state.allCards.filter(c => !c.deleted) : [];
    const reviewLogs = await db.getAllReviewLogs();

    // Populate deck filter select dropdown if needed
    populateAnalyticsDeckDropdown(cards);

    // Run data-science analytics calculations
    const deckAnalysis = analyzeDecks(cards, reviewLogs, {
      targetRetention,
      timeHorizonDays: activeTimeHorizon
    });

    const cardFriction = analyzeCardFriction(cards, reviewLogs, {
      selectedDeck: activeDeckFilter,
      limit: 25
    });

    const ergonomics = analyzeErgonomics(reviewLogs);
    const calibration = calculateModelCalibration(reviewLogs);

    const prescriptions = generatePrescriptions({
      deckAnalytics: deckAnalysis,
      cardFriction,
      ergonomics,
      calibration,
      targetRetention
    });

    lastAnalyzedDecks = deckAnalysis;
    lastAnalyzedFriction = cardFriction;
    lastAnalyzedErgo = ergonomics;
    lastAnalyzedCal = calibration;

    // Render Sub-Components
    renderKPICards(deckAnalysis.summary, targetRetention, cardFriction.length);
    renderPrescriptions(prescriptions);
    renderDeckHealthTable(deckAnalysis.decks);
    renderLeechRadar(cardFriction);
    renderCircadianChart(ergonomics.circadian);
    renderCalibrationChart(calibration);
    renderTimelinessChart(ergonomics.timeliness);
  } catch (err) {
    console.error("Failed to render analytics view:", err);
  } finally {
    isRendering = false;
  }
}

/**
 * Populate collection options in the analytics filter dropdown
 */
function populateAnalyticsDeckDropdown(cards = []) {
  const select = document.getElementById("analytics-deck-filter");
  if (!select) return;

  const current = activeDeckFilter || "all";
  const uniqueDecks = new Set();

  cards.forEach(c => {
    const folder = getCardFolder(c);
    const deck = getCardDeck(c) || "Default";
    const key = folder ? `${folder} / ${deck}` : deck;
    uniqueDecks.add(key);
  });

  const sortedDecks = Array.from(uniqueDecks).sort();
  select.innerHTML = `<option value="all">📁 All Collections (${cards.length} cards)</option>`;

  sortedDecks.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = `↳ ${d}`;
    select.appendChild(opt);
  });

  if (Array.from(select.options).some(o => o.value === current)) {
    select.value = current;
  } else {
    select.value = "all";
    activeDeckFilter = "all";
  }
}

/**
 * Render High-Level KPI Summary Cards
 */
function renderKPICards(summary, targetRetention, leechCount = 0) {
  const retEl = document.getElementById("analytics-kpi-retention");
  const retCiEl = document.getElementById("analytics-kpi-retention-ci");
  const calEl = document.getElementById("analytics-kpi-cal-delta");
  const calStatusEl = document.getElementById("analytics-kpi-cal-status");
  const stabEl = document.getElementById("analytics-kpi-velocity");
  const stabSubEl = document.getElementById("analytics-kpi-velocity-sub");
  const leechEl = document.getElementById("analytics-kpi-leeches");
  const leechSubEl = document.getElementById("analytics-kpi-leeches-sub");

  if (!summary) return;

  // 1. Empirical Retention & Wilson CI
  if (retEl) {
    if (summary.totalReviews === 0) {
      retEl.textContent = "—";
    } else {
      retEl.textContent = `${(summary.empiricalRetention * 100).toFixed(1)}%`;
    }
  }
  if (retCiEl) {
    if (summary.totalReviews === 0) {
      retCiEl.textContent = "No reviews yet";
      retCiEl.className = "kpi-badge neutral";
    } else {
      const margin = (summary.wilsonCI.margin * 100).toFixed(1);
      retCiEl.textContent = `95% CI: ±${margin}% (${(summary.wilsonCI.lower * 100).toFixed(0)}%–${(summary.wilsonCI.upper * 100).toFixed(0)}%)`;
      retCiEl.className = summary.wilsonCI.margin <= 0.05 ? "kpi-badge success" : "kpi-badge info";
    }
  }

  // 2. Model Calibration Delta
  if (calEl && calStatusEl) {
    if (summary.totalReviews === 0) {
      calEl.textContent = `Target: ${(targetRetention * 100).toFixed(0)}%`;
      calStatusEl.textContent = "Uncalibrated";
      calStatusEl.className = "kpi-badge neutral";
    } else {
      const delta = summary.calibrationDelta;
      const deltaPct = (delta * 100).toFixed(1);
      const sign = delta >= 0 ? "+" : "";
      calEl.textContent = `${sign}${deltaPct}% vs Target`;
      if (Math.abs(delta) <= 0.04) {
        calStatusEl.textContent = "🎯 Well Calibrated";
        calStatusEl.className = "kpi-badge success";
      } else if (delta < -0.04) {
        calStatusEl.textContent = "⚠️ Under-Performing";
        calStatusEl.className = "kpi-badge danger";
      } else {
        calStatusEl.textContent = "📈 Over-Retention";
        calStatusEl.className = "kpi-badge warning";
      }
    }
  }

  // 3. Stability Velocity (Memory half-life expansion)
  if (stabEl && stabSubEl) {
    if (summary.totalReviews === 0) {
      stabEl.textContent = "0.0d";
      stabSubEl.textContent = "Awaiting review history";
    } else {
      stabEl.textContent = `+${summary.stabilityVelocity.toFixed(1)}d`;
      stabSubEl.textContent = `Half-life gain / review • ${summary.efficiencyGrade} (${summary.efficiencyScore} pts)`;
    }
  }

  // 4. Memory Traps / Leech Radar count
  if (leechEl && leechSubEl) {
    leechEl.textContent = leechCount;
    if (leechCount === 0) {
      leechSubEl.textContent = "Clean memory stream 🎉";
      leechEl.style.color = "var(--text-primary)";
    } else if (leechCount <= 3) {
      leechSubEl.textContent = "Minor friction detected";
      leechEl.style.color = "#f59e0b";
    } else {
      leechSubEl.textContent = "Action recommended";
      leechEl.style.color = "#ef4444";
    }
  }
}

/**
 * Render Prescriptive Reflection Insight Cards
 */
function renderPrescriptions(prescriptions = []) {
  const container = document.getElementById("analytics-prescriptions-container");
  if (!container) return;

  if (!prescriptions || prescriptions.length === 0) {
    container.innerHTML = `
      <div class="prescription-empty-card">
        <span class="prescription-icon">🧠</span>
        <div class="prescription-content">
          <h4>Memory Stream Clean</h4>
          <p>Your study cadence and card designs are balanced. No cognitive traps or significant calibration errors detected.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  prescriptions.forEach(p => {
    const card = document.createElement("div");
    card.className = `prescription-card ${p.type}`;

    let icon = "💡";
    if (p.type === "danger") icon = "⚠️";
    else if (p.type === "warning") icon = "🚨";
    else if (p.type === "kudos") icon = "🏆";
    else if (p.type === "insight") icon = "⚡";

    card.innerHTML = `
      <div class="prescription-header">
        <span class="prescription-badge ${p.type}">${escapeHTML(p.category || "Insight")}</span>
        <span class="prescription-icon-mini">${icon}</span>
      </div>
      <h4 class="prescription-title">${escapeHTML(p.title)}</h4>
      <p class="prescription-message">${escapeHTML(p.message)}</p>
      ${p.actionLabel && p.actionType !== "none" ? `
        <button type="button" class="btn-prescription-action" data-action="${p.actionType}" data-target="${escapeHTML(p.target || "")}">
          ${escapeHTML(p.actionLabel)} →
        </button>
      ` : ""}
    `;

    // Action button wiring
    const btnAction = card.querySelector(".btn-prescription-action");
    if (btnAction) {
      btnAction.addEventListener("click", () => {
        handlePrescriptionAction(p.actionType, p.target);
      });
    }

    container.appendChild(card);
  });
}

function handlePrescriptionAction(actionType, target) {
  if (actionType === "filter_deck") {
    activeDeckFilter = target;
    const select = document.getElementById("analytics-deck-filter");
    if (select) select.value = target;
    renderAnalyticsView();
    scrollToId("analytics-leech-radar-section");
  } else if (actionType === "scroll_leech") {
    scrollToId("analytics-leech-radar-section");
  } else if (actionType === "scroll_circadian") {
    scrollToId("analytics-circadian-section");
  } else if (actionType === "start_due") {
    switchView("view-review");
  } else if (actionType === "view_settings") {
    switchView("view-settings");
  }
}

function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Render Interactive Deck Health & Retention Matrix
 */
function renderDeckHealthTable(decks = []) {
  const tbody = document.getElementById("analytics-deck-table-body");
  if (!tbody) return;

  if (!decks || decks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty-cell">No collections found in your library.</td></tr>`;
    return;
  }

  // Filter if activeDeckFilter is set
  let displayedDecks = [...decks];
  if (activeDeckFilter && activeDeckFilter !== "all") {
    displayedDecks = displayedDecks.filter(d => d.key === activeDeckFilter);
  }

  // Multi-column sorting
  displayedDecks.sort((a, b) => {
    let valA = a[deckSortColumn];
    let valB = b[deckSortColumn];
    if (typeof valA === "string") valA = valA.toLowerCase();
    if (typeof valB === "string") valB = valB.toLowerCase();
    if (valA < valB) return deckSortAsc ? -1 : 1;
    if (valA > valB) return deckSortAsc ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = "";
  displayedDecks.forEach(deck => {
    const tr = document.createElement("tr");
    tr.className = `deck-health-row status-${deck.healthStatus}`;

    const retPct = (deck.empiricalRetention * 100).toFixed(1);
    const ciMargin = (deck.wilsonCI.margin * 100).toFixed(1);
    const barWidth = Math.min(100, Math.max(0, deck.empiricalRetention * 100));

    let statusPillClass = "status-optimal";
    if (deck.healthStatus === "critical_friction") statusPillClass = "status-critical";
    else if (deck.healthStatus === "needs_attention") statusPillClass = "status-warning";
    else if (deck.healthStatus === "over_practiced") statusPillClass = "status-over";
    else if (deck.healthStatus === "insufficient_data") statusPillClass = "status-neutral";

    tr.innerHTML = `
      <td class="col-deck-name">
        <div class="deck-name-wrap">
          <span class="deck-title-main">${escapeHTML(deck.deck)}</span>
          ${deck.folder ? `<span class="deck-folder-sub">📁 ${escapeHTML(deck.folder)}</span>` : ""}
        </div>
      </td>
      <td class="col-cards-count">${deck.totalCards}</td>
      <td class="col-reviews-count">
        <span>${deck.totalReviews}</span>
        <span class="reviews-pass-ratio">${deck.passedReviews}✓ / ${deck.failedReviews}✗</span>
      </td>
      <td class="col-retention">
        <div class="retention-cell-wrap">
          <div class="retention-val-row">
            <span class="retention-pct-val">${deck.totalReviews > 0 ? `${retPct}%` : "—"}</span>
            ${deck.totalReviews > 0 ? `<span class="retention-ci-pill">±${ciMargin}%</span>` : ""}
          </div>
          <div class="retention-bar-bg">
            <div class="retention-bar-fill ${deck.healthStatus}" style="width: ${barWidth}%;"></div>
          </div>
        </div>
      </td>
      <td class="col-stability">${deck.avgStability.toFixed(1)}d</td>
      <td class="col-velocity">+${deck.stabilityVelocity.toFixed(1)}d</td>
      <td class="col-difficulty">${deck.avgDifficulty.toFixed(1)}</td>
      <td class="col-efficiency">
        <span class="efficiency-grade-badge grade-${deck.efficiencyGrade.replace('+', '-plus')}">${deck.efficiencyGrade}</span>
        <span class="efficiency-score-sub">${deck.efficiencyScore} pts</span>
      </td>
      <td class="col-status">
        <span class="deck-status-pill ${statusPillClass}">${escapeHTML(deck.healthLabel)}</span>
      </td>
    `;

    // Row click filters to this deck's leech radar
    tr.addEventListener("click", () => {
      activeDeckFilter = deck.key;
      const select = document.getElementById("analytics-deck-filter");
      if (select) select.value = deck.key;
      renderAnalyticsView();
      scrollToId("analytics-leech-radar-section");
    });

    tbody.appendChild(tr);
  });

  // Attach Table Header Sort Click Listeners
  initDeckTableSortHeaders();
}

function initDeckTableSortHeaders() {
  document.querySelectorAll(".deck-table-th-sortable").forEach(th => {
    th.onclick = () => {
      const col = th.getAttribute("data-sort");
      if (!col) return;
      if (deckSortColumn === col) {
        deckSortAsc = !deckSortAsc;
      } else {
        deckSortColumn = col;
        deckSortAsc = false;
      }
      // Update UI sort indicators
      document.querySelectorAll(".deck-table-th-sortable").forEach(h => {
        h.classList.remove("sorted-asc", "sorted-desc");
      });
      th.classList.add(deckSortAsc ? "sorted-asc" : "sorted-desc");
      if (lastAnalyzedDecks) {
        renderDeckHealthTable(lastAnalyzedDecks.decks);
      }
    };
  });
}

/**
 * Render Memory Traps & Leech Radar (Word-Level Friction)
 */
function renderLeechRadar(frictionCards = []) {
  const container = document.getElementById("analytics-leech-list");
  const countBadge = document.getElementById("leech-radar-count-badge");
  if (!container) return;

  if (countBadge) countBadge.textContent = frictionCards.length;

  if (!frictionCards || frictionCards.length === 0) {
    container.innerHTML = `
      <div class="leech-empty-state">
        <span class="leech-empty-icon">🛡️</span>
        <h4>No Cognitive Traps Detected</h4>
        <p>No cards with recurring lapses or excessive dwell latency found in this selection.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  frictionCards.forEach(card => {
    const item = document.createElement("div");
    item.className = "leech-card-item";

    const flagTags = card.flags.map(f => {
      if (f === "leech_trap") return `<span class="leech-flag-tag danger">Leech Trap</span>`;
      if (f === "memory_treadmill") return `<span class="leech-flag-tag warning">Treadmill</span>`;
      if (f === "slow_dwell") return `<span class="leech-flag-tag info">Slow Latency</span>`;
      return `<span class="leech-flag-tag neutral">Unstable</span>`;
    }).join(" ");

    item.innerHTML = `
      <div class="leech-card-main">
        <div class="leech-card-header">
          <div class="leech-card-deck-tag">📁 ${escapeHTML(card.deck)}</div>
          <div class="leech-card-flags">${flagTags}</div>
        </div>
        <div class="leech-card-content">
          <div class="leech-prompt">${escapeHTML(limitText(card.front, 64))}</div>
          ${card.sub ? `<div class="leech-sub">${escapeHTML(limitText(card.sub, 48))}</div>` : ""}
          <div class="leech-answer">${escapeHTML(limitText(card.back, 80))}</div>
        </div>
        <div class="leech-card-prescription">
          <span class="rx-icon">🩺</span>
          <span>${escapeHTML(card.prescription)}</span>
        </div>
      </div>

      <div class="leech-card-metrics">
        <div class="leech-metric-col">
          <span class="metric-val text-danger">${card.lapses}</span>
          <span class="metric-lbl">Lapses</span>
        </div>
        <div class="leech-metric-col">
          <span class="metric-val">${card.stability}d</span>
          <span class="metric-lbl">Stability</span>
        </div>
        <div class="leech-metric-col">
          <span class="metric-val">${card.difficulty}</span>
          <span class="metric-lbl">Difficulty</span>
        </div>
        <div class="leech-metric-col">
          <span class="metric-val text-warning">${card.lsi.toFixed(1)}</span>
          <span class="metric-lbl">LSI Index</span>
        </div>
      </div>

      <div class="leech-card-actions">
        <button type="button" class="btn-leech-action btn-leech-edit" title="Edit and simplify card prompt">
          ✏️ Edit
        </button>
        <button type="button" class="btn-leech-action btn-leech-reset" title="Erase tangled FSRS history to relearn clean">
          🔄 Reset FSRS
        </button>
      </div>
    `;

    // Button Wiring
    const btnEdit = item.querySelector(".btn-leech-edit");
    if (btnEdit) {
      btnEdit.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditCardModal(card.id);
      });
    }

    const btnReset = item.querySelector(".btn-leech-reset");
    if (btnReset) {
      btnReset.addEventListener("click", (e) => {
        e.stopPropagation();
        showModal(
          `Reset FSRS for "${limitText(card.front, 24)}"?`,
          `Are you sure you want to reset spaced repetition progress for this single card? It will return to New state so you can relearn it cleanly.`,
          async () => {
            const rawCard = state.allCards.find(c => (c.id || c._id) === card.id);
            if (rawCard) {
              await executeResetCardsFSRS([rawCard], rawCard.front);
              renderAnalyticsView();
            }
          }
        );
      });
    }

    container.appendChild(item);
  });
}

/**
 * Render Responsive Inline SVG Circadian 24-Hour Recall Performance Chart
 */
function renderCircadianChart(circadian) {
  const container = document.getElementById("analytics-circadian-chart-wrap");
  const insightEl = document.getElementById("circadian-window-insight");
  if (!container) return;

  if (!circadian || !circadian.hours) {
    container.innerHTML = `<div class="chart-empty-state">No hourly review history recorded yet.</div>`;
    return;
  }

  if (insightEl) {
    if (circadian.peakRetention !== null) {
      insightEl.innerHTML = `
        <span class="insight-badge success">⚡ Peak: ${circadian.peakWindow} (${circadian.peakRetention}% Recall)</span>
        ${circadian.fatigueRetention !== null ? `<span class="insight-badge danger">🌙 Fatigue: ${circadian.fatigueWindow} (${circadian.fatigueRetention}% Recall)</span>` : ""}
      `;
    } else {
      insightEl.innerHTML = `<span class="insight-badge neutral">Collecting circadian review data</span>`;
    }
  }

  const hours = circadian.hours;
  const maxReviews = Math.max(5, ...hours.map(h => h.reviews));

  const svgWidth = 720;
  const svgHeight = 220;
  const padLeft = 40;
  const padRight = 20;
  const padTop = 30;
  const padBottom = 35;
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;
  const barSlotWidth = plotWidth / 24;
  const barWidth = Math.max(4, barSlotWidth - 6);

  let barsSvg = "";
  let linePoints = [];
  let dotsSvg = "";

  hours.forEach((h, i) => {
    const x = padLeft + (i * barSlotWidth) + (barSlotWidth - barWidth) / 2;
    const barH = (h.reviews / maxReviews) * plotHeight;
    const y = padTop + (plotHeight - barH);

    // Highlight peak and fatigue hours
    let barFill = "rgba(255, 255, 255, 0.12)";
    if (i === circadian.peakHour) barFill = "rgba(16, 185, 129, 0.45)"; // green
    else if (i === circadian.fatigueHour) barFill = "rgba(239, 68, 68, 0.45)"; // red

    barsSvg += `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="3" fill="${barFill}">
        <title>${h.label}: ${h.reviews} reviews, ${(h.retention * 100).toFixed(1)}% recall</title>
      </rect>
    `;

    // Retention line points
    if (h.reviews > 0) {
      const lineX = padLeft + (i * barSlotWidth) + barSlotWidth / 2;
      const lineY = padTop + (1 - h.retention) * plotHeight;
      linePoints.push(`${lineX},${lineY}`);
      dotsSvg += `
        <circle cx="${lineX}" cy="${lineY}" r="3.5" fill="#ffffff" stroke="#000000" stroke-width="1.5">
          <title>${h.label}: ${(h.retention * 100).toFixed(1)}% retention (${h.reviews} reviews)</title>
        </circle>
      `;
    }
  });

  const polylineSvg = linePoints.length > 1
    ? `<polyline fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${linePoints.join(' ')}" />`
    : "";

  // Hour tick marks (every 3 hours)
  let ticksSvg = "";
  for (let i = 0; i < 24; i += 3) {
    const tx = padLeft + (i * barSlotWidth) + barSlotWidth / 2;
    ticksSvg += `<text x="${tx}" y="${svgHeight - 10}" text-anchor="middle" font-size="10" fill="#888888">${String(i).padStart(2, '0')}:00</text>`;
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="analytics-svg-chart">
      <!-- Grid lines -->
      <line x1="${padLeft}" y1="${padTop}" x2="${svgWidth - padRight}" y2="${padTop}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
      <line x1="${padLeft}" y1="${padTop + plotHeight * 0.5}" x2="${svgWidth - padRight}" y2="${padTop + plotHeight * 0.5}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
      <line x1="${padLeft}" y1="${padTop + plotHeight}" x2="${svgWidth - padRight}" y2="${padTop + plotHeight}" stroke="rgba(255,255,255,0.15)" />

      <!-- Y-Axis Labels -->
      <text x="${padLeft - 8}" y="${padTop + 4}" text-anchor="end" font-size="10" fill="#888888">100%</text>
      <text x="${padLeft - 8}" y="${padTop + plotHeight * 0.5 + 4}" text-anchor="end" font-size="10" fill="#888888">50%</text>
      <text x="${padLeft - 8}" y="${padTop + plotHeight + 4}" text-anchor="end" font-size="10" fill="#888888">0%</text>

      ${barsSvg}
      ${polylineSvg}
      ${dotsSvg}
      ${ticksSvg}
    </svg>
  `;
}

/**
 * Render FSRS-5 Reliability Diagram & Brier Calibration Score
 */
function renderCalibrationChart(calibration) {
  const container = document.getElementById("analytics-calibration-chart-wrap");
  const badgeEl = document.getElementById("calibration-rating-badge");
  if (!container) return;

  if (!calibration || !calibration.bins) {
    container.innerHTML = `<div class="chart-empty-state">No model calibration data available yet.</div>`;
    return;
  }

  if (badgeEl) {
    badgeEl.textContent = `Brier Score: ${calibration.brierScore.toFixed(4)} (${calibration.brierRating})`;
    badgeEl.className = `kpi-badge ${calibration.brierScore <= 0.15 ? "success" : "warning"}`;
  }

  const svgWidth = 360;
  const svgHeight = 240;
  const pad = 40;
  const plotSize = svgHeight - (pad * 2);

  // 45 degree perfect line: from (pad, pad + plotSize) to (pad + plotSize, pad)
  const perfectLine = `
    <line x1="${pad}" y1="${pad + plotSize}" x2="${pad + plotSize}" y2="${pad}"
          stroke="rgba(255, 255, 255, 0.25)" stroke-width="1.5" stroke-dasharray="4,4" />
  `;

  // Plot observed bins
  let observedPoints = [];
  let dotsSvg = "";

  calibration.bins.forEach(b => {
    if (b.count > 0) {
      const pred = b.meanPredicted; // 0..1
      const obs = b.meanObserved;   // 0..1

      const cx = pad + (pred * plotSize);
      const cy = pad + ((1 - obs) * plotSize);

      observedPoints.push(`${cx},${cy}`);
      dotsSvg += `
        <circle cx="${cx}" cy="${cy}" r="5" fill="#10b981" stroke="#ffffff" stroke-width="1.5">
          <title>${b.label}: Predicted ${(pred * 100).toFixed(1)}% vs Observed ${(obs * 100).toFixed(1)}% (${b.count} revs)</title>
        </circle>
      `;
    }
  });

  const curveSvg = observedPoints.length > 1
    ? `<polyline fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${observedPoints.join(' ')}" />`
    : "";

  container.innerHTML = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="analytics-svg-calibration">
      <!-- Axes -->
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${pad + plotSize}" stroke="rgba(255,255,255,0.2)" />
      <line x1="${pad}" y1="${pad + plotSize}" x2="${pad + plotSize}" y2="${pad + plotSize}" stroke="rgba(255,255,255,0.2)" />

      <!-- Labels -->
      <text x="${pad + plotSize / 2}" y="${svgHeight - 10}" text-anchor="middle" font-size="11" fill="#888888">Predicted Retrievability (R)</text>
      <text x="12" y="${pad + plotSize / 2}" text-anchor="middle" font-size="11" fill="#888888" transform="rotate(-90 12,${pad + plotSize / 2})">Actual Recall</text>

      ${perfectLine}
      ${curveSvg}
      ${dotsSvg}
    </svg>
  `;
}

/**
 * Render Timeliness & Overdue Decay Breakdown
 */
function renderTimelinessChart(timeliness) {
  const container = document.getElementById("analytics-timeliness-wrap");
  if (!container || !timeliness) return;

  const entries = Object.entries(timeliness);
  let html = `<div class="timeliness-grid">`;

  entries.forEach(([key, val]) => {
    const pct = val.reviews > 0 ? (val.retention * 100).toFixed(1) : "—";
    let badgeColor = "success";
    if (key === "overdue_moderate") badgeColor = "warning";
    if (key === "overdue_severe") badgeColor = "danger";

    html += `
      <div class="timeliness-card ${key}">
        <div class="timeliness-card-header">
          <span class="timeliness-label">${escapeHTML(val.label)}</span>
          <span class="kpi-badge ${badgeColor}">${val.reviews} reviews</span>
        </div>
        <div class="timeliness-stat-val">${pct}%</div>
        <div class="timeliness-bar-bg">
          <div class="timeliness-bar-fill ${badgeColor}" style="width: ${val.retention * 100}%;"></div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}
