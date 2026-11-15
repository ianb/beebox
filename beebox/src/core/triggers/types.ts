/**
 * The contract between a box's trigger file and the engine: what the module
 * exports, what each evaluation receives, and what it may return. A box
 * imports these as types from `beebox/triggers` (src/exports/triggers.ts);
 * the evaluation child (`eval-child.ts`) validates a module against them.
 * See plan:activity-triggers, Ontology.
 */

import type { ActivityLine } from "../activity/entry.js";
import type { JudgeInput, JudgeResult } from "../../services/jev-judge.js";

export type { ActivityLine, JudgeInput, JudgeResult };

/** Why the function is being called. */
export type TriggerReason = "activity" | "tick";

export interface TriggerInput {
  reason: TriggerReason;
  /** The session's entries since the last evaluation, oldest first; empty on a tick with nothing new. */
  entries: ActivityLine[];
  /** The session's entries since arming, oldest first, capped at the most recent {@link HISTORY_CAP}. */
  history: ActivityLine[];
  /** Milliseconds since the session's latest entry, or null when there has been none since arming. */
  sinceLastActivityMs: number | null;
  /** How many times this activation has fired. */
  fires: number;
  /** ISO time of the last fire, or null. */
  lastFireAt: string | null;
  /** ISO time the activation was armed. */
  armedAt: string;
}

/** A judge call: Jev's question types over a state, or a judgment card applied to a state. */
export type TriggerJudgeInput =
  | JudgeInput
  | { card: string; state: unknown };

export type TriggerJudgeResult =
  | JudgeResult
  | { kind: "unavailable"; reason: string };

export interface TriggerContext {
  /** The JSON the agent passed at arm time. */
  config: unknown;
  /** Absolute path of the box. */
  boxRoot: string;
  reason: TriggerReason;
  /**
   * Ask Jev. The answers are probabilities, choices and scores; Jev writes
   * no prose. The function picks or fills in its own text from them. When
   * the judge is unconfigured, over budget, or fails, the result is
   * `{ kind: "unavailable", reason }` and the function decides what to do.
   */
  judge: (input: TriggerJudgeInput) => Promise<TriggerJudgeResult>;
  /** Add a line to the evaluation's trace, for `bbx chat trigger log`. */
  log: (message: string) => void;
}

/**
 * What a trigger returns when it has something to say or wants to stop.
 * `{ text }` fires a notice; `{ done: true }` alone ends the activation
 * quietly (a watcher for failed attempts that sees success); `{ text, done }`
 * does both.
 */
export interface TriggerResult {
  /** The notice the person sees, under the trigger's label. Cut at {@link TEXT_CAP} characters. Absent with `done: true`: end quietly. */
  text?: string;
  /** For the agent only; not shown to the person. */
  note?: string;
  /** End the activation, after the fire if there is one. */
  done?: boolean;
  /**
   * The card the notice is about; the notice links to it so the person can
   * return to it. Default: the card the latest entry came from (the pane
   * card when the figure sat inside one).
   */
  card?: string;
}

export interface TriggerModule {
  /** The name the person sees ("Watching: Water check") and the agent uses to disarm. */
  label: (config: unknown) => string;
  trigger: (input: TriggerInput, ctx: TriggerContext) => Promise<TriggerResult | null | undefined> | TriggerResult | null | undefined;
  /** Seconds between evaluations with `reason: "tick"`, at least {@link TICK_FLOOR_SECONDS}. Absent: evaluate on activity only. */
  tick?: number;
}

/** The smallest `tick` a module may ask for, in seconds. */
export const TICK_FLOOR_SECONDS = 10;
/** The most history entries an evaluation receives. */
export const HISTORY_CAP = 500;
/** The longest `text` a fire delivers. */
export const TEXT_CAP = 2000;
