# App-wide Content-Security-Policy

This plan introduces a Content-Security-Policy (CSP) on the callback-box
webapp. Today the app ships **no** document CSP — the only CSP in the codebase
is `FROZEN_CSP`, scoped to captured-snapshot HTML at
`src/webapp/routes/api-files.ts:40`. The immediate motivation is the new
markdown YouTube embed (an `<iframe>` to `youtube-nocookie.com`), which is a
good moment to add a real policy that both allowlists that frame origin and
hardens the whole app against injected scripts/frames/exfiltration. The plan's
shippable unit is the policy in **Report-Only** mode (breaks nothing, yields
real violation data); flipping to enforcing is a gated follow-up.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:` *"Read before writing. Don't guess file formats,
  XML structures, or API shapes."* — every directive below is traced to a
  verified `file:line` where the browser actually contacts an origin, not to a
  guess about what a SPA "probably" needs.
- `callback-box/CLAUDE.md:` the "don't add features beyond what the task
  requires" rule — argues for a hand-rolled `onSend` hook over pulling in
  `@fastify/helmet` and its full header suite when the task is specifically a
  CSP (see Open question 1), and for deferring the `img-src` tightening (see
  NOT in scope).
- `callback-box/CLAUDE.md:` *"Treat noisy command output as a bug"* and the
  general no-regressions posture — a CSP that breaks figures/box-views/dictation
  in prod would be exactly the kind of silent breakage this repo treats as
  unacceptable; the Report-Only-first rollout is the mitigation.
- `callback-box/CODE-STYLE.md:` no `any`, max 2 positional params, custom error
  classes, `// eslint-disable-next-line` only with justification — applies to
  the new CSP-policy module and report route.
- Precedent: the existing `FROZEN_CSP` (`api-files.ts:40`) and the
  chrome-extension CORS `onSend` hook (`server-root.ts:25`) are the densest
  precedents for "how this codebase attaches security headers" — the plan
  follows their hand-rolled, narrowly-scoped shape rather than introducing a
  framework.

## What already exists

- **The only existing CSP — `FROZEN_CSP`.** `src/webapp/routes/api-files.ts:40`:
  `const FROZEN_CSP = `sandbox allow-scripts; script-src '${FROZEN_SCRIPT_HASH}'`;`
  applied per-response at `api-files.ts:188` (`.header("Content-Security-Policy",
  FROZEN_CSP)`) only when the served file is `.frozen`. This is a deliberately
  strict per-document sandbox for untrusted captured HTML. **The plan must not
  clobber it.** Frozen pages are opened as top-level navigations
  (`WebpageView.tsx:62` `window.open(...)`), never iframed inside the app, so
  this CSP governs an isolated document. **Reused, untouched.**
- **The one global response hook.** `src/webapp/server-root.ts:25`
  `server.addHook("onSend", ...)` (registered via `registerChromeExtensionCors`
  at `server.ts:56`) currently only reflects CORS headers for
  `chrome-extension://` origins. This is the natural place to attach the app
  CSP. **Reused — extended, not rebuilt.**
- **The prod HTML document sources.** `registerSpaFallback`
  (`server-root.ts:121-154`) emits the SPA shell at `server-root.ts:150`
  (`reply.type("text/html").send(fs.readFileSync(...index.html...))`); the
  unbuilt-frontend landing is at `server-root.ts:162`; the box-selector `/`
  document is served by `@fastify/static` (`server.ts:102`,
  `server-box-scope.ts:178`). Because HTML reaches the browser through *three*
  mechanisms, a single `onSend` hook keyed on `Content-Type: text/html` is the
  robust way to cover them all. **Reused.**
- **Same-origin API surface.** `getApiBase()` / `withBase()` /
  `getWebSocketUrl()` in `src/frontend/src/api-core.ts:79-82` resolve to the
  page origin. Almost all browser traffic is `'self'`. **Relied on.**
- **No `@fastify/helmet`.** `package.json` has `@fastify/static` only; Fastify is
  `^5.7.2`. Adopting helmet would mean a new dep (v13+ for Fastify 5). The plan's
  lean is **rebuild-not-adopt** (a ~15-line hook), justified under "don't add
  features beyond what the task requires" — see Open question 1.

## Prior art (external)

- **CSP cannot be strict in Vite dev.** Vite injects inline scripts (the
  react-refresh preamble) and inline styles and opens an HMR WebSocket; a strict
  `script-src`/`style-src` produces "Refused to execute/apply inline" errors.
  Standard practice is a **dev/prod split**: relaxed (or report-only) in dev,
  strict in prod. https://github.com/vitejs/vite/issues/11862,
  https://github.com/vitejs/vite/issues/16749
