# Verification report — 1.2.0

Verified on 2026-10-15 UTC using Node.js 24.19.0.

## Redesign

The primary navigation is Today, Cards and Settings. Today has a native deck selector and one main action. Sessions default to ten cards. The core review choices are Again and Got it; additional ratings are available on demand. Practice uses a short, one-pass set without changing long-term scheduling.

Cards opens a simple deck list with direct review actions. New cards start with Question, Answer and Deck. Hints, notes, audio, folders, advanced organization, importing, progress and data tools are available behind secondary controls. There is no automatic walkthrough. A three-step guide is available in Settings.

The interface uses a warm neutral background, green accents, restrained type, generous spacing, a quiet progress bar and concise completion feedback. Light and dark variants are included.

## Passed

- Syntax and relative module import checks.
- ESLint checks.
- Production build: immutable release `0ffd15c45c27aa4b`, with 61 generated offline assets.
- 72 existing behavior tests, updated for the shorter optional guide and native deck selector.
- 1 runner regression check for awaited asynchronous failures.
- 38 domain, storage, import, HTTP, offline, boot and actual DOM interaction tests.
- Unique control IDs and exactly three primary navigation destinations.
- Real interaction tests for native deck selection, short sessions, answer reveal, two primary ratings, completion, and direct deck review/practice.
- Source whitespace checks.

Total: 111 passing automated tests/checks, plus lint, import/syntax and build verification.

The redesign also fixes a double-trigger on answer reveal and a completed daily session retaining its grading lock. Existing atomic persistence, rollback and sync protections remain covered.

## Browser limits

The 16 Playwright browser workflows remain configured for Chrome, Firefox, WebKit and mobile Chrome. They now navigate secondary tools through Settings and exercise the explicit Show answer control.

Native Chromium could not launch in this sandbox. The alternate browser preview was blocked from opening the local app with ERR_BLOCKED_BY_CLIENT. Consequently, actual rendered layout, browser-engine compatibility and full visual/accessibility review are not verified here. DOM tests are not a substitute for those checks. Deployment still requires the browser suite to pass.

## Reproduce

```bash
npm ci
npm run verify
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e
```

Deploy only `dist/`, preserving the existing origin so browser data remains available. Close existing app tabs once to allow the updated offline release to activate. No deployment or external repository push was performed.
