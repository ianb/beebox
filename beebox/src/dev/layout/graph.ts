/**
 * Path and import-graph helpers shared by more than one rule.
 */
import type { LayoutFile, ModuleFile, PackageLayout, TestFile } from "./model.js";

export function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Last path segment. */
export function baseOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

const COMPOUND_SUFFIXES = [".doctest.md", ".test.ts", ".tour.ts", ".d.ts"];

/** File name without its extension: `history.archive.doctest.md` → `history.archive`. */
export function stemOf(path: string): string {
  const base = baseOf(path);
  for (const suffix of COMPOUND_SUFFIXES) {
    if (base.endsWith(suffix)) return base.slice(0, -suffix.length);
  }
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
}

/** True when `path` is `dir` or inside it. */
export function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

export function modules(layout: PackageLayout): ModuleFile[] {
  return [...layout.files.values()].filter((f): f is ModuleFile => f.kind === "module");
}

export function tests(layout: PackageLayout): TestFile[] {
  return [...layout.files.values()].filter((f): f is TestFile => f.kind === "test");
}

/** Direct children of a directory: files and subdirectories. */
export function childrenOf(layout: PackageLayout, dir: string): { files: LayoutFile[]; dirs: string[] } {
  const files = [...layout.files.values()].filter((f) => dirOf(f.path) === dir);
  const dirs = [...layout.directories].filter((d) => d !== dir && dirOf(d) === dir);
  return { files, dirs };
}

/** Lowest directory containing every path. */
export function commonDir(paths: string[]): string {
  if (paths.length === 0) return "";
  let common = dirOf(paths[0] ?? "").split("/");
  for (const path of paths.slice(1)) {
    const parts = dirOf(path).split("/");
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common.join("/");
}
