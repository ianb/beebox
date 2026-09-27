/**
 * Rule 8 (tests): a package has one source root; its test root mirrors it
 * directory-for-directory; a test is named for the module or directory it
 * tests, and a test directory that does not mirror source must be a scenario
 * group: directly under the test root, with no source counterpart. Scenario
 * tests name a scenario, not a module, and may import anything for setup.
 * `docs/plans/file-layout.md` rule 8 is the spec.
 */
import { baseOf, dirOf, isWithin, stemOf, tests, commonDir } from "../../graph.js";
import type { Finding, LayoutRule, PackageLayout } from "../../model.js";

const MODULE_TARGET = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;

/** The source directory a test directory mirrors, whether or not it exists. */
function mirrorOf(layout: PackageLayout, dir: string): string {
  if (dir === layout.testRoot) return layout.sourceRoot;
  return layout.sourceRoot + dir.slice(layout.testRoot.length);
}

function isExactMirror(layout: PackageLayout, td: string): boolean {
  return layout.directories.has(mirrorOf(layout, td));
}

/** The path of a source module or directory named `stem` directly under `dir`, if any. */
function sourceEntityNamed(layout: PackageLayout, { dir, stem }: { dir: string; stem: string }): string | undefined {
  if (layout.directories.has(`${dir}/${stem}`)) return `${dir}/${stem}`;
  for (const file of layout.files.values()) {
    if (
      (file.kind === "module" || file.kind === "declaration") &&
      dirOf(file.path) === dir &&
      stemOf(file.path) === stem
    ) {
      return file.path;
    }
  }
  return undefined;
}

function firstStemSegment(path: string): string {
  const stem = stemOf(path);
  return stem.split(".")[0] ?? stem;
}

function sourceRootFindings(layout: PackageLayout): Finding[] {
  return layout.extraSourceRoots.map((root) => ({
    rule: "source-roots",
    path: root,
    message: `second source root; fold it into ${layout.sourceRoot} so tests have one tree to mirror`,
  }));
}

/** Rule 8 test-placement: a test names what it tests by import target, not containment. */
function placementFindings(layout: PackageLayout): Finding[] {
  const findings: Finding[] = [];
  for (const test of tests(layout)) {
    if (!isWithin(test.path, layout.testRoot)) {
      findings.push({
        rule: "test-placement",
        path: test.path,
        message: `tests live under ${layout.testRoot}, mirroring the source path`,
      });
      continue;
    }
    const seen = new Set<string>();
    for (const edge of test.imports) {
      if (edge.external || edge.typeOnly || edge.target === null || seen.has(edge.target)) continue;
      const target = edge.target;
      seen.add(target);
      const nestedPackage = layout.nestedPackages.find((np) => isWithin(target, np));
      if (nestedPackage !== undefined) {
        findings.push({
          rule: "test-placement",
          path: test.path,
          message: `tests ${nestedPackage} code; it belongs in ${nestedPackage}/test`,
        });
        continue;
      }
      if (!isWithin(target, layout.root) && MODULE_TARGET.test(target)) {
        findings.push({
          rule: "test-placement",
          path: test.path,
          message: `tests ${target}, which is outside this package; it belongs in that package's test root`,
        });
      }
    }
  }
  return findings;
}

/** Rule 8 test-naming: an exact-mirror test names the module or directory it tests. */
function namingFindings(layout: PackageLayout): Finding[] {
  const findings: Finding[] = [];
  for (const test of tests(layout)) {
    if (!isWithin(test.path, layout.testRoot)) continue;
    const td = dirOf(test.path);
    if (!isExactMirror(layout, td)) continue;
    const sourceDir = mirrorOf(layout, td);
    const stem = firstStemSegment(test.path);
    if (sourceEntityNamed(layout, { dir: sourceDir, stem }) !== undefined) continue;
    findings.push({
      rule: "test-naming",
      path: test.path,
      message:
        `${baseOf(test.path)} names no module or directory in ${sourceDir}; ` +
        "name it subject.facet.ext after the module or directory it tests",
    });
  }
  return findings;
}

