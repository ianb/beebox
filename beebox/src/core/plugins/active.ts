/**
 * The box's view of the plugin registry (`docs/plugins.md`): which installed
 * plugins are active, which `plugins` entries in `_config/box.json` are
 * wrong, and, for an active plugin, which of its declared stubs the box has
 * written. Read by `bbx plugins list`, `bbx status`, and the skill mirror.
 */
import { access } from "node:fs/promises";
import { join } from "node:path";
import { activePluginNames, type PluginConfigProblem } from "../box/config.js";
import { boxCodePaths, boxCodePathsRelativeToBoxRoot, getBoxShape } from "../../lib/box-shape.js";
import { errnoCode } from "../../shared/error-guards.js";
import { pluginByName, pluginNames } from "../../plugins.js";
import type { PluginDefinition } from "../../cards/plugin-definition.js";
import { createCardSchemaMap } from "../../schemas.js";
import { assertNever, invariant } from "../../shared/invariant.js";

/** One stub an active plugin declares: a schema per default type, a view per view. */
export interface PluginStub {
  kind: "schema" | "view";
  /** The default type name or the view name. */
  name: string;
  /** Box-relative path the stub lives at when present. */
  path: string;
  /** The stub file exists. */
  present: boolean;
  /**
   * The stub does its job: for a schema, the effective schema map
   * (`createCardSchemaMap`) has a schema of this type; for a view, the file
   * exists. A present schema stub that defines some other type is not effective.
   */
  effective: boolean;
}

/** `present` / `missing` / `present, defines no <type> schema`, for `bbx plugins list`. */
export function describeStubStatus(stub: PluginStub): string {
  if (!stub.present) return "missing";
  return stub.effective ? "present" : `present, defines no ${stub.name} schema`;
}

export interface PluginListing {
  name: string;
  active: boolean;
  description: string;
  /** Path under the installed package, e.g. `node_modules/beebox/src/plugins/courseware/README.md`. */
  docs: string;
  /** Declared stubs and whether each is present; empty for an inactive plugin. */
  stubs: PluginStub[];
}

/** The active plugins' definitions, in config order. */
export async function activePlugins(boxRoot: string): Promise<PluginDefinition[]> {
  const { active } = await activePluginNames(boxRoot);
  return active.map((name) => {
    const plugin = pluginByName(name);
    invariant(plugin !== undefined, `activePluginNames returned "${name}", which the registry lacks`);
    return plugin;
  });
}

/** One line per invalid `plugins` entry, for `bbx status`, `bbx plugins list`, and the card lint. */
export function describeInvalidPluginEntries(invalid: readonly PluginConfigProblem[]): string[] {
  return invalid.map((problem) => {
    switch (problem.kind) {
      case "unknown-name":
        return `box.json names an unknown plugin: ${problem.name}`;
      case "malformed":
        return `box.json "plugins" must be an array of plugin names; found ${JSON.stringify(problem.value)}`;
      default:
        return assertNever(problem);
    }
  });
}

async function exists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
}

/**
 * The stubs `plugin` declares, whether the box has each file, and whether each
 * takes effect (`docs/plugins.md`, Stubs). The schema check reads the EFFECTIVE
 * map, so a stub that is on disk but defines a different type reads as not
 * effective rather than as done.
 */
async function pluginStubs(boxRoot: string, plugin: PluginDefinition): Promise<PluginStub[]> {
  const shape = await getBoxShape(boxRoot);
  const abs = boxCodePaths(shape);
  const rel = boxCodePathsRelativeToBoxRoot(shape);
  const declared: Array<{ kind: PluginStub["kind"]; name: string; absPath: string; path: string }> = [
    ...Object.keys(plugin.schemas ?? {}).map((type) => ({
      kind: "schema" as const,
      name: type,
      absPath: join(abs.schemasDir, `${type}.ts`),
      path: `${rel.schemasDir}/${type}.ts`,
    })),
    ...(plugin.views ?? []).map((view) => ({
      kind: "view" as const,
      name: view.name,
      absPath: join(abs.viewsDir, `${view.name}.tsx`),
      path: `${rel.viewsDir}/${view.name}.tsx`,
    })),
  ];
  const schemaTypes = new Set((await createCardSchemaMap(boxRoot)).keys());
  const stubs: PluginStub[] = [];
  for (const { kind, name, absPath, path } of declared) {
    const present = await exists(absPath);
    const effective = kind === "schema" ? schemaTypes.has(name) : present;
    stubs.push({ kind, name, path, present, effective });
  }
  return stubs;
}

/**
 * Every installed plugin with its activation state and, when active, its stub
 * status; plus the invalid `plugins` entries, already worded for printing.
 */
export async function listPlugins(boxRoot: string): Promise<{ plugins: PluginListing[]; problems: string[] }> {
  const { active, invalid } = await activePluginNames(boxRoot);
  const activeSet = new Set(active);
  const plugins: PluginListing[] = [];
  for (const name of pluginNames().toSorted()) {
    const plugin = pluginByName(name);
    invariant(plugin !== undefined, `registry key "${name}" has no plugin`);
    const isActive = activeSet.has(name);
    plugins.push({
      name,
      active: isActive,
      description: plugin.description,
      docs: `node_modules/beebox/${plugin.docs}`,
      stubs: isActive ? await pluginStubs(boxRoot, plugin) : [],
    });
  }
  return { plugins, problems: describeInvalidPluginEntries(invalid) };
}
