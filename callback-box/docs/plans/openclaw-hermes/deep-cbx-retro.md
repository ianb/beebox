# Deep dive: `cb retro` retrospective pipeline

Source tree: `callback-box/src/core/retro/` (`discovery.ts`, `state.ts`,
`registries.ts`, `render.ts`, `observer.ts`, `observations.ts`, `ledger.ts`,
`scan.ts`, `report.ts`), CLI surface `callback-box/src/cli/commands/retro.ts`,
procedure `callback-box/templates/procedures/process-retrospective.procedure.card`,
schedule default `callback-box/src/core/box-defaults.ts:252-272`, prose pointer
`callback-box/src/core/agent-guide/behavior.ts:62-68`, design doc
`callback-box/docs/implemented-plans/box-retrospectives.md` (the original plan;
frozen as historical record, largely still accurate against the code — verified
line-by-line below). Note: `callback-box/docs/activities-retrospective.md` is an
unrelated document (post-mortem of a removed "Activities" chat framework) — a
grep false-positive, not part of this pipeline.

Implementation landed across 8 commits (`a0fd2c51` chunk 1 walker →
`93d85c20` chunk 2 observer/ledger → `5d5670a0` chunk 3 procedure →
`cb24f952` doc move → `f50c5ecf` validation-gate fix → `afa46eda` XML→YAML
procedure migration → `1448c7a6` backlog-drain integration → `a23dabe3`
body-rewrite wording clarification). No open TODOs found in code.

---

## 1. Trigger & cadence

- **Command surface**: `cb retro status [--check]` and
  `cb retro scan [--max-sessions N] [--dry-run]`
  (`callback-box/src/cli/commands/retro.ts:53-118`). No `cb retro integrate` —
  integration is agent-driven, embedded in the procedure, not a separate CLI
  verb.
- **Procedure wrapper**: `templates/procedures/process-retrospective.procedure.card`
  has two steps, `scan` then `integrate`, each with its own `precheck` /
  `run` / `validate` phase (procedure-engine YAML-frontmatter cards, `<agent>`
  steps invoke Claude Code).
  - `scan` precheck: `cb retro status --check` → `exit $CHECK_SKIP` when zero
    qualifying sessions (lines 22-32) — a quiet week does no work and spawns
    no agent.
  - `scan` validate: greps for the newest `store/reviews/retro/*.md`,
    fails the phase if none exists (lines 36-50).
  - `integrate` precheck: `grep -Fl '_Pending integration._' store/reviews/retro/*.md`
    — **drains the whole backlog**, not just the latest run (lines 54-116).
    `exit $CHECK_SKIP` when nothing is pending.
  - `integrate` validate (`severity: abort`, lines 228-249): fails the whole
    procedure run if any report still says `_Pending integration._` after the
    agent step.
- **Default schedule**: `process-retrospective.scheduled-script.card`,
  installed via `DEFAULT_SCHEDULES` (`box-defaults.ts:252-272`):
  `cron: "0 7 * * 1"` (Monday 07:00), `notBefore: "3d"`, `onWakeup: false`,
  **`enabled: true`** — shipped enabled for every box, not opt-in. The comment
  at `box-defaults.ts:259-267` explains why this is deliberately safe:
  `generateDocs()` re-syncs the template on every reactor cycle/chat-session
  start, so flipping it on retroactively re-enables it on existing boxes too;
  the scan+integrate prechecks make it a true no-op (no agent invoked) on
  boxes with nothing to mine.
  `lockGroup: "retro"` serializes this schedule against any other scheduled
  script sharing the same lock group (not against interactive chat — see §6).
- **Manual trigger**: `cb procedure run process-retrospective` any time, or
  `cb retro scan` directly for just the observation half.
- **Gates**: session **quiescence** (30 min, `QUIESCENCE_MS`,
  `discovery.ts:22`) — a transcript modified more recently than that is
  deferred, not observed, so an in-progress conversation is never mined
  mid-stream. Per-run session cap (`--max-sessions`, default 20,
  `retro.ts:26`) — overflow is left for the next run and named in the report,
  never silently dropped or silently expanded.

