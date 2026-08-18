---
title: "Emission model: durable acceptance, no sticky pending states"
status: draft
workstream: emission-model
issues:
  - ../../../issues/bugs/2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md
  - ../../../issues/bugs/2026-08-18-ios-stuck-sending-message-survives-restart.md
  - ../../../issues/bugs/2026-08-18-ios-keyword-tag-leaks-into-composer-when-sending-is-stuck.md
  - ../../../issues/bugs/2026-08-03-ios-stale-unconfirmed-emission-banner.md
  - ../../../issues/bugs/2026-07-23-voice-send-lingers-as-unsent-recovery-draft.md
  - ../../../issues/bugs/2026-08-18-first-message-audio-not-retranscribable.md
---

# Emission model: durable acceptance, no sticky pending states

Six filed bugs cluster around one model problem — a chat send can sit in a
pending state for minutes (or forever), and several of those pending states
have no exit — plus two satellite defects with their own causes (the draft
clear, the keyword substitution). This plan changes the model so acceptance
is fast and durable, every remaining pending state has a bounded exit, and
the client-side machinery shrinks instead of growing timeout rules.

## The diagnosis (what the code says today)

The current model, after `ef20af7f` (2026-08-15):

- The **receipt is the `/api/chat/send` POST response** — there is no separate
  receipt broadcast (`src/frontend/src/input/targets/receipts.ts`,
  `src/frontend/src/lib/chat-receipt-settlement.ts`). No side manufactures a
  verdict from elapsed time (`docs/mobile-contract.md` §4.2).
- The server **claims the messageId before running** and persists claims for 7
  days (`src/webapp/routes/chat-send-routes.ts:207-215`,
  `MESSAGE_ID_TTL_MS`), so redelivering the same emission ID is idempotent.
- iOS keeps a **durable pending-emission queue** that replays on relaunch
  (`ios-app/CallbackBox/Storage/PendingEmissionStore.swift` — `activate()` at
  lines 24-52) and redelivers on navigation (`ChatWebView.swift`,
  `didCommit`/`didFinish` since `ef20af7f`).

The load-bearing fact: **on the idle path, the POST response is coupled to
engine startup.** `chat-send-routes.ts:295` awaits `chatSession.send()`, which
includes spawning the engine — minutes on a cold Codex. The busy path already
acks in milliseconds: `enqueue` + persist the `chat-user-message` event +
return `{queued: true}` (`chat-send-routes.ts:250-259`). Every symptom in the
cluster lives inside the minutes-long idle-path window, or in a pending state
that has no exit while waiting on it:

| Wedge | Where | Exit today |
|---|---|---|
| Web receipt promise never settles | `receipts.ts:33` map; settle only from `chat-actors.ts` call sites | none (30s diagnostic log only) |
| iOS `.awaitingReceipt` | `PendingEmissionStore.swift:203-228`; no staleness rule, replayed unchanged on relaunch | receipt, or user Retry/Restore/Discard on `.rejected` only |
| Server dedup claim with no recorded message | claim persisted at `chat-send-routes.ts:214`, *before* `recordUserMessage()` at :315 | 7-day prune; a crash mid-turn leaves "already sent" answering for a message history never got |
| Persisted web draft after send | `usePersistScheduler.ts:58-64` — flush only on `visibilitychange→hidden`; unmount cancels the pending clear | tab-hide, or the user discarding the bogus recovery offer |
| iOS keyword tag stranded in composer | `SpeechKeywords.swift:154` substitutes before `NativeComposerView.swift:442-456` can refuse | user hand-edits the tag out |

Two places the filed issues disagree with the code, worth stating so the plan
doesn't chase them:

1. **The stuck-send → stuck-`isSending` link is not real.** `isSending` is
   `isPreparingSend || batchProgress != nil || !draftStore.isReady`
   (`NativeComposerView.swift:636-638`). `isPreparingSend` spans only the
   `enqueue`/`stageVoicePreparation` call (:512-538, :600-624), not the
   `.awaitingReceipt` window. A wedged pending emission does **not** hold
   `isSending` true. Whatever wedged it on the developer's device was one of
   the other two terms (a stuck batch upload, or `ComposerDraftStore.isReady`
   never turning true) or a hung staging call. Track D includes finding out.
