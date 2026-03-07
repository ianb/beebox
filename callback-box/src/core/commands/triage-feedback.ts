/**
 * Triage-feedback command - Categorize and integrate user feedback.
 *
 * This command handles the triage phase of feedback processing:
 * 1. Reads transcribed feedback cards from box/inbox/feedback/
 * 2. Categorizes each card (feedback about brief, task/reminder, or unhandled)
 * 3. For feedback: integrates directly into the target brief as <user-comment>
 * 4. For tasks: creates task cards (future work)
 * 5. For unhandled: moves to box/inbox/unhandled/
 *
 * After integration, feedback cards are moved to store/integrated/ for provenance.
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
 * Arguments for the triage-feedback command.
 */
export interface TriageFeedbackArgs {
  /** Show what would happen without doing it */
  dryRun?: boolean;
  /** Force even if another process is running */
  force?: boolean;
  /** Injected agent — if not provided, creates a real Claude agent. */
  agent?: Agent;
}

/**
 * Get feedback cards from inbox that have been transcribed.
 * Only returns cards with transcription (voice) or text content.
 */
async function getTranscribedFeedbackCards(boxRoot: string): Promise<string[]> {
  const dir = path.join(boxRoot, "box/inbox/feedback");
  try {
    const files = await fs.readdir(dir);
    const feedbackCards = files.filter((f) => f.endsWith(".feedback.card"));

    // Filter to only cards that are ready for triage (have content)
    const readyCards: string[] = [];
    for (const card of feedbackCards) {
      const cardPath = path.join(dir, card);
      const content = await fs.readFile(cardPath, "utf-8");

      // Check if voice card has transcription, or if it's a text card with content
      const hasTranscription = content.includes("<transcription");
      const hasTextContent =
        content.includes("<source>text</source>") &&
        (content.includes("<comment>") || content.includes("<response>"));
      const hasPermanentError = content.includes('permanent="true"');

      // Skip cards with permanent transcription errors
      if (hasPermanentError) {
        continue;
      }

      // Include if it has transcription or is a text card
      if (hasTranscription || hasTextContent) {
        readyCards.push(path.join("box/inbox/feedback", card));
      }
    }

    return readyCards;
  } catch {
    return [];
  }
}

/**
 * Build the system prompt for feedback triage.
 */
function buildFeedbackTriagePrompt(boxRoot: string): string {
  return `You are triaging user feedback on news briefs in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
Process feedback cards in box/inbox/feedback/, categorize them, and integrate feedback into briefs.

OVERVIEW:
1. Read each feedback card and its transcription
2. Categorize the content
3. Integrate feedback directly into the target brief
4. Move processed cards to appropriate locations

CATEGORIES:
- **feedback**: Direct commentary on brief content → integrate into brief
- **task**: A reminder, follow-up, or action item → move to box/inbox/unhandled/ (task system not yet built)
- **unhandled**: Unclear intent or doesn't fit other categories → move to box/inbox/unhandled/

SPLIT HANDLING:
If a single feedback card contains MULTIPLE intents (e.g., "This was interesting, I should follow up on Zig later"):
1. The feedback portion ("This was interesting") should be integrated into the brief
2. The task portion ("follow up on Zig later") should be noted
3. Create a new card for the task portion in box/inbox/unhandled/ with a note about what it is
4. Mark the original card's triage-summary attr with what was extracted

STEP-BY-STEP PROCESS:

For each feedback card:

1. READ THE CARD:
   \`\`\`
   cat box/inbox/feedback/<card-name>.feedback.card
   \`\`\`
   Note the target ref (e.g., "store/archive/briefs/2026-02-03_foo.news-brief.card#s1")
   Note the transcription or comment text

2. CATEGORIZE:
   - Is this feedback about the brief content? → feedback
   - Is this a reminder/follow-up/action for later? → task
   - Is this unclear or something else? → unhandled
   - Does it contain multiple intents? → note both

3. FOR FEEDBACK ITEMS - INTEGRATE INTO BRIEF:
   a. Parse the target ref to get brief path and element ID
   b. Read the target brief
   c. Find the target element (section or expando by ID)
   d. Add a <user-comment> element as a child of that element:

   \`\`\`xml
   <user-comment timestamp="<from-feedback-card>" source="voice"
                 audio="store/integrated/<feedback-card-basename>.webm"
                 language="en">
     <transcription text here>
   </user-comment>
   \`\`\`

   For text feedback, use source="text" and omit the audio attr.

   e. Save the brief

4. MOVE THE FEEDBACK CARD:
   - For integrated feedback:
     \`\`\`
     cb mv box/inbox/feedback/<card> store/integrated/
     \`\`\`
   - For unhandled items:
     \`\`\`
     mkdir -p box/inbox/unhandled
     cb mv box/inbox/feedback/<card> box/inbox/unhandled/
     \`\`\`

5. UPDATE TRIAGE STATUS:
   Before moving, update the card's triage-status attribute:
   - For feedback: triage-status="integrated"
   - For unhandled: triage-status="unhandled"

EXAMPLE INTEGRATION:

If feedback card has:
- target ref: "store/archive/briefs/2026-02-03_security.news-brief.card#s1"
- transcription: "This hardware angle isn't really my thing"
- timestamp: "2026-02-03T12:38:30Z"

Find section s1 in the brief and add:
\`\`\`xml
<section id="s1" heading="..." user-feedback="thumbs-down">
  <user-comment timestamp="2026-02-03T12:38:30Z" source="voice"
                audio="store/integrated/brief_feedback_2026-02-03T12-38-30.webm"
                language="en">
    This hardware angle isn't really my thing
  </user-comment>
  ... existing content ...
</section>
\`\`\`

HANDLING EDGE CASES:

**Brief not found**: If the target brief doesn't exist at the path, move feedback to box/inbox/unhandled/

**Element not found**: If the target element (e.g., #s5) doesn't exist in the brief, move to unhandled

**Expando target**: Expandos can also have user-comment children - same process as sections

**No fragment in ref**: If ref has no fragment (just the brief path), the comment is about the brief overall.
In this case, add the user-comment as a child of the <content> element.

OUTPUT FORMAT:
For each card processed, report:
  CARD: [path]
  CATEGORY: feedback | task | unhandled
  ACTION: integrated into [brief#element] | moved to unhandled | split (feedback integrated, task to unhandled)

When done, commit your changes with a detailed message:

\`\`\`bash
git add -A && git commit -m "$(cat <<'EOF'
Triage feedback: <N> integrated, <M> unhandled

Integrated:
- <brief#element>: "<summary of comment>"
- <brief#element>: "<summary of comment>"

Unhandled:
- <card>: <reason>

Triggered-By: cb triage-feedback
EOF
)"
\`\`\`

GIT: Do NOT add Co-Authored-By to commits. The system adds appropriate trailers automatically.`;
}

