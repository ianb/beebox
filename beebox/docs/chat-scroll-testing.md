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
opened above the bottom (web and iOS). Assistant images now reserve their
70vh frame; user-image thumbnails can still gain height when decoded. Use a
session whose final reply embeds several images, and
open it **cold** (a hard reload, so the images are fetched, not served from
the memory cache):

```bash
bin/browse open "/chat?session=<session-with-images-in-the-last-reply>"
sleep 4
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");const box=s.getBoundingClientRect();const imgs=[...s.querySelectorAll("img")];const pending=imgs.filter(i=>{const r=i.getBoundingClientRect();return !i.complete&&(i.loading!=="lazy"||(r.bottom>=box.top&&r.top<=box.bottom));});return JSON.stringify({imgs:imgs.length,pendingVisibleOrEager:pending.length,fb:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),btn:!!document.querySelector("#bbx-chat-scroll-latest")});})()'
# expect pendingVisibleOrEager === 0, fb ~0, btn:false; far-offscreen lazy images may remain unloaded
```

For a known-good fixture, also verify that the expected visible images decoded
successfully (`naturalWidth > 0`); a failure placeholder is not a successful
load. Cold runs require confirmed network fetches, using disabled cache or
fresh fixture URLs. Record the request evidence rather than assuming a
navigation was cold.

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

Finalize must not briefly remove the assistant turn and restore it after the
history request. That transient collapse is the regression
`chat-machine-finalize.doctest.md` guards. Record intentional send-spacer
removal separately; a height decrease by itself is not proof of that bug.

## 3. Inline images and lazy loading

Image-bearing conversations are required fixtures for scroll verification,
including the simulator and physical-device passes. A text-only `/fakestream`
run does not cover them. Exercise the actual rendering paths separately:

- Assistant Markdown images, both in a paragraph and in an image-only
  paragraph: `ChatInlineImage` / `ChatImage` in `markdown-rendering.tsx` use
  `Image size="chat"`, reserving a 70vh frame and loading eagerly.
- User-message image content blocks: `MessageImage` in `user-entry-content.tsx`
  uses `Image size="sm" loading="lazy"`. Its maximum dimensions do not reserve
  the image's intrinsic height before decode. Use real attachment/content-block
  messages; a Markdown image pasted into user text is not this path.
- Embedded image cards use `FileView`; record that path separately instead of
  assuming every image is an ordinary Markdown `<img>`.

Use landscape and portrait images, several images in one turn, and enough
history to put images well above and below the initial viewport. For each
case below, record an identifiable visible text marker's screen position,
composer/scroller height, scroll position, image request start/completion,
`complete`, `naturalWidth`, and rendered image dimensions. Compare warm-cache
and cold-cache runs. Reset/reload between fixtures so failure caching from a
previous case does not hide a request.

| Case | Procedure and evidence |
| --- | --- |
| Open image-bearing history | Cold-open a conversation ending in images. Capture initial layout, each decode, and the settled bottom position; a correct final position alone does not rule out transient jumps. Repeat warm. |
| Delayed eager image | Delay an image response while its frame is visible; release it while typing, while reading above, and during streaming. Measure text displacement and whether the reserved assistant frame changes height. |
| Lazy image enters view | Start with a user image far offscreen. Verify **no request yet**, scroll toward it until the request actually begins, then capture decode and nearby text movement. `loading="lazy"` alone does not prove deferred loading; browser preload distances vary. |
| Lazy completion during a gesture | Delay a requested user image, move the viewport so it is above the text being read, then release it during a scroll/fling. Check for reversal or a jump; repeat with the keyboard open/closed on the simulator and device. |
| Several images / finalize | Deliver images in a different order from their transcript order; finish the real assistant turn while an image is pending. Check image/turn node replacement and placeholder/frame collapse across authoritative history refresh. |
| Missing image | Return 404 and wait at least 12 seconds. The failure placeholder should remain stable and there must be no timed `imageRetry` requests or repeated placeholder/image swaps. Repeat after a Markdown rerender. |
| Changed image / proxy fallback | For assistant box images, change the underlying file and confirm the file-change versioned URL can load after an earlier failure. Record the short failure placeholder expanding back to a 70vh image frame, with the reading marker above and below it. Separately test an external image's one-time proxy fallback, including a failing proxy. |