2. **The "chat did not confirm the message" banner no longer exists.**
   Repo-wide grep finds no such string in `ios-app/`; the current UI is the
   generic `.rejected(reason:)` presentation (`NativeComposerView.swift:1400-1411`).
   Issues 2026-08-03 and 2026-08-04 cite a pre-refactor line. The underlying
   defect (Retry on an already-run message duplicates the turn) is still real.

Also relevant: the stuck-restart report (2026-08-18) describes behavior that
`ef20af7f`'s relaunch-redelivery should already cure *when the installed app
build includes it* — relaunch replays the entry, the web page re-POSTs the same
ID, the dedup map answers `deduplicated: true`, the receipt clears the entry.
Verifying the installed build predates the fix is step zero of Track E, before
any of this plan's iOS work is credited or blamed.

## Why "reconcile against durable history" is not the design

The briefing's inherited thesis was: treat history as the source of truth and
the receipt as an optimization. It fails on identity: **durable chat history
never records the client messageId** (grep: no `messageId` anywhere under
`src/core/chat/`). "Is this message in history" has no key to match on —
text-matching would guess, and guessing feeds the duplicate-turn trap. The
dedup registry is the only durable record keyed by emission identity, and it
already exists. So the model this plan commits to:

> **The server's claim registry is the source of truth for "did my send
> land."** A pending emission resolves by (re)delivering — always safe because
> delivery is idempotent — and the server answers from its durable record.
> Nothing reconciles by inspecting history; nothing invents a verdict from
> elapsed time.

`ef20af7f` already built most of this. What remains is to make acceptance
fast (so pending states are short-lived), make the claim durable at the same
moment the message is durable (so the registry cannot lie), and give the few
remaining pending states bounded exits.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — resilient-not-silent (wedges must
  surface, not spin forever); validate-at-boundaries; fewer states over more
  expiry rules.
- `callback-box/CLAUDE.md` — "Read before writing"; mobile-contract is the
  single owner of the bridge vocabulary; time discipline (`awake-timeout` for
  any iOS/web timer this plan adds — plain timers fire wrong across sleep).
- Boxholder directives from the briefing: never duplicate a turn; never lose
  the user's text; the `isSending` lock's *refusal* is correct; prefer
  removing a state to adding a timeout; restart should be a cure, not a
  preservative.
