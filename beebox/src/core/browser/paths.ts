/**
 * Where a box's browser keeps its files (docs/plans/shared-browser.md, Track B).
 *
 * Everything lives under `<BBX_STATE_DIR>/browser/<slug>-<key>/`: outside the
 * box's git repository (cookies and logins must never be committed) and
 * outside `_tmp/` (swept after seven days, which would log the person out).
 * On a unit host `BBX_STATE_DIR` is in the box user's own home
 * (`/var/lib/beebox/<slug>/.local/share/beebox`), which the box sandbox makes
 * writable and hides from sibling boxes.
 *
 * `BBX_STATE_DIR` is per OS user, not per box. In dev every worktree has its
 * own clone of `test1`, all with the slug `test1`, so the slug alone would give
 * them one shared profile, and one worktree's browser start would stop
 * another's. `<key>` is a short hash of the box root, which separates them;
 * the slug keeps the directory readable.
 *
 * agent-browser's daemon listens on `<socketDir>/<session>.sock`. A Unix
 * socket path has a hard length limit (103 bytes on macOS, 107 on Linux), and
 * agent-browser refuses a longer one with a message that does not name our
 * directory, so the limit is checked here, where the path is built.
 */

import { createHash } from "node:crypto";
import * as path from "node:path";

/** The agent-browser session name every box browser uses: one session per box. */
export const BOX_BROWSER_SESSION = "box";

/** The longest socket path accepted, under both platforms' limits with room to spare. */
const MAX_SOCKET_PATH_BYTES = 100;

export interface BrowserPaths {
  /** `<state>/browser/<slug>-<key>`, the parent of everything below. */
  readonly root: string;
  /** Chromium's user-data directory: cookies, logins, site settings. */
  readonly profile: string;
  /** agent-browser's `AGENT_BROWSER_SOCKET_DIR`: daemon sockets and pid files. */
  readonly socketDir: string;
  /** The dashboard relay socket the engine proxies to. */
  readonly relaySocket: string;
  /** Where downloads land. */
  readonly downloads: string;
  /** The browser host's log, read back when it fails to start. */
  readonly log: string;
  /** The explicit agent-browser config file, so no other config is discovered. */
  readonly config: string;
}

export class BrowserPathTooLongError extends Error {
  override name = "BrowserPathTooLongError";
  constructor(readonly socketPath: string) {
    super(
      `The box browser's socket path is ${String(Buffer.byteLength(socketPath))} bytes, over the ${String(MAX_SOCKET_PATH_BYTES)}-byte limit for Unix sockets: ${socketPath}. Use a shorter box slug or home directory.`,
    );
  }
}

/** The first 8 hex characters of the SHA-256 of the box root. */
export function boxRootKey(boxRoot: string): string {
  return createHash("sha256").update(path.resolve(boxRoot)).digest("hex").slice(0, 8);
}

export interface BrowserBox {
  /** The box's root directory; its hash keys the browser directory. */
  readonly boxRoot: string;
  /** The box's URL slug, kept in the directory name for readability. */
  readonly slug: string;
  /** The state directory (`BBX_STATE_DIR` in production code). */
  readonly stateDir: string;
}

/** The browser paths for one box. */
export function browserPaths({ boxRoot, slug, stateDir }: BrowserBox): BrowserPaths {
  const root = path.join(stateDir, "browser", `${slug}-${boxRootKey(boxRoot)}`);
  const socketDir = path.join(root, "sock");
  const relaySocket = path.join(root, "dashboard.sock");
  for (const socketPath of [path.join(socketDir, `${BOX_BROWSER_SESSION}.sock`), relaySocket]) {
    if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) throw new BrowserPathTooLongError(socketPath);
  }
  return {
    root,
    profile: path.join(root, "profile"),
    socketDir,
    relaySocket,
    downloads: path.join(root, "downloads"),
    log: path.join(root, "host.log"),
    config: path.join(root, "agent-browser.json"),
  };
}
