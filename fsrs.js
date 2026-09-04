/**
 * FSRS-5 (Free Spaced Repetition Scheduler v5) Engine
 * 
 * Implements the state-of-the-art memory stability (S), item difficulty (D),
 * and retrievability (R) spacing algorithm targeting 90% retention.
 * 
 * Reference: Jarrett Ye / Open Spaced Repetition Research
 */

// Optimized default FSRS-5 weights (19 parameters)
export const DEFAULT_FSRS_WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, 
  7.1949, 0.5345, 1.4604, 0.0046, 
  1.54575, 0.1192, 1.01925, 1.9395, 
  0.11, 0.29605, 2.2698, 0.2315, 
  2.9898, 0.51655, 0.6621
];

export const DEFAULT_TARGET_RETENTION = 0.90; // 90% Standard Default

/**
 * Get active user configured target retention rate (0.70 - 0.98)
 */
export function getTargetRetention() {
  try {
    const stored = localStorage.getItem("app-target-retention");
    if (stored) {
      const val = parseFloat(stored);
      if (!isNaN(val) && val >= 0.70 && val <= 0.98) return val;
    }
  } catch (e) {}
  return DEFAULT_TARGET_RETENTION;
}

/**
 * Update user configured target retention rate
 */
export function setTargetRetention(rate) {
  const val = Math.min(0.98, Math.max(0.70, parseFloat(rate) || DEFAULT_TARGET_RETENTION));
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("app-target-retention", val.toFixed(2));
    }
  } catch (e) {}
  return val;
}

export const DESIRED_RETENTION = getTargetRetention();

// Rating Enum
export const Rating = {
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4
};

// State Enum
export const State = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3
};

/**
 * Calculates Retrievability R(t, S) using power forgetting curve
 * @param {number} daysElapsed Elapsed days since last review
 * @param {number} stability Current stability in days
 * @returns {number} Probability of recall (0.0 - 1.0)
 */
export function calculateRetrievability(daysElapsed, stability) {
  if (stability <= 0) return 0;
  // Standard FSRS forgetting curve: R(t, S) = (1 + 19/81 * (t / S))^-0.5
  const factor = 19 / 81;
  return Math.pow(1 + factor * (daysElapsed / stability), -0.5);
}

/**
 * Calculates optimal interval given target stability and desired retention
 * @param {number} stability Memory stability in days
 * @param {number} requestRetention Target retention probability (default getTargetRetention())
 * @returns {number} Interval in days
 */
export function calculateInterval(stability, requestRetention = getTargetRetention()) {
  if (stability <= 0) return 1;
  const factor = 19 / 81;
  // Formula: I = S / factor * (R^(-2) - 1)
  const interval = (stability / factor) * (Math.pow(requestRetention, -2) - 1);
  return Math.max(1, Math.round(interval));
}

/**
 * Initial Stability S0(G) based on initial rating
 */
function initStability(grade, w = DEFAULT_FSRS_WEIGHTS) {
  return Math.max(0.1, w[grade - 1]);
}

/**
 * Initial Difficulty D0(G) based on initial rating
 */
function initDifficulty(grade, w = DEFAULT_FSRS_WEIGHTS) {
  const d0 = w[4] - Math.exp(w[5] * (grade - 1)) + 1;
  return Math.min(10, Math.max(1, d0));
}

/**
 * Next Difficulty D'(D, G) with mean reversion
 */
function nextDifficulty(difficulty, grade, w = DEFAULT_FSRS_WEIGHTS) {
  const d0_good = initDifficulty(Rating.Good, w);
  const nextD = w[7] * d0_good + (1 - w[7]) * (difficulty - w[6] * (grade - 3));
  return Math.min(10, Math.max(1, nextD));
}

/**
 * Next Stability on successful recall
 */
