---
title: "Coined chat ids: a new chat has its real session id before its first message"
status: implemented
workstream: new-chat-first-emission
issues:
  - ../../../issues/closed/features/2026-08-20-cannot-capture-into-a-new-chat.md
---

# Coined chat ids: a new chat has its real session id before its first message

A new chat currently has no id until the agent harness assigns one part-way
through the first run. Everything that wants to put something into that chat
must either wait or create its own session, so two paths that both create end
up with two chats. This plan has the client mint the session id up front and
the server reserve it, passing it to the harness as the run's session id. The
`"new"` sentinel, the capture and bulk-upload "send a message first" gates, and
the per-subprocess session-id file all go away on the Claude engine. Codex, which
cannot be told an id, keeps today's assign-later path as a named minority case.

## The job to be done

*When I have just taken photos of a thing and want to ask about it, I want to
open a chat and put the photos in as the opening move, so I can say "what is
this?" with the thing itself attached.*

*When I get back to my desk with a phone full of receipts, I want to open a new
chat, drop the batch in, and have the first thing I say be about the batch —
not a greeting typed only so the upload button turns on.*

*When I open a new chat and type two short messages quickly — the question, then
the correction I thought of a second later — I want both in one conversation.*

The third situation does not involve capture and is broken today.
`src/frontend/src/machines/chat-actions.ts:73` sends `session:
context.sessionInput` for a queued send, and `sessionInput` stays `"new"` until
the assignment arrives, so the second send takes the `"new"` branch again and
creates a second chat.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` #2 (exhaustiveness is enforced, not hoped
  for) — one target union replaces four uncoordinated `createNew()` calls.
- #3 (validate at boundaries and during parsing) — a coined id is validated once
  at the reservation boundary, not string-compared per route.
- #4 (resilient AND never silent) — a reservation that is reaped, or a coined id
  that collides, must fail loudly or recover cleanly, never land content in
  someone else's chat.
- #6 (right-sized defensiveness) — the harness already fails closed on a reused
  id, so this plan does not build a second guard for it.
- #8 (one way to do each thing) — one owner for session creation; the sentinel
  path survives only where the engine forces it.
- #11 (enforcement beats convention) — a lint restriction keeps call site five
  from appearing.
- `callback-box/CLAUDE.md` — no features beyond what the task requires.
- `code-style.md` exhaustiveness — `switch-exhaustiveness-check` with
  `considerDefaultExhaustiveForUnions: false`.
- Precedent: `docs/implemented-plans/emission-model.md` — durable acceptance and
  the `session-assigned` handshake this plan mostly retires.

## What already exists

- **The harness accepts a caller-chosen session id.** `Options.sessionId` in
  `@anthropic-ai/claude-agent-sdk` 0.3.234 (pinned in `package.json:101`):
  *"Use a specific session ID for the conversation instead of an auto-generated
  one. Must be a valid UUID."* The SDK passes it through as `--session-id`.
  Verified by spike, 2026-08-20 — see Prior art. Reused; this is the plan's
  foundation.
- **The assignment callback's bookkeeping — but NOT its trigger.**
  `makeOnAssigned` (`src/core/chat/session/registry.ts:249-313`) writes the
  history entry, the feature seeds, the most-active pointer, and the husk card,
  then emits `session-assigned`. It will **not** fire for a coined session:
  `captureAssignedSessionId` returns early when the session already knows its id
  (`src/core/chat/session/state.ts:183`, `if (current !== null) return null;`),
  and a session constructed with a known id sets `initialSessionId`
  (`registry.ts:194`). So the bookkeeping is reused as a function, but the plan
  must call it explicitly at first run start. Treating this as free reuse was
  the plan's most serious error before review; every downstream claim about
  "the chat already exists" depended on it.
- **The client already makes a mount-time round trip.**
  `chatBootstrapProcedure` (`src/webapp/trpc/routers/chat-bootstrap-procedure.ts:58-78`)
  resolves the session and returns its history. Reused as the reservation point.
- **The prewarm mechanism exists and is on in production.**
  `registry.prewarm()` (`registry.ts:111-126`), enabled by `cb serve` via
  `prewarmChat` (`src/webapp/routes/chat.ts:103-107`), consuming a slot warmed
  by `startup()` (`src/services/claude-chat.ts:185-195`). Rebuilt: the slot
  becomes per-chat and keyed by the coined id (justified below).
- **The nullable delivery target already works and is tested.**
  `deliver-user-message.ts:141-163` creates a session for a null target;
  `test/core/capture/deliver-message.doctest.md:32-50` covers it. Kept for the
  deep-link and Codex cases; it stops being the common path.
- **Rebuilt, not reused:** the four `createNew()` call sites
  (`deliver-user-message.ts:145`, `chat-send-target.ts:22`,
  `chat-schedule-fire.ts:141` and `:163`). They are the defect — nothing
  coordinates them and two can run concurrently for one intended chat.
- **Not reached (rather than deleted):** the per-subprocess session-id file
  (`src/core/chat/session/session-id-file.ts`, minted at `claude-chat.ts:90-98`).
  Its module doc says why it exists: *"the moment the SDK emits the session id,
  the backend writes it into that file"* — with a coined id there is no such
  moment, and `start.ts` already sets `CB_CHAT_SESSION_ID` whenever the session
  has an id, so the allocation condition (`env[CB_CHAT_SESSION_ID_ENV] ===
  undefined`) is simply false. No deletion was needed; the file keeps serving
  the case it was built for. **Implemented, verified by doctest.**

## Prior art (external)

- **Client-supplied ids for optimistic creation** is the established shape:
  idempotency keys (<https://docs.stripe.com/api/idempotent_requests>) and
  client-minted primary keys in offline-first sync. Reserving an id the client
  chose, rather than aliasing one the server chose, is the same pattern.
- **The Claude Agent SDK supports it; the Python SDK did not, and it was
  requested.** `anthropic-ai/claude-agent-sdk-python` issue #338, "Allow setting
  a specific session id"
  (<https://github.com/anthropics/claude-agent-sdk-python/issues/338>), notes the
  CLI's `--session-id` and its absence from the client. Our TypeScript SDK
  exposes it (<https://docs.claude.com/en/docs/agent-sdk/sessions>).
- **Verified locally rather than trusted** (spike, 2026-08-20, SDK 0.3.234,
  real subprocess, since the docs do not state the failure or persistence
  behavior):
  - A coined UUID is honored: the init and result messages both report it, and
    the transcript is written to `~/.claude/projects/<dir>/<uuid>.jsonl` — the
    layout `resolveSessionLogPath` (`history.ts:292`) already expects.
  - Reusing an id that already has a transcript fails closed: the subprocess
    exits 1 with *"Session ID &lt;uuid&gt; is already in use."* No silent resume.
  - `startup({ options: { sessionId } })` also honors it, so a **warm slot can
    carry a coined id**. This is what makes per-chat prewarm possible.
  - A warm slot closed without a prompt writes **no transcript**, and the id is
    still usable afterward. An abandoned reservation therefore costs nothing.
  - Cold vs warm time-to-first-assistant-token, three paired runs on Haiku 4.5:
    cold 3745 / 4096 / 3326 ms, warm 2624 / 2123 / 2716 ms — warm start saves
    roughly 0.6–2.0 s. Noisy, model latency dominates the remainder, but the
    saving is real and worth preserving.
- **No prior art found** for keying a warm subprocess pool by a
  not-yet-started conversation id; the pooling literature assumes fungible
  workers. That is the one genuinely novel piece here, and it is small.

## Tracks / scope

Ordered by implementation dependency.

### Track A — coin and reserve

**What.** The client mints a UUIDv4 for a new chat. The server reserves it: it
checks the id is unused, registers a registry entry under it, and spawns a warm
subprocess carrying that id.

**Why this needs to change.** A pending session is unaddressable today —
`registry.ts:63` holds it in a `Set` with no key — so nothing can name the chat
the user is looking at until the harness speaks. Every symptom in the filed
issue follows from that.

**Direction.**

```ts
// src/core/chat/session/reserve.ts
export interface ChatReservation {
  sessionId: string;
  engine: AgentEngine;              // pinned at reserve time — see below
  contextDir: string | null;        // landmark binding, captured here
  seedFeatures: Record<string, string>;
  createdAt: number;
}

