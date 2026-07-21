# Chat scroll — manual test procedure

The chat message list's scroll behavior (follow-the-bottom, scroll-up-to-detach,
the scroll-to-bottom button, hold-position-when-content-loads-above) is layout
behavior that doctests can't exercise (`docs/testing.md` §6). This is the
repeatable procedure for verifying it in a real browser via `bin/browse`, plus
the device-only checklist for the parts a headless Chromium can't reach.

Run this after touching `InteractiveChat-scroll.ts` (the `useStickToBottom`
controller), `InteractiveChat-messages.tsx` (the list/button), or the
`/fakestream` stub.

## Setup

1. Dev router running (`bin/worktrees serve` / `pnpm dev` at the monorepo root).
2. Open a fresh chat and get the composer's element ref (it changes on reload):

   ```bash
   bin/browse open "/chat?session=new"
   CREF=$(bin/browse snapshot | grep -i textbox | grep -oE 'ref=e[0-9]+' | head -1 | cut -d= -f2)
   echo "composer ref: $CREF"     # used as @e$CREF below
   ```

3. The scroll container is `[data-testid="chat-scroller"]`; its inner content
   wrapper is `.max-w-5xl`. The measurement primitive is the
   distance-from-bottom:

   ```js
   const s = document.querySelector('[data-testid="chat-scroller"]');
   Math.round(s.scrollHeight - s.scrollTop - s.clientHeight);   // 0 == pinned to bottom
   ```

## `/fakestream` vs a real turn

- **`/fakestream [chunks] [intervalMs] [chunkLen]`** streams deterministic text
  with **no backend** — ideal for the scroll mechanics. It short-circuits before
  the agent, so it finalizes via the synthetic `rollupStreamToEntry` path, **not**
  the real `reconcilePending` path. It cannot test the real finalize.
