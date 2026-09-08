/**
 * anamnesis — Data Science Cognitive Intelligence & Memory Analytics Engine
 *
 * Implements research-grade cognitive modeling and memory efficiency analytics:
 * 1. Wilson Score 95% Confidence Intervals for Empirical Retention
 * 2. Multi-Level Deck Health & Retention Matrix
 * 3. Leech Severity Index (LSI) & Memory Trap Diagnostics
 * 4. Response Dwell Time & Cognitive Friction Latency
 * 5. Circadian Efficiency Profiler (24-Hour Recall Performance)
 * 6. Timeliness & Overdue Forgetting Curve Degradation
 * 7. FSRS-5 Reliability Diagram & Brier Calibration Score
 * 8. Automated Heuristic Reflection & Prescription Engine
 */

import { calculateRetrievability, getTargetRetention, DEFAULT_TARGET_RETENTION } from "../fsrs.js";
import { getCardFolder, getCardDeck, matchesDeckSelection } from "./utils.js";

// ============================================================================
// 1. STATISTICAL CONFIDENCE INTERVALS (Wilson Score Interval)
// ============================================================================

/**
 * Calculates Wilson Score Interval for a binomial proportion (retention rate).
 * Provides statistical rigor for decks with low review counts where simple percentages lie.
 *
 * @param {number} successes Number of recalled reviews (grades 2, 3, 4)
 * @param {number} total Total review attempts (grades 1, 2, 3, 4)
 * @param {number} confidence Confidence level (default 0.95 for 95% CI, z ~ 1.95996)
 * @returns {{ center: number, lower: number, upper: number, margin: number, p: number, formatted: string }}
 */
export function wilsonScoreInterval(successes, total, confidence = 0.95) {
  const n = Math.max(0, parseInt(total, 10) || 0);
  const s = Math.max(0, parseInt(successes, 10) || 0);

  if (n <= 0) {
    return {
      center: 0,
      lower: 0,
      upper: 0,
      margin: 0,
      p: 0,
      formatted: "0.0% (±0.0%)"
    };
  }

  const p = Math.min(1, Math.max(0, s / n));
  // Standard normal quantile for confidence level
  let z = 1.95996398454; // 95% CI
  if (Math.abs(confidence - 0.90) < 0.01) z = 1.64485362695;
  if (Math.abs(confidence - 0.99) < 0.01) z = 2.57582930355;

  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const radicand = (p * (1 - p)) / n + z2 / (4 * n * n);
  const margin = (z * Math.sqrt(Math.max(0, radicand))) / denominator;

  const lower = Math.max(0, center - margin);
  const upper = Math.min(1, center + margin);

  const pct = (p * 100).toFixed(1);
  const mPct = (margin * 100).toFixed(1);

  return {
    center: Math.round(center * 10000) / 10000,
    lower: Math.round(lower * 10000) / 10000,
    upper: Math.round(upper * 10000) / 10000,
    margin: Math.round(margin * 10000) / 10000,
    p: Math.round(p * 10000) / 10000,
    formatted: `${pct}% (±${mPct}%)`
  };
}

// ============================================================================
// 2. WORD / CARD COGNITIVE FRICTION (Leech Severity Index)
// ============================================================================

/**
 * Computes the Leech Severity Index (LSI) for an individual card.
 *
 * LSI combines:
 * - Repeated memory lapses (L)
 * - Intrinsic FSRS difficulty (D in [1, 10])
 * - Memory stability stagnation (S in days)
 *
 * Formula: LSI = Lapses * (Difficulty / 10) * (1 / log2(max(0.1, Stability) + 2))
 *
 * @param {number} lapses Number of failed reviews (lapses)
 * @param {number} difficulty FSRS difficulty rating (1..10)
 * @param {number} stability FSRS stability rating in days
 * @param {number} reps Total repetitions
 * @returns {number} Dynamic Leech Severity score (0.0 to 20.0+)
 */
export function calculateLeechSeverity(lapses = 0, difficulty = 5.0, stability = 0.1, reps = 0) {
  const l = Math.max(0, Number(lapses) || 0);
  if (l === 0) return 0;

  const d = Math.min(10, Math.max(1, Number(difficulty) || 5.0));
  const s = Math.max(0.01, Number(stability) || 0.1);

  // log2(S + 2): as stability grows (e.g. S=30 -> log2(32) = 5), LSI attenuates drastically
  const logTerm = Math.log2(s + 2);
  const lsi = l * (d / 10) * (1 / Math.max(0.5, logTerm));

  return Math.round(lsi * 100) / 100;
}

