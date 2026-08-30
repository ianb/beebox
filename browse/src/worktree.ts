import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Must match `BROWSE_KEY_COOKIE` in `beebox/src/core/browse-key.ts`.
 * Restated rather than imported: `browse/` has no dependency on beebox
 * and gains nothing but coupling from one, and a mismatch fails loudly and
 * immediately — the very first authenticated navigation lands on the login
 * page.
 */
const BROWSE_KEY_COOKIE = "bbx_browse_key";

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
  const worktreeMatch = repoDir.match(/\/beebox-worktrees\/([^/]+)/);
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
 * The base every `/`-leading path is rewritten onto, and the only URL base
 * whose navigation may seed the browse-key cookie (`isOwnOrigin` below is
 * defined against it). Browser cookies are host-scoped rather than port-scoped;
 * the narrower lifetime and profile boundary are documented below.
 *
 * `BROWSE_BASE_URL` replaces the router-derived default outright, for drivers
 * that own their own server instead of going through the shared dev router —
 * beebox's field-test harness (`docs/plans/agent-field-tests.md`,
 * Track 2) starts a dedicated `bbx serve` on a free port and points browse at
 * `http://127.0.0.1:<port>/<box>`. Without it, `bin/browse open /` would drive
 * the router's `test1` instead: the wrong box, silently.
 *
 * Both properties move together deliberately. Rewriting paths to the run
 * server while seeding the cookie for the router host would land every
 * navigation on the login page.
 *
 * Unset (the normal case) is byte-for-byte the previous behavior.
 */
