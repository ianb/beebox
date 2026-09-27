/**
 * Box-scanning and card-compilation helpers for doc generation.
 *
 * These functions read the box filesystem (config cards, per-chat guides,
 * briefings, personalities), compile them to markdown / rule files, and
 * return summaries the agent guide needs. Split out of generate-docs.ts so
 * the orchestration file stays focused on cache logic and top-level wiring.
 */

import { join } from "node:path";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { loadCardFrontmatter } from "../../frontmatter-field.js";
import { parseGuide, parseGuideCard } from "../../../schemas/guide/parse.js";
import { compileGuide } from "../../../schemas/guide/compile.js";
import { compileSpeakingVoice } from "../../../schemas/personality/schema.js";
import { compileBriefing, BriefingSchema } from "../../../schemas/briefing.js";
import { cardFields, parseCardText } from "../../card-io.js";
import { createCardSchemaMap } from "../../../schemas.js";
import { DOCS_DIR, withDocId } from "../shared.js";
import { pruneGuideRules } from "./guide-rules-prune.js";
import { readConfigGuides, readPersonality, type GuideSummary } from "../config-cards/core.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { getBoxDir, BOX_DIRS } from "../../../lib/paths/core.js";

/**
 * Scan procedure cards and extract name + first-line description.
 */
export interface ProcedureSummary {
  name: string;
  filename: string;
  description: string;
}

export async function scanProcedures(boxRoot: string): Promise<ProcedureSummary[]> {
  const procedureDir = getBoxDir(boxRoot, "procedures");
  let files: string[];
  try {
    files = await readdir(procedureDir);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`[generate-docs] could not read ${procedureDir}; assuming no procedures:`, e);
    }
    return [];
  }

  const cards = files.filter((f) => f.endsWith(".procedure.card")).toSorted();
  const results: ProcedureSummary[] = [];

  for (const filename of cards) {
    const fallbackName = filename.replace(".procedure.card", "");
    const fields = await loadCardFrontmatter(join(procedureDir, filename));
    if (fields === null) {
      // No readable frontmatter — index with a placeholder rather than dropping it.
      console.warn(`[generate-docs] could not read procedure frontmatter ${filename}`);
      results.push({ name: fallbackName, filename, description: "(could not parse)" });
      continue;
    }
    const nameField = fields["name"];
    const name = typeof nameField === "string" && nameField !== "" ? nameField : fallbackName;
    const descField = fields["description"];
    const desc = typeof descField === "string" ? descField.trim() : "";
    // Take just the first sentence/line for the compact index.
    const shortDesc = desc.split(/\n/)[0]?.replace(/\.\s.*/, ".").trim() || desc;
    results.push({ name, filename, description: shortDesc });
  }

  return results;
}

/**
 * Find and compile all briefing.briefing.card files in the box.
 *
 * Each briefing card is compiled to a .md file next to the .card file.
 * Returns the list of compiled briefing paths (relative to box root)
 * so CLAUDE.md can include them.
 */
export async function compileBriefings(boxRoot: string): Promise<string[]> {
  const compiledPaths: string[] = [];

  // Check root briefing
  const rootBriefingPath = join(boxRoot, "_content/briefing.briefing.card");
  try {
    const content = await readFile(rootBriefingPath, "utf-8");
    const parsed = parseCardText(content, {
      source: "_content/briefing.briefing.card",
      schemas: await createCardSchemaMap(boxRoot),
    });
    const compiled = compileBriefing(cardFields(parsed, BriefingSchema));
    const mdPath = join(boxRoot, "_content/briefing.md");
    await writeFile(
      mdPath,
      withDocId({ relativePath: "_content/briefing.md", content: compiled })
    );
    compiledPaths.push("_content/briefing.md");
  } catch (e) {
    // Missing root briefing is normal (skip); a parse error means a malformed
    // card we failed to compile — surface it either way so bad cards aren't silent.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`[generate-docs] could not compile ${rootBriefingPath} (absent or malformed):`, e);
    }
  }

  // TODO: scan subdirectories for directory briefings in the future
  // For now, only the root briefing is supported

  return compiledPaths;
}

/**
 * Scan `_config/*.guide.card`, compile each, and generate job-type rules.
 * Also scan per-chat guide cards in `_content/chat/` directories.
 * Returns summaries of config-level guides (for inclusion in agent guide).
 */
export async function compileGuides(boxRoot: string): Promise<GuideSummary[]> {
  const rulesDir = join(boxRoot, ".claude/rules");
  await mkdir(rulesDir, { recursive: true });

  const written = new Set<string>();
  const ctx = { boxRoot, rulesDir, written };
  const guides = await compileConfigGuides(ctx);
  await compileChatGuides(ctx);
  await pruneGuideRules(ctx);
  return guides;
}

interface GuideCompileContext {
  boxRoot: string;
  rulesDir: string;
  /** Rule filenames this run wrote; anything else in its families is an orphan. */
  written: Set<string>;
}

/**
 * Compile config/*.guide.card and generate job-type rules.
 * Returns summaries of all compiled guides.
 */
