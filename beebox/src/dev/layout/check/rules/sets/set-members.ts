/**
 * Finding 3 (set-members): completeness both ways — a direct child of the set
 * directory that no member claims, and a member whose source is missing or
 * outside a valid location. Only `module`, `test`, and `declaration` files
 * (and subdirectories) are candidate members; `data` files (fixtures,
 * `.card`, `.html`, `.svg`, assets, a directory's `CLAUDE.md`/`AGENTS.md`)
 * are opaque to the rules (Ontology, "Scope of the rules") and never
 * unclaimed.
 */
import type { Finding } from "../../../model.js";
import { childrenOf, dirOf, stemOf } from "../../../graph.js";
import type { PackageLayout } from "../../../model.js";
import { classifyMemberSource, type DeclEntry } from "./decls.js";

/** A direct child of the set directory that no member claims. */
export function unclaimedChildFindings(layout: PackageLayout, entry: DeclEntry): Finding[] {
  const { module, decl } = entry;
  const findings: Finding[] = [];
  const sources = new Set(decl.members.flatMap((member) => (member.source === null ? [] : [member.source])));
  const { files, dirs } = childrenOf(layout, decl.directory);
  const message = `not a member of ${module.path}; register it or move it out of the set`;
  for (const file of files) {
    if (file.kind === "data") continue;
    if (!sources.has(file.path)) findings.push({ rule: "set-members", path: file.path, message });
  }
  for (const subdirectory of dirs) {
    const claimed =
      decl.entry !== null &&
      decl.members.some((member) => member.source !== null && dirOf(member.source) === subdirectory && stemOf(member.source) === decl.entry);
    if (!claimed) findings.push({ rule: "set-members", path: subdirectory, message });
  }
  return findings;
}

/** A member whose source is missing or outside a valid location. */
export function misplacedMemberFindings(entry: DeclEntry): Finding[] {
  const { module, decl } = entry;
  const findings: Finding[] = [];
  for (const member of decl.members) {
    if (member.source === null) {
      findings.push({
        rule: "set-members",
        path: module.path,
        message: `member ${member.expression} is not imported from the set directory`,
      });
      continue;
    }
    const location = classifyMemberSource(decl, member.source);
    if (location.valid) continue;
    findings.push({
      rule: "set-members",
      path: member.source,
      message: `member ${member.expression}'s source ${member.source} is not a valid location in set directory ${decl.directory} (must be ${decl.directory}/<name>.ts, or with an entry, ${decl.directory}/<name>/<entry>.ts); move it or fix the registry`,
    });
  }
  return findings;
}