/**
 * Calculates Memory Return-on-Investment (Stability Days gained per minute spent)
 *
 * @param {number} stabilityDelta Net stability gained (S_after - S_before)
 * @param {number} durationMs Active dwell time in milliseconds
 * @returns {number} Days gained per minute of active recall
 */
export function calculateCardMemoryROI(stabilityDelta = 0, durationMs = 0) {
  const delta = Math.max(0, Number(stabilityDelta) || 0);
  const mins = Math.max(0.05, (Number(durationMs) || 5000) / 60000);
  return Math.round((delta / mins) * 10) / 10;
}

// ============================================================================
// 3. COMPOSITE EFFICIENCY SCORE
// ============================================================================

/**
 * Computes a standardized 0-100 composite efficiency score and letter grade.
 *
 * Balanced weights:
 * - Empirical Retention vs Target (40%)
 * - Stability Velocity (30%)
 * - Difficulty Management (15%)
 * - Dwell Latency Efficiency (15%)
 *
 * @param {Object} params
 * @returns {{ score: number, grade: string }}
 */
export function calculateEfficiencyScore({
  retentionRate = 0,
  targetRetention = 0.90,
  stabilityVelocity = 0,
  avgDifficulty = 5.0,
  avgDurationMs = 0
}) {
  const target = Math.max(0.70, Number(targetRetention) || 0.90);
  const ret = Math.min(1, Math.max(0, Number(retentionRate) || 0));

  // 1. Retention component (40 pts)
  const retRatio = Math.min(1.15, ret / target);
  const retPoints = Math.min(40, retRatio * 38);

  // 2. Stability velocity component (30 pts) — benchmark: 3.0 days/review = 30 pts
  const vel = Math.max(0, Number(stabilityVelocity) || 0);
  const velPoints = Math.min(30, (vel / 3.0) * 30);

  // 3. Difficulty component (15 pts) — lower average difficulty = cleaner cards
  const diff = Math.min(10, Math.max(1, Number(avgDifficulty) || 5.0));
  const diffPoints = Math.max(0, (1 - diff / 10)) * 15;

  // 4. Latency component (15 pts) — target: <= 4000ms = 15 pts, >= 15000ms = 2 pts
  const durSec = avgDurationMs > 0 ? avgDurationMs / 1000 : 4.5;
  const latPoints = Math.max(2, Math.min(15, 15 * (1 - (durSec - 2) / 16)));

  const totalScore = Math.round(Math.min(100, Math.max(0, retPoints + velPoints + diffPoints + latPoints)) * 10) / 10;

  let grade = "C";
  if (totalScore >= 92) grade = "A+";
  else if (totalScore >= 84) grade = "A";
  else if (totalScore >= 75) grade = "B+";
  else if (totalScore >= 66) grade = "B";
  else if (totalScore >= 55) grade = "C";
  else grade = "D";

  return { score: totalScore, grade };
}

// ============================================================================
// 4. DECK-LEVEL RETENTION & HEALTH MATRIX AGGREGATOR
// ============================================================================

/**
 * Generates comprehensive deck-level data-science analytics across all collections.
 *
 * @param {Array<Object>} cards All flashcards in database
 * @param {Array<Object>} reviewLogs Historical review logs
 * @param {Object} options Configuration options
 * @returns {{ decks: Array<Object>, summary: Object }}
 */
