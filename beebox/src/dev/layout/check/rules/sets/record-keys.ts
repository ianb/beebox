/**
 * Finding 4 (registry): a record-form member whose literal key does not equal
 * its member name in identifier form. `docs/plans/file-layout.md`'s "Record
 * keys" bullet: `quick-chat.ts` is keyed `quickChat`.
 */
import type { Finding } from "../../../model.js";
import { classifyMemberSource, type DeclEntry } from "./decls.js";

/** Kebab-case to camelCase: `quick-chat` -> `quickChat`; a name with no hyphens is unchanged. */
function toCamelCase(name: string): string {
  return name.replace(/-([\da-z])/g, (_match, char: string) => char.toUpperCase());
}

/** A record-form member whose literal key differs from its member name in identifier form. */
export function recordKeyFindings(entry: DeclEntry): Finding[] {
  const { module, decl } = entry;
  if (decl.form !== "record") return [];
  const findings: Finding[] = [];
  for (const member of decl.members) {
    if (member.source === null || member.key === null) continue;
    const location = classifyMemberSource(decl, member.source);
    if (!location.valid || location.name === null) continue;
    const expectedKey = toCamelCase(location.name);
    if (member.key === expectedKey) continue;
    findings.push({
      rule: "registry",
      path: module.path,
      message: `record key "${member.key}" does not match expected key "${expectedKey}" for member "${location.name}" (${member.source}); rename the key or the member to match`,
    });
  }
  return findings;
}
