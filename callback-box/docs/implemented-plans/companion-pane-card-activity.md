---
title: "Companion-pane card activity awareness for chat"
status: implemented
workstream: unknown
issues: []
---
# Companion-pane card activity awareness for chat

> **Status: implemented (2026-06-14).** Shipped as five tracks. Where the
> work lives now: snapshot attrs + vocabulary in `src/core/chat-features.ts`
> and `src/core/chat-card-activity.ts` (Track A); URL persistence + the
> activity accumulator/reporters in
> `src/frontend/src/components/chat/InteractiveChat-card-hooks.ts`
> (`useCompanionCard`), wired through `ViewRenderer`/`FileView`/
> `CompanionViewPanel` (Tracks B+C); the turn marker + `cb chat whats-changed`
> in `src/core/chat-turn-marker.ts`, `src/core/chat-whats-changed.ts`,
> `src/cli/lib/git-range.ts`, and the `/api/chat/whats-changed` route (Track D);
> prompt + view-API docs + knowledge audits (Track E). This file is the frozen
> design record.

This plan makes the chat agent aware of the card open in the two-pane companion
layout and what the user is doing to it. The chat's leading per-turn context
(`<chat-app>` snapshot) gains two **additive** read-only attributes —
`open-card` and `card-activity`; interactive card views get a `reportActivity()`
hook; the open card is persisted in the URL so it survives reload; and a `cb
chat whats-changed` command gives the agent git-change depth. The signal is
derived from companion-pane *state*; how a card gets opened is out of scope.

