# Content-Security-Policy

The webapp serves a Content-Security-Policy on every HTML document. It is
currently **Report-Only** — it reports violations but blocks nothing — so it is
safe by construction; promotion to the enforcing header is a gated, reviewed
step (below).

## Where it's defined and wired

- **`src/lib/csp.ts`** — `buildCspPolicy({ mode, reportPath })` is the single
  source of truth for the directive set. Prod and dev share it so they can't
  drift; only `script-src`/`style-src` and the report path differ by mode.
- **Built webapp** — `registerCspReportingHeaders` (`src/webapp/server-root.ts`) adds an
  `onSend` hook that sets `Content-Security-Policy-Report-Only` +
  `Reporting-Endpoints` on `text/html` responses. It keys on content-type (API
  and asset responses get no CSP) and **yields to any route that already set a
  CSP** — notably the frozen captured-page route (`api-files.ts`), whose strict
  `sandbox` policy stays authoritative. Fastify always selects the production
  policy: it serves the built frontend, never Vite's HMR HTML.
- **Dev** — Vite serves the dev HTML, so `vite.config.ts` sets the same headers
  via `server.headers`, built from `buildCspPolicy({ mode: "dev" })`. Dev relaxes
  `script-src`/`style-src` to `'unsafe-inline' 'unsafe-eval'` for Vite's injected
  react-refresh + HMR; the built webapp is strict (`script-src 'self'`). Neither
  choice depends on `NODE_ENV`.
- **Report sink** — `POST /api/csp-report`
  (`src/webapp/routes/api-csp-report.ts`), a root-level, unauthenticated route
  (browsers send reports without credentials). It accepts both
  `application/csp-report` and `application/reports+json`, normalizes them, and
  appends them as **JSONL** (one `{ts, directive, blocked, doc}` object per line)
  to `<primary-box>/.beebox/csp-reports.log` (there is no server-level state
  dir, so reports — which are app-global — land under the primary box). The log
  rolling-truncates on a newline boundary so JSONL stays valid. The report path
  carries the worktree base prefix in dev so the router→Vite→backend proxy
  resolves it.

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

## Cross-box isolation: single-operator by design

Boxes are path siblings on ONE origin (`/<slug>/…`), so the same-origin policy is
shared between them — a script under one box can make same-origin requests to another
box's API carrying that box's ambient session. **This is not browser-level isolation,
and we don't claim it is.** It's acceptable because a beebox instance is
**single-operator**: every box on an origin belongs to one operator, running content
they or their agents authored — no operator co-hosts a *different* operator's boxes on
the same origin (e.g. all of one person's boxes live on their own domain). The server
side still prevents cross-box *authentication* forgery (the hub holds the session
secret; boxes never verify cookies — see `src/webapp/auth.ts`), so a box can't
authenticate AS another; the accepted residual is same-origin ambient access between
one operator's own boxes. Revisit (per-box origins, or sandboxed untrusted content)
only if boxes ever render third-party-authored views or are shared between different
people.

## Adding a new external origin

If you add a browser-side call to a new external host (a new STT/TTS provider, an
external image/asset host, a third-party iframe), you **must** add its origin to
the matching directive in `src/lib/csp.ts` (and update `test/lib/csp.doctest.md`).
Otherwise it works in no-CSP environments but is reported (and, once enforced,
blocked) in prod. Server-side calls (the backend talking to an API) never need a
CSP entry — only things the browser contacts directly.

## Reviewing violations + hardening

`pnpm csp-digest` (`src/dev/csp-digest.ts`) dedupes the log and prints a digest:
each directive+origin that fired, with counts and a first/last-seen window, or
"safe to harden" when clean. By default it runs **incrementally** against the
local primary box (`~/src/boxes/test1`): it reports only entries newer than the
last run — tracked by a timestamp cursor written beside the log in the git-ignored
`.beebox/csp-digest-cursor.json` — and advances the cursor. `--all` ignores
the cursor and digests the whole log (use it to judge a harden); `--json` emits
the digest for an agent to analyze; a positional `<logPath>` digests an explicit
file. A local scheduled routine runs the incremental digest on a cadence,
analyzes whatever is new, and reports; it **proposes** the Report-Only →
enforcing flip when clean but never flips the policy itself — a human confirms.
The routine is a runbook: see `docs/scheduled/csp-violation-review.md`. To harden
manually: once `--all` is clean across real traffic, change the prod header name
from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in
`registerCspReportingHeaders`, keeping `script-src 'self'`.
