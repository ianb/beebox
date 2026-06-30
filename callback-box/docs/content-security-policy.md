# Content-Security-Policy

The webapp serves a Content-Security-Policy on every HTML document. It is
currently **Report-Only** — it reports violations but blocks nothing — so it is
safe by construction; promotion to the enforcing header is a gated, reviewed
step (below).

## Where it's defined and wired

- **`src/lib/csp.ts`** — `buildCspPolicy({ mode, reportPath })` is the single
  source of truth for the directive set. Prod and dev share it so they can't
  drift; only `script-src`/`style-src` and the report path differ by mode.
- **Prod** — `registerCspReportingHeaders` (`src/webapp/server-root.ts`) adds an
  `onSend` hook that sets `Content-Security-Policy-Report-Only` +
  `Reporting-Endpoints` on `text/html` responses. It keys on content-type (API
  and asset responses get no CSP) and **yields to any route that already set a
  CSP** — notably the frozen captured-page route (`api-files.ts`), whose strict
  `sandbox` policy stays authoritative.
- **Dev** — Vite serves the dev HTML, so `vite.config.ts` sets the same headers
  via `server.headers`, built from `buildCspPolicy({ mode: "dev" })`. Dev relaxes
  `script-src`/`style-src` to `'unsafe-inline' 'unsafe-eval'` for Vite's injected
  react-refresh + HMR; prod is strict (`script-src 'self'`).
- **Report sink** — `POST /api/csp-report`
  (`src/webapp/routes/api-csp-report.ts`), a root-level, unauthenticated route
  (browsers send reports without credentials). It accepts both
  `application/csp-report` and `application/reports+json`, normalizes them, and
  appends to `<primary-box>/.callback-box/csp-reports.log` (there is no
  server-level state dir, so reports — which are app-global — land under the
  primary box). The report path carries the worktree base prefix in dev so the
  router→Vite→backend proxy resolves it.

## The directive set (why each entry is here)

Every non-`'self'` origin is a real, verified browser connection:

- `connect-src` — Deepgram (`wss://api.deepgram.com`) and OpenAI realtime
  (`wss://api.openai.com`) sockets; everything else (tRPC WS, TTS, all `fetch`)
  is same-origin.
- `frame-src` — the YouTube embed (`https://www.youtube-nocookie.com`); the PDF
  and frozen-snapshot frames are same-origin.
- `img-src https:` — external markdown image hot-links **and** Google account
  avatars (`lh3.googleusercontent.com`). `data:`/`blob:` cover pasted images.
- `media-src blob:` — audio playback / MediaSource.
- `script-src 'self'` (prod) — box views and figures run as same-origin compiled
  ES modules. **Exception:** p5.js's opt-in features (Strands shaders, JS filter
  shaders, HarfBuzz 3D-text) use `eval`/WASM; a figure using them would be
  blocked. Most figures don't; the digest surfaces any that do, and the fix is to
  iframe-isolate that figure, not to loosen the app-wide policy.
- `style-src 'unsafe-inline'` — React inline `style={{…}}` props compile to
  governed `style=""` attributes.

## Adding a new external origin

If you add a browser-side call to a new external host (a new STT/TTS provider, an
external image/asset host, a third-party iframe), you **must** add its origin to
the matching directive in `src/lib/csp.ts` (and update `test/lib/csp.doctest.md`).
Otherwise it works in no-CSP environments but is reported (and, once enforced,
blocked) in prod. Server-side calls (the backend talking to an API) never need a
CSP entry — only things the browser contacts directly.

## Reviewing violations + hardening

`pnpm csp-digest <path-to-csp-reports.log>` (`src/dev/csp-digest.ts`) dedupes the
log and prints a digest: each directive+origin that fired, with counts and a
first/last-seen window, or "safe to harden" when clean. The scheduled review
routine runs this over the dev and prod logs and surfaces the result; it
**proposes** the Report-Only → enforcing flip when clean but never flips the
policy itself — a human confirms. To harden: once the digest is clean across real
traffic, change the prod header name from `Content-Security-Policy-Report-Only`
to `Content-Security-Policy` in `registerCspReportingHeaders`, keeping
`script-src 'self'`.
