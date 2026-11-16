// The sketch's own line in a stack: the first frame outside canvas-loop's
// runtime (scene, gpu, device, core, headless) and outside Node and packages. A
// warning names it so an agent can go to the call; an error's transcript line
// lists the sketch frames of its stack, up to the runner that called the
// sketch. Paths under the working directory are
// shown relative to it.

/** `file:line:col` of a stack line, or undefined for a frame without a location. */
function location(line: string): string | undefined {
  const m = /\(?((?:file:\/\/)?\/[^():]+):(\d+):(\d+)\)?\s*$/.exec(line.trim());
  if (m?.[1] === undefined) return undefined;
  return `${m[1].replace(/^file:\/\//, "")}:${m[2] ?? ""}:${m[3] ?? ""}`;
}

const SELF_FILE = "scene/call-site.ts";

/**
 * Where canvas-loop's source shows in stacks. Two forms: the module's URL, and
 * this module's own frame as the stack reports it. They differ when the code
 * runs bundled (beebox's `bbx`): with source maps a frame names the mapped
 * source path, which need not be the bundle's; without them it names the
 * bundle, which then holds the whole runtime.
 */
export function runtimePaths(a: { moduleUrl: string; ownFrame: string | undefined }): RuntimePaths {
  const srcs: string[] = [new URL("../", a.moduleUrl).pathname];
  const own = a.ownFrame?.replace(/:\d+:\d+$/, "");
  const bundle: string[] = [];
  if (own !== undefined && own.endsWith(`/${SELF_FILE}`)) srcs.push(own.slice(0, -SELF_FILE.length));
  else if (own !== undefined) bundle.push(own);
  return {
    runtime: [...srcs.flatMap((src) => ["scene/", "gpu/", "device/", "core/", "headless/"].map((dir) => src + dir)), ...bundle],
    // The runner and the browser surface call the sketch: frames below them are their callers, not the sketch.
    roots: srcs.flatMap((src) => ["headless/tea-runtime/runner.ts", "browser/scene/"].map((dir) => src + dir)),
  };
}

/** Path prefixes of the runtime's frames, and of the frames that call the sketch. */
export interface RuntimePaths {
  readonly runtime: readonly string[];
  readonly roots: readonly string[];
}

let paths: RuntimePaths | undefined;

/** This module's paths, from its URL and from a frame of its own (`capture`'s), found once. */
function ownPaths(): RuntimePaths {
  paths ??= runtimePaths({ moduleUrl: import.meta.url, ownFrame: location(capture().stack?.split("\n")[1] ?? "") });
  return paths;
}

function workingDir(): string | undefined {
  const proc: unknown = Reflect.get(globalThis, "process");
  const cwd: unknown = typeof proc === "object" && proc !== null ? Reflect.get(proc, "cwd") : undefined;
  if (typeof cwd !== "function") return undefined;
  const dir: unknown = Reflect.apply(cwd, proc, []);
  return typeof dir === "string" ? `${dir}/` : undefined;
}


/** The stack's frames that belong to the sketch, nearest first, as `path:line:col`. */
export function sketchFrames(stack: string | undefined, known?: RuntimePaths): string[] {
  const { runtime, roots } = known ?? ownPaths();
  const cwd = workingDir();
  const out: string[] = [];
  for (const line of (stack ?? "").split("\n").slice(1)) {
    const at = location(line);
    if (at !== undefined && roots.some((dir) => at.startsWith(dir))) break;
    if (at === undefined || at.includes("/node_modules/") || runtime.some((dir) => at.startsWith(dir))) continue;
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

/** A stack captured at the current call. */
function capture(): CallSiteError {
  // The recorder can be a dozen frames deep (groups, picture bodies); V8 keeps 10 by default.
  const limit: unknown = Reflect.get(Error, "stackTraceLimit");
  Reflect.set(Error, "stackTraceLimit", 64);
  try {
    return new CallSiteError();
  } finally {
    Reflect.set(Error, "stackTraceLimit", limit);
  }
}

/** Where the sketch made the current call, as `path:line:col`, or undefined when no frame of the stack is the sketch's. */
export function sketchLine(): string | undefined {
  return sketchFrames(capture().stack)[0];
}

/** The current call's place, found only when `line` is read: V8 formats a stack on first read, so keeping one is cheap. */
export interface CallSite {
  readonly line: string | undefined;
  /** The whole stack, for an error found after the call that it is about. */
  readonly stack?: string | undefined;
}

/** The current call's stack, kept for a check that decides later (after the frame, or after its render) whether to warn. */
export function callSite(): CallSite {
  const error = capture();
  let line: { at: string | undefined } | undefined;
  return {
    get line() {
      line ??= { at: sketchFrames(error.stack)[0] };
      return line.at;
    },
    get stack() {
      return error.stack;
    },
  };
}

/** ` (at path:line:col)` for a message, or "" when the sketch's line is not known. */
export function atSketchLine(): string {
  const at = sketchLine();
  return at === undefined ? "" : ` (at ${at})`;
}
