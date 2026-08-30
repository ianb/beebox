/**
 * Scenario loader — discovers and parses scenario definitions.
 *
 * Scenarios live under a scenarios root, one subdirectory per scenario:
 *   scenario.yaml — step definitions
 *   stubs.yaml — optional time/http stubs
 *   box/ — the git repo (the actual box)
 *
 * The root is `BBX_SCENARIOS_DIR` if set, else `~/src/boxes/scenarios` --
 * the historical default from before `beebox` became a standalone
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
import { isRecord } from "../lib/is-record.js";
import type { ScenarioDefinition, StubsDefinition } from "./types.js";

/**
 * True once `value` carries the required `name`/`description` strings and a
 * `steps` array (step internals are trusted — this is hand-authored fixture
 * YAML the runner exercises). `loadScenario` fills `name`/`description`
 * defaults before checking, so this only fails on a missing `steps` array.
 */
function isScenarioDefinition(value: unknown): value is ScenarioDefinition {
  return (
    isRecord(value)
    && typeof value["name"] === "string"
    && typeof value["description"] === "string"
    && Array.isArray(value["steps"])
  );
}

/** A stubs file is valid when it's a mapping with a string `time?` and array `http?`. */
function isStubsDefinition(value: unknown): value is StubsDefinition {
  if (!isRecord(value)) return false;
  if (value["time"] !== undefined && typeof value["time"] !== "string") return false;
  if (value["http"] !== undefined && !Array.isArray(value["http"])) return false;
  return true;
}

function scenariosDir(): string {
  return process.env["BBX_SCENARIOS_DIR"] || path.join(os.homedir(), "src/boxes/scenarios");
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
  const parsed: unknown = parseYaml(content);
  if (!isRecord(parsed)) {
    throw new InvalidScenarioStepsError(name);
  }
  if (typeof parsed["name"] !== "string" || parsed["name"] === "") parsed["name"] = name;
  if (typeof parsed["description"] !== "string") parsed["description"] = "";
  if (!isScenarioDefinition(parsed)) {
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
    const parsed: unknown = parseYaml(content);
    return isStubsDefinition(parsed) ? parsed : null;
  } catch (_e) {
    // stubs.yaml is optional — absent file means "no stubs". Expected.
    return null;
  }
}
