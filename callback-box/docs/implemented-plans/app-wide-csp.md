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
- `callback-box/code-style.md:` no `any`, max 2 positional params, custom error
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
  and our own code. The bundled figure runtimes are mostly clean: classic
  `three.module.js` and `d3` have no eval/WASM; `p5` 2.3.0 has 4 eval/WASM sites
  but all inside opt-in features (Strands JS shaders, JS filter shaders, HarfBuzz
  3D-text), none at module load. So strict `'self'` works unless a specific
  figure uses those advanced p5 APIs — which Report-Only surfaces per-figure,
  rather than us pre-loosening the whole policy.
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

**Prod adds (strict):**
```
script-src  'self';
style-src   'self' 'unsafe-inline';
```
- `script-src 'self'`: all dynamic-`import()` targets are same-origin compiled
  modules (`src/frontend/src/components/ViewRenderer.tsx:191`,
  `src/frontend/src/components/FigureView.tsx:73`); no inline script in
  `index.html` (only `<script type="module" src="/src/main.tsx">`, rewritten to
  a hashed asset by `vite build`).
- **Figure runtimes are mostly clean; p5's `eval`/WASM is opt-in and lazy.**
  `FigureMount.tsx:63-70` imports `p5`/`three`/`d3` on demand. Verified:
  `import("three")` resolves to the classic `three.module.js` (0 eval/WASM — the
  WebGPU builds have it but aren't imported); `d3` is clean. `p5` 2.3.0 contains
  `new Function`/`WebAssembly` at exactly 4 sites
  (`node_modules/p5/lib/p5.esm.js:61836,62351,120146,134111`), but **all four are
  inside opt-in feature methods, not module top-level**: the "Strands"
  JS-shader-hook system, `loadFilterShader` with JS (not GLSL), and HarfBuzz
  text-shaping for 3D text (`textToModel`). A normal 2D/3D sketch never triggers
  them. So strict `script-src 'self'` works for the vast majority of figures;
  only a figure using those specific advanced APIs would be blocked. **Report-Only
  reveals which real figures (if any) hit them** — the right per-figure response
  is to iframe-isolate *that* figure (Open question 5), not to weaken the
  app-wide policy. (`new Function` needs `'unsafe-eval'`; HarfBuzz WASM needs
  `'wasm-unsafe-eval'` — noted so the routine can map a report to the right
  narrow token if isolation is declined for a given figure.)
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
  Deepgram/OpenAI `connect-src` entries; assert prod `script-src` is exactly
  `'self'` (no `'unsafe-eval'`/`'unsafe-inline'`); assert dev `script-src`
  additionally contains `'unsafe-inline' 'unsafe-eval'`. This encodes the done-when (and pins the report
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
fully determined by the verified inventory. The figure-runtime strictness
question is resolved by shipping strict `script-src 'self'` and letting
Report-Only identify the rare advanced-p5 figure that needs isolation (Open
question 5).

## Failure modes

**Bounded (was framed as a critical gap):** an enforced `script-src 'self'`
breaks only the narrow set of figures using p5's opt-in eval/WASM features
(Strands shaders, JS filter shaders, HarfBuzz 3D-text — verified the only sites
in `p5.esm.js`; `three`-classic and `d3` are clean). A basic 2D/3D figure, a
sandbox view, and all app code run fine under `'self'`. *Mitigation:* the plan
ships Report-Only (cannot break anything); the Chunk 4 routine reads real reports
and, per figure that trips it, the response is iframe-isolation (Open question 5)
or — if isolation is declined for that figure — a scoped `'unsafe-eval'` /
`'wasm-unsafe-eval'`, never an app-wide loosening. A broken figure would
otherwise be a silent blank pane; the report makes it visible.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A figure uses p5 Strands/filter-shader/3D-text → `script-src 'self'` blocks its `new Function`/WASM | No (gate: exercise such a figure under report-only) | Report-Only won't block; routine surfaces it; isolate or scope-exempt that figure | Reported via /api/csp-report |
| Box-authored view does something `script-src 'self'` forbids | No | Report-Only + routine | Reported, not silent |
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
- **Iframe-isolating advanced-p5 figures** (Open question 5). The app ships
  strict `script-src 'self'`; if Report-Only shows a real figure using p5
  Strands/filter-shaders/3D-text (which need `eval`/WASM), the fix is to run
  *that* figure's module inside a sandboxed same-origin iframe with its own looser
  CSP — a refactor of the inline-`import()` figure mount
  (`FigureMount.tsx`/`FigureView.tsx`) that belongs in its own plan. Deferred and
  only triggered on demand — most figures need nothing here.

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
5. **Handling a figure that trips strict `script-src 'self'`.** *Decided toward
   strict:* ship `'self'` (no eval); p5's eval/WASM is opt-in (Strands/filter
   shaders, 3D-text) and most figures never hit it. If Report-Only flags a real
   advanced-p5 figure, the response is to iframe-isolate that figure (see NOT in
   scope), falling back to a scoped `'unsafe-eval'`/`'wasm-unsafe-eval'` only if
   isolation is declined — never an app-wide loosening. Matches the bias toward
   strict at near-zero up-front cost. Was previously framed as needing app-wide
   `'unsafe-eval'`; corrected after confirming the eval paths are lazy.
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
  window, that class can be promoted. The natural ratchet order (low-risk first):
  flip the *enforcing* header on with the full strict directive set (including
  `script-src 'self'`); if a real advanced-p5 figure surfaces, isolate it (Open
  question 5) rather than stall the flip; then, as a later step, revisit
  tightening `img-src https:` toward proxy-only. Each ratchet step is its own
  small reviewed commit informed by the routine's digest.
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
  `Content-Security-Policy`, keeping `script-src 'self'`. If a real advanced-p5
  figure reported a `script-src` violation, isolate that figure first (Open
  question 5) rather than loosen the policy. One small reviewed commit, proposed
  by the routine, confirmed by a human/agent (the decided "propose, human
  confirms" mode).
- **No data migration** — this changes no on-disk shape.
- **Docs:** add a short present-tense reference note (e.g.
  `docs/content-security-policy.md`) describing the policy, the dev/prod split,
  the report endpoint, and the "how to add a new external origin" procedure, so
  the next person who adds an external API knows to update `connect-src`.
</content>
</invoke>
