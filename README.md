# anamnesis

Offline-first flashcards with FSRS scheduling, scheduled review and practice sessions, collection browsing, analytics, Anki import, IndexedDB backups, and GitHub Gist synchronization.

## A simpler daily practice

- **Today:** choose a deck, then start a ten-card session. Reveal the answer and choose Again or Got it. More ratings are available on demand.
- **Cards:** browse a simple deck list or add a card using Question, Answer and Deck. Notes, hints, audio and folder organization stay behind secondary controls.
- **Settings:** progress, importing, syncing, backups and study preferences live here. No walkthrough opens automatically.

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

Configure a GitHub token with Gist access and a secret Gist. Credentials are stored in this browser's localStorage. Secret Gists are unlisted, not encrypted storage; anyone with the URL and appropriate access can read the content. Do not store credentials or highly sensitive content in cards.

Each installation writes `anamnesis-device-<id>.json`, plus the `flashcards.json` compatibility snapshot. Upgraded clients merge all device snapshots, protecting different devices' unique records during simultaneous uploads. Same-card conflicts use last-modified wins, then deletion on a timestamp tie, then deterministic canonical-content order. Changes to one card are not merged field by field.

Edits made during network requests are preserved at the transactional apply boundary. A recovery snapshot is saved before remote updates. Invalid remote files stop sync. Checkpoints advance after local application succeeds.

Conditional requests use a digest of the acknowledged snapshot. A PATCH forces the next sync to fetch fresh data so it cannot hide a concurrent device file. Web Locks serialize synchronization across tabs where supported.

Deletion markers are retained to prevent resurrection by long-offline devices. Cloud sync covers cards and scheduling; logs, backups and preferences remain local. Update all devices to receive independent-device protection. Earlier clients read only the compatibility snapshot.

## Offline updates

Builds place runtime assets under a content-derived release directory and generate their precache manifest. The worker serves one installed release consistently. Updates wait until existing tabs close, with a notice in the app. Installation requires one successful online load. External fonts may fall back to system fonts offline.

## Import compatibility

CSV, TSV, Anki text exports, and older-compatible SQLite Anki packages are supported. Package parsing queries notes/cards/models/decks, including reverse templates and cloze ordinals. It does not scan bytes for probable text. Package work runs in a worker where supported.

Compressed `collection.anki21b` packages and newer normalized metadata schemas are rejected with an actionable message. Export with older-version compatibility or use text export. Media, custom template JavaScript, advanced nested template conditions and original Anki scheduling are not imported. Imported cards receive fresh schedules. Package input and expanded collection sizes are limited to 100 MB.

## Architecture

- `app.js`: boot, routing and dependency wiring.
- `js/domain/`: practice rules, data contracts, canonical comparison and repeatable legacy transformations.
- `js/services/`: review operations, sync coordination and package worker orchestration.
- `db.js`: connection, transactions, repositories, migrations and backups.
- `sync.js`: Gist transport and deterministic merge.
- `js/state.js`: card, selection, study, gesture, dialog, settings and import slices. A flat compatibility facade remains for existing integrations.
- `js/*.js`: feature rendering and event controllers.
- `css/`: ordered modules and accessibility rules. Preserve their order when moving overrides.
- `vendor/`: pinned browser SQLite/ZIP assets and upstream licenses. Rebuild intentionally when updating dependencies.

Scheduling equations and analytics retain the application's existing behavior. Their educational or statistical claims are not independently scientifically validated by this refactor.
