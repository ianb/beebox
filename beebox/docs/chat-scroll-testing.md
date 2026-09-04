# Chat scroll — test procedure

The chat message list's scroll behavior is layout behavior that doctests can't
exercise (`docs/testing.md` §6). Two instruments cover it, and a change to
`chat-scroll.ts`, `InteractiveChat-messages.tsx` (the list, the send anchor, the
spacer, the button) or the `/fakestream` stub should run both:

1. **The isolated harness at `/dev/chat-scroll`** — a fake chat of fixed-height
   blocks with scripted scenarios and measured expectations. This is the fast,
   deterministic one; run it first.
2. **The real app via `bin/browse`** — the procedure below, which is what
   catches the things the harness's fake DOM can't have (the real content
   wrapper's shape, the machine's send path, the mobile composer).

The model being verified: **the controller writes `scrollTop` only on a discrete
user action — open a thread, send, press the button — plus geometric
compensations for changes the reader cannot see. Content growth below the reader
never scrolls** (`docs/plans/chat-scroll-model.md`; the nested
`components/chat/CLAUDE.md` has the invariants).

## 1. The harness

```bash
bin/browse open /dev/chat-scroll
bin/browse eval 'window.__scrollHarness.runAll().then(rs=>JSON.stringify(rs.map(r=>[r.scenario,r.pass,r.failures])))'
```

Every scenario must PASS. `window.__scrollHarness` also exposes `run(name)`,
`scenarios()`, `state()`, `log()` and `reset()`; the page shows the same run as
a readout plus the controller's own trace. Scenarios live in
`pages/dev/components/chat-scroll-scenarios.ts` — a new device behavior belongs
there as a step and a scenario, not as a paragraph in this file. The measures a
scenario can assert on (`writes`, `driftWhileAwayPx`, `flingReversals`,
`finalUserMessageTop`, …) are produced in `chat-scroll-sampler.ts`, from the DOM,
never from what the controller says about itself.

A run takes ~40s. It is deterministic: the same seed, fixed pixel heights, and a
per-scenario reset that goes through the controller's open-thread path.

## 2. The real app

### Setup

```bash
bin/browse open "/chat?session=new"
```

The scroll container is `[data-testid="chat-scroller"]`, its inner content
wrapper is `.max-w-5xl`, and every turn wrapper inside it carries `data-role`
(`user` / `assistant` / …). The measurement primitive is the
distance-from-bottom:

```js
const s = document.querySelector('[data-testid="chat-scroller"]');
Math.round(s.scrollHeight - s.scrollTop - s.clientHeight);   // 0 == at the bottom
```

**Use `bin/browse eval --no-wait` for anything sampled mid-stream.** A plain
`eval` waits for the app to go idle, which for a streaming turn means it hands
you the settled page after the stream finished — every mid-stream sample comes
back identical and the check silently proves nothing.

### `/fakestream` vs a real turn

- **`/fakestream [chunks] [intervalMs] [chunkLen]`** streams deterministic text
  with **no backend** — ideal for the scroll mechanics. Two caveats: it
  short-circuits before the agent, so it finalizes via the synthetic
  `rollupStreamToEntry` path and cannot test the real finalize; and **in a
  server-backed session its content vanishes at finalize** (the authoritative
  history has no such turn), so `scrollHeight` collapses back when the stream
  ends. Sample while it is streaming, not after.
- **A real turn** exercises the genuine streaming + `reconcilePending` finalize.
  The agent is **slow to cold-start** (the first turn can take 20–30s to produce
  any output — `scrollHeight` sits flat until it does; that's the agent spinning
  up, not a scroll bug). Run at least one real turn for the finalize check.

### 2.1 Send anchors the user message to the top

```bash
bin/browse fill bbx-composer-input "/fakestream 600 30 40"; bin/browse press Enter
sleep 1
bin/browse eval --no-wait '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");const us=s.querySelectorAll("[data-role=user]");const u=us[us.length-1];return JSON.stringify({userTop:Math.round(u.getBoundingClientRect().top-s.getBoundingClientRect().top),top:Math.round(s.scrollTop),fb:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight)});})()'
# expect userTop:0 — the new user message sits at the top of the viewport
```

