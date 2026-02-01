/**
 * Process-feedback command - Process user feedback on editions.
 *
 * This command invokes Claude Code to process feedback cards and update
 * the news guide accordingly.
 *
 * The agent:
 * 1. Reads feedback cards from box/inbox/feedback/
 * 2. Resolves the target reference to understand what was commented on
 * 3. Updates the news-guide based on the feedback:
 *    - Adjusts confidence levels on interests/preferences
 *    - Records observations on experiments
 *    - Updates experiment status based on evidence
 * 4. May create questions for ambiguous feedback
 * 5. Archives processed feedback
 *
 * Feedback types:
 * - query-response: User answered a query in an edition
 * - edition: User commented on a section/expando/hypothesis
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { runAgent } from "../agent.js";
import { acquireLock, releaseLock, getLockInfo } from "../../cli/lib/lock.js";
import { stageAll, commit, getStatus } from "../../cli/lib/git.js";
import { fmt } from "../../cli/lib/format.js";

/**
 * Arguments for the process-feedback command.
 */
export interface ProcessFeedbackArgs {
  /** Show what would happen without doing it */
  dryRun?: boolean;
  /** Force even if another process is running */
  force?: boolean;
}

/**
 * Get feedback cards from inbox.
 */
async function getFeedbackCards(boxRoot: string): Promise<string[]> {
  const dir = path.join(boxRoot, "box/inbox/feedback");
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => f.endsWith(".feedback.card"))
      .map((f) => path.join("box/inbox/feedback", f));
  } catch {
    return [];
  }
}

/**
 * Build the system prompt for feedback processing.
 */
