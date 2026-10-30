/**
 * Which Chromium the box browser runs (docs/plans/shared-browser.md, Track B).
 *
 * On a unit host the deploy installs Chrome for Testing once for every box and
 * keeps `/opt/beebox-browser/chrome` pointing at it (Track F); a box cannot
 * install it itself (`NoNewPrivileges`, no sudo). If that link is missing the
 * browser is not installed, and the person and the agent are told so: there
 * is no fallback to some other Chrome on the host.
 *
 * Elsewhere (a developer's machine) agent-browser finds a browser itself: the
 * Chrome for Testing it downloaded, or the system Chrome. An
 * `AGENT_BROWSER_EXECUTABLE_PATH` already in the engine's environment wins.
 */

import { existsSync } from "node:fs";
import { onUnitHost } from "../../lib/unit-host.js";

/** The link the deploy maintains on a unit host. */
export const UNIT_HOST_BROWSER_PATH = "/opt/beebox-browser/chrome";

export type BrowserExecutable =
  /** `executablePath` undefined means agent-browser chooses. */
  | { readonly ok: true; readonly executablePath: string | undefined }
  | { readonly ok: false; readonly reason: string };

export interface ResolveBrowserOptions {
  readonly unitHost?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly exists?: (p: string) => boolean;
}

export function resolveBrowserExecutable(given?: ResolveBrowserOptions): BrowserExecutable {
  const options = given ?? {};
  const unitHost = options.unitHost ?? onUnitHost();
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const explicit = env.AGENT_BROWSER_EXECUTABLE_PATH;
  if (explicit !== undefined && explicit !== "") {
    if (!exists(explicit)) return { ok: false, reason: `AGENT_BROWSER_EXECUTABLE_PATH names ${explicit}, which does not exist` };
    return { ok: true, executablePath: explicit };
  }
  if (!unitHost) return { ok: true, executablePath: undefined };
  if (!exists(UNIT_HOST_BROWSER_PATH)) {
    return { ok: false, reason: `the server has no browser installed (${UNIT_HOST_BROWSER_PATH} is missing; the deploy installs it)` };
  }
  return { ok: true, executablePath: UNIT_HOST_BROWSER_PATH };
}
