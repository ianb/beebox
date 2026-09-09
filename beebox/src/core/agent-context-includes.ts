/** Resolve Claude-style @file context includes for harnesses that do not. */

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { errnoCode } from "../lib/error-guards.js";

const INCLUDE_PATTERN = /^@(.+\.md)\s*$/gm;

class UnsafeAgentContextIncludeError extends Error {
  readonly specifier: string;

  constructor(specifier: string) {
    super("Agent context include must stay inside the box package");
    this.name = "UnsafeAgentContextIncludeError";
    this.specifier = specifier;
  }
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
}

/** Expand include-only lines recursively, bounded to the box package. */
export async function expandClaudeIncludes(options: {
  claudePath: string;
  boxRoot: string;
}): Promise<string> {
  const seen = new Set<string>();
  const sections: string[] = [];
  const visit = async (path: string): Promise<void> => {
    const content = await readIfPresent(path);
    if (content === null) return;
    for (const match of content.matchAll(INCLUDE_PATTERN)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      if (isAbsolute(specifier)) throw new UnsafeAgentContextIncludeError(specifier);
      const included = resolve(dirname(path), specifier);
      const rel = relative(options.boxRoot, included);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new UnsafeAgentContextIncludeError(specifier);
      if (seen.has(included)) continue;
      seen.add(included);
      const includedContent = await readIfPresent(included);
      if (includedContent === null) continue;
      sections.push(`<!-- beebox include: ${rel} -->\n${includedContent.trim()}`);
      await visit(included);
    }
  };
  await visit(options.claudePath);
  return sections.join("\n\n");
}
