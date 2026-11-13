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
  if (arg instanceof Error) return [`${arg.name}: ${errorMessage(arg)}`, ...stackFrames(arg.stack)].join(" | ");
  try {
    return JSON.stringify(arg);
  } catch (_e) {
    return String(arg); // circular or otherwise unserializable
  }
}

/** Enough frames to find the throw in the sourcemapped bundle, while the line stays readable. */
const MAX_STACK_FRAMES = 5;

/**
 * The first frames of a stack, one per entry, without the origin.
 *
 * Without them a production error such as "Cannot read properties of undefined
 * (reading 'length')" names no place at all. The server flattens a logged
 * message to one line, so frames are joined rather than kept as lines. V8
 * frames read `at fn (url:line:col)` after a header that repeats the message;
 * Safari and Firefox frames read `fn@url:line:col` with no header.
 */
function stackFrames(stack: string | undefined): string[] {
  if (stack === undefined) return [];
  const lines = stack.split("\n").map((line) => line.trim());
  // The V8 header repeats the message, which may itself contain "@".
  const v8 = lines.some((line) => line.startsWith("at "));
  return lines
    .filter((line) => (v8 ? line.startsWith("at ") : line.includes("@")))
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => line.replace(/\b[a-z][\d+.a-z-]*:\/\/[^\s)/]+/gi, ""));
}