export type ReserveResult =
  | { kind: "reserved"; sessionId: string }
  | { kind: "taken" }        // the id already has history or a transcript
  | { kind: "unsupported" }; // engine cannot be told an id (Codex)

export async function reserveChatSession(ctx: ChatTargetContext, req: ReserveRequest): Promise<ReserveResult>;
```

- **The reservation is a record, not a registry entry.** It must outlive the
  live session object, because `sweepIdle` (`registry.ts:422-440`) deletes
  entries with no recent activity, and a chat the user opened and left for ten
  minutes before capturing must still be addressable. Sweeping stops the
  subprocess; it does not cancel the reservation. The record is small and
  in-memory, with its own TTL.
- Idempotent by id: reserving an id already reserved by this box returns
  `reserved` again — safe under a StrictMode double-invoke or a retried request.
  This is why the client mints and the server reserves, rather than the server
  coining and the client adopting.
- `taken` is decided from `loadHistoryEntries` plus a stat of
  `resolveSessionLogPath` — the pair `isResumableSession` already uses. The
  harness's own "already in use" is the backstop, not the check (#6).
- **The engine is pinned at reserve time.** `resolveChatEngine`
  (`engine.ts:6-13`) returns `"claude"` for any id it has no history entry for,
  so a reserved id on a Codex box would otherwise be routed to Claude. The
  reservation calls `loadAgentEngine(boxRoot)` and refuses with `unsupported`
  when it is not Claude.
- **`contextDir` and `seedFeatures` are captured at reserve time.** Today they
  ride the send only when `sessionInput === "new"` (`chatMachine.ts:239-242`,
  applied at `chat-send-target.ts:19-24`, passed by `ChatPage.tsx:305`). A
  coined chat is not `"new"`, so a landmark binding would be silently dropped —
  the reservation is where that data now lives, and `resolveChatTarget` reads it
  from there.
- **The durable bookkeeping fires at first run start, not at reserve** (with one
  exception found in review: a pre-first-message feature toggle now writes a
  history entry, because the chat has an id for the server to record against —
  see the failure-modes table). Because
  `captureAssignedSessionId` (`state.ts:183`) will not fire for a session that
  already knows its id, the run-start path calls the same work `makeOnAssigned`
  does — history append, feature seeds, most-active, husk, `session-assigned`.
  Doing it at reserve time instead would leave a husk and a history entry for
  every abandoned new chat; doing it at first run keeps durable state tied to a
  real turn.
- The reserved session's backend options carry `sessionId`, and
  `CB_CHAT_SESSION_ID` goes straight into the subprocess env, so `cb chat
  screenshot` and friends resolve without the session-id file.

**Vocabulary lock-ins.** "Coin" (the client mints), "reserve" (the server
accepts), `reserveChatSession`, `ReserveResult` kinds `reserved` / `taken` /
`unsupported`.

**First implementation chunk.** `reserve.ts`, the reservation record and its
TTL, the run-start bookkeeping, and the `sessionId` passthrough in
`buildQueryOptions` (`claude-chat.ts:86-131`), with doctests. Nothing calls the
reservation yet.

**Per-chat prewarm is the last chunk, and it is in scope.** The backend holds
exactly one `warmSlot` and one `warming` promise (`claude-chat.ts:171-203`), and
`hasWarm()` is a boolean (`registry.ts:102`), so keying the pool by session id
is a real change to that module rather than a parameter. It buys the 0.6–2.0 s
measured above and nothing else — correctness does not depend on it, so it is
sequenced last, after every correctness chunk is real. The boxholder weighed the
measurement against the module change on 2026-08-20 and kept it: the first
message of a new chat is the most latency-visible moment in the product.

### Track B — one target resolver

**What.** One module owns "which chat, and who creates it."

**Why this needs to change.** "Which chat" is spelled four ways today: the
`"new"` sentinel, a nullable `sessionId`, the `DeliveryTarget` struct, and an
implicit "most active". Each site re-decides who creates.

**Direction.**

```ts
// src/core/chat/session/target.ts
export type ChatTargetSpec =
  | { kind: "existing"; sessionId: string }          // resumable or reserved
  | { kind: "fresh"; contextDir?: string; seedFeatures?: Record<string, string> }  // legacy "new", Codex, schedule fallback
  | { kind: "most-active-or-fresh"; contextDir?: string };                          // capture deep link, legacy schedules

