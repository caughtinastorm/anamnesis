# anamnesis

Offline-first flashcards with FSRS scheduling, scheduled review and practice sessions, collection browsing, analytics, Anki import, IndexedDB backups, and GitHub Gist synchronization.

## A simpler daily practice

- **Today:** choose a deck and start a short review. Reveal the answer, then choose Again or Got it. Extra ratings stay under More rating options.
- **Cards:** search Decks, browse All cards, or open Organize. Add card is the primary action; Import is alongside it. New cards start with Question, Answer and Deck. Hints, notes, folders and audio stay optional.
- **Progress:** the Overview shows activity and suggestions. Decks, Patterns and Model tabs hold specialist details. Charts are rendered when their tab opens and reuse the already-analyzed data.
- **Settings:** Preferences, Data and Sync. Everyday preferences are visible directly; advanced scheduling, deletion and connection tools use consistent disclosures. Connected sync opens with a status and Sync now; connection fields stay under Connection settings.

Import has separate From a file, Paste text and Starter deck tabs. Text files continue in Paste text with a clear Preview cards action. Keyboard users can move between tabs with Left/Right or Home/End and activate with Enter/Space. No walkthrough opens automatically.

Practice is one pass through a short set of cards, with forgotten cards revisited. It leaves long-term scheduling unchanged. Preferences can increase the session size or include every ready card. Light and dark themes share the same quiet green palette.

## Run

Use Node.js 24 LTS (minimum 22.13).

```bash
npm ci
npm run verify
npm start
```

Open http://127.0.0.1:8081. The server serves `dist/` when built. For source development, use `node server.js --dev`. Deploy only `dist/`, using HTTPS. Opening `index.html` directly is unsupported.

Preserve the existing hostname and URL origin when upgrading: browser data belongs to its origin. Export a JSON snapshot before changing domains or ports.

## Quality checks

- `npm run verify`: syntax, local imports, lint, build, unit tests, storage integration tests, DOM interaction tests, HTTP tests, and offline-cache tests.
- `npx playwright install --with-deps chromium firefox webkit`, then `npm run test:e2e`: desktop Chrome, Firefox, Safari/WebKit and mobile Chrome workflows.
- Pull requests and deployment run both suites in GitHub Actions. Pages deployment publishes only `dist/` after checks succeed.

DOM tests execute real event handlers using Happy DOM and fake IndexedDB. They complement browser tests; they do not prove visual layout, accessibility conformance or browser-engine compatibility.

## Data guarantees

Grading commits the schedule and review log in one IndexedDB transaction. The session advances after commit. Undo commits atomically with a fresh modification revision. Stale grading and undo cannot overwrite a newer change. Failed writes leave the session available for retry.

Review counters derive from committed logs. A one-time baseline preserves counts recorded by older versions. Practice-only attempts are logged separately without changing scheduling.

Legacy repairs run as a recorded migration. The database name and existing IDs are retained. The v3 upgrade adds metadata without replacing existing stores.

Snapshots include cards, review logs and the historical-count baseline. JSON export includes no sync token. Restore creates a recovery snapshot, restores scheduling and history atomically, and records removals as fresh tombstones. Old cards-only backups preserve existing logs; full backups restore their captured logs.

Snapshots are local until exported. Export regularly and before changing origins: browser storage is not an external backup.

## Synchronization

Configure a GitHub token with Gist access and a secret Gist. Tokens are remembered in localStorage by default so reopening the app stays connected. “Remember token on this device” starts checked. Uncheck it and save to use sessionStorage for this tab session instead. Existing saved credentials continue to work. Disconnect removes both copies. Both stores are readable by scripts running on this origin; neither encrypts the token. Secret Gists are unlisted, not encrypted storage; anyone with the URL and appropriate access can read the content. Do not store credentials or highly sensitive content in cards.

