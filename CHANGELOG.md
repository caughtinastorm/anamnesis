# 1.4.0

- Restructure the app into Today, Cards, Progress and Settings instead of putting unrelated tools under Settings.
- Give Decks, All cards and Organize separate tabs; move the legacy file manager out of the default deck list.
- Make Add card a focused form with multiline question/answer fields and an explicit Back to decks action.
- Split Progress into Overview, Decks, Patterns and Model. Reuse analyzed data and render specialist SVGs only when their tab opens.
- Split importing into file, paste and starter-deck methods; text files continue in Paste text with an explicit preview action.
- Simplify Settings to Preferences, Data and Sync. Show flat sections for everyday controls and consistent disclosures for advanced scheduling, connection tools and deletion.
- Show connected sync status before configuration; preserve remembered tokens by default and the sync/cache improvements from 1.3.1.
- Apply a shared type scale, surface style, spacing, button hierarchy and tab appearance across all screens; make chart colors theme-aware.
- Update the optional guide and navigation regression tests for the new structure.

# 1.3.1

- Remember GitHub tokens by default, including on a fresh setup and after Disconnect; retain the session-only option.
- Reuse successful background checks for 30 seconds without reading the database or contacting GitHub. Local edits, credential changes and manual sync bypass this cooldown.
- Coalesce concurrent requests without redundant follow-ups; preserve a follow-up when local edits occur during a sync.
- Acknowledge HTTP 304 responses with a fresh last-check time and allow conditional requests for acknowledged empty datasets.
- Skip background network attempts while offline and resume on reconnect.
- Retain local-first rendering, persistent ETags, unchanged-sync UI reuse and offline asset caching.

# 1.3.0

- Add General, Study, Data and Sync tabs while keeping Today / Cards / Settings as the primary navigation.
- Add deck search, 40-row pagination, accessible tab keyboard controls, visible focus, a skip link, and browser zoom support.
- Use session credentials by default, retain remembered credentials only by choice, and add Disconnect.
- Bound complete HTTP responses by size and deadline, reject redirects, validate Gist targets, and abort stale sync application when configuration changes, including at the database transaction boundary.
- Neutralize formula-bearing CSV export cells.
- Generate matching server, HTML and static-host policies from one module, blocking forms, embedded objects and frames.
- Coalesce data refreshes, defer hidden collection views, skip unchanged sync refreshes, and load ZIP parsing code on demand.
- Bundle production CSS in cascade order and remove duplicate CSS files from the production cache.
- Preserve the database name, schema, cards, review history and scheduling behavior.
- Extend security, performance, navigation, integration and browser regression coverage. See QUALITY_REPORT.md for executed checks and browser limitations.

# 1.2.0 — A simpler daily loop

- Reduce main navigation to Today, Cards and Settings.
- Give Today one primary action and a native deck dropdown.
- Use short ten-card sessions by default, including one-pass practice.
- Reveal answers explicitly and show Again / Got it as the two primary choices; retain additional ratings in a disclosure.
- Replace the default file-manager screen with a simple deck list and direct review buttons.
- Start new cards with Question, Answer and Deck; reveal optional fields only on demand.
- Group importing, progress, backups, sync, preferences and advanced organization behind secondary entry points.
- Add a light, warm green visual system, responsive navigation, quiet progress and concise completion copy.
- Remove automatic onboarding; shorten the optional guide to three steps.
- Preserve existing data and persistence guarantees. Add regression coverage for the simplified core loop and fix completion and answer-reveal interaction issues.

# 1.1.0

- Await async tests and remove machine-specific paths.
- Commit grading, undo and resets atomically; preserve session state on failed saves.
- Protect newer edits, use fresh revisions and preserve schedules on repeated Again reviews.
- Derive history from committed logs while preserving the earlier baseline.
- Extract practice rules, review operations and sync coordination; split state by owner.
- Validate remote data and backups; resolve ties deterministically and retain tombstones.
- Preserve in-flight edits; add independent device snapshots and digest checkpoints.
- Include review history in backups, add JSON restore and save recovery snapshots.
- Query SQLite for Anki packages and move package parsing into a worker.
- Generate immutable releases and offline manifests with deferred activation.
- Add dialog focus containment/restoration, shortcut guards, live toasts, reduced motion and ordered CSS.
- Defer hidden-view analytics and queue requests made during rendering.
- Serve only public assets, handle malformed URLs and publish only checked build output.
- Add storage, DOM-handler, boot, import, HTTP and offline tests, plus a four-project browser suite and CI gates.
