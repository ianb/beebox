/**
 * Generator for the `cb` command reference doc (docs/generated/cb-commands.md).
 *
 * Pure function: the static command prose is assembled here, with the
 * auto-generated "Available Templates" listing interleaved. Split out of
 * generate-docs-content.ts to keep each file under the line limit.
 */

import type { ZodTypeAny } from "zod";
import { getAllTemplates } from "../schemas/templates.js";

/**
 * Lead-in prose + `cb create` section for the cb command reference.
 */
function cbCommandsIntro(): string[] {
  return [
    "# cb Command Reference",
    "",
    "These are the `cb` commands most relevant to agents working in a box.",
    "",
    "## cb create",
    "",
    "Create a new card from a template.",
    "",
    "```",
    "cb create <path> [options]",
    "```",
    "",
    "The card type is inferred from the filename (e.g., `my-question.question.card` → question template).",
    "",
    "**Options:**",
    "- `-t, --template <name>` — Override template (usually auto-detected from filename)",
    "- `-c, --content <text>` — Content for memo cards",
    "- `-p, --prompt <text>` — Prompt for question cards",
    "- `-m, --memo <text>` — Context/background for question cards",
    "-  `-o, --options <items...>` — Options for select questions",
    "- `-a, --attachment <path>` — Path to an attachment file",
    "- `--commit` — Commit the new card immediately",
    "",
    "**Examples:**",
    "```bash",
    "# Create a memo",
    'cb create box/inbox/my-note.memo.card content="Remember to check the logs"',
    "",
    "# Create a yes/no question",
    "cb create box/questions/confirm.question.card -t question-confirm \\",
    '  memo="The capture session is ready to archive" prompt="Archive it?"',
    "",
    "# Create a scheduled script",
    'cb create config/schedules/check.scheduled-script.card runs="cb wakeup" cron="0 6 * * *"',
    "```",
    "",
    "### Available Templates",
    "",
  ];
}

/**
 * The auto-generated "Available Templates" listing for `cb create`.
 */
function cbCommandsTemplates(): string[] {
  const lines: string[] = [];
  for (const t of getAllTemplates()) {
    lines.push(`#### ${t.name}`);
    lines.push("");
    lines.push(t.description);
    lines.push("");
    lines.push(`Card types: ${t.cardTypes.join(", ")}`);
    lines.push("");

    const shape = t.argsSchema.shape;
    const argEntries = Object.entries(shape);
    if (argEntries.length > 0) {
      lines.push("Arguments:");
      for (const [key, schema] of argEntries) {
        const zodSchema = schema as ZodTypeAny;
        const isOptional = zodSchema.isOptional();
        const desc = zodSchema.description ?? "";
        let line = `- \`${key}\``;
        if (isOptional) line += " (optional)";
        if (desc) line += ` — ${desc}`;
        lines.push(line);
      }
      lines.push("");
    }
  }
  return lines;
}

/**
 * Hand-written command sections: mv, rm, validate, answer, status, reactor, finish.
 */
