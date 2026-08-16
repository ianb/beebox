---
title: "Chat scroll redesign: remove virtualization, single scroll controller"
status: implemented
workstream: unknown
issues: []
---
# Chat scroll redesign: remove virtualization, single scroll controller

The InteractiveChat message list has persistent scroll defects: it doesn't
reliably pin to the bottom on join, it yanks the user back down after they
deliberately scroll up during streaming, it jitters, messages flash during the
stream→finalized swap, and it snaps to the same position repeatedly. Several are
mobile-Safari-only. This plan replaces the current architecture — `react-virtuoso`
plus a hand-rolled pin layer that fights it — with a non-virtualized message list
driven by a single, in-repo scroll controller, adds a floating scroll-to-bottom
button (with an unseen-content indicator) that falls out of that controller's
state, and establishes a deterministic harness (extending the existing
`/fakestream` stub, driven via `bin/browse`) that turns each defect into a
measurable pass/fail so the redesign is decided by evidence, not argument.

> **Status — shipped 2026-06-21.** Tracks 1–4 are implemented and verified on
> desktop Chrome via `bin/browse` (procedure: `docs/chat-scroll-testing.md`):
> de-virtualized list + single `useStickToBottom` controller
> (`InteractiveChat-scroll.ts`), scroll-to-bottom button, real-turn finalize
> (no flash), and hold-position-when-content-loads-above. Track 5 (mobile
> Safari) landed `visualViewport` keyboard handling + `overscroll-behavior`, but
> **fling-safety is deferred and the mobile path is unverified on a real iOS
> device** — that's the one outstanding item.

