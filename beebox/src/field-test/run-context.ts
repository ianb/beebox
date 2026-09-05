/**
 * The live state one field run carries between its checklist items
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * A separate module purely so the item loop (`run-item.ts`) and the run
 * orchestrator (`run.ts`) can share the shape without importing each other.
 * The orchestrator OWNS the mutable parts — the server handle and the box
 * clock, both of which a day advance replaces — and exposes them here as
 * accessors so the item loop can never hold a stale server across a restart.
 */

import type { FieldBox } from "./run-box.js";
import type { FieldServer } from "./run-server.js";
import type { FieldScenario } from "./scenario.js";
import type { OperatorSession } from "./operator.js";

export interface QuiescenceBudget {
  timeoutMs: number;
  pollMs: number;
  settleMs: number;
}

export interface FieldRunContext {
  scenario: FieldScenario;
  box: FieldBox;
  /** The run directory; everything written by the harness lives under it. */
  runDir: string;
  /** `<runDir>/screenshots` — each item gets a subdirectory under it. */
  screenshotsRoot: string;
  operator: OperatorSession;
  /** The CURRENT server. Never cache it: `reset` and a day advance replace it. */
  server(): FieldServer;
  /** The box's simulated clock right now. */
  boxTime(): Date;
  /** The run's fake-Gmail state file. */
  fakeGmailStatePath: string;
  quiescence: QuiescenceBudget;
  /** Env overlay for `bbx` subprocesses, with `BBX_TIME` at the current day. */
  childEnv(): NodeJS.ProcessEnv;
  /** Stop and re-start the run server (after a `reset`). */
  restartServer(): Promise<void>;
  /** Stop the server, move the clock, run the day's maintenance, restart.
   *  Returns the new box time. */
  advanceDays(days: number): Promise<Date>;
  /** Record a harness event on the run (not on an item). */
  event(message: string): void;
}
