// Custom error classes. The preset bans `throw new Error(...)` (error/require-
// custom-error) and literal/template messages passed to any `*Error(...)`
// constructor (error/no-literal-error-message) — but a message built inside the
// class via `super(...)` is allowed, so each class owns its message template and
// callers pass only structured detail.

/** Thrown when a sketch reaches for a nondeterministic global (Math.random, Date, …). */
export class DeterminismError extends Error {
  name = "DeterminismError";
  constructor(options: { api: string; use: string }) {
    super(
      `${options.api}() is unavailable inside canvas-loop sketches — runs are deterministic. Use ${options.use} instead.`,
    );
  }
}

/** Thrown when a sketch misuses the Sketch API (draws before createCanvas, double createCanvas, …). */
export class SketchUsageError extends Error {
  name = "SketchUsageError";
  constructor(options: { detail: string }) {
    super(`Sketch API misuse: ${options.detail}`);
  }
}

/** Thrown when the events JSON file is missing, malformed, or has an invalid entry. */
export class EventScriptError extends Error {
  name = "EventScriptError";
  constructor(options: { detail: string }) {
    super(`Invalid events script: ${options.detail}`);
  }
}

/** Thrown when update() returns undefined — a msg.type fell through the switch without returning a Model. */
export class UnhandledMsgError extends Error {
  name = "UnhandledMsgError";
  constructor(options: { msgType: string }) {
    super(
      `update() returned undefined for msg type "${options.msgType}" — every branch of update must return the Model. Add a case for "${options.msgType}" (or a default) to the update switch.`,
    );
  }
}

/** Thrown for bad CLI invocation (unknown command, non-numeric flag, missing sketch, …). */
export class CliError extends Error {
  name = "CliError";
  constructor(options: { detail: string }) {
    super(`canvas-loop: ${options.detail}`);
  }
}