- Memory/feedback: bias-toward-strict, but stop over-engineering rare
  failures (bounds Track A's crash-recovery scope); minimize invented
  concepts — keep the existing `{turnId}`/`{queued}` response shapes rather
  than minting new dispositions.

## What already exists

- **Fast-ack path**: `chat-send-routes.ts:250-259` — enqueue + persisted
  `chat-user-message` + `{queued:true}`. Track A generalizes this; it does
  not invent a new response shape.
- **Idempotent redelivery**: 7-day persisted claim map
  (`chat-send-routes.ts:128-155`), iOS same-ID redelivery on nav/relaunch
  (`ChatWebView.swift` post-`ef20af7f`). Track B's in-session redelivery
  reuses it.
- **Outcome-shared receipt expectations**: duplicate `expectReceipt` calls for
  one ID share the real outcome (`receipts.ts`, covered by
  `test/frontend/receipts.doctest.md`). Redelivery therefore cannot
  double-settle.
- **Terminal state with user affordance**: `.rejected` with
  Retry/Restore/Discard (`NativeComposerView.swift:1400-1411`). Track B's
  long-pending affordance reuses this UI shape without reusing the state (a
  long wait is not a rejection).
- **In-band failure surfacing precedent**: queue-drain failures are reported
  on the session as `error` events, not HTTP responses
  (`src/core/chat/session/index.ts:289-301`). Track A's spawn-failure
  surfacing follows this shape.
- **`removePersistedEmission`** already exists (`emission-persist.ts`) — Track
  C only adds the synchronous call site the 2026-07-23 issue identified.

## Prior art (external)

- **Idempotency keys for retried POSTs** — the model Track A/B completes is
  Stripe's idempotent-requests pattern (client-minted key, server-side claim
  registry with TTL, safe blind retry):
  [Stripe: Idempotent requests](https://stripe.com/docs/api/idempotent_requests).
  Their TTL is 24h; our 7 days is defensible for an offline-capable phone
  client.
- **Durable-record-then-deliver** — Track A's "persist the message, ack, then
  run the engine" is the transactional-outbox shape:
  [microservices.io: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html).
  We deliberately take only half of it (durable record + in-band failure
  surfacing), not a guaranteed-redelivery relay — see Could this be simpler.
- No external prior art searched for the WKWebView receipt-timing half;
  `ef20af7f` already solved it internally and this plan does not reopen it.

## Tracks

Ordered by dependency, then size. A, B, C, D are independent enough to commit
separately; B's UX depends on A's semantics being decided first.

### Track A — durable acceptance: always ack from the record, never from the spawn

**What.** Make the idle send path ack the way the busy path already does:
persist the user message + claim, respond immediately, start the run
asynchronously. The POST response becomes "the box durably has your message,"
not "the engine started." Concretely:

- Reorder so the durable claim persists at the same moment as
  `recordUserMessage()` — one durability point, not two. In-memory claim
  still happens first (the in-flight double-submit guard at
  `chat-send-routes.ts:207-215` stays); only the *persisted* write moves next
  to the persisted message event. A crash before that point loses both
  together (client retries, message runs once); a crash after loses neither
  (client retries, gets `deduplicated: true`, and history really has the
  message). The current 7-day false-"already sent" window
  (claim persisted at :214, message recorded at :315, minutes apart on a cold
  spawn) closes.
- **A duplicate POST must not settle from a volatile claim** (cross-model
  finding): if request A holds only the in-memory claim and request B answers
  `deduplicated: true`, a crash of A before the durable write leaves B's
  client believing a send that never landed. So a volatile claim carries the
  in-flight request's outcome promise, and a duplicate POST awaits and
  returns *that* outcome (the server-side mirror of the client's shared
  receipt expectations in `receipts.ts`). `deduplicated: true` is answered
  only from a durable claim.
- Idle path: mint `turnId` + wire `captureTurn` exactly as today
  (`chat-send-routes.ts:284-285` — both already happen *before* `send()`),
  persist the record, and **respond `{turnId}` immediately**; `send()`
  continues async. The response shape does not change, so turn-stream
  attachment and receipt settlement in the frontend are untouched — only the
  wait for engine spawn is removed. This dissolves what an earlier draft
  left open (how clients attach under an always-`queued` ack): they attach
  the way they always have.
- A spawn failure after the ack surfaces **in the turn stream the client is
  already attached to**: the async continuation catches `send()`
  rejection/false, fails the capture with an error frame (new small API on
  `captureTurn` — today it only has `cancel()`, `chat-send-routes.ts:285`),
  releases the pin, and does **not** release the durable claim (the client
  was told success; history has the message; releasing would let a
  redelivery duplicate the history record). `ChatSession.send()` itself does
  not emit session errors on start failure (`session/index.ts:311+` — only
  `drainQueue()` wraps it, :293-300), so this plumbing is explicit new work,
  not free reuse; the doctest for it uses a fake engine whose spawn rejects.
- The busy path keeps `{queued: true}` unchanged. Note honestly: idle sends
  include **new-session** sends (`knownId === null`), which the busy path
  never sees — `recordUserMessage()` already emits with a null sessionId and
  subscribers pick it up on `session-assigned` (`chat-send-routes.ts:229-237`),
  and `pinSession`/`captureTurn` already support a pending session (:275-285),
  but the A2 doctests must cover the new-session case explicitly.

**Why.** Every symptom in the cluster needs a minutes-long pending window to
manifest. Shrinking acceptance to ~one disk write removes the window itself,
which is the "fewer states that can wedge" outcome the developer asked for —
the pending states still exist, but their occupancy drops from minutes to
milliseconds, and the cold-agent trigger disappears entirely.

**Semantics to state honestly** (this is the decision the developer must
ratify): after Track A, a receipt no longer implies the engine ran — it
implies the message is durably recorded and will be delivered (the `{turnId}`
response arrives before the spawn finishes, possibly before it starts). That
is already true of every `{queued:true}` ack today, including its failure mode:
a crash after ack loses the *delivery* while history keeps the message
(`session/index.ts` — `messageQueue` is in-memory; drain failures deliberately
do not re-queue, :293-300). Track A extends existing semantics to the idle
path; it does not invent them. What it adds for that failure mode: an
accepted-but-undelivered message must be *visible* — see failure modes.

**First chunk.** Move the persisted-claim write to sit beside
`recordUserMessage()` (both paths) and make duplicate POSTs share the
in-flight outcome instead of answering from a volatile claim. Route doctests
assert: crash simulation between in-memory claim and durable record → retry
with same ID runs the message exactly once; crash after durable record →
retry gets `deduplicated: true`; concurrent duplicate POST → both responses
report the same real outcome.

### Track B — iOS: two pending states become one, and every state has an exit

**What.**

- Collapse `PendingEmissionState` (`Models/ComposerDraft.swift:135-139`)
  from `.awaitingWebView | .awaitingReceipt(attempt, sentAt) | .rejected` to
  `pending(deliveryAttempts, lastAttemptAt) | rejected(reason)`. Whether the
  webview currently holds the emission is session state
  (`inflightEmissionIDs` in `ChatWebView.swift`), not a durable distinction —
  today's split is two names for "not yet confirmed."
- **In-session redelivery**: a `pending` emission whose receipt has not
  arrived redelivers on a gentle backoff (awake-time, not wall-clock —
  `CLAUDE.md` time discipline). Redelivery must first *abandon the inflight
  attempt*: `deliver()` skips any ID in `inflightEmissionIDs`
  (`ChatWebView.swift:422`) and nothing clears that set while a POST hangs,
  so the backoff step removes the ID and delivers again. A late receipt from
  the abandoned attempt is dropped by the `inflightEmissionIDs.contains`
  guard (`ChatWebView.swift:450`) — harmless, because the new attempt
  re-asks the server and the claim registry answers idempotently; on the web
  side, duplicate expectations for one ID already share the real outcome
  (`receipts.ts`). Redelivery is the *same* idempotent delivery, so this is
  a retry loop, not a timeout verdict. With Track A the loop almost never
  fires past the first attempt.
- **User exit on long-pending**: a `pending` emission older than a threshold
  renders differently ("Still waiting for the box to confirm — Discard /
  Restore") reusing the `.rejected` presentation shape without becoming
  `rejected`. Discard/Restore already exist on the store
  (`PendingEmissionStore.swift:239-270`). This satisfies "no state without an
  exit" via a user decision, never a manufactured failure.
- **The doubling fix falls out**: a replayed `pending` entry and a live one
  are the same state with different ages; the age-differentiated rendering
  plus fast dedup resolution replaces "two identical Sending message… rows."

**Why.** `.awaitingReceipt` is the one state that today can wedge forever and
replays forever (`PendingEmissionStore.swift:24-52`, no staleness rule
anywhere). This gives it an exit (redeliver → server answers) and a user
override, while *removing* a durable state rather than adding an expiry rule.

**First chunk.** The state collapse + persistence migration of stored
entries: old enum cases decode into `pending`, **preserving**
`.awaitingReceipt`'s `attempt` and `sentAt` as `deliveryAttempts` and
`lastAttemptAt` (a lossy decode would reset a long-stuck row to "fresh" and
delay its long-pending affordance). XCTest coverage in
`ChatWebViewRequestTests`/store tests. No behavior change yet.

### Track C — web: the draft clear on send is synchronous

**What.** On send, call `removePersistedEmission` directly, bypassing the
debounce; additionally flush (not cancel) any scheduled write on unmount
(`usePersistScheduler.ts:58-64`, `useEmissionPersistence.ts:203`). Doctest
the scheduler's flush semantics (currently uncovered — the gap named in the
web map).

**Why.** Issue 2026-07-23, mechanism re-verified current: send schedules a
debounced clear; quick in-app navigation unmounts and cancels it; the
dictation-era draft survives and is offered as "unsent." A definitive event
(send) must not be debounced like a keystroke. This is a genuinely separate
root cause from the receipt family — the issue's own 2026-08-14 dedup check
holds — and stays its own track so the distinction isn't lost.

### Track D — iOS voice: refusal must precede substitution, and the wedge gets named

**What.**

- Move keyword-tag substitution behind the gate: `handleKeywordIntent`
  (`NativeComposerView.swift:442-456`) refuses *before* the tag from
  `SpeechKeywords.swift:154` reaches composer text — either gate inside the
  detection pipeline, or undo the substitution on refusal. The tag never
  appears in the composer for a command that did not run.
- Detection rejects already-tagged input, so a repeat cannot nest even if
  another path leaks a tag.
- Honest status: the refusal message stops promising "try again in a moment"
  when the blocking term is not transient.
- **Diagnose the real `isSending` wedge**: instrument the three terms
  (`isPreparingSend`, `batchProgress`, `draftStore.isReady`) with `BoxLog`
  transition entries (per `ios-app/CLAUDE.md` runtime-diagnostics rule) so
  the next field occurrence names its term. The filed issue's assumed
  mechanism (stuck pending emission) is contradicted by the code — see
  diagnosis section — so this needs evidence, not a guess. Candidate
  suspects to inspect while instrumenting: a hung `stageVoicePreparation`
  (`NativeComposerView.swift:516`), a `batchProgress` that never clears on a
  failed upload path, `ComposerDraftStore` load stalling (`isReady` set
  `false` at `ComposerDraftStore.swift:42,54`).
- Check the web keyword path (`src/frontend/src/lib/audio/speech-keywords.ts`,
  `input/voice-intent.ts`) for the same substitute-then-gate shape; fix or
  record that it differs.

**Why.** The lock's refusal is correct (its comment says why; the briefing
ratifies it). The defect is textual residue of a refused command, plus a
diagnosis gap. Voice-output-during-nonempty-composer (the issue's third
symptom) is deferred until the wedge is named — it is likely the same wedged
term.

