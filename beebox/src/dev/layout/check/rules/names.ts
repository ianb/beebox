/**
 * Rule 6 (no `index`; re-export modules are public surfaces only, kept in
 * `src/exports/`) and principle 4 (a name is never repeated: a file name
 * does not repeat its directory's name). Rules: docs/plans/file-layout.md.
 */
import type { Finding, LayoutRule, PackageLayout } from "../../model.js";
import { baseOf, dirOf, stemOf } from "../../graph.js";

function exportsDirOf(layout: PackageLayout): string {
  return `${layout.sourceRoot}/exports`;
}

/** Finding 1: no module, test, or declaration is named `index`. Data files are opaque to the rule. */
function noIndexFindings(layout: PackageLayout): Finding[] {
  const findings: Finding[] = [];
  for (const file of layout.files.values()) {
    if (file.kind === "data") continue;
    if (stemOf(file.path) !== "index") continue;
    findings.push({ rule: "no-index", path: file.path, message: "name the module by what it does; index names nothing" });
  }
  return findings;
}

/** Finding 2: a re-export-only module lives outside `<sourceRoot>/exports`. */
function reexportSurfaceFindings(layout: PackageLayout, exportsDir: string): Finding[] {
  const findings: Finding[] = [];
  for (const file of layout.files.values()) {
    if (file.kind !== "module" || !file.reexportOnly) continue;
    if (dirOf(file.path) === exportsDir) continue;
    findings.push({
      rule: "reexport-surface",
      path: file.path,
      message: `re-export modules exist only as public surfaces in ${exportsDir}; import from the defining modules instead`,
    });
  }
  return findings;
}

const BUILD_TARGET_SUFFIXES = [".js", ".mjs", ".cjs"];

function isBuildTarget(target: string): boolean {
  return BUILD_TARGET_SUFFIXES.some((suffix) => target.endsWith(suffix));
}

/** Finding 3: each code-target public surface must be built from a module in `exportsDir`. */
function surfaceSourceFindings(layout: PackageLayout, exportsDir: string): Finding[] {
  const findings: Finding[] = [];
  for (const surface of layout.publicSurfaces) {
    if (!isBuildTarget(surface.target)) continue;
    if (surface.source === null) {
      findings.push({
        rule: "public-surface",
        path: surface.target,
        message: `cannot find the source the build produces ${surface.target} from`,
      });
      continue;
    }
    if (dirOf(surface.source) === exportsDir) continue;
    findings.push({
      rule: "public-surface",
      path: surface.source,
      message: `public surface ${surface.specifier} is built from ${surface.source}; move it to ${exportsDir}/`,
    });
  }
  return findings;
}

/** Every module a public surface (of any target kind) is built from, wherever it lives. */
function surfaceSources(layout: PackageLayout): ReadonlySet<string> {
  const sources = new Set<string>();
  for (const surface of layout.publicSurfaces) {
    if (surface.source !== null) sources.add(surface.source);
  }
  return sources;
}

/** Every specifier a public surface declares (`./cards` for a source or a `.d.ts` counterpart). */
function surfaceSpecifiers(layout: PackageLayout): ReadonlySet<string> {
  return new Set(layout.publicSurfaces.map((surface) => surface.specifier));
}

/** Finding 4: every direct child of `exportsDir` is a public surface's source (or its `.d.ts`). */
function exportsMembershipFindings(layout: PackageLayout, exportsDir: string): Finding[] {
  const findings: Finding[] = [];
  const sources = surfaceSources(layout);
  const specifiers = surfaceSpecifiers(layout);
  const message = `not a public surface; every module in ${exportsDir} is a package export's source`;
  for (const file of layout.files.values()) {
    if (dirOf(file.path) !== exportsDir) continue;
    if (file.kind === "module" && sources.has(file.path)) continue;
    if (file.kind === "declaration" && specifiers.has(`./${stemOf(file.path)}`)) continue;
    findings.push({ rule: "public-surface", path: file.path, message });
  }
  return findings;
}

function isSourceRoot(layout: PackageLayout, dir: string): boolean {
  if (dir === layout.root || dir === layout.sourceRoot || dir === layout.testRoot) return true;
  return layout.extraSourceRoots.includes(dir);
}

/** Finding 5: a file name repeats, or prefixes itself with, its own directory's name. */
function repeatedNameFindings(layout: PackageLayout): Finding[] {
  const findings: Finding[] = [];
  for (const file of layout.files.values()) {
    if (file.kind === "data") continue;
    const dir = dirOf(file.path);
    if (isSourceRoot(layout, dir)) continue;
    const dirName = baseOf(dir);
    const stem = stemOf(file.path);
    if (stem === dirName) {
      findings.push({
        rule: "repeated-name",
        path: file.path,
        message: `name it by what it does; ${dirName}/${dirName} repeats the directory`,
      });
    } else if (stem.startsWith(`${dirName}-`) || stem.startsWith(`${dirName}.`)) {
      findings.push({
        rule: "repeated-name",
        path: file.path,
        message: `drop the ${dirName}- prefix: the directory already says it`,
      });
    }
  }
  return findings;
}

function byPathThenMessage(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export const namesRule: LayoutRule = {
  description: "no module named index; re-export modules only as public surfaces; a name never repeats its directory",
  check(layout: PackageLayout): Finding[] {
    const exportsDir = exportsDirOf(layout);
    const findings = [
      ...noIndexFindings(layout),
      ...reexportSurfaceFindings(layout, exportsDir),
      ...surfaceSourceFindings(layout, exportsDir),
      ...exportsMembershipFindings(layout, exportsDir),
      ...repeatedNameFindings(layout),
    ];
    return findings.toSorted(byPathThenMessage);
  },
};
