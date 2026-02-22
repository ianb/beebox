/**
 * Generate agent documentation for a callback box.
 *
 * Produces two categories of docs:
 * 1. `.callback-box/agent-guide.md` — compact, always-loaded via @-include in CLAUDE.md
 * 2. `docs/generated/*.md` — detailed reference docs, read on demand by agents
 *
 * Called by `cb init` and at the start of `cb reactor`.
 */

import { join } from "node:path";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import type { ZodTypeAny } from "zod";
import { parseXml } from "cardworks";
import { schemas } from "../schemas/registry.js";
import { getAllTemplates, getTemplatesForCardType, describeTemplateArgs } from "../schemas/templates.js";
import { parseGuide, compileGuide, type Guide } from "../schemas/guide.js";

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
  produces: string[];
  description: string;
}

const CONNECTORS: ConnectorInfo[] = [
  {
    name: "rss",
    produces: ["news-item", "news-job"],
    description: "Pulls RSS/Atom feeds and creates news-item cards. Creates a news job in `box/jobs/` when new items arrive.",
  },
  {
    name: "raindrop",
    produces: ["bookmark"],
    description: "Syncs bookmarks with Raindrop.io.",
  },
  {
    name: "dropbox",
    produces: ["memo"],
    description: "Relays browser notifications via Dropbox.",
  },
  {
    name: "gmail",
    produces: ["email-thread", "email-message"],
    description: "Pulls emails from Gmail via IMAP. Creates thread directories with message cards and body text files.",
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
 * Parameters for withDocId
 */
interface WithDocIdParams {
  relativePath: string;
  content: string;
  debug: boolean;
}

/**
 * Optionally prepend a DOCID marker comment to content.
 * Uses the relative path from box root, e.g. "DOCID:docs/generated/card-question.md"
 */
function withDocId(params: WithDocIdParams): string {
  const { relativePath, content, debug } = params;
  if (!debug) return content;
  return `<!-- DOCID:${relativePath} -->\n${content}`;
}

/**
 * Scan workflow cards and extract name + first-line description.
 */
interface WorkflowSummary {
  name: string;
  filename: string;
  description: string;
}

async function scanWorkflows(boxRoot: string): Promise<WorkflowSummary[]> {
  const workflowDir = join(boxRoot, "config/workflows");
  let files: string[];
  try {
    files = await readdir(workflowDir);
  } catch {
    return [];
  }

  const cards = files.filter((f) => f.endsWith(".workflow.card")).toSorted();
  const results: WorkflowSummary[] = [];

  for (const filename of cards) {
    try {
      const content = await readFile(join(workflowDir, filename), "utf-8");
      const root = await parseXml(content, filename);
      const name = root.attrs["name"] ?? filename.replace(".workflow.card", "");
      const descEl = (root.children ?? []).find(
        (c: { tagName?: string }) => c.tagName === "description"
      );
      const desc = (descEl as { text?: string })?.text?.trim() ?? "";
      // Take just the first sentence/line for the compact index
      const shortDesc = desc.split(/\n/)[0]?.replace(/\.\s.*/, ".").trim() || desc;
      results.push({ name, filename, description: shortDesc });
    } catch {
      // Skip unparseable workflow cards
      results.push({
        name: filename.replace(".workflow.card", ""),
        filename,
        description: "(could not parse)",
      });
    }
  }

  return results;
}

/**
 * Generate all agent documentation for a box.
 */
export async function generateDocs(boxRoot: string, options: GenerateDocsOptions = {}): Promise<void> {
  const debug = options.docIdDebug ?? await hasDocIdMarker(boxRoot);

  await mkdir(join(boxRoot, AGENT_GUIDE_DIR), { recursive: true });
  await mkdir(join(boxRoot, DOCS_DIR), { recursive: true });

  const workflows = await scanWorkflows(boxRoot);

  await Promise.all([
    writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
      withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: generateAgentGuide(workflows), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "cb-commands.md"),
      withDocId({ relativePath: `${DOCS_DIR}/cb-commands.md`, content: generateCbCommands(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "connectors.md"),
      withDocId({ relativePath: `${DOCS_DIR}/connectors.md`, content: generateConnectorsDocs(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "workflows.md"),
      withDocId({ relativePath: `${DOCS_DIR}/workflows.md`, content: generateWorkflowGuide(), debug })),
    ...schemas
      .filter((s) => s.instructions)
      .map((s) => {
        const filename = `card-${s.tagName}.md`;
        return writeFile(join(boxRoot, DOCS_DIR, filename),
          withDocId({ relativePath: `${DOCS_DIR}/${filename}`, content: generateCardDoc(s.tagName), debug }));
      }),
  ]);

  // Compile guides and generate job-type rules
  await compileGuides(boxRoot, debug);

  await ensureClaudeMdInclude(boxRoot);
}

/**
 * Scan config/*.guide.card, compile each, and generate job-type rules.
 */
async function compileGuides(boxRoot: string, debug: boolean): Promise<void> {
  const configDir = join(boxRoot, "config");
  let files: string[];
  try {
    files = await readdir(configDir);
  } catch {
    return;
  }

  const guideFiles = files.filter((f) => f.endsWith(".guide.card"));
  if (guideFiles.length === 0) return;

  // job-type → list of { guidePath, appliesTo, compiledPath }
  const jobTypeMap = new Map<string, Array<{ guidePath: string; appliesTo: string; compiledPath: string }>>();

  const rulesDir = join(boxRoot, ".claude/rules");
  await mkdir(rulesDir, { recursive: true });

  for (const filename of guideFiles) {
    const guidePath = `config/${filename}`;
    const guideName = filename.replace(".guide.card", "");

    try {
      const content = await readFile(join(configDir, filename), "utf-8");
      const root = await parseXml(content, filename) as Guide;
      const parsed = parseGuide(root);
      const compiled = compileGuide(parsed, guideName);
      const compiledFilename = `${guideName}-guide.md`;
      const compiledPath = `${DOCS_DIR}/${compiledFilename}`;

      await writeFile(
        join(boxRoot, compiledPath),
        withDocId({ relativePath: compiledPath, content: compiled, debug })
      );

      // Collect job-type mappings
      for (const jobType of parsed.jobTypes) {
        if (!jobTypeMap.has(jobType)) {
          jobTypeMap.set(jobType, []);
        }
        jobTypeMap.get(jobType)!.push({
          guidePath,
          appliesTo: parsed.appliesTo ?? "",
          compiledPath,
        });
      }
    } catch {
      // Skip unparseable guide cards
    }
  }

  // Generate a rule file for each job type
  for (const [jobType, guides] of jobTypeMap) {
    const ruleFilename = `guides-for-${jobType}.md`;
    const lines: string[] = [
      "---",
      "paths:",
      `  - "**/*.${jobType}.card"`,
      "---",
      "# Applicable Guides",
      "",
      "The following guides may help with processing this job. Read the relevant one(s):",
      "",
    ];

    for (const g of guides) {
      lines.push(`- **${g.guidePath}** — ${g.appliesTo}`);
      lines.push(`  Compiled reference: \`${g.compiledPath}\``);
    }
    lines.push("");

    await writeFile(join(rulesDir, ruleFilename), lines.join("\n"));
  }
}

/**
 * Generate the compact agent guide (always loaded via @-include).
 */
function generateAgentGuide(workflows: WorkflowSummary[]): string {
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
    "| `box/jobs/` | Pending job cards for the reactor to process |",
    "| `box/questions/` | Pending questions for the user |",
    "| `box/resources/` | Synced external state |",
    "| `box/output/` | Produced content (briefs, etc.) |",
    "| `box/pool/` | Items being actively worked on |",
    "| `store/archive/` | Processed/completed items |",
    "| `store/integrated/` | Feedback absorbed into guides |",
    "| `store/recipes/` | Recipe collection (subdirectories for organization) |",
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
    "- `cb reactor` — Process all pending jobs in `box/jobs/`",
    "- `cb scenario list|run` — Run scenario tests against boxes",
    "- `cb finish <job-file>` — Complete a job (deletes the job card and commits)",
    "- `cb workflow run <name-or-path>` — Run a workflow (see `docs/generated/workflows.md`)",
    "",
  ];

  // Workflow index (dynamic, scanned from box)
  if (workflows.length > 0) {
    lines.push(
      "## Workflows",
      "",
      "Available workflows in `config/workflows/`:",
      "",
    );
    for (const w of workflows) {
      lines.push(`- **${w.name}** — ${w.description}`);
    }
    lines.push("");
    lines.push("Run with `cb workflow run <name>`. See `docs/generated/workflows.md` for authoring details.");
    lines.push("");
  }

  // Schedules section
  lines.push(
    "## Schedules",
    "",
    "Scheduled scripts in `config/schedules/` automate recurring tasks (connector syncs, maintenance, custom jobs).",
    "Each is a `.scheduled-script.card` with a cron/at/rrule schedule.",
    "",
    "- `cb tick` — evaluate and run due schedules",
    "- `cb scheduled` — list all schedules with status and last-run time",
    "",
    "Agents can create or modify scheduled scripts for custom automation.",
    "See `docs/generated/card-scheduled-script.md` for the full schema.",
    "",
  );

  lines.push(
    "## Card Types",
    "",
  );

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
  lines.push("- This guide and `docs/generated/` are code-generated by `cb init`. If docs seem stale, re-run `cb init` to regenerate.");
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
    "cb create box/questions/confirm.question.card -t question-confirm \\",
    '  -m "The news brief is ready" -p "Should I publish it?"',
    "",
    "# Create a select question",
    "cb create box/questions/pick.question.card \\",
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
    "## cb workflow",
    "",
    "Run and manage declarative workflows. See `docs/generated/workflows.md` for details.",
    "",
    "```bash",
    "cb workflow run <name-or-path>          # Run a workflow",
    "cb workflow run <name> --step <id>      # Run a single step",
    "cb workflow run <name> --dry-run        # Preview without executing",
    "cb workflow list                        # List available workflows",
    "cb workflow status [run-dir]            # Show status of latest/specific run",
    "```",
    "",
    "The `<name-or-path>` argument can be a bare name (resolves to `config/workflows/<name>.workflow.card`)",
    "or a direct path to any `.workflow.card` file.",
    "",
    "## cb tick",
    "",
    "Evaluate scheduled scripts and run any that are due.",
    "",
    "```",
    "cb tick [--dry-run] [--time <iso-datetime>]",
    "```",
    "",
    "Checks all `config/schedules/*.scheduled-script.card` files against their cron/at/rrule schedules.",
    "Runs due scripts, updates last-run timestamps, and deletes one-shot (`once`) scripts after execution.",
    "",
    "**Options:**",
    "- `--dry-run` — Show which scripts would run without executing them",
    "- `--time <iso-datetime>` — Override the current time for evaluation",
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
      lines.push(`**Produces:** ${c.produces.map((t) => `\`${t}\``).join(", ")} (via \`cb wakeup\`)`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate the workflows guide for agents.
 */
function generateWorkflowGuide(): string {
  return `# Workflows

Workflows are multi-step processes defined as XML cards. The workflow engine runs each step in order, checking preconditions, executing actions, and validating results. Everything is tracked in git.

## Running Workflows

\`\`\`bash
cb workflow run process-news                    # Run by name
cb workflow run config/workflows/my.workflow.card  # Run by path
cb workflow run process-news --step triage      # Run one step only
cb workflow run process-news --dry-run          # Preview steps
cb workflow list                                # List available workflows
cb workflow status                              # Show latest run status
\`\`\`

Workflow definitions live in \`config/workflows/\`. Each run creates a tracking card in \`workflow/runs/<name>_<timestamp>/\`.

## How Steps Work

Each step has three optional phases:

1. **Precheck** — Should this step run? Shell script that exits 0 (proceed), \`$CHECK_SKIP\` (skip), or non-zero (fail).
2. **Run** — The main action: a shell command or an agent invocation.
3. **Validate** — Did it work? Shell check + optional model evaluation.

The engine enforces a clean git state between steps. Every step's work is committed before the next step begins.

## Workflow Card Structure

\`\`\`xml
<workflow name="my-workflow">
  <description>What this workflow does</description>

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
        (date, workflow name, step ID, working directory).
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
</workflow>
\`\`\`

## Building Blocks

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
- The engine injects a context block with the date, run card path, step ID, and workflow source location.
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
- \`severity="abort"\` — Stop the workflow immediately

### Why Elements

\`<why>\` elements explain the purpose of a phase. They're shown to:
- Humans reading the workflow
- Review models evaluating validation failures
- Agents retrying failed steps

## Writing a New Workflow

1. Create \`config/workflows/my-workflow.workflow.card\`
2. Define steps with prechecks that skip gracefully when there's nothing to do
3. Use \`cb workflow run my-workflow --dry-run\` to verify the structure
4. Test step-by-step with \`--step <id>\`

### Tips

- **Prechecks should be fast.** They run every time. Don't do expensive work in prechecks — save that for the run phase.
- **One concern per step.** Each step should do one thing. If a step needs 40+ agent turns, consider splitting it.
- **Idempotent steps.** If a workflow is interrupted, it may be re-run. Steps should handle partial state gracefully.
- **Commit messages matter.** Agents should commit with descriptive messages. The git history IS the audit trail.
- **Use \`cb move\` not \`mv\`.** Card moves update cross-references. Agents in workflow steps should use \`cb move\` for cards.

### Agent Prompt Guidelines

Agent prompts in workflows should:
- Start with a clear role statement ("You are triaging inbox items...")
- List concrete steps (STEP 1, STEP 2, etc.)
- Include exact shell/command examples the agent can copy
- Include a commit step marked "REQUIRED — do not skip" with the expected message format
- End with "GIT: Do NOT add Co-Authored-By to commits."

**Important:** If an agent doesn't commit, the engine creates a fallback commit with a generic message (tagged \`Commit-Source: workflow-fallback\`). Always instruct agents to commit explicitly so the git history is meaningful.

## System Workflows and Migration

Workflow cards in \`config/workflows/\` are installed by \`cb init\` from built-in templates. If you edit a system workflow, your changes are preserved:

- **\`cb init\` on a fresh box**: Templates are copied directly.
- **\`cb init\` on an existing box (unchanged workflows)**: Templates are updated in place.
- **\`cb init\` on an existing box (modified workflows)**: The new template is written as \`<name>.orig-workflow.card\` alongside your modified version. You can diff them and merge manually.

To check for updates:
\`\`\`bash
ls config/workflows/*.orig-workflow.card
# If any exist, compare with the main version and merge changes
diff config/workflows/process-news.workflow.card config/workflows/process-news.orig-workflow.card
\`\`\`

After merging, delete the \`.orig-workflow.card\` file. The next \`cb init\` will see your merged version as the current copy.

## Git History

A complete workflow run produces commits like:

\`\`\`
abc123f Complete workflow: process-news
abc123e [workflow] Complete step: brief
abc123d Brief: The Specification Problem           ← agent commit
abc123c [workflow] Complete step: analyze
abc123b Analyze 5 items                            ← agent commit
abc123a [workflow] Complete step: fetch
abc1239 [workflow] Complete step: triage
abc1238 Triage: 5/12 items kept                    ← agent commit
abc1237 Start workflow: process-news
\`\`\`

Each commit represents a clean, consistent state. You can \`git reset --hard\` to any commit to get a valid snapshot.
`;
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
