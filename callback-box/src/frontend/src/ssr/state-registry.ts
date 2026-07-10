/**
 * State registry for SSR rendering scenarios.
 *
 * Declares per-machine metadata and per-route scenarios so that
 * `cb render` can enumerate possible states and render arbitrary
 * UI situations (streaming, empty, error, etc.) without live data.
 */

import { machineRegistry } from "./state-registry-machines";
import { routeConfigs } from "./state-registry-routes";

export { machineRegistry } from "./state-registry-machines";
export { routeConfigs } from "./state-registry-routes";
export type {
  MachineStateInfo,
  RouteScenario,
  RouteConfig,
} from "./state-registry-types";

class RegistryLookupError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "RegistryLookupError";
  }
}

/**
 * Honest `Record` lookup: the frontend tsconfig doesn't set
 * `noUncheckedIndexedAccess`, so a bare `rec[key]` types as always-defined
 * even though every key here (machine id, route path, scenario name) is an
 * external string that may not be registered. Routing through a function
 * with an explicit `| undefined` return type keeps the absence real instead
 * of annotating a `const` in a way TS's control-flow analysis discards.
 */
function recordGet<T>(rec: Record<string, T>, key: string): T | undefined {
  return rec[key];
}

// --- Enumeration ---

/**
 * List declared states for a machine from the registry.
 */
export function enumerateStates(machineId: string): string[] {
  const info = recordGet(machineRegistry, machineId);
  if (!info) return [];
  return Object.keys(info.states);
}

interface BuildSnapshotOptions {
  machineId: string;
  stateValue: string;
  contextOverrides?: Record<string, unknown>;
}

/**
 * Build an XState snapshot for a machine in a given state.
 */
export function buildSnapshot(opts: BuildSnapshotOptions): unknown {
  const { machineId, stateValue, contextOverrides } = opts;
  const info = recordGet(machineRegistry, machineId);
  if (!info) {
    const message = `Unknown machine: ${machineId}`;
    throw new RegistryLookupError(message);
  }

  const stateInfo = recordGet(info.states, stateValue);
  if (!stateInfo) {
    const message =
      `Unknown state "${stateValue}" for machine "${machineId}". ` +
      `Available: ${Object.keys(info.states).join(", ")}`;
    throw new RegistryLookupError(message);
  }

  const context = { ...stateInfo.context, ...contextOverrides };
  return info.machine.resolveState({ value: stateValue, context } as never);
}

/**
 * Build the full SSRStateMap for a route given a scenario name or
 * explicit machine state overrides.
 */
export function buildSSRStateMap(
  routePath: string,
  options?: {
    scenario?: string;
    machineOverrides?: Record<string, string>; // machineId → stateValue
  },
): Record<string, unknown> {
  options = options ?? {};
  const ssrState: Record<string, unknown> = {};
  const normalizedRoute = routePath === "/" ? "/" : "/" + routePath.replace(/^\//, "").replace(/\/.*/, "");
  const routeConfig = recordGet(routeConfigs, normalizedRoute);

  // Determine machine states from scenario or explicit overrides
  const machineStates: Record<string, string> = {};

  if (options.scenario && routeConfig) {
    const scenario = recordGet(routeConfig.scenarios, options.scenario);
    if (!scenario) {
      const available = Object.keys(routeConfig.scenarios).join(", ");
      const message = `Unknown scenario "${options.scenario}" for route "${normalizedRoute}". Available: ${available}`;
      throw new RegistryLookupError(message);
    }
    if (scenario.machines) {
      Object.assign(machineStates, scenario.machines);
    }
  }

  // Explicit overrides take precedence
  if (options.machineOverrides) {
    Object.assign(machineStates, options.machineOverrides);
  }

  // Default: sse=disconnected if no state specified
  if (!machineStates.sse) {
    machineStates.sse = "disconnected";
  }

  // Build snapshots
  for (const [machineId, stateValue] of Object.entries(machineStates)) {
    if (recordGet(machineRegistry, machineId)) {
      ssrState[machineId] = buildSnapshot({ machineId, stateValue });
    }
  }

  return ssrState;
}

/**
 * Get query overrides for a scenario.
 * Returns a map of tRPC procedure path → mock data.
 */
export function getQueryOverrides(
  routePath: string,
  scenario: string,
): Record<string, unknown> | undefined {
  const normalizedRoute = routePath === "/" ? "/" : "/" + routePath.replace(/^\//, "").replace(/\/.*/, "");
  const routeConfig = recordGet(routeConfigs, normalizedRoute);
  if (!routeConfig) return undefined;

  const sc = recordGet(routeConfig.scenarios, scenario);
  return sc?.queryOverrides;
}

/**
 * Format state information for --list-states output.
 */
export function formatStateList(routePath: string): string {
  const normalizedRoute = routePath === "/" ? "/" : "/" + routePath.replace(/^\//, "").replace(/\/.*/, "");
  const routeConfig = recordGet(routeConfigs, normalizedRoute);

  const lines: string[] = [];
  lines.push(`Route: ${normalizedRoute}`);
  lines.push("");

  if (!routeConfig) {
    lines.push("No route config found. Available routes:");
    for (const r of Object.keys(routeConfigs)) {
      lines.push(`  ${r}`);
    }
    return lines.join("\n");
  }

  lines.push("Machines:");
  for (const machineId of routeConfig.machines) {
    const states = enumerateStates(machineId);
    lines.push(`  ${machineId}: ${states.join(", ")}`);
  }

  lines.push("");
  lines.push("Scenarios:");
  const maxLen = Math.max(...Object.keys(routeConfig.scenarios).map((s) => s.length));
  for (const [name, scenario] of Object.entries(routeConfig.scenarios)) {
    lines.push(`  ${name.padEnd(maxLen + 2)}${scenario.description}`);
  }

  return lines.join("\n");
}
