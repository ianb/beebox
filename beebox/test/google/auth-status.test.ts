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
import { printed } from "agent-doctest/check";
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
async function tryCall(fn: () => Promise<unknown>): Promise<Error> {
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
  // doctest:L67
  t.check(isInvalidGrantError(gaxiosError("invalid_grant", { error: "invalid_grant" })), true);

  // doctest:L70
  t.check(
    // ReAuth variant: message is the stringified payload.
    isInvalidGrantError(gaxiosError('{"error":"invalid_grant","error_description":"ReAuth required"}')),
    true,
  );

  // doctest:L74
  t.check(isInvalidGrantError(gaxiosError("connect ETIMEDOUT")), false);

  // doctest:L77
  t.check(isInvalidGrantError(gaxiosError("Service Unavailable", { error: "backendError" })), false);

  // doctest:L80
  t.check(isInvalidGrantError(undefined), false);
});

// ## A transient failure is classified as "not our problem" and left alone
void test("A transient failure is classified as \"not our problem\" and left alone", async (t) => {
  const out = printed();
  const print = out.print;
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
  // doctest:L87
  const transient = await classifyRefreshFailure(gaxiosError("connect ETIMEDOUT"), {});
  await t.checkText(out.with(transient), "null");

  // doctest:L91
  const untouched = await readGoogleAuthStatus();
  await t.checkText(out.with(JSON.stringify({ needsReauthSince: untouched.needsReauthSince, connected: untouched.connected })), "{\"needsReauthSince\":null,\"connected\":false}");

  // ## An `invalid_grant` records the breakage and returns a typed error

  // doctest:L99
  await saveGoogleTokens({ refreshToken: "rt-1", accessToken: "at-1" });

  // doctest:L101
  const expired = await classifyRefreshFailure(
    gaxiosError("invalid_grant", { error: "invalid_grant", error_description: "Token has been expired or revoked." }),
    {},
  );
  await t.checkText(out.with(expired?.name), "GoogleAuthExpiredError");

  // doctest:L108
  // The token state is machine-wide, but `configured` asks whether THIS box holds
  // a grant for the OAuth app's credentials — so the read is per-box.
  const box = await grantedBox();
  const dead = await readGoogleAuthStatus(box.root);
  await t.checkText(out.with(JSON.stringify({ configured: dead.configured, connected: dead.connected, broken: dead.needsReauthSince !== null })), "{\"configured\":true,\"connected\":true,\"broken\":true}");

  // doctest:L115
  // An ungranted box reads the same token state, but is not configured.
  const other = await makeTmpBox();
  await t.checkText(out.with((await readGoogleAuthStatus(other.root)).configured), "false");

  // ## Re-marking preserves when the breakage started
  //
  // Every failing sync re-marks, but the health message and the notification latch
  // both key on *when it broke* — so the original timestamp has to survive.

  // doctest:L127
  const firstSince = dead.needsReauthSince;
  await markGoogleAuthDead({ reason: "a later failure" });
  const again = await readGoogleAuthStatus(box.root);
  await t.checkText(out.with(JSON.stringify({ sameSince: again.needsReauthSince === firstSince, reason: again.reauthReason })), "{\"sameSince\":true,\"reason\":\"a later failure\"}");

  // ## A fresh token clears the state — repair can't be forgotten
  //
  // A new refresh or access token only ever reaches disk through `saveGoogleTokens`,
  // so clearing happens structurally rather than at each call site that might
  // remember to do it.

  // doctest:L141
  await saveGoogleTokens({ refreshToken: "rt-2", accessToken: "at-2" });
  const repaired = await readGoogleAuthStatus();
  await t.checkText(
    out.with(JSON.stringify({
      broken: repaired.needsReauthSince !== null,
      reason: repaired.reauthReason,
      verified: repaired.authCheckedAt !== null,
    })),
    "{\"broken\":false,\"reason\":null,\"verified\":true}",
  );

  // A write that carries no token (a bare expiry touch-up) leaves the state as it
  // found it — only proof the grant works may clear it:

  // doctest:L155
  await markGoogleAuthDead({ reason: "broken again" });
  await saveGoogleTokens({ tokenExpiry: "2026-07-28T00:00:00.000Z" });
  const stillBroken = await readGoogleAuthStatus();
  await t.checkText(out.with(stillBroken.needsReauthSince !== null), "true");

  // The flag is stored beside the credential it describes, so it travels with the
  // token file rather than living in any one box:

  // doctest:L166
  const onDisk = JSON.parse(await readFile(TOKENS_FILE, "utf-8"));
  await t.checkText(out.with(JSON.stringify(Object.keys(onDisk).toSorted())), "[\"accessToken\",\"authCheckedAt\",\"needsReauthSince\",\"reauthReason\",\"refreshToken\",\"tokenExpiry\"]");

  // ## A corrupt token file fails the write closed, it is not rewritten
  //
  // The store is a read-modify-write, and a partial file — a crash mid-write, before
  // this store wrote atomically — used to fall through to `{}`. The next token
  // update then rewrote the file from that empty base, wiping the one refresh token
  // shared by gmail, calendar, and drive across every box on the server. There is no
  // safe automatic recovery, so the write refuses and the bytes stay for a human.

  // doctest:L180
  await writeFile(TOKENS_FILE, '{"refreshToken": "trun');
  const failure = await tryCall(() => saveGoogleTokens({ accessToken: "fresh" }));
  print(`error: ${failure.name}`);
  await t.checkText(out.with(print(`onDisk: ${await readFile(TOKENS_FILE, "utf-8")}`)), `error: GoogleTokenStoreCorruptError
onDisk: {"refreshToken": "trun`);

  // A genuinely absent file is the legitimate first run, and still starts fresh.

  // doctest:L192
  await rm(TOKENS_FILE, { force: true });
  await saveGoogleTokens({ refreshToken: "first-ever" });
  await t.checkText(out.with(JSON.parse(await readFile(TOKENS_FILE, "utf-8")).refreshToken), "first-ever");

  // Writes land by temp file + fsync + atomic rename, so that truncated state can no
  // longer be produced in the first place — and no temp sibling is left behind.

  // doctest:L202
  await t.checkText(out.with((await readdir(tmp)).toSorted().join(",")), "google-tokens.json");
});
