/** Resolve Claude-style @file context includes in an instruction file, for harnesses that do not. */

import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { errnoCode } from "../shared/error-guards.js";

const INCLUDE_PATTERN = /^@(.+\.md)\s*$/gm;

export class UnsafeAgentContextIncludeError extends Error {
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

async function realpathIfPresent(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The real directories an include may resolve into: the box itself, and the
 * installed engine package (`node_modules/beebox`), whose reference docs a box
 * may include and which a linked dev engine places outside the box.
 */
async function allowedRealRoots(boxRoot: string): Promise<string[]> {
  const roots = [await realpath(boxRoot)];
  const engine = await realpathIfPresent(resolve(boxRoot, "node_modules", "beebox"));
  if (engine !== null) roots.push(engine);
  return roots;
}

/** Expand include-only lines recursively, bounded to the box package. */
export async function expandInstructionIncludes(options: {
  /** The root instruction file (`instructionFilePath(boxRoot, "")`, made absolute). */
  instructionPath: string;
  boxRoot: string;
}): Promise<string> {
  const seen = new Set<string>();
  const sections: string[] = [];
  const realRoots = await allowedRealRoots(options.boxRoot);
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
      // The lexical check above does not see symlinks; the real path must
      // stay inside the box (or its engine package) too.
      const real = await realpathIfPresent(included);
      if (real === null) continue;
      if (!realRoots.some((root) => isInside(root, real))) throw new UnsafeAgentContextIncludeError(specifier);
      // Read the path that was checked, so a swapped link cannot redirect the read.
      const includedContent = await readIfPresent(real);
      if (includedContent === null) continue;
      sections.push(`<!-- beebox include: ${rel} -->\n${includedContent.trim()}`);
      await visit(included);
    }
  };
  await visit(options.instructionPath);
  return sections.join("\n\n");
}
