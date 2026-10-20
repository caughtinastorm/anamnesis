# Security model

Anamnesis is an offline-first browser app. It has no application server account system. Cards, review history, settings and local backups belong to the browser origin. Browser or device compromise, malicious extensions, and scripts executing on the same origin can access this data. Do not host unrelated or untrusted applications on this origin.

## Content and imports

Card rendering retains an escaped, small formatting allowlist. Imported scripts, event handlers and arbitrary HTML are not executed. Package parsing uses pinned, local dependencies and a worker where available. Existing package and expanded database limits remain 100 MB; JSON restore remains capped at 20 MB. CSV exports prefix cells that could be interpreted as spreadsheet formulas. That safety prefix can appear in a subsequent text re-import.

## Synchronization

GitHub synchronization is optional. Tokens are remembered in localStorage by default for personal-app convenience. The Remember checkbox starts enabled; unchecking it selects tab-session storage instead. Upgrades preserve tokens already remembered in earlier versions. Uncheck Remember and save to move one to session storage, or Disconnect to remove it. These stores are not encrypted and do not protect against XSS. Use a dedicated token limited to Gist access and revoke it at GitHub if a device is lost or compromised.

Secret Gists are unlisted rather than encrypted. Anyone with access to the Gist URL may read its content. Avoid sensitive card content. This app does not provide end-to-end encryption.

Transport omits ambient browser credentials and referrers, refuses redirects, and restricts Gist IDs and raw download origins. The request deadline covers the response body. API responses and combined datasets are limited to 32 MiB per sync; individual raw datasets are limited to 20 MiB. Forty device snapshots remain the maximum. Reaching a limit stops synchronization instead of partially applying it. A configuration change invalidates in-flight results before upload, local application, and inside the local write transaction.

## Hosting

Use HTTPS and deploy only `dist/`. `security-policy.js` generates matching HTML policy, `_headers`, and local-server headers. It restricts scripts and workers to this origin, limits network connections, and disables form submission, objects and frames. The existing WebAssembly permission supports SQLite; inline styles remain allowed for the existing UI. Inline scripts remain blocked.

Your production host must actually honor the generated HTTP headers. `_headers` is a host-specific configuration file, not a browser feature. If your host ignores it, configure equivalent headers separately. In particular, framing protection requires HTTP headers; the HTML meta policy cannot enforce `frame-ancestors`. Verify the live response headers before deployment. The included Pages workflow alone does not prove those headers are delivered.

The local server binds to loopback, serves an allowlist of public assets, rejects traversal and symlink escapes, and provides security headers on error responses too. It is a local static-file server; use a managed HTTPS host or reverse proxy for a public deployment.

## Verification boundaries

Automated regression tests and dependency audits reduce risk; they are not an independent penetration test, security certification, or accessibility audit. Native browser rendering and deployment-specific header verification were not possible in the authoring environment. See QUALITY_REPORT.md.

Policy references: [MDN form-action](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action), [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), and [GitHub Gist API](https://docs.github.com/en/rest/gists/gists).
