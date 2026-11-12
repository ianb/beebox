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
 * Rules: docs/implemented-plans/file-layout.md, rules 3 and 5.
 */
import type { Finding, LayoutRule, ModuleFile, PackageLayout } from "../../model.js";
import { baseOf, childrenOf, dirOf, isWithin, modules, stemOf } from "../../graph.js";

interface UnitsContext {
  layout: PackageLayout;
  importersByTarget: Map<string, Set<string>>;
  setDirs: Set<string>;
  /**
   * Modules whose location a registry fixes: the registry itself, or the
   * source of one of its members (a file member, or a directory member's
   * `<dir>/<name>/<entry>.ts`). Such a module is always an entry of its
   * directory and never a unit-directory or shared-infrastructure move
   * candidate (docs/implemented-plans/file-layout.md, Ontology).
   */
  fixedEntries: Set<string>;
}

function computeFixedEntries(layout: PackageLayout): Set<string> {
  const fixed = new Set<string>();
  for (const module of modules(layout)) {
    if (module.registries.length > 0) fixed.add(module.path);
    for (const registry of module.registries) {
      for (const member of registry.members) {
        if (member.source !== null) fixed.add(member.source);
      }
    }
  }
  return fixed;
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
  edges: string[];
  otherEntries: string[];
}

/** At most this many other entries are named in one finding; the rest are counted. */
const MAX_NAMED_OTHER_ENTRIES = 5;

function unitMessage(spec: UnitMessageSpec): string {
  const { dir, entry, helpers, edges, otherEntries } = spec;
  const stem = stemOf(entry.path);
  const helperNames = helpers.map((helper) => baseOf(helper.path)).toSorted().join(", ");
  const named = otherEntries.slice(0, MAX_NAMED_OTHER_ENTRIES);
  const rest = otherEntries.length - named.length;
  const others = rest > 0 ? `${named.join(", ")}, and ${rest} more` : named.join(", ");
  return (
    `${baseOf(entry.path)} and its helpers ${helperNames} are one unit beside other units in ${dir}; ` +
    `make ${dir}/${stem}/ and move them in, dropping the ${stem}- prefix, and rename their mirrored tests to match. ` +
    `If a new import of one of these helpers made this a unit, importing through ${baseOf(entry.path)} instead may be the smaller fix ` +
    `(beebox/docs/implemented-plans/file-layout.md, rule 5). Unit imports: ${edges.join(", ")}. Other entries: ${others}`
  );
}

/**
 * Why a sibling is an entry of its directory, for a reader hunting the edge
 * that split the directory: a registry fixes it, nothing imports it, or a
 * module outside the directory imports it (the first such importer is named).
 */
function entryReason(params: { ctx: UnitsContext; dir: string; path: string }): string {
  const { ctx, dir, path } = params;
  if (ctx.fixedEntries.has(path)) return "registry-fixed";
  const importers = [...(ctx.importersByTarget.get(path) ?? new Set<string>())].toSorted();
  const outside = importers.find((importer) => dirOf(importer) !== dir);
  return outside === undefined ? "no importers" : `imported by ${outside}`;
}

