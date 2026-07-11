/**
 * Generator for the `cb` command reference doc (docs/generated/cb-commands.md).
 *
 * Pure function: the static command prose is assembled here, with the
 * auto-generated "Available Templates" listing interleaved. Split out of
 * generate-docs-content.ts to keep each file under the line limit.
 */

import { z } from "zod";
import { getAllTemplates } from "../../schemas/templates.js";
import { cbCommandsScheduling } from "./cb-commands-scheduling.js";

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
    "# File an inbox item into its permanent home",
    "cb mv box/inbox/Recipe.recipe.card store/recipes/Recipe.recipe.card",
    "",
    "# Archive a processed item",
    "cb mv store/notes/Old_Note.doc.card store/archive/done/Old_Note.doc.card",
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
    "## cb view test",
    "",
    "Render-test an agent-authored view (`views/<slug>.tsx`) in Node — no browser needed.",
    "",
    "```",
    "cb view test <slug> [--path <card>] [--raw]",
    "```",
    "",
    "Compiles the view, loads the real cards its `dependencies` select, renders it once, and",
    "prints the HTML — or, on failure, the error with a stack mapped to your `.tsx` source.",
    "Use it to check a view after writing it. It's a synchronous render (no effects/async",
    "helpers); see `docs/generated/views.md` for what it does and doesn't cover.",
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