## 2. Input selection

- **Source of sessions**: `listSessions(boxRoot)` (`cli/lib/session.ts`)
  enumerates everything under `~/.claude/projects/<encoded-box>/` — this
  directory is shared by chat sessions, wakeup runs, job runs, and procedure
  runs alike, so discovery must separately classify "is this a chat."
- **Chat qualification** (`discovery.ts:97-124`, all three must hold):
  1. **Is chat** — the transcript has `<typed>`/`<speech>`-tagged user
     messages (`isRealUserMessage`, webapp convention) **or** the session id
     appears in a chat registry (`loadChatRegistryIndex`,
     `registries.ts:56-82`: `.callback-box/chat-session-history.json` for
     webapp history, `.callback-box/chat-thread-sessions.json` /
     `chat-sessions.json` for telegram threads — telegram sends raw
     untagged text, so registry membership is the only chat marker there).
     `userMessages = counts.tagged > 0 ? counts.tagged : counts.userEntries`
     (line 112) — falls back to raw user-entry count when untagged but
     registry-confirmed. Zero either way → classified `nonChat`.
  2. **Quiescent** — `now - mtime >= 30min` (line 102).
  3. **Not settled** — `!isSessionSettled(state, sessionId)`
     (`state.ts:42-47`): a session already marked `done`, or `failed` with
     `attempts >= MAX_OBSERVE_ATTEMPTS` (2), is skipped — this is the
     high-water mark.