/** The directory directly under `testRoot` that contains `td` (or `td` itself). */
function testGroupDir(layout: PackageLayout, td: string): string {
  const rel = td.slice(layout.testRoot.length + 1);
  const slash = rel.indexOf("/");
  return `${layout.testRoot}/${slash === -1 ? rel : rel.slice(0, slash)}`;
}

/** Rule 8 test-structure: a non-mirror directory is allowed only inside a scenario group. */
function structureFindings(layout: PackageLayout): Finding[] {
  const findings: Finding[] = [];
  for (const test of tests(layout)) {
    if (!isWithin(test.path, layout.testRoot)) continue;
    const td = dirOf(test.path);
    if (isExactMirror(layout, td)) continue;
    const groupDir = testGroupDir(layout, td);
    const groupName = baseOf(groupDir);
    const nested = `${layout.sourceRoot}/${groupName}`;
    const extraRoot = `${layout.root}/${groupName}`;
    if (layout.nestedPackages.includes(nested)) {
      findings.push({
        rule: "test-structure",
        path: test.path,
        message: `${groupDir} mirrors the nested package ${nested}; its tests belong in ${nested}/test`,
      });
      continue;
    }
    if (layout.extraSourceRoots.includes(extraRoot)) {
      findings.push({
        rule: "test-structure",
        path: test.path,
        message: `${groupDir} mirrors the second source root ${extraRoot}; fold that root into ${layout.sourceRoot} and mirror it there`,
      });
      continue;
    }
    if (layout.directories.has(mirrorOf(layout, groupDir))) {
      findings.push({
        rule: "test-structure",
        path: test.path,
        message: `${td} has no source counterpart; move this test to the mirror of the module it tests`,
      });
    }
  }
  return findings;
}

/** Directories under `testRoot` with no test file anywhere beneath them. */
function supportDirectories(layout: PackageLayout): Set<string> {
  const testPaths = tests(layout).map((test) => test.path);
  const result = new Set<string>();
  for (const dir of layout.directories) {
    if (dir === layout.testRoot || !isWithin(dir, layout.testRoot)) continue;
    if (!testPaths.some((path) => isWithin(path, dir))) result.add(dir);
  }
  return result;
}

function supportPlacementFindings(layout: PackageLayout): Finding[] {
  const findings: Finding[] = [];
  const supportDirs = supportDirectories(layout);
  for (const file of layout.files.values()) {
    if (file.kind !== "module" || !isWithin(file.path, layout.testRoot)) continue;
    const importers: string[] = [];
    for (const other of layout.files.values()) {
      if (other.path === file.path) continue;
      if (other.kind !== "module" && other.kind !== "test") continue;
      if (!isWithin(other.path, layout.testRoot)) continue;
      if (other.imports.some((edge) => edge.target === file.path)) importers.push(other.path);
    }
    if (importers.length === 0) continue;
    const commonImporterDir = commonDir(importers);
    const supportDir = dirOf(file.path);
    if (supportDir === commonImporterDir) continue;
    if (dirOf(supportDir) === commonImporterDir && supportDirs.has(supportDir)) continue;
    findings.push({
      rule: "support-placement",
      path: file.path,
      message: `used by tests under ${commonImporterDir}; move it to ${commonImporterDir}/ (or a support directory directly under it)`,
    });
  }
  return findings;
}

function byPathThenMessage(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export const testsRule: LayoutRule = {
  description:
    "one source root; tests live under the test root; a test is named for the module or " +
    "directory it tests, and a non-mirror test directory sits in a scenario group under the test root",
  check(layout: PackageLayout): Finding[] {
    const findings = [
      ...sourceRootFindings(layout),
      ...placementFindings(layout),
      ...namingFindings(layout),
      ...structureFindings(layout),
      ...supportPlacementFindings(layout),
    ];
    return findings.toSorted(byPathThenMessage);
  },
};
