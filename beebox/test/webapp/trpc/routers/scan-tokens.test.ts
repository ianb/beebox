// # `scanTokens` tRPC procedures: mint once, list without secrets, revoke by name
//
// The boxholder's surface for the scan upload credential. Owner-only, like the
// mobile pairing procedures beside it: minting a credential is not something a box
// member — let alone a machine credential — may do.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate } from "@ianbicking/tap-check/check";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { verifyScanToken } from "../../../../src/core/scan/tokens.js";

function caller(boxRoot: string, { isOwner }: { isOwner: boolean }) {
  return appRouter.createCaller(trpcContext({
    boxRoot,
    user: { email: "owner@example.com", name: "Owner" },
    isOwner,
  }));
}

// ## create returns the secret once, and it really authenticates
void test("create returns the secret once, and it really authenticates", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L25
  const box = await makeTmpBox({ git: true });
  const owner = caller(box.root, { isOwner: true });
  const created = await owner.scanTokens.create({ name: "laptop-scansnap" });
  t.check(created, { name: "laptop-scansnap", token: any(String), createdAt: isoDate() });

  // doctest:L29
  t.check(await verifyScanToken(box.root, created.token), {
    name: "laptop-scansnap",
    tokenHash: any(String).matches(/^[\da-f]{64}$/),
    createdAt: isoDate(),
    createdBy: "owner@example.com",
    lastUsedAt: isoDate(),
  });

  // ## list never carries a secret or a hash

  // doctest:L36
  const listed = await owner.scanTokens.list();
  t.check(listed, [
    { name: "laptop-scansnap", createdAt: isoDate(), createdBy: "owner@example.com", lastUsedAt: isoDate(), revoked: false, lastClient: null },
  ]);

  // doctest:L40

  // ## revoke kills the credential; a second revoke reports NOT_FOUND

  // doctest:L47
  t.check(await owner.scanTokens.revoke({ name: "laptop-scansnap" }), {
    ok: true,
  });

  // doctest:L50
  t.check(await verifyScanToken(box.root, created.token), null);

  // doctest:L53
  t.check(await owner.scanTokens.revoke({ name: "laptop-scansnap" }).then(() => "no error", (e) => e.code), "NOT_FOUND");

  // ## A duplicate name is a CONFLICT, not a silent second credential
  //
  // Names are the revoke handle and the provenance string, so they stay unique.

  // doctest:L62
  await owner.scanTokens.create({ name: "desk-scanner" });
  t.check(await owner.scanTokens.create({ name: "desk-scanner" }).then(() => "no error", (e) => e.code), "CONFLICT");

  // An invalid name is rejected at the input schema, before any store write.

  // doctest:L70
  t.check(await owner.scanTokens.create({ name: "../../etc/passwd" }).then(() => "no error", (e) => e.code), "BAD_REQUEST");

  // ## Every procedure is owner-only

  // doctest:L77
  const member = caller(box.root, { isOwner: false });
  const codes = await Promise.all([
    member.scanTokens.create({ name: "sneaky" }).then(() => "no error", (e) => e.code),
    member.scanTokens.list().then(() => "no error", (e) => e.code),
    member.scanTokens.revoke({ name: "desk-scanner" }).then(() => "no error", (e) => e.code),
  ]);
  t.check(codes, [
    "FORBIDDEN",
    "FORBIDDEN",
    "FORBIDDEN",
  ]);
});
