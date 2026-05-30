/**
 * Scenario loader — discovers and parses scenario definitions.
 *
 * Scenarios live at ~/src/boxes/scenarios/<name>/ with:
 *   scenario.yaml — step definitions
 *   stubs.yaml — optional time/http stubs
 *   box/ — the git repo (the actual box)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import type { ScenarioDefinition, StubsDefinition } from "./types.js";

const SCENARIOS_DIR = path.join(os.homedir(), "src/boxes/scenarios");

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
  return SCENARIOS_DIR;
}

/**
 * Get the directory for a specific scenario.
 */
export function getScenarioDir(name: string): string {
  return path.join(SCENARIOS_DIR, name);
}

/**
 * Get the box root for a specific scenario.
 */
export function getBoxRoot(name: string): string {
  return path.join(SCENARIOS_DIR, name, "box");
}

/**
 * List available scenario names.
 */
export async function listScenarios(): Promise<string[]> {
  try {
    const entries = await fs.readdir(SCENARIOS_DIR, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Must have a scenario.yaml
      try {
        await fs.access(path.join(SCENARIOS_DIR, entry.name, "scenario.yaml"));
        names.push(entry.name);
      } catch (_e) {
        // No scenario.yaml — this directory isn't a scenario. Expected.
      }
    }
    return names.toSorted();
  } catch (e) {
    // Scenarios dir absent/unreadable. Empty list is the right answer, but
    // surface it in case a real read error is masking existing scenarios.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
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
  const parsed = parseYaml(content) as ScenarioDefinition;

  if (!parsed.name) parsed.name = name;
  if (!parsed.steps || !Array.isArray(parsed.steps)) {
    throw new InvalidScenarioStepsError(name);
  }

  return parsed;
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
