# Procedures

Procedures are multi-step processes expressed as cards. Each step is a shell command, agent invocation, or model-evaluated instruction. The procedure engine runs steps in order, checks results, and records what happened.

Procedures replace hand-coded TypeScript orchestration with declarative cards that can be inspected, edited, and versioned. The prompts, sequencing, and checks all live in the filesystem.

## Two Halves: Definition and Run

A **procedure definition** lives in `_config/procedures/` and describes the steps. It's a template — what _should_ happen, not what _did_ happen.

A **procedure run** is created when the procedure executes. It contains a run card tracking progress and per-step results. Effects land in the normal places (inbox, pool, archive, trash) — the run directory is bookkeeping.

Run directories are a **recent cache, not an archive** — git history retains every committed run, so deleting a run dir loses nothing. Two mechanisms keep `_bookkeeping/procedure/runs/` small (see [Run Hygiene](#run-hygiene)): no-op runs never persist, and finished runs expire.

```
_config/
  procedures/
    process-pages.procedure.card

_bookkeeping/
  procedure/
    runs/
      process-pages_2026-02-06T2000/
        run.procedure-run.card
```

## Building Blocks

A procedure definition is a YAML-frontmatter card with a `steps:` list.
Every step has three optional phases: **precheck**, **run**,
**validate**. Each phase uses the same building blocks:

- `shells:` — bash commands, executed in the box root
- `agents:` — Claude Code invocations with inline `prompt:` (plus
  `model:`, `max-turns:`)
- `instructions:` — natural-language success criteria, **model-judged**
  against the step's git diff in a `validate` phase (see
  [Instructions](#instructions)); gate by severity like a `shells:`
  check.
- `whys:` — explanations of purpose for humans, fixing agents, and
  review models

Multi-line text uses YAML block scalars (`|-`/`>-`), so prompts and
scripts read naturally inline.

## Step Structure

Condensed from a real definition
(`templates/procedures/process-pages.procedure.card`):

```yaml
steps:
  - id: intake
    description: Classify and route saved pages
    precheck:
      shells:
        - |-
          count=$(ls _content/inbox/pages-saved/*.record.card 2>/dev/null | wc -l)
          if [ "$count" -eq 0 ]; then exit $CHECK_SKIP; fi
          echo "Found $count page(s) to process"
      whys:
        - No saved pages to process
    run:
      agents:
        - prompt: >-
            Your agent prompt here...
          model: balanced
          max-turns: 30
    validate:
      shells:
        - |-
          remaining=$(ls _content/inbox/pages-saved/*.record.card 2>/dev/null | wc -l)
          questions=$(ls _bookkeeping/questions/intake-*.question.card 2>/dev/null | wc -l)
          [ "$remaining" -eq 0 ] || [ "$questions" -gt 0 ]
      instructions:
        - |-
          Every page should either be routed to a destination, trashed,
          or have a question created asking the user what to do.
      severity: abort
```

### Shell Commands

Shell scripts have three outcomes:
- **Exit 0**: success
- **Exit `$CHECK_SKIP`**: skip this step (only meaningful in prechecks)
- **Exit non-zero** (other): failure

The `$CHECK_SKIP` environment variable is set by the engine.

A failing shell fails its step in every phase — including the **run** phase: a
non-zero run shell fails the step (it does not silently complete) and halts the
procedure, with the exit code and both output streams recorded on the run card's
`run.stdout` so `bbx procedure status` shows why. Multiple `shells:` entries in a
phase run in order and short-circuit on the first failure.

Scripts run under **`set -euo pipefail`** (`shell.ts`): `-e` exits on the first
failing command, `-u` turns a reference to an unset variable (usually a typo'd
name) into a hard error instead of a silent empty expansion, and `pipefail` fails
a pipeline when any stage fails rather than only its last. Use `${VAR:-default}`
for genuinely optional variables.

### Agent Invocations

An `agents:` entry invokes the box's configured agent engine with the text as
the prompt. The engine prepends a context block with working directory, date,
procedure name, and step ID.

Attributes:
- `model` — portable `efficient`, `balanced`, `strong`, or `strongest` tier;
  omitted uses the engine default. Legacy `haiku`, `sonnet`, `opus`, and
  `fable` values remain aliases.
- `max-turns` — maximum agent turns (default: 20)

### Instructions

`instructions:` in a `validate` phase are model-judged. The engine assembles the
instruction(s), the step's git diff (the whole step — every commit the run made,
captured as a `baseline..finalRef` range, not just the last commit), and the
step's `whys:`, and asks a review model (`validate.model`, default `balanced`) for a
structured pass/fail verdict. A failing verdict gates by `severity` exactly like a
failing `shells:` check; the reasoning is recorded in the run card's `validate.review`.
Implementation: `evaluateInstructions` in `engine-validate-model.ts`.

**A judge that never answers is `inconclusive`, not a failure.** If the review
hits its turn cap, times out, or returns nothing parseable, the engine retries
the *judge* once (a fresh session at double the turn cap — never the work
agent, whose work is already done and committed). If the second attempt also
reaches no verdict, the check records `validate.status: inconclusive` with the
concrete reason in `validate.error`, and:

- it does **not** fail the step, at any severity, including `abort` — `abort`
  hard-gates a failing check, and a check that never decided has not failed;
- it does **not** trigger the `severity: review` work-agent retry;
- the run's terminal status becomes `inconclusive` rather than `completed`,
  and `bbx procedure run` exits **3** (`INCONCLUSIVE_EXIT_CODE` — 2 already
  means "migration applied with per-card failures") with one stderr line:
  `Inconclusive: procedure <name> — review of step <id> reached max turns (16); work completed`;
- `bbx procedure resume` on that run reports the same thing: the work is done
  and nothing re-judges it, so resume re-reads the non-verdict from the run
  card and exits the same way rather than saying "completed — nothing to
  resume". `inconclusive` is a terminal run status;
- `bbx migrate` does **not** record a migration whose procedure ended
  inconclusive as applied, and stops the sweep — retiring a migration on an
  unread check is the same misreading one level up;
- the scheduler records the run as `inconclusive` (not a failure: it does not
  increment `consecutiveFailures`, and it does not set `lastSuccess` either),
  and `bbx health` shows `?  <task>  inconclusive`, which does **not** make
  `bbx health` exit 1.

Nothing silently passes: an unjudged step stays visibly unjudged everywhere it
surfaces. Reason tags (`max-turns`, `max-budget`, `timeout`,
`no-structured-output`, `unknown`) live in `src/shared/inconclusive.ts` — a
turn-cap exhaustion is a *budget* problem (a cap set too low, or a judge prompt
that wanders), which is a different fix from a timeout, so they are recorded
distinctly.

Use `instructions:` for judgment a shell can't cheaply make; keep objective,
deterministic checks in `shells:`.

### Validation Severity

Applies to both `shells:` and `instructions:` failures:

- `severity="warn"` — log a completed validation check's negative result and
  continue. If the judge *harness* fails outright (auth/model rejection — no
  assistant response at all), the step fails because validation did not run.
  A judge that ran but reached no verdict is `inconclusive` instead (above).
- `severity="abort"` — fail the step (and, for a `kind: "procedure"` migration,
  block the migration). Hard gate, no retry.
- `severity="review"` — self-heal: re-invoke the run agent with a
  `<validation-failure>` context block (the failure detail + the step's `whys:`)
  and re-validate, up to the engine's retry cap (`MAX_REVIEW_RETRIES`); if it
  still fails, the step fails. Requires **exactly one** run agent (the session to
  resume) — a review phase with zero or multiple agents fails terminally. Retry
  invocations carry a `maxBudgetUsd` ceiling. Implementation: `runAndValidate` in
  `engine-run-phase.ts`.

A step is marked `failed` when a `validate` check fails and `severity` is `abort`,
when a `review` failure exhausts its retries, or when an agent engine fails
without producing a usable assistant response (for example auth or model
rejection). An inconclusive check is not on that list. A started agent turn that ends after partial assistant activity is
still logged without gating by itself. If you need "the agent must have actually
done the work," prove it with a `shells:` check or an `instructions:` verdict;
don't assume the agent finishing means the step did.

### Checklists (opt-in thoroughness)

For a step where you want the agent to work methodically through several items
and leave an auditable trail, use a **checklist** — a convention, not a separate
engine feature:

- Embed the items in the agent prompt as markdown checkboxes (`- [ ]`), and tell
  the agent to maintain a working copy (e.g.
  `_config/migration-runs/<name>.checklist.md`), flipping `- [ ]` → `- [x]` only
  when an item is genuinely done, with a one-line grounded note (cite the file).
- Gate completion in `validate.shells` with a completeness check —
  `test -f "$f" && grep -q '\[x\]' "$f" && ! grep -q '\[ \]' "$f"` — so the step
  can't pass with unfinished items. This *also* gives you safe partial failure:
  an agent that runs out of `max-turns` leaves `[ ]` boxes, the gate blocks
  `completed`, and re-running resumes.
- The checklist forces decomposition and records the agent's path; the **objective**
  `shells` check (does the thing actually work) is still what proves correctness.
  Completeness + objective check together; agent honesty + the committed checklist
  + diff review backstop "is a checked box truthful."

The agent controls traversal — it can reorder and loop back. The working file is
the agent's externalized reasoning, not an engine-tracked state machine.

## Execution Model

For each step:

1. Run precheck → skip/fail/proceed
2. Execute run phase (agent or shell)
3. Ensure git is clean (fallback commit if needed)
4. Record git-ref
5. Run validation
6. Update run card, commit

The engine enforces **git-clean between steps**. Agent steps produce two commits (agent's work + engine bookkeeping). Shell steps produce one.

## Run Hygiene

**No-op runs leave nothing behind.** The run dir and card are written to disk at start (the on-disk card is the "procedure is running" signal for `bbx tick`'s at-rest gate), but the first git commit is deferred until a step does something non-skip — a precheck pass, a precheck failure, or a step with no run phase. If every executed step skips, the run dir is removed at completion and nothing is committed; the tick's outcome in `scheduler.jsonl` is the provenance. A frequently-scheduled procedure that usually finds nothing to do costs nothing.

**Finished runs expire.** At completion the engine stamps an `expires` attribute on the run card: `completed-at` + 30 days for completed runs, + 90 days for failed runs (failures get investigated late). Procedure cards can override with `run-expiry` / `failed-run-expiry` attributes (`"60d"`, `"12w"`, or `"never"`). Because the expiration lives on the run itself, anyone — agent, human, a future tool — can retain a specific run by editing its card: set `expires="never"` to pin it, or push the date out.

**`bbx procedure gc` sweeps expired runs.** Installed by `bbx init` as the `gc-procedure-runs` daily schedule. It is deliberately dumb: delete what's past its date. It always keeps the newest run per procedure (`bbx procedure status` reads it) and anything still running. Legacy cards without `expires` use the status-based default from their `completed-at`; crashed runs (stuck at `running` with a stale card) expire 90 days after `started-at`.

## CLI

```
bbx procedure run <name>       # Start a new run
bbx procedure resume [run-dir] # Resume a failed run from its first incomplete step (defaults to latest)
bbx procedure status           # Show current run status
bbx procedure list             # List available definitions
bbx procedure gc               # Delete expired run directories
```

**Resume** re-runs a failed (or interrupted) run from its first not-yet-completed
step, reusing the existing run dir/card rather than starting over. The resume
point is the first step whose recorded status is neither `completed` nor
`skipped` — i.e. the failed step (execution halts there, so everything after is
still `pending`). Earlier completed/skipped steps are not re-run. The run's
original directive carries over unless `--directive` overrides it. Resuming an
already-completed run is a no-op.

## Git History

A complete run produces:

```
abc123f Complete procedure: process-retrospective
abc123e [procedure] Complete step: integrate
abc123d Integrate 4 observations into personality card   ← agent commit
abc123c [procedure] Complete step: scan
abc123b Scan 3 chat sessions for retro observations       ← agent commit
abc123a Start procedure: process-retrospective
```

Rewinding to any commit gives a valid, consistent state.

Skipped steps don't commit — their precheck result is recorded in the run card and rides along in the next commit. A run where every step skips produces no commits at all (see [Run Hygiene](#run-hygiene)).
