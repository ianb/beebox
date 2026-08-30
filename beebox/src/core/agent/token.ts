/**
 * Per-box agent loopback token.
 *
 * Box agents (chat subprocess, scheduled scripts, reactor tasks) call back
 * into the live server over HTTP (`bbx chat self-note`, `bbx chat
 * get-last-audio`). In production those requests hit the public URL and the
 * per-box auth wall, which only knows browser session cookies — so agent
 * loopback calls used to 401. This token closes that gap without any manual
 * provisioning:
 *
 * - The token lives at `.beebox/agent-token` (mode 0600, gitignored),
 *   generated on first use. Anything running as the box's user can read it —
 *   which is exactly the trust boundary: the agents ARE the box.
 * - `buildScriptEnv` injects it as `BBX_AGENT_TOKEN` into every spawned
 *   subprocess; the `bbx chat` commands send it as a bearer header.
 * - The per-box auth wall (server-box-scope.ts) accepts the bearer as
 *   box-scoped authentication. Both server processes (web app, scheduler
 *   daemon) resolve the same file, so tokens agree across spawners.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";

const TOKEN_RELATIVE_PATH = ".beebox/agent-token";
const MIN_TOKEN_LENGTH = 32;

function tokenPath(boxRoot: string): string {
  return path.join(boxRoot, TOKEN_RELATIVE_PATH);
}

/**
 * Read the box's agent token, generating and persisting one if absent.
 */
export function getOrCreateAgentToken(boxRoot: string): string {
  const file = tokenPath(boxRoot);
  try {
    const existing = fs.readFileSync(file, "utf-8").trim();
    if (existing.length >= MIN_TOKEN_LENGTH) return existing;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

/**
 * Check an `Authorization` header value against the box's agent token.
 * Timing-safe; false for a missing/malformed header or a missing token file
 * (verification never creates the file — only spawners do).
 */
export function verifyAgentBearer(boxRoot: string, authorization: string | undefined): boolean {
  if (typeof authorization !== "string") return false;
  let token: string;
  try {
    token = fs.readFileSync(tokenPath(boxRoot), "utf-8").trim();
  } catch (_e) {
    return false;
  }
  if (token.length < MIN_TOKEN_LENGTH) return false;
  const expected = `Bearer ${token}`;
  if (authorization.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

/**
 * Resolve the agent token from the CLI's perspective: the env var set by
 * `buildScriptEnv`, falling back to the token file under the current
 * working directory (agents run with cwd at the box root; the fallback also
 * covers manual `bbx` runs from a box). Null when neither is available.
 */
export function resolveAgentToken(): string | null {
  const fromEnv = process.env.BBX_AGENT_TOKEN;
  if (fromEnv && fromEnv.length >= MIN_TOKEN_LENGTH) return fromEnv;
  try {
    const fromCwd = fs.readFileSync(tokenPath(process.cwd()), "utf-8").trim();
    if (fromCwd.length >= MIN_TOKEN_LENGTH) return fromCwd;
  } catch (_e) {
    // No box at cwd (or no token yet) — caller proceeds unauthenticated.
  }
  return null;
}