The timed missing-image retry hook was removed in this workstream. A missing
URL now stays failed rather than periodically attempting the same resource.
The existing assistant file-change versioning and external proxy fallback are
separate mechanisms and remain. These checks do not claim that a newly created
file must recover without a new URL or a file-change event.

The native simulator is useful for keyboard/layout reproduction, but cannot
replace a physical-device momentum/rubber-band pass. Its native composer is
outside the DOM: a zero/missing web-composer measurement is not a native
composer-height measurement; pair DOM traces with a simulator recording.

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

Before adding the real-image scenario, the isolated harness reproduced send failures:
16/18 scenarios passed; `send-anchors-user-message-top` and
`reply-longer-than-screen-does-not-follow` failed with a 362 px final offset
and two controller writes. These are outstanding failures, not evidence of a
completed fix. The reproduction phase intentionally keeps them red.

### Reading the expanded trace

`react-commit` records development React Profiler callbacks for `chat-root`
(the ChatView subtree), `message-list`, and `composer`. The outer callback
also fires for commits in descendants; it does not mean InteractiveChat itself
rendered. Count callbacks per ID within the capture; `actualMs` is React's
render-duration estimate, not browser layout/paint time. A callback does not
prove a DOM mutation. The native SwiftUI composer is outside these boundaries.
Production does not mount React Profilers; disabled development traces leave
only the Profiler's early-return callback unless a subscriber is attached.
Like controller events, React commits are available to a subscribe-only client;
enabling additionally sends them through the bounded log transport.

An initial single-line typing capture produced one composer callback and one
outer callback, no message-list callback, no transcript mutation, and no scroll
write. This checks a narrow typing case, not streaming performance.

The isolated `real-images-around-reading-marker` scenario uses actual lazy
`img` nodes and controlled SVG sources, waiting for load and decode with a
bounded failure path. It asserts image placement and final dimensions above
and below the reading marker. Wait 400ms after the user drag before completing
the first image: the sampler ignores movement for 350ms after input. The
initial 150ms wait produced a vacuous zero-drift result and was corrected.

After correction, an isolated Chromium run and a fresh full run measured zero
drift, but another full run reported 490px accumulated drift. Temporarily
disabling only the harness scroller's `scrollTo` produced a 245px drift failure;
the override was restored and the page reloaded before the full runs. This
proves the check can fail without compensation, but does not establish stable
image behavior. The doubled movement may reflect growth followed by correction
or an intermediate state sampled before paint. Preserve that uncertainty until
frame/recording evidence distinguishes them. Full runs currently produce 16/19
or 17/19 passes; the two send-alignment failures are consistent.

Step exceptions now return failed scenario summaries so the remainder of
`runAll()` still runs. A forced image-geometry mismatch returned a failure and
the following prepend scenario passed.
Data URLs do not establish network lazy-load deferral or delayed server timing;
those remain in the real-chat matrix above.

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
values. `image` records captured load/error events inside the transcript with
an image-node number, the lazy-loading hint, intrinsic dimensions and current
rendered geometry; it includes no URL or alt text. This marks completion, not
request start: use the browser's request evidence to establish lazy deferral.
`dom` counts additions, removals, and text-node updates; it does not
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
`/scrolldebug` toggle retains lightweight controller-only tracing in production.
In development builds, including a simulator paired to the worktree, it also
enables DOM observation; the session flag restores observation after reload.
Every event carries an ephemeral `traceId` for its module instance. Separate
concurrent clients and HMR generations by this ID before comparing timelines;
it identifies neither the conversation nor the device. Geometry sampling can
affect timing; always compare a failing sequence with observation disabled.

### Native reproduction and motion control (2026-09-04)

The real-chat send runner failed three more times with ordinary motion
(`userTop: 330`, `easeCancelled: true`) and passed three times at `userTop: 0`
with `bin/browse set media light reduced-motion`. Restore ordinary motion with
`bin/browse set media light`. This is an isolation experiment, not a fix:
reduced motion takes the existing instantaneous-send path.