function nextRecallStability(difficulty, stability, retrievability, grade, w = DEFAULT_FSRS_WEIGHTS) {
  const hardPenalty = (grade === Rating.Hard) ? w[15] : 1.0;
  const easyBonus = (grade === Rating.Easy) ? w[16] : 1.0;
  
  const b = 1 + Math.exp(w[8]) * 
            (11 - difficulty) * 
            Math.pow(stability, -w[9]) * 
            (Math.exp(w[10] * (1 - retrievability)) - 1) * 
            hardPenalty * 
            easyBonus;
            
  return Math.max(0.1, stability * b);
}

/**
 * Next Stability on lapse (Again)
 */
function nextForgetStability(difficulty, stability, retrievability, w = DEFAULT_FSRS_WEIGHTS) {
  const nextS = w[11] * 
                Math.pow(difficulty, -w[12]) * 
                (Math.pow(stability + 1, w[13]) - 1) * 
                Math.exp(w[14] * (1 - retrievability));
                
  return Math.min(stability, Math.max(0.1, nextS));
}

/**
 * Calculates the next review timestamp based on days interval and logical rollover hour (default 4:00 AM).
 * Prevents midnight jumping and ensures proper spacing across time of day.
 * @param {number} nextInterval Interval in days
 * @param {number} now Current timestamp in ms
 * @param {number} rolloverHour Hour of day (0-23) when new study day begins (default 4 AM)
 * @returns {number} Target epoch timestamp in ms
 */
export function calculateNextReviewTimestamp(nextInterval, now = Date.now(), rolloverHour = 4) {
  if (nextInterval <= 0) return now;

  const current = new Date(now);
  const logicalDate = new Date(now);

  // If reviewed between midnight and rolloverHour (e.g. 2:00 AM), we are logically in previous study day
  if (current.getHours() < rolloverHour) {
    logicalDate.setDate(logicalDate.getDate() - 1);
  }
  logicalDate.setHours(rolloverHour, 0, 0, 0);

  // Advance by nextInterval days
  logicalDate.setDate(logicalDate.getDate() + nextInterval);

  let targetTimestamp = logicalDate.getTime();

  // Guard: if nextInterval >= 1, ensure at least 12 hours between review time and next review
  const minSpacingMs = 12 * 60 * 60 * 1000;
  if (targetTimestamp - now < minSpacingMs && nextInterval >= 1) {
    targetTimestamp += 24 * 60 * 60 * 1000;
  }

  return targetTimestamp;
}

/**
 * Compute the next FSRS-5 state after rating a card.
 * @param {Object} card Flashcard object
 * @param {number} grade Rating (1: Again, 2: Hard, 3: Good, 4: Easy)
 * @param {number} now Current timestamp in milliseconds (defaults to Date.now())
 * @returns {Object} Updated card object with FSRS-5 statistics
 */
