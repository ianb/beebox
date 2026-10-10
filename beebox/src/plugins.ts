/**
 * The closed set of in-repo plugins (`docs/plans/plugins.md`): libraries a
 * box completes through stubs, each `src/plugins/<name>/plugin.ts` exporting
 * a `PluginDefinition`. Installed means present here; active means named in
 * the box's config.
 */
import { defineRegistry } from "./shared/registry.js";
import type { PluginDefinition } from "./cards/plugin-definition.js";
import coursewarePlugin from "./plugins/courseware/plugin.js";

export const plugins = defineRegistry<PluginDefinition>({
  directory: "./plugins",
  entry: "plugin",
  ordered: false,
  members: { courseware: coursewarePlugin },
});

export function pluginByName(name: string): PluginDefinition | undefined {
  return plugins.get(name);
}

export function pluginNames(): string[] {
  return plugins.keys();
}
