---
title: "Deferred-recoverable agent failures: engine unavailability as a first-class condition"
status: draft
workstream: deferred-recoverable
issues:
  - ../../../issues/bugs/2026-08-18-codex-quota-exhaustion-surfaces-as-a-meaningless-error.md
---

# Deferred-recoverable agent failures

The system collapses every agent-run failure into one bucket. This plan adds a
second, narrow bucket: **deferred-recoverable** — the engine will not work now,
will work later (often at a known time), and nothing on the task's side is
broken. Codex quota exhaustion is the motivating instance; the category is the
deliverable. The plan names the condition **engine unavailability**, detects it
from recognized provider signals only, and changes behavior at each consumer:
chat says what happened and when it resolves, the scheduler defers instead of
accruing failures, procedures abort cleanly, `cb health` renders "waiting" not
"failing", and the operator is notified once per episode.

Three failure kinds, for vocabulary:

- **Transient** — retry now, it may work (an `index.lock` race). Exists today
  as one-off retries; owned by
  [scheduled task dies on git index.lock](../../../issues/bugs/2026-08-18-scheduled-task-dies-on-git-index-lock.md).
- **Deferred-recoverable** — will not work now, will work later, often with a
  known-by time; account/service-scoped, not task-scoped. Missing today. This
  plan.
- **Permanent** — broken until a human acts. Today's default, and it stays the
  default for anything unrecognized.

## Confirmed mechanism (live probe, 2026-08-18)

With quota exhausted, `codex exec --experimental-json` emits the semantic
failure on stdout before exiting 1:

```
{"type":"error","message":"You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 19th, 2026 11:34 PM."}
{"type":"turn.failed","error":{"message":"You've hit your usage limit. ..."}}
```

`CodexSdkSession.run` already captures those events
(`src/services/codex-sdk-session.ts:199-203`: `else if (event.type ===
"turn.failed") { error = event.error.message; }`). The loss point is the catch
at `codex-sdk-session.ts:212-217`: the SDK's generator *also* throws a
process-exit error after the stream ends (`@openai/codex-sdk/dist/index.js:294`:
`` throw new Error(`Codex Exec exited with ${detail}: ${stderrBuffer}`) ``),
and the catch rethrows it, discarding the good message already captured. The
issue's pointer at `codex-run.ts:85` is secondary — that filter only affects
the activity/output callbacks; the terminal status logic lives in the session
wrapper.

