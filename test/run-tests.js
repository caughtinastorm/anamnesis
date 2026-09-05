/**
 * Comprehensive Automated Test Suite for anamnesis
 * Tests:
 * 1. FSRS-5 scheduling and logical rollover hour boundary
 * 2. HTML escaping, sanitization, and plain-text conversion
 * 3. Local date formatting and streak calculation
 * 4. Cloze syntax parsing without bracket destruction
 * 5. Sync merge and tombstone expiration
 * 6. Server path resolution and security traversal checks
 */

import assert from "assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import {
  calculateNextReviewTimestamp,
  calculateRetrievability,
  calculateInterval,
  calculateFSRS5,
  createDefaultFSRSStats,
  Rating,
  State,
  DEFAULT_TARGET_RETENTION
} from "../fsrs.js";
import {
  escapeHTML,
  sanitizeHTML,
  plainText,
  getLocalDateString,
  limitText,
  formatDeckSelectionLabel
} from "../js/utils.js";
import { calculateStreak } from "../js/dashboard.js";
import { renderCardContent } from "../js/study.js";
import { mergeCards, cardsDiffer, getCardTimestamp, sanitizeGistId } from "../sync.js";
import { parseAnkiText, normalizeAnkiDeck, expandClozeCards, cleanHtmlTags } from "../anki.js";
import { sortCardsLogically } from "../js/explorer-actions.js";
import { INTRO_STEPS } from "../js/intro.js";

let testsRun = 0;
let testsPassed = 0;