- **High-water mark mechanism**: `.callback-box/retro/state.json`
  (`state.ts:15`) — `{ lastRunAt, sessions: { [sessionId]: {status, attempts, at} } }`.
  This is a **per-session settled/unsettled ledger**, not a single timestamp
  cursor — every session id is tracked individually, so out-of-order
  mtimes or late-arriving sessions are handled correctly (no risk of "session
  older than the cursor gets skipped forever"). The full session list is
  re-enumerated and re-filtered on every run (`discoverSessions` re-lists
  everything each time) — it does **not** re-read already-`done` transcripts,
  since `isSessionSettled` short-circuits before `countUserMessages` is
  called. So: full re-scan of the directory listing every run, but no re-read
  of already-processed transcript content.
- **Window/bounding of one session's content**: `renderSessionCompact`
  (`render.ts:57-65`) renders user+assistant turns with one-line tool-call
  summaries (tool_results dropped as "noise without value", line 36), hard-capped
  at `MAX_RENDERED_CHARS = 40_000` (line 21) via `elideMiddle` — over the cap,
  the **middle** of the transcript is dropped with a `"… (N chars of
  conversation elided) …"` marker, keeping both ends (the plan's rationale:
  corrections/preferences cluster at both ends of long conversations).
- **Ordering**: qualified sessions are processed oldest-first
  (`discovery.ts:126-128`, "so recurrence builds chronologically").

## 3. The prompt

Observer is one **tool-less** (by prompt convention; not sandboxed — see §4)
LLM pass per session (`observer.ts`). Full system prompt, verbatim
(`observer.ts:32-48`):

> You are the retrospective observer for a personal-assistant box. You read
> one chat transcript between the boxholder and their assistant and extract
> what the boxholder implicitly taught the assistant.
>
> Report an observation ONLY when the transcript actually shows it:
>
> - correction — the boxholder corrected the assistant's behavior, tone, or output
> - preference — a stated or demonstrated preference about how things should be done
> - register — evidence of the boxholder's preferred tone, formality, or verbosity
> - recurring-ask — a request that looks like a standing need rather than a one-off
> - context-gap — the assistant had to ask about (or guessed wrong on) something its briefing should have answered
> - experiment-evidence — behavior bearing on an active personality or guide experiment
>
> Rules:
> - evidence must be a LITERAL QUOTE copied from the transcript — the boxholder's words where possible, never a paraphrase.
> - proposal is one sentence: what belief or rule this evidence suggests.
> - sink says where the belief belongs: personality (tone/traits/relationship), guide (a domain rule — set sinkRef to the guide card path if the transcript makes it clear), briefing (missing situational context), question (needs the boxholder's explicit confirmation).
> - Do not use any tools. Work only from the transcript in this prompt.
> - Do not invent observations. An empty list is the common, correct result for routine conversations.

User prompt: `` `Session ${sessionId}. Transcript follows.\n\n${transcript}` ``
(line 72).

**Output structure** — Zod schema `ObserverOutputSchema` = `{ observations: SessionObservation[] }`
(`observations.ts:26-49`), each observation:
```
kind: correction | preference | register | recurring-ask | context-gap | experiment-evidence
evidence: string (min 1)   — "Literal quote copied from the transcript — never a paraphrase"
proposal: string (min 1)   — "One sentence: what belief or rule this evidence suggests"
sink: personality | guide | briefing | question
sinkRef?: string           — box-relative guide-card path when sink is guide
```
The observer explicitly does **not** assign confidence — that's deferred to
integration policy (§5), driven by recurrence, which the single-session
observer cannot see.

## 4. Model & tool surface

- **Model**: `DEFAULT_OBSERVER_MODEL = "haiku"` (`observer.ts:28`) — cheap
  tier by design; comment says "quality is judged by reading run reports,
  revisit if it under-extracts" — i.e. no automated quality metric, human
  spot-check only. Overridable via `createSdkRetroObserver({ model })` but
  nothing in the CLI/procedure passes a different model — haiku is what
  actually runs.
- **Budget/turns**: `maxTurns: 4`, `maxBudgetUsd: MAX_BUDGET_USD = 0.25`
  per session (`observer.ts:30,74-75`). One retro run can therefore cost up
  to `20 sessions × $0.25 = $5` in the worst case (default `--max-sessions`),
  though a tool-less single-shot extraction should cost far less in
  practice.
- **Fresh agent per session**: `createAgent({ name: `retro-observer:${sessionId}` })`
  (line 68) — no session reuse/resume across sessions, no shared memory
  between observer passes within a run (each session judged independently;
  cross-session recurrence is purely a later ledger-read operation, not
  something the observer itself sees).
- **Tool surface — the "tool-less" claim is prompt-only, not enforced.**
  `createAgent`/`runAgent` (`callback-box/src/core/agent.ts`,
  `agent-run.ts`) build SDK query options with
  **`permissionMode: "bypassPermissions"`** (`agent-run.ts:63`) unconditionally
  for every agent invocation in the codebase — there is no
  `allowedTools`/`disallowedTools` restriction anywhere in `agent.ts`,
  `agent-run.ts`, or `agent-types.ts`. The observer's isolation rests entirely
  on: (a) the system-prompt instruction "Do not use any tools," and (b)
  `maxTurns: 4` capping how many tool-call round-trips could occur even if
  the model ignored that instruction. `PreToolUse`/`PostToolUse` hooks
  (`gitMvNudgeHook`, `cardValidatorHook`) are still wired
  (`agent-run.ts:73`) regardless. In practice haiku reliably follows a
  direct "don't use tools" instruction, but this is a **prompt-level
  convention, not a sandboxed guarantee** — a sufficiently adversarial or
  confused transcript (e.g. one containing prompt-injection text) could in
  principle induce a tool call with full bypass-permissions filesystem/shell
  access scoped to the box directory, since `cwd` defaults to `boxRoot`
  (`agent-run.ts:189, buildQueryOptions` line ~63) and no `additionalDirectories`
  narrowing is applied for the observer.
- **Isolation between runs**: none beyond process boundaries — no worktree
  or sandbox isolation; the observer runs directly against the live box
  checkout (same as every other `cb`-invoked agent).
- **Integration agent** (the `<agent>` step in the procedure,
  `process-retrospective.procedure.card:118-227`): a normal full-capability
  Claude Code agent (`max-turns: 40`, no model override so it uses whatever
  default `cb procedure run` uses) with full read/write/git access to the box
  — it is expected to edit cards and run `git commit`. No tool restriction
  here either, by design (it must write files and commit).

## 5. Promotion/staging

Promotion happens entirely inside the `integrate` step's agent prompt — there
is **no code-level scoring or threshold enforcement**; the LLM is trusted to
apply a stated policy on its own read of the ledger. Verbatim policy from the
procedure card (`process-retrospective.procedure.card:146-207`):

- **Filter for signal first** (Step 2): *"Many observations are thin
  one-offs: a passing mention, a logistics aside, a single offhand line with
  no durable lesson... SKIP these. Skipping with a one-line reason is the
  common, correct outcome — not a failure."*
- **Evidence-model confidence ladder** (Step 3, hard limits per the prompt):
  - New belief → `source: inferred`. Confidence by **recurrence across
    distinct sessionIds** sharing the same proposal: 1 session = `hypothesis`,
    2-3 = `low`, 4+ = `medium`.
  - `medium` is the **hard ceiling** for `inferred`; promotion past it
    requires a question card (boxholder confirmation → becomes
    `user-stated`).
  - An existing matching belief may be strengthened by **at most one notch**
    per integration pass (respecting the ceiling) — never duplicated.
  - **Never edit or remove a `user-stated` belief.** Conflicting evidence →
    create a question card instead of overwriting.
  - `speaking-voice` and the briefing card **body** are never directly
    edited — proposed corrections there always become question cards.
  - `ref` is set to the observation's `threadRef` when the ledger entry has
    one.
  - An observation may resolve an item in the personality card's
    `unresolved:` list.
- **Sink routing** (Step 4): personality → tone/traits/relationships/
  unresolved/experiments only, with the rule that any wording change to a
  trait/tone entry requires rewriting the **whole body paragraph** (a
  confidence-only bump does not); guide → the specific guide card's rules/
  reactions/experiments (via `sinkRef` or "the obvious guide from the
  candidates listed"); briefing → never edited directly; context-gap →
  judged case-by-case (may create a new data card, may escalate to a
  question card, may be skipped as thin); question → a new
  `box/questions/<Name>.question.card`.
- **Recurrence/dedup mechanics**: two separate layers.
  1. **Exact-duplicate suppression** (code-enforced, `scan.ts:78-96`,
     `observations.ts:57-60`): `evidenceHash` = SHA-256 of the
     whitespace-normalized quote. If a hash is already in
     `.callback-box/retro/observations.jsonl`, the new observation is
     dropped before it's ever ledgered — this exists specifically because a
     *resumed* Claude Code session re-presents earlier turns verbatim, which
     would otherwise inflate recurrence counts every time the boxholder
     resumes a thread.
  2. **"Same proposal, different wording" recurrence** is **not** code-
     matched at all — it's left entirely to the integrator LLM's judgment
     reading the full ledger (design doc, "Open design questions": *"leave
     similarity judgment to the integrator... keep evidenceHash only for
     exact-duplicate suppression. Revisit if the ledger grows enough that the
     integrator misses recurrences."*). There is no embedding similarity, no
     fuzzy matching, no clustering — just an LLM eyeballing a JSONL dump.
- **Contradiction handling**: policy-only (prompt instruction, no code
  gate) — *"NEVER edit or remove a belief whose source is user-stated. If
  evidence conflicts with one, create a question card."* Nothing prevents
  the agent from disobeying this at the tool-call level; the only backstop
  is the `validate` phase of the procedure, which checks the report
  finalization state, not the semantic content of the diff (see §6).
- **Backlog-drain design** (commit `1448c7a6`): integration doesn't key off
  "latest report" — it re-greps *every* `store/reviews/retro/*.md` still
  containing the literal string `_Pending integration._` and integrates them
  all in one pass, so a lesson from an older, previously-skipped run is never
  permanently stranded behind a newer one. "Prior finalized reports" (their
  `## Actions taken` sections) are also dumped into context so the
  integrator doesn't redo already-integrated work.

## 6. Robustness gaps (honest assessment)

- **Ledger and state are entirely un-versioned, box-local, gitignored.**
  `callback-box/.gitignore` excludes all of `.callback-box/` (confirmed:
  `.callback-box/retro/state.json` and `.callback-box/retro/observations.jsonl`
  both live under that prefix, per `ledger.ts:15` and `state.ts:15`). This
  means:
  - **No audit trail survives a re-clone.** If the box directory is deleted
    and re-cloned from git (exactly what the monorepo's worktree tooling does
    for `~/src/boxes/test1` clones), the observation ledger and the
    per-session settled-state both vanish. The per-run **reports** in
    `store/reviews/retro/` are committed and survive — but the underlying
    evidence-hash dedup set and the "already processed" session list do not.
  - **Concretely**: after a re-clone, every previously-`done` session
    re-qualifies for observation (state.json gone → `isSessionSettled` always
    false), the observer will re-run on all of them, and since
    `evidenceHash` is also gone, the resulting observations will **not** be
    recognized as duplicates against history — they'll be freshly ledgered
    and can inflate recurrence counts on the very next integration pass. The
    procedure's own precheck acknowledges the *ledger-missing* half of this
    (`process-retrospective.procedure.card:70-77`: warns and tells the agent
    not to claim recurrence-dependent confidence) but does **not** address
    that a missing ledger also nullifies the duplicate guard.
  - **No backup/reversibility path** beyond normal git history of the
    committed report/card files. The append-only ledger itself (the record
    an operator would want to audit "what evidence led to this belief") is
    not backed up anywhere.
- **No size/bloat control on any retro artifact.** The ledger
  (`observations.jsonl`) is pure append-only with no rotation, truncation, or
  archival (`ledger.ts:26-35`); `store/reviews/retro/*.md` accumulates one
  file per run forever (no `gc`-style cleanup analogous to `cb procedure gc`
  for procedure runs); `state.json` grows one entry per session forever
  (`state.ts` — no pruning of old `done`/`failed` entries). Over months of
  weekly runs across many chat sessions this is unbounded growth, though
  small per-entry size keeps it manageable in absolute terms for a
  single-user hearth box.
- **No cap on personality/guide card size** — nothing in the integrator
  prompt or schema enforces a bound on how many `tone`/`traits`/rule entries
  accumulate; the "strengthen by at most one notch, never duplicate" rule is
  the only anti-bloat mechanism, and it's judgment-based (LLM-enforced), not
  code-enforced.
- **Partial-run / mid-write failure handling**:
  - **Observer failures are handled and bounded**: a failed `renderSessionCompact`
    or `observer.observe()` call is caught per-session
    (`scan.ts:63-76`), the session is marked `failed` with an incrementing
    `attempts` counter (`scan.ts:99-114`), retried up to
    `MAX_OBSERVE_ATTEMPTS = 2` (`state.ts:18`), then permanently skipped and
    reported (`report.ts:72-74`). This is solid.
  - **Ledger append is not atomic/transactional** — `appendLedgerEntries`
    (`ledger.ts:26-35`) does a single `fs.appendFile` of all entries for the
    run; on process kill mid-write, a partial line could be left, which the
    tolerant line-parser (`loadLedgerEntries`, lines 42-72) will skip as
    unparseable/corrupt rather than crash — reasonable but silently drops
    that one entry with only a `console.debug` (not surfaced to the run
    report at all).
  - **No transactionality between ledger-append and state-save**: `scan.ts:170-172`
    appends the ledger, *then* saves state, *then* writes the report. If the
    process dies between the ledger append and the state save, the next run
    will treat the session as unsettled and **re-observe it** — the observer
    will re-extract (possibly re-word) the same lesson from the same
    transcript. Whether this creates a duplicate ledger entry depends on
    whether the new pass reproduces the exact same evidence string (hash
    match) — a re-worded quote from the same evidence would **not** be
    caught by `evidenceHash` and would silently double-count recurrence.
  - **No transactionality in the integrator step at all** — it's a single
    freeform 40-turn agent step editing multiple cards and committing at the
    end (Step 6 in the prompt). If the agent is interrupted mid-edit (budget
    cutoff, crash), cards can be left half-edited and uncommitted; the next
    integration run's precheck re-detects `_Pending integration._` reports
    and starts over, likely re-doing (not necessarily identically) whatever
    partial edits were in flight. Recovery is via git status inspection /
    manual intervention, not automated.
- **Idempotency (re-run same state twice)**: `cb retro scan` run twice back
  to back mostly no-ops the second time (no new qualifying sessions;
  `discover` re-filters against `state.json`). `cb procedure run
  process-retrospective` twice: the `scan` step's precheck exits
  `$CHECK_SKIP` on the second run (nothing new since quiescence), and the
  `integrate` step's precheck exits `$CHECK_SKIP` once no report says
  `_Pending integration._`. So the **procedure** is idempotent by design.
  This idempotency, however, depends entirely on `state.json`/report
  finalization surviving between runs — see the re-clone gap above.
- **Catch-up after missed weeks**: works as designed — quiescent qualifying
  sessions simply accumulate until the next run, capped per-run at
  `--max-sessions` (default 20) with explicit overflow reporting
  (`scan.ts:129-130`, `report.ts:71`). No special "missed schedule" handling
  is needed since discovery is state-driven, not calendar-driven — a
  four-week-late run just processes a bigger (capped) backlog.
- **Validation of integrator writes**: relies entirely on the **existing**,
  generic card-validation infrastructure — PostToolUse `cb validate --hook`
  (warns, non-blocking) and the per-box git `pre-commit` hook running
  `cb validate --staged` (blocks the commit) — described in the plan's
  failure-mode table as "existing hook coverage." There is **no
  retro-specific semantic validation** (e.g. nothing programmatically checks
  that the diff didn't touch `speaking-voice` or a `user-stated` entry — that
  policy is stated only in the prompt and checked, if at all, by whatever the
  agent itself chooses to grep in its own `validate` phase instructions,
  which are prose ("the git diff showing only personality/guide/
  question/data/report changes — never speaking-voice...") not an executed
  shell assertion). The `validate` phase's actual **executed** check
  (`process-retrospective.procedure.card:230-237`) only greps for leftover
  `_Pending integration._` markers — it does **not** grep the diff for
  forbidden-field edits, contradicting the design doc's own failure-mode
  table entry ("Integrator edits a user-stated belief or speaking-voice" →
  "chunk-3 validate phase... procedure validate greps the diff for forbidden
  targets" — **this described mitigation is not actually implemented** in
  the shipped validate shell block; only the prose `instructions` field
  mentions it, which is advisory context for a human/agent reader, not an
  enforced check).
- **Audit trail — what's actually recorded**: per-run markdown report
  (`store/reviews/retro/<runId>.md`, committed) with Sessions
  examined/Observations/Actions-taken sections; git trailers
  `Created-By: retrospective` + one `Retro-Run: <runId>` line per drained
  report on the integration commit (no dedicated `RETRO_TRAILER_KEYS`
  vocabulary — reuses the existing `Created-By` connector-axis key from
  `git-trailers.ts:15-21`, so retro commits show up in the existing history
  browser's connector filter for free). This is a genuinely good audit
  surface for the beliefs that get promoted — but it's a narrative summary
  written by the same LLM that made the edits, not an independently
  verifiable trace (no diff-level assertion tying a specific card edit back
  to a specific ledger entry beyond the LLM's own prose).
- **Reversibility**: purely git-native — `git revert` on the integration
  commit, or manual card edits. No retro-specific undo/rollback tooling.
- **Cost controls**: per-session `maxBudgetUsd: 0.25` cap and cheap-tier
  model (`haiku`) for the observer only; the integrator agent step has
  **no `maxBudgetUsd`** set (only `max-turns: 40`) — an unbounded-cost
  integration pass is possible if the model runs long turns, bounded only by
  turn count, not spend.
- **Concurrency**: `lockGroup: "retro"` only serializes this schedule against
  other *scheduled* scripts sharing the group — it does **not** lock against
  an interactive chat session simultaneously editing
  `main.personality.card`. This is an explicitly **accepted, documented
  risk** in the design doc ("Failure modes" preamble): worst case is a git
  commit conflict surfacing in the procedure's validate phase, "loud,
  recoverable." No card-level file locking exists project-wide for this
  (per `CLAUDE.md`, only `src/lib/file-lock.ts`-based locks are sanctioned,
  and no card-write path uses one).

## 7. What else writes memory-like state

- **Direct chat-time card edits (the primary pathway, not retro).**
  Any agent — most commonly the interactive chat agent — can edit
  `config/main.personality.card` or a `config/*.guide.card` directly the
  moment the boxholder states a preference explicitly. This writes
  `source: user-stated` immediately, at `confirmed`/`high` confidence,
  with no recurrence requirement and no procedure involved — retro's
  `source: inferred` pathway exists specifically to catch *implicit*
  signal this explicit pathway misses. Per
  `src/schemas/personality-instructions.ts:77-81` and the parallel guide
  schema, "Evidence model... source (user-stated > feedback > inferred >
  default)" is the shared vocabulary both pathways write into — retro never
  touches `user-stated` entries (§5/§6), only adds/strengthens `inferred`
  ones.
- **`cb feedback`** (`src/cli/commands/feedback.ts`) — a separate, developer/
  agent-facing mechanism: "Record agent observations about CLI friction or
  confusing conventions," writes to `config/feedback/` and commits silently.
  This is about the *tool's* usability (agent-to-maintainer signal), not
  boxholder preferences — a different axis entirely, not a competitor to
  retro's belief-writing.
  - Note: the design doc's "What already exists" section cites a
    `process-guidance` procedure (feedback → `source: feedback` belief
    integration) as an existing precedent this plan mirrors. **That
    procedure no longer exists in the current tree** — `templates/procedures/`
    contains only `process-captures`, `process-pages`,
    `process-retrospective`, `refresh-maps`, `view-card-shape`; no
    `process-guidance.procedure.card` anywhere in the repo. Its cited
    `source: feedback` evidence-model tier is defined in the schema
    (`BeliefSource` still includes `"feedback"`,
    `guide-elements.tsx`) but the writer that plan describes appears to have
    been retired or renamed since the retro plan was written — worth
    flagging if the boxholder's mental model still includes it as a live
    parallel loop.
- **Question cards** (`box/questions/*.question.card`) — the escalation
  sink for anything retro (or any agent) decides needs explicit boxholder
  confirmation rather than a direct write; answering one presumably feeds
  back into a `user-stated` belief via whatever handles question resolution
  (not part of this retro-specific investigation).
- **Briefing `{% correction %}` entries** — authoritative behavior overrides,
  per `src/schemas/briefing.tsx:52-55`; retro is explicitly barred from
  writing these directly (§5) — they only arrive via question-card
  escalation, i.e. boxholder-approved.

---

## Summary of the strongest concrete gaps (for quick reference)

1. Ledger + settled-state are gitignored/box-local — a box re-clone silently
   resets both recurrence history and the duplicate-evidence guard, with no
   detection or warning beyond the ledger-absent branch already coded into
   the integration precheck (which doesn't address the state.json reset).
2. No size/rotation control on the ledger, state file, or report directory —
   unbounded growth by design, mitigated only by small per-entry size.
3. The design doc's claimed "validate phase greps the diff for forbidden
   targets" (user-stated edits, speaking-voice) is **not implemented** in the
   shipped procedure card — the only executed validate check is "no pending
   report markers remain." The forbidden-target policy is prompt-only.
4. The observer's "tool-less" isolation is a system-prompt instruction, not
   an SDK-enforced restriction — `permissionMode: "bypassPermissions"` and no
   `allowedTools`/`disallowedTools` narrowing apply uniformly to every agent
   invocation in the codebase, observer included.
5. No transactional guarantee between ledger-append, state-save, and
   report-write in `scan.ts`, nor within the integrator's own multi-card-edit
   + commit step — a crash mid-run can produce partial state (re-observed
   sessions with re-worded, unhashed-duplicate evidence; half-edited,
   uncommitted card changes on the next integration attempt).
6. Cross-session-recurrence matching ("is this the same belief as that one,
   worded differently") is unimplemented as code — entirely delegated to the
   integrator LLM eyeballing the full ledger dump, by explicit, documented
   design choice ("revisit if the ledger grows enough that the integrator
   misses recurrences").
7. The integrator agent step has no `maxBudgetUsd` cap (only `max-turns: 40`),
   unlike the observer's strict `$0.25`/session ceiling.
