/**
 * Shared types for the SSR state registry.
 */

import type { AnyStateMachine } from "xstate";

export interface MachineStateInfo {
  machine: AnyStateMachine;
  /** Input needed for graph traversal (machines with required input) */
  input?: Record<string, unknown>;
  /** Per-state context overrides for rendering */
  states: Record<string, { context?: Record<string, unknown> }>;
}

export interface RouteScenario {
  description: string;
  /** machineId → state value */
  machines?: Record<string, string>;
  /** tRPC procedure path (dot-separated) → mock data */
  queryOverrides?: Record<string, unknown>;
}

export interface RouteConfig {
  /** Machine IDs used by this route */
  machines: string[];
  scenarios: Record<string, RouteScenario>;
}
