// # Cloudflare publishing connections stay server-held
//
// Admin connection procedures store a verified account token in machine custody,
// expose metadata only except for the explicitly audited owner reveal, and grant
// it to boxes at `server` access. The ordinary secret APIs never receive this
// credential value.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, not } from "@ianbicking/tap-check/check";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { createFakeCloudflarePublishTokenVerifier } from "../../../../src/services/cloudflare-publish-token-verifier.js";
import { resolveCloudflarePublishCredential } from "../../../../src/core/secrets/cloudflare-publish.js";
import { getCloudflarePublishBinding, reserveCloudflarePublishBinding } from "../../../../src/core/secrets/cloudflare-publish.js";
import { listSecrets } from "../../../../src/core/secrets/lifecycle.js";
import { resolveSecret } from "../../../../src/core/secrets/resolve.js";
import { accessLogSegmentPath } from "../../../../src/core/secrets/access-log.js";
import { getBoxTimeISO } from "../../../../src/lib/time.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

const storeDir = await mkdtemp(join(tmpdir(), "bbx-cf-publish-"));
const storeFile = join(storeDir, "secrets.json");
process.env.BBX_SECRETS_FILE = storeFile;
const box = await makeTmpBox({ git: true });
const verifier = createFakeCloudflarePublishTokenVerifier();
const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const SAVED_CONNECTION = {
  name: "studio",
  accountId: ACCOUNT_ID,
  credentialType: "account-api-token",
  verifiedAt: isoDate(),
  tokenId: "fake-cloudflare-token-id",
  tokenStatus: "active",
  capabilities: {
    tokenForAccount: "verified",
    r2ObjectWrite: "unverified",
    workerDeploy: "unverified",
    accessLive: "unverified",
  },
  grants: [],
} as const;
function caller(isAuthenticatedOwner: boolean) {
  return appRouter.createCaller(trpcContext({
    boxRoot: box.root,
    boxSlug: "test-box",
    services: { cloudflarePublishTokenVerifier: verifier },
    user: { email: "owner@example.com", name: "Owner" },
    isAuthenticatedOwner,
  }));
}
const STORE_AFTER_SAVE = {
  secrets: {},
  grants: {},
  cloudflarePublishConnections: {
    studio: {
      accountId: ACCOUNT_ID,
      credentialType: "account-api-token",
      apiToken: "placeholder-cloudflare-token",
      tokenId: "fake-cloudflare-token-id",
      verifiedAt: isoDate(),
      capabilities: { tokenForAccountVerifiedAt: isoDate() },
      grants: {},
    },
  },
  cloudflarePublishBindings: {},
};
async function message(promise: Promise<unknown>) {
  try { await promise; return "allowed"; }
  catch (error) { return error instanceof TRPCError ? error.code : error instanceof Error ? error.message : String(error); }
}

