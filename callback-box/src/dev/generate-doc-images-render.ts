/**
 * Image generation (Gemini), Mermaid rendering, and prompt construction
 * for doc image generation.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type { PromptPart } from "./generate-doc-images-types.js";

const execFileAsync = promisify(execFile);

export async function generateImage(
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

/**
 * Render a .mmd file to PNG using the mermaid CLI (mmdc).
 * Returns the PNG buffer, or null if mmdc is not available or rendering fails.
 */
export async function renderMermaid(mmdPath: string): Promise<Buffer | null> {
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
export function buildDiagramPrompt(
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
export async function buildScenePrompt(
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
