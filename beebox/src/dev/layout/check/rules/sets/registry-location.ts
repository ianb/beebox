/**
 * Findings 1 and 2 (registry): a set directory declared by more than one
 * registry, and a registry that does not sit in its set directory's parent
 * (or is misnamed).
 */
import type { Finding } from "../../../model.js";
import { baseOf, dirOf, stemOf } from "../../../graph.js";
import type { DeclEntry } from "./decls.js";

/** Finding 1 (registry): two or more registries declare the same set directory. */
export function duplicateDirectoryFindings(decls: DeclEntry[]): Finding[] {
  const byDirectory = new Map<string, DeclEntry[]>();
  for (const entry of decls) {
    const group = byDirectory.get(entry.decl.directory);
    if (group === undefined) byDirectory.set(entry.decl.directory, [entry]);
    else group.push(entry);
  }
  const findings: Finding[] = [];
  for (const [directory, group] of byDirectory) {
    if (group.length < 2) continue;
    for (const entry of group) {
      const others = group
        .filter((other) => other !== entry)
        .map((other) => other.module.path)
        .toSorted();
      findings.push({
        rule: "registry",
        path: entry.module.path,
        message: `set directory ${directory} is also declared by ${others.join(", ")}; keep exactly one defineRegistry call per set directory`,
      });
    }
  }
  return findings;
}

/** Finding 2 (registry): the registry does not sit in the set directory's parent, or is misnamed. */
export function registryLocationFindings(decls: DeclEntry[]): Finding[] {
  const findings: Finding[] = [];
  for (const { module, decl } of decls) {
    const expectedParent = dirOf(decl.directory);
    const expectedStem = baseOf(decl.directory);
    const actualParent = dirOf(module.path);
    const actualStem = stemOf(module.path);
    if (actualParent === expectedParent && actualStem === expectedStem) continue;
    const extension = module.path.slice(module.path.lastIndexOf(".") + 1);
    const expectedPath = `${expectedParent}/${expectedStem}.${extension}`;
    findings.push({
      rule: "registry",
      path: module.path,
      message: `registry for set directory ${decl.directory} must be ${expectedPath} (the set directory's parent, named for the set); move or rename it`,
    });
  }
  return findings;
}