// Only a real authenticated owner may manage this machine-wide credential.
void test("Only a real authenticated owner may manage this machine-wide credential.", async (t) => {
  t.check(await message(caller(false).cloudflarePublishConnections.list()), "FORBIDDEN");

  // Saving verifies the token against the selected account and returns metadata,
  // never the token itself. Other write capabilities remain explicitly unverified
  // until actual server provisioning exercises them.

  const owner = caller(true);
  const saved = await owner.cloudflarePublishConnections.save({
    name: "studio",
    accountId: "0123456789abcdef0123456789abcdef",
    apiToken: "placeholder-cloudflare-token",
  });
  t.check({ saved, verified: verifier.verified }, {
    saved: SAVED_CONNECTION,
    verified: [{ accountId: ACCOUNT_ID, apiToken: "placeholder-cloudflare-token" }],
  });

  // The token has its own server-only connection slot, not a generic secret slot.

  const metadata = await owner.cloudflarePublishConnections.list();
  const generic = await listSecrets();
  const raw = JSON.parse(await readFile(storeFile, "utf-8"));
  t.check({ metadata, genericNames: generic.map((entry) => entry.name), raw }, {
    metadata: [SAVED_CONNECTION],
    genericNames: [],
    raw: STORE_AFTER_SAVE,
  });

  // Only an authenticated owner may explicitly reveal the saved token. The audit
  // event identifies the credential without recording its value. Browser UI
  // refuses Show when `navigator.webdriver` is true; this is a client-side check.

  t.check(await message(caller(false).cloudflarePublishConnections.revealToken({ name: "studio" })), "FORBIDDEN");
  // A retired input field, passed through a variable so only the server-side schema rejects it.
  const legacyReveal = { name: "studio", webdriver: true };
  t.check(await message(owner.cloudflarePublishConnections.revealToken(legacyReveal)), "BAD_REQUEST");
  const revealed = await owner.cloudflarePublishConnections.revealToken({ name: "studio" });
  const log = await readFile(accessLogSegmentPath(getBoxTimeISO(box.root)), "utf8");
  const event = JSON.parse(log.trim().split("\n").at(-1) ?? "");
  t.check({ revealed, event }, {
    revealed: { token: "placeholder-cloudflare-token" },
    event: {
      ts: isoDate(),
      box: "test-box",
      secret: "cloudflare-publish/studio",
      purpose: "owner revealed token in Admin",
      event: "owner-read",
    },
  });
  t.check(log, not(any(String).includes("placeholder-cloudflare-token")));

  // A grant is always `server`; there is no API input that can raise a publishing
  // token to agent access. The resolver refuses boxes without the grant.

  await owner.cloudflarePublishConnections.grant({ name: "studio", boxSlug: "test-box" });
  const credential = await resolveCloudflarePublishCredential({
    name: "studio", boxSlug: "test-box", purpose: "publish-prepare", at: new Date().toISOString(),
  });
  const notGranted = await message(resolveCloudflarePublishCredential({
    name: "studio", boxSlug: "other-box", purpose: "publish-prepare", at: new Date().toISOString(),
  }));
  const genericResolve = await resolveSecret({ boxRoot: box.root, name: "cloudflare-publish/studio", purpose: "publish-prepare", access: "agent" });
  t.check({ credential, notGranted, genericResolve }, {
    credential: { accountId: ACCOUNT_ID, apiToken: "placeholder-cloudflare-token" },
    notGranted: "Cloudflare publishing connection 'studio' has no server grant for box 'other-box'.",
    genericResolve: {
      ok: false,
      error: {
        name: "UnknownSecretError",
        message: "No secret named \"cloudflare-publish/studio\" exists on this machine. It can be declared (bbx secrets declare cloudflare-publish/studio), but only the boxholder can supply its value.",
        secretName: "cloudflare-publish/studio",
        kind: "unknown-secret",
      },
    },
  });

  // Publication locators are box-owned, while sites in one box and connection share
  // the same isolated bucket. A copied PubId cannot be resolved by another box.

  const createdAt = new Date().toISOString();
  const bindingA = await reserveCloudflarePublishBinding({
    pubId: "abcdefghijklmnopqrstuvwxyz",
    boxSlug: "test-box",
    connectionName: "studio",
    bucketName: "bbx-pub-first",
    workerName: "worker-a",
    hostHandle: "host-a",
    createdAt,
  });
  const bindingB = await reserveCloudflarePublishBinding({
    pubId: "bcdefghijklmnopqrstuvwxyz2",
    boxSlug: "test-box",
    connectionName: "studio",
    bucketName: "bbx-pub-second",
    workerName: "worker-b",
    hostHandle: "host-b",
    createdAt,
  });
  t.check({ bindingA, bindingB }, {
    bindingA: {
      pubId: "abcdefghijklmnopqrstuvwxyz",
      boxSlug: "test-box",
      connectionName: "studio",
      accountId: ACCOUNT_ID,
      bucketName: "bbx-pub-first",
      workerName: "worker-a",
      hostHandle: "host-a",
      createdAt,
    },
    bindingB: {
      pubId: "bcdefghijklmnopqrstuvwxyz2",
      boxSlug: "test-box",
      connectionName: "studio",
      accountId: ACCOUNT_ID,
      bucketName: "bbx-pub-first",
      workerName: "worker-b",
      hostHandle: "host-b",
      createdAt,
    },
  });
  await t.checkThrows(
    () => getCloudflarePublishBinding({ pubId: bindingA.pubId, boxSlug: "other-box" }),
    "CloudflarePublishConnectionError: This publication id is already bound to a different box.",
  );

  // A failed verification does not create or rotate a connection. Revocation drops
  // the credential while retaining routing metadata and grants for diagnosis.

  const rejectingVerifier = createFakeCloudflarePublishTokenVerifier({ error: new Error("bad token") });
  const rejecting = appRouter.createCaller(trpcContext({
    boxRoot: box.root,
    boxSlug: "test-box",
    services: { cloudflarePublishTokenVerifier: rejectingVerifier },
    user: { email: "owner@example.com", name: "Owner" },
    isAuthenticatedOwner: true,
  }));
  const failed = await message(rejecting.cloudflarePublishConnections.save({
    name: "broken", accountId: "0123456789abcdef0123456789abcdef", apiToken: "placeholder-invalid-token",
  }));
  await owner.cloudflarePublishConnections.revoke({ name: "studio" });
  const after = (await owner.cloudflarePublishConnections.list())[0];
  const unavailable = await message(resolveCloudflarePublishCredential({
    name: "studio", boxSlug: "test-box", purpose: "publish-disable", at: new Date().toISOString(),
  }));
  t.check({ failed, names: (await owner.cloudflarePublishConnections.list()).map((item) => item.name), after, unavailable }, {
    failed: "BAD_REQUEST",
    names: ["studio"],
    after: {
      name: "studio",
      accountId: ACCOUNT_ID,
      credentialType: "account-api-token",
      verifiedAt: null,
      tokenId: null,
      tokenStatus: "revoked",
      capabilities: {
        tokenForAccount: "unverified",
        r2ObjectWrite: "unverified",
        workerDeploy: "unverified",
        accessLive: "unverified",
      },
      grants: [{ boxSlug: "test-box", access: "server" }],
    },
    unavailable: "Cloudflare publishing connection 'studio' is revoked; server operations are unavailable.",
  });
});
