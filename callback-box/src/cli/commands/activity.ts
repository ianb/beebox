/**
 * cb activity - Manage activity instances.
 *
 * Subcommands:
 *   cb activity list                           List all registered activity types
 *   cb activity new <type> <name> [display]    Create a new instance
 *   cb activity instances <type>               List instances of a type in the current box
 */

import { Command } from "commander";
import type { ActivityRegistry, InstanceSummary } from "../../activities/index.js";
import { createBuiltinRegistry } from "../../activities/index.js";
import { requireBoxRoot } from "../lib/paths.js";

export interface ActivityTypeInfo {
  type: string;
  title: string;
  description: string;
  singleton: boolean;
}

export function listActivityTypes(registry: ActivityRegistry): ActivityTypeInfo[] {
  return registry.list().map((a) => ({
    type: a.type,
    title: a.metadata.title,
    description: a.metadata.description,
    singleton: a.metadata.singleton,
  }));
}

export async function listInstancesOfType(
  registry: ActivityRegistry,
  { boxRoot, type }: { boxRoot: string; type: string },
): Promise<InstanceSummary[]> {
  const activity = registry.getOrThrow(type);
  return activity.listInstances({ boxRoot });
}

export async function createInstance(
  registry: ActivityRegistry,
  { boxRoot, type, name, displayName }: { boxRoot: string; type: string; name: string; displayName: string },
): Promise<void> {
  const activity = registry.getOrThrow(type);
  await activity.createInstance({ boxRoot, name, displayName });
}

function formatActivityTypes(types: ActivityTypeInfo[]): string {
  if (types.length === 0) return "No activities registered.";
  const typeWidth = Math.max(...types.map((t) => t.type.length));
  const titleWidth = Math.max(...types.map((t) => t.title.length));
  const lines = types.map((t) => {
    const singletonMark = t.singleton ? " (singleton)" : "";
    return `${t.type.padEnd(typeWidth)}  ${t.title.padEnd(titleWidth)}  ${t.description}${singletonMark}`;
  });
  return lines.join("\n");
}

function formatInstances(instances: InstanceSummary[]): string {
  if (instances.length === 0) return "No instances.";
  const nameWidth = Math.max(...instances.map((i) => i.name.length));
  const titleWidth = Math.max(...instances.map((i) => i.displayName.length));
  const lines = instances.map(
    (i) => `${i.name.padEnd(nameWidth)}  ${i.displayName.padEnd(titleWidth)}  ${i.createdAt}`,
  );
  return lines.join("\n");
}

const listSub = new Command("list")
  .description("List all registered activity types")
  .option("--json", "Output as JSON")
  .action(async (options: { json?: boolean }) => {
    const registry = createBuiltinRegistry();
    const types = listActivityTypes(registry);
    if (options.json) {
      console.log(JSON.stringify(types, null, 2));
    } else {
      console.log(formatActivityTypes(types));
    }
  });

const newSub = new Command("new")
  .description("Create a new instance of an activity")
  .argument("<type>", "Activity type (see `cb activity list`)")
  .argument("<name>", "Instance name (filesystem-safe; used as directory name)")
  .option("-d, --display-name <name>", "Human-readable display name (defaults to <name>)")
  // eslint-disable-next-line max-params -- Commander's .action signature for multi-arg commands
  .action(async (type: string, name: string, options: { displayName?: string }) => {
    const registry = createBuiltinRegistry();
    const boxRoot = await requireBoxRoot();
    const displayName = options.displayName !== undefined ? options.displayName : name;
    await createInstance(registry, { boxRoot, type, name, displayName });
    console.log(`Created ${type}/${name} (${displayName})`);
  });

const instancesSub = new Command("instances")
  .description("List instances of an activity type in the current box")
  .argument("<type>", "Activity type")
  .option("--json", "Output as JSON")
  .action(async (type: string, options: { json?: boolean }) => {
    const registry = createBuiltinRegistry();
    const boxRoot = await requireBoxRoot();
    const instances = await listInstancesOfType(registry, { boxRoot, type });
    if (options.json) {
      console.log(JSON.stringify(instances, null, 2));
    } else {
      console.log(formatInstances(instances));
    }
  });

export const activityCommand = new Command("activity")
  .description("Manage activity instances")
  .addCommand(listSub)
  .addCommand(newSub)
  .addCommand(instancesSub);