- **Inline `style=""` attributes ARE governed by CSP** (correcting an assumption
  in the planning brief). React inline `style={{…}}` props compile to real
  `style=""` attributes, which a restrictive `style-src` blocks. Prod will need
  `style-src 'unsafe-inline'` unless every inline style + CSS-in-JS path is
  audited out — and `'unsafe-inline'` on *styles* is far lower-risk than on
  scripts.
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src
- **YouTube-nocookie embed needs only `frame-src
  https://www.youtube-nocookie.com`** on the parent (plus `img-src
  https://i.ytimg.com` *if* the parent shows poster thumbnails — it doesn't; the
  cross-origin iframe loads its own thumbnails). A cross-origin iframe is a
  separate browsing context: its scripts/fetch/media are governed by YouTube's
  CSP, not ours. `child-src` is unneeded when `frame-src` is set.
  https://jloh.co/posts/youtube-csp/
- **Report-Only rollout is the safe path.** `Content-Security-Policy-Report-Only`
  can be sent alongside the enforcing header; browsers honor both independently
  (one blocks, one only reports). Ship report-only, collect violations, then
  promote.
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only
- **`@fastify/helmet` supports per-route CSP override and report-only toggling**
  — if we *did* adopt it, the frozen route could override via `helmet: {
  contentSecurityPolicy: {...} }`. Recorded so Open question 1 is decided against
  real capabilities, not assumptions. https://github.com/fastify/fastify-helmet
- **`script-src 'self'` covers the dynamic-`import()` view/figure *mechanism***
  (same-origin compiled modules, no `blob:`/eval for our own code) — **but p5.js
  itself requires `'unsafe-eval'`**: `node_modules/p5/lib/p5.esm.js` uses `new
  Function` + `WebAssembly` (verified, 4 matches), and `new Function` needs full
  `'unsafe-eval'`, not the narrower `'wasm-unsafe-eval'`. So an enforced prod
  `script-src` that keeps figures working is `'self' 'unsafe-eval'`. This is a
  decided trade-off, not a "Report-Only will reveal it" unknown.
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src

## Tracks / scope

Single track, three chunks (ordered by dependency). The directive set is the
load-bearing artifact; everything else is plumbing around it.

### The directive set (the artifact)

Derived from the browser-connection inventory (every entry cited below). Two
policies share one source-of-truth module; they differ only in `script-src` /
`style-src` and the report directives.

**Common (both dev and prod):**
```
default-src 'self';
connect-src 'self' https://api.deepgram.com wss://api.deepgram.com https://api.openai.com wss://api.openai.com;
img-src     'self' data: blob: https:;
media-src   'self' blob:;
worker-src  'self';
frame-src   'self' https://www.youtube-nocookie.com;
font-src    'self';
object-src  'none';
base-uri    'self';
frame-ancestors 'self';
report-uri  /api/csp-report;
report-to   csp-endpoint;
```
The `report-to csp-endpoint` token only works if the response *also* carries a
`Reporting-Endpoints: csp-endpoint="/api/csp-report"` header (HTTP-header form of
the Reporting API) — the same `onSend`/Vite wiring that sets the CSP header must
set this companion header. `report-uri` is the legacy fallback for browsers
without the Reporting API; emit both. **Without these, Report-Only produces
console noise but no server-side evidence, and the promotion gate that reads
`/api/csp-report` is hollow** — so the report directives are part of the
directive set, not an afterthought.
- `connect-src` external entries: Deepgram WS at
  `transcription-connections.ts:109` (`wss://api.deepgram.com/v1/listen`),
  OpenAI realtime at `transcription-connections.ts:199`
  (`wss://api.openai.com/v1/realtime`). Same-origin WS (tRPC
  `api-core.ts:79-82`, Voxtral `transcription-connections.ts:46-49`) is covered
  by `'self'`. TTS (`tts-client.ts:286`) and all other `fetch()` are `'self'`.
  (Verified complete: Mistral/Google/Telegram/Anthropic/Replicate calls are all
  server-side or same-origin proxy calls, not browser cross-origin.)