/**
 * Execute the triage-feedback command.
 */
async function executeTriageFeedback(
  ctx: CommandContext,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  const triageArgs = args as TriageFeedbackArgs;
  const dryRun = triageArgs.dryRun ?? false;

  // Check for existing lock
  if (!triageArgs.force) {
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
  if (!lock && !triageArgs.force) {
    return {
      success: false,
      error: "Failed to acquire lock",
    };
  }

  // Ensure directories exist
  const feedbackDir = path.join(ctx.boxRoot, "box/inbox/feedback");
  const integratedDir = path.join(ctx.boxRoot, "store/integrated");
  const unhandledDir = path.join(ctx.boxRoot, "box/inbox/unhandled");
  await fs.mkdir(feedbackDir, { recursive: true });
  await fs.mkdir(integratedDir, { recursive: true });
  await fs.mkdir(unhandledDir, { recursive: true });

  try {
    ctx.writeLine(fmt.phase("Triaging Feedback"));

    const feedbackCards = await getTranscribedFeedbackCards(ctx.boxRoot);

    if (feedbackCards.length === 0) {
      ctx.writeLine(fmt.dim("No transcribed feedback to triage."));
      ctx.writeLine(
        fmt.dim("(Voice recordings need transcription first - run 'cb wakeup')")
      );
      return { success: true, data: { processed: 0 } };
    }

    ctx.writeLine(
      `Found ${fmt.num(feedbackCards.length)} feedback card(s) ready for triage.`
    );

    if (dryRun) {
      ctx.writeLine(fmt.dim("(dry run - skipping agent)"));
      for (const card of feedbackCards) {
        ctx.writeLine(fmt.dim(`  Would triage: ${card}`));
      }
      return { success: true, data: { processed: 0, dryRun: true } };
    }

    const paths = feedbackCards.join("\n  - ");
    ctx.writeLine(fmt.info("Starting Claude Code agent..."));
    ctx.writeLine("");

    // Create or use injected agent
    const agent = triageArgs.agent ?? createAgent({
      name: "triage",
      onOutput: (text) => ctx.write(text),
    });

    const baseline = await captureBaseline(ctx.boxRoot);
    const result = await agent.invoke({
      boxRoot: ctx.boxRoot,
      systemPrompt: buildFeedbackTriagePrompt(ctx.boxRoot),
      prompt: `Please triage and integrate these feedback cards:\n  - ${paths}`,
    });
    ctx.writeLine("");

    if (result.success) {
      ctx.writeLine(fmt.ok("Agent finished successfully"));

      // Retry if agent didn't commit, then fallback
      await ensureAgentCommitted({
        boxRoot: ctx.boxRoot,
        agent,
        baseline,
        fallbackMessage: `Triage ${feedbackCards.length} feedback card(s)`,
        fallbackTrailers: { "Triggered-By": "cb triage-feedback", Session: agent.sessionId },
        onOutput: (text) => ctx.write(text),
      });

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
  name: "triage-feedback",
  description: "Triage feedback cards and integrate into briefs",
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
  execute: executeTriageFeedback,
});

export { executeTriageFeedback, getTranscribedFeedbackCards, buildFeedbackTriagePrompt };