function runTest(name, fn) {
  testsRun++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

console.log("\n=== 1. FSRS-5 SCHEDULER & ROLLOVER HOUR TESTS ===");

runTest("calculateRetrievability returns 1.0 when elapsed days is 0", () => {
  const r = calculateRetrievability(0, 10);
  assert.equal(r, 1.0);
});

runTest("calculateRetrievability decays properly with elapsed time", () => {
  const r1 = calculateRetrievability(10, 10);
  const factor = 19 / 81;
  const expected = Math.pow(1 + factor * (10 / 10), -0.5);
  assert.ok(Math.abs(r1 - expected) < 1e-6);
  assert.ok(r1 < 1.0 && r1 > 0.5);
});

runTest("calculateInterval produces valid interval for target retention", () => {
  const interval = calculateInterval(10, 0.90);
  assert.ok(interval >= 1);
  assert.ok(Number.isInteger(interval));
});

runTest("Logical rollover: Late night review (11:00 PM) gives next review Wednesday 4:00 AM (>12h away)", () => {
  // Monday 2026-09-07 23:00:00 (11 PM)
  const mondayNight = new Date(2026, 8, 7, 23, 0, 0).getTime();
  const nextTimestamp = calculateNextReviewTimestamp(1, mondayNight, 4);
  const targetDate = new Date(nextTimestamp);

  // Must be Wednesday 4:00 AM (29 hours later, not Tuesday 4:00 AM which is only 5 hours later)
  assert.equal(targetDate.getFullYear(), 2026);
  assert.equal(targetDate.getMonth(), 8);
  assert.equal(targetDate.getDate(), 9); // Wednesday Sept 9
  assert.equal(targetDate.getHours(), 4);
  assert.equal(targetDate.getMinutes(), 0);
  assert.ok(nextTimestamp - mondayNight >= 12 * 60 * 60 * 1000);
});

runTest("Logical rollover: Early morning review (02:00 AM) counts as previous logical day", () => {
  // Tuesday 2026-09-08 02:00:00 (2 AM)
  const tuesdayEarly = new Date(2026, 8, 8, 2, 0, 0).getTime();
  const nextTimestamp = calculateNextReviewTimestamp(1, tuesdayEarly, 4);
  const targetDate = new Date(nextTimestamp);

  // Logical day is Monday Sept 7 -> +1 day is Tuesday 4 AM (2h later < 12h) -> guards to Wednesday Sept 9 4 AM
  assert.equal(targetDate.getDate(), 9);
  assert.equal(targetDate.getHours(), 4);
  assert.ok(nextTimestamp - tuesdayEarly >= 12 * 60 * 60 * 1000);
});

runTest("Logical rollover: Morning review (09:00 AM) becomes due tomorrow at 4:00 AM", () => {
  // Tuesday 2026-09-08 09:00:00 (9 AM)
  const tuesdayMorning = new Date(2026, 8, 8, 9, 0, 0).getTime();
  const nextTimestamp = calculateNextReviewTimestamp(1, tuesdayMorning, 4);
  const targetDate = new Date(nextTimestamp);

  // Logical day is Tuesday Sept 8 -> +1 day is Wednesday Sept 9 at 4:00 AM (19h later)
  assert.equal(targetDate.getDate(), 9);
  assert.equal(targetDate.getHours(), 4);
  assert.ok(nextTimestamp - tuesdayMorning >= 12 * 60 * 60 * 1000);
});

runTest("Lapse (interval 0) returns current timestamp immediately", () => {
  const now = Date.now();
  const nextTimestamp = calculateNextReviewTimestamp(0, now, 4);
  assert.equal(nextTimestamp, now);
});

runTest("calculateFSRS5 advances new card to Review state on Good rating", () => {
  const newCard = { id: "c1", front: "Question", back: "Answer" };
  const updated = calculateFSRS5(newCard, Rating.Good);
  assert.equal(updated.fsrs_stats.state, State.Review);
  assert.ok(updated.fsrs_stats.stability > 0);
  assert.ok(updated.fsrs_stats.interval >= 1);
  assert.equal(updated.fsrs_stats.repetitions, 1);
  assert.equal(updated.fsrs_stats.lapses, 0);
});

runTest("calculateFSRS5 marks lapsed card as Relearning on Again rating", () => {
  const reviewedCard = {
    id: "c1",
    front: "Q",
    back: "A",
    fsrs_stats: {
      stability: 10,
      difficulty: 5,
      repetitions: 3,
      lapses: 0,
      state: State.Review,
      last_review: Date.now() - 5 * 86400000
    }
  };
  const updated = calculateFSRS5(reviewedCard, Rating.Again);
  assert.equal(updated.fsrs_stats.state, State.Relearning);
  assert.equal(updated.fsrs_stats.interval, 0);
  assert.equal(updated.fsrs_stats.lapses, 1);
});

console.log("\n=== 2. SANITIZATION & FORMATTING TESTS ===");

runTest("escapeHTML properly escapes dangerous characters", () => {
  const raw = `<script>alert("XSS" & 'hack')</script>`;
  const escaped = escapeHTML(raw);
  assert.ok(!escaped.includes("<"));
  assert.ok(!escaped.includes(">"));
  assert.ok(escaped.includes("&lt;script&gt;"));
  assert.ok(escaped.includes("&amp;"));
});

runTest("sanitizeHTML preserves safe formatting tags and converts <br>", () => {
  const input = `<b>Bold</b> <i>Italic</i> <br> <code>code</code>`;
  const sanitized = sanitizeHTML(input);
  assert.ok(sanitized.includes("<b>Bold</b>"));
  assert.ok(sanitized.includes("<i>Italic</i>"));
  assert.ok(sanitized.includes("<br>"));
  assert.ok(sanitized.includes("<code>code</code>"));
});

runTest("sanitizeHTML neutralizes malicious script and event handlers", () => {
  const input = `<img src=x onerror=alert(1)> <script>alert(2)</script>`;
  const sanitized = sanitizeHTML(input);
  assert.ok(!sanitized.includes("<script>"));
  assert.ok(!sanitized.includes("<img"));
  assert.ok(sanitized.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(sanitized.includes("&lt;script&gt;alert(2)&lt;/script&gt;"));
});

runTest("plainText strips HTML and normalizes whitespace", () => {
  const input = `<b>Hello</b><br>world   &amp; test`;
  const plain = plainText(input);
  assert.equal(plain, "Hello world &amp; test");
});

runTest("limitText limits text length and appends ellipsis without exceeding limit", () => {
  assert.equal(limitText("Short Deck", 20), "Short Deck");
  assert.equal(limitText("Super Long Deck Name Exceeding Twenty Characters", 20), "Super Long Deck Nam…");
  assert.equal(limitText("Super Long Deck Name Exceeding Twenty Characters", 20).length, 20);
  assert.equal(limitText("", 10), "");
});

runTest("formatDeckSelectionLabel formats and limits long collection names", () => {
  assert.equal(formatDeckSelectionLabel("all"), "📁 All Collections");
  assert.equal(formatDeckSelectionLabel("deck:Grammar"), "🗂️ Grammar");
  assert.equal(formatDeckSelectionLabel("deck:Super Long Deck Name Exceeding Twenty Characters", 20), "🗂️ Super Long Deck…");
  assert.equal(formatDeckSelectionLabel("folder:Advanced Japanese Kanji & Grammar", 20), "📁 Advanced Japanes…");
});

console.log("\n=== 3. LOCAL TIME & STREAK TESTS ===");

runTest("getLocalDateString returns YYYY-MM-DD for local date", () => {
  const d = new Date(2026, 8, 3, 14, 30);
  assert.equal(getLocalDateString(d), "2026-09-03");
});

runTest("calculateStreak counts consecutive active days correctly", () => {
  const today = getLocalDateString(new Date());
  const yestDate = new Date();
  yestDate.setDate(yestDate.getDate() - 1);
  const yest = getLocalDateString(yestDate);
  const dayBeforeDate = new Date();
  dayBeforeDate.setDate(dayBeforeDate.getDate() - 2);
  const dayBefore = getLocalDateString(dayBeforeDate);

  const history = {
    [today]: 15,
    [yest]: 20,
    [dayBefore]: 10
  };

  const streak = calculateStreak(history);
  assert.equal(streak, 3);
});

runTest("calculateStreak handles yesterday review if user has not reviewed today yet", () => {
  const yestDate = new Date();
  yestDate.setDate(yestDate.getDate() - 1);
  const yest = getLocalDateString(yestDate);

  const history = {
    [yest]: 10
  };

  const streak = calculateStreak(history);
  assert.equal(streak, 1);
});

console.log("\n=== 4. CLOZE & BRACKET SAFETY TESTS ===");

runTest("renderCardContent preserves standard IPA brackets [kæt] on both front and back", () => {
  const text = "What is the pronunciation of cat? [kæt]";
  const front = renderCardContent(text, false);
  const back = renderCardContent(text, true);

  // Brackets must NOT be turned into [ ... ] or cloze spans
  assert.ok(front.includes("[kæt]"));
  assert.ok(!front.includes("cloze-blank"));
  assert.ok(back.includes("[kæt]"));
  assert.ok(!back.includes("cloze-answer"));
});

runTest("renderCardContent preserves citation brackets [1] and math brackets [0, 1]", () => {
  const text = "According to study [1], the range is [0, 1].";
  const front = renderCardContent(text, false);
  const back = renderCardContent(text, true);

  assert.ok(front.includes("[1]"));
  assert.ok(front.includes("[0, 1]"));
  assert.ok(!front.includes("cloze-blank"));
});

runTest("renderCardContent formats explicit cloze {{c1::answer}} correctly", () => {
  const text = "The capital of France is {{c1::Paris}}.";
  const front = renderCardContent(text, false);
  const back = renderCardContent(text, true);

  assert.ok(front.includes(`<span class="cloze-blank">[ ... ]</span>`));
  assert.ok(back.includes(`<span class="cloze-answer">Paris</span>`));
});

runTest("renderCardContent formats cloze with hint {{c1::Paris::city}} correctly", () => {
  const text = "The capital of France is {{c1::Paris::city}}.";
  const front = renderCardContent(text, false);
  const back = renderCardContent(text, true);

  assert.ok(front.includes(`<span class="cloze-blank">[ city ]</span>`));
  assert.ok(back.includes(`<span class="cloze-answer">Paris</span>`));
});

runTest("renderCardContent formats expanded cloze [ ... ] on front", () => {
  const text = "The capital of France is [ ... ].";
  const front = renderCardContent(text, false);
  assert.ok(front.includes(`<span class="cloze-blank">[ ... ]</span>`));
});

runTest("cleanHtmlTags strips HTML tags but preserves line breaks", () => {
  const html = "<div>First line<br>Second line</div>";
  const cleaned = cleanHtmlTags(html);
  assert.ok(cleaned.includes("First line"));
  assert.ok(cleaned.includes("Second line"));
  assert.ok(!cleaned.includes("<div>"));
  assert.ok(!cleaned.includes("</div>"));
});

runTest("normalizeAnkiDeck splits multi-level deck names", () => {
  const result = normalizeAnkiDeck("Languages::Spanish::Verbs");
  assert.equal(result.folder, "Languages");
  assert.equal(result.deck, "Spanish / Verbs");

  const single = normalizeAnkiDeck("Biology");
  assert.equal(single.folder, undefined);
  assert.equal(single.deck, "Biology");
});

runTest("expandClozeCards expands multiple cloze deletions properly", () => {
  const baseCard = {
    front: "The {{c1::quick}} brown {{c2::fox}} jumps.",
    back: "Extra note"
  };
  const expanded = expandClozeCards(baseCard);
  assert.equal(expanded.length, 2);
  assert.ok(expanded[0].front.includes("[ ... ]"));
  assert.ok(expanded[0].front.includes("fox"));
  assert.ok(expanded[1].front.includes("[ ... ]"));
  assert.ok(expanded[1].front.includes("quick"));
});

runTest("parseAnkiText parses tab-delimited Anki exports with headers", () => {
  const text = `#separator:tab\n#html:true\n#deck:Medical::Anatomy\nFront 1\tBack 1\tSub 1\nFront 2\tBack 2\tSub 2`;
  const cards = parseAnkiText(text);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].front, "Front 1");
  assert.equal(cards[0].back, "Back 1");
  assert.equal(cards[0].folder, "Medical");
  assert.equal(cards[0].deck, "Anatomy");
});

