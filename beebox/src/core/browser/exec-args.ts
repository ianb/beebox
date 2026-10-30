/**
 * Which agent-browser arguments the box browser accepts
 * (docs/plans/shared-browser.md, Track C, `POST /api/browser/exec`).
 *
 * The box has one browser with one profile, and the agent reaches it only
 * through `bbx browser`. A global flag that picks another browser, profile,
 * session or state (`--profile`, `--cdp`, `--session`, ...) would leave the box
 * browser, and so would `connect`. `batch` is refused because each of its
 * strings is parsed as a separate command, so `batch "connect wss://x"` would
 * get past a check on the first word. The list is exact tokens and the
 * `--flag=value` form; it is a refusal list, so a flag missing from it is
 * allowed through. `--namespace` picks another daemon socket directory, so
 * another set of sessions.
 *
 * To find the subcommand the check skips the value that follows a
 * value-taking global flag (`--max-output 5000 open ...`); without that, a
 * value that looks like a subcommand would be misread. The value-taking list
 * comes from the options table in agent-browser's README (pinned version).
 */

import { z } from "zod";
import { BOX_BROWSER_SESSION } from "./paths.js";

/** Shape of the exec route's request body. */
export const EXEC_BODY = z.object({ args: z.array(z.string().max(8192)).min(1).max(64) });

/** Global flags that change which browser, profile, session or state is used. */
export const REFUSED_FLAGS = [
  "--session",
  "--session-name",
  "--profile",
  "--cdp",
  "--auto-connect",
  "--provider",
  "-p",
  "--engine",
  "--executable-path",
  "--args",
  "--state",
  "--restore",
  "--config",
  "--headed",
  "--extension",
  "--namespace",
] as const;

/** Subcommands that leave the box browser or change the install. */
export const REFUSED_SUBCOMMANDS = ["connect", "batch", "dashboard", "install", "upgrade", "plugin", "mcp"] as const;

/** Global flags that take a separate value token (README options table). */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--session",
  "--restore",
  "--restore-save",
  "--restore-check-url",
  "--restore-check-text",
  "--restore-check-fn",
  "--namespace",
  "--session-name",
  "--profile",
  "--state",
  "--headers",
  "--executable-path",
  "--extension",
  "--init-script",
  "--enable",
  "--args",
  "--user-agent",
  "--proxy",
  "--proxy-bypass",
  "--ca-cert",
  "--hide-scrollbars",
  "-p",
  "--provider",
  "--device",
  "--threshold",
  "--screenshot-dir",
  "--screenshot-quality",
  "--screenshot-format",
  "--cdp",
  "--color-scheme",
  "--download-path",
  "--max-output",
  "--allowed-domains",
  "--action-policy",
  "--confirm-actions",
  "--input-mode",
  "--idle-timeout",
  "--engine",
  "--model",
  "--config",
  "--timeout",
]);

export type ExecArgsCheck = { ok: true } | { ok: false; refused: string; message: string };

const REFUSED_FLAG_SET: ReadonlySet<string> = new Set(REFUSED_FLAGS);
const REFUSED_SUBCOMMAND_SET: ReadonlySet<string> = new Set(REFUSED_SUBCOMMANDS);

function isRefusedFlag(name: string): boolean {
  return REFUSED_FLAG_SET.has(name);
}

function isRefusedSubcommand(name: string): boolean {
  return REFUSED_SUBCOMMAND_SET.has(name);
}

function flagName(token: string): string {
  const eq = token.indexOf("=");
  return token.startsWith("-") && eq > 0 ? token.slice(0, eq) : token;
}

function refuseFlag(flag: string): ExecArgsCheck {
  return { ok: false, refused: flag, message: `bbx browser: ${flag} is fixed for the box browser; the box uses one browser profile` };
}

/** Checks `args` against the refused lists; a flag in `allowed` is not refused (its value is still skipped). */
function checkArgs(args: readonly string[], allowed: ReadonlySet<string>): ExecArgsCheck {
  for (const token of args) {
    const name = flagName(token);
    if (isRefusedFlag(name) && !allowed.has(name)) return refuseFlag(name);
    // A short flag can carry its value glued on (`-pbrowserbase`).
    if (token.startsWith("-p") && !token.startsWith("--")) return refuseFlag("-p");
  }
  const subcommand = execSubcommand(args);
  if (subcommand !== null && isRefusedSubcommand(subcommand)) {
    return { ok: false, refused: subcommand, message: `bbx browser: "${subcommand}" is not available for the box browser` };
  }
  return { ok: true };
}

/** The subcommand: the first argument that is not a flag or a flag's value; null when there is none. */
export function execSubcommand(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    if (!token.startsWith("-")) return token;
    if (VALUE_FLAGS.has(token)) i++;
  }
  return null;
}

/** Checks the argument list the agent passed to `bbx browser`. */
export function checkExecArgs(args: readonly string[]): ExecArgsCheck {
  return checkArgs(args, new Set());
}

export const ONE_SESSION_MESSAGE = `the box browser has one session, "${BOX_BROWSER_SESSION}"`;

/**
 * Checks the arguments the proxied dashboard posts to its own `/api/exec`.
 * The dashboard prefixes every command with `--session <name>`, so
 * `--session box` (or `--session=box`) is allowed and any other session is
 * refused; the rest is checked as for the agent. A `--session` that another
 * flag would take as its value is still checked here, which can only refuse more.
 */
export function checkDashboardExecArgs(args: readonly string[]): ExecArgsCheck {
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    const session = token === "--session" ? args[i + 1] : flagName(token) === "--session" ? token.slice("--session=".length) : null;
    if (session !== null && session !== BOX_BROWSER_SESSION) return { ok: false, refused: "--session", message: ONE_SESSION_MESSAGE };
  }
  return checkArgs(args, new Set(["--session"]));
}
