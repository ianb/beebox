/**
 * Finding 5 (member-imports) and finding 6 (registry): a value import between
 * two members of the same set, and a member that imports its own registry.
 */
import type { Finding, PackageLayout } from "../../../model.js";
import { isWithin, modules, tests } from "../../../graph.js";
import { classifyMemberSource, type DeclEntry } from "./decls.js";

export interface MemberOwner {
  setDirectory: string;
  memberName: string;
}

/** Every file that belongs to a member of any set, keyed by path. */
export function fileToMember(layout: PackageLayout, decls: DeclEntry[]): Map<string, MemberOwner> {
  const owners = new Map<string, MemberOwner>();
  for (const { decl } of decls) {
    for (const member of decl.members) {
      if (member.source === null) continue;
      const location = classifyMemberSource(decl, member.source);
      if (!location.valid || location.name === null || location.scope === null) continue;
      const owner: MemberOwner = { setDirectory: decl.directory, memberName: location.name };
      if (location.scope === member.source) {
        owners.set(member.source, owner);
        continue;
      }
      for (const path of layout.files.keys()) {
        if (isWithin(path, location.scope)) owners.set(path, owner);
      }
    }
  }
  return owners;
}

/** Finding 5 (member-imports): a value import between two members of the same set. */
export function memberImportFindings(layout: PackageLayout, owners: Map<string, MemberOwner>): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const file of [...modules(layout), ...tests(layout)]) {
    const owner = owners.get(file.path);
    if (owner === undefined) continue;
    for (const edge of file.imports) {
      if (edge.typeOnly || edge.target === null) continue;
      const target = owners.get(edge.target);
      if (target === undefined || target.setDirectory !== owner.setDirectory) continue;
      if (target.memberName === owner.memberName) continue;
      const key = `${file.path}|${owner.memberName}|${target.memberName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        rule: "member-imports",
        path: file.path,
        message: `imports ${edge.target} (member "${target.memberName}") from member "${owner.memberName}" of the same set; move the shared thing to infrastructure outside the set, or merge the two members`,
      });
    }
  }
  return findings;
}

export interface MemberImportsRegistryArgs {
  layout: PackageLayout;
  decls: DeclEntry[];
  owners: Map<string, MemberOwner>;
}

/** Finding 6 (registry): a member file that imports its own registry. */
export function memberImportsRegistryFindings({ layout, decls, owners }: MemberImportsRegistryArgs): Finding[] {
  const findings: Finding[] = [];
  for (const { module, decl } of decls) {
    for (const [path, owner] of owners) {
      if (owner.setDirectory !== decl.directory) continue;
      const file = layout.files.get(path);
      if (file === undefined || (file.kind !== "module" && file.kind !== "test")) continue;
      if (file.imports.some((edge) => edge.target === module.path)) {
        findings.push({
          rule: "registry",
          path,
          message: `imports its own registry ${module.path}; members must not import their registry`,
        });
      }
    }
  }
  return findings;
}