export function analyzeDecks(cards = [], reviewLogs = [], options = {}) {
  const targetRetention = options.targetRetention || getTargetRetention() || DEFAULT_TARGET_RETENTION;
  const timeHorizonDays = options.timeHorizonDays || null;
  const now = Date.now();
  const timeLimit = timeHorizonDays ? now - (timeHorizonDays * 24 * 60 * 60 * 1000) : 0;

  // Build card lookup map
  const cardMap = new Map();
  const validCards = (cards || []).filter(c => !c.deleted);
  validCards.forEach(c => {
    const cid = c.id || c._id;
    if (cid) cardMap.set(cid, c);
  });

  // Filter relevant review logs
  const filteredLogs = (reviewLogs || []).filter(log => {
    if (!log || !log.timestamp) return false;
    if (timeLimit > 0 && log.timestamp < timeLimit) return false;
    return true;
  });

  // Group cards by deck key (folder / deck)
  const deckCardsMap = new Map();
  validCards.forEach(card => {
    const folder = getCardFolder(card);
    const deck = getCardDeck(card) || "Default";
    const key = folder ? `${folder} / ${deck}` : deck;
    if (!deckCardsMap.has(key)) {
      deckCardsMap.set(key, { folder, deck, cards: [] });
    }
    deckCardsMap.get(key).cards.push(card);
  });

  // Group logs by deck key
  const deckLogsMap = new Map();
  filteredLogs.forEach(log => {
    let key = "Default";
    if (log.folder && log.deck) {
      key = `${log.folder} / ${log.deck}`;
    } else if (log.deck) {
      key = log.deck;
    } else if (log.card_id && cardMap.has(log.card_id)) {
      const c = cardMap.get(log.card_id);
      const folder = getCardFolder(c);
      const deck = getCardDeck(c) || "Default";
      key = folder ? `${folder} / ${deck}` : deck;
    }

    if (!deckLogsMap.has(key)) {
      deckLogsMap.set(key, []);
    }
    deckLogsMap.get(key).push(log);
  });

  // Combine unique keys
  const allKeys = new Set([...deckCardsMap.keys(), ...deckLogsMap.keys()]);
  const deckResults = [];

  let overallCardsCount = 0;
  let overallReviewsCount = 0;
  let overallPassesCount = 0;
  let overallLapsesCount = 0;
  let overallStabilityGain = 0;
  let overallDurationMs = 0;
  let overallDurationCount = 0;

  allKeys.forEach(key => {
    const deckInfo = deckCardsMap.get(key) || { folder: "", deck: key, cards: [] };
    const dCards = deckInfo.cards;
    const dLogs = deckLogsMap.get(key) || [];

    // Card state distributions
    let newCount = 0;
    let learningCount = 0;
    let reviewCount = 0;
    let matureCount = 0; // Stability >= 21 days
    let totalDifficulty = 0;
    let totalStability = 0;
    let reviewedCardCount = 0;
    let leechCount = 0;

    dCards.forEach(card => {
      const fsrs = card.fsrs_stats || {};
      const st = fsrs.state ?? 0;
      const s = fsrs.stability || 0;
      const d = fsrs.difficulty || 5.0;
      const lapses = fsrs.lapses || 0;
      const reps = fsrs.repetitions || 0;

      if (st === 0 || reps === 0) {
        newCount++;
      } else if (st === 1 || st === 3) {
        learningCount++;
        reviewedCardCount++;
        totalStability += s;
        totalDifficulty += d;
      } else {
        reviewCount++;
        reviewedCardCount++;
        totalStability += s;
        totalDifficulty += d;
        if (s >= 21) matureCount++;
      }

      const lsi = calculateLeechSeverity(lapses, d, s, reps);
      if (lsi >= 2.0 || lapses >= 3) {
        leechCount++;
      }
    });

    // Review statistics
    let passes = 0;
    let fails = 0;
    let hardCount = 0;
    let goodCount = 0;
    let easyCount = 0;
    let netStabilityGain = 0;
    let totalDuration = 0;
    let durationLogCount = 0;

    dLogs.forEach(log => {
      const g = Number(log.grade) || 0;
      if (g >= 2) passes++;
      else if (g === 1) fails++;

      if (g === 2) hardCount++;
      else if (g === 3) goodCount++;
      else if (g === 4) easyCount++;

      const sBefore = Number(log.stability_before) || 0;
      const sAfter = Number(log.stability_after) || 0;
      netStabilityGain += Math.max(0, sAfter - sBefore);

      if (log.duration_ms && log.duration_ms > 0) {
        totalDuration += Math.min(180000, log.duration_ms);
        durationLogCount++;
      }
    });

    const totalReviews = passes + fails;
    const empiricalRetention = totalReviews > 0 ? passes / totalReviews : 0;
    const wilson = wilsonScoreInterval(passes, totalReviews);
    const calibrationDelta = totalReviews > 0 ? empiricalRetention - targetRetention : 0;

    const avgStability = reviewedCardCount > 0 ? Math.round((totalStability / reviewedCardCount) * 10) / 10 : 0;
    const avgDifficulty = reviewedCardCount > 0 ? Math.round((totalDifficulty / reviewedCardCount) * 10) / 10 : 5.0;
    const stabilityVelocity = totalReviews > 0 ? Math.round((netStabilityGain / totalReviews) * 100) / 100 : 0;
    const avgDurationMs = durationLogCount > 0 ? Math.round(totalDuration / durationLogCount) : 0;

    const { score: efficiencyScore, grade: efficiencyGrade } = calculateEfficiencyScore({
      retentionRate: empiricalRetention,
      targetRetention,
      stabilityVelocity,
      avgDifficulty,
      avgDurationMs
    });

    // Determine Health Status
    let healthStatus = "optimal";
    let healthLabel = "Optimal Health";
    if (totalReviews < 5 && dCards.length < 5) {
      healthStatus = "insufficient_data";
      healthLabel = "Emerging / Low Data";
    } else if (totalReviews >= 5 && (empiricalRetention < 0.78 || calibrationDelta < -0.12)) {
      healthStatus = "critical_friction";
      healthLabel = "Critical Friction";
    } else if (totalReviews >= 5 && (empiricalRetention < 0.85 || calibrationDelta < -0.05)) {
      healthStatus = "needs_attention";
      healthLabel = "Needs Attention";
    } else if (totalReviews >= 25 && empiricalRetention > 0.97) {
      healthStatus = "over_practiced";
      healthLabel = "High Over-Practice";
    }

    deckResults.push({
      key,
      folder: deckInfo.folder || "",
      deck: deckInfo.deck || key,
      totalCards: dCards.length,
      newCards: newCount,
      learningCards: learningCount,
      reviewCards: reviewCount,
      matureCards: matureCount,
      totalReviews,
      passedReviews: passes,
      failedReviews: fails,
      hardCount,
      goodCount,
      easyCount,
      empiricalRetention: Math.round(empiricalRetention * 1000) / 1000,
      wilsonCI: wilson,
      targetRetention,
      calibrationDelta: Math.round(calibrationDelta * 1000) / 1000,
      avgStability,
      avgDifficulty,
      stabilityVelocity,
      avgDurationMs,
      leechCount,
      efficiencyScore,
      efficiencyGrade,
      healthStatus,
      healthLabel
    });

    // Rollup accumulators
    overallCardsCount += dCards.length;
    overallReviewsCount += totalReviews;
    overallPassesCount += passes;
    overallLapsesCount += fails;
    overallStabilityGain += netStabilityGain;
    overallDurationMs += totalDuration;
    overallDurationCount += durationLogCount;
  });

  // Sort decks: Most reviewed first by default
  deckResults.sort((a, b) => b.totalReviews - a.totalReviews || b.totalCards - a.totalCards);

  // Overall Library Summary
  const overallRetention = overallReviewsCount > 0 ? overallPassesCount / overallReviewsCount : 0;
  const overallWilson = wilsonScoreInterval(overallPassesCount, overallReviewsCount);
  const overallCalibrationDelta = overallReviewsCount > 0 ? overallRetention - targetRetention : 0;
  const overallVelocity = overallReviewsCount > 0 ? Math.round((overallStabilityGain / overallReviewsCount) * 100) / 100 : 0;
  const overallAvgDurationMs = overallDurationCount > 0 ? Math.round(overallDurationMs / overallDurationCount) : 0;

  const { score: overallEfficiencyScore, grade: overallEfficiencyGrade } = calculateEfficiencyScore({
    retentionRate: overallRetention,
    targetRetention,
    stabilityVelocity: overallVelocity,
    avgDifficulty: 5.0,
    avgDurationMs: overallAvgDurationMs
  });

  return {
    decks: deckResults,
    summary: {
      totalDecks: deckResults.length,
      totalCards: overallCardsCount,
      totalReviews: overallReviewsCount,
      passedReviews: overallPassesCount,
      failedReviews: overallLapsesCount,
      empiricalRetention: Math.round(overallRetention * 1000) / 1000,
      wilsonCI: overallWilson,
      targetRetention,
      calibrationDelta: Math.round(overallCalibrationDelta * 1000) / 1000,
      stabilityVelocity: overallVelocity,
      avgDurationMs: overallAvgDurationMs,
      efficiencyScore: overallEfficiencyScore,
      efficiencyGrade: overallEfficiencyGrade
    }
  };
}

