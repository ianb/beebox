/**
 * Rules 1, 2, and 4 (a set directory holds members only, declared by exactly
 * one registry that sits in the set's parent and is named for the set) plus
 * the side-effect-registration check from rule 4's "nothing else constructs
 * the list". Rules: docs/plans/file-layout.md.
 */
import type { Finding, LayoutRule, ModuleFile, PackageLayout, RegistryDecl } from "../../model.js";
import { baseOf, childrenOf, dirOf, isWithin, modules, stemOf, tests } from "../../graph.js";

interface DeclEntry {
  module: ModuleFile;
  decl: RegistryDecl;
}

function collectDecls(layout: PackageLayout): DeclEntry[] {
  const entries: DeclEntry[] = [];
  for (const module of modules(layout)) {
    for (const decl of module.registries) entries.push({ module, decl });
  }
  return entries;
}

/** Finding 1 (registry): two or more registries declare the same set directory. */
function duplicateDirectoryFindings(decls: DeclEntry[]): Finding[] {
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
function registryLocationFindings(decls: DeclEntry[]): Finding[] {
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

interface MemberLocation {
  valid: boolean;
  /** File stem for a file member, subdirectory name for a directory member. */
  name: string | null;
  /** The file itself for a file member, its containing subdirectory for a directory member. */
  scope: string | null;
}

const NOT_LOCATED: MemberLocation = { valid: false, name: null, scope: null };

/** Where `source` sits relative to `decl`'s set directory. */
function classifyMemberSource(decl: RegistryDecl, source: string): MemberLocation {
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

/** Finding 3 (set-members): a direct child of the set directory that no member claims. */
function unclaimedChildFindings(layout: PackageLayout, entry: DeclEntry): Finding[] {
  const { module, decl } = entry;
  const findings: Finding[] = [];
  const sources = new Set(decl.members.flatMap((member) => (member.source === null ? [] : [member.source])));
  const { files, dirs } = childrenOf(layout, decl.directory);
  const message = `not a member of ${module.path}; register it or move it out of the set`;
  for (const file of files) {
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

/** Finding 3 (set-members): a member whose source is missing or outside a valid location. */
function misplacedMemberFindings(entry: DeclEntry): Finding[] {
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

/** Finding 4 (registry): a record-form member whose literal key differs from its member name. */
function recordKeyFindings(entry: DeclEntry): Finding[] {
  const { module, decl } = entry;
  if (decl.form !== "record") return [];
  const findings: Finding[] = [];
  for (const member of decl.members) {
    if (member.source === null || member.key === null) continue;
    const location = classifyMemberSource(decl, member.source);
    if (!location.valid || location.name === null || location.name === member.key) continue;
    findings.push({
      rule: "registry",
      path: module.path,
      message: `record key "${member.key}" does not match member name "${location.name}" (${member.source}); rename the key or the member to match`,
    });
  }
  return findings;
}

interface MemberOwner {
  setDirectory: string;
  memberName: string;
}

/** Every file that belongs to a member of any set, keyed by path. */
function fileToMember(layout: PackageLayout, decls: DeclEntry[]): Map<string, MemberOwner> {
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
function memberImportFindings(layout: PackageLayout, owners: Map<string, MemberOwner>): Finding[] {
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

interface MemberImportsRegistryArgs {
  layout: PackageLayout;
  decls: DeclEntry[];
  owners: Map<string, MemberOwner>;
}

/** Finding 6 (registry): a member file that imports its own registry. */
function memberImportsRegistryFindings({ layout, decls, owners }: MemberImportsRegistryArgs): Finding[] {
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

const REGISTER_CALL = /(^|\.)register[A-Z]/;

/** True when `callee`'s root identifier (`a` for `a.b.registerX`) is bound by an external import. */
function isExternalRegistrationCallee(module: ModuleFile, callee: string): boolean {
  const dot = callee.indexOf(".");
  const root = dot === -1 ? callee : callee.slice(0, dot);
  return module.imports.some((edge) => edge.external && edge.names.includes(root));
}

/** Finding 7 (side-effect-registration): a module that registers itself at import using a
 * registration function this package owns (not an external package's own API). */
function sideEffectRegistrationFindings(layout: PackageLayout): Finding[] {
  const findings: Finding[] = [];
  for (const module of modules(layout)) {
    const registersOwnFunction = module.topLevelCalls.some(
      (callee) => REGISTER_CALL.test(callee) && !isExternalRegistrationCallee(module, callee),
    );
    if (!registersOwnFunction) continue;
    findings.push({
      rule: "side-effect-registration",
      path: module.path,
      message: "registers at import; list it in a defineRegistry registry instead",
    });
  }
  return findings;
}

function resolveRelativeLiteral(baseDirectory: string, literal: string): string {
  const parts = baseDirectory === "" ? [] : baseDirectory.split("/");
  for (const segment of literal.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/** Finding 8 (registry): a non-registry module that reads a set directory by path. */
function pathReadFindings(layout: PackageLayout, decls: DeclEntry[]): Finding[] {
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
    ];
    return findings.toSorted(byPathThenMessage);
  },
};