The authenticated iPhone 17 Pro simulator, iOS 26.5, reproduced the same
animation conflict in WKWebView. After a multiline native `/fakestream` send,
the trace showed `ease-write` from 1153 to 1371, followed in the same frame by
`hold-anchor` with delta -218, `ease-stop` with `finish: false`, and a write
back to 1153. The requested first step was within the 1929px scroll maximum,
so clamping cannot explain this cancellation. The web's controller is undoing
its own animation before the scroll event refreshes its viewport-relative
anchor snapshot.

A second native run with DOM observation and React profiling enabled showed
the same sequence (1157 → 1373 → 1157) and a stable `userTop: 619` afterward.
This repeats the symptom with both lightweight and expanded instrumentation.
It does not establish that the observers have no effect on timing.

With the software keyboard actually visible (Simulator I/O → Keyboard →
Toggle Software Keyboard), a separate observation resized the viewport from
651px to 350px while the reader was 160px from the bottom. `hold-from-bottom`
moved scrollTop from 1153 to 1454. This matches today's implementation; whether
the reader's text should move by the keyboard height is a product-policy
question, not evidence that resize compensation is correct. Hardware-keyboard
input alone does not exercise this boundary.

The simulator results establish reproduction, not completion. Real-device
momentum/rubber-band, actual delayed-image network completion, and the full
image/keyboard combination matrix remain separate verification gates. See the
[comparison research](../../research/chat-scroll-comparison-2026-09-04.md) for
the external product review and its limits.

### Deeper web checks (2026-09-04)

**Composer growth while reading:** run
`node --import tsx beebox/scripts/chat-scroll-resize-repro.ts '/chat?session=TEST_SESSION'`.
Use an existing disposable conversation longer than a viewport. It tests both
starting at the bottom and starting 200px above it, without sending anything,
in a dedicated browser session at 1280×577.
Exit 1 means the reading-position check failed; exit 2 is a setup/cleanup error.
The test deliberately asks for stable reading text when away from the bottom,
which is stricter than the current controller's unconditional bottom-gap rule.

In desktop Chromium at 1280×577, the eight-line draft grew the textarea from
36px to 176px and shrank the scroller from 450px to 330px. Starting at the bottom
preserved the bottom, as expected. Starting 200px above it moved scrollTop
198 → 318 and the reading marker 48 → -72. The `hold-from-bottom` write caused
this displacement. Both arms recorded one composer commit, two message-list
commits, and three enclosing ChatView commits: viewport changes reach the
message list even though ordinary single-line typing is isolated.

A later fresh-session rerun with connected-marker checks produced a different
failure: at-bottom scrollTop stayed 398 while the viewport shrank 120px, leaving
a 120px bottom gap; the away marker stayed steady. Its trace contained input
and React commit events but no controller reconciliation. The browser then failed a rendering-health check: timers ran, but no animation
frame arrived within a second, despite visible document state. This run is
inconclusive, not another established controller failure. The probes now require
animation-frame delivery before measurement. The earlier explicit
`hold-from-bottom` trace does not explain this suspended-rendering run.
After rendering resumed, the guarded probe reproduced the original 120px
away-marker displacement, with both cached markers still connected.

