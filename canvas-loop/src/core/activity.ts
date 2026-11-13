// A sketch's optional `activity(model)` export: a second `draw` that turns the
// state into a small data object instead of pixels. After an input the sketch
// handled (or a param change), the runtime calls it on the new model and puts
// the result on the event it streams to the host (`onEvent`). canvas-loop does
// not know where it goes; a host may log it.
//
// It is best effort: a throwing or non-object result is left off the event and
// warned about once, and the sketch keeps running.

/** What `activity(model)` returns: plain JSON-like data. */
export type ActivityData = Record<string, unknown>;

/** The sketch's export, as the runtimes hold it (model opaque). */
export type ActivityFn = (model: unknown) => ActivityData;

/** Whether an event is one the sketch acted on: a param change or a handled input. */
export function actedOn(event: { type: string; handled?: readonly string[] }): boolean {
  return event.type === "param" || (event.handled?.length ?? 0) > 0;
}

/** Calls a sketch's `activity` export safely; warns once per reporter on failure. */
export class ActivityReporter {
  #fn: ActivityFn | undefined;
  #warn: (message: string) => void;
  #warned = false;

  constructor(fn: ActivityFn | undefined, warn: (message: string) => void) {
    this.#fn = fn;
    this.#warn = warn;
  }

  /** The activity data for `model`, or undefined when there is no export or it failed. */
  of(model: unknown): ActivityData | undefined {
    if (this.#fn === undefined) return undefined;
    try {
      const data: unknown = this.#fn(model);
      if (typeof data === "object" && data !== null && !Array.isArray(data)) return { ...data };
      this.#once(`activity(model) returned ${data === null ? "null" : typeof data}, not an object; left off the event`);
    } catch (error) {
      this.#once(`activity(model) threw (${error instanceof Error ? error.message : String(error)}); left off the event`);
    }
    return undefined;
  }

  #once(message: string): void {
    if (this.#warned) return;
    this.#warned = true;
    this.#warn(`canvas-loop: ${message}`);
  }
}

/**
 * Wrap a host's event callback so each event the sketch acted on carries the
 * activity of the model at that moment (read through `model`, after the fold).
 */
export function streamWithActivity<E extends { type: string; handled?: readonly string[] }>(deps: {
  onEvent: ((event: E & { activity?: ActivityData }) => void) | undefined;
  reporter: ActivityReporter;
  model: () => unknown;
}): ((event: E) => void) | undefined {
  const { onEvent, reporter, model } = deps;
  if (onEvent === undefined) return undefined;
  return (event) => {
    const activity = actedOn(event) ? reporter.of(model()) : undefined;
    onEvent(activity === undefined ? event : { ...event, activity });
  };
}
