/**
 * The static procedures reference doc for agents.
 *
 * A single large markdown template — split into two halves so neither
 * function exceeds the max-lines-per-function limit, then concatenated.
 */

function procedureGuideOverview(): string {
  return `# Procedures

Procedures are multi-step processes defined as XML cards. The procedure engine runs each step in order, checking preconditions, executing actions, and validating results. Everything is tracked in git.

## Running Procedures

\`\`\`bash
cb procedure run process-captures                   # Run by name
cb procedure run config/procedures/my.procedure.card  # Run by path
cb procedure run process-captures --step transcribe # Run one step only
cb procedure run process-captures --dry-run         # Preview steps
cb procedure run process-captures --directive "skip the music clips"  # Pass directive
cb procedure list                                   # List available procedures
cb procedure status                                 # Show latest run status
cb procedure gc                                     # Delete expired run dirs
\`\`\`

Procedure definitions live in \`config/procedures/\`. Each run creates a tracking card in \`procedure/runs/<name>_<timestamp>/\`. Run dirs are a recent cache, not an archive: a run where every step skips is removed at completion, and finished runs get an \`expires\` stamp (30d completed / 90d failed, or the procedure card's \`run-expiry\`/\`failed-run-expiry\` override) that \`cb procedure gc\` enforces daily. Git history retains every committed run. To pin a specific run, set \`expires="never"\` on its run card.

## Directives

A **directive** is an opaque runtime string passed when invoking a procedure. It appears as \`<directive>...</directive>\` in every agent's system prompt within the procedure, allowing callers to customize behavior without modifying the procedure card.

\`\`\`bash
cb procedure run process-captures --directive "Only process today's session"
\`\`\`

The directive is also recorded as the \`directive\` field on the procedure-run card for auditability. Step prompts can reference "the Directive" to act on it.

## Procedures in Jobs

Job cards can trigger a procedure directly using the \`<procedure>\` element:

\`\`\`xml
<some-job-type>
<procedure ref="process-captures">
<directive>Focus on the meeting recordings</directive>
</procedure>
</some-job-type>
\`\`\`

The reactor detects \`<procedure ref="...">\` in job cards and runs the procedure engine directly — no nested agent session is needed. The job is automatically finished when the procedure completes. If the procedure fails, the job remains for retry.

## How Steps Work

Each step has three optional phases:

1. **Precheck** — Should this step run? Shell script that exits 0 (proceed), \`$CHECK_SKIP\` (skip), or non-zero (fail).
2. **Run** — The main action: a shell command or an agent invocation.
3. **Validate** — Did it work? Shell check + optional model evaluation.

The engine enforces a clean git state between steps. Every step's work is committed before the next step begins.

## Procedure Card Structure

\`\`\`xml
<procedure name="my-procedure">
<description>What this procedure does</description>
<step id="first-step">
<description>Human-readable description of this step</description>
<precheck>
<shell>
# Exit 0 to proceed, exit $CHECK_SKIP to skip
count=$(ls box/inbox/*.card 2>/dev/null | wc -l)
if [ "$count" -eq 0 ]; then exit $CHECK_SKIP; fi
echo "Found $count items"
</shell>
<why>Explanation of when/why this step should be skipped</why>
</precheck>
<run>
<agent model="haiku" max-turns="20">
Agent prompt goes here. The engine prepends context
(date, procedure name, step ID, working directory).
</agent>
</run>
<validate severity="review">
<shell>
# Exit 0 = pass, non-zero = fail
remaining=$(ls box/inbox/*.card 2>/dev/null | wc -l)
echo "Remaining: $remaining"
[ "$remaining" -eq 0 ]
</shell>
<instruction>
Natural language description of what success looks like.
A model evaluates the git diff against this instruction.
</instruction>
<why>Why this validation matters</why>
</validate>
</step>
</procedure>
\`\`\`
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

\`\`\`xml
<agent model="haiku" max-turns="25">
Prompt text here...
</agent>
\`\`\`

- \`model\`: \`haiku\` (fast/cheap), \`sonnet\` (balanced), \`opus\` (most capable). Default: sonnet.
- \`max-turns\`: Maximum tool-use rounds. Default: 20.
- The engine injects a context block with the date, run card path, step ID, and procedure source location.
- Agent text is automatically dedented, so indent freely within the XML.

### Passing Precheck Data to Agents

Add \`pass-output="true"\` to a precheck to include its stdout in the agent's context:

\`\`\`xml
<precheck pass-output="true">
<shell>echo "Items to process: 5"</shell>
</precheck>
\`\`\`

The agent sees this as a \`<precheck>\` block in its system prompt. Use this to avoid redundant work — the precheck can compute a manifest that the agent acts on.

### Validation Severity

- \`severity="warn"\` — Log the failure and continue
- \`severity="review"\` — A model evaluates the git diff against the \`<instruction>\`. If it fails, the agent gets one retry attempt.
- \`severity="abort"\` — Stop the procedure immediately

### Why Elements

\`<why>\` elements explain the purpose of a phase. They're shown to:
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
diff config/procedures/process-captures.procedure.card config/_template-updates/procedures/process-captures.procedure.card
\`\`\`

After merging, delete the file under \`config/_template-updates/procedures/\`. The next \`cb init\` will see your merged version as the current copy.

## Git History

A complete procedure run produces commits like:

\`\`\`
abc123f Complete procedure: process-captures
abc123e [procedure] Complete step: archive
abc123d Archive session 2026-05-22_kitchen           ← agent commit
abc123c [procedure] Complete step: assemble
abc123b Assemble timeline for 3 clips                ← agent commit
abc123a [procedure] Complete step: describe-images
abc1239 [procedure] Complete step: transcribe
abc1238 Transcribe 3/3 audio clips                   ← agent commit
abc1237 Start procedure: process-captures
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
