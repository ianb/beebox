/**
 * Must match `BROWSE_KEY_COOKIE` in `callback-box/src/core/browse-key.ts`.
 * Restated rather than imported: `browse/` has no dependency on callback-box
 * and gains nothing but coupling from one, and a mismatch fails loudly and
 * immediately — the very first authenticated navigation lands on the login
 * page.
 */
const BROWSE_KEY_COOKIE = "cb_browse_key";

export interface WorktreeContext {
  repoDir: string;
  worktree: string;
  box: string;
  port: number;
  routerBase: string;
}

export function detectWorktreeContext(): WorktreeContext {
  const repoDir = process.env["BROWSE_REPO_DIR"];
  if (repoDir === undefined || repoDir === "") {
    throw new BrowseConfigError("BROWSE_REPO_DIR is not set. Invoke via bin/browse, not directly.");
  }
  const explicit = process.env["BROWSE_WORKTREE"];
  const worktreeMatch = repoDir.match(/\/callback-worktrees\/([^/]+)/);
  const worktree = explicit !== undefined && explicit !== ""
    ? explicit
    : (worktreeMatch !== null && worktreeMatch[1] !== undefined ? worktreeMatch[1] : "main");
  // Box slug is just "test1" — the dev router clones the base test1 box
  // into a per-worktree copy and registers it under that slug.
  const box = process.env["BROWSE_BOX"] !== undefined && process.env["BROWSE_BOX"] !== ""
    ? process.env["BROWSE_BOX"]
    : "test1";
  const portStr = process.env["ROUTER_PORT"];
  const port = portStr !== undefined && portStr !== "" ? Number.parseInt(portStr, 10) : 3210;
  if (!Number.isFinite(port) || port <= 0) {
    throw new BrowseConfigError(`ROUTER_PORT is not a valid port: ${String(portStr)}`);
  }
  const routerBase = resolveBase({ port, worktree, box });
  return { repoDir, worktree, box, port, routerBase };
}

/**
 * The base every `/`-leading path is rewritten onto, and the ONLY origin the
 * browse key is attached to (`isOwnOrigin` below is defined against it).
 *
 * `BROWSE_BASE_URL` replaces the router-derived default outright, for drivers
 * that own their own server instead of going through the shared dev router —
 * callback-box's field-test harness (`docs/plans/agent-field-tests.md`,
 * Track 2) starts a dedicated `cb serve` on a free port and points browse at
 * `http://127.0.0.1:<port>/<box>`. Without it, `bin/browse open /` would drive
 * the router's `test1` instead: the wrong box, silently.
 *
 * Both properties move together deliberately. Rewriting paths to the run
 * server while still scoping the cookie to the router origin would land every
 * navigation on the login page, and scoping the cookie to a base the rewrite
 * doesn't use would leak the key to an origin nobody navigated to.
 *
 * Unset (the normal case) is byte-for-byte the previous behavior.
 */
function resolveBase({ port, worktree, box }: { port: number; worktree: string; box: string }): string {
  const override = process.env["BROWSE_BASE_URL"];
  if (override === undefined || override === "") {
    return `http://localhost:${String(port)}/${worktree}/${box}`;
  }
  if (!override.startsWith("http://") && !override.startsWith("https://")) {
    throw new BrowseConfigError(`BROWSE_BASE_URL must be an absolute http(s) URL: ${override}`);
  }
  // A trailing slash would make every rewritten path double-slashed and every
  // own-origin check miss (`base + "/foo"` vs `base + "//foo"`).
  return override.replace(/\/+$/, "");
}

export function rewriteOpenUrl(url: string, ctx: WorktreeContext): string {
  if (url.startsWith("//")) return url;
  if (url.startsWith("/")) return `${ctx.routerBase}${url}`;
  return url;
}

/**
 * The local-dev browser key, when the operator set `CB_BROWSE_API_KEY` (the
 * checkout's `callback-box/.env` is the usual home; the router loads it for
 * the processes it spawns, and `bin/browse` reads it for this one). Auth is on
 * by default in dev, so without it a navigation lands on the login page.
 *
 * This deliberately does NOT fall back to the box's agent loopback token. That
 * token is a 0600 file secret for box subprocesses calling their own box, and
 * putting it in browser request headers would make it a network credential —
 * see `callback-box/src/core/browse-key.ts` for why this key exists instead.
 */
function browseKey(): string | undefined {
  const key = process.env["CB_BROWSE_API_KEY"];
  return key !== undefined && key !== "" ? key : undefined;
}

/**
 * `true` when `url` (already run through `rewriteOpenUrl`) targets this
 * worktree's own dev origin. Guards the bearer injection below so the
 * token — which authenticates as this box — never rides along to an
 * unrelated host a browse invocation happens to navigate to.
 */
export function isOwnOrigin(url: string, ctx: WorktreeContext): boolean {
  return url === ctx.routerBase || url.startsWith(`${ctx.routerBase}/`) || url.startsWith(`${ctx.routerBase}?`);
}

/**
 * Headers to attach for `url`, or `null` when there's no key configured (not
 * every target needs auth) or `url` isn't this worktree's own origin. Callers
 * pass the result straight to agent-browser's origin-scoped
 * `open <url> --headers <json>`.
 *
 * A cookie, and deliberately NOT an `Authorization` header, for two reasons:
 *
 * 1. A browser never attaches `Authorization` to a WebSocket handshake, so the
 *    header alone would authenticate the document and XHR but leave the tRPC
 *    socket refused — the app renders without live updates. A cookie rides
 *    every request to the origin, the upgrade included.
 * 2. The dev router treats ANY authorized GET into a box that carries an
 *    `Authorization` header as a mobile-device pairing bootstrap
 *    (`bin/router-mobile-bootstrap.ts`). The browse key is not a device token,
 *    so that exchange fails and the router answers the navigation with a hard
 *    `401 Mobile session bootstrap failed.` — measured, not theoretical.
 *    Carrying no bearer sidesteps it. (That trigger is too broad and wants
 *    narrowing on its own merits; it is not this code's job to work around.)
 *
 * Sending `Cookie` as a request header rather than seeding the profile's
 * cookie jar keeps it scoped to exactly the origin agent-browser scopes these
 * headers to, and leaves no credential behind in the persistent profile.
 */
export function authHeaderFor(url: string, ctx: WorktreeContext): Record<string, string> | null {
  const key = browseKey();
  if (key === undefined || !isOwnOrigin(url, ctx)) return null;
  return { Cookie: `${BROWSE_KEY_COOKIE}=${key}` };
}

export class BrowseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowseConfigError";
  }
}