Correction to the issue text: `refresh-maps` does **not** retry its validation
— its validate step is `severity: warn`
(`templates/procedures/refresh-maps.procedure.card:140-171`), which reports
without gating. The retry-after-failed-validation loop is the generic
`severity: review` mechanism (`src/core/procedure/engine-run-phase.ts:257-291`)
and that is the code path this plan must gate.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` #1 (types are structure), #2
  (exhaustiveness), #4 (resilient AND never silent — and never resilient to
  the impossible), #5 (failure paths visible in signatures where callers
  branch), #6 (right-sized defensiveness), #8 (one way to do each thing).
- `code-style.md` "When to Result vs throw": callers here genuinely branch on
  *why* the run failed, so the cause belongs in the returned type, not in
  string matching at N consumers.
- `src/lib/result.ts` doc comment: "prefer a tagged union when callers act on
  the cause."
- Precedents: `google-auth-alert.ts` (one notification per episode of an
  account-level condition), `health-alert.ts` (alert latch cleared on heal),
  `scan-vision-claude.ts:218-220` (narrow regex classification of a provider
  failure string).
- Boxholder feedback: classification must be narrow and evidence-based — a
  misclassified permanent error parked as "recoverable someday" is worse than
  today's noisy failure.

## What already exists

| Thing | Where | Reuse or rebuild |
|---|---|---|
| `AgentResult` discriminated union both engines return | `src/core/agent/types.ts:74-76` | Reuse — add an optional typed field to the failure arm |
| Codex event capture (`turn.failed`, `error`) | `src/services/codex-sdk-session.ts:199-203` | Reuse — fix the rethrow that discards it |
| Claude-path failure translation | `src/core/agent/run.ts:111-151` (`buildAgentResult`) | Reuse — add recognition there |
| Single outcome-recording choke point for schedules | `src/core/schedule/state.ts:203` (`recordOutcome`) | Reuse — add a `"deferred"` result |
| Pre-run skip gates | `src/cli/commands/tick-helpers.ts:112` (`evaluateSkip`) | Reuse — add an unavailability gate |
| Once-per-episode notification latch for an account-level condition | `src/core/schedule/google-auth-alert.ts` | Model to copy (latch lives in the new store, not per-task state) |
| Operator notification fan-out | `src/core/notify-boxholder.ts:68` (`notifyBoxholder`) | Reuse |
| Machine-level state locations | `~/.config/cb/` (`boxes-config.ts:33`), `~/.local/share/cb` (`push-subscriptions.ts:72`) | Follow — store goes in `~/.local/share/cb/` |
| Narrow provider-failure regex classification | `src/services/scan-vision-claude.ts:218-220` | Pattern precedent (that classifier stays subsystem-local; it classifies *transient*, a different kind) |
| Normalized quota windows with ISO `resetsAt` | `bin/agent-quotas.ts:11-25` (dev repo) | Not wired in; see NOT in scope |
| Health rendering of task status | `src/cli/commands/health.ts:44-58`, `src/core/schedule/health.ts:111` | Reuse — add a waiting state |

## Prior art (external)

- **Codex CLI JSON event stream under quota exhaustion**: verified empirically
  (probe above) rather than from docs; the `--experimental-json` event shapes
  match the SDK's `ThreadEvent` types (`@openai/codex-sdk/dist/index.d.ts`).
  The SDK's own `run()` (non-streamed) turns `turn.failed` into a thrown error
  with the semantic message (`dist/index.js:116-118`) — upstream treats the
  event as the authoritative failure, supporting the same choice here.
- **Reset-time format**: the Codex message embeds a human date ("try again at
  Aug 19th, 2026 11:34 PM") with no timezone. No documented machine-readable
  field exists in the exec surface; the app-server protocol (used by
  `bin/agent-quotas.ts`) exposes unix-seconds resets, but that is a different
  channel. We parse the human date as box-local time and clamp (failure
  modes below).
- **Claude usage-limit surface**: Claude Code historically emits
  `Claude AI usage limit reached|<unix-epoch>`; the Agent SDK also exposes
  typed `rate_limits` via the usage control request (consumed by
  `bin/agent-quotas.ts:214`). Not live-verifiable now (Claude quota is not
  exhausted); the Claude recognizer ships provisional and narrow.
- No named external pattern search beyond this — the mechanism (classify →
  side-channel store → defer/latch) is composed from in-repo precedents.

## Design

### The type

One new leaf module `src/core/agent/engine-unavailability.ts`:

```ts
export type EngineProvider = "codex" | "claude";

export interface EngineUnavailability {
  provider: EngineProvider;
  /** Extensible union; only add reasons with a recognized, evidence-based signal. */
  reason: "quota-exhausted";
  /** ISO. Parsed from the provider message when possible; otherwise detectedAt + 1h. */
  retryAt: string;
  detectedAt: string;
  /** The provider's verbatim message. */
  message: string;
}
```

`AgentResult`'s failure arm (`src/core/agent/types.ts:76`) gains an optional
field:

```ts
| (AgentResultBase & { success: false; error: string; unavailability?: EngineUnavailability })
```

`error` is simultaneously rewritten to a human-readable line, e.g.
`Codex is out of usage quota until Tue Aug 19 23:34 (account-level: affects
every box and task on this account). Provider message: <verbatim>` — so every
consumer that only carries the string (chat stream, procedure run cards, JSONL
logs) improves without knowing about the new field.

Recognition is **narrow**: a per-provider list of regexes that must match the
engine-level error message (never task output). Codex:
`/You've hit your usage limit/`. Claude (provisional, unverified live):
`/Claude AI usage limit reached\|(\d+)/` and `/usage limit reached/i` scoped to
the SDK result-error path only. Anything unmatched keeps today's behavior
exactly.