console.log("\n=== 5. SYNC & TOMBSTONE PRUNING TESTS ===");

runTest("mergeCards applies Last-Write-Wins based on timestamp", () => {
  const local = [{ id: "1", front: "Local newer", last_modified: 2000 }];
  const remote = [{ id: "1", front: "Remote older", last_modified: 1000 }];

  const merged = mergeCards(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].front, "Local newer");
});

runTest("mergeCards removes tombstones older than 30 days", () => {
  const now = Date.now();
  const oldTombstone = { id: "del-old", front: "Deleted", deleted: true, last_modified: now - 35 * 86400000 };
  const freshTombstone = { id: "del-fresh", front: "Deleted", deleted: true, last_modified: now - 5 * 86400000 };
  const activeCard = { id: "active", front: "Active", last_modified: now };

  const merged = mergeCards([oldTombstone, freshTombstone, activeCard], []);
  const ids = merged.map(c => c.id);

  assert.ok(!ids.includes("del-old"), "Old tombstone should be pruned");
  assert.ok(ids.includes("del-fresh"), "Fresh tombstone should be kept");
  assert.ok(ids.includes("active"), "Active card should be kept");
});

runTest("cardsDiffer detects content, deletion, and timestamp differences", () => {
  const a = [{ id: "1", front: "A", last_modified: 100 }];
  const b = [{ id: "1", front: "B", last_modified: 100 }];
  assert.equal(cardsDiffer(a, b), true);

  const c = [{ id: "1", front: "A", last_modified: 100 }];
  assert.equal(cardsDiffer(a, c), false);
});

