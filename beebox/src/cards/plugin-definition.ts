/**
 * The contract an in-repo plugin (`src/plugins/<name>/plugin.ts`) exports and
 * the engine reads: `docs/plans/plugins.md`, "Ontology". A plugin is a
 * library a box completes through stubs, not a runtime registration; its
 * declarative fields are read without running the hooks.
 *
 * This file is the one engine module a plugin may import besides
 * `src/exports/*` (layout rule `plugin-imports`); `beebox/cards` re-exports it
 * too, so the types a hook needs are re-exported from here.
 */
import type { LintIssue } from "./lint-format.js";
import type { CardSchemaConfig, FieldDecl } from "./schema.js";
import type { HealthCheck } from "../shared/health-check.js";

export type { HealthCheck, LintIssue };

/** Box-aware helpers the engine hands to `lintCards`, so a plugin never imports engine internals. */
export interface LintContext {
  readonly boxRoot: string;
  /** Resolves `ref` from the card at `from` inside the box, or null when it leaves the box or does not exist (wraps `src/core/ref-exists.ts`). */
  readonly resolveContainedRef: (from: string, ref: string) => Promise<string | null>;
  /** Card paths directly in `dir`, contained to the box. */
  readonly listSiblingCards: (dir: string) => Promise<string[]>;
}

/**
 * A base of any field map. `CardSchemaConfig` is contravariant in its fields
 * through `summarize`'s parameter, so no one field map accepts every base;
 * this type holds `summarize` as `unknown` instead, and every
 * `CardSchemaConfig<string, F>` is assignable to it. The engine reads bases
 * through it (it needs only their keys); a box's stub sees the precise
 * `CardSchemaConfig` through `PluginDefinition<S>`.
 */
type AnySchemaBase = Omit<CardSchemaConfig<string, Record<string, FieldDecl>>, "summarize"> & {
  readonly summarize?: unknown;
};

/** Bases keyed by their default type name. */
type SchemasMap = Readonly<Record<string, AnySchemaBase>>;

/**
 * `S` is the plugin's precise schemas map, inferred by `definePlugin` so the
 * published `plugin.d.ts` keeps each base's field types for `extendSchema`.
 * The default is the erased form the registry and engine hold; every
 * `PluginDefinition<S>` is assignable to it.
 */
export interface PluginDefinition<S extends SchemasMap | undefined = SchemasMap | undefined> {
  /** Equals the directory name under `src/plugins/`; kebab-case. */
  readonly name: string;
  /** One line; passes the brief lint. */
  readonly description: string;
  /** Path under the package, e.g. `src/plugins/courseware/README.md`. */
  readonly docs: string;
  /** SKILL.md body; the engine writes the frontmatter. */
  readonly skill?: string;
  /** Bases (a `CardSchemaConfig` with no type name) keyed by their default type name; `undefined` when the plugin has none. */
  readonly schemas: S;
  readonly views?: ReadonlyArray<{ readonly name: string; readonly rendersCardTypes: ReadonlyArray<string> }>;
  readonly healthChecks?: (boxRoot: string) => Promise<HealthCheck[]>;
  readonly lintCards?: (
    input: { path: string; type: string; fields: Record<string, unknown> },
    ctx: LintContext,
  ) => Promise<LintIssue[]>;
}

/**
 * A plugin's `plugin.ts` default-exports `definePlugin({...})`. `S` is inferred
 * from the `schemas` literal, so `plugin.schemas.<type>` is the base's precise
 * config in the published declaration; a plugin without bases writes
 * `schemas: undefined`.
 */
export function definePlugin<const S extends SchemasMap | undefined>(def: PluginDefinition<S>): PluginDefinition<S> {
  return def;
}
