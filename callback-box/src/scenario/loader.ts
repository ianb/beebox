/**
 * Scenario loader — discovers and parses scenario definitions.
 *
 * Scenarios live under a scenarios root, one subdirectory per scenario:
 *   scenario.yaml — step definitions
 *   stubs.yaml — optional time/http stubs
 *   box/ — the git repo (the actual box)
 *
 * The root is `CB_SCENARIOS_DIR` if set, else `~/src/boxes/scenarios` --
 * the historical default from before `callback-box` became a standalone
 * package (see `docs/implemented-plans/boxes-as-packages-v2.md` Track H). Kept as a
 * documented default, not a bare hardcoded constant, so a checkout outside
 * `~/src` (or with boxes living elsewhere) can point scenarios at the right
 * place without editing engine source.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import { errnoCode } from "../lib/error-guards.js";
import type { ScenarioDefinition, StubsDefinition } from "./types.js";

function scenariosDir(): string {
  return process.env["CB_SCENARIOS_DIR"] || path.join(os.homedir(), "src/boxes/scenarios");
}

class InvalidScenarioStepsError extends Error {
  readonly scenarioName: string;
  constructor(scenarioName: string) {
    super(`Scenario ${scenarioName}: missing or invalid 'steps' array`);
    this.name = "InvalidScenarioStepsError";
    this.scenarioName = scenarioName;
  }
}

/**
 * Get the root scenarios directory.
 */
export function getScenariosDir(): string {
  return scenariosDir();
}

/**
 * Get the directory for a specific scenario.
 */
export function getScenarioDir(name: string): string {
  return path.join(scenariosDir(), name);
}

/**
 * Get the box root for a specific scenario.
 */
export function getBoxRoot(name: string): string {
  return path.join(scenariosDir(), name, "box");
}

/**
 * List available scenario names.
 */
export async function listScenarios(): Promise<string[]> {
  const root = scenariosDir();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Must have a scenario.yaml
      try {
        await fs.access(path.join(root, entry.name, "scenario.yaml"));
        names.push(entry.name);
      } catch (_e) {
        // No scenario.yaml — this directory isn't a scenario. Expected.
      }
    }
    return names.toSorted();
  } catch (e) {
    // Scenarios dir absent/unreadable. Empty list is the right answer, but
    // surface it in case a real read error is masking existing scenarios.
    if (errnoCode(e) !== "ENOENT") {
      console.warn("Failed to read scenarios directory, treating as empty:", e);
    }
    return [];
  }
}

/**
 * Load and parse a scenario definition.
 */
export async function loadScenario(name: string): Promise<ScenarioDefinition> {
  const yamlPath = path.join(getScenarioDir(name), "scenario.yaml");
  const content = await fs.readFile(yamlPath, "utf-8");
  const parsed = parseYaml(content) as Partial<ScenarioDefinition>;

  if (!parsed.name) parsed.name = name;
  if (!parsed.steps || !Array.isArray(parsed.steps)) {
    throw new InvalidScenarioStepsError(name);
  }

  return parsed as ScenarioDefinition;
}

/**
 * Load stubs definition for a scenario, if it exists.
 */
export async function loadStubs(name: string): Promise<StubsDefinition | null> {
  const yamlPath = path.join(getScenarioDir(name), "stubs.yaml");
  try {
    const content = await fs.readFile(yamlPath, "utf-8");
    return parseYaml(content) as StubsDefinition;
  } catch (_e) {
    // stubs.yaml is optional — absent file means "no stubs". Expected.
    return null;
  }
}
