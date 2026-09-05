---
title: "Sidecar shell: survive a transient failure, keep tabs, pin one"
status: active
workstream: sidecar-shell
issues:
  - ../../../issues/bugs/2026-08-31-card-sidecar-stays-failed-after-transient-502.md
  - ../../../issues/bugs/2026-08-29-new-tab-not-scrolled-into-view.md
  - ../../../issues/features/2026-08-30-pin-a-sidecar-tab.md
---
# Sidecar shell: survive a transient failure, keep tabs, pin one

The companion panel beside chat — the sidecar — holds the documents you open
while you talk. Three of its defects share one owner: it throws away a loaded
card when a background refetch fails, it does not scroll a newly opened tab
into view, and it cannot keep a tab. This plan fixes the three together
because the last two are the same state (`useChatTabs`) and the first is the
shell that renders inside it.

The jobs, concretely. When the box restarts under an open sidecar, I want the
card I was reading to stay on screen and come back by itself, so I do not lose
my place to a thirty-second outage. When I open a document while several are
already open, I want to see the tab I just opened, so I know the click worked.
When I am working out of one document and opening others beside it, I want to
keep that one, so it is still there ten opens later.

**Issues addressed:**
[card-sidecar-stays-failed-after-transient-502](../../../issues/bugs/2026-08-31-card-sidecar-stays-failed-after-transient-502.md),
[new-tab-not-scrolled-into-view](../../../issues/bugs/2026-08-29-new-tab-not-scrolled-into-view.md),
[pin-a-sidecar-tab](../../../issues/features/2026-08-30-pin-a-sidecar-tab.md).

Grepped the queue for adjacent items (`sidecar`, `companion`, `tab`, `panel`,
`persist`, `sessionStorage`, `502`, `reconnect`, `stale`, `scroll`). Related but
NOT resolved here:
[sticky-hq-transcription-preference](../../../issues/features/2026-08-26-sticky-hq-transcription-preference.md)
(the per-viewer-preference precedent question the pin issue points at — Track C
answers it for tabs only, and says why the answer does not generalize),
[todos-inline-things-to-think-about](../../../issues/features/2026-08-30-todos-inline-things-to-think-about.md)
(the companion-context surface; untouched),
[chat-scroll-still-bad-after-rewrite](../../../issues/bugs/2026-09-04-chat-scroll-still-bad-after-rewrite.md)
(chat transcript scrolling, a different scroller). Closed as wontfix during this
workstream and explicitly not revived:
[chat-card-panel-missing-landmark-context](../../../issues/closed/bugs/2026-08-30-chat-card-panel-missing-landmark-context.md).

## Stated preferences this plan trades against

- **Principle 13** (*a control shows the state the system is in, never the one
  it intends*): the sidecar currently shows "this card is broken" when the truth
  is "this copy is a minute old and the last refresh failed". Track A is
  principle 13 applied to a data view.
- **Principle 4** (*resilient AND never silent*): keeping the last good card
  through a failed refetch is resilience; doing it without saying so would be
  the silent half. The stale state is displayed, not swallowed.
- **Principle 10** (*testability is architectural*): the risky parts of all
  three tracks are decisions — which of (data, error, stale) to show, which tab
  to evict, what to restore from storage. Each is extracted as a pure function
  so the doctest tier reaches it, per `docs/testing.md`'s tier table.
- **Principle 3** (*validate at boundaries and during parsing*): the restored
  tab list comes off `sessionStorage` as untyped JSON and is validated at the
  parse boundary, following `lib/location-share.ts:68-100`.
- **Principle 8** (*one way to do each thing*): the persisted tab target reuses
  `serializeViewUrl`/`parseViewUrl` — the same string the `?card=` param already
  carries — rather than inventing a second serialization of a `ViewTarget`.
- **beebox/CLAUDE.md**, no features beyond the task: Track A changes the retry
  policy for the file-view queries only, not the app-wide QueryClient default.
- **Most recent shipped precedent**: `lib/last-chat.ts` for a `sessionStorage`
  slice ("per tab, per box, and deliberately not durable"), and
  `components/chat/chat-scroll-ease.ts:78-82` for the reduced-motion idiom.

## What already exists

- `components/FileView.tsx:88-186` — `useFileData`, the shared loader for every
  file surface (chat, companion, browse, page). Card data via
  `trpc.card.get.useQuery` (`:100`), text via a `useQuery` over
  `/api/files/*` (`:106`). **Reuse, change the return contract.** The defect is
  one line: `:162` — `if (cardError) return { data: null, loading: false, error: cardError.message };`
  — the error is checked before the cached `card`, and `:181` is the same for
  text.
