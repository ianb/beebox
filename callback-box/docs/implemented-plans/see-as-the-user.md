# See as the user — screenshots of the live box UI for the chat agent

**Status:** implemented 2026-07 — both entry points (composer "Send
screenshot" and agent-initiated `cb chat screenshot`) shipped; see
`see-as-the-user.review.md` for the incorporated cross-model review.

Give the chat agent a way to see what the user currently sees in the box UI —
true rendered pixels, not a DOM reconstruction — in two entry points: a
user-initiated "Send screenshot" item in the composer's Add menu, and an
agent-initiated `cb chat screenshot` command that round-trips through the
user's own browser tab. Capture at agent initiative is confined to enabled
box pages; nothing outside the box is ever captured at the agent's request.

> Revised 2026-07-11 after a cross-model (Codex, gpt-5.6-sol) review; see
> `see-as-the-user.review.md` (scratch copy: `scratch/codex-out.md`). The
> review's material findings — reuse of the last-audio rendezvous, session
> identity, the two-phase ack, path-scoped extension authorization, the
> active-tab race, and cutting in-thread persistence from v1 — are
> incorporated below.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — traced by number below.
  Most load-bearing here: **#3 Validate at boundaries** (the
  screenshot-response endpoint accepts bytes from the browser), **#4
  Resilient AND never silent** (every degraded capture path must say what it
  is; a failed capture must never be papered over with a lower-fidelity
  substitute), **#5 Failure paths visible in signatures** (the cb command's
  outcomes are enumerable), **#8 One way to do each thing** (one capture
  pipeline shared by both entry points; one pending-request primitive shared
  with last-audio), **#12 The maintainer is usually an agent**
  (discoverability is part of the design).
- `callback-box/CLAUDE.md` — validation contract; "don't add features beyond
  what the task requires" (bounds the NOT-in-scope list).
- `callback-box/code-style.md` — mechanical rules (no default parameters,
  max 2 positional params, no `any`).
- Precedents: **`cb chat get-last-audio`** (the shipped CLI long-poll →
  transient bus event → browser answer rendezvous — the direct template for
  Track B); `cb chat self-note` / `whats-changed` for CLI→live-server
  commands; `ShareLocationMenuItem` for a self-contained Add-menu item; the
  clerk's per-box enable flow (`callback-clerk/src/platform/enable-box.ts`)
  for extension permission scoping.
- A boxholder-stated boundary (2026-07-11 design conversation): **no
  screenshotting outside the box at agent initiative.** Enforced by the
  extension refusing non-enabled pages plus an active-tab check at capture
  time; see Track C for the small residual race this leaves and why it is
  accepted.

## What already exists

Reused (nothing here is rebuilt):

- **The last-audio rendezvous — the template for Track B.**
  `src/core/last-audio-pending.ts:1-13` implements exactly the needed
  primitive: a CLI long-poll parks a promise under a requestId, a transient
  bus event broadcasts the id to connected chat tabs, tabs answer with a
  payload (`fulfill`, first-wins) or "I have nothing" (`reportNone`, which
  starts a grace window), and silence times out. The routes
  (`src/webapp/routes/chat-last-audio-routes.ts`) carry the browser's answer
  as multipart, and the whole loop is doctested
  (`test/core/last-audio.doctest.md`). Track B **generalizes this primitive**
  (rename/extract a shared pending-request module with a type parameter for
  the fulfillment payload) rather than writing a parallel copy — principle
  #8. The bus event precedent is `chat-last-audio-request { requestId }`
  (`src/core/event-bus-schemas.ts`).
- **UI-state context on every chat send.** `sendBodySchema` carries
  `openCard`, `cardActivity`, `cardState` (`src/webapp/routes/chat-helpers.ts:65-78`),
  serialized into the `<chat-app>` snapshot
  (`src/core/chat/features.ts:152-183`; spec section in
  `src/core/chat/session/prompts.ts:92`). Chat `images` ride the send body
  separately (`chat-helpers.ts:46`) and become model content, not snapshot
  attributes. The screenshot is the *visual complement* to this state read —
  the plan does not touch this machinery.