// ============================================================================
// 5. WORD & CARD FRICTION DIAGNOSTICS (Memory Traps & Leech Radar)
// ============================================================================

/**
 * Analyzes individual cards to locate cognitive traps, excessive response latency,
 * and high-friction leeches dragging down deck efficiency.
 *
 * @param {Array<Object>} cards Flashcard objects
 * @param {Array<Object>} reviewLogs Review logs
 * @param {Object} options Filter options
 * @returns {Array<Object>} Ranked friction cards with prescriptions
 */
export function analyzeCardFriction(cards = [], reviewLogs = [], options = {}) {
  const limit = options.limit || 30;
  const selectedDeck = options.selectedDeck || "all";

  // Group review logs by card ID for telemetry
  const logStatsByCard = new Map();
  (reviewLogs || []).forEach(log => {
    if (!log || !log.card_id) return;
    const cid = log.card_id;
    if (!logStatsByCard.has(cid)) {
      logStatsByCard.set(cid, {
        reviews: 0,
        fails: 0,
        totalDuration: 0,
        durationCount: 0,
        lastGrade: null,
        lastTimestamp: 0
      });
    }
    const st = logStatsByCard.get(cid);
    st.reviews++;
    if (log.grade === 1) st.fails++;
    if (log.duration_ms && log.duration_ms > 0) {
      st.totalDuration += Math.min(180000, log.duration_ms);
      st.durationCount++;
    }
    if (log.timestamp > st.lastTimestamp) {
      st.lastTimestamp = log.timestamp;
      st.lastGrade = log.grade;
    }
  });

  const frictionCards = [];

  (cards || []).forEach(card => {
    if (card.deleted) return;
    if (selectedDeck !== "all" && !matchesDeckSelection(card, selectedDeck)) return;

    const fsrs = card.fsrs_stats || {};
    const lapses = fsrs.lapses || 0;
    const reps = fsrs.repetitions || 0;
    const stability = fsrs.stability || 0;
    const difficulty = fsrs.difficulty || 5.0;

    const cLogs = logStatsByCard.get(card.id || card._id) || {
      reviews: reps,
      fails: lapses,
      totalDuration: 0,
      durationCount: 0,
      lastGrade: null
    };

    const avgDurationMs = cLogs.durationCount > 0 ? Math.round(cLogs.totalDuration / cLogs.durationCount) : 0;
    const lsi = calculateLeechSeverity(lapses, difficulty, stability, reps);

    // Friction flags
    const flags = [];
    let prescription = "";

    if (lsi >= 2.2 || lapses >= 4) {
      flags.push("leech_trap");
      prescription = `Lapsed ${lapses} times with high difficulty (${difficulty.toFixed(1)}). Prompt may be vague or test multiple facts at once.`;
    } else if (reps >= 5 && stability <= 3.0) {
      flags.push("memory_treadmill");
      prescription = `Reviewed ${reps} times but memory stability is trapped under 3 days. Recommend adding an associative mnemonic.`;
    } else if (avgDurationMs >= 9000) {
      flags.push("slow_dwell");
      prescription = `Average recall time is ${(avgDurationMs / 1000).toFixed(1)}s (high cognitive friction). Consider shortening the question.`;
    } else if (lapses >= 2 && stability <= 1.5) {
      flags.push("unstable");
      prescription = `Recent relapse into relearning state. Requires reinforcement.`;
    }

    if (flags.length > 0 || lsi > 0.8 || lapses >= 2) {
      frictionCards.push({
        id: card.id || card._id,
        front: card.front || "",
        back: card.back || "",
        sub: card.sub || "",
        folder: getCardFolder(card),
        deck: getCardDeck(card) || "Default",
        lapses,
        repetitions: reps,
        stability: Math.round(stability * 10) / 10,
        difficulty: Math.round(difficulty * 10) / 10,
        lsi,
        reviewsCount: cLogs.reviews,
        avgDurationMs,
        flags,
        prescription: prescription || "Moderate friction. Monitor in upcoming review sessions."
      });
    }
  });

  // Rank by LSI descending, then lapses descending, then difficulty descending
  frictionCards.sort((a, b) => b.lsi - a.lsi || b.lapses - a.lapses || b.difficulty - a.difficulty);

  return frictionCards.slice(0, limit);
}

