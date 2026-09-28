/**
 * Rules 1, 2, and 4 (a set directory holds members only, declared by exactly
 * one registry that sits in the set's parent and is named for the set) plus
 * the side-effect-registration check from rule 4's "nothing else constructs
 * the list" and the mechanical guard that the registry is actually read: a
 * declared registry no module value-imports is a second list that only
 * satisfies the check, not a real set. Rules: docs/plans/file-layout.md.
 * Each finding is a sibling module by job; this file only assembles and
 * sorts them.
 */
import type { Finding, LayoutRule, PackageLayout } from "../../../model.js";
import { collectDecls } from "./decls.js";
import { fileToMember, memberImportFindings, memberImportsRegistryFindings } from "./member-imports.js";
import { pathReadFindings } from "./path-reads.js";
import { recordKeyFindings } from "./record-keys.js";
import { duplicateDirectoryFindings, registryLocationFindings } from "./registry-location.js";
import { registryImportedFindings } from "./registry-imported.js";
import { misplacedMemberFindings, unclaimedChildFindings } from "./set-members.js";
import { sideEffectRegistrationFindings } from "./side-effect-registration.js";

function byPathThenMessage(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export const setsRule: LayoutRule = {
  description: "a set directory holds only its registry's members, declared once in its parent and named for the set",
  check(layout: PackageLayout): Finding[] {
    const decls = collectDecls(layout);
    const owners = fileToMember(layout, decls);
    const findings = [
      ...duplicateDirectoryFindings(decls),
      ...registryLocationFindings(decls),
      ...decls.flatMap((entry) => unclaimedChildFindings(layout, entry)),
      ...decls.flatMap((entry) => misplacedMemberFindings(entry)),
      ...decls.flatMap((entry) => recordKeyFindings(entry)),
      ...memberImportFindings(layout, owners),
      ...memberImportsRegistryFindings({ layout, decls, owners }),
      ...sideEffectRegistrationFindings(layout),
      ...pathReadFindings(layout, decls),
      ...registryImportedFindings(layout, decls),
    ];
    return findings.toSorted(byPathThenMessage);
  },
};
