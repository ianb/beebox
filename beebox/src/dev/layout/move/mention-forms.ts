/**
 * The literal text forms a moved path (or a uniformly-renamed directory,
 * `mention-directories.ts`) can appear as in a mention: the repo-relative
 * path, the path relative to its owning package (scoped to files inside
 * that package, or a package-relative config — `mention-apply.ts`'s
 * knip.ts special case is applied by the caller), and — for a `.ts`/`.tsx`
 * module — the same two forms with the extension swapped to `.js` or
 * dropped, since a specifier can spell any of the three.
 */
import { owningRoot } from "./mentions.js";
import type { DirectoryRename } from "./mention-directories.js";
import type { PlannedMove } from "./list.js";
import { pathWithoutExtension } from "./specifier.js";

export type FormKind = "repo-relative" | "package-relative" | "directory-repo-relative" | "directory-package-relative";

export interface LiteralForm {
  old: string;
  new: string;
  kind: FormKind;
  /** The package root a `package-relative` form is scoped to; `null` for a repo-relative form (any file). */
  scopeRoot: string | null;
}

function extensionOf(path: string): string {
  return path.slice(pathWithoutExtension(path).length);
}

export function isModulePath(path: string): boolean {
  const ext = extensionOf(path);
  return ext === ".ts" || ext === ".tsx";
}

/** The raw pair, plus (for a `.ts`/`.tsx` module) the `.js` and extensionless spellings. */
function pathVariants(oldPath: string, newPath: string): Array<{ old: string; new: string }> {
  const variants = [{ old: oldPath, new: newPath }];
  if (isModulePath(oldPath)) {
    const oldBase = pathWithoutExtension(oldPath);
    const newBase = pathWithoutExtension(newPath);
    variants.push({ old: `${oldBase}.js`, new: `${newBase}.js` });
    variants.push({ old: oldBase, new: newBase });
  }
  return variants;
}

export function fileForms(params: { move: PlannedMove; roots: string[] }): LiteralForm[] {
  const forms: LiteralForm[] = pathVariants(params.move.from, params.move.to).map((variant) => ({
    ...variant,
    kind: "repo-relative",
    scopeRoot: null,
  }));
  const root = owningRoot(params.move.from, params.roots);
  const newRoot = owningRoot(params.move.to, params.roots);
  if (root !== null && root === newRoot) {
    const oldRel = params.move.from.slice(root.length + 1);
    const newRel = params.move.to.slice(root.length + 1);
    for (const variant of pathVariants(oldRel, newRel)) {
      forms.push({ ...variant, kind: "package-relative", scopeRoot: root });
    }
  }
  return forms;
}

/** Directories have no extension, so only the raw repo-relative and package-relative forms apply. */
export function directoryForms(params: { rename: DirectoryRename; roots: string[] }): LiteralForm[] {
  const forms: LiteralForm[] = [
    { old: params.rename.from, new: params.rename.to, kind: "directory-repo-relative", scopeRoot: null },
  ];
  const root = owningRoot(params.rename.from, params.roots);
  const newRoot = owningRoot(params.rename.to, params.roots);
  if (root !== null && root === newRoot) {
    forms.push({
      old: params.rename.from.slice(root.length + 1),
      new: params.rename.to.slice(root.length + 1),
      kind: "directory-package-relative",
      scopeRoot: root,
    });
  }
  return forms;
}
