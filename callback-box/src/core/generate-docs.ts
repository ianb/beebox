/**
 * Generate agent documentation for a callback box.
 *
 * Produces two categories of docs:
 * 1. `.callback-box/agent-guide.md` — compact, always-loaded via @-include in CLAUDE.md
 * 2. `docs/generated/*.md` — detailed reference docs, read on demand by agents
 *
 * Called by `cb init` and at the start of `cb wakeup`.
 */

import { join } from "node:path";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { schemas } from "../schemas/registry.js";
import { getAllTemplates, getTemplatesForCardType, describeTemplateArgs } from "../schemas/templates.js";

const AGENT_GUIDE_DIR = ".callback-box";
const AGENT_GUIDE_FILE = "agent-guide.md";
const DOCS_DIR = "docs/generated";
const INCLUDE_LINE = `@.callback-box/${AGENT_GUIDE_FILE}`;

/**
 * Static connector metadata. Connectors register at runtime with a boxRoot,
 * but their capabilities are fixed at build time — so we declare them here.
 */
interface ConnectorInfo {
  name: string;
  handles: string[];
  produces: string[];
  description: string;
}

const CONNECTORS: ConnectorInfo[] = [
  {
    name: "rss",
    handles: [],
    produces: ["news-item"],
    description: "Pulls RSS/Atom feeds and creates news-item cards.",
  },
  {
    name: "raindrop",
    handles: [],
    produces: ["bookmark"],
    description: "Syncs bookmarks with Raindrop.io.",
  },
  {
    name: "dropbox",
    handles: ["open-tab"],
    produces: ["memo"],
    description: "Relays browser notifications via Dropbox. Handles `open-tab` commands to open URLs in the user's browser.",
  },
];

const DOCID_DEBUG_MARKER = ".callback-box/docid-debug";

export interface GenerateDocsOptions {
  /** Add DOCID markers to each generated file for debugging prompt inclusion.
   *  If not specified, checks for a `.callback-box/docid-debug` marker file. */
  docIdDebug?: boolean | undefined;
}

/**
 * Check if the docid-debug marker file exists in the box.
 */
async function hasDocIdMarker(boxRoot: string): Promise<boolean> {
  try {
    await stat(join(boxRoot, DOCID_DEBUG_MARKER));
    return true;
  } catch {
    return false;
  }
}

/**
 * Set or clear the docid-debug marker file.
 */
export async function setDocIdDebug(boxRoot: string, enabled: boolean): Promise<void> {
  const markerPath = join(boxRoot, DOCID_DEBUG_MARKER);
  if (enabled) {
    await mkdir(join(boxRoot, AGENT_GUIDE_DIR), { recursive: true });
    await writeFile(markerPath, "");
  } else {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(markerPath);
    } catch {
      // Already gone
    }
  }
}

/**
 * Optionally prepend a DOCID marker comment to content.
 * Uses the relative path from box root, e.g. "DOCID:docs/generated/card-question.md"
 */
function withDocId(relativePath: string, content: string, debug: boolean): string {
  if (!debug) return content;
  return `<!-- DOCID:${relativePath} -->\n${content}`;
}

/**
 * Generate all agent documentation for a box.
 */