function cbCommandsCore(): string[] {
  return [
    "## cb mv",
    "",
    "Move or rename a card, updating references in other cards.",
    "",
    "```",
    "cb mv <source> <destination>",
    "```",
    "",
    "Use this instead of `git mv` or `mv` — it updates cross-references.",
    "",
    "**Examples:**",
    "```bash",
    "# Move from inbox to pool for processing",
    "cb mv box/inbox/item.memo.card box/pool/item.memo.card",
    "",
    "# Archive a processed item",
    "cb mv box/pool/item.memo.card store/archive/item.memo.card",
    "```",
    "",
    "## cb rm",
    "",
    "Soft-delete a card by moving it to `store/trash/`.",
    "",
    "```",
    "cb rm <path>",
    "```",
    "",
    "## cb validate",
    "",
    "Validate a card against its schema.",
    "",
    "```",
    "cb validate <path>",
    "```",
    "",
    "Always validate after creating or editing cards. Returns a non-zero exit code on failure.",
    "",
    "## cb answer",
    "",
    "Answer a pending question card.",
    "",
    "```",
    "cb answer <path>",
    "```",
    "",
    "Interactively answers a question. For agents, it's often easier to edit the card XML directly",
    "(set the `<answer>` element and `status=\"answered\"`).",
    "",
    "## cb status",
    "",
    "Show a summary of the box state — item counts in each directory, git status, etc.",
    "",
    "```",
    "cb status",
    "```",
    "",
    "## cb reactor",
    "",
    "Process all pending jobs in `box/jobs/`.",
    "",
    "```",
    "cb reactor [--dry-run]",
    "```",
    "",
    "The reactor finds all `*.job.card` files in `box/jobs/`, spawns an agent session,",
    "and processes them according to each job type's instructions (from `.claude/rules/`).",
    "The agent calls `cb finish` for each completed job.",
    "",
    "## cb finish",
    "",
    "Complete a job by deleting its card file and committing the deletion.",
    "",
    "```",
    "cb finish <job-file>",
    "```",
    "",
    "Call this after all work for a job is done and committed. It only handles the job card deletion.",
    "",
  ];
}

/**
 * Hand-written command sections: procedure, tick, scheduled, scheduler, finalize,
 * describe-images, scenario.
 */
