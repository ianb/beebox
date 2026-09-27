/**
 * Registry declarations and where a member's source sits relative to its set
 * directory — shared by every check in this rule.
 */
import type { ModuleFile, PackageLayout, RegistryDecl } from "../../../model.js";
import { isWithin, modules, stemOf } from "../../../graph.js";

export interface DeclEntry {
  module: ModuleFile;
  decl: RegistryDecl;
}

export function collectDecls(layout: PackageLayout): DeclEntry[] {
  const entries: DeclEntry[] = [];
  for (const module of modules(layout)) {
    for (const decl of module.registries) entries.push({ module, decl });
  }
  return entries;
}

export interface MemberLocation {
  valid: boolean;
  /** File stem for a file member, subdirectory name for a directory member. */
  name: string | null;
  /** The file itself for a file member, its containing subdirectory for a directory member. */
  scope: string | null;
}

export const NOT_LOCATED: MemberLocation = { valid: false, name: null, scope: null };

/** Where `source` sits relative to `decl`'s set directory. */
export function classifyMemberSource(decl: RegistryDecl, source: string): MemberLocation {
  const { directory, entry } = decl;
  if (!isWithin(source, directory) || source === directory) return NOT_LOCATED;
  const segments = source.slice(directory.length + 1).split("/");
  if (segments.length === 1) return { valid: true, name: stemOf(source), scope: source };
  const [subdirectory] = segments;
  if (segments.length === 2 && entry !== null && stemOf(source) === entry && subdirectory !== undefined) {
    return { valid: true, name: subdirectory, scope: `${directory}/${subdirectory}` };
  }
  return NOT_LOCATED;
}
