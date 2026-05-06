/**
 * Process-feedback command - Single-pass guide revision from all feedback.
 *
 * This command processes ALL accumulated feedback and updates the news guide:
 * 1. Finds all briefs in store/archive/briefs/ missing the guide-revision attr
 * 2. Collects feedback from each brief:
 *    - overall-rating, selected-reactions attrs
 *    - user-feedback attrs on sections/expandos
 *    - <user-comment> elements (integrated voice/text feedback)
 *    - <curation> section (what experiments were tested)
 * 3. Presents all feedback to the agent for unified guide revision
 * 4. Marks processed briefs with guide-revision="timestamp"
 *
 * This replaces the old per-card processing with a single-pass approach
 * that sees all feedback together for better context.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { createAgent, ensureAgentCommitted, captureBaseline, type Agent } from "../agent.js";
import { acquireLock, releaseLock, getLockInfo } from "../../cli/lib/lock.js";
import { fmt } from "../../cli/lib/format.js";

/**
 * Arguments for the process-feedback command.
 */
export interface ProcessFeedbackArgs {
  /** Show what would happen without doing it */
  dryRun?: boolean;
  /** Force even if another process is running */
  force?: boolean;
  /** Injected agent — if not provided, creates a real Claude agent. */
  agent?: Agent;
}

/**
 * Get briefs that haven't been processed for guide revision.
 * These are briefs in store/archive/briefs/ without a guide-revision attr.
 */
async function getUnprocessedBriefs(boxRoot: string): Promise<string[]> {
  const dir = path.join(boxRoot, "store/archive/briefs");
  try {
    const files = await fs.readdir(dir);
    const briefFiles = files.filter((f) => f.endsWith(".news-brief.card"));

    const unprocessed: string[] = [];
    for (const file of briefFiles) {
      const filePath = path.join(dir, file);
      const content = await fs.readFile(filePath, "utf-8");

      // Check if it has a guide-revision attr (already processed)
      if (!content.includes("guide-revision=")) {
        unprocessed.push(path.join("store/archive/briefs", file));
      }
    }

    return unprocessed;
  } catch {
    return [];
  }
}

/**
 * Build the system prompt for guide revision.
 */
