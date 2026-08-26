---
title: "Chat session identity — one owned key, one recorded origin"
status: draft
workstream: chat-session-identity
issues:
  - ../../../issues/closed/bugs/2026-08-25-encode-project-dir-underscore-mismatch.md
  - ../../../issues/bugs/2026-07-28-renamed-husk-duplicates-on-backfill.md
  - ../../../issues/features/2026-07-29-stale-husks-outlive-their-transcripts.md
  - ../../../issues/bugs/2026-07-29-chat-review-journal-is-machine-local.md
  - ../../../issues/code-quality/2026-07-18-chat-backend-port-hygiene.md
  - ../../../issues/features/2026-07-20-chat-thread-management.md
  - ../../../issues/bugs/2026-07-28-parse-session-log-silent-page-truncation.md
  - ../../../issues/bugs/2026-08-15-chat-husk-title-contains-raw-message-markup.md
---
# Chat session identity — one owned key, one recorded origin

A web chat's state lives in three stores with different lifetimes and sync
properties: the husk card (git, permanent, every checkout), the engine's
transcript (one machine, expires), and `.callback-box/` bookkeeping (one
checkout). This plan makes the husk's `session` field the only key we look a
husk up by, and records on the husk the one fact nothing can derive later —
which machine ran the session. That fact resolves "expired vs ran elsewhere",
lets a dead husk be archived truthfully, and gives chat review a single writer
per session.