runTest("sanitizeGistId extracts clean hex ID from URL, fragments, and queries", () => {
  assert.equal(sanitizeGistId("https://gist.github.com/user/e30c449339485f8c6b738927498c0d9a"), "e30c449339485f8c6b738927498c0d9a");
  assert.equal(sanitizeGistId("https://gist.github.com/user/e30c449339485f8c6b738927498c0d9a#file-flashcards-json"), "e30c449339485f8c6b738927498c0d9a");
  assert.equal(sanitizeGistId("https://gist.github.com/user/e30c449339485f8c6b738927498c0d9a?foo=bar/"), "e30c449339485f8c6b738927498c0d9a");
  assert.equal(sanitizeGistId("  e30c449339485f8c6b738927498c0d9a  "), "e30c449339485f8c6b738927498c0d9a");
  assert.equal(sanitizeGistId(""), "");
  assert.equal(sanitizeGistId(null), "");
});

console.log("\n=== 6. SERVER PATH RESOLUTION SECURITY TESTS ===");

runTest("Path resolution prevents sibling directory traversal", () => {
  const __dirname = path.resolve("c:/Users/12/Desktop/app");
  const baseDir = path.resolve(__dirname);

  // Safe path inside app
  const safeFile = path.resolve(baseDir, "./index.html");
  const isSafe = safeFile === baseDir || safeFile.startsWith(baseDir + path.sep);
  assert.equal(isSafe, true);

  // Sibling directory traversal (e.g. /app-secret)
  const siblingDir = path.resolve(baseDir, "../app-secret/passwords.txt");
  const isSiblingSafe = siblingDir === baseDir || siblingDir.startsWith(baseDir + path.sep);
  assert.equal(isSiblingSafe, false);

  // Dot-dot traversal
  const dotDot = path.resolve(baseDir, "../../Windows/win.ini");
  const isDotDotSafe = dotDot === baseDir || dotDot.startsWith(baseDir + path.sep);
  assert.equal(isDotDotSafe, false);
});