> **Revision note.** This plan was reviewed by a cross-model pass (codex) plus an
> independent cold codex session given only the symptoms. Both independently
> concluded "drop virtualization + one controller." Their findings corrected three
> citation errors, surfaced a layout-specific architecture bug (below-list chrome
> resizing), and argued the controller should be written in-repo rather than chosen
> via a dependency ladder. Those corrections are folded in below.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:Behavioral Notes` — *"Read before writing. Don't guess
  file formats … read the existing code, read the test patterns."* The harness
  track (Track 1) is the embodiment of this: reproduce-then-change.
- `callback-box/CLAUDE.md` — *"Frontend uses UI primitives and a semantic
  palette. Read frontend.md before writing UI … the `className`-only-for-outer-layout
  rule (enforced by `restrict-component-classes`)."* The list rewrite and the
  scroll-to-bottom button keep appearance in `components/`-scoped code.
- `callback-box/CLAUDE.md` — *"don't add features beyond what the task requires."*
  This plan removes a dependency rather than adding one (the controller is written
  in-repo, no new runtime dependency).
- `~/.claude` memory `feedback_components_own_a11y` — the scroll-to-bottom button is
  its own component that renders its own `<button aria-label=…>`; it is not a bare
  icon wrapped by a parent landmark.
- `callback-box/code-style.md:36-37` — no default parameters; max 2 positional
  params (named params object beyond that). The controller hook's signature obeys
  this.
- `callback-box/code-style.md:55` — `as` assertions are `unsafe`-grade. Scroll code
  reads DOM geometry; any narrowing uses an `instanceof` guard (the current code
  already does — `InteractiveChat-messages.tsx:129`).
- `callback-box/code-style.md:58` — files max 300 lines, functions max 150. The
  current `InteractiveChat-messages.tsx` is 340 lines; the rewrite splits the
  controller into its own `lib/` hook to stay under the limit.
- `callback-box/docs/testing.md:5-11` — tests force decomposition, document, and
  anchor regressions, *not* coverage for its own sake. The harness anchors specific
  defects, not the whole UI.
- Most-recent precedent: `docs/testing.md:474-510` (`/fakestream` + `bin/browse`)
  is the established pattern for exactly this bug class. This plan extends it.

## What already exists

- **`InteractiveChat-messages.tsx:206-340`** (`VirtualizedMessageList`) — the
  Virtuoso shell. **Rebuilt**, not reused: it's the root of the two-controller
  conflict. Behavior worth carrying forward (as new code, not as-is):
  - `:104-106` `pinToBottom()` → `virtuosoRef.scrollToIndex({index:"LAST"})` —
    replaced by a direct `scrollTop` write on our own container.
  - `:127-141` `handleScroll` direction+threshold disengage — the *idea*
    (direction-based disengage gated on recent genuine user input) carries forward;
    the implementation moves into the new controller.
  - `:112-118` `markUserScroll`/`handleKeyScroll` (wheel/touch/key intent stamp) —
    carries forward; this is the "detect genuine user intent, not the raw scroll
    event" pattern the redesign is built on.
  - `:161-166` `handleAtBottomStateChange` + its comment *"Virtuoso's atBottom
    signal is unreliable during tail growth"* — the documented reason the
    declarative path was abandoned; deleting Virtuoso deletes this hazard.
  - `:170-174` streaming tail-follow effect — carries forward as the controller's
    content-grew→re-pin path, driven by `ResizeObserver` rather than a React effect
    on stream text.
  - `:190-196` first-data-populate jump — carries forward as the controller's
    on-mount pin.
  - `:258-274` prepend-anchor bookkeeping (`firstItemIndex` decrement on "load
    older") — **rebuilt** as scrollTop-delta preservation (record `scrollHeight`
    before prepend, restore distance after); `firstItemIndex` is a Virtuoso concept.
  - `:51-65` `LoadOlderHeader` + `:284-289` pagination context — **reused** nearly
    verbatim; pagination is the agreed large-thread strategy, independent of
    virtualization.
  - `:71-79` `CenteredList` max-width centering — **reused** as the inner content
    wrapper inside our own scroll container.
  - `:279-282`/`:322` `chatImagesJson` lightbox image list — **reused** verbatim.
  - `:323` the `<Virtuoso>` instance sets **no** `data-testid`. (Codex finding #4:
    the `virtuoso-scroller` selector referenced in `testing.md:505` does not exist
    in source. The harness adds a **net-new** `data-testid="chat-scroller"`; it is
    not a reuse.)
- **`InteractiveChat-message-items.tsx:107-190`** (`DataItem`, `buildDataItems` at
  `:148`, `dataItemKey` at `:121`, `renderDataItem`) — **reused**. Data assembly is
  orthogonal to virtualization; it yields a flat `DataItem[]` we `.map()` directly.
  These functions have **no doctest coverage today** (codex finding #6, verified —
  earlier draft wrongly claimed otherwise). The `{kind:"stream"}` item keyed
  `"stream"` (`:124`) vs. the finalized group keyed `group.entries[0].uuid` (`:127`)
  is the key-swap implicated in the flash (Track 4).
- **`InteractiveChat-messages.tsx:242-243`** — `streamingShown` gate keeping the
  streamed bubble visible through `refreshing`. **Reused**; the flash is a key
  *identity* problem on top of this gate (Track 4), not a reason to change it.
- **`src/frontend/src/machines/chat-actors.ts:96`** (`runFakeStream`; dispatched at
  `:265-266` on the `/fakestream` prefix) — the actual `/fakestream` implementation.
  **Reused and extended** (Track 1). Today it parses three numeric params
  (`chunks`, `intervalMs`, `chunkLen`) and emits text plus one synthetic tool event
  (`:121-135`). It does **not** load history — initial history comes from
  `/chat/history` (`:25`), a separate path. (Codex finding #5: `docs/testing.md:484`
  and the earlier plan draft both wrongly located this in `chatMachine.ts`; both get
  fixed.)
- **`src/frontend/src/machines/chat-types.ts:42`** `HISTORY_TAIL = 200` and
  **`InteractiveChat-actions.ts:160`** `handleLoadOlder` (40-message chunks) —
  **reused**. The loaded window is already bounded at 200, growing 40 at a time on
  explicit user action. This is the concrete evidence virtualization buys little,
  and it is the perf lever if 200 rich messages janks (drop to 80–120).
- **`bin/browse`** + the upstream `agent-browser` CLI (passthrough via
  `browse/src/cli.ts:64`) — **reused** as the harness driver. Verified command
  surface includes `mouse wheel <dy>` (a real wheel event), `scroll <dir> [px]`,
  `eval <js>` (read geometry), `set device "iPhone 12"`, retina viewport via `set
  viewport w h 2`, and `batch`. This is what makes Track 1 feasible *and* makes the
  scroll-up a genuine input event (codex finding #3) rather than a `scrollTop` write.
- **Below-the-list chrome that changes height** (codex finding #1, the key one):
  status banners + composer region (`InteractiveChat-layout.tsx:240-247`), the
  mobile typing row (`:176-207`), attachments (`ChatAttachments.tsx:53`), selections
  (`ChatSelections.tsx:35`), and recovered dictation. These are flex siblings
  *below* the scroller; when they grow/shrink they change the scroller's
  `clientHeight` **without** changing content height — so a content-only
  ResizeObserver (what `use-stick-to-bottom` does, its open issue #40) silently
  drifts off bottom. The controller MUST observe the scroller too (Track 3).
- **`app-shell.tsx:62`** `h-screen h-[100dvh]` + **`index.css:105`** dvh handling —
  **reused**. No `visualViewport` usage exists anywhere in `src/frontend/src`
  (grep-confirmed) — net-new in Track 5.
- **`scrollToBottomTrigger`** (`InteractiveChat.tsx:95`, threaded through
  `InteractiveChat-view.tsx`) — **reused**; the send-message scroll becomes one more
  caller of the controller's `scrollToBottom()`, alongside the new button.

## Prior art (external)

Three research sweeps (assistant-ui, Vercel AI Chatbot, LibreChat, Open WebUI,
Lobe Chat, react-virtuoso; plus underlying browser behavior) plus two codex passes.

- **`stackblitz-labs/use-stick-to-bottom`** — the de-facto React standard (powers
  bolt.new; vendored into Vercel's AI Elements). ResizeObserver on the **content**
  element; discriminates user vs. programmatic scroll by *recording the `scrollTop`
  it last wrote*; ~70px near-bottom margin; spring follow; handles content shrink.
  Deliberately avoids CSS `overflow-anchor` "which Safari does not support."
  https://github.com/stackblitz-labs/use-stick-to-bottom
  - **Decision: borrow its internals, do not depend on it.** Its open issues are in
    our exact problem area — #9 "Bad on iOS", #32 Safari-zoom sub-pixel jump, and
    **#40 breaks when a flex *sibling* resizes** (content-only observer). Our layout
    (below-list chrome, above) triggers #40 by construction. We reimplement the
    proven parts (record-the-scrollTop intent detection, shrink handling, generous
    margin) in-repo and additionally observe the scroller. Both codex sessions
    converged on "don't be deferential to the library"; the better-informed
    (layout-aware) one argued for writing it ourselves.
- **CSS `overflow-anchor` unsupported in every shipping Safari** (desktop + iOS) as
  of mid-2026 — Tech Preview only; WebKit #307734 landed Feb 2026 but isn't on
  users' devices. https://caniuse.com/css-overflow-anchor,
  https://bugs.webkit.org/show_bug.cgi?id=307734. (Codex external check confirmed
  this is directionally current.) **Consequence:** JS ResizeObserver is the only
  cross-browser foundation; prepend preservation is manual (Track 2).
- **`scrollend` shipped only in Safari/iOS 26.2 (Dec 2025).** (Codex confirmed
  against Can I Use.) https://caniuse.com/mdn-api_element_scrollend_event. Debounced
  `scroll` fallback required for older iOS (Track 5).
- **assistant-ui's `<=1px` at-bottom check broke on Chrome at devicePixelRatio 2**
  (PR #4141) — use a generous margin (~70px), never equality.
- **`scrollIntoView` walks every scrollable ancestor** (W3C csswg #9452, "often
  surprising"); write `scrollTop`/`scrollTo({top})` on the one known container.
- **Smooth scroll harms streaming** (only one animation at a time; not cancelable
  in Safari). https://css-tricks.com/cancelable-smooth-scrolling/. `behavior:'instant'`
  while streaming; smooth only for the idle button click.
- **Mobile Safari:** keyboard does not resize the layout viewport — fixed bars end
  up behind it; use `visualViewport` (Safari 13+).
  https://tkte.ch/articles/2019/09/23/safari-13-mobile-keyboards-and-the-visualviewport-api.html.
  Writing `scrollTop` mid-fling kills momentum (react-window #122).
  `overscroll-behavior:contain` is iOS 16+. **Note:** `-webkit-overflow-scrolling:
  touch` is a no-op since iOS 13 (momentum is default) — explicitly *not* used,
  despite one codex suggestion to add it (our research is more current here).
- **`flex-direction: column-reverse`** sticky trick rejected: Firefox overflow bug
  open ~10y (bugzilla #1042151) + DOM-order/a11y break (WCAG C27).
- **Virtualization need:** consensus crossover is thousands+ of simultaneously
  rendered nodes; below that, render-all is fine. With `HISTORY_TAIL = 200` +
  manual pagination the window never reaches that. `content-visibility:auto` is
  **deferred** (Track 2) — not needed at 200 and it adds scrollbar wobble (codex #7).
- **No prior art found** for one project combining rich async-resizing embedded
  views + manual prepend pagination + stick-to-bottom; the integration is ours.

## Tracks / scope

Ordered by implementation dependency. Track 1 (harness) is the scoreboard. Tracks 2
and 3 are the structural change. Track 4 (stream/finalize identity) is promoted
ahead of mobile because the flash is a top user-visible symptom and is independent
of mobile. Track 5 (mobile) is last.

### Track 1 — Deterministic scroll harness (do first, right-sized)

- **What.** Extend `/fakestream` and add `bin/browse`-driven measurement scripts
  that reproduce the defects as pass/fail against current code (baseline), then
  against the new build.
- **Why.** "Despite some fixes" / "jumps back over and over" is the signature of
  un-anchored fixing. Without a deterministic repro we can't tell whether a change
  helped.
- **Direction.**
  - **Chunk 0 — de-risk the primitive first** (codex findings #2/#3). Before any
    scenario work, prove the harness can (a) drive a *real* wheel via `bin/browse`
    (`mouse wheel <dy>`), and (b) read geometry via `eval` (`scrollHeight -
    scrollTop - clientHeight`). The scroll-up MUST be `mouse wheel`, not a
    `scrollTop` write — the disengage logic requires a genuine wheel/touch/key mark
    (`InteractiveChat-messages.tsx:112,135-138`), so a `scrollTop` write would test
    nothing.
  - **Scenarios this stub can express now** (numeric-param + text growth, the stub's
    current shape): `stream-while-pinned` (jitter + tail-follow), `scroll-up`
    (wheel up mid-stream, assert no yank-back), `finalize` (let a stream complete,
    assert no backward jump / no missing frame at the `"stream"`→uuid swap).
  - **`join`** needs the stub to mount with history present. The current stub does
    not touch the history path (`chat-actors.ts:25`); Chunk handles this by driving
    a real (or seeded) thread that already has messages, then asserting at-bottom on
    first settled frame — *not* by faking `DataItem`s.
  - **Deferred to after the controller exists** (codex finding #2 — the stub can't
    express these without becoming its own fixture project): `late-card` (async
    embed insertion) and older-iOS fling. Logged here so the deferral is explicit,
    not silent.
  - **Button scenario** (for Track 3): scroll up → assert the scroll-to-bottom
    button appears; emit stream text while detached → assert the button enters its
    emphasized (unseen-content) state; click it → assert return-to-bottom and the
    emphasis clears.
  - **Jitter as a number:** an `eval`-sampled `scrollTop` over a rAF window;
    assert it never moves backward while pinned.
- **First implementation chunk.** Chunk 0 (primitive de-risk) + the `scroll-up`
  scenario, run against current code to capture the yank-back baseline. No open
  questions inside it.

### Track 2 — De-virtualize the message list

- **What.** Replace `<Virtuoso>` with a single scroll container rendering
  `buildDataItems(...).map(renderDataItem)` in normal DOM order, with the existing
  "load older" pagination preserved.
- **Why.** Virtuoso's `atBottom`-during-tail-growth unreliability (our own comment,
  `:161-163`) is a root cause; its recycling complicates the flash (Track 4); and
  virtualization buys nothing at a 200-bounded window.
- **Direction.**
  - New container `<div data-testid="chat-scroller" class="relative flex-1 min-h-0
    overflow-y-auto overflow-x-hidden" style="overflow-anchor: none">` wrapping the
    `CenteredList` content. `relative` so the floating button (Track 3) positions
    against it; `min-h-0` so the flex child actually scrolls; `overflow-anchor:none`
    stops Chrome/Firefox native anchoring fighting our JS (no-op on Safari).
  - Items via existing `renderDataItem`; `key={dataItemKey(item)}`.
  - A bottom **sentinel** `<div ref={bottomRef}>` after the items — the controller's
    pin target and the at-bottom reference.
  - **Prepend preservation (replaces `firstItemIndex`):** in `handleLoadOlder`,
    record `scrollHeight`/`scrollTop` before the older page is prepended, then in a
    `useLayoutEffect` set `scrollTop += (newScrollHeight - oldScrollHeight)` so the
    anchor doesn't jump.
  - **`content-visibility:auto` is DEFERRED** (codex #7). Not added in v1; the
    200-bounded window doesn't need it and it introduces scrollbar-estimate wobble.
    Revisit only if profiling on a fully-loaded thread shows jank — at which point
    the lever is also `HISTORY_TAIL` (drop to 80–120) before reaching for CSS
    containment.
- **Vocabulary lock-ins.** `data-testid="chat-scroller"` (net-new; update
  `docs/testing.md:505` from the nonexistent `virtuoso-scroller`).
- **First implementation chunk.** Non-virtualized list with pagination prepend
  preservation, sentinel, and a temporary one-shot on-join pin (`scrollTop =
  scrollHeight` in `useLayoutEffect`) — **no** controller yet, so Track 3 layers
  cleanly. No open questions in this chunk.

### Track 3 — Single in-repo scroll controller + scroll-to-bottom button

- **What.** One controller owns pin/follow/disengage and exposes the state the
  floating button needs, replacing both Virtuoso's `followOutput` and the
  hand-rolled `pinnedRef` layer.
- **Why.** The whole defect class is two controllers disagreeing. One controller
  with genuine-intent detection is the load-bearing fix. The button is then a thin
  consumer of its state (the feature that was hard under Virtuoso because there was
  no trustworthy `isPinned`).
- **Direction — a concrete in-repo controller** (codex's "write it now, narrowly";
  no dependency, no ladder). `useStickToBottom({ scrollerRef, contentRef })` returns
  `{ isPinned, hasUnseenContent, scrollToBottom }`. Internal refs:
  - `isPinned` — following the bottom.
  - `lastProgrammaticScrollTop` — the value we last wrote, so our own scrolls aren't
    misread as user intent (the use-stick-to-bottom trick).
  - `lastUserIntentAt` — stamped by `wheel`/`touchmove`/scroll-key listeners.
  - `lastDistanceFromBottom` — preserved while detached so content growth above/below
    doesn't move the user's view.
  - `hasUnseenContent` — content grew while detached (drives the button emphasis).
  - **Observers:** `ResizeObserver` on **both** the content element **and** the
    scroller (codex #1 — below-list chrome changes `clientHeight` without changing
    content height). `scroll` listener (passive) for pin/unpin decisions.
  - **On resize (content or scroller):** if `isPinned` → write `scrollTop =
    scrollHeight - clientHeight` (instant), record `lastProgrammaticScrollTop`; else
    → restore `lastDistanceFromBottom` and set `hasUnseenContent = true`.
  - **On scroll:** ignore if `scrollTop ≈ lastProgrammaticScrollTop` (our own write).
    Else: upward + recent `lastUserIntentAt` → `isPinned=false`; within ~70px of
    bottom → `isPinned=true`, `hasUnseenContent=false`, `lastDistanceFromBottom=0`;
    otherwise update `lastDistanceFromBottom`.
  - **`scrollToBottom(opts)`:** write to bottom (instant while streaming, smooth on
    button click), `isPinned=true`, `hasUnseenContent=false`. Called by the button,
    the send action (`scrollToBottomTrigger`), and on-join.
  - **No spring** in v1 (codex) — instant follow; add spring only if the harness
    shows the re-pin reads as abrupt.
- **Scroll-to-bottom button** (the requested feature, its own component):
  - A floating `<button aria-label="Scroll to latest messages">` with a down-arrow
    icon, positioned bottom-right inside the `relative` scroller (uses
    `env(safe-area-inset-bottom)` so it clears the iOS home indicator).
  - **Visible** when `!isPinned`.
  - **Emphasized** (distinct bg-opacity/color, or a small dot) when
    `hasUnseenContent` — i.e. text arrived since the user left the bottom; **default
    (subtle)** appearance when scrolled up but nothing new arrived.
  - **Click** → `scrollToBottom({ behavior: "smooth" })`.
  - Appearance lives in the component (frontend.md `className`-only-for-outer-layout;
    component owns its a11y per `feedback_components_own_a11y`).
- **Vocabulary lock-ins.** Hook name + `{ isPinned, hasUnseenContent, scrollToBottom }`
  return shape (consumed by the button + send action).
- **First implementation chunk.** The controller hook wired to the Track 2 container
  (content + scroller observers), with the streaming/scroll-up/finalize harness
  scenarios passing on Chrome. The button is the next chunk (depends on
  `isPinned`/`hasUnseenContent`). No open questions in the controller chunk — the
  shape is specified above.

### Track 4 — Stream/finalize identity (promoted)

- **What.** Eliminate the flash when the streamed bubble (`{kind:"stream"}`, key
  `"stream"`) is replaced by the finalized group (key `group.entries[0].uuid`).
- **Why.** "Messages flash away between streaming and not streaming." The
  `streamingShown`-through-`refreshing` gate (`:242-243`) closes the *data* gap, but
  the React **key change** still unmounts/remounts the bubble subtree at the swap.
  Both codex sessions flagged this; the cold session ranked it a top-3 move — hence
  promoted ahead of mobile (earlier draft buried it last).
- **Direction.** First confirm with the Track 1 `finalize` assertion whether
  removing Virtuoso alone fixes it (Virtuoso recycling may be the visible cause). If
  it persists: give the active turn a stable client identity so the live stream and
  its finalized entry render under the **same** key — i.e. `"stream"`→uuid is no
  longer a key change. Lock the exact keying in `dataItemKey` (`:121-129`) here, since
  it's a shared contract with the error-boundary labels (`message-items.tsx:219`).
- **Vocabulary lock-ins.** Any `dataItemKey` change is the contract; lock it here.
- **First implementation chunk.** Run the `finalize` assertion against the Track 2+3
  build and record whether the flash survives de-virtualization. The keying fix (if
  needed) is the next chunk — designed only once the measurement proves it's needed.

### Track 5 — Mobile Safari layer

- **What.** `visualViewport` keyboard handling, fling-safe scrolling, overscroll
  containment — the bugs Chrome-based harnesses can't catch.
- **Why.** "Some things happen only on mobile Safari." Distinct from controller
  logic and unaddressed today (no `visualViewport` usage).
- **Direction.**
  - Listen to `window.visualViewport` `resize`/`scroll`; offset the chat shell by
    `visualViewport.height`+`offsetTop` so the composer stays above the keyboard;
    re-run `scrollToBottom` after a keyboard resize *if pinned*.
  - **Fling safety:** never write `scrollTop` during a touch fling; gate auto-follow
    on "pinned AND not actively touch-scrolling," resume on `scrollend` —
    `'onscrollend' in window` feature-detect + ~120ms debounced-`scroll` fallback for
    pre-26.2 iOS.
  - `overscroll-behavior: contain` on the scroller (iOS 16+; harmless elsewhere).
  - The carried-forward keyboard-dismiss phantom-scroll guard (`USER_SCROLL_WINDOW_MS`,
    `:31-35`) stays as defense-in-depth; verify on device before removing.
- **First implementation chunk.** `visualViewport` keyboard-offset handling, verified
  on a real iPhone (composer stays above keyboard; list re-pins after open/close).

## Subplans

None. The one previously-open question (which controller approach) is now settled —
write it in-repo — on the strength of the layout-aware codex finding (#1). If the
in-repo controller proves insufficient on real iOS, its intent state machine may
warrant a subplan then; flagged, not pre-committed.

## Failure modes

> **Critical-gap honesty (codex finding #2).** The earlier draft claimed "critical
> gap: none." Corrected: the harness genuinely *cannot* express `late-card` or
> older-iOS fling with the current stub. These are **deferred, not handled** — listed
> below and in Track 1 so the gap is explicit, not silent. The defects they'd cover
> (async-card shift; iOS momentum) still get manual device verification.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Below-list chrome resizes `clientHeight`, content-only observer drifts off bottom | Track 1 button/stream scenarios (toggle composer rows) | ResizeObserver on **both** content and scroller (Track 3) | Clear — would otherwise be silent drift |
| Prepend "load older" mis-restores scrollTop (height not settled when read) | Track 1 prepend-anchor script | `useLayoutEffect` reads post-commit; double-rAF re-read if stale | Clear (visible jump) |
| Async embedded view grows after join → shifts read position | **Deferred** (`late-card` not yet expressible) + manual device check | ResizeObserver re-pin (pinned) / preserve-distance (scrolled) | Documented deferral, not silent |
| ResizeObserver fires mid-fling, we write `scrollTop` → momentum killed (iOS) | Real-device check (Track 5); Chrome harness can't see it | Gate writes on not-actively-touch-scrolling; resume on `scrollend` | Silent on Chrome harness, clear on device — device pass mandatory |
| `scrollend` absent pre-26.2 iOS → follow never resumes | Real-device check on older iOS | feature-detect + debounced-scroll fallback | Clear (follow stuck) — fallback handles it |
| Synthetic scroll-up via `scrollTop` write doesn't trigger disengage → false green | Track 1 Chunk 0 proves real `mouse wheel` drives disengage | Harness uses `mouse wheel`, never `scrollTop` write | Clear (Chunk 0 is the gate) |
| At-bottom margin too tight → retina never registers "at bottom" (PR #4141) | Track 1 join at `set viewport w h 2` | Generous (~70px) margin, not equality | Clear |
| `hasUnseenContent` stuck on after returning to bottom | Track 1 button scenario (click clears emphasis) | Cleared when `isPinned` re-engages and in `scrollToBottom` | Clear |
| Dropping Virtuoso regresses perf on a fully-loaded window | Manual: load many pages, sample frame timing | Pagination bounds window; `HISTORY_TAIL` lever; content-visibility held in reserve | Clear (jank visible) |
| File exceeds 300-line limit after rewrite | `pnpm lint` | Controller split into own `lib/` hook | Clear (lint error) |

## Agent-flow / user-flow edge cases

A frontend rendering surface — no card/tag/agent-written data — so several template
scenarios are **N/A by construction**, listed rather than omitted:

- **Wrong tag / wrong field** — N/A (no schema/tag change).
- **Stale ref** — N/A for cards. The analogue (the old `trackedFirstKey` anchor with
  no `idx === -1` fallback, `:266-274`) is **ADDRESSED**: the rewrite uses
  scrollHeight-delta preservation, which has no "key not found" failure mode.
- **Two agents / hand-edit drift / fabricated value / validation UX** — N/A (no
  shared data path).
- **Partial migration / transition state** — **ADDRESSED.** Track 2 lands
  non-virtualized with a temporary one-shot on-join pin before the controller exists;
  tracks land in order on a worktree; nothing ships until the plan completes.
- **User scrolled up, new turn arrives** (core case) — **ADDRESSED** by Track 3
  (intent disengage + `hasUnseenContent` button emphasis) and the Track 1 `scroll-up`
  + button scenarios.

## NOT in scope

- **Generalizing the controller for non-chat lists.** Only chat has the streaming/pin
  problem; premature generalization violates "don't add features beyond what the task
  requires."
- **Virtualization of any kind**, including re-adding it. Pagination is the
  large-thread strategy. A genuinely unbounded single page would be a new plan.
- **`content-visibility:auto`** in v1 (codex #7) — deferred to a perf-evidence
  follow-up; the `HISTORY_TAIL` lever comes first.
- **`column-reverse` / `scaleY(-1)` layouts** — rejected (Firefox overflow + a11y).
- **Reworking the chat state machine** beyond extending `runFakeStream`. The
  `streaming`/`refreshing` states stay; the flash fix (Track 4) is a keying change in
  the view.
- **Speech/TTS, lightbox, companion-card scroll** — untouched except where they
  consume the new `scrollToBottom`.
- **A general Playwright stack** — `bin/browse` + `/fakestream` is the convention
  (`docs/testing.md:474-521`).

## Open design questions

- **Does the flash survive de-virtualization?** (Track 4.) A *measurement*, not a
  design call — the harness answers it before the keying fix is designed.
- **Keep `USER_SCROLL_WINDOW_MS` after Track 3?** *Lean:* keep through device
  verification, remove only if the intent-based controller proves it redundant on real
  iOS. Inside Track 5, not a blocker.
- **Button emphasis treatment** (color shift vs. bg-opacity vs. a count/dot). *Lean:*
  start with a bg-opacity/color shift + a small dot; no unread *count* in v1 (we don't
  cheaply know message count delta, only "something arrived"). A pure appearance
  choice — settle in implementation with frontend.md primitives.
- *(Resolved)* Controller approach: in-repo, not a dependency ladder (codex #1).

## Knowledge audits

**Skip, with rationale.** No box-agent-facing concept — no card type, tag,
convention, or "how to do X" rule a box agent must recall. The new developer-facing
affordances (extended `/fakestream` scenarios; the `chat-scroller` test id) belong in
`docs/testing.md` (developer reference), not `knowledge-audits.yaml` (which tests what
a *box* agent knows). No audit entry warranted.

## Implementation order

1. **Track 1 Chunk 0** — primitive de-risk (`mouse wheel` drives disengage; `eval`
   reads geometry) + `scroll-up` scenario; capture baseline. (Commit.)
2. **Track 1 remainder** — `stream-while-pinned`, `finalize`, `join` scenarios +
   jitter/backward-scroll assertion; baseline table. (Commit.)
3. **Track 2 chunk 1** — non-virtualized list, pagination prepend preservation,
   sentinel, `data-testid="chat-scroller"`, temporary one-shot on-join pin; update
   `docs/testing.md` (scroller id + the `chat-actors.ts` location fix). (Commit.)
4. **Track 3 controller** — in-repo `useStickToBottom` (content+scroller observers);
   streaming/scroll-up/finalize scenarios green on Chrome. (Commit.) Depends on 1–3.
5. **Track 3 button** — floating scroll-to-bottom button + unseen-content emphasis;
   button scenario green. (Commit.) Depends on 4.
6. **Track 4** — finalize-flash measurement; keying fix only if it survives. (Commit.)
   Depends on 3–5.
7. **Track 5** — `visualViewport` keyboard, fling-safe scroll, overscroll; device
   verification. (Commit.) Depends on 4.
8. **Cleanup** — remove `react-virtuoso` (`package.json:102`) once unused
   (`pnpm lint:knip`); ensure files < 300 lines; the deferred `late-card`/fling
   scenarios documented as follow-ups. (Commit.)

The plan completes when the harness table shows every expressible defect fixed on
Chrome and the device pass is clean. Shipping (merge to `main`) is a separate explicit
boxholder signal (per `cb-plan`), not agent-triggered.

## Rollout shape

- **Test posture.** Tests-first as a design tool (`docs/testing.md:5-9`): Track 1 is
  authored before the rewrite and run against current code, so each defect's done-when
  is a concrete harness assertion (e.g. "in `scroll-up`, after a real `mouse wheel`
  up, `scrollTop` never returns toward bottom until the button is clicked"). Six
  expressible scenarios + the prepend-anchor + button assertions; `late-card`/fling
  deferred (documented). `buildDataItems`/`dataItemKey` have **no** existing doctests
  (codex #6) — if Track 4 changes `dataItemKey`, add a focused doctest for the new
  keying then (forcing-decomposition purpose), not blanket coverage. DOM-geometry
  behavior stays in the `bin/browse` harness, not doctests (`docs/testing.md:476`).
- **Doc fixes that land with the work:** `docs/testing.md:484` (`chatMachine.ts` →
  `chat-actors.ts:96`) and `:505` (`virtuoso-scroller` → `chat-scroller`) — both
  stale today; corrected in Track 2's commit.
- **Knowledge-audit entries.** None (see Knowledge audits).
- **Migration.** No data-shape change. The code migration (Virtuoso → own container)
  is staged across commits on the worktree, all landing before completion — no
  partial-ship.
- **Dependency change.** `react-virtuoso` removed (step 8); **no new runtime
  dependency** — the controller is in-repo (`use-stick-to-bottom` is a cited
  reference, not installed). Verified by `pnpm lint:knip` before completion.
