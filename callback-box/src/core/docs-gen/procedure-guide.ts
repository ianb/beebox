/**
 * The static procedures reference doc for agents.
 *
 * A single large markdown template — split into two halves so neither
 * function exceeds the max-lines-per-function limit, then concatenated.
 */

function procedureGuideOverview(): string {
  return `# Procedures

Procedures are multi-step processes defined as YAML-frontmatter cards. The procedure engine runs each step in order, checking preconditions, executing actions, and validating results. Everything is tracked in git.

## Running Procedures

\`\`\`bash
cb procedure run process-pages                   # Run by name
cb procedure run config/procedures/my.procedure.card  # Run by path
cb procedure run process-pages --step intake     # Run one step only
cb procedure run process-pages --dry-run         # Preview steps
cb procedure run process-pages --directive "prefer the reading list over trashing"  # Pass directive
cb procedure list                                   # List available procedures
cb procedure status                                 # Show latest run status
cb procedure gc                                     # Delete expired run dirs
\`\`\`

Procedure definitions live in \`config/procedures/\`. Each run creates a tracking card in \`procedure/runs/<name>_<timestamp>/\`. Run dirs are a recent cache, not an archive: a run where every step skips is removed at completion, and finished runs get an \`expires\` stamp (30d completed / 90d failed, or the procedure card's \`run-expiry\`/\`failed-run-expiry\` override) that \`cb procedure gc\` enforces daily. Git history retains every committed run. To pin a specific run, set \`expires: never\` on its run card.

## Directives

A **directive** is an opaque runtime string passed when invoking a procedure. It appears as \`<directive>...</directive>\` in every agent's system prompt within the procedure, allowing callers to customize behavior without modifying the procedure card.

\`\`\`bash
cb procedure run process-pages --directive "Only process today's pages"
\`\`\`

The directive is also recorded as the \`directive\` field on the procedure-run card for auditability. Step prompts can reference "the Directive" to act on it.

## How Steps Work

Each step has three optional phases:

1. **Precheck** — Should this step run? Shell script that exits 0 (proceed), \`$CHECK_SKIP\` (skip), or non-zero (fail).
2. **Run** — The main action: a shell command or an agent invocation.
3. **Validate** — Did it work? Shell check + optional model evaluation.

The engine enforces a clean git state between steps. Every step's work is committed before the next step begins.

## Procedure Card Structure

\`\`\`yaml
---
name: my-procedure
description: What this procedure does
steps:
  - id: first-step
    description: Human-readable description of this step
    precheck:
      shells:
        - |
          # Exit 0 to proceed, exit $CHECK_SKIP to skip
          count=$(ls box/inbox/*.card 2>/dev/null | wc -l)
          if [ "$count" -eq 0 ]; then exit $CHECK_SKIP; fi
          echo "Found $count items"
      whys:
        - Explanation of when/why this step should be skipped
    run:
      agents:
        - model: haiku
          max-turns: 20
          prompt: |
            Agent prompt goes here. The engine prepends context
            (date, procedure name, step ID, working directory).
    validate:
      severity: abort   # warn | abort | review (see Validation Severity)
      shells:
        - |
          # Exit 0 = pass, non-zero = fail (objective gate).
          remaining=$(ls box/inbox/*.card 2>/dev/null | wc -l)
          echo "Remaining: $remaining"
          [ "$remaining" -eq 0 ]
      instructions:
        - |
          Natural-language success criterion, model-judged against the
          step's git diff. Gates by severity like a shells check. Use for
          judgment a shell can't make; keep objective checks in shells.
      whys:
        - Why this validation matters
---
\`\`\`

Each phase (\`precheck\`/\`run\`/\`validate\`) groups its actions by kind: \`shells\`, \`agents\`, \`instructions\`, \`whys\` — each a list. Use YAML block scalars (\`|\`) for multi-line scripts and prompts.
`;
}