console.log("\n=== 7. EXPORT LOGICAL ORDERING & SM2 PURGE TESTS ===");

runTest("sortCardsLogically groups root cards, orders folders and natural decks", () => {
  const cards = [
    { front: "Social 1", folder: "Social", deck: "Smooth Exits", sub: "Exit" },
    { front: "Culinary 2", folder: "Culinary", deck: "Basics", sub: "Pan" },
    { front: "Root 1", folder: undefined, deck: "Default", sub: "" },
    { front: "Japanese 2", folder: "Japanese", deck: "Core 100", sub: "Verb" },
    { front: "Japanese 1", folder: "Japanese", deck: "Core 100", sub: "Noun" },
    { front: "Culinary 1", folder: "Culinary", deck: "Basics", sub: "Acid" }
  ];

  const sorted = sortCardsLogically(cards);
  assert.equal(sorted[0].front, "Root 1", "Root cards should come first");
  assert.equal(sorted[1].folder, "Culinary");
  assert.equal(sorted[1].front, "Culinary 1", "Within Culinary, Acid subtopic comes before Pan");
  assert.equal(sorted[2].front, "Culinary 2");
  assert.equal(sorted[3].folder, "Japanese");
  assert.equal(sorted[3].front, "Japanese 1", "Within Japanese, Noun comes before Verb");
  assert.equal(sorted[5].folder, "Social");
});

runTest("calculateFSRS5 never creates or maintains sm2_stats", () => {
  const card = {
    id: "fsrs-clean",
    front: "Q",
    back: "A",
    sm2_stats: { ease_factor: 2.5, interval: 3, repetitions: 2, next_review: 1000 }
  };

  const updated = calculateFSRS5(card, Rating.Good, 5000);
  assert.equal(updated.sm2_stats, undefined, "sm2_stats must be completely deleted from updated cards");
  assert.ok(updated.fsrs_stats, "fsrs_stats must exist");
  assert.ok(updated.fsrs_stats.stability > 0, "FSRS stability must be calculated");
});

