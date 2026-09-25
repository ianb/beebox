# Chat scroll investigation, 2026-09-04

Frozen 2026-09-25 from `docs/chat-scroll-testing.md`. The measurements, the
reproduction runs, and the fix verification for the send-anchoring and image
drift work of 2026-09-04. The current procedure is
[chat scroll](../chat/scroll.md); the model is in the chat component's
`CLAUDE.md` and `docs/plans/chat-scroll-model.md`. Do not update in place.

## Repeatable real-composer send failure

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

## Native reproduction and motion control (2026-09-04)

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

## Deeper web checks (2026-09-04)

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

**Earlier reserved-frame network-image baseline (before natural sizing was restored):** isolated real-chat tests of the shipping markdown
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

## Controller fix verification (2026-09-04)

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

## Natural image sizing follow-up

The forced full-width 70vh frame has been removed. Chat images use their
intrinsic proportions, with available width and 70vh as maximum dimensions;
small images are not enlarged to fill the transcript. Caption and lightbox
wrappers no longer force full width.

The ordinary assistant Markdown `ChatImage` renderer was exercised with a
controlled delayed HTTP response above and below a visible reading marker.
Both arms decoded the same 800×600 DOM image after exactly one request, gaining
403.875px height. Above the marker, compensation was 404px and marker drift
was −0.125px; below it, both compensation and marker drift were zero. This
covers the now-variable ordinary image path in desktop Chromium; physical-iOS
image completion remains on the device checklist.

A mounted production `Image` component probe also measured landscape, portrait,
and small images. In a 400px-wide container, 800×400 rendered at 400×200,
400×800 rendered at approximately 202×404 (the viewport's 70vh cap), and
120×80 remained 120×80. Their button and figure widths matched the images.