function resolveBase({ port, worktree, box }: { port: number; worktree: string; box: string }): string {
  const override = process.env["BROWSE_BASE_URL"];
  if (override === undefined || override === "") {
    return `http://localhost:${String(port)}/${worktree}/${box}`;
  }
  // Parsed, not prefix-checked. `isOwnOrigin` below is a string-prefix test,
  // so a value the eye reads as one host but the browser resolves as another
  // would attach the browse key to that other host: `http://localhost:1234@x`
  // has origin `x`, yet every rewritten URL starts with the configured base
  // and would pass the own-origin test. Rejecting userinfo (and rebuilding
  // from the parsed parts) closes that.
  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch (_e) {
    throw new BrowseConfigError(`BROWSE_BASE_URL is not a valid URL: ${override}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BrowseConfigError(`BROWSE_BASE_URL must be http(s): ${override}`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new BrowseConfigError(`BROWSE_BASE_URL must not carry credentials: ${override}`);
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new BrowseConfigError(`BROWSE_BASE_URL must be an origin plus optional path only: ${override}`);
  }
  // A trailing slash would make every rewritten path double-slashed and every
  // own-origin check miss (`base + "/foo"` vs `base + "//foo"`).
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

export function rewriteOpenUrl(url: string, ctx: WorktreeContext): string {
  if (url.startsWith("//")) return url;
  if (url.startsWith("/")) return `${ctx.routerBase}${url}`;
  return url;
}

/**
 * The local-dev browser key, when the operator set `BBX_BROWSE_API_KEY` (the
 * checkout's `beebox/.env` is the usual home; the router loads it for
 * the processes it spawns, and `bin/browse` reads it for this one). Auth is on
 * by default in dev, so without it a navigation lands on the login page.
 *
 * This deliberately does NOT fall back to the box's agent loopback token. That
 * token is a 0600 file secret for box subprocesses calling their own box, and
 * putting it in browser request headers would make it a network credential —
 * see `beebox/src/core/browse-key.ts` for why this key exists instead.
 */
function browseKey(): string | undefined {
  const key = process.env["BBX_BROWSE_API_KEY"];
  return key !== undefined && key !== "" ? key : undefined;
}

/**
 * `true` when `url` (already run through `rewriteOpenUrl`) targets this
 * worktree's own dev origin. Guards the cookie seeding below so the token —
 * which authenticates as this box — is never stored for an unrelated host a
 * browse invocation happens to navigate to.
 */
export function isOwnOrigin(url: string, ctx: WorktreeContext): boolean {
  return url === ctx.routerBase || url.startsWith(`${ctx.routerBase}/`) || url.startsWith(`${ctx.routerBase}?`);
}

/**
 * Cookie command to run before opening `url`. Calling this for another origin
 * is a programmer error: the caller must check `isOwnOrigin` by reaching this
 * function only for a rewritten own-origin navigation.
 *
 * A cookie, and deliberately NOT an `Authorization` header, for two reasons:
 *
 * 1. agent-browser's origin-scoped `open --headers` authenticates document and
 *    fetch requests but does not attach its synthetic `Cookie` header to
 *    WebSocket upgrades. Measured 2026-08-09: every initial tRPC upgrade and
 *    retry arrived without a cookie. A cookie in Chromium's jar rode both an
 *    initial upgrade and a reconnect after the live socket was destroyed.
 * 2. The dev router treats ANY authorized GET into a box that carries an
 *    `Authorization` header as a mobile-device pairing bootstrap
 *    (`bin/router-mobile-bootstrap.ts`). The browse key is not a device token,
 *    so that exchange fails and the router answers the navigation with a hard
 *    `401 Mobile session bootstrap failed.` — measured, not theoretical.
 *    Carrying no bearer sidesteps it. (That trigger is too broad and wants
 *    narrowing on its own merits; it is not this code's job to work around.)
 *
 * Seeding the jar does leave the credential in the per-worktree profile. A
 * host-only cookie still reaches other ports on that host, so the isolated
 * profile and 30-minute expiry bound (but do not eliminate) that local-dev
 * exposure. Keep it HttpOnly and Strict. It needs path `/`:
 * Chromium did not attach a cookie scoped to the externally visible router
 * prefix to the internally based tRPC socket URL. Worktree teardown removes a
 * worktree profile; the expiry bounds persistence for main. One
 * cookie mechanism covers navigation, fetch, and WebSocket reconnects; keeping
 * header injection too would create two auth paths with different lifetimes.
 */
export function authCookieArgs(url: string, ctx: WorktreeContext): string[] {
  if (!isOwnOrigin(url, ctx)) {
    throw new BrowseConfigError(`Refusing to seed browse auth for another origin: ${url}`);
  }
  const key = browseKey();
  const base = new URL(ctx.routerBase);
  // An absent key must revoke a previously seeded jar entry. Otherwise deleting
  // the key from .env would leave this profile authenticated until expiry.
  const expires = key === undefined ? 1 : Math.floor(Date.now() / 1000) + 30 * 60;
  return [
    "cookies", "set", BROWSE_KEY_COOKIE, key ?? "",
    "--url", base.origin,
    "--path", "/",
    "--httpOnly",
    "--sameSite", "Strict",
    "--expires", String(expires),
  ];
}

/**
 * The Chrome profile directory a named `--session` gets, created if absent.
 *
 * Chrome holds an exclusive `SingletonLock` on a profile and aborts rather
 * than open one another instance owns, so sessions must not share a profile
 * dir or only one can be live at a time. Sibling of the default session's
 * profile inside `bin/browse`'s per-worktree base, so worktree teardown still
 * removes every profile in one sweep.
 *
 * The name is sanitized, not merely validated: it becomes a path segment, and
 * `--session ../../x` must not escape the base. Sanitizing alone would be
 * lossy enough to break the very isolation this exists for — `a/b` and `a-b`
 * both reduce to `a-b`, and two sessions sharing a profile is exactly the
 * SingletonLock collision — so a name that had to be rewritten also carries a
 * digest of the original, which makes the mapping one-to-one again.
 */
export async function sessionProfileDir(name: string): Promise<string> {
  const base = process.env["BROWSE_PROFILE_BASE"];
  if (base === undefined || base === "") {
    throw new BrowseConfigError("BROWSE_PROFILE_BASE is not set. Invoke via bin/browse, not directly.");
  }
  const safe = name.replace(/[^\w.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  if (safe === "") {
    throw new BrowseConfigError(`--session name has no usable characters for a profile directory: ${name}`);
  }
  const segment = safe === name ? name : `${safe}-${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
  const dir = join(base, "profiles", segment);
  await mkdir(dir, { recursive: true });
  return dir;
}

export class BrowseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowseConfigError";
  }
}