A cross-model (Codex) review of an earlier draft is folded in — see
"Cross-model review applied" at the end for what changed and why.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:101` — *"Read before writing. Don't guess file
  formats, XML structures, or API shapes. Read the schema, read the existing
  code, read the test patterns."* — reuse existing pipelines (cited below)
  rather than parallel ones; where reuse turned out false (the git helpers,
  below), say so and add the minimal new plumbing.
- `callback-box/CLAUDE.md:104` — the new per-send fields ride the existing
  `/chat/send` raw route (already the documented tRPC exception), not a new
  endpoint.
- `callback-box/code-style.md` — files ≤300 lines, no default parameters, max 2
  positional params, no `any`, only export what's used. New helpers go in
  sibling modules, not inline (the `chatMachine.ts`/`git.ts` line caps already
  bit related work this cycle).
- Warm-pool invariance (`src/core/session-context.ts` header): situational
  context lives in the per-message snapshot, never the system prompt.
- Precedent: the `channel` per-send field → snapshot attribute is the template,
  **with one correction the review surfaced** — `channel` is threaded straight
  into `composeSendSnapshot`, not stored in `SnapshotContext`, and queued sends
  collapse it latest-wins. New fields copy the *transport*, not the latest-wins
  combine (see Track A).

## What already exists

- **Snapshot read-only-attr pipeline** — `src/core/chat-features.ts:130`
  (`const READ_ONLY_ATTRS = new Set([`), `:165` (`const contextAttrs: Array<…>`),
  `:170` (`["health", input.health],`). Attrs omit only `undefined`; **an empty
  string is rendered** (`chat-features.ts:165`) — so "omit when empty" means
  passing `undefined`, not `""`. `src/core/session-context.ts:156` (`interface
  SnapshotContext`) holds *computed* context (local-time/last-activity/calendar/
  health); **`channel` is NOT in it** — it's a separate `composeSendSnapshot`
  param (`session-context.ts:168/173`). **Reuse** the serialization; thread
  `openCard`/`cardActivity` like `channel` (params), not as `SnapshotContext`
  fields.
- **Per-send field transport** — `src/core/chat-session-messages.ts:130`
  (`channel?: string;` on `ChatSendInput`), `src/core/chat-session-start.ts:145`
  (conditional spread into `composeSendSnapshot`), `chat-send-routes.ts:196`
  (extract), `:201`/`:235` (thread into `enqueue`/`send`), `chat-helpers.ts:14`
  (`interface SendBody`). **Reuse** field-for-field.
- **Queued-send combine** — `src/core/chat-session-state.ts:241-266`
  (`combineQueuedInputs`): `:236` *"channel wins — it reflects where the user is
  now"* — latest-wins. **Rebuild** the combine for the new fields: `openCard`
  latest-wins (the current pane), `cardActivity` **union** (don't lose earlier
  queued activity).
- **Companion-pane state** — `src/frontend/src/components/chat/InteractiveChat-hooks.ts:22`
  (`useChatTabs()`), `:23` (`{ tabs: PanelTab[]; activePath: string | null }`),
  `:24` (`const activeView = …`). The mechanism-independent source of the open
  card. **Reuse** as the read point. Note `:28` `onZoomView` keys tabs by path
  and does not refresh an already-open tab's target/viewer/params — a v1
  limitation (see Open questions).
- **View activity sources** — `src/frontend/src/hooks/useViewFileHelpers.ts:82-88`
  (`writeFile`/`appendFile`/`commitFile`; `useViewFileHelpers` returns
  `makeHelpers`). **Reuse** for "modified"; navigation via `onNavigate`. Add an
  `onActivity` callback + `reportActivity`; "scrolled" is new.
- **URL search schema** — `src/frontend/src/router.tsx:77` (`validateSearch:
  z.object({`), `:82` (`companion: z.string().optional()`). **Reuse**; add a live
  `card`. **But** bare-`/chat` resolution drops all params except `session`
  (`ChatPage.tsx:42`, per review) and new-session assignment does the same
  (`InteractiveChat-sse.ts:150`, per review) — Track C must carry `card` through
  both.
- **Turn-end hook** — `src/core/chat-session.ts:250` (`if (msg.type ===
  "result")`), `:258` (`this.emit("done", msg)`), `:288` (queue drain). **Reuse**
  to record the turn marker — but **synchronously, before the drain** (the race
  the review flagged).
- **Git helpers — partial reuse only.** `src/cli/lib/git.ts:96` (`getStatus`),
  `:295` (`getDiff(boxRoot, staged?)` — **no baseline/range**), `:138`
  (`pathsHaveChanges`); `git-log.ts:147` (`getLogPaginated({count, offset,
  filter})` — **no commit-range input**). The earlier draft's "reuse the git
  helpers, no new git code" for ranged diff/log is **false** (review #1,
  verified). Track D adds two small ranged helpers; `getStatus`/`pathsHaveChanges`
  still reuse.
- **`cb chat` subcommand precedent** — `src/cli/commands/chat.ts:47`
  (`selfNoteCommand`, loopback `CB_SERVER_URL`/`CB_BOX_NAME`), `:96`
  (`chatCommand`). **Reuse** the shape.
- **`serializeViewUrl`/`parseViewUrl`** — `src/frontend/src/lib/view-url.ts`.
  **Reuse** for round-tripping the open card through the URL.

## Prior art (external)

- **TanStack Router search-param ↔ state sync loops** (Track C). Real and
  documented: `useEffect`/`navigate` cycles infinite-loop / go stale
  ([#453](https://github.com/TanStack/router/issues/453)); two `navigate` calls
  in one tick overwrite each other
  ([#2028](https://github.com/TanStack/router/issues/2028)). Mitigation:
  spread-previous, navigate only on change, `replace: true`
  ([docs](https://tanstack.com/router/latest/docs/framework/react/how-to/navigate-with-search-params)).
  Adopted — **plus** the in-repo clobbers (`ChatPage.tsx:42`,
  `InteractiveChat-sse.ts:150`) which the generic guard does not cover.
- **Passive/throttled scroll detection** — standard; collapse to a boolean per
  window. No surprising behavior.
- No external prior art applies to the snapshot-attribute or `cb`-command work —
  internal to callback-box conventions.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track A — Backend snapshot + transport (smallest, unblocks the rest)
**What.** Two **additive** read-only `<chat-app>` attrs, fed by two new per-send
fields. **Does not touch** the existing `zoomed-view`/`<typed>` mechanism.
**Why.** The agent has no structured, snapshot-level signal for the open card.
**Direction.** Mirror `channel`'s *transport*: `ChatSendInput.openCard?` +
`cardActivity?` (`chat-session-messages.ts`); conditional spread in
`composeTurnContent` (`chat-session-start.ts:145`); **new `composeSendSnapshot`
params** `openCard?`/`cardActivity?` passed straight to `composeChatAppSnapshot`
(NOT added to `SnapshotContext` — that's computed-context only); add to
`composeChatAppSnapshot` input + `contextAttrs` + `READ_ONLY_ATTRS`; `SendBody`
+ extract + thread into `enqueue`/`send`. **Combine semantics**
(`combineQueuedInputs`, `chat-session-state.ts`): `openCard` latest-wins,
`cardActivity` **union of the kinds across queued sends**. **Omit-when-empty:**
pass `undefined` (not `""`) so the attr is dropped, since the pipeline renders
empty strings.
**Vocabulary lock-ins.** Attr names `open-card` (box-relative path) and
`card-activity` (comma-joined kinds, stable order
`scrolled,navigated,explored,modified`). The agent treats these as
**low-confidence hints, not assertions of intent** (review #7) — documented in
Track E.
**First chunk.** Backend field→snapshot path + combine semantics + doctests
(`composeChatAppSnapshot` present/absent/empty-as-undefined-omitted;
`parseChatAppDeltas` ignores both; `combineQueuedInputs` unions activity). The
snapshot accepts the fields; nothing sends them yet (safe to land).

### Track B — Frontend activity accumulator + reportActivity hook
**What.** Accumulate activity kinds from companion-pane interactions; expose
`reportActivity`. `open-card` reads `useChatTabs().activeView.target.path`.
**Why.** Without it the Track A fields are always empty.
**Direction.** `useCardActivity()` (`InteractiveChat-hooks.ts`):
`useRef<Set<ActivityKind>>`, `report(kind)`, `snapshot()` (reads **without
clearing**). **Capture on the SEND event, not drain-before-ack** (review #3):
the SEND event carries an immutable activity snapshot + open-card; the
accumulator is cleared only when the turn is acknowledged (`startChatTurn`
resolves with a `turnId`/queued/deduped), and on send failure
(`api-chat.ts:223` retry exhausted, swallowed queued failures at
`chat-actors.ts:379`) the kinds remain so the next send still reports them.
Wire: *navigated* ← `CompanionViewPanel.onNavigate`; *modified* ← `onActivity?`
added to `useViewFileHelpers` after a successful write/append/commit; *scrolled*
← throttled passive scroll listener on the active pane's `overflow-auto`
container; *explored* ← `reportActivity("explored")` on the view helpers (opt-in).
**First chunk.** `useCardActivity` + `modified`/`navigated` + the SEND-event
field plumbing (machine context → `startChatTurn` → SendBody) + the
capture-on-SEND / clear-on-ack lifecycle. `scrolled` and `reportActivity` follow
as their own chunks.

### Track C — Open-card URL persistence
**What.** Reflect the companion-pane card in the URL; restore on reload.
**Why.** Today the open card is React-only; reload loses it.
**Direction.** Add `card: z.string().optional()` to `chatRoute.validateSearch`
(`router.tsx:77`). `ChatPage` reads it as `initialCard`; `useChatTabs` restores
on mount (`parseViewUrl` → `onZoomView`) and syncs `activeView.target` → `card`
(`serializeViewUrl`) on change. **Loop guard** (prior art): spread-previous +
navigate-only-on-change + `replace: true`. **Clobber fixes** (review #4): carry
`card` through bare-`/chat` search resolution (`ChatPage.tsx:42`) and
new-session assignment (`InteractiveChat-sse.ts:150`) — both currently rewrite
the search object keeping only `session`. **Known limitation:** tabs are keyed
by path; reopening a path won't refresh viewer/params — acceptable for v1, noted
in Open questions.
**First chunk.** Schema param + mount-restore + change-sync with the guard, +
the two clobber fixes. Standalone; no dependency on A or B.

### Track D — `cb chat whats-changed` + per-session turn marker
**What.** A command for git-change depth, anchored to a per-turn marker.
**Why.** The snapshot is referential by design; "what changed in the card" needs
an on-demand surface, and there's no "since last turn" anchor today.
**Direction.**
- **Turn marker:** new `src/core/chat-turn-marker.ts` —
  `recordTurnMarker`/`loadTurnMarker` →
  `.callback-box/chat-turn-marker/<sessionId>.json` = `{ head, time }`. Record in
  `chat-session.ts:250` result block **synchronously (awaited) before the queue
  drains** (`:258/:288`) so the next turn can't race ahead of the write; still
  guarded by try/catch so a write failure logs and the turn proceeds.
- **New ranged git helpers** (`git.ts` — the existing ones can't range): a
  `git diff <baseRef>..HEAD` summary and a `git log <baseRef>..HEAD` listing
  (small `simpleGit` wrappers next to `getDiff`/`getLogPaginated`).
- **Command** `cb chat whats-changed` (`cli/commands/chat.ts`, loopback like
  `selfNoteCommand:47`): committed changes via the ranged helpers
  (`marker.head..HEAD`) **plus** the current uncommitted working tree
  (`getStatus` + `getDiff`); `--card <path>` scopes via `pathsHaveChanges` +
  per-path diff. **Precise semantic** (review #1): *"commits since my last reply
  (`marker.head..HEAD`) plus the current uncommitted working tree"* — not a
  single timestamped delta. Documented in the command help and Track E.
- **Marker-absent fallback** (first turn): report uncommitted working tree +
  last N commits, labeled as such.
**First chunk.** The turn-marker module + awaited recording + the two ranged git
helpers, with a `makeTmpBox()` doctest. The command follows.

### Track E — System prompt + view-API docs
**What.** Document the two new attrs, the activity vocabulary (as hints), and
`reportActivity`. **Leaves the existing `zoomed-view` documentation in place.**
**Direction.** Add `open-card` + `card-activity` to the STATE SNAPSHOT list
(`chat-session-prompts.ts:97`), framed as read-only, terse, **low-confidence
hints** (don't overclaim intent), pointing to `cb chat whats-changed` for the
precise delta. Classify the four kinds in prose (navigated = a link was
followed; explored = params changed; modified = data changed; scrolled =
passive). Document `reportActivity` in the `docs/generated/views.md` generator.
Static prose only.
**First chunk.** Prompt + views-doc edits, landing with Track B's
`reportActivity`.

## Subplans

None. Each track is a contained design; the activity-vocabulary lock-in is small
enough to settle inline.

## Failure modes

**Critical gap:** none unresolved.

| What can fail | Test? | Handling? | Clear-or-silent? |
|---|---|---|---|
| `cb chat whats-changed` claims a delta the git helpers can't produce (review #1) | Track D doctest | Yes — new ranged helpers (`marker..HEAD`) + uncommitted tree; semantic documented as "commits since last reply + uncommitted" | Was the original silent gap; now explicit |
| Queued sends lose earlier activity (latest-wins copy of `channel`, review #2) | `combineQueuedInputs` doctest | Yes — `cardActivity` unions, `openCard` latest-wins | Would be silent; union fixes it |
| Activity drained before send is acknowledged → permanent loss (review #3) | No (manual) | Yes — capture on SEND, clear only on ack; retained on failure | Would be silent; lifecycle fixes it |
| `?card=` dropped by bare-`/chat` / new-session assignment (review #4) | No (manual) | Yes — carry `card` through `ChatPage.tsx:42` + `InteractiveChat-sse.ts:150` | Would be silent (card vanishes on reload/new id) |
| URL sync `navigate` loop (TanStack #453/#2028) | Manual | Yes — spread-prev + changed-only + `replace:true` | Loud (hang) if unguarded; guarded → no-op |
| Turn-marker write races the next turn (post-`done` drain) | Track D doctest | Yes — awaited record before drain; try/catch | Was silent; awaited write fixes |
| `open-card` path stale (card moved/archived after open) | No | Partial — it's a hint; `cb chat whats-changed --card` reports absence | Silent-ish; documented as a hint |
| Scroll listener fires continuously | No | Yes — passive + throttle-to-boolean; Set collapses | Clear (jank) if wrong; design prevents |
| `cb chat whats-changed` run with no `CB_SERVER_URL` | Track D doctest | Yes — mirror `selfNoteCommand` env errors | Clear (named error) |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A: read-only, system-written; `parseChatAppDeltas`
  ignores them. **ADDRESSED.**
- **Stale ref** — `open-card` can name a moved/archived card. **ADDRESSED** (hint;
  `cb chat whats-changed --card` reports absence).
- **Two agents touching the same card** — surfaces as a `file-change` SSE the
  pane already handles, as `modified` activity, and in `cb chat whats-changed`
  git output. **ADDRESSED.**
- **Hand-edit drift** — N/A (frontend emits these; boxholder doesn't author them).
- **Fabricated free-form value** — the snapshot gives terse truth and `cb chat
  whats-changed` gives verifiable git detail, so honesty is the cheap path. The
  activity kinds are framed as hints to *discourage* overclaiming (review #7).
  **ADDRESSED.**
- **Validation error UX** — `cb chat whats-changed` errors mirror the readable
  `cb chat self-note` messages. **ADDRESSED.**
- **Partial migration / transition state** — N/A now: `open-card`/`card-activity`
  are additive; `zoomed-view` and the message tags are untouched, so there's no
  transport swap to transition. **ADDRESSED.**

## NOT in scope

- **How cards are opened / the `zoomed-view` mechanism.** Left entirely
  untouched. `open-card`/`card-activity` are additive; we do not retire,
  consolidate, or rework the opening path or the `<typed>`/`<speech>` splice.
  (User direction; also dissolves review #5's retirement-breadth concern.)
- **Screenshot / the agent seeing the rendered card.** Deferred — larger lift
  (SSR via `cb render`, or the filed "preconfigured agent-browser scoped to the
  box" idea).
- **Event-bus persistence of activity for between-turn awareness.** Deferred —
  v1 is per-send leading-context only.
- **The agent interacting with / driving the card view.** Deferred.
- **Back-filling `open-card` onto historical messages.** Deferred.
- **Auto-detecting "explored" generically.** Deferred — opt-in `reportActivity`
  only in v1.
- **Refreshing an already-open tab's viewer/params on reopen** (the path-keyed
  limitation). Deferred — v1 persists the active card path; param re-tracking is
  later work.

## Open design questions

- **Turn-marker recording point** — record at turn *completion* (HEAD+time),
  awaited before drain. Lean: keep this; the command's semantic is "since my
  last reply." Settle before Track D's command chunk (not inside the first
  chunk, which is just the marker module + helpers).
- **`open-card`: path-only vs full `view:` URL in the snapshot** — lean
  path-only (terse) in the snapshot; the full `view:` URL lives in `?card=` and
  `cb chat whats-changed --card` takes the path. Settle in Track A.
- **Path-keyed tabs not refreshing viewer/params on reopen** — accepted as a v1
  limitation (NOT in scope). Revisit if param-tracking becomes needed.

## Knowledge audits

Two agent-facing concepts: the `open-card`/`card-activity` snapshot attrs and the
`cb chat whats-changed` command. Per the `{% quote %}` / `zoomed-view`
precedent (`src/dev/knowledge-audits.yaml:868` already audits `zoomed-view`),
each gets at least one `knows_directly` audit:
- "When a card is open in the companion pane, how do you learn what the user did
  to it, and how do you get the precise changes?" (expects
  `open-card`/`card-activity` + `cb chat whats-changed`).
- The four activity kinds and that they're **hints, not assertions of intent**.

Audits land **run** (`pnpm knowledge-audit run --box test1 --filter
card-activity`) with the status recorded before the plan completes.

## Implementation order

1. **Track A first chunk** — backend field→snapshot + combine semantics +
   doctests. Unblocks all; nothing emits the fields yet.
2. **Track C** — URL persistence (independent; smallest visible win; includes the
   two clobber fixes + the loop guard).
3. **Track B chunks** — `useCardActivity` + `modified`/`navigated` + SEND-event
   plumbing + capture-on-SEND/clear-on-ack (feeds Track A); then `scrolled`;
   then `reportActivity`. **No `zoomed-view` removal** — additive only.
4. **Track D** — turn-marker module + awaited recording + ranged git helpers
   (with doctest), then the `whats-changed` subcommand.
5. **Track E** — prompt + views-doc edits, alongside B's `reportActivity`.
6. Knowledge-audit entries authored + run.

## Rollout shape

- **Test posture.** Dogfood first; doctests per substantial new codepath:
  chat-features snapshot + `combineQueuedInputs` union (Track A), a `/chat/send`
  route doctest threading the fields, and a `makeTmpBox()` doctest for the turn
  marker + ranged helpers + `cb chat whats-changed` (Track D). Frontend activity
  wiring is dogfood/manual (browse skill).
- **Knowledge audits** land run with the plan.
- **Migration.** None — additive throughout; no data-shape or transport change to
  existing messages.
- **Worktree.** Executed on a dedicated worktree (this plan's branch); commit per
  chunk; **do not merge to main without the boxholder's explicit "ship."** The
  plan completes (all five tracks) before it ships as one unit.

## Cross-model review applied

A Codex review of the first draft falsified two "free reuse" claims (verified
against source) and surfaced real gaps; the plan above incorporates them:
- **#1** the git helpers can't do a ranged/baseline diff or log (`getDiff` has no
  baseline `git.ts:295`; `getLogPaginated` has no range `git-log.ts:147`) → Track
  D adds two small ranged helpers and documents the exact semantic; the
  marker write is awaited before the queue drain.
- **#2** `combineQueuedInputs` is latest-wins for `channel`
  (`chat-session-state.ts:236`) → `card-activity` unions across queued sends,
  `open-card` latest-wins.
- **#3** draining activity before send-ack loses it on failure → capture on the
  SEND event, clear only on ack, retain on failure.
- **#4** bare-`/chat` and new-session assignment drop all search params but
  `session` → Track C carries `card` through both.
- **#6** `channel` is threaded into `composeSendSnapshot`, not stored in
  `SnapshotContext`, and empty strings render → new fields follow `channel`
  (params, not `SnapshotContext`) and omit-when-empty via `undefined`.
- **#7** activity vocabulary risks overclaiming intent → framed as
  low-confidence hints in the prompt.
- **#5** (zoomed-view retirement breadth) is moot — retirement is out of scope;
  the work is additive.

Codex's headline recommendation ("ship `open-card`-only, cut Tracks B–D") was
**not** taken: the boxholder explicitly wants the activity signal, the URL
persistence, and the command. The underlying point — don't ship those with
hand-waved semantics — is addressed by the fixes above rather than by cutting
scope.
