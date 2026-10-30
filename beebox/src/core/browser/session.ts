/**
 * Making sure the box browser has a session before the person looks at it
 * (docs/plans/shared-browser.md, Track C, `GET /browser/`).
 *
 * The dashboard shows only sessions that exist; with none it offers its own
 * session form, which can start a browser outside the box's profile. So the
 * page load starts the box session when it is missing, with `open
 * about:blank`. It does so only when `session list` answers with a list that
 * lacks the box session: any other answer (an error, output in a shape this
 * file does not know) is reported and nothing is opened, because opening a
 * page in a session that does exist would replace the page the person or the
 * agent was working on.
 */

import { sendBrowserCommand } from "./command-socket.js";
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

/**
 * Start the box session through the command socket if it is not running.
 * Returns null when the session exists (or was started), else a sentence for
 * the person saying why it could not be checked or started.
 */
export async function ensureBoxSession(cliSocket: string): Promise<string | null> {
  const list = await sendBrowserCommand(cliSocket, ["session", "list"]);
  if (list.exitCode !== 0) return `Could not list the browser's sessions: ${list.stderr.trim() || `exit code ${String(list.exitCode)}`}`;
  const names = parseSessionList(list.stdout);
  if (names === null) return `Could not read the browser's session list: ${list.stdout.trim().slice(0, 200)}`;
  if (names.includes(BOX_BROWSER_SESSION)) return null;
  const opened = await sendBrowserCommand(cliSocket, ["open", "about:blank"]);
  if (opened.exitCode !== 0) return `Could not start the box browser: ${opened.stderr.trim() || `exit code ${String(opened.exitCode)}`}`;
  return null;
}
