/**
 * Rule typescript-imports (`docs/implemented-plans/typescript-7.md`, Track C): only
 * `src/lib/typescript/` imports `typescript`, `@typescript/native`, or a
 * subpath of either, type-only imports included. It is the one TypeScript 7
 * boundary, in the beebox package only. Doctests (`*.doctest.md`) are exempt:
 * three stay on the 6.0 `typescript` package.
 */
import type { Finding, LayoutRule, PackageLayout } from "../../model.js";
import { isWithin } from "../../graph.js";

const PACKAGE_ROOT = "beebox";
const PACKAGES = ["typescript", "@typescript/native"];

function isTypeScriptSpecifier(specifier: string): boolean {
  return PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function byPathThenMessage(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export const typescriptImportsRule: LayoutRule = {
  description: "only src/lib/typescript/ imports typescript or @typescript/native (doctests excepted)",
  check(layout: PackageLayout): Finding[] {
    if (layout.root !== PACKAGE_ROOT) return [];
    const boundary = `${layout.sourceRoot}/lib/typescript`;
    const findings: Finding[] = [];
    for (const file of layout.files.values()) {
      if (file.kind !== "module" && file.kind !== "test") continue;
      if (isWithin(file.path, boundary) || file.path.endsWith(".doctest.md")) continue;
      for (const edge of file.imports) {
        if (!edge.external || !isTypeScriptSpecifier(edge.specifier)) continue;
        findings.push({
          rule: "typescript-imports",
          path: file.path,
          message:
            `imports ${edge.specifier}; use ${boundary}/ ` +
            "(the one TypeScript 7 boundary; see docs/implemented-plans/typescript-7.md)",
        });
      }
    }
    return findings.toSorted(byPathThenMessage);
  },
};
