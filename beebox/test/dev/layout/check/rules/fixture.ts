/**
 * Build a `PackageLayout` by hand for rule doctests. Paths are relative to
 * the package root `pkg`; `imports` lists resolved targets (also relative to
 * `pkg`), with `type:` marking a type-only edge and a bare name marking an
 * external package. Directories are derived from the file paths.
 */
import type {
  ImportEdge,
  LayoutFile,
  PackageLayout,
  PublicSurface,
  RegistryDecl,
  RegistryMember,
} from "../../../../../src/dev/layout/model.js";

const ROOT = "pkg";

export interface FixtureModule {
  imports?: string[];
  registry?: {
    directory: string;
    entry?: string;
    ordered?: boolean;
    form?: "list" | "record";
    /** member source paths; `key` for record form. */
    members: Array<{ source: string | null; key?: string; expression?: string }>;
  };
  reexportOnly?: boolean;
  topLevelCalls?: string[];
  relativePathLiterals?: string[];
}

export interface FixtureSpec {
  /** path → module spec, `"test"` spec, `"data"`, or `"declaration"`. */
  files: Record<string, FixtureModule | { test: string[] } | "data" | "declaration">;
  extraSourceRoots?: string[];
  nestedPackages?: string[];
  publicSurfaces?: Array<{ specifier: string; target: string; source: string | null }>;
}

const abs = (p: string): string => `${ROOT}/${p}`;

function edge(spec: string): ImportEdge {
  const typeOnly = spec.startsWith("type:");
  const raw = typeOnly ? spec.slice(5) : spec;
  const external = !raw.includes("/") && !raw.includes(".");
  return { specifier: raw, target: external ? null : abs(raw), external, typeOnly, names: [], dynamic: false };
}

function registry(r: NonNullable<FixtureModule["registry"]>): RegistryDecl {
  const members: RegistryMember[] = r.members.map((m) => ({
    expression: m.expression ?? (m.source ?? "inline"),
    source: m.source === null ? null : abs(m.source),
    key: m.key ?? null,
  }));
  return {
    directory: abs(r.directory),
    entry: r.entry ?? null,
    ordered: r.ordered ?? false,
    form: r.form ?? "list",
    members,
    line: 1,
  };
}

export function layout(spec: FixtureSpec): PackageLayout {
  const files = new Map<string, LayoutFile>();
  const directories = new Set<string>([ROOT, `${ROOT}/src`]);
  for (const [rel, value] of Object.entries(spec.files)) {
    const path = abs(rel);
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/"));
    if (value === "data" || value === "declaration") {
      files.set(path, { kind: value, path });
    } else if ("test" in value) {
      files.set(path, { kind: "test", path, imports: value.test.map(edge) });
    } else {
      files.set(path, {
        kind: "module",
        path,
        imports: (value.imports ?? []).map(edge),
        registries: value.registry === undefined ? [] : [registry(value.registry)],
        reexportOnly: value.reexportOnly ?? false,
        topLevelCalls: value.topLevelCalls ?? [],
        relativePathLiterals: value.relativePathLiterals ?? [],
      });
    }
  }
  const publicSurfaces: PublicSurface[] = (spec.publicSurfaces ?? []).map((s) => ({
    specifier: s.specifier,
    target: abs(s.target),
    source: s.source === null ? null : abs(s.source),
  }));
  return {
    root: ROOT,
    sourceRoot: `${ROOT}/src`,
    testRoot: `${ROOT}/test`,
    extraSourceRoots: (spec.extraSourceRoots ?? []).map(abs),
    nestedPackages: (spec.nestedPackages ?? []).map(abs),
    files,
    directories,
    publicSurfaces,
    scanFindings: [],
  };
}

/** Findings as `rule path` lines, sorted, for compact doctest output. */
export function summary(findings: Array<{ rule: string; path: string }>): string {
  return findings.map((f) => `${f.rule} ${f.path}`).toSorted().join("\n");
}