export async function generateDocs(boxRoot: string, options: GenerateDocsOptions = {}): Promise<void> {
  const debug = options.docIdDebug ?? await hasDocIdMarker(boxRoot);

  await mkdir(join(boxRoot, AGENT_GUIDE_DIR), { recursive: true });
  await mkdir(join(boxRoot, DOCS_DIR), { recursive: true });

  await Promise.all([
    writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
      withDocId(`${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, generateAgentGuide(), debug)),
    writeFile(join(boxRoot, DOCS_DIR, "cb-commands.md"),
      withDocId(`${DOCS_DIR}/cb-commands.md`, generateCbCommands(), debug)),
    writeFile(join(boxRoot, DOCS_DIR, "connectors.md"),
      withDocId(`${DOCS_DIR}/connectors.md`, generateConnectorsDocs(), debug)),
    ...schemas
      .filter((s) => s.instructions)
      .map((s) => {
        const filename = `card-${s.tagName}.md`;
        return writeFile(join(boxRoot, DOCS_DIR, filename),
          withDocId(`${DOCS_DIR}/${filename}`, generateCardDoc(s.tagName), debug));
      }),
  ]);

  await ensureClaudeMdInclude(boxRoot);
}

/**
 * Generate the compact agent guide (always loaded via @-include).
 */
function generateAgentGuide(): string {
  const commandTypes = CONNECTORS.flatMap((c) => c.handles).filter(Boolean);
  const templates = getAllTemplates();

  const lines: string[] = [
    "# Callback Box Agent Guide",
    "",
    "## Directory Layout",
    "",
    "Location is state — a card's directory determines its lifecycle stage:",
    "",
    "| Directory | Purpose |",
    "|-----------|---------|",
    "| `box/inbox/` | Incoming items to be triaged |",
    "| `box/inbox/unhandled/` | Items with no clear destination |",
    "| `box/commands/` | Command cards ready to execute |",
    "| `box/questions/` | Pending questions for the user |",
    "| `box/resources/` | Synced external state |",
    "| `box/output/` | Produced content (briefs, etc.) |",
    "| `box/pool/` | Items being actively worked on |",
    "| `store/archive/` | Processed/completed items |",
    "| `store/integrated/` | Feedback absorbed into guides |",
    "| `store/trash/` | Soft-deleted items |",
    "| `config/` | Box configuration |",
    "",
    "## Key Commands",
    "",
    "Use `cb` for all card operations. See `docs/generated/cb-commands.md` for full reference.",
    "",
    "- `cb create <path>` — Create a card from template (auto-detects type from filename)",
    "- `cb move <src> <dest>` — Move a card, updating all references",
    "- `cb trash <path>` — Soft-delete a card to `store/trash/`",
    "- `cb validate <path>` — Validate a card against its schema",
    "- `cb answer <path>` — Answer a pending question",
    "- `cb context` — Show current box state for agent prompts",
    "",
    "## Card Types",
    "",
  ];

  for (const schema of schemas) {
    const hasDoc = schema.instructions ? ` — see \`docs/generated/card-${schema.tagName}.md\`` : "";
    lines.push(`- **${schema.tagName}**${hasDoc}`);
  }

  lines.push("");
  lines.push("## Creating Cards");
  lines.push("");
  lines.push("Prefer `cb create` with templates over writing XML directly:");
  lines.push("");

  for (const t of templates) {
    lines.push(`- \`cb create <path> -t ${t.name}\` — ${t.description}`);
  }

  lines.push("");
  lines.push("Always run `cb validate <path>` after creating or editing a card.");

  if (commandTypes.length > 0) {
    lines.push("");
    lines.push("## Commands (External Actions)");
    lines.push("");
    lines.push("Create command cards in `box/commands/` to trigger external actions.");
    lines.push(`Supported command types: ${commandTypes.map((t) => `\`${t}\``).join(", ")}`);
    lines.push("");
    lines.push("See `docs/generated/connectors.md` for details on each connector.");
  }

  lines.push("");
  lines.push("## Questions");
  lines.push("");
  lines.push("Create question cards in `box/questions/` to ask the user.");
  lines.push("Set `answered-by` to your agent name so the answer routes back to you.");
  lines.push("See `docs/generated/card-question.md` for format and templates.");
  lines.push("");
  lines.push("## General Principles");
  lines.push("");
  lines.push("- Prefer `cb create` with templates over writing XML by hand");
  lines.push("- Always `cb validate` after creating or modifying cards");
  lines.push("- Commit with meaningful messages describing what changed and why");
  lines.push("- Use `cb move` to change card state (not `git mv` or `mv`)");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate the cb commands reference doc.
 */
function generateCbCommands(): string {
  const lines: string[] = [
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
    'cb create box/inbox/my-note.memo.card -c "Remember to check the logs"',
    "",
    "# Create a yes/no question",
    'cb create box/questions/confirm.question.card -t question-confirm \\',
    '  -m "The news brief is ready" -p "Should I publish it?"',
    "",
    "# Create a select question",
    'cb create box/questions/pick.question.card \\',
    '  -m "Multiple topics found" -p "Which topic to focus on?" \\',
    '  -o "AI" "Climate" "Economics"',
    "```",
    "",
    "### Available Templates",
    "",
  ];

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
        const zodSchema = schema as import("zod").ZodTypeAny;
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

  lines.push(
    "## cb move",
    "",
    "Move or rename a card, updating references in other cards.",
    "",
    "```",
    "cb move <source> <destination>",
    "```",
    "",
    "Use this instead of `git mv` or `mv` — it updates cross-references.",
    "",
    "**Examples:**",
    "```bash",
    "# Move from inbox to pool for processing",
    "cb move box/inbox/item.memo.card box/pool/item.memo.card",
    "",
    "# Archive a processed item",
    "cb move box/pool/item.memo.card store/archive/item.memo.card",
    "```",
    "",
    "## cb trash",
    "",
    "Soft-delete a card by moving it to `store/trash/`.",
    "",
    "```",
    "cb trash <path>",
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
    "## cb context",
    "",
    "Show the current box state summary, useful for building agent prompts.",
    "",
    "```",
    "cb context",
    "```",
    "",
    "## cb status",
    "",
    "Show a summary of the box state — item counts in each directory, git status, etc.",
    "",
    "```",
    "cb status",
    "```",
    "",
  );

  return lines.join("\n");
}

/**
 * Generate a detailed doc for a single card type.
 */
function generateCardDoc(tagName: string): string {
  const schema = schemas.find((s) => s.tagName === tagName);
  if (!schema) return `# ${tagName}\n\nNo schema found.\n`;

  const templates = getTemplatesForCardType(tagName);
  const lines: string[] = [
    `# ${tagName} Card`,
    "",
  ];

  if (schema.instructions) {
    lines.push(schema.instructions.trim());
    lines.push("");
  }

  if (templates.length > 0) {
    lines.push("## Templates");
    lines.push("");

    for (const t of templates) {
      lines.push(`### ${t.name}`);
      lines.push("");
      lines.push(t.description);
      lines.push("");
      lines.push("```bash");
      lines.push(`cb create <path>.${tagName}.card -t ${t.name}`);
      lines.push("```");
      lines.push("");

      lines.push(describeTemplateArgs(t.name));
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Generate the connectors reference doc.
 */
function generateConnectorsDocs(): string {
  const lines: string[] = [
    "# Connectors",
    "",
    "Connectors bridge external services to the box filesystem.",
    "They are configured per-box in `config/connectors/`.",
    "",
  ];

  for (const c of CONNECTORS) {
    lines.push(`## ${c.name}`);
    lines.push("");
    lines.push(c.description);
    lines.push("");

    if (c.produces.length > 0) {
      lines.push(`**Produces:** ${c.produces.map((t) => `\`${t}\``).join(", ")} (via \`cb pull\`)`);
    }

    if (c.handles.length > 0) {
      lines.push(`**Handles commands:** ${c.handles.map((t) => `\`${t}\``).join(", ")}`);
      lines.push("");
      lines.push("To trigger this connector, create a command card in `box/commands/`:");
      lines.push("");
      for (const type of c.handles) {
        lines.push("```bash");
        lines.push(`cb create box/commands/<name>.${type}.card`);
        lines.push("```");
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Ensure CLAUDE.md has the @-include for the agent guide.
 *
 * If CLAUDE.md doesn't exist, create it with just the include.
 * If it exists but lacks the include, prepend it.
 * Never overwrite hand-edited content.
 */
async function ensureClaudeMdInclude(boxRoot: string): Promise<void> {
  const claudePath = join(boxRoot, "CLAUDE.md");

  let content: string;
  try {
    content = await readFile(claudePath, "utf-8");
  } catch {
    // No CLAUDE.md — create one with just the include
    await writeFile(claudePath, INCLUDE_LINE + "\n");
    return;
  }

  if (content.includes(INCLUDE_LINE)) {
    return; // Already has it
  }

  // Prepend the include line
  await writeFile(claudePath, INCLUDE_LINE + "\n\n" + content);
}
