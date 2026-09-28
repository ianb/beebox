/**
 * Finding 8 (registry): a non-registry module that reads a set directory by
 * path instead of importing its registry.
 */
import type { Finding, PackageLayout } from "../../../model.js";
import { dirOf, modules } from "../../../graph.js";
import type { DeclEntry } from "./decls.js";

function resolveRelativeLiteral(baseDirectory: string, literal: string): string {
  const parts = baseDirectory === "" ? [] : baseDirectory.split("/");
  for (const segment of literal.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/** A non-registry module that reads a set directory by path. */
export function pathReadFindings(layout: PackageLayout, decls: DeclEntry[]): Finding[] {
  const declarersByDirectory = new Map<string, Set<string>>();
  for (const { module, decl } of decls) {
    const declarers = declarersByDirectory.get(decl.directory);
    if (declarers === undefined) declarersByDirectory.set(decl.directory, new Set([module.path]));
    else declarers.add(module.path);
  }
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const module of modules(layout)) {
    for (const literal of module.relativePathLiterals) {
      const resolved = resolveRelativeLiteral(dirOf(module.path), literal);
      const declarers = declarersByDirectory.get(resolved);
      if (declarers === undefined || declarers.has(module.path)) continue;
      const key = `${module.path}|${resolved}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        rule: "registry",
        path: module.path,
        message: `reads set directory ${resolved} by path; only its registry enumerates the set`,
      });
    }
  }
  return findings;
}
