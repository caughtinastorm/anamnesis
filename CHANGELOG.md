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
