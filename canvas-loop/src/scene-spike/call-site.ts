// The sketch's own line in a stack: the first frame outside canvas-loop's
// runtime (the scene spike, core, headless) and outside Node and packages. A
// warning names it so an agent can go to the call; an error's transcript line
// lists the sketch frames of its stack, up to the runner that called the
// sketch. Paths under the working directory are
// shown relative to it.

const SRC = new URL("../", import.meta.url).pathname;
const RUNTIME = ["scene-spike/", "core/", "headless/"].map((dir) => SRC + dir);
// The runner and the browser surface call the sketch: frames below them are their callers, not the sketch.
const ROOTS = ["scene-spike/run/runner.ts", "scene-spike/browser/"].map((dir) => SRC + dir);

function workingDir(): string | undefined {
  const proc: unknown = Reflect.get(globalThis, "process");
  const cwd: unknown = typeof proc === "object" && proc !== null ? Reflect.get(proc, "cwd") : undefined;
  if (typeof cwd !== "function") return undefined;
  const dir: unknown = Reflect.apply(cwd, proc, []);
  return typeof dir === "string" ? `${dir}/` : undefined;
}

/** `file:line:col` of a stack line, or undefined for a frame without a location. */
function location(line: string): string | undefined {
  const m = /\(?((?:file:\/\/)?\/[^():]+):(\d+):(\d+)\)?\s*$/.exec(line.trim());
  if (m?.[1] === undefined) return undefined;
  return `${m[1].replace(/^file:\/\//, "")}:${m[2] ?? ""}:${m[3] ?? ""}`;
}

/** The stack's frames that belong to the sketch, nearest first, as `path:line:col`. */
export function sketchFrames(stack: string | undefined): string[] {
  const cwd = workingDir();
  const out: string[] = [];
  for (const line of (stack ?? "").split("\n").slice(1)) {
    const at = location(line);
    if (at !== undefined && ROOTS.some((dir) => at.startsWith(dir))) break;
    if (at === undefined || at.includes("/node_modules/") || RUNTIME.some((dir) => at.startsWith(dir))) continue;
    out.push(cwd !== undefined && at.startsWith(cwd) ? at.slice(cwd.length) : at);
  }
  return out;
}

/** An error made only for its stack. */
class CallSiteError extends Error {
  name = "CallSiteError";
  constructor() {
    super("where the sketch made the call");
  }
}

/** Where the sketch made the current call, as `path:line:col`, or undefined when no frame of the stack is the sketch's. */
export function sketchLine(): string | undefined {
  // The recorder can be a dozen frames deep (groups, picture bodies); V8 keeps 10 by default.
  const limit: unknown = Reflect.get(Error, "stackTraceLimit");
  Reflect.set(Error, "stackTraceLimit", 64);
  try {
    return sketchFrames(new CallSiteError().stack)[0];
  } finally {
    Reflect.set(Error, "stackTraceLimit", limit);
  }
}

/** ` (at path:line:col)` for a message, or "" when the sketch's line is not known. */
export function atSketchLine(): string {
  const at = sketchLine();
  return at === undefined ? "" : ` (at ${at})`;
}