### Track E — field verification and the audio lead

- **Step zero**: confirm whether the installed iPhone build includes
  `ef20af7f` (its iOS half needs an app install). The stuck-restart report may
  describe the pre-fix app against the post-fix server. Outcome decides how
  much of Track B's redelivery work remains load-bearing vs. belt-and-braces.
- The receipts issue's existing `needs: [manual-testing]` gate (cold-Codex
  first send) remains; Track A changes what the tester should see — the plan
  updates the issue's Manual testing section when A lands (expected: composer
  clears in ~a second even on a cold agent).
- **First-message audio** (2026-08-18): investigated — the issue's Research
  section now records two mechanisms: native voice sends are *never*
  retranscribable (the recording is deleted after HQ transcription and the
  tab retention store never holds it), and web voice retention is page
  memory wiped by any reload — the same cold-start/navigation transition as
  the receipts family. Whether to fix it here (server-side retention keyed
  by emission ID, carried on the transcribe upload) is a scope decision for
  the developer; the plan takes no dependency on it either way.

### Contract and docs

`docs/mobile-contract.md` §4.2 semantics update (receipt = durable
acceptance; also fix its internal staleness — it still says a "timeout"
receipt clears pending state while elsewhere denying elapsed-time verdicts),
§3.4 correction (it still describes pre-`ef20af7f`
provisional-nav clearing; the code moved to `didCommit`), and an explicit
ownership statement: **iOS owns the durable pre-POST queue and redelivery;
web owns dispatch and settles receipts from the POST outcome; the server owns
acceptance, the claim registry, and delivery.** Keyword detection ownership
(native vs web) gets one sentence after Track D's web-path check.

