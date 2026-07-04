# Scheduling & Proactivity: CBX vs. OpenClaw vs. Hermes Agent

Comparison of how the three systems decide *when* an agent runs unprompted, how that
state survives crashes, how an in-conversation agent arms its own future wakeups, and
how results get back to a human. Sources: `cbx-proactivity-context.md`,
`openclaw-scheduling.md`, `hermes-scheduling.md` in this directory.

## 1. Side-by-side

| Axis | Callback Box | OpenClaw | Hermes Agent |
|---|---|---|---|
| **Schedule primitives** | Schedule cards (`config/schedules/*.scheduled-script.card`) checked every minute by `cb tick` against cron/at/rrule; chat-armed `<schedule delay="5m">` tags for in-conversation reminders | Discriminated union: `at` (one-shot), `every` (phase-anchored interval), `cron` (croner expr w/ tz + stagger), `on-exit` (gateway-supervisor-owned process watcher, event-driven not time-due) | One grammar parsed from a single string: `every Nm/h` → interval, 5-field cron expr (`croniter`), ISO timestamp or bare duration → `once`. No separate on-exit/event primitive found |
| **Storage & crash-safety** | Schedule cards are files in git; scheduler config list in `~/.config/cb/scheduler.json`, reloaded every tick; per-box JSONL log. No documented claim-before-fire/stuck-job reaping mechanism in the read materials — durability rides on filesystem+git, and a missed window "fires on the next tick after wake" | `cron_jobs` table in a shared SQLite DB (Kysely), config columns vs. runtime columns split so hot-path ticks (`runningAtMs` stamping) don't churn config JSON. Reservation (`runningAtMs` persisted) happens **before** execution. Crash recovery = three independent mechanisms: stuck-marker reaping by age (2h `STUCK_RUN_MS`), manual-run bypass that force-recomputes before checking "already running," and startup catch-up that reruns missed jobs (capped/staggered, command jobs immediate, agent-turn jobs deferred by default) | JSON file (`~/.hermes/cron/jobs.json`), atomic tempfile-replace, `0600` perms, advisory `flock` + in-process `RLock`. `advance_next_run()` bumps `next_run_at` **before** execution (crash loses at most one fire); `claim_dispatch()` pre-claims a one-shot's `repeat.completed` before the side effect (at-least-once → at-most-*times*); `claim_job_for_fire()` is a CAS+TTL for multi-replica/webhook exactly-once. Grace windows (120s one-shot; half-period clamped 120s-2h recurring) decide catch-up-once vs. fast-forward-silently on a late discovery |
| **Agent self-scheduling in-conversation** | `<schedule label delay alarm announce>` tag in a chat response, persisted per-session/per-thread (`chat-schedules.json` / `thread-schedules/<threadRef>.json`), armed via `setTimeout`, delivered as `<schedule-fired>` back into the *same resumed session* (SSE + polling fallback). Telegram gets the same minus alarm/TTS; agent told to make a job card instead for longer-term reminders | A model-callable `wake()` path plus cron's `sessionTarget: "main"` (system-event enqueue, drained by heartbeat) or `"isolated"`/`"current"`/`session:<id>` (full agent-turn job). No single "arm a chat tag" primitive — self-scheduling goes through the same cron job API the CLI uses | `cronjob(...)` tool, directly callable by the model mid-conversation ("Self-schedule reminders and follow-up tasks"); a one-shot reminder is *just* a cron job with `kind: once` — no separate reminder subsystem |
| **Heartbeat / idle polling** | No dedicated "nothing to do" heartbeat loop found; `cb tick` (once/min) is the polling substrate, and it drives real work (wakeup cycles) rather than a cheap ambient check. Proactivity is schedule-driven, not ambient-poll-driven | Dedicated, phase-staggered per-agent heartbeat (`heartbeat-runner.ts`), three-layer cheapest-first "nothing to do" decision: (1) cooldown/dedup/flood-guard gate, (2) preflight reads `HEARTBEAT.md`, skips **before any LLM call** if empty and no due commitments, (3) model call with a `HEARTBEAT_OK` token or a structured `heartbeat_respond` tool forcing an explicit notify/no-notify decision | Housekeeping loop exists (`_start_gateway_housekeeping`: channel-directory refresh, cache GC, curator poll) but is infra self-maintenance, not user-facing proactivity/idle-check-in. No heartbeat-equivalent ambient loop found |
| **Inferred follow-ups** | None as a distinct mechanism; closest analogue is retrospective mining (`cb retro`) — but that mines *past chat sessions* for personality/guide corrections, not "I said I'd get back to you" open loops, and runs on a weekly cron (disabled by default), not per-turn | **Commitments** (`src/commitments/`) — a hidden, tools-off, fast-model extraction pass after every ordinary turn, tagged `event_check_in/deadline_check/care_check_in/open_loop`, confidence-thresholded (0.72/0.86), delivered through the heartbeat's own notify decision (never creates its own cron job), auto-expiring 72h after window close if never delivered | Not found as a distinct mechanism in the reviewed files |
| **Delivery to user** | Chat schedules: `<schedule-fired>` re-enters the *same resumed session* (continuable by construction); reactor/job output lands as committed cards, surfaced via `cb finalize`/git, not pushed proactively unless a connector round-trips it. `healthAlerts` push (Telegram) only for scheduler *failures* | Delivery plan resolved per-job: default `announce` for isolated/current jobs unless opted to `none`; main-session jobs can only use webhook/none (their real output *is* the later heartbeat turn). Idempotent send keys (`cron-direct-delivery:v1:<executionId>:...`); a same-target guard avoids double-sending failure alerts and primary delivery; interim-ack detection substitutes real subagent output before delivering | `deliver` field resolves `local` (silent, saved to disk only) / `origin` (chat it was created from, falling back to a configured home channel) / explicit platform / `all`; `[SILENT]` contract lets the agent suppress a no-news run; output optionally wrapped with manage/stop hints |
| **Attach-to-session / continuable threads** | Chat-armed schedules always attach to the originating session by design (session resume) | Not centrally documented as a delivery feature in the read material — cron delivery goes through the normal channel-send path (`sendDurableMessageBatch`), same as ordinary replies, not a session-mirror mechanism | Explicit opt-in features: `attach_to_session` (mirrors clean delivery text into the origin session as a **user-role** turn, avoiding role-alternation breakage) and continuable threads (`_open_continuable_cron_thread`, seeds a new thread/DM with the brief so a reply lands with context already loaded) — both off by default |
| **Collision with interactive sessions** | Reactor takes a PID lock (`.cb-lock`); chat/job sessions are distinct registries so a reactor cycle and a live chat don't share a Claude Code session id. `cb wakeup --connector X` job-filtering avoids draining unrelated in-flight work | `locked()` is a process-local promise-chain mutex per store path serializing all cron ops incl. timer ticks; isolated runs get a run-scoped session-key suffix so repeat/concurrent runs of the same job never collide; heartbeat has its own busy/coalesce/flood machinery independent of cron's lock | `HERMES_CRON_SESSION=1` env var + explicit `set_session_vars` clearing (not seeding) sender identity from origin, so cron runs can't be mistaken for a live user turn by tools that check session context; `cronjob`/`messaging`/`clarify` toolsets are unconditionally denied to cron-spawned agents (can't self-schedule further or block on input) |
| **Scheduled-run context assembly** | Reactor builds two prompts per cycle: system prompt (what's already loaded — job frontmatter, referenced files, schema instructions, rules) + user prompt (jobs + inlined referenced files + schema processing instructions). No job-chaining/`context_from`-equivalent found | Isolated runs sanitize carried-over session state to an explicit allow-list (deliberately not leaking main-chat context); model selection layers global→agent→hook→per-job override→session-stored fallback with a preflight reachability check | `_build_job_prompt()` layers: optional pre-run script output (`## Script Output`), optional `context_from` chaining (most recent `.md` output of another job, truncated 8K chars, `## Output from job '<id>'`), a fixed cron-execution hint (final response auto-delivered; reply `[SILENT]` if nothing to report), optional skills. Assembled prompt is prompt-injection-scanned before running |

## 2. Confirmations — where CBX matches the field

- **Schedules as durable, inspectable records, not just in-memory timers.** All three
  persist schedule state outside the process (CBX: git-tracked cards; OpenClaw: SQLite
  table; Hermes: locked JSON file) so a restart doesn't lose the schedule list. CBX's
  choice to make schedules literal cards fits its broader "everything is a file, git is
  history" architecture and gives the same benefit (inspectable, diffable, git-blamable)
  that OpenClaw gets from its `job_json`/`state_json` escape-hatch columns and Hermes
  gets from its atomic JSON store.
- **Wakeup → reactor as the "drain what's due" loop** is structurally the same shape as
  OpenClaw's heartbeat draining a system-event queue and Hermes' ticker calling
  `get_due_jobs()`: a periodic tick collects due work and hands it to an agent-processing
  step, decoupled from the scheduling primitive itself.
- **Agent-armed schedules from inside a live conversation** — CBX's `<schedule>` tag,
  OpenClaw's `wake()`/cron self-service, and Hermes' `cronjob()` tool are three
  independent arrivals at the same idea: the model itself, mid-turn, can create future
  work rather than requiring an out-of-band API call. CBX and Hermes both explicitly gate
  this to short-term use (CBX tells the agent to make a job card instead for anything
  longer-term; Hermes' one-shot reminder literally *is* a cron job under the same API).
- **Per-box/per-profile isolation of schedule state** — CBX's scheduler config keys by
  box and Hermes' job store is anchored on the active profile's home directory
  (explicitly to prevent cross-profile leakage, issue #4707 cited) are the same design
  instinct: schedule state must not become a shared/global resource across independently
  operated agent instances.

## 3. Divergences

- **Ambient "nothing to do" polling vs. schedule-only proactivity.** OpenClaw's heartbeat
  is a genuinely separate proactivity axis from cron — an always-on ambient loop whose
  entire job is deciding, as cheaply as possible, whether *anything* needs surfacing right
  now, independent of any specific due job. CBX has no equivalent: `cb tick` exists but
  it drives real work (wakeup cycles), not a cheap "check if HEARTBEAT.md has content"
  pass, so CBX proactivity is entirely schedule-driven — nothing happens between
  scheduled events even if circumstances change. Hermes is architecturally closer to CBX
  here (no ambient heartbeat found; housekeeping is infra-only).
- **Inferred follow-ups (commitments) vs. none.** OpenClaw's commitments pipeline is a
  distinct, per-turn, cheap-model extraction pass purpose-built for "I'll get back to you
  about X" — a mechanism CBX doesn't have at all in this shape. CBX's nearest relative,
  retrospective mining, runs on a much slower cadence (weekly, disabled by default),
  mines *past* sessions rather than the just-completed turn, and targets personality/guide
  drift rather than open conversational loops.
- **Storage engine choice.** OpenClaw moved cron off flat JSON into a shared SQLite table
  specifically to split hot runtime columns (avoid full-config-rewrite churn on every
  tick) from cold config columns — a scaling/write-amplification concern neither CBX
  (git-committed cards, inherently infrequent-write) nor Hermes (single JSON file with
  advisory locking) optimizes for, because neither expects tick-frequency writes to
  the schedule's own storage. CBX schedule cards don't get rewritten every tick at all
  (the daemon reads and evaluates, without necessarily persisting run-state back into
  the card) — closer to Hermes' `next_run_at`/`last_run_at` mutation-in-place model than
  OpenClaw's column-split optimization, but less protected against races since Hermes adds
  file locking that CBX's docs don't describe an equivalent of.
- **Crash-safety maturity.** Both OpenClaw and Hermes have explicit, tested claim-before-fire
  semantics (`runningAtMs`/`advance_next_run` stamped *before* execution) plus layered
  stuck-job reaping and catch-up staggering with documented issue numbers behind each
  fix. CBX's documented crash story is coarser: "sleep is tolerated (a missed window
  fires on the next tick after wake)" — true resilience to macOS sleep, but no described
  mechanism for reserve-before-execute, stuck-marker aging, or catch-up storm throttling.
  This may be adequate at CBX's current single-box/single-daemon scale but is the least
  battle-tested of the three on this specific axis.
- **Delivery/session-attachment model.** Hermes and CBX both treat "does this land back
  in a session the user can naturally reply to" as a first-class, opt-in-controlled
  concern (Hermes: `attach_to_session` + continuable threads; CBX: chat-armed schedules
  attach by construction since they resume the same session). OpenClaw's cron delivery
  is comparatively flatter — it reuses the ordinary channel-send path and doesn't mirror
  into a session transcript; its "continuity" story is really the heartbeat's own live
  main-session loop, not a per-job attach mechanism.
- **Job chaining / pre-run scripts.** Hermes' `context_from` (chain job A's output into
  job B) and pre-run script injection are dedicated composition primitives with no CBX or
  OpenClaw equivalent described in the source docs — CBX's nearest analogue is
  procedures (multi-step cards with precheck/run/validate phases) which are a different,
  heavier mechanism (explicit workflow authoring, not schedule-to-schedule output
  piping), and OpenClaw's isolated jobs don't chain to each other's *output* at all.
- **Toolset/identity fencing of scheduled runs.** Both OpenClaw (session-state
  allow-list sanitization on isolation) and Hermes (`HERMES_CRON_SESSION` env var,
  identity-clearing `ContextVars`, hard-denied `cronjob`/`messaging`/`clarify` toolsets)
  go out of their way to make a scheduled run *provably* distinguishable from a live
  user turn to every tool that checks session context. CBX's job/chat session separation
  achieves a similar practical effect (distinct registries) but isn't described as having
  an equivalent explicit "this is a non-interactive run" identity signal threaded through
  tool-level context.

## 4. Steal-this — prioritized ideas for CBX

1. **Cheap heartbeat-style preflight before any scheduled agent invocation.** *(High
   value, medium effort.)* Right now every `cb tick` firing that reaches a wakeup does
   real work; there's no "is there actually anything worth an LLM call" gate analogous to
   OpenClaw's `HEARTBEAT.md`-empty-and-no-commitments check. A cheap, no-model
   pre-check — e.g., skip invoking the agent if the job queue is empty and no connector
   reported new items — could cut the ambient minute-by-minute tick cost for
   quiet boxes. (CBX likely already partially gets this for free since `findJobCards`
   naturally returns nothing to process, but the explicit "decide before any model call"
   framing plus a documented skip-reason log would make the economics visible/tunable
   the way OpenClaw's does.)

2. **Commitments-style inferred follow-ups as a *distinct*, fast mechanism, separate from
   retrospective mining.** *(High value, higher effort.)* CBX's retro system deliberately
   runs slow and coarse (weekly, quiescent-session-only, feeds personality/guide belief
   ladders). A commitments-shaped addition — per-turn, cheap-model, tools-off extraction
   of "I'll check back about X," with its own due-window/confidence/dedup model and
   delivery through the *next* wakeup/chat-schedule rather than a new card type — would
   fill a real gap: today, an agent that says "I'll look into that and let you know"
   mid-chat has no structural mechanism to actually follow up unless it explicitly arms a
   `<schedule>` tag in the same turn (easy to forget, and not retroactively fixable once
   the turn ends). Worth prototyping as a lightweight job card type (`commitment.job.card`)
   created by a small post-turn extraction pass, drained by the normal wakeup cycle,
   rather than a whole new subsystem.

3. **Explicit crash-safety semantics for `cb tick`/schedule cards: claim-before-fire +
   stuck-job reaping.** *(Medium value, low-medium effort.)* Adopt the same
   reserve-then-execute pattern OpenClaw/Hermes both converged on independently: write a
   "claimed at T" marker into the schedule card (or a sidecar state file) *before*
   invoking the agent, and age out stale claims (analogous to OpenClaw's 2h
   `STUCK_RUN_MS`) so a daemon crash mid-run can't wedge a schedule indefinitely or
   double-fire it on the next tick. This is cheap relative to OpenClaw's SQLite migration
   and directly closes CBX's least-mature area per the research (§3, "crash-safety
   maturity").

4. **Attach-to-session delivery for chat-originated job-card reminders.** *(Medium value,
   low effort.)* CBX already has attach-by-construction for chat-armed `<schedule>` tags,
   but explicitly tells the agent to fall back to a plain job card for longer-term
   reminders — which then delivers as an ordinary archived-job output, not back into the
   originating chat thread. Hermes' `attach_to_session` (mirror as a user-role turn) is a
   small, well-scoped addition: when a job card's originating context was a chat thread,
   mirror its completion back into that thread's session (with the same
   role-alternation care Hermes took, given #2221/#2313) rather than only landing in
   `box/output/`. Directly closes the "agent forgot the reminder because the schedule
   only fires for a fixed short window" gap noted in item 2.

5. **Job/pre-run-script and job-chaining (`context_from`) as a lightweight scheduling
   primitive.** *(Lower priority, medium effort.)* Useful mainly if CBX schedule cards
   grow beyond "run wakeup" into more varied recurring scripts; procedures already cover
   the heavier multi-step-workflow case, so this is worth deferring unless a concrete use
   case (e.g., "job A refreshes a data card, job B summarizes it") shows up in practice.

## Key source index

| Topic | Doc |
|---|---|
| CBX scheduling/reactor/chat-schedules | `cbx-proactivity-context.md` §1, §7.2 |
| OpenClaw cron/heartbeat/commitments | `openclaw-scheduling.md` |
| Hermes cron/delivery/context assembly | `hermes-scheduling.md` |
