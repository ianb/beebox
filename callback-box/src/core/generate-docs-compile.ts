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
import { parseCard } from "cardworks";
import { parseGuide, compileGuide, type Guide } from "../schemas/guide.js";
import { compilePersonality, compileSpeakingVoice, type PersonalityFields } from "../schemas/personality.js";
import { compileBriefing, type BriefingFields } from "../schemas/briefing.js";
import { parseCardText } from "./card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import { DOCS_DIR, withDocId } from "./generate-docs-shared.js";

/**
 * Scan procedure cards and extract name + first-line description.
 */
export interface ProcedureSummary {
  name: string;
  filename: string;
  description: string;
}

export async function scanProcedures(boxRoot: string): Promise<ProcedureSummary[]> {
  const procedureDir = join(boxRoot, "config/procedures");
  let files: string[];
  try {
    files = await readdir(procedureDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[generate-docs] could not read ${procedureDir}; assuming no procedures:`, e);
    }
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
    } catch (e) {
      // Skip unparseable procedure cards — still index them with a placeholder.
      console.warn(`[generate-docs] could not parse procedure card ${filename}:`, e);
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
 * Find and compile all briefing.briefing.card files in the box.
 *
 * Each briefing card is compiled to a .md file next to the .card file.
 * Returns the list of compiled briefing paths (relative to box root)
 * so CLAUDE.md can include them.
 */
export async function compileBriefings(boxRoot: string, debug: boolean): Promise<string[]> {
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
  } catch (e) {
    // Missing root briefing is normal (skip); a parse error means a malformed
    // card we failed to compile — surface it either way so bad cards aren't silent.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[generate-docs] could not compile ${rootBriefingPath} (absent or malformed):`, e);
    }
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
export async function compileGuides(boxRoot: string, debug: boolean): Promise<GuideSummary[]> {
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
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[generate-docs] could not read ${configDir}; assuming no guides:`, e);
    }
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
    } catch (e) {
      // Skip unparseable guide cards, but surface them so malformed cards aren't silent.
      console.warn(`[generate-docs] could not parse guide card ${filename}:`, e);
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
  } catch (_e) {
    // No store/chat directory — box has no chats, so no per-chat guides. Expected.
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
      await compileChatGuide({ connectorDir, connector, slug, rulesDir, debug, boxRoot });
    }
  }
}

interface ChatGuideParams {
  connectorDir: string;
  connector: string;
  slug: string;
  rulesDir: string;
  debug: boolean;
  boxRoot: string;
}

/**
 * Compile a single per-chat guide card to its doc + scoped rule file.
 */
async function compileChatGuide(params: ChatGuideParams): Promise<void> {
  const { connectorDir, connector, slug, rulesDir, debug, boxRoot } = params;
  const guideFile = join(connectorDir, slug, "chat.guide.card");
  let content: string;
  try {
    content = await readFile(guideFile, "utf-8");
  } catch (_e) {
    return; // No guide card for this chat — the common case, not an error.
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
  } catch (e) {
    // Skip unparseable chat guide cards, but surface them so malformed cards aren't silent.
    console.warn(`[generate-docs] could not compile chat guide ${guideFile}:`, e);
  }
}

/**
 * Scan config/*.personality.card, compile each, and return the compiled markdown
 * and speaking-voice JSON.
 */
export async function compilePersonalities(boxRoot: string, debug: boolean): Promise<string | undefined> {
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
    const parsed = parseCardText(content, {
      source: filename,
      schemas: createCardSchemaMap(),
    });
    const fields = parsed.fields as unknown as PersonalityFields;
    const compiled = compilePersonality(fields);
    const compiledFilename = `personality-${personalityName}.md`;
    const compiledPath = `${DOCS_DIR}/${compiledFilename}`;

    await writeFile(
      join(boxRoot, compiledPath),
      withDocId({ relativePath: compiledPath, content: compiled, debug })
    );

    // Write speaking-voice JSON for Electron consumption
    const voice = compileSpeakingVoice(fields);
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
