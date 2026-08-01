# Workflow lifecycle and subagent orchestration

**Snapshot date:** 2026-07-30. Companion to [README.md](README.md).

## The lifecycle: plan → work → review → compound

Their stated principle is **"the filesystem is the state machine."** Each phase
reads the previous phase's output from a per-plan namespace directory:

```
.claude/plans/{slug}/
├── plan.md          # the plan AND the execution state
├── interview.md     # brainstorm → plan requirements handoff
├── progress.md      # chronological session log
├── scratchpad.md    # decisions, dead-ends, handoffs
├── research/        # research agent output
├── reviews/         # per-track review output
└── summaries/       # compressed output the orchestrator actually reads
```

### Plans as execution state

The load-bearing idea, and the sharpest contrast with us:

> **Plan checkboxes ARE the state.** No separate JSON state files.

Tasks are `- [ ] [P1-T3][agent] Description`. On completion the checkbox is
ticked *and an inline implementation note is appended in the same edit* —
`- [x] [P1-T3] Add user schema — citext for email, composite index on [user_id, status]`.
Resume is: glob the most recent plan, find the first `- [ ]`, go. Stated reason:
"this survives context compaction; the plan is re-read on resume."

Three artifacts, three jobs, and they're genuinely distinct:

- **plan.md checkboxes** — what's done. Single source of truth, can't drift from
  reality because it *is* the reality.
- **scratchpad.md** — why, and what not to retry. Written by the planning phase
  with `DECISION` entries, appended by the work phase with `DEAD-END` entries and
  a `HANDOFF` block when work stops with blockers outstanding. The work skill
  must read it before implementing ("Step 2 is not optional").
- **progress.md** — a chronological log. The thinnest of the three; largely
  redundant with git history plus the plan's own inline notes, read mainly by
  their `brief` skill to narrate what happened.

Our `callback-box/docs/plans/` holds 25 documents with **zero checkboxes**. Our
plans are design artifacts — `cb-plan` produces a "Stated preferences this plan
trades against" section, which is a different and arguably more valuable thing
than a task ledger. Execution state lives in the conversation and dies with it.
Whether we want to change that is a real fork, filed as a decision (README D1),
not an obvious adoption.

### The brainstorm → plan contract

`interview.md` carries a coverage rubric (6 dimensions × 0–2, sufficient at
≥8/12) and a `Status: COMPLETE | IN_PROGRESS` field. The planning skill checks
exactly one thing — `Status: COMPLETE` — and if it sees it, **skips its own
clarification phase entirely** on the grounds that "the interview IS the
clarification."

