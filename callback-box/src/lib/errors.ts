/**
 * Shared, reusable error classes.
 *
 * Most errors in this codebase are best expressed as a local, purpose-named
 * class right where they're thrown (see e.g. CardIOError in core/card-io.ts).
 * This module is only for error shapes that genuinely recur across many call
 * sites — add a class here only when it describes the same failure in several
 * places, not as a dumping ground.
 *
 * Note on construction: the `error/*` lint rules forbid passing a string/
 * template literal as the *first* argument of an Error constructor (that slot
 * is treated as a hardcoded message). So reusable classes take their dynamic
 * data as fields and compose the message internally; the distinguishing label
 * (e.g. the resource name) goes in a non-first argument.
 */

/**
 * A resource could not be located by its identifier. The id and resource label
 * are kept as fields for programmatic inspection; the message is composed here.
 *
 *   throw new NotFoundError(fileId, "File");        // "File not found: <id>"
 *   throw new NotFoundError(eventId, "Calendar event");
 */
export class NotFoundError extends Error {
  readonly id: string;
  readonly resource: string;
  constructor(id: string, resource: string) {
    super(`${resource} not found: ${id}`);
    this.name = "NotFoundError";
    this.id = id;
    this.resource = resource;
  }
}
