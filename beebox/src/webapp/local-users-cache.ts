/**
 * Request-path cache for the local credential store (`local-users.ts`).
 *
 * The identity resolver (`auth.ts` `resolveRequestIdentity`) consults the auth
 * file on EVERY request to enforce the `gen` session-revocation check (Track D).
 * Statting + reading + Zod-parsing the file per request would be wasteful, so
 * this caches the parsed file keyed on its `mtime:size:inode` and invalidates
 * the moment a credential operation rewrites it — each of create/add/set/remove
 * replaces the file via O_EXCL create or temp+rename, moving at least one of
 * those stat fields.
 *
 * A corrupt/symlinked file is NEVER cached: `loadAuthFile()` throws
 * (`AuthStoreUnavailableError`) and the throw propagates without recording
 * anything, so a healed file recovers on the next call and a still-broken one is
 * re-detected every request (the resolver maps the throw to the distinct
 * `auth-store-unavailable` outcome → 503). Accepted residual staleness: a
 * same-millisecond, same-size, same-inode overwrite could serve a revoked cookie
 * until the next stat tick (<1s); credential ops are rare and human-paced.
 */

import * as fs from "node:fs";
import { errnoCode } from "../lib/error-guards.js";
import { AuthFileCorruptError } from "./local-users-errors.js";
import { authFilePath, findUser, loadAuthFile, type AuthFile, type LocalUser } from "./local-users.js";

let requestPathCache: { key: string; file: AuthFile | null } | null = null;

function loadAuthFileForRequestPath(): AuthFile | null {
  const target = authFilePath();
  let key: string;
  try {
    const stat = fs.lstatSync(target);
    key = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") {
      requestPathCache = null;
      return null;
    }
    throw new AuthFileCorruptError(target, { cause: e });
  }
  const cached = requestPathCache;
  if (cached && cached.key === key) return cached.file;
  const loaded = loadAuthFile();
  requestPathCache = { key, file: loaded };
  return loaded;
}

/**
 * Like `getLocalUser`, but served from the mtime-guarded request-path cache so
 * the identity resolver isn't statting + parsing the auth file on every request.
 * Throws `AuthStoreUnavailableError` on a corrupt/symlinked file exactly as the
 * uncached path does — the resolver catches it and fails the request closed and
 * distinctly (503), never as "no record".
 */
export function getLocalUserCached(email: string): LocalUser | null {
  const file = loadAuthFileForRequestPath();
  return file ? findUser(file, email) : null;
}

/** Drop the cached parse (tests that rewrite the auth file within one stat tick). */
export function resetLocalUserCache(): void {
  requestPathCache = null;
}
