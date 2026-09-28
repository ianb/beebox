/**
 * Finding (registry): a registry that nothing imports. A registry declares
 * completeness ("every member of this set is enumerated here"), but only a
 * consumer that reads the registry back (list/byKey/get, or the shared
 * members object passed to a framework call) proves the directory is
 * actually a set — members used uniformly through one list, not each
 * imported individually by its own caller. A registry no `module` ever
 * value-imports is the second-list smell: something declared for the check
 * alone, with no reader to keep it honest. Tests don't count: a doctest
 * exercising the registry in isolation is not a production consumer.
 * Rules: docs/plans/file-layout.md, rule 1/4.
 */
import type { Finding, PackageLayout } from "../../../model.js";
import { modules } from "../../../graph.js";
import type { DeclEntry } from "./decls.js";

/** A declared registry's module is value-imported by no `module` in the package. */
export function registryImportedFindings(layout: PackageLayout, decls: DeclEntry[]): Finding[] {
  const findings: Finding[] = [];
  for (const { module, decl } of decls) {
    const imported = modules(layout).some((candidate) => {
      if (candidate.path === module.path) return false;
      return candidate.imports.some((edge) => !edge.typeOnly && edge.target === module.path);
    });
    if (imported) continue;
    findings.push({
      rule: "registry",
      path: module.path,
      message: `${module.path} declares ${decl.directory} but nothing imports it; the set's consumers must enumerate it through the registry, or the directory is not a set (delete the registry)`,
    });
  }
  return findings;
}