function buildGuideRevisionPrompt(boxRoot: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const timestamp = new Date().toISOString();

  return `You are revising the news guide based on accumulated reader feedback in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
Process feedback from all unprocessed briefs and update the guide in a single pass.

OVERVIEW:
1. Read the current guide
2. Read each unprocessed brief and extract all feedback
3. Synthesize all feedback together
4. Update the guide based on the complete picture
5. Mark each processed brief with guide-revision="${timestamp}"

STEP 1 - READ THE GUIDE:
\`\`\`
cat config/news.guide.card
\`\`\`
Understand current triage rules, actions, experiments, and their confidence levels.

STEP 2 - READ EACH BRIEF AND EXTRACT FEEDBACK:
For each brief provided, read it and note:

**Root-level attrs:**
- overall-rating="great|ok|meh" - User's overall impression
- selected-reactions="id1,id2" - Reactions user selected (comma-separated)
- read-at - When they finished reading

**Section/expando attrs:**
- user-feedback="thumbs-up" or "thumbs-down" on each section/expando

**User comments:**
- <user-comment> elements contain transcribed voice/text feedback
- Note which section/expando they're attached to

**Curation section:**
- <interest> refs show what interests were featured
- <experiment-ref> shows which experiments were being tested
- <hypothesis> elements show specific claims being tested

STEP 3 - SYNTHESIZE ALL FEEDBACK:
Look at the complete picture across ALL briefs:
- Patterns in thumbs up/down across topics
- Overall ratings and what they correlate with
- Explicit user comments explaining their reactions
- Which experiments got positive vs negative signals

STEP 4 - UPDATE THE GUIDE:
Based on the synthesis:

**Triage rules:**
- Thumbs up on a section → increase confidence on related rules
- Thumbs down → add Skip rules or decrease confidence
- User comments mentioning topics → evidence for rule adjustments
- Adjust confidence levels: hypothesis → low → medium → high → confirmed

**Actions:**
- Adjust action instructions based on feedback patterns
- "Missing context" → update Write Brief instructions
- "Too long" / "Too shallow" → update depth/structure in action instructions

**Experiments:**
- Add <observation> elements for each piece of evidence
- If experiment has clear positive signal → mark "successful"
- If experiment has clear negative signal → mark "unsuccessful" and create replacement
- If mixed signals → keep "active" and note the observations

**Create new experiments:**
Keep 1-3 active/proposed experiments. Ideas:
- Test refinements based on what was learned
- Explore adjacent interests
- Try different presentation approaches

STEP 5 - MARK BRIEFS AS PROCESSED:
For each brief you processed, add the guide-revision attr to the root <news-brief> element.

You can edit each brief to add the attribute. For example, change:
\`\`\`xml
<news-brief overall-rating="ok" read-at="...">
\`\`\`
to:
\`\`\`xml
<news-brief overall-rating="ok" read-at="..." guide-revision="${timestamp}">
\`\`\`

CONFIDENCE LEVEL GUIDE:
- hypothesis → low: First signal of interest
- low → medium: Consistent pattern (2-3 signals)
- medium → high: Strong evidence (multiple confirmations)
- high → confirmed: User directly stated preference

EXAMPLE GUIDE UPDATES:

Adding an observation to an experiment:
\`\`\`xml
<experiment id="exp-3" status="successful">
  <hypothesis>Security research as software puzzles</hypothesis>
  <approach>Feature security investigations focusing on methodology</approach>
  <observation ref="/store/archive/briefs/2026-02-03_security.news-brief.card" date="${today}">
    Thumbs up on multi-agent expando, overall rating "ok" - methodology focus worked
  </observation>
  <conclusion>Security investigation narratives engage when focused on the puzzle aspect</conclusion>
</experiment>
\`\`\`

Increasing confidence on a triage rule based on feedback:
\`\`\`xml
<rule confidence="medium" source="feedback"
      ref="/store/archive/briefs/2026-02-03_security.news-brief.card">
  AI and machine learning tools — prioritize these
</rule>
\`\`\`

STEP 6 - COMMIT WITH DETAILED MESSAGE:
After updating the guide and marking briefs, commit with a detailed message.

Use this format:
\`\`\`bash
git add -A && git commit -m "$(cat <<'EOF'
Guide revision: <one-line summary of main insight>

Changes:
- <what was added/changed in interests>
- <what was added/changed in disinterests>
- <what was added/changed in preferences>
- <experiment status changes>
- <new experiments proposed>

Evidence:
- <brief1>: <rating>, <key signals>
- <brief2>: <rating>, <key signals>

Feedback-Source: <brief1-path>
Feedback-Source: <brief2-path>
Triggered-By: cb process-feedback
EOF
)"
\`\`\`

The commit message should:
1. First line: One sentence capturing the main learning (e.g., "Reader prefers AI analysis over security incidents")
2. Changes section: Bullet list of what was modified in the guide
3. Evidence section: What feedback led to each change
4. Trailers: One Feedback-Source trailer per brief processed

OUTPUT FORMAT:
For each brief processed, state:
  BRIEF: [path]
  OVERALL: [rating]
  THUMBS: [list of up/down on sections/expandos]
  COMMENTS: [summary of user comments if any]
  GUIDE CHANGES: [what you updated based on this brief]

At the end:
  SUMMARY: [overall synthesis of what was learned]
  EXPERIMENTS: [status changes and new experiments created]

Then commit as described above.

GIT: Do NOT add Co-Authored-By to commits. The system adds appropriate trailers automatically.`;
}

