/**
 * bbx plugins — the installed plugins (`docs/plugins.md`) and this box's use
 * of them. `list` is the only subcommand: one line per installed plugin, its
 * activation state, description, and README path; for an active plugin, one
 * line per declared stub saying whether the box has written it; then one line
 * per problem in `_config/box.json` `plugins`.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { listPlugins, type PluginListing } from "../../core/plugins/active.js";

function formatPlugin(plugin: PluginListing): string[] {
  const state = plugin.active ? "active" : "inactive";
  const lines = [`${plugin.name}  ${state}  ${plugin.description}  docs: ${plugin.docs}`];
  for (const stub of plugin.stubs) {
    lines.push(`  ${stub.kind} ${stub.name}: ${stub.path} ${stub.present ? "present" : "missing"}`);
  }
  return lines;
}

export const pluginsCommand = new Command("plugins")
  .description("Installed plugins and whether this box has activated them");

pluginsCommand
  .command("list")
  .description("List installed plugins, each active or inactive, with docs path and stub status")
  .option("--json", "Emit the listing and problems as JSON")
  .action(async (options: { json?: boolean }) => {
    const boxRoot = await requireBoxRoot();
    const { plugins, problems } = await listPlugins(boxRoot);
    if (options.json === true) {
      console.log(JSON.stringify({ plugins, problems }, null, 2));
      return;
    }
    if (plugins.length === 0) console.log("No plugins installed.");
    for (const plugin of plugins) for (const line of formatPlugin(plugin)) console.log(line);
    for (const problem of problems) console.log(problem);
  });
