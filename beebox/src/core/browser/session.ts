/**
 * Starting the box session (docs/plans/shared-browser.md, Track C).
 *
 * Every launch of the box browser goes through here: the command socket runs
 * it before any command that finds the session missing
 * (`host-process/command-server.ts`), and the browser page sends a command
 * on load. The dashboard shows only sessions that exist; with none it offers
 * its own session form, which can start a browser outside the box's profile.
 * A missing session is started with `open about:blank`, only when `session
 * list` answers with a list that lacks the box session: any other answer (an
 * error, output in a shape this file does not know) is reported and nothing
 * is opened, because opening a page in a session that does exist would
 * replace the page the person or the agent was working on.
 */

import type { ExecReply } from "./command-socket.js";
import { BOX_BROWSER_SESSION } from "./paths.js";

/**
 * The session names in `agent-browser session list` output, or null when the
 * output is not in a known shape. Known shapes: "No active sessions", or
 * "Active sessions:" followed by one name per line, the current one marked
 * with `→` (agent-browser 0.39.2); an ASCII `->` is read the same way.
 */
export function parseSessionList(stdout: string): string[] | null {
  const lines = stdout.trim().split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length === 1 && lines[0] === "No active sessions") return [];
  if (lines[0] !== "Active sessions:") return null;
  const names = lines.slice(1).map((line) => line.replace(/^(?:→|->)\s*/, ""));
  return names.every((name) => /^[\w.-]+$/.test(name)) ? names : null;
}

/** Starts the stderr line in which the command socket says the box session could not be started; the browser page shows it. */
export const SESSION_PROBLEM_PREFIX = "bbx browser: box session: ";

/** Runs one agent-browser command for the box and returns its reply. */
export type RunBrowserCommand = (args: readonly string[]) => Promise<ExecReply>;

/**
 * The box browser's viewport. agent-browser 0.39.2 launches headless Chrome
 * with a 1280x720 window but sets no viewport, so the page gets the window
 * less Chrome's toolbar (1280x577; 1280x633 for `tab new`), while the
 * dashboard maps clicks onto 1280x720: every click landed lower than aimed
 * (G2, 2026-10-30). Set once, the viewport holds for every later tab and
 * popup until the browser is launched again.
 */
export const BOX_VIEWPORT = { width: 1280, height: 720 } as const;

/**
 * Start the box session if it is not running: open `about:blank` and set
 * `BOX_VIEWPORT`. Returns null when the session exists (or was started), else
 * a sentence saying why it could not be checked or started.
 */
export async function ensureBoxSession(run: RunBrowserCommand): Promise<string | null> {
  const list = await run(["session", "list"]);
  if (list.exitCode !== 0) return `Could not list the browser's sessions: ${list.stderr.trim() || `exit code ${String(list.exitCode)}`}`;
  const names = parseSessionList(list.stdout);
  if (names === null) return `Could not read the browser's session list: ${list.stdout.trim().slice(0, 200)}`;
  if (names.includes(BOX_BROWSER_SESSION)) return null;
  const opened = await run(["open", "about:blank"]);
  if (opened.exitCode !== 0) return `Could not start the box browser: ${opened.stderr.trim() || `exit code ${String(opened.exitCode)}`}`;
  const sized = await run(["set", "viewport", String(BOX_VIEWPORT.width), String(BOX_VIEWPORT.height)]);
  if (sized.exitCode !== 0) return `Could not set the box browser's viewport: ${sized.stderr.trim() || `exit code ${String(sized.exitCode)}`}`;
  return null;
}