// ============================================================================
// 6. METHOD & HABIT ERGONOMICS (Circadian, Timeliness, Mode Comparison)
// ============================================================================

/**
 * Analyzes study methods, circadian time-of-day efficiency, and overdue review degradation.
 *
 * @param {Array<Object>} reviewLogs Review logs
 * @returns {Object} Ergonomic analytics
 */
export function analyzeErgonomics(reviewLogs = []) {
  // 1. Circadian 24-Hour Profile
  const hourlyBins = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    label: `${String(i).padStart(2, '0')}:00`,
    reviews: 0,
    passes: 0,
    fails: 0,
    retention: 0,
    totalDurationMs: 0,
    durationCount: 0,
    avgDurationMs: 0
  }));

  // 2. Timeliness / Overdue Breakdown
  const timelinessBins = {
    early: { label: "Early / Cram (<0.7x interval)", reviews: 0, passes: 0, retention: 0 },
    on_time: { label: "On-Time (0.7x - 1.3x)", reviews: 0, passes: 0, retention: 0 },
    overdue_moderate: { label: "Overdue (1.3x - 2.5x)", reviews: 0, passes: 0, retention: 0 },
    overdue_severe: { label: "Severely Overdue (>2.5x)", reviews: 0, passes: 0, retention: 0 }
  };

  // 3. Study Mode Comparison
  const modeStats = {
    scheduled: { reviews: 0, passes: 0, netStability: 0, totalDuration: 0, durationCount: 0 },
    practice: { reviews: 0, passes: 0, netStability: 0, totalDuration: 0, durationCount: 0 }
  };

  (reviewLogs || []).forEach(log => {
    if (!log || !log.timestamp) return;

    const date = new Date(log.timestamp);
    const hour = date.getHours();
    const g = Number(log.grade) || 0;
    const passed = g >= 2;

    // Circadian binning
    if (hour >= 0 && hour < 24) {
      const b = hourlyBins[hour];
      b.reviews++;
      if (passed) b.passes++; else b.fails++;
      if (log.duration_ms && log.duration_ms > 0) {
        b.totalDurationMs += Math.min(180000, log.duration_ms);
        b.durationCount++;
      }
    }

    // Timeliness binning (requires elapsed_days and prior interval or stability)
    const elapsed = Number(log.elapsed_days);
    const interval = Number(log.interval) || 1;
    if (!isNaN(elapsed) && elapsed > 0 && interval > 0) {
      const ratio = elapsed / interval;
      let targetBin = timelinessBins.on_time;
      if (ratio < 0.7) targetBin = timelinessBins.early;
      else if (ratio <= 1.3) targetBin = timelinessBins.on_time;
      else if (ratio <= 2.5) targetBin = timelinessBins.overdue_moderate;
      else targetBin = timelinessBins.overdue_severe;

      targetBin.reviews++;
      if (passed) targetBin.passes++;
    }

    // Mode binning
    const modeKey = (log.mode === "practice" || log.mode === "practice_buffer") ? "practice" : "scheduled";
    const m = modeStats[modeKey];
    m.reviews++;
    if (passed) m.passes++;
    const sBefore = Number(log.stability_before) || 0;
    const sAfter = Number(log.stability_after) || 0;
    m.netStability += Math.max(0, sAfter - sBefore);
    if (log.duration_ms && log.duration_ms > 0) {
      m.totalDuration += Math.min(180000, log.duration_ms);
      m.durationCount++;
    }
  });

  // Normalize Hourly Bins
  hourlyBins.forEach(b => {
    b.retention = b.reviews > 0 ? Math.round((b.passes / b.reviews) * 1000) / 1000 : 0;
    b.avgDurationMs = b.durationCount > 0 ? Math.round(b.totalDurationMs / b.durationCount) : 0;
  });

  // Calculate Peak & Fatigue Circadian Windows
  let bestHour = -1;
  let bestRet = -1;
  let worstHour = -1;
  let worstRet = 2.0;

  hourlyBins.forEach(b => {
    if (b.reviews >= 5) {
      if (b.retention > bestRet) {
        bestRet = b.retention;
        bestHour = b.hour;
      }
      if (b.retention < worstRet) {
        worstRet = b.retention;
        worstHour = b.hour;
      }
    }
  });

  // Normalize Timeliness Bins
  Object.values(timelinessBins).forEach(tb => {
    tb.retention = tb.reviews > 0 ? Math.round((tb.passes / tb.reviews) * 1000) / 1000 : 0;
  });

  // Normalize Mode Stats
  const modes = {
    scheduled: {
      reviews: modeStats.scheduled.reviews,
      retention: modeStats.scheduled.reviews > 0 ? Math.round((modeStats.scheduled.passes / modeStats.scheduled.reviews) * 1000) / 1000 : 0,
      stabilityVelocity: modeStats.scheduled.reviews > 0 ? Math.round((modeStats.scheduled.netStability / modeStats.scheduled.reviews) * 100) / 100 : 0,
      avgDurationMs: modeStats.scheduled.durationCount > 0 ? Math.round(modeStats.scheduled.totalDuration / modeStats.scheduled.durationCount) : 0
    },
    practice: {
      reviews: modeStats.practice.reviews,
      retention: modeStats.practice.reviews > 0 ? Math.round((modeStats.practice.passes / modeStats.practice.reviews) * 1000) / 1000 : 0,
      stabilityVelocity: modeStats.practice.reviews > 0 ? Math.round((modeStats.practice.netStability / modeStats.practice.reviews) * 100) / 100 : 0,
      avgDurationMs: modeStats.practice.durationCount > 0 ? Math.round(modeStats.practice.totalDuration / modeStats.practice.durationCount) : 0
    }
  };

  return {
    circadian: {
      hours: hourlyBins,
      peakHour: bestHour >= 0 ? bestHour : null,
      peakWindow: bestHour >= 0 ? `${String(bestHour).padStart(2, '0')}:00 – ${String((bestHour + 2) % 24).padStart(2, '0')}:00` : "Insufficient Data",
      peakRetention: bestRet >= 0 ? Math.round(bestRet * 1000) / 10 : null,
      fatigueHour: worstHour >= 0 && worstHour !== bestHour ? worstHour : null,
      fatigueWindow: worstHour >= 0 && worstHour !== bestHour ? `${String(worstHour).padStart(2, '0')}:00 – ${String((worstHour + 2) % 24).padStart(2, '0')}:00` : "None Detected",
      fatigueRetention: worstRet <= 1.0 && worstHour !== bestHour ? Math.round(worstRet * 1000) / 10 : null
    },
    timeliness: timelinessBins,
    modes
  };
}