### The store (crossing the process boundary)

`cb tick` runs scheduled scripts as subprocesses
(`tick-helpers.ts:250`: `execWithTimeout(parsed.runs, ...)`), so the typed
field cannot reach `recordOutcome` in-process. And quota is account-scoped:
one box's failure should inform every box on the machine.

Both problems have the same answer: a machine-level advisory store,
`~/.local/share/cb/engine-availability.json` (env override
`CB_ENGINE_AVAILABILITY_FILE` for tests), written via `writeFileAtomic`, keyed
by provider:

```ts
{ codex?: EngineUnavailability & { episodeStartedAt: string; notifiedAt: string | null; notifiedRetryAt: string | null }, claude?: ... }
```

- **Written** at the moment of classification (inside the engine layer, so
  every caller — chat, reactor, procedures, structured invokes — populates it).
- **Read** by the tick skip gate, the tick failure handler, and health.
- **Advisory and fail-open**: a corrupt or unreadable store logs a warning and
  is treated as "no record" — an availability *hint* must never block agent
  work (contrast `transient-state.ts`, which fails closed because its data is
  authoritative; this data is re-derivable from the next failure). The
  degraded mode is itself observable: with no record, runs fail noisily
  exactly as they do today, so a broken store cannot hide anything.
- **Self-expiring**: a record whose `retryAt` is in the past is dead; readers
  ignore it and the next writer replaces it. No sweeper needed.

### Consumers

**Scheduler — skip instead of burn, defer instead of fail.**

1. `evaluateSkip` (`tick-helpers.ts:112`) gains a gate after `enabled`: load
   the box's engine (`loadAgentEngine`), map to provider, and if the store
   holds a live record (`now < retryAt`), skip with the visible reason
   `waiting on codex quota until <t>`. `lastRun` is untouched, so the script
   stays due and runs on the first tick after reset.
2. `executeScript`'s catch (`tick-helpers.ts:263`) consults the store: if a
   live record exists for the box's provider **and its `detectedAt` falls
   within this run's span** (snapshot the start time before
   `execWithTimeout`), record the outcome as `"deferred"`. The freshness
   requirement is what stops the store from laundering unrelated failures: a
   script that dies of its own bug during someone else's quota episode fails
   normally, because no record was written during *its* run. (A stale-but-live
   record doesn't need the deferred outcome anyway — the skip gate stops the
   *next* run before it starts.) `recordOutcome` gains the result value; it
   sets
   `lastResult: "deferred"`, sets `lastError` to the informative message, and
   **neither increments nor resets** `consecutiveFailures` (a genuinely broken
   task must not have its counter laundered by a quota episode).
   `ScriptState`/`ScriptStatePartialSchema` (`schedule/state.ts:35-71`) extend
   accordingly.

**Health — waiting is not failing.** The `waiting` state joins the core
`TaskHealth` status union in `src/core/schedule/health.ts` (computed where
`failing`/`overdue` are computed today, `health.ts:111`, consulting the
store), NOT bolted onto the CLI renderer — both consumers of task health
derive from that one computation: the `cb health` renderer
(`health.ts:44-58`, new glyph in `STATUS_GLYPHS` at `:31-38`, excluded from
the exit-code-1 path at `:148-151`) and the proactive alert selection
(`health-alert.ts:64-65` via `loadScheduleHealth`), which therefore suppresses
`overdue`/`failing` alerts during an episode with no separate logic. `cb
health` additionally adds a box-level check row: `engine: waiting on codex
quota until <t>` (via the existing `printBoxChecks` surface,
`health.ts:112-126`).

