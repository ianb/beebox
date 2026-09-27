/**
 * Generator for the `bbx` command reference doc (bbx-commands.md in the package docs).
 *
 * Pure function: the static command prose is assembled here, with the
 * auto-generated "Available Templates" listing interleaved. Split out of
 * generate-docs-content.ts to keep each file under the line limit.
 */

import { BOX_PACKAGE_DOCS } from "./shared.js";
import { z } from "zod";
import { getBuiltinTemplates } from "../../schemas/templates.js";
import { bbxCommandsScheduling } from "./bbx-commands-scheduling.js";
import { bbxCommandsConnectors } from "./bbx-commands-connectors.js";
import { bbxCommandsSearch } from "./bbx-commands-search.js";

/**
 * Lead-in prose + `bbx create` section for the bbx command reference.
 */
function bbxCommandsIntro(): string[] {
  return [
    "# bbx Command Reference",
    "",
    "These are the `bbx` commands most relevant to agents working in a box.",
    "",
    "## bbx create",
    "",
    "Create a new card from a template.",
    "",
    "```",
    "bbx create <path> [options]",
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
    'bbx create _content/inbox/my-note.memo.card content="Remember to check the logs"',
    "",
    "# Create a yes/no question",
    "bbx create _bookkeeping/questions/confirm.question.card -t question-confirm \\",
    '  memo="The capture session is ready to archive" prompt="Archive it?"',
    "",
    "# Create a scheduled script",
    'bbx create _config/schedules/check.scheduled-script.card runs="bbx engine wakeup" cron="0 6 * * *"',
    "```",
    "",
    "For array or structured frontmatter values, use **JSON** (`options='[\"Red\",\"Blue\"]'`)",
    "— JSON is the default for anything machine-set. **Two-step pattern:** for a",
    "complex card, `bbx create` a minimal one, then edit it to fill in the details.",
    "",
    "`bbx create --list-templates` lists every template this box can use, its own",
    "included; the built-in ones are below.",
    "",
    "### Available Templates",
    "",
  ];
}

/**
 * The auto-generated "Available Templates" listing for `bbx create`.
 */
function bbxCommandsTemplates(): string[] {
  const lines: string[] = [];
  // Built-in only: this doc ships in the package, so a box's own templates
  // must not leak into it (they are listed in that box's agent guide).
  for (const t of getBuiltinTemplates()) {
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
        if (!(schema instanceof z.ZodType)) continue;
        const isOptional = schema.isOptional();
        const desc = schema.description ?? "";
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
 * Hand-written command sections: mv, rm, validate, view test, answer, contains, status, session, reactor, finish.
 */
function bbxCommandsCore(): string[] {
  return [
    "## bbx mv",
    "",
    "Move or rename a card, updating references in other cards.",
    "",
    "```",
    "bbx mv <source> <destination>",
    "```",
    "",
    "Use this instead of `git mv` or `mv` — it updates cross-references.",
    "",
    "**Examples:**",
    "```bash",
    "# File an inbox item into its permanent home",
    "bbx mv _content/inbox/Recipe.recipe.card _content/recipes/Recipe.recipe.card",
    "",
    "# Archive a processed item",
    "bbx mv _content/notes/Old_Note.doc.card _bookkeeping/archive/done/Old_Note.doc.card",
    "```",
    "",
    "## bbx rm",
    "",
    "Soft-delete a card by moving it to `_bookkeeping/trash/`.",
    "",
    "```",
    "bbx rm <path>",
    "```",
    "",
    "## bbx validate",
    "",
    "Validate a card against its schema.",
    "",
    "```",
    "bbx validate <path>",
    "```",
    "",
    "Always validate after creating or editing cards. Returns a non-zero exit code on failure.",
    "",
    "## bbx view test",
    "",
    "Render-test an agent-authored view (`views/<slug>.tsx`) in Node — no browser needed.",
    "",
    "```",
    "bbx view test <slug> [--path <card>] [--raw]",
    "```",
    "",
    "Compiles the view, loads the real cards its `dependencies` select, renders it once, and",
    "prints the HTML — or, on failure, the error with a stack mapped to your `.tsx` source.",
    "Use it to check a view after writing it. It's a synchronous render (no effects/async",
    `helpers); see \`${BOX_PACKAGE_DOCS}/views.md\` for what it does and doesn't cover.`,
    "",
    "## bbx answer",
    "",
    "Answer a pending question card.",
    "",
    "```",
    "bbx answer <question> <answer>",
    "```",
    "",
    "`<answer>` is the answer text, or an option ID (`a`, `b`, `c`, …) for a select question.",
    "",
    "## bbx contains",
    "",
    "Maintain the `contains:` field across the box.",
    "",
    "```",
    "bbx contains list [--missing] [--stale] [--json]",
    "bbx contains update <card> --text \"...\"",
    "```",
    "",
    "If you edit content and the",
    "sentence still holds, `bbx contains update <card> --text \"...\"` clears the",
    "staleness flag; `bbx contains list --missing` / `--stale` shows which cards",
    "still need one written or refreshed.",
    "",
    "## bbx status",
    "",
    "Show a summary of the box state — item counts in each directory, git status, etc.",
    "",
    "```",
    "bbx status",
    "```",
    "",
    "## bbx session",
    "",
    "Read a past session's transcript (chats, wakeups, job runs).",
    "",
    "```",
    "bbx session [<id>] [--list] [--latest] [--dialogue-only] [--tool-report] [--since <when>]",
    "```",
    "",
    "`--list` to find recent sessions, `--latest` or `<id>` to view (`--dialogue-only` for just",
    "the conversation, `--tool-report` for tool usage, `--since 2d` for a",
    "window). To *search* a large transcript, spawn a subagent (Task tool) to",
    "read it and report back the relevant part instead of pulling the whole",
    "transcript into your own context.",
    "",
    "## bbx reactor",
    "",
    "Process all pending jobs in `_bookkeeping/jobs/`.",
    "",
    "```",
    "bbx reactor [--dry-run]",
    "```",
    "",
    "The reactor finds all `*.job.card` files in `_bookkeeping/jobs/`, spawns an agent session,",
    "and processes them according to each job type's instructions (from `.claude/rules/`).",
    "The agent calls `bbx finish` for each completed job.",
    "",
    "## bbx finish",
    "",
    "Complete a job by deleting its card file and committing the deletion.",
    "",
    "```",
    "bbx finish <job-file>",
    "```",
    "",
    "Call this after all work for a job is done and committed. It only handles the job card deletion.",
    "",
  ];
}

/**
 * Generate the bbx commands reference doc.
 */
export function generateBbxCommands(): string {
  const lines: string[] = [
    ...bbxCommandsIntro(),
    ...bbxCommandsTemplates(),
    ...bbxCommandsCore(),
    ...bbxCommandsSearch(),
    ...bbxCommandsScheduling(),
    ...bbxCommandsConnectors(),
  ];
  return lines.join("\n");
}