function cbCommandsScheduling(): string[] {
  return [
    "## cb procedure",
    "",
    "Run and manage declarative procedures. See `docs/generated/procedures.md` for details.",
    "",
    "```bash",
    "cb procedure run <name-or-path>          # Run a procedure",
    "cb procedure run <name> --step <id>      # Run a single step",
    "cb procedure run <name> --dry-run        # Preview without executing",
    'cb procedure run <name> --directive "text" # Pass a directive to agents',
    "cb procedure list                        # List available procedures",
    "cb procedure status [run-dir]            # Show status of latest/specific run",
    "```",
    "",
    "The `<name-or-path>` argument can be a bare name (resolves to `config/procedures/<name>.procedure.card`)",
    "or a direct path to any `.procedure.card` file.",
    "",
    "The `--directive` flag passes an opaque string that appears as `<directive>...</directive>` in every agent's",
    "system prompt within the procedure. Use it to customize behavior without modifying the procedure card.",
    "",
    "## cb tick",
    "",
    "Evaluate scheduled scripts and run any that are due.",
    "",
    "```",
    "cb tick [--dry-run] [--script <name>] [--force] [--box <path>]",
    "```",
    "",
    "Checks all `config/schedules/*.scheduled-script.card` files against their cron/at/rrule schedules.",
    "Runs due scripts, updates last-run timestamps, and deletes one-shot (`once`) scripts after execution.",
    "",
    "**Options:**",
    "- `--dry-run` — Show which scripts would run without executing them",
    "- `--script <name>` — Only evaluate a specific script (by filename stem)",
    "- `--force` — Run the `--script` now, bypassing schedule, budget, and active-chat checks. Use this when the boxholder asks for a run from chat — a plain tick defers on the chat session itself. Running scripts/procedures and live lock-group holders still defer; force never preempts running work.",
    "- `--box <path>` — Target a specific box instead of the current directory",
    "",
    "Note: scripts with `on-wakeup=\"true\"` also run during `cb wakeup`, subject to their `not-before` interval.",
    "",
    "## cb scheduled",
    "",
    "List all scheduled scripts and their status.",
    "",
    "```",
    "cb scheduled",
    "```",
    "",
    "Shows each schedule's name, type (cron/at/rrule), next due time, last run, and flags (on-wakeup, once, enabled).",
    "",
    "## cb health",
    "",
    "Show scheduled-task health: failing, overdue, blocked, or invalid tasks, plus",
    "whether the scheduler daemon is alive.",
    "",
    "```",
    "cb health [--json] [--all] [--box <path>]",
    "```",
    "",
    "Per task: status, last attempt vs last success (they diverge while failing),",
    "consecutive-failure count, and the last error. `--all` includes disabled tasks.",
    "Exit code 1 when anything is failing/overdue/invalid or the scheduler heartbeat",
    "is stale, so scripts can gate on it. Deliberate skips (budget exhausted, missing",
    "connector, disabled) show as blocked/disabled, never as failures.",
    "",
    "## cb scheduler",
    "",
    "Manage the background scheduler daemon that runs `cb tick` on a recurring basis.",
    "",
    "```",
    "cb scheduler start [--interval <seconds>]  # Run daemon (foreground)",
    "cb scheduler add <path>                    # Add box to scheduler",
    "cb scheduler remove <path>                 # Remove box",
    "cb scheduler list                          # Show configured boxes",
    "cb scheduler status                        # Show boxes + launchd status",
    "cb scheduler log [--box <path>] [--limit <n>] [--errors] [--json]",
    "cb scheduler install                       # Install launchd plist",
    "cb scheduler uninstall                     # Remove launchd plist",
    "```",
    "",
    "The daemon polls every 60 seconds (configurable). Config at `~/.config/cb/scheduler.json`.",
    "Per-box logs are written to `.callback-box/scheduler.jsonl` (JSONL, auto-rotated at 1MB).",
    "Each log entry records which scripts ran/skipped/errored with timestamps and durations.",
    "Agents can read `.callback-box/scheduler.jsonl` to understand recent scheduling activity.",
    "",
    "## cb finalize",
    "",
    "Run outbound connectors to flush pending output cards.",
    "",
    "```",
    "cb finalize [-c, --connector <name>]",
    "```",
    "",
    "Symmetric counterpart to `cb wakeup`. Sends any pending cards in `box/output/`",
    "(e.g. telegram messages). Called automatically by the reactor after job processing,",
    "or run manually to flush output.",
    "",
    "## cb describe-images",
    "",
    "Analyze images using Gemini Flash — OCR, descriptions, EXIF extraction, and renaming.",
    "",
    "```",
    "cb describe-images [--no-rename] <paths...>",
    "```",
    "",
    "Pass image files (`.jpg`, `.png`) or image cards (`.image.card`). Multiple images",
    "are sent as a batch so the model sees them together (better context for related images).",
    "Extracts EXIF date to update the card's `captured` attribute. Creates image cards for",
    "raw image files if none exists. Renames cards to descriptive names by default.",
    "",
    "## cb scenario",
    "",
    "Run scenario tests against boxes. Scenarios live in `~/src/boxes/scenarios/`.",
    "",
    "```bash",
    "cb scenario list                          # List available scenarios",
    "cb scenario run <name>                    # Run a scenario",
    "cb scenario run <name> --from <checkpoint> # Start from checkpoint",
    "cb scenario run <name> --dry-run          # Preview steps",
    "```",
    "",
    "## cb chat",
    "",
    "Talk to the live chat session.",
    "",
    "- `cb chat self-note \"<body>\" [--ref <path>] [--commit <hash>]` — Post an",
    "  agent-authored record into the chat transcript without triggering a reply.",
    "- `cb chat get-last-audio [--out <path>]` — Fetch the recording of the",
    "  user's most recent voice message; prints the saved temp-file path plus",
    "  `recorded-at:`/`text:` lines identifying the message. For the rare cases",
    "  where the exact audio matters — a mangled transcription that's important",
    "  to get right, or sound-sensitive work like language practice — not",
    "  routine chat. Only the latest voice message is available, and only while",
    "  the chat tab that recorded it is open.",
    "",
  ];
}

/**
 * Generate the cb commands reference doc.
 */
export function generateCbCommands(): string {
  const lines: string[] = [
    ...cbCommandsIntro(),
    ...cbCommandsTemplates(),
    ...cbCommandsCore(),
    ...cbCommandsScheduling(),
  ];
  return lines.join("\n");
}
