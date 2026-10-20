# Upgrade to 1.4.0

1. Create a snapshot using the Backups controls in your current app, then export it as JSON. In 1.4.0 these controls live under Settings → Data. Keep that file outside the browser.
2. Extract this ZIP. From `app/`, use Node.js 24 LTS and run `npm ci`, then `npm run verify`.
3. Run `npx playwright install --with-deps chromium firefox webkit`, then `npm run test:e2e`. Inspect desktop and mobile layouts in both themes. This is still required before production release.
4. Run `npm start` for the built app, or deploy only `dist/` over HTTPS. Preserve the existing origin (scheme, hostname and port) so browser data remains available. Check the live HTTP security headers against SECURITY.md.
5. Close all existing app tabs and reopen once to activate the new offline release. Check a deck, grade/undo a card, export/restore a backup, and test optional sync on a test Gist before enabling it for important data.

No database migration is introduced. Cards, schedules, IDs, review logs, backups and tombstones use the existing database and schema. The existing migration marker and first-run seed rules remain unchanged.

The interface now has four task destinations: Today, Cards, Progress and Settings. Cards separates Decks, All cards and Organize; Add card and Import are direct header actions. The add form has an explicit Back to decks control. Progress defaults to Overview and keeps detailed tables/charts in Decks, Patterns and Model tabs. Settings uses Preferences, Data and Sync. Import methods have separate tabs.

Remember token on this device is enabled by default for new configurations, and existing remembered tokens remain enabled. An explicitly saved session-only configuration still shows its current setting. To reduce persistence, open Settings → Sync, uncheck Remember token on this device and save. Disconnect removes the stored credentials. Session tokens belong to a tab session; configure each independent tab/device as needed.

For rollback, retain the previous deployment and your exported JSON snapshot. Browser storage is not an external backup. Avoid changing the origin during rollout or rollback.

Background sync reuses a recent successful check for 30 seconds. Local edits, credential changes, and manual sync bypass this cooldown. Existing acknowledged-snapshot ETags remain persistent across app restarts. Local data displays before background synchronization.
