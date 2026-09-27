/**
 * After the move, prints (never fixes) every non-import mention of each
 * moved path: docs, skills, configs, and eslint/knip globs break silently on
 * a move and need hand repair. Excludes `scratch/` and files the tool itself
 * rewrote.
 */
import { isWithin } from "../graph.js";
import { gitGrep } from "./git-ops.js";
import type { PlannedMove } from "./list.js";
import { pathWithoutExtension } from "./specifier.js";

export interface MentionGroup {
  movedPath: string;
  lines: string[];
}

function owningRoot(path: string, roots: string[]): string | null {
  const matches = roots.filter((root) => isWithin(path, root)).toSorted((a, b) => b.length - a.length);
  return matches[0] ?? null;
}

function mentionPatterns(params: { oldPath: string; roots: string[] }): string[] {
  const patterns = new Set<string>([params.oldPath, pathWithoutExtension(params.oldPath)]);
  const root = owningRoot(params.oldPath, params.roots);
  if (root !== null) {
    const rel = params.oldPath.slice(root.length + 1);
    patterns.add(rel);
    patterns.add(pathWithoutExtension(rel));
  }
  return [...patterns];
}

export function reportMentions(params: {
  repoRoot: string;
  moves: PlannedMove[];
  roots: string[];
  rewrittenFiles: ReadonlySet<string>;
}): MentionGroup[] {
  return params.moves.map((move) => {
    const seen = new Set<string>();
    for (const pattern of mentionPatterns({ oldPath: move.from, roots: params.roots })) {
      for (const line of gitGrep({ repoRoot: params.repoRoot, pattern })) {
        const path = line.slice(0, line.indexOf(":"));
        if (path.startsWith("scratch/") || params.rewrittenFiles.has(path)) continue;
        seen.add(line);
      }
    }
    return { movedPath: move.from, lines: [...seen].toSorted() };
  });
}