/** `importer -> imported` sibling edges inside one unit, by basename, sorted. */
function unitEdges(params: { members: Set<string>; adjacency: Map<string, Set<string>> }): string[] {
  const edges: string[] = [];
  for (const from of params.members) {
    for (const to of params.adjacency.get(from) ?? []) {
      if (params.members.has(to)) edges.push(`${baseOf(from)} -> ${baseOf(to)}`);
    }
  }
  return edges.toSorted();
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

interface DirectoryGraph {
  dir: string;
  siblings: ModuleFile[];
  entries: Set<string>;
  adjacency: Map<string, Set<string>>;
  owners: Map<string, Set<string>>;
}

function directoryGraph(ctx: UnitsContext, dir: string): DirectoryGraph {
  const siblings = childrenOf(ctx.layout, dir).files.filter((file): file is ModuleFile => file.kind === "module");
  const siblingPaths = new Set(siblings.map((sibling) => sibling.path));
  const entries = new Set(
    siblings
      .filter(
        (sibling) =>
          ctx.fixedEntries.has(sibling.path) || isEntry(dir, ctx.importersByTarget.get(sibling.path) ?? new Set()),
      )
      .map((sibling) => sibling.path),
  );
  const adjacency = buildAdjacency(siblings, siblingPaths);
  return { dir, siblings, entries, adjacency, owners: computeOwners(adjacency, entries) };
}

/** The siblings only `entryPath` reaches: its exclusive helpers. */
function exclusiveHelpers(graph: DirectoryGraph, entryPath: string): ModuleFile[] {
  return graph.siblings.filter((sibling) => {
    if (graph.entries.has(sibling.path)) return false;
    const ownerSet = graph.owners.get(sibling.path);
    return ownerSet !== undefined && ownerSet.size === 1 && ownerSet.has(entryPath);
  });
}

function unitMembers(entryPath: string, helpers: ModuleFile[]): Set<string> {
  return new Set([entryPath, ...helpers.map((helper) => helper.path)]);
}

function unitDirectoryFindings(ctx: UnitsContext, graph: DirectoryGraph): Finding[] {
  const { dir, siblings, entries, adjacency } = graph;
  if (entries.size < 2) return [];
  const findings: Finding[] = [];
  for (const entryPath of [...entries].toSorted()) {
    // A registry fixes this entry's location (itself, or as a set member's
    // source): it stays an entry of its directory and is never swept into
    // a unit-directory move, whatever helpers it exclusively reaches.
    if (ctx.fixedEntries.has(entryPath)) continue;
    const entryModule = siblings.find((sibling) => sibling.path === entryPath);
    if (entryModule === undefined) continue;
    const helpers = exclusiveHelpers(graph, entryPath);
    if (helpers.length === 0) continue;
    const otherEntries = [...entries]
      .filter((other) => other !== entryPath)
      .toSorted()
      .map((other) => `${baseOf(other)} (${entryReason({ ctx, dir, path: other })})`);
    const edges = unitEdges({ members: unitMembers(entryPath, helpers), adjacency });
    findings.push({
      rule: "unit-directory",
      path: entryPath,
      message: unitMessage({ dir, entry: entryModule, helpers, edges, otherEntries }),
    });
  }
  return findings;
}

interface SharedInfrastructureSpec {
  dir: string;
  siblings: ModuleFile[];
  importersByTarget: Map<string, Set<string>>;
  setDirs: Set<string>;
  fixedEntries: Set<string>;
}

function sharedInfrastructureFindings(spec: SharedInfrastructureSpec): Finding[] {
  const { dir, siblings, importersByTarget, setDirs, fixedEntries } = spec;
  const findings: Finding[] = [];
  for (const sibling of siblings) {
    // A module whose location a registry fixes (it declares the registry,
    // or it is a set member's source) is never a shared-infrastructure move
    // candidate.
    if (fixedEntries.has(sibling.path)) continue;
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
  const graph = directoryGraph(ctx, dir);
  if (graph.siblings.length === 0) return [];
  return [
    ...unitDirectoryFindings(ctx, graph),
    ...sharedInfrastructureFindings({
      dir,
      siblings: graph.siblings,
      importersByTarget: ctx.importersByTarget,
      setDirs: ctx.setDirs,
      fixedEntries: ctx.fixedEntries,
    }),
  ];
}

function compareFindings(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

function unitsContext(layout: PackageLayout): UnitsContext {
  return {
    layout,
    importersByTarget: moduleImportersOf(layout),
    setDirs: new Set(modules(layout).flatMap((module) => module.registries.map((registry) => registry.directory))),
    fixedEntries: computeFixedEntries(layout),
  };
}

function scopeNote(ctx: UnitsContext, dir: string): string {
  if (!inScope(ctx.layout, dir)) return " (outside the rule's scope)";
  if (ctx.setDirs.has(dir)) return " (a set directory; rule 1 governs it)";
  return "";
}

/**
 * The unit graph of one directory as rule 5 sees it, for `layout-check
 * --explain <dir>`: each entry with why it is one, its exclusive helpers and
 * the sibling imports inside its unit, then helpers two or more entries
 * reach. A planner can place a stub file with its imports and read the
 * result before a commit trips the rule.
 */
export function explainDirectory(layout: PackageLayout, dir: string): string[] {
  const ctx = unitsContext(layout);
  const graph = directoryGraph(ctx, dir);
  if (graph.siblings.length === 0) return [`${dir}: no modules`];
  const lines = [`${dir}: ${graph.entries.size} entries${scopeNote(ctx, dir)}`];
  for (const entryPath of [...graph.entries].toSorted()) {
    lines.push(`  ${baseOf(entryPath)} (${entryReason({ ctx, dir, path: entryPath })})`);
    const helpers = exclusiveHelpers(graph, entryPath);
    if (helpers.length === 0) continue;
    lines.push(`    helpers: ${helpers.map((helper) => baseOf(helper.path)).toSorted().join(", ")}`);
    lines.push(`    imports: ${unitEdges({ members: unitMembers(entryPath, helpers), adjacency: graph.adjacency }).join(", ")}`);
  }
  const shared = graph.siblings
    .filter((sibling) => (graph.owners.get(sibling.path)?.size ?? 0) > 1)
    .map((sibling) => {
      const owners = [...(graph.owners.get(sibling.path) ?? [])].map(baseOf).toSorted();
      return `  ${baseOf(sibling.path)} (reached from ${owners.join(", ")})`;
    })
    .toSorted();
  if (shared.length > 0) lines.push("shared helpers:", ...shared);
  return lines;
}

export const unitsRule: LayoutRule = {
  description:
    "rule 3: a module reachable from two or more entries is infrastructure and moves to the lowest directory containing all its uses; " +
    "rule 5: a unit of two or more files becomes its own directory",
  check(layout: PackageLayout): Finding[] {
    const ctx = unitsContext(layout);
    const scopedDirs = [...layout.directories].filter((dir) => inScope(layout, dir) && !ctx.setDirs.has(dir));
    return scopedDirs.flatMap((dir) => checkDirectory(ctx, dir)).toSorted(compareFindings);
  },
};
