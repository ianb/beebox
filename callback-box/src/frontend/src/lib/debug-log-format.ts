/**
 * How a `console.*` argument is rendered into the debug log.
 *
 * Split out of `DebugLog.tsx` so it can be tested without mounting React.
 */
import { errorMessage } from "@shared/error-guards";

/**
 * How one logged argument reads in the debug log.
 *
 * An Error does not survive `JSON.stringify`: `message` and `stack` are
 * non-enumerable, so a thrown error arrived as `{"name":"ImageProcessingError"}`
 * — the class name and nothing else, on the one surface whose whole job is to
 * say what went wrong. A journey walker read that line, wrote "a name, not a
 * reason", and had to guess the actual cause; so did the engineer reading the
 * log afterwards.
 *
 * `JSON.stringify` also throws on a circular object, which inside a patched
 * `console` would take out the log call itself.
 */
export function describeArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg === undefined) return "undefined"; // JSON.stringify returns undefined, not a string
  if (arg instanceof Error) return `${arg.name}: ${errorMessage(arg)}`;
  try {
    return JSON.stringify(arg);
  } catch (_e) {
    return String(arg); // circular or otherwise unserializable
  }
}