// ============================================================================
// 7. FSRS-5 RELIABILITY DIAGRAM & MODEL CALIBRATION (Brier Score)
// ============================================================================

/**
 * Computes FSRS-5 model calibration and Brier score.
 * Evaluates whether predicted retrievability matches real-world recall probabilities.
 *
 * @param {Array<Object>} reviewLogs Review logs
 * @returns {Object} Reliability diagram bins and Brier score
 */
export function calculateModelCalibration(reviewLogs = []) {
  // Define 5 predicted retrievability bins: [0.5-0.6), [0.6-0.7), [0.7-0.8), [0.8-0.9), [0.9-1.0]
  const bins = [
    { label: "50% – 60%", minR: 0.50, maxR: 0.60, count: 0, sumPredicted: 0, sumObserved: 0 },
    { label: "60% – 70%", minR: 0.60, maxR: 0.70, count: 0, sumPredicted: 0, sumObserved: 0 },
    { label: "70% – 80%", minR: 0.70, maxR: 0.80, count: 0, sumPredicted: 0, sumObserved: 0 },
    { label: "80% – 90%", minR: 0.80, maxR: 0.90, count: 0, sumPredicted: 0, sumObserved: 0 },
    { label: "90% – 100%", minR: 0.90, maxR: 1.01, count: 0, sumPredicted: 0, sumObserved: 0 }
  ];

  let totalValid = 0;
  let brierSum = 0;

  (reviewLogs || []).forEach(log => {
    if (!log) return;
    const g = Number(log.grade) || 0;
    if (g < 1 || g > 4) return;

    const y = g >= 2 ? 1 : 0; // Binary outcome: 1 = recall, 0 = forget
    const elapsed = Number(log.elapsed_days) || 0;
    const sBefore = Number(log.stability_before) || 0;

    // Only compute calibration for reviews where prior stability existed
    if (sBefore <= 0) return;

    const predR = calculateRetrievability(elapsed, sBefore);
    brierSum += Math.pow(predR - y, 2);
    totalValid++;

    // Assign to bin
    for (const bin of bins) {
      if (predR >= bin.minR && predR < bin.maxR) {
        bin.count++;
        bin.sumPredicted += predR;
        bin.sumObserved += y;
        break;
      }
    }
  });

  const brierScore = totalValid > 0 ? Math.round((brierSum / totalValid) * 10000) / 10000 : 0;

  const formattedBins = bins.map(b => {
    const meanPred = b.count > 0 ? Math.round((b.sumPredicted / b.count) * 1000) / 1000 : (b.minR + b.maxR) / 2;
    const meanObs = b.count > 0 ? Math.round((b.sumObserved / b.count) * 1000) / 1000 : 0;
    const delta = b.count > 0 ? Math.round((meanObs - meanPred) * 1000) / 1000 : 0;
    return {
      label: b.label,
      count: b.count,
      meanPredicted: meanPred,
      meanObserved: meanObs,
      delta,
      isCalibrated: b.count >= 5 ? Math.abs(delta) <= 0.08 : null
    };
  });

  return {
    totalEvaluated: totalValid,
    brierScore, // 0.0 is perfect prediction, lower is better
    brierRating: brierScore <= 0.12 ? "Excellent Fit" : brierScore <= 0.18 ? "Good Calibration" : "Needs Retuning",
    bins: formattedBins
  };
}