**The 490px image measurement:** phase-tagged samples resolved the earlier
uncertainty. In 20 isolated runs, 4 reported 490px. In a second set of 15 runs
with a Chrome rendering trace, 6 reported it. Each counted +245px in a timer
task, then -245px in the next resize-observer callback about one frame later.
There were zero `Paint`/paint-lifecycle events between those samples in the
page's renderer process. The timer forced layout after asynchronous image
completion but before the next rendering update; it was not measuring a
painted displacement. `requestAnimationFrame` followed by `setTimeout` does
not guarantee that later DOM reads describe the last painted frame. The
[HTML rendering algorithm](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering)
and [Resize Observer processing model](https://drafts.csswg.org/resize-observer/#html-event-loop)
place resize reconciliation inside a rendering update, before paint.

**Reserved network images:** isolated real-chat tests of the shipping markdown
`Image size="chat"` path with an eight-second HTTP response produced one request
and retained one DOM image in each of five arms: no typing, single-line typing,
five-line typing, diagnostics on at navigation, and diagnostics enabled while
the request was pending. No DOM image replacement or request abortion occurred.
The reserved 70vh frame prevented decode-time geometry movement. An earlier
three-request run coincided with development source edits and was not
reproduced with source held stable; it is not evidence of a surviving timed
image retry.

**Lazy user images:** the shipping `MessageImage` → `Image size="sm"` path
reserves no full image height. A controlled HTTP probe confirmed lazy request
deferral, exactly one request, successful 800×600 decoding, and the same DOM
node. When the image was above the reading marker inside one long user message,
its height grew 238.5px and the marker moved down 238.5px, with no scroll
compensation. Below the marker, the same growth caused zero marker movement.
The controller's message-level anchor misses movement within that message.

Run the isolated two-arm reproduction with:

```bash
node --import tsx beebox/scripts/chat-scroll-lazy-image-repro.ts
```

It creates temporary test1 sessions, serves a held image response, captures
before/after screenshots, and cleans up its fixtures. Exit 0 means stable
reading markers, 1 means unwanted movement, and 2 means setup or cleanup failed.
Keep frontend source stable during network experiments: HMR can replace nodes
and restart requests.

The sampler now defers task-phase reads of sizes its ResizeObserver has not
processed, retaining the previous anchor until reconciliation. Twenty subsequent
image runs measured zero drift, with 58–64 samples each. The runner fails if
its observed elements disappear or change, or if it records no samples; both
real-chat probes reject detached reading markers. Disabling compensation as a negative control
still failed with 245px drift. The complete harness passed 17 of 19 scenarios;
the two send-animation scenarios remain failing. These are reproducibility
improvements, not a production scrolling fix.

### Controller fix verification (2026-09-04)

The fix uses a visible text character inside each message as the reading
anchor, measured in content coordinates. Appending below it cannot move that
coordinate; image growth above it can. Text-prefix validation rejects a reused
DOM node whose contents changed. A canceled send invalidates its anchor, and
an active send owns writes while resize reconciliation still measures geometry.

Viewport resizing preserves the bottom only when the signed natural-content
bottom gap was actually near zero. A negative gap inside a live turn's empty
spacer is not a bottom-pinning request. The spacer now uses `100cqh` against the
size-contained scroller, so it resizes in the same layout instead of waiting
for a React state update. This follows the
[container-relative length model](https://www.w3.org/TR/css-contain-3/#container-lengths).
The real multiline typing probe now records zero message-list commits, versus
two before this change (one composer and one enclosing chat-root commit remain).
The spacer is scoped to the current send: the production hook was mounted in
Chrome and driven through initial idle, send, completed idle, background refresh,
and next send. It stayed absent during the refresh and returned for the next
send. The harness now attaches the same natural-height live-content wrapper as
real chat and excludes empty spacer space from its bottom-distance measurement.

Verified locally with rendering-health and connected-marker checks:

- Real desktop multiline send: 3/3 at `userTop: 0`, no ease cancellation.
- Composer growth: bottom retained at gap 0; marker drift 0 at gap 200.
  A separate real-chat short-reply probe kept `userTop: 0` through composer
  grow/shrink (viewport 405 → 285 → 405px, natural live content only 20–56px),
  proving that unused spacer space does not trigger bottom pinning.
- Real lazily loaded user image: above-marker drift -0.5px with 239px scroll
  compensation for 238.5px image growth; below-marker drift 0. Each arm deferred
  its initial request, fetched once, retained the node, and decoded 800×600.
- Full deterministic harness: 20/20 with both normal and reduced motion,
  including the new short-reply/composer
  grow-and-shrink scenario. That scenario failed at 108px before the spacer
  layout change. Send is now marked as intentional movement through its bounded
  animation; final alignment and subsequent streaming drift remain asserted.
- Authenticated iPhone 17 Pro simulator, iOS 26.5, final WKWebView: send ease
  finished at scrollTop 1964 with `userTop: 0`; software-keyboard opening shrank
  the scroller 606 → 305px, with `act: none`, unchanged scrollTop, and
  `userTop: 0` while the reply continued growing. The later synthetic-stream
  completion dropped its provisional reply/spacer and clamped to the real
  bottom; that is outside the send/keyboard assertion window.

Physical iPhone momentum/rubber-band and actual delayed-image completion on iOS
remain unverified. The open issue stays open for those device checks; desktop
and simulator success are not a substitute.

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
  scroller-resize branch retains the bottom only if already there; reading
  above it should remain steady).
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
