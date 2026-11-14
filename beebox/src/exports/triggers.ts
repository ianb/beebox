/**
 * Public type surface of `beebox/triggers`: what a box's trigger file
 * (`src/triggers/<name>.ts`) exports and receives. Types only; the engine
 * runs the file, the box never imports a value from here.
 */
export type {
  ActivityLine,
  JudgeInput,
  JudgeResult,
  TriggerContext,
  TriggerInput,
  TriggerJudgeInput,
  TriggerJudgeResult,
  TriggerModule,
  TriggerReason,
  TriggerResult,
} from "../core/triggers/types.js";