- `lib/trpc/provider.tsx:11` — `queries: { staleTime: 5000, retry: false }`.
  **Reuse; do not change globally.** `retry: false` is why one failed refetch is
  terminal for the query.
- `components/FileView.tsx:124-157` — the existing recovery path: `resync()`
  invalidates the card query, fired on a matching `file-change` bus event and on
  a bus *re*connect (`useDeferredResync`, coalesced and deferred while hidden).
  **Reuse.** It works when it fires; the bug is that nothing fires it after a
  refetch that failed while the page stays open and focused.
- `components/chat/InteractiveChat-controls.tsx:160-207` — the sidecar tab strip
  (`#bbx-panel-tabs`, `role="tablist"`, `overflow-x-auto`), and `:212-256` the
  mounted tabpanels. **Reuse.** Note the issue names
  `components/ui/TabBar.tsx` as the file to fix; that component is used only by
  `renderers/gsheet.tsx` and `pages/inventory/components/InventoryContent.tsx`
  and has nothing to do with the sidecar. The issue's diagnosis is wrong on the
  file and right on the symptom.
- `components/chat/InteractiveChat-hooks.ts:25-67` — `useChatTabs`: the whole
  tab state, `{ tabs: PanelTab[]; activePath: string | null }` in one
  `useState`. **Rebuild as a pure reducer + hook wrapper**, because pinning,
  eviction, and restore are decisions that must be testable (principle 10) and
  because the current shape has no place to put per-tab flags.
- `components/chat/InteractiveChat-card-hooks.ts:33-68` — `useCardUrlPersistence`:
  round-trips the **active** tab through `?card=`, restore-once guarded.
  **Reuse unchanged**; Track C adds a second store beside it, and the URL keeps
  winning for the active card.
- `lib/last-chat.ts:36-58` — the `sessionStorage` precedent: key
  `bbx:last-chat:${boxSlug}`, `sessionStore()` returns `null` rather than
  throwing when storage is unavailable. **Reuse the shape and the key
  convention.**
- `hooks/usePersistScheduler.ts:26,53` — debounced persistence (400 ms,
  flush on visibility-hide and unmount) already used by the dictation draft and
  the emission store. **Reuse** for the tab-list writes.
- `components/PdfPageStrip.tsx:36` — `target.scrollIntoView({ block: "nearest", inline: "center" })`,
  the existing horizontal-strip precedent. **Reuse the call shape**, with
  `inline: "nearest"` (see Track B).
- `components/chat/chat-scroll-ease.ts:78-82` — the house reduced-motion idiom:
  `window.matchMedia("(prefers-reduced-motion: reduce)").matches` → instant
  write, else the eased path. **Reuse.**
- `components/ui/Badge.tsx` / `StatusBadge.tsx` — the visual primitive for a
  small state marker (`tone`: info/warning/success/accent/neutral). **Reuse**
  for the stale marker.
- Searched for a generic "stale data" or "reconnecting" indicator and **found
  nothing**: the app has `toastError` (`components/ui/toast-store.ts`) for
  transient failures, `RouteError.tsx` for a crashed route, and a connection dot
  in `components/dashboard/HeaderStrip.tsx:80-83`. A per-view stale marker is
  new UI; it is built from `Badge`, not from a new primitive.
- Searched for an existing tab cap or eviction anywhere in the sidecar and
  **found nothing**: `useChatTabs` appends without limit
  (`InteractiveChat-hooks.ts:38-42`). The pin issue's "whatever tab-limit/eviction
  logic exists must never evict a pinned tab" describes logic that does not
  exist yet.

### Verified behaviour (not inferred)

Reproduced in the running app on 2026-09-05 with `bin/browse` against
`/sidecar-shell/test1/chat?card=_content/courses/Acids_Bases.attach/Acids_Bases_Lesson_Plan.lesson-plan.card`,
patching `window.fetch` to answer `card.get` with a real `502 Bad Gateway`:

1. One failed background refetch replaces the rendered card with
   `Error loading courses/…/Acids_Bases_Lesson_Plan.lesson-plan.card` — the
   card had loaded seconds earlier. Confirms the `:162` precedence bug.
