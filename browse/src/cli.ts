import { AgentBrowserError, runPassthrough } from "agent-browser-typed";
import { runEnhancedScreenshot } from "./screenshot.js";
import type { ScreenshotInvocation } from "./screenshot.js";
import { BrowseConfigError, detectWorktreeContext, rewriteOpenUrl } from "./worktree.js";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return runPassthrough([]);
  }
  const ctx = detectWorktreeContext();
  const sub = args[0];

  if (sub === "open") {
    const rest = args.slice(1);
    const target = rest[0];
    if (target !== undefined) {
      const rewritten = rewriteOpenUrl(target, ctx);
      return runPassthrough(["open", rewritten, ...rest.slice(1)]);
    }
    return runPassthrough(["open"]);
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
