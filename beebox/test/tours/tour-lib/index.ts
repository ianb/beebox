/**
 * Public API. A tour file imports `tour` and registers itself:
 *
 *   import { tour } from "../tour-lib";
 *   tour({ name: "dashboard", description: "Walk the dashboard" }, async (t) => {
 *     await t.go("/");
 *     await t.checkpoint("loaded");
 *   });
 *
 * The runner imports the file, then reads `registeredTours` to find what
 * was registered.
 */

import type { TourDefinition, TourFn } from "./types.js";

export type { TourContext, TourDefinition, Finding, TourResult } from "./types.js";

const registry: TourDefinition[] = [];

export function tour({ name, description }: { name: string; description: string }, fn: TourFn): void {
  registry.push({ name, description, fn });
}

export function registeredTours(): readonly TourDefinition[] {
  return registry;
}

export function clearRegistry(): void {
  registry.length = 0;
}