- `img-src https:` is forced by **two** external-image consumers, not one:
  (a) markdown image hot-linking — `Markdown.tsx:149` →
  `view-url.ts:165` (external URLs returned as-is, rendered by `Image.tsx:126`);
  (b) **authenticated user avatars** — Google OAuth stores `payload.picture`
  (`src/webapp/routes/auth.ts:82`), `/auth/me` returns it (`auth.ts:145`), and
  `Avatar.tsx:49` renders `<img src={picture}>` against
  `lh3.googleusercontent.com`. `data:` for pasted-image previews
  (`image-paste.ts:87`); `blob:` for pasted/processed images
  (`image-paste.ts:64,133`). Note: any future `img-src` tightening to proxy-only
  must handle BOTH consumers (avatars too), not just markdown — see NOT in scope.
- `media-src blob:` for audio playback / MediaSource
  (`audio-context.ts:130,214`).
- `worker-src 'self'` for the AudioWorklet served same-origin
  (`transcription-mic.ts:24,100`). No `blob:`/`new Worker` anywhere.
- `frame-src`: YouTube embed (`VideoEmbed.tsx:21` ← `video-url.ts:70`); the PDF
  iframe (`pdf.tsx:14-17`) and any same-origin frame are `'self'`.
- `font-src 'self'`: no external/`@font-face`/`data:` fonts (system stacks only,
  `index.css`).
