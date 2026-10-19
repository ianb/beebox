// # Dead Google grant: detection and state
//
// A BYO operator's Google OAuth grant can expire (7 days, in Testing mode) or be
// revoked. Google says so with `invalid_grant` on token refresh — the one signal
// we treat as auth-dead, because access tokens live an hour so a dead refresh
// token surfaces there within the hour no matter which connector runs first.
//
// The state lives with the credential (`google-token-store.ts`), not in
// per-connector state: one refresh token is shared by gmail/calendar/drive across
// every box on the server. See `docs/plans/google-auth-reauth-health.md`.

import { test } from "tap";
import "agent-doctest/tap";
import { capture, isoDate } from "agent-doctest/check";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  isInvalidGrantError,
  classifyRefreshFailure,
  readGoogleAuthStatus,
} from "../../src/google/auth-status.js";
import { saveGoogleTokens, markGoogleAuthDead } from "../../src/google/token-store.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const tmp = await mkdtemp(path.join(os.tmpdir(), "google-auth-status-"));
const TOKENS_FILE = path.join(tmp, "google-tokens.json");
process.env.BBX_GOOGLE_TOKENS_FILE = TOKENS_FILE;

/** A box holding the OAuth app's client credentials — `configured` is per-box. */
async function grantedBox() {
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  for (const name of ["google-oauth-client-id", "google-oauth-client-secret"]) {
    await setSecret({ name, value: `placeholder-${name}` });
    await grantSecret({ slug, name, access: "server" });
  }
  return box;
}

/** Run `fn`, which must throw, and return the error instead of propagating it. */
async function tryCall(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof Error) return e;
    throw e;
  }
  throw new Error("expected the call to throw");
}

/** A GaxiosError-shaped rejection, the way google-auth-library v10 throws it. */
function gaxiosError(message: string, data?: object): Error {
  const e = new Error(message);
  return data ? Object.assign(e, { response: { data } }) : e;
}

// ## Only `invalid_grant` counts as a dead grant
//
// The structured `response.data.error` is the primary signal; the ReAuth variant
// replaces `message` with the JSON of that same payload, so a message match is the
// fallback. Everything else is transient and must NOT flip the state — a network
// blip that told the boxholder to go re-authorize would be worse than silence.
void test("The structured response.data.error is the primary signal; the ReAuth variant...", async (t) => {
  t.check(isInvalidGrantError(gaxiosError("invalid_grant", { error: "invalid_grant" })), true);

  t.check(
    // ReAuth variant: message is the stringified payload.
    isInvalidGrantError(gaxiosError('{"error":"invalid_grant","error_description":"ReAuth required"}')),
    true,
  );

  t.check(isInvalidGrantError(gaxiosError("connect ETIMEDOUT")), false);

  t.check(isInvalidGrantError(gaxiosError("Service Unavailable", { error: "backendError" })), false);

  t.check(isInvalidGrantError(undefined), false);
});

