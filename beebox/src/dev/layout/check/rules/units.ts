/**
 * Rules 3 and 5: a module reachable from two or more entries is
 * infrastructure and moves to the lowest directory containing all its
 * uses; a unit of two or more files (an entry plus the helpers only it
 * reaches) becomes its own directory.
 *
 * Scope: every directory at or under `layout.sourceRoot` or an
 * `extraSourceRoots` entry, except a set directory (some module's
 * `registries[].directory`), which rule 1 governs at its own top level.
 * Only `module` files are siblings and importers here; tests never count
 * as importers for this rule (tests import internals freely).
 * Rules: docs/plans/file-layout.md, rules 3 and 5.
 */
import type { Finding, LayoutRule, ModuleFile, PackageLayout } from "../../model.js";
import { baseOf, childrenOf, dirOf, isWithin, modules, stemOf } from "../../graph.js";

interface UnitsContext {
  layout: PackageLayout;
  importersByTarget: Map<string, Set<string>>;
  setDirs: Set<string>;
}

function moduleImportersOf(layout: PackageLayout): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const module of modules(layout)) {
    for (const edge of module.imports) {
      if (edge.target === null) continue;
      let importers = result.get(edge.target);
      if (importers === undefined) {
        importers = new Set();
        result.set(edge.target, importers);
      }
      importers.add(module.path);
    }
  }
  return result;
}

function inScope(layout: PackageLayout, dir: string): boolean {
  return isWithin(dir, layout.sourceRoot) || layout.extraSourceRoots.some((root) => isWithin(dir, root));
}

function isEntry(dir: string, importers: Set<string>): boolean {
  return importers.size === 0 || [...importers].some((importer) => dirOf(importer) !== dir);
}

function buildAdjacency(siblings: ModuleFile[], siblingPaths: Set<string>): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const sibling of siblings) {
    const targets = new Set<string>();
    for (const edge of sibling.imports) {
      if (edge.target !== null && edge.target !== sibling.path && siblingPaths.has(edge.target)) {
        targets.add(edge.target);
      }
    }
    adjacency.set(sibling.path, targets);
  }
  return adjacency;
}

interface ReachSpec {
  adjacency: Map<string, Set<string>>;
  entries: Set<string>;
  start: string;
}

/** Non-entry siblings reachable from `start` without continuing through another entry. */
function reachableNonEntries(spec: ReachSpec): Set<string> {
  const { adjacency, entries, start } = spec;
  const reached = new Set<string>();
  const visited = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      if (entries.has(next)) continue;
      reached.add(next);
      stack.push(next);
    }
  }
  return reached;
}

function computeOwners(adjacency: Map<string, Set<string>>, entries: Set<string>): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const entry of entries) {
    const reached = reachableNonEntries({ adjacency, entries, start: entry });
    for (const node of reached) {
      let ownerSet = owners.get(node);
      if (ownerSet === undefined) {
        ownerSet = new Set();
        owners.set(node, ownerSet);
      }
      ownerSet.add(entry);
    }
  }
  return owners;
}

interface UnitMessageSpec {
  dir: string;
  entry: ModuleFile;
  helpers: ModuleFile[];
}

function unitMessage(spec: UnitMessageSpec): string {
  const { dir, entry, helpers } = spec;
  const stem = stemOf(entry.path);
  const helperNames = helpers.map((helper) => baseOf(helper.path)).toSorted().join(", ");
  return (
    `${baseOf(entry.path)} and its helpers ${helperNames} are one unit beside other units in ${dir}; ` +
    `make ${dir}/${stem}/ and move them in, dropping the ${stem}- prefix`
  );
}

/** The sole immediate child directory of `dir` strictly containing every importer, or null. */
function soleSubdirectory(dir: string, importers: Set<string>): string | null {
  let child: string | null = null;
  for (const importer of importers) {
    const importerDir = dirOf(importer);
    if (!importerDir.startsWith(`${dir}/`)) return null;
    const rest = importerDir.slice(dir.length + 1);
    const firstSegment = rest.split("/")[0] ?? "";
    const candidate = `${dir}/${firstSegment}`;
    if (child === null) child = candidate;
    else if (child !== candidate) return null;
  }
  return child;
}