## Could this be simpler?

The simplest version that could plausibly work: keep the post-`ef20af7f`
model unchanged and land only Tracks B (redelivery + exit affordance), C, and
D — pure client patches, no server change.

What A buys over it: without A, every pending state still routinely lasts
minutes on a cold agent, so the patches must be good UX for a *common* state
— the spinner, the long-pending affordance, the redelivery loop all fire in
normal use, and the "first send after cold agent" trigger keeps producing
field reports (resilient-not-silent says surface wedges; it does not say
make waiting a lifestyle). With A, the same client states exist but are
almost never occupied, and the cluster's reliable reproduction disappears at
the root. A is also the smallest track in code terms — it reorders one
durability write and reuses an existing response disposition.

Conversely, the fuller version this plan deliberately does *not* build: a
durable server-side delivery queue with boot-time redelivery (full outbox).
The in-memory `messageQueue` already drops delivery on crash for busy-path
sends today; A keeps that bounded failure (visible message in history, agent
never saw it) rather than building guaranteed delivery —
`stop-over-engineering-rare-failures`, and the failure is user-visible and
user-recoverable (the message is in the transcript; sending "did you get
that?" or re-sending is safe under dedup only if the user chooses it).

## Subplans

None. Track A keeps the `{turnId}` response and the existing turn-stream
attachment, so no client-attachment design remains open. If the
`captureTurn` error-frame API turns out to need real design, that becomes a
subplan rather than an inline improvisation.

## Failure modes

> **Critical gap (accepted, documented):** crash after ack, before delivery —
> the message is in history, the agent never received it, and nothing
> redelivers. Exists today for every busy-path send
> (`session/index.ts:293-300` deliberately does not re-queue). Track A makes
> this window apply to idle-path sends too. Mitigation in-plan: the message
> is visibly in the transcript (not lost), a `session error` event surfaces
> the failed drain, and re-sending is duplicate-safe. Full fix (durable
> outbox) explicitly rejected above.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Crash between in-memory claim and durable record+message | planned (A chunk 1 doctest) | retry re-runs once (claim was volatile) | clear |
| Crash after durable record | planned (A chunk 1 doctest) | retry → `deduplicated: true`; history has message | clear |
| Spawn fails after the `{turnId}` ack | planned (A doctest via fake engine) | error frame into the captured turn stream; text preserved in history | clear (turn stream shows failure) — must verify the web UI actually renders a turn-stream error frame; if it drops it this is silent and A is not done |
| iOS redelivery loops against an unreachable box | planned (XCTest) | backoff + long-pending affordance (Discard/Restore) | clear |
| Old persisted `PendingEmissionState` cases after Track B's migration | planned (XCTest decode test) | decode legacy cases into `pending` | clear |
| Unmount flush writes a stale draft over a newer one (Track C) | planned (scheduler doctest) | flush executes the *latest* scheduled write only | clear |
| Keyword refusal leaves partial transcript mutation (Track D) | planned (XCTest on SpeechKeywords) | substitution gated/undone atomically | clear |
| Receipt for an emission the store no longer holds (redelivery races Discard) | exists (`receipts.doctest.md` shares outcomes; iOS `handleReceipt` no-ops on unknown ID) | yes | silent by design (correct) |

## Agent-flow / user-flow edge cases

This is transport/UI work, not card/vocabulary work, so the standard seven
mostly do not apply. The ones that do:

- **Two clients sending the same emission** (phone + reopened web tab after
  recovery): ADDRESSED — claim registry, `deduplicated: true`, shared
  receipt outcomes.
- **User retries an already-run message via UI affordance**: ADDRESSED —
  Retry re-POSTs the same emission ID; dedup answers; no duplicate turn.
  This closes the 2026-08-03 issue's trap without history inspection.
- **Hand-edit drift equivalent — user edits composer text containing a leaked
  tag**: ADDRESSED by Track D (tags never reach the composer; detection
  rejects tagged input as a backstop).
- **Partial rollout — new app build against old server or vice versa**:
  ADDRESSED — the response shapes (`{turnId}`/`{queued}`) are unchanged;
  Track B's state collapse is iOS-internal; no wire shape changes. The one
  ordering rule: Track A (server) may land before any iOS build; nothing in
  A requires a client change.

## NOT in scope

- **Durable server-side delivery queue / boot-time redelivery** — rejected
  above; the bounded crash-after-ack failure is accepted and documented.
- **History recording the client messageId** — would enable history
  reconciliation, but the plan's model makes reconciliation unnecessary;
  adding identity plumbing through history for no consumer is invented
  concept surface.
- **Codex cold-spawn speed itself** — Track A makes spawn latency invisible
  to the send path; making spawn faster is a separate concern.
- **The mic-open-during-sleep issue** (`a99c1695`'s sibling report) — same
  filing batch, different subsystem.
- **Voice-output-suppression symptom** (keyword issue's third report) —
  deferred until Track D's instrumentation names the wedged term.
- **Turn-stream refactor** — Track A keeps the `{turnId}` response and the
  existing attachment mechanics; any broader turn-stream rework is out of
  scope.

## Open design questions

1. **Long-pending threshold for the iOS affordance.** Lean: show the
   affordance after ~30s awake-time pending (post-A this is already
   anomalous), with no automatic state change ever.
2. **Does the web composer need the same long-pending affordance as iOS?**
   Post-A the web pending window is milliseconds; lean no — the existing
   error-path restore covers rejects. Revisit if Track E's field testing
   disagrees.

## Knowledge audits

None. No box-agent-facing concept changes — this is transport, client state,
and contract documentation. Box agents never see emissions or receipts.
(Skip-with-rationale per the template.)

## Implementation order

1. **A1** — claim-write reorder + crash-window doctests (server only, safe
   alone).
2. **A2** — idle path responds `{turnId}` before `send()` settles; spawn
   failures become turn-stream error frames (`captureTurn` fail API);
   verify/fix web rendering of that error frame; new-session-send doctest;
   update receipts doctests.
3. **C** — synchronous draft clear + scheduler flush semantics + doctest
   (independent; can land any time).
4. **B1** — iOS state collapse + decode migration + tests.
5. **B2** — in-session redelivery with awake-time backoff; long-pending
   affordance; age-differentiated rendering.
6. **D** — substitution gating + tagged-input rejection + `isSending`-term
   instrumentation + web-path check.
7. **Docs** — mobile-contract §3.4/§4.2 + ownership statement; issue updates
   (including correcting the two stale claims named in the diagnosis).
8. **E** — runs alongside: installed-build check first (before B is credited);
   manual-testing instructions refreshed after A2.

## Rollout shape

- **Tests first as design tool**: A1/A2 route doctests (fake engine for spawn
  failure), scheduler doctest (C), XCTest for state decode + redelivery (B),
  SpeechKeywords XCTest (D). Done-when is encoded there, plus the two field
  gates below.
- **Manual-testing gates** (only the developer clears): the cold-Codex first
  send (existing gate on the receipts issue — post-A the expected behavior
  changes to "clears immediately"), and the Track B long-pending affordance
  on a real device with the box unreachable. Both get `## Manual testing`
  sections per `issues/CLAUDE.md`.
- **No migration of on-disk box data.** The only stored-shape change is
  iOS-local (`PendingEmissionState` decode migration, B1). Server dedup file
  shape is unchanged.
- Ships as one unit from this worktree; commits at track boundaries; no merge
  to main without the developer's say-so.