export async function resolveChatTarget(ctx: ChatTargetContext, spec: ChatTargetSpec): Promise<ResolvedChatTarget>;
```

A `switch` ending in `assertNever`, so a fourth kind cannot be added without
every branch being written (#2). `registry.createNew` is renamed
`createNewInternal`, and an ESLint `no-restricted-syntax` entry rejects it
outside `target.ts` and `reserve.ts` (#11). Note the union has **three** kinds,
not the four an alias design would need — a reserved chat is just `existing`.
Route-layer concerns (availability, the 410 mapping at
`chat-send-target.ts:59-75`, `assertExactSessionTarget`) stay in the route.

Four existence gates learn about reservations, not one. Each currently proves a
chat exists by finding a transcript, and a reserved chat has none yet:

- `resolveSessionAvailability` (`availability.ts:29-40`) — `fs.access(logPath)`
  fails, returning `missing-local-transcript`, so the first send 410s.
- `assertExactSessionTarget` (`chat-send-target.ts:36-41`) via
  `isResumableSession` (`recent-landmark.ts:52`) — the exact-session path
  bypasses availability entirely.
- `resolveCaptureDeliveryTarget` (`deliver.ts:79-83`) — accepts the target only
  if `loadHistory()` includes it, else falls back to most-active. **This is the
  filed bug's actual path**: without this gate knowing about reservations, a
  capture started as the first action in a coined chat still lands elsewhere.
- `resolveBulkDeliveryTarget` (`bulk-upload/deliver.ts:38`) — same shape.

All four consult the reservation record through one predicate, `chatExists()`,
which answers "history, transcript, or live reservation". A fifth gate,
`loadSessionEntry` (`list.ts:139-157`), deliberately does **not**: a reserved
chat with no turn yet must not appear in the session list.

**First implementation chunk.** `target.ts`, the four call sites moved onto it,
the availability case, the lint rule. No wire change.

### Track C — the client mints, and the sentinel retires

**What.** `ChatPage` mints the id for a new chat, reserves it through bootstrap,
and rewrites the URL before the machine mounts.

**Direction.**

- The reservation boundary validates the id with `z.string().uuid()` — the
  harness requires a UUID, so anything else is rejected before it reaches a
  spawn. The existing permissive `z.string().min(1)` on the chat URL
  (`router.tsx:107-108`), bootstrap (`chat-bootstrap-procedure.ts:64-68`), and
  send (`chat-helpers.ts:48-51`) schemas stays as-is: they must keep accepting
  historical non-UUID ids, and a bad id there already fails the existence gates.
- `ChatPage` mints `crypto.randomUUID()` when `search.session === "new"`, calls
  `chat.bootstrap({ session: <id>, reserve: true })`, and on `reserved`
  navigates to `?session=<id>`. The bootstrap input
  (`chat-bootstrap-procedure.ts:64-68`) gains `reserve: z.boolean().optional()`.
  On `taken` the client mints again (once; a second collision is a 500-class
  event, not a retry loop). On `unsupported` — a Codex box — it falls back to
  today's `"new"` path unchanged.
- Because the id exists before `InteractiveChat` mounts, the machine mounts with
  a real `sessionId` and the `"new"` branches
  (`chat-actors.ts:44` and `:78`, `chatMachine.ts:88`, `:239`, `:242`, `:351`)
  are reached only on a Codex box. They stay, now as the named minority path.
- The `keyState` carry and the assignment latch (`ChatPage.tsx:126-171`) become
  Codex-only for the same reason. They are not deleted — deleting them would
  break Codex boxes — but their comment gains the reason they now survive.
- `InteractiveChat-ws.ts:157-166` keeps its broadcast-adoption guard for Codex.
  Its complaint that the broadcast *"carries no client correlation"* stops
  applying to Claude chats, which never need adoption.
- Bare `session: "new"` on the wire keeps working: the shipped iOS build sends
  it (`ios-app/CallbackBox/Services/ChatAPI.swift:362`,
  `return result.sessionId ?? "new"`) and ships on its own train.

**First implementation chunk.** Minting, the `reserve` input, the URL rewrite,
and the Codex fallback branch — one semantic change; splitting it leaves a
half-retired sentinel.

### Track D — the gates are deleted

**What.** Capture and bulk upload target an ordinary session id, because by then
there always is one.

**Direction.** As implemented, this track needed **no UI change at all** — a
better outcome than the plan predicted, and worth recording. Both gates are
written as conditions on `sessionId === null`
(`InteractiveChat.tsx:331-332`, and `:141` for the bulk overlay) rather than as
hardcoded disables, so on a box that coins ids the condition is simply never
true, and on a Codex box the gate still says the true thing. Deleting the lines
would have *removed* correct Codex behavior. The delivery side is where the work
actually was, and it is **not** free: `resolveCaptureDeliveryTarget` (`deliver.ts:79-83`) admits
a target only if `loadHistory()` includes it, which a reserved chat is not until
its first turn — so it must go through Track B's `chatExists()` predicate or the
gate removal ships the exact misdirection the gate prevents. On a Codex box
`sessionId` can still be null at mount, so the disabled reasons survive as a
Codex-only condition rather than the default state.

Verified in the running app on 2026-08-20: a chat opened at `?session=new`
navigates to `?session=<uuid>`, the Add menu offers "Capture…" and "Upload
files…" with no "(send a message first)", and a first message runs against the
real harness under the coined id — transcript, history entry, husk card, and
most-active pointer all landing on that id.

**First implementation chunk.** The four lines plus the tour that proves it.

### Track E — schedule fire joins the resolver

**What.** `chat-schedule-fire.ts:141` and `:163` become `fresh` targets through
`resolveChatTarget`. Behavior unchanged; they are in scope as callers so that
`createNewInternal` has no callers left outside the owner module.

**First implementation chunk.** Included in Track B's chunk.

## Could this be simpler?

**The simplest version:** delete the two disabled reasons and let the capture's
delivery-time `createNew()` do its thing.

It fails on the concurrent case, which is the common one: the user opens a new
chat, starts a capture, and types while it uploads. The capture's
`createNew()` (`deliver-user-message.ts:145`) and the send's
(`chat-send-target.ts:22`) both run, and the capture lands in a different chat
from the message. Per #4 that is a silent wrong answer, worse than today's
honest refusal.

**The next-simplest:** keep the harness as the id authority and alias a
client-minted handle to whatever id it assigns. This was the plan until the
spike came back. It works on every engine and is purely additive, but it keeps
the `"new"` sentinel, the assignment latch, the pending-promotion step, and the
session-id file forever, and it adds an alias table and a fourth target kind on
top of them. It buys engine-uniformity at the cost of never simplifying
anything (#8).

**What the extra complexity here buys.** The reservation is roughly the same
amount of new code as the alias would have been, and it *removes* four
mechanisms instead of adding a fifth. The one genuinely new thing is keying the
warm slot to a chat, which the spike shows is supported and which makes prewarm
better targeted than the speculative slot it replaces.

**What was cut.** An exhaustive union over composer "first input kinds".
Screenshot (`ScreenshotMenuItem.tsx:51-57`) and Attach file
(`InteractiveChat-composer.tsx:234`) put items into the draft emission, and
Share location (`ShareLocationMenuItem.tsx:20-24`) is box-scoped via
`useLocationShare(boxSlug)` — none of them names a chat, so the union would be
mostly `n/a` members. The completeness belongs on chat-identity resolution,
which is where Track B puts it.

## Subplans

None. The one adjacent question big enough for its own design — making chat
identity fully ours, with the harness id demoted to a resume token so Codex
stops being a special case — is deferred entirely (see NOT in scope), not split
out. This plan completes without it.

## Failure modes

No critical gaps. Two accepted risks are named below the table.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A coined id collides with an existing chat | New (Track A doctest) | `reserveChatSession` returns `taken`; the client mints once more. The harness's "already in use" exit is the backstop | Clear |
| The live session object is swept before the first send | New (Track A doctest) | The reservation record outlives the entry, so the send re-creates the session with the same id; the spike shows an abandoned warm slot wrote no transcript and did not burn the id | Clear |
| Two tabs each open a new chat | New (Track A doctest) | Distinct UUIDs → distinct reservations; no shared slot to contend for | Clear |
| A client reserves ids and never sends (buggy or hostile tab) | New (Track A doctest) | Reservations past the warm cap are registered but not warmed; the idle sweep reaps them | Clear |
| The first send arrives while the reserved session is `starting` | Existing (`deliver-message.doctest.md`) | `deliverUserMessage` enqueues (`deliver-user-message.ts:183-186`); the queue drains when the starting run's turn completes — deliberate, see `lifecycle.ts:105-118` | Clear |
| A reserved id is asked for history before any turn | New (bootstrap test) | Availability treats reserved-without-transcript as available-and-empty, not a ghost (Track B) | Clear |
| The box runs Codex, so the id cannot be coined | New (Track C test) | `reserve` returns `unsupported` and the client uses today's `"new"` path | Clear |
| A capture is delivered into a coined chat the user abandons | No | The card is committed and the chat is listed | Clear |
| A feature is toggled in a coined chat that is then abandoned | No | The toggle goes through the server now that the chat has an id, and `updateFeaturesForSession` (`history.ts:361-370`) creates a history entry if none exists — so an abandoned chat can leave a history row with no transcript. Accepted: the row is skipped as a ghost by `getLastSessionForDirectory` and never listed (`list.ts` requires a husk), and reaping it would mean a sweep for a case that needs a toggle-then-abandon | Logged as a ghost skip when a landmark resolves |
| The server restarts between reserve and first send; the in-memory reservation is gone | New (Track A doctest) | The send's existence check fails and returns the existing 410; the client re-bootstraps, re-reserves the same id (idempotent, and no transcript exists so it is not `taken`), and retries | Clear — one visible retry |
| A landmark chat is coined, and the binding is lost | New (Track C test) | `contextDir`/`seedFeatures` are captured in the reservation, not carried by the `"new"`-only send fields | Clear |
| A coined id is reserved on a Codex box | New (Track A doctest) | The engine is pinned at reserve; `unsupported` sends the client down the `"new"` path | Clear |
| An exact-session send (`exactSession: true`) targets a reserved chat | New (Track B test) | `assertExactSessionTarget` consults `chatExists()` rather than `isResumableSession` alone | Clear |
| A reserved chat appears in the session picker before it has a turn | New (Track B test) | `loadSessionEntry` (`list.ts:139-157`) keeps requiring a transcript, so it does not | Clear |
| `sessionId` support is dropped by a future SDK version | No | The spike is encoded as a doctest that fails loudly on an SDK bump | Clear — see below |

Two accepted risks:

- **This plan depends on a third-party option.** If `Options.sessionId` changes
  behavior in an SDK upgrade, new chats break. Handling: the spike becomes a
  real-SDK doctest asserting a coined id is honored, so a version bump fails the
  suite rather than production. Per #4, a dependency this load-bearing gets a
  test, not a comment.
- **A reserved-but-unsent chat holds a subprocess** until the sweep reaps it,
  where today's single speculative slot held one regardless. The cap bounds it.
  Adding a separate reaper for a case the existing sweep already covers is the
  over-engineering #6 warns about.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — the analogue is a client sending a
  non-UUID or another box's id to reserve. **ADDRESSED**: zod format check plus
  the `taken` result; a reservation never adopts an existing conversation.
- **Stale ref** — a staging row points at a chat that no longer exists (the live
  example is a `failed:prepare` row 16 days old). **ADDRESSED**: unchanged
  behavior — `resolveCaptureDeliveryTarget` (`deliver.ts:79-93`) falls back to
  most-active, then to a fresh session.
- **Two agents touching the same card** — n/a; this plan writes no cards. The
  concurrency it introduces is two deliveries into one reserved session, which
  serializes through the existing busy/enqueue fork.
- **Hand-edit drift** — a boxholder hand-edits `session.json` with a malformed
  target. **ADDRESSED**: unchanged; the target resolver falls back rather than
  matching by accident.
- **Fabricated free-form value** — n/a; no agent authors a session id.
- **Validation error UX** — a rejected reservation returns a typed
  `ReserveResult`, not an error string, so the client's retry is a branch rather
  than message-sniffing (#5).
- **Partial migration / transition state** — **ADDRESSED**: additive on the
  wire. Old clients keep sending `"new"`; existing sessions are untouched;
  Codex boxes never enter the new path. No bilingual window to unwind.

## NOT in scope

- **Making chat identity fully ours.** A box-owned id with the harness id as a
  resume token would make Codex stop being a special case, but the harness id is
  also the transcript path (`history.ts:292`), the URL, the husk key, and the
  Codex-engine key — a migration, not a refactor. Deferred deliberately.
- **Coining ids for Codex.** `codex-chat.ts:42-97` takes whatever the Codex SDK
  assigns and exposes no equivalent option. Revisit if it gains one.
- **The `/capture` deep link's most-active fallback** (`deliver.ts:88-93`). A
  deep-link capture has no chat on screen, so coining does not apply, and the
  boxholder expects `/capture` to be removed (2026-08-20 decision).
- **`issues/bugs/2026-08-20-capture-success-is-invisible.md`** — a delivered
  capture signals success by disappearing. Same area, different fix: this plan
  changes where a capture lands, not how it reports.
- **`issues/bugs/2026-08-20-failed-capture-chip-cannot-be-discarded.md`** — a
  stuck row needs a discard affordance, independent of targeting.
- **The `starting`-phase enqueue fork** flagged in
  `issues/bugs/2026-08-05-open-chat-flashes-agent-working-no-send.md`. Deliberate
  (`lifecycle.ts:105-118`) and correct for the first-input case.
- **iOS native capture and bulk upload.** `CaptureAPI.swift:151-186` and
  `BulkUploadAPI.swift:74-119` pass an optional target through unchanged; the
  webview's chat gets coined ids for free. Per the `cb-ios-overlap` skill, the
  shared surfaces touched are `/api/chat/send` (unchanged shape) and the
  bootstrap procedure (additive input). No native change lands here.
- **Deleting the `"new"` client machinery.** It stays for Codex and legacy
  clients. Removing it is a follow-up once Codex is handled or dropped.

## Open design questions

Both questions the plan opened were settled during implementation:

- **Reservation is its own mutation (`chat.reserveSession`), not a bootstrap
  flag.** The round-trip argument for folding it into bootstrap turned out to be
  imaginary: the client skips `chat.bootstrap` entirely for `?session=new`
  (`ChatPage.tsx`, `enabled: !isFreshChat`), so there was no trip to share. A
  mutation also keeps the query free of side effects.
- **The warm cap is 2** (`MAX_WARM_SLOTS`, `services/claude-chat.ts`) — one
  speculative slot plus one open-but-unwritten chat. Revisit if a box shows
  subprocess pressure.

## Knowledge audits

No new agent-facing concept lands. A coined id is a UUID that the browser, the
HTTP boundary, and the registry pass around; a box agent sees the same
`CB_CHAT_SESSION_ID` it sees today, just earlier. The one thing an agent
encounters differently is a chat whose first user message is a `<capture>` or
`<upload>` wrapper with no preceding typed message, which already happens
through the `/capture` deep link and is covered by existing capture guidance.
Skipping audits deliberately.

## Implementation order

1. **Chunk 1 (Track A)** — `reserve.ts`, reserved registry entries, `sessionId`
   passthrough in `buildQueryOptions`, `CB_CHAT_SESSION_ID` direct injection.
2. **Chunk 2 (Tracks B + E)** — `target.ts`, the four call sites, the
   `chatExists()` predicate wired into all four existence gates, the lint rule.
   Depends on 1.
3. **Chunk 3 (Track C)** — minting, the `reserve` bootstrap input, the URL
   rewrite, the Codex fallback. Depends on 1 and 2.
4. **Chunk 4 (Track D)** — the gates deleted. Depends on 3.
5. **Chunk 5** — the session-id-file deletion for coined sessions, once nothing
   reads it on that path. Depends on 1 and 3.
6. **Chunk 6 (Track A)** — per-chat prewarm keyed by the coined id,
   replacing the box-wide slot; the cap and the sweep interaction. Last because
   it is latency, not correctness.

## Rollout shape

**Test posture**, named as part of the design per `docs/testing.md`:

- `test/core/chat/session/reserve.doctest.md` (Chunk 1) — reserving is
  idempotent; a colliding id returns `taken`; a reserved id is addressable by
  send before any turn; a reaped reservation is re-creatable with the same id.
- `test/core/chat/session/coined-id.real-sdk.doctest.md` (Chunk 1) — the
  dependency test: a coined UUID is the id the harness reports, and a warm slot
  carries it. This is what fails on an SDK bump that drops the option.
- `test/core/chat/session/target.doctest.md` (Chunk 3) — each `ChatTargetSpec`
  kind resolves to the expected session; two concurrent resolutions of one
  reserved id yield one session (the double-send case from the third job story).
- A bootstrap test (Chunk 4) — `reserve: true` returns `reserved` on Claude and
  `unsupported` on Codex; the client's URL rewrite follows.
- Extend `test/tours/capture.tour.ts` (Chunk 5) — open a new chat, capture as
  the very first action, assert the capture lands in that chat and the box gained
  exactly one session. This is the tour that would have caught the filed issue.

**Done-when:** the above pass, plus the existing chat-send, capture,
bulk-upload, and schedule suites unchanged, and a manual check on a Codex-engine
box that the `"new"` path still works.

**Knowledge audits:** none, per the section above.

**Migration:** none. No on-disk shape changes; existing sessions, staging rows,
and history entries are read and written exactly as today.

**Cross-model review:** required before this plan is called done — it spans the
frontend, the HTTP boundary, the registry, the backend spawn path, and two
delivery pipelines.
