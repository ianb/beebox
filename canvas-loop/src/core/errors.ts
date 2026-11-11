// Errors raised by the shared drawing engine (both runtimes). The preset bans
// literal messages passed to `*Error(...)`, so each class owns its template and
// callers pass structured detail.

/** Thrown when a sketch misuses the drawing API (bad brush field, draws before createCanvas, …). */
export class SketchUsageError extends Error {
  name = "SketchUsageError";
  constructor(options: { detail: string }) {
    super(`Sketch API misuse: ${options.detail}`);
  }
}
