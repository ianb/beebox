/**
 * Ceilings and messages for an upstream daemon that stops answering.
 *
 * agent-browser's client waits 30 s for a reply, then (0.27.0) re-sends the
 * command up to five times, so one stuck command fails after 152 s with
 * "Failed to read: Resource temporarily unavailable (os error 35)" and keeps
 * the daemon busy that whole time. A `bin/browse` call makes several upstream
 * calls, so a wedged session used to cost minutes per command with no cause
 * named. These ceilings stop the client early and say what to do instead.
 *
 * Repro and measurements: issues/bugs/2026-07-14-browse-daemon-wedges-on-animated-canvas.md.
 */
import { AgentBrowserError } from "agent-browser-typed";

/**
 * How long a running daemon gets to answer `get url` before the session is
 * called wedged. A healthy one answers in about 0.2 s; one whose tab has
 * stopped responding never does.
 */
export const PROBE_TIMEOUT_MS = 10_000;

/**
 * Ceiling for `snapshot` and `screenshot`. Above upstream's 30 s read timeout,
 * so upstream reports its own failures (0.41.0 reports `page_wedged` at about
 * 33 s), and well under the 152 s of five re-sends.
 */
export const CAPTURE_TIMEOUT_MS = 45_000;

/** The `bin/browse … close` that ends the caller's session (cli.ts hoists `--session` into this env var). */
function closeCommand(): string {
  const session = process.env["AGENT_BROWSER_SESSION"];
  return session === undefined || session === "" ? "bin/browse close" : `bin/browse --session ${session} close`;
}

/** What to tell the caller when the probe got no answer. */
export function wedgedMessage(): string {
  return `browse: the browser did not answer within ${String(PROBE_TIMEOUT_MS / 1000)} s, so this session is wedged `
    + "(a page that stopped responding, or a stuck command still holding the daemon). "
    + `Run \`${closeCommand()}\`, then open the page again.\n`;
}

/**
 * What to tell the caller when `snapshot` or `screenshot` hit
 * `CAPTURE_TIMEOUT_MS`. Upstream may already have re-sent the command, so the
 * daemon can stay busy after the client is stopped; the next command's probe
 * then reports the session wedged.
 */
export function stuckCaptureMessage(command: "snapshot" | "screenshot"): string {
  const cause = command === "screenshot"
    ? "On macOS a stuck capture usually means the display is asleep: `caffeinate -u -t 2` wakes it."
    : "The page or the snapshot of it is stuck.";
  return `browse: ${command} did not finish within ${String(CAPTURE_TIMEOUT_MS / 1000)} s and was stopped. ${cause} `
    + `If the next command reports the session wedged, run \`${closeCommand()}\` and open the page again.\n`;
}

/** True when `e` is this wrapper's own ceiling firing, not an upstream failure. */
export function isStuck(e: unknown): e is AgentBrowserError {
  return e instanceof AgentBrowserError && e.timedOut;
}
