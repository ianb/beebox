# Procedures

Procedures are multi-step processes expressed as cards. Each step is a shell command, agent invocation, or model-evaluated instruction. The procedure engine runs steps in order, checks results, and records what happened.

Procedures replace hand-coded TypeScript orchestration with declarative cards that can be inspected, edited, and versioned. The prompts, sequencing, and checks all live in the filesystem.

## Two Halves: Definition and Run

A **procedure definition** lives in `config/procedures/` and describes the steps. It's a template — what _should_ happen, not what _did_ happen.

A **procedure run** is created when the procedure executes. It contains a run card tracking progress and per-step results. Effects land in the normal places (inbox, pool, archive, trash) — the run directory is bookkeeping.

Run directories are a **recent cache, not an archive** — git history retains every committed run, so deleting a run dir loses nothing. Two mechanisms keep `procedure/runs/` small (see [Run Hygiene](#run-hygiene)): no-op runs never persist, and finished runs expire.

```
config/
  procedures/
    process-captures.procedure.card

procedure/
  runs/
    process-captures_2026-02-06T2000/
      run.procedure-run.card
```

## Building Blocks

Every step has three optional phases: **precheck**, **run**, **validate**. All use the same child elements:

- `<shell>` — a bash command, executed in the box root
- `<agent>` — Claude Code invocation with inline prompt
- `<instruction>` — natural language evaluated by a model (pass/fail)
- `<why>` — explanation of purpose for humans, fixing agents, and review models

**Text dedenting:** All text content is automatically dedented, so prompts can be indented naturally within the XML.

## Step Structure

```xml
<step id="transcribe">
<description>Transcribe any audio clips that haven't been processed yet</description>

<precheck>
<shell>
count=$(ls box/inbox/capture-*/*.audio.card 2>/dev/null | wc -l)
if [ "$count" -eq 0 ]; then exit $CHECK_SKIP; fi
echo "Found $count audio clip(s) to transcribe"
</shell>
<why>Nothing to do if no fresh captures are pending</why>
</precheck>

<run>
<agent model="haiku" max-turns="20">
Your agent prompt here...
</agent>
</run>

<validate severity="review">
<shell>
remaining=$(grep -l 'status="new"' box/inbox/capture-*/*.audio.card 2>/dev/null | wc -l)
echo "Untranscribed clips remaining: $remaining"
</shell>
<instruction>
Every audio clip should have either a transcription block or an explicit transcription-error.
</instruction>
</validate>
</step>
```

### Shell Commands

Shell scripts have three outcomes:
- **Exit 0**: success
- **Exit `$CHECK_SKIP`**: skip this step (only meaningful in prechecks)
- **Exit non-zero** (other): failure

The `$CHECK_SKIP` environment variable is set by the engine.

### Agent Invocations

`<agent>` invokes Claude Code with the text as the prompt. The engine prepends a context block with working directory, date, procedure name, and step ID.

Attributes:
- `model` — `haiku`, `sonnet`, or `opus` (default: sonnet)
- `max-turns` — maximum agent turns (default: 20)

### Instructions

`instructions:` is **intended** to be evaluated by a model against the git diff,
but is **not implemented yet** — the engine logs the instruction and treats it as
pass-by-default (`engine-phase.ts`, "instruction checks pass by default" TODO).
Until it's built, do **not** rely on `instructions` to gate anything: put the
real check in `shells:`. Leave `instructions` as human-readable intent only.

### Validation Severity

- `severity="warn"` — log and continue.
- `severity="abort"` — a failing `shells:` check fails the step (and, for a
  `kind: "procedure"` migration, blocks the migration). **This is the only
  severity that actually gates.**
- `severity="review"` — *intended* to re-invoke the agent with the failure
  context, but **not implemented**: it currently downgrades the failure to a
  warning and continues (`engine-phase.ts` TODO). Treat it as `warn` until built;
  for a hard gate use `abort`.

A step is marked `failed` only when a `validate` `shells` check fails **and**
`severity` is `abort`. A failing agent invocation does **not** itself fail the
step (it's logged) — so if you need "the agent must have actually done the work,"
encode that as a `shells` check, don't assume the agent succeeding means the step
did.

### Checklists (opt-in thoroughness)

For a step where you want the agent to work methodically through several items
and leave an auditable trail, use a **checklist** — a convention, not a separate
engine feature:

- Embed the items in the agent prompt as markdown checkboxes (`- [ ]`), and tell
  the agent to maintain a working copy (e.g.
  `config/migration-runs/<name>.checklist.md`), flipping `- [ ]` → `- [x]` only
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

**No-op runs leave nothing behind.** The run dir and card are written to disk at start (the on-disk card is the "procedure is running" signal for `cb tick`'s at-rest gate), but the first git commit is deferred until a step does something non-skip — a precheck pass, a precheck failure, or a step with no run phase. If every executed step skips, the run dir is removed at completion and nothing is committed; the tick's outcome in `scheduler.jsonl` is the provenance. A frequently-scheduled procedure that usually finds nothing to do costs nothing.

**Finished runs expire.** At completion the engine stamps an `expires` attribute on the run card: `completed-at` + 30 days for completed runs, + 90 days for failed runs (failures get investigated late). Procedure cards can override with `run-expiry` / `failed-run-expiry` attributes (`"60d"`, `"12w"`, or `"never"`). Because the expiration lives on the run itself, anyone — agent, human, a future tool — can retain a specific run by editing its card: set `expires="never"` to pin it, or push the date out.

**`cb procedure gc` sweeps expired runs.** Installed by `cb init` as the `gc-procedure-runs` daily schedule. It is deliberately dumb: delete what's past its date. It always keeps the newest run per procedure (`cb procedure status` reads it) and anything still running. Legacy cards without `expires` use the status-based default from their `completed-at`; crashed runs (stuck at `running` with a stale card) expire 90 days after `started-at`.

## CLI

```
cb procedure run <name>       # Start a new run
cb procedure status           # Show current run status
cb procedure list             # List available definitions
cb procedure gc               # Delete expired run directories
```

## Git History

A complete run produces:

```
abc123f Complete procedure: process-captures
abc123e [procedure] Complete step: archive
abc123d Archive session 2026-05-22_kitchen         ← agent commit
abc123c [procedure] Complete step: assemble
abc123b Assemble timeline for 3 clips              ← agent commit
abc123a [procedure] Complete step: describe-images
abc1239 [procedure] Complete step: transcribe
abc1238 Transcribe 3/3 audio clips                 ← agent commit
abc1237 Start procedure: process-captures
```

Rewinding to any commit gives a valid, consistent state.

Skipped steps don't commit — their precheck result is recorded in the run card and rides along in the next commit. A run where every step skips produces no commits at all (see [Run Hygiene](#run-hygiene)).
