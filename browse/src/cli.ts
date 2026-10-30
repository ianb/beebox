import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { AgentBrowserError, getUrl, run, runPassthrough } from "agent-browser-typed";
import { reclaimWorktreeBrowsers } from "../../bin/process-cleanup.js";
import { annotatedSnapshot, checkedAction, getWithTarget, noteAction } from "./act.js";
import { scrollWithSelector } from "./scroll-target.js";
import { TARGET_COMMANDS } from "./controls.js";
import { runEnhancedScreenshot } from "./screenshot.js";
import { openClerkPopup } from "./clerk-popup.js";
import type { ScreenshotInvocation } from "./screenshot.js";
import { daemonRunning, hoistLaunchOptions, knownSessions, waitForDaemonExit } from "./launch-options.js";
import { isStuck, noAnswer, PROBE_TIMEOUT_MS, stuckCaptureMessage, wedgedMessage } from "./stuck.js";
import { authCookieArgs, BrowseConfigError, detectWorktreeContext, isOwnOrigin, rewriteOpenUrl, sessionProfileDir } from "./worktree.js";
import type { WorktreeContext } from "./worktree.js";

// JS expression evaluated in the page. The beebox frontend exposes
// `<body data-bbx-loading="true|false">` driven by React Query's
// useIsFetching/useIsMutating, so "false" means all in-flight queries
// (and any mutations) have settled. See beebox trpc-provider.tsx.
const READY_FN = "document.body.dataset.bbxLoading === 'false'";

// Ceiling on the settle wait, for a page that never sets the marker (the
// login wall, an app that failed to load). Overridable for a genuinely slow
// page.
const READY_TIMEOUT_MS_DEFAULT = 15_000;