**Decided before planning (boxholder, 2026-08-26):** transcripts do not go into
the box's git repository. A durable box-owned transcript would need a non-git
store; that is not this plan.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` #1 types are structure (`:12`) — transcript
  state is a discriminated union, not three nullable flags.
- #3 validate at boundaries (`:37`) — `session` is validated as an id before it
  becomes a path segment; `origin` is a plain string, never joined.
- #4 resilient AND never silent (`:49`) — a duplicate husk, a truncated count,
  an unknown origin each produce a visible signal.
- #6 right-sized defensiveness (`:75`) — no defense against a session running
  on two machines at once; that cannot happen (one engine store per machine).
- #8 one way to do each thing (`:95`) — one lookup (`session` field), one
  host identity (`os.hostname()`, already used by `src/lib/file-lock.ts:302`),
  one archive mechanism (`cb mv` semantics, as delete reuses `trash`).
- `callback-box/CLAUDE.md` "don't add features beyond what the task requires" —
  no GC sweep, no rename UI.
- Precedent: `docs/plans/chat-session-delete.md` — validate `session` as the
  SDK's UUID shape before any path join; reuse box commands rather than new
  file mechanics; delete-order as an invariant.
- `cb-migration` rule: an additive field that old cards load without is not a
  migration. `origin`/`engine` are additive and backfilled by reconcile.

## What already exists

- `src/core/chat/husk.ts:47-58` `findChatHusk` — the only filename-suffix
  matcher; used by `ensureChatHusk` (`:94`) as its idempotency gate and by
  `findChatHuskEntry` (`:221`) as a fast path that already falls back to a
  `session`-field scan (`:226-227`). **Reuse the scan; retire the suffix gate.**
- `src/core/chat/husk.ts:246` `reconcileChatHusks` — runs every boot, keys on
  the `session` field (`:246-248`), reads each husk once. **Reuse as the
  backfill point for `origin`/`engine`.**
- `src/core/chat/session/session-start-record.ts:76` — the one live caller of
  `ensureChatHusk`, already carrying `engine`. **Reuse: pass `engine` and
  `origin` through.**
- `src/core/chat/session/availability.ts:13,32` — `reason:
  "missing-local-transcript"`, surfaced by `chat-bootstrap-procedure.ts:70`.
  **Extend** with attribution.
- `src/core/chat/session/list.ts:83-95` `loadAllSessions` — skips husks whose
  transcript is absent. **Change**: return them with a transcript state so the
  UI can group them.
- `src/core/chat/review/discovery.ts:247` — husk-first corpus. **Extend** with
  the origin claim.
- `src/core/chat/review/state.ts` — the span journal. **Keep machine-local**;
  it is legitimate once only the origin machine reviews a session.
- `src/core/commands/trash.ts:58-149` — moves a card + attachment scope and
  can commit. **Reuse its move primitive** for archive; delete already does.
- `src/core/card-lint.ts:76` `lintCardsDispatch` / `lintFrontmatterCard` —
  per-file only; no cross-file rule exists. **Add** a per-run index for the
  `chat` type.
- `src/core/chat/session/transcript-paths.ts:28` `encodeProjectDir` — verified
  correct against Claude Code 2.1.246 on 2026-08-25 (commit `2032961e8`); the
  divergent copy in `symlinkClaudeMemory` was the bug and is fixed.
- `src/core/retro/discovery.ts:72-87` `countUserMessages` — page-0 read of
  `MAX_SESSION_ENTRIES`, discards `total`. **Change** to surface truncation.
- `src/core/chat/husk.ts:80` `readSnippetTitle` → `extractSnippet` — shipped
  `7faa58b2`. Closes the husk-title issue once inner elements are confirmed
  stripped (chunk 1 checks `stripSpeechWrappers` against `<user-selection>`,
  `<send-message>`, `<unsure>`).

## Prior art (external)

- Claude Code retention: `cleanupPeriodDays` (default 30) prunes
  `~/.claude/projects/**` — https://docs.anthropic.com/en/docs/claude-code/settings.
  Measured cliff in the stale-husks issue. No upstream notion of "why gone".
- Claude Code 2.1.239 changelog: project-dir names over 200 chars are
  truncated with a hash suffix (read from the 2.1.246 binary, function pair
  `B`/`J`). Not mirrored; longest local name is 152. Recorded on the encoder.
- Host identity: `os.hostname()` on macOS can change with network location.
  Node docs make no stability promise. Searched "os.hostname macOS changes
  local" — known behaviour (Bonjour name vs `scutil --get HostName`). Handled
  as a failure mode below, not designed around: the field is a label for
  attribution, never a key for a path or a lock.
- No named pattern found for "expired vs elsewhere" attribution of foreign
  caches; the origin-stamp is the standard answer (a write-once provenance
  field).

## Tracks / scope

### Track 1 — Husk identity is the `session` field (clerical)

**What.** Every husk lookup goes by the `session` field. The filename suffix
is a naming convention, never a key.

**Why.** `ensureChatHusk` gates on the suffix (`husk.ts:94`), so a renamed
husk is duplicated on the first resume after a server restart
(`session/state.ts:158` short-circuits only while the session is current).
The schema encourages renaming (`schemas/chat.ts:29`). Nothing detects the
duplicate: `session` is a bare `z.string()` (`schemas/chat.ts:18`).

**Direction.**
- `findChatHusk` → delete. `ensureChatHusk` calls `findChatHuskEntry`
  (field scan; the suffix fast-path stays inside it).
- `schemas/chat.ts`: `session: z.string().uuid()`-shaped check via the same
  strict id parser delete uses (`docs/plans/chat-session-delete.md`, "parse it
  as the SDK's strict UUID shape"). Codex thread ids: confirm shape in chunk 1;
  if not UUID, a union of the two shapes.
- card-lint: for `chat` cards, an error when another card under
  `store/chat/**` carries the same `session`. Index built once per
  `lintCardsDispatch` run (lazy, on `LintDispatchOptions`), listing via
  `listChatHusks`. Message names both paths.
- `reconcileChatHusks`: log a warning per duplicate `session` (boot-time
  visibility, principle #4); no auto-repair.
- `countUserMessages`: return `{ count, truncated: total > limit }`; the
  caller logs a one-line notice when truncated. Amend the truncation issue
  down to `renderSessionCompact` + `extractBehavior` if those remain, else close.

**Vocabulary lock-ins.** None new.

**First chunk.** All of the above; one commit per bullet is fine. No open
questions.

### Track 2 — The husk records `engine` and `origin`

**What.** Two write-once fields on the husk: `engine: claude | codex` and
`origin: <hostname>` — the machine whose engine store holds the transcript.

**Why.** Today "transcript missing here" cannot be told from "transcript
expired". The history file has `engine` but is per-checkout; nothing anywhere
records the machine.

**Direction.**
- `schemas/chat.ts`: `engine: z.enum(["claude","codex"]).optional()`,
  `origin: z.string().optional()`. Instructions: machine-owned, leave alone.
- `createChatHuskTemplate` takes both; `ensureChatHusk` writes them on
  create. `recordSessionStart` passes `engine` (it has it) and
  `origin = os.hostname()` via one helper `localOrigin()` in
  `src/core/chat/session/origin.ts` (single definition, principle #8).
- Backfill in `reconcileChatHusks`: a husk with no `origin` whose transcript
  exists here gets `origin = localOrigin()` and `engine` from the history
  entry (default `claude`). A husk with no `origin` and no transcript stays
  unset — `unknown` is honest. One card write per backfilled husk, under the
  existing card lock; logged as a count.
- Existing `engine` on the history entry is unchanged (it is the runtime's
  fast path); the husk copy is the durable one.

**Vocabulary lock-ins.** Field names `engine`, `origin` on `chat` cards.
`origin` is a label; it is never joined into a path or compared for locking.

**First chunk.** Schema + template + write-through at start + reconcile
backfill + doctest that a fresh husk carries both and a legacy husk gains
them when its transcript is present. No open questions.

### Track 3 — Transcript state and archive

**What.** A derived, typed transcript state per husk, shown in the chat lists
and bootstrap; an archive action for dead husks.

**Direction.**
- `src/core/chat/session/availability.ts`: `SessionAvailability` gains
  `transcript: { state: "present" } | { state: "expired" } | { state:
  "elsewhere"; origin: string } | { state: "unknown" }`, derived as:
  present → `present`; missing and `origin === localOrigin()` → `expired`;
  missing and `origin` set → `elsewhere`; missing and unset → `unknown`.
  Replaces the bare `"missing-local-transcript"` reason (principle #1).
- `loadAllSessions` returns dead husks too, with the state; the dropdown and
  `ChatsLandmarkCard` group them under "Expired" / "On <origin>" /
  "Unavailable", non-resumable, linking to the husk card.
- Archive: `chat.archive` tRPC procedure beside `chat.delete`; moves the husk
  (with attachment scope, via the `trash.ts` move primitive) to
  `store/chat/archive/`, commits like delete does. Offered in the same
  confirmation surface as delete, enabled for any state except `present`.
  `listChatHusks` continues to read `store/chat/web/` only, so archived husks
  leave every list and the review corpus while staying searchable cards.
- Delete on an `elsewhere` husk: keep current behaviour (trash the card;
  nothing local to remove) but the disclosure names the origin machine.

**First chunk.** The state derivation + availability + doctest; UI grouping
and archive follow as separate commits. Open question below on labels only.

### Track 4 — Chat review claims by origin

**What.** A machine reviews only sessions it originated.

**Why.** Two checkouts share one account and hold different transcript
subsets (`issues/bugs/2026-07-29-chat-review-journal-is-machine-local.md`);
each extends `contains-evidence` from partial material.

**Direction.** `review/discovery.ts` qualifies a session only when
`origin === localOrigin()`, or `origin` unset and the transcript is present
here (pre-backfill husks; reconcile sets `origin` on the next boot so this
branch decays). Sessions skipped for origin are counted in `cb chat review
status` output. The journal stays in `.callback-box/` — it is machine state
about a machine-local transcript, which is now the correct scope.

**First chunk.** The discovery predicate + a doctest with a husk whose
`origin` is another host. No open questions.

### Track 5 — Port hygiene item 3: recast

No code. The issue's item 3 ("own a durable transcript") is rewritten to
record the 2026-08-26 decision: no git-stored transcript; a durable store
would be a separate mechanism; revisit if retention loss exceeds what
`contains-evidence` preserves or a third engine arrives. Items 1, 2, 4 stay
open as filed.

## Could this be simpler?

Simplest version: fix `ensureChatHusk`'s lookup (Track 1) and stop. Cost:
"expired vs elsewhere" stays unanswerable, so archive cannot be offered
truthfully (principle #4 — archiving a live-elsewhere chat hides it), and
review keeps double-extending accounts across checkouts. Next simplest: record
`origin` but skip archive and UI grouping. That leaves dead husks invisible in
every list (they are skipped today), so the boxholder never sees the state the
system is in (principle #13). The plan's extra pieces are the state derivation
and one archive action; the journal is deliberately *not* moved to the husk,
and no GC sweep is built.

## Subplans

None. A non-git durable transcript store would be one; it is out of scope.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Two husks carry the same `session` (pre-existing duplicates) | Track 1 lint doctest | lint error + reconcile warning | clear |
| `os.hostname()` changes on the laptop → own sessions read as `elsewhere` | Track 3 doctest for the `elsewhere` branch only | none: state shows "On <old-name>"; archive still allowed, review skips | clear but wrong attribution |
| Backfill stamps `origin` on a husk whose transcript exists on two machines | cannot happen: one engine store per machine; a resumed-elsewhere session forks a new id | — | — |
| Reconcile's card write fails mid-backfill | existing reconcile logging | logged, retried next boot (idempotent) | clear |
| Archive move fails after commit staging | reuse of `trash.ts` paths + its doctests | compensates like delete | clear |
| Codex thread id not UUID-shaped, strict `session` check rejects valid husks | chunk-1 check | fix shape before landing | — |
| `countUserMessages` truncated on a >5000-entry transcript | new doctest with a synthetic long log | notice logged | clear |

> No critical gap. The hostname-drift row is accepted: the field is a label,
> the wrong label is visible, and a rename of the machine is rare and
> boxholder-caused.

## Agent-flow / user-flow edge cases

- **Wrong field** — an agent edits `origin`/`engine`: ADDRESSED, instructions
  mark them machine-owned; reconcile never overwrites a set value, so an
  edit sticks and shows as-is (same posture as hand-set titles).
- **Stale ref** — husk archived while a chat tab is open: ADDRESSED, the tab's
  bootstrap resolves by `session` and reports the transcript state.
- **Two agents touching the same card** — reconcile backfill vs review
  writing `contains`: ADDRESSED, both use the existing card lock
  (`review/husk-write.ts` `withCardLock`).
- **Hand-edit drift** — `Origin:` capitalised: ADDRESSED by schema (unknown
  key is a lint error today).
- **Fabricated value** — n/a; both fields are machine-written.
- **Validation error UX** — duplicate-session message names both paths and
  says "keep one; `cb trash` the other": ADDRESSED in Track 1.
- **Transition state** — husks without `origin` during rollout: ADDRESSED,
  `unknown` state + review's decaying fallback branch.

## NOT in scope

- A box-owned transcript log (decided 2026-08-26: not in git; a separate
  store is separate work).
- Automatic archive/GC of expired husks — the boxholder archives; a sweep is
  a policy decision not yet made.
- Rename UI — renaming is `cb mv`/editor today and Track 1 makes it safe;
  a UI affordance is the thread-management issue's remainder.
- Moving the review journal onto the husk — unnecessary once review is
  origin-claimed; it would add four machine fields to a card.
- `events-db` generation truncation across checkouts
  (`issues/bugs/2026-08-08-events-db-truncates-across-engine-checkouts.md`) —
  same per-checkout-state family, different subsystem; untouched.
- Port-hygiene items 1, 2, 4.
- Mirroring Claude Code's 200-char project-dir truncation.

## Open design questions

- List labels for dead husks ("Expired" / "On prod" / "Unavailable") — lean
  as written; settle in the UI commit.
- Whether `cb chat review status` should list the skipped-for-origin sessions
  by name or only count them — lean: count.

## Knowledge audits

One `knows_directly` entry: an agent asked to rename a chat husk should say
renaming is safe because the `session` field is the key, and should say not to
touch `origin`/`engine`. Lands with Track 2 and is run against the test box.

## Implementation order

1. Track 1 (lookup, lint, reconcile warning, truncation notice, husk-title
   verification/close) — no dependencies.
2. Track 2 (fields + backfill) — depends on 1's lookup change.
3. Track 3 chunk 1 (state derivation) — depends on 2. Then list grouping,
   then archive.
4. Track 4 (review claim) — depends on 2; independent of 3.
5. Track 5 (issue rewrite) — any time.
Cross-model review after 3; /finish after all.

## Rollout shape

- Tests: doctests named per track above; each landing chunk runs its own
  doctests + typecheck + eslint, not the full suite.
- Migration: none in the `cb migrate` sense; reconcile's boot-time backfill
  is idempotent and additive. Prod gains `origin` on its next boot for every
  session that ran there.
- Knowledge audit: one entry, run before /finish.
