/**
 * Agent invocation - Spawns Claude Code to process items.
 *
 * This module handles spawning Claude Code with appropriate context
 * and processing its outputs.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";

export interface AgentOptions {
  /** Box root directory */
  boxRoot: string;
  /** System prompt to prepend */
  systemPrompt: string;
  /** User prompt to send */
  prompt: string;
  /** Callback for streaming output */
  onOutput?: ((text: string) => void) | undefined;
  /** Maximum cost budget in dollars (default: 1.00) */
  maxCost?: number | undefined;
  /** Whether to run in dry-run mode (no side effects) */
  dryRun?: boolean | undefined;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
}

/**
 * Run Claude Code with the given prompts.
 *
 * Returns when the agent completes or errors.
 */
export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const {
    boxRoot,
    systemPrompt,
    prompt,
    onOutput,
    maxCost = 1.0,
    dryRun = false,
  } = options;

  return new Promise((resolve) => {
    const args = [
      "--print",
      "--dangerously-skip-permissions",
      "--max-turns", "20",
    ];

    // Add system prompt via append-system-prompt
    if (systemPrompt) {
      args.push("--append-system-prompt", systemPrompt);
    }

    // Add the user prompt
    args.push(prompt);

    if (dryRun) {
      resolve({
        success: true,
        output: `[DRY RUN] Would run Claude Code with prompt:\n${prompt}`,
        exitCode: 0,
      });
      return;
    }

    const child = spawn("claude", args, {
      cwd: boxRoot,
      env: {
        ...process.env,
        // Could add cost budget as env var if Claude Code supports it
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      if (onOutput) {
        onOutput(text);
      }
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      // Also send stderr to output callback
      if (onOutput) {
        onOutput(text);
      }
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        output: stdout,
        error: `Failed to spawn Claude Code: ${err.message}`,
        exitCode: -1,
      });
    });

    child.on("close", (code) => {
      const exitCode = code ?? 0;
      const result: AgentResult = {
        success: exitCode === 0,
        output: stdout,
        exitCode,
      };
      if (exitCode !== 0) {
        result.error = stderr || `Exit code: ${exitCode}`;
      }
      resolve(result);
    });
  });
}

/**
 * Build the system prompt for inbox processing.
 */
export function buildInboxProcessingPrompt(boxRoot: string): string {
  return `You are processing items in a Callback Box inbox.

WORKING DIRECTORY: ${boxRoot}

YOUR TASK:
Process news items (.news-item.card files) by:
1. Reading each item to understand the content
2. Creating a summary memo of interesting items
3. Marking items as processed

FOR NEWS ITEMS:
- Read the title, summary, and link from each card
- Identify the most interesting/notable items
- Create a summary memo at box/inbox/News_Summary_[DATE].memo.card
- Mark each processed item by changing status="new" to status="processed"

SUMMARY MEMO FORMAT:
\`\`\`xml
<memo status="new">
  <created>[ISO timestamp]</created>
  <content>
## News Summary for [Date]

### Top Stories
- [Title](link) - Brief note about why it's interesting

### Other Notable Items
- [Title](link)
- [Title](link)
  </content>
  <source>news-digest</source>
</memo>
\`\`\`

GUIDELINES:
- Use the Read tool to read card files
- Use the Edit tool to change status="new" to status="processed"
- Use the Write tool to create the summary memo
- Be concise - just note the key points
- Focus on what would be interesting/useful to know

When done, briefly state what you processed and summarized.`;
}

/**
 * Build a prompt for processing specific inbox items.
 */
export function buildItemProcessingPrompt(itemPaths: string[]): string {
  if (itemPaths.length === 0) {
    return "No items to process.";
  }

  const pathList = itemPaths.map((p) => `  - ${p}`).join("\n");

  return `Please process the following inbox items:

${pathList}

For each item:
1. Read and understand the content
2. Mark as processed (change status="new" to status="processed")
3. Note any items that need follow-up

When done, provide a brief summary of what you processed.`;
}
