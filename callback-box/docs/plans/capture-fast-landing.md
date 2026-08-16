---
title: "Capture fast landing — deliver first, process behind the message"
status: active
workstream: unknown
issues: []
---
# Capture fast landing — deliver first, process behind the message

Status: PROPOSAL (measurement done; Codex-reviewed 2026-08-04 — this revision
incorporates its findings; design awaiting boxholder review)

The capture → chat flow feels very slow: from pressing Done to the capture
becoming a real message the chat agent acts on. This plan is built on real
measurements (below), and its direction is the one the boxholder chose: land
the capture in chat fast, in an explicitly unfinished state, and let the
processing complete behind it — with the chat agent given the means to wait
on, or itself drive, that processing.

## What measurement actually found

Per-step wall-clock instrumentation in the preparation worker
(`.callback-box/capture-timing.log`, one line per capture), replaying a real
prod capture (3 phone photos ~3.2MB each + one 33s voice clip) against a local
worktree box:

| step | local (Mac) | notes |
|---|---|---|
| write cards + copy media | 15–71ms | even at 10 photos / 32MB — **not** a cost |
| transcribe (1 clip) | 2.7–3.0s voxtral / **0.96s deepgram** | serial per clip; 3 clips ≈ 7.9s voxtral |
| timeline + validate | ~10–25ms | not a cost |
| commit #1 (doc) | 1.6–2.0s | `stageAndCommitPaths` = 5 git subprocesses |
| deliver (agent send) | ~3ms warm/enqueue; 0.6–1.1s cold | cold = compose snapshot ~320ms + auth preflight ~270ms; generateDocs cache-hit + SDK spawn ≈ 13ms |
| commit #2 (delivered flip) | 1.1–1.3s | second `stageAndCommitPaths` |
| **total** | **3.8s (deepgram) – 7.4s (voxtral, cold)** | |

Refuted: image processing (there is none on this path) and byte-copying are
irrelevant. Confirmed: the costs are transcription, **two git commits**, and
the cold agent start.

Prod is much worse, for two reasons:

1. **Prod git is ~10× slower.** `git status` on box-family takes 4.0s (3
   vCPUs, disk pressure, cold page cache). Two commits × 5 git subprocesses
   each puts plausibly 10s+ of git on the critical path.
2. **Until 2026-08-04 ~18:48 UTC, every box-family capture was wedging, not
   just slow.** The post-annex ignore rule `**/tmp-capture/**/*.attach/**`
   made `git add` stage nothing from the attach scope, the commit pathspec
   failed ("did not match any file(s) known to git"), and the capture looped
   `failed:prepare` → retry. Real history: the pottery capture (2026-08-03)
   failed 3× and took **34 minutes** to deliver; the 2026-08-04T17:14 capture
   took 5m24s including a mid-delivery server restart. The boxholder's "very
   very slow" was mostly this bug. `6e9860f3` (commit only what actually
   staged) fixed the wedge and is now deployed — but the steady-state cost
   above remains, and the glob still leaves child cards + manifests
   uncommitted (see "gitignore glob" below).

## Design

### Reorder: deliver before transcription

Current: write → transcribe → timeline → validate → commit → deliver → flip+commit → cleanup.

New:

```
write cards → assemble no-audio timeline → validate skeleton
    → DELIVER (provisional wrapper)                        ← critical path ends here
    → staging state: delivered:processing                  ← staging is the durable owner
     ↳ async continuation (same worker, sole executor):
          transcribe (sidecar BEFORE status flip) → timeline
          → final validation → one commit (doc + delivered flip together)
          → emit capture-status "transcribed" → THEN tear down staging
```