2. The user-visible message is not even the 502: it is
   `Failed to execute 'json' on 'Response': Unexpected token 'B', "Bad Gateway" is not valid JSON`,
   because `httpBatchStreamLink` parses the gateway's HTML/text body as JSON.
   A person reading that cannot tell it is an outage.
3. With the fault removed and the server healthy, the panel stayed in the error
   state for 30 s of idle with **zero** refetch attempts. Confirms "never
   recovers".
4. Dispatching a `visibilitychange` (React Query's focus trigger) recovered it
   immediately. So the recovery machinery is sound; the failure is that no
   trigger fires while the person keeps looking at the page — exactly the
   reported situation.
5. Stopping this worktree's processes (`bin/workstreams down sidecar-shell`) did
   **not** by itself produce the failure: nothing refetched during the outage,
   and the card stayed. The failure needs a refetch that lands inside the outage
   window — a bus reconnect, a `file-change`, or a focus — which is why it reads
   as intermittent.

## Prior art (external)

- TanStack Query keeps the previous `data` when a background refetch fails and
  exposes `isRefetchError` precisely to distinguish that from a failed first
  load ([useQuery reference](https://tanstack.com/query/v5/docs/react/reference/useQuery),
  [migrating to v5](https://tanstack.com/query/v5/docs/framework/react/guides/migrating-to-v5)).
  Track A's fix is the library's intended shape, not a workaround: read
  `isLoadingError` vs `isRefetchError` instead of a bare `error`.
- The upstream discussion "Don't clear error while failed query is refetching"
  ([#6910](https://github.com/TanStack/query/discussions/6910)) confirms the
  error/data interplay is a known sharp edge callers are expected to resolve
  themselves.
- The pattern has a name — **stale-while-revalidate**: serve the cached copy,
  revalidate behind it, mark it as not-fresh. Named so the code comment can
  point at the pattern rather than re-explain it.
- Searched for prior art on scrolling an active tab into view inside a
  horizontal strip and **found nothing worth citing**: `Element.scrollIntoView`
  with `inline: "nearest"` is the platform answer, and the repo already uses it
  (`PdfPageStrip.tsx:36`). The one gotcha worth naming is that `scrollIntoView`
  walks *every* scrollable ancestor, which is what `block: "nearest"` is for.
- Browser pinned-tab behaviour (Chrome/Firefox) is the familiar model the issue
  cites: pinned tabs sort first, shrink to their icon, and do not scroll with
  the rest. Track C takes the sort-first and never-evict halves and drops the
  shrink-to-icon half (a beebox tab's label is its only identity — there is no
  favicon).

## Tracks / scope

Ordered by dependency: Track A is independent and is the important issue; Track
B is small and is the substrate Track C's ordering rides on; Track C is the
largest and needs B's scroll behaviour to be defined first.

### Track A — a failed refresh must not take the card away

**What.** `useFileData` keeps showing the last successful load when a
*background* refetch fails, marks that copy as not-fresh, retries a bounded
number of times by itself, and offers one explicit retry when it gives up. An
error still replaces the view when there is nothing to show — a first load that
fails is still an error.

**Why this needs to change.** Verified above: one 502 during a server restart
discards a card the person was reading, shows them a JSON parse error, and
leaves the panel dead until they click away and back. Every part of that is
wrong: the content was in memory, the message named the wrong problem, and the
recovery existed but was never triggered.

**Direction.**

`useFileData`'s `LoadResult` gains one field and changes one precedence rule:

```ts
interface LoadResult {
  data: FileData | null;
  loading: boolean;
  /** Set only when there is nothing to show: a first load that failed. */
  error: string | null;
  /** Set when `data` is a previous load and the newest refresh failed. */
  staleSince: { message: string; failedAt: number } | null;
}
```

The decision moves out of the hook into a pure function so the doctest tier
reaches it (principle 10):

```ts
// lib/file-load-state.ts
export function resolveLoadState<T>(q: {
  data: T | undefined;
  isLoading: boolean;
  isLoadingError: boolean;   // first load failed — nothing cached
  isRefetchError: boolean;   // refresh failed — cached copy stands
  error: { message: string } | null;
}): { value: T | null; loading: boolean; error: string | null; stale: string | null }
```

`useFileData` calls it once for the card query and once for the text query; the
`isCard` / `isDir` / `isBinary` / `isJson` branching at
`components/FileView.tsx:158-186` stays as it is.

Retry policy, scoped to these two queries only:
`retry: (count, err) => count < 3 && isTransient(err)` with React Query's
default exponential backoff (~1 s, 2 s, 4 s). `isTransient` is another pure
function: a transport failure or a 5xx is transient; a tRPC `NOT_FOUND`
(the `Card not found:` case `FileView.tsx:316` already special-cases) is not,
and must not be retried three times before the missing-card state appears.

Stranding, per *nothing retries forever*: after the three attempts the query
stops. The panel keeps the card, shows the stale marker, and the marker carries
a **Refresh** button that refetches. The existing triggers (`file-change`,
bus reconnect, window focus) still clear it whenever they fire first. No polling
timer is added — see *Could this be simpler?*.

**Verified after the fact, because it is the issue's central requirement:** a
real box restart under an open, stale sidecar recovers on its own. Stopping the
worktree drops the tRPC WebSocket; when the box comes back the subscription
restarts, `FileView`'s existing `onConnect` resync invalidates the card query,
the refetch succeeds, and the marker clears with no click and no reload. So the
stranded state needs a narrower failure than "the box restarted": HTTP has to
fail while the WebSocket never drops, and stay failed until the person acts. The
Refresh button is the backstop for that, and a hard load failure now carries the
same **Try again** so a card opened *during* an outage is not a dead end
either.

The marker itself: a `Badge tone="warning"` reading **Not up to date** with the
failure as its `title`, rendered by `FileView` above the renderer output in
every mode, so a card in chat, in the sidecar, and on the card page all report
the same state (principle 13; one way to do each thing, principle 8).

**Vocabulary lock-ins.** `staleSince` on `LoadResult`; the pure functions
`resolveLoadState` and `isTransientQueryError` in `lib/file-load-state.ts`; the
user-facing words **Not up to date** and **Refresh**.

**First implementation chunk.** `lib/file-load-state.ts` with both pure
functions and `test/frontend/file-load-state.doctest.md` covering: first-load
failure → error; refetch failure with cached data → value + stale; recovery →
neither; a `NOT_FOUND` is not transient; a 502 and a network failure are. No UI
in this chunk.

### Track B — the active tab scrolls itself into view

**What.** When the active tab changes, the strip scrolls it into view. Applies
to opening a document, to `?card=`/`?companion=` deep links, and to any other
route that activates a tab.

**Why this needs to change.** With more open documents than the strip can show,
the new tab lands outside the visible range, so the click appears to do nothing
(`InteractiveChat-controls.tsx:165` — the strip is `overflow-x-auto` and nothing
ever scrolls it).

**Direction.** A `Map<string, HTMLElement>` of tab refs in
`CompanionViewPanelInner`, and an effect on `activePath`:

```ts
const el = tabRefs.current.get(activePath);
el?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
```

`block: "nearest"` because `scrollIntoView` walks every scrollable ancestor and
the fixed chat shell must not move; `inline: "nearest"` because a tab already
in view must not be re-centred (the churn the pin issue warns about).
`prefersReducedMotion()` is the existing `matchMedia` check, extracted from
`chat-scroll-ease.ts:78` to a shared `lib/reduced-motion.ts` and used by both
(principle 8 — there should not be two copies of this predicate).

One interaction with Track C is easy to miss: `scrollIntoView` knows nothing
about occlusion, so a pinned tab made `position: sticky` at the left edge would
leave a tab sitting *behind* it counted as "in view" and never scrolled to.
**Built instead as two scrollers** — a pinned group and the rest, inside one
`role="tablist"` with `role="none"` wrappers — which makes "pinned tabs stay
put" true by construction and leaves nothing for the scroll code to special-case
(`InteractiveChat-controls.tsx`, `SidecarTabStrip`).

A second timing problem showed up only in the running app: on a restored strip
the pane's width is not settled when the effect first runs, so every tab
measures as visible and nothing scrolls. A `ResizeObserver` on the scroller
re-runs the reveal, and the reveal returns early when the active tab is already
visible, so a resize cannot churn.

**Vocabulary lock-ins.** `lib/reduced-motion.ts` exporting
`prefersReducedMotion(): boolean`.

**First implementation chunk.** The extraction plus the effect, verified with
`bin/browse` on a strip with more tabs than fit.

### Track C — pinned tabs, a persisted strip, and a cap

**What.** A tab can be pinned. Pinned tabs sort first, cannot be evicted, and
stay visible while the rest of the strip scrolls. The whole strip survives a
reload within the same browser tab. Unpinned tabs above a cap are evicted
least-recently-active-first.

**Why this needs to change.** Three connected gaps. There is no way to keep a
document open while others come and go. The strip is lost entirely on reload —
only the active card returns, via `?card=`. And once the strip *does* survive a
reload, an unbounded list (`InteractiveChat-hooks.ts:38-42` appends forever)
comes back as thirty tabs, which is when a cap stops being hypothetical.

**Direction.**

`useChatTabs` splits into a pure reducer and a thin hook:

```ts
// components/chat/sidecar-tabs.ts
export interface SidecarTab { target: ViewTarget; label: string; pinned: boolean; lastActiveAt: number }
export interface SidecarState { tabs: SidecarTab[]; activePath: string | null }
export type SidecarAction =
  | { type: "open"; target: ViewTarget; label: string; at: number }
  | { type: "select"; path: string; at: number }
  | { type: "close"; path: string }
  | { type: "togglePin"; path: string }
  | { type: "closeAll" }
  | { type: "restore"; state: SidecarState };
export function sidecarReducer(state: SidecarState, action: SidecarAction): SidecarState;
```

Ordering is a property of the reducer, not of the render: `tabs` is kept
pinned-first, and within each group in insertion order. Eviction happens inside
the `open` case — when the unpinned count would exceed `MAX_UNPINNED_TABS`, the
unpinned tab with the smallest `lastActiveAt` that is not the active tab is
dropped. Pinned tabs are never counted against the cap and never dropped.

Persistence, following `lib/last-chat.ts`:

- `sessionStorage`, key `bbx:sidecar-tabs:${boxSlug}:${chatSessionId}` — per
  browser tab, per box, per conversation. `sessionStorage` because the open
  strip is a property of this tab's trip through the app, exactly the reasoning
  at `lib/last-chat.ts:12-16`; two chats open in two browser tabs must not
  fight over one slot, which a `localStorage` key would guarantee.
- Written through `usePersistScheduler` (400 ms debounce, flush on hide and
  unmount), so a burst of opens is one write.
- Read once on mount, through a validating parse (principle 3): each entry must
  re-parse as a `ViewTarget` via `parseViewUrl` of its stored `view:` string;
  anything malformed drops that entry, not the whole strip. A storage read that
  throws returns `null` and the sidecar starts empty, as today.
- The session id comes from `sessionInput` — an existing id or the literal
  `"new"` (`components/chat/InteractiveChat.tsx:61-78`) — and a fresh chat
  learns its real id later through `onSessionAssignment`
  (`components/chat/InteractiveChat.tsx:134`). So the key is available on
  mount in both cases, and the `"new"` → assigned-id move is a rename of one
  storage entry on that callback, not a design gap (open question 2).
- **Restore order is part of the contract**, because three things want to set
  the active tab on mount. Restore runs first and only populates the strip; then
  `useCardUrlPersistence`'s restore-once effect
  (`InteractiveChat-card-hooks.ts:44-51`) activates `?card=`; then
  `useCompanionDeepLink` (`InteractiveChat-hooks.ts:82-106`) opens `?companion=`
  and activates it, which is correct — a deep link is an explicit instruction
  and outranks what the strip happened to hold. A `?card=` or `?companion=`
  naming a document not in the restored list opens it as a new tab. Restore must
  never write to the URL; only `useCardUrlPersistence` does, and it is untouched.

Affordance: the pin control lives in the tab, left of the close button, and is
shown on hover/focus or always when pinned — matching where the close button
already is (`InteractiveChat-controls.tsx:190-204`). A pinned tab keeps its
label (no shrink-to-icon: there is no favicon) and is marked with the pin glyph.
Pinned tabs render in their own scroller ahead of the rest (see Track B), which
keeps them out of the scroll-into-view churn with no special case in the scroll
code.

**Vocabulary lock-ins.** `SidecarTab` / `SidecarState` / `SidecarAction` and
`sidecarReducer` in `components/chat/sidecar-tabs.ts`; the storage key
`bbx:sidecar-tabs:${boxSlug}:${chatSessionId}`; `MAX_UNPINNED_TABS`; the
user-facing verbs **Pin tab** / **Unpin tab**.

**First implementation chunk.** `components/chat/sidecar-tabs.ts` (reducer only,
no storage, no UI) plus `test/frontend/sidecar-tabs.doctest.md`, and
`useChatTabs` rewritten to call it with identical outward behaviour — pinning
and eviction reachable but unused. This chunk changes no pixels.

## Could this be simpler?

**The simplest version of Track A** is one line: swap the order at
`FileView.tsx:162` so cached data wins over the error, and stop there. That
alone fixes the reported symptom's worst half — the card no longer vanishes —
and costs nothing. What the fuller plan buys: without the stale marker the panel
would show a card that is silently out of date, which is invisible degradation
(principle 4) and a control wearing the wrong face (principle 13); without a
bounded retry the copy stays stale until the person happens to click away and
back, so the issue's second requirement ("must retry or invalidate after
connectivity returns") is unmet. The marker and the retry are the two additions;
everything else is refactoring the decision into a testable shape.

**The simplest version of Track C** is pinning alone, in memory, no persistence
and no cap — perhaps twenty lines. The boxholder asked for persistence
explicitly, and the simple version fails on the concrete case that prompted it:
a reload during a conversation loses every open document but one. The cap is the
piece with the weakest case; it exists only because persistence makes an
unbounded strip durable. It is one branch in the reducer that the doctest covers
anyway, so its marginal cost is small — but it is the first thing to cut.

**Rejected as over-built:** a polling retry timer (a `setInterval` that refetches
a failed card every 30 s). It defends a window that focus, `file-change`, and bus
reconnect already close, and it would fetch forever on a permanently broken box.
Also rejected: lifting `retry` to the global QueryClient default — that changes
every query in the app to fix two, which is a bigger blast radius than the task
(beebox/CLAUDE.md, no features beyond the task). Also rejected: a generic
`usePersistedState` hook — there would be one caller, and the repo's own
convention is that each feature owns its key (`lib/dictation-draft.ts`,
`lib/location-share.ts`, `lib/last-chat.ts`).

## Subplans

None. Each track is one surface with a settled shape; the only cross-track
dependency is B's scroll behaviour feeding C's sticky pinned tabs, which is one
paragraph, not a design step.

## Failure modes

> **Critical gap:** `resolveLoadState` returning stale content with no marker
> rendered — if the marker is dropped or the badge fails to render, the sidecar
> silently shows an out-of-date card, which is strictly worse than today's loud
> error. Closed by making the marker part of the same doctest as the state
> function (the function returns the marker text; a null return means no
> staleness) and by a `bin/browse` check in the rollout.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Refetch fails, cached card kept, marker not rendered | yes — `file-load-state.doctest.md` returns the marker text | yes — marker is the function's output, not a separate branch | would be silent; that is why it is tested |
| A `NOT_FOUND` card is retried 3× before showing the missing-card state | yes — `isTransientQueryError` case | yes — non-transient errors are not retried | clear (a 4 s delay before a correct state) |
| Retries exhausted and the box is genuinely down for minutes | no automated test (needs a real outage) | yes — stale card + **Refresh** button; focus/reconnect still recover | clear |
| A 502 body reaches the person as a JSON parse message | yes — `isTransientQueryError` maps it to "the box did not answer" | yes — marker text is our words, not the parser's | clear |
| `sessionStorage` throws (private mode, blocked storage) | yes — parse/store doctest with a throwing stub | yes — `sessionStore()` returns `null`, sidecar starts empty | clear (behaves as today) |
| Stored tab list contains a path whose card was deleted meanwhile | yes — restore doctest keeps the entry | yes — the tab restores and shows the existing `MissingCardState` | clear |
| Stored blob is from an older shape (field added later) | yes — parse doctest with an unknown/missing field | yes — per-entry validation drops bad entries, keeps good ones | clear |
| Eviction drops the tab the person is actively reading | yes — reducer doctest asserts the active tab is never evicted | yes — the active path is excluded from eviction candidates | clear |
| Every tab pinned, cap can never be satisfied | yes — reducer doctest | yes — pinned tabs are not counted; the strip grows | clear (their choice) |
| `scrollIntoView` scrolls the chat shell instead of the strip | no unit test (DOM behaviour) | yes — `block: "nearest"` | visible immediately in `bin/browse` |
| Two browser tabs on the same chat write the same key | n/a | yes — `sessionStorage` is per browser tab by definition | n/a |
| Restore fights `?card=` and flips the active tab on load | yes — restore doctest asserts URL wins | yes — restore-then-activate order | clear |
| Restore overrides a one-shot `?companion=` deep link | yes — restore doctest covers the deep-link-last order | yes — the deep link opens and activates after restore | clear |
| A tab hidden behind pinned tabs is treated as in view and never scrolled to | no unit test (DOM behaviour) | yes — pinned tabs are a separate scroller, so occlusion cannot arise | visible immediately in `bin/browse` |
| A restored strip renders before the pane's width settles, so nothing scrolls | no unit test (DOM behaviour) | yes — a ResizeObserver re-runs the reveal | found this way in `bin/browse`; fixed |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED, not applicable: this plan adds no
  agent-facing vocabulary. No card field, no annotation, no schema.
- **Stale ref** — ADDRESSED: a restored tab whose card was deleted renders the
  existing `MissingCardState` (`FileView.tsx:324`), the same as opening a
  deleted card today.
- **Two agents touching the same card** — ADDRESSED: unchanged. The chat agent
  writing a card still emits `file-change`, which still calls `resync()`
  (`FileView.tsx:158-166`); Track A adds the case where that resync *fails*,
  and now it leaves the previous body on screen with the marker instead of an
  error.
- **Hand-edit drift** — ADDRESSED: the only hand-editable surface is the
  `?card=` URL, whose parsing is unchanged.
- **Fabricated free-form value** — not applicable: nothing here is authored by
  an agent.
- **Validation error UX** — ADDRESSED: the marker says *Not up to date* with the
  underlying failure in its `title`; the raw transport message never becomes the
  headline (that is the verified defect above).
- **Partial migration / transition state** — ADDRESSED: `sessionStorage` is
  per-browser-tab and non-durable, so a deployed change meets, at worst, a blob
  written by the previous bundle in the same tab. Per-entry validation on
  restore handles it, and the worst case is an empty strip.
- **The card open beside chat is reported to the agent** — GAP to check during
  implementation: `useCardSend` (`InteractiveChat-card-hooks.ts:98-160`) sends
  the open card and the activity accumulated on it. Pin, eviction, and restore
  change which tab is active at send time. The rule to hold: what the agent is
  told is still "the tab the person is looking at", and a restored-but-never-
  looked-at tab must not be reported as read. Verify before Track C lands.

## NOT in scope

- **A landmark or context strip beside the card** — closed wontfix on
  2026-09-05 after the boxholder reviewed three shapes. Not revived here.
- **`localStorage` / cross-device tab sync** — considered, not now: the sidecar
  is a property of one browser tab's session (`lib/last-chat.ts:12-16`), and a
  durable strip that follows you between devices is a different feature with a
  different question behind it.
- **A general per-viewer-preference mechanism** — the pin issue points at
  [sticky-hq-transcription-preference](../../../issues/features/2026-08-26-sticky-hq-transcription-preference.md)
  and asks whether pins ride the same story. They do not: an HQ-dictation
  preference is durable and cross-session, a tab strip is not. Track C answers
  only for tabs and takes no position on HQ.
- **Drag-to-reorder tabs, tab context menus, middle-click close** — not asked
  for; pin is the one new affordance.
- **Chat transcript scrolling** — a different scroller, tracked separately in
  [chat-scroll-still-bad-after-rewrite](../../../issues/bugs/2026-09-04-chat-scroll-still-bad-after-rewrite.md).
- **Changing the global QueryClient `retry: false`** — see *Could this be
  simpler?*; if the file-view policy proves right, lifting it is a separate,
  reviewable change.
- **Server-side persistence of open tabs (chat feature state)** — considered and
  rejected for this plan: it makes every open a write to the box, and
  [hq-toggle-blocks-on-a-git-commit](../../../issues/bugs/2026-09-04-hq-toggle-blocks-on-a-git-commit.md)
  is the live warning about what that costs.

## Open design questions

All three were settled during implementation; kept here with their answers,
because the reasoning is the part worth reading later.

1. **`MAX_UNPINNED_TABS` value, or no cap at all.** Settled: 12, the
   boxholder's call.
   Original lean and reasoning: Lean: 12. It is high enough
   that nobody hits it in a normal conversation and low enough that a restored
   strip is legible. Cutting the cap entirely is the acceptable alternative —
   it is the weakest piece of Track C, and eviction is the only part of this
   plan that removes something the person did not ask to remove.
2. **Whether the `"new"`-chat strip should follow the assigned session id.**
   Settled: yes, implemented as `moveSidecarState`.
   The mechanism exists (`onSessionAssignment`,
   `components/chat/InteractiveChat.tsx:134`), so this is a behaviour choice,
   not a blocker. Lean: yes — rename `bbx:sidecar-tabs:${boxSlug}:new` to the
   assigned id, because documents opened while composing the first message
   belong to the conversation that message started. The alternative (drop them)
   is defensible only if the rename proves fiddly.
3. **Does the stale marker belong in `chat` mode too**, where a card is embedded
   inline in the transcript and there may be several? Settled: yes in `chat`,
   `companion` and `page` — a silently-stale card is the same defect wherever it
   renders — and no in `embed`, the frameless mode figures use inside a card
   body, which has no chrome to carry a marker and whose host card reports its
   own staleness.

## Knowledge audits

None. Skipped with rationale: this plan is entirely frontend and changes nothing
a box agent loads — no card shape, no schema instruction, no box-facing
convention. `pnpm knowledge-audit` tests what a box agent knows, and a box agent
never sees the sidecar.

## What will hold this after it ships

- **`test/frontend/file-load-state.doctest.md`** — the Track A decision as a pure
  function. Cheap: no DOM, no React, table-driven over the five query shapes.
  This is the test that matters most, because the failure it guards is silent.
- **`test/frontend/sidecar-tabs.doctest.md`** — the reducer: open/select/close,
  pinned-first ordering, pin survives other opens, eviction picks the
  least-recently-active unpinned non-active tab, `closeAll` clears everything.
- **`test/frontend/sidecar-tabs-storage.doctest.md`** — serialize/parse round
  trip, a malformed entry dropped without losing its neighbours, a throwing
  storage stub yielding an empty strip.
- **`bin/browse` verification, recorded in the plan's closing note**, for the
  three things no doctest reaches: the active tab scrolls into view in an
  overflowing strip, a pinned tab stays visible while the strip scrolls, and a
  502 injected at `window.fetch` leaves the card on screen with the marker and
  recovers. The 502 procedure is written up in this plan's *Verified behaviour*
  section so it is repeatable.
- **No new test tier, no new mock.** The existing frontend doctest tier reaches
  everything decision-shaped; the DOM-shaped remainder is genuinely a browser
  check.
- The smoke tier already opens a card (`docs/testing.md:556-570`), so a change
  that breaks card rendering outright still fails at `/finish`.

## Implementation order

1. **A1** — `lib/file-load-state.ts` + its doctest. No behaviour change.
2. **A2** — `useFileData` adopts it: cached data wins, `staleSince` returned,
   scoped retry policy added. Card no longer disappears.
3. **A3** — the **Not up to date** marker with its **Refresh** action, rendered
   by `FileView` in every mode. Closes the 502 issue; verify with the injected
   502 procedure.
4. **B1** — extract `lib/reduced-motion.ts`, point `chat-scroll-ease.ts` at it.
5. **B2** — tab refs + scroll-into-view effect in the strip. Closes the
   scroll-into-view issue.
6. **C1** — `components/chat/sidecar-tabs.ts` reducer + doctest; `useChatTabs`
   rewritten on top of it, outward behaviour identical.
7. **C2** — pin: state, affordance, pinned-first ordering, sticky positioning.
8. **C3** — `sessionStorage` persistence with validating restore, wired through
   `usePersistScheduler`; verify `?card=` still wins for the active tab, and
   check the `useCardSend` GAP above.
9. **C4** — the cap and eviction (or its removal, per open question 1).
10. **Cross-model review** before declaring done — this is three surfaces and a
    new persisted shape, well past a small-scope bug fix.

## Rollout shape

Tests first, per `docs/testing.md`: A1, C1 and the storage doctest are written
before the code they cover, because in all three the decision is the artifact.

**Done when:** `file-load-state`, `sidecar-tabs` and `sidecar-tabs-storage`
doctests pass; `pnpm typecheck` and `pnpm exec eslint` are clean on the touched
files; the three `bin/browse` checks above pass on `/sidecar-shell/test1/chat`;
`bin/smoke` passes at `/finish`.

**Verified in the running app** (`/sidecar-shell/test1/chat`) rather than only
by test: a 502 injected at `window.fetch` leaves the card on screen with the
marker, Refresh recovers it, and window focus does too; a restored ten-tab strip
scrolls its active tab into view; a pinned tab holds its place across nine
further opens and a reload; the twelve-tab cap evicts the oldest unpinned tab
and never the pinned one; closing the panel clears the stored strip; and a
`?companion=` deep link still wins the active tab over the restored strip.

No migration: nothing on disk changes shape. The only persisted state is
`sessionStorage`, which is per-browser-tab and discarded when the tab closes, so
there is no old data to convert and no transition window to survive.

No knowledge audits (see above). The three issues close via the frontmatter
`issues:` list when the plan ships.
