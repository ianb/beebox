---
name: cross-model
description: Get an independent review from the other model family for a plan, branch diff, or adversarial failure analysis. Use when requested and whenever root guidance requires cross-model review for work larger than a small bug fix.
allowed-tools: Bash, Read, Grep, Glob
---

# Cross-model review

## Rules

- **Other family only.** Claude drivers (Fable, Opus) use `--engine codex`;
  Codex drivers (Astra, Sol) use `--engine claude`. Choose by family, not tier.
  If the other family cannot run, report the blocker; never substitute a
  same-family review.
- **The reviewer is read-only evidence, not authority.** Verify each actionable
  claim against the source before you act on it or report it. Separate real
  defects from scope opinions and noise.
- **Send a blind brief.** Give the target, scope, and human requirements. Omit
  your own conclusions, fixes you consider settled, and expected answers.
- **Bounded rounds.** Round 1 is the full review. Round 2 verifies the fixes and
  accepts fresh findings. After that, run verification only: name the found
  problems, ask whether the fixes hold, and tell the reviewer not to hunt for new
  ones. Stop at 3-5 rounds in total. Residual risks go to the human as
  accept-or-fix decisions, never silently fixed.
- **An adversarial reviewer never says "clean".** Its "not fit" verdict does
  not stop the work; the human's risk judgment does.
- **Name the engine and model** (for example `codex gpt-6-sol`) wherever you
  report the review.
- Presumptively reject mid-operation I/O-failure windows in one-shot operator
  tools, exotic input encodings, and attacker-is-the-owner scenarios.
- Done means: findings adjudicated against the human's request, verified
  in-scope defects fixed and rechecked, remaining risks surfaced.

## Select the mode

| Mode | Trigger | Target and purpose |
|---|---|---|
| **plan** | `plan [name]` | Read the plan in `docs/plans/` and verify its approach and source claims. |
| **review** | `review [focus]` | Review the current branch diff for correctness. |
| **challenge** | `challenge [focus]` | Find production failure modes in a diff or plan. |

With no argument: use plan mode if a plan was written or edited this session;
otherwise, if there is a diff against `main`, ask review or challenge. A focus
narrows investigation; it does not narrow the originating requirements.

## Write the prompt

Point at in-repo plans, briefs, and diff files; do not paste their contents.
For a diff, write `git diff main...HEAD > scratch/cross-model/review.diff`
(add working-tree changes when they are part of the work) and name that file.

1. **Boundary (Codex reviewer only).** Start with: "Do not read or execute
   files under `~/.claude/`, `~/.agents/`, or `.claude/skills/` unless the
   read-list names specific skill files. Repo docs and `.claude/rules/` are
   allowed for verifying claims within the review scope."
2. **Orientation.** The reviewer runs at the worktree root. Say which paths are
   subproject-relative: for a beebox target, `src/`, `docs/`, and `test/` mean
   `beebox/...`; `bin/` is at the monorepo root.
3. **Scope.** A read-list, pre-verified facts that need no recheck, and a
   findings cap. For diffs, name first-hop files and allow only directly
   relevant call sites, sibling paths, and shared-state owners. Require the
   reviewer to name every extra file it opened.
4. **Authority.** Include in every mode; quote decisive human wording, or label
   a faithful paraphrase:

```text
Review authority (highest to lowest):
- Direct human requirements/decisions: <wording, labeled paraphrase, or none available>
- Originating issue or brief: <repo path or none available>
- Plan under review or being implemented: <repo path or none available>

Direct human requirements and later decisions outrank issue proposals, plan
prose, inferred intent, and implementation choices. Report any contradiction.
Do not promote optional issue/plan ideas into requirements.
```

5. **Evidence.** Spot-check `file:line` citations and claims such as "we already
   do X", "free reuse", and "validation catches it". Ask for ranked, concrete
   findings without padding.
6. **Mode instructions** from below. In diff prompts, put the required diff
   moves after the authority block and before the findings cap.

**Required in every review and diff challenge**, attached to the changed logic:

```text
- For new or changed logic, choose at least one concrete input or state and
  trace it through the relevant code. Look especially for a wrong value,
  label, state, or side effect that does not throw or otherwise announce itself.
- When the change claims a durable bug fix, reconstruct the original failing
  sequence and the invariant the fix must establish. Inspect relevant sibling
  paths and shared state transitions. Call the fix inadequate only when source
  evidence shows the authorized failure remains reachable; report an adjacent
  reachable failure as its own finding.
- For each material finding, identify the smallest honest remedy. If it would
  add durable state, a schema change, background/retry/persistence machinery,
  a new subsystem, or a product decision, label it `human decision required`.
```

**Plan mode:** "You are an independent, adversarial engineering and design
reviewer from a different model family. Read docs/plans/<name>.md, then the
source it cites. Review in priority: (1) wrong problem or over-engineering:
the minimal version, what to cut; (2) architecture flaws; (3) silent failure
modes (no test, no handling, invisible); (4) things treated as settled that
will bite in implementation; (5) incorrect or unverifiable citations. Cite plan
section and file:line. Rank by impact. End with the single most important
change."

**Challenge mode:** add "Your job is to find ways this will fail in production.
Think like an attacker and a chaos engineer: edge cases, races, resource leaks,
silent data corruption. No compliments, just the problems."

## Run it

If you wrote or delegated the change, write a CODING_FEEDBACK entry before
sending its diff: pipe your answers to the four prompts (`bin/coding-feedback
help`) into `bin/coding-feedback add --checkpoint implemented`. A review-only
session skips it.

Write the prompt to `scratch/cross-model/<name>.prompt.md`, then run it as a
background shell command and wait for its completion notice (a review outlasts
the shell tool's 10-minute foreground limit):

```bash
bin/cross-model-run --engine codex --prompt-file scratch/cross-model/<name>.prompt.md
```

It runs the reviewer read-only at `--effort high` (default models `gpt-6-sol`
and `claude-opus-5-5`) and prints the saved answer path and the final answer. Use `--model fable` (Claude) for plan mode and `--model
gpt-6-astra` (Codex) for a hard plan or a disputed finding; honor a human's
model override within the family. `--help` lists `--out`, `--cwd`, and `--timeout` (default 30 min).
A tool that yields a session handle has not finished: poll it to an exit code.
A nonzero exit (127 missing engine, 124 timeout, 1 failure or empty answer)
prints the raw-log tail; report it. If a Codex model stalls, retry once with an
older model the account allows before reporting. Stop only the exact orphaned
reviewer PID; `pkill -f codex` also kills Codex.app and sibling sessions.

## Report

After adjudicating a diff review, write a second CODING_FEEDBACK entry the same
way with `--checkpoint review-adjudicated`.

Validating other work: lead with the work outcome; mention the review only for
a material change, an unresolved risk, or a decision the human may override. No
transcript, no second conclusion.

When the review is the deliverable: give a concise ranked summary in your own
words, then your adjudication. Quote the reviewer only where exact wording
matters; raw output is opt-in. Never comment on the review's worth.