interface SharedTargetSpec {
  dir: string;
  importers: Set<string>;
  setDirs: Set<string>;
}

/**
 * The move target for a shared helper: the sole subdirectory of `dir`
 * containing every importer, descending past any set directory into the
 * one member directory holding every importer (rule 1: a set directory
 * holds members only). Null when there is no sole subdirectory, or when a
 * set directory's importers do not narrow to one member directory.
 */
function sharedTarget(spec: SharedTargetSpec): string | null {
  const { dir, importers, setDirs } = spec;
  let candidate = soleSubdirectory(dir, importers);
  while (candidate !== null && setDirs.has(candidate)) {
    candidate = soleSubdirectory(candidate, importers);
  }
  return candidate;
}

interface UnitDirectorySpec {
  dir: string;
  siblings: ModuleFile[];
  entries: Set<string>;
  owners: Map<string, Set<string>>;
}

function unitDirectoryFindings(spec: UnitDirectorySpec): Finding[] {
  const { dir, siblings, entries, owners } = spec;
  if (entries.size < 2) return [];
  const findings: Finding[] = [];
  for (const entryPath of [...entries].toSorted()) {
    const entryModule = siblings.find((sibling) => sibling.path === entryPath);
    if (entryModule === undefined) continue;
    const helpers = siblings.filter((sibling) => {
      if (entries.has(sibling.path)) return false;
      const ownerSet = owners.get(sibling.path);
      return ownerSet !== undefined && ownerSet.size === 1 && ownerSet.has(entryPath);
    });
    if (helpers.length === 0) continue;
    findings.push({
      rule: "unit-directory",
      path: entryPath,
      message: unitMessage({ dir, entry: entryModule, helpers }),
    });
  }
  return findings;
}

interface SharedInfrastructureSpec {
  dir: string;
  siblings: ModuleFile[];
  importersByTarget: Map<string, Set<string>>;
  setDirs: Set<string>;
}

function sharedInfrastructureFindings(spec: SharedInfrastructureSpec): Finding[] {
  const { dir, siblings, importersByTarget, setDirs } = spec;
  const findings: Finding[] = [];
  for (const sibling of siblings) {
    const importers = importersByTarget.get(sibling.path) ?? new Set<string>();
    if (importers.size === 0) continue;
    const target = sharedTarget({ dir, importers, setDirs });
    if (target === null) continue;
    findings.push({
      rule: "shared-infrastructure",
      path: sibling.path,
      message: `used only under ${target}; move it there`,
    });
  }
  return findings;
}

function checkDirectory(ctx: UnitsContext, dir: string): Finding[] {
  const siblings = childrenOf(ctx.layout, dir).files.filter((file): file is ModuleFile => file.kind === "module");
  if (siblings.length === 0) return [];
  const siblingPaths = new Set(siblings.map((sibling) => sibling.path));
  const entries = new Set(
    siblings
      .filter((sibling) => isEntry(dir, ctx.importersByTarget.get(sibling.path) ?? new Set()))
      .map((sibling) => sibling.path),
  );
  const adjacency = buildAdjacency(siblings, siblingPaths);
  const owners = computeOwners(adjacency, entries);
  return [
    ...unitDirectoryFindings({ dir, siblings, entries, owners }),
    ...sharedInfrastructureFindings({ dir, siblings, importersByTarget: ctx.importersByTarget, setDirs: ctx.setDirs }),
  ];
}

function compareFindings(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export const unitsRule: LayoutRule = {
  description:
    "rule 3: a module reachable from two or more entries is infrastructure and moves to the lowest directory containing all its uses; " +
    "rule 5: a unit of two or more files becomes its own directory",
  check(layout: PackageLayout): Finding[] {
    const setDirs = new Set(modules(layout).flatMap((module) => module.registries.map((registry) => registry.directory)));
    const ctx: UnitsContext = { layout, importersByTarget: moduleImportersOf(layout), setDirs };
    const scopedDirs = [...layout.directories].filter((dir) => inScope(layout, dir) && !setDirs.has(dir));
    return scopedDirs.flatMap((dir) => checkDirectory(ctx, dir)).toSorted(compareFindings);
  },
};
