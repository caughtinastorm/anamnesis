/**
 * SM-2 Spaced Repetition Engine
 * 
 * Calculates interval and ease factor based on the SuperMemo-2 algorithm.
 */

export function calculateSM2(card, grade) {
  // Ensure sm2_stats exists with default values if not defined
  const stats = card.sm2_stats ? { ...card.sm2_stats } : {
    ease_factor: 2.5,
    interval: 0,
    repetitions: 0,
    next_review: 0
  };

  let { ease_factor, interval, repetitions } = stats;

  // Enforce grade bounds
  grade = Math.max(0, Math.min(5, Math.floor(grade)));

  if (grade < 3) {
    // If the grade is less than 3, the card is forgotten.
    // Reset repetitions and set interval to 1 day.
    repetitions = 0;
    interval = 1;
  } else {
    // Correct response, increment repetitions
    repetitions += 1;
    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 6;
    } else {
      interval = Math.ceil(interval * ease_factor);
    }
  }

  // Calculate new ease factor: E' = E + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
  const d = 5 - grade;
  ease_factor = ease_factor + (0.1 - d * (0.08 + d * 0.02));

  // Floor ease factor at 1.3
  if (ease_factor < 1.3) {
    ease_factor = 1.3;
  }

  const now = Date.now();
  // Set next review to 4:00 AM on the target day to align with daily study boundaries
  const targetDate = new Date(now + interval * 24 * 60 * 60 * 1000);
  targetDate.setHours(4, 0, 0, 0);
  if (targetDate.getTime() <= now) {
    targetDate.setDate(targetDate.getDate() + 1);
  }
  const next_review = targetDate.getTime();

  return {
    ...card,
    sm2_stats: {
      ease_factor: Number(ease_factor.toFixed(4)),
      interval,
      repetitions,
      next_review
    },
    last_modified: now
  };
}