// ## A transient failure is classified as "not our problem" and left alone
void test("A transient failure is classified as \"not our problem\" and left alone", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_GOOGLE_TOKENS_FILE;
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      await rm(tmp, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const transient = await classifyRefreshFailure(gaxiosError("connect ETIMEDOUT"), {});
  t.check(transient, null);

  const untouched = await readGoogleAuthStatus();
  t.check(untouched, { configured: false, connected: false, needsReauthSince: null, reauthReason: null, authCheckedAt: null });

  // ## An `invalid_grant` records the breakage and returns a typed error

  await saveGoogleTokens({ refreshToken: "rt-1", accessToken: "at-1" });

  const expired = await classifyRefreshFailure(
    gaxiosError("invalid_grant", { error: "invalid_grant", error_description: "Token has been expired or revoked." }),
    {},
  );
  t.check(expired, { name: "GoogleAuthExpiredError", message: "Google authorization expired or revoked: invalid_grant" });

  // The token state is machine-wide, but `configured` asks whether THIS box holds
  // a grant for the OAuth app's credentials — so the read is per-box.
  const box = await grantedBox();
  const dead = await readGoogleAuthStatus(box.root);
  const since = capture(isoDate());
  t.check(dead, { configured: true, connected: true, needsReauthSince: since, reauthReason: "invalid_grant", authCheckedAt: isoDate() });

  // An ungranted box reads the same token state, but is not configured.
  const other = await makeTmpBox();
  t.check(await readGoogleAuthStatus(other.root), {
    configured: false,
    connected: true,
    needsReauthSince: since.value,
    reauthReason: "invalid_grant",
    authCheckedAt: isoDate(),
  });

  // ## Re-marking preserves when the breakage started
  //
  // Every failing sync re-marks, but the health message and the notification latch
  // both key on *when it broke* — so the original timestamp has to survive.

  await markGoogleAuthDead({ reason: "a later failure" });
  const again = await readGoogleAuthStatus(box.root);
  t.check(again, { configured: true, connected: true, needsReauthSince: since.value, reauthReason: "a later failure", authCheckedAt: isoDate() });

  // ## A fresh token clears the state — repair can't be forgotten
  //
  // A new refresh or access token only ever reaches disk through `saveGoogleTokens`,
  // so clearing happens structurally rather than at each call site that might
  // remember to do it.

  await saveGoogleTokens({ refreshToken: "rt-2", accessToken: "at-2" });
  const repaired = await readGoogleAuthStatus();
  t.check(repaired, { configured: false, connected: true, needsReauthSince: null, reauthReason: null, authCheckedAt: isoDate() });

  // A write that carries no token (a bare expiry touch-up) leaves the state as it
  // found it — only proof the grant works may clear it:

  await markGoogleAuthDead({ reason: "broken again" });
  await saveGoogleTokens({ tokenExpiry: "2026-07-28T00:00:00.000Z" });
  const stillBroken = await readGoogleAuthStatus();
  t.check(stillBroken, { configured: false, connected: true, needsReauthSince: isoDate(), reauthReason: "broken again", authCheckedAt: isoDate() });

  // The flag is stored beside the credential it describes, so it travels with the
  // token file rather than living in any one box:

  const onDisk = JSON.parse(await readFile(TOKENS_FILE, "utf-8"));
  t.check(onDisk, {
    refreshToken: "rt-2",
    accessToken: "at-2",
    authCheckedAt: isoDate(),
    needsReauthSince: isoDate(),
    reauthReason: "broken again",
    tokenExpiry: "2026-07-28T00:00:00.000Z",
  });

  // ## A corrupt token file fails the write closed, it is not rewritten
  //
  // The store is a read-modify-write, and a partial file — a crash mid-write, before
  // this store wrote atomically — used to fall through to `{}`. The next token
  // update then rewrote the file from that empty base, wiping the one refresh token
  // shared by gmail, calendar, and drive across every box on the server. There is no
  // safe automatic recovery, so the write refuses and the bytes stay for a human.

  await writeFile(TOKENS_FILE, '{"refreshToken": "trun');
  const failure = await tryCall(() => saveGoogleTokens({ accessToken: "fresh" }));
  t.check(failure, {
    name: "GoogleTokenStoreCorruptError",
    message: `Google token store at ${TOKENS_FILE} exists but could not be read or parsed. Refusing to overwrite it — inspect or remove the file by hand, then re-authorize.`,
    storePath: TOKENS_FILE,
  });
  t.checkText(await readFile(TOKENS_FILE, "utf-8"), '{"refreshToken": "trun');

  // A genuinely absent file is the legitimate first run, and still starts fresh.

  await rm(TOKENS_FILE, { force: true });
  await saveGoogleTokens({ refreshToken: "first-ever" });
  t.check(JSON.parse(await readFile(TOKENS_FILE, "utf-8")), { refreshToken: "first-ever", authCheckedAt: isoDate() });

  // Writes land by temp file + fsync + atomic rename, so that truncated state can no
  // longer be produced in the first place — and no temp sibling is left behind.

  t.check((await readdir(tmp)).toSorted(), ["google-tokens.json"]);
});
