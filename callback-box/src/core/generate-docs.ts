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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import type { ZodTypeAny } from "zod";
import { parseCard } from "cardworks";
import { schemas, loadBoxSchemas } from "../schemas/registry.js";
import type { ElementSchema } from "cardworks";
import { getAllTemplates, getTemplatesForCardType, describeTemplateArgs } from "../schemas/templates.js";
import { parseGuide, compileGuide, type Guide } from "../schemas/guide.js";
import { parsePersonality, compilePersonality, compileSpeakingVoice, type Personality } from "../schemas/personality.js";
import { compileBriefing, type BriefingFields } from "../schemas/briefing.js";
import { parseCardText } from "./card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import { generateViewsDoc } from "./views-doc.js";
import { generateChatVoiceDoc } from "./chat-voice-doc.js";
import { generateNarrationModeDoc } from "./narration-mode-doc.js";
import { generatePythonToolsDoc } from "./python-tools-doc.js";
import { generateAgentGuide } from "./agent-guide/index.js";
import {
  installProcedures,
  installGuides,
  installPersonality,
  installBriefing,
  installSchedules,
} from "./box.js";
import { generateRules } from "./init-rules.js";
import { isRepo, hasCommits, getStatus, stageFiles, commitPaths } from "../cli/lib/git.js";

const execFileAsync = promisify(execFile);

const AGENT_GUIDE_DIR = ".callback-box";
const AGENT_GUIDE_FILE = "agent-guide.md";
const DOCS_DIR = "docs/generated";
const INCLUDE_LINE = `@.callback-box/${AGENT_GUIDE_FILE}`;
const GENERATE_MARKER = ".callback-box/docs-generated-at";

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
    name: "gmail",
    produces: ["email-thread", "email-message"],
    description: "Pulls emails from Gmail via IMAP. Creates thread directories with message cards and body text files.",
  },
  {
    name: "google-drive",
    produces: ["sheet", "doc"],
    description: "Two-way sync with Google Drive. Spreadsheets become `.sheet.card` files with JSON tabs; Google Docs become `.doc.card` files with sibling markdown. Push detects conflicts when remote changed since the last pull.",
  },
];

const DOCID_DEBUG_MARKER = ".callback-box/docid-debug";

/**
 * Get the current git commit hash of the callback-box repo.
 * Returns null if git is unavailable or this isn't a git repo.
 */
