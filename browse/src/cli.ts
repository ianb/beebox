import { AgentBrowserError, run, runPassthrough } from "agent-browser-typed";
import { runEnhancedScreenshot } from "./screenshot.js";
import type { ScreenshotInvocation } from "./screenshot.js";
import { authCookieArgs, BrowseConfigError, detectWorktreeContext, isOwnOrigin, rewriteOpenUrl } from "./worktree.js";

// JS expression evaluated in the page. The callback-box frontend exposes
// `<body data-cb-loading="true|false">` driven by React Query's
// useIsFetching/useIsMutating, so "false" means all in-flight queries
// (and any mutations) have settled. See callback-box trpc-provider.tsx.
const READY_FN = "document.body.dataset.cbLoading === 'false'";

// Commands that operate on the current page and benefit from waiting for
// query activity to settle first. `open` waits AFTER navigating; `snapshot`
// and `screenshot` wait BEFORE reading so they capture the settled state.
const WAIT_AFTER = new Set(["open"]);
const WAIT_BEFORE = new Set(["snapshot", "screenshot"]);

async function waitForReady(): Promise<void> {
  try {
    await run(["wait", "--fn", READY_FN]);
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
    await waitForReady();
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
    if (code === 0 && !skipWait && WAIT_AFTER.has(sub)) await waitForReady();
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