export function calculateFSRS5(card, grade, now = Date.now(), requestRetention = getTargetRetention()) {
  const w = DEFAULT_FSRS_WEIGHTS;
  
  // Extract or initialize FSRS metadata with SM-2 backwards-compatibility fallback
  const fsrs = card.fsrs_stats || {};
  let stability = fsrs.stability || 0;
  let difficulty = fsrs.difficulty || 0;
  let reps = (fsrs.repetitions !== undefined) ? fsrs.repetitions : (card.sm2_stats?.repetitions || 0);
  let lapses = fsrs.lapses || 0;
  let state = (fsrs.state !== undefined) ? fsrs.state : (reps === 0 ? State.New : State.Review);
  let lastReview = fsrs.last_review || card.sm2_stats?.last_reviewed || 0;
  
  // Convert SM-2 interval to initial stability if migrating
  if (stability === 0 && card.sm2_stats && card.sm2_stats.interval > 0) {
    stability = card.sm2_stats.interval;
    difficulty = Math.min(10, Math.max(1, 10 - ((card.sm2_stats.ease_factor || 2.5) - 1.3) * 5));
  }

  const daysElapsed = lastReview > 0 ? Math.max(0, (now - lastReview) / (1000 * 60 * 60 * 24)) : 0;
  const retrievability = stability > 0 ? calculateRetrievability(daysElapsed, stability) : 1.0;

  let nextInterval = 0;
  
  if (state === State.New || stability === 0) {
    // New Card initialization
    stability = initStability(grade, w);
    difficulty = initDifficulty(grade, w);
    if (grade === Rating.Again) {
      state = State.Learning;
      nextInterval = 0;
      lapses++;
    } else {
      state = State.Review;
      nextInterval = calculateInterval(stability, requestRetention);
      reps++;
    }
  } else {
    // Existing card review
    difficulty = nextDifficulty(difficulty, grade, w);
    
    if (grade === Rating.Again) {
      state = State.Relearning;
      stability = nextForgetStability(difficulty, stability, retrievability, w);
      nextInterval = 0;
      lapses++;
    } else {
      state = State.Review;
      stability = nextRecallStability(difficulty, stability, retrievability, grade, w);
      nextInterval = calculateInterval(stability, requestRetention);
      reps++;
    }
  }

  // Target 4:00 AM target boundary scheduling for daily reviews
  const nextReviewTimestamp = calculateNextReviewTimestamp(nextInterval, now, 4);

  const updated = {
    ...card,
    fsrs_stats: {
      stability: Math.round(stability * 100) / 100,
      difficulty: Math.round(difficulty * 100) / 100,
      repetitions: reps,
      lapses: lapses,
      state: state,
      last_review: now,
      next_review: nextReviewTimestamp,
      interval: nextInterval
    },
    last_modified: now,
    updated_at: now
  };
  delete updated.sm2_stats;
  return updated;
}

/**
 * Creates default FSRS-5 stats for a new flashcard.
 */
export function createDefaultFSRSStats() {
  return {
    stability: 0,
    difficulty: 0,
    repetitions: 0,
    lapses: 0,
    state: State.New,
    last_review: 0,
    next_review: 0,
    interval: 0
  };
}

/**
 * Returns the next review epoch timestamp in milliseconds for a card.
 */
export function getCardNextReview(card) {
  if (!card) return 0;
  if (card.fsrs_stats?.next_review !== undefined) return card.fsrs_stats.next_review;
  return 0;
}

/**
 * Checks if a card is due for review.
 */
export function isCardDue(card, now = Date.now()) {
  if (!card || card.deleted) return false;
  return getCardNextReview(card) <= now;
}

/**
 * Checks if a card is brand new (never reviewed).
 */
export function isCardNew(card) {
  if (!card || card.deleted) return false;
  if (card.fsrs_stats) {
    const isZeroReps = (card.fsrs_stats.repetitions === 0 || card.fsrs_stats.repetitions === undefined);
    const isNewState = (card.fsrs_stats.state === State.New || card.fsrs_stats.state === 0 || card.fsrs_stats.state === undefined);
    return isZeroReps && isNewState;
  }
  return true;
}

/**
 * Formats day interval into concise human readable text.
 */
export function formatIntervalLabel(days) {
  if (days <= 0) return "< 10m";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 365) {
    const mo = Math.round(days / 30 * 10) / 10;
    return `${mo}mo`;
  }
  const yr = Math.round(days / 365 * 10) / 10;
  return `${yr}y`;
}

/**
 * Calculates projected intervals for all 4 ratings (Again, Hard, Good, Easy) for UI display.
 */
export function calculateProjectedIntervals(card, now = Date.now(), requestRetention = getTargetRetention()) {
  const previewForGrade = (grade) => {
    const res = calculateFSRS5(card, grade, now, requestRetention);
    return res.fsrs_stats.interval;
  };

  const againDays = previewForGrade(Rating.Again);
  const hardDays = previewForGrade(Rating.Hard);
  const goodDays = previewForGrade(Rating.Good);
  const easyDays = previewForGrade(Rating.Easy);

  return {
    again: formatIntervalLabel(againDays),
    hard: formatIntervalLabel(hardDays),
    good: formatIntervalLabel(goodDays),
    easy: formatIntervalLabel(easyDays)
  };
}

