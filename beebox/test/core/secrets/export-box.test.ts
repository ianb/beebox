// # One box's share of the secret store
//
// `boxShareOf` (`src/core/secrets/export-box.ts`) is what a box user's own store
// holds on a unit host: that box's granted secrets with their values, its
// grants, and the publish records bound to it; nothing of a sibling's. A stale
// grant for a secret the master no longer holds is dropped, as `copyBoxGrants`
// drops it. `exportBoxSubscriptions` (`src/core/push-subscriptions.ts`) is the
// same split for the push store.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxShareOf, grantNamesFor } from "../../../src/core/secrets/export-box.js";
import type { SecretStoreData } from "../../../src/core/secrets/store.js";
import { exportBoxSubscriptions } from "../../../src/core/push-subscriptions.js";

const master: SecretStoreData = {
  secrets: {
    mistral: { value: "m-key", updated: "2026-01-01T00:00:00.000Z", note: "shared" },
    deepgram: { value: "d-key", updated: "2026-01-01T00:00:00.000Z" },
    "r2-personal": { value: "bucket-token", updated: "2026-01-01T00:00:00.000Z", shareable: false, owningBox: "personal" },
  },
  grants: {
    personal: { mistral: "agent", "r2-personal": "server", gone: "server" },
    other: { mistral: "server", deepgram: "server" },
  },
  cloudflarePublishConnections: {
    main: { accountId: "0123456789abcdef0123456789abcdef", credentialType: "account-api-token", apiToken: "cf-token", grants: { personal: "server", other: "server" } },
    spare: { accountId: "0123456789abcdef0123456789abcdef", credentialType: "user-api-token", grants: { other: "server" } },
  },
  cloudflarePublishBindings: {
    "personal-site": { boxSlug: "personal", connectionName: "main", accountId: "0123456789abcdef0123456789abcdef", bucketName: "b", workerName: "w", hostHandle: "h", createdAt: "2026-01-01T00:00:00.000Z" },
    "other-site": { boxSlug: "other", connectionName: "spare", accountId: "0123456789abcdef0123456789abcdef", bucketName: "b2", workerName: "w2", hostHandle: "h2", createdAt: "2026-01-01T00:00:00.000Z" },
  },
  cloudflarePublishBoxHosts: {
    other: { connectionName: "spare", accountId: "0123456789abcdef0123456789abcdef", bucketName: "b2", workerName: "w2", hostHandle: "h2", hostname: "other.example", status: "attached", createdAt: "2026-01-01T00:00:00.000Z" },
  },
};

void test("a box's share holds its grants and records, with values, and nothing of a sibling", async (t) => {
  t.check(boxShareOf(master, "personal"), {
    secrets: {
      mistral: { value: "m-key", updated: "2026-01-01T00:00:00.000Z", note: "shared" },
      "r2-personal": { value: "bucket-token", updated: "2026-01-01T00:00:00.000Z", shareable: false, owningBox: "personal" },
    },
    // The stale grant `gone` is dropped; the master had no such secret.
    grants: { personal: { mistral: "agent", "r2-personal": "server" } },
    cloudflarePublishConnections: {
      main: { accountId: "0123456789abcdef0123456789abcdef", credentialType: "account-api-token", apiToken: "cf-token", grants: { personal: "server" } },
    },
    cloudflarePublishBindings: {
      "personal-site": { boxSlug: "personal", connectionName: "main", accountId: "0123456789abcdef0123456789abcdef", bucketName: "b", workerName: "w", hostHandle: "h", createdAt: "2026-01-01T00:00:00.000Z" },
    },
  });
  // The verification the migration runs: grant names in the master, which the copy must match.
  t.check(grantNamesFor(master, "personal"), ["gone", "mistral", "r2-personal"]);
  t.check(grantNamesFor(boxShareOf(master, "personal"), "personal"), ["mistral", "r2-personal"]);
  // A box with no grants gets an empty store, not a missing one.
  t.check(boxShareOf(master, "nobody"), { secrets: {}, grants: {}, cloudflarePublishConnections: {}, cloudflarePublishBindings: {} });
});

void test("the push store splits per box, each endpoint opted into that box alone", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bbx-push-export-"));
  process.env.BBX_PUSH_STORE_DIR = dir;
  await writeFile(join(dir, "push-subscriptions.json"), JSON.stringify({
    "https://push.example/a": { keys: { p256dh: "p1", auth: "a1" }, boxes: ["personal", "other"], createdAt: "2026-01-01T00:00:00.000Z", ua: "phone" },
    "https://push.example/b": { keys: { p256dh: "p2", auth: "a2" }, boxes: ["other"], createdAt: "2026-01-02T00:00:00.000Z" },
  }));
  t.check(await exportBoxSubscriptions("personal"), {
    "https://push.example/a": { keys: { p256dh: "p1", auth: "a1" }, boxes: ["personal"], createdAt: "2026-01-01T00:00:00.000Z", ua: "phone" },
  });
  t.check(await exportBoxSubscriptions("nobody"), {});
});