async function compileConfigGuides(ctx: GuideCompileContext): Promise<GuideSummary[]> {
  const { boxRoot, rulesDir } = ctx;
  const configGuides = await readConfigGuides(boxRoot);

  // job-type → list of { guidePath, appliesTo, compiledPath }
  const jobTypeMap = new Map<string, Array<{ guidePath: string; appliesTo: string; compiledPath: string }>>();

  for (const { summary, compiled } of configGuides) {
    const { guidePath, appliesTo, compiledPath } = summary;
    await writeFile(
      join(boxRoot, compiledPath),
      withDocId({ relativePath: compiledPath, content: compiled })
    );
    for (const jobType of summary.jobTypes) {
      let entries = jobTypeMap.get(jobType);
      if (!entries) {
        entries = [];
        jobTypeMap.set(jobType, entries);
      }
      entries.push({ guidePath, appliesTo, compiledPath });
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

    await writeFile(join(rulesDir, ruleFilename),
      withDocId({ relativePath: `.claude/rules/${ruleFilename}`, content: lines.join("\n") }));
    ctx.written.add(ruleFilename);
  }

  return configGuides.map((g) => g.summary);
}

/**
 * Scan per-chat directory guide cards (chat.guide.card) under `_content/chat/`.
 * Each guide compiles to a rule that loads when accessing files in that chat directory.
 */
async function compileChatGuides(ctx: GuideCompileContext): Promise<void> {
  const { boxRoot, rulesDir } = ctx;
  const chatRoot = getBoxDir(boxRoot, "chat");
  let connectors: string[];
  try {
    connectors = await readdir(chatRoot);
  } catch (_e) {
    // No _content/chat directory — box has no chats, so no per-chat guides. Expected.
    return;
  }

  for (const connector of connectors) {
    const connectorDir = join(chatRoot, connector);
    let connectorStat;
    try {
      connectorStat = await stat(connectorDir);
    } catch (_e) {
      // Entry vanished or is unreadable between readdir and stat — nothing to compile here.
      continue;
    }
    if (!connectorStat.isDirectory()) continue;

    let chatSlugs: string[];
    try {
      chatSlugs = await readdir(connectorDir);
    } catch (_e) {
      // Connector dir became unreadable — skip; no chat guides to compile under it.
      continue;
    }

    for (const slug of chatSlugs) {
      await compileChatGuide({ connectorDir, connector, slug, rulesDir, boxRoot, written: ctx.written });
    }
  }
}

interface ChatGuideParams {
  connectorDir: string;
  connector: string;
  slug: string;
  rulesDir: string;
  boxRoot: string;
  written: Set<string>;
}

/**
 * Compile a single per-chat guide card to its doc + scoped rule file.
 */
async function compileChatGuide(params: ChatGuideParams): Promise<void> {
  const { connectorDir, connector, slug, rulesDir, boxRoot } = params;
  const guideFile = join(connectorDir, slug, "chat.guide.card");
  let content: string;
  try {
    content = await readFile(guideFile, "utf-8");
  } catch (_e) {
    return; // No guide card for this chat — the common case, not an error.
  }

  try {
    const fields = parseGuideCard(content);
    if (fields === null) return; // Malformed chat guide — skip silently.
    const parsed = parseGuide(fields);
    const guideName = `chat-${connector}-${slug}`;
    const compiled = compileGuide(parsed, guideName);
    const compiledFilename = `${guideName}-guide.md`;
    const compiledPath = `${DOCS_DIR}/${compiledFilename}`;

    await writeFile(
      join(boxRoot, compiledPath),
      withDocId({ relativePath: compiledPath, content: compiled })
    );

    // Generate a rule file scoped to this chat directory
    const chatDir = `${BOX_DIRS.chat}/${connector}/${slug}`;
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

    await writeFile(join(rulesDir, ruleFilename),
      withDocId({ relativePath: `.claude/rules/${ruleFilename}`, content: lines.join("\n") }));
    params.written.add(ruleFilename);
  } catch (e) {
    // Skip unparseable chat guide cards, but surface them so malformed cards aren't silent.
    console.warn(`[generate-docs] could not compile chat guide ${guideFile}:`, e);
  }
}

/**
 * Compile `_config/*.personality.card`, write its markdown and the
 * speaking-voice JSON, and return the compiled section for the agent guide.
 */
export async function compilePersonalities(boxRoot: string): Promise<string | undefined> {
  const personality = await readPersonality(boxRoot);
  if (personality === undefined) return undefined;

  const compiledPath = `${DOCS_DIR}/personality-${personality.name}.md`;
  await writeFile(
    join(boxRoot, compiledPath),
    withDocId({ relativePath: compiledPath, content: personality.compiled })
  );

  // Write speaking-voice JSON for Electron consumption
  const voice = compileSpeakingVoice(personality.fields);
  const voicePath = `${DOCS_DIR}/speaking-voice.json`;
  await writeFile(
    join(boxRoot, voicePath),
    JSON.stringify(voice, null, 2) + "\n"
  );

  return personality.compiled;
}
