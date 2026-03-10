#!/usr/bin/env tsx
/**
 * Generate images for architecture docs from markdown image prompts.
 *
 * Scans docs/architecture/*.md for image prompts in the format:
 *   ![type:character Name | prompt description](images/filename.png)
 *
 * Combines prompts with the style prefix from docs/architecture/image-gen.yaml
 * and generates images using Google's Gemini API.
 *
 * Usage:
 *   npm run generate:doc-images           # generate missing images
 *   npm run generate:doc-images -- --force # regenerate all images
 *   npm run generate:doc-images -- --dry-run # show what would be generated
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { glob } from "glob";
import { GoogleGenAI } from "@google/genai";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImageGenConfig {
  style: string;
  model: string;
  apiKeyEnv: string;
}

interface ImagePrompt {
  /** e.g. "type:character" or character names like "Diana James" */
  tag: string;
  /** The prompt text after the pipe */
  prompt: string;
  /** Relative path from docs/architecture/, e.g. "images/diana-portrait.png" */
  imagePath: string;
  /** Source markdown file */
  sourceFile: string;
  /** Whether this is a character reference image */
  isCharacter: boolean;
  /** Character name if isCharacter */
  characterName: string | null;
}

interface ImageMetadata {
  prompt: string;
  style: string;
  model: string;
  generatedAt: string;
  promptHash: string;
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
  return {
    style: String(raw.style || "").trim(),
    model: String(raw.model || "gemini-2.5-flash-preview-05-20"),
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
    let characterName: string | null = null;
    if (isCharacter) {
      // "type:character Diana" -> "Diana"
      characterName = tag.replace("type:character", "").trim() || null;
    }

    prompts.push({
      tag,
      prompt,
      imagePath,
      sourceFile: mdPath,
      isCharacter,
      characterName,
    });
  }

  return prompts;
}

// ---------------------------------------------------------------------------
// Metadata (for up-to-date checking)
// ---------------------------------------------------------------------------

function metadataPath(imagePath: string): string {
  const ext = path.extname(imagePath);
  return imagePath.substring(0, imagePath.length - ext.length) + "-prompt.json";
}

function promptHash(style: string, prompt: string): string {
  return createHash("sha256").update(`${style}\n---\n${prompt}`).digest("hex").substring(0, 16);
}

async function readMetadata(imagePath: string): Promise<ImageMetadata | null> {
  const metaPath = metadataPath(imagePath);
  if (!existsSync(metaPath)) return null;
  try {
    const raw = await readFile(metaPath, "utf8");
    return JSON.parse(raw) as ImageMetadata;
  } catch (_e) {
    return null;
  }
}

async function writeMetadata(imagePath: string, metadata: ImageMetadata): Promise<void> {
  await writeFile(metadataPath(imagePath), JSON.stringify(metadata, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

async function generateImage(
  prompt: string,
  { model, apiKey }: { model: string; apiKey: string },
): Promise<Buffer | null> {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const filterType = args.find((a) => a.startsWith("--type="));
  const typeFilter = filterType ? filterType.split("=")[1] : "character";

  const config = loadConfig();

  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey && !dryRun) {
    console.error(`Error: ${config.apiKeyEnv} environment variable not set`);
    process.exit(1);
  }

  // Find all markdown files
  const mdFiles = await glob("*.md", { cwd: DOCS_DIR });
  const allPrompts: ImagePrompt[] = [];

  for (const mdFile of mdFiles) {
    const fullPath = path.join(DOCS_DIR, mdFile);
    const content = await readFile(fullPath, "utf8");
    const prompts = parseImagePrompts(mdFile, content);
    allPrompts.push(...prompts);
  }

  // Filter to type:character only (for now)
  const filtered = typeFilter === "all"
    ? allPrompts
    : allPrompts.filter((p) => {
      if (typeFilter === "character") return p.isCharacter;
      return p.tag.startsWith(`type:${typeFilter}`);
    });

  if (filtered.length === 0) {
    console.log("No image prompts found matching filter.");
    return;
  }

  console.log(`Found ${filtered.length} image prompt(s) (filter: ${typeFilter})`);

  let generated = 0;
  let skipped = 0;

  for (const entry of filtered) {
    const absImagePath = path.join(DOCS_DIR, entry.imagePath);
    const hash = promptHash(config.style, entry.prompt);

    // Check if up to date
    if (!force && existsSync(absImagePath)) {
      const meta = await readMetadata(absImagePath);
      if (meta && meta.promptHash === hash) {
        console.log(`  skip (up to date): ${entry.imagePath}`);
        skipped++;
        continue;
      }
    }

    const fullPrompt = `${config.style}\n\n${entry.prompt}`;

    if (dryRun) {
      console.log(`\n  would generate: ${entry.imagePath}`);
      console.log(`  character: ${entry.characterName || "(none)"}`);
      console.log(`  prompt: ${entry.prompt.substring(0, 120)}...`);
      continue;
    }

    console.log(`\n  generating: ${entry.imagePath}...`);

    // Ensure output directory exists
    await mkdir(path.dirname(absImagePath), { recursive: true });

    const imageBuffer = await generateImage(fullPrompt, {
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
      style: config.style,
      model: config.model,
      generatedAt: new Date().toISOString(),
      promptHash: hash,
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