**Procedures — abort cleanly, never retry into a dead engine.** The right
choke point is `runRunAgents`, not the retry loop: today a failed run agent is
only *logged* (`engine-run-phase.ts:104-106` and `:143-145` — `Agent failed:
...` then execution continues), so a step whose agent died still runs its
shells, and with no validate block reports **completed**
(`engine-step.ts:215` fails only on `runFailure`/`validationGated`/
`reviewExhausted`). Under quota exhaustion that is a silently-successful
no-op step. Change: `runRunAgents` returns the failed `AgentResult`'s
`unavailability` when present, and `runAndValidate` then fails the step
immediately with the informative message — no run shells, no validation, no
`severity: review` retry (`engine-run-phase.ts:274-289` never entered). The
broader question — whether a *generic* agent failure should ever leave a step
"completed" — is adjacent pre-existing behavior, noted but out of scope.

**Chat — say what happened.** No frontend change needed: the session-wrapper
fix means `completed.error` (`codex-chat.ts:140`) now carries the real
message, and the classification rewrite makes it human-readable, so
`chat-actors.ts:191-195` renders `Chat turn failed — Codex is out of usage
quota until ...` as-is.

**Reactor — stop the batch.** When a reactor-cycle agent run returns
`unavailability`, stop processing further jobs in that cycle (every one would
fail identically and burn log noise); leave jobs pending for the next cycle.
Chat-jobs' existing `resetSession()` on failure
(`reactor/chat-jobs.ts:88-89`) stays.

**Notification — once per episode, with the reset time.** When a written
record starts a new episode (continuity rule below), send one
`notifyBoxholder` (`deliver: true`)
from the box whose run triggered classification: `Codex is out of usage quota
until <t>. Scheduled work is deferred until then; chat on Codex-engine boxes
will fail. No action needed unless this recurs.` Then stamp `notifiedAt`.
This is `google-auth-alert.ts`'s latch shape with the latch in the machine
store instead of per-box transient state. Episode identity needs a
**continuity rule**, not raw `retryAt` equality — the 1-hour parse-failure
holds would otherwise mint a "new episode" (and a notification) every hour of
one real outage. Rule: the store record carries `episodeStartedAt` and
`notifiedRetryAt`; a new classification written while the previous record is
still live, or within a 30-minute grace after its `retryAt`, **extends** the
episode (carries both fields forward, no notification). A notification fires
only when (a) no episode is being extended — a genuinely new exhaustion,
including one recurring after the promised reset, which is the escalation
case — or (b) a *parsed* `retryAt` moves later than `notifiedRetryAt` by more
than an hour (the provider moved the goalposts; the operator's expectation is
stale). Fallback-hold records can extend an episode but never trigger (b).
Deferral itself is always time-bounded by `retryAt`.

### Reset-time parsing

The Codex message embeds `try again at Aug 19th, 2026 11:34 PM` — month name,
ordinal day, year, 12-hour time, no timezone. A small dedicated parser
(doctested) handles exactly this shape, interpreting it in box-local time
(`getBoxTime` discipline for "now"; the wall-clock fields as local). Guards:

- Parse failure → `retryAt = detectedAt + 1h` (bounded hold; the next failure
  re-detects and re-holds, so drift in the provider's format degrades to
  hourly retries, never to an unbounded park or a hard error).
- Clamp: a parsed `retryAt` in the past or more than 7 days out falls back to
  the 1-hour hold (defends against a misparsed year/AM-PM inverting the
  meaning).

## Could this be simpler?

**Simplest plausible version:** string-match `usage limit` in `executeScript`'s
catch and skip the `consecutiveFailures` increment; nothing else. It fails
concretely:

