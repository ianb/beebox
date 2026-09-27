/**
 * The in-memory model the layout check reads. The scanner (`scan/`) builds a
 * `PackageLayout` from disk; every rule (`rules/`) is a pure function of one.
 * Rules never touch the filesystem, so their doctests build layouts by hand
 * (`test/dev/layout/check/rules/fixture.ts`).
 *
 * All paths are repo-relative POSIX paths with no trailing slash
 * (`beebox/src/core/chat/session/history.ts`, `beebox/src/core`).
 * Rules: docs/plans/file-layout.md; this check: file-layout.check.subplan.md.
 */

export interface ImportEdge {
  /** As written: `./history.js`, `@shared/ref-path`, `zod`. */
  specifier: string;
  /** Resolved repo-relative file, or null when `external` or unresolved. */
  target: string | null;
  /** A bare package specifier (`zod`, `node:fs`, `beebox/cards`). */
  external: boolean;
  /** `import type`, `export type`, or every named binding marked `type`. */
  typeOnly: boolean;
  /** Local names this import binds (`import { a as b }` binds `b`). */
  names: string[];
  /** `await import("...")` with a literal specifier. */
  dynamic: boolean;
}

export interface RegistryMember {
  /** The element's source text (`MemoSchema`, `verb("x")`). */
  expression: string;
  /** Resolved file of the import binding the element's identifier, else null. */
  source: string | null;
  /** Record form: the literal key. List form: null (derived at runtime). */
  key: string | null;
}

export interface RegistryDecl {
  /** The `directory` literal resolved against the declaring file. */
  directory: string;
  /** `entry` literal, or null when absent. */
  entry: string | null;
  ordered: boolean;
  form: "list" | "record";
  members: RegistryMember[];
  /** 1-based line of the `defineRegistry` call. */
  line: number;
}

export interface ModuleFile {
  kind: "module";
  path: string;
  imports: ImportEdge[];
  registries: RegistryDecl[];
  /** Every top-level statement is an import or an `export ... from`. */
  reexportOnly: boolean;
  /** Callee names of top-level expression-statement calls (`registerConnector`). */
  topLevelCalls: string[];
  /** String literals that are not import specifiers and begin with `./` or `../`. */
  relativePathLiterals: string[];
  /**
   * Every esbuild `build({ entryPoints: [...], outfile: ... })` call found in
   * this module, with both a literal string or `join(...)` of literals. A
   * package's build entries can live in any of its modules, not only a
   * `scripts/` directory — `surfaces.ts` aggregates these across a
   * `PackageLayout`'s files to resolve `package.json` `exports` to source.
   */
  buildEntries: Array<{ entry: string; outfile: string }>;
}

export interface TestFile {
  kind: "test";
  /** `*.doctest.md`, `*.test.ts`, `*.tour.ts`. */
  path: string;
  /** From the doctest's generated source, or the `.ts` file itself. */
  imports: ImportEdge[];
}

/** An ambient `.d.ts`. Placed like a module; has no imports the rules read. */
export interface DeclarationFile {
  kind: "declaration";
  path: string;
}

/** Anything else: fixtures, `.card`, `.html`, `.svg`, `.json`, assets. */
export interface DataFile {
  kind: "data";
  path: string;
}

export type LayoutFile = ModuleFile | TestFile | DeclarationFile | DataFile;

export interface PublicSurface {
  /** `package.json` `exports` key (`./cards`). */
  specifier: string;
  /** The built target the specifier maps to (`beebox/dist/cards/index.js`). */
  target: string;
  /** Source module the build produces `target` from, or null when unknown. */
  source: string | null;
}

export type RuleId =
  | "scan"
  | "set-members"
  | "member-imports"
  | "registry"
  | "side-effect-registration"
  | "shared-infrastructure"
  | "unit-directory"
  | "repeated-name"
  | "no-index"
  | "reexport-surface"
  | "public-surface"
  | "source-roots"
  | "test-placement"
  | "test-naming"
  | "test-structure"
  | "support-placement";

export interface Finding {
  rule: RuleId;
  /** The file or directory the finding is about. */
  path: string;
  message: string;
}

export interface PackageLayout {
  /** `beebox`, `beebox/src/frontend`, `workstreams-app`. */
  root: string;
  /** `<root>/src`. */
  sourceRoot: string;
  /** `<root>/test` (may not exist on disk yet). */
  testRoot: string;
  /** Other top-level directories holding modules (`beebox/scripts`). */
  extraSourceRoots: string[];
  /** Nested package roots excluded from this layout (`beebox/src/frontend`). */
  nestedPackages: string[];
  /** Every scanned file, keyed by path. */
  files: Map<string, LayoutFile>;
  /** Every scanned directory, including roots. */
  directories: Set<string>;
  publicSurfaces: PublicSurface[];
  /**
   * Surfaces declared by an enclosing package's `package.json` (walking up
   * from `root` to the repo root). A module in `root`'s own
   * `<sourceRoot>/exports` may be the source of one of these instead of one
   * of `publicSurfaces` (a nested package's export built by its parent).
   */
  enclosingSurfaces: PublicSurface[];
  /** Problems the scanner hit (unresolved import, doctest that will not generate). */
  scanFindings: Finding[];
}

export interface LayoutRule {
  /** One sentence for the report header. */
  description: string;
  check(layout: PackageLayout): Finding[];
}