function procedureGuideDetails(): string {
  return `## Building Blocks

### Shell Commands

Shell scripts run in the box root via \`bash -c\`. Three outcomes:
- **Exit 0**: success
- **Exit \`$CHECK_SKIP\`**: skip this step (prechecks only)
- **Other exit code**: failure

**Important:** macOS ships bash 3.2. Avoid bash 4+ features like \`declare -A\` (associative arrays). Use \`shopt -s nullglob\` instead of \`for f in glob 2>/dev/null\`.

### Agent Invocations

\`\`\`yaml
agents:
  - model: haiku
    max-turns: 25
    prompt: |
      Prompt text here...
\`\`\`

- \`model\`: \`haiku\` (fast/cheap), \`sonnet\` (balanced), \`opus\` (most capable). Default: sonnet.
- \`max-turns\`: Maximum tool-use rounds. Default: 20.
- The engine injects a context block with the date, run card path, step ID, and procedure source location.
- Use a YAML block scalar (\`|\`) for the prompt so indentation is preserved.

### Instruction Checks (model-judged)

\`instructions:\` in a \`validate\` phase are natural-language success criteria that a
review model judges against the **step's git diff** (the whole step — every commit
the run made — not just the last one), with the step's \`whys:\` as context. The
verdict gates by \`severity\` exactly like a \`shells:\` check. \`validate.model\`
(haiku/sonnet/opus, default sonnet) picks the judge tier. If the model can't return
a verdict, the check fails closed (a check you think gates never silently passes).

Use \`instructions:\` for judgment a shell can't cheaply make ("the summary actually
reflects the source"); keep objective, deterministic checks in \`shells:\`.

### Passing Precheck Data to Agents

Add \`pass-output: true\` to a precheck to include its stdout in the agent's context:

\`\`\`yaml
precheck:
  pass-output: true
  shells:
    - echo "Items to process: 5"
\`\`\`

The agent sees this as a \`<precheck>\` block in its system prompt. Use this to avoid redundant work — the precheck can compute a manifest that the agent acts on.

### Validation Severity

Applies to both \`shells:\` and \`instructions:\` failures:

- \`severity="warn"\` — Log the failure and continue.
- \`severity="abort"\` — Fail the step (and, for a procedure-kind migration, block the migration). Hard gate, no retry.
- \`severity="review"\` — Self-heal: re-invoke the run agent with a \`<validation-failure>\` context block (the failure detail + the step's \`whys:\`) and re-validate, up to the engine's retry cap; if it still fails, the step fails. Requires **exactly one** run agent (the session to resume) — a review phase with zero or multiple agents fails terminally instead.

**A failing \`agents\` invocation does not by itself fail the step** (it's logged). "The agent must have actually done the work" has to be proven by a \`shells\` check or an \`instructions\` verdict — never assume the agent finishing means the step succeeded.

### Checklists (opt-in thoroughness)

When a step has the agent work through several items and you want an auditable trail, use a **checklist** — a convention, not an engine feature:

- Have the agent maintain a working file (e.g. \`config/migration-runs/<name>.checklist.md\`) of markdown checkboxes (\`- [ ]\`), flipping to \`- [x]\` only when an item is genuinely done, with a one-line grounded note (cite the file changed).
- Gate it in \`validate.shells\` with a completeness check so the step can't pass with unfinished items:
  \`\`\`bash
  f="config/migration-runs/my.checklist.md"
  test -f "$f" && grep -q '\\[x\\]' "$f" && ! grep -q '\\[ \\]' "$f"
  \`\`\`
- This also gives safe partial failure: an agent that runs out of \`max-turns\` leaves \`[ ]\` boxes, the gate blocks completion, and re-running resumes. The checklist forces decomposition and records the path; the **objective** \`shells\` check (does the thing actually work) is still what proves correctness.

### Why Entries

\`whys\` entries explain the purpose of a phase. They're shown to:
- Humans reading the procedure
- Review models evaluating validation failures
- Agents retrying failed steps

## Writing a New Procedure

1. Create \`config/procedures/my-procedure.procedure.card\`
2. Define steps with prechecks that skip gracefully when there's nothing to do
3. Use \`cb procedure run my-procedure --dry-run\` to verify the structure
4. Test step-by-step with \`--step <id>\`

### Tips

- **Prechecks should be fast.** They run every time. Don't do expensive work in prechecks — save that for the run phase.
- **One concern per step.** Each step should do one thing. If a step needs 40+ agent turns, consider splitting it.
- **Idempotent steps.** If a procedure is interrupted, it may be re-run. Steps should handle partial state gracefully.
- **Commit messages matter.** Agents should commit with descriptive messages. The git history IS the audit trail.
- **Use \`cb mv\` not \`mv\`.** Card moves update cross-references. Agents in procedure steps should use \`cb mv\` for cards.

### Agent Prompt Guidelines

Agent prompts in procedures should:
- Start with a clear role statement ("You are triaging inbox items...")
- List concrete steps (STEP 1, STEP 2, etc.)
- Include exact shell/command examples the agent can copy
- Include a commit step marked "REQUIRED — do not skip" with the expected message format
- End with "GIT: Do NOT add Co-Authored-By to commits."

**Important:** If an agent doesn't commit, the engine creates a fallback commit with a generic message (tagged \`Commit-Source: procedure-fallback\`). Always instruct agents to commit explicitly so the git history is meaningful.

## System Procedures and Migration

Procedure cards in \`config/procedures/\` are installed by \`cb init\` from built-in templates. If you edit a system procedure, your changes are preserved:

- **\`cb init\` on a fresh box**: Templates are copied directly.
- **\`cb init\` on an existing box (unchanged procedures)**: Templates are updated in place.
- **\`cb init\` on an existing box (modified procedures)**: The new template is parked under \`config/_template-updates/procedures/<name>.procedure.card\` so you can diff and merge manually. The active file at \`config/procedures/<name>.procedure.card\` is left untouched.

To check for updates:
\`\`\`bash
ls config/_template-updates/procedures/
# If any exist, compare with the main version and merge changes
diff config/procedures/process-pages.procedure.card config/_template-updates/procedures/process-pages.procedure.card
\`\`\`

After merging, delete the file under \`config/_template-updates/procedures/\`. The next \`cb init\` will see your merged version as the current copy.

## Git History

A complete procedure run produces commits like:

\`\`\`
abc123f Complete procedure: process-retrospective
abc123e [procedure] Complete step: integrate
abc123d Integrate 4 observations into personality card   ← agent commit
abc123c [procedure] Complete step: scan
abc123b Scan 3 chat sessions for retro observations       ← agent commit
abc123a Start procedure: process-retrospective
\`\`\`

Each commit represents a clean, consistent state. You can \`git reset --hard\` to any commit to get a valid snapshot.
`;
}

/**
 * Generate the procedures guide for agents.
 */
export function generateProcedureGuide(): string {
  return procedureGuideOverview() + "\n" + procedureGuideDetails();
}