// ============================================================================
// 8. PRESCRIPTIVE REFLECTION & DIAGNOSTIC ENGINE
// ============================================================================

/**
 * Generates automated founder-grade reflections and actionable interventions.
 *
 * @param {Object} context Analyzed metrics bundle
 * @returns {Array<Object>} List of actionable prescription cards
 */
export function generatePrescriptions({
  deckAnalytics = null,
  cardFriction = [],
  ergonomics = null,
  calibration = null,
  targetRetention = 0.90
} = {}) {
  const prescriptions = [];

  // 1. Deck Friction Diagnostics
  if (deckAnalytics && deckAnalytics.decks) {
    const criticalDecks = deckAnalytics.decks.filter(d => d.totalReviews >= 10 && d.healthStatus === "critical_friction");
    criticalDecks.forEach(d => {
      const drop = Math.round((targetRetention - d.empiricalRetention) * 100);
      prescriptions.push({
        id: `deck_crit_${d.key}`,
        type: "danger",
        category: "Deck Friction",
        title: `Low Retention in "${d.deck}" (${(d.empiricalRetention * 100).toFixed(1)}%)`,
        message: `This collection is ${drop}% below your target retention of ${Math.round(targetRetention * 100)}%. It contains ${d.leechCount} active leeches consuming study time.`,
        actionLabel: `Inspect ${d.leechCount} Leech Cards`,
        actionType: "filter_deck",
        target: d.key
      });
    });

    const overPracticed = deckAnalytics.decks.filter(d => d.totalReviews >= 30 && d.healthStatus === "over_practiced");
    overPracticed.forEach(d => {
      prescriptions.push({
        id: `deck_over_${d.key}`,
        type: "tip",
        category: "Over-Practicing",
        title: `Diminishing Returns in "${d.deck}" (${(d.empiricalRetention * 100).toFixed(1)}%)`,
        message: `Retention is unusually high (>97%). You are reviewing cards too frequently with minimal marginal memory gains. Consider letting FSRS intervals expand.`,
        actionLabel: `Review Deck Settings`,
        actionType: "view_settings",
        target: "settings"
      });
    });
  }

  // 2. Leech Pareto Concentration Alert
  if (cardFriction && cardFriction.length > 0) {
    const top3 = cardFriction.slice(0, 3);
    const totalFrictionLapses = cardFriction.reduce((acc, c) => acc + c.lapses, 0);
    const top3Lapses = top3.reduce((acc, c) => acc + c.lapses, 0);

    if (totalFrictionLapses >= 8 && top3Lapses / totalFrictionLapses >= 0.40) {
      const pct = Math.round((top3Lapses / totalFrictionLapses) * 100);
      prescriptions.push({
        id: "pareto_leeches",
        type: "warning",
        category: "Memory Traps",
        title: `Pareto Concentration: 3 Cards Cause ${pct}% of All Lapses`,
        message: `"${top3.map(c => limitString(c.front, 16)).join('", "')}" are repeatedly failing. Rewording these into atomic prompts will eliminate the majority of your daily review fatigue.`,
        actionLabel: "Open Leech Radar",
        actionType: "scroll_leech",
        target: "leech_radar"
      });
    }
  }

  // 3. Circadian Cognitive Window
  if (ergonomics && ergonomics.circadian && ergonomics.circadian.peakRetention !== null) {
    const { peakWindow, peakRetention, fatigueWindow, fatigueRetention } = ergonomics.circadian;
    if (fatigueRetention !== null && peakRetention - fatigueRetention >= 12.0) {
      prescriptions.push({
        id: "circadian_window",
        type: "insight",
        category: "Circadian Optimization",
        title: `Optimal Study Window: ${peakWindow}`,
        message: `Your recall accuracy reaches ${peakRetention}% during ${peakWindow}, but drops to ${fatigueRetention}% during ${fatigueWindow}. Scheduling major review sessions in your peak window will save study time.`,
        actionLabel: "View 24h Profile",
        actionType: "scroll_circadian",
        target: "circadian_chart"
      });
    }
  }

  // 4. Overdue Backlog Tax
  if (ergonomics && ergonomics.timeliness) {
    const onTime = ergonomics.timeliness.on_time;
    const severe = ergonomics.timeliness.overdue_severe;
    if (onTime.reviews >= 10 && severe.reviews >= 5) {
      const drop = Math.round((onTime.retention - severe.retention) * 100);
      if (drop >= 15) {
        prescriptions.push({
          id: "overdue_penalty",
          type: "warning",
          category: "Habit Friction",
          title: `Overdue Penalty: -${drop}% Retention Tax`,
          message: `Cards reviewed >2.5x past due suffer a ${drop}% drop in recall probability compared to on-time reviews. Maintaining small daily sessions prevents this backlog penalty.`,
          actionLabel: "Study Due Now",
          actionType: "start_due",
          target: "view-review"
        });
      }
    }
  }

  // 5. High Performance Kudos
  if (deckAnalytics && deckAnalytics.summary && deckAnalytics.summary.efficiencyGrade === "A+") {
    prescriptions.push({
      id: "high_performer",
      type: "kudos",
      category: "Elite Cadence",
      title: "S-Tier Memory Cadence: 92+ Efficiency Score",
      message: "Your retention rate is well-calibrated against FSRS target intervals with high stability velocity. Your card creation and review habits are operating at peak efficiency.",
      actionLabel: "Keep Crushing It",
      actionType: "none",
      target: null
    });
  }

  return prescriptions;
}

function limitString(str, max = 20) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "…" : str;
}
