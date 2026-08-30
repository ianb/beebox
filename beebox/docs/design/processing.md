# Processing — wakeup, the reactor, and the question loop

## What `bbx wakeup` actually does

Verified against `src/cli/commands/wakeup.ts` (2026-07-04). One full
sync-and-process pass:

1. **Preprocess** inbox items (transcription, etc.).
2. **Housekeeping** (sweep stale tmp uploads, refill the root landmark).
3. Run **on-wakeup scheduled scripts**.
4. Run **connectors** — pull external data, create job cards in `box/jobs/`;
   then clean up stale jobs, create intake jobs for unjobbed inbox items
   (UI memos, etc.), and occasionally queue a low-priority backfill job.
5. **Process pending jobs** — one reactor cycle (skipping low-priority jobs).
6. **Push** committed changes to the box's git remote (non-fatal).

`bbx wakeup --connector X` scopes the whole pass to one connector's jobs.
Wakeup does **not** "execute commands" (command cards are gone; outbound cards
are flushed by `bbx finalize` inside the reactor), and it does **not** schedule
the next wakeup — recurring runs come from the `bbx tick` daemon
([`../scheduler.md`](../scheduler.md)) and agent-set timers
([`../chat-schedules.md`](../chat-schedules.md)).

## The reactor is the main loop

`runReactor` (`src/core/reactor/DESIGN.md`): sync (`bbx wakeup` as its step
when invoked with `--sync`) → refresh generated agent docs → find job cards →
agent processing → `bbx finalize`. Two processing paths: **batch** (all pending
non-chat jobs described in one agent session, `bbx finish` per job) and
**chat** (per-thread sessions resumed across cycles). "Wakeup cycle" remains a
fair umbrella name for one full pass; the reactor is its engine.

## What "processing" an item means

The intake → triage → handle pipeline is the reference:
[`../triage.md`](../triage.md). Possible outcomes for an item: archive it
(`store/archive/`), trash it (`bbx trash` → `store/trash/`), create an outbound
card (sent at finalize), ask a question, update or link a resource, spawn a
secondary artifact, or leave it batched for later. The decisions come from
schema `instructions`, rules files, category rules on landmark cards, and
personality/guide cards (see `teaching.md`) — not from a hardcoded pipeline.

## The question loop

When an agent can't proceed, it creates a question card in `box/questions/`:
`prompt`, `input` (select/text/confirm), `memo` for why it's asking, `context`
refs to the cards being discussed, and a `directive` — instructions for what
to do with the answer. When the user answers (web, CLI, or API), the system
creates a **follow-up job** from the directive (`src/schemas/question-followup-job.ts`);
it does not resume the paused session — session-resume is chat's mechanism.

Unresolved design (ruling 12): whether long-running interrupted work should
instead resume its original session, and how context-ref *roles*
(subject / related / proposed-action, from the original design) fit — the
current schema has flat `{ref, text}` context entries. Not filled out enough
to have a clear answer; evolve it when a use case pushes (triage's
low-confidence flow is the named forcing case).

## Sessions

Resolved by practice: chat threads get persistent resumable sessions
(rotated by age/message count); batch jobs get a fresh session per reactor
invocation; the retro procedure (`bbx retro`) is the meta-review channel where
the system's own behavior gets examined (see `teaching.md`).