Sending again must re-anchor to the newest user message. If `userTop` is far
from 0 on a short reply, suspect the last-turn spacer (`min-height` on the last
item, from the controller's `viewportPx`): without it the anchor position is not
a reachable scroll offset.

### 2.2 The reply does not follow

Sample the same expression a few times a second apart while the stream runs:
`fb` must GROW, `top` must NOT change (the controller writes nothing), and
`userTop` must stay 0.

```bash
bin/browse eval --no-wait '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");const b=document.querySelector("#bbx-chat-scroll-latest");return JSON.stringify({top:Math.round(s.scrollTop),fb:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),btn:!!b,emph:!!(b&&b.querySelector("span"))});})()'
# expect a growing fb, a fixed top, btn:true, emph:true
```

### 2.3 The button returns to the bottom

```bash
bin/browse eval --no-wait 'document.querySelector("#bbx-chat-scroll-latest").click(), "clicked"'
sleep 1.2
bin/browse eval --no-wait '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");return Math.round(s.scrollHeight-s.scrollTop-s.clientHeight);})()'
```

Mid-stream the click lands at the bottom and the *continuing* growth pushes it
away again — a small `fb` and a button that comes back is the model working, not
a regression. After the stream ends it must be ~0.

### 2.4 Opening a thread lands at the bottom

```bash
bin/browse open "/chat?session=<session-with-history>"
sleep 3
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");return JSON.stringify({fb:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),sh:s.scrollHeight,btn:!!document.querySelector("#bbx-chat-scroll-latest")});})()'
# expect fb ~0 and btn:false on a 30 000px transcript
```

This is the check that catches an open-phase that ends too early: the caller
reports "history is in the DOM" from an effect that runs *before* the
ResizeObserver cycle which measures it, so the hold lapses on a timer. A thread
that lands at the top means the hold ended before the first content cycle.

### 2.4b Opening a thread whose last turn carries images

The boxholder's 2026-08-26 report: with images in the transcript the page
opened above the bottom (web and iOS). An `<img>` has no height until its
bytes land, so the last turn grows well after the first render; the open hold
must outlast that. Use a session whose final reply embeds several images, and
open it **cold** (a hard reload, so the images are fetched, not served from
the memory cache):

```bash
bin/browse open "/chat?session=<session-with-images-in-the-last-reply>"
sleep 4
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");const imgs=[...s.querySelectorAll("img")];return JSON.stringify({imgs:imgs.length,loaded:imgs.filter(i=>i.complete&&i.naturalHeight>0).length,fb:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),btn:!!document.querySelector("#bbx-chat-scroll-latest")});})()'
# expect loaded === imgs, fb ~0, btn:false
```

The harness scenario for this is `open-thread-late-image-at-bottom`.

### 2.5 Content loading above must not shift the view

The regression for async-resizing embeds and for "load older". Scroll to the
middle, let the anchor capture, insert a tall block **above** the viewport, and
measure a visible element's shift — must be 0.

```bash
bin/browse eval --no-wait '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");const c=s.querySelector(".max-w-5xl");s.scrollTop=Math.round((s.scrollHeight-s.clientHeight)*0.5);return new Promise(res=>setTimeout(()=>{const scTop=s.getBoundingClientRect().top;const items=[...c.querySelectorAll("[data-role]")];let ref=null;for(const ch of items){if(ch.getBoundingClientRect().top>scTop+80){ref=ch;break;}}const before=ref.getBoundingClientRect().top-scTop;let target=null;for(const ch of items){if(ch.getBoundingClientRect().bottom<scTop-10)target=ch;}const sp=document.createElement("div");sp.style.height="300px";target.parentElement.insertBefore(sp,target);requestAnimationFrame(()=>requestAnimationFrame(()=>{const after=ref.getBoundingClientRect().top-scTop;sp.remove();res(JSON.stringify({shift:Math.round(after-before)}));}));},400));})()'
# expect {shift:0}
```

Real "load older" is the same branch with a captured gap: click
`#bbx-chat-load-older` while scrolled up, and a reference element's shift must be
0 while the scroll-to-bottom button stays **unaccented** — old history prepended
above the viewport is not new content below the reader.

### 2.6 Mobile composer path (< 640px)

The narrow composer is a different set of controls; a send through it must
anchor identically.

```bash
bin/browse set viewport 390 844
bin/browse open "/chat?session=new"
bin/browse click bbx-composer-keyboard
bin/browse fill bbx-composer-input-mobile "/fakestream 300 30 40"
bin/browse click bbx-composer-send-mobile
# then the 2.1 assertion: userTop must be 0
bin/browse set viewport 1280 800
```

### 2.7 Real-turn finalize (no flash)

The sharpest instrument here is a MutationObserver on the content wrapper, not a
scroll sample — the failure mode is a *content collapse*, and the scroll jump is
downstream of it.

```bash
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");const c=s.querySelector(".max-w-5xl");window.__m=[];new MutationObserver(rs=>{let a=0,r=0;for(const x of rs){a+=x.addedNodes.length;r+=x.removedNodes.length;}window.__m.push([Math.round(performance.now()),`+${a}-${r}`,c.children.length,s.scrollHeight,Math.round(s.scrollTop)]);}).observe(c,{childList:true,subtree:true});return "watching";})()'
# send a real message, wait for it to finish, then:
bin/browse eval 'JSON.stringify(window.__m)'
```

Finalize must keep `scrollHeight` monotonic. A drop — the turn briefly gone,
leaving the user message alone — is the regression
`chat-machine-finalize.doctest.md` guards: something cleared `streamText` before
the finalized entry arrived.

## `/scrolldebug` — the on-device scroll trace (field probe)

### Repeatable real-composer send failure

Run from the monorepo root against a **disposable test conversation** with at
least one screen of retained history. This drives the real desktop composer,
send action, message list, and controller. It submits a synthetic `/fakestream`
message three times, reloading the stored conversation between trials:

```bash
node --import tsx beebox/scripts/chat-scroll-repro.ts '/chat?session=TEST_SESSION' scratch/scroll-repro
```

The script uses the current `bin/browse` viewport (keep it desktop-width), fills
eight lines, clicks Send, and measures the last user message after 800 ms.
Exit 1 means at least one trial failed the 2 px top-alignment assertion, did not
add exactly one user message, or lost trace events. Exit 0 means all three
aligned. Setup/execution/cleanup errors exit 2. Each trial saves a bounded JSON trace and
a screenshot. Run the control with `SCROLL_REPRO_TRACE=0` to disable both DOM
observation and the trace subscription. This tests send anchoring only, **not
authoritative finalization or native keyboard behavior**.

The 2026-09-04 desktop reproduction failed 3/3: the eight-line composer shrank
from 176 px to 36 px on send, and the submitted message remained 330 px below
the scroller top. The trace records the first `ease-write`, a content-resize
`hold-anchor` with an approximately -116 px delta, an unfinished `ease-stop`,
and an instant write undoing the animation step. No controller behavior was
changed in this investigation. The same sequence also failed 3/3 with tracing
and observation disabled, again at 330 px.

The existing isolated harness in this checkout also reproduced send failures:
16/18 scenarios passed; `send-anchors-user-message-top` and
`reply-longer-than-screen-does-not-follow` failed with a 362 px final offset
and two controller writes. These are outstanding failures, not evidence of a
completed fix. The reproduction phase intentionally keeps them red.

### Reading the expanded trace

When enabled through the dev API, a read-only observer samples geometry on animation frames and
emits changed samples (plus frame gaps over 50 ms). `frame` includes composer
height/position, scroller geometry, visual viewport geometry, page scroll,
last user-message position, live-turn/spacer heights, and a fixed reading
marker's position. Presence flags distinguish missing elements from a true
zero position; only compare offsets whose presence flag is true.
`reading-anchor` identifies marker replacement with a
numeric generation; do not compare positions across generations. It prefers
paragraphs/code blocks, falls back to message wrappers, and resets on a new
wheel/touch gesture. It is a geometric marker, not eye tracking.

`interaction` records input/focus/touch/wheel event kinds without text or key
values. `dom` counts additions, removals, and text-node updates; it does not
identify React renders or prove a remount. `scroller-node` records replacement
of the scroll element. `ease-write`, `ease-interrupted`, and `ease-stop` cover
the send animation's writes and cancellation, previously absent from the
controller trace. `ease-write.want` is the requested position, `to` is the
actual position read after the write, and `max` exposes clamping limits.
Animation-frame sampling is not proof of which frames were
actually painted; use recordings when assessing visible jitter.

In dev builds, `window.__bbxScrollTrace.enable(boolean)` and
`window.__bbxScrollTrace.subscribe(callbackOrNull)` expose the **live** module.
Use this seam instead of dynamically importing a bare Vite module URL, which
can create a second diagnostics singleton after HMR. Subscription is exclusive
(also used by the isolated harness); detach after a capture. Disabling removes
the DOM observer and frame loop. HMR disposes those resources too. The normal
`/scrolldebug` toggle retains lightweight controller-only tracing in production
and on devices, with the same bounded log transport. DOM observation is opt-in
through the dev API and does not persist across reloads. Geometry sampling can
affect timing; always compare a failing sequence with observation disabled.

When scroll behavior misbehaves somewhere `bin/browse` can't reach (a real
iPhone, a prod-only condition), type `/scrolldebug` in the composer to toggle a
flag-gated trace of the controller (`lib/scroll-diagnostics.ts`): every scroll
event with its geometry, every reconcile cycle with its `decideReconcile` action
and measured anchor delta, and every programmatic write. Reproduce for ~20–30s,
toggle again to flush; batches land in the box's `client-debug.log` tagged
`[scroll-trace]` (numbers only — safe to quote).

