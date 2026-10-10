/**
 * Plugin type coverage: which card types a plugin declares are present on
 * disk without an effective schema, and which declarations of an ACTIVE
 * plugin have no effective schema or view. The data behind the
 * `plugin-type-unprovided` and `plugin-declared-missing` health checks
 * (`docs/plugins.md`, "Health").
 *
 * Pure over the three inputs the plan names (`docs/plans/plugins.md`, Track
 * 3): the effective schema map's type names, the card types on disk, and the
 * registry with the active list. The active list alone decides nothing: an
 * inactive plugin with cards of its type on disk is reported the same as an
 * active one with no stub, because the cards are unprovided either way. A
 * declared schema type is missing when the EFFECTIVE map lacks it, whether or
 * not a stub file exists: the file's presence only decides the reason.
 */

export interface PluginDeclarations {
  readonly name: string;
  /** Default type keys of `PluginDefinition.schemas`. */
  readonly schemaTypes: ReadonlyArray<string>;
  /** `PluginDefinition.views[].name`. */
  readonly viewNames: ReadonlyArray<string>;
}

export interface PluginCoverageInput {
  /** Card type → number of cards of that type on disk. */
  readonly typesOnDisk: ReadonlyMap<string, number>;
  /** Type names in the effective schema map (built-ins plus loaded box stubs). */
  readonly effectiveSchemaTypes: ReadonlySet<string>;
  readonly plugins: ReadonlyArray<PluginDeclarations>;
  /** Names in the box's `plugins` config that are registry keys. */
  readonly active: ReadonlySet<string>;
  /**
   * Stub files on disk by name, loaded or not: `src/schemas/<type>.ts` and
   * `src/views/<name>.tsx`. A view's name is its file, so this decides a view
   * declaration; for a schema it only tells "no file" from "a file that defines
   * no schema of that type" (a failed load is also `plugin-stub-missing`'s report).
   */
  readonly stubs: { readonly schemaTypes: ReadonlySet<string>; readonly viewNames: ReadonlySet<string> };
}

export interface UnprovidedType {
  readonly plugin: string;
  readonly type: string;
  readonly cards: number;
}

export interface MissingDeclaration {
  readonly plugin: string;
  readonly kind: "schema" | "view";
  readonly name: string;
  /** `no-file`: no stub on disk. `no-schema`: the stub file exists but the effective map has no schema of this type. */
  readonly reason: "no-file" | "no-schema";
}

export interface PluginTypeCoverage {
  /** Per plugin (active or not): its declared types with cards on disk and no effective schema. */
  readonly unprovided: UnprovidedType[];
  /** Per ACTIVE plugin: declared schema types with no effective schema, and views with no stub. */
  readonly declaredMissing: MissingDeclaration[];
}

export function pluginTypeCoverage(input: PluginCoverageInput): PluginTypeCoverage {
  const { typesOnDisk, effectiveSchemaTypes, plugins, active, stubs } = input;
  const unprovided: UnprovidedType[] = [];
  const declaredMissing: MissingDeclaration[] = [];
  for (const plugin of plugins) {
    for (const type of plugin.schemaTypes) {
      if (effectiveSchemaTypes.has(type)) continue;
      const cards = typesOnDisk.get(type) ?? 0;
      if (cards > 0) unprovided.push({ plugin: plugin.name, type, cards });
      if (active.has(plugin.name)) {
        const reason = stubs.schemaTypes.has(type) ? "no-schema" : "no-file";
        declaredMissing.push({ plugin: plugin.name, kind: "schema", name: type, reason });
      }
    }
    if (!active.has(plugin.name)) continue;
    for (const name of plugin.viewNames) {
      if (!stubs.viewNames.has(name)) declaredMissing.push({ plugin: plugin.name, kind: "view", name, reason: "no-file" });
    }
  }
  return { unprovided, declaredMissing };
}