function buildFeedbackPrompt(boxRoot: string): string {
  return `You are processing user feedback on news editions in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
Process feedback cards in box/inbox/feedback/ and update the news-guide accordingly.

STEP 1 - READ THE GUIDE:
First, read config/news-guide.news-guide.card to understand current beliefs and experiments.

STEP 2 - PROCESS EACH FEEDBACK CARD:
For each feedback card:

1. Read the card and note the target reference (ref="path#fragment")
2. Parse the reference to understand what was targeted:
   - #q1, #q2 etc. = query responses
   - #s1, #s2 etc. = section feedback
   - #h1, #h2 etc. = hypothesis feedback
   - #exp1, #exp2 etc. = expando feedback

3. Read the referenced edition to understand context:
   - What was the query asking?
   - What hypothesis was being tested?
   - What experiment does this relate to?

4. Update the guide based on feedback type:

   FOR QUERY RESPONSES:
   - The response often reveals user interests or preferences
   - Add or update <topic> elements with source="feedback"
   - Add or update <preference> elements
   - Increase confidence on confirmed interests
   - Reference the feedback: evidence="feedback:[feedback-card-path]"

   FOR HYPOTHESIS FEEDBACK:
   - Check the edition's <curation> section for the hypothesis
   - Find the related experiment in the guide
   - Add an <observation> to the experiment
   - If feedback confirms: increase confidence, consider marking experiment "successful"
   - If feedback refutes: decrease confidence, consider marking experiment "unsuccessful"

   FOR SECTION/EXPANDO FEEDBACK:
   - Positive feedback on a topic → increase confidence on that interest
   - Negative feedback → add to disinterests or decrease confidence
   - Comments about depth/tone → update preferences

5. If feedback is ambiguous or raises questions:
   Create a question card for clarification:
   \`\`\`
   cb create box/questions/Clarify_<topic>.question.card
   \`\`\`

   Then edit it:
   \`\`\`xml
   <question status="pending" answered-by="news-curation">
     <memo>Processing feedback on edition, need clarification</memo>
     <context ref="[feedback-card-path]">User feedback that prompted this question</context>
     <prompt>Your clarifying question here</prompt>
     <input type="select">
       <option id="a">Option A</option>
       <option id="b">Option B</option>
     </input>
   </question>
   \`\`\`

   Note: The answered-by="news-curation" ensures the answer comes back to this agent.

STEP 3 - ARCHIVE PROCESSED FEEDBACK:
After processing each feedback card:
\`\`\`
cb move box/inbox/feedback/<card> store/archive/feedback/
\`\`\`

STEP 4 - UPDATE THE GUIDE:
Make sure to update <updated-at> in the guide with the current timestamp.

EXAMPLE GUIDE UPDATES:

Adding an observation to an experiment:
\`\`\`xml
<experiment id="exp-retro" status="active">
  <hypothesis>User enjoys retro computing content</hypothesis>
  <approach>Include one retro piece per edition</approach>
  <observation ref="store/archive/feedback/query_response_2026-02-01.feedback.card" date="${new Date().toISOString().slice(0, 10)}">
    User explicitly expressed interest in Amiga Unix article
  </observation>
</experiment>
\`\`\`

Increasing confidence on an interest:
\`\`\`xml
<topic confidence="high" source="feedback" evidence="store/archive/feedback/query_response_2026-02-01.feedback.card">
  Retro computing
</topic>
\`\`\`

Adding a new preference:
\`\`\`xml
<preference aspect="depth" confidence="medium" source="feedback" evidence="store/archive/feedback/edition_feedback_2026-02-01.feedback.card">
  Appreciates technical deep-dives on systems programming
</preference>
\`\`\`

CONFIDENCE LEVEL GUIDE:
- hypothesis → low: First signal of interest
- low → medium: Consistent pattern (2-3 signals)
- medium → high: Strong evidence (explicit statement or multiple confirmations)
- high → confirmed: User directly stated preference

OUTPUT: As you process each feedback card, state:
  PROCESSED: [filename] → [what was updated in guide]
  QUESTION: [filename] → Created question about [topic]

When done, summarize what was learned and any open questions.

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
  const feedbackDir = path.join(ctx.boxRoot, "box/inbox/feedback");
  const archiveDir = path.join(ctx.boxRoot, "store/archive/feedback");
  const questionsDir = path.join(ctx.boxRoot, "box/questions");
  await fs.mkdir(feedbackDir, { recursive: true });
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.mkdir(questionsDir, { recursive: true });

  try {
    ctx.writeLine(fmt.phase("Processing Feedback"));

    const feedbackCards = await getFeedbackCards(ctx.boxRoot);

    if (feedbackCards.length === 0) {
      ctx.writeLine(fmt.dim("No feedback to process."));
      return { success: true, data: { processed: 0 } };
    }

    ctx.writeLine(`Found ${fmt.num(feedbackCards.length)} feedback card(s) to process.`);

    if (dryRun) {
      ctx.writeLine(fmt.dim("(dry run - skipping agent)"));
      for (const card of feedbackCards) {
        ctx.writeLine(fmt.dim(`  Would process: ${card}`));
      }
      return { success: true, data: { processed: 0, dryRun: true } };
    }

    const paths = feedbackCards.join("\n  - ");
    ctx.writeLine(fmt.info("Starting Claude Code agent..."));
    ctx.writeLine("");

    const result = await runAgent({
      boxRoot: ctx.boxRoot,
      systemPrompt: buildFeedbackPrompt(ctx.boxRoot),
      prompt: `Please process these feedback cards:\n  - ${paths}`,
      onOutput: (text) => ctx.write(text),
    });
    ctx.writeLine("");

    if (result.success) {
      ctx.writeLine(fmt.ok("Agent finished successfully"));

      // Commit changes
      const status = await getStatus(ctx.boxRoot);
      if (!status.clean) {
        await stageAll(ctx.boxRoot);
        await commit(ctx.boxRoot, {
          message: `Process ${feedbackCards.length} feedback card(s)`,
          trailers: { "Triggered-By": "cb process-feedback" },
        });
        ctx.writeLine(fmt.dim("  Changes committed."));
      }

      return {
        success: true,
        data: { processed: feedbackCards.length },
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
  description: "Process user feedback and update the news guide",
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

export { executeProcessFeedback };