- `frame-ancestors 'self'`: the app should not itself be embeddable cross-origin
  (the frozen sandbox is the only intentional framing, and it's same-origin).

**Prod adds:**
```
script-src  'self' 'unsafe-eval';
style-src   'self' 'unsafe-inline';
```
- `script-src 'self'`: our own code is fine — all dynamic-`import()` targets are
  same-origin compiled modules (`src/frontend/src/components/ViewRenderer.tsx:191`,
  `src/frontend/src/components/FigureView.tsx:73`); no inline script in
  `index.html` (only `<script type="module" src="/src/main.tsx">`, rewritten to
  a hashed asset by `vite build`).
- **`'unsafe-eval'` is REQUIRED (verified, not speculative):** p5.js figures
  import `p5` directly (`src/frontend/src/components/FigureMount.tsx:63`
  `await import("p5")`), and the installed `p5` build uses `new Function` and
  `WebAssembly` internally (`node_modules/p5/lib/p5.esm.js`, 4 matches). `new
  Function` is NOT covered by the narrower `'wasm-unsafe-eval'` — it needs full
  `'unsafe-eval'`. So an enforced prod `script-src` that keeps p5 figures working
  must include `'unsafe-eval'`. This is the central strictness trade-off; see
  Open question 5 (it intersects the "bias toward strict" preference) and the
  NOT-in-scope figure-isolation item. Note `'self' 'unsafe-eval'` still blocks
  injected inline `<script>`/handlers (no `'unsafe-inline'`) and foreign-origin
  script tags — `'unsafe-eval'` only re-permits `eval`/`new Function`/WASM, so
  this is a partial, deliberate relaxation, not a no-op policy.
- `style-src 'unsafe-inline'`: React inline `style={{…}}` props +
  `SourceViewOverlay.tsx:96` injected `<style>`. Lower-risk than script
  inlining; a nonce/hash pass to remove it is NOT in scope.

**Dev replaces script/style with a relaxed pair** (Vite injects inline
react-refresh + styles; the HMR WS rides the page origin so `connect-src 'self'`
already covers it — `vite.config.ts:36-43`):
```
script-src  'self' 'unsafe-inline' 'unsafe-eval';
style-src   'self' 'unsafe-inline';
```
Dev keeps the *same* external-origin allowlist (frame-src, connect-src) so
developing locally still exercises the YouTube/Deepgram/OpenAI rules and surfaces
mistakes early.

### Chunk 1 — shared policy module + report sink (first implementation chunk, no open questions inside it)

- New `src/lib/csp.ts` exporting `buildCspPolicy({ mode }: { mode: "dev" |
  "prod" }): string` returning the serialized header value, and a constant for
  the report path. Single source of truth; dev and prod call it with different
  `mode`. Lives in `src/lib/` per CLAUDE.md ("Cross-cutting helpers").
- New report route `POST /api/csp-report` (root-level, same-origin so
  `report-uri`/`report-to` resolve) that parses the violation JSON (both the
  legacy `application/csp-report` body and the Reporting-API `application/reports+json`
  array form) and appends a one-line record to a log readable by existing tooling
  (mirror the client-debug-log mechanism; do not echo to stdout per the
  noisy-output rule).
- Doctest `test/lib/csp.doctest.md`: assert both modes contain `report-uri
  /api/csp-report`, `frame-src 'self' https://www.youtube-nocookie.com`, and the
  Deepgram/OpenAI `connect-src` entries; assert prod `script-src` is `'self'
  'unsafe-eval'` and NOT `'unsafe-inline'`; assert dev `script-src` additionally
  contains `'unsafe-inline'`. This encodes the done-when (and pins the report
  directive so it can't be silently dropped — codex's top finding).

### Chunk 2 — wire prod (Report-Only) via the onSend hook

- Extend the `onSend` hook at `server-root.ts:25` (or a sibling hook registered
  beside it): if the response already has a `Content-Security-Policy` header
  (frozen pages), leave it; else if `Content-Type` starts with `text/html`, set
  `Content-Security-Policy-Report-Only: buildCspPolicy({mode:"prod"})`. Keyed on
  `text/html` so API/asset/script responses don't get a meaningless CSP and the
  FROZEN_CSP route is untouched.
- Report-Only means **zero breakage risk** on deploy — this is the safe landing.

### Chunk 3 — wire dev via Vite

- `src/frontend/vite.config.ts`: add `server.headers["Content-Security-Policy-Report-Only"]
  = buildCspPolicy({mode:"dev"})` (import from `src/lib/csp.ts`). Report-Only in
  dev too, so Vite's own inline bits don't hard-fail HMR while we still see
  violations in the console. The header flows browser-ward through the router
  proxy (`bin/router.ts:706`).

The plan **completes** at the end of Chunk 3: a Report-Only policy live in dev
and prod, plus a working violation sink. **Promotion to enforcing**
(`Content-Security-Policy` instead of `-Report-Only`) is a gated follow-up, not
part of this plan's shipped unit — see Rollout shape.

## Subplans

None. No sub-question here needs its own design step — the directive set is
fully determined by the verified inventory. The one strictness trade-off (p5
requiring `'unsafe-eval'`) is a settled decision, not an open research question
(see Open question 5 for the strict-isolation alternative, deferred).

## Failure modes

**Resolved (was a critical gap):** an enforced `script-src 'self'` *would* break
p5.js figures — verified, not hypothetical: `FigureMount.tsx:63` imports `p5`,
and `node_modules/p5/lib/p5.esm.js` uses `new Function` + `WebAssembly`. The plan
resolves this in the directive set by including `'unsafe-eval'` in prod
`script-src` (a deliberate, scoped relaxation — still blocks inline + foreign
scripts). The remaining *unverified* risk is whether `'unsafe-eval'` is
*sufficient* (vs. some path also needing `'wasm-unsafe-eval'` or a same-origin
worker), and whether box-authored views trip anything else. *Mitigation:* the
plan ships Report-Only (cannot break anything), and promotion to enforcing is
gated on exercising a p5 figure + a three/d3 figure + a sandbox view under
Report-Only and confirming the only `script-src` reports are the expected
`'unsafe-eval'` ones (already permitted), with `'wasm-unsafe-eval'` added only if
a report demands it.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| p5 figure needs more than `'unsafe-eval'` (e.g. `'wasm-unsafe-eval'`) → blocked when enforced | No (gate: exercise a p5 figure under report-only) | Report-Only won't block; promotion gated on report review | Reported via /api/csp-report (once report directives wired) |
| Box-authored view does something even `'self' 'unsafe-eval'` forbids | No | Report-Only + gate | Reported, not silent |
| A real image origin is non-HTTPS (`http:`) and `img-src https:` blocks it | Partial (csp.doctest asserts directives) | `img-src` allows `https:` only; broken img shows the existing `Image` error placeholder | Clear (placeholder + report) |
| FROZEN_CSP accidentally overwritten by the app hook | Yes (add: route doctest asserts frozen response still carries `sandbox` CSP) | Hook yields when a CSP header is already present | Clear (test fails loudly) |
| A new external API added later (e.g. a new STT provider) without updating `connect-src` | No (inherent) | Report-Only in dev surfaces it during development | Reported |
| CSP put on a non-HTML response (script/JSON) and breaks it | Yes (doctest: hook only fires on `text/html`) | Content-Type guard | Clear |
| Report endpoint floods the log under attack/misconfig | No | Append-only line log; rate-not-bounded (accept; see Open question 2) | Could be silent disk growth |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A; CSP is infra, no agent-authored tag/field.
- **Stale ref** — N/A.
- **Two agents touching the same card** — N/A.
- **Hand-edit drift** — **ADDRESSED indirectly:** a boxholder/agent hand-writing
  a markdown image with a non-HTTPS or odd external URL gets the existing
  `Image` error placeholder (`Image.tsx` `ErrorPlaceholder`), not a blank — CSP
  doesn't worsen the failure UX.
- **Fabricated free-form value** — N/A.
- **Validation error UX** — **ADDRESSED:** CSP violations are not card-validation
  errors; they land in the report log and (in dev) the browser console, which is
  where a developer looks, not in an agent's card context.
- **Partial migration / transition state** — **ADDRESSED:** there is no data
  shape change; the only transition is Report-Only → enforcing, which is
  additive (Report-Only header present from Chunk 2, enforcing header added
  later). At no point is the app in a half-broken state.

## NOT in scope

- **Tightening `img-src` to `'self' data: blob:`** (dropping `https:`). Would
  require routing all external markdown images through `/api/proxy-image`
  (`view-url.ts` change) with its own latency/load failure modes. Images are
  low-risk; the script/frame/connect controls are the real win. Deferred.
- **Removing `style-src 'unsafe-inline'`** via nonces/hashes. Vite's prod build
  + React inline styles make this a large audit for marginal gain (style
  inlining is low-risk). Deferred.
- **Adopting `@fastify/helmet` for the broader header suite**
  (`X-Content-Type-Options`, `Referrer-Policy`, HSTS, `X-Frame-Options`). The
  task is a CSP; other headers are a separate hardening pass. Deferred (and see
  Open question 1).
- **A nonce-based strict policy in dev.** Vite injects its own inline bits
  without our nonce; not worth fighting. Dev stays relaxed Report-Only.
- **Promoting to enforcing in this plan's shipped unit.** Gated on real
  Report-Only data (see Rollout). Intentionally a follow-up.
- **Iframe-isolating figures to drop `'unsafe-eval'` from the app `script-src`**
  (Open question 5). The strictest end-state runs p5/three/d3 figure modules
  inside a sandboxed same-origin iframe with its own looser CSP, letting the
  top-level app keep `script-src 'self'` (no eval). That's a real refactor of the
  inline-`import()` figure mount (`FigureMount.tsx`/`FigureView.tsx`) and belongs
  in its own plan. Deferred — but it's the recommended path to reclaim full
  script strictness, not a permanent write-off.

## Open design questions

1. **Hand-rolled `onSend` hook vs `@fastify/helmet`.** *Lean: hand-rolled.* It
   matches the existing `FROZEN_CSP` + CORS-hook precedent, adds no dependency,
   naturally scopes to `text/html`, and yields to the frozen route for free. Helmet
   blankets every response (needs explicit per-route disabling for frozen + puts
   pointless headers on API/asset responses) and pulls in a header suite that's
   out of scope. Counter-argument: helmet gives report-only toggling and nonce
   plumbing if we later want them. (codex review: confirmed the hand-rolled hook
   on `text/html` correctly covers static-served + fallback HTML and leaves
   FROZEN_CSP intact.)
2. **Report endpoint rate-limiting / retention.** *Lean: unbounded append for the
   Report-Only window, then revisit.* The window is short and same-origin; a
   bounded log or sampling can be added if volume is a problem. Open because it's
   a real (if low) disk-growth risk.
3. **Does dev need CSP at all, or prod-only?** *Lean: dev Report-Only.* It catches
   external-origin mistakes during development (the whole point), and Report-Only
   means it can't break HMR. Open in case the console noise proves not worth it.
4. **`report-to` (Reporting API) vs legacy `report-uri`.** *Decided: emit both*,
   with the required `Reporting-Endpoints` companion header for `report-to` (now
   folded into the directive set above), so the report sink actually receives
   violations rather than just lighting up the console.
5. **`'unsafe-eval'` in prod `script-src` vs iframe-isolating figures.** The
   verified p5 requirement forces a choice: (a) accept `script-src 'self'
   'unsafe-eval'` app-wide now (this plan's lean — pragmatic, still blocks inline
   + foreign scripts), or (b) isolate figures in a sandboxed iframe so the app
   keeps `script-src 'self'` (stricter, but a separate refactor — see NOT in
   scope). Given the boxholder's bias toward strict, (b) is the eventual target;
   (a) is the shippable now. **This is the main decision I want the boxholder's
   call on.**

## Knowledge audits

**Skip-with-rationale:** this is purely infrastructural. No box agent authors,
recalls, or reasons about the CSP — it's a server header. There is no
agent-facing concept (no new tag, card shape, or "how you do X" convention) that
a future agent could forget. A `docs/` reference note (below) is the right
altitude, not a knowledge-audit entry.

## Implementation order

1. **Chunk 1** — `src/lib/csp.ts` + `POST /api/csp-report` + `csp.doctest.md`.
   No dependency on the wiring; testable in isolation.
2. **Chunk 2** — prod `onSend` Report-Only wiring + a route doctest asserting
   (a) an HTML response carries the Report-Only header and (b) a `.frozen`
   response still carries the untouched `sandbox` FROZEN_CSP. Depends on Chunk 1.
3. **Chunk 3** — Vite dev `server.headers` Report-Only wiring. Depends on Chunk
   1. Independent of Chunk 2 (could land in either order after Chunk 1).
4. **Chunk 4** — scheduled violation-review routine (closes the loop between
   Report-Only and hardening). Depends on Chunks 1–3 (needs reports flowing).

### Chunk 4 — scheduled CSP-violation review + hardening ratchet

The Report-Only window only pays off if someone actually looks at the reports
and acts. Rather than rely on a human remembering to `curl` the log, schedule it.

- **A recurring routine** (cron-scheduled cloud agent, the `schedule`/routines
  mechanism) that, on each run: reads accumulated CSP reports from BOTH dev and
  prod sinks (the dev sink is the same `/api/csp-report` route, written while
  developing; prod is the deployed one), dedupes by `violated-directive` +
  `blocked-uri`, and produces a short summary: *which directives fired, which
  origins were blocked, how many times, first/last seen.*
- **The routine arranges context; it does not auto-flip to enforcing.** Per the
  box principle *"arrange context, don't automate judgment"* — the routine's
  output is a digest that says one of: (a) "violations present — here's what,
  with a proposed allowlist edit or a real-bug flag"; or (b) "zero violations
  over the window — safe to harden: here's the one-line flip from
  `-Report-Only` to enforcing." A human/agent confirms the flip; the routine
  never edits the policy itself. This keeps the irreversible-ish prod hardening a
  reviewed decision, not a silent cron side effect.
- **The hardening ratchet.** Once a directive class has been clean for the
  window, that class can be promoted. The natural ratchet order (loosest-value
  first, so each step is low-risk): flip the *enforcing* header on with the
  already-correct directives, keeping `script-src 'self' 'unsafe-eval'`; then, if
  Open question 5 is resolved toward figure-isolation, tighten `script-src` to
  drop `'unsafe-eval'`; then revisit `img-src https:`. Each ratchet step is its
  own small reviewed commit informed by the routine's digest.
- **Open sub-question:** where the digest lands — a box question card, a feedback
  item, or a chat ping to the boxholder. *Lean: a box question card* so it shows
  up in the normal review surface with the proposed diff attached. Settle when
  Chunk 4 is designed in detail.

This chunk makes "harden if there are no violations" an actual standing process
rather than a one-time manual gate that gets forgotten.

## Rollout shape

- **Test posture.** Two doctests anchor the done-when: `csp.doctest.md` (the
  directive set is correct per mode) and a webapp route doctest (the hook sets
  Report-Only on HTML and never clobbers FROZEN_CSP). These cover the
  Failure-modes "Test exists?" gaps for the hook itself. The figure/box-view
  script-src risk isn't doctestable (headless CSP enforcement of third-party
  runtimes), so it's covered by the **Chunk 4 routine** reading real
  `/api/csp-report` data rather than a one-off manual gate.
- **Ships as one unit:** Report-Only policy in dev + prod + report sink. This is
  complete and non-breaking on its own — Report-Only cannot block any resource.
- **Promotion to enforcing (gated follow-up, NOT this plan's ship):** driven by
  the Chunk 4 routine's digest. Once the Report-Only header has been live in prod
  across real traffic (chat with images, dictation/realtime voice, a p5 figure, a
  sandbox view, a logged-in avatar) with **zero** unexpected violations — flip the
  prod header name from `Content-Security-Policy-Report-Only` to
  `Content-Security-Policy` (adding `'wasm-unsafe-eval'` to `script-src` only if a
  figure reported needing it beyond `'unsafe-eval'`). One small reviewed commit,
  proposed by the routine, confirmed by a human/agent.
- **No data migration** — this changes no on-disk shape.
- **Docs:** add a short present-tense reference note (e.g.
  `docs/content-security-policy.md`) describing the policy, the dev/prod split,
  the report endpoint, and the "how to add a new external origin" procedure, so
  the next person who adds an external API knows to update `connect-src`.
</content>
</invoke>