Each installation writes `anamnesis-device-<id>.json`, plus the `flashcards.json` compatibility snapshot. Upgraded clients merge all device snapshots, protecting different devices' unique records during simultaneous uploads. Same-card conflicts use last-modified wins, then deletion on a timestamp tie, then deterministic canonical-content order. Changes to one card are not merged field by field.

Edits made during network requests are preserved at the transactional apply boundary. A recovery snapshot is saved before remote updates. Invalid remote files stop sync. Checkpoints advance after local application succeeds.

The app displays local IndexedDB data first, then synchronizes in the background. Repeated background checks within 30 seconds reuse the recent successful check without rereading cards or making a network request. Local edits, credential changes and manual sync bypass that cooldown; failed requests are never reused. Duplicate in-flight requests share one operation, while edits made during it schedule a fresh follow-up. Reconnecting to the network resumes background sync. This cooldown can delay discovery of another device’s changes by up to 30 seconds when switching tabs; manual sync checks immediately.

Conditional requests use a digest of the acknowledged snapshot, including an acknowledged empty collection. A 304 response updates the last-checked timestamp without downloading datasets or refreshing the local UI. A PATCH forces the next sync to fetch fresh data so it cannot hide a concurrent device file. Web Locks serialize synchronization across tabs where supported.

Deletion markers are retained to prevent resurrection by long-offline devices. Cloud sync covers cards and scheduling; logs, backups and preferences remain local. Update all devices to receive independent-device protection. Earlier clients read only the compatibility snapshot.

## Offline updates

Builds place runtime assets under a content-derived release directory and generate their precache manifest. The worker serves one installed release consistently. Updates wait until existing tabs close, with a notice in the app. Installation requires one successful online load. The app uses system fonts and makes no external font requests. Production CSS is bundled into one file in its existing cascade order.

## Import compatibility

CSV, TSV, Anki text exports, and older-compatible SQLite Anki packages are supported. Package parsing queries notes/cards/models/decks, including reverse templates and cloze ordinals. It does not scan bytes for probable text. Package work runs in a worker where supported.

Compressed `collection.anki21b` packages and newer normalized metadata schemas are rejected with an actionable message. Export with older-version compatibility or use text export. Media, custom template JavaScript, advanced nested template conditions and original Anki scheduling are not imported. Imported cards receive fresh schedules. Package input and expanded collection sizes are limited to 100 MB.

## Architecture

- `app.js`: boot, routing and dependency wiring.
- `js/domain/`: practice rules, data contracts, canonical comparison and repeatable legacy transformations.
- `js/services/`: atomic review operations, sync coordination, bounded HTTP transport, deferred view refresh, and package worker orchestration.
- `js/tabs.js`: shared secondary-tab selection and keyboard behavior for Settings, Progress and Import.
- `security-policy.js`: shared source of server headers and build-generated HTML/static-host policies.
- Collection rendering waits until its view or tab is visible. Repeated refresh requests coalesce, and unchanged syncs avoid a full database/UI reload.
- `db.js`: connection, transactions, repositories, migrations and backups.
- `sync.js`: Gist transport and deterministic merge.
- `js/state.js`: card, selection, study, gesture, dialog, settings and import slices. A flat compatibility facade remains for existing integrations.
- `js/*.js`: feature rendering and event controllers.
- `css/`: ordered modules and accessibility rules. Preserve their order when moving overrides.
- `vendor/`: pinned browser SQLite/ZIP assets and upstream licenses. Rebuild intentionally when updating dependencies.

Scheduling equations and analytics retain the application's existing behavior. Their educational or statistical claims are not independently scientifically validated by this refactor.

## Security and release notes

Read [SECURITY.md](SECURITY.md) for the threat model and hosting requirements, [UPGRADE.md](UPGRADE.md) for rollout, and [QUALITY_REPORT.md](QUALITY_REPORT.md) for verified checks and remaining limits. Browser-based acceptance tests must pass on your deployment environment before release.
