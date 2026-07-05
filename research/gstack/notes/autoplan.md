# /autoplan — auto-review pipeline

A pipeline that takes a rough plan file and runs it through four reviews — CEO → Design → Eng → DX — with intermediate decisions auto-answered by codified principles. Plus, at every phase, runs Claude and Codex side-by-side and reconciles their findings in a consensus table.

> "Rough plan in, fully reviewed plan out."

It's the most ambitious orchestration in gstack. Worth studying for the mechanics even if the whole pipeline is too heavy to adopt.

## What actually happens

```
Phase 0:   Intake (scope detect, restore point, load sub-skills)
Phase 0.5: Codex preflight
Phase 1:   CEO review     → dual voices → consensus
Phase 2:   Design review  → dual voices → consensus    (skipped if no UI scope)
Phase 3:   Eng review     → dual voices → consensus
Phase 3.5: DX review      → dual voices → consensus    (skipped if no DX scope)
Phase 4:   Final approval gate (taste decisions + user challenges + aggregated tasks)
```

The plan file lives on disk; each phase reads it, runs its analysis, writes findings BACK into the plan, and emits a structured tasks JSONL. The aggregator at the end dedupes tasks across phases and renders a single checklist.

## The seven ideas worth keeping

### 1. The 6 Decision Principles (auto-decide rules)

Codified rules that replace user judgment for intermediate questions:

1. **Choose completeness** — pick the approach that covers more edge cases
2. **Boil lakes** — auto-approve scope expansions in blast radius AND <1 day CC effort
3. **Pragmatic** — two options fix the same thing? Pick the cleaner one in 5 seconds
4. **DRY** — duplicates existing functionality? Reject
5. **Explicit over clever** — 10-line obvious fix beats 200-line abstraction
6. **Bias toward action** — merge > review cycles > stale deliberation

Phase-specific tiebreakers: CEO phase favors P1+P2; Eng phase favors P5+P3; Design phase favors P5+P1.

**Worth borrowing.** Codify our own version of "when in doubt, do X" — fewer principles, callback-specific.

### 2. Mechanical / Taste / User Challenge classification

This is the most generalizable idea in autoplan. Every decision is classified:

- **Mechanical** — one clearly right answer → auto-decide silently. (Examples: "run codex?" → always yes. "Run evals?" → always yes.)
- **Taste** — reasonable people could disagree → auto-decide with recommendation, but **surface at final gate.** Three sources: close approaches, borderline scope, Codex disagreements.
- **User Challenge** — both models agree the user's stated direction should change → **NEVER auto-decided.** Surfaced with special framing:
  > **What the user said:** their original direction
  > **What both models recommend:** the change
  > **Why:** the models' reasoning
  > **What context we might be missing:** explicit acknowledgment of blind spots
  > **If we're wrong, the cost is:** what happens if the user was right

  "The user's original direction is the default. The models must make the case for change, not the other way around."

This is excellent. **Both models disagreeing with the user is a qualitatively different decision class than two models disagreeing with each other.** The user has domain context the models lack — taste, timing, relationships. So the framing acknowledges that explicitly. Worth absorbing as a general principle for any AI-in-the-loop workflow.

Security/feasibility exception: if both models flag the user's choice as a security or feasibility risk (not just a preference), the framing is escalated: "Both models believe this is a security/feasibility risk, not just a preference."

### 3. Dual voices + consensus table

Each phase runs **two** independent reviewers and reconciles:

- **Claude subagent** (via Agent tool) — gets NO prior-phase context. Truly independent.
- **Codex** (via `codex exec`) — gets prior-phase consensus summaries so it can build on them.

Outputs a consensus table:
```
Dimension                Claude  Codex  Consensus
Architecture sound?      ✓       ✓      CONFIRMED
Test coverage?           ✓       ✗      DISAGREE → taste decision
Performance risks?       ✓       ✓      CONFIRMED
```

