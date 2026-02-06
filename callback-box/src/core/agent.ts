/**
 * Agent invocation - Spawns Claude Code to process items.
 *
 * This module handles spawning Claude Code with appropriate context
 * and processing its outputs.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fmt } from "../cli/lib/format.js";

// Get the path to the cb wrapper scripts so we can add them to PATH
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(__dirname, "../../bin");
// Path to the cb-claude wrapper that auto-adds plugins
const cbClaudePath = path.join(binDir, "cb-claude");

/**
 * Format command line for display, with special handling for prompts.
 * Returns multiple lines: the command itself, then system prompt, then user prompt.
 */
function formatCommandLine(cmd: string, args: string[]): string {
  const lines: string[] = [];
  const cmdParts: string[] = [cmd];

  let systemPrompt: string | null = null;
  let userPrompt: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--append-system-prompt" && i + 1 < args.length) {
      systemPrompt = args[i + 1]!;
      cmdParts.push(arg, "<system-prompt>");
      i++; // skip the next arg
    } else if (i === args.length - 1 && !arg.startsWith("-")) {
      // Last non-flag arg is likely the user prompt
      userPrompt = arg;
      cmdParts.push("<prompt>");
    } else {
      cmdParts.push(arg);
    }
  }

  lines.push(fmt.dim("$ ") + fmt.cmd(cmdParts.join(" ")));

  if (systemPrompt) {
    lines.push("");
    lines.push(fmt.dim("System prompt:"));
    lines.push(fmt.dim("─".repeat(40)));
    lines.push(systemPrompt);
    lines.push(fmt.dim("─".repeat(40)));
  }

  if (userPrompt) {
    lines.push("");
    lines.push(fmt.dim("User prompt:"));
    lines.push(fmt.dim("─".repeat(40)));
    lines.push(userPrompt);
    lines.push(fmt.dim("─".repeat(40)));
  }

  lines.push("");

  return lines.join("\n");
}

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
  /** Explicit session ID (auto-generated if not provided) */
  sessionId?: string | undefined;
  /** Maximum agent turns (default: 20) */
  maxTurns?: number | undefined;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  sessionId: string;
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
    maxTurns = 20,
  } = options;

  const sessionId = options.sessionId ?? randomUUID();

  return new Promise((resolve) => {
    const args = [
      "--print",
      "--verbose",
      "--dangerously-skip-permissions",
      "--max-turns", String(maxTurns),
      "--session-id", sessionId,
    ];

    // Add system prompt with session tracking instruction
    const sessionInstruction = `\n\nSESSION TRACKING: When making git commits, include this trailer:\n  Session: ${sessionId}\nAdd it after any other trailers in your commit messages.`;
    const fullSystemPrompt = systemPrompt + sessionInstruction;
    if (fullSystemPrompt) {
      args.push("--append-system-prompt", fullSystemPrompt);
    }

    // Add the user prompt
    args.push(prompt);

    if (dryRun) {
      resolve({
        success: true,
        output: `[DRY RUN] Would run Claude Code with prompt:\n${prompt}`,
        exitCode: 0,
        sessionId,
      });
      return;
    }

    // Show the command being run (show as "claude" for readability even though we use cb-claude)
    const cmdLine = formatCommandLine("claude", args);
    onOutput?.(cmdLine);

    // Add callback-box bin directory to PATH so cb commands are available
    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    };

    // Use cb-claude wrapper which auto-adds --plugin-dir for card validation
    const child = spawn(cbClaudePath, args, {
      cwd: boxRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      onOutput?.(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      onOutput?.(text);
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        output: stdout,
        error: `Failed to spawn Claude Code: ${err.message}`,
        exitCode: -1,
        sessionId,
      });
    });

    child.on("close", (code) => {
      const exitCode = code ?? 0;
      const result: AgentResult = {
        success: exitCode === 0,
        output: stdout,
        exitCode,
        sessionId,
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