- **CLI→live-server command pattern.** `cb chat self-note` posts to
  `${CB_SERVER_URL}/${CB_BOX_NAME}/api/chat/self-note` with
  `loopbackHeaders()` (`src/cli/commands/chat.ts:33-46,55-56`). The agent
  subprocess env provides `CB_SERVER_URL`/`CB_BOX_NAME` but **no chat
  session id** (`src/core/script-env.ts:83-101`) — a gap this plan closes
  (Track B) rather than working around with "most-active session" guessing.
- **Typed event bus with WS subscription.** SQLite-backed bus bridged to
  tRPC subscriptions (`src/webapp/trpc/routers/events.ts:53-60`), typed via
  zod schemas in `src/core/event-bus-schemas.ts` (adding an event means a
  schema entry + `EVENT_SCHEMA_GENERATION` bump,
  `event-bus-schemas.ts:76`); transience is chosen at the emit site
  (`emitTransient`, `src/core/event-bus.ts:173`). Note the bridge may drop
  transient events for a slow/backgrounded subscriber (`events.ts:78-94`) —
  the Track B protocol is designed so a dropped request degrades to
  `no-client`, never to a hang.
- **Composer Add menu.** `InteractiveChat-composer.tsx:190-216` already
  hosts capture mode / "Attach file…" / `ShareLocationMenuItem`. "Send
  screenshot…" is one more `MenuItem`.
- **Image attachment pipeline with downscaling.** Pasted/dropped images flow
  through `processImageBlob` (`frontend/src/lib/image-paste.ts`), which
  already downscales to a 1920px longest side at quality 0.85
  (`image-paste.ts:19-23`), then `editor.addImage` → `[imageN]` tokens →
  `images` on the send body, validated server-side by `validateImages`
  (25MB cap, `chat-helpers.ts:102,164`). Track A adds **no resizing of its
  own** — the captured frame enters this pipeline as just another blob.
- **Clerk per-box enablement.** The extension identifies boxes by absolute
  root URL *including path* (`callback-clerk/src/domain/config.ts:1-16`) and
  requests per-origin host permission at enable time
  (`src/platform/enable-box.ts`). `chrome.tabs.captureVisibleTab` requires
  host permission for the tab's URL — granted for enabled boxes, so **no new
  manifest permission is needed**.
- **Box-detection meta tag.** The frontend emits
  `<meta name="callback-box">` and the clerk verifies the claimed `boxUrl`
  shares the tab's origin (`src/domain/box-identity.ts:36`). This proves
  origin consistency only — the Track C trust model below is explicit about
  what it does not prove.

Explicitly *not* reused:

- `bin/browse` / agent-browser — drives its own headless Chromium; answers
  "what would this page look like," not "what does the user see." (Box-scoped
  variant: separate open issue,
  `issues/features/2026-06-12-agent-browser-scoped-to-box.md`.)
- The clerk's `freeze-page.ts` DOM serialization — see Prior art; DOM
  reconstruction is disqualified for this feature.
