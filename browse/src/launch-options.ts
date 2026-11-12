/**
 * agent-browser launch options: read once, when the daemon starts its
 * browser. On `open`, bin/browse's browse-key cookie step runs first and
 * starts the daemon without them, so upstream then ignores the same flags on
 * the `open` itself ("ignored: daemon already running"). Hoisting each into its
 * env var makes every child command — the cookie step included — launch with
 * them.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BrowseConfigError } from "./worktree.js";

type LaunchOption =
  | { env: string; kind: "value" }
  /** Repeatable; joined with commas, appended to any value already in the env. */
  | { env: string; kind: "list" }
  /** Bare, or followed by `true` / `false`. */
  | { env: string; kind: "bool" };

const LAUNCH_OPTIONS: ReadonlyMap<string, LaunchOption> = new Map([
  ["--args", { env: "AGENT_BROWSER_ARGS", kind: "value" }],
  ["--headed", { env: "AGENT_BROWSER_HEADED", kind: "bool" }],
  ["--extension", { env: "AGENT_BROWSER_EXTENSIONS", kind: "list" }],
  ["--init-script", { env: "AGENT_BROWSER_INIT_SCRIPTS", kind: "list" }],
  ["--enable", { env: "AGENT_BROWSER_ENABLE", kind: "list" }],
  ["--user-agent", { env: "AGENT_BROWSER_USER_AGENT", kind: "value" }],
  ["--proxy", { env: "AGENT_BROWSER_PROXY", kind: "value" }],
  ["--proxy-bypass", { env: "AGENT_BROWSER_PROXY_BYPASS", kind: "value" }],
  ["--ignore-https-errors", { env: "AGENT_BROWSER_IGNORE_HTTPS_ERRORS", kind: "bool" }],
  ["--allow-file-access", { env: "AGENT_BROWSER_ALLOW_FILE_ACCESS", kind: "bool" }],
  ["--executable-path", { env: "AGENT_BROWSER_EXECUTABLE_PATH", kind: "value" }],
  ["--color-scheme", { env: "AGENT_BROWSER_COLOR_SCHEME", kind: "value" }],
  ["--download-path", { env: "AGENT_BROWSER_DOWNLOAD_PATH", kind: "value" }],
  ["--engine", { env: "AGENT_BROWSER_ENGINE", kind: "value" }],
  // Not --state: `wait --state hidden` shares the name. Use AGENT_BROWSER_STATE.
  ["--session-name", { env: "AGENT_BROWSER_SESSION_NAME", kind: "value" }],
]);

const ISOLATED = "bin/browse drives its own local browser, and seeds it with the browse key";

/** Launch options bin/browse sets itself; a caller's value would break worktree isolation. */
const OWNED_OPTIONS: ReadonlyMap<string, string> = new Map([
  ["--profile", "bin/browse gives each worktree and --session its own profile; use --session <name>"],
  ["--cdp", ISOLATED],
  ["--auto-connect", ISOLATED],
  ["--provider", ISOLATED],
  ["-p", ISOLATED],
  ["--device", ISOLATED],
]);

export interface HoistedLaunchOptions {
  args: string[];
  /** Env assignments, in argument order. */
  env: Record<string, string>;
  /** The launch flags found, for the "browser already running" refusal. */
  flags: string[];
}

/** Pull every launch option out of `args` and into env assignments. */
export function hoistLaunchOptions(args: readonly string[], env: Readonly<Record<string, string | undefined>>): HoistedLaunchOptions {
  const rest: string[] = [];
  const out: Record<string, string> = {};
  const flags: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const owned = OWNED_OPTIONS.get(arg);
    if (owned !== undefined) throw new BrowseConfigError(`${arg} is not supported: ${owned}`);
    const option = LAUNCH_OPTIONS.get(arg);
    if (option === undefined) {
      rest.push(arg);
      continue;
    }
    flags.push(arg);
    const next = args[i + 1];
    if (option.kind === "bool") {
      const explicit = next === "true" || next === "false";
      out[option.env] = explicit ? next : "true";
      if (explicit) i++;
      continue;
    }
    // Not "next starts with --": an --args value is itself a list of flags.
    if (next === undefined || next === "") {
      throw new BrowseConfigError(`${arg} requires a value`);
    }
    i++;
    if (option.kind === "value") {
      out[option.env] = next;
    } else {
      const prior = out[option.env] ?? env[option.env];
      out[option.env] = prior === undefined || prior === "" ? next : `${prior},${next}`;
    }
  }
  return { args: rest, env: out, flags };
}

const DAEMON_EXIT_WAIT_MS = 3000;

/**
 * Wait until `session`'s daemon has exited. Upstream's `close` answers before
 * the daemon exits (~100 ms), so a launch right after it could be refused as
 * "running". Gives up quietly after {@link DAEMON_EXIT_WAIT_MS}; the next
 * launch says so.
 */
export async function waitForDaemonExit(socketDir: string, sessions: readonly string[]): Promise<void> {
  const deadline = Date.now() + DAEMON_EXIT_WAIT_MS;
  while (sessions.some((session) => daemonRunning(socketDir, session)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Every session with a pid file in `socketDir` (for `close --all`). */
export function knownSessions(socketDir: string): string[] {
  try {
    return readdirSync(socketDir).filter((f) => f.endsWith(".pid")).map((f) => f.slice(0, -".pid".length));
  } catch {
    return [];
  }
}

/**
 * Whether `session`'s daemon is running. Its pid file outlives `close`, so the
 * file alone says nothing; the process it names must be alive.
 */
export function daemonRunning(socketDir: string, session: string): boolean {
  let pid: number;
  try {
    pid = Number.parseInt(readFileSync(join(socketDir, `${session}.pid`), "utf8").trim(), 10);
  } catch {
    return false; // No pid file: never started.
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: alive but not ours to signal.
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
}
