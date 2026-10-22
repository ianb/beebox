// # `scanTokens` tRPC procedures: mint once, list without secrets, revoke by name
//
// The surface for the scan upload credential. Anyone with access to the box can
// add files through the web app, so anyone signed in may set up an uploader, as
// with pairing a phone: a person manages the uploaders they made, and the owner
// manages all of them.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate } from "@ianbicking/tap-check/check";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { verifyScanToken } from "../../../../src/core/scan/tokens.js";

function caller(boxRoot: string, { isOwner, email }: { isOwner: boolean; email: string | null }) {
  return appRouter.createCaller(trpcContext({
    boxRoot,
    user: email === null ? null : { email, name: email },
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
  const box = await makeTmpBox({ git: true });
  const owner = caller(box.root, { isOwner: true, email: "owner@example.com" });
  const created = await owner.scanTokens.create({ name: "laptop-scansnap" });
  t.check(created, { name: "laptop-scansnap", token: any(String), createdAt: isoDate() });

  t.check(await verifyScanToken(box.root, created.token), {
    name: "laptop-scansnap",
    tokenHash: any(String).matches(/^[\da-f]{64}$/),
    createdAt: isoDate(),
    createdBy: "owner@example.com",
    lastUsedAt: isoDate(),
  });

  // ## list never carries a secret or a hash

  const listed = await owner.scanTokens.list();
  t.check(listed, [
    { name: "laptop-scansnap", createdAt: isoDate(), createdBy: "owner@example.com", lastUsedAt: isoDate(), revoked: false, lastClient: null },
  ]);

  // ## revoke kills the credential; a second revoke reports NOT_FOUND

  t.check(await owner.scanTokens.revoke({ name: "laptop-scansnap" }), {
    ok: true,
  });

  t.check(await verifyScanToken(box.root, created.token), null);

  t.check(await owner.scanTokens.revoke({ name: "laptop-scansnap" }).then(() => "no error", (e) => e.code), "NOT_FOUND");

  // ## A duplicate name is a CONFLICT, not a silent second credential
  //
  // Names are the revoke handle and the provenance string, so they stay unique.

  await owner.scanTokens.create({ name: "desk-scanner" });
  t.check(await owner.scanTokens.create({ name: "desk-scanner" }).then(() => "no error", (e) => e.code), "CONFLICT");

  // An invalid name is rejected at the input schema, before any store write.

  t.check(await owner.scanTokens.create({ name: "../../etc/passwd" }).then(() => "no error", (e) => e.code), "BAD_REQUEST");

  // ## A member sets up and revokes their own uploader, and only their own

  const member = caller(box.root, { isOwner: false, email: "member@example.com" });
  const minted = await member.scanTokens.create({ name: "member-mac" });
  t.check((await verifyScanToken(box.root, minted.token))?.createdBy, "member@example.com");

  // The member's list holds only their own; the owner's holds every uploader.
  t.check((await member.scanTokens.list()).map((token) => token.name), ["member-mac"]);
  t.check((await owner.scanTokens.list()).map((token) => token.name), ["laptop-scansnap", "desk-scanner", "member-mac"]);

  // Somebody else's uploader reads as missing, so its name is not confirmed.
  t.check(await member.scanTokens.revoke({ name: "desk-scanner" }).then(() => "no error", (e) => e.code), "NOT_FOUND");
  t.check(await member.scanTokens.revoke({ name: "member-mac" }), { ok: true });

  // ## A caller with no person behind it cannot mint
  //
  // Its token would be recorded against nobody, and so be unrevocable by it.

  const machine = caller(box.root, { isOwner: false, email: null });
  t.check(await machine.scanTokens.create({ name: "orphan" }).then(() => "no error", (e) => e.code), "FORBIDDEN");
});
