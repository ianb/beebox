#!/usr/bin/env tsx
/**
 * Generate images for architecture docs from markdown image prompts.
 *
 * Scans docs/architecture/*.md for image prompts in the format:
 *   ![type:character Name | prompt description](images/filename.png)
 *   ![Diana James | scene description](images/scene.png)
 *
 * Character portraits (type:character) are generated with the style prefix only.
 * Scene images include character portrait references so the model can match
 * appearances — names in the tag are matched to character portraits.
 *
 * Usage:
 *   pnpm generate:doc-images                    # generate missing character images
 *   pnpm generate:doc-images --type=all         # generate all image types
 *   pnpm generate:doc-images --type=scene       # generate scene images only
 *   pnpm generate:doc-images --force            # regenerate all
 *   pnpm generate:doc-images --file=diana       # only images matching "diana"
 *   pnpm generate:doc-images --dry-run          # show what would be generated
 */

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { glob } from "glob";
import {
  DOCS_DIR,
  loadConfig,
} from "./generate-doc-images-types.js";
import type {
  ImageGenConfig,
  ImageMetadata,
  ImagePrompt,
  PromptPart,
} from "./generate-doc-images-types.js";
import {
  buildCharacterIndex,
  computePromptHash,
  getMermaidBakPath,
  getMermaidPath,
  parseImagePrompts,
  readMetadata,
  writeMetadata,
} from "./generate-doc-images-parse.js";
import {
  buildDiagramPrompt,
  buildScenePrompt,
  generateImage,
  renderMermaid,
} from "./generate-doc-images-render.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
  force: boolean;
  dryRun: boolean;
  typeFilter: string;
  fileFilter: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const force = argv.includes("--force");
  const dryRun = argv.includes("--dry-run");
  const filterArg = argv.find((a) => a.startsWith("--type="));
  const typeFilter = filterArg ? filterArg.split("=")[1] || "character" : "character";
  const fileArg = argv.find((a) => a.startsWith("--file="));
  const fileFilter = fileArg ? fileArg.split("=")[1] || null : null;
  return { force, dryRun, typeFilter, fileFilter };
}

// ---------------------------------------------------------------------------
// Prompt loading + filtering
// ---------------------------------------------------------------------------

async function loadAllPrompts(): Promise<ImagePrompt[]> {
  const mdFiles = await glob("*.md", { cwd: DOCS_DIR });
  const allPrompts: ImagePrompt[] = [];
  for (const mdFile of mdFiles) {
    const fullPath = path.join(DOCS_DIR, mdFile);
    const content = await readFile(fullPath, "utf8");
    allPrompts.push(...parseImagePrompts(mdFile, content));
  }
  return allPrompts;
}

function filterByType(allPrompts: ImagePrompt[], typeFilter: string): ImagePrompt[] {
  if (typeFilter === "all") return allPrompts;
  if (typeFilter === "character") return allPrompts.filter((p) => p.isCharacter);
  if (typeFilter === "scene") return allPrompts.filter((p) => !p.isCharacter && !p.isDiagram);
  if (typeFilter === "diagram") return allPrompts.filter((p) => p.isDiagram);
  return allPrompts.filter((p) => p.tag.startsWith(`type:${typeFilter}`));
}

