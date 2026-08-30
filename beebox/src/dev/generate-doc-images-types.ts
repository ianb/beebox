/**
 * Shared types and configuration loading for doc image generation.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { NotFoundError } from "../lib/errors.js";
import { parse as parseYaml } from "yaml";

export type PromptPart =
  | { type: "text"; text: string }
  | { type: "image"; buffer: Buffer; mimeType: string };

export interface ImageGenConfig {
  style: string;
  diagramStyle: string;
  model: string;
  apiKeyEnv: string;
}

export interface ImagePrompt {
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

export const imageMetadataSchema = z.object({
  prompt: z.string(),
  style: z.string(),
  model: z.string(),
  generatedAt: z.string(),
  promptHash: z.string(),
  references: z.array(z.string()),
});
export type ImageMetadata = z.infer<typeof imageMetadataSchema>;

export const DOCS_DIR = path.join(PACKAGE_ROOT, "docs", "architecture");

const imageGenConfigFileSchema = z.object({
  style: z.string().default(""),
  diagramStyle: z.string().optional(),
  model: z.string().default("gemini-2.5-flash-image"),
  apiKeyEnv: z.string().default("GEMINI_KEY"),
});

export function loadConfig(): ImageGenConfig {
  const configPath = path.join(DOCS_DIR, "image-gen.yaml");
  if (!existsSync(configPath)) {
    throw new NotFoundError(configPath, "Config");
  }
  // Parse boundary: config/image-gen.yaml is untrusted on-disk data — zod
  // validates it (and applies the same defaults the old `|| ""` fallbacks
  // gave) instead of a blind cast.
  const raw = imageGenConfigFileSchema.parse(parseYaml(readFileSync(configPath, "utf8")));
  const style = raw.style.trim();
  return {
    style,
    diagramStyle: (raw.diagramStyle ?? style).trim(),
    model: raw.model,
    apiKeyEnv: raw.apiKeyEnv,
  };
}
