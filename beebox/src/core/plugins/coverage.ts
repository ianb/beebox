/**
 * Plugin type coverage: which card types a plugin declares are present on
 * disk without an effective schema, and which declarations of an ACTIVE
 * plugin have no stub. The data behind the `plugin-type-unprovided` and
 * `plugin-declared-missing` health checks (`docs/plugins.md`, "Health").
 *
 * Pure over the three inputs the plan names (`docs/plans/plugins.md`, Track
 * 3): the effective schema map's type names, the card types on disk, and the
 * registry with the active list. The active list alone decides nothing: an
 * inactive plugin with cards of its type on disk is reported the same as an
 * active one with no stub, because the cards are unprovided either way.
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
   * `src/views/<name>.tsx`. A schema stub that exists but failed to load is
   * `plugin-stub-missing`'s report, not a missing declaration.
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
}

export interface PluginTypeCoverage {
  /** Per plugin (active or not): its declared types with cards on disk and no effective schema. */
  readonly unprovided: UnprovidedType[];
  /** Per ACTIVE plugin: declared schema types and views with no stub. */
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
      if (active.has(plugin.name) && !stubs.schemaTypes.has(type)) {
        declaredMissing.push({ plugin: plugin.name, kind: "schema", name: type });
      }
    }
    if (!active.has(plugin.name)) continue;
    for (const name of plugin.viewNames) {
      if (!stubs.viewNames.has(name)) declaredMissing.push({ plugin: plugin.name, kind: "view", name });
    }
  }
  return { unprovided, declaredMissing };
}