function selectPrompts(allPrompts: ImagePrompt[], { typeFilter, fileFilter }: CliArgs): ImagePrompt[] {
  let filtered = filterByType(allPrompts, typeFilter);
  if (fileFilter) {
    const lower = fileFilter.toLowerCase();
    filtered = filtered.filter((p) => p.imagePath.toLowerCase().includes(lower));
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Per-entry hashing
// ---------------------------------------------------------------------------

interface EntryPlan {
  effectiveStyle: string;
  mermaidSource: string | null;
  hash: string;
}

async function planEntry(
  entry: ImagePrompt,
  { absImagePath, config }: { absImagePath: string; config: ImageGenConfig },
): Promise<EntryPlan> {
  const refNames = entry.isCharacter || entry.isDiagram ? [] : entry.referencedCharacters;
  const effectiveStyle = entry.isDiagram ? config.diagramStyle : config.style;

  let mermaidSource: string | null = null;
  if (entry.isDiagram) {
    const mmdPath = getMermaidPath(absImagePath);
    if (existsSync(mmdPath)) {
      mermaidSource = await readFile(mmdPath, "utf8");
    }
  }

  const hash = computePromptHash(entry.prompt, {
    style: effectiveStyle,
    references: refNames,
    ...(mermaidSource ? { mermaidSource } : {}),
  });

  return { effectiveStyle, mermaidSource, hash };
}

// ---------------------------------------------------------------------------
// Dry-run reporting
// ---------------------------------------------------------------------------

function reportDryRun(entry: ImagePrompt, mermaidSource: string | null): void {
  console.log(`\n  would generate: ${entry.imagePath}`);
  if (entry.isCharacter) {
    console.log(`  type: character (${entry.characterName})`);
  } else if (entry.isDiagram) {
    const hasMermaid = mermaidSource !== null;
    console.log(`  type: diagram (mermaid: ${hasMermaid ? "yes" : "no — text-only fallback"})`);
  } else {
    console.log("  type: scene");
    console.log(`  characters: ${entry.referencedCharacters.join(", ") || "(none)"}`);
  }
  console.log(`  prompt: ${entry.prompt.substring(0, 120)}...`);
}

// ---------------------------------------------------------------------------
// Backup + prompt construction
// ---------------------------------------------------------------------------

async function backupExisting(absImagePath: string): Promise<void> {
  if (!existsSync(absImagePath)) return;
  const ext = path.extname(absImagePath);
  const base = absImagePath.substring(0, absImagePath.length - ext.length);
  let bakNum = 1;
  while (existsSync(`${base}.${bakNum}.bak${ext}`)) {
    bakNum++;
  }
  const bakPath = `${base}.${bakNum}.bak${ext}`;
  await copyFile(absImagePath, bakPath);
  console.log(`    backed up to: ${path.basename(bakPath)}`);
}

async function buildDiagramEntryPrompt(
  entry: ImagePrompt,
  { absImagePath, config }: { absImagePath: string; config: ImageGenConfig },
): Promise<string | PromptPart[]> {
  console.log("    rendering mermaid...");
  const mmdPath = getMermaidPath(absImagePath);
  const mermaidPng = await renderMermaid(mmdPath);

  if (!mermaidPng) {
    console.log("    mermaid render failed, falling back to text-only");
    return `${config.diagramStyle}\n\n${entry.prompt}`;
  }

  const mermaidBakPath = getMermaidBakPath(absImagePath);
  await writeFile(mermaidBakPath, mermaidPng);
  console.log(`    mermaid render saved: ${path.basename(mermaidBakPath)}`);

  return buildDiagramPrompt(mermaidPng, {
    style: config.diagramStyle,
    annotation: entry.prompt,
  });
}

interface BuiltPrompt {
  prompt: string | PromptPart[];
  refPaths: string[];
}

async function buildEntryPrompt(
  entry: ImagePrompt,
  { absImagePath, config, mermaidSource, characterIndex }: {
    absImagePath: string;
    config: ImageGenConfig;
    mermaidSource: string | null;
    characterIndex: Map<string, string>;
  },
): Promise<BuiltPrompt> {
  if (entry.isCharacter) {
    return { prompt: `${config.style}\n\n${entry.prompt}`, refPaths: [] };
  }
  if (entry.isDiagram && mermaidSource) {
    const prompt = await buildDiagramEntryPrompt(entry, { absImagePath, config });
    return { prompt, refPaths: [] };
  }
  if (entry.isDiagram) {
    return { prompt: `${config.diagramStyle}\n\n${entry.prompt}`, refPaths: [] };
  }
  const result = await buildScenePrompt(entry.prompt, {
    style: config.style,
    referencedCharacters: entry.referencedCharacters,
    characterIndex,
  });
  if (result.refPaths.length > 0) {
    console.log(`    with references: ${entry.referencedCharacters.join(", ")}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Per-entry processing
// ---------------------------------------------------------------------------

interface ProcessContext {
  config: ImageGenConfig;
  apiKey: string;
  characterIndex: Map<string, string>;
  args: CliArgs;
}

type EntryResult = "generated" | "skipped" | "noop";

async function processEntry(entry: ImagePrompt, ctx: ProcessContext): Promise<EntryResult> {
  const absImagePath = path.join(DOCS_DIR, entry.imagePath);
  const { effectiveStyle, mermaidSource, hash } = await planEntry(entry, {
    absImagePath,
    config: ctx.config,
  });

  if (!ctx.args.force && existsSync(absImagePath)) {
    const meta = await readMetadata(absImagePath);
    if (meta && meta.promptHash === hash) {
      console.log(`  skip (up to date): ${entry.imagePath}`);
      return "skipped";
    }
  }

  if (ctx.args.dryRun) {
    reportDryRun(entry, mermaidSource);
    return "noop";
  }

  console.log(`\n  generating: ${entry.imagePath}...`);
  await mkdir(path.dirname(absImagePath), { recursive: true });
  await backupExisting(absImagePath);

  const { prompt, refPaths } = await buildEntryPrompt(entry, {
    absImagePath,
    config: ctx.config,
    mermaidSource,
    characterIndex: ctx.characterIndex,
  });

  const imageBuffer = await generateImage(prompt, {
    model: ctx.config.model,
    apiKey: ctx.apiKey,
  });

  if (!imageBuffer) {
    console.error(`  FAILED: No image returned for ${entry.imagePath}`);
    return "noop";
  }

  await writeFile(absImagePath, imageBuffer);

  const metadata: ImageMetadata = {
    prompt: entry.prompt,
    style: effectiveStyle,
    model: ctx.config.model,
    generatedAt: new Date().toISOString(),
    promptHash: hash,
    references: refPaths.map((p) => path.relative(DOCS_DIR, p)),
  };
  await writeMetadata(absImagePath, metadata);

  console.log(`  saved: ${entry.imagePath} (${imageBuffer.length} bytes)`);
  return "generated";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey && !args.dryRun) {
    console.error(`Error: ${config.apiKeyEnv} environment variable not set`);
    process.exit(1);
  }

  const allPrompts = await loadAllPrompts();
  const characterIndex = buildCharacterIndex(allPrompts);
  const filtered = selectPrompts(allPrompts, args);

  if (filtered.length === 0) {
    console.log("No image prompts found matching filter.");
    return;
  }

  console.log(`Found ${filtered.length} image prompt(s) (filter: ${args.typeFilter})`);
  if (!args.dryRun && args.typeFilter !== "character" && characterIndex.size > 0) {
    console.log(`Character references available: ${[...characterIndex.keys()].join(", ")}`);
  }

  const ctx: ProcessContext = { config, apiKey: apiKey || "", characterIndex, args };
  let generated = 0;
  let skipped = 0;

  for (const entry of filtered) {
    const result = await processEntry(entry, ctx);
    if (result === "generated") {
      generated++;
    } else if (result === "skipped") {
      skipped++;
    }
  }

  console.log(`\nDone. Generated: ${generated}, Skipped: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
