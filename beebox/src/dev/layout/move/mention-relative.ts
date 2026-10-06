/**
 * Form 4: a path relative to the MENTIONING file's own directory (`./foo.ts`,
 * `../core/foo.js`), found in a non-TypeScript file (JSON, shell, YAML,
 * Markdown). Unlike the repo-relative and package-relative forms, the
 * mention text differs per mentioning file, so it can't be found by a
 * single repo-wide literal search — each candidate non-TS file is checked
 * against the specific relative spellings its own directory would produce.
 */
import { dirOf } from "../graph.js";
import type { PlannedMove } from "./list.js";
import { isModulePath } from "./mention-forms.js";
import { computeRelativeSpecifier, pathWithoutExtension } from "./specifier.js";

/** Extensions of non-TypeScript files this form is checked in. */
const RELATIVE_MENTION_EXTENSIONS = [".json", ".sh", ".bash", ".yml", ".yaml", ".md"];

export function isRelativeMentionCandidateFile(path: string): boolean {
  return RELATIVE_MENTION_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** Fake specifiers whose only job is fixing the extension STYLE `computeRelativeSpecifier` preserves. */
function extensionStyleTokens(oldPath: string): string[] {
  return isModulePath(oldPath) ? ["x.ts", "x.js", "x"] : [`x${oldPath.slice(pathWithoutExtension(oldPath).length)}`];
}

/**
 * The old/new relative-spelling pairs a mention of `move` could take inside
 * `mentioningPath`, one pair per extension style. `mentioningPath`'s own new
 * directory (via `moveMap`, if it also moved) is used for the new side, same
 * as a real specifier rewrite would.
 */
export function relativeCandidates(params: {
  move: PlannedMove;
  mentioningPath: string;
  moveMap: ReadonlyMap<string, string>;
}): Array<{ old: string; new: string }> {
  const currentDir = dirOf(params.mentioningPath);
  const newMentioningPath = params.moveMap.get(params.mentioningPath) ?? params.mentioningPath;
  const newDir = dirOf(newMentioningPath);
  return extensionStyleTokens(params.move.from).map((styleToken) => ({
    old: computeRelativeSpecifier({ newImporterDir: currentDir, newTargetPath: params.move.from, oldSpecifier: styleToken }),
    new: computeRelativeSpecifier({ newImporterDir: newDir, newTargetPath: params.move.to, oldSpecifier: styleToken }),
  }));
}