Rules:
- **CONFIRMED** = both agree → take as findings
- **DISAGREE** = surface as a taste decision at the final gate
- **Single critical finding from one voice** = flagged regardless (don't let majority-vote bury an important one-sided finding)
- Missing voice (e.g., Codex timed out) = N/A, never CONFIRMED

**Worth borrowing standalone.** Even without all of autoplan, "run Claude subagent + Codex on a diff and emit a consensus table" is a one-skill mechanic that captures most of the value.

The asymmetric prior-context approach is subtle: independence for the subagent (fresh eyes), context for Codex (efficient narrowing). Different roles in the same dialectic.

### 4. "Auto-decide replaces the user's judgment, not the analysis"

Worth quoting directly:

> Auto-decide replaces the USER'S judgment with the 6 principles. It does NOT replace the ANALYSIS. Every section in the loaded skill files must still be executed at the same depth as the interactive version. The only thing that changes is who answers the AskUserQuestion: you do, using the 6 principles, instead of the user.

Then it spells out anti-shortcuts:
> You MUST still:
> - READ the actual code, diffs, and files each section references
> - PRODUCE every output the section requires (diagrams, tables, registries, artifacts)
> - IDENTIFY every issue the section is designed to catch
> - DECIDE each issue using the 6 principles (instead of asking the user)
> - LOG each decision in the audit trail
> - WRITE all required artifacts to disk
>
> You MUST NOT:
> - Compress a review section into a one-liner table row
> - Write "no issues found" without showing what you examined
> - Skip a section because "it doesn't apply" without stating what you checked and why
> - Produce a summary instead of the required output (e.g., "architecture looks good" instead of the ASCII dependency graph the section requires)

This is fighting a real failure mode: **automated agents collapse "decide" and "analyze" into "skip" when nobody's watching.** The explicit MUST/MUST NOT lists are doing real work here.

### 5. Restore point before destructive AI editing

Before autoplan starts modifying the plan file, it:
1. Dumps the original plan to `~/.gstack/projects/$SLUG/<branch>-autoplan-restore-<timestamp>.md` with re-run instructions baked in
2. Prepends an HTML comment to the plan file: `<!-- /autoplan restore point: [RESTORE_PATH] -->`

So if autoplan goes off the rails, you have a recoverable original. **Generalizable to any "AI rewrites this file in place" workflow.**

### 6. Scope detection by grep + threshold

UI scope: grep the plan for `component, screen, form, button, modal, layout, dashboard, sidebar, nav, dialog`. Require **2+ matches.** Exclude false positives (`page` alone, `UI` in acronyms).

DX scope: grep for `API, endpoint, REST, GraphQL, gRPC, webhook, CLI, command, flag, SDK, library, npm, pip, SKILL.md, MCP, agent, OpenClaw, ...`. 2+ matches OR "product IS a developer tool" OR "AI agent is the primary user."

Used to skip Phase 2 (Design) or Phase 3.5 (DX) entirely when irrelevant.

**Simple-but-effective pattern.** Cheap heuristic instead of asking the user "is this UI-related?"

### 7. Skip-list when one skill loads another

When autoplan loads `plan-ceo-review/SKILL.md`, `plan-eng-review/SKILL.md`, etc., it declares a section skip list — sections of the loaded sub-skill that autoplan already handles:

> When following a loaded skill file, SKIP these sections (they are already handled by /autoplan):
> - Preamble (run first)
> - AskUserQuestion Format
> - Completeness Principle — Boil the Lake
> - Search Before Building
> - Completion Status Protocol
> - Telemetry (run last)
> - ...

So the sub-skill contributes only its unique review methodology. Boilerplate runs once, not four times.

**Worth adopting if we ever compose skills.** Loaded skills should have a clear "common preamble" vs "unique methodology" structure so they're composable.

### Bonus: Tasks aggregator

Each phase writes a JSONL of structured tasks to `~/.gstack/projects/$SLUG/tasks-<phase>-<run>.jsonl`. Each task has: id, priority (P1/P2/P3), component, title, files, effort_human, effort_cc, phase, source_finding.

The aggregator at the end:
- Filters to current branch + recent commits
- Keeps only the latest run_id per phase (handles re-runs cleanly)
- Dedupes by `(component, sorted(files), title)`
- Sorts by priority then phase order
- Renders as a markdown checklist

Nice composable pattern: sub-phases emit structured findings; orchestrator aggregates.

## Cost

This is HEAVY:
- 4 phases × 2 voices = 8 model calls (or 6 if no UI, or 4 if no UI+DX)
- Each phase reads the plan file + referenced code + writes findings back
- Codex timeouts: 10 min per call, shell wrapper at 10:30
- Real wall-clock time: probably 20-40 minutes
- Real money: probably $1-5 per run

For a 1-2 line bug fix this is wildly overkill. It's designed for "I have a multi-day feature plan, review the whole thing before I commit to it."

## Ian's take

Too heavy to engage with right now. It's a whole process, and the shape doesn't obviously match how callback work actually happens. Park it. The component ideas (dual voices, decision taxonomy, restore point) are worth keeping in mind separately, but the pipeline as a whole isn't a fit.

## Adoption candidates (mix-and-match, not wholesale)

In order of likely value-per-effort:

1. **Dual voices + consensus table** — single skill that runs Claude subagent + Codex on the same input, emits a consensus table. Most of autoplan's mechanical value without the orchestration weight. Builds on the /codex port.
2. **Mechanical/Taste/User Challenge classification** — adopt as a thinking framework for any AI-in-the-loop decision, regardless of skills. Especially the User Challenge framing.
3. **Restore point before AI rewrites** — apply to any skill that modifies a file in place.
4. **"Auto-decide replaces judgment, not analysis"** — borrow the MUST/MUST NOT lists as anti-shortcut guardrails.
5. **Decision Principles** — codify our own callback-specific version (probably 3-4 principles, not 6).
6. The full pipeline — only if we ever have callback "plans" of comparable scope.
