/**
 * Markdown prompt parsing, character index, metadata, and path helpers
 * for doc image generation.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DOCS_DIR } from "./generate-doc-images-types.js";
import type { ImageMetadata, ImagePrompt } from "./generate-doc-images-types.js";

const IMAGE_PATTERN = /^!\[([^\]]+)]\(([^)]+\.png)\)\s*$/;

export function parseImagePrompts(mdPath: string, content: string): ImagePrompt[] {
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

/** Map from character name (e.g. "Diana") to absolute image path */
export function buildCharacterIndex(allPrompts: ImagePrompt[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const p of allPrompts) {
    if (p.isCharacter && p.characterName) {
      index.set(p.characterName, path.join(DOCS_DIR, p.imagePath));
    }
  }
  return index;
}

function getMetadataPath(imagePath: string): string {
  const ext = path.extname(imagePath);
  return imagePath.substring(0, imagePath.length - ext.length) + "-prompt.json";
}

export function computePromptHash(
  prompt: string,
  { style, references, mermaidSource }: { style: string; references: string[]; mermaidSource?: string },
): string {
  const refStr = references.toSorted().join(",");
  const mermaid = mermaidSource || "";
  return createHash("sha256").update(`${style}\n---\n${prompt}\n---\n${refStr}\n---\n${mermaid}`).digest("hex").substring(0, 16);
}

export async function readMetadata(imagePath: string): Promise<ImageMetadata | null> {
  const metaPath = getMetadataPath(imagePath);
  if (!existsSync(metaPath)) return null;
  try {
    const raw = await readFile(metaPath, "utf8");
    return JSON.parse(raw) as ImageMetadata;
  } catch (_e) {
    return null;
  }
}

export async function writeMetadata(imagePath: string, metadata: ImageMetadata): Promise<void> {
  await writeFile(getMetadataPath(imagePath), JSON.stringify(metadata, null, 2), "utf8");
}

/** Get the path to the .mmd source file for a diagram image. */
export function getMermaidPath(imagePath: string): string {
  const ext = path.extname(imagePath);
  return imagePath.substring(0, imagePath.length - ext.length) + ".mmd";
}

/** Get the path to the Mermaid-rendered backup image. */
export function getMermaidBakPath(imagePath: string): string {
  const ext = path.extname(imagePath);
  return imagePath.substring(0, imagePath.length - ext.length) + ".mermaid.bak" + ext;
}