Reading one: `write` events are the controller acting, and under this model they
are rare and each should be explainable by a user action or a resize
compensation — a stream of them is the bug. `sh` dips in `reconcile` events are
content collapses. Protocol for running a round with the boxholder: the
`field-probe` skill.

## Device-only checklist (real iPhone — Chromium can't emulate these)

- **Keyboard:** focus the composer; it must stay above the on-screen keyboard
  (`.h-app` tracks `visualViewport`), and a list that was at the bottom must
  still be at the bottom after the keyboard opens and closes (rule 4's
  scroller-resize branch preserves the previous `fromBottom`).
- **Send spacer:** after sending, the user message must sit at the top of the
  visible area with the reply growing below it — including for a one-line reply,
  which is what the last-turn `min-height` buys.
- **Momentum fling:** flick-scroll up during streaming — must not fight the
  finger or snap back. The harness's `momentum-fling-no-touchmove` scenario
  models it (scroll events with no input events, with an above-viewport reflow
  landing mid-fling), but only a real fling proves it.
- **Rubber-band:** overscroll at top/bottom must not scroll the page behind
  (`overscroll-behavior: contain`, iOS 16+).
- **Retina:** confirm "at the bottom" still registers at `devicePixelRatio` 2
  (the 24px margin should absorb sub-pixel rounding).
