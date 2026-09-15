// The page a worktree that failed to start shows in a browser.
//
// Split out of router-pages.ts when the automatic-retry state pushed that file
// past its line limit. It is also a coherent unit on its own: everything here
// answers one question, "why is this worktree not serving, and what happens
// next" — including the part a reader cannot get from the captured error alone,
// which is whether the router intends to try again (engineering principle 13).

import path from "node:path";
import { LOG_DIR } from "./router-config.js";
import type { FailedLifecycle } from "./router-lifecycle.js";
import { escapeHtml } from "./router-markdown.js";

/**
 * What the router will do next, in the reader's own terms.
 *
 * Only `waitForHttp` failures retry automatically, so this also tells a reader
 * which KIND of failure they are looking at without making them know the phase
 * vocabulary: "we think the machine was busy" versus "this is broken".
 */
function retryNote(failed: FailedLifecycle): string {
  const note = (text: string): string => `<p class="sub">${text}</p>`;
  const spent = failed.attempts;
  if (failed.retryAfter !== null) {
    const seconds = Math.max(0, Math.round((failed.retryAfter - Date.now()) / 1000));
    const tried = spent === 0 ? "" : ` ${String(spent)} automatic retr${spent === 1 ? "y has" : "ies have"} already run.`;
    return note(
      "This looks like host load rather than a broken worktree, so the router will start it again by itself — " +
        `on the next request about ${String(seconds)}s from now.${tried}`,
    );
  }
  if (spent > 0) {
    return note(
      `The router already restarted this worktree ${String(spent)} time${spent === 1 ? "" : "s"} ` +
        "automatically and it kept failing, so it will not try again on its own.",
    );
  }
  return note(
    "This failure says something about the worktree rather than the machine, so the router will not restart it on its own.",
  );
}

export function renderFailedPage(name: string, failed: FailedLifecycle): string {
  const err = failed.lastError;
  const logPath = path.join(LOG_DIR, `${name}.log`);
  const sinceMs = Date.now() - err.at;
  // A control shows the state the system is in, not the one it intends
  // (engineering principle 13). A worktree with a retry still scheduled is NOT
  // in the same state as one that has given up, and the difference decides
  // whether the reader needs to do anything at all.
  const retrySection = retryNote(failed);
  const viteSection = err.viteOutput.trim()
    ? `<h2>vite output (last ${err.viteOutput.length} bytes, stdout+stderr interleaved)</h2><pre>${escapeHtml(err.viteOutput)}</pre>`
    : "<h2>vite output</h2><p class=\"muted\">(empty)</p>";
  const fastifySection = err.fastifyOutput.trim()
    ? `<h2>fastify output (last ${err.fastifyOutput.length} bytes, stdout+stderr interleaved)</h2><pre>${escapeHtml(err.fastifyOutput)}</pre>`
    : "<h2>fastify output</h2><p class=\"muted\">(empty)</p>";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Worktree ${escapeHtml(name)} — failed to start</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 920px; margin: 2em auto; padding: 0 1em; color: #222; }
  h1 { font-size: 1.2em; margin-bottom: 0.2em; color: #a22; }
  h2 { font-size: 0.95em; margin: 1.5em 0 0.3em; color: #555; }
  p.sub { color: #666; margin-top: 0; }
  p.muted { color: #999; font-style: italic; }
  .err { margin: 1em 0; padding: 0.8em 1em; background: #fff5f5; border-left: 4px solid #c33; border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; white-space: pre-wrap; }
  pre { background: #f7f7f7; padding: 0.8em 1em; border-radius: 4px; overflow-x: auto; font-size: 0.8em; line-height: 1.4; max-height: 24em; }
  form { display: inline; }
  button { font: 14px/1 system-ui; padding: 0.5em 1em; background: #2255aa; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  button:hover { background: #1a4490; }
  a { color: #2255aa; }
  .actions { margin: 1.5em 0; display: flex; gap: 0.8em; align-items: center; }
  .meta { font-size: 0.85em; color: #888; }
  code { background: #fff; padding: 0.1em 0.35em; border-radius: 3px; border: 1px solid #ddd; }
</style>
</head>
<body>
<h1>Worktree <code>${escapeHtml(name)}</code> failed to start</h1>
<p class="sub">Phase: <code>${escapeHtml(err.phase)}</code> · <span class="meta">${Math.round(sinceMs / 1000)}s ago</span></p>

<div class="err">${escapeHtml(err.message)}</div>
${retrySection}

<div class="actions">
  <form method="POST" action="/__router/retry/${escapeHtml(name)}">
    <button type="submit">Retry startup</button>
  </form>
  <a href="/">← back to router index</a>
</div>

${viteSection}
${fastifySection}

<h2>Per-worktree log</h2>
<p class="meta">Full output (both children, all attempts) lives at <code>${escapeHtml(logPath)}</code>.</p>

</body>
</html>
`;
}
