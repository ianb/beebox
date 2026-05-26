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
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { glob } from "glob";
import { GoogleGenAI } from "@google/genai";
import { parse as parseYaml } from "yaml";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PromptPart =
  | { type: "text"; text: string }
  | { type: "image"; buffer: Buffer; mimeType: string };

interface ImageGenConfig {
  style: string;
  diagramStyle: string;
  model: string;
  apiKeyEnv: string;
}

interface ImagePrompt {
  /** e.g. "type:character Diana" or "Diana James Mateo" */
  tag: string;
  /** The prompt text after the pipe */
  prompt: string;
  /** Relative path from docs/architecture/, e.g. "images/diana-portrait.png" */
  imagePath: string;
  /** Source markdown file */
  sourceFile: string;
  /** Whether this is a character reference image */
  isCharacter: boolean;
  /** Whether this is a diagram */
  isDiagram: boolean;
  /** Character name if isCharacter */
  characterName: string | null;
  /** Character names referenced (for scene images) */
  referencedCharacters: string[];
}

interface ImageMetadata {
  prompt: string;
  style: string;
  model: string;
  generatedAt: string;
  promptHash: string;
  references: string[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DOCS_DIR = path.resolve(import.meta.dirname, "../../docs/architecture");

function loadConfig(): ImageGenConfig {
  const configPath = path.join(DOCS_DIR, "image-gen.yaml");
  if (!existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }
  const raw = parseYaml(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const style = String(raw.style || "").trim();
  return {
    style,
    diagramStyle: String(raw.diagramStyle || style).trim(),
    model: String(raw.model || "gemini-2.5-flash-image"),
    apiKeyEnv: String(raw.apiKeyEnv || "GEMINI_KEY"),
  };
}

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------

const IMAGE_PATTERN = /^!\[([^\]]+)]\(([^)]+\.png)\)\s*$/;

function parseImagePrompts(mdPath: string, content: string): ImagePrompt[] {
  const prompts: ImagePrompt[] = [];

  for (const line of content.split("\n")) {
    const match = line.match(IMAGE_PATTERN);
    if (!match) continue;

    const altText = match[1];
    const imagePath = match[2];
    if (!altText || !imagePath) continue;

    // Must contain a pipe separator
    const pipeIdx = altText.indexOf("|");
    if (pipeIdx === -1) continue;

    const tag = altText.substring(0, pipeIdx).trim();
    const prompt = altText.substring(pipeIdx + 1).trim();

    const isCharacter = tag.startsWith("type:character");
    const isDiagram = tag.startsWith("type:diagram");
    let characterName: string | null = null;
    let referencedCharacters: string[] = [];

    if (isCharacter) {
      // "type:character Diana" -> "Diana"
      characterName = tag.replace("type:character", "").trim() || null;
    } else if (!isDiagram) {
      // Scene image: tag is space-separated character names like "Diana James"
      referencedCharacters = tag.split(/\s+/).filter((s) => s.length > 0);
    }

    prompts.push({
      tag,
      prompt,
      imagePath,
      sourceFile: mdPath,
      isCharacter,
      isDiagram,
      characterName,
      referencedCharacters,
    });
  }

  return prompts;
}

// ---------------------------------------------------------------------------
// Character portrait index
// ---------------------------------------------------------------------------

/** Map from character name (e.g. "Diana") to absolute image path */
function buildCharacterIndex(allPrompts: ImagePrompt[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const p of allPrompts) {
    if (p.isCharacter && p.characterName) {
      index.set(p.characterName, path.join(DOCS_DIR, p.imagePath));
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Metadata (for up-to-date checking)
// ---------------------------------------------------------------------------

function getMetadataPath(imagePath: string): string {
  const ext = path.extname(imagePath);
  return imagePath.substring(0, imagePath.length - ext.length) + "-prompt.json";
}

function computePromptHash(
  prompt: string,
  { style, references, mermaidSource }: { style: string; references: string[]; mermaidSource?: string },
): string {
  const refStr = references.toSorted().join(",");
  const mermaid = mermaidSource || "";
  return createHash("sha256").update(`${style}\n---\n${prompt}\n---\n${refStr}\n---\n${mermaid}`).digest("hex").substring(0, 16);
}

async function readMetadata(imagePath: string): Promise<ImageMetadata | null> {
  const metaPath = getMetadataPath(imagePath);
  if (!existsSync(metaPath)) return null;
  try {
    const raw = await readFile(metaPath, "utf8");
    return JSON.parse(raw) as ImageMetadata;
  } catch (_e) {
    return null;
  }
}

async function writeMetadata(imagePath: string, metadata: ImageMetadata): Promise<void> {
  await writeFile(getMetadataPath(imagePath), JSON.stringify(metadata, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

async function generateImage(
  prompt: string | PromptPart[],
  { model, apiKey }: { model: string; apiKey: string },
): Promise<Buffer | null> {
  const ai = new GoogleGenAI({ apiKey });

  let contents: string | Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;

  if (typeof prompt === "string") {
    contents = prompt;
  } else {
    contents = prompt.map((part) => {
      if (part.type === "text") {
        return { text: part.text };
      }
      return {
        inlineData: {
          mimeType: part.mimeType,
          data: part.buffer.toString("base64"),
        },
      };
    });
  }

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  });

  if (response.candidates && response.candidates.length > 0) {
    const candidate = response.candidates[0];
    const content = candidate ? candidate.content : undefined;
    if (content && content.parts) {
      for (const part of content.parts) {
        if ("inlineData" in part && part.inlineData && part.inlineData.data) {
          return Buffer.from(part.inlineData.data, "base64");
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Mermaid rendering (for diagrams)
// ---------------------------------------------------------------------------

/**
 * Get the path to the .mmd source file for a diagram image.
 */
function getMermaidPath(imagePath: string): string {
  const ext = path.extname(imagePath);
  return imagePath.substring(0, imagePath.length - ext.length) + ".mmd";
}

/**
 * Get the path to the Mermaid-rendered backup image.
 */
function getMermaidBakPath(imagePath: string): string {
  const ext = path.extname(imagePath);
  return imagePath.substring(0, imagePath.length - ext.length) + ".mermaid.bak" + ext;
}

/**
 * Render a .mmd file to PNG using the mermaid CLI (mmdc).
 * Returns the PNG buffer, or null if mmdc is not available or rendering fails.
 */
async function renderMermaid(mmdPath: string): Promise<Buffer | null> {
  const tmpOut = path.join(tmpdir(), `mermaid-${Date.now()}.png`);
  try {
    await execFileAsync("mmdc", [
      "-i", mmdPath,
      "-o", tmpOut,
      "-w", "1024",
      "-H", "768",
      "--backgroundColor", "white",
    ], { timeout: 30000 });
    const buf = await readFile(tmpOut);
    return buf;
  } catch (e) {
    const err = e as Error;
    if ("code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error("    warning: mmdc not found. Install with: pnpm add -g @mermaid-js/mermaid-cli");
    } else {
      console.error(`    warning: mermaid render failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * Build a multipart prompt for a diagram using a Mermaid-rendered reference image.
 * The annotation is extra instructions from the markdown prompt text.
 */
function buildDiagramPrompt(
  mermaidPng: Buffer,
  { style, annotation }: { style: string; annotation: string },
): PromptPart[] {
  let instructions = `Here is a reference diagram showing the layout and text content I want. Reproduce this diagram with the EXACT SAME text labels, words, and layout structure, but restyle it in this art style:\n\n${style}\n\nIMPORTANT: Keep every word, label, and connection from the reference diagram exactly as shown. The text must be spelled correctly — copy it exactly from the reference. Change ONLY the visual style (hand-drawn, colored pencil, cream paper). Do NOT change any text content.`;

  if (annotation) {
    instructions += `\n\nAdditional notes about this diagram: ${annotation}`;
  }

  return [
    { type: "text", text: instructions },
    { type: "image", buffer: mermaidPng, mimeType: "image/png" },
  ];
}

/**
 * Build a multipart prompt with character reference images for a scene.
 */
async function buildScenePrompt(
  scenePrompt: string,
  { style, referencedCharacters, characterIndex }: { style: string; referencedCharacters: string[]; characterIndex: Map<string, string> },
): Promise<{ prompt: string | PromptPart[]; refPaths: string[] }> {
  const refParts: PromptPart[] = [];
  const refPaths: string[] = [];

  // Collect available character references
  for (const name of referencedCharacters) {
    const portraitPath = characterIndex.get(name);
    if (!portraitPath || !existsSync(portraitPath)) {
      console.log(`    warning: no portrait for "${name}", skipping reference`);
      continue;
    }
    const imageBuffer = await readFile(portraitPath);
    refParts.push({ type: "text", text: `\nReference image for ${name}:` });
    refParts.push({ type: "image", buffer: imageBuffer, mimeType: "image/png" });
    refPaths.push(portraitPath);
  }

  // If no references available, fall back to plain text
  if (refParts.length === 0) {
    return { prompt: `${style}\n\n${scenePrompt}`, refPaths: [] };
  }

  // Build multipart: references first, then the generation prompt
  const parts: PromptPart[] = [
    { type: "text", text: "The following are character reference images. Use them to accurately depict the characters in the scene that follows.\n" },
    ...refParts,
    { type: "text", text: `\n\nNow generate a new image in this style and scene. Match the characters to their reference images above. Do NOT include any text or labels in the image.\n\n${style}\n\n${scenePrompt}` },
  ];

  return { prompt: parts, refPaths };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const filterArg = args.find((a) => a.startsWith("--type="));
  const typeFilter = filterArg ? filterArg.split("=")[1] : "character";
  const fileArg = args.find((a) => a.startsWith("--file="));
  const fileFilter = fileArg ? fileArg.split("=")[1] : null;

  const config = loadConfig();

  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey && !dryRun) {
    console.error(`Error: ${config.apiKeyEnv} environment variable not set`);
    process.exit(1);
  }

  // Find all markdown files and parse prompts
  const mdFiles = await glob("*.md", { cwd: DOCS_DIR });
  const allPrompts: ImagePrompt[] = [];

  for (const mdFile of mdFiles) {
    const fullPath = path.join(DOCS_DIR, mdFile);
    const content = await readFile(fullPath, "utf8");
    const prompts = parseImagePrompts(mdFile, content);
    allPrompts.push(...prompts);
  }

  // Build character portrait index (needed for scene generation)
  const characterIndex = buildCharacterIndex(allPrompts);

  // Filter prompts
  let filtered: ImagePrompt[];
  if (typeFilter === "all") {
    filtered = allPrompts;
  } else if (typeFilter === "character") {
    filtered = allPrompts.filter((p) => p.isCharacter);
  } else if (typeFilter === "scene") {
    filtered = allPrompts.filter((p) => !p.isCharacter && !p.isDiagram);
  } else if (typeFilter === "diagram") {
    filtered = allPrompts.filter((p) => p.isDiagram);
  } else {
    filtered = allPrompts.filter((p) => p.tag.startsWith(`type:${typeFilter}`));
  }

  // Apply file name filter if provided
  if (fileFilter) {
    const lower = fileFilter.toLowerCase();
    filtered = filtered.filter((p) => p.imagePath.toLowerCase().includes(lower));
  }

  if (filtered.length === 0) {
    console.log("No image prompts found matching filter.");
    return;
  }

  console.log(`Found ${filtered.length} image prompt(s) (filter: ${typeFilter})`);
  if (!dryRun && typeFilter !== "character" && characterIndex.size > 0) {
    console.log(`Character references available: ${[...characterIndex.keys()].join(", ")}`);
  }

  let generated = 0;
  let skipped = 0;

  for (const entry of filtered) {
    const absImagePath = path.join(DOCS_DIR, entry.imagePath);

    // For scenes, include reference portrait paths in the hash
    const refNames = entry.isCharacter || entry.isDiagram ? [] : entry.referencedCharacters;
    const effectiveStyle = entry.isDiagram ? config.diagramStyle : config.style;

    // For diagrams, check for a .mmd source file and include it in the hash
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

    // Check if up to date
    if (!force && existsSync(absImagePath)) {
      const meta = await readMetadata(absImagePath);
      if (meta && meta.promptHash === hash) {
        console.log(`  skip (up to date): ${entry.imagePath}`);
        skipped++;
        continue;
      }
    }

    if (dryRun) {
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
      continue;
    }

    console.log(`\n  generating: ${entry.imagePath}...`);

    // Ensure output directory exists
    await mkdir(path.dirname(absImagePath), { recursive: true });

    // Backup existing image before overwriting
    if (existsSync(absImagePath)) {
      const ext = path.extname(absImagePath);
      const base = absImagePath.substring(0, absImagePath.length - ext.length);
      // Find next backup number
      let bakNum = 1;
      while (existsSync(`${base}.${bakNum}.bak${ext}`)) {
        bakNum++;
      }
      const bakPath = `${base}.${bakNum}.bak${ext}`;
      await copyFile(absImagePath, bakPath);
      console.log(`    backed up to: ${path.basename(bakPath)}`);
    }

    // Build the prompt
    let prompt: string | PromptPart[];
    let refPaths: string[] = [];

    if (entry.isCharacter) {
      // Character portrait: style + prompt, plain text
      prompt = `${config.style}\n\n${entry.prompt}`;
    } else if (entry.isDiagram && mermaidSource) {
      // Diagram with Mermaid source: render → restyle pipeline
      console.log("    rendering mermaid...");
      const mmdPath = getMermaidPath(absImagePath);
      const mermaidPng = await renderMermaid(mmdPath);

      if (mermaidPng) {
        // Save the Mermaid render as a .mermaid.bak.png for inspection
        const mermaidBakPath = getMermaidBakPath(absImagePath);
        await writeFile(mermaidBakPath, mermaidPng);
        console.log(`    mermaid render saved: ${path.basename(mermaidBakPath)}`);

        // Build multipart prompt with Mermaid reference image
        prompt = buildDiagramPrompt(mermaidPng, {
          style: config.diagramStyle,
          annotation: entry.prompt,
        });
      } else {
        // Mermaid render failed, fall back to text-only
        console.log("    mermaid render failed, falling back to text-only");
        prompt = `${config.diagramStyle}\n\n${entry.prompt}`;
      }
    } else if (entry.isDiagram) {
      // Diagram without Mermaid: text-only fallback (original behavior)
      prompt = `${config.diagramStyle}\n\n${entry.prompt}`;
    } else {
      // Scene image: include character reference images
      const result = await buildScenePrompt(entry.prompt, {
        style: config.style,
        referencedCharacters: entry.referencedCharacters,
        characterIndex,
      });
      prompt = result.prompt;
      refPaths = result.refPaths;
      if (refPaths.length > 0) {
        console.log(`    with references: ${entry.referencedCharacters.join(", ")}`);
      }
    }

    const imageBuffer = await generateImage(prompt, {
      model: config.model,
      apiKey: apiKey!,
    });

    if (!imageBuffer) {
      console.error(`  FAILED: No image returned for ${entry.imagePath}`);
      continue;
    }

    await writeFile(absImagePath, imageBuffer);

    // Write metadata
    const metadata: ImageMetadata = {
      prompt: entry.prompt,
      style: effectiveStyle,
      model: config.model,
      generatedAt: new Date().toISOString(),
      promptHash: hash,
      references: refPaths.map((p) => path.relative(DOCS_DIR, p)),
    };
    await writeMetadata(absImagePath, metadata);

    console.log(`  saved: ${entry.imagePath} (${imageBuffer.length} bytes)`);
    generated++;
  }

  console.log(`\nDone. Generated: ${generated}, Skipped: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
