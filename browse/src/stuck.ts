/**
 * Ceilings and messages for an upstream daemon that stops answering.
 *
 * agent-browser's client waits 30 s for a reply. 0.27.0 then re-sent the
 * command up to five times, so one stuck command cost 152 s; 0.41.0 gives up
 * after one wait ("os error 35 … it may or may not have run") and replaces a
 * tab that stays stuck with a blank one after about 80 s. A `bin/browse` call
 * makes several upstream calls, so the probe below still saves most of that
 * wait and names the cause.
 *
 * Repro and measurements: issues/closed/bugs/2026-07-14-browse-daemon-wedges-on-animated-canvas.md.
 */
import { AgentBrowserError } from "agent-browser-typed";

/**
 * How long a running daemon gets to answer `get url` before the session is
 * called wedged. A healthy one answers in about 0.2 s; one whose tab has
 * stopped responding never does.
 */
export const PROBE_TIMEOUT_MS = 10_000;

/**
 * Backstop for `snapshot` and `screenshot`. Above upstream's 30 s read
 * timeout, so upstream normally reports the failure first; this fires only if
 * the client itself hangs.
 */
export const CAPTURE_TIMEOUT_MS = 45_000;

/** The `bin/browse … close` that ends the caller's session (cli.ts hoists `--session` into this env var). */
function closeCommand(): string {
  const session = process.env["AGENT_BROWSER_SESSION"];
  return session === undefined || session === "" ? "bin/browse close" : `bin/browse --session ${session} close`;
}

/** What to tell the caller when the probe got no answer. */
export function wedgedMessage(): string {
  return `browse: the browser did not answer within ${String(PROBE_TIMEOUT_MS / 1000)} s. `
    + "Its page stopped responding, or another command in this session is stuck or still running. "
    + "agent-browser replaces a stuck tab with a blank one after about 80 s. "
    + `To recover now, if no other command is running, run \`${closeCommand()}\`, then open the page again.\n`;
}

/** What to tell the caller when `snapshot` or `screenshot` got no answer ({@link noAnswer}). */
export function stuckCaptureMessage(command: "snapshot" | "screenshot"): string {
  const cause = command === "screenshot"
    ? "On macOS a stuck capture usually means the display is asleep: `caffeinate -u -t 2` wakes it."
    : "The page or the snapshot of it is stuck.";
  return `browse: ${command} got no answer from the browser. ${cause} `
    + `If the next command reports no answer, run \`${closeCommand()}\` and open the page again.\n`;
}

/** True when `e` is this wrapper's own ceiling firing, not an upstream failure. */
export function isStuck(e: unknown): e is AgentBrowserError {
  return e instanceof AgentBrowserError && e.timedOut;
}

/**
 * True when the command got no answer: this wrapper's ceiling fired, or
 * upstream's client gave up waiting on the daemon (macOS EAGAIN, "os error 35").
 */
export function noAnswer(e: unknown): e is AgentBrowserError {
  return isStuck(e) || (e instanceof AgentBrowserError && /\(os error 35\)/.test(`${e.stderr}\n${e.stdout}`));
}