The mechanically interesting part isn't the file format, it's the rule pair:
brainstorm is *forbidden* from auto-transitioning into plan ("NEVER
auto-transition… let the user choose"), and plan may skip clarification *only*
because a machine-checkable field says the work was done. That's an actual
inter-skill contract rather than a convention, and it's what makes the handoff
safe to trust.

Also worth noting from the planning skill: it skips research entirely when its
input is a review or investigation file, because "the findings ARE the research."
The justification is measured — a 56-session analysis found the same findings
being rediscovered 3–4 times, wasting ~96K tokens.

## Skills worth harvesting a technique from (not porting)

- **`review` — the anti-noise filter.** Before writing findings, a pass asking
  "would a senior dev dismiss this as noise?", plus a PRE-EXISTING vs NEW split
  scoped to the diff rather than the whole file. Their competitive analysis
  independently names the same idea from another project as the "Carmack filter":
  a meta-gate against the model's tendency to over-recommend.
- **`challenge` — prior-findings dedup across runs.** Before analysing, grep
  previous review output and classify every prior finding as Fixed→SKIP,
  Still-present→PERSISTENT (one line only), New→NEW (full writeup),
  Reintroduced→REGRESSION; present NEW first. Stops a re-run re-litigating the
  same twelve issues at full length. Directly applicable to our `codex` skill,
  which currently has no memory of what it already told us.
- **`verify` — discover the project's verification pipeline, don't hardcode it.**
  Read the manifest to find which tools are actually installed, prefer the
  project's own composite alias, verify the alias works before trusting it. Sound
  idea with nothing for it to do here: `pnpm test` / `pnpm lint` already *are*
  the composite runner.
- **`document` and `investigate` — no-op guards with receipts.** Both open by
  checking whether there's anything to do and exiting if not, each citing a
  specific session that wasted tokens doing the work anyway. `investigate` also
  carries an explicit warning against spawning confirmatory subagents, citing
  ~80K tokens burned spawning four agents to confirm an already-obvious root
  cause. That single line is worth adding to `cb-debug`; the rest of the skill
  duplicates it.
- **`learn-from-fix` — a destination-selection table.** Given a verified lesson,
  an explicit table routes it by scope and durability: package-specific skill →
  project config → project memory → personal config → solutions corpus. Gate:
  persist only a *verified* fix or an explicit rule the user taught; stop without
  writing otherwise. Functionally what our `MEMORY.md` discipline does, with the
  judgment made explicit as a table.

## The subagent roster

26 agents. The Ash/Ecto/Oban/LiveView specialists are domain checklists with a
single skill preload and no transferable structure. Four patterns are worth
attention.

### context-supervisor — compression with a coverage invariant

A Haiku agent (`effort: low`, 10 turns, no Bash, no Agent tool) sitting between
an orchestrator and N workers that each wrote findings to a file. It picks a
compression ratio by total token count, applies caller-supplied keep/compress/
drop priorities, dedupes by matching function names and file paths across files —
and then runs a **mandatory coverage-validation pass: every input file must
appear at least once in the output, or it's flagged as a COVERAGE GAP.**

That invariant is the idea. It's what stops a summariser silently dropping a
worker's entire contribution, which is the characteristic failure of compressing
N reports into one. The orchestrators then read *only* the consolidated summary,
consulting individual files only when a gap is flagged.

Weak points, for honesty: "characters ÷ 4" token estimation, arbitrary round-
number strategy thresholds, and five priority tables baked into the compressor's
own prompt that read more like documented defaults than a real caller-supplied
contract.

### requirements-verifier — the "did we deliver it" gate

The most transferable agent in the repo, and the narrowest. One job: was this
delivered? Never code quality.

- Extracts requirements from an issue body or a plan's `- [x]` items —
  deliberately ignoring `- [ ]` as "deferred by design, not missing."
- Classifies each MET / PARTIAL / UNMET / UNCLEAR against `{file}:{line}`
  evidence only.
- **"Do not fabricate evidence"** — with no citation available, the answer is
  UNCLEAR with evidence `cannot verify from diff`, not a guess.
- Explicit anti-scope-creep: no quality findings, no suggested fixes, and never
  mark a requirement MET on the strength of a commit message or branch name.

The reason this earns a separate agent rather than a review checklist: an agent
can write clean, well-tested, well-reviewed code that silently drops half the
acceptance criteria, and every quality-shaped review will pass it. Our
`.claude/agents/finish.md` reconciles plan docs (step 6) and closes resolved
issues (step 7b) but never asks whether the plan's stated scope actually landed.

### codex-reviewer — cross-model review as a graph node

A deliberately dumb Haiku bridge: preflight the CLI, one `codex exec review`
call, parse its output bullets, normalise priorities to BLOCKER/WARNING/
SUGGESTION, tag `[codex]`, mark findings outside the diff as PRE-EXISTING. Its
iron law is **"findings pass through verbatim — never editorialize or filter"**,
because filtering is the orchestrator's job downstream.

Two things ours doesn't do. It's spawned *first* in the review fan-out because
it's the slowest track, so its 1–5 minutes overlap with the Claude-side reviews
rather than serialising after them. And findings flagged by **both** codex and a
Claude reviewer are marked HIGH CONFIDENCE and explicitly never dropped as
duplicates — agreement between two different models is treated as signal rather
than redundancy. Our `codex` skill is a standalone manual pass whose findings are
never cross-referenced against anything (README B4).

### Depth-budget preflight and topology collapse

They document that `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` defaults changed
across point releases, and their deepest chain is depth 3. Rather than failing
when the budget is smaller, orchestrators **collapse the topology**: run the same
state machine inline in the main session, spawn only leaf workers, preserve every
decision, artifact, gate and retry limit. The rule is applied consistently down
to leaf prompts — one nested track is explicitly told to apply trace procedures
directly rather than spawn an agent that would itself fan out.

The specific version thresholds are brittle and unverifiable from a checkout.
The *pattern* — preflight the budget, degrade by flattening rather than failing,
and never tell the user to set an environment variable to make your feature work
— is the right shape for any orchestrator-of-orchestrators. We don't have one
yet, so this is a note for when we do, not a task.

## Frontmatter conventions

Their cost tiering is real and consistently applied: Haiku for mechanical work
(compression, web fetch, command wrapping, the codex bridge), Sonnet for
analytical specialists, Opus for exactly four agents — security analysis and
top-of-tree orchestration. Turn budgets scale with role, 10 to 60. Several worker
prompts build "write partial output by turn ~12, don't wait until the end"
discipline around their own budget, which is a good defensive move given
`maxTurns` is a hard stop.

Two things to flag rather than copy:

- `permissionMode: bypassPermissions` is set on **all 30 agents**, including ones
  with Bash. Defensible for a batch flow; an aggressive default for a distributed
  third-party plugin, and a design choice rather than a requirement. Our `finish`
  agent is deliberately narrower.
- Two of their debugging agents still spawn `general-purpose` subagents with
  ad-hoc prompt text, which their *own* later commentary calls a stale workaround
  they migrated away from elsewhere ("spawn the REAL specialist agents directly…
  do NOT use general-purpose impersonation"). If we adopt a fan-out pattern, give
  tracks typed agents from the start rather than inheriting their inconsistency.

## Dispositions

Covered in README: `requirements-verifier` → adopt (A3); fan-out compression with
the coverage invariant → adapt (B2); codex consensus-boosting → adapt (B4);
plans-as-execution-state → decide (D1); `triage` and `brief` → later; the
compound/recall corpus and the investigate/audit/techdebt/review/challenge skills
→ reject (R1, R2).