/**
 * Execute the process-feedback command.
 */
async function executeProcessFeedback(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const processArgs = args as ProcessFeedbackArgs;
  const dryRun = processArgs.dryRun ?? false;

  // Check for existing lock
  if (!processArgs.force) {
    const existingLock = await getLockInfo(ctx.boxRoot);
    if (existingLock) {
      return {
        success: false,
        error: `Another process is running (PID ${existingLock.pid}). Use --force to override.`,
      };
    }
  }

  // Acquire lock
  const lock = await acquireLock(ctx.boxRoot);
  if (!lock && !processArgs.force) {
    return {
      success: false,
      error: "Failed to acquire lock",
    };
  }

  // Ensure directories exist
  const briefsDir = path.join(ctx.boxRoot, "store/archive/briefs");
  const questionsDir = path.join(ctx.boxRoot, "box/questions");
  await fs.mkdir(briefsDir, { recursive: true });
  await fs.mkdir(questionsDir, { recursive: true });

  try {
    ctx.writeLine(fmt.phase("Guide Revision"));

    const unprocessedBriefs = await getUnprocessedBriefs(ctx.boxRoot);

    if (unprocessedBriefs.length === 0) {
      ctx.writeLine(fmt.dim("No unprocessed briefs to revise guide from."));
      ctx.writeLine(
        fmt.dim("(Briefs need to be read and have feedback before processing)")
      );
      return { success: true, data: { processed: 0 } };
    }

    ctx.writeLine(
      `Found ${fmt.num(unprocessedBriefs.length)} brief(s) with unprocessed feedback.`
    );

    if (dryRun) {
      ctx.writeLine(fmt.dim("(dry run - skipping agent)"));
      for (const brief of unprocessedBriefs) {
        ctx.writeLine(fmt.dim(`  Would process: ${brief}`));
      }
      return { success: true, data: { processed: 0, dryRun: true } };
    }

    const paths = unprocessedBriefs.join("\n  - ");
    ctx.writeLine(fmt.info("Starting Claude Code agent..."));
    ctx.writeLine("");

    const agent = processArgs.agent ?? createAgent({
      name: "guide-revision",
      onOutput: (text) => ctx.write(text),
    });
    const baseline = await captureBaseline(ctx.boxRoot);
    const result = await agent.invoke({
      boxRoot: ctx.boxRoot,
      systemPrompt: buildGuideRevisionPrompt(ctx.boxRoot),
      prompt: `Please process feedback from these briefs and revise the guide:\n  - ${paths}`,
      maxBudgetUsd: 5,
    });
    ctx.writeLine("");

    if (result.success) {
      ctx.writeLine(fmt.ok("Agent finished successfully"));

      // Retry if agent didn't commit, then fallback
      await ensureAgentCommitted({
        boxRoot: ctx.boxRoot,
        agent,
        baseline,
        fallbackMessage: `Guide revision from ${unprocessedBriefs.length} brief(s)`,
        fallbackTrailers: { "Triggered-By": "cb process-feedback", Session: agent.sessionId ?? "unknown" },
        onOutput: (text) => ctx.write(text),
      });

      return {
        success: true,
        data: { processed: unprocessedBriefs.length },
      };
    } else {
      ctx.writeLine(fmt.fail(`Agent error: ${result.error}`));
      return {
        success: false,
        error: result.error ?? "Agent failed",
      };
    }
  } finally {
    await releaseLock(ctx.boxRoot);
  }
}

// Register the command
registerCommand({
  name: "process-feedback",
  description: "Process brief feedback and revise the news guide",
  args: [
    {
      name: "dryRun",
      description: "Show what would happen without doing it",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "force",
      description: "Force even if another process is running",
      required: false,
      default: false,
      type: "boolean",
    },
  ],
  execute: executeProcessFeedback,
});

export { executeProcessFeedback, getUnprocessedBriefs, buildGuideRevisionPrompt };