Captures with no audio assemble their timeline synchronously before delivery
(it's ~5ms) — their wrapper is final and nothing runs behind the message.

Critical path becomes write (~50ms) + validate (~20ms) + deliver (0–1.1s).
Estimated Done → visible message: **sub-second warm, ~1.5s cold** locally;
on prod, seconds instead of tens-of-seconds-to-minutes, because git leaves
the path entirely.

Validation runs **twice**: the existing pre-delivery pass (now validating
the skeleton — cards must parse and lint before a message points at them)
and a **final pass at the end of the continuation**, before the deferred
commit, covering everything transcription and timeline assembly mutated.
Both are ~20ms; committing unvalidated mutations was a gap in the first
draft.

Enqueue semantics are unchanged and stay honest: delivery into a busy chat
enqueues in memory, and a crash before drain loses the *notification* (never
the cards — and now never the processing either, since staging still owns
the continuation through `delivered:processing`). Same accepted trade as
today, explicitly not expanded.

### The provisional wrapper

Delivery currently depends on transcription for the wrapper's `summary` and
`audio="M:SS"`. The provisional wrapper drops that dependency:

```
<capture doc="…/tmp-capture/….capture-session.card" images="3" clips="1" pending="transcription">
3 photos, 1 voice clip
</capture>
```

- `pending="transcription"` — present only while audio awaits transcription;
  captures with no audio never carry it (their wrapper is already final and
  keeps the current shape, `audio="0:00"` semantics unchanged).
- `clips="N"` replaces the duration we don't know yet; the final duration,
  transcript timeline, and summary live on the capture card once
  transcription lands. (Alternative: ffprobe per clip — ffmpeg is now a
  standard server install — would give a real `audio="M:SS"` up front for
  ~50ms/clip. Optional polish, not load-bearing.)
- The summary is a deterministic media tally, matching what the pending
  bubble already shows.

The chat transcript is append-only, so the wrapper text stays provisional
forever; the *card* is the source of truth for the finished capture. That
means `pending` **cannot** drive a live "transcribing…" badge by itself — a
year later the wrapper still says `pending`. Two-part rendering rule:

- `pending` alone renders as *historical* fact ("sent while transcribing"),
  never as current status.
- The `CaptureChip` does a lazy per-doc query (tRPC, on mount, only when
  `pending` is present) for the card's current state, and renders the real
  summary / "transcribing…" / "transcription failed" from that. This is
  mandatory in the first cut, not polish — without it the chat shows a
  permanently stale processing badge. (Today's chip is a pure render of the
  wrapper string with no fetch; and to correct the first draft: today's
  `transcription-failed="1"` is *not* silent — the chip shows it and the
  prompts explain it. The new failure surface must not regress that.)

The agent's response — quoting and acting on the real transcript — remains
the main user-visible payoff.

### The agent's side: wait on it

The message must carry "enough for the agent to know how to wait on and act
on it". One `cb` command in the first cut:

- **`cb capture await <doc-path> [--timeout 90s]`** — blocks until the
  **whole continuation** has finished (transcription sidecars + timeline +
  final validation + the deferred commit), then prints the assembled
  transcript body; on failure/timeout it reports the concrete state (which
  clips failed, whether the continuation is still running). Normally returns
  in ~0–3s because the continuation started at delivery; it is a
  synchronization primitive, not a work order.

The capture-session schema `instructions` (plus the capture mention in chat
prompts) teach: "a `<capture>` message with `pending=\"transcription\"` means
the transcript isn't ready; run `cb capture await <doc>` before acting on it,
and do not file/move/annotate the capture until `await` returns" — the
do-not-move rule guards the race between the agent's filing instructions
(the schema already tells agents to annotate → commit → move) and the
continuation still mutating cards at the original path.

Reliability stance: **exactly one executor** — the worker owns transcription
end to end; startup resume and the sweep re-fire the *same* continuation off
the retained staging state (below), same as they re-fire preparation today.
An agent-driven `cb capture transcribe` (the agent actually running the
processing) is deliberately cut from the first version: a second executor in
a second process needs cross-process locking and a full lifecycle contract
(final validation, commit, events), and the Codex review showed the sketch of
it was under-specified on all of those. It can return as a follow-up if
worker-side recovery proves insufficient in practice.

### Commits: off the path, and fewer

- The two per-capture commits collapse into **one deferred commit** at the
  end of the continuation (doc + `status: delivered` flip together), off the
  critical path. `commitChain` serialization and pathspec scoping stay.
- The card `status: new → delivered` flip happens in that same commit.
  Mid-continuation crash recovery is owned by the **staging state**, not by
  card scanning (see next section) — the delivered-probe (transcript
  substring) answers "did the message land", staging answers "is processing
  done".
- Longer-term option (boxholder call, not in this plan's first cut): stop
  committing `tmp-capture/` at all — it is explicitly pre-triage/ephemeral
  (the annex exception exists because filing re-encodes and renames) — and
  let the filing step make the first commit. That would also make the glob
  question moot.

### The gitignore glob (independent bug, fix alongside)

`**/tmp-capture/**/*.attach/**` (the managed cb-assets block) over-matches:
it was meant to keep pre-triage *media bytes* out of the annex, but it also
ignores the child `.card` files and `manifest.json`. Post-`6e9860f3` captures
deliver, but their child cards and manifests are silently uncommitted (a
capture "committed" to box-family history today is just the session card).
Fix: add negations to the managed block —

```
**/tmp-capture/**/*.attach/**
!**/tmp-capture/**/*.attach/**/*.card
!**/tmp-capture/**/*.attach/**/manifest.json
!**/tmp-capture/**/*.attach/**/*.timing.json
```

(`*.timing.json` too — the word-timing sidecars are what the timeline is
rederived from; without them a backup/remote can't rebuild the transcript.)

— and re-run the unignore writer on existing annex boxes (same managed-block
update mechanism that installed it). If the "never commit tmp-capture"
option is chosen instead, this becomes unnecessary; until that decision the
history should not be silently lossy.

### Resume, sweep, and staging teardown

- **Pre-delivery states are unchanged** (`sealed`/`preparing`/`delivering` +
  the CAS seal, resume scan, and abandonment sweep all keep their semantics);
  the span they cover just shrinks to "until the message lands".
- **Staging stays the durable recovery owner until the continuation
  finishes.** One new state, **`delivered:processing`**, is written when the
  message lands; teardown happens only after transcription + timeline +
  final validation + the deferred commit all succeed (i.e. exactly where
  teardown happens today). Startup resume and the sweep re-fire
  `delivered:processing` sessions into the continuation the same way they
  re-fire `preparing` today — no card-scanning supervisor, no crash window
  where an unfinished capture has no owner. (The first draft tore staging
  down at delivery and rescanned cards instead; the Codex review showed that
  combination leaves a restart-after-teardown capture unowned. Staging bytes
  could in principle be discarded early since `write-cards` already copied
  them into the attach scopes — but the state file must live for the
  session's whole life, and deleting media-but-not-state buys ~nothing.)
- **Transcription becomes crash-consistent**: the `.timing.json` sidecar is
  written *before* the audio card's `status: transcribed` flip (today it's
  the reverse — a crash in the gap yields a clip that reads complete but has
  no timing, and the timeline assembler then can't ever rebuild it). With a
  single executor plus this ordering, re-fired continuations are safely
  idempotent.
- Transcription failure after delivery: clips keep `status: new` with the
  error recorded on the card; the continuation still assembles the timeline
  (untranscribed-clip markers are an existing mechanism), validates, commits,
  and tears down — the capture completes *degraded*, exactly like today's
  `transcription-failed` outcome, except the agent (via `await`) and the chip
  (via the live query below) can say so in the conversation flow.

### Explicitly out of scope / follow-ups

- **Parallelize per-clip transcription** (serial loop in
  `transcribe-clips.ts`): fold into the continuation as a trivial
  `Promise.allSettled` with a small cap. Footnote-level: the common case is
  one clip.
- **Provider choice — settled**: the boxholder wants voxtral or whisper
  (deepgram measured 3× faster — 0.96s vs 2.8s for the same 33s clip — but is
  not the preference). Consequence: ~2.7–3s per clip is the transcription
  floor, which makes taking it off the critical path (this plan) and
  parallelizing multi-clip captures the levers, not provider swaps.
- **The 2026-08-04 morning capture's 4–5 minutes was mostly NOT this
  pipeline**: the box child was GC-thrashing (mutator utilization ~0.3)
  under the iOS webview's burst-refetch of a 15.5MB transcript, then heap-OOM
  crashed mid-`delivering` and resumed after respawn. That is
  `issues/bugs/2026-08-04-chat-history-parse-transient-oom.md` (filed from
  the ios-capture-upload-diag worktree, live-measured, with fix directions) —
  a separate track. This plan removes work from the crash-exposed span but
  does not fix the OOM.
- **The pre-Done upload wait (~20s on phone uplink)**: Done is gated on all
  uploads landing. A possible follow-up: allow finalize-with-pending-uploads
  (client declares expected media; the server seals when the last upload
  drains), moving that wait into the async span too. Touches the iOS/web
  capture clients and the staging seal CAS — out of scope here, noted for
  the boxholder.
- **Cold-start delivery cost** (~0.6–1.1s: compose snapshot + auth
  preflight): real but secondary; optimize only if it dominates post-change
  measurements.
- **Keep the timing instrumentation**: the per-capture `StepTimer` line in
  `.callback-box/capture-timing.log` stays (it is how prod gets diagnosed
  next time); the finer-grained `chat-send`/`chat-run-start` lines come out
  before merge.

## Surfaces touched

| surface | change |
|---|---|
| `core/capture/prepare.ts` | reorder; provisional wrapper; continuation split; final validation pass |
| `core/capture/staging-store.ts` / `staging-schema.ts` | new `delivered:processing` state |
| `core/capture/transcribe-clips.ts` | sidecar-before-status ordering; called from continuation; optional parallelism |
| `core/capture/deliver.ts` | `buildCaptureWrapper` new attrs (`clips`, `pending`); summary tally variant |
| `core/capture/resume.ts` / `sweep.ts` | re-fire `delivered:processing` into the continuation |
| `core/event-bus-schemas.ts` + frontend `capture-bubble.tsx` status union | new `transcribed` capture-status value |
| `cli` | new `cb capture await` (waits for the whole continuation) |
| `schemas/capture-session.tsx` | instructions: pending state; don't file/move until `await` returns |
| chat prompts (`chat/session/prompts.ts`) | pending-capture handling |
| `frontend components/chat/capture-message.ts` + `CaptureChip` | parse `clips`/`pending`; historical badge + mandatory lazy card-state query |
| webapp tRPC | small capture-card-state query for the chip |
| annex unignore writer | glob negations (cards, manifests, timing sidecars) + managed-block migration |
| doctests | wrapper exact-string tests, prepare pipeline fixtures, continuation resume fixtures, `await` tests |

Wire-contract note: the `<capture>` wrapper is chat vocabulary (doctested
exact). iOS renders chat through the web view, so the chip change rides
along; the capture upload/finalize HTTP contract is untouched
(`docs/mobile-contract.md` unaffected).

## Open questions for the boxholder

1. Deferred-single-commit (this plan) vs **never committing tmp-capture**
   (filing makes the first commit)? The latter is simpler and matches the
   pre-triage semantics, but changes what backup/remotes see for unfiled
   captures.
2. `cb capture await` + worker-driven continuation (this plan) vs also giving
   the agent a `cb capture transcribe` drive-it-yourself lever? The first cut
   deliberately has exactly one executor (the worker); the agent synchronizes
   but never processes. If you want the agent-drives lever, it needs a
   cross-process lock + a full lifecycle contract (validate/commit/events),
   which is real added scope — the Codex review sized that gap.
3. ~~Flip box-family (and/or the default) to deepgram?~~ Settled: no —
   voxtral/whisper stays (boxholder, 2026-08-04).
4. Any attachment to the summary appearing in the chat bubble text itself?
   (Post-change it's a media tally there; the real summary lives on the card
   and in the agent's response. The optional live-chip query can close most
   of the gap.)
