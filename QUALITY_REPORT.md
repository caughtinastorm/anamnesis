# Verification report — 1.4.0

Verified on 2026-10-20 UTC using Node.js 24.19.0.

## Executed checks

`npm run verify` passed: syntax and local-import validation, ESLint, production build, 72 behavior checks, one asynchronous-runner regression check, and 61 Node/DOM/integration tests. Total: 134 passing automated tests/checks, in addition to lint, syntax and build.

Production release: `43c72e08475a22f7`, with 50 offline assets. Source and the matching production build are included. Application dependencies are unchanged; the preceding dependency audit reported zero known vulnerabilities across 94 dependencies.

## UI changes covered

- Four task destinations: Today, Cards, Progress and Settings.
- Default deck list is separated from the Organize tab and legacy file manager.
- Add card opens a focused multiline form; Back to decks returns focus to the correct tab.
- Progress opens on Overview. Decks, Patterns and Model contain specialist details. Hidden SVG charts are not built until requested, and tab changes reuse analyzed data.
- Import shows one method at a time. Paste text has an explicit preview step, and the starter-deck method hides the input/preview workspace.
- Settings uses Preferences, Data and Sync, with advanced controls in optional disclosures.
- Common spacing, type, surfaces, buttons, form fields and tab appearance are defined in the shared product stylesheet. Chart drawing colors use theme variables.
- Keyboard tab movement, focus containment, primary navigation state, search, 40-row pagination and 2,000-deck interaction coverage remain passing.
- Existing grading, undo, completion, failed-save, scheduler, storage, import, backup/restore, HTTP and offline-cache tests remain passing.

## Remembered credentials and caching

- Tokens are remembered by default. Session-only storage remains available. Disconnect removes stored credentials.
- Repeated background checks within 30 seconds reuse a successful check without reading cards or contacting GitHub.
- Local edits, cross-tab data invalidation, credential changes and manual sync bypass that cooldown; failed requests are not cached.
- Concurrent requests share active work. Edits during synchronization schedule a fresh follow-up.
- Persistent acknowledged-snapshot ETags support 304 responses, including empty datasets. A 304 updates the last-check time without applying or rerendering card data.
- Background requests are skipped while offline and resume on reconnect. Local IndexedDB data renders before background sync.

## Browser validation remains outstanding

Eight workflows are configured for each of Chromium, Firefox, WebKit and mobile Chrome (32 total). None has passed in this environment. The standard Chromium download failed; an alternate registry-distributed Chromium executable could not launch (SIGTRAP), and the cloud browser could not connect to the local app server.

Actual visual layout, responsive overflow, browser-specific behavior and assistive-technology behavior therefore remain unverified. DOM tests and stylesheet inspection do not substitute for visual browser testing. Existing CI/deployment gates still require the native browser suite.

No live deployment or repository push was performed. No user browser data was accessed. The database name/schema, card IDs and existing scheduling behavior are preserved. This is not an independent security or accessibility audit.

## Reproduce

```bash
npm ci
npm run verify
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e
npm start
```

Export a JSON snapshot before rollout, preserve the existing app origin, deploy only `dist/` over HTTPS, and verify the production security headers. See UPGRADE.md and SECURITY.md.
