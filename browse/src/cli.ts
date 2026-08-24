import { AgentBrowserError, getUrl, run, runPassthrough } from "agent-browser-typed";
import { annotatedSnapshot, checkedAction } from "./act.js";
import { TARGET_COMMANDS } from "./controls.js";
import { runEnhancedScreenshot } from "./screenshot.js";
import type { ScreenshotInvocation } from "./screenshot.js";
import { authCookieArgs, BrowseConfigError, detectWorktreeContext, isOwnOrigin, rewriteOpenUrl, sessionProfileDir } from "./worktree.js";
import type { WorktreeContext } from "./worktree.js";

// JS expression evaluated in the page. The callback-box frontend exposes
// `<body data-cb-loading="true|false">` driven by React Query's
// useIsFetching/useIsMutating, so "false" means all in-flight queries
// (and any mutations) have settled. See callback-box trpc-provider.tsx.
const READY_FN = "document.body.dataset.cbLoading === 'false'";

// Ceiling on the settle wait. `wait --fn` polls forever on agent-browser
// 0.27.0: its own `--timeout` flag is parsed only in `--download` mode, and
// the documented 25s default action timeout is not applied unless
// AGENT_BROWSER_DEFAULT_TIMEOUT is set explicitly. Unset, a page that never
// sets the marker — about:blank, any non-app site, the login wall — hangs the
// wrapper indefinitely, which is what broke `screenshot`, `snapshot`, and
// `open` for every agent that ran them (issue 2026-08-15). Overridable for a
// genuinely slow page.
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

/**
 * Wait for the app's React Query activity to settle — but only when the page
 * in question is this worktree's own app, since nothing else sets the marker
 * and off-origin pages would just burn the whole timeout on every capture.
 *
 * The browser is asked what page it is on rather than trusting a navigation
 * target: `open /` lands on `/chat`, and a redirect across origins in either
 * direction would otherwise decide the wait on a URL nobody is looking at.
 */
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
    // The env var is what actually bounds the poll; timeoutMs is the backstop
    // for the day upstream stops honoring it — the failure it prevents is an
    // unkillable hang, so it is worth carrying both.
    await run(["wait", "--fn", READY_FN], {
      env: { AGENT_BROWSER_DEFAULT_TIMEOUT: String(timeout) },
      timeoutMs: timeout + 5_000,
    });
  } catch (e) {
    const msg = e instanceof AgentBrowserError ? e.message : String(e);
    process.stderr.write(`browse: page-ready wait timed out (${msg.trim().split("\n")[0]}); proceeding anyway\n`);
  }
}

async function main(): Promise<number> {
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
  const noWaitIdx = args.indexOf("--no-wait");
  const skipWait = noWaitIdx !== -1;
  if (skipWait) args = [...args.slice(0, noWaitIdx), ...args.slice(noWaitIdx + 1)];

  if (args.length === 0) {
    return runPassthrough([]);
  }
  const ctx = detectWorktreeContext();
  const sub = args[0] === undefined ? "" : args[0];

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
    return code;
  }

  if (sub === "screenshot") {
    const invocation = parseScreenshotArgs(args.slice(1));
    const result = await runEnhancedScreenshot(invocation, ctx);
    process.stdout.write(`${result.imagePath}\n`);
    process.stdout.write(`url: ${result.sidecar.url}\n`);
    process.stdout.write(`title: ${result.sidecar.title}\n`);
    process.stdout.write(`sidecar: ${result.sidecarPath}\n`);
    return 0;
  }

  if (sub === "snapshot") {
    return annotatedSnapshot(args.slice(1), ctx);
  }

  if (TARGET_COMMANDS.has(sub)) {
    return checkedAction({ sub, args: args.slice(1), ctx });
  }

  return runPassthrough(args);
}

function parseScreenshotArgs(args: readonly string[]): ScreenshotInvocation {
  let full = false;
  let annotate = false;
  let slug = "shot";
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--full" || a === "-f") { full = true; continue; }
    if (a === "--annotate") { annotate = true; continue; }
    if (a === "--slug") {
      const next = args[i + 1];
      if (next !== undefined) { slug = next; i++; }
      continue;
    }
    if (a !== undefined) positional.push(a);
  }
  const path = positional.length > 0 ? positional[positional.length - 1] : null;
  return { path: path !== undefined ? path : null, slug, full, annotate };
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
