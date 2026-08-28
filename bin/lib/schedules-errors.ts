/**
 * Every `ScheduleError` subclass the schedules subsystem raises.
 *
 * The base class stays in `schedules.js` (it is part of the loader's public
 * surface — callers catch `instanceof ScheduleError`); the per-failure
 * subclasses live here so each failure is programmatically distinguishable and
 * no message text is composed at a throw site. Message wording is the schedule
 * author's error report, so treat it as a contract.
 */

import { SCHEDULES_MARKER, ScheduleError } from "./schedules.js";

/** A linter printed something that is not JSON at all. */
export class LinterOutputNotJsonError extends ScheduleError {
  constructor(readonly options: { tool: string; reason: string; text: string }) {
    super(`${options.tool} did not print JSON (${options.reason}): ${options.text.slice(0, 200)}`);
    this.name = "LinterOutputNotJsonError";
  }
}

/** A linter exited with a code that means "I broke", not "I found things". */
export class LinterFailedError extends ScheduleError {
  constructor(readonly options: { tool: string; exitCode: number | undefined; output: string }) {
    super(`${options.tool} failed (exit ${String(options.exitCode)}): ${options.output}`);
    this.name = "LinterFailedError";
  }
}

/** A linter printed JSON of a shape this module does not know how to read. */
export class LinterOutputShapeError extends ScheduleError {
  constructor(readonly options: { tool: string; output: string }) {
    super(`${options.tool} output was not the expected JSON: ${options.output.slice(0, 200)}`);
    this.name = "LinterOutputShapeError";
  }
}

/** eslint reported the file as ignored — the root config no longer covers
 *  `schedules/`, which would otherwise read as a clean schedule. */
export class EslintNotScopedError extends ScheduleError {
  constructor(readonly filePath: string, readonly detail: string) {
    super(`eslint does not lint ${filePath} — the root eslint.config.ts no longer scopes schedules/**/*.ts (${detail})`);
    this.name = "EslintNotScopedError";
  }
}

/** The store path exists but holds no marker and is not empty — somebody
 *  else's data, refused rather than adopted. */
export class UnmarkedStoreRootError extends ScheduleError {
  constructor(readonly root: string) {
    super(`${root} exists without ${SCHEDULES_MARKER} — refusing to adopt an unrelated directory`);
    this.name = "UnmarkedStoreRootError";
  }
}

/** A store JSON file that does not match its schema. */
export class InvalidStoreRecordError extends ScheduleError {
  constructor(readonly filePath: string, readonly reasons: string) {
    super(`${filePath} is not a valid record: ${reasons}`);
    this.name = "InvalidStoreRecordError";
  }
}

/** A tool pattern that would silently split into two argv entries. */
export class NewlineInToolPatternError extends ScheduleError {
  constructor(readonly pattern: string) {
    super(`tool pattern '${pattern}' contains a newline`);
    this.name = "NewlineInToolPatternError";
  }
}

/** `startWorkstream` called for a schedule whose config declares no workstream. */
export class NoWorkstreamToStartError extends ScheduleError {
  constructor(readonly scheduleName: string) {
    super(`${scheduleName} has no workstream to start`);
    this.name = "NoWorkstreamToStartError";
  }
}
