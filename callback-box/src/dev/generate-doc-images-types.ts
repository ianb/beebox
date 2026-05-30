/**
 * Shared types and configuration loading for doc image generation.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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

export interface ImageMetadata {
  prompt: string;
  style: string;
  model: string;
  generatedAt: string;
  promptHash: string;
  references: string[];
}

export const DOCS_DIR = path.join(PACKAGE_ROOT, "docs", "architecture");

export function loadConfig(): ImageGenConfig {
  const configPath = path.join(DOCS_DIR, "image-gen.yaml");
  if (!existsSync(configPath)) {
    throw new NotFoundError(configPath, "Config");
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