function readyTimeoutMs(): number {
  const raw = process.env["BROWSE_READY_TIMEOUT_MS"];
  if (raw === undefined || raw === "") return READY_TIMEOUT_MS_DEFAULT;
  // Whole string or nothing. `parseInt` alone reads "15,000" as 15 and "1e4"
  // as 1 — a typo that silently shortens the wait instead of announcing
  // itself, which is the failure mode this whole change exists to remove.
  if (!/^\d+$/.test(raw)) {
    throw new BrowseConfigError(`BROWSE_READY_TIMEOUT_MS is not a positive integer: ${raw}`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed <= 0) {
    throw new BrowseConfigError(`BROWSE_READY_TIMEOUT_MS is not a positive integer: ${raw}`);
  }
  return parsed;
}

// Commands that operate on the current page and benefit from waiting for
// query activity to settle first. `open` waits AFTER navigating; `snapshot`
// and `screenshot` wait BEFORE reading so they capture the settled state.
const WAIT_AFTER = new Set(["open"]);
const WAIT_BEFORE = new Set(["snapshot", "screenshot"]);

// Leading flags upstream answers on its own, with no page or subcommand.
const PASSTHROUGH_LEADING_FLAGS = new Set(["--help", "-h", "--version", "-V"]);

// Commands that can change the page under a snapshot's refs. After one runs, a
// `@eN` ref is refused until the next snapshot (`noteAction`).
const PAGE_CHANGING = new Set([
  "click", "dblclick", "fill", "type", "press", "select", "check", "uncheck", "upload", "drag", "keyboard",
  "open", "goto", "navigate", "back", "forward", "reload", "tab",
]);

/**
 * Wait for the app's React Query activity to settle — but only when the page
 * in question is this worktree's own app, since nothing else sets the marker
 * and off-origin pages would just burn the whole timeout on every capture.
 *
 * The browser is asked what page it is on rather than trusting a navigation
 * target: `open /` lands on `/chat`, and a redirect across origins in either
 * direction would otherwise decide the wait on a URL nobody is looking at.
 */
/**
 * The browse-key cookie lasts 30 minutes (`authCookieArgs`) and was re-seeded
 * only on `open`, so a long session of clicks and snapshots on one page was
 * signed out halfway (D-chemistry journey, 2026-10-09: "Your session has ended"
 * exactly 30 minutes after the walker's only `open`). Re-seed it on every
 * command while the browser is on this worktree's origin.
 */
async function refreshAuthCookie(ctx: WorktreeContext): Promise<void> {
  let current: string;
  try {
    current = await getUrl();
  } catch (_e) {
    return; // No page yet; the next `open` seeds the cookie.
  }
  if (isOwnOrigin(current, ctx)) await run(authCookieArgs(current, ctx));
}

/**
 * Whether a running daemon still answers. A wedged one fails every later
 * upstream call after 152 s, and a `bin/browse` command makes several, so the
 * caller learns nothing for minutes. No daemon yet means nothing to probe: the
 * command will start one, and a cold launch must not count against the probe.
 */
async function daemonAnswers(socketDir: string, session: string): Promise<boolean> {
  if (!daemonRunning(socketDir, session)) return true;
  try {
    await run(["get", "url"], { timeoutMs: PROBE_TIMEOUT_MS });
  } catch (e) {
    if (isStuck(e)) return false;
    // Any answer, even an error (no page yet), means the daemon is serving.
  }
  return true;
}

async function waitForReady(ctx: WorktreeContext): Promise<void> {
  let target: string;
  try {
    target = await getUrl();
  } catch (_e) {
    return; // No page to read; nothing to settle.
  }
  if (!isOwnOrigin(target, ctx)) return;
  const timeout = readyTimeoutMs();
  try {
    // `--timeout`, not AGENT_BROWSER_DEFAULT_TIMEOUT: on 0.41.0 a command
    // whose env differs from the daemon's restarts its background state, and
    // every later `snapshot` then returns the tree from before the change.
    // timeoutMs is the backstop against an unkillable hang.
    await run(["wait", "--fn", READY_FN, "--timeout", String(timeout)], { timeoutMs: timeout + 5_000 });
  } catch (e) {
    const msg = e instanceof AgentBrowserError ? e.message : String(e);
    process.stderr.write(`browse: page-ready wait timed out (${msg.trim().split("\n")[0]}); proceeding anyway\n`);
  }
}

/**
 * Reap this worktree's superseded agent-browser daemons before running.
 * Upstream's daemon stops serving its socket on idle but never exits, so
 * without this they accumulate one per generation.
 *
 * Best-effort by construction: a cleanup that cannot run must never fail the
 * command the user actually asked for.
 */
async function reapSupersededDaemons(): Promise<void> {
  const worktree = process.env["BROWSE_WORKTREE"];
  if (worktree === undefined || worktree === "") return;
  try {
    await reclaimWorktreeBrowsers({ worktree });
  } catch { /* best-effort */ }
}

async function main(): Promise<number> {
  await reapSupersededDaemons();
  let args = process.argv.slice(2);
  // `--session <name>` is agent-browser's global session selector, and callers
  // put it before the subcommand (`bin/browse --session s open /`). Left in
  // place it hides the subcommand from everything below — the open rewrite and
  // browse-key cookie, the settle waits, the screenshot enhancer — so all of it
  // silently skipped for named sessions (the field-test spine run's operator
  // landed on the login wall exactly this way). Hoist it into the env var the
  // binary honors; every child this process spawns then targets that session,
  // waitForReady's own calls included.
  const sessionIndexes = args.flatMap((arg, index) => arg === "--session" ? [index] : []);
  if (sessionIndexes.length > 1) {
    throw new BrowseConfigError("--session may only be specified once");
  }
  const sessionIndex = sessionIndexes[0];
  if (sessionIndex !== undefined) {
    const name = args[sessionIndex + 1];
    if (name === undefined || name === "" || name.startsWith("-")) {
      throw new BrowseConfigError("--session requires a session name");
    }
    process.env["AGENT_BROWSER_SESSION"] = name;
    // …and point the session at its own Chrome profile. Chrome refuses to
    // start a second instance on a profile another instance holds (it aborts
    // on the existing `SingletonLock` rather than risk corruption), so with
    // every session sharing one profile dir a named session could only ever
    // run while no other was live — the isolation the flag advertises did not
    // exist. Profiles are per-session AND per-worktree; the browse-key cookie
    // is re-seeded on each own-origin `open`, so a fresh profile authenticates
    // itself on first navigation with nothing to carry over.
    process.env["AGENT_BROWSER_PROFILE"] = await sessionProfileDir(name);
    args = [...args.slice(0, sessionIndex), ...args.slice(sessionIndex + 2)];
  }
  // Launch options (`--args`, `--headed`, …) go to every child through their
  // env vars, so the cookie step that starts the browser has them too.
  const launch = hoistLaunchOptions(args, process.env);
  args = launch.args;
  Object.assign(process.env, launch.env);
  const noWaitIdx = args.indexOf("--no-wait");
  const skipWait = noWaitIdx !== -1;
  if (skipWait) args = [...args.slice(0, noWaitIdx), ...args.slice(noWaitIdx + 1)];

  if (args.length === 0) {
    return runPassthrough([]);
  }
  const ctx = detectWorktreeContext();
  const sub = args[0] === undefined ? "" : args[0];
  // Any other flag before the subcommand would be taken for the subcommand,
  // skipping the open rewrite and the cookie (upstream then gets a bare path).
  if (sub.startsWith("-") && !PASSTHROUGH_LEADING_FLAGS.has(sub)) {
    throw new BrowseConfigError(`put ${sub} after the subcommand (e.g. bin/browse open /chats ${sub} …)`);
  }

  // A running browser keeps the options it started with; upstream would
  // ignore the new ones without a word.
  const socketDir = process.env["AGENT_BROWSER_SOCKET_DIR"] ?? "";
  const session = process.env["AGENT_BROWSER_SESSION"] ?? "default";
  if (launch.flags.length > 0 && sub !== "close" && daemonRunning(socketDir, session)) {
    throw new BrowseConfigError(`${launch.flags.join(", ")} apply when the browser starts, and it is running: run bin/browse close first`);
  }

  // `close` is the recovery for a wedged session, so it is never refused;
  // help needs no browser.
  // Screenshot arguments are this wrapper's own, so their usage errors and
  // help come first too.
  const shot = sub === "screenshot" ? parseScreenshotArgs(args.slice(1)) : null;
  if (shot?.kind === "help") { process.stdout.write(SCREENSHOT_USAGE); return 0; }
  if (shot?.kind === "error") { process.stderr.write(`browse screenshot: ${shot.message}\n${SCREENSHOT_USAGE}`); return 2; }
  if (shot === null && (PASSTHROUGH_LEADING_FLAGS.has(sub) || args.includes("--help") || args.includes("-h"))) {
    return runPassthrough(args);
  }
  if (sub !== "close" && !(await daemonAnswers(socketDir, session))) {
    process.stderr.write(wedgedMessage());
    return 1;
  }

  if (sub !== "open" && sub !== "close") {
    await refreshAuthCookie(ctx);
  }

  if (!skipWait && WAIT_BEFORE.has(sub)) {
    await waitForReady(ctx);
  }

  if (sub === "open") {
    const rest = args.slice(1);
    const target = rest[0];
    const url = target === undefined ? undefined : rewriteOpenUrl(target, ctx);
    if (url !== undefined && isOwnOrigin(url, ctx)) {
      await run(authCookieArgs(url, ctx));
    }
    const passArgs = url === undefined ? ["open"] : ["open", url, ...rest.slice(1)];
    const code = await runPassthrough(passArgs);
    if (code === 0 && !skipWait && WAIT_AFTER.has(sub)) await waitForReady(ctx);
    if (code === 0) await noteAction(sub);
    return code;
  }

  if (shot !== null) {
    let result;
    try {
      result = await runEnhancedScreenshot(shot.invocation, ctx);
    } catch (e) {
      if (!noAnswer(e)) throw e;
      process.stderr.write(stuckCaptureMessage("screenshot"));
      return 1;
    }
    process.stdout.write(`${result.imagePath}\n`);
    process.stdout.write(`url: ${result.sidecar.url}\n`);
    process.stdout.write(`title: ${result.sidecar.title}\n`);
    process.stdout.write(`sidecar: ${result.sidecarPath}\n`);
    return 0;
  }

  if (sub === "snapshot") {
    return annotatedSnapshot(args.slice(1), ctx);
  }

  if (sub === "clerk-popup") {
    return openClerkPopup(args[1]);
  }

  if (sub === "upload") {
    args = [sub, ...uploadArgs(args.slice(1))];
  }

  if (TARGET_COMMANDS.has(sub)) {
    const code = await checkedAction({ sub, args: args.slice(1), ctx });
    if (code === 0 && PAGE_CHANGING.has(sub)) await noteAction(sub);
    return code;
  }

  if (sub === "scroll") {
    return scrollWithSelector(args.slice(1));
  }

  if (sub === "get") {
    return getWithTarget(args.slice(1));
  }

  const code = await runPassthrough(args);
  if (code === 0 && PAGE_CHANGING.has(sub)) await noteAction(sub);
  if (code === 0 && sub === "close") {
    await waitForDaemonExit(socketDir, args.includes("--all") ? knownSessions(socketDir) : [session]);
  }
  return code;
}

export const SCREENSHOT_USAGE = `usage: browse screenshot [--full|-f] [--annotate] [--slug <name>] [path]
  path defaults to an indexed file under the worktree's screenshot dir;
  a URL/title sidecar is written beside it.
`;

export type ScreenshotParse =
  | { kind: "run"; invocation: ScreenshotInvocation }
  | { kind: "help" }
  | { kind: "error"; message: string };

/** Pure: flags, one optional output path. A dash-leading token is never a path. */
export function parseScreenshotArgs(args: readonly string[]): ScreenshotParse {
  let full = false;
  let annotate = false;
  let slug = "shot";
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--full" || a === "-f") { full = true; continue; }
    if (a === "--annotate") { annotate = true; continue; }
    if (a === "--slug") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) return { kind: "error", message: "--slug needs a name" };
      slug = next; i++;
      continue;
    }
    if (a.startsWith("-")) return { kind: "error", message: `unknown option ${a}` };
    positional.push(a);
  }
  if (positional.length > 1) return { kind: "error", message: `one output path at most, got ${positional.length}` };
  const path = positional[0] ?? null;
  return { kind: "run", invocation: { path, slug, full, annotate } };
}

main().then((code) => {
  process.exit(code);
}).catch((e: unknown) => {
  if (e instanceof BrowseConfigError || e instanceof AgentBrowserError) {
    process.stderr.write(`browse: ${e.message}\n`);
    process.exit(1);
    return;
  }
  process.stderr.write(`browse: unexpected error: ${String(e)}\n`);
  process.exit(1);
});

/**
 * `upload <target> <file>...` hands the paths to the browser daemon, which resolves
 * a relative path against its own working directory. The page then receives an
 * empty File that fails on read, and the app reports a format or network fault
 * that is ours (B-inventory journey, 2026-10-08). Resolve against the caller's
 * directory, and refuse a file that does not exist.
 */
function uploadArgs(rest: readonly string[]): string[] {
  return rest.map((arg, index) => {
    if (index === 0 || arg.startsWith("-")) return arg;
    const absolute = resolve(process.cwd(), arg);
    if (!existsSync(absolute)) throw new BrowseConfigError(`upload: no such file: ${absolute}`);
    return absolute;
  });
}