async function getCallbackBoxCommit(): Promise<string | null> {
  try {
    const cbRoot = new URL("../../", import.meta.url);
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: cbRoot.pathname,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export interface GenerateDocsOptions {
  /** Add DOCID markers to each generated file for debugging prompt inclusion.
   *  If not specified, checks for a `.callback-box/docid-debug` marker file. */
  docIdDebug?: boolean | undefined;
  /** Bypass the input-mtime / source-commit cache and regenerate everything.
   *  Use during dev when source has uncommitted changes that affect output,
   *  or in test infrastructure where stale docs would invalidate results. */
  force?: boolean | undefined;
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
 * Scan procedure cards and extract name + first-line description.
 */
export interface ProcedureSummary {
  name: string;
  filename: string;
  description: string;
}

async function scanProcedures(boxRoot: string): Promise<ProcedureSummary[]> {
  const procedureDir = join(boxRoot, "config/procedures");
  let files: string[];
  try {
    files = await readdir(procedureDir);
  } catch {
    return [];
  }

  const cards = files.filter((f) => f.endsWith(".procedure.card")).toSorted();
  const results: ProcedureSummary[] = [];

  for (const filename of cards) {
    try {
      const content = await readFile(join(procedureDir, filename), "utf-8");
      const root = await parseCard(content, { source: filename });
      const name = root.attrs["name"] ?? filename.replace(".procedure.card", "");
      const descEl = (root.children ?? []).find(
        (c: { tagName?: string }) => c.tagName === "description"
      );
      const desc = (descEl as { text?: string })?.text?.trim() ?? "";
      // Take just the first sentence/line for the compact index
      const shortDesc = desc.split(/\n/)[0]?.replace(/\.\s.*/, ".").trim() || desc;
      results.push({ name, filename, description: shortDesc });
    } catch {
      // Skip unparseable procedure cards
      results.push({
        name: filename.replace(".procedure.card", ""),
        filename,
        description: "(could not parse)",
      });
    }
  }

  return results;
}

/**
 * Collect mtimes of all input files that affect doc generation.
 * Returns the newest mtime found, or 0 if no inputs exist.
 */
async function newestInputMtime(boxRoot: string): Promise<number> {
  let newest = 0;

  const check = async (filePath: string) => {
    try {
      const s = await stat(filePath);
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    } catch {
      // File doesn't exist — skip
    }
  };

  const checkDir = async (dirPath: string, pattern: RegExp) => {
    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      return;
    }
    for (const f of files) {
      if (pattern.test(f)) {
        await check(join(dirPath, f));
      }
    }
  };

  // Config-level inputs
  await checkDir(join(boxRoot, "config"), /\.(guide|personality)\.card$/);
  await checkDir(join(boxRoot, "config/procedures"), /\.procedure\.card$/);
  await checkDir(join(boxRoot, "config/schemas"), /\.ts$/);

  // Briefing cards (root + any subdirectory)
  await check(join(boxRoot, "briefing.briefing.card"));

  // Per-chat guide cards
  const chatRoot = join(boxRoot, "store/chat");
  try {
    const connectors = await readdir(chatRoot);
    for (const connector of connectors) {
      const connectorDir = join(chatRoot, connector);
      let slugs: string[];
      try {
        slugs = await readdir(connectorDir);
      } catch {
        continue;
      }
      for (const slug of slugs) {
        await check(join(connectorDir, slug, "chat.guide.card"));
      }
    }
  } catch {
    // No store/chat directory
  }

  return newest;
}

/**
 * Paths that the `install*` and `generateRules` helpers own. Used by
 * `syncTemplatesFromSource` to commit just their output without sweeping
 * up user work in progress. Glob-style globs avoided: simple regex over
 * relative paths is enough for what we generate.
 */
const TEMPLATE_MANAGED_PATTERNS: readonly RegExp[] = [
  /^config\/procedures\/.+\.(?:procedure|orig-procedure)\.card$/,
  /^config\/schedules\/.+\.(?:scheduled-script|orig-scheduled-script)\.card$/,
  /^config\/.+\.(?:guide|orig-guide)\.card$/,
  /^config\/.+\.(?:personality|orig-personality)\.card$/,
  /^config\/_template-updates\/.+$/,
  /^briefing\.(?:briefing|orig-briefing)\.card$/,
  /^briefing\.md$/,
  /^\.claude\/rules\/.+\.md$/,
];

function isTemplateManagedPath(relPath: string): boolean {
  return TEMPLATE_MANAGED_PATTERNS.some((re) => re.test(relPath));
}

/**
 * Re-install upstream templates (procedures, guides, schedules, personality,
 * briefing, card rules) into the box. Each install* helper is idempotent and
 * only writes when the upstream template differs from the box's copy. Runs
 * inside generateDocs's cache-invalidated path, so it fires when the
 * callback-box source has changed (typically right after a deploy) and is a
 * no-op otherwise.
 *
 * Any tracked-file changes the helpers leave behind get committed in a
 * single surgical commit so the box's working tree doesn't accumulate drift
 * on hosts that don't routinely run `cb tick` (which would otherwise sweep
 * the changes via its post-script housekeeping commit).
 */
async function syncTemplatesFromSource(boxRoot: string): Promise<void> {
  await installProcedures(boxRoot);
  await installGuides(boxRoot);
  await installPersonality(boxRoot);
  await installBriefing(boxRoot);
  await installSchedules(boxRoot);
  await generateRules(boxRoot);

  await commitTemplateSyncChanges(boxRoot);
}

/**
 * Commit any template-managed paths the install/generateRules helpers
 * dirtied, leaving user work in progress (in other paths) alone.
 */
async function commitTemplateSyncChanges(boxRoot: string): Promise<void> {
  if (!(await isRepo(boxRoot))) return;
  if (!(await hasCommits(boxRoot))) return;

  const status = await getStatus(boxRoot);
  const candidates = [
    ...status.staged,
    ...status.modified,
    ...status.untracked,
  ];
  const toCommit = candidates.filter(isTemplateManagedPath);
  if (toCommit.length === 0) return;

  // Stage explicitly so untracked files are picked up by `commit -- <paths>`.
  await stageFiles(boxRoot, toCommit);
  await commitPaths(boxRoot, {
    paths: toCommit,
    message: "Sync templates from upstream",
    trailers: { "Triggered-By": "generateDocs" },
  });
}

/**
 * Generate all agent documentation for a box.
 */
export async function generateDocs(boxRoot: string, options: GenerateDocsOptions = {}): Promise<void> {
  // TEMPORARY — diagnose unexpected writes to the callback-box source repo
  // (`.callback-box/` and `docs/generated/` showing up here as untracked).
  // Remove once the caller is identified.
  if (boxRoot.endsWith("/callback/callback-box") || boxRoot.endsWith("/src/callback/callback-box")) {
    console.warn(`[generateDocs:DIAG] called with boxRoot=${boxRoot}`);
    console.warn(new Error("generateDocs called against the callback-box repo").stack);
  }

  // Fast path: skip if no input files changed and source code unchanged.
  // Skipped entirely when force is set — see GenerateDocsOptions.force for why.
  const markerPath = join(boxRoot, GENERATE_MARKER);
  const inputMtime = await newestInputMtime(boxRoot);
  const currentCommit = await getCallbackBoxCommit();
  if (!options.force) {
    try {
      const markerStat = await stat(markerPath);
      const markerContent = await readFile(markerPath, "utf-8");
      const storedCommit = markerContent.split("\n")[1] || null;
      const mtimeUnchanged = inputMtime > 0 && inputMtime <= markerStat.mtimeMs;
      const commitUnchanged = currentCommit !== null && storedCommit === currentCommit;
      if (mtimeUnchanged && commitUnchanged) {
        return; // Nothing changed — skip regeneration
      }
    } catch (_e) {
      // No marker file — first run, generate everything
    }
  }

  // Sync templates from upstream callback-box source. Idempotent — only
  // writes files where the box's copy differs (and emits .orig-*.card
  // entries when the user modified a template). Runs before doc generation
  // so newly-installed procedures are picked up by scanProcedures().
  await syncTemplatesFromSource(boxRoot);

  const debug = options.docIdDebug ?? await hasDocIdMarker(boxRoot);

  await mkdir(join(boxRoot, AGENT_GUIDE_DIR), { recursive: true });
  await mkdir(join(boxRoot, DOCS_DIR), { recursive: true });

  const procedures = await scanProcedures(boxRoot);

  // Load box-local schemas alongside built-in ones
  const boxSchemas = await loadBoxSchemas(boxRoot);
  const allSchemas = [...schemas, ...boxSchemas];

  // Compile personality first so we can include it in the agent guide
  const personalitySection = await compilePersonalities(boxRoot, debug);

  await Promise.all([
    writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
      withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: generateAgentGuide({ procedures, allSchemas, personalitySection }), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "cb-commands.md"),
      withDocId({ relativePath: `${DOCS_DIR}/cb-commands.md`, content: generateCbCommands(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "connectors.md"),
      withDocId({ relativePath: `${DOCS_DIR}/connectors.md`, content: generateConnectorsDocs(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "views.md"),
      withDocId({ relativePath: `${DOCS_DIR}/views.md`, content: generateViewsDoc(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "chat-voice.md"),
      withDocId({ relativePath: `${DOCS_DIR}/chat-voice.md`, content: generateChatVoiceDoc(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "narration-mode.md"),
      withDocId({ relativePath: `${DOCS_DIR}/narration-mode.md`, content: generateNarrationModeDoc(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "procedures.md"),
      withDocId({ relativePath: `${DOCS_DIR}/procedures.md`, content: generateProcedureGuide(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "python-tools.md"),
      withDocId({ relativePath: `${DOCS_DIR}/python-tools.md`, content: generatePythonToolsDoc(), debug })),
    ...allSchemas
      .filter((s) => s.instructions)
      .map((s) => {
        const filename = `card-${s.tagName}.md`;
        return writeFile(join(boxRoot, DOCS_DIR, filename),
          withDocId({ relativePath: `${DOCS_DIR}/${filename}`, content: generateCardDoc(s.tagName, allSchemas), debug }));
      }),
  ]);

  // Compile guides and generate job-type rules
  const guides = await compileGuides(boxRoot, debug);

  // Rewrite agent guide now that we have guide summaries
  await writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
    withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: generateAgentGuide({ procedures, allSchemas, personalitySection, guides }), debug }));

  // Compile briefing cards to .md files
  const briefingPaths = await compileBriefings(boxRoot, debug);

  await ensureClaudeMdIncludes(boxRoot, briefingPaths);

  // Write marker so next call can skip if nothing changed
  const commitLine = currentCommit ? `\n${currentCommit}` : "";
  await writeFile(markerPath, new Date().toISOString() + commitLine);
}

/**
 * Find and compile all briefing.briefing.card files in the box.
 *
 * Each briefing card is compiled to a .md file next to the .card file.
 * Returns the list of compiled briefing paths (relative to box root)
 * so CLAUDE.md can include them.
 */
async function compileBriefings(boxRoot: string, debug: boolean): Promise<string[]> {
  const compiledPaths: string[] = [];

  // Check root briefing
  const rootBriefingPath = join(boxRoot, "briefing.briefing.card");
  try {
    const content = await readFile(rootBriefingPath, "utf-8");
    const parsed = parseCardText(content, {
      source: "briefing.briefing.card",
      schemas: createCardSchemaMap(),
    });
    const compiled = compileBriefing(parsed.fields as unknown as BriefingFields);
    const mdPath = join(boxRoot, "briefing.md");
    await writeFile(
      mdPath,
      withDocId({ relativePath: "briefing.md", content: compiled, debug })
    );
    compiledPaths.push("briefing.md");
  } catch {
    // No root briefing or parse error — skip
  }

  // TODO: scan subdirectories for directory briefings in the future
  // For now, only the root briefing is supported

  return compiledPaths;
}

/**
 * Scan config/*.guide.card, compile each, and generate job-type rules.
 * Also scan per-chat guide cards in store/chat/ directories.
 * Returns summaries of config-level guides (for inclusion in agent guide).
 */
async function compileGuides(boxRoot: string, debug: boolean): Promise<GuideSummary[]> {
  const rulesDir = join(boxRoot, ".claude/rules");
  await mkdir(rulesDir, { recursive: true });

  const ctx = { boxRoot, rulesDir, debug };
  const guides = await compileConfigGuides(ctx);
  await compileChatGuides(ctx);
  return guides;
}

interface GuideCompileContext {
  boxRoot: string;
  rulesDir: string;
  debug: boolean;
}

/**
 * Summary of a compiled guide, for inclusion in the agent guide.
 */
export interface GuideSummary {
  name: string;
  guidePath: string;
  compiledPath: string;
  appliesTo: string;
  jobTypes: string[];
}

/**
 * Compile config/*.guide.card and generate job-type rules.
 * Returns summaries of all compiled guides.
 */
async function compileConfigGuides(ctx: GuideCompileContext): Promise<GuideSummary[]> {
  const { boxRoot, rulesDir, debug } = ctx;
  const configDir = join(boxRoot, "config");
  let files: string[];
  try {
    files = await readdir(configDir);
  } catch {
    return [];
  }

  const guideFiles = files.filter((f) => f.endsWith(".guide.card"));
  if (guideFiles.length === 0) return [];

  // job-type → list of { guidePath, appliesTo, compiledPath }
  const jobTypeMap = new Map<string, Array<{ guidePath: string; appliesTo: string; compiledPath: string }>>();
  const allGuides: GuideSummary[] = [];

  for (const filename of guideFiles) {
    const guidePath = `config/${filename}`;
    const guideName = filename.replace(".guide.card", "");

    try {
      const content = await readFile(join(configDir, filename), "utf-8");
      const root = await parseCard(content, { source: filename }) as Guide;
      const parsed = parseGuide(root);
      const compiled = compileGuide(parsed, guideName);
      const compiledFilename = `${guideName}-guide.md`;
      const compiledPath = `${DOCS_DIR}/${compiledFilename}`;

      await writeFile(
        join(boxRoot, compiledPath),
        withDocId({ relativePath: compiledPath, content: compiled, debug })
      );

      allGuides.push({
        name: guideName,
        guidePath,
        compiledPath,
        appliesTo: parsed.appliesTo ?? "",
        jobTypes: parsed.jobTypes,
      });

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

  return allGuides;
}

/**
 * Scan per-chat directory guide cards (chat.guide.card) under store/chat/.
 * Each guide compiles to a rule that loads when accessing files in that chat directory.
 */
async function compileChatGuides(ctx: GuideCompileContext): Promise<void> {
  const { boxRoot, rulesDir, debug } = ctx;
  const chatRoot = join(boxRoot, "store/chat");
  let connectors: string[];
  try {
    connectors = await readdir(chatRoot);
  } catch {
    return;
  }

  for (const connector of connectors) {
    const connectorDir = join(chatRoot, connector);
    let connectorStat;
    try {
      connectorStat = await stat(connectorDir);
    } catch {
      continue;
    }
    if (!connectorStat.isDirectory()) continue;

    let chatSlugs: string[];
    try {
      chatSlugs = await readdir(connectorDir);
    } catch {
      continue;
    }

    for (const slug of chatSlugs) {
      const guideFile = join(connectorDir, slug, "chat.guide.card");
      let content: string;
      try {
        content = await readFile(guideFile, "utf-8");
      } catch {
        continue; // No guide card for this chat
      }

      try {
        const root = await parseCard(content, { source: "chat.guide.card" }) as Guide;
        const parsed = parseGuide(root);
        const guideName = `chat-${connector}-${slug}`;
        const compiled = compileGuide(parsed, guideName);
        const compiledFilename = `${guideName}-guide.md`;
        const compiledPath = `${DOCS_DIR}/${compiledFilename}`;

        await writeFile(
          join(boxRoot, compiledPath),
          withDocId({ relativePath: compiledPath, content: compiled, debug })
        );

        // Generate a rule file scoped to this chat directory
        const chatDir = `store/chat/${connector}/${slug}`;
        const ruleFilename = `guide-for-chat-${connector}-${slug}.md`;
        const lines = [
          "---",
          "paths:",
          `  - "${chatDir}/**"`,
          "---",
          `# Chat Guide: ${slug.replace(/_/g, " ")}`,
          "",
          `This chat has behavioral guidelines. Read \`${compiledPath}\` before responding.`,
          "",
          `Source: \`${chatDir}/chat.guide.card\``,
          "",
        ];

        await writeFile(join(rulesDir, ruleFilename), lines.join("\n"));
      } catch {
        // Skip unparseable guide cards
      }
    }
  }
}

/**
 * Scan config/*.personality.card, compile each, and return the compiled markdown
 * and speaking-voice JSON.
 */
async function compilePersonalities(boxRoot: string, debug: boolean): Promise<string | undefined> {
  const configDir = join(boxRoot, "config");
  let files: string[];
  try {
    files = await readdir(configDir);
  } catch (_e) {
    return undefined;
  }

  const personalityFiles = files.filter((f) => f.endsWith(".personality.card"));
  if (personalityFiles.length === 0) return undefined;

  // Only support one personality card (main) for now
  const filename = personalityFiles[0]!;
  const personalityName = filename.replace(".personality.card", "");

  try {
    const content = await readFile(join(configDir, filename), "utf-8");
    const root = await parseCard(content, { source: filename }) as Personality;
    const parsed = parsePersonality(root);
    const compiled = compilePersonality(parsed);
    const compiledFilename = `personality-${personalityName}.md`;
    const compiledPath = `${DOCS_DIR}/${compiledFilename}`;

    await writeFile(
      join(boxRoot, compiledPath),
      withDocId({ relativePath: compiledPath, content: compiled, debug })
    );

    // Write speaking-voice JSON for Electron consumption
    const voice = compileSpeakingVoice(parsed);
    const voicePath = `${DOCS_DIR}/speaking-voice.json`;
    await writeFile(
      join(boxRoot, voicePath),
      JSON.stringify(voice, null, 2) + "\n"
    );

    return compiled;
  } catch (e) {
    console.error(`[generate-docs] Failed to compile personality ${filename}:`, e);
    return undefined;
  }
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
    'cb create box/inbox/my-note.memo.card content="Remember to check the logs"',
    "",
    "# Create a yes/no question",
    "cb create box/questions/confirm.question.card -t question-confirm \\",
    '  memo="The news brief is ready" prompt="Should I publish it?"',
    "",
    "# Create a scheduled script",
    'cb create config/schedules/check.scheduled-script.card runs="cb wakeup" cron="0 6 * * *"',
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
    "cb tick [--dry-run] [--script <name>] [--box <path>]",
    "```",
    "",
    "Checks all `config/schedules/*.scheduled-script.card` files against their cron/at/rrule schedules.",
    "Runs due scripts, updates last-run timestamps, and deletes one-shot (`once`) scripts after execution.",
    "",
    "**Options:**",
    "- `--dry-run` — Show which scripts would run without executing them",
    "- `--script <name>` — Only evaluate a specific script (by filename stem)",
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
  );

  return lines.join("\n");
}

/**
 * Generate a detailed doc for a single card type.
 */
function generateCardDoc(tagName: string, allSchemas: ElementSchema[] = schemas): string {
  const schema = allSchemas.find((s) => s.tagName === tagName);
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
    } else {
      lines.push("**Outbound only** — no cards produced.");
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate the procedures guide for agents.
 */
function generateProcedureGuide(): string {
  return `# Procedures

Procedures are multi-step processes defined as XML cards. The procedure engine runs each step in order, checking preconditions, executing actions, and validating results. Everything is tracked in git.

## Running Procedures

\`\`\`bash
cb procedure run process-news                       # Run by name
cb procedure run config/procedures/my.procedure.card  # Run by path
cb procedure run process-news --step triage         # Run one step only
cb procedure run process-news --dry-run             # Preview steps
cb procedure run process-news --directive "focus on AI stories"  # Pass directive
cb procedure list                                   # List available procedures
cb procedure status                                 # Show latest run status
\`\`\`

Procedure definitions live in \`config/procedures/\`. Each run creates a tracking card in \`procedure/runs/<name>_<timestamp>/\`.

## Directives

A **directive** is an opaque runtime string passed when invoking a procedure. It appears as \`<directive>...</directive>\` in every agent's system prompt within the procedure, allowing callers to customize behavior without modifying the procedure card.

\`\`\`bash
cb procedure run process-news --directive "Only include stories about AI safety"
\`\`\`

The directive is also recorded as an attribute on the \`<procedure-run>\` element for auditability. Step prompts can reference "the Directive" to act on it.

## Procedures in Jobs

Job cards can trigger a procedure directly using the \`<procedure>\` element:

\`\`\`xml
<some-job-type>
<procedure ref="process-news">
<directive>Focus on technology stories</directive>
</procedure>
</some-job-type>
\`\`\`

The reactor detects \`<procedure ref="...">\` in job cards and runs the procedure engine directly — no nested agent session is needed. The job is automatically finished when the procedure completes. If the procedure fails, the job remains for retry.

## How Steps Work

Each step has three optional phases:

1. **Precheck** — Should this step run? Shell script that exits 0 (proceed), \`$CHECK_SKIP\` (skip), or non-zero (fail).
2. **Run** — The main action: a shell command or an agent invocation.
3. **Validate** — Did it work? Shell check + optional model evaluation.

The engine enforces a clean git state between steps. Every step's work is committed before the next step begins.

## Procedure Card Structure

\`\`\`xml
<procedure name="my-procedure">
<description>What this procedure does</description>
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
(date, procedure name, step ID, working directory).
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
</procedure>
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
- The engine injects a context block with the date, run card path, step ID, and procedure source location.
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
- \`severity="abort"\` — Stop the procedure immediately

### Why Elements

\`<why>\` elements explain the purpose of a phase. They're shown to:
- Humans reading the procedure
- Review models evaluating validation failures
- Agents retrying failed steps

## Writing a New Procedure

1. Create \`config/procedures/my-procedure.procedure.card\`
2. Define steps with prechecks that skip gracefully when there's nothing to do
3. Use \`cb procedure run my-procedure --dry-run\` to verify the structure
4. Test step-by-step with \`--step <id>\`

### Tips

- **Prechecks should be fast.** They run every time. Don't do expensive work in prechecks — save that for the run phase.
- **One concern per step.** Each step should do one thing. If a step needs 40+ agent turns, consider splitting it.
- **Idempotent steps.** If a procedure is interrupted, it may be re-run. Steps should handle partial state gracefully.
- **Commit messages matter.** Agents should commit with descriptive messages. The git history IS the audit trail.
- **Use \`cb mv\` not \`mv\`.** Card moves update cross-references. Agents in procedure steps should use \`cb mv\` for cards.

### Agent Prompt Guidelines

Agent prompts in procedures should:
- Start with a clear role statement ("You are triaging inbox items...")
- List concrete steps (STEP 1, STEP 2, etc.)
- Include exact shell/command examples the agent can copy
- Include a commit step marked "REQUIRED — do not skip" with the expected message format
- End with "GIT: Do NOT add Co-Authored-By to commits."

**Important:** If an agent doesn't commit, the engine creates a fallback commit with a generic message (tagged \`Commit-Source: procedure-fallback\`). Always instruct agents to commit explicitly so the git history is meaningful.

## System Procedures and Migration

Procedure cards in \`config/procedures/\` are installed by \`cb init\` from built-in templates. If you edit a system procedure, your changes are preserved:

- **\`cb init\` on a fresh box**: Templates are copied directly.
- **\`cb init\` on an existing box (unchanged procedures)**: Templates are updated in place.
- **\`cb init\` on an existing box (modified procedures)**: The new template is parked under \`config/_template-updates/procedures/<name>.procedure.card\` so you can diff and merge manually. The active file at \`config/procedures/<name>.procedure.card\` is left untouched.

To check for updates:
\`\`\`bash
ls config/_template-updates/procedures/
# If any exist, compare with the main version and merge changes
diff config/procedures/process-news.procedure.card config/_template-updates/procedures/process-news.procedure.card
\`\`\`

After merging, delete the file under \`config/_template-updates/procedures/\`. The next \`cb init\` will see your merged version as the current copy.

## Git History

A complete procedure run produces commits like:

\`\`\`
abc123f Complete procedure: process-news
abc123e [procedure] Complete step: brief
abc123d Brief: The Specification Problem           ← agent commit
abc123c [procedure] Complete step: analyze
abc123b Analyze 5 items                            ← agent commit
abc123a [procedure] Complete step: fetch
abc1239 [procedure] Complete step: triage
abc1238 Triage: 5/12 items kept                    ← agent commit
abc1237 Start procedure: process-news
\`\`\`

Each commit represents a clean, consistent state. You can \`git reset --hard\` to any commit to get a valid snapshot.
`;
}

/**
 * Ensure CLAUDE.md has the @-include for the agent guide and any compiled briefings.
 *
 * If CLAUDE.md doesn't exist, create it with the includes.
 * Adds missing includes and removes stale briefing includes.
 * Never overwrite hand-edited content.
 */
async function ensureClaudeMdIncludes(boxRoot: string, briefingPaths: string[]): Promise<void> {
  const claudePath = join(boxRoot, "CLAUDE.md");

  // All lines that should be @-included (in order)
  const requiredIncludes = [
    INCLUDE_LINE,
    ...briefingPaths.map((p) => `@${p}`),
  ];

  let content: string;
  try {
    content = await readFile(claudePath, "utf-8");
  } catch {
    // No CLAUDE.md — create one with all includes
    const seed = [
      ...requiredIncludes,
      "",
    ].join("\n");
    await writeFile(claudePath, seed);
    return;
  }

  const lines = content.split("\n");
  let changed = false;

  // Add any missing required includes at the top
  for (const include of requiredIncludes) {
    if (!content.includes(include)) {
      // Find where to insert — after the last existing @-include at the top, or at position 0
      let insertAt = 0;
      for (const [idx, line] of lines.entries()) {
        if (line.startsWith("@")) {
          insertAt = idx + 1;
        } else if (line.trim() !== "") {
          break;
        }
      }
      lines.splice(insertAt, 0, include);
      changed = true;
    }
  }

  // Remove stale briefing @-includes (briefing .md files that no longer exist)
  const beforeLength = lines.length;
  const filtered = lines.filter((line) => {
    if (line.startsWith("@") && line.endsWith(".md") && line !== INCLUDE_LINE) {
      if (line.includes("briefing") && !requiredIncludes.includes(line)) {
        return false;
      }
    }
    return true;
  });
  if (filtered.length !== beforeLength) {
    lines.length = 0;
    lines.push(...filtered);
    changed = true;
  }

  if (changed) {
    await writeFile(claudePath, lines.join("\n"));
  }
}