runTest("Resetting FSRS data resets stats to default, purges legacy SM2, and preserves card content", () => {
  const card = {
    id: "card-reset-1",
    front: "Katakana",
    back: "カタカナ",
    sub: "Alphabet",
    description: "Syllabary",
    folder: "Japanese",
    deck: "Katakana",
    sm2_stats: { ease_factor: 2.1, interval: 14, repetitions: 5 },
    fsrs_stats: {
      stability: 12.5,
      difficulty: 6.2,
      repetitions: 7,
      lapses: 1,
      state: State.Review,
      last_review: 1600000000000,
      next_review: 1601000000000,
      interval: 12
    },
    last_modified: 1500000000000
  };

  const now = Date.now();
  const resetCard = {
    ...card,
    fsrs_stats: createDefaultFSRSStats(),
    last_modified: now
  };
  delete resetCard.sm2_stats;

  assert.equal(resetCard.front, "Katakana");
  assert.equal(resetCard.back, "カタカナ");
  assert.equal(resetCard.sub, "Alphabet");
  assert.equal(resetCard.description, "Syllabary");
  assert.equal(resetCard.folder, "Japanese");
  assert.equal(resetCard.deck, "Katakana");
  assert.equal(resetCard.id, "card-reset-1");
  assert.equal(resetCard.last_modified, now);

  assert.equal(resetCard.sm2_stats, undefined, "sm2_stats must be purged");
  assert.deepEqual(resetCard.fsrs_stats, {
    stability: 0,
    difficulty: 0,
    repetitions: 0,
    lapses: 0,
    state: State.New,
    last_review: 0,
    next_review: 0,
    interval: 0
  }, "FSRS stats must be reset to defaults");
});

console.log("\n=== 8. ONBOARDING & INTRODUCTION TOUR TESTS ===");

runTest("INTRO_STEPS contains all essential app areas with valid metadata", () => {
  assert.ok(Array.isArray(INTRO_STEPS), "INTRO_STEPS must be an array");
  assert.ok(INTRO_STEPS.length >= 6, "Must contain at least 6 guided steps");

  const validViews = new Set(["view-review", "view-decks", "view-browser", "view-settings"]);

  INTRO_STEPS.forEach((step, idx) => {
    assert.ok(step.id, `Step ${idx} must have an id`);
    assert.ok(step.tag, `Step ${idx} must have a tag badge`);
    assert.ok(step.title, `Step ${idx} must have a title`);
    assert.ok(step.bodyHtml, `Step ${idx} must have body HTML content`);
    assert.ok(validViews.has(step.view), `Step ${idx} view '${step.view}' must be a valid app view`);
  });

  // Check that the first step covers welcome and has a skip hint
  assert.equal(INTRO_STEPS[0].id, "welcome");
  assert.ok(INTRO_STEPS[0].bodyHtml.includes("skip"), "Step 1 must explicitly mention skipping");

  // Check key area steps exist
  const stepIds = INTRO_STEPS.map(s => s.id);
  assert.ok(stepIds.includes("dashboard"), "Must have dashboard step");
  assert.ok(stepIds.includes("study-practice"), "Must have study vs practice step");
  assert.ok(stepIds.includes("decks-explorer"), "Must have deck explorer step");
  assert.ok(stepIds.includes("card-browser"), "Must have card browser step");
  assert.ok(stepIds.includes("settings-sync"), "Must have settings and sync step");
});

console.log(`\nResults: ${testsPassed} passed / ${testsRun} total`);
if (testsPassed === testsRun) {
  console.log("🎉 ALL TESTS PASSED SUCCESSFULLY!\n");
} else {
  console.error("⚠️ SOME TESTS FAILED!\n");
  process.exit(1);
}
