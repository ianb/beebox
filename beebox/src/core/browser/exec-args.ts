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
 * allowed through.
 *
 * To find the subcommand the check skips the value that follows a
 * value-taking global flag (`--max-output 5000 open ...`); without that, a
 * value that looks like a subcommand would be misread. The value-taking list
 * comes from the options table in agent-browser's README (pinned version).
 */

import { z } from "zod";

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

/** Checks the argument list the agent passed to `bbx browser`. */
export function checkExecArgs(args: readonly string[]): ExecArgsCheck {
  for (const token of args) {
    const name = flagName(token);
    if (isRefusedFlag(name)) return refuseFlag(name);
    // A short flag can carry its value glued on (`-pbrowserbase`).
    if (token.startsWith("-p") && !token.startsWith("--")) return refuseFlag("-p");
  }
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    if (token.startsWith("-")) {
      if (VALUE_FLAGS.has(token)) i++;
      continue;
    }
    if (isRefusedSubcommand(token)) {
      return { ok: false, refused: token, message: `bbx browser: "${token}" is not available for the box browser` };
    }
    break;
  }
  return { ok: true };
}