- `forSession` (`InteractiveChat-ws.ts:46-48`) treats a null on either side
  as a wildcard — correct for chat events, wrong for capture targeting (an
  idle `?session=new` tab must not answer an established session's request).
  Capture requests match on **exact** session id.

## Prior art (external)

Researched 2026-07-11 (three web-research passes; key findings):

- **In-page DOM rasterization is disqualified.** html2canvas is abandoned
  (last release 2022-01, 1,052 open issues); the foreignObject family
  (html-to-image, SnapDOM) architecturally loses canvas/WebGL buffers,
  nested scroll, `:hover`, animation state — and *repairs* the very
  breakage the user is asking about (fonts re-race, animations restart).
  Browserbase's postmortem on rrweb-based recording names the killer
  property: DOM replay is "subtly wrong while looking plausible"
  (https://www.browserbase.com/blog/session-recordings). BugHerd's
  engineering blog rejected html2canvas as "a less-than-perfect
  interpretation"
  (https://bugherd.com/blog/screenshots-without-a-browser-extension);
  among surveyed bug-report vendors (Marker.io, Usersnap, Jam, BugHerd),
  none uses in-page DOM rasterization as its primary capture — Sentry User
  Feedback's widget is the notable exception and its issue tracker shows
  the classic artifacts.
- **Sentry's screenshot-on-error is the getDisplayMedia precedent**:
  `getDisplayMedia({preferCurrentTab: true, selfBrowserSurface:
  'include'})` → hidden `<video>` → one frame to canvas → `toBlob`
  (`getsentry/sentry-javascript`,
  `packages/feedback/src/screenshot/useTakeScreenshot.tsx` as of 2026-07;
  path may drift — re-verify at implementation time). Requires a user
  gesture and shows the native share picker every time; a "sharing this
  tab" infobar shows while the stream is open (we close it immediately
  after the grab).
- **`chrome.tabs.captureVisibleTab`**: compositor-derived pixels of the
  window's *currently active tab* — there is no tabId parameter
  (https://developer.chrome.com/docs/extensions/reference/api/tabs). Hard
  limit `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2`. Developer reports
  (not documented guarantees) describe blank frames right after tab
  switches and unreliable results for minimized/occluded windows
  (https://groups.google.com/a/chromium.org/g/chromium-extensions/c/9nFO4NTLDoA)
  — treat "capture may be blank or stale when the window isn't visibly
  composited" as an empirical hazard to verify during implementation, and
  measure returned image dimensions rather than assuming a
  devicePixelRatio multiple. Needs `activeTab` **or** host permission for
  the tab URL — the clerk's enable flow grants the latter.
- **`chrome.debugger` + CDP rejected**: can capture background tabs and
  full-page, but attaching shows a persistent "started debugging this
  browser" infobar with a user-facing Cancel; unsuppressible for normal
  installs (https://github.com/anthropics/claude-code/issues/69287).
- **MV3 service workers terminate unpredictably and lose all global
  state**
  (https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
  — the Track C background holds **no cross-message state**: no queues, no
  in-flight maps; each capture request is handled and answered within one
  message turn, and overload is answered `busy` for the page to handle.
- **Consent grammar from cobrowsing vendors** (Cobrowse.io: default consent
  dialog, escalation dialogs, persistent visual indicator, revoke-anytime —
  https://docs.cobrowse.io/sdk-features/customize-the-interface/user-consent-dialog).
  Adopted as: explicit popup on the no-extension path and a visible in-chat
  indicator for every agent-initiated capture.
- **First-party copilots read their own data model** (Notion, Figma,
  Linear, M365) — confirms the existing `<chat-app>` snapshot is the right
  primary channel and the screenshot is a complement for the one thing
  state can't express. AI assistants that need pixels pair them with
  structured state (Claude in Chrome does DOM + screenshots) — matching
  this plan's shape.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track A — plus-menu "Send screenshot…" (getDisplayMedia, no extension)

**What.** A "Send screenshot…" `MenuItem` in the composer Add menu
(`InteractiveChat-composer.tsx:190-216`). Click → Sentry-style one-frame
grab: `getDisplayMedia({video: true, preferCurrentTab: true,
selfBrowserSurface: 'include'})`, pipe to a hidden `<video>`, wait for
`loadedmetadata` **and** a decoded frame with non-zero
`videoWidth`/`videoHeight` (via `requestVideoFrameCallback`, falling back
to a rAF tick) before drawing to canvas — a zero-sized or undecoded first
frame must fail, not silently produce a blank PNG — then
`canvas.toBlob('image/png')` and stop all tracks immediately. The blob
enters the existing attachment pipeline (`processImageBlob` →
`editor.addImage` → `[imageN]` token) unmodified; that pipeline already
downscales to 1920px (`image-paste.ts:19`). The screenshot path surfaces
`processImageBlob` failure as a visible toast — the current
console-only logging (`InteractiveChat-attachments.ts:98-104`) is
acceptable for paste (the user sees the tile never appear where they just
acted) but not for a flow that ends in a picker hand-off (principle #4).

**Why this needs to change.** Today the only way to show the agent what
the screen looks like is an OS screenshot pasted by hand. The friction is
high enough that it rarely happens, and the agent discusses custom views
blind.

**Direction / shape.** New module
`frontend/src/components/chat/screenshot-capture.ts` exporting
`captureTabScreenshot(): Promise<CaptureOutcome>` where

```ts
type CaptureOutcome =
  | { kind: "image"; blob: Blob; viewport: { cssWidth: number; cssHeight: number; dpr: number } }
  | { kind: "declined" }        // user dismissed the picker
  | { kind: "unsupported" }     // no getDisplayMedia (mobile Safari, etc.)
  | { kind: "error"; message: string };
```

The menu item is hidden when `kind: "unsupported"` would be the result
(feature-detect `navigator.mediaDevices?.getDisplayMedia` at render).

The picker technically lets the user choose a different tab or the whole
screen. That is the user's deliberate act — equivalent in kind to pasting
an OS screenshot, which already exists — so no restriction is attempted.
The boxholder's "no capture outside the box" boundary binds the
*agent-initiated* path (Tracks B/C), not the user's own hand.

**First implementation chunk.** `screenshot-capture.ts` + the menu item +
attachment wiring + the failure toast. One commit; exercisable end-to-end
immediately.

### Track B — agent-initiated `cb chat screenshot` (rendezvous + consent popup fallback)

**What.** A new `cb chat screenshot` subcommand the chat agent can run
mid-turn. It long-polls the live server; the server broadcasts a transient
bus event; the browser client holding that exact chat session acks, then
captures (Track C's extension relay when available, else a consent popup
gating the same `captureTabScreenshot()` from Track A) and answers with
the PNG; the command prints the saved file path; the agent Reads it.

**Why this needs to change.** "Send screenshot" covers "look at this"; it
doesn't cover the agent asking "show me what you see" mid-conversation —
e.g. while debugging a custom view it just wrote.

**Direction / shape.**

- **Session identity (prerequisite).** `cb chat screenshot` requires the
  current SDK session id — the exact id the frontend matches the bus event
  against. It resolves via `resolveChatSessionId()`: `--session`, then
  `CB_CHAT_SESSION_ID` (set at spawn for *resumed* sessions), then a
  backend-written per-subprocess id file named by `CB_CHAT_SESSION_ID_FILE`,
  with a brief first-turn poll; errors out if none resolves. No
  "most-active session" fallback — guessing can target a different live
  conversation. **Implementation note (superseding the original B0
  sketch):** baking the id into the spawn env only works for resumes,
  because (a) a new conversation's SDK id is assigned *after* spawn and the
  long-lived subprocess env can't be repaired, and (b) chat prewarm's warm
  pool is env-blind, so a warm-consumed subprocess keeps the probe's env.
  So for new sessions the *backend* (which mints the subprocess) allocates
  a unique id-file path at spawn and writes the SDK id into it the instant
  `system/init` streams; the CLI reads that file. Per-subprocess file =
  each concurrent session sees its own id (`core/chat/session/session-id-file.ts`).
  `cb chat self-note`/`whats-changed` may adopt this resolver later — out
  of scope here.
- **Pending-request primitive.** Generalize `last-audio-pending.ts` into a
  shared `src/core/pending-browser-request.ts` parameterized on the
  fulfillment payload; last-audio becomes its first consumer (mechanical
  refactor, doctests keep passing), screenshots its second. Semantics are
  unchanged: first `fulfill` wins; `reportNone`-style answers start a
  grace window; silence times out. One addition: an **ack** phase —
  clients that received the request and matched the session immediately
  POST an ack; the pending entry resolves `no-client` if no ack arrives
  within 2s. This separates the outcomes honestly (finding 3): *no ack* →
  `no-client` (tab closed, event dropped by the WS bridge, stale frontend,
  user on phone); *acked but never answered* → `timeout` (user ignoring
  the popup).
- **Routes** (`src/webapp/routes/chat-screenshot-routes.ts`, shaped like
  `chat-last-audio-routes.ts`):
  - `POST /api/chat/screenshot/request` — loopback-only long-poll. Body
    `{session, timeoutMs}`. Creates the pending entry, emits transient bus
    event `screenshot-request {requestId, session, expiresAt}` (schema in
    `event-bus-schemas.ts` + `EVENT_SCHEMA_GENERATION` bump). Resolves
    with the image (written to `tmp/screenshot-<requestId>.png` under the
    box root, the same 7-day-swept tmp area the agent already knows,
    `prompts.ts:66`) or the outcome. **Cancels the pending entry on
    request abort** (CLI killed / connection dropped) so a consent popup
    never outlives its requester beyond the event's `expiresAt`.
  - `POST /api/chat/screenshot/:requestId` — browser-facing (session-cookie
    auth). Multipart PNG + fields (`viewport`, `fidelity:
    "extension" | "displaymedia"`), or JSON `{ack: true}` /
    `{declined: true}` / `{failed: "<reason>"}`. Boundary validation:
    PNG magic bytes, size cap shared with `MAX_IMAGE_BYTES`
    (`chat-helpers.ts:102`). Unknown/settled requestId → 404 (matching
    last-audio's contract).
- **Command** (`src/cli/commands/chat.ts`, alongside self-note):
  `cb chat screenshot [--session <id>] [--timeout <seconds>]` (default 45
  — long enough for a human to answer the popup). Prints exactly one of:
  - the absolute path of the saved image + a `fidelity:` line (exit 0),
  - `declined: the user declined the screenshot request` (exit 1),
  - `no-client: no browser is attached to this chat session` (exit 1),
  - `timeout: the request was seen but not answered within <n>s` (exit 1),
  - `failed: <reason from the browser>` (exit 1),
  - `error: <network/server failure>` (exit 1 — e.g. server restart
    severing the long-poll; reported as what it is, not mislabeled
    `timeout`).
  Enumerable outcomes, visible in the command's contract (principle #5).
- **Frontend handler** (in `InteractiveChat-ws.ts`'s event dispatch): on
  `screenshot-request` with **exact** session match (not `forSession` —
  see What already exists): ack immediately, then
  1. if the clerk relay is present (Track C handshake): request an
     extension capture; on success upload with `fidelity: "extension"`;
  2. else, or on any relay failure: show a consent popup — "The agent
     wants to see this screen" with **Share screenshot** / **Decline**.
     Share is the user gesture gating `captureTabScreenshot()`; upload
     with `fidelity: "displaymedia"`. Decline posts `{declined: true}`.
     The popup auto-dismisses at the event's `expiresAt`.
  If several same-session tabs are open, all ack and all may answer;
  first-wins resolves it (the last-audio multi-tab contract,
  `last-audio.doctest.md`: "the normal multi-tab outcome"). Concurrent
  requests queue popups one at a time.
- **Visibility.** Every agent-initiated capture renders a client-side
  indicator row in the chat ("📸 screenshot shared with the agent", with
  the thumbnail) on the answering client. This is ephemeral UI, not a
  transcript write — **persistent in-thread posting is cut from v1**
  (finding 5: `/chat/send` starts or queues an agent turn,
  `chat-send-routes.ts:249-257`, so posting mid-turn would enqueue a
  spurious user turn; direct transcript mutation is a concurrency-sensitive
  feature of its own). The honesty property this loses is partly retained:
  the image lives in flat `tmp/screenshot-<id>.png` files (swept with the rest of `tmp/`) where the user can open it, and
  the indicator shows the thumbnail at capture time.
- **Discoverability**: one line in `src/core/agent-guide/commands.ts`
  (`keyCommandsSection()`); the generated reference picks the command up
  from Commander (`src/core/docs-gen/cb-commands.ts`); a sentence in the
  chat system prompt near the `<chat-app>` spec
  (`src/core/chat/session/prompts.ts:92`) saying screenshots exist and
  when to reach for one.

**Vocabulary lock-ins.** Command name `cb chat screenshot` (not "capture"
— `src/core/capture/` is the voice-memo pipeline). Bus event
`screenshot-request`. Outcome words `declined` / `no-client` / `timeout` /
`failed` / `error`. Env var `CB_CHAT_SESSION_ID`. Fidelity values
`extension` / `displaymedia`.

**First implementation chunk.** Extract `pending-browser-request.ts` from
last-audio (both consumers, doctests green) + `CB_CHAT_SESSION_ID`
plumbing. Second chunk: routes + bus event + command, frontend stubbed to
ack-then-decline — testable end-to-end without UI.

### Track C — clerk relay (silent captureVisibleTab for enabled boxes)

**What.** The clerk gains a page↔extension relay so an enabled box's
frontend can ask for a real `captureVisibleTab` screenshot without a
picker. The extension side is a capability oracle: it never talks to the
server and holds no channel or state of its own.

**Why this needs to change.** The consent popup works but costs a click
and a native picker every time. "Extension if possible, picker if
necessary" (boxholder decision, 2026-07-11) is the intended steady state.

**Trust model (explicit).** Within an enabled box page, *any same-origin
script* — including custom views, which render unsandboxed in the host
React tree — can reach the relay. That is accepted: the boxholder's
boundary is box vs. non-box, not intra-box (in-box content is already
fully visible to the agent). What the relay must prevent is (a) non-box
pages capturing anything and (b) a box page causing capture of a
*different* tab. The meta-tag spoof guard (`box-identity.ts:36`) proves
origin consistency only; authorization therefore rests on the extension's
own enabled-box list, not on anything the page asserts.

**Direction / shape.**

- **Content script** `box-relay.content.ts`, registered dynamically via
  `chrome.scripting.registerContentScripts` at enable time with **match
  patterns built from the full `boxUrl` including path**
  (`config.ts:5-8` — boxes are identified by absolute root URL; on the
  dev router and any multi-box host, many boxes share an origin, so
  origin-level matching would over-grant; finding 1b). Registrations
  persist across restarts; enable/disable keeps them in sync. The script
  announces itself (`window.postMessage`, `callback-clerk-relay` marker)
  for feature detection and forwards capture requests to the background,
  carrying a per-request correlation id; strict `event.origin` +
  source-window checks both directions.
- **Background** (`entrypoints/background.ts`), per request and stateless
  across requests (MV3 workers terminate unpredictably and lose globals —
  no queue, no throttle state; finding 6b):
  1. verify `sender.tab.url` is under an enabled box's `boxUrl` (exact
     URL-prefix match against the stored enabled-box list, not origin);
  2. verify the sender tab **is the active tab of its window**
     (`chrome.tabs.query({active: true, windowId})`) — else respond
     `not-capturable`;
  3. `chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"})`;
  4. re-verify after capture that the window's active tab is still the
     sender tab — if not, discard the image and respond `not-capturable`.
  If the API's 2/sec quota trips, catch the error and respond `busy`; the
  page falls back rather than the worker queueing.

  **Known residual race (accepted, documented):** `captureVisibleTab` is
  window-scoped with no tabId parameter, so a tab switch *during* the
  capture call can put another tab's pixels in the result. The
  before/after active-tab checks shrink the window to milliseconds but
  cannot close it — the earlier draft's "structurally impossible" claim
  was wrong (finding 1a). Residual risk assessed as acceptable: the
  captured image goes to this box's own agent and is visible to the user
  in the indicator; the failure requires the user themselves switching
  tabs mid-request; and the discard-on-mismatch check catches every case
  where the switch settles before the post-check runs.
- **Frontend**: the Track B handler prefers the relay when the
  announcement was seen; any relay failure (`not-capturable`, `busy`,
  relay timeout ≤ 3s, extension uninstalled mid-session) falls back to
  the consent popup — degraded but never silent (principle #4), and
  `fidelity` in the upload tells the agent which path produced the image.
- **Image size**: the data URL is decoded and passed through the same
  1920px downscale used by the attachment pipeline (shared helper with
  `image-paste.ts`) before upload.

**First implementation chunk.** Content script + background handler +
handshake, exercised against a worktree box in a headed
`BROWSE_CLERK=1 bin/browse` session before the frontend wiring lands (no
MV3 test harness exists; manual verification, documented in the clerk
CLAUDE.md).

### Track D — agent-facing docs + knowledge audit

The `keyCommandsSection()` line, the system-prompt sentence, regenerate
`docs/generated/cb-commands.md`, and a knowledge-audit entry. Small, but
it is the difference between the feature existing and the agent knowing it
exists (principle #12; CLAUDE.md: "undiscoverable infrastructure reads as
not existing").

## Failure modes

**Accepted risk 1 (documented above):** the captureVisibleTab active-tab
race — milliseconds wide after the before/after checks; consequences
bounded to the user's own box agent seeing the user's own other tab, with
the indicator making it visible.

**Accepted risk 2:** a stale compositor frame from an occluded (not
minimized) window may be captured with no error signal — empirical Chrome
behavior with no programmatic detection. Mitigated by the indicator
thumbnail (the user is looking at the real screen and catches staleness);
forcing the popup always would defeat Track C's purpose.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| User dismisses the getDisplayMedia picker (Track A) | planned (unit test of `CaptureOutcome` mapping from a rejected promise) | `kind: "declined"`, silent no-op, no attachment (cancelling is not an error; matches the Direction text) | clear |
| First video frame undecoded / zero-sized (Track A) | planned (unit test with a stubbed track) | wait for decoded non-zero frame; timeout → `kind: "error"` | clear |
| `processImageBlob` fails after a successful grab | planned (unit test) | screenshot path shows a toast (paste path keeps console-only) | clear |
| `getDisplayMedia` unsupported (mobile) | planned (feature-detect test) | menu item hidden; Track B popup path answers `{failed: "unsupported-client"}` | clear |
| No browser client attached / bus drops the transient event / stale frontend | planned (doctest: request with no ack) | no ack within 2s → `no-client` | clear |
| User ignores the consent popup | planned (doctest: ack then silence) | acked-but-unanswered → `timeout`; popup auto-dismisses at `expiresAt` | clear |
| CLI killed mid-request | planned (doctest: abort cancels pending) | request-abort cancels the entry; late answers get 404; popup dies at `expiresAt` | clear |
| Server restart with pending request | not planned (accepted) | long-poll severed → CLI reports `error: <network failure>` (not `timeout`) | clear |
| Replayed request after WS reconnect | planned (schema/emit-site test asserting `emitTransient`) | transient events don't replay; frontend additionally ignores requests past `expiresAt`; answers to settled ids get 404 | clear |
| Two tabs answer the same request | covered by shared primitive (existing last-audio doctest, "second: false") | first-wins; requestId consumed | clear |
| Relay present but tab not active in its window | manual (MV3, no harness) | `not-capturable` → popup fallback | clear |
| Tab switch during the capture call | manual | post-capture active-tab re-check discards mismatches; residual ms-wide race accepted (above) | documented |
| Relay message from a non-box page | manual + code review | content script registered only on enabled box-URL match patterns; background re-verifies sender URL against the enabled list | clear (refused) |
| captureVisibleTab quota (2/sec) exceeded | planned (clerk unit test of the error mapping) | API error caught → `busy` → popup fallback; no worker-side queue | clear |
| MV3 worker terminated mid-request | manual | worker is stateless; page-side 3s relay timeout → popup fallback | clear |
| Upload exceeds size cap / not a PNG | planned (route validation doctest) | 400 at the boundary; frontend answers `{failed: <reason>}` | clear |
| Extension updated/uninstalled mid-session | manual | relay timeout → popup fallback | clear |

## Agent-flow / user-flow edge cases

- **Wrong tool for the question** (screenshot when `whats-changed` or
  reading view source was right): ADDRESSED — the system-prompt sentence
  (Track D) frames screenshots as for *visual/layout* questions, alongside
  the existing "hints, not assertions" framing (`prompts.ts:92`).
- **Stale ref** (screenshot shows a card that has since changed):
  ADDRESSED — capture time is in the command output; `whats-changed`
  remains ground truth for content.
- **Two agents / two requests concurrently**: ADDRESSED — independent
  requestIds; popups queue one at a time; relay is stateless per request.
- **Hand-edit drift**: not applicable — no card format introduced; the
  only persisted artifacts are PNGs under flat `tmp/screenshot-<id>.png` files (swept with the rest of `tmp/`) (7-day sweep).
- **Fabricated free-form value** (agent claims it saw something it
  didn't): PARTIALLY ADDRESSED — the indicator thumbnail on the answering
  client and the tmp file let the user check what the agent saw; full
  in-thread persistence is deferred (NOT in scope).
- **Validation error UX**: ADDRESSED — every cb-command failure prints a
  one-line prefixed actionable message (matching `cb chat self-note:`
  style, `chat.ts:59-68`).
- **Partial rollout state** (server updated, frontend tab stale, or vice
  versa): ADDRESSED — a stale frontend never acks → `no-client`; a new
  frontend against an old server never sees the event. The
  `EVENT_SCHEMA_GENERATION` bump truncates stale persisted rows on deploy
  (`event-bus.ts` open path). No bilingual window.
- **User on mobile / PWA when the agent asks**: ADDRESSED — client acks,
  then answers `{failed: "unsupported-client"}`; command reports it
  plainly.

## NOT in scope

- **Capturing anything outside the box at agent initiative** — boxholder
  boundary; enforced by enabled-box URL matching + active-tab checks, with
  the documented ms-wide residual race.
- **Persistent in-thread posting of agent-initiated captures** — needs a
  non-turn transcript write path that doesn't exist; `/chat/send` would
  enqueue a spurious user turn (`chat-send-routes.ts:249-257`). Deferred
  with the ephemeral indicator + tmp file standing in. Revisit as its own
  small plan if the honesty gap proves real in use.
- **DOM-freeze / serialized-HTML introspection** — misrepresents exactly
  the broken-rendering cases this feature exists for; if "agent reads the
  rendered markup" is wanted later it is a separate feature, never labeled
  a screenshot.
- **Full-page (beyond-viewport) capture** — needs `chrome.debugger` and
  its infobar; "what the user sees" is the viewport by definition.
- **Continuous watching / video / cobrowsing** — one-shot stills only.
- **Per-box setting to force the popup even with the extension** —
  plausible future knob; deferred until someone asks (CLAUDE.md: no
  features beyond the task).
- **`CB_CHAT_SESSION_ID` adoption by self-note/whats-changed** — real
  improvement, separate change; this plan only introduces the variable.
- **Box-scoped agent-browser** (`issues/features/2026-06-12-…`) — solves
  agent self-verification, not user-view capture; unaffected.
- **Clerk Web Store packaging/review implications** — self-distributed
  today; no new manifest permission is added. Revisit if store
  distribution starts.

## Open design questions

- **Ack transport**: the ack rides the same
  `POST /api/chat/screenshot/:requestId` route as answers (JSON
  `{ack: true}`) vs. a separate lighter route. Lean: same route — one
  boundary, one auth path; the pending primitive gains an `ack()` method
  next to `fulfill()`/`reportNone()`.
- **Downscale for relay captures**: reuse of the 1920px attachment
  downscale is asserted above; if small UI text proves illegible at 1920
  in practice, add a `--full-res` flag to the command later. Not
  architectural.

## Knowledge audits

One new agent-facing concept: *the chat agent can request a screenshot of
what the user currently sees with `cb chat screenshot`, prefers it for
visual/layout questions, and understands the outcome vocabulary
(`declined`/`no-client`/`timeout`)*. One `knows_directly` entry in
`src/dev/knowledge-audits.yaml`; run with
`pnpm knowledge-audit run --filter <tag>` and record the status comment
before the plan completes.

Track A (plus-menu) is user-facing UI, no agent recall needed —
skip-with-rationale.

## Implementation order

1. **B0** — extract `pending-browser-request.ts` from
   `last-audio-pending.ts` (both consumers; last-audio doctests stay
   green) + `CB_CHAT_SESSION_ID` plumbing at agent spawn.
2. **A1** — `screenshot-capture.ts` + Add-menu item + attachment wiring +
   failure toast (Track A complete; independent of B0).
3. **B1** — bus event schema (+ generation bump) + screenshot routes +
   `cb chat screenshot`, frontend stubbed to ack-then-decline.
4. **B2** — real frontend handler: exact-session matching, ack, consent
   popup, upload, indicator row (depends on A1, B1).
5. **C1** — clerk relay (content script + background + handshake),
   manually verified in a headed `BROWSE_CLERK=1` session.
6. **C2** — frontend prefers relay, popup fallback, fidelity tagging
   (depends on B2, C1).
7. **D1** — agent guide line, system-prompt sentence, regenerated command
   docs, knowledge-audit entry + run.

Each chunk is a commit boundary, not a ship boundary; the plan merges as
one unit.

## Rollout shape

- **Tests first as design tool** (`docs/testing.md`): B0's extraction is
  anchored by the existing `last-audio.doctest.md`; B1 gets a
  `screenshot.doctest.md` mirroring it (ack→`no-client` split,
  abort-cancels-pending, 404-on-settled, PNG/size boundary validation);
  the bus event gets a schema round-trip entry in
  `event-bus.doctest.md`'s sample catalog (which asserts schema-count
  exhaustiveness); `CaptureOutcome` mapping and the frame-readiness wait
  get unit tests; the clerk's error→`busy`/`not-capturable` mapping gets a
  unit test in the clerk package. MV3 messaging paths are
  manual-verification, documented in the clerk CLAUDE.md — building an
  extension harness is out of scope.
- **Verification**: drive both entry points end-to-end in a worktree box
  via headed `BROWSE_CLERK=1 bin/browse` (plus-menu item;
  `cb chat screenshot` with and without the extension; decline, no-client,
  and popup-timeout paths).
- **Knowledge audit** lands and runs in D1.
- **No data migration** — no card shapes change; flat `tmp/screenshot-<id>.png` files (swept with the rest of `tmp/`) lives
  under the existing swept tmp area.
- Ships by merging the worktree branch to main on the boxholder's explicit
  signal; auto-deploy covers `callback-box/`; the clerk ships by its own
  extension build/reload flow (not auto-deployed).