- **A real turn** (any normal message) exercises the genuine streaming +
  `reconcilePending` finalize. The agent is **slow to cold-start** (the first
  turn can take 20–30s to produce any output — `scrollHeight` sits flat until it
  does; that's the agent spinning up, not a scroll bug). Subsequent turns are
  fast. Run at least one real turn for the finalize check.

## Scenarios (desktop Chrome via `bin/browse`)

### 1. Join pins to bottom
Open a chat with history; the first settled frame must be at the bottom.
```bash
bin/browse open "/chat?session=<existing-session-with-history>"
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");return Math.round(s.scrollHeight-s.scrollTop-s.clientHeight);})()'
# expect ~0
```

### 2. Follow while streaming
From the bottom, stream and sample — `fromBottom` must stay ~0 as `scrollHeight` grows.
```bash
bin/browse fill "@e$CREF" "/fakestream 300 25 25"; bin/browse press Enter
# sample a few times: each should print ~0
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");return Math.round(s.scrollHeight-s.scrollTop-s.clientHeight);})()'
```

### 3. Scroll-up during streaming must NOT yank back
**Use a real `WheelEvent`** — a bare `scrollTop` write is intentionally ignored
(the controller only disengages on genuine wheel/touch/key intent), and
agent-browser's `mouse wheel` doesn't scroll headless Chromium.
```bash
bin/browse fill "@e$CREF" "/fakestream 400 25 25"; bin/browse press Enter
sleep 1
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");s.dispatchEvent(new WheelEvent("wheel",{deltaY:-150,bubbles:true}));s.scrollTop-=900;return "up";})()'
# sample repeatedly: fromBottom must GROW (content arrives below) and never snap back to 0
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");return Math.round(s.scrollHeight-s.scrollTop-s.clientHeight);})()'
```

### 4. Scroll-to-bottom button
While detached (scenario 3), the button must be present and accented; clicking returns.
```bash
bin/browse eval '(()=>{const b=document.querySelector("button[aria-label=\"Scroll to latest messages\"]");return JSON.stringify({btn:!!b,emph:!!(b&&b.querySelector("span"))});})()'
# expect {btn:true, emph:true}  (emph = unseen content arrived since detaching)
bin/browse click "button[aria-label='Scroll to latest messages']"
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");const b=document.querySelector("button[aria-label=\"Scroll to latest messages\"]");return JSON.stringify({fb:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),btn:!!b});})()'
# expect {fb:0, btn:false}
```

### 5. Content loading above must NOT shift the view (image/embed/card)
The regression for async-resizing embeds. Build tall content, detach to the
middle, let the anchor capture, inject a tall block **above** the viewport, and
measure a visible element's shift. Must be ~0 (was ~300 before the fix).
```bash
for n in 1 2 3; do bin/browse fill "@e$CREF" "/fakestream 200 12 30"; bin/browse press Enter; sleep 3.5; done
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");const c=s.querySelector(".max-w-5xl");s.dispatchEvent(new WheelEvent("wheel",{deltaY:-150,bubbles:true}));s.scrollTop=Math.round((s.scrollHeight-s.clientHeight)*0.5);const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return raf().then(()=>{const scTop=s.getBoundingClientRect().top;let ref=null;for(const ch of c.children){const r=ch.getBoundingClientRect();if(r.top>scTop+50){ref=ch;break;}}const before=ref.getBoundingClientRect().top-scTop;const sp=document.createElement("div");sp.style.height="300px";sp.dataset.testSpacer="1";c.insertBefore(sp,c.children[1]);return raf().then(()=>{const after=ref.getBoundingClientRect().top-scTop;sp.remove();return JSON.stringify({shift:Math.round(after-before)});});});})()'
# expect {shift:0}
```

### 5b. A finalize/content shrink must not re-pin a scrolled-up reader
When a turn finalizes shorter than its streamed form (or any content shrinks
below the reader's position), the browser *clamps* `scrollTop` to the new
bottom. That clamp must NOT re-engage following — otherwise the next growth (a
late image/embed) yanks the reader down. Detach to *near* the bottom, shrink the
last item, then grow it:
```bash
# detached near bottom (fb ~150), button present:
bin/browse eval '(()=>{const s=document.querySelector("[data-testid=chat-scroller]");s.dispatchEvent(new WheelEvent("wheel",{deltaY:-150,bubbles:true}));s.scrollTop=s.scrollHeight-s.clientHeight-150;return "up";})()'
# shrink the last item 300px (forces a clamp), then assert the button stays:
bin/browse eval '(()=>{const c=document.querySelector("[data-testid=chat-scroller] .max-w-5xl").lastElementChild;c.style.height=(c.getBoundingClientRect().height-300)+"px";c.style.overflow="hidden";return "shrank";})()'
# button must STILL be present (not re-pinned); then grow +400 and fromBottom must NOT be ~0
bin/browse eval '(()=>{const b=document.querySelector("button[aria-label=\"Scroll to latest messages\"]");return "btn="+!!b;})()'   # expect btn=true
```

### 5c. Loading older history must NOT flag "new messages"
Regression for the false down-arrow badge on scroll-up. Open a chat with enough
history to paginate (a "Show N earlier messages" button at the top), scroll up,
click it, and let the older block settle. The button must appear (you're
detached) but must **not** take its accented "new messages" state — old history
prepended above the viewport is not new content below the reader. The pure
decision is unit-checked in `test/frontend/chat-scroll-reconcile.doctest.md`
(`prepend` → `hold-prepend`, never `flag-unseen`); this scenario confirms the
DOM path.
```bash
bin/browse open "/chat?session=<session-with-paginated-history>"
# scroll up to reveal the "Show N earlier messages" button, then click it:
bin/browse click "text=Show"
sleep 1
bin/browse eval '(()=>{const b=document.querySelector("button[aria-label=\"Scroll to latest messages\"]");return JSON.stringify({btn:!!b,emph:!!(b&&b.querySelector("span"))});})()'
# expect {btn:true, emph:false}  — present (detached) but NOT accented (no new content)
```
Contrast: a genuinely new message arriving while scrolled up *must* still flag —
re-run scenario 3 to confirm the down-arrow still lights for a real append.

### 6. Real-turn finalize (no flash)
Send a real message and watch the streamed bubble become the finalized message
with no flash/jump. A per-frame recorder helps, but note its `flashed` flag goes
true on *subsequent* turns from the legitimate turn-start throbber (an empty
streaming bubble before the first tokens), not a finalize vanish — confirm the
empty frame's content is the `ldrs` Grid spinner, not a real disappearance.
The machine swaps streamText→entry in one atomic `assign`, so a single-turn
fresh chat shows no flash.

## Device-only checklist (real iPhone — Chromium can't emulate these)

- **Keyboard:** focus the composer; it must stay above the on-screen keyboard
  (`.h-app` tracks `visualViewport`), and the list must re-pin to the bottom when
  the keyboard opens/closes if it was pinned.
- **Momentum fling:** flick-scroll up during streaming — must not fight the
  finger or snap back (fling-safety is not yet implemented; watch for jumps).
- **Rubber-band:** overscroll at top/bottom must not scroll the page behind
  (`overscroll-behavior: contain`, iOS 16+).
- **Retina:** confirm "at bottom" still registers at `devicePixelRatio` 2
  (the ~70px near-bottom margin should absorb sub-pixel rounding).