- The string never reaches tick today — the subprocess prints the *stderr*
  chatter, not the event message; the session-wrapper fix is irreducible
  (principle #4: the current silence about the real cause is the bug).
- Chat, procedures, and the reactor still burn attempts and mislead
  (principle #5: these callers branch on the cause, so the cause must be in
  the signature, not re-derived by each from strings).
- Every box and task re-detects independently: N notifications, N wasted
  attempts per cadence (the condition is account-scoped; modeling it
  task-scoped misstates reality — principle #1).

**What the fuller shape buys, piece by piece:** the typed field is the
contract (#5); the machine store is the only way the classification crosses
tick's process boundary at all, and it collapses N re-detections into one
(#8 — one place knows availability). **What was cut as over-build:** a
generic three-kind `failureKind` field on every result (only `deferred` has
consumers today; the union stays extensible without pre-building arms —
`stop-over-engineering`); proactive quota querying before every run (see NOT
in scope); any UI beyond existing text surfaces.

## Failure modes

> **No unresolved critical gaps.** Every silent-failure row below has explicit
> handling in the design.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Provider changes the quota message wording — recognizer misses | Doctest pins current wording | Yes: unmatched → today's behavior (generic failure, counted) | Clear (noisy failure, as now) |
| Provider changes the *date* format only — recognizer hits, parse fails | Doctest for parse-failure branch | Yes: 1-hour bounded hold | Clear (message still verbatim in `lastError`) |
| Date parsed wrong (AM/PM, year) → absurd `retryAt` | Doctest for clamp | Yes: past/-7d clamp to 1-hour hold | Clear |
| Store corrupt/unreadable | Doctest | Yes: fail-open (treated as absent), `console.warn` | Clear |
| Two boxes classify concurrently — store write race | No (accepted) | `writeFileAtomic`, last-write-wins; both records describe the same episode | Silent, harmless |
| Genuinely broken task fails *during* a quota episode — misattributed as deferred | Doctest for counter behavior + freshness rule | Two guards: the deferred outcome requires a record written during *this run's* span (an unrelated failure defers nothing), and `consecutiveFailures` is frozen, not reset. Residual: a task whose own run both hits quota AND has a real bug is masked until the episode ends | Clear once episode ends |
| Parse-failure 1-hour holds re-notify hourly through one outage | Doctest for episode continuity | Episode continuity rule: a record extending a live-or-just-expired episode carries the latch forward; fallback holds never re-trigger notification | Clear |
| Quota returns early (credits purchased) while records says unavailable | No | Skip gate holds until `retryAt`; worst case = the wasted window the operator already knew about. `--force` bypasses the gate like other schedule gates | Clear (`cb health` shows why) |
| Claude recognizer wrong (unverified live) | Doctest against known strings only | Scoped to SDK result-error text; unmatched → status quo | Clear |
| Chat during episode — user sends messages that all fail | Covered by wrapper fix doctest | Message now names cause + reset time; no auto-block (human is present and informed) | Clear |
| A non-quota `turn.failed` event (any other semantic Codex error) now surfaces instead of stderr chatter | Doctest | Yes — strict improvement; classification untouched | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — no agent-authored vocabulary here; N/A.
- **Stale ref** — no refs; the store self-expires via `retryAt`. ADDRESSED
  (Design → store).
- **Two agents touching the same card** — the store is not a card;
  atomic-write last-write-wins is stated. ADDRESSED (failure modes).
- **Hand-edit drift** — boxholder hand-editing the store file: Zod-parsed,
  fail-open on invalid. ADDRESSED.
- **Fabricated free-form value** — classification is regex-on-provider-output;
  no agent authors it. N/A.
- **Validation error UX** — the rewritten error line is the UX; it names
  cause, scope, and reset time in one sentence. ADDRESSED (Design → type).
- **Partial migration / transition state** — `"deferred"` only appears in new
  writes; the partial schema tolerates missing *fields*, but its `lastResult`
  enum (`state.ts:61`) is strict, so a **rolled-back** binary reading
  `lastResult: "deferred"` Zod-rejects the file and the catch in
  `loadScriptState` (`state.ts:131-136`) resets to empty state with a
  warning. Concretely that resets cadence and budget gates: the task is
  immediately due, runs once, and fails the way it does today (pre-plan
  behavior). Accepted: machine-local, self-healing on the next write, and the
  degraded mode is the status quo. ADDRESSED.

## NOT in scope

- **Transient-failure handling** (index-lock queueing/locking): owned by
  [its own issue](../../../issues/bugs/2026-08-18-scheduled-task-dies-on-git-index-lock.md);
  this plan only reserves the vocabulary so the kinds stay distinct.
- **Proactive quota checking before unattended work** (the
  `bin/agent-quotas.ts` lever): the passive store already reduces the cost of
  an episode to one burned attempt machine-wide; a pre-flight adds a network
  call and a staleness window to every run to save that one attempt. Revisit
  if one burned attempt per episode proves costly.
- **Auto-switching engines during an episode** (run the box on Claude while
  Codex is out): a behavior change to the box the boxholder didn't choose;
  needs its own decision.
- **Frontend/UI surfaces beyond existing text** (a banner, a chat-composer
  block during episodes): human-present surfaces already communicate via the
  rewritten message.
- **Claude-path live verification**: Claude quota is not exhausted; its
  recognizer ships provisional (see Rollout).
- **Prod multi-owner notification routing**: the notifying box's owner gets
  the episode notification; on a multi-owner server that is the box that hit
  it first. Acceptable for the current single-operator deployment.

## Open design questions

- Should the deferred outcome also appear in the scheduler's JSONL log as its
  own event type (today: `event: "tick", error: ...`,
  `scheduler.ts:244-250`)? Lean: yes, trivially, as `result: "deferred"` on
  the existing entry — but it is cosmetic and can land with the scheduler
  chunk without further discussion.
- `reason` union growth: `auth-expired` (Codex login lapse) has the same
  deferred *shape* but no known reset time and arguably *is* permanent (human
  must re-login). Lean: keep it out; quota-exhausted stays the only member
  until a second evidence-based case appears.

## Knowledge audits

None. This is infrastructure invisible to box agents — no new tag, card
shape, or convention a box agent must recall. The operator-facing vocabulary
("waiting on quota") appears only in system-rendered surfaces, never in
agent-authored content. Skip-with-rationale per the skill.

## Implementation order

1. **Classification core** — `engine-unavailability.ts`: type, recognizers,
   date parser with clamps, store IO (fail-open), `describe()` rewrite
   helper. Doctests for every branch (recognizer hit/miss, parse fail, clamp,
   corrupt store). No consumers yet; pure leaf.
2. **Codex path** — fix `codex-sdk-session.ts` catch to prefer the captured
   event error over the process throw (return `status: "failed"` with it);
   classify in `codex-run.ts`'s failure paths; populate
   `AgentResult.unavailability` + rewritten `error`; write the store.
   Doctests via a fake session factory replaying the probe's event sequence.
3. **Claude path** — recognize in `buildAgentResult` (`run.ts:111-151`), same
   field, same store write. Doctests against the known strings.
4. **Scheduler** — `recordOutcome` `"deferred"`, `ScriptState` schema,
   `evaluateSkip` gate, `executeScript` store consultation. Doctests at the
   tick-helpers tier.
5. **Health** — waiting state, box-level check row, alert suppression.
   Doctest.
6. **Procedures + reactor** — gate the `severity: review` retry; stop the
   reactor batch. Doctests.
7. **Notification** — episode latch + `notifyBoxholder`. Doctest with fake
   channels.
8. **Docs + issue reconciliation** — `docs/scheduler.md`, `docs/health-checks.md`
   notes; close the quota issue; cross-link from the index-lock issue's
   "distinguish lost-a-lock-race from failed" section.

Chunks 2-3 depend on 1; 4-7 depend on 1 and are mutually independent; 8 last.

## Rollout shape

- **Tests first, as design**: the fake Codex session replaying the verified
  event sequence is the anchor doctest — it encodes the probe as a regression
  test. Done-when: that doctest asserts the informative message and the typed
  field; the tick doctest asserts `consecutiveFailures` stays 0 across a
  deferred outcome and that the skip gate holds until `retryAt`.
- **Live verification**: the *exhausted* path is verifiable against the real
  CLI right now (quota resets ~2026-08-19 23:34); the *recovery* path (first
  tick after reset runs normally) can only be watched after reset. The Claude
  recognizer ships provisional — flag it in the closing issue note as
  unverified-live.
- **No data migration**: the store is new; `ScriptState` changes are additive
  and machine-local with a safe fallback (see edge cases).
- Ships as one unit when all chunks land; merge to main only on the
  boxholder's signal.
